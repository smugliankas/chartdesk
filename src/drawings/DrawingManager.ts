import { readable } from '../chart/appearance';
import type { ChartController } from '../chart/ChartController';
import { modifierHeld } from '../platform';
import { DrawingsPrimitive, type DrawingSource } from './DrawingsPrimitive';
import { distToPolyline, distToSegment, extendSegment, handlesOf, insideChannel, moveHandle, moveWhole, segmentCrossesRect, type Part } from './geometry';
import {
  DEFAULT_COLORS,
  DEFAULT_FONT_SIZE,
  DEFAULT_LABEL_POS,
  DEFAULT_LABEL_SIZE,
  DEFAULT_LOSS_COLOR,
  DEFAULT_PROFIT_COLOR,
  DEFAULT_WIDTH,
  FIB_LEVELS,
  fibLevelsOf,
  fibPrice,
  fibShowsTrendLine,
  isOnePointType,
  isStraightLineType,
  isTwoPoint,
  isTwoPointType,
  measureText,
  newId,
  shownOn,
  styleSupport,
  textFont,
  textLineHeight,
  type Drawing,
  type DrawingStyle,
  type DrawingTemplate,
  type DrawingType,
  type ParallelChannel,
  type Point,
  type TextNote,
  type ToolId,
  type TwoPointDrawing,
  type TwoPointType,
} from './model';
import type { Timeframe } from '../types';
import { loadDrawings, loadStyleDefaults, loadTemplates, saveDrawings, saveStyleDefaults, saveTemplates } from './storage';

interface DragState {
  id: string;
  part: Part;
  original: Drawing;
  /** Moving several selected drawings at once: the others, as they were when the drag began. */
  others?: Drawing[];
  startLogical: number;
  startPrice: number;
  before: Drawing[];
}

/** Rectangle dragged out with ⌘/Ctrl to select the drawings it touches (pane pixels). */
export interface SelectBox {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
}

const HANDLE_RADIUS = 8;
const BASE_TOLERANCE = 6;
const HISTORY_LIMIT = 200;

/**
 * Handles the drawing tools: placing drawings, selecting, dragging (whole drawing
 * or one handle), editing text, deleting, undo/redo, the measure ruler, the magnet,
 * and saving per symbol.
 *
 * There is no limit on the number of drawings.
 */
export class DrawingManager implements DrawingSource {
  drawings: Drawing[] = [];
  preview: Drawing | null = null;
  /**
   * The selected drawings. Usually one; several after ⌘/Ctrl+click or a ⌘/Ctrl box.
   * `selectedId` is the one selected drawing (null when none or several), and setting it
   * replaces the whole selection.
   */
  private sel: string[] = [];
  /** Box being dragged out with ⌘/Ctrl to select drawings. */
  selectBox: SelectBox | null = null;
  editingId: string | null = null;
  /** The drawing under the mouse, for drawings that show more while pointed at. */
  hoveredId: string | null = null;
  measure: { p1: Point; p2: Point } | null = null;
  hidden = false;
  /** The chart's timeframe, for drawings shown only on some timeframes. */
  timeframe: Timeframe | null = null;

  private tool: ToolId = 'cursor';
  private pending: Point | null = null;
  /** Parallel channel: the base line, once its two points are placed; the third click sets the width. */
  private channelBase: { p1: Point; p2: Point } | null = null;
  /** Brush stroke being drawn (mouse held down). */
  private stroke: Point[] | null = null;
  private measuring = false;
  private drag: DragState | null = null;
  private magnet = false;
  /** ⌘ (Mac) / Ctrl held: flips the magnet while held, like TradingView. */
  private magnetHeld = false;
  private storageKey = '';
  private undoStack: Drawing[][] = [];
  private redoStack: Drawing[][] = [];
  private textEditor: HTMLTextAreaElement | null = null;
  /** Last-used style per drawing type; new drawings start with it. */
  private styleDefaults = loadStyleDefaults();
  /** Named styles per kind of drawing (see saveTemplate). */
  private templates = loadTemplates();
  /** Snapshot taken when a live style preview (e.g. dragging in the color picker) starts. */
  private styleBefore: Drawing[] | null = null;
  /** Copied drawing (⌘C), pasted with ⌘V. Shared across symbols. */
  private clipboard: Drawing | null = null;
  /** Arrow-key nudges within a short time are one undo step. */
  private nudgeBefore: Drawing[] | null = null;
  private nudgeTimer: ReturnType<typeof setTimeout> | undefined;

  private readonly primitive: DrawingsPrimitive;
  private readonly listeners = { tool: [] as ((t: ToolId) => void)[], change: [] as (() => void)[] };

  constructor(
    private readonly cc: ChartController,
    private readonly container: HTMLElement,
  ) {
    this.primitive = new DrawingsPrimitive(this, cc);
    cc.candles.attachPrimitive(this.primitive);

    // Capture phase: we see mouse presses before the chart does, and keep them
    // from panning the chart while drawing or dragging a drawing.
    container.addEventListener('mousedown', this.onMouseDown, true);
    container.addEventListener('mousemove', this.onHover);
    container.addEventListener('mouseleave', () => this.setHovered(null));
    container.addEventListener('dblclick', this.onDoubleClick, true);
    window.addEventListener('keydown', this.onKeyDown);
    window.addEventListener('keydown', this.onModifierKey);
    window.addEventListener('keyup', this.onModifierKey);
    window.addEventListener('blur', () => this.setMagnetHeld(false));
  }

  // --- public API ---------------------------------------------------------------

  /** Storage key of the drawings on screen ("provider:symbol"). */
  get currentKey(): string {
    return this.storageKey;
  }

  get currentTool(): ToolId {
    return this.tool;
  }

  get magnetOn(): boolean {
    return this.magnet;
  }

  /**
   * The magnet as it acts right now: the setting, flipped while ⌘/Ctrl is held. It acts only
   * while drawing (a drawing tool is picked) or moving a drawing; with the plain cursor the
   * crosshair moves freely, so ⌘/Ctrl shortcuts don't make it jump to the candles.
   */
  private get magnetActive(): boolean {
    const drawing = this.tool !== 'cursor' || this.drag !== null;
    return drawing && this.magnet !== this.magnetHeld;
  }

  private syncCrosshairMagnet(): void {
    this.cc.setCrosshairMagnet(this.magnetActive);
  }

  private setMagnetHeld(held: boolean): void {
    if (held === this.magnetHeld) return;
    this.magnetHeld = held;
    this.syncCrosshairMagnet();
    if (this.pending || this.measuring || this.drag) this.redraw();
  }

