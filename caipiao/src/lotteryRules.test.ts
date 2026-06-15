import { describe, expect, it } from 'vitest';
import {
  combination,
  createInitialState,
  lotteryGames,
  lotteryIds,
  normalizeTicketBetCount,
} from './lotteryRules';
import type { LotteryTicket, WinningNumber } from './lotteryTypes';

function winning(lotteryId: WinningNumber['lotteryId'], numbers: number[][]): WinningNumber {
  return { lotteryId, numbers, updatedAt: 1 };
}

function ticket(
  lotteryId: LotteryTicket['lotteryId'],
  playType: string,
  selections: number[][],
  appended = false,
): LotteryTicket {
  const game = lotteryGames[lotteryId];
  const betCount = game.calculateBetCount(playType, selections);
  return {
    id: 1,
    lotteryId,
    playType,
    selections,
    multiplier: 1,
    betCount,
    cost: betCount * (game.pricePerBet + (appended ? 1 : 0)),
    appended,
  };
}

describe('shared lottery rules', () => {
  it('calculates combinations', () => {
    expect(combination(7, 6)).toBe(7);
    expect(combination(35, 5)).toBe(324_632);
    expect(combination(3, 4)).toBe(0);
  });

  it('normalizes edited totals to a valid ticket multiple', () => {
    expect(normalizeTicketBetCount(7, 14)).toBe(14);
    expect(normalizeTicketBetCount(7, 10)).toBe(7);
    expect(normalizeTicketBetCount(7, 19)).toBe(21);
    expect(normalizeTicketBetCount(1, 0)).toBe(1);
  });

  it('creates a complete independent initial state for every game', () => {
    for (const id of lotteryIds) {
      const state = createInitialState(lotteryGames[id]);
      expect(state.lotteryId).toBe(id);
      expect(state.winningNumber.lotteryId).toBe(id);
      expect(state.tickets).toEqual([]);
      expect(state.isDrawn).toBe(false);
    }
  });

  it('uses single-bet number counts as random defaults', () => {
    expect(createInitialState(lotteryGames.ssq).selectedCounts).toEqual([6, 1]);
    expect(createInitialState(lotteryGames.dlt).selectedCounts).toEqual([5, 2]);
    expect(createInitialState(lotteryGames.qlc).selectedCounts).toEqual([7]);
  });

  it('multiplies winning counts and amounts for repeated ticket copies', () => {
    const game = lotteryGames.ssq;
    const repeated = ticket('ssq', 'compound', [[1, 2, 3, 4, 5, 6], [7]]);
    repeated.multiplier = 3;
    repeated.betCount = 3;
    repeated.cost = 6;
    const firstPrize = game.analyzeTicket(
      repeated,
      winning('ssq', [[1, 2, 3, 4, 5, 6], [7]]),
    )[0];
    expect(firstPrize.count).toBe(3);
    expect(firstPrize.amount).toBe(15_000_000);
  });
});

describe('double-zone games', () => {
  it('calculates SSQ compound bets and all six prize levels', () => {
    const game = lotteryGames.ssq;
    expect(game.calculateBetCount('compound', [[1, 2, 3, 4, 5, 6, 7], [1, 2]])).toBe(14);
    const lines = game.analyzeTicket(
      ticket('ssq', 'compound', [[1, 2, 3, 4, 5, 6], [7]]),
      winning('ssq', [[1, 2, 3, 4, 5, 6], [7]]),
    );
    expect(lines.find((line) => line.key === '1')?.count).toBe(1);
    expect(lines.find((line) => line.key === '1')?.rule).toBe('6个红球 + 蓝球');
  });

  it('calculates DLT compound and appended ticket cost', () => {
    const game = lotteryGames.dlt;
    const selections = [[1, 2, 3, 4, 5, 6], [1, 2, 3]];
    expect(game.calculateBetCount('compound', selections)).toBe(18);
    expect(game.createManualTicket('compound', selections, true, 1)?.cost).toBe(54);
    const lines = game.analyzeTicket(
      ticket('dlt', 'compound', [[1, 2, 3, 4, 5], [1, 2]], true),
      winning('dlt', [[1, 2, 3, 4, 5], [1, 2]]),
    );
    expect(lines[0]).toMatchObject({
      count: 1,
      unitPrize: 9_000_000,
      rule: '前区5个 + 后区2个',
    });
  });

  it('handles QLC basic numbers and special number separately', () => {
    const game = lotteryGames.qlc;
    const draw = winning('qlc', [[1, 2, 3, 4, 5, 6, 7, 8]]);
    const first = game.analyzeTicket(ticket('qlc', 'compound', [[1, 2, 3, 4, 5, 6, 7]]), draw);
    const second = game.analyzeTicket(ticket('qlc', 'compound', [[1, 2, 3, 4, 5, 6, 8]]), draw);
    expect(first.find((line) => line.key === '1')?.count).toBe(1);
    expect(second.find((line) => line.key === '2')?.count).toBe(1);
    expect(second.find((line) => line.key === '2')?.rule).toContain('特别号');
  });
});

