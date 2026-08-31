import { useEffect, useState } from 'react';
import {
  applyTheme,
  readThemeChoice,
  resolveTheme,
  watchSystemTheme,
  writeThemeChoice,
  type ResolvedTheme,
  type ThemeChoice,
} from './theme';

/**
 * Keeps the live theme in step with the stored choice, and follows the OS while
 * the choice is 'system'. The pre-paint script in index.html has already
 * applied the right theme by the time this mounts; this only handles changes.
 */
export function useTheme(): [ThemeChoice, ResolvedTheme, (next: ThemeChoice) => void] {
  const [choice, setChoice] = useState<ThemeChoice>(readThemeChoice);
  const [resolved, setResolved] = useState<ResolvedTheme>(() => resolveTheme(readThemeChoice()));

  useEffect(() => {
    if (choice !== 'system') return;
    return watchSystemTheme(() => setResolved(applyTheme('system')));
  }, [choice]);

  const set = (next: ThemeChoice) => {
    setChoice(next);
    setResolved(writeThemeChoice(next));
  };

  return [choice, resolved, set];
}
