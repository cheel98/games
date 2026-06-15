import { createInitialState, lotteryGames, lotteryIds } from './lotteryRules';
import type { LotteryId, LotteryState, WinningNumber } from './lotteryTypes';

const DB_NAME = 'lottery-settings';
const STORE_NAME = 'settings';
const DB_VERSION = 2;
const APP_STATE_KEY = 'multi-lottery-state';
const LEGACY_WINNING_KEY = 'winning-number';

export interface PersistedAppState {
  activeLotteryId: LotteryId;
  lotteries: Record<LotteryId, LotteryState>;
}

interface AppStateRecord extends PersistedAppState {
  id: typeof APP_STATE_KEY;
}

interface LegacyWinningRecord {
  id: typeof LEGACY_WINNING_KEY;
  reds: number[];
  blue: number;
  updatedAt: number;
}

function openDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      if (!request.result.objectStoreNames.contains(STORE_NAME)) {
        request.result.createObjectStore(STORE_NAME, { keyPath: 'id' });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error('无法打开本地数据库'));
  });
}

function isLotteryId(value: unknown): value is LotteryId {
  return typeof value === 'string' && lotteryIds.includes(value as LotteryId);
}

function isWinningNumber(value: unknown, lotteryId: LotteryId): value is WinningNumber {
  if (!value || typeof value !== 'object') return false;
  const winning = value as Partial<WinningNumber>;
  return winning.lotteryId === lotteryId
    && Array.isArray(winning.numbers)
    && winning.numbers.every((zone) => Array.isArray(zone) && zone.every(Number.isInteger))
    && typeof winning.updatedAt === 'number';
}

function normalizeState(lotteryId: LotteryId, value: unknown): LotteryState {
  const fallback = createInitialState(lotteryGames[lotteryId]);
  if (!value || typeof value !== 'object') return fallback;
  const state = value as Partial<LotteryState>;
  const play = lotteryGames[lotteryId].plays.find((candidate) => candidate.id === state.playType);
  if (!play || !isWinningNumber(state.winningNumber, lotteryId)) return fallback;
  const legacyDefaultCounts: Partial<Record<LotteryId, number[]>> = {
    ssq: [7, 1],
    dlt: [6, 2],
    qlc: [8],
  };
  const storedCounts = Array.isArray(state.selectedCounts) ? state.selectedCounts : [];
  const legacyDefaults = legacyDefaultCounts[lotteryId];
  const shouldMigrateDefaults = play.id === 'compound'
    && legacyDefaults?.length === storedCounts.length
    && legacyDefaults.every((count, index) => count === storedCounts[index]);
  return {
    ...fallback,
    playType: play.id,
    purchaseMode: state.purchaseMode === 'manual' ? 'manual' : 'random',
    selections: Array.isArray(state.selections)
      ? play.zones.map((_, index) => Array.isArray(state.selections?.[index]) ? state.selections[index] : [])
      : fallback.selections,
    selectedCounts: shouldMigrateDefaults
      ? play.zones.map((zone) => zone.defaultCount)
      : Array.isArray(state.selectedCounts)
      ? play.zones.map((zone, index) => Number.isInteger(state.selectedCounts?.[index])
        ? Math.min(zone.pickMax, Math.max(zone.pickMin, state.selectedCounts![index]))
        : zone.defaultCount)
      : fallback.selectedCounts,
    appended: Boolean(state.appended && play.appendable),
    tickets: Array.isArray(state.tickets)
      ? state.tickets
        .filter((ticket) => ticket?.lotteryId === lotteryId)
        .map((ticket) => {
          const multiplier = Number.isInteger(ticket.multiplier) && ticket.multiplier > 0
            ? ticket.multiplier
            : 1;
          const baseBetCount = lotteryGames[lotteryId].calculateBetCount(
            ticket.playType,
            ticket.selections,
          );
          const unitPrice = lotteryGames[lotteryId].pricePerBet + (ticket.appended ? 1 : 0);
          return {
            ...ticket,
            multiplier,
            betCount: baseBetCount * multiplier,
            cost: baseBetCount * unitPrice * multiplier,
          };
        })
      : [],
    winningNumber: state.winningNumber,
    isDrawn: Boolean(state.isDrawn),
    roundStartedAt: typeof state.roundStartedAt === 'number' ? state.roundStartedAt : fallback.roundStartedAt,
    ruleVersion: lotteryGames[lotteryId].ruleVersion,
  };
}

