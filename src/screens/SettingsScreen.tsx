import { useRef, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '../db/db';
import { downloadBackup, importBackup, type ImportReport } from '../lib/backup';
import { Card, Label, Screen } from '../components/Layout';
import { InventoryEditor } from '../components/InventoryEditor';

export function SettingsScreen() {
  const fileInput = useRef<HTMLInputElement>(null);
  const [report, setReport] = useState<ImportReport | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const counts = useLiveQuery(
    async () => ({
      exercise: await db.exercise.count(),
      session: await db.session.count(),
      setLog: await db.setLog.count(),
      bodyWeight: await db.sharedBodyWeight.count(),
      activity: await db.sharedActivity.count(),
      goals: await db.sharedGoals.count(),
      selections: await db.nutritionSelections.count(),
      savedMeals: await db.nutritionSavedMeals.count(),
    }),
    [],
    undefined,
  );

  const handleFile = async (file: File) => {
    setBusy(true);
    setError(null);
    setReport(null);
    try {
      const parsed = JSON.parse(await file.text()) as unknown;
      setReport(await importBackup(parsed));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setBusy(false);
      if (fileInput.current) fileInput.current.value = '';
    }
  };

  const row = (label: string, value: string) => (
    <div className="flex items-baseline justify-between gap-3 py-1.5">
      <Label>{label}</Label>
      <span className="text-[14px] font-medium">{value}</span>
    </div>
  );

  return (
    <Screen title="Settings">
      <Card title="Backup">
        <p className="text-[13px] text-text-dim">
          One JSON file covers both apps. Import reads the nutrition app's version 2 export as
          well as this app's version 3 envelope; it upserts on natural keys, so re-importing the
          same file never duplicates rows and never deletes anything.
        </p>

        <input
          ref={fileInput}
          type="file"
          accept="application/json,.json"
          className="hidden"
          onChange={(event) => {
            const file = event.target.files?.[0];
            if (file) void handleFile(file);
          }}
        />

        <div className="mt-4 flex gap-2">
          <button
            type="button"
            disabled={busy}
            onClick={() => fileInput.current?.click()}
            className="h-11 flex-1 rounded-full bg-cta font-semibold text-bg disabled:bg-surface-2 disabled:text-text-faint"
          >
            {busy ? 'Importing…' : 'Import backup'}
          </button>
          <button
            type="button"
            onClick={() => void downloadBackup()}
            className="h-11 flex-1 rounded-full bg-surface-2 font-medium"
          >
            Export backup
          </button>
        </div>

        {error && (
          <p className="mt-3 text-[13px] font-medium" style={{ color: 'var(--color-rir-1)' }}>
            {error}
          </p>
        )}

        {report && (
          <div className="mt-3 rounded-xl bg-surface-2 p-3">
            <p className="text-[13px] font-semibold">
              Imported a version {report.sourceVersion || '?'} file
            </p>
            <div className="mt-1.5">
              {Object.entries(report.counts)
                .filter(([, n]) => n > 0)
                .map(([table, n]) => (
                  <div key={table} className="flex justify-between gap-3">
                    <Label>{table}</Label>
                    <span className="text-[13px] font-medium">{n}</span>
                  </div>
                ))}
              {Object.values(report.counts).every((n) => n === 0) && (
                <Label>nothing new to merge</Label>
              )}
            </div>
            {report.warnings.map((warning) => (
              <p key={warning} className="mt-2 text-[12px]" style={{ color: 'var(--color-rir-3)' }}>
                {warning}
              </p>
            ))}
          </div>
        )}
      </Card>

      <Card title="Stored data" className="mt-3">
        {counts === undefined ? (
          <Label>--</Label>
        ) : (
          <>
            {row('Exercises', String(counts.exercise))}
            {row('Sessions', String(counts.session))}
            {row('Set logs', String(counts.setLog))}
            {row('Body weight entries', String(counts.bodyWeight))}
            {row('Activity entries', String(counts.activity))}
            {row('Goals (shared)', String(counts.goals))}
            {row('Nutrition days', String(counts.selections))}
            {row('Saved meals', String(counts.savedMeals))}
          </>
        )}
      </Card>

      <div className="mt-3">
        <InventoryEditor />
      </div>
    </Screen>
  );
}
