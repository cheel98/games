import type {
  LotteryGame,
  LotteryId,
  LotteryState,
  LotteryTicket,
  NumberZone,
  PlayConfig,
  PrizeLine,
  WinningNumber,
} from './lotteryTypes';

export function combination(n: number, k: number): number {
  if (k < 0 || n < k) return 0;
  let result = 1;
  for (let index = 1; index <= k; index += 1) {
    result = (result * (n - k + index)) / index;
  }
  return result;
}

export function normalizeTicketBetCount(baseBetCount: number, requestedBetCount: number): number {
  if (!Number.isFinite(baseBetCount) || baseBetCount < 1) return 1;
  if (!Number.isFinite(requestedBetCount)) return baseBetCount;
  const multiplier = Math.max(1, Math.round(requestedBetCount / baseBetCount));
  return baseBetCount * multiplier;
}

export function sampleUnique(min: number, max: number, count: number): number[] {
  const pool = Array.from({ length: max - min + 1 }, (_, index) => index + min);
  for (let index = 0; index < count; index += 1) {
    const swapIndex = index + Math.floor(Math.random() * (pool.length - index));
    [pool[index], pool[swapIndex]] = [pool[swapIndex], pool[index]];
  }
  return pool.slice(0, count).sort((a, b) => a - b);
}

function sum(values: number[]): number {
  return values.reduce((total, value) => total + value, 0);
}

function intersectCount(first: readonly number[], second: readonly number[]): number {
  const set = new Set(second);
  return first.filter((value) => set.has(value)).length;
}

function prize(
  key: string,
  label: string,
  rule: string,
  count: number,
  unitPrize: number,
): PrizeLine {
  return { key, label, rule, count, unitPrize, amount: count * unitPrize };
}

function summarize(
  game: LotteryGame,
  tickets: LotteryTicket[],
  winningNumber: WinningNumber,
): PrizeLine[] {
  const totals = new Map<string, PrizeLine>();
  tickets.flatMap((ticket) => game.analyzeTicket(ticket, winningNumber)).forEach((line) => {
    const current = totals.get(line.key);
    if (current) {
      current.count += line.count;
      current.amount += line.amount;
    } else {
      totals.set(line.key, { ...line });
    }
  });
  return Array.from(totals.values());
}

function zoneValues(zone: NumberZone): number[] {
  return Array.from({ length: zone.max - zone.min + 1 }, (_, index) => zone.min + index);
}

function selectionsAreValid(play: PlayConfig, selections: number[][]): boolean {
  return play.zones.every((zone, index) => {
    const values = selections[index] ?? [];
    if (zone.allowEmpty && values.length === 0) return true;
    return values.length >= zone.pickMin
      && values.length <= zone.pickMax
      && new Set(values).size === values.length
      && values.every((value) => Number.isInteger(value) && value >= zone.min && value <= zone.max);
  });
}

type ZoneBetCalculator = (playType: string, selections: number[][]) => number;
type ZoneAnalyzer = (
  ticket: LotteryTicket,
  winningNumber: WinningNumber,
) => PrizeLine[];