  private onModifierKey = (e: KeyboardEvent): void => {
    this.setMagnetHeld(modifierHeld(e));
  };

  get canUndo(): boolean {
    return this.undoStack.length > 0;
  }

  get canRedo(): boolean {
    return this.redoStack.length > 0;
  }

  get selectedId(): string | null {
    return this.sel.length === 1 ? this.sel[0] : null;
  }

  set selectedId(id: string | null) {
    this.sel = id ? [id] : [];
  }

  /** All selected drawings' ids (one or more), in the order they were selected. */
  get selectedIds(): readonly string[] {
    return this.sel;
  }

  isSelected(id: string): boolean {
    return this.sel.includes(id);
  }

  /** Keeps only the selected drawings that still exist and show on this timeframe. */
  private pruneSelection(): void {
    this.sel = this.sel.filter((id) => {
      const d = this.drawings.find((x) => x.id === id);
      return d && !d.hidden && shownOn(d, this.timeframe);
    });
  }

  get selectedDrawing(): Drawing | null {
    return this.drawings.find((d) => d.id === this.selectedId) ?? null;
  }

  /**
   * Changes the style of the selected drawing and remembers it for that tool.
   * With `live`, the change is shown but not yet recorded as an undo step
   * (for color picker dragging); the next non-live call records it.
   */
  setStyle(patch: DrawingStyle, live = false): void {
    const d = this.selectedDrawing;
    if (!d) return;
    const before = this.styleBefore ?? this.snapshot();
    this.styleBefore = live ? before : null;

    const support = styleSupport(d.type);
    const clean: DrawingStyle = {};
    if (support.color && patch.color) clean.color = patch.color;
    if (support.line && patch.width) clean.width = patch.width;
    if (support.line && patch.lineStyle) clean.lineStyle = patch.lineStyle;
    if (support.font && patch.fontSize) clean.fontSize = patch.fontSize;
    if (support.zones && patch.profitColor) clean.profitColor = patch.profitColor;
    if (support.zones && patch.lossColor) clean.lossColor = patch.lossColor;
    if (support.fill && patch.fillColor) clean.fillColor = patch.fillColor;
    if (support.fib && patch.levels) clean.levels = [...patch.levels].sort((x, y) => x - y);
    if (support.fib && patch.trendLine !== undefined) clean.trendLine = patch.trendLine;
    if (support.label && patch.label !== undefined) clean.label = patch.label;
    if (support.label && patch.labelPos) clean.labelPos = patch.labelPos;
    if (support.label && patch.labelSize) clean.labelSize = patch.labelSize;

    this.drawings = this.drawings.map((x) => (x.id === d.id ? ({ ...x, ...clean } as Drawing) : x));
    if (!live) {
      this.pushHistory(before);
      this.save();
      // New drawings take the look, not the words: the text stays with this drawing (or a template).
      const { label: _text, ...look } = clean;
      this.styleDefaults = { ...this.styleDefaults, [d.type]: { ...this.styleDefaults[d.type], ...look } };
      saveStyleDefaults(this.styleDefaults);
    }
    this.changed();
  }

  // --- templates: named styles per kind of drawing ----------------------------------

  /** Saved templates for a kind of drawing, in the order they were made. */
  templatesFor(type: DrawingType): readonly DrawingTemplate[] {
    return this.templates[type] ?? [];
  }

  /** Saves the selected drawing's style (and text) as a template; a same-named one is replaced. */
  saveTemplate(name: string): void {
    const d = this.selectedDrawing;
    const n = name.trim();
    if (!d || !n) return;
    const list = this.templatesFor(d.type).filter((t) => t.name !== n);
    // The whole look, defaults included: a thin solid line is part of a template too.
    this.templates = { ...this.templates, [d.type]: [...list, { name: n, style: { ...lookDefaults(d.type, d.color), ...styleOf(d) } }] };
    saveTemplates(this.templates);
    this.changed();
  }

  /** Gives the selected drawing a template's style; new drawings of that kind follow it too. */
  applyTemplate(name: string): void {
    const d = this.selectedDrawing;
    const t = d && this.templatesFor(d.type).find((x) => x.name === name);
    if (!t) return;
    // Whatever the template doesn't say (older templates kept only what was changed) goes back
    // to the default, and a template without text takes the text off: the drawing then looks
    // exactly as it did when the template was saved.
    this.setStyle({ ...lookDefaults(d.type, t.style.color ?? d.color), label: '', ...t.style });
  }

  deleteTemplate(type: DrawingType, name: string): void {
    this.templates = { ...this.templates, [type]: this.templatesFor(type).filter((t) => t.name !== name) };
    saveTemplates(this.templates);
    this.changed();
  }

  /** Style a new drawing of this type starts with. */
  private styleFor(type: DrawingType): { color: string } & DrawingStyle {
    return { color: DEFAULT_COLORS[type], ...this.styleDefaults[type] };
  }

  /** Called when the active tool changes. */
  onToolChange(fn: (tool: ToolId) => void): void {
    this.listeners.tool.push(fn);
  }

  /** Called when drawings, history, selection or the magnet change (for enabling buttons). */
  onChange(fn: () => void): void {
    this.listeners.change.push(fn);
  }

  setTool(tool: ToolId): void {
    if (tool !== 'cursor' && tool !== 'measure' && this.hidden) this.setHidden(false);
    this.tool = tool;
    this.pending = null;
    this.channelBase = null;
    this.preview = null;
    this.measuring = false;
    if (tool !== 'cursor') {
      this.selectedId = null;
      this.measure = null;
    }
    // The crosshair lines are the cursor (see #chart in style.css), with drawing tools too.
    this.container.style.cursor = '';
    this.syncCrosshairMagnet();
    this.listeners.tool.forEach((fn) => fn(tool));
    this.changed();
  }

  setMagnet(on: boolean): void {
    this.magnet = on;
    this.syncCrosshairMagnet();
    this.changed();
  }

  /** Switches the set of drawings, e.g. when the symbol changes. Drawings are shared across timeframes. */
  setStorageKey(key: string): void {
    if (key !== this.storageKey) {
      this.closeTextEditor(false);
      this.storageKey = key;
      this.drawings = loadDrawings(key);
      this.selectedId = null;
      this.pending = null;
      this.channelBase = null;
      this.preview = null;
      this.measure = null;
      this.undoStack = [];
      this.redoStack = [];
      this.styleBefore = null;
    }
    this.changed();
  }

