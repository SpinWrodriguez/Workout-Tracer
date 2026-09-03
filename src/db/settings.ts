import { db } from './db';
import { DEFAULT_INVENTORY, clearLadderCache, type Inventory } from '../lib/loadable';

/* -------------------------------------------------------------------------- */
/*  Settings are key-value rows so a new one never needs a schema bump.        */
/*  Reads merge over the defaults, so a partially written row still boots.     */
/* -------------------------------------------------------------------------- */

export const INVENTORY_KEY = 'inventory';
/*
 * The lifter's standing instructions to the model, in their own words. Kept in
 * the database rather than localStorage, unlike the API key: this is real user
 * content that belongs in a backup and should follow them to another device.
 * The key is a secret and stays device-local; a goal is not.
 */
export const AI_INSTRUCTIONS_KEY = 'aiInstructions';
export const AI_INSTRUCTIONS_MAX = 1200;

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

/** Merged over DEFAULT_INVENTORY so a hand-edited or partial row still works. */
export function mergeInventory(value: unknown): Inventory {
  if (!isRecord(value)) return DEFAULT_INVENTORY;
  const plates = Array.isArray(value.plates)
    ? value.plates
        .filter(isRecord)
        .map((p) => ({ kg: Number(p.kg), pairs: Math.round(Number(p.pairs)) }))
        .filter((p) => Number.isFinite(p.kg) && p.kg > 0 && Number.isFinite(p.pairs) && p.pairs > 0)
    : DEFAULT_INVENTORY.plates;
  const kettlebells = Array.isArray(value.kettlebells)
    ? value.kettlebells.map(Number).filter((kg) => Number.isFinite(kg) && kg > 0)
    : DEFAULT_INVENTORY.kettlebells;
  const bars = isRecord(value.barWeights) ? value.barWeights : {};
  return {
    plates: plates.length ? plates : DEFAULT_INVENTORY.plates,
    kettlebells,
    barWeights: {
      free_bar: Number(bars.free_bar) || DEFAULT_INVENTORY.barWeights.free_bar,
      smith: Number(bars.smith) || DEFAULT_INVENTORY.barWeights.smith,
    },
    cableStackKg: Number(value.cableStackKg) || DEFAULT_INVENTORY.cableStackKg,
    cableStepKg: Number(value.cableStepKg) || DEFAULT_INVENTORY.cableStepKg,
  };
}

export async function readInventory(): Promise<Inventory> {
  const row = await db.settings.get(INVENTORY_KEY);
  return mergeInventory(row?.value);
}

export async function writeInventory(inventory: Inventory): Promise<void> {
  await db.settings.put({ key: INVENTORY_KEY, value: inventory });
  // The ladder cache is keyed on the inventory, but drop it anyway so a stale
  // entry can never outlive an edit.
  clearLadderCache();
}

/* -------------------------------------------------------------------------- */
/*  Training preferences: set once, rarely changed, so they live in Settings   */
/*  rather than on the block screen. Anything whose answer is always the same  */
/*  is a setting, not a choice.                                               */
/* -------------------------------------------------------------------------- */

export const TRAINING_KEY = 'training';

export interface TrainingPrefs {
  /** ISO weekdays a round is typically played. Sat is 6, Sun is 7. */
  golfWeekdays: number[];
  weeklySetTarget: number;
  sessionMinutes: number;
  /**
   * What the heavy days train. Stored rather than derived because, unlike the
   * number of sessions and which are heavy, nothing in the schedule records
   * it — two heavy days look identical whichever split produced them.
   */
  shape: 'mixed' | 'upper_lower';
}

export const DEFAULT_TRAINING: TrainingPrefs = {
  golfWeekdays: [6],
  weeklySetTarget: 33,
  sessionMinutes: 40,
  shape: 'mixed',
};

