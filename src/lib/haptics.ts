/* -------------------------------------------------------------------------- */
/*  The small tap you feel when something registers.                         */
/*                                                                           */
/*  iOS has no Vibration API. Safari has never implemented navigator.vibrate */
/*  and calling it there does nothing at all, which is why a web app on an    */
/*  iPhone normally feels dead next to a native one.                         */
/*                                                                           */
/*  What does work is a side effect: a checkbox with the `switch` attribute   */
/*  (Safari 17.4) runs the Taptic Engine when it is toggled. The first        */
/*  version of this called .click() on a hidden one from inside the button    */
/*  handler, and on this phone it did nothing — as of iOS 26.5 only a DIRECT  */
/*  tap fires it, and script cannot.                                         */
/*                                                                           */
/*  So the switch is not hidden away and poked; it is laid over the button    */
/*  itself, transparent and the full size of it, and your finger lands on the */
/*  switch rather than on the button. iOS sees a real switch being toggled,   */
/*  because one is. The click carries on to the button underneath, so the     */
/*  action is unchanged. See HapticTick in components/HapticTick.tsx.         */
/*                                                                           */
/*  Two rules learned the hard way, both from people who tested on-device:    */
/*  the control must keep its native appearance (styling it away kills the    */
/*  haptic) and it must be clipped, or its intrinsic shape takes taps outside */
/*  the button it is covering.                                               */
/*                                                                           */
/*  Android and desktop keep the real API, which is what tap() is for.        */
/* -------------------------------------------------------------------------- */

/**
 * One tick on the platforms that have a real API for it: Android and desktop
 * Chrome, where this is a no-op if there is no motor.
 *
 * Does nothing on iOS. It cannot: script-triggered haptics were closed off in
 * iOS 26.5, which is what HapticTick exists to work around. Called from the
 * same handlers the tick covers, so the two platforms behave the same.
 */
export function tap(): void {
  try {
    navigator.vibrate?.(8);
  } catch {
    // A phone that will not buzz is not a problem worth reporting.
  }
}

/** True where a tick can only come from a real tap on a switch: WebKit. */
export function needsSwitchOverlay(): boolean {
  try {
    return typeof navigator.vibrate !== 'function';
  } catch {
    return false;
  }
}
