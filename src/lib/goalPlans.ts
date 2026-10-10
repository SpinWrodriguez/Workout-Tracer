import { db } from '../db/db';
import type {
  Block,
  BlockExercise,
  DaySlot,
  Exercise,
  GoalId,
  GoalPlanInfo,
  MovementPattern,
  MuscleId,
  PlanRole,
} from '../db/types';
import { daysBetween, shiftIso, todayIso, weekStart } from './format';
import type { Weekday } from './golf';
import { workingRepRange } from './blockValidation';
import { isTimed } from './repUnit';
import { readPlans, readSchedules, writePlan, writeSchedule, type BlockSchedule } from './program';

/* -------------------------------------------------------------------------- */
/*  Goal plans — docs/GOAL-PLANS.md.                                          */
/*                                                                            */
/*  A plan is a block with a goal: three workouts fixed for its length and a  */
/*  target that changes week by week. The targets are written into the        */
/*  block's own rows once a week (syncPlanWeek), so the cards, the session,    */
/*  progression and the golf rule all read them without knowing what a plan   */
/*  is. Ending a plan takes its block out of the running and the app falls    */
/*  back to the block before it, shelf and all.                               */
/* -------------------------------------------------------------------------- */

export interface PhaseTarget {
  week: number;
  name: string;
  mainSets: number;
  accessorySets: number;
  main: { low: number; high: number };
  accessory: { low: number; high: number };
  /** Reps in reserve on working sets, as said to the lifter. */
  rir: string;
  /** About how many weighted sets each muscle should get this week. */
  setsPerMuscle: number;
  /** Golf power stays fast; it drops to two sets while the lifting peaks. */
  powerSets: number;
}

/** The Muscle preset, week by week. */
export const MUSCLE_PHASES: PhaseTarget[] = [
  { week: 1, name: 'Settle in', mainSets: 3, accessorySets: 2, main: { low: 10, high: 12 }, accessory: { low: 12, high: 15 }, rir: '3', setsPerMuscle: 10, powerSets: 3 },
  { week: 2, name: 'Settle in', mainSets: 3, accessorySets: 3, main: { low: 10, high: 12 }, accessory: { low: 12, high: 15 }, rir: '3', setsPerMuscle: 10, powerSets: 3 },
  { week: 3, name: 'Build', mainSets: 3, accessorySets: 3, main: { low: 8, high: 12 }, accessory: { low: 10, high: 15 }, rir: '2', setsPerMuscle: 12, powerSets: 3 },
  { week: 4, name: 'Build', mainSets: 4, accessorySets: 3, main: { low: 8, high: 12 }, accessory: { low: 10, high: 15 }, rir: '2', setsPerMuscle: 13, powerSets: 3 },
  { week: 5, name: 'Build', mainSets: 4, accessorySets: 3, main: { low: 8, high: 12 }, accessory: { low: 10, high: 15 }, rir: '2', setsPerMuscle: 14, powerSets: 3 },
  { week: 6, name: 'Push', mainSets: 4, accessorySets: 4, main: { low: 6, high: 10 }, accessory: { low: 8, high: 12 }, rir: '1–2', setsPerMuscle: 16, powerSets: 2 },
  { week: 7, name: 'Push', mainSets: 4, accessorySets: 4, main: { low: 6, high: 10 }, accessory: { low: 8, high: 12 }, rir: '1–2', setsPerMuscle: 16, powerSets: 2 },
  { week: 8, name: 'Lighter + test', mainSets: 2, accessorySets: 2, main: { low: 8, high: 10 }, accessory: { low: 10, high: 12 }, rir: '3', setsPerMuscle: 8, powerSets: 2 },
];

/** One place in a workout, and what is allowed to fill it. */
export interface SlotDef {
  key: string;
  label: string;
  role: PlanRole;
  patterns: MovementPattern[];
  /** At least one of these must be a primary muscle of whatever fills it. */
  muscles: MuscleId[];
  /** Power slots also take only explosive or rotational work. */
  explosive?: boolean;
  /** Tried in order when building; listed first when swapping. */
  candidates: string[];
}

