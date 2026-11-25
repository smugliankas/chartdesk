import type { Point } from '../drawings/model';
import { getProvider } from '../providers';

/** A price alert. It fires once, when the price crosses `price` in either direction. */
export interface PriceAlert {
  id: string;
  providerId: string;
  symbol: string;
  price: number;
  /** Price as shown when the alert was created (keeps the symbol's decimals). */
  priceText: string;
  createdAt: number;
  /** Set once the alert has fired; it is then inactive until re-armed. */
  triggeredAt?: number;
  /** The drawing this alert follows, if it was created from one. */
  drawingId?: string;
  /** For sloped lines: the line, so the alert level moves with time. */
  line?: AlertLine;
}

export type AlertLineKind = 'trend' | 'ray' | 'extended' | 'arrow';

export interface AlertLine {
  kind: AlertLineKind;
  p1: Point;
  p2: Point;
}

const LINE_NAMES: Record<AlertLineKind, string> = { trend: 'trend line', ray: 'ray', extended: 'extended line', arrow: 'arrow' };

/** Alert level at a time (UNIX seconds). For a sloped line this is the line's price at that time. */
export function alertPriceAt(a: PriceAlert, time: number): number {
  if (!a.line) return a.price;
  const { p1, p2 } = a.line;
  if (p2.time === p1.time) return p1.price;
  return p1.price + ((p2.price - p1.price) * (time - p1.time)) / (p2.time - p1.time);
}

/** "92,000.00" or "trend line". */
export function alertTarget(a: PriceAlert): string {
  return a.line ? LINE_NAMES[a.line.kind] : a.priceText;
}

export interface NewAlert {
  providerId: string;
  symbol: string;
  price: number;
  priceText: string;
  /** When known, the starting point for detecting the crossing. */
  currentPrice?: number;
  drawingId?: string;
  line?: AlertLine;
}

const KEY = 'chartdesk:alerts';

function load(): PriceAlert[] {
  try {
    const raw = localStorage.getItem(KEY);
    const parsed: unknown = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? (parsed as PriceAlert[]) : [];
  } catch {
    return [];
  }
}

function newId(): string {
  return Math.random().toString(36).slice(2, 10) + Date.now().toString(36);
}

export const symbolKey = (providerId: string, symbol: string) => `${providerId}:${symbol}`;

/**
 * Keeps the alerts, saves them, and watches live prices for every symbol that has
 * an active alert (not only the one on the chart). Needs ChartDesk to be open in a tab.
 */
export class AlertManager {
  private alerts: PriceAlert[] = load();
  /** Last seen price per symbol, to detect crossings. */
  private lastPrice = new Map<string, number>();
  private subscriptions = new Map<string, () => void>();
  private readonly changeListeners: (() => void)[] = [];
  private readonly triggerListeners: ((a: PriceAlert, price: number) => void)[] = [];

  constructor() {
    this.syncSubscriptions();
  }

  get all(): readonly PriceAlert[] {
    return this.alerts;
  }

  get activeCount(): number {
    return this.alerts.filter((a) => !a.triggeredAt).length;
  }

  forSymbol(providerId: string, symbol: string): PriceAlert[] {
    return this.alerts.filter((a) => a.providerId === providerId && a.symbol === symbol);
  }

  onChange(fn: () => void): void {
    this.changeListeners.push(fn);
  }

  onTrigger(fn: (a: PriceAlert, price: number) => void): void {
    this.triggerListeners.push(fn);
  }

  add({ currentPrice, ...fields }: NewAlert): PriceAlert {
    const alert: PriceAlert = { id: newId(), createdAt: Date.now(), ...fields };
    this.alerts.push(alert);
    if (currentPrice !== undefined) this.lastPrice.set(symbolKey(alert.providerId, alert.symbol), currentPrice);
    this.changed();
    return alert;
  }

  remove(id: string): void {
    this.alerts = this.alerts.filter((a) => a.id !== id);
    this.changed();
  }

  clearTriggered(): void {
    this.alerts = this.alerts.filter((a) => !a.triggeredAt);
    this.changed();
  }

  /** Makes a fired alert active again. */
  rearm(id: string): void {
    this.alerts = this.alerts.map((a) => (a.id === id ? { ...a, triggeredAt: undefined } : a));
    this.changed();
  }

  /** Moves an alert (e.g. when its line is dragged). */
  update(id: string, patch: Pick<PriceAlert, 'price' | 'priceText'> & { line?: AlertLine }): void {
    this.alerts = this.alerts.map((a) => (a.id === id ? { ...a, ...patch } : a));
    this.changed();
  }

  /** Feeds a price seen elsewhere (e.g. the chart's own live updates). */
  observe(providerId: string, symbol: string, price: number): void {
    this.check(symbolKey(providerId, symbol), price);
  }

  // --- internals ---------------------------------------------------------------

  private changed(): void {
    try {
      localStorage.setItem(KEY, JSON.stringify(this.alerts));
    } catch {
      /* ignore */
    }
    this.syncSubscriptions();
    this.changeListeners.forEach((fn) => fn());
  }

  private check(key: string, price: number): void {
    const prev = this.lastPrice.get(key);
    this.lastPrice.set(key, price);
    if (prev === undefined || prev === price) return;

    let fired = false;
    const now = Date.now() / 1000;
    for (const a of this.alerts) {
      if (a.triggeredAt || symbolKey(a.providerId, a.symbol) !== key) continue;
      const level = alertPriceAt(a, now);
      const crossedUp = prev < level && price >= level;
      const crossedDown = prev > level && price <= level;
      if (crossedUp || crossedDown) {
        a.triggeredAt = Date.now();
        fired = true;
        this.triggerListeners.forEach((fn) => fn(a, price));
      }
    }
    if (fired) this.changed();
  }

  /** One live subscription per symbol with an active alert. */
  private syncSubscriptions(): void {
    const needed = new Map<string, PriceAlert>();
    for (const a of this.alerts) if (!a.triggeredAt) needed.set(symbolKey(a.providerId, a.symbol), a);

    for (const [key, stop] of this.subscriptions) {
      if (!needed.has(key)) {
        stop();
        this.subscriptions.delete(key);
      }
    }
    for (const [key, a] of needed) {
      if (this.subscriptions.has(key)) continue;
      const provider = getProvider(a.providerId);
      if (provider.id !== a.providerId || !provider.subscribe) continue;
      const stop = provider.subscribe(a.symbol, '1m', (c) => this.check(key, c.close));
      this.subscriptions.set(key, stop);
    }
  }
}
