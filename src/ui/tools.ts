import { IS_MAC } from '../platform';
import type { ToolId } from '../drawings/model';

const svg = (body: string) =>
  `<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round">${body}</svg>`;

export const ICONS = {
  cursor: svg('<path d="M5 3l14 8-6 1.5L10 19z"/>'),
  trend: svg('<path d="M4 19L20 5"/><circle cx="4" cy="19" r="1.6"/><circle cx="20" cy="5" r="1.6"/>'),
  ray: svg('<path d="M4 19L21 4"/><circle cx="4" cy="19" r="1.6"/><circle cx="12" cy="12" r="1.6"/>'),
  extended: svg('<path d="M2 21L22 3"/><circle cx="8" cy="15.6" r="1.6"/><circle cx="16" cy="8.4" r="1.6"/>'),
  arrow: svg('<path d="M4 20L18 6"/><path d="M11 5h8v8"/>'),
  hline: svg('<path d="M3 12h18"/><circle cx="12" cy="12" r="1.6"/>'),
  hray: svg('<path d="M7 12h14"/><circle cx="5.4" cy="12" r="1.6"/>'),
  cross: svg('<path d="M3 12h18M12 3v18"/><circle cx="12" cy="12" r="1.6"/>'),
  channel: svg('<path d="M3 15L16 4M8 20L21 9"/><path d="M5.5 17.5l13-11" stroke-dasharray="2 2.2"/>'),
  pricerange: svg('<path d="M4 4h16M4 20h16M12 7v10M9 9.5L12 6.5l3 3M9 14.5l3 3 3-3"/>'),
  daterange: svg('<path d="M4 4v16M20 4v16M7 12h10M9.5 9L6.5 12l3 3M14.5 9l3 3-3 3"/>'),
  brush: svg('<path d="M3 17c3-6 5-6 7-2s4 4 6-2 3-5 5-4"/>'),
  more: '<svg viewBox="0 0 6 10" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M1.5 1.5L4.5 5l-3 3.5"/></svg>',
  vline: svg('<path d="M12 3v18"/><circle cx="12" cy="12" r="1.6"/>'),
  rect: svg('<rect x="4" y="6" width="16" height="12" rx="1"/>'),
  fib: svg('<path d="M3 5h18M3 9.5h18M3 13h18M3 19h18"/><path d="M5 19L19 5" stroke-dasharray="2 2"/>'),
  long: svg('<rect x="5" y="4" width="14" height="8" fill="currentColor" fill-opacity=".25"/><rect x="5" y="12" width="14" height="6"/><path d="M12 10V6m-2 2l2-2 2 2"/>'),
  short: svg('<rect x="5" y="6" width="14" height="6"/><rect x="5" y="12" width="14" height="8" fill="currentColor" fill-opacity=".25"/><path d="M12 14v4m-2-2l2 2 2-2"/>'),
  text: svg('<path d="M5 6V4h14v2M12 4v16M9 20h6"/>'),
  measure: svg('<path d="M3 17L17 3l4 4L7 21z"/><path d="M7 13l2 2M10 10l2 2M13 7l2 2"/>'),
  magnet: svg('<path d="M6 4v8a6 6 0 0012 0V4"/><path d="M6 8h4M14 8h4"/>'),
  trash: svg('<path d="M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13"/>'),
  trashAll: svg('<path d="M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13M10 11v5M14 11v5"/>'),
  undo: svg('<path d="M9 14L4 9l5-5"/><path d="M4 9h11a5 5 0 010 10h-3"/>'),
  redo: svg('<path d="M15 14l5-5-5-5"/><path d="M20 9H9a5 5 0 000 10h3"/>'),
  info: svg('<circle cx="12" cy="12" r="9"/><path d="M12 11v5M12 8v.01"/>'),
  settings: svg('<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 00.3 1.8l.1.1a2 2 0 11-2.8 2.8l-.1-.1a1.7 1.7 0 00-1.8-.3 1.7 1.7 0 00-1 1.5V21a2 2 0 11-4 0v-.1a1.7 1.7 0 00-1.1-1.5 1.7 1.7 0 00-1.8.3l-.1.1a2 2 0 11-2.8-2.8l.1-.1a1.7 1.7 0 00.3-1.8 1.7 1.7 0 00-1.5-1H3a2 2 0 110-4h.1a1.7 1.7 0 001.5-1.1 1.7 1.7 0 00-.3-1.8l-.1-.1a2 2 0 112.8-2.8l.1.1a1.7 1.7 0 001.8.3H9a1.7 1.7 0 001-1.5V3a2 2 0 114 0v.1a1.7 1.7 0 001 1.5 1.7 1.7 0 001.8-.3l.1-.1a2 2 0 112.8 2.8l-.1.1a1.7 1.7 0 00-.3 1.8V9a1.7 1.7 0 001.5 1H21a2 2 0 110 4h-.1a1.7 1.7 0 00-1.5 1z"/>'),
  bell: svg('<path d="M6 16V11a6 6 0 0112 0v5l1.5 2h-15z"/><path d="M10 20a2 2 0 004 0"/>'),
  lock: svg('<rect x="5" y="11" width="14" height="9" rx="2"/><path d="M8 11V8a4 4 0 018 0v3"/>'),
  unlock: svg('<rect x="5" y="11" width="14" height="9" rx="2"/><path d="M8 11V8a4 4 0 017.5-2"/>'),
  eye: svg('<path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12z"/><circle cx="12" cy="12" r="3"/>'),
  eyeOff: svg('<path d="M3 3l18 18M10.6 5.1A10 10 0 0112 5c6.5 0 10 7 10 7a17 17 0 01-3.2 4M6.6 6.6A17 17 0 002 12s3.5 7 10 7a10 10 0 004.4-1"/><path d="M9.9 9.9a3 3 0 004.2 4.2"/>'),
  layers: svg('<path d="M12 4l9 5-9 5-9-5z"/><path d="M3 14l9 5 9-5"/>'),
  list: svg('<path d="M8 6h13M8 12h13M8 18h13"/><circle cx="4" cy="6" r="1"/><circle cx="4" cy="12" r="1"/><circle cx="4" cy="18" r="1"/>'),
  camera: svg('<path d="M4 8h3l2-3h6l2 3h3v11H4z"/><circle cx="12" cy="13" r="3.5"/>'),
  toLatest: svg('<path d="M6 7l5 5-5 5M13 7l5 5-5 5"/>'),
};

