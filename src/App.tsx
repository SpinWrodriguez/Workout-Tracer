import { useEffect, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { db } from './db/db';
import type { DaySlot } from './db/types';
import { seedDatabase } from './db/seed';
import { syncNow, syncWorkoutNow } from './lib/nutritionSync';
import { startWorkoutAutoSync } from './lib/workoutAutoSync';
import { BottomNav, type Tab } from './components/BottomNav';
import { ACTIVE_SESSION_KEY, readActiveSession } from './db/settings';
import { ResumeBar } from './components/ResumeBar';
import { CoachSheet } from './components/CoachSheet';
import { isModelAvailable } from './lib/askModel';
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
  const [asking, setAsking] = useState(false);
  /* A question handed over by another screen — a session from History — asked
     the moment the sheet opens. */
  const [askAbout, setAskAbout] = useState<string | undefined>(undefined);
  /* Which week the Program screen has open, so a question asked over the top
     of it is about that week rather than about today's. */
  const [programWeek, setProgramWeek] = useState<string | undefined>(undefined);
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
          onStartDay={startSession}
          onFreestyle={() => setRoute({ kind: 'session', freestyle: true })}
          onOpenSettings={() => setRoute({ kind: 'tab', tab: 'settings' })}
        />
      )}
      {route.tab === 'levels' && <LevelsScreen exercises={exercises} />}
      {/* The per-session Ask chip went with the session list: History is the
          calendar now, and the coach can be asked about any session from the
          floating button — it reads the same log. */}
      {route.tab === 'history' && <HistoryScreen exercises={exercises} onOpen={openSession} />}
      {route.tab === 'program' && (
        <ProgramScreen
          exercises={exercises}
          onStartDay={startSession}
          onWeekChange={setProgramWeek}
        />
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
        /* Not offered where nothing can answer it. `isModelAvailable` is
           false with no key and no relay, and turns false again the moment a
           relay is found not to be deployed — so the button does not sit
           there promising an answer the app cannot get. */
        onCoach={isModelAvailable() ? () => setAsking(true) : undefined}
      />

      {asking && (
        <CoachSheet
          exercises={exercises}
          initialQuestion={askAbout}
          /* Only while that screen is the one open. Asked from Home or
             History there is no week on screen, and the current one is what
             the question is about. */
          weekOf={route.tab === 'program' ? programWeek : undefined}
          onClose={() => {
            setAsking(false);
            setAskAbout(undefined);
          }}
        />
      )}

    </>
  );
}
