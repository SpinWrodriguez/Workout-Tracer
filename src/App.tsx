import { useEffect, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { db } from './db/db';
import { seedDatabase } from './db/seed';
import { BottomNav, type Tab } from './components/BottomNav';
import { DashboardScreen } from './screens/DashboardScreen';
import { HistoryScreen } from './screens/HistoryScreen';
import { ProgramScreen } from './screens/ProgramScreen';
import { SessionScreen } from './screens/SessionScreen';
import { SettingsScreen } from './screens/SettingsScreen';

/** Either a tab, or a session being logged/edited full-screen. */
type Route = { kind: 'tab'; tab: Tab } | { kind: 'session'; sessionId?: string };

export default function App() {
  const [ready, setReady] = useState(false);
  const [route, setRoute] = useState<Route>({ kind: 'tab', tab: 'dashboard' });
  const exercises = useLiveQuery(() => db.exercise.orderBy('name').toArray(), [], undefined);

  useEffect(() => {
    void seedDatabase().finally(() => setReady(true));
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
        exercises={exercises}
        onExit={() => setRoute({ kind: 'tab', tab: route.sessionId ? 'history' : 'dashboard' })}
      />
    );
  }

  const openSession = (sessionId: string) => setRoute({ kind: 'session', sessionId });

  return (
    <>
      {route.tab === 'dashboard' && (
        <DashboardScreen exercises={exercises} onOpenSession={openSession} />
      )}
      {route.tab === 'history' && (
        <HistoryScreen exercises={exercises} onOpen={openSession} />
      )}
      {route.tab === 'program' && <ProgramScreen exercises={exercises} />}
      {route.tab === 'settings' && <SettingsScreen />}

      <BottomNav
        tab={route.tab}
        onTab={(tab) => setRoute({ kind: 'tab', tab })}
        onNewSession={() => setRoute({ kind: 'session' })}
      />
    </>
  );
}