export interface WorkoutDef {
  slot: DaySlot;
  name: string;
  weekday: Weekday;
  /** The day before golf: no high grip, no high spinal load, no finisher. */
  golfSafe: boolean;
  slots: SlotDef[];
}

/* The power and core slots open every workout: golf work goes first, while
   fresh, and is kept short so it does not eat into the muscle work. */
export const MUSCLE_WORKOUTS: WorkoutDef[] = [
  {
    slot: 'A',
    name: 'Lower + Push',
    weekday: 1,
    golfSafe: false,
    slots: [
      { key: 'power', label: 'Golf power', role: 'power', explosive: true, patterns: ['squat', 'hinge', 'rotation', 'push_v'], muscles: ['quads', 'glutes', 'obliques', 'front_delts'], candidates: ['bw_jump_squat', 'lm_scoop', 'lm_rotational_press'] },
      { key: 'core', label: 'Anti-rotation', role: 'core', patterns: ['core', 'rotation'], muscles: ['abs', 'obliques'], candidates: ['cb_pallof_press', 'cb_pallof_rotation', 'bw_side_plank'] },
      { key: 'lower', label: 'Lower', role: 'main', patterns: ['squat'], muscles: ['quads'], candidates: ['bb_back_squat', 'bb_front_squat', 'kb_goblet_squat', 'sm_squat'] },
      { key: 'push', label: 'Push', role: 'main', patterns: ['push_h'], muscles: ['chest'], candidates: ['bb_bench_press', 'sm_bench_press', 'bw_push_up'] },
      { key: 'single', label: 'One leg', role: 'accessory', patterns: ['squat'], muscles: ['quads', 'glutes'], candidates: ['kb_bulgarian_split', 'bw_split_squat', 'db_split_squat', 'kb_reverse_lunge', 'kb_step_up'] },
      { key: 'delts', label: 'Side delts', role: 'accessory', patterns: ['push_v'], muscles: ['side_delts'], candidates: ['cb_lateral_raise', 'db_lateral_raise'] },
      { key: 'triceps', label: 'Triceps', role: 'accessory', patterns: ['push_v', 'push_h'], muscles: ['triceps'], candidates: ['cb_overhead_triceps', 'cb_tricep_pushdown', 'cb_kickback'] },
      { key: 'calves', label: 'Calves', role: 'accessory', patterns: ['squat'], muscles: ['calves'], candidates: ['db_single_leg_calf_raise', 'sm_calf_raise', 'db_seated_calf_raise'] },
    ],
  },
  {
    slot: 'B',
    name: 'Pull + Hinge',
    weekday: 3,
    golfSafe: false,
    slots: [
      { key: 'power', label: 'Golf power', role: 'power', explosive: true, patterns: ['rotation', 'hinge', 'push_v'], muscles: ['obliques', 'glutes', 'front_delts'], candidates: ['lm_rotational_press', 'lm_scoop', 'cb_chop'] },
      { key: 'core', label: 'Adductors', role: 'core', patterns: ['core', 'carry', 'squat'], muscles: ['adductors'], candidates: ['bw_copenhagen_plank', 'cb_hip_adduction'] },
      { key: 'hinge', label: 'Hinge', role: 'main', patterns: ['hinge'], muscles: ['hamstrings', 'glutes'], candidates: ['bb_rdl', 'kb_single_leg_rdl', 'cb_pull_through'] },
      { key: 'pull', label: 'Vertical pull', role: 'main', patterns: ['pull_v'], muscles: ['lats'], candidates: ['bw_pull_up', 'bw_chin_up', 'bw_neutral_pull_up', 'cb_lat_pulldown'] },
      { key: 'row', label: 'Row', role: 'accessory', patterns: ['pull_h'], muscles: ['lats', 'upper_back'], candidates: ['cb_single_arm_row', 'cb_seated_row', 'sm_inverted_row', 'db_one_arm_row'] },
      { key: 'hamcurl', label: 'Hamstring curl', role: 'accessory', patterns: ['hinge'], muscles: ['hamstrings'], candidates: ['bw_nordic_curl', 'cb_leg_curl'] },
      { key: 'biceps', label: 'Biceps', role: 'accessory', patterns: ['pull_h', 'pull_v'], muscles: ['biceps'], candidates: ['db_incline_curl', 'bb_curl', 'cb_bicep_curl', 'db_hammer_curl'] },
    ],
  },
  {
    slot: 'C',
    name: 'Upper + Glutes',
    weekday: 5,
    golfSafe: true,
    slots: [
      { key: 'power', label: 'Golf primer', role: 'power', explosive: true, patterns: ['rotation'], muscles: ['obliques'], candidates: ['cb_chop', 'cb_lift', 'cb_punch'] },
      { key: 'core', label: 'Core', role: 'core', patterns: ['core', 'rotation'], muscles: ['obliques', 'abs'], candidates: ['bw_side_plank', 'cb_pallof_press', 'bw_captains_knee_raise'] },
      { key: 'glutes', label: 'Glutes', role: 'main', patterns: ['hinge'], muscles: ['glutes'], candidates: ['bb_hip_thrust', 'bw_glute_bridge', 'cb_pull_through'] },
      { key: 'press', label: 'Press', role: 'main', patterns: ['push_v'], muscles: ['front_delts'], candidates: ['db_shoulder_press', 'lm_press', 'bb_overhead_press'] },
      { key: 'lats', label: 'Lats', role: 'accessory', patterns: ['pull_v', 'pull_h'], muscles: ['lats'], candidates: ['db_pullover', 'sm_inverted_row', 'cb_straight_arm_pulldown', 'cb_single_arm_row'] },
      { key: 'chest', label: 'Chest', role: 'accessory', patterns: ['push_h'], muscles: ['chest'], candidates: ['cb_fly', 'bw_push_up', 'sm_incline_press'] },
      { key: 'reardelts', label: 'Rear delts', role: 'accessory', patterns: ['pull_h'], muscles: ['rear_delts'], candidates: ['cb_rear_delt_fly', 'cb_face_pull', 'bd_pull_apart'] },
      { key: 'calves', label: 'Calves', role: 'accessory', patterns: ['squat'], muscles: ['calves'], candidates: ['db_seated_calf_raise', 'sm_calf_raise', 'db_single_leg_calf_raise'] },
    ],
  },
];

