/* -------------------------------------------------------------------------- */
/*  Theme selection.                                                          */
/*                                                                            */
/*  Dark is the spec's theme (§4) and the default; light is an alternate       */
/*  palette over the same tokens. Stored in localStorage rather than the       */
/*  shared Dexie database on purpose: it is a per-device display preference,   */
/*  not data, and it has to be readable synchronously before first paint or    */
/*  the app flashes the wrong theme on every launch.                          */
/* -------------------------------------------------------------------------- */

export const THEME_STORAGE_KEY = 'workout-theme';

export const THEME_CHOICES = ['system', 'light', 'dark'] as const;
export type ThemeChoice = (typeof THEME_CHOICES)[number];
export type ResolvedTheme = 'light' | 'dark';

/** Status-bar colour per theme, matching --color-bg. */
export const THEME_COLOR: Record<ResolvedTheme, string> = {
  dark: '#0A0A0A',
  light: '#F2F2F5',
};

export function isThemeChoice(value: unknown): value is ThemeChoice {
  return typeof value === 'string' && (THEME_CHOICES as readonly string[]).includes(value);
}

export function readThemeChoice(): ThemeChoice {
  try {
    const stored = localStorage.getItem(THEME_STORAGE_KEY);
    return isThemeChoice(stored) ? stored : 'system';
  } catch {
    // Private mode or blocked storage. The default is still correct.
    return 'system';
  }
}

export function systemTheme(): ResolvedTheme {
  return typeof window !== 'undefined' &&
    window.matchMedia?.('(prefers-color-scheme: light)').matches
    ? 'light'
    : 'dark';
}

export function resolveTheme(choice: ThemeChoice): ResolvedTheme {
  return choice === 'system' ? systemTheme() : choice;
}

/**
 * Sets `data-theme` on the root element and keeps the status-bar meta in step.
 * Dark carries no attribute, so the default palette applies with no override.
 */
export function applyTheme(choice: ThemeChoice): ResolvedTheme {
  const resolved = resolveTheme(choice);
  const root = document.documentElement;
  if (resolved === 'light') root.setAttribute('data-theme', 'light');
  else root.removeAttribute('data-theme');

  document
    .querySelector('meta[name="theme-color"]')
    ?.setAttribute('content', THEME_COLOR[resolved]);

  return resolved;
}

export function writeThemeChoice(choice: ThemeChoice): ResolvedTheme {
  try {
    localStorage.setItem(THEME_STORAGE_KEY, choice);
  } catch {
    // Not fatal — the choice still applies for this session.
  }
  return applyTheme(choice);
}

/** Calls back when the OS flips. Only worth listening to while on 'system'. */
export function watchSystemTheme(onChange: () => void): () => void {
  const query = window.matchMedia?.('(prefers-color-scheme: light)');
  if (!query) return () => {};
  query.addEventListener('change', onChange);
  return () => query.removeEventListener('change', onChange);
}
