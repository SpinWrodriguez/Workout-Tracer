import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '../db/db';
import type { Exercise } from '../db/types';
import { EM_WEIGHT, friendlyDate, kg, todayIso, weekStart } from '../lib/format';
import { Card, Empty, Label, Screen } from '../components/Layout';
import { Ring } from '../components/Ring';

/**
 * Weekly targets for a realistic two-session week (spec §1): ~6 exercises a
 * session at 3 sets. Editable targets are a Settings concern for a later
 * phase; hard-coding them now keeps Phase 1 honest about what it computes.
 */
const WEEKLY_TARGET = { sets: 36, exercises: 12, muscles: 10 };

export function DashboardScreen({
  exercises,
  onOpenSession,
}: {
  exercises: Exercise[];
  onOpenSession: (sessionId: string) => void;
}) {
  const week = useLiveQuery(async () => {
    const from = weekStart(todayIso());
    const sessions = await db.session.where('date').aboveOrEqual(from).toArray();
    const ids = new Set(sessions.map((s) => s.id));
    const logs = (await db.setLog.toArray()).filter((l) => ids.has(l.sessionId));
    const byId = new Map(exercises.map((e) => [e.id, e]));

    const exerciseIds = new Set(logs.map((l) => l.exerciseId));
    const muscles = new Set<string>();
    for (const id of exerciseIds) {
      const exercise = byId.get(id);
      // Primary muscles only here. Weighted primary/secondary volume is the
      // Phase 4 job; this ring just answers "did I touch it this week".
      for (const m of exercise?.primaryMuscles ?? []) muscles.add(m);
    }

    return {
      from,
      sessionCount: sessions.length,
      setCount: logs.length,
      exerciseCount: exerciseIds.size,
      muscleCount: muscles.size,
      volumeKg: logs.reduce((sum, l) => sum + (l.effectiveKg ?? 0) * l.reps, 0),
    };
  }, [exercises]);

  const bodyWeight = useLiveQuery(
    () => db.sharedBodyWeight.orderBy('date').reverse().limit(14).toArray(),
    [],
    undefined,
  );

  const recent = useLiveQuery(
    () => db.session.orderBy('date').reverse().limit(4).toArray(),
    [],
    undefined,
  );

  const latest = bodyWeight?.[0];
  const earlier = bodyWeight?.at(-1);
  const delta =
    latest && earlier && latest.date !== earlier.date ? latest.kg - earlier.kg : undefined;

  return (
    <Screen title="Dashboard">
      <Card title="This week">
        <div className="mt-1 flex justify-around">
          <Ring
            value={week?.setCount ?? 0}
            target={WEEKLY_TARGET.sets}
            label="sets"
            color="var(--color-volume)"
          />
          <Ring
            value={week?.exerciseCount ?? 0}
            target={WEEKLY_TARGET.exercises}
            label="exercises"
            color="var(--color-strength)"
          />
          <Ring
            value={week?.muscleCount ?? 0}
            target={WEEKLY_TARGET.muscles}
            label="muscles"
            color="var(--color-muscle)"
          />
        </div>
        <p className="mt-4 text-[12px] font-medium text-text-dim">
          {week && week.sessionCount > 0
            ? `${week.sessionCount} session${week.sessionCount === 1 ? '' : 's'} · ${kg(
                week.volumeKg,
              )} kg effective volume`
            : '--- sets this week'}
        </p>
      </Card>

      <Card title="Body weight" className="mt-3">
        {latest ? (
          <div className="flex items-end justify-between gap-3">
            <div>
              <span className="stat" style={{ color: 'var(--color-bodyweight)' }}>
                {kg(latest.kg)}
              </span>
              <span className="ml-1.5 text-sm font-medium text-text-dim">kg</span>
              <p className="label mt-1">{friendlyDate(latest.date)}</p>
            </div>
            <div className="text-right">
              <span className="stat-sm">
                {delta === undefined ? '--' : `${delta > 0 ? '+' : ''}${kg(delta)}`}
              </span>
              <p className="label mt-1">
                {bodyWeight && bodyWeight.length > 1
                  ? `over ${bodyWeight.length} entries`
                  : 'no trend yet'}
              </p>
            </div>
          </div>
        ) : (
          <>
            <Empty>{EM_WEIGHT}</Empty>
            <p className="mt-1 text-[12px] font-medium text-text-dim">
              Import the nutrition backup in Settings to bring in the shared weigh-in history.
            </p>
          </>
        )}
      </Card>

      <Card title="Recent sessions" className="mt-3">
        {recent === undefined || recent.length === 0 ? (
          <Empty>--- sets</Empty>
        ) : (
          <div className="-mx-1">
            {recent.map((session) => (
              <button
                key={session.id}
                type="button"
                onClick={() => onOpenSession(session.id)}
                className="flex w-full items-center justify-between gap-3 rounded-xl px-1 py-2.5 text-left"
              >
                <span className="text-[15px] font-medium">{friendlyDate(session.date)}</span>
                <Label>
                  day {session.daySlot}
                  {session.durationMin ? ` · ${session.durationMin} min` : ''}
                </Label>
              </button>
            ))}
          </div>
        )}
      </Card>
    </Screen>
  );
}
