# ChartDesk

[![CI](https://github.com/smugliankas/chartdesk/actions/workflows/ci.yml/badge.svg)](https://github.com/smugliankas/chartdesk/actions/workflows/ci.yml)

> A free, open-source charting app with **unlimited drawings**.
> Runs on your own computer, and you bring your own data.

**[Open ChartDesk in your browser →](https://smugliankas.github.io/chartdesk/)** Nothing to install.

Tired of drawing limits, indicator caps and paywalls on your charting platform? This app
gives you candlestick charts and drawing tools with no limits, and your drawings stay on
your machine.

## Features

- Candlestick chart with volume; timeframes 1m, 5m, 15m, 30m, 1H, 4H, 1D, 1W and 1M
- Older history loads automatically as you scroll left
- Crypto, forex, gold, oil and stocks with no account: Binance, plus Bybit and Binance
  perpetual futures on traditional markets; one symbol search across all sources (picking
  a result switches the source), plain names, live updates
- Watchlist with live prices and 24h change, mixing symbols from several sources; click a
  symbol to open it
- Price alerts with sound, desktop notification and on-screen message; set from the bell menu,
  the bell next to the price scale, `Alt/⌥` + `A`, or on a horizontal or sloped line. Watched for all symbols while ChartDesk is open
- Countdown to bar close in the last-price label (can be turned off in the settings)
- Drawing tools: trend line, ray, extended line, arrow, horizontal line and ray, vertical line,
  cross line, Fibonacci retracement, parallel channel, rectangle, brush, long/short position,
  price range, date range, text notes. Grouped in the toolbar like TradingView
- Drawings list: see every drawing on a symbol; select, hide, lock or delete it
- Measure tool (`Shift` + click): price change, %, bars and time between two points
- **No limit on the number of drawings** (stored in the browser's database, tested with tens of thousands)
- Bar replay: pick a bar and play the chart forward from it, at your speed or bar by bar
- Show a drawing only on the timeframes you choose (e.g. 4H and above)
- Drawing styles: color, line width, solid/dashed/dotted lines, text size. Each tool remembers the last style you used
- Magnet mode: snap points to a bar's open, high, low or close
- Undo / redo, select, drag (whole drawing or one handle), delete with `Del`
- Right-click menu, copy / paste / duplicate, lock drawings, hide all drawings
- Chart image: download as PNG or copy to paste anywhere
- Backup and restore of drawings, alerts, watchlist and settings
- Nudge with the arrow keys; `Shift` keeps lines horizontal, vertical or at 45°
- Drawings are saved per symbol and stay in place when you switch timeframes
- Log scale, auto-fit and "scroll to latest bar" controls; show/hide volume
- Chart settings: dark and light themes, candle colors, borders and wicks, background, grid lines,
  scale text color and size
- Times shown in your local time zone

### Keyboard shortcuts

| Keys | Action |
| --- | --- |
| `Alt/⌥` + `T` `H` `J` `V` `C` | Trend line, horizontal line, horizontal ray, vertical line, cross line |
| `Alt/⌥` + `R` `F` `L` `S` `N` `M` | Rectangle, Fibonacci, long, short, text, measure |
| `Alt/⌥` + `A` | Alert at the cursor price |
| Hold `⌘` (Mac) / `Ctrl` | Magnet while held: crosshair and drawing points snap to open/high/low/close |
| `Shift` + click | Measure |
| Hold `Shift` while drawing a line | Horizontal, vertical or 45° |
| `⌘/Ctrl` + `C` / `V` / `D` | Copy, paste, duplicate the selected drawing |
| Arrow keys (`Shift` for ×10) | Move the selected drawing |
| Right-click | Drawing or chart menu |
| `⌥⌘S` / `Ctrl` + `Alt` + `S` | Download chart image |
| `⇧⌘S` / `Ctrl` + `Shift` + `S` | Copy chart image |
| `Esc` | Cursor / cancel (in full screen: exits when there is nothing to cancel) |
| `⇧F` / `Shift` + `F` | Full screen |
| `⇧A` / `Shift` + `A` | Auto-fit the price scale on / off |
| `Space` | Replay: play / pause |
| `⇧→` / `Shift` + `→` | Replay: next bar |
| `Del` / `Backspace` | Delete selected drawing |
| `⌘/Ctrl` + `Z`, `⌘/Ctrl` + `Shift` + `Z` | Undo, redo |
| Double-click a text note | Edit it |

## Data sources

| Source | Markets | Notes |
| --- | --- | --- |
| **Binance (crypto)** | Crypto | Spot market. Public data, no account or API key. Live updates. |
| **Bybit TradFi** | Forex (EUR/USD, GBP/USD, USD/JPY…), gold, silver, oil, US stocks and ETFs | Perpetual futures. Public data, no account. Live updates. |
| **Binance TradFi** | Gold, silver, oil, US, Hong Kong and Korean stocks | Perpetual futures. Public data, no account. Live updates. |
| **CSV file** | Anything | MetaTrader 5 exports and most generic OHLC CSVs. Higher timeframes are built from the file. |
| FOREX.com | Forex, indices, metals | Planned (needs your own FOREX.com account). |

The two TradFi sources show perpetual futures that follow the real market, not the market
itself. They trade around the clock, so there are candles at night and on weekends when the
real market is closed, and the price can be a little off the broker quote (for EUR/USD,
about 10 to 20 pips while we tested).

### Getting a CSV from MetaTrader 5

1. In MT5, open **View → Symbols** (`Ctrl+U`).
2. Go to the **Bars** tab, choose the symbol, timeframe and date range, and click **Request**.
3. Click **Export Bars** and save the file.
4. In the app, choose **CSV file → Open CSV…**.

Other CSVs work too if the first row is a header with a date/time column plus
`open`, `high`, `low`, `close` (and optionally `volume`). Times without a time zone are read as UTC.

## Quick start

The easiest way is the hosted version: **https://smugliankas.github.io/chartdesk/**. It runs
entirely in your browser; market data comes straight from the source to you, and your drawings
are saved in your browser (export a backup from ⚙ Settings now and then).

To run it from the source code instead (requires [Node.js](https://nodejs.org) 20 or newer):

```bash
npm install
npm run dev
```

Then open the address shown in the terminal (usually http://localhost:5173).

To run the checks that also run on GitHub:

```bash
npm run typecheck
npm test
```

## Adding a data source

Every data source implements one small interface, `DataProvider` in
[`src/providers/types.ts`](src/providers/types.ts):

```ts
interface DataProvider {
  id: string;
  name: string;
  freeSymbolInput: boolean;
  getCandles(symbol: string, tf: Timeframe): Promise<Candle[]>;
  getCandlesBefore?(symbol: string, tf: Timeframe, beforeTime: number): Promise<Candle[]>; // older history
  subscribe?(symbol: string, tf: Timeframe, onCandle: (c: Candle) => void): () => void;   // live updates
  searchSymbols?(query: string): Promise<SymbolInfo[]>;                                    // symbol search
  watchQuotes?(symbols: string[], onQuote: (q: Quote) => void): () => void;              // watchlist prices
}
```

Implement it, register it in [`src/providers/index.ts`](src/providers/index.ts), and it shows up in the UI.
Pull requests for new sources are welcome.

Data always goes from the source straight to your own machine. This project does not
run a server or redistribute anyone's market data.

## Project structure

```
src/
  main.ts                    UI wiring
  chart/ChartController.ts   chart, series, time ↔ bar-index mapping
  drawings/                  drawing tools (model, geometry, rendering, mouse handling, storage)
  providers/                 data sources (Binance, Bybit, CSV)
  alerts/                    price alerts (checking, drawing on the chart, notifications)
  ui/                        toolbar, symbol search, watchlist, menus and dialogs
tests/                       automated tests (npm test)
```

## Roadmap

- [x] Forex, gold and stocks without an account (Bybit and Binance perpetual futures)
- [x] Export/import drawings (Settings → Backup)
- [ ] FOREX.com data with your own account
- [ ] More timeframes and chart types
- [ ] Desktop app (Tauri) for Windows and macOS

## License

Copyright © 2026 Ömer Çolak

ChartDesk is free software, licensed under the **GNU Affero General Public License v3.0**
(`AGPL-3.0-only`). See [LICENSE](LICENSE).

In short: you can use, study, change and share it. If you share a modified version, or run one
as a website or service for other people, you must make your source code available under the
same license. ChartDesk stays free, and so does every version built on it.

## Credits

Charts are rendered with [TradingView Lightweight Charts™](https://www.tradingview.com/lightweight-charts/)
(Apache 2.0).

TradingView Lightweight Charts™ Copyright © 2025 TradingView, Inc. https://www.tradingview.com/

The attribution and link are also shown in the app's **About** dialog (ⓘ button), as the library's license requires.

This project is not affiliated with or endorsed by TradingView.
