import { useEffect, useRef, useState } from 'react';

/* -------------------------------------------------------------------------- */
/*  Rest timer state — spec §4 puts the countdown in the session header.       */
/*                                                                            */
/*  Timing is derived from a wall-clock deadline rather than decremented on a  */
/*  tick, so it stays honest when iOS throttles timers in a backgrounded tab   */
/*  or the screen locks between sets.                                         */
/* -------------------------------------------------------------------------- */

export const REST_PRESETS = [60, 90, 120, 180] as const;

interface RestState {
  durationSec: number;
  deadline: number | undefined;
}

export interface RestTimer {
  durationSec: number;
  remainingSec: number;
  running: boolean;
  elapsedFraction: number;
  start: (sec?: number) => void;
  stop: () => void;
  setDuration: (sec: number) => void;
}

export function useRestTimer(defaultSec = 120): RestTimer {
  const [state, setState] = useState<RestState>({ durationSec: defaultSec, deadline: undefined });
  const [now, setNow] = useState(() => Date.now());
  const timeout = useRef<number | undefined>(undefined);

  useEffect(() => {
    if (state.deadline === undefined) return;
    const tick = () => {
      setNow(Date.now());
      timeout.current = window.setTimeout(tick, 250);
    };
    tick();
    return () => window.clearTimeout(timeout.current);
  }, [state.deadline]);

  const remainingMs = state.deadline === undefined ? 0 : Math.max(0, state.deadline - now);
  const running = state.deadline !== undefined && remainingMs > 0;

  return {
    durationSec: state.durationSec,
    remainingSec: remainingMs / 1000,
    running,
    elapsedFraction: running ? 1 - remainingMs / (state.durationSec * 1000) : 1,
    start: (sec = state.durationSec) =>
      setState({ durationSec: sec, deadline: Date.now() + sec * 1000 }),
    stop: () => setState((prev) => ({ ...prev, deadline: undefined })),
    setDuration: (sec: number) =>
      setState((prev) => ({
        durationSec: sec,
        deadline: prev.deadline === undefined ? undefined : Date.now() + sec * 1000,
      })),
  };
}
