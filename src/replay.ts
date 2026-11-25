import type { ChartController } from './chart/ChartController';
import { formatDateTime } from './format';
import { barCloseTime } from './chart/countdown';
import type { Candle, Timeframe } from './types';
import { IS_MAC } from './platform';
import { makeDraggable } from './ui/draggable';
import { ICONS } from './ui/tools';

/** Bars per second. */
export const REPLAY_SPEEDS: readonly number[] = [0.5, 1, 2, 3, 5, 10];

export const REPLAY_STEP_KEYS = IS_MAC ? '⇧→' : 'Shift+→';

export interface ReplayHost {
  cc: ChartController;
  /** The element around the chart; the replay bar and the start-bar picker go in it. */
  wrap: HTMLElement;
  /** The chart's timeframe. */
  timeframe: () => Timeframe;
  /** Called on every change: entered, stepped, paused, left. */
  onChange: () => void;
  /** Leaving replay: load the live chart again. */
  onExit: () => void;
}

/**
 * Bar replay: pick a bar on the chart, everything after it disappears, then the bars come
 * back one by one, at a chosen speed or step by step. For practising on past price action
 * without seeing what happened next.
 *
 * The replay keeps a "clock": the close time of the last bar shown. Changing the timeframe
 * or the symbol keeps the clock, and shows only bars that had closed by then, so nothing
 * from the future leaks in.
 */
export class Replay {
  /** All bars of the current chart; only the first `shown` are on screen. */
  private full: Candle[] = [];
  private shown = 0;
  private timer: ReturnType<typeof setInterval> | undefined;
  private speedIndex = 1;
  private selecting = false;
  /** Close time of the last bar shown (UNIX seconds). */
  private clock = 0;
  private active_ = false;

  private readonly bar: HTMLDivElement;
  private readonly playButton: HTMLButtonElement;
  private readonly speedSelect: HTMLSelectElement;
  private readonly dateLabel: HTMLSpanElement;
  private readonly cursorEl: HTMLDivElement;
  private readonly shadeEl: HTMLDivElement;
  private readonly hintEl: HTMLDivElement;

  constructor(private readonly host: ReplayHost) {
    // --- control bar --------------------------------------------------------
    this.bar = document.createElement('div');
    this.bar.id = 'replayBar';
    this.bar.className = 'hidden';
    const btn = (html: string, tip: string, onClick: () => void) => {
      const b = document.createElement('button');
      b.className = 'rp-button';
      b.innerHTML = html;
      b.dataset.tip = tip;
      b.addEventListener('click', onClick);
      return b;
    };
    const selectButton = btn(ICONS.replaySelect, 'Pick another start bar', () => this.startSelecting());
    this.playButton = btn(ICONS.play, 'Play (Space)', () => this.togglePlay());
    const stepButton = btn(ICONS.stepForward, `Next bar (${REPLAY_STEP_KEYS})`, () => {
      this.pause();
      this.step();
    });
    this.speedSelect = document.createElement('select');
    this.speedSelect.className = 'rp-speed';
    this.speedSelect.dataset.tip = 'Speed (bars per second)';
    for (const [i, s] of REPLAY_SPEEDS.entries()) this.speedSelect.append(new Option(`${s}×`, String(i)));
    this.speedSelect.value = String(this.speedIndex);
    this.speedSelect.addEventListener('change', () => {
      this.speedIndex = Number(this.speedSelect.value);
      if (this.timer !== undefined) {
        this.pause();
        this.play();
      }
    });
    this.dateLabel = document.createElement('span');
    this.dateLabel.className = 'rp-date';
    const exitButton = btn(ICONS.close, 'Back to real time', () => this.exit());
    exitButton.classList.add('rp-exit');
    const sep = () => Object.assign(document.createElement('span'), { className: 'rp-sep' });
    this.bar.append(selectButton, sep(), this.playButton, stepButton, this.speedSelect, sep(), this.dateLabel, sep(), exitButton);
    host.wrap.append(this.bar);
    makeDraggable(this.bar, host.wrap, 'chartdesk:replayBarPos');

    // --- start-bar picker ---------------------------------------------------
    this.shadeEl = Object.assign(document.createElement('div'), { id: 'replayShade', className: 'hidden' });
    this.cursorEl = Object.assign(document.createElement('div'), { id: 'replayCursor', className: 'hidden' });
    this.hintEl = Object.assign(document.createElement('div'), {
      id: 'replayHint',
      className: 'hidden',
      textContent: 'Click the bar to start the replay from · Esc to cancel',
    });
    host.wrap.append(this.shadeEl, this.cursorEl, this.hintEl);

    // Capture phase on the wrapper: while picking, clicks never reach the chart or the drawings.
    host.wrap.addEventListener('mousemove', (e) => this.selecting && this.showPicker(e), true);
    host.wrap.addEventListener(
      'mousedown',
      (e) => {
        if (!this.selecting || e.button !== 0) return;
        if (!(e.target as HTMLElement).closest('#chart')) return;
        e.stopPropagation();
        e.preventDefault();
        const i = this.barAt(e);
        if (i !== null) this.startAt(i);
      },
      true,
    );
    host.wrap.addEventListener('mouseleave', () => this.selecting && this.hidePicker());
    window.addEventListener('keydown', (e) => this.onKey(e));
  }

