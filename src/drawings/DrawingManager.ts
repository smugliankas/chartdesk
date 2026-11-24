import type { ChartController } from '../chart/ChartController';
import { DrawingsPrimitive, type DrawingSource } from './DrawingsPrimitive';
import {
  DEFAULT_COLORS,
  FIB_LEVELS,
  fibPrice,
  newId,
  type Drawing,
  type Point,
  type ToolId,
  type TwoPointDrawing,
} from './model';
import { loadDrawings, saveDrawings } from './storage';

type Part = 'p1' | 'p2' | 'body';

interface DragState {
  id: string;
  part: Part;
  original: Drawing;
  startLogical: number;
  startPrice: number;
}

const HANDLE_RADIUS = 8;
const LINE_TOLERANCE = 6;

/**
 * Handles the drawing tools: placing new drawings with two clicks, selecting,
 * dragging (whole drawing or one end), deleting, and saving per symbol.
 *
 * There is no limit on the number of drawings.
 */
export class DrawingManager implements DrawingSource {
  drawings: Drawing[] = [];
  preview: Drawing | null = null;
  selectedId: string | null = null;

  private tool: ToolId = 'cursor';
  private pending: Point | null = null;
  private drag: DragState | null = null;
  private storageKey = '';
  private readonly primitive: DrawingsPrimitive;
  private readonly toolListeners: ((tool: ToolId) => void)[] = [];

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
    window.addEventListener('keydown', this.onKeyDown);
  }

  // --- public API -----------------------------------------------------------

  get currentTool(): ToolId {
    return this.tool;
  }

  onToolChange(fn: (tool: ToolId) => void): void {
    this.toolListeners.push(fn);
  }

  setTool(tool: ToolId): void {
    this.tool = tool;
    this.pending = null;
    this.preview = null;
    if (tool !== 'cursor') this.selectedId = null;
    this.container.style.cursor = tool === 'cursor' ? '' : 'crosshair';
    this.toolListeners.forEach((fn) => fn(tool));
    this.redraw();
  }

  /** Switches the set of drawings, e.g. when the symbol changes. Drawings are shared across timeframes. */
  setStorageKey(key: string): void {
    if (key === this.storageKey) {
      this.redraw();
      return;
    }
    this.storageKey = key;
    this.drawings = loadDrawings(key);
    this.selectedId = null;
    this.pending = null;
    this.preview = null;
    this.redraw();
  }

  deleteSelected(): void {
    if (!this.selectedId) return;
    this.drawings = this.drawings.filter((d) => d.id !== this.selectedId);
    this.selectedId = null;
    this.commit();
  }

  clearAll(): void {
    this.drawings = [];
    this.selectedId = null;
    this.commit();
  }

  redraw(): void {
    this.primitive.requestUpdate();
  }

  // --- helpers ----------------------------------------------------------------

  private commit(): void {
    if (this.storageKey) saveDrawings(this.storageKey, this.drawings);
    this.redraw();
  }

  private local(e: MouseEvent): { x: number; y: number; inPane: boolean } {
    const rect = this.container.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;
    const pane = this.cc.paneSize();
    return { x, y, inPane: x >= 0 && y >= 0 && x <= pane.width && y <= pane.height };
  }

  /** Screen position → chart point, snapped to the nearest bar in time. */
  private toPoint(x: number, y: number): Point | null {
    const logical = this.cc.xToLogical(x);
    const price = this.cc.yToPrice(y);
    if (logical === null || price === null) return null;
    return { time: this.cc.logicalToTime(Math.round(logical)), price };
  }

  private makeDrawing(tool: Exclude<ToolId, 'cursor' | 'hline'>, p1: Point, p2: Point): TwoPointDrawing {
    return { id: newId(), type: tool, color: DEFAULT_COLORS[tool], p1, p2 };
  }

  // --- hit testing --------------------------------------------------------------

  private hitTest(x: number, y: number): { id: string; part: Part } | null {
    for (let i = this.drawings.length - 1; i >= 0; i--) {
      const d = this.drawings[i];
      const part = this.hitDrawing(d, x, y);
      if (part) return { id: d.id, part };
    }
    return null;
  }

  private hitDrawing(d: Drawing, x: number, y: number): Part | null {
    if (d.type === 'hline') {
      const yy = this.cc.priceToY(d.price);
      return yy !== null && Math.abs(yy - y) <= LINE_TOLERANCE ? 'body' : null;
    }

    const ax = this.cc.timeToX(d.p1.time);
    const ay = this.cc.priceToY(d.p1.price);
    const bx = this.cc.timeToX(d.p2.time);
    const by = this.cc.priceToY(d.p2.price);
    if (ax === null || ay === null || bx === null || by === null) return null;

    if (Math.hypot(x - ax, y - ay) <= HANDLE_RADIUS) return 'p1';
    if (Math.hypot(x - bx, y - by) <= HANDLE_RADIUS) return 'p2';

    switch (d.type) {
      case 'trend':
        return distToSegment(x, y, ax, ay, bx, by) <= LINE_TOLERANCE ? 'body' : null;

      case 'rect': {
        const inside =
          x >= Math.min(ax, bx) - LINE_TOLERANCE &&
          x <= Math.max(ax, bx) + LINE_TOLERANCE &&
          y >= Math.min(ay, by) - LINE_TOLERANCE &&
          y <= Math.max(ay, by) + LINE_TOLERANCE;
        return inside ? 'body' : null;
      }

      case 'fib': {
        if (distToSegment(x, y, ax, ay, bx, by) <= LINE_TOLERANCE) return 'body';
        const left = Math.min(ax, bx);
        const right = Math.max(ax, bx);
        if (x < left - LINE_TOLERANCE || x > right + LINE_TOLERANCE) return null;
        for (const level of FIB_LEVELS) {
          const ly = this.cc.priceToY(fibPrice(d, level));
          if (ly !== null && Math.abs(ly - y) <= LINE_TOLERANCE) return 'body';
        }
        return null;
      }
    }
  }

  // --- events ---------------------------------------------------------------

  private onMouseDown = (e: MouseEvent): void => {
    if (e.button !== 0) return;
    const { x, y, inPane } = this.local(e);
    if (!inPane) return;

    // Placing a new drawing.
    if (this.tool !== 'cursor') {
      e.stopPropagation();
      e.preventDefault();
      const pt = this.toPoint(x, y);
      if (!pt) return;

      if (this.tool === 'hline') {
        const d: Drawing = { id: newId(), type: 'hline', color: DEFAULT_COLORS.hline, price: pt.price };
        this.drawings.push(d);
        this.commit();
        this.setTool('cursor');
        this.selectedId = d.id;
        this.redraw();
        return;
      }

      if (!this.pending) {
        this.pending = pt;
        this.preview = this.makeDrawing(this.tool, pt, pt);
        this.redraw();
        return;
      }

      const d = this.makeDrawing(this.tool, this.pending, pt);
      this.drawings.push(d);
      this.commit();
      this.setTool('cursor');
      this.selectedId = d.id;
      this.redraw();
      return;
    }

    // Cursor: select / start dragging, or let the chart pan.
    const hit = this.hitTest(x, y);
    if (!hit) {
      if (this.selectedId) {
        this.selectedId = null;
        this.redraw();
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
      };
      window.addEventListener('mousemove', this.onDragMove);
      window.addEventListener('mouseup', this.onDragEnd);
    }
    this.redraw();
  };

  private onHover = (e: MouseEvent): void => {
    if (this.drag) return;
    const { x, y } = this.local(e);

    if (this.pending && this.tool !== 'cursor' && this.tool !== 'hline') {
      const pt = this.toPoint(x, y);
      if (pt) {
        this.preview = this.makeDrawing(this.tool, this.pending, pt);
        this.redraw();
      }
      return;
    }

    if (this.tool === 'cursor') {
      const hit = this.hitTest(x, y);
      this.container.style.cursor = !hit ? '' : hit.part === 'body' ? 'move' : 'pointer';
    }
  };

  private onDragMove = (e: MouseEvent): void => {
    const drag = this.drag;
    if (!drag) return;
    const { x, y } = this.local(e);
    const logicalRaw = this.cc.xToLogical(x);
    const price = this.cc.yToPrice(y);
    if (logicalRaw === null || price === null) return;
    const logical = Math.round(logicalRaw);
    const dl = logical - drag.startLogical;
    const dp = price - drag.startPrice;

    const o = drag.original;
    let next: Drawing;
    if (o.type === 'hline') {
      next = { ...o, price: o.price + dp };
    } else if (drag.part === 'body') {
      next = { ...o, p1: this.shift(o.p1, dl, dp), p2: this.shift(o.p2, dl, dp) };
    } else {
      const pt = { time: this.cc.logicalToTime(logical), price };
      next = drag.part === 'p1' ? { ...o, p1: pt } : { ...o, p2: pt };
    }

    this.drawings = this.drawings.map((d) => (d.id === drag.id ? next : d));
    this.redraw();
  };

  private onDragEnd = (): void => {
    window.removeEventListener('mousemove', this.onDragMove);
    window.removeEventListener('mouseup', this.onDragEnd);
    this.drag = null;
    this.commit();
  };

  private shift(p: Point, dLogical: number, dPrice: number): Point {
    return { time: this.cc.logicalToTime(this.cc.timeToLogical(p.time) + dLogical), price: p.price + dPrice };
  }

  private onKeyDown = (e: KeyboardEvent): void => {
    const target = e.target as HTMLElement | null;
    if (target && (target.tagName === 'INPUT' || target.tagName === 'SELECT' || target.tagName === 'TEXTAREA')) return;

    if (e.key === 'Escape') {
      this.setTool('cursor');
      this.selectedId = null;
      this.redraw();
    } else if ((e.key === 'Delete' || e.key === 'Backspace') && this.selectedId) {
      e.preventDefault();
      this.deleteSelected();
    }
  };
}

function distToSegment(px: number, py: number, ax: number, ay: number, bx: number, by: number): number {
  const dx = bx - ax;
  const dy = by - ay;
  const len2 = dx * dx + dy * dy;
  if (len2 === 0) return Math.hypot(px - ax, py - ay);
  const t = Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / len2));
  return Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
}