  /** Runs `fn` with nothing shown as selected and no measurement, e.g. for a chart image. */
  whileUnselected<T>(fn: () => T): T {
    const selected = this.sel;
    const measure = this.measure;
    this.sel = [];
    this.measure = null;
    try {
      return fn();
    } finally {
      this.sel = selected;
      this.measure = measure;
    }
  }

  /** Hides or shows all drawings (they stay saved). */
  setHidden(hidden: boolean): void {
    this.hidden = hidden;
    if (hidden) this.selectedId = null;
    this.changed();
  }

  /** Whether Esc has something to cancel here: a tool in use, a selection, a ruler, text being edited. */
  get hasEscapable(): boolean {
    return (
      this.tool !== 'cursor' ||
      this.sel.length > 0 ||
      this.measure !== null ||
      this.pending !== null ||
      this.channelBase !== null ||
      this.stroke !== null ||
      this.textEditor !== null
    );
  }

  get canPaste(): boolean {
    return this.clipboard !== null;
  }

  copySelected(): void {
    const d = this.selectedDrawing;
    if (d) this.clipboard = structuredClone(d);
  }

  /** Pastes the copied drawing a few bars to the right of the original. */
  paste(): void {
    if (this.clipboard) this.insertCopy(this.clipboard);
  }

  duplicateSelected(): void {
    const d = this.selectedDrawing;
    if (d) this.insertCopy(d);
  }

  private insertCopy(source: Drawing): void {
    const copy = moveWhole(structuredClone(source), (t) => this.cc.logicalToTime(this.cc.timeToLogical(t) + 5), 0);
    copy.id = newId();
    copy.locked = false;
    copy.hidden = false;
    if (this.hidden) this.hidden = false;
    this.mutate(() => (this.drawings = [...this.drawings, copy]));
    this.selectedId = copy.id;
    this.changed();
  }

  toggleLock(id = this.selectedId): void {
    if (!id) return;
    this.mutate(() => {
      this.drawings = this.drawings.map((d) => (d.id === id ? { ...d, locked: !d.locked } : d));
    });
  }

  /** Tells the drawings which timeframe the chart shows. */
  setTimeframe(tf: Timeframe): void {
    if (this.timeframe === tf) return;
    this.timeframe = tf;
    this.pruneSelection();
    this.changed();
  }

  /** Limits a drawing to some timeframes (`undefined`: all). An empty list is ignored. */
  setTimeframes(timeframes: Timeframe[] | undefined, id = this.selectedId): void {
    if (!id || (timeframes && timeframes.length === 0)) return;
    this.mutate(() => {
      this.drawings = this.drawings.map((d) => {
        if (d.id !== id) return d;
        const next = { ...d };
        if (timeframes) next.timeframes = [...timeframes];
        else delete next.timeframes;
        return next;
      });
      const d = this.drawings.find((x) => x.id === id);
      if (d && this.selectedId === id && !shownOn(d, this.timeframe)) this.selectedId = null;
    });
  }

  /** Whether a drawing shows on the chart right now (not hidden, and on this timeframe). */
  isShown(d: Drawing): boolean {
    return !this.hidden && !d.hidden && shownOn(d, this.timeframe);
  }

  /** Hides or shows one drawing. A hidden drawing can't be selected on the chart. */
  toggleVisibility(id: string): void {
    this.mutate(() => {
      this.drawings = this.drawings.map((d) => (d.id === id ? { ...d, hidden: !d.hidden } : d));
      this.pruneSelection();
    });
  }

  /** Selects a drawing by id (null to clear the selection). */
  select(id: string | null): void {
    const d = id ? this.drawings.find((x) => x.id === id) : null;
    if (d && (d.hidden || !shownOn(d, this.timeframe))) return;
    if (d && this.tool !== 'cursor') this.setTool('cursor');
    this.selectedId = d ? d.id : null;
    this.changed();
  }

  remove(id: string): void {
    if (!this.drawings.some((d) => d.id === id)) return;
    this.mutate(() => {
      this.drawings = this.drawings.filter((d) => d.id !== id);
      this.pruneSelection();
    });
  }

  bringToFront(id = this.selectedId): void {
    const d = this.drawings.find((x) => x.id === id);
    if (!d) return;
    this.mutate(() => (this.drawings = [...this.drawings.filter((x) => x !== d), d]));
  }

  sendToBack(id = this.selectedId): void {
    const d = this.drawings.find((x) => x.id === id);
    if (!d) return;
    this.mutate(() => (this.drawings = [d, ...this.drawings.filter((x) => x !== d)]));
  }

  /** Selects the drawing under a screen position (e.g. for a right-click menu) and returns it. */
  selectAt(clientX: number, clientY: number): Drawing | null {
    const rect = this.container.getBoundingClientRect();
    const hit = this.hitTest(clientX - rect.left, clientY - rect.top);
    this.selectedId = hit?.id ?? null;
    this.changed();
    return this.selectedDrawing;
  }

  /** Moves the selected drawings by whole bars and/or screen pixels (arrow keys). */
  nudge(bars: number, pixels: number): void {
    const moving = this.drawings.filter((d) => this.sel.includes(d.id) && !d.locked);
    if (moving.length === 0) return;
    const y0 = this.cc.priceToY(0) ?? 0;
    const p0 = this.cc.yToPrice(y0);
    const p1 = this.cc.yToPrice(y0 - pixels);
    const dPrice = p0 === null || p1 === null ? 0 : p1 - p0;
    // Several presses in a row are a single undo step.
    this.nudgeBefore ??= this.snapshot();
    clearTimeout(this.nudgeTimer);
    this.nudgeTimer = setTimeout(() => {
      if (this.nudgeBefore) this.pushHistory(this.nudgeBefore);
      this.nudgeBefore = null;
      this.changed();
    }, 600);
    const shift = (t: number) => this.cc.logicalToTime(this.cc.timeToLogical(t) + bars);
    const moved = new Map(moving.map((d) => [d.id, moveWhole(d, shift, dPrice)]));
    this.drawings = this.drawings.map((x) => moved.get(x.id) ?? x);
    this.save();
    this.changed();
  }

  /** Deletes the selected drawings (one or several) as one undo step. */
  deleteSelected(): void {
    if (this.sel.length === 0) return;
    const ids = new Set(this.sel);
    this.mutate(() => {
      this.drawings = this.drawings.filter((d) => !ids.has(d.id));
      this.sel = [];
    });
  }

  clearAll(): void {
    if (this.drawings.length === 0) return;
    this.mutate(() => {
      this.drawings = [];
      this.selectedId = null;
    });
  }