function createZoneGame(config: {
  id: LotteryId;
  name: string;
  shortName: string;
  subtitle: string;
  ruleVersion: string;
  sourceUrl: string;
  pricePerBet?: number;
  retired?: boolean;
  plays: PlayConfig[];
  winningZones: Array<{ min: number; max: number; count: number }>;
  createWinningNumbers?: () => number[][];
  calculateBetCount: ZoneBetCalculator;
  analyze: ZoneAnalyzer;
}): LotteryGame {
  const game: LotteryGame = {
    ...config,
    pricePerBet: config.pricePerBet ?? 2,
    createWinningNumber: () => ({
      lotteryId: config.id,
      numbers: config.createWinningNumbers?.()
        ?? config.winningZones.map((zone) => sampleUnique(zone.min, zone.max, zone.count)),
      updatedAt: Date.now(),
    }),
    calculateBetCount: config.calculateBetCount,
    createRandomTicket: (playType, selectedCounts, appended, id) => {
      const play = config.plays.find((candidate) => candidate.id === playType) ?? config.plays[0];
      const selections = play.zones.map((zone, index) => {
        const count = Math.min(
          zone.pickMax,
          Math.max(zone.pickMin, selectedCounts[index] ?? zone.defaultCount),
        );
        return count === 0 ? [] : sampleUnique(zone.min, zone.max, count);
      });
      if (config.id === 'k3'
        && play.id === 'double-single'
        && selections[0]?.length === 1
        && selections[0][0] === selections[1]?.[0]) {
        selections[1] = [selections[0][0] % 6 + 1];
      }
      const betCount = config.calculateBetCount(play.id, selections);
      return {
        id,
        lotteryId: config.id,
        playType: play.id,
        selections,
        multiplier: 1,
        betCount,
        cost: betCount * ((config.pricePerBet ?? 2) + (appended ? 1 : 0)),
        appended: play.appendable && appended,
      };
    },
    createManualTicket: (playType, selections, appended, id) => {
      const play = config.plays.find((candidate) => candidate.id === playType);
      if (!play || !selectionsAreValid(play, selections)) return null;
      const normalized = selections.map((values) => [...values].sort((a, b) => a - b));
      const betCount = config.calculateBetCount(play.id, normalized);
      if (betCount <= 0) return null;
      return {
        id,
        lotteryId: config.id,
        playType: play.id,
        selections: normalized,
        multiplier: 1,
        betCount,
        cost: betCount * ((config.pricePerBet ?? 2) + (appended ? 1 : 0)),
        appended: play.appendable && appended,
      };
    },
    analyzeTicket: (ticket, winningNumber) => {
      const multiplier = Number.isInteger(ticket.multiplier) && ticket.multiplier > 0
        ? ticket.multiplier
        : 1;
      return config.analyze(ticket, winningNumber).map((line) => ({
        ...line,
        count: line.count * multiplier,
        amount: line.amount * multiplier,
      }));
    },
    summarizePrizes: (tickets, winningNumber) => summarize(game, tickets, winningNumber),
    formatWinningNumber: (winningNumber) => winningNumber.numbers,
  };
  return game;
}

const ssqPlays: PlayConfig[] = [{
  id: 'compound',
  name: '复式',
  description: '红球至少选6个，蓝球至少选1个',
  zones: [
    { id: 'reds', label: '红球', min: 1, max: 33, pickMin: 6, pickMax: 33, defaultCount: 6, style: 'red' },
    { id: 'blues', label: '蓝球', min: 1, max: 16, pickMin: 1, pickMax: 16, defaultCount: 1, style: 'blue' },
  ],
}];

const ssq = createZoneGame({
  id: 'ssq',
  name: '双色球复式模拟器',
  shortName: '双色球',
  subtitle: '6个红球 + 1个蓝球，支持复式随机与自选',
  ruleVersion: '2026-01',
  sourceUrl: 'https://www.cwl.gov.cn/',
  plays: ssqPlays,
  winningZones: [{ min: 1, max: 33, count: 6 }, { min: 1, max: 16, count: 1 }],
  calculateBetCount: (_, selections) => combination(selections[0]?.length ?? 0, 6) * (selections[1]?.length ?? 0),
  analyze: (ticket, winning) => {
    const redWins = intersectCount(ticket.selections[0], winning.numbers[0]);
    const redOthers = ticket.selections[0].length - redWins;
    const blueWins = intersectCount(ticket.selections[1], winning.numbers[1]);
    const blueOthers = ticket.selections[1].length - blueWins;
    const reds = (matches: number) => combination(redWins, matches) * combination(redOthers, 6 - matches);
    return [
      prize('1', '一等奖（模拟）', '6个红球 + 蓝球', reds(6) * blueWins, 5_000_000),
      prize('2', '二等奖（模拟）', '6个红球', reds(6) * blueOthers, 100_000),
      prize('3', '三等奖', '5个红球 + 蓝球', reds(5) * blueWins, 3_000),
      prize('4', '四等奖', '5个红球，或4个红球 + 蓝球', reds(5) * blueOthers + reds(4) * blueWins, 200),
      prize('5', '五等奖', '4个红球，或3个红球 + 蓝球', reds(4) * blueOthers + reds(3) * blueWins, 10),
      prize('6', '六等奖', '蓝球且命中0–2个红球', (reds(2) + reds(1) + reds(0)) * blueWins, 5),
    ];
  },
});

