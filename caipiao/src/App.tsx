import { useCallback, useEffect, useRef, useState } from 'react';
import { loadOrCreateAppState, saveAppState, type PersistedAppState } from './lotteryDb';
import {
  createInitialState,
  getPlay,
  getZoneValues,
  lotteryGames,
  lotteryIds,
  normalizeTicketBetCount,
} from './lotteryRules';
import type {
  LotteryGame,
  LotteryId,
  LotteryState,
  LotteryTicket,
  NumberStyle,
  PrizeLine,
  WinningNumber,
} from './lotteryTypes';

function formatNumber(value: number): string {
  return value.toLocaleString('zh-CN');
}

function formatBall(value: number): string {
  return String(value).padStart(2, '0');
}

function Ball({
  value,
  style,
  selected,
  matched,
  disabled,
  onClick,
}: {
  value: number;
  style: NumberStyle;
  selected?: boolean;
  matched?: boolean;
  disabled?: boolean;
  onClick?: () => void;
}) {
  return (
    <button
      className={`ball ball-${style}${selected ? ' selected' : ''}${matched ? ' matched' : ''}`}
      disabled={disabled}
      onClick={onClick}
      type="button"
    >
      {style === 'dice' ? value : formatBall(value)}
    </button>
  );
}

function getWinningStyles(game: LotteryGame, winningNumber: WinningNumber): NumberStyle[][] {
  if (game.id === 'ssq' || game.id === 'dlt') return [['red'], ['blue']];
  if (game.id === 'qlc') {
    return [winningNumber.numbers[0].map((_, index) => index === 7 ? 'blue' : 'red')];
  }
  if (game.id === 'k3') return [['dice']];
  return [['gold']];
}

function NumberDisplay({
  groups,
  styles,
  matchedGroups,
}: {
  groups: number[][];
  styles: NumberStyle[][];
  matchedGroups?: number[][];
}) {
  return (
    <div className="number-display">
      {groups.map((numbers, groupIndex) => (
        <div className="number-group" key={`group-${groupIndex}`}>
          {numbers.map((number, numberIndex) => (
            <Ball
              key={`${groupIndex}-${numberIndex}-${number}`}
              value={number}
              style={styles[groupIndex]?.[numberIndex] ?? styles[groupIndex]?.[0] ?? 'gold'}
              matched={matchedGroups?.[groupIndex]?.includes(number)}
              disabled
            />
          ))}
        </div>
      ))}
    </div>
  );
}

function createTicketStyles(game: LotteryGame, ticket: LotteryTicket): NumberStyle[][] {
  const play = getPlay(game, ticket.playType);
  return ticket.selections.map((_, index) => [play.zones[index]?.style ?? 'gold']);
}

function getTicketMatchedGroups(
  game: LotteryGame,
  ticket: LotteryTicket,
  winningNumber: WinningNumber,
): number[][] {
  if (game.id === 'fc3d' || game.id === 'pl3' || game.id === 'pl5') {
    return winningNumber.numbers[0].map((number) => [number]);
  }
  if (game.id !== 'k3') return winningNumber.numbers;

  const dice = winningNumber.numbers[0];
  const counts = new Map<number, number>();
  dice.forEach((number) => counts.set(number, (counts.get(number) ?? 0) + 1));
  const pair = [...counts.entries()].find(([, count]) => count === 2)?.[0];
  const single = [...counts.entries()].find(([, count]) => count === 1)?.[0];
  if (ticket.playType === 'sum') return [[dice.reduce((total, number) => total + number, 0)]];
  if (ticket.playType === 'double-single') return [[pair ?? 0], [single ?? 0]];
  if (ticket.playType === 'triple-single') return [[counts.size === 1 ? dice[0] : 0]];
  if (ticket.playType === 'double-all') return [[pair ?? 0]];
  return [[...counts.keys()]];
}

function ticketResult(game: LotteryGame, ticket: LotteryTicket, winningNumber: WinningNumber) {
  const lines = game.analyzeTicket(ticket, winningNumber);
  return {
    count: lines.reduce((total, line) => total + line.count, 0),
    amount: lines.reduce((total, line) => total + line.amount, 0),
    labels: lines.filter((line) => line.count > 0).map((line) => line.label),
  };
}

function totalPrize(lines: PrizeLine[]): number {
  return lines.reduce((total, line) => total + line.amount, 0);
}

