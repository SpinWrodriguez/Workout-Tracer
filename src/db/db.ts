import Dexie, { type Table } from 'dexie';
import type {
  Activity,
  Block,
  BlockExercise,
  BodyWeight,
  Exercise,
  FreeDbCache,
  GolfDay,
  Goals,
  NutritionDay,
  SavedMeal,
  Session,
  SetLog,
  SettingRow,
} from './types';

/* -------------------------------------------------------------------------- */
/*  Single Dexie database shared with the nutrition app — spec §10.           */
/*                                                                            */
/*  Store names carry their namespace as a prefix. This is what makes one      */
/*  database safe for two apps: the nutrition app already owns a table called  */
/*  `exercise` holding calorie-burn entries (which migrate to shared_activity) */
/*  and this app needs an `exercise` table of its own holding the curated      */
/*  movement list. Prefixing keeps both intact.                               */
/* -------------------------------------------------------------------------- */

export const DB_NAME = 'fitness';

/** Backup envelope version this build reads and writes (spec §10). */
export const BACKUP_VERSION = 3;

export class FitnessDB extends Dexie {
  // shared — either app reads and writes these
  sharedBodyWeight!: Table<BodyWeight, string>;
  sharedActivity!: Table<Activity, [string, string, string]>;
  sharedGoals!: Table<Goals, string>;

  // nutrition — round-tripped through backup, never interpreted here
  nutritionSelections!: Table<NutritionDay, string>;
  nutritionChecked!: Table<NutritionDay, string>;
  nutritionSavedMeals!: Table<SavedMeal, string>;

  // workout
  exercise!: Table<Exercise, string>;
  freeDbCache!: Table<FreeDbCache, string>;
  block!: Table<Block, string>;
  blockExercise!: Table<BlockExercise, [string, string, string]>;
  session!: Table<Session, string>;
  setLog!: Table<SetLog, [string, string, number]>;
  settings!: Table<SettingRow, string>;
  golfDay!: Table<GolfDay, string>;

  constructor() {
    super(DB_NAME);

    this.version(1).stores({
      shared_bodyWeight: 'date',
      // Compound key makes re-import an upsert rather than a duplicate.
      shared_activity: '[date+name+source], date, source',
      shared_goals: 'date',

      nutrition_selections: 'date',
      nutrition_checked: 'date',
      nutrition_savedMeals: 'id',

      workout_exercise: 'id, name, station, gripLoad, loadMode',
      workout_freeDbCache: 'id',
      workout_block: 'id, startDate, endDate',
      workout_blockExercise: '[blockId+exerciseId+daySlot], blockId, exerciseId, daySlot',
      workout_session: 'id, date, blockId, daySlot',
      // Natural compound key: one row per (session, exercise, set number).
      workout_setLog: '[sessionId+exerciseId+setNo], sessionId, exerciseId, [sessionId+exerciseId]',
    });

    // Phase 2 adds the editable equipment inventory; Phase 3 the golf calendar.
    this.version(2).stores({
      workout_settings: 'key',
      workout_golfDay: 'date, status',
    });

    this.sharedBodyWeight = this.table('shared_bodyWeight');
    this.sharedActivity = this.table('shared_activity');
    this.sharedGoals = this.table('shared_goals');
    this.nutritionSelections = this.table('nutrition_selections');
    this.nutritionChecked = this.table('nutrition_checked');
    this.nutritionSavedMeals = this.table('nutrition_savedMeals');
    this.exercise = this.table('workout_exercise');
    this.freeDbCache = this.table('workout_freeDbCache');
    this.block = this.table('workout_block');
    this.blockExercise = this.table('workout_blockExercise');
    this.session = this.table('workout_session');
    this.setLog = this.table('workout_setLog');
    this.settings = this.table('workout_settings');
    this.golfDay = this.table('workout_golfDay');
  }
}

export const db = new FitnessDB();
