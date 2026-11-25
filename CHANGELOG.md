# Changelog

## Unreleased

- Price alerts: get a sound, a desktop notification and an on-screen message when the price
  crosses a level. Set one from the bell menu, with the bell that follows the cursor next to
  the price scale, with ⌥/Alt + A at the cursor price, or on a selected horizontal line, trend
  line, ray or extended line (the alert follows the line, also when it is moved). Alerts are
  watched for every symbol, not only the one on the chart, while ChartDesk is open. Fired
  alerts can be turned on again or cleared. Hover an alert line to see its price and a ×
  to delete it; drag the line to move the alert. Alerts use the chart's text color.

- Hold ⌘ (Mac) or Ctrl (Windows/Linux) for a temporary magnet, like TradingView: while held,
  the crosshair and drawing points snap to the nearest open, high, low or close. If the magnet
  is already on, holding the key turns it off. The crosshair now also snaps while the magnet is on.
- Polish: menus, lists, the style bar and dialogs open with short animations; buttons react
  to hover and clicks; selected buttons use a soft blue gradient; timeframes sit in one outlined group; fast tooltips that show keyboard shortcuts as keys; a thin loading bar
  and a dimmed chart while data loads; matches highlighted in symbol search; Esc closes menus.
  Animations are turned off when the system asks for reduced motion.

## v0.2.0

Customization, chart settings and a few TradingView favorites.

- Drawing styles: select a drawing to change its color (palette or custom), line width,
  line style (solid, dashed, dotted) and, for text, font size. Style changes can be undone.
- Each tool remembers the last style you used, so new drawings start with it.
- Chart settings (⚙): dark and light app themes; separate up/down colors for candle bodies,
  borders and wicks (borders and wicks can be turned off); background color; vertical and
  horizontal grid lines and grid color. Saved between visits. The theme only changes the app;
  the chart's colors are set separately, so a dark app with a light chart works.
- Show or hide volume, from the settings or the "vol" button on the chart.
- Countdown to bar close: the last-price label on the price scale shows the time left until
  the current bar closes on a second line, updated every second. Can be turned off in the settings.
- Monthly timeframe (1M). Timeframes are labeled 1m, 5m, 15m, 30m, 1H, 4H, 1D, 1W, 1M.
- Text settings: color and size of the price/time scale labels and the symbol name.
  If the chosen color is hard to read on the background, a readable one is used instead.
- Dark theme is now neutral black instead of dark blue, and the border lines next to the
  price and time axes are gone for a cleaner look.
- Drawings that would be hard to see on the current background (e.g. white text on the
  light theme) are drawn in the theme's text color.
- Price labels pick dark or white text depending on their background color.
- The "auto" button now turns auto-fit on and off.

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
