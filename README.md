# chart-app

> Working name. A free, open-source charting app with **unlimited drawings**.
> Runs on your own computer, and you bring your own data.

Tired of drawing limits, indicator caps and paywalls on your charting platform? This app
gives you candlestick charts and drawing tools with no limits, and your drawings stay on
your machine.

## Features

- Candlestick chart with volume, 1m to 1w timeframes
- Drawing tools: trend line, horizontal line, rectangle, Fibonacci retracement
- **No limit on the number of drawings**
- Drawings are saved per symbol and stay in place when you switch timeframes
- Select, drag (whole drawing or one end), delete with `Del`, cancel with `Esc`
- Live updates for crypto (Binance)
- Times shown in your local time zone

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
  subscribe?(symbol: string, tf: Timeframe, onCandle: (c: Candle) => void): () => void;
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
  drawings/                  drawing tools (model, rendering, mouse handling, storage)
  providers/                 data sources (Binance, CSV)
```

## Roadmap

- [ ] MT5 bridge (forex, indices and gold from your own broker)
- [ ] Load older history when scrolling left
- [ ] More tools: ray, extended line, text, long/short position
- [ ] FVG and liquidity tools
- [ ] Drawing colors and styles
- [ ] Export/import drawings
- [ ] Desktop app (Tauri) for Windows and macOS

## Credits

Charts are rendered with [TradingView Lightweight Charts™](https://www.tradingview.com/lightweight-charts/)
(Apache 2.0). Copyright © TradingView, Inc. As its license requires, the TradingView
attribution logo stays visible on the chart.

This project is not affiliated with or endorsed by TradingView.
