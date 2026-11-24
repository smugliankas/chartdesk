# ChartDesk

> A free, open-source charting app with **unlimited drawings**.
> Runs on your own computer, and you bring your own data.

Tired of drawing limits, indicator caps and paywalls on your charting platform? This app
gives you candlestick charts and drawing tools with no limits, and your drawings stay on
your machine.

## Features

- Candlestick chart with volume; timeframes 1m, 5m, 15m, 30m, 1H, 4H, 1D, 1W and 1M
- Older history loads automatically as you scroll left
- Symbol search (Binance), live updates for crypto
- Countdown to bar close in the last-price label (can be turned off in the settings)
- Drawing tools: trend line, ray, extended line, horizontal and vertical lines, rectangle,
  Fibonacci retracement, long/short position, text notes
- Measure tool (`Shift` + click): price change, %, bars and time between two points
- **No limit on the number of drawings**
- Drawing styles: color, line width, solid/dashed/dotted lines, text size. Each tool remembers the last style you used
- Magnet mode: snap points to a bar's open, high, low or close
- Undo / redo, select, drag (whole drawing or one handle), delete with `Del`
- Drawings are saved per symbol and stay in place when you switch timeframes
- Log scale, auto-fit and "scroll to latest bar" controls; show/hide volume
- Chart settings: dark and light themes, candle colors, borders and wicks, background, grid lines,
  scale text color and size
- Times shown in your local time zone

### Keyboard shortcuts

| Keys | Action |
| --- | --- |
| `Alt/⌥` + `T` `H` `V` `R` `F` `L` `S` `N` `M` | Trend line, horizontal line, vertical line, rectangle, Fibonacci, long, short, text, measure |
| `Shift` + click | Measure |
| `Esc` | Cursor / cancel |
| `Del` / `Backspace` | Delete selected drawing |
| `⌘/Ctrl` + `Z`, `⌘/Ctrl` + `Shift` + `Z` | Undo, redo |
| Double-click a text note | Edit it |

## Data sources

| Source | Markets | Notes |
| --- | --- | --- |
| **Binance** | Crypto | Public market data. No account or API key. Live updates. |
| **CSV file** | Anything | MetaTrader 5 exports and most generic OHLC CSVs. Higher timeframes are built from the file. |
| MT5 bridge | Forex, indices, metals (your broker's feed) | Planned. Windows only. |

### Getting a CSV from MetaTrader 5

1. In MT5, open **View → Symbols** (`Ctrl+U`).
2. Go to the **Bars** tab, choose the symbol, timeframe and date range, and click **Request**.
3. Click **Export Bars** and save the file.
4. In the app, choose **CSV file → Open CSV…**.

Other CSVs work too if the first row is a header with a date/time column plus
`open`, `high`, `low`, `close` (and optionally `volume`). Times without a time zone are read as UTC.

## Quick start

Requires [Node.js](https://nodejs.org) 20 or newer.

```bash
npm install
npm run dev
```

Then open the address shown in the terminal (usually http://localhost:5173).

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
  providers/                 data sources (Binance, CSV)
  ui/                        toolbar icons and tool list, symbol search
```

## Roadmap

- [ ] MT5 bridge (forex, indices and gold from your own broker)
- [ ] More timeframes and chart types
- [ ] Export/import drawings
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