function createFreshAppState(): PersistedAppState {
  return {
    activeLotteryId: 'ssq',
    lotteries: Object.fromEntries(
      lotteryIds.map((lotteryId) => [lotteryId, createInitialState(lotteryGames[lotteryId])]),
    ) as Record<LotteryId, LotteryState>,
  };
}

function applyLegacyWinning(
  appState: PersistedAppState,
  legacy: unknown,
): PersistedAppState {
  if (!legacy || typeof legacy !== 'object') return appState;
  const record = legacy as Partial<LegacyWinningRecord>;
  if (record.id !== LEGACY_WINNING_KEY
    || !Array.isArray(record.reds)
    || record.reds.length !== 6
    || !Number.isInteger(record.blue)) return appState;
  appState.lotteries.ssq.winningNumber = {
    lotteryId: 'ssq',
    numbers: [[...record.reds].sort((a, b) => a - b), [record.blue!]],
    updatedAt: typeof record.updatedAt === 'number' ? record.updatedAt : Date.now(),
  };
  return appState;
}

export async function loadOrCreateAppState(): Promise<PersistedAppState> {
  const database = await openDatabase();
  try {
    return await new Promise((resolve, reject) => {
      const transaction = database.transaction(STORE_NAME, 'readwrite');
      const store = transaction.objectStore(STORE_NAME);
      const appRequest = store.get(APP_STATE_KEY);
      const legacyRequest = store.get(LEGACY_WINNING_KEY);
      let result = createFreshAppState();
      let appValue: Partial<AppStateRecord> | undefined;
      let legacyValue: unknown;
      let completedRequests = 0;

      const finishReading = () => {
        completedRequests += 1;
        if (completedRequests !== 2) return;

        if (appValue && isLotteryId(appValue.activeLotteryId) && appValue.lotteries) {
          result = {
            activeLotteryId: appValue.activeLotteryId,
            lotteries: Object.fromEntries(
              lotteryIds.map((lotteryId) => [
                lotteryId,
                normalizeState(lotteryId, appValue?.lotteries?.[lotteryId]),
              ]),
            ) as Record<LotteryId, LotteryState>,
          };
          return;
        }
        result = applyLegacyWinning(result, legacyValue);
        store.put({ id: APP_STATE_KEY, ...result } satisfies AppStateRecord);
      };

      transaction.oncomplete = () => resolve(result);
      transaction.onerror = () => reject(transaction.error ?? new Error('无法初始化本地状态'));
      transaction.onabort = () => reject(transaction.error ?? new Error('初始化本地状态已取消'));
      appRequest.onsuccess = () => {
        appValue = appRequest.result as Partial<AppStateRecord> | undefined;
        finishReading();
      };
      legacyRequest.onsuccess = () => {
        legacyValue = legacyRequest.result;
        finishReading();
      };
    });
  } finally {
    database.close();
  }
}

export async function saveAppState(state: PersistedAppState): Promise<void> {
  const database = await openDatabase();
  try {
    await new Promise<void>((resolve, reject) => {
      const transaction = database.transaction(STORE_NAME, 'readwrite');
      transaction.objectStore(STORE_NAME).put({
        id: APP_STATE_KEY,
        ...state,
      } satisfies AppStateRecord);
      transaction.oncomplete = () => resolve();
      transaction.onerror = () => reject(transaction.error ?? new Error('无法保存本地状态'));
      transaction.onabort = () => reject(transaction.error ?? new Error('保存本地状态已取消'));
    });
  } finally {
    database.close();
  }
}
