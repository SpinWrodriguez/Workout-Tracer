/* -------------------------------------------------------------------------- */
/*  The small tap you feel when something registers.                         */
/*                                                                           */
/*  iOS has no Vibration API. Safari has never implemented navigator.vibrate */
/*  and calling it there does nothing at all, which is why a web app on an    */
/*  iPhone normally feels dead next to a native one.                         */
/*                                                                           */
/*  What does work is a side effect: a checkbox with the `switch` attribute   */
/*  (Safari 17.4) runs the Taptic Engine when it is toggled. So there is a    */
/*  hidden switch on the page and toggling it is the tap. Undocumented and    */
/*  therefore not promised: Apple narrowed it in iOS 26.5, where the first    */
/*  tick still fires and patterns of several ticks no longer do. One tick is  */
/*  all this asks for.                                                        */
/*                                                                           */
/*  The rule that decides the whole shape of this: it only fires inside a     */
/*  real user gesture. Call it synchronously from the click or pointer        */
/*  handler — not after an await, not from a timer, not when a rest timer     */
/*  ends. A phone in a pocket cannot be buzzed by this and should not be.     */
/* -------------------------------------------------------------------------- */

const PREF_KEY = 'workout-haptics';

/** Device-local, like the theme: it describes this phone, not the training. */
export function hapticsEnabled(): boolean {
  try {
    return localStorage.getItem(PREF_KEY) !== 'off';
  } catch {
    return true;
  }
}

export function setHapticsEnabled(on: boolean): void {
  try {
    if (on) localStorage.removeItem(PREF_KEY);
    else localStorage.setItem(PREF_KEY, 'off');
  } catch {
    // Blocked storage costs a preference, never a rep.
  }
}

let element: HTMLInputElement | undefined;

/**
 * The hidden switch, made once and left in the document.
 *
 * Not `display: none`: an element with no box is not something iOS considers
 * toggled, and the whole trick is that it thinks a real switch moved.
 */
function taptic(): HTMLInputElement | undefined {
  if (element?.isConnected) return element;
  if (typeof document === 'undefined') return undefined;
  const input = document.createElement('input');
  input.type = 'checkbox';
  input.setAttribute('switch', '');
  input.setAttribute('aria-hidden', 'true');
  input.tabIndex = -1;
  input.style.cssText =
    'position:fixed;top:0;left:0;width:1px;height:1px;opacity:0;pointer-events:none;';
  document.body.appendChild(input);
  element = input;
  return input;
}

/**
 * One tick, if this device can and the lifter wants it. Never throws and never
 * blocks: nothing in a set log should depend on a vibration motor.
 *
 * MUST be called synchronously inside the event handler for the tap it belongs
 * to. Anywhere else it is silently nothing on iOS.
 */
export function tap(): void {
  if (!hapticsEnabled()) return;
  try {
    /* Android and desktop Chrome have the real API and it is a no-op where
       there is no motor, so it is safe to prefer it. */
    const vibrate = navigator.vibrate?.bind(navigator);
    if (vibrate) {
      vibrate(8);
      return;
    }
    taptic()?.click();
  } catch {
    // A phone that will not buzz is not a problem worth reporting.
  }
}

/** For the Settings row, which needs to fire even while switching it back on. */
export function testTap(): void {
  try {
    const vibrate = navigator.vibrate?.bind(navigator);
    if (vibrate) {
      vibrate(8);
      return;
    }
    taptic()?.click();
  } catch {
    // Same again: silence is the failure mode.
  }
}