const dlt = createZoneGame({
  id: 'dlt',
  name: '超级大乐透模拟器',
  shortName: '大乐透',
  subtitle: '前区5个 + 后区2个，支持复式及追加投注',
  ruleVersion: '第26014期起',
  sourceUrl: 'https://www.lottery.gov.cn/xxgk/tzgg/dlttz/20260115/10052026.html',
  plays: [{
    id: 'compound',
    name: '复式',
    description: '前区至少选5个，后区至少选2个',
    appendable: true,
    zones: [
      { id: 'front', label: '前区', min: 1, max: 35, pickMin: 5, pickMax: 35, defaultCount: 5, style: 'red' },
      { id: 'back', label: '后区', min: 1, max: 12, pickMin: 2, pickMax: 12, defaultCount: 2, style: 'blue' },
    ],
  }],
  winningZones: [{ min: 1, max: 35, count: 5 }, { min: 1, max: 12, count: 2 }],
  calculateBetCount: (_, selections) => combination(selections[0]?.length ?? 0, 5) * combination(selections[1]?.length ?? 0, 2),
  analyze: (ticket, winning) => {
    const frontWins = intersectCount(ticket.selections[0], winning.numbers[0]);
    const frontOthers = ticket.selections[0].length - frontWins;
    const backWins = intersectCount(ticket.selections[1], winning.numbers[1]);
    const backOthers = ticket.selections[1].length - backWins;
    const ways = (front: number, back: number) => (
      combination(frontWins, front)
      * combination(frontOthers, 5 - front)
      * combination(backWins, back)
      * combination(backOthers, 2 - back)
    );
    const appendFactor = ticket.appended ? 1.8 : 1;
    return [
      prize('1', '一等奖（模拟）', '前区5个 + 后区2个', ways(5, 2), Math.round(5_000_000 * appendFactor)),
      prize('2', '二等奖（模拟）', '前区5个 + 后区1个', ways(5, 1), Math.round(100_000 * appendFactor)),
      prize('3', '三等奖', '前区5个', ways(5, 0), 10_000),
      prize('4', '四等奖', '前区4个 + 后区2个', ways(4, 2), 3_000),
      prize('5', '五等奖', '前区4个 + 后区1个', ways(4, 1), 300),
      prize('6', '六等奖', '前区3个 + 后区2个', ways(3, 2), 200),
      prize('7', '七等奖', '前区4个', ways(4, 0), 100),
      prize('8', '八等奖', '前区3个 + 后区1个，或前区2个 + 后区2个', ways(3, 1) + ways(2, 2), 15),
      prize('9', '九等奖', '前区3个；或前区0–2个 + 后区相应号码', ways(3, 0) + ways(2, 1) + ways(1, 2) + ways(0, 2), 5),
    ];
  },
});

function digitPlays(includeGroups: boolean, digits: number): PlayConfig[] {
  const direct: PlayConfig = {
    id: 'direct',
    name: '直选复式',
    description: `按位置选择${digits}位号码`,
    zones: Array.from({ length: digits }, (_, index) => ({
      id: `digit-${index}`,
      label: ['百位', '十位', '个位', '第四位', '第五位'][index],
      min: 0,
      max: 9,
      pickMin: 1,
      pickMax: 10,
      defaultCount: 1,
      style: 'gold' as const,
    })),
  };
  if (!includeGroups) return [direct];
  return [
    direct,
    {
      id: 'group3',
      name: '组三复式',
      description: '选择至少2个不同数字，开奖号码含一组对子',
      zones: [{ id: 'numbers', label: '组选号码', min: 0, max: 9, pickMin: 2, pickMax: 10, defaultCount: 2, style: 'green' }],
    },
    {
      id: 'group6',
      name: '组六复式',
      description: '选择至少3个不同数字，开奖号码各不相同',
      zones: [{ id: 'numbers', label: '组选号码', min: 0, max: 9, pickMin: 3, pickMax: 10, defaultCount: 3, style: 'blue' }],
    },
  ];
}