interface RuleDotGroup {
  style: NumberStyle;
  total: number;
  bright: number;
}

type RulePattern = RuleDotGroup[];

function zonePattern(
  style: NumberStyle,
  total: number,
  bright: number,
): RuleDotGroup {
  return { style, total, bright };
}

function getPrizeRulePatterns(game: LotteryGame, line: PrizeLine): RulePattern[] {
  if (game.id === 'ssq') {
    const matches: Record<string, Array<[number, number]>> = {
      '1': [[6, 1]],
      '2': [[6, 0]],
      '3': [[5, 1]],
      '4': [[5, 0], [4, 1]],
      '5': [[4, 0], [3, 1]],
      '6': [[2, 1], [1, 1], [0, 1]],
    };
    return (matches[line.key] ?? []).map(([red, blue]) => [
      zonePattern('red', 6, red),
      zonePattern('blue', 1, blue),
    ]);
  }

  if (game.id === 'dlt') {
    const matches: Record<string, Array<[number, number]>> = {
      '1': [[5, 2]],
      '2': [[5, 1]],
      '3': [[5, 0]],
      '4': [[4, 2]],
      '5': [[4, 1]],
      '6': [[3, 2]],
      '7': [[4, 0]],
      '8': [[3, 1], [2, 2]],
      '9': [[3, 0], [2, 1], [1, 2], [0, 2]],
    };
    return (matches[line.key] ?? []).map(([front, back]) => [
      zonePattern('red', 5, front),
      zonePattern('blue', 2, back),
    ]);
  }

  if (game.id === 'qlc') {
    const matches: Record<string, [number, number, number]> = {
      '1': [7, 0, 0],
      '2': [6, 1, 0],
      '3': [6, 0, 1],
      '4': [5, 1, 1],
      '5': [5, 0, 2],
      '6': [4, 1, 2],
      '7': [4, 0, 3],
    };
    const [basic, special, missed] = matches[line.key] ?? [0, 0, 7];
    return [[
      zonePattern('red', basic, basic),
      zonePattern('blue', special, special),
      zonePattern('red', missed, 0),
    ]];
  }

  if (game.id === 'pl5') return [[zonePattern('gold', 5, 5)]];
  if (game.id === 'fc3d' || game.id === 'pl3') {
    if (line.key === 'group3') {
      return [[zonePattern('gold', 2, 2), zonePattern('gold', 1, 0)]];
    }
    return [[zonePattern('gold', 3, 3)]];
  }

  const k3Patterns: Record<string, RulePattern> = {
    sum: [zonePattern('dice', 3, 3)],
    'triple-single': [zonePattern('dice', 3, 3)],
    'triple-all': [zonePattern('dice', 3, 3)],
    'double-single': [zonePattern('dice', 2, 2), zonePattern('dice', 1, 1)],
    'double-all': [zonePattern('dice', 2, 2), zonePattern('dice', 1, 0)],
    'triple-different': [zonePattern('green', 3, 3)],
    'straight-all': [zonePattern('green', 3, 3)],
    'double-different': [zonePattern('blue', 2, 2), zonePattern('dice', 1, 0)],
  };
  return [k3Patterns[line.key] ?? []];
}

function PrizeRuleDots({ game, line }: { game: LotteryGame; line: PrizeLine }) {
  const patterns = getPrizeRulePatterns(game, line);
  return (
    <span className="prize-rule-dots" aria-label={line.rule} title={line.rule}>
      {patterns.map((pattern, patternIndex) => (
        <span className="rule-pattern" key={`pattern-${patternIndex}`}>
          {patternIndex > 0 && <span className="rule-or">或</span>}
          {pattern.map((group, groupIndex) => (
            <span className="rule-dot-group" key={`${group.style}-${groupIndex}`}>
              {Array.from({ length: group.total }, (_, dotIndex) => (
                <span
                  className={`rule-dot rule-dot-${group.style}${dotIndex < group.bright ? ' bright' : ''}`}
                  key={dotIndex}
                />
              ))}
            </span>
          ))}
        </span>
      ))}
    </span>
  );
}