export const MUSCLE_WEEKS = MUSCLE_PHASES.length;

/* --- Strength ---------------------------------------------------------------- */

/** Fewer, heavier sets on the main lifts; accessories hold the size. */
export const STRENGTH_PHASES: PhaseTarget[] = [
  { week: 1, name: 'Groove', mainSets: 3, accessorySets: 2, main: { low: 6, high: 8 }, accessory: { low: 8, high: 12 }, rir: '3', setsPerMuscle: 8, powerSets: 3 },
  { week: 2, name: 'Groove', mainSets: 4, accessorySets: 2, main: { low: 6, high: 8 }, accessory: { low: 8, high: 12 }, rir: '2', setsPerMuscle: 9, powerSets: 3 },
  { week: 3, name: 'Strength', mainSets: 4, accessorySets: 2, main: { low: 4, high: 6 }, accessory: { low: 8, high: 10 }, rir: '2', setsPerMuscle: 9, powerSets: 3 },
  { week: 4, name: 'Strength', mainSets: 4, accessorySets: 2, main: { low: 4, high: 6 }, accessory: { low: 8, high: 10 }, rir: '1–2', setsPerMuscle: 9, powerSets: 3 },
  { week: 5, name: 'Peak', mainSets: 3, accessorySets: 2, main: { low: 3, high: 5 }, accessory: { low: 8, high: 10 }, rir: '1', setsPerMuscle: 7, powerSets: 2 },
  { week: 6, name: 'Lighter + test', mainSets: 2, accessorySets: 1, main: { low: 3, high: 5 }, accessory: { low: 8, high: 10 }, rir: '3', setsPerMuscle: 5, powerSets: 2 },
];

/** The Muscle workouts' slots, by key, so Strength reuses the same choices. */
function slotsOf(slot: DaySlot, keys: string[], override: Partial<Record<string, Partial<SlotDef>>> = {}): SlotDef[] {
  const def = MUSCLE_WORKOUTS.find((w) => w.slot === slot) as WorkoutDef;
  return keys.map((key) => {
    const base = def.slots.find((s) => s.key === key) as SlotDef;
    return { ...base, ...override[key] };
  });
}

