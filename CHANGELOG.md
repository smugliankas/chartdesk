# Changelog

## Unreleased

- The alert bell next to the price scale is a little bigger and disappears the moment the
  mouse reaches the price scale, like TradingView's.
- Calmer crosshair: thin solid lines in the theme's text color, mostly see-through, instead of
  bold dashes. Over the chart the crosshair is the cursor (no mouse pointer on top of it, which
  sat up to half a bar away from the line snapped to the candles).
- Softer alert lines: short, see-through dashes.
- cTrader as a data source in the desktop app: prices straight from your own broker
  (Pepperstone, IC Markets and other cTrader brokers), live and without delay, with history.
  Click **Connect cTrader**, sign in with your cTrader ID in the browser, and the app uses
  your account (a free demo account works). Symbols from cTrader also show up in the search
  across all sources. Read-only: ChartDesk never places orders.
- Select several drawings at once, like TradingView: ⌘/Ctrl + click adds a drawing to the
  selection (or takes it out), ⌘/Ctrl + drag selects every drawing in an area, ⌘/Ctrl + A
  selects them all. Delete removes them, dragging one moves them all, the arrow keys move
  them, and one undo brings them back.
- Desktop app for macOS and Windows (Tauri): the same app in its own window. Full screen is
  the window's own; chart images and backups are saved through a real "Save as" dialog; links
  open in your browser. Installers are built on GitHub (Actions → Desktop app), not signed yet.
- Lines held at 45° with ⇧ (Shift) no longer wobble: the end snaps to a bar first and the
  height follows it exactly.
- A selected drawing keeps its width and gets a soft glow in its own color, with its handles,
  instead of turning thicker.
- The magnet (and holding ⌘/Ctrl) acts only while drawing or moving a drawing. With the plain
  cursor the crosshair moves freely, so ⌘/Ctrl shortcuts don't make it jump to the candles.
- "Remove all drawings" and "Restore backup" ask in the app's own dialog instead of the
  browser's box at the top of the window.
- Tooltips use the theme's colors (dark on the dark theme) instead of a white bubble.
- The alert bell next to the price scale glides with the mouse: before, it stood still while
  the mouse was on it and then jumped (a couple of dollars at a time on gold), so some prices
  couldn't be picked.
- "Alert set: …" in the status line is a short confirmation now: it goes away after a few
  seconds, and at once if that alert is deleted or moved.
- One symbol search for every source: type "xau", "eur" or "btc" and the list shows matches
  from Binance, Bybit TradFi and Binance TradFi together, each with its source on the right.
  Picking one switches the chart to that source on its own; no need to change the data source
  first. The watchlist's add box searches the same way.
- Drop-down menus (data source, replay speed, font sizes) are now the app's own, so they look
  the same on Windows as on a Mac. The data source menu shows what each source covers.
- When a data source can't be reached, the message says which site (for example, a school or
  office network blocking Binance) instead of a general "Network error".
- With "reduce motion" on (on Windows: Settings → Accessibility → Visual effects → Animation
  effects off), menus fade in instead of sliding; colors and fades no longer switch abruptly.
- Forex, gold, oil and stocks with no account: two new data sources, **Bybit TradFi**
  (EUR/USD, GBP/USD, USD/JPY, gold, silver, oil, US stocks and ETFs) and **Binance TradFi**
  (gold, silver, oil, US, Hong Kong and Korean stocks). Both are perpetual futures that follow
  the real market; they trade around the clock, so there are weekend candles. Live updates,
  older history as you scroll, and search by name ("gold", "apple").
- Symbol search shows a plain name next to the code (XAUUSDT · Gold).
- The watchlist can hold symbols from several sources at once. New symbols come from the
  chart's source; symbols from another source show its name under them.
- The style bar and the replay bar can be moved: drag the grip on their left. They stay where
  you put them; double-click the grip to put them back.
- Dates and numbers are always in English, like the rest of the app, whatever the computer's
  language (a Turkish Mac showed "25 Kas 2026" in the replay bar).
- Bar replay: the replay button in the top bar lets you pick a bar; everything after it
  disappears, and you play the chart forward from there (0.5× to 10× bars per second, Space to
  play or pause, ⇧→ for one bar). Switching timeframe or symbol keeps the replay's date and
  shows only bars that had closed by then, so nothing from the future shows. Drawings work as
  usual; alerts keep watching the live price. The × button goes back to real time.
- Show a drawing only on some timeframes (clock button in the style bar): presets such as
  "4H and above" or "Only 15m", or any set of timeframes. The drawings list shows which
  drawings are not on the current timeframe.
