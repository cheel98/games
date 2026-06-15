import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it } from 'vitest';
import { loadOrCreateAppState, saveAppState } from './lotteryDb';

function deleteDatabase(): Promise<void> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.deleteDatabase('lottery-settings');
    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error);
    request.onblocked = () => reject(new Error('database deletion blocked'));
  });
}

function createLegacyDatabase(): Promise<void> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open('lottery-settings', 1);
    request.onupgradeneeded = () => {
      request.result.createObjectStore('settings', { keyPath: 'id' });
    };
    request.onsuccess = () => {
      const database = request.result;
      const transaction = database.transaction('settings', 'readwrite');
      transaction.objectStore('settings').put({
        id: 'winning-number',
        reds: [1, 2, 3, 4, 5, 6],
        blue: 7,
        updatedAt: 123,
      });
      transaction.oncomplete = () => {
        database.close();
        resolve();
      };
      transaction.onerror = () => reject(transaction.error);
    };
    request.onerror = () => reject(request.error);
  });
}

describe('lottery state database', () => {
  beforeEach(async () => {
    await deleteDatabase();
  });

  it('creates and restores seven isolated lottery states', async () => {
    const state = await loadOrCreateAppState();
    expect(Object.keys(state.lotteries)).toHaveLength(7);
    state.activeLotteryId = 'dlt';
    state.lotteries.dlt.isDrawn = true;
    state.lotteries.dlt.tickets.push({
      id: 1,
      lotteryId: 'dlt',
      playType: 'compound',
      selections: [[1, 2, 3, 4, 5], [1, 2]],
      multiplier: 1,
      betCount: 1,
      cost: 2,
    });
    await saveAppState(state);

    const restored = await loadOrCreateAppState();
    expect(restored.activeLotteryId).toBe('dlt');
    expect(restored.lotteries.dlt.isDrawn).toBe(true);
    expect(restored.lotteries.dlt.tickets).toHaveLength(1);
    expect(restored.lotteries.ssq.tickets).toHaveLength(0);
  });

  it('migrates the legacy SSQ winning number', async () => {
    await createLegacyDatabase();
    const state = await loadOrCreateAppState();
    expect(state.lotteries.ssq.winningNumber).toMatchObject({
      lotteryId: 'ssq',
      numbers: [[1, 2, 3, 4, 5, 6], [7]],
      updatedAt: 123,
    });
    expect(state.lotteries.dlt.lotteryId).toBe('dlt');
  });
});