/* Same days, same golf work first, same Friday rule. Each workout is two
   main lifts and two accessories: strength is built on few lifts done often
   and heavy, with rests long enough to make the next set count. */
export const STRENGTH_WORKOUTS: WorkoutDef[] = [
  {
    slot: 'A',
    name: 'Squat + Bench',
    weekday: 1,
    golfSafe: false,
    slots: slotsOf('A', ['power', 'core', 'lower', 'push', 'single', 'triceps'], {
      lower: { candidates: ['bb_back_squat', 'bb_front_squat', 'sm_squat'] },
      push: { candidates: ['bb_bench_press', 'sm_bench_press'] },
    }),
  },
  {
    slot: 'B',
    name: 'Hinge + Pull',
    weekday: 3,
    golfSafe: false,
    slots: slotsOf('B', ['power', 'core', 'hinge', 'pull', 'row', 'hamcurl']),
  },
  {
    slot: 'C',
    name: 'Press + Glutes',
    weekday: 5,
    golfSafe: true,
    slots: slotsOf('C', ['power', 'core', 'glutes', 'press', 'lats', 'reardelts'], {
      press: { candidates: ['bb_overhead_press', 'db_shoulder_press', 'lm_press'] },
    }),
  },
];

export interface GoalPreset {
  goal: GoalId;
  label: string;
  phases: PhaseTarget[];
  workouts: WorkoutDef[];
  /** One line on the setup sheet. */
  blurb: string;
  judgedOn: string;
}

export const PRESETS: Record<GoalId, GoalPreset> = {
  muscle: {
    goal: 'muscle',
    label: 'Muscle',
    phases: MUSCLE_PHASES,
    workouts: MUSCLE_WORKOUTS,
    blurb:
      '8–12 reps, sets climbing from about 10 to 16 per muscle a week, and a lighter week 8 with a re-test.',
    judgedOn: "Judged on the main lifts' estimated 1-RM, weekly sets per muscle and body weight.",
  },
  strength: {
    goal: 'strength',
    label: 'Strength',
    phases: STRENGTH_PHASES,
    workouts: STRENGTH_WORKOUTS,
    blurb:
      'Two heavy main lifts a workout, 6–8 reps down to 3–5, long rests, a lighter week 6 with a re-test.',
    judgedOn: "Judged on the main lifts' estimated 1-RM. Keeps the size the Muscle plan built.",
  },
};

export const GOALS = Object.keys(PRESETS) as GoalId[];
export const GOAL_LABEL: Record<GoalId, string> = { muscle: 'Muscle', strength: 'Strength' };

export function presetOf(goal: GoalId | undefined): GoalPreset {
  return PRESETS[goal ?? 'muscle'] ?? PRESETS.muscle;
}

/* --- what fits where ------------------------------------------------------- */

/** Safe the day before golf: nothing grip-heavy, nothing heavy on the spine. */
export function isGolfSafe(exercise: Exercise): boolean {
  return exercise.gripLoad !== 'high' && exercise.spinalLoad !== 'high';
}

export function fitsSlot(exercise: Exercise, slot: SlotDef, golfSafe: boolean): boolean {
  if (exercise.isMobility || exercise.loadMode === 'rpe_only') return false;
  if (golfSafe && !isGolfSafe(exercise)) return false;
  if (slot.explosive && !exercise.isExplosive && exercise.pattern !== 'rotation') return false;
  if (!slot.patterns.includes(exercise.pattern)) return false;
  return exercise.primaryMuscles.some((muscle) => slot.muscles.includes(muscle));
}

/**
 * What a slot can be swapped to: its own candidates first, in their order,
 * then everything else that fits, by name. Only choosable exercises are passed
 * in, so retired and deleted ones never appear.
 */
export function slotOptions(slot: SlotDef, exercises: Exercise[], golfSafe: boolean): Exercise[] {
  const fitting = exercises.filter((exercise) => fitsSlot(exercise, slot, golfSafe));
  const rank = (exercise: Exercise) => {
    const at = slot.candidates.indexOf(exercise.id);
    return at === -1 ? slot.candidates.length : at;
  };
  return fitting.sort((a, b) => rank(a) - rank(b) || a.name.localeCompare(b.name));
}

