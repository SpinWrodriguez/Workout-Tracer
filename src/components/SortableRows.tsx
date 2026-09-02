import { useRef, useState, type ReactNode } from 'react';
import { dropIndex, moved } from '../lib/reorder';

/* -------------------------------------------------------------------------- */
/*  Rows you drag to reorder and swipe to delete.                            */
/*                                                                           */
/*  Replaces a row of three small buttons — up, down, remove — that took      */
/*  three taps to move an exercise two places and put a delete target 28px    */
/*  from the thing that reorders. Both gestures are the ones a thumb already  */
/*  expects on a list.                                                       */
/*                                                                           */
/*  Two gestures on one row is where this gets fiddly, so they are kept       */
/*  apart: dragging happens on the grip and nowhere else, swiping happens on  */
/*  the row and locks to the horizontal only once it is clearly horizontal.   */
/*  Anything else stays a scroll, because a list you cannot scroll past is    */
/*  worse than one you cannot reorder.                                       */
/*                                                                           */
/*  Arrow keys on the grip do the same job as a drag. Not decoration: a       */
/*  gesture is the only way to reorder now, and a gesture is unavailable to   */
/*  anything that is not a pointer. It is also the only path a DOM test can   */
/*  drive, since jsdom has no real pointer — and the only way to move a row   */
/*  to a place that is off the screen, since a drag does not scroll the page  */
/*  with it. Seven exercises is the ceiling, so that is two drags at worst.   */
/* -------------------------------------------------------------------------- */

export interface SortableRow {
  key: string;
  /** Names this row in the grip and delete labels, for anyone not looking. */
  label: string;
  content: ReactNode;
}

/** How far the row slides to uncover the delete button. */
const REVEAL = 92;
/** Past this, letting go opens rather than snapping shut. */
const OPEN_AT = REVEAL / 2;
/** Movement below this is not yet a direction. */
const AXIS = 6;

/* A drag carries the row heights it started with. Measured once, on the way
   in, because rows are not the same height — an editing row is about three
   times a plain one — and because reading a ref while rendering is reading a
   number React has not promised is current yet. */
interface Drag {
  key: string;
  from: number;
  dy: number;
  heights: number[];
}

function GripIcon() {
  return (
    <svg viewBox="0 0 24 24" className="size-4.5" fill="none" aria-hidden="true">
      <path
        d="M9 6h.01M9 12h.01M9 18h.01M15 6h.01M15 12h.01M15 18h.01"
        stroke="currentColor"
        strokeWidth="2.5"
        strokeLinecap="round"
      />
    </svg>
  );
}

