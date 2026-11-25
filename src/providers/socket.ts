/**
 * A WebSocket that reconnects on its own (backoff 1 s, 2 s, 4 s … up to 30 s) until stopped.
 * `onOpen` runs on every (re)connect, for sending subscriptions. With `ping`, that message is
 * sent every `pingMs` to keep the connection alive (Bybit closes quiet connections).
 */
export function liveSocket(
  url: string,
  handlers: { onOpen?: (ws: WebSocket) => void; onMessage: (data: unknown) => void; ping?: string; pingMs?: number },
): () => void {
  let ws: WebSocket | null = null;
  let stopped = false;
  let attempt = 0;
  let retryTimer: ReturnType<typeof setTimeout> | undefined;
  let pingTimer: ReturnType<typeof setInterval> | undefined;

  const connect = () => {
    ws = new WebSocket(url);
    ws.onopen = () => {
      handlers.onOpen?.(ws!);
      if (handlers.ping) {
        clearInterval(pingTimer);
        pingTimer = setInterval(() => ws?.readyState === WebSocket.OPEN && ws.send(handlers.ping!), handlers.pingMs ?? 20_000);
      }
    };
    ws.onmessage = (ev) => {
      attempt = 0;
      let data: unknown;
      try {
        data = JSON.parse(String(ev.data));
      } catch {
        return;
      }
      handlers.onMessage(data);
    };
    ws.onclose = () => {
      clearInterval(pingTimer);
      if (!stopped) retryTimer = setTimeout(connect, Math.min(30_000, 1000 * 2 ** attempt++));
    };
  };

  connect();
  return () => {
    stopped = true;
    clearTimeout(retryTimer);
    clearInterval(pingTimer);
    ws?.close();
  };
}

/**
 * fetch(), but when the request never gets an answer (offline, or a school or office network
 * blocking the exchange) the error says which site could not be reached.
 */
export async function reach(url: string, source: string): Promise<Response> {
  try {
    return await fetch(url);
  } catch {
    throw new Error(`Can't reach ${source} (${new URL(url).host}). This network may be blocking it.`);
  }
}

/** GET a JSON document; errors carry the source's name and its own message when it has one. */
export async function getJson<T>(url: string, source: string): Promise<T> {
  const res = await reach(url, source);
  if (!res.ok) {
    let detail = res.statusText || `HTTP ${res.status}`;
    try {
      const body = (await res.json()) as { msg?: string; retMsg?: string };
      detail = body.msg || body.retMsg || detail;
    } catch {
      /* ignore */
    }
    throw new Error(`${source}: ${detail}`);
  }
  return (await res.json()) as T;
}

/** Decimals in a step like "0.00100000" (→ 3) or "1.00000000" (→ 0). */
export function stepDecimals(step: string): number {
  return (step.split('.')[1]?.replace(/0+$/, '') ?? '').length;
}

/** "+1.23%" */
export const pctText = (p: number) => `${p >= 0 ? '+' : ''}${p.toFixed(2)}%`;

/** Plain names for the commodities; the exchange only gives codes. */
export const COMMODITY_NAMES: Record<string, string> = {
  XAU: 'Gold',
  XAG: 'Silver',
  XPT: 'Platinum',
  XPD: 'Palladium',
  COPPER: 'Copper',
  CL: 'WTI crude oil',
  BZ: 'Brent crude oil',
  NATGAS: 'Natural gas',
};