/** One workout's choice, slot by slot. Undefined where nothing fits. */
export interface DraftWorkout {
  def: WorkoutDef;
  picks: (string | undefined)[];
}

/**
 * Build my workouts: every slot takes the best choosable exercise that fits
 * it, never the same exercise twice in one workout. Deterministic, so pressing
 * it twice gives the same three workouts and the review is what changes them.
 */
export function buildPlanDraft(exercises: Exercise[], goal: GoalId = 'muscle'): DraftWorkout[] {
  return presetOf(goal).workouts.map((def) => {
    const used = new Set<string>();
    const picks = def.slots.map((slot) => {
      const choice = slotOptions(slot, exercises, def.golfSafe).find((e) => !used.has(e.id));
      if (choice) used.add(choice.id);
      return choice?.id;
    });
    return { def, picks };
  });
}

/* --- the week's numbers ---------------------------------------------------- */

export function phaseFor(week: number, goal: GoalId = 'muscle'): PhaseTarget {
  const phases = presetOf(goal).phases;
  const clamped = Math.min(Math.max(1, week), phases.length);
  return phases[clamped - 1] as PhaseTarget;
}

/** A week back after time off: week 1's targets, under its own name. */
function reentryPhase(goal: GoalId): PhaseTarget {
  return { ...phaseFor(1, goal), name: 'Re-entry' };
}

/** Sets and range for one row this week, always inside the exercise's bounds. */
export function prescriptionFor(
  role: PlanRole,
  exercise: Exercise,
  phase: PhaseTarget,
): { targetSets: number; repRangeLow: number; repRangeHigh: number } {
  const range = (low: number, high: number) => workingRepRange(exercise, { low, high });
  let sets: number;
  let reps: { low: number; high: number };
  if (role === 'power') {
    sets = phase.powerSets;
    reps = isTimed(exercise) ? range(exercise.repMin, exercise.repMax) : range(5, 6);
  } else if (role === 'core') {
    sets = 2;
    reps = isTimed(exercise) ? range(20, 30) : range(8, 12);
  } else if (role === 'main') {
    sets = phase.mainSets;
    reps = isTimed(exercise) ? range(exercise.repMin, exercise.repMax) : range(phase.main.low, phase.main.high);
  } else {
    sets = phase.accessorySets;
    reps = isTimed(exercise)
      ? range(exercise.repMin, exercise.repMax)
      : range(phase.accessory.low, phase.accessory.high);
  }
  return { targetSets: sets, repRangeLow: reps.low, repRangeHigh: reps.high };
}

/** Said on the session screen while logging. */
export function effortCueFor(phase: PhaseTarget, def: WorkoutDef): string {
  const base =
    phase.name === 'Re-entry'
      ? `Re-entry week: week 1 targets, and start about 10% lighter than you left off.`
      : `Week ${phase.week} · ${phase.name}: ${phase.rir} reps in reserve on working sets.`;
  return def.golfSafe ? `${base} Golf tomorrow, so nothing to failure.` : base;
}

/* --- where a plan is in time ----------------------------------------------- */

export type PlanState = 'upcoming' | 'active' | 'finished' | 'ended';

/** Weeks since the plan started, by the calendar: 1 in its first week. */
export function calendarWeekOf(block: Block, date = todayIso()): number {
  return Math.floor(daysBetween(block.startDate, date) / 7) + 1;
}

/** The plan week a date falls in: the calendar week, less repeats and re-entries. */
export function planWeekOf(block: Block, date = todayIso()): number {
  const weeks = block.plan?.weeks ?? MUSCLE_WEEKS;
  const week = calendarWeekOf(block, date) - (block.plan?.offsetWeeks ?? 0);
  return Math.min(Math.max(1, week), weeks);
}

/** This week's targets, re-entry included. */
export function planPhaseOf(block: Block, date = todayIso()): PhaseTarget {
  const goal = block.plan?.goal ?? 'muscle';
  if (block.plan?.reentryWeek !== undefined && block.plan.reentryWeek === calendarWeekOf(block, date)) {
    return reentryPhase(goal);
  }
  return phaseFor(planWeekOf(block, date), goal);
}

