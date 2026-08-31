import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import {
  THEME_CHOICES,
  THEME_COLOR,
  THEME_STORAGE_KEY,
  isThemeChoice,
  resolveTheme,
} from './theme';

const CSS = readFileSync('src/index.css', 'utf8');
const INDEX_HTML = readFileSync('index.html', 'utf8');

/** Every --color-* token declared in a given block. */
function tokensIn(block: string): Map<string, string> {
  const out = new Map<string, string>();
  for (const match of block.matchAll(/(--color-[a-z0-9-]+):\s*([^;]+);/g)) {
    out.set(match[1] as string, (match[2] as string).trim());
  }
  return out;
}

/** The braced block following `marker`, matched by depth rather than indent. */
function blockAfter(marker: string): string {
  const start = CSS.indexOf(marker);
  expect(start, `missing ${marker}`).toBeGreaterThan(-1);
  const open = CSS.indexOf('{', start);
  let depth = 0;
  for (let i = open; i < CSS.length; i += 1) {
    if (CSS[i] === '{') depth += 1;
    else if (CSS[i] === '}') {
      depth -= 1;
      if (depth === 0) return CSS.slice(open + 1, i);
    }
  }
  throw new Error(`unterminated block after ${marker}`);
}

const dark = tokensIn(blockAfter('@theme {'));
const light = tokensIn(blockAfter(":root[data-theme='light']"));

describe('theme choice', () => {
  it('offers system, light and dark, and defaults to system', () => {
    expect(THEME_CHOICES).toEqual(['system', 'light', 'dark']);
    expect(isThemeChoice('light')).toBe(true);
    expect(isThemeChoice('sepia')).toBe(false);
    expect(isThemeChoice(null)).toBe(false);
  });

  it('resolves an explicit choice without consulting the system', () => {
    expect(resolveTheme('light')).toBe('light');
    expect(resolveTheme('dark')).toBe('dark');
  });
});