export function mergeTraining(value: unknown): TrainingPrefs {
  if (!isRecord(value)) return DEFAULT_TRAINING;
  const golfWeekdays = Array.isArray(value.golfWeekdays)
    ? value.golfWeekdays
        .map(Number)
        .filter((day) => Number.isInteger(day) && day >= 1 && day <= 7)
    : DEFAULT_TRAINING.golfWeekdays;
  const target = Number(value.weeklySetTarget);
  const minutes = Number(value.sessionMinutes);
  return {
    golfWeekdays,
    weeklySetTarget:
      Number.isFinite(target) && target > 0 ? Math.round(target) : DEFAULT_TRAINING.weeklySetTarget,
    sessionMinutes:
      Number.isFinite(minutes) && minutes > 0
        ? Math.round(minutes)
        : DEFAULT_TRAINING.sessionMinutes,
    shape: value.shape === 'upper_lower' ? 'upper_lower' : DEFAULT_TRAINING.shape,
  };
}

export async function readTraining(): Promise<TrainingPrefs> {
  const row = await db.settings.get(TRAINING_KEY);
  return mergeTraining(row?.value);
}

export async function writeTraining(prefs: TrainingPrefs): Promise<void> {
  await db.settings.put({ key: TRAINING_KEY, value: prefs });
}

/* -------------------------------------------------------------------------- */
/*  When the nutrition data was last pulled. Excluded from the backup: it is a */
/*  fact about this device, not about the training.                           */
/* -------------------------------------------------------------------------- */

export const LAST_SYNC_KEY = 'lastWeightSync';

export async function readLastSync(): Promise<string | undefined> {
  const row = await db.settings.get(LAST_SYNC_KEY);
  return typeof row?.value === 'string' ? row.value : undefined;
}

export async function writeLastSync(at: string): Promise<void> {
  await db.settings.put({ key: LAST_SYNC_KEY, value: at });
}

/**
 * Free text describing what the lifter is training for. Read on every
 * generation, so changing it changes the next workout with no other action —
 * which is the point: goals drift, and a stale instruction is worse than none.
 */
export async function readAiInstructions(): Promise<string> {
  const row = await db.settings.get(AI_INSTRUCTIONS_KEY);
  return typeof row?.value === 'string' ? row.value : '';
}

export async function writeAiInstructions(text: string): Promise<void> {
  const trimmed = text.trim().slice(0, AI_INSTRUCTIONS_MAX);
  if (trimmed) await db.settings.put({ key: AI_INSTRUCTIONS_KEY, value: trimmed });
  else await db.settings.delete(AI_INSTRUCTIONS_KEY);
}

/* -------------------------------------------------------------------------- */
/*  What the last generation cost.                                            */
/*                                                                            */
/*  Written because "it feels slow" and "it looks cheap" are not measurements. */
/*  The output token count is the latency story on a thinking model, and the   */
/*  cache read tells you whether the 11k-token library is being re-billed on   */
/*  every call. Both were invisible until this existed.                       */
/* -------------------------------------------------------------------------- */

export const LAST_MODEL_CALL_KEY = 'lastModelCall';

export interface LastModelCall {
  at: string;
  /** How many round trips the validator needed. More than one is a retry. */
  attempts: number;
  ms: number;
  inputTokens?: number;
  outputTokens?: number;
  cacheReadTokens?: number;
  cacheWriteTokens?: number;
}

export async function readLastModelCall(): Promise<LastModelCall | undefined> {
  const row = await db.settings.get(LAST_MODEL_CALL_KEY);
  const value = row?.value;
  if (!isRecord(value)) return undefined;
  const at = typeof value.at === 'string' ? value.at : undefined;
  if (!at) return undefined;
  const num = (key: string): number | undefined => {
    const raw = value[key];
    return typeof raw === 'number' && Number.isFinite(raw) ? raw : undefined;
  };
  return {
    at,
    attempts: num('attempts') ?? 1,
    ms: num('ms') ?? 0,
    inputTokens: num('inputTokens'),
    outputTokens: num('outputTokens'),
    cacheReadTokens: num('cacheReadTokens'),
    cacheWriteTokens: num('cacheWriteTokens'),
  };
}