export function planStateOf(block: Block, date = todayIso()): PlanState | undefined {
  if (!block.plan) return undefined;
  if (block.plan.endedAt) return 'ended';
  if (date < block.startDate) return 'upcoming';
  if (date > block.endDate) return 'finished';
  return 'active';
}

/**
 * The block the app works in today. Newest first, skipping a plan that has
 * been ended and one that has not started yet: until its Monday comes, the
 * old block and its shelf carry on as they were.
 */
export function currentBlockOf(blocks: Block[], date = todayIso()): Block | undefined {
  const sorted = [...blocks].sort((a, b) => b.startDate.localeCompare(a.startDate));
  return (
    // A plan that has started and not been ended outranks any free-form block,
    // whatever their start dates say: it is what the lifter chose to follow.
    sorted.find((block) => block.plan && !block.plan.endedAt && block.startDate <= date) ??
    sorted.find((block) => !block.plan?.endedAt && block.startDate <= date) ??
    sorted.find((block) => !block.plan?.endedAt) ??
    sorted[0]
  );
}

export async function readCurrentBlock(date = todayIso()): Promise<Block | undefined> {
  return currentBlockOf(await db.block.toArray(), date);
}

/** A plan that is booked but has not reached its start date. */
export async function readUpcomingPlan(date = todayIso()): Promise<Block | undefined> {
  return (await db.block.toArray()).find((block) => planStateOf(block, date) === 'upcoming');
}

/** The Monday a plan started today would begin: this week's, or the next one. */
export function defaultPlanStart(date = todayIso()): string {
  const monday = weekStart(date);
  return monday === date ? date : shiftIso(monday, 7);
}

/* --- starting, keeping current, ending ------------------------------------- */

export async function startPlan({
  start,
  draft,
  exercisesById,
  goal = 'muscle',
}: {
  start: string;
  draft: DraftWorkout[];
  exercisesById: Map<string, Exercise>;
  goal?: GoalId;
}): Promise<string> {
  const id = `plan_${start}`;
  const preset = presetOf(goal);
  const weeks = preset.phases.length;
  const info: GoalPlanInfo = { goal, weeks, appliedWeek: 1 };
  const block: Block = {
    id,
    startDate: start,
    endDate: shiftIso(start, weeks * 7 - 1),
    focusMuscles: [],
    notes: `${preset.label} plan, ${weeks} weeks.`,
    plan: info,
  };
  const phase = phaseFor(1, goal);
  const rows: BlockExercise[] = [];
  const schedule: BlockSchedule = {};
  for (const { def, picks } of draft) {
    let order = 0;
    def.slots.forEach((slot, i) => {
      const exercise = picks[i] ? exercisesById.get(picks[i] as string) : undefined;
      if (!exercise) return;
      rows.push({
        blockId: id,
        exerciseId: exercise.id,
        daySlot: def.slot,
        role: slot.role,
        order: order++,
        ...prescriptionFor(slot.role, exercise, phase),
      });
    });
    schedule[def.slot] = {
      weekday: def.weekday,
      intensity: 'heavy',
      name: def.name,
      effortCue: effortCueFor(phase, def),
    };
  }
  await db.transaction('rw', db.block, db.blockExercise, async () => {
    await db.blockExercise.where('blockId').equals(id).delete();
    await db.block.put(block);
    await db.blockExercise.bulkPut(rows);
  });
  await writeSchedule(id, schedule);
  return id;
}

/** Catch-up workouts live in these slots for one week, then go. */
export const CATCH_UP_SLOTS: DaySlot[] = ['X', 'Y'];

async function sessionsInCalendarWeek(block: Block, week: number): Promise<number> {
  const from = shiftIso(block.startDate, (week - 1) * 7);
  const to = shiftIso(from, 7);
  return db.session
    .where('date')
    .between(from, to, true, false)
    .filter((session) => session.blockId === block.id)
    .count();
}

