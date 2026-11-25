import { describe, expect, it } from 'vitest';
import { snapshotFileName } from '../src/ui/snapshot';

describe('snapshotFileName', () => {
  it('names the image after the symbol, timeframe and local time', () => {
    expect(snapshotFileName('BTCUSDT', '1H', new Date(2026, 10, 25, 4, 7))).toBe('BTCUSDT_1H_2026-11-25_0407.png');
  });

  it('keeps file names safe', () => {
    expect(snapshotFileName('EUR/USD m15', '15m', new Date(2026, 0, 2, 13, 5))).toBe('EUR_USD_m15_15m_2026-01-02_1305.png');
  });
});