  undo(): void {
    const prev = this.undoStack.pop();
    if (!prev) return;
    this.redoStack.push(this.snapshot());
    this.restore(prev);
  }

  redo(): void {
    const next = this.redoStack.pop();
    if (!next) return;
    this.undoStack.push(this.snapshot());
    this.restore(next);
  }

  redraw(): void {
    this.primitive.requestUpdate();
  }

  // --- state helpers --------------------------------------------------------------

  /** Drawings are never changed in place (every change makes new objects), so a shallow copy is a full snapshot. */
  private snapshot(): Drawing[] {
    return [...this.drawings];
  }

  /** Runs a change to the drawings as one undoable step, then saves. */
  private mutate(fn: () => void): void {
    const before = this.snapshot();
    fn();
    this.pushHistory(before);
    this.save();
    this.changed();
  }

  private pushHistory(before: Drawing[]): void {
    this.undoStack.push(before);
    if (this.undoStack.length > HISTORY_LIMIT) this.undoStack.shift();
    this.redoStack = [];
  }

  private restore(drawings: Drawing[]): void {
    this.drawings = drawings;
    this.pruneSelection();
    this.save();
    this.changed();
  }

  private save(): void {
    if (this.storageKey) saveDrawings(this.storageKey, this.drawings);
  }

  private changed(): void {
    this.redraw();
    this.listeners.change.forEach((fn) => fn());
  }

  private add(d: Drawing): void {
    if (this.hidden) this.hidden = false;
    this.mutate(() => (this.drawings = [...this.drawings, d]));
    this.setTool('cursor');
    this.selectedId = d.id;
    this.changed();
  }

  // --- coordinates -------------------------------------------------------------------

  private local(e: MouseEvent): { x: number; y: number; inPane: boolean } {
    const rect = this.container.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;
    const pane = this.cc.paneSize();
    return { x, y, inPane: x >= 0 && y >= 0 && x <= pane.width && y <= pane.height };
  }

  /** Screen position → chart point, snapped to the nearest bar in time, and to its O/H/L/C when the magnet is on. */
  private toPoint(x: number, y: number, useMagnet = true): Point | null {
    const logicalRaw = this.cc.xToLogical(x);
    let price = this.cc.yToPrice(y);
    if (logicalRaw === null || price === null) return null;
    const logical = Math.round(logicalRaw);

    if (useMagnet && this.magnetActive) {
      const c = this.cc.candleAt(logical);
      if (c) {
        const p = price;
        price = [c.open, c.high, c.low, c.close].reduce((best, v) => (Math.abs(v - p) < Math.abs(best - p) ? v : best));
      }
    }
    return { time: this.cc.logicalToTime(logical), price };
  }

  /** Screen position → chart point without snapping to bars (for freehand strokes). */
  private toExactPoint(x: number, y: number): Point | null {
    const logical = this.cc.xToLogical(x);
    const price = this.cc.yToPrice(y);
    if (logical === null || price === null) return null;
    return { time: this.cc.logicalToTime(logical), price };
  }

  private xy(p: Point): { x: number; y: number } | null {
    const x = this.cc.timeToX(p.time);
    const y = this.cc.priceToY(p.price);
    return x === null || y === null ? null : { x, y };
  }

  /**
   * The point under (x, y), moved so the line from `anchor` is horizontal, vertical or at
   * 45° on screen, whichever is closest to where the mouse is.
   */
  private constrain(anchor: Point, x: number, y: number): Point | null {
    const a = this.xy(anchor);
    if (!a) return this.toPoint(x, y, false);
    const dx = x - a.x;
    const dy = y - a.y;
    const angle = Math.abs(Math.atan2(dy, dx) * (180 / Math.PI)); // 0..180
    const fromHorizontal = Math.min(angle, 180 - angle);
    if (fromHorizontal < 22.5) {
      const p = this.toPoint(x, a.y, false);
      return p && { time: p.time, price: anchor.price };
    }
    if (fromHorizontal > 67.5) {
      const p = this.toPoint(a.x, y, false);
      return p && { time: anchor.time, price: p.price };
    }
    // 45°: the end snaps to a bar in time, so take the bar first and then make the height match
    // its exact distance. Snapping x while y followed the mouse made the slope wobble.
    const len = Math.max(Math.abs(dx), Math.abs(dy));
    const logicalRaw = this.cc.xToLogical(a.x + Math.sign(dx) * len);
    if (logicalRaw === null) return null;
    const logical = Math.round(logicalRaw);
    const bx = this.cc.logicalToX(logical);
    if (bx === null) return null;
    const price = this.cc.yToPrice(a.y + Math.sign(dy) * Math.abs(bx - a.x));
    return price === null ? null : { time: this.cc.logicalToTime(logical), price };
  }

  // --- creating drawings -------------------------------------------------------------

  private makeTwoPoint(type: TwoPointType, p1: Point, p2: Point): TwoPointDrawing {
    return { id: newId(), type, ...this.styleFor(type), p1, p2 };
  }

  /** A channel on `base`, as wide as needed to pass through the point at (x, y). */
  private makeChannel(base: { p1: Point; p2: Point }, x: number, y: number): ParallelChannel {
    let offset = 0;
    const a = this.xy(base.p1);
    const b = this.xy(base.p2);
    const price = this.cc.yToPrice(y);
    if (a && b && price !== null) {
      const baseY = a.x === b.x ? a.y : a.y + ((b.y - a.y) * (x - a.x)) / (b.x - a.x);
      const basePrice = this.cc.yToPrice(baseY);
      if (basePrice !== null) offset = price - basePrice;
    }
    return { id: newId(), type: 'channel', ...this.styleFor('channel'), p1: base.p1, p2: base.p2, offset };
  }

  private makePosition(type: 'long' | 'short', entry: Point, y: number): Drawing {
    // Default size: risk = 8% of the pane height, reward = 2× risk, 20 bars wide.
    const pane = this.cc.paneSize();
    const away = this.cc.yToPrice(y - pane.height * 0.08);
    const risk = away === null ? entry.price * 0.005 : Math.abs(away - entry.price);
    const dir = type === 'long' ? 1 : -1;
    const endTime = this.cc.logicalToTime(this.cc.timeToLogical(entry.time) + 20);
    return {
      id: newId(),
      type,
      ...this.styleFor(type),
      entry,
      tp: entry.price + dir * risk * 2,
      sl: entry.price - dir * risk,
      endTime,
    };
  }

  // --- text notes (edited in place) ---------------------------------------------------