function digitAnalyzer(prizes: { direct: number; group3?: number; group6?: number }) {
  return (ticket: LotteryTicket, winning: WinningNumber): PrizeLine[] => {
    const digits = winning.numbers[0];
    if (ticket.playType === 'direct') {
      const count = ticket.selections.every((values, index) => values.includes(digits[index])) ? 1 : 0;
      return [prize('direct', '直选', '按位置与开奖号码完全一致', count, prizes.direct)];
    }
    const distinct = new Set(digits);
    const selected = new Set(ticket.selections[0]);
    const containsAll = Array.from(distinct).every((value) => selected.has(value));
    if (ticket.playType === 'group3') {
      return [prize('group3', '组三', '开奖号码为两同一不同，且包含所选号码', distinct.size === 2 && containsAll ? 1 : 0, prizes.group3 ?? 0)];
    }
    return [prize('group6', '组六', '开奖号码各不相同，且包含所选3个号码', distinct.size === 3 && containsAll ? 1 : 0, prizes.group6 ?? 0)];
  };
}

function createDigitGame(
  id: 'fc3d' | 'pl3' | 'pl5',
  name: string,
  digits: number,
  prizes: { direct: number; group3?: number; group6?: number },
  sourceUrl: string,
): LotteryGame {
  return createZoneGame({
    id,
    name: `${name}模拟器`,
    shortName: name,
    subtitle: digits === 3 ? '支持直选、组三和组六复式投注' : '五位数字按位置直选复式',
    ruleVersion: '现行规则',
    sourceUrl,
    plays: digitPlays(digits === 3, digits),
    winningZones: [{ min: 0, max: 9, count: digits }],
    createWinningNumbers: () => [
      Array.from({ length: digits }, () => Math.floor(Math.random() * 10)),
    ],
    calculateBetCount: (playType, selections) => {
      if (playType === 'group3') return (selections[0]?.length ?? 0) * ((selections[0]?.length ?? 0) - 1);
      if (playType === 'group6') return combination(selections[0]?.length ?? 0, 3);
      return selections.reduce((total, values) => total * values.length, 1);
    },
    analyze: digitAnalyzer(prizes),
  });
}

const fc3d = createDigitGame(
  'fc3d',
  '福彩3D',
  3,
  { direct: 1_040, group3: 346, group6: 173 },
  'https://www.cwl.gov.cn/c/2021/11/10/493454.shtml',
);
const pl3 = createDigitGame(
  'pl3',
  '排列3',
  3,
  { direct: 1_040, group3: 346, group6: 173 },
  'https://www.lottery.gov.cn/bzzx/yxgz/20191119/1002855.html',
);
const pl5 = createDigitGame(
  'pl5',
  '排列5',
  5,
  { direct: 100_000 },
  'https://www.lottery.gov.cn/bzzx/yxgz/20191119/10011178.html',
);

const qlc = createZoneGame({
  id: 'qlc',
  name: '七乐彩复式模拟器',
  shortName: '七乐彩',
  subtitle: '从01–30中选择至少7个号码，开奖另含1个特别号',
  ruleVersion: '现行30选7规则',
  sourceUrl: 'https://www.cwl.gov.cn/c/2017/11/15/418902.shtml',
  plays: [{
    id: 'compound',
    name: '复式',
    description: '从30个号码中选择7个或更多',
    zones: [{ id: 'numbers', label: '基本号码', min: 1, max: 30, pickMin: 7, pickMax: 30, defaultCount: 7, style: 'red' }],
  }],
  winningZones: [{ min: 1, max: 30, count: 8 }],
  createWinningNumbers: () => {
    const basics = sampleUnique(1, 30, 7);
    const remaining = zoneValues({
      id: 'remaining',
      label: '',
      min: 1,
      max: 30,
      pickMin: 0,
      pickMax: 30,
      defaultCount: 0,
      style: 'red',
    }).filter((number) => !basics.includes(number));
    const special = remaining[Math.floor(Math.random() * remaining.length)];
    return [[...basics, special]];
  },
  calculateBetCount: (_, selections) => combination(selections[0]?.length ?? 0, 7),
  analyze: (ticket, winning) => {
    const basics = winning.numbers[0].slice(0, 7);
    const special = winning.numbers[0][7];
    const basicWins = intersectCount(ticket.selections[0], basics);
    const others = ticket.selections[0].length - basicWins - Number(ticket.selections[0].includes(special));
    const hasSpecial = Number(ticket.selections[0].includes(special));
    const ways = (basic: number, specialCount: number) => (
      combination(basicWins, basic)
      * combination(hasSpecial, specialCount)
      * combination(others, 7 - basic - specialCount)
    );
    return [
      prize('1', '一等奖（模拟）', '7个基本号码', ways(7, 0), 5_000_000),
      prize('2', '二等奖（模拟）', '6个基本号码 + 特别号', ways(6, 1), 100_000),
      prize('3', '三等奖', '6个基本号码', ways(6, 0), 3_000),
      prize('4', '四等奖', '5个基本号码 + 特别号', ways(5, 1), 200),
      prize('5', '五等奖', '5个基本号码', ways(5, 0), 50),
      prize('6', '六等奖', '4个基本号码 + 特别号', ways(4, 1), 10),
      prize('7', '七等奖', '4个基本号码', ways(4, 0), 5),
    ];
  },
});

