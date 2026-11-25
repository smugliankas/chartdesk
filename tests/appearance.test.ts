import { describe, expect, it } from 'vitest';
import { THEMES, contrastText, labelTextColor, readable, withAlpha } from '../src/chart/appearance';

describe('colour helpers', () => {
  it('turns a hex colour into rgba', () => {
    expect(withAlpha('#ff8000', 0.5)).toBe('rgba(255, 128, 0, 0.5)');
    expect(withAlpha('red', 0.5)).toBe('red');
  });

  it('replaces a colour that would be invisible on the background', () => {
    expect(readable('#ffffff', '#ffffff', '#000000')).toBe('#000000');
    expect(readable('#ffffff', '#000000', '#000000')).toBe('#ffffff');
  });

  it('picks dark text on light backgrounds and light text on dark ones', () => {
    expect(contrastText('#ffffff')).toBe(THEMES.light.text);
    expect(contrastText('#0c0c0c')).toBe(THEMES.dark.text);
  });

  it('uses white text on price labels unless the label is light', () => {
    expect(labelTextColor('#26a69a')).toBe('#ffffff');
    expect(labelTextColor('#ef5350')).toBe('#ffffff');
    expect(labelTextColor('#ffeb3b')).toBe(THEMES.light.text);
  });
});
