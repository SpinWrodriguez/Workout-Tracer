import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '../db/db';
import type { Exercise } from '../db/types';
import { longDate } from '../lib/format';
import { Card, Empty, Label, Screen } from '../components/Layout';

const DAY_SLOTS = ['A', 'B', 'C', 'X', 'Y'] as const;

/**
 * Read-only in Phase 1. The block builder — day-slot assignment, set and rep
 * targets, and the golf-rule placement that is the whole point of it — is
 * Phase 3. This screen exists so the block a session is logged against is
 * visible rather than implicit.
 */
export function ProgramScreen({ exercises }: { exercises: Exercise[] }) {
  const block = useLiveQuery(() => db.block.orderBy('startDate').reverse().first(), [], undefined);
  const slots = useLiveQuery(
    async () => (block ? db.blockExercise.where('blockId').equals(block.id).toArray() : []),
    [block?.id],
    undefined,
  );
  const byId = new Map(exercises.map((e) => [e.id, e]));

  return (
    <Screen title="Program">
      <Card title={block ? 'Current block' : 'No block'}>
        {block ? (
          <>
            <p className="text-[13px] font-medium text-text-dim">
              {longDate(block.startDate)} — {longDate(block.endDate)}
            </p>
            {block.notes && <p className="mt-2 text-[13px] text-text-dim">{block.notes}</p>}
          </>
        ) : (
          <Empty>--</Empty>
        )}
      </Card>

      {DAY_SLOTS.map((slot) => {
        const list = (slots ?? [])
          .filter((s) => s.daySlot === slot)
          .sort((a, b) => a.order - b.order);
        return (
          <Card key={slot} title={`Day ${slot}`} className="mt-3">
            {list.length === 0 ? (
              <Empty>--- sets</Empty>
            ) : (
              list.map((entry) => (
                <div
                  key={entry.exerciseId}
                  className="flex items-baseline justify-between gap-3 py-1.5"
                >
                  <span className="truncate text-[15px] font-medium">
                    {byId.get(entry.exerciseId)?.name ?? entry.exerciseId}
                  </span>
                  <Label>
                    {entry.targetSets} × {entry.repRangeLow}-{entry.repRangeHigh}
                  </Label>
                </div>
              ))
            )}
          </Card>
        );
      })}

      <p className="mt-4 px-1 text-[12px] font-medium text-text-faint">
        Slot assignment, set and rep targets, and golf-aware placement land in Phase 3.
      </p>
    </Screen>
  );
}