/**
 * Brings a running plan up to today, one calendar week at a time, and writes
 * that week's targets into its rows. Cheap to call often: it returns at once
 * when the week is already applied, so screens call it before they read.
 *
 * Each week boundary settles the week just gone (docs/GOAL-PLANS.md §3):
 *  - a week with no session repeats: the plan week stays and the end moves
 *    out a week;
 *  - a second empty week in a row makes the next one a re-entry week, at
 *    week-1 targets, which does not use up a plan week either;
 *  - catch-up workouts made for the week are cleared.
 */
export async function syncPlanWeek(block: Block | undefined, date = todayIso()): Promise<void> {
  if (!block?.plan || block.plan.endedAt || date < block.startDate) return;
  const target = calendarWeekOf(block, date);
  const applied = block.plan.appliedWeek ?? 1;
  if (applied >= target) return;

  let offset = block.plan.offsetWeeks ?? 0;
  let reentry = block.plan.reentryWeek;
  let lastEmpty = applied >= 2 ? (await sessionsInCalendarWeek(block, applied - 1)) === 0 : false;
  for (let week = applied + 1; week <= target; week += 1) {
    const prev = week - 1;
    const prevEmpty = (await sessionsInCalendarWeek(block, prev)) === 0;
    const wasReentry = reentry === prev;
    if (wasReentry || prevEmpty) offset += 1;
    reentry = prevEmpty && (lastEmpty || wasReentry) ? week : undefined;
    lastEmpty = prevEmpty;
  }

  const plan: GoalPlanInfo = {
    ...block.plan,
    appliedWeek: target,
    offsetWeeks: offset,
    ...(reentry !== undefined ? { reentryWeek: reentry } : { reentryWeek: undefined }),
  };
  const next: Block = {
    ...block,
    endDate: shiftIso(block.startDate, (plan.weeks + offset) * 7 - 1),
    plan,
  };
  const phase = planPhaseOf(next, date);

  const rows = await db.blockExercise.where('blockId').equals(block.id).toArray();
  const exercisesById = new Map(
    (await db.exercise.bulkGet([...new Set(rows.map((row) => row.exerciseId))]))
      .filter((exercise): exercise is Exercise => exercise !== undefined)
      .map((exercise) => [exercise.id, exercise]),
  );
  const kept = rows.filter((row) => !CATCH_UP_SLOTS.includes(row.daySlot));
  const updated = kept.map((row) => {
    const exercise = exercisesById.get(row.exerciseId);
    if (!exercise || !row.role) return row;
    return { ...row, ...prescriptionFor(row.role, exercise, phase) };
  });

  const schedule = (await readSchedules())[block.id] ?? {};
  for (const slot of CATCH_UP_SLOTS) delete schedule[slot];
  for (const def of presetOf(plan.goal).workouts) {
    const day = schedule[def.slot];
    if (day) schedule[def.slot] = { ...day, effortCue: effortCueFor(phase, def) };
  }
  const dates = { ...((await readPlans())[block.id] ?? {}) };
  for (const [day, slot] of Object.entries(dates)) {
    if (day < shiftIso(block.startDate, (target - 1) * 7)) delete dates[day];
    else if (slot && CATCH_UP_SLOTS.includes(slot)) delete dates[day];
  }

  await db.transaction('rw', db.block, db.blockExercise, async () => {
    await db.blockExercise
      .where('blockId')
      .equals(block.id)
      .filter((row) => CATCH_UP_SLOTS.includes(row.daySlot))
      .delete();
    await db.blockExercise.bulkPut(updated);
    await db.block.put(next);
  });
  await writeSchedule(block.id, schedule);
  await writePlan(block.id, dates);
}

/**
 * End plan. The block keeps every logged set, stops being current, and the
 * block before it — the free-form shelf — is the app's again. A plan that had
 * not started is removed outright: nothing was logged against it.
 */
export async function endPlan(block: Block, date = todayIso()): Promise<void> {
  if (!block.plan) return;
  if (planStateOf(block, date) === 'upcoming') {
    await db.transaction('rw', db.block, db.blockExercise, async () => {
      await db.blockExercise.where('blockId').equals(block.id).delete();
      await db.block.delete(block.id);
    });
    return;
  }
  await db.block.put({
    ...block,
    endDate: date < block.endDate ? date : block.endDate,
    plan: { ...block.plan, endedAt: date },
  });
}
