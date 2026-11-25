import { readable } from '../chart/appearance';
import type { ChartController } from '../chart/ChartController';
import { DrawingsPrimitive, type DrawingSource } from './DrawingsPrimitive';
import { distToSegment, extendSegment, handlesOf, moveHandle, moveWhole, type Part } from './geometry';
import {
  DEFAULT_COLORS,
  DEFAULT_FONT_SIZE,
  DEFAULT_WIDTH,
  FIB_LEVELS,
  fibPrice,
  isTwoPointType,
  measureText,
  newId,
  styleSupport,
  textFont,
  textLineHeight,
  type Drawing,
  type DrawingStyle,
  type DrawingType,
  type Point,
  type TextNote,
  type ToolId,
  type TwoPointDrawing,
  type TwoPointType,
} from './model';
import { loadDrawings, loadStyleDefaults, saveDrawings, saveStyleDefaults } from './storage';

interface DragState {
  id: string;
  part: Part;
  original: Drawing;
  startLogical: number;
  startPrice: number;
  before: Drawing[];
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
  selectedId: string | null = null;
  editingId: string | null = null;
  measure: { p1: Point; p2: Point } | null = null;

  private tool: ToolId = 'cursor';
  private pending: Point | null = null;
  private measuring = false;
  private drag: DragState | null = null;
  private magnet = false;
  private storageKey = '';
  private undoStack: Drawing[][] = [];
  private redoStack: Drawing[][] = [];
  private textEditor: HTMLTextAreaElement | null = null;
  /** Last-used style per drawing type; new drawings start with it. */
  private styleDefaults = loadStyleDefaults();
  /** Snapshot taken when a live style preview (e.g. dragging in the color picker) starts. */
  private styleBefore: Drawing[] | null = null;

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
    container.addEventListener('dblclick', this.onDoubleClick, true);
    window.addEventListener('keydown', this.onKeyDown);
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

  get canUndo(): boolean {
    return this.undoStack.length > 0;
  }

  get canRedo(): boolean {
    return this.redoStack.length > 0;
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

    this.drawings = this.drawings.map((x) => (x.id === d.id ? ({ ...x, ...clean } as Drawing) : x));
    if (!live) {
      this.pushHistory(before);
      this.save();
      this.styleDefaults = { ...this.styleDefaults, [d.type]: { ...this.styleDefaults[d.type], ...clean } };
      saveStyleDefaults(this.styleDefaults);
    }
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
    this.tool = tool;
    this.pending = null;
    this.preview = null;
    this.measuring = false;
    if (tool !== 'cursor') {
      this.selectedId = null;
      this.measure = null;
    }
    this.container.style.cursor = tool === 'cursor' ? '' : 'crosshair';
    this.listeners.tool.forEach((fn) => fn(tool));
    this.changed();
  }