describe('digit games', () => {
  it('supports direct, group3 and group6 bets for FC3D and PL3', () => {
    for (const id of ['fc3d', 'pl3'] as const) {
      const game = lotteryGames[id];
      expect(game.calculateBetCount('direct', [[1, 2], [3], [4, 5]])).toBe(4);
      expect(game.calculateBetCount('group3', [[1, 2, 3]])).toBe(6);
      expect(game.calculateBetCount('group6', [[1, 2, 3, 4]])).toBe(4);
      expect(game.analyzeTicket(ticket(id, 'direct', [[1], [2], [3]]), winning(id, [[1, 2, 3]]))[0].count).toBe(1);
      expect(game.analyzeTicket(ticket(id, 'group3', [[1, 2]]), winning(id, [[1, 1, 2]]))[0].count).toBe(1);
      expect(game.analyzeTicket(ticket(id, 'group6', [[1, 2, 3]]), winning(id, [[3, 1, 2]]))[0].count).toBe(1);
    }
  });

  it('supports repeated winning digits and PL5 positional matching', () => {
    const game = lotteryGames.pl5;
    const draw = winning('pl5', [[1, 1, 2, 2, 3]]);
    expect(game.analyzeTicket(ticket('pl5', 'direct', [[1], [1], [2], [2], [3]]), draw)[0].count).toBe(1);
    for (let index = 0; index < 50; index += 1) {
      const generated = game.createWinningNumber().numbers[0];
      expect(generated).toHaveLength(5);
      expect(generated.every((value) => value >= 0 && value <= 9)).toBe(true);
    }
  });
});

describe('historical K3 plays', () => {
  const game = lotteryGames.k3;
  const cases: Array<[string, number[][], number[], number]> = [
    ['sum', [[6]], [1, 2, 3], 25],
    ['triple-single', [[4]], [4, 4, 4], 240],
    ['triple-all', [], [2, 2, 2], 40],
    ['double-single', [[2], [5]], [2, 2, 5], 80],
    ['double-all', [[3]], [3, 3, 6], 15],
    ['triple-different', [[1, 3, 5]], [1, 3, 5], 40],
    ['straight-all', [], [2, 3, 4], 10],
    ['double-different', [[1, 6]], [1, 4, 6], 8],
  ];

  it.each(cases)('awards %s correctly', (playType, selections, dice, amount) => {
    const line = game.analyzeTicket(
      ticket('k3', playType, selections),
      winning('k3', [dice]),
    )[0];
    expect(line.count).toBe(1);
    expect(line.amount).toBe(amount);
  });

  it('rejects equal pair and single selections in double-single bet count', () => {
    expect(game.calculateBetCount('double-single', [[1, 2], [1, 3]])).toBe(3);
  });

  it('counts every winning pair in a double-different compound ticket', () => {
    const line = game.analyzeTicket(
      ticket('k3', 'double-different', [[1, 2, 3]]),
      winning('k3', [[1, 2, 3]]),
    )[0];
    expect(line.count).toBe(3);
    expect(line.amount).toBe(24);
  });
});
