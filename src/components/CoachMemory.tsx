import { useLiveQuery } from 'dexie-react-hooks';

import { WEEKDAY_LABEL, weekdayOf } from '../lib/golf';
import { friendlyDate } from '../lib/format';
import { deleteCoachMemory, readCoachMemory } from '../db/settings';

import { Card, Label } from './Layout';

/* -------------------------------------------------------------------------- */
/*  What the coach remembers, where the lifter can read it.                   */
/*                                                                            */
/*  Memory the owner cannot inspect is not memory, it is surveillance. Every   */
/*  note the coach saves — always at the lifter's own request, in the chat —   */
/*  is listed here with the date it was saved, and any of them can be          */
/*  deleted. Deleting one is final and silent: the coach simply never sees it  */
/*  again, and nothing else in the app reads this list at all.                */
/* -------------------------------------------------------------------------- */

export function CoachMemory() {
  const notes = useLiveQuery(readCoachMemory, []);

  return (
    <Card
      title="Coach memory"
      collapsible
      summary={
        notes === undefined
          ? '--'
          : notes.length === 0
            ? 'nothing saved yet'
            : `${notes.length} ${notes.length === 1 ? 'note' : 'notes'}`
      }
    >
      <p className="text-[13px] text-text-dim">
        Saved when you ask the coach to remember something — &ldquo;save this&rdquo; in the
        chat. Every note is shown to the coach in future conversations and rides in your
        backups. Delete anything it should forget.
      </p>

      {notes !== undefined && notes.length > 0 && (
        <div className="mt-3 flex flex-col gap-1.5">
          {/* Newest first: the note being looked for is usually the last one made. */}
          {[...notes].reverse().map((note) => (
            <div key={note.id} className="rounded-xl bg-surface-2 p-3">
              <div className="flex items-baseline justify-between gap-2">
                {/* friendlyDate already names the weekday for a real date;
                    only Today and Yesterday need it appended. */}
                <Label>
                  {(() => {
                    const day = note.savedAt.slice(0, 10);
                    const when = friendlyDate(day);
                    return when === 'Today' || when === 'Yesterday'
                      ? `${when} · ${WEEKDAY_LABEL[weekdayOf(day)]}`
                      : when;
                  })()}
                </Label>
                <button
                  type="button"
                  onClick={() => void deleteCoachMemory(note.id)}
                  className="text-[11px] font-medium text-text-dim"
                  aria-label={`Forget the note from ${note.savedAt.slice(0, 10)}`}
                >
                  forget
                </button>
              </div>
              <p className="mt-1 text-[14px] leading-snug">{note.note}</p>
            </div>
          ))}
        </div>
      )}
    </Card>
  );
}
