import { useCallback } from 'react';
import { hapticsEnabled } from '../lib/haptics';

/* -------------------------------------------------------------------------- */
/*  A real switch, laid invisibly over a button, so iOS ticks when you tap it. */
/*                                                                           */
/*  Drop it inside any button that is `relative`. Your finger lands on this   */
/*  rather than on the button; iOS runs the Taptic Engine because a genuine   */
/*  switch genuinely moved; the click carries on to the button underneath, so */
/*  nothing about the action changes.                                        */
/*                                                                           */
/*  Three details are load-bearing, all of them learned from people who       */
/*  tested on an actual phone:                                               */
/*                                                                           */
/*   - It keeps its native appearance. Styling the control away — the         */
/*     reflex — stops the haptic; only opacity may hide it.                   */
/*   - It is clipped to the button. The switch has an intrinsic shape of its  */
/*     own, and without this it takes taps from outside the button it covers. */
/*   - It is full size, or the parts of the button it does not cover are      */
/*     dead to the tick and alive to the button, which feels broken rather    */
/*     than plain.                                                           */
/*                                                                           */
/*  WHERE THIS BELONGS, which is not "every button".                         */
/*                                                                           */
/*  A tick means something happened that you would care about: a set went    */
/*  down, a workout started, saved or was thrown away, a generation was      */
/*  asked for. Roughly a dozen places in the app.                            */
/*                                                                           */
/*  It does not belong on navigation, on opening or closing a sheet, on the  */
/*  keypad, or on the +/- steppers. Three reasons, in order of how much they */
/*  matter:                                                                  */
/*                                                                           */
/*   1. If everything ticks, nothing does. The tick is a signal that this    */
/*      one landed; spend it on the taps where being sure is worth something */
/*      — mid-set, looking at the bar rather than the screen.                */
/*   2. Repeated taps become a rattle. Holding a stepper or typing 60 on the */
/*      keypad would buzz a dozen times in two seconds.                      */
/*   3. Every one of these is an invisible interactive control laid over a   */
/*      button. On small or crowded targets that is a hit-testing risk for   */
/*      no gain, and it is a hack Apple has already narrowed twice — the     */
/*      fewer places it lives, the less there is to repair next time.        */
/*                                                                           *//*  Nested inside the button on purpose: that is what keeps the click on its  */
/*  normal path instead of re-dispatching one, and re-dispatched clicks are   */
/*  how this kind of thing starts double-firing. It is aria-hidden and not    */
/*  focusable, so nothing reading the page ever meets it.                     */
/* -------------------------------------------------------------------------- */

export function HapticTick({ radius = 999, force = false }: { radius?: number; force?: boolean }) {
  /*
   * `switch` is not a React prop, and it has to be a real attribute rather
   * than a class for WebKit to treat this as a switch at all.
   */
  const attach = useCallback((node: HTMLInputElement | null) => {
    node?.setAttribute('switch', '');
  }, []);

  /* Read at render rather than subscribed: the element IS the feature, so
     turning it off has to remove it, and the screens carrying it mount after
     Settings closes. */
  if (!force && !hapticsEnabled()) return null;

  return (
    <input
      ref={attach}
      type="checkbox"
      aria-hidden="true"
      tabIndex={-1}
      className="absolute inset-0 size-full opacity-0"
      style={{ clipPath: `inset(0 round ${radius}px)` }}
    />
  );
}