describe('palette parity', () => {
  it('keeps the §4 dark tokens exactly as specified', () => {
    expect(dark.get('--color-bg')).toBe('#0a0a0a');
    expect(dark.get('--color-surface')).toBe('#171717');
    expect(dark.get('--color-surface-2')).toBe('#242424');
    expect(dark.get('--color-border')).toBe('#2e2e2e');
    expect(dark.get('--color-text')).toBe('#ffffff');
    expect(dark.get('--color-text-dim')).toBe('#8e8e93');
    expect(dark.get('--color-text-faint')).toBe('#5a5a5e');
    expect(dark.get('--color-volume')).toBe('#ff8a5b');
    expect(dark.get('--color-muscle')).toBe('#2e6fe8');
    expect(dark.get('--color-strength')).toBe('#4fd1e0');
    expect(dark.get('--color-bodyweight')).toBe('#a78bfa');
    expect(dark.get('--color-cta')).toBe('#ffffff');
    expect(dark.get('--color-rir-1')).toBe('#8e2b2b');
    expect(dark.get('--color-rir-2')).toBe('#7a5b12');
    expect(dark.get('--color-rir-3')).toBe('#e8a020');
  });

  it('overrides every colour token in light — a missed one leaks dark', () => {
    const missing = [...dark.keys()].filter((token) => !light.has(token));
    expect(missing).toEqual([]);
  });

  it('inverts the neutral ramp: grey page, white cards', () => {
    expect(light.get('--color-bg')).toBe('#f2f2f5');
    expect(light.get('--color-surface')).toBe('#ffffff');
    // Elevation is still lightness, just the other way up.
    expect(luminance(light.get('--color-surface') as string)).toBeGreaterThan(
      luminance(light.get('--color-bg') as string),
    );
    expect(luminance(dark.get('--color-surface') as string)).toBeGreaterThan(
      luminance(dark.get('--color-bg') as string),
    );
  });

  it('inverts --cta so bg-cta + text-bg reads correctly in both themes', () => {
    expect(contrast(light.get('--color-cta') as string, light.get('--color-bg') as string))
      .toBeGreaterThan(4.5);
    expect(contrast(dark.get('--color-cta') as string, dark.get('--color-bg') as string))
      .toBeGreaterThan(4.5);
  });

  it('darkens the text accents for light so 12px labels stay readable', () => {
    for (const token of [
      '--color-volume',
      '--color-muscle',
      '--color-strength',
      '--color-bodyweight',
      '--color-warn',
    ]) {
      const onWhite = contrast(light.get(token) as string, light.get('--color-surface') as string);
      expect(onWhite, `${token} on a light card`).toBeGreaterThanOrEqual(4.5);
    }
  });

  it('keeps the RIR swatches apart enough to read as a scale', () => {
    for (const theme of [dark, light]) {
      // Each step is visibly lighter than the one before it: dark red, dark
      // amber, bright amber. Darkening them all to text contrast collapsed the
      // scale into three near-identical browns, which is why --warn is split
      // out for the text usages.
      const l1 = luminance(theme.get('--color-rir-1') as string);
      const l2 = luminance(theme.get('--color-rir-2') as string);
      const l3 = luminance(theme.get('--color-rir-3') as string);
      expect(l2).toBeGreaterThan(l1 * 1.5);
      expect(l3).toBeGreaterThan(l2 * 1.5);
    }
  });

  it('gives the light swatches real contrast against a white card', () => {
    for (const token of ['--color-rir-1', '--color-rir-2', '--color-rir-3']) {
      const onCard = contrast(light.get(token) as string, light.get('--color-surface') as string);
      expect(onCard, token).toBeGreaterThanOrEqual(3);
    }
  });

  it("documents that §4's dark rir-1 is a low-contrast swatch by design", () => {
    // #8e2b2b on #171717 is 2.2:1 — under the 3:1 graphics minimum. It is the
    // spec's value so it stands, and the RIR badge is never colour-only: every
    // one prints its number beside the dot, which is what carries the meaning.
    const onCard = contrast(dark.get('--color-rir-1') as string, dark.get('--color-surface') as string);
    expect(onCard).toBeLessThan(3);
    expect(readFileSync('src/components/SetRow.tsx', 'utf8')).toContain('{caption}');
  });

  it('pairs the danger fill with a readable text colour in both themes', () => {
    expect(
      contrast(dark.get('--color-danger-text') as string, dark.get('--color-danger') as string),
    ).toBeGreaterThan(4.5);
    expect(
      contrast(light.get('--color-danger-text') as string, light.get('--color-danger') as string),
    ).toBeGreaterThan(4.5);
  });

  it('keeps body text well clear of the minimum in both themes', () => {
    expect(contrast(dark.get('--color-text') as string, dark.get('--color-surface') as string))
      .toBeGreaterThan(7);
    expect(contrast(light.get('--color-text') as string, light.get('--color-surface') as string))
      .toBeGreaterThan(7);
  });
});

describe('no flash of the wrong theme', () => {
  it('applies the stored theme inline, before the bundle is requested', () => {
    const script = INDEX_HTML.indexOf(THEME_STORAGE_KEY);
    const bundle = INDEX_HTML.indexOf('/src/main.tsx');
    expect(script).toBeGreaterThan(-1);
    expect(script).toBeLessThan(bundle);
  });

  it('ships a theme-color meta for the inline script to update', () => {
    expect(INDEX_HTML).toContain('name="theme-color"');
    expect(INDEX_HTML).toContain(THEME_COLOR.light);
  });

  it('leaves dark as the attribute-free default', () => {
    expect(CSS).not.toContain("data-theme='dark'");
  });
});

/* --- WCAG relative luminance and contrast ratio --------------------------- */

function luminance(hex: string): number {
  const value = hex.replace('#', '');
  const channel = (pair: string) => {
    const c = parseInt(pair, 16) / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  };
  const r = channel(value.slice(0, 2));
  const g = channel(value.slice(2, 4));
  const b = channel(value.slice(4, 6));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function contrast(a: string, b: string): number {
  const la = luminance(a);
  const lb = luminance(b);
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
}
