# Changelog

## Unreleased

- Drawing styles: select a drawing to change its color (palette or custom), line width,
  line style (solid, dashed, dotted) and, for text, font size. Style changes can be undone.
- Each tool remembers the last style you used, so new drawings start with it.
- Chart settings (⚙): dark and light app themes, candle up/down colors, borders, wicks,
  background color, vertical/horizontal grid lines and grid color. Saved between visits.
  The theme only changes the app; the chart's colors are set separately, so a dark app
  with a light chart works.
- Show or hide volume, from the settings or the "vol" button on the chart.
- Monthly timeframe (1M). Timeframes are labeled 1m, 5m, 15m, 30m, 1H, 4H, 1D, 1W, 1M.
- Text settings: color and size of the price/time scale labels and the symbol name.
  If the chosen color is hard to read on the background, a readable one is used instead.
- Dark theme is now neutral black instead of dark blue, and the border lines next to the
  price and time axes are gone for a cleaner look.
- Drawings that would be hard to see on the current background (e.g. white text on the
  light theme) are drawn in the theme's text color.

## v0.1.0

First public release of ChartDesk: free, open-source charting with unlimited drawings.

**Highlights**

- Candlestick chart with volume, 1m to 1w timeframes
- Drawing tools: trend line, ray, extended line, horizontal/vertical lines, rectangle, Fibonacci,
  long/short position, text
- No limit on drawings; saved per symbol, kept across timeframes
- Measure tool, magnet mode, undo/redo, keyboard shortcuts
- Older history loads as you scroll left
- Data: Binance (live, with symbol search) and CSV files (including MetaTrader 5 exports)
- Log scale, auto-fit and scroll-to-latest controls

**Getting started**

```bash
npm install
npm run dev
```
