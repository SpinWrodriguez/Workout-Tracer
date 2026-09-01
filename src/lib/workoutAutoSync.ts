import { db } from '../db/db';
import { isSuspended, markDirty } from './workoutSync';

/* -------------------------------------------------------------------------- */
/*  Marking the device dirty, and pushing shortly after.                      */
/*                                                                            */
/*  Change hooks rather than a call at every mutation site: there are a dozen  */
/*  places that write, and one forgotten call is a session that silently never */
/*  reaches the cloud.                                                        */
/* -------------------------------------------------------------------------- */

const DEBOUNCE_MS = 2000;

let timer: number | undefined;
let installed = false;

/** Tables whose contents belong to the account rather than the build. */
const SYNCED = () => [db.block, db.blockExercise, db.session, db.setLog, db.settings, db.golfDay];

export function startWorkoutAutoSync(push: () => void): void {
  if (installed) return;
  installed = true;

  const changed = () => {
    if (isSuspended()) return;
    markDirty();
    if (timer !== undefined) window.clearTimeout(timer);
    timer = window.setTimeout(() => {
      timer = undefined;
      push();
    }, DEBOUNCE_MS);
  };

  for (const table of SYNCED()) {
    table.hook('creating', changed);
    table.hook('updating', changed);
    table.hook('deleting', changed);
  }

  // A pending push should not be lost to a backgrounded tab on a phone.
  window.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden' && timer !== undefined) {
      window.clearTimeout(timer);
      timer = undefined;
      push();
    }
  });
}
