/* -------------------------------------------------------------------------- */
/*  Portrait only, on a phone.                                                */
/*                                                                            */
/*  The manifest asks for portrait and Android honours it. iOS ignores         */
/*  manifest orientation entirely, and Safari exposes no Screen Orientation    */
/*  lock to call instead — `screen.orientation.lock()` is simply not there —   */
/*  so a turned iPhone rotates the app whatever the manifest says. Covering    */
/*  the app and asking for it back upright is the only thing that holds.      */
/*                                                                            */
/*  Whether it shows is decided entirely in CSS, by `.portrait-only`, so this  */
/*  never re-renders on rotation and nothing unmounts: the session underneath  */
/*  keeps its draft, its timer and its scroll position while the phone is      */
/*  sideways. Rendered outside the router so it covers every screen, the       */
/*  in-progress workout and the loading state included.                       */
/* -------------------------------------------------------------------------- */

export function PortraitOnly() {
  return (
    <div
      className="portrait-only fixed inset-0 z-[100] flex-col items-center justify-center gap-3 bg-bg px-8 text-center"
      role="alertdialog"
      aria-label="Turn your phone upright"
    >
      <svg viewBox="0 0 24 24" className="size-9 text-text-dim" fill="none" aria-hidden="true">
        <rect x="7" y="2" width="10" height="20" rx="2.5" stroke="currentColor" strokeWidth="1.6" />
        <path d="M11 19h2" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
        <path
          d="M3.5 9.5A9 9 0 0 1 6 5.2M20.5 14.5A9 9 0 0 1 18 18.8"
          stroke="currentColor"
          strokeWidth="1.6"
          strokeLinecap="round"
        />
      </svg>
      <p className="screen-title text-[20px]">Turn your phone upright</p>
      <p className="text-[13px] font-medium text-text-dim">
        Workout Tracer is built for one hand in portrait. Nothing is lost — your session is
        still here.
      </p>
    </div>
  );
}
