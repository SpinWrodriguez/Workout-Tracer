import { useEffect, useRef, useState } from 'react';

/* -------------------------------------------------------------------------- */
/*  Rest timer state — spec §4 puts the countdown in the session header.       */
/*                                                                            */
/*  Timing is derived from a wall-clock deadline rather than decremented on a  */
/*  tick, so it stays honest when iOS throttles timers in a backgrounded tab   */
/*  or the screen locks between sets.                                         */
/*                                                                            */
/*  The duration comes from the exercise. Every exercise in the library        */
/*  carries a restSeconds — 30 for a band walk, 180 for a heavy deadlift —     */
/*  and the timer used to ignore all of it and count 120 down for everything,  */
/*  so a curl rested for two minutes and a triple got the same as a warm-up.   */
/*  A tapped preset still wins, but only while you are on that exercise:       */
/*  moving on drops it, because it was a choice about that lift and not a      */
/*  setting.                                                                   */
/* -------------------------------------------------------------------------- */

export const REST_PRESETS = [60, 90, 120, 180] as const;

/**
 * The chips to offer for an exercise: its own rest, plus the nearest presets.
 * Its own first, so the number the timer is actually counting is always one of
 * the buttons — and always four of them, because five did not fit the row.
 */
export function restChoices(restSeconds: number | undefined, count = 4): number[] {
  if (!restSeconds) return [...REST_PRESETS];
  const others = REST_PRESETS.filter((sec) => sec !== restSeconds)
    .sort((a, b) => Math.abs(a - restSeconds) - Math.abs(b - restSeconds))
    .slice(0, count - 1);
  return [restSeconds, ...others].sort((a, b) => a - b);
}

interface RestState {
  /** A duration the lifter tapped, which beats the exercise's own. */
  chosen?: number;
  /** What the running countdown was started with, so the bar cannot shift. */
  startedWith?: number;
  deadline?: number;
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

/**
 * @param defaultSec the rest the exercise being logged asks for. Changing it —
 * moving to another exercise — drops a tapped override, so the timer follows
 * what you are lifting rather than the last button you pressed.
 */
export function useRestTimer(defaultSec = 120): RestTimer {
  const [state, setState] = useState<RestState>({});
  const [now, setNow] = useState(() => Date.now());
  const timeout = useRef<number | undefined>(undefined);

  /* Adjusted during render rather than in an effect, which is React's own
     answer to "reset some state when a prop changes" and avoids a second
     render pass. Same pattern as the day card's name field. */
  const [lastDefault, setLastDefault] = useState(defaultSec);
  if (lastDefault !== defaultSec) {
    setLastDefault(defaultSec);
    setState((prev) => ({ ...prev, chosen: undefined }));
  }

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
  /* Running: what it was started with, so a preset tapped mid-rest cannot
     rewrite history. Idle: what the next set will get. */
  const durationSec = running
    ? (state.startedWith ?? defaultSec)
    : (state.chosen ?? defaultSec);

  return {
    durationSec,
    remainingSec: remainingMs / 1000,
    running,
    elapsedFraction: running ? 1 - remainingMs / (durationSec * 1000) : 1,
    start: (sec = durationSec) =>
      setState((prev) => ({ ...prev, startedWith: sec, deadline: Date.now() + sec * 1000 })),
    stop: () => setState((prev) => ({ ...prev, deadline: undefined })),
    setDuration: (sec: number) =>
      setState((prev) => ({
        chosen: sec,
        startedWith: prev.deadline === undefined ? prev.startedWith : sec,
        deadline: prev.deadline === undefined ? undefined : Date.now() + sec * 1000,
      })),
  };
}