  private openTextEditor(point: Point, existing?: TextNote): void {
    this.closeTextEditor(true);
    const pos = this.xy(point);
    const host = this.container.parentElement;
    if (!pos || !host) return;

    const hostRect = host.getBoundingClientRect();
    const rect = this.container.getBoundingClientRect();
    const style = existing ?? this.styleFor('text');
    const fontSize = style.fontSize ?? DEFAULT_FONT_SIZE;
    const ta = document.createElement('textarea');
    ta.className = 'text-editor';
    ta.value = existing?.text ?? '';
    ta.placeholder = 'Text…';
    ta.style.left = `${rect.left - hostRect.left + pos.x}px`;
    ta.style.top = `${rect.top - hostRect.top + pos.y}px`;
    ta.style.font = textFont(fontSize);
    ta.style.lineHeight = `${textLineHeight(fontSize)}px`;
    const theme = this.cc.themeColors;
    ta.style.color = readable(style.color, theme.background, theme.text);
    ta.rows = Math.max(1, ta.value.split('\n').length);
    host.append(ta);
    this.textEditor = ta;
    this.editingId = existing?.id ?? null;
    this.redraw();

    let done = false;
    const finish = (keep: boolean) => {
      if (done) return;
      done = true;
      this.textEditor = null;
      this.editingId = null;
      const text = ta.value.replace(/\s+$/, '');
      ta.remove();
      if (keep) {
        if (existing) {
          if (!text) {
            this.mutate(() => (this.drawings = this.drawings.filter((d) => d.id !== existing.id)));
          } else if (text !== existing.text) {
            this.mutate(() => (this.drawings = this.drawings.map((d) => (d.id === existing.id ? { ...existing, text } : d))));
          }
        } else if (text) {
          this.add({ id: newId(), type: 'text', ...this.styleFor('text'), p: point, text });
          return;
        }
      }
      this.setTool('cursor');
    };
    (ta as HTMLTextAreaElement & { finish?: (keep: boolean) => void }).finish = finish;

    ta.addEventListener('keydown', (e) => {
      e.stopPropagation();
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        finish(true);
      } else if (e.key === 'Escape') {
        finish(false);
      }
    });
    ta.addEventListener('input', () => (ta.rows = Math.max(1, ta.value.split('\n').length)));
    ta.addEventListener('blur', () => finish(true));
    requestAnimationFrame(() => ta.focus());
  }

  private closeTextEditor(keep: boolean): void {
    const ta = this.textEditor as (HTMLTextAreaElement & { finish?: (keep: boolean) => void }) | null;
    ta?.finish?.(keep);
  }

  // --- brush ------------------------------------------------------------------------

  private startStroke(x: number, y: number): void {
    const pt = this.toExactPoint(x, y);
    if (!pt) return;
    this.stroke = [pt];
    this.preview = { id: 'preview', type: 'brush', ...this.styleFor('brush'), points: this.stroke };
    let last = { x, y };
    const move = (e: MouseEvent) => {
      const p = this.local(e);
      if (Math.hypot(p.x - last.x, p.y - last.y) < 3) return; // skip tiny steps; keeps strokes small
      const next = this.toExactPoint(p.x, p.y);
      if (!next || !this.stroke) return;
      last = { x: p.x, y: p.y };
      this.stroke.push(next);
      this.preview = { id: 'preview', type: 'brush', ...this.styleFor('brush'), points: [...this.stroke] };
      this.redraw();
    };
    const up = () => {
      window.removeEventListener('mousemove', move);
      window.removeEventListener('mouseup', up);
      const points = this.stroke ?? [];
      this.stroke = null;
      this.preview = null;
      if (points.length >= 2) this.add({ id: newId(), type: 'brush', ...this.styleFor('brush'), points });
      else this.redraw();
    };
    window.addEventListener('mousemove', move);
    window.addEventListener('mouseup', up);
    this.redraw();
  }

  // --- hit testing ------------------------------------------------------------------

  private hitTest(x: number, y: number): { id: string; part: Part } | null {
    if (this.hidden) return null;
    // Selected drawings first, so their handles win over drawings underneath.
    const w = this.primitive.viewWindow();
    const order = this.drawings.filter((d) => !d.hidden && shownOn(d, this.timeframe) && (this.sel.includes(d.id) || !w || this.primitive.inView(d, w))).reverse().sort((a, b) => Number(this.sel.includes(b.id)) - Number(this.sel.includes(a.id)));
    for (const d of order) {
      for (const h of d.locked ? [] : handlesOf(d)) {
        const p = this.xy(h.point);
        if (p && Math.hypot(x - p.x, y - p.y) <= HANDLE_RADIUS) return { id: d.id, part: h.part };
      }
      if (this.hitBody(d, x, y)) return { id: d.id, part: 'body' };
    }
    return null;
  }

  private hitBody(d: Drawing, x: number, y: number): boolean {
    const pane = this.cc.paneSize();
    const reach = (pane.width + pane.height) * 4;
    const LINE_TOLERANCE = BASE_TOLERANCE + (d.width ?? DEFAULT_WIDTH) / 2;

    switch (d.type) {
      case 'hline': {
        const yy = this.cc.priceToY(d.price);
        return yy !== null && Math.abs(yy - y) <= LINE_TOLERANCE;
      }
      case 'vline': {
        const xx = this.cc.timeToX(d.time);
        return xx !== null && Math.abs(xx - x) <= LINE_TOLERANCE;
      }
      case 'hray': {
        const p = this.xy(d.p);
        return p !== null && x >= p.x - LINE_TOLERANCE && Math.abs(p.y - y) <= LINE_TOLERANCE;
      }
      case 'cross': {
        const p = this.xy(d.p);
        return p !== null && (Math.abs(p.y - y) <= LINE_TOLERANCE || Math.abs(p.x - x) <= LINE_TOLERANCE);
      }
      case 'brush': {
        const pts = d.points.map((pt) => this.xy(pt)).filter((pt): pt is { x: number; y: number } => pt !== null);
        return distToPolyline(x, y, pts) <= LINE_TOLERANCE;
      }
      case 'text': {
        const p = this.xy(d.p);
        if (!p) return false;
        const { width, height } = measureText(d.text, d.fontSize ?? DEFAULT_FONT_SIZE);
        return x >= p.x && x <= p.x + width && y >= p.y && y <= p.y + height;
      }
      case 'long':
      case 'short': {
        const x1 = this.cc.timeToX(d.entry.time);
        const x2 = this.cc.timeToX(d.endTime);
        const y1 = this.cc.priceToY(d.tp);
        const y2 = this.cc.priceToY(d.sl);
        if (x1 === null || x2 === null || y1 === null || y2 === null) return false;
        return x >= Math.min(x1, x2) && x <= Math.max(x1, x2) && y >= Math.min(y1, y2) && y <= Math.max(y1, y2);
      }
    }

    const a = this.xy(d.p1);
    const b = this.xy(d.p2);
    if (!a || !b) return false;

    switch (d.type) {
      case 'trend':
      case 'arrow':
        return distToSegment(x, y, a.x, a.y, b.x, b.y) <= LINE_TOLERANCE;
      case 'channel': {
        const top = this.cc.priceToY(d.p1.price + d.offset);
        const dy = top === null ? 0 : top - a.y;
        return (
          insideChannel(x, y, a, b, dy) ||
          distToSegment(x, y, a.x, a.y, b.x, b.y) <= LINE_TOLERANCE ||
          distToSegment(x, y, a.x, a.y + dy, b.x, b.y + dy) <= LINE_TOLERANCE
        );
      }
      case 'ray':
      case 'extended': {
        const [x1, y1, x2, y2] = extendSegment(a.x, a.y, b.x, b.y, reach, d.type === 'extended');
        return distToSegment(x, y, x1, y1, x2, y2) <= LINE_TOLERANCE;
      }
      case 'rect':
      case 'pricerange':
      case 'daterange':
        return (
          x >= Math.min(a.x, b.x) - LINE_TOLERANCE &&
          x <= Math.max(a.x, b.x) + LINE_TOLERANCE &&
          y >= Math.min(a.y, b.y) - LINE_TOLERANCE &&
          y <= Math.max(a.y, b.y) + LINE_TOLERANCE
        );
      case 'fib': {
        if (fibShowsTrendLine(d) && distToSegment(x, y, a.x, a.y, b.x, b.y) <= LINE_TOLERANCE) return true;
        if (x < Math.min(a.x, b.x) - LINE_TOLERANCE || x > Math.max(a.x, b.x) + LINE_TOLERANCE) return false;
        return fibLevelsOf(d).some((level) => {
          const ly = this.cc.priceToY(fibPrice(d, level));
          return ly !== null && Math.abs(ly - y) <= LINE_TOLERANCE;
        });
      }
    }
  }

  // --- mouse ---------------------------------------------------------------------

  private onMouseDown = (e: MouseEvent): void => {
    this.setMagnetHeld(modifierHeld(e));
    if (e.button !== 0) return;
    const { x, y, inPane } = this.local(e);
    if (!inPane) return;

    // A finished measurement disappears on the next click.
    if (this.measure && !this.measuring) {
      this.measure = null;
      this.redraw();
    }

    const tool = this.tool === 'cursor' && e.shiftKey ? 'measure' : this.tool;

    if (tool === 'measure') {
      e.stopPropagation();
      e.preventDefault();
      const pt = this.toPoint(x, y, false);
      if (!pt) return;
      if (!this.measuring) {
        if (this.tool !== 'measure') this.setTool('measure');
        this.measure = { p1: pt, p2: pt };
        this.measuring = true;
      } else {
        this.measuring = false;
        const m = this.measure;
        this.setTool('cursor');
        this.measure = m; // keep it on screen until the next click
      }
      this.redraw();
      return;
    }

    if (tool !== 'cursor') {
      e.stopPropagation();
      e.preventDefault();
      const pt = this.toPoint(x, y);
      if (!pt) return;

      if (tool === 'hline') return this.add({ id: newId(), type: 'hline', ...this.styleFor('hline'), price: pt.price });
      if (isOnePointType(tool)) return this.add({ id: newId(), type: tool, ...this.styleFor(tool), p: pt });
      if (tool === 'brush') return this.startStroke(x, y);
      if (tool === 'channel') {
        if (this.channelBase) return this.add(this.makeChannel(this.channelBase, x, y));
        if (!this.pending) {
          this.pending = pt;
          this.preview = { id: 'preview', type: 'channel', ...this.styleFor('channel'), p1: pt, p2: pt, offset: 0 };
        } else {
          const end = e.shiftKey ? (this.constrain(this.pending, x, y) ?? pt) : pt;
          this.channelBase = { p1: this.pending, p2: end };
          this.pending = null;
          this.preview = this.makeChannel(this.channelBase, x, y);
        }
        this.redraw();
        return;
      }
      if (tool === 'vline') return this.add({ id: newId(), type: 'vline', ...this.styleFor('vline'), time: pt.time });
      if (tool === 'long' || tool === 'short') return this.add(this.makePosition(tool, pt, y));
      if (tool === 'text') return this.openTextEditor(pt);

      if (isTwoPointType(tool)) {
        if (!this.pending) {
          this.pending = pt;
          this.preview = this.makeTwoPoint(tool, pt, pt);
          this.redraw();
        } else {
          const end = e.shiftKey && isStraightLineType(tool) ? (this.constrain(this.pending, x, y) ?? pt) : pt;
          this.add(this.makeTwoPoint(tool, this.pending, end));
        }
      }
      return;
    }

    // Cursor: select / start dragging, or let the chart pan.
    const hit = this.hitTest(x, y);

    // ⌘/Ctrl, like TradingView: a click adds a drawing to the selection or takes it out; a drag
    // over empty space draws a box and selects every drawing it touches.
    if (modifierHeld(e)) {
      e.stopPropagation();
      e.preventDefault();
      if (hit) {
        this.sel = this.sel.includes(hit.id) ? this.sel.filter((id) => id !== hit.id) : [...this.sel, hit.id];
        this.changed();
      } else {
        this.selectBox = { x1: x, y1: y, x2: x, y2: y };
        window.addEventListener('mousemove', this.onBoxMove);
        window.addEventListener('mouseup', this.onBoxEnd);
        this.redraw();
      }
      return;
    }

    if (!hit) {
      if (this.sel.length) {
        this.sel = [];
        this.changed();
      }
      return;
    }

    e.stopPropagation();
    e.preventDefault();
    // Grabbing one of several selected drawings moves them all; anything else selects just it.
    const group = this.sel.length > 1 && this.sel.includes(hit.id);
    if (!group) this.selectedId = hit.id;
    const original = this.drawings.find((d) => d.id === hit.id);
    const logical = this.cc.xToLogical(x);
    const price = this.cc.yToPrice(y);
    if (original && (group || !original.locked) && logical !== null && price !== null) {
      this.drag = {
        id: hit.id,
        part: group ? 'body' : hit.part,
        original: structuredClone(original),
        others: group ? this.drawings.filter((d) => d.id !== hit.id && this.sel.includes(d.id)) : undefined,
        startLogical: Math.round(logical),
        startPrice: price,
        before: this.snapshot(),
      };
      this.syncCrosshairMagnet();
      window.addEventListener('mousemove', this.onDragMove);
      window.addEventListener('mouseup', this.onDragEnd);
    }
    this.changed();
  };

  private onHover = (e: MouseEvent): void => {
    this.setMagnetHeld(modifierHeld(e));
    if (this.drag) return;
    const { x, y } = this.local(e);

    if (this.measuring && this.measure) {
      const pt = this.toPoint(x, y, false);
      if (pt) {
        this.measure = { ...this.measure, p2: pt };
        this.redraw();
      }
      return;
    }

    if (this.tool === 'channel' && (this.pending || this.channelBase)) {
      if (this.channelBase) this.preview = this.makeChannel(this.channelBase, x, y);
      else if (this.pending) {
        const pt = e.shiftKey ? this.constrain(this.pending, x, y) : this.toPoint(x, y);
        if (pt) this.preview = { id: 'preview', type: 'channel', ...this.styleFor('channel'), p1: this.pending, p2: pt, offset: 0 };
      }
      this.redraw();
      return;
    }

    if (this.pending && isTwoPointType(this.tool)) {
      const pt = e.shiftKey && isStraightLineType(this.tool) ? this.constrain(this.pending, x, y) : this.toPoint(x, y);
      if (pt) {
        this.preview = this.makeTwoPoint(this.tool, this.pending, pt);
        this.redraw();
      }
      return;
    }

    if (this.tool === 'cursor') {
      const hit = this.hitTest(x, y);
      const locked = hit && this.drawings.find((d) => d.id === hit.id)?.locked;
      this.container.style.cursor = !hit ? '' : locked ? 'default' : hit.part === 'body' ? 'move' : 'pointer';
      this.setHovered(hit?.id ?? null);
    } else this.setHovered(null);
  };

  private setHovered(id: string | null): void {
    if (id === this.hoveredId) return;
    const was = this.drawings.find((d) => d.id === this.hoveredId);
    const now = this.drawings.find((d) => d.id === id);
    this.hoveredId = id;
    // Only positions look different while pointed at; skip the redraw for the rest.
    if ([was, now].some((d) => d && (d.type === 'long' || d.type === 'short'))) this.redraw();
  }

  private onDoubleClick = (e: MouseEvent): void => {
    if (this.tool !== 'cursor') return;
    const { x, y } = this.local(e);
    const hit = this.hitTest(x, y);
    const d = hit && this.drawings.find((dd) => dd.id === hit.id);
    if (d && d.type === 'text') {
      e.stopPropagation();
      e.preventDefault();
      this.openTextEditor(d.p, d);
    }
  };

  private onDragMove = (e: MouseEvent): void => {
    this.setMagnetHeld(modifierHeld(e));
    const drag = this.drag;
    if (!drag) return;
    const { x, y } = this.local(e);

    let next: Drawing;
    if (drag.part === 'body') {
      const logicalRaw = this.cc.xToLogical(x);
      const price = this.cc.yToPrice(y);
      if (logicalRaw === null || price === null) return;
      const dl = Math.round(logicalRaw) - drag.startLogical;
      const shiftTime = (t: number) => this.cc.logicalToTime(this.cc.timeToLogical(t) + dl);
      if (drag.others) {
        // Several drawings: all move by the same amount (locked ones stay).
        const all = [drag.original, ...drag.others].filter((d) => !d.locked);
        const moved = new Map(all.map((d) => [d.id, moveWhole(d, shiftTime, price - drag.startPrice)]));
        this.drawings = this.drawings.map((d) => moved.get(d.id) ?? d);
        this.redraw();
        return;
      }
      next = moveWhole(drag.original, shiftTime, price - drag.startPrice);
    } else {
      const o = drag.original;
      // Shift keeps a line horizontal, vertical or at 45° around its other end.
      const straight = (isStraightLineType(o.type) && isTwoPoint(o)) || o.type === 'channel';
      const anchor =
        e.shiftKey && straight && (drag.part === 'p1' || drag.part === 'p2') && 'p1' in o
          ? drag.part === 'p1'
            ? o.p2
            : o.p1
          : null;
      const pt = anchor ? this.constrain(anchor, x, y) : this.toPoint(x, y);
      if (!pt) return;
      next = moveHandle(o, drag.part, pt);
    }

    this.drawings = this.drawings.map((d) => (d.id === drag.id ? next : d));
    this.redraw();
  };

  private onDragEnd = (): void => {
    window.removeEventListener('mousemove', this.onDragMove);
    window.removeEventListener('mouseup', this.onDragEnd);
    const drag = this.drag;
    this.drag = null;
    this.syncCrosshairMagnet();
    if (drag && JSON.stringify(drag.before) !== JSON.stringify(this.drawings)) {
      this.pushHistory(drag.before);
      this.save();
    } else if (drag?.others) {
      // A click (no move) on one of several selected drawings selects just that one.
      this.selectedId = drag.id;
    }
    this.changed();
  };

  private onBoxMove = (e: MouseEvent): void => {
    if (!this.selectBox) return;
    const { x, y } = this.local(e);
    this.selectBox = { ...this.selectBox, x2: x, y2: y };
    this.redraw();
  };

  private onBoxEnd = (): void => {
    window.removeEventListener('mousemove', this.onBoxMove);
    window.removeEventListener('mouseup', this.onBoxEnd);
    const b = this.selectBox;
    this.selectBox = null;
    if (!b) return;
    const box = { left: Math.min(b.x1, b.x2), right: Math.max(b.x1, b.x2), top: Math.min(b.y1, b.y2), bottom: Math.max(b.y1, b.y2) };
    // A ⌘/Ctrl click on empty space (no real box) clears the selection.
    if (box.right - box.left < 3 && box.bottom - box.top < 3) this.sel = [];
    else this.sel = this.drawings.filter((d) => this.isShown(d) && this.touchesBox(d, box)).map((d) => d.id);
    this.changed();
  };

  /** Whether any part of a drawing lies inside the box (pane pixels). */
  private touchesBox(d: Drawing, box: { left: number; right: number; top: number; bottom: number }): boolean {
    const { left, right, top, bottom } = box;
    const pane = this.cc.paneSize();
    const xIn = (x: number) => x >= left && x <= right;
    const yIn = (y: number) => y >= top && y <= bottom;
    const seg = (a: { x: number; y: number }, c: { x: number; y: number }) => segmentCrossesRect(a.x, a.y, c.x, c.y, left, top, right, bottom);
    const boxOverlap = (x1: number, y1: number, x2: number, y2: number) =>
      Math.max(x1, x2) >= left && Math.min(x1, x2) <= right && Math.max(y1, y2) >= top && Math.min(y1, y2) <= bottom;
    const X = (t: number) => this.cc.timeToX(t);
    const Y = (p: number) => this.cc.priceToY(p);

    switch (d.type) {
      case 'hline': {
        const y = Y(d.price);
        return y !== null && yIn(y);
      }
      case 'vline': {
        const x = X(d.time);
        return x !== null && xIn(x);
      }
      case 'hray': {
        const p = this.xy(d.p);
        return !!p && yIn(p.y) && p.x <= right;
      }
      case 'cross': {
        const p = this.xy(d.p);
        return !!p && (yIn(p.y) || xIn(p.x));
      }
      case 'trend':
      case 'arrow': {
        const a = this.xy(d.p1);
        const c = this.xy(d.p2);
        return !!a && !!c && seg(a, c);
      }
      case 'ray':
      case 'extended': {
        const a = this.xy(d.p1);
        const c = this.xy(d.p2);
        if (!a || !c) return false;
        const [x1, y1, x2, y2] = extendSegment(a.x, a.y, c.x, c.y, (pane.width + pane.height) * 4, d.type === 'extended');
        return segmentCrossesRect(x1, y1, x2, y2, left, top, right, bottom);
      }
      case 'channel': {
        const a = this.xy(d.p1);
        const c = this.xy(d.p2);
        const a2 = this.xy({ time: d.p1.time, price: d.p1.price + d.offset });
        const c2 = this.xy({ time: d.p2.time, price: d.p2.price + d.offset });
        if (!a || !c || !a2 || !c2) return false;
        return seg(a, c) || seg(a2, c2) || insideChannel((left + right) / 2, (top + bottom) / 2, a, c, a2.y - a.y);
      }
      case 'brush': {
        const pts = d.points.map((p) => this.xy(p)).filter((p): p is { x: number; y: number } => p !== null);
        return pts.some((p, i) => (i === 0 ? xIn(p.x) && yIn(p.y) : seg(pts[i - 1], p)));
      }
      case 'text': {
        const p = this.xy(d.p);
        if (!p) return false;
        const size = measureText(d.text, d.fontSize ?? DEFAULT_FONT_SIZE);
        return boxOverlap(p.x, p.y, p.x + size.width, p.y + size.height);
      }
      case 'long':
      case 'short': {
        const x1 = X(d.entry.time);
        const x2 = X(d.endTime);
        const y1 = Y(d.tp);
        const y2 = Y(d.sl);
        return x1 !== null && x2 !== null && y1 !== null && y2 !== null && boxOverlap(x1, y1, x2, y2);
      }
      default: {
        // Rectangle, Fibonacci, price and date ranges: the area between their two points.
        const a = this.xy(d.p1);
        const c = this.xy(d.p2);
        return !!a && !!c && boxOverlap(a.x, a.y, c.x, c.y);
      }
    }
  }

  // --- keyboard ---------------------------------------------------------------------

  private onKeyDown = (e: KeyboardEvent): void => {
    const target = e.target as HTMLElement | null;
    if (target && (target.tagName === 'INPUT' || target.tagName === 'SELECT' || target.tagName === 'TEXTAREA')) return;
    const mod = e.metaKey || e.ctrlKey;

    if (mod && e.code === 'KeyZ') {
      e.preventDefault();
      if (e.shiftKey) this.redo();
      else this.undo();
    } else if (mod && e.code === 'KeyY') {
      e.preventDefault();
      this.redo();
    } else if (mod && e.code === 'KeyC' && this.selectedId) {
      e.preventDefault();
      this.copySelected();
    } else if (mod && e.code === 'KeyA' && !e.shiftKey && !e.altKey) {
      // Select every drawing on the chart (instead of the page's text).
      e.preventDefault();
      this.sel = this.drawings.filter((d) => this.isShown(d)).map((d) => d.id);
      this.changed();
    } else if (mod && e.code === 'KeyV' && this.clipboard) {
      e.preventDefault();
      this.paste();
    } else if (mod && e.code === 'KeyD' && this.selectedId) {
      e.preventDefault(); // also stops the browser's "bookmark this page"
      this.duplicateSelected();
    } else if (this.sel.length && !mod && e.key.startsWith('Arrow')) {
      e.preventDefault();
      const big = e.shiftKey;
      if (e.key === 'ArrowLeft') this.nudge(big ? -10 : -1, 0);
      else if (e.key === 'ArrowRight') this.nudge(big ? 10 : 1, 0);
      else if (e.key === 'ArrowUp') this.nudge(0, big ? 10 : 1);
      else if (e.key === 'ArrowDown') this.nudge(0, big ? -10 : -1);
    } else if (e.key === 'Escape') {
      this.measure = null;
      this.sel = [];
      this.setTool('cursor');
    } else if ((e.key === 'Delete' || e.key === 'Backspace') && this.sel.length) {
      e.preventDefault();
      this.deleteSelected();
    }
  };
}

