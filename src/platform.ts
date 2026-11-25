/** True on macOS (and iOS), where ⌘ plays the role Ctrl plays elsewhere. */
export const IS_MAC = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform);

/** Whether the platform's main modifier (⌘ on Mac, Ctrl elsewhere) is held during this event. */
export function modifierHeld(e: KeyboardEvent | MouseEvent): boolean {
  return IS_MAC ? e.metaKey : e.ctrlKey;
}
