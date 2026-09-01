import { useRef, useState } from 'react';
import type { DaySlot } from '../db/types';
import { slotName } from '../lib/slotName';
import { WEEKDAY_LABEL, type WeekDay, type Weekday } from '../lib/golf';
import { fromIsoDate } from '../lib/format';

/* -------------------------------------------------------------------------- */
/*  Weekly view — spec Phase 3: gym days, golf days, rest days and rule        */
/*  violations in one glance, and the place you edit all three.                */
/*                                                                            */
/*  It shows PLANNED sessions from the block schedule, not just logged ones,   */
/*  so generating a week immediately changes what this reads.                  */
/*                                                                            */
/*  Grip safety is deliberately not labelled per day. It was on every column,  */
/*  every week, and almost always said the same thing; the rule only needs to  */
/*  speak when it is actually being broken, which the violation marker and the */
/*  session banner already do.                                                */
/* -------------------------------------------------------------------------- */

export interface WeekStripDay extends WeekDay {
  /** Slot the block schedules on this weekday, logged or not. */
  plannedSlot?: DaySlot;
}

function dotColor(day: WeekStripDay): string | undefined {
  if (day.violation) return 'var(--color-rir-1)';
  if (day.golf) return 'var(--color-muscle)';
  if (day.plannedSlot || day.sessionIds.length > 0) return 'var(--color-volume)';
  return undefined;
}

export function WeekStrip({
  week,
  onPickDay,
  onMoveSlot,
}: {
  week: WeekStripDay[];
  onPickDay: (date: string) => void;
  /** Drag-and-drop reassignment of a session to another weekday. */
  onMoveSlot: (slot: DaySlot, weekday: Weekday) => void;
}) {
  const columns = useRef<(HTMLDivElement | null)[]>([]);
  const [drag, setDrag] = useState<{ slot: DaySlot; x: number; y: number; over: number } | null>(
    null,
  );

  /** Which column index the pointer is currently inside. */
  const columnAt = (x: number, y: number): number => {
    return columns.current.findIndex((el) => {
      if (!el) return false;
      const box = el.getBoundingClientRect();
      return x >= box.left && x <= box.right && y >= box.top - 40 && y <= box.bottom + 40;
    });
  };

  const startDrag = (slot: DaySlot, index: number) => (event: React.PointerEvent) => {
    event.preventDefault();
    (event.target as Element).setPointerCapture?.(event.pointerId);
    setDrag({ slot, x: event.clientX, y: event.clientY, over: index });
  };

  const moveDrag = (event: React.PointerEvent) => {
    if (!drag) return;
    event.preventDefault();
    setDrag({ ...drag, x: event.clientX, y: event.clientY, over: columnAt(event.clientX, event.clientY) });
  };

  const endDrag = () => {
    if (!drag) return;
    const target = week[drag.over];
    if (target && target.plannedSlot !== drag.slot) onMoveSlot(drag.slot, target.weekday);
    setDrag(null);
  };

  return (
    <div className="relative">
      <div className="flex gap-1.5" onPointerMove={moveDrag} onPointerUp={endDrag} onPointerCancel={endDrag}>
        {week.map((day, index) => {
          const color = dotColor(day);
          const dropping = drag !== null && drag.over === index;
          const done = day.sessionIds.length > 0;
          return (
            <div
              key={day.date}
              ref={(el) => {
                columns.current[index] = el;
              }}
              className={`flex-1 rounded-xl px-1 pt-2 pb-1.5 transition-colors ${
                dropping ? 'bg-surface-2 outline-2 outline-cta' : 'bg-surface-2'
              }`}
            >
              <button
                type="button"
                onClick={() => onPickDay(day.date)}
                className="block w-full"
                aria-label={`${WEEKDAY_LABEL[day.weekday]} ${day.date}${
                  day.plannedSlot ? `, ${slotName(day.plannedSlot)}` : ''
                }${day.golf ? `, golf ${day.golf.status}` : ''}${
                  day.violation ? ', rule violation' : ''
                }`}
              >
                <span className="block text-[10px] font-medium text-text-dim">
                  {WEEKDAY_LABEL[day.weekday]}
                </span>
                <span className="mt-0.5 block text-[15px] font-semibold">
                  {fromIsoDate(day.date).getDate()}
                </span>
                <span
                  className="mx-auto mt-1.5 block size-1.5 rounded-full"
                  style={{ background: color ?? 'var(--color-border)' }}
                />
              </button>

              {/* The draggable token: the session itself, not the day. */}
              {day.plannedSlot ? (
                <div
                  role="button"
                  tabIndex={0}
                  onPointerDown={startDrag(day.plannedSlot, index)}
                  aria-label={`${slotName(day.plannedSlot)} — drag to move`}
                  className={`mt-1.5 cursor-grab touch-none rounded-lg py-1 text-center text-[11px] font-bold select-none ${
                    drag?.slot === day.plannedSlot ? 'opacity-30' : ''
                  } ${done ? 'bg-cta text-bg' : 'bg-volume text-bg'}`}
                >
                  {day.plannedSlot}
                </div>
              ) : day.golf ? (
                <div
                  className="mt-1.5 rounded-lg py-1 text-center text-[10px] font-bold text-bg"
                  style={{ background: 'var(--color-muscle)' }}
                >
                  GOLF
                </div>
              ) : (
                <div className="mt-1.5 py-1 text-center text-[10px] font-medium text-text-faint">
                  {done ? 'Log' : 'Rest'}
                </div>
              )}
            </div>
          );
        })}
      </div>

      {/* Follows the finger so the drag reads as physical on a phone. */}
      {drag && (
        <div
          className="pointer-events-none fixed z-50 flex size-9 items-center justify-center rounded-lg bg-cta text-[13px] font-bold text-bg"
          style={{ left: drag.x - 18, top: drag.y - 18 }}
        >
          {drag.slot}
        </div>
      )}
    </div>
  );
}
