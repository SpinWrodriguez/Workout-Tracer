import { useEffect, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { db } from './db/db';
import type { DaySlot } from './db/types';
import { seedDatabase } from './db/seed';
import { syncNow, syncWorkoutNow } from './lib/nutritionSync';
import { startWorkoutAutoSync } from './lib/workoutAutoSync';
import { BottomNav, type Tab } from './components/BottomNav';
import { StartSheet, type StartOption } from './components/StartSheet';
import { dayLabel } from './lib/dayLabel';
import { ACTIVE_SESSION_KEY, readActiveSession } from './db/settings';
import { ResumeBar } from './components/ResumeBar';
import { readWeekPlan } from './lib/weekPlan';
import { DashboardScreen } from './screens/DashboardScreen';
import { HistoryScreen } from './screens/HistoryScreen';
import { LevelsScreen } from './screens/LevelsScreen';
import { ProgramScreen } from './screens/ProgramScreen';
import { SessionScreen } from './screens/SessionScreen';
import { SettingsScreen } from './screens/SettingsScreen';

/** Either a tab, or a session being logged/edited full-screen. */
type Route =
  | { kind: 'tab'; tab: Tab }
  | { kind: 'session'; sessionId?: string; daySlot?: DaySlot; freestyle?: boolean };

export default function App() {
  const [ready, setReady] = useState(false);
  const [route, setRoute] = useState<Route>({ kind: 'tab', tab: 'dashboard' });
  const [starting, setStarting] = useState(false);
  const exercises = useLiveQuery(() => db.exercise.orderBy('name').toArray(), [], undefined);
  /*
   * A workout left running. Keyed on the settings row so it appears the moment
   * the session screen writes one and disappears on save or discard, with no
   * message passing between the two.
   */
  const active = useLiveQuery(async () => {
    await db.settings.get(ACTIVE_SESSION_KEY);
    return readActiveSession();
  }, [], undefined);

  useEffect(() => {
    void seedDatabase().finally(() => setReady(true));
    /*
     * Pull the nutrition app's weigh-ins on open. Deliberately fire-and-forget:
     * it must never delay first paint or fail the launch, because the garage
     * has patchy wifi and everything here works from the local copy.
     */
    void syncNow().catch(() => undefined);

    /*
     * Reconcile the training data too, then keep it pushed. Both are
     * fire-and-forget: nothing here may delay first paint or fail the launch,
     * because the app has to open on bad wifi and work from the local copy.
     */
    void syncWorkoutNow().catch(() => undefined);
    startWorkoutAutoSync(() => {
      void syncWorkoutNow().catch(() => undefined);
    });
  }, []);

  /* Only read while the sheet is open: the + is not a reason to keep a query
     alive behind every screen. */
  const startOptions = useLiveQuery(async (): Promise<StartOption[]> => {
    if (!starting) return [];
    const plan = await readWeekPlan();
    if (!plan) return [];
    const byId = new Map((exercises ?? []).map((e) => [e.id, e]));
    return plan.all.map((day) => {
      const picked = day.entries
        .map((entry) => byId.get(entry.exerciseId))
        .filter((exercise) => exercise !== undefined);
      return {
        slot: day.slot,
        label: dayLabel({
          slot: day.slot,
          name: day.name,
          exercises: picked,
          intensity: day.intensity,
        }),
        weekday: day.weekday,
        date: day.date,
        exerciseCount: day.entries.length,
        done: day.done,
        isToday: day.date !== undefined && day.date === plan.today,
        isNext: day.slot === plan.next,
        preview: picked.slice(0, 3).map((exercise) => exercise.name).join(' · '),
      };
    });
  }, [starting, exercises]);

  if (!ready || exercises === undefined) {
    return (
      <div className="flex min-h-dvh items-center justify-center bg-bg">
        <span className="screen-title text-text-faint">Workout</span>
      </div>
    );
  }

  if (route.kind === 'session') {
    return (
      <SessionScreen
        sessionId={route.sessionId}
        daySlot={route.daySlot}
        freestyle={route.freestyle}
        exercises={exercises}
        onExit={() => setRoute({ kind: 'tab', tab: route.sessionId ? 'history' : 'dashboard' })}
      />
    );
  }

  const openSession = (sessionId: string) => setRoute({ kind: 'session', sessionId });
  /** Start a new session. Without a slot the screen resolves today's. */
  const startSession = (slot?: DaySlot) => setRoute({ kind: 'session', daySlot: slot });

  return (
    <>
      {route.tab === 'dashboard' && (
        <DashboardScreen
          exercises={exercises}
          onOpenSession={openSession}
          onStartDay={startSession}
          onOpenSettings={() => setRoute({ kind: 'tab', tab: 'settings' })}
        />
      )}
      {route.tab === 'levels' && <LevelsScreen exercises={exercises} />}
      {route.tab === 'history' && (
        <HistoryScreen exercises={exercises} onOpen={openSession} />
      )}
      {route.tab === 'program' && (
        <ProgramScreen exercises={exercises} onStartDay={startSession} />
      )}
      {route.tab === 'settings' && <SettingsScreen />}

      {/* Above the nav, on every tab, whenever a workout is unfinished. The
          point of letting you leave mid-session is being able to get back. */}
      {active && (
        <ResumeBar
          label={active.label}
          onResume={() => setRoute({ kind: 'session' })}
        />
      )}

      <BottomNav
        tab={route.tab}
        onTab={(tab) => setRoute({ kind: 'tab', tab })}
        onNewSession={() => setStarting(true)}
      />

      {starting && (
        <StartSheet
          options={startOptions ?? []}
          onPick={(slot) => {
            setStarting(false);
            startSession(slot);
          }}
          onFreestyle={() => {
            setStarting(false);
            setRoute({ kind: 'session', freestyle: true });
          }}
          onClose={() => setStarting(false)}
        />
      )}
    </>
  );
}