  setMagnet(on: boolean): void {
    this.magnet = on;
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
      this.preview = null;
      this.measure = null;
      this.undoStack = [];
      this.redoStack = [];
      this.styleBefore = null;
    }
    this.changed();
  }

  deleteSelected(): void {
    const id = this.selectedId;
    if (!id) return;
    this.mutate(() => {
      this.drawings = this.drawings.filter((d) => d.id !== id);
      this.selectedId = null;
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

  private snapshot(): Drawing[] {
    return structuredClone(this.drawings);
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
    if (this.selectedId && !drawings.some((d) => d.id === this.selectedId)) this.selectedId = null;
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
    this.mutate(() => this.drawings.push(d));
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

    if (useMagnet && this.magnet) {
      const c = this.cc.candleAt(logical);
      if (c) {
        const p = price;
        price = [c.open, c.high, c.low, c.close].reduce((best, v) => (Math.abs(v - p) < Math.abs(best - p) ? v : best));
      }
    }
    return { time: this.cc.logicalToTime(logical), price };
  }

  private xy(p: Point): { x: number; y: number } | null {
    const x = this.cc.timeToX(p.time);
    const y = this.cc.priceToY(p.price);
    return x === null || y === null ? null : { x, y };
  }

  // --- creating drawings -------------------------------------------------------------

  private makeTwoPoint(type: TwoPointType, p1: Point, p2: Point): TwoPointDrawing {
    return { id: newId(), type, ...this.styleFor(type), p1, p2 };
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
      color: DEFAULT_COLORS[type],
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

  // --- hit testing ------------------------------------------------------------------

  private hitTest(x: number, y: number): { id: string; part: Part } | null {
    // Selected drawing first, so its handles win over drawings underneath.
    const order = [...this.drawings].reverse().sort((a, b) => Number(b.id === this.selectedId) - Number(a.id === this.selectedId));
    for (const d of order) {
      for (const h of handlesOf(d)) {
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
        return distToSegment(x, y, a.x, a.y, b.x, b.y) <= LINE_TOLERANCE;
      case 'ray':
      case 'extended': {
        const [x1, y1, x2, y2] = extendSegment(a.x, a.y, b.x, b.y, reach, d.type === 'extended');
        return distToSegment(x, y, x1, y1, x2, y2) <= LINE_TOLERANCE;
      }
      case 'rect':
        return (
          x >= Math.min(a.x, b.x) - LINE_TOLERANCE &&
          x <= Math.max(a.x, b.x) + LINE_TOLERANCE &&
          y >= Math.min(a.y, b.y) - LINE_TOLERANCE &&
          y <= Math.max(a.y, b.y) + LINE_TOLERANCE
        );
      case 'fib': {
        if (distToSegment(x, y, a.x, a.y, b.x, b.y) <= LINE_TOLERANCE) return true;
        if (x < Math.min(a.x, b.x) - LINE_TOLERANCE || x > Math.max(a.x, b.x) + LINE_TOLERANCE) return false;
        return FIB_LEVELS.some((level) => {
          const ly = this.cc.priceToY(fibPrice(d, level));
          return ly !== null && Math.abs(ly - y) <= LINE_TOLERANCE;
        });
      }
    }
  }

  // --- mouse ---------------------------------------------------------------------

  private onMouseDown = (e: MouseEvent): void => {
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
      if (tool === 'vline') return this.add({ id: newId(), type: 'vline', ...this.styleFor('vline'), time: pt.time });
      if (tool === 'long' || tool === 'short') return this.add(this.makePosition(tool, pt, y));
      if (tool === 'text') return this.openTextEditor(pt);

      if (isTwoPointType(tool)) {
        if (!this.pending) {
          this.pending = pt;
          this.preview = this.makeTwoPoint(tool, pt, pt);
          this.redraw();
        } else {
          this.add(this.makeTwoPoint(tool, this.pending, pt));
        }
      }
      return;
    }

    // Cursor: select / start dragging, or let the chart pan.
    const hit = this.hitTest(x, y);
    if (!hit) {
      if (this.selectedId) {
        this.selectedId = null;
        this.changed();
      }
      return;
    }

    e.stopPropagation();
    e.preventDefault();
    this.selectedId = hit.id;
    const original = this.drawings.find((d) => d.id === hit.id);
    const logical = this.cc.xToLogical(x);
    const price = this.cc.yToPrice(y);
    if (original && logical !== null && price !== null) {
      this.drag = {
        id: hit.id,
        part: hit.part,
        original: structuredClone(original),
        startLogical: Math.round(logical),
        startPrice: price,
        before: this.snapshot(),
      };
      window.addEventListener('mousemove', this.onDragMove);
      window.addEventListener('mouseup', this.onDragEnd);
    }
    this.changed();
  };

  private onHover = (e: MouseEvent): void => {
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

    if (this.pending && isTwoPointType(this.tool)) {
      const pt = this.toPoint(x, y);
      if (pt) {
        this.preview = this.makeTwoPoint(this.tool, this.pending, pt);
        this.redraw();
      }
      return;
    }

    if (this.tool === 'cursor') {
      const hit = this.hitTest(x, y);
      this.container.style.cursor = !hit ? '' : hit.part === 'body' ? 'move' : 'pointer';
    }
  };

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
      next = moveWhole(drag.original, shiftTime, price - drag.startPrice);
    } else {
      const pt = this.toPoint(x, y);
      if (!pt) return;
      next = moveHandle(drag.original, drag.part, pt);
    }

    this.drawings = this.drawings.map((d) => (d.id === drag.id ? next : d));
    this.redraw();
  };

  private onDragEnd = (): void => {
    window.removeEventListener('mousemove', this.onDragMove);
    window.removeEventListener('mouseup', this.onDragEnd);
    const drag = this.drag;
    this.drag = null;
    if (drag && JSON.stringify(drag.before) !== JSON.stringify(this.drawings)) {
      this.pushHistory(drag.before);
      this.save();
    }
    this.changed();
  };

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
    } else if (e.key === 'Escape') {
      this.measure = null;
      this.selectedId = null;
      this.setTool('cursor');
    } else if ((e.key === 'Delete' || e.key === 'Backspace') && this.selectedId) {
      e.preventDefault();
      this.deleteSelected();
    }
  };
}
