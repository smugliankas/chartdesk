# Changelog

## Unreleased

- Drawing styles: select a drawing to change its color (palette or custom), line width,
  line style (solid, dashed, dotted) and, for text, font size. Style changes can be undone.
- Each tool remembers the last style you used, so new drawings start with it.

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
