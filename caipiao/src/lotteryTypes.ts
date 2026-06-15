export type LotteryId = 'ssq' | 'dlt' | 'fc3d' | 'pl3' | 'pl5' | 'qlc' | 'k3';
export type PurchaseMode = 'random' | 'manual';
export type NumberStyle = 'red' | 'blue' | 'gold' | 'green' | 'dice';

export interface NumberZone {
  id: string;
  label: string;
  min: number;
  max: number;
  pickMin: number;
  pickMax: number;
  defaultCount: number;
  style: NumberStyle;
  allowEmpty?: boolean;
}

export interface PlayConfig {
  id: string;
  name: string;
  description: string;
  zones: NumberZone[];
  appendable?: boolean;
}

export interface LotteryTicket {
  id: number;
  lotteryId: LotteryId;
  playType: string;
  selections: number[][];
  multiplier: number;
  betCount: number;
  cost: number;
  appended?: boolean;
}

export interface WinningNumber {
  lotteryId: LotteryId;
  numbers: number[][];
  updatedAt: number;
}

export interface PrizeLine {
  key: string;
  label: string;
  rule: string;
  count: number;
  unitPrize: number;
  amount: number;
}

export interface TicketResult {
  count: number;
  amount: number;
  labels: string[];
}

export interface LotteryState {
  lotteryId: LotteryId;
  playType: string;
  purchaseMode: PurchaseMode;
  selections: number[][];
  selectedCounts: number[];
  appended: boolean;
  tickets: LotteryTicket[];
  winningNumber: WinningNumber;
  isDrawn: boolean;
  roundStartedAt: number;
  ruleVersion: string;
}

export interface LotteryGame {
  id: LotteryId;
  name: string;
  shortName: string;
  subtitle: string;
  ruleVersion: string;
  sourceUrl: string;
  retired?: boolean;
  pricePerBet: number;
  plays: PlayConfig[];
  createWinningNumber: () => WinningNumber;
  calculateBetCount: (playType: string, selections: number[][]) => number;
  createRandomTicket: (
    playType: string,
    selectedCounts: number[],
    appended: boolean,
    id: number,
  ) => LotteryTicket;
  createManualTicket: (
    playType: string,
    selections: number[][],
    appended: boolean,
    id: number,
  ) => LotteryTicket | null;
  analyzeTicket: (ticket: LotteryTicket, winningNumber: WinningNumber) => PrizeLine[];
  summarizePrizes: (tickets: LotteryTicket[], winningNumber: WinningNumber) => PrizeLine[];
  formatWinningNumber: (winningNumber: WinningNumber) => number[][];
}
