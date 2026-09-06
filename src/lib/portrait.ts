/* -------------------------------------------------------------------------- */
/*  Keeping the app upright on a turned phone.                                */
/*                                                                            */
/*  The manifest asks for portrait and Android honours it. iOS ignores         */
/*  manifest orientation entirely and Safari exposes no Screen Orientation     */
/*  lock to call instead, so a turned iPhone rotates the app whatever is       */
/*  declared. The app is turned back in CSS instead — see `#root` in           */
/*  index.css — which costs no re-render, so a session keeps its draft, its    */
/*  rest timer and its scroll position across the turn.                       */
/*                                                                            */
/*  This file exists for the one thing CSS cannot answer: WHICH WAY the phone  */
/*  was turned. A media query knows the viewport is landscape and nothing      */
/*  more, so a fixed quarter turn is right one way round and upside down the   */
/*  other — and both are ordinary ways to hold a phone.                       */
/* -------------------------------------------------------------------------- */

/**
 * The angle the system has already rotated the page by, as an attribute the
 * stylesheet can match on.
 *
 * The counter-rotation is simply the negative of it, which is why this reads
 * the angle rather than trying to name the two landscapes: whatever the
 * platform means by "landscape-primary", undoing its own number lands upright.
 */
export function trackScreenAngle(root: HTMLElement = document.documentElement): () => void {
  const apply = () => {
    /* `screen.orientation` is the current API; `window.orientation` is the
       deprecated one iOS carried for years. Neither is guaranteed, and an
       absent angle means an unrotated screen, which needs no correction. */
    const angle =
      window.screen?.orientation?.angle ??
      (window as unknown as { orientation?: number }).orientation ??
      0;
    // Normalised, because the deprecated API reports -90 where the current one
    // reports 270, and the stylesheet should only ever see one of them.
    root.dataset.screenAngle = String(((angle % 360) + 360) % 360);
  };

  apply();
  window.screen?.orientation?.addEventListener?.('change', apply);
  // The old event still fires on iOS, and fires on some versions where the
  // orientation object's own event does not.
  window.addEventListener('orientationchange', apply);
  window.addEventListener('resize', apply);

  return () => {
    window.screen?.orientation?.removeEventListener?.('change', apply);
    window.removeEventListener('orientationchange', apply);
    window.removeEventListener('resize', apply);
  };
}