export async function writeLastModelCall(call: LastModelCall): Promise<void> {
  await db.settings.put({ key: LAST_MODEL_CALL_KEY, value: call });
}

/* -------------------------------------------------------------------------- */
/*  The workout currently in progress.                                        */
/*                                                                            */
/*  Everything else in the app works on a draft that touches Dexie only when   */
/*  saved, which is right for a screen you either finish or abandon. It was    */
/*  wrong for the screen you leave to look something up: Close threw the       */
/*  session away and Save wrote it down as finished, so there was no way to    */
/*  step out mid-workout and come back.                                       */
/*                                                                            */
/*  One row, because there is one workout at a time. Cleared on save and on a  */
/*  deliberate discard, and on nothing else.                                  */
/* -------------------------------------------------------------------------- */

export const ACTIVE_SESSION_KEY = 'activeSession';

export interface ActiveSession {
  /** The SessionDraft, opaque here: this module stores it, it does not read it. */
  draft: unknown;
  /**
   * When the session began, in epoch millis. Persisted so the recorded duration
   * survives leaving the screen — timing from the remount would report a
   * forty-minute session as five.
   */
  startedAt: number;
  /** For the resume bar: what to call it without loading the whole draft. */
  label?: string;
  savedAt: string;
}

export async function readActiveSession(): Promise<ActiveSession | undefined> {
  const row = await db.settings.get(ACTIVE_SESSION_KEY);
  const value = row?.value;
  if (!isRecord(value) || value.draft === undefined) return undefined;
  const startedAt = Number(value.startedAt);
  return {
    draft: value.draft,
    startedAt: Number.isFinite(startedAt) ? startedAt : Date.now(),
    label: typeof value.label === 'string' ? value.label : undefined,
    savedAt: typeof value.savedAt === 'string' ? value.savedAt : new Date().toISOString(),
  };
}

export async function writeActiveSession(
  session: Omit<ActiveSession, 'savedAt'>,
): Promise<void> {
  await db.settings.put({
    key: ACTIVE_SESSION_KEY,
    value: { ...session, savedAt: new Date().toISOString() },
  });
}

export async function clearActiveSession(): Promise<void> {
  await db.settings.delete(ACTIVE_SESSION_KEY);
}

/* -------------------------------------------------------------------------- */
/*  The coach conversation.                                                   */
/*                                                                            */
/*  It lived in component state, so closing the sheet — or the PWA being       */
/*  reloaded, which iOS does whenever it feels like it — threw away the        */
/*  thread. Every follow-up then started from nothing, which is the one thing  */
/*  a conversation cannot survive: "what about the other one" has no referent. */
/*                                                                            */
/*  One row, like the active session, and stored opaquely for the same reason: */
/*  the shape of a turn belongs to aiCoach.ts, and a second copy of it here    */
/*  would be a second thing to keep in step.                                   */
/* -------------------------------------------------------------------------- */

export const COACH_CHAT_KEY = 'coachChat';

export interface StoredCoachChat {
  /** CoachTurn[], opaque here: this module stores it, it does not read it. */
  turns: unknown[];
  /** The footnote for each assistant turn, so a resumed one keeps its sources. */
  notes?: unknown;
  savedAt: string;
}

export async function readCoachChat(): Promise<StoredCoachChat | undefined> {
  const row = await db.settings.get(COACH_CHAT_KEY);
  const value = row?.value;
  if (!isRecord(value) || !Array.isArray(value.turns)) return undefined;
  return {
    turns: value.turns,
    notes: value.notes,
    savedAt: typeof value.savedAt === 'string' ? value.savedAt : new Date().toISOString(),
  };
}

export async function writeCoachChat(chat: Omit<StoredCoachChat, 'savedAt'>): Promise<void> {
  await db.settings.put({
    key: COACH_CHAT_KEY,
    value: { ...chat, savedAt: new Date().toISOString() },
  });
}

export async function clearCoachChat(): Promise<void> {
  await db.settings.delete(COACH_CHAT_KEY);
}