/** Every look setting a drawing of this type can have, at its default. */
function lookDefaults(type: DrawingType, color: string): DrawingStyle {
  const s = styleSupport(type);
  return {
    ...(s.line ? { width: DEFAULT_WIDTH, lineStyle: 'solid' as const } : {}),
    ...(s.font ? { fontSize: DEFAULT_FONT_SIZE } : {}),
    ...(s.zones ? { profitColor: DEFAULT_PROFIT_COLOR, lossColor: DEFAULT_LOSS_COLOR } : {}),
    ...(s.fill ? { fillColor: color } : {}),
    ...(s.fib ? { levels: [...FIB_LEVELS], trendLine: true } : {}),
    ...(s.label ? { labelPos: DEFAULT_LABEL_POS, labelSize: DEFAULT_LABEL_SIZE } : {}),
  };
}

/** The style properties a drawing has set (what a template keeps). */
function styleOf(d: Drawing): DrawingStyle {
  const keys = ['color', 'width', 'lineStyle', 'fontSize', 'profitColor', 'lossColor', 'fillColor', 'levels', 'trendLine', 'label', 'labelPos', 'labelSize'] as const;
  const out: Record<string, unknown> = {};
  for (const k of keys) {
    const v = (d as unknown as Record<string, unknown>)[k];
    if (v !== undefined) out[k] = Array.isArray(v) ? [...v] : v;
  }
  return out as DrawingStyle;
}
