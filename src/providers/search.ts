import { PROVIDERS } from './index';
import type { DataProvider, SymbolInfo } from './types';

/** "Bybit TradFi (forex, gold, stocks)" → "Bybit TradFi": the label next to each result. */
export function sourceLabel(p: DataProvider): string {
  return p.name.replace(/\s*\(.*\)$/, '');
}

const EMPTY_FIRST = 20; // empty box: this many from the chart's source…
const EMPTY_OTHERS = 10; // …and this many from each of the others
const MAX_RESULTS = 60;

/**
 * Merges the result lists of several sources (each already in its own best-first order) into one.
 *
 * With a query: exact symbol matches first ("xau" also matches XAUUSDT), then symbols starting with it, then the rest (name
 * or middle of the symbol). Within each of these, the sources take turns, the first list first,
 * so one source with many matches can't push the others off the list.
 * With an empty box: the first source's top entries, then a few of each other's.
 */
export function mergeResults(query: string, lists: SymbolInfo[][]): SymbolInfo[] {
  const q = query.trim().toUpperCase();
  if (!q) return lists.flatMap((list, i) => list.slice(0, i === 0 ? EMPTY_FIRST : EMPTY_OTHERS));

  // "xau" or "btc" means the USDT market of that name above all.
  const exact = (sym: string) => sym === q || sym === `${q}USDT`;
  const tier = (s: SymbolInfo) => (exact(s.symbol) ? 0 : s.symbol.startsWith(q) ? 1 : 2);
  const ranked: { item: SymbolInfo; tier: number; rank: number; source: number }[] = [];
  lists.forEach((list, source) => {
    const seen = [0, 0, 0];
    for (const item of list) {
      const t = tier(item);
      ranked.push({ item, tier: t, rank: seen[t]++, source });
    }
  });
  ranked.sort((a, b) => a.tier - b.tier || a.rank - b.rank || a.source - b.source);
  return ranked.slice(0, MAX_RESULTS).map((r) => r.item);
}

/**
 * Searches every source that has a symbol list, the chart's own source first. Each result
 * carries its source, so picking it can switch the chart there.
 *
 * `partial` gets the merged list each time a source answers, so a slow or blocked source
 * doesn't hold up the others. Fails only when every source fails.
 */
export function searchAll(
  query: string,
  firstId: string,
  partial?: (items: SymbolInfo[]) => void,
): Promise<SymbolInfo[]> {
  const sources = PROVIDERS.filter((p) => p.searchSymbols);
  sources.sort((a, b) => Number(b.id === firstId) - Number(a.id === firstId));
  if (sources.length === 0) return Promise.resolve([]);

  const lists: SymbolInfo[][] = sources.map(() => []);
  const merged = () => mergeResults(query, lists);
  let failed = 0;
  let left = sources.length;
  let firstError: unknown;

  return new Promise((resolve, reject) => {
    sources.forEach((p, i) => {
      p.searchSymbols!(query)
        .then((res) => {
          lists[i] = res.map((s) => ({ ...s, providerId: p.id, source: sourceLabel(p) }));
          if (left > 1) partial?.(merged());
        })
        .catch((err: unknown) => {
          failed++;
          firstError ??= err;
        })
        .finally(() => {
          if (--left > 0) return;
          if (failed === sources.length) reject(firstError);
          else resolve(merged());
        });
    });
  });
}
