import { describe, expect, it } from 'vitest';
import { decimalsOf } from '../src/providers/binance';

describe('decimalsOf (Binance tick size → price decimals)', () => {
  it.each([
    ['0.01000000', 2],
    ['0.00010000', 4],
    ['0.00000001', 8],
    ['1.00000000', 0],
    ['10', 0],
  ])('%s → %i', (tick, decimals) => expect(decimalsOf(tick)).toBe(decimals));
});