- Drawings are now stored in the browser's database (IndexedDB) instead of localStorage, which
  held only about 5 MB (roughly 20,000 drawings) for the whole app. Existing drawings move over
  on their own the first time.
- Faster with many drawings: drawings off screen are skipped, saving waits for a pause in
  quick changes, undo keeps lighter copies, and price labels are only made for lines on screen.
- ChartDesk now runs on the web with nothing to install:
  https://smugliankas.github.io/chartdesk/ (published by GitHub Actions on every push).
- Backup: export your drawings, alerts, watchlist and settings to one file from ⚙ Settings,
  and restore them from it (also to move to another computer or browser).
- Chart image: the camera button downloads the chart as a PNG (⌥⌘S / Ctrl+Alt+S) or copies
  it to paste anywhere (⇧⌘S / Ctrl+Shift+S). The image has a header with the symbol,
  timeframe and last bar, and leaves out the selection handles.
- Icon for the browser tab, and a description for link previews.
- Full screen: button in the top bar or ⇧F (Shift+F). Esc first cancels what is going on (a
  tool, a selection, a menu) and leaves full screen only when there is nothing left to cancel
  (Chrome and Edge; holding Esc always exits. In Safari and Firefox the browser keeps Esc for
  leaving full screen).
- ⇧A (Shift+A) turns auto-fit of the price scale on and off.
- New drawing tools: horizontal ray (⌥J), cross line (⌥C), arrow, parallel channel (three
  clicks: two for the base line, one for the width), price range, date range (bars, time and
  volume) and brush. Horizontal rays, cross lines and arrows can carry alerts.
- The left toolbar groups tools like TradingView: each button shows the tool used last from its
  group. The thin strip next to the button opens the others (so do a right-click and a long
  press on the button).
- Drawings list: the layers button in the top bar lists every drawing on the symbol. Click one
  to select it; hide, lock or delete it from its row. Hidden drawings stay saved.
- The watchlist and the drawings list share the right panel; it remembers which one was open
  and its width.
- Watchlist: a panel on the right (list button in the top bar) with live price and 24h change
  for your symbols. Click a row to open it on the chart; add symbols with the search box,
  remove them with ×. Prices use each market's own decimals and flash green or red when they
  change; the 24h change is always green or red, whatever the candle colors are. Drag the
  panel's left edge to resize it (double-click to reset). Saved between visits.
- Red and green in the app (24h change, errors, delete buttons) no longer follow the candle
  colors, so they stay readable with black-and-white candles.
- Right-click menu: on a drawing (duplicate, copy, lock, bring to front, send to back, alert,
  delete) and on the empty chart (alert at that price, paste, hide drawings, reset the view,
  remove all drawings).
- Copy, paste and duplicate drawings with ⌘/Ctrl + C, V and D.
- Lock a drawing (style bar or right-click) so it can't be moved or changed by accident.
- Hide all drawings with the eye button in the sidebar; picking a drawing tool shows them again.
- Arrow keys move the selected drawing by one bar (left/right) or one pixel (up/down); with
  Shift, by ten. A series of presses is undone in one step.
- Hold Shift while drawing a trend line, ray or extended line, or while dragging one of its
  ends, to keep it horizontal, vertical or at 45°.
- Automated tests (Vitest) for the CSV reader, drawing geometry, Fibonacci levels, bar
  countdown, alert levels and color helpers. GitHub Actions runs type checking, the tests and
  a build on every push and pull request.

- Price alerts: get a sound, a desktop notification and an on-screen message when the price
  crosses a level. Set one from the bell menu, with the bell that follows the cursor next to
  the price scale, with ⌥/Alt + A at the cursor price, or on a selected horizontal line, trend
  line, ray or extended line (the alert follows the line, also when it is moved). Alerts are
  watched for every symbol, not only the one on the chart, while ChartDesk is open. Fired
  alerts can be turned on again or cleared. Hover an alert line to see its price and a ×
  to delete it; drag the line to move the alert. Alerts use the chart's text color.

- Long/short positions: handles work like TradingView's (entry handle: entry price and start
  time; target and stop: price only; right edge: end time only), and target or stop can no
  longer be dragged across the entry. Target and stop zone colors can be changed from the
  style bar.
- Fibonacci: level labels are now to the right of the lines. Turn each level on or off (e.g. only 0, 0.5 and 1 for a range) and hide the dashed
  trend line, from the levels button in the style bar. New Fibonacci drawings start with the
  last choice.
- Style bar: separators only appear between the controls that are shown.
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
