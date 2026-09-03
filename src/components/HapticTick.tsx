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
/*  Nested inside the button on purpose: that is what keeps the click on its  */
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