const k3Plays: PlayConfig[] = [
  { id: 'sum', name: '和值', description: '选择三个骰子点数之和', zones: [{ id: 'sums', label: '和值', min: 3, max: 18, pickMin: 1, pickMax: 16, defaultCount: 1, style: 'gold' }] },
  { id: 'triple-single', name: '三同号单选', description: '指定三个相同号码', zones: [{ id: 'triples', label: '同号', min: 1, max: 6, pickMin: 1, pickMax: 6, defaultCount: 1, style: 'dice' }] },
  { id: 'triple-all', name: '三同号通选', description: '任意三个相同号码均中奖', zones: [] },
  {
    id: 'double-single',
    name: '二同号单选',
    description: '分别选择同号与不同号',
    zones: [
      { id: 'pair', label: '同号', min: 1, max: 6, pickMin: 1, pickMax: 6, defaultCount: 1, style: 'red' },
      { id: 'single', label: '不同号', min: 1, max: 6, pickMin: 1, pickMax: 6, defaultCount: 1, style: 'blue' },
    ],
  },
  { id: 'double-all', name: '二同号复选', description: '选择对子号码，开出所选对子即中奖', zones: [{ id: 'pairs', label: '对子', min: 1, max: 6, pickMin: 1, pickMax: 6, defaultCount: 1, style: 'red' }] },
  { id: 'triple-different', name: '三不同号', description: '选择至少3个不同号码', zones: [{ id: 'numbers', label: '不同号', min: 1, max: 6, pickMin: 3, pickMax: 6, defaultCount: 3, style: 'green' }] },
  { id: 'straight-all', name: '三连号通选', description: '开出123、234、345或456即中奖', zones: [] },
  { id: 'double-different', name: '二不同号', description: '选择至少2个不同号码', zones: [{ id: 'numbers', label: '不同号', min: 1, max: 6, pickMin: 2, pickMax: 6, defaultCount: 2, style: 'blue' }] },
];

const k3SumPrizes: Record<number, number> = {
  3: 240, 4: 80, 5: 40, 6: 25, 7: 16, 8: 12, 9: 10,
  10: 9, 11: 9, 12: 10, 13: 12, 14: 16, 15: 25, 16: 40, 17: 80, 18: 240,
};