function TicketBetEditor({
  baseBetCount,
  betCount,
  disabled,
  onCommit,
}: {
  baseBetCount: number;
  betCount: number;
  disabled: boolean;
  onCommit: (betCount: number) => void;
}) {
  const [draft, setDraft] = useState(String(betCount));

  const commit = () => {
    const normalized = normalizeTicketBetCount(baseBetCount, Number(draft));
    setDraft(String(normalized));
    if (normalized !== betCount) onCommit(normalized);
  };

  return (
    <label className="ticket-bet-editor">
      <span>注数</span>
      <input
        aria-label={`修改注数，每份包含${baseBetCount}注`}
        disabled={disabled}
        inputMode="numeric"
        min={baseBetCount}
        onBlur={commit}
        onChange={(event) => setDraft(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === 'Enter') event.currentTarget.blur();
        }}
        step={baseBetCount}
        title={baseBetCount > 1 ? `必须为 ${baseBetCount} 的整数倍` : '请输入正整数'}
        type="number"
        value={draft}
      />
    </label>
  );
}

export default function App() {
  const [appState, setAppState] = useState<PersistedAppState | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [storageError, setStorageError] = useState('');
  const hasLoaded = useRef(false);
  const saveSequence = useRef(0);
  const saveQueue = useRef<Promise<void>>(Promise.resolve());

  useEffect(() => {
    let active = true;
    loadOrCreateAppState()
      .then((state) => {
        if (active) {
          setAppState(state);
          hasLoaded.current = true;
        }
      })
      .catch((error: unknown) => {
        if (active) {
          const fallback = {
            activeLotteryId: 'ssq' as const,
            lotteries: Object.fromEntries(
              lotteryIds.map((id) => [id, createInitialState(lotteryGames[id])]),
            ) as Record<LotteryId, LotteryState>,
          };
          setAppState(fallback);
          setStorageError(error instanceof Error ? error.message : '本地数据库不可用');
        }
      })
      .finally(() => {
        if (active) setIsLoading(false);
      });
    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    if (!appState || !hasLoaded.current) return;
    const currentSequence = ++saveSequence.current;
    saveQueue.current = saveQueue.current
      .catch(() => undefined)
      .then(() => saveAppState(appState))
      .then(() => {
        if (currentSequence === saveSequence.current) setStorageError('');
      })
      .catch((error: unknown) => {
        if (currentSequence === saveSequence.current) {
          setStorageError(error instanceof Error ? error.message : '无法保存本地状态');
        }
      });
  }, [appState]);

  const updateLottery = useCallback((
    lotteryId: LotteryId,
    updater: (current: LotteryState) => LotteryState,
  ) => {
    setAppState((current) => {
      if (!current) return current;
      return {
        ...current,
        lotteries: {
          ...current.lotteries,
          [lotteryId]: updater(current.lotteries[lotteryId]),
        },
      };
    });
  }, []);

  if (isLoading || !appState) {
    return <div className="loading-screen">正在恢复各彩种模拟状态...</div>;
  }

  const activeId = appState.activeLotteryId;
  const game = lotteryGames[activeId];
  const state = appState.lotteries[activeId];
  const play = getPlay(game, state.playType);
  const totalBetCount = state.tickets.reduce((total, ticket) => total + ticket.betCount, 0);
  const totalCost = state.tickets.reduce((total, ticket) => total + ticket.cost, 0);
  const previewBetCount = game.calculateBetCount(state.playType, state.selections);
  const previewCost = previewBetCount * (game.pricePerBet + (state.appended ? 1 : 0));
  const prizeSummary = state.isDrawn
    ? game.summarizePrizes(state.tickets, state.winningNumber)
    : [];
  const prizeAmount = totalPrize(prizeSummary);
  const winningCount = prizeSummary.reduce((total, line) => total + line.count, 0);

  const selectLottery = (lotteryId: LotteryId) => {
    setAppState((current) => current ? { ...current, activeLotteryId: lotteryId } : current);
  };

  const changePlay = (playType: string) => {
    const nextPlay = getPlay(game, playType);
    updateLottery(activeId, (current) => ({
      ...current,
      playType: nextPlay.id,
      selections: nextPlay.zones.map(() => []),
      selectedCounts: nextPlay.zones.map((zone) => zone.defaultCount),
      appended: false,
    }));
  };

  const toggleSelection = (zoneIndex: number, value: number) => {
    if (state.isDrawn) return;
    updateLottery(activeId, (current) => {
      const next = current.selections.map((values) => [...values]);
      const zone = play.zones[zoneIndex];
      const values = new Set(next[zoneIndex] ?? []);
      if (values.has(value)) values.delete(value);
      else if (values.size < zone.pickMax) values.add(value);
      next[zoneIndex] = Array.from(values).sort((a, b) => a - b);
      return { ...current, selections: next };
    });
  };

  const changeSelectedCount = (zoneIndex: number, count: number) => {
    updateLottery(activeId, (current) => {
      const counts = [...current.selectedCounts];
      counts[zoneIndex] = count;
      return { ...current, selectedCounts: counts };
    });
  };

  const buyTicket = () => {
    if (state.isDrawn) return;
    const id = state.tickets.length + 1;
    const ticket = state.purchaseMode === 'random'
      ? game.createRandomTicket(state.playType, state.selectedCounts, state.appended, id)
      : game.createManualTicket(state.playType, state.selections, state.appended, id);
    if (!ticket) return;
    updateLottery(activeId, (current) => ({
      ...current,
      tickets: [...current.tickets, ticket],
      selections: state.purchaseMode === 'manual' ? play.zones.map(() => []) : current.selections,
    }));
  };

  const setTicketBetCount = (ticketId: number, requestedBetCount: number) => {
    if (state.isDrawn) return;
    updateLottery(activeId, (current) => ({
      ...current,
      tickets: current.tickets.map((ticket) => {
        if (ticket.id !== ticketId) return ticket;
        const baseBetCount = game.calculateBetCount(ticket.playType, ticket.selections);
        const betCount = normalizeTicketBetCount(baseBetCount, requestedBetCount);
        const multiplier = betCount / baseBetCount;
        const unitPrice = game.pricePerBet + (ticket.appended ? 1 : 0);
        return {
          ...ticket,
          multiplier,
          betCount,
          cost: betCount * unitPrice,
        };
      }),
    }));
  };

  const newRound = () => {
    const next = createInitialState(game);
    next.playType = state.playType;
    next.purchaseMode = state.purchaseMode;
    const activePlay = getPlay(game, next.playType);
    next.selections = activePlay.zones.map(() => []);
    next.selectedCounts = activePlay.zones.map((zone) => zone.defaultCount);
    updateLottery(activeId, () => next);
  };

  const manualTicket = game.createManualTicket(
    state.playType,
    state.selections,
    state.appended,
    state.tickets.length + 1,
  );
  const canBuy = !state.isDrawn
    && (state.purchaseMode === 'random' || manualTicket !== null);

  return (
    <div className="app">
      <header className="header">
        <div className="eyebrow">本地娱乐模拟 · 不连接真实购彩平台</div>
        <h1>{game.name}</h1>
        <p>{game.subtitle}</p>
      </header>

      <nav className="lottery-nav" aria-label="彩种切换">
        {lotteryIds.map((lotteryId) => {
          const item = lotteryGames[lotteryId];
          return (
            <button
              className={lotteryId === activeId ? 'active' : ''}
              key={lotteryId}
              onClick={() => selectLottery(lotteryId)}
              type="button"
            >
              <strong>{item.shortName}</strong>
              {item.retired && <span>历史玩法</span>}
            </button>
          );
        })}
      </nav>

      {game.retired && (
        <div className="retired-notice">
          快3等高频快开游戏已退市，本入口仅用于历史规则演示，不代表当前在售彩票。
        </div>
      )}
      {storageError && <div className="storage-error">{storageError}，当前操作仍保留在页面内存中。</div>}

      <main>
        <section className="card purchase-card">
          <div className="card-head">
            <div>
              <h2>选择玩法与号码</h2>
              <span>{state.isDrawn ? '本期已开奖，请开始新一期' : '可连续购买多张票后统一开奖'}</span>
            </div>
            <a href={game.sourceUrl} target="_blank" rel="noreferrer">
              规则：{game.ruleVersion}
            </a>
          </div>

          <div className="play-tabs">
            {game.plays.map((item) => (
              <button
                className={item.id === state.playType ? 'active' : ''}
                disabled={state.isDrawn}
                key={item.id}
                onClick={() => changePlay(item.id)}
                type="button"
              >
                {item.name}
              </button>
            ))}
          </div>
          <p className="play-description">{play.description}</p>

          <div className="mode-row">
            <div className="mode-tabs">
              <button
                className={state.purchaseMode === 'random' ? 'active' : ''}
                disabled={state.isDrawn}
                onClick={() => updateLottery(activeId, (current) => ({
                  ...current,
                  purchaseMode: 'random',
                  selections: play.zones.map(() => []),
                }))}
                type="button"
              >
                随机购买
              </button>
              <button
                className={state.purchaseMode === 'manual' ? 'active' : ''}
                disabled={state.isDrawn}
                onClick={() => updateLottery(activeId, (current) => ({
                  ...current,
                  purchaseMode: 'manual',
                }))}
                type="button"
              >
                自选号码
              </button>
            </div>
            {play.appendable && (
              <label className="append-toggle">
                <input
                  checked={state.appended}
                  disabled={state.isDrawn}
                  onChange={(event) => updateLottery(activeId, (current) => ({
                    ...current,
                    appended: event.target.checked,
                  }))}
                  type="checkbox"
                />
                追加投注（每注+1元）
              </label>
            )}
          </div>

          {play.zones.length === 0 ? (
            <div className="no-selection">该玩法无需选择具体号码，直接购买即可。</div>
          ) : state.purchaseMode === 'random' ? (
            <div className="count-grid">
              {play.zones.map((zone, index) => (
                <label key={zone.id}>
                  <span>{zone.label}数量</span>
                  <select
                    disabled={state.isDrawn}
                    onChange={(event) => changeSelectedCount(index, Number(event.target.value))}
                    value={state.selectedCounts[index] ?? zone.defaultCount}
                  >
                    {Array.from(
                      { length: zone.pickMax - zone.pickMin + 1 },
                      (_, optionIndex) => optionIndex + zone.pickMin,
                    ).map((count) => <option key={count} value={count}>{count} 个</option>)}
                  </select>
                </label>
              ))}
            </div>
          ) : (
            <div className="manual-picker">
              {play.zones.map((zone, zoneIndex) => (
                <div className="picker-zone" key={zone.id}>
                  <div className="picker-head">
                    <strong>{zone.label}</strong>
                    <span>
                      已选 {state.selections[zoneIndex]?.length ?? 0}
                      {zone.pickMin === zone.pickMax ? `/${zone.pickMin}` : `（至少${zone.pickMin}）`}
                    </span>
                  </div>
                  <div className="ball-grid">
                    {getZoneValues(zone).map((number) => (
                      <Ball
                        disabled={state.isDrawn}
                        key={number}
                        onClick={() => toggleSelection(zoneIndex, number)}
                        selected={state.selections[zoneIndex]?.includes(number)}
                        style={zone.style}
                        value={number}
                      />
                    ))}
                  </div>
                </div>
              ))}
              <button
                className="clear-button"
                onClick={() => updateLottery(activeId, (current) => ({
                  ...current,
                  selections: play.zones.map(() => []),
                }))}
                type="button"
              >
                清空自选
              </button>
            </div>
          )}

          <div className="purchase-summary">
            <div>
              <span>下一张票</span>
              <strong>
                {state.purchaseMode === 'random'
                  ? '随机生成'
                  : `${formatNumber(previewBetCount)} 注`}
              </strong>
            </div>
            <div>
              <span>预计金额</span>
              <strong>
                {state.purchaseMode === 'random' && game.id === 'k3' && state.playType === 'double-single'
                  ? '按组合计算'
                  : `¥${formatNumber(state.purchaseMode === 'random'
                    ? game.createRandomTicket(
                      state.playType,
                      state.selectedCounts,
                      state.appended,
                      0,
                    ).cost
                    : previewCost)}`}
              </strong>
            </div>
          </div>

          <div className="action-row">
            <button className="primary-button" disabled={!canBuy} onClick={buyTicket} type="button">
              {state.tickets.length ? '再买一张' : '购买一张'}
            </button>
            <button
              className="draw-button"
              disabled={state.isDrawn || state.tickets.length === 0}
              onClick={() => updateLottery(activeId, (current) => ({ ...current, isDrawn: true }))}
              type="button"
            >
              开奖
            </button>
            <button className="secondary-button" onClick={newRound} type="button">新一期</button>
          </div>
        </section>

        <section className="card">
          <div className="stats">
            <div><strong>{state.tickets.length}</strong><span>已购票数</span></div>
            <div><strong>{formatNumber(totalBetCount)}</strong><span>累计注数</span></div>
            <div><strong>¥{formatNumber(totalCost)}</strong><span>累计金额</span></div>
          </div>

          {state.tickets.length === 0 ? (
            <div className="empty-state">选择玩法后随机购买或自选号码</div>
          ) : (
            <div className="ticket-list">
              {[...state.tickets].reverse().map((ticket) => {
                const result = state.isDrawn
                  ? ticketResult(game, ticket, state.winningNumber)
                  : null;
                const ticketPlay = getPlay(game, ticket.playType);
                const multiplier = ticket.multiplier ?? 1;
                const baseBetCount = game.calculateBetCount(ticket.playType, ticket.selections);
                return (
                  <article className={result?.count ? 'ticket won' : 'ticket'} key={ticket.id}>
                    <div className="ticket-head">
                      <div>
                        <strong>第 {ticket.id} 张 · {ticketPlay.name}</strong>
                        {ticket.appended && <span className="tag">追加</span>}
                      </div>
                      <div className="ticket-meta">
                        <span>
                          {multiplier > 1
                            ? `${formatNumber(baseBetCount)} 注 × ${multiplier} 份`
                            : `${formatNumber(ticket.betCount)} 注`}
                          {' · '}¥{formatNumber(ticket.cost)}
                        </span>
                        <TicketBetEditor
                          baseBetCount={baseBetCount}
                          betCount={ticket.betCount}
                          disabled={state.isDrawn}
                          key={`${ticket.id}-${ticket.betCount}`}
                          onCommit={(betCount) => setTicketBetCount(ticket.id, betCount)}
                        />
                      </div>
                    </div>
                    {ticket.selections.length > 0
                      ? (
                        <NumberDisplay
                          groups={ticket.selections}
                          matchedGroups={state.isDrawn
                            ? getTicketMatchedGroups(game, ticket, state.winningNumber)
                            : undefined}
                          styles={createTicketStyles(game, ticket)}
                        />
                      )
                      : <div className="ticket-plain">{ticketPlay.description}</div>}
                    {result && (
                      <div className={result.count ? 'ticket-result won' : 'ticket-result'}>
                        {result.count
                          ? `${result.labels.join('、')} · ${result.count}注 · ¥${formatNumber(result.amount)}`
                          : '未中奖'}
                      </div>
                    )}
                  </article>
                );
              })}
            </div>
          )}
        </section>

        {state.isDrawn && (
          <section className="card result-card">
            <div className="result-title">开奖结果</div>
            <div className="winning-number">
              <span>本期开奖号码</span>
              <NumberDisplay
                groups={game.formatWinningNumber(state.winningNumber)}
                styles={getWinningStyles(game, state.winningNumber)}
              />
              {game.id === 'qlc' && <small>最后一个蓝色号码为特别号</small>}
            </div>
            <div className="result-stats">
              <div><span>中奖注数</span><strong>{formatNumber(winningCount)}</strong></div>
              <div><span>模拟奖金</span><strong>¥{formatNumber(prizeAmount)}</strong></div>
              <div>
                <span>模拟盈亏</span>
                <strong className={prizeAmount >= totalCost ? 'profit' : 'loss'}>
                  {prizeAmount >= totalCost ? '+' : '-'}¥{formatNumber(Math.abs(prizeAmount - totalCost))}
                </strong>
              </div>
            </div>
            <div className="prize-table">
              <div className="prize-row prize-head">
                <span>奖项及中奖规则</span><span>注数</span><span>单注奖金</span><span>小计</span>
              </div>
              {prizeSummary.map((line) => (
                <div className={line.count ? 'prize-row hit' : 'prize-row'} key={line.key}>
                  <span className="prize-label">
                    <span>{line.label}</span>
                    <PrizeRuleDots game={game} line={line} />
                  </span>
                  <span>{formatNumber(line.count)}</span>
                  <span>¥{formatNumber(line.unitPrize)}</span>
                  <span>¥{formatNumber(line.amount)}</span>
                </div>
              ))}
            </div>
            <p className="prize-note">
              标注“模拟”的浮动奖使用估算金额；实际奖金会随当期销量、奖池和中奖注数变化。
            </p>
          </section>
        )}
      </main>

      <footer>
        所有号码均在本地随机生成并保存在浏览器中 · 每注基础价格2元 · 纯属娱乐，请理性购彩
      </footer>
    </div>
  );
}