function BinIcon() {
  return (
    <svg viewBox="0 0 24 24" className="size-4.5" fill="none" aria-hidden="true">
      <path
        d="M4 7h16M9 7V5h6v2m-8 0 1 13h8l1-13M10 11v6m4-6v6"
        stroke="currentColor"
        strokeWidth="1.7"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

export function SortableRows({
  rows,
  onReorder,
  onDelete,
}: {
  rows: SortableRow[];
  /** The keys in their new order. Called once, when the drag ends. */
  onReorder: (orderedKeys: string[]) => void;
  onDelete: (key: string) => void;
}) {
  const nodes = useRef<Record<string, HTMLDivElement | null>>({});
  const [drag, setDrag] = useState<Drag | null>(null);
  const [swipe, setSwipe] = useState<{ key: string; dx: number } | null>(null);
  /* Which row is sitting open. Only ever one: two rows showing a delete
     button is two things asking to be tapped. */
  const [open, setOpen] = useState<string | undefined>(undefined);
  const gesture = useRef<{ x: number; y: number; axis?: 'x' | 'y' } | null>(null);

  const keyOrderAfter = (from: number, to: number) =>
    moved(rows.map((row) => row.key), from, to);

  /* --- reorder, on the grip ---------------------------------------------- */

  const startDrag = (key: string, from: number) => (event: React.PointerEvent) => {
    event.preventDefault();
    (event.target as Element).setPointerCapture?.(event.pointerId);
    setOpen(undefined);
    setSwipe(null);
    gesture.current = { x: event.clientX, y: event.clientY, axis: 'y' };
    setDrag({
      key,
      from,
      dy: 0,
      heights: rows.map((row) => nodes.current[row.key]?.offsetHeight ?? 0),
    });
  };

  const moveDrag = (event: React.PointerEvent) => {
    if (!drag || !gesture.current) return;
    event.preventDefault();
    setDrag({ ...drag, dy: event.clientY - gesture.current.y });
  };

  const endDrag = () => {
    if (!drag) return;
    const to = dropIndex(drag.from, drag.dy, drag.heights);
    if (to !== drag.from) onReorder(keyOrderAfter(drag.from, to));
    setDrag(null);
    gesture.current = null;
  };

  const nudge = (from: number, direction: -1 | 1) => {
    const to = from + direction;
    if (to < 0 || to >= rows.length) return;
    onReorder(keyOrderAfter(from, to));
  };

  /* --- swipe, on the row ------------------------------------------------- */

  const startSwipe = (key: string) => (event: React.PointerEvent) => {
    // A press on the grip is a drag; it bubbles here, and it is not a swipe.
    if ((event.target as Element).closest?.('[data-grip]')) return;
    /* Captured, so the rest of the gesture still arrives once the row has slid
       out from under the finger. Without this a swipe that goes far enough to
       be worth making strands the row wherever it lost the pointer. */
    (event.currentTarget as Element).setPointerCapture?.(event.pointerId);
    gesture.current = { x: event.clientX, y: event.clientY };
    setSwipe({ key, dx: open === key ? -REVEAL : 0 });
  };

  const moveSwipe = (event: React.PointerEvent) => {
    const start = gesture.current;
    if (!swipe || !start) return;
    const dx = event.clientX - start.x;
    const dy = event.clientY - start.y;

    if (!start.axis) {
      if (Math.abs(dx) < AXIS && Math.abs(dy) < AXIS) return;
      /* Vertical wins ties. Stealing an ambiguous drag from the scroller is
         how a list becomes impossible to read past. */
      start.axis = Math.abs(dx) > Math.abs(dy) ? 'x' : 'y';
      if (start.axis === 'y') {
        setSwipe(null);
        return;
      }
    }
    if (start.axis !== 'x') return;

    event.preventDefault();
    const base = open === swipe.key ? -REVEAL : 0;
    // Rightward past closed does nothing: there is nothing on that side.
    setSwipe({ ...swipe, dx: Math.max(-REVEAL, Math.min(0, base + dx)) });
  };

  const endSwipe = () => {
    if (!swipe) return;
    setOpen(swipe.dx <= -OPEN_AT ? swipe.key : undefined);
    setSwipe(null);
    gesture.current = null;
  };

  const offsetFor = (key: string) => {
    if (swipe?.key === key) return swipe.dx;
    return open === key ? -REVEAL : 0;
  };

  /* Where the dragged row is heading, and the hole it left behind. */
  const landing = drag ? dropIndex(drag.from, drag.dy, drag.heights) : undefined;
  const lift = drag ? (drag.heights[drag.from] ?? 0) : 0;

  return (
    <div>
      {rows.map((row, index) => {
        const dragging = drag?.key === row.key;
        /* Where an untouched row sits while another is being dragged over it.
           The dragged row leaves a hole; the rows between close it up. */
        let shift = 0;
        if (drag && !dragging && landing !== undefined) {
          if (index > drag.from && index <= landing) shift = -lift;
          else if (index < drag.from && index >= landing) shift = lift;
        }

        return (
          <div
            key={row.key}
            ref={(el) => {
              nodes.current[row.key] = el;
            }}
            /* Clipped, so a swiped row slides out of sight at the card edge
               rather than out over the screen. */
            className={`relative overflow-hidden ${index > 0 ? 'border-t border-border' : ''}`}
            style={{
              transform: dragging
                ? `translateY(${drag.dy}px)`
                : shift
                  ? `translateY(${shift}px)`
                  : undefined,
              transition: drag ? 'none' : 'transform 160ms ease',
              zIndex: dragging ? 2 : undefined,
              /* Lifted, so it is obvious which row is in your hand. */
              boxShadow: dragging ? '0 8px 24px rgb(0 0 0 / 0.18)' : undefined,
              background: dragging ? 'var(--color-surface)' : undefined,
            }}
          >
            {/* Behind the row, uncovered by the swipe. In the DOM whether or
                not it is showing, so it can still be reached by anything that
                does not swipe. */}
            <button
              type="button"
              onClick={() => {
                setOpen(undefined);
                onDelete(row.key);
              }}
              aria-label={`Delete ${row.label}`}
              className="absolute inset-y-0 right-0 flex w-[92px] items-center justify-center text-bg"
              style={{ background: 'var(--color-rir-1)' }}
            >
              <BinIcon />
            </button>

            <div
              onPointerDown={startSwipe(row.key)}
              onPointerMove={moveSwipe}
              onPointerUp={endSwipe}
              onPointerCancel={endSwipe}
              className="relative flex items-start gap-2 bg-bg"
              style={{
                transform: `translateX(${offsetFor(row.key)}px)`,
                transition: swipe?.key === row.key ? 'none' : 'transform 180ms ease',
                // The card is the surface behind these rows.
                background: 'var(--color-surface)',
              }}
            >
              <div className="min-w-0 flex-1 py-2.5">{row.content}</div>

              <div
                role="button"
                tabIndex={0}
                data-grip=""
                aria-label={`Reorder ${row.label}`}
                onPointerDown={startDrag(row.key, index)}
                onPointerMove={moveDrag}
                onPointerUp={endDrag}
                onPointerCancel={endDrag}
                onKeyDown={(event) => {
                  if (event.key === 'ArrowUp') {
                    event.preventDefault();
                    nudge(index, -1);
                  }
                  if (event.key === 'ArrowDown') {
                    event.preventDefault();
                    nudge(index, 1);
                  }
                }}
                className="mt-2.5 flex size-9 shrink-0 cursor-grab touch-none items-center justify-center rounded-lg text-text-faint"
              >
                <GripIcon />
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}