export interface ToolDef {
  id: ToolId;
  title: string;
  /** Alt/Option + this key selects the tool (KeyboardEvent.code). */
  key?: string;
  keyLabel?: string;
}

/** Every tool, with its name and Alt/Option shortcut. */
export const TOOLS: readonly ToolDef[] = [
  { id: 'cursor', title: 'Cursor', keyLabel: 'Esc' },
  { id: 'trend', title: 'Trend line', key: 'KeyT' },
  { id: 'ray', title: 'Ray' },
  { id: 'extended', title: 'Extended line' },
  { id: 'arrow', title: 'Arrow' },
  { id: 'hline', title: 'Horizontal line', key: 'KeyH' },
  { id: 'hray', title: 'Horizontal ray', key: 'KeyJ' },
  { id: 'vline', title: 'Vertical line', key: 'KeyV' },
  { id: 'cross', title: 'Cross line', key: 'KeyC' },
  { id: 'fib', title: 'Fibonacci retracement', key: 'KeyF' },
  { id: 'channel', title: 'Parallel channel' },
  { id: 'rect', title: 'Rectangle', key: 'KeyR' },
  { id: 'brush', title: 'Brush' },
  { id: 'long', title: 'Long position', key: 'KeyL' },
  { id: 'short', title: 'Short position', key: 'KeyS' },
  { id: 'pricerange', title: 'Price range' },
  { id: 'daterange', title: 'Date range' },
  { id: 'measure', title: 'Measure', key: 'KeyM', keyLabel: 'Shift + click' },
  { id: 'text', title: 'Text', key: 'KeyN' },
];

export function toolDef(id: ToolId): ToolDef {
  return TOOLS.find((t) => t.id === id)!;
}

/**
 * The left toolbar: one button per group, like TradingView. A group's button shows the tool
 * used last from it; the small corner arrow opens the others.
 */
export const TOOL_GROUPS: readonly (readonly ToolId[])[] = [
  ['cursor'],
  ['trend', 'ray', 'extended', 'arrow', 'hline', 'hray', 'vline', 'cross'],
  ['fib', 'channel'],
  ['rect', 'brush'],
  ['long', 'short', 'pricerange', 'daterange', 'measure'],
  ['text'],
];

export const ALT = IS_MAC ? '⌥' : 'Alt+';
export const MOD = IS_MAC ? '⌘' : 'Ctrl+';
/** The key to hold for a temporary magnet. */
export const HOLD = IS_MAC ? '⌘' : 'Ctrl';

export function toolTitle(t: ToolDef): string {
  const keys: string[] = [];
  if (t.key) keys.push(`${ALT}${t.key.replace('Key', '')}`);
  if (t.keyLabel) keys.push(t.keyLabel);
  return keys.length ? `${t.title} (${keys.join(', ')})` : t.title;
}