  get active(): boolean {
    return this.active_;
  }

  get isSelecting(): boolean {
    return this.selecting;
  }

  get playing(): boolean {
    return this.timer !== undefined;
  }

  /** Close time of the last bar shown. */
  get time(): number {
    return this.clock;
  }

  // --- picking the start bar -------------------------------------------------

  /** Shows the picker: the next click on the chart chooses where the replay starts. */
  startSelecting(): void {
    if (this.host.cc.barCount < 2) return;
    this.pause();
    this.selecting = true;
    this.hintEl.classList.remove('hidden');
    this.host.wrap.classList.add('replay-picking');
    this.host.onChange();
  }

  cancelSelecting(): void {
    if (!this.selecting) return;
    this.selecting = false;
    this.hidePicker();
    this.hintEl.classList.add('hidden');
    this.host.wrap.classList.remove('replay-picking');
    this.host.onChange();
  }

  private barAt(e: MouseEvent): number | null {
    const chart = this.host.wrap.querySelector('#chart')!.getBoundingClientRect();
    const logical = this.host.cc.xToLogical(e.clientX - chart.left);
    if (logical === null) return null;
    return Math.max(0, Math.min(this.host.cc.barCount - 1, Math.round(logical)));
  }

  private showPicker(e: MouseEvent): void {
    const i = this.barAt(e);
    const chart = this.host.wrap.querySelector('#chart')!.getBoundingClientRect();
    const wrap = this.host.wrap.getBoundingClientRect();
    const x = i === null ? null : this.host.cc.logicalToX(i);
    if (x === null || e.clientY - chart.top > this.host.cc.paneSize().height) return this.hidePicker();
    // Line on the picked bar; the bars after it are shaded, as they will disappear.
    const left = chart.left - wrap.left + x;
    const width = this.host.cc.paneSize().width;
    this.cursorEl.style.left = `${left}px`;
    this.cursorEl.style.height = `${this.host.cc.paneSize().height}px`;
    this.shadeEl.style.left = `${left + 1}px`;
    this.shadeEl.style.width = `${Math.max(0, chart.left - wrap.left + width - left - 1)}px`;
    this.shadeEl.style.height = `${this.host.cc.paneSize().height}px`;
    this.cursorEl.classList.remove('hidden');
    this.shadeEl.classList.remove('hidden');
  }

  private hidePicker(): void {
    this.cursorEl.classList.add('hidden');
    this.shadeEl.classList.add('hidden');
  }