const k3 = createZoneGame({
  id: 'k3',
  name: '快3历史玩法模拟器',
  shortName: '快3',
  subtitle: '高频快开玩法已退市，此处仅作历史规则娱乐模拟',
  ruleVersion: '历史规则',
  sourceUrl: 'https://m.mof.gov.cn/czsj/202108/t20210830_3748923.htm',
  retired: true,
  plays: k3Plays,
  winningZones: [{ min: 1, max: 6, count: 3 }],
  createWinningNumbers: () => [[
    Math.floor(Math.random() * 6) + 1,
    Math.floor(Math.random() * 6) + 1,
    Math.floor(Math.random() * 6) + 1,
  ].sort((a, b) => a - b)],
  calculateBetCount: (playType, selections) => {
    if (playType === 'triple-all' || playType === 'straight-all') return 1;
    if (playType === 'double-single') {
      return (selections[0] ?? []).reduce(
        (total, pair) => total + (selections[1] ?? []).filter((single) => single !== pair).length,
        0,
      );
    }
    if (playType === 'triple-different') return combination(selections[0]?.length ?? 0, 3);
    if (playType === 'double-different') return combination(selections[0]?.length ?? 0, 2);
    return selections[0]?.length ?? 0;
  },
  analyze: (ticket, winning) => {
    const dice = winning.numbers[0];
    const counts = new Map<number, number>();
    dice.forEach((value) => counts.set(value, (counts.get(value) ?? 0) + 1));
    const distinct = [...counts.keys()];
    const triple = distinct.length === 1;
    const pair = [...counts.entries()].find(([, count]) => count === 2)?.[0];
    const single = [...counts.entries()].find(([, count]) => count === 1)?.[0];
    const straight = distinct.length === 3 && Math.max(...distinct) - Math.min(...distinct) === 2;
    const play = k3Plays.find((candidate) => candidate.id === ticket.playType);
    let won = false;
    let amount = 0;
    switch (ticket.playType) {
      case 'sum': {
        const total = sum(dice);
        won = ticket.selections[0].includes(total);
        amount = k3SumPrizes[total];
        break;
      }
      case 'triple-single':
        won = triple && ticket.selections[0].includes(dice[0]);
        amount = 240;
        break;
      case 'triple-all':
        won = triple;
        amount = 40;
        break;
      case 'double-single':
        won = pair !== undefined && single !== undefined
          && ticket.selections[0].includes(pair) && ticket.selections[1].includes(single);
        amount = 80;
        break;
      case 'double-all':
        won = pair !== undefined && ticket.selections[0].includes(pair);
        amount = 15;
        break;
      case 'triple-different':
        won = distinct.length === 3 && distinct.every((value) => ticket.selections[0].includes(value));
        amount = 40;
        break;
      case 'straight-all':
        won = straight;
        amount = 10;
        break;
      case 'double-different':
        {
          const matches = distinct.filter((value) => ticket.selections[0].includes(value)).length;
          const winningBets = combination(matches, 2);
          return [prize(
            ticket.playType,
            play?.name ?? ticket.playType,
            '所选号码中任意2个出现在开奖号码中',
            winningBets,
            8,
          )];
        }
    }
    const rules: Record<string, string> = {
      sum: '三个骰子点数之和等于所选和值',
      'triple-single': '三个骰子均为所选同一号码',
      'triple-all': '三个骰子号码相同',
      'double-single': '开出所选对子号码和不同号码',
      'double-all': '开奖号码包含所选对子',
      'triple-different': '三个不同号码均在所选号码中',
      'straight-all': '开出123、234、345或456',
    };
    return [prize(
      ticket.playType,
      play?.name ?? ticket.playType,
      rules[ticket.playType] ?? play?.description ?? '',
      won ? 1 : 0,
      amount,
    )];
  },
});

export const lotteryGames: Record<LotteryId, LotteryGame> = {
  ssq,
  dlt,
  fc3d,
  pl3,
  pl5,
  qlc,
  k3,
};

export const lotteryIds = Object.keys(lotteryGames) as LotteryId[];

export function getPlay(game: LotteryGame, playType: string): PlayConfig {
  return game.plays.find((play) => play.id === playType) ?? game.plays[0];
}

export function createInitialState(game: LotteryGame): LotteryState {
  const play = game.plays[0];
  return {
    lotteryId: game.id,
    playType: play.id,
    purchaseMode: 'random',
    selections: play.zones.map(() => []),
    selectedCounts: play.zones.map((zone) => zone.defaultCount),
    appended: false,
    tickets: [],
    winningNumber: game.createWinningNumber(),
    isDrawn: false,
    roundStartedAt: Date.now(),
    ruleVersion: game.ruleVersion,
  };
}

export function getZoneValues(zone: NumberZone): number[] {
  return zoneValues(zone);
}