  /** Starts (or restarts) the replay with bar `index` as the last bar shown. */
  startAt(index: number): void {
    if (!this.active_) this.full = this.host.cc.allCandles();
    this.cancelSelecting();
    this.active_ = true;
    this.shown = Math.max(1, Math.min(this.full.length, index + 1));
    this.updateClock();
    this.host.cc.setData(this.full.slice(0, this.shown), this.host.cc.intervalSeconds, this.host.cc.barsInView());
    this.bar.classList.remove('hidden');
    this.host.onChange();
  }

  /**
   * After the chart loaded new bars (another timeframe or symbol) during a replay: keeps the
   * clock and shows only the bars that had closed by then.
   */
  resume(candles: Candle[], intervalSeconds: number): void {
    this.pause();
    this.full = candles;
    const tf = this.host.timeframe();
    let n = 0;
    while (n < candles.length && barCloseTime(candles[n].time, tf) <= this.clock) n++;
    this.shown = Math.max(1, n);
    this.host.cc.setData(this.full.slice(0, this.shown), intervalSeconds, this.host.cc.barsInView());
    this.dateLabel.textContent = this.formatClock();
    this.host.onChange();
  }

  /** Older bars were loaded at the left edge (the chart has already added them). */
  prepend(older: Candle[]): void {
    const first = this.full[0];
    const add = first ? older.filter((c) => c.time < first.time) : older;
    this.full = [...add, ...this.full];
    this.shown += add.length;
  }

  /** Whether the bars on hand reach back to the replay clock (else load older ones first). */
  covers(candles: Candle[]): boolean {
    return candles.length > 0 && barCloseTime(candles[0].time, this.host.timeframe()) <= this.clock;
  }

  // --- playing -----------------------------------------------------------------

  /** Shows the next bar. Returns false at the end of the data. */
  step(): boolean {
    if (!this.active_ || this.shown >= this.full.length) {
      this.pause();
      return false;
    }
    this.host.cc.update(this.full[this.shown]);
    this.shown++;
    this.updateClock();
    this.host.onChange();
    return true;
  }

  play(): void {
    if (!this.active_ || this.timer !== undefined) return;
    if (this.shown >= this.full.length) return;
    this.timer = setInterval(() => this.step(), 1000 / REPLAY_SPEEDS[this.speedIndex]);
    this.syncPlayButton();
  }

  pause(): void {
    if (this.timer === undefined) return;
    clearInterval(this.timer);
    this.timer = undefined;
    this.syncPlayButton();
    this.host.onChange();
  }

  togglePlay(): void {
    if (this.timer !== undefined) this.pause();
    else this.play();
  }

  /** Leaves the replay and goes back to the live chart. */
  exit(): void {
    if (!this.active_ && !this.selecting) return;
    this.pause();
    this.cancelSelecting();
    if (!this.active_) return;
    this.active_ = false;
    this.full = [];
    this.bar.classList.add('hidden');
    this.host.onChange();
    this.host.onExit();
  }

  /** At the end of the data. */
  get atEnd(): boolean {
    return this.active_ && this.shown >= this.full.length;
  }

  private syncPlayButton(): void {
    const on = this.timer !== undefined;
    this.playButton.innerHTML = on ? ICONS.pause : ICONS.play;
    this.playButton.dataset.tip = on ? 'Pause (Space)' : 'Play (Space)';
  }

  private updateClock(): void {
    const last = this.full[this.shown - 1];
    this.clock = last ? barCloseTime(last.time, this.host.timeframe()) : 0;
    this.dateLabel.textContent = this.formatClock();
  }

  private formatClock(): string {
    const last = this.full[this.shown - 1];
    if (!last) return '';
    return formatDateTime(last.time);
  }

  // --- keys --------------------------------------------------------------------

  private onKey(e: KeyboardEvent): void {
    const target = e.target as HTMLElement | null;
    if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.tagName === 'SELECT')) return;
    if (e.key === 'Escape' && this.selecting) {
      this.cancelSelecting();
      return;
    }
    if (!this.active_ || e.metaKey || e.ctrlKey || e.altKey) return;
    if (e.code === 'Space' && !e.shiftKey) {
      e.preventDefault();
      this.togglePlay();
    }
  }
}
