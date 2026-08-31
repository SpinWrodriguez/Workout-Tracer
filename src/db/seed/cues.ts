/* -------------------------------------------------------------------------- */
/*  One-line cues — spec §9: "Fall back to your own one-line cue text and no  */
/*  photo."                                                                   */
/*                                                                            */
/*  Kept in its own table rather than added to the Exercise type, which §5     */
/*  pins field for field. Every exercise has one, not just the unmapped ones:  */
/*  a cue about *this* gym's setup beats a generic upstream description, and   */
/*  it is the only text available with no network and no cache.               */
/* -------------------------------------------------------------------------- */

export const CUES: Record<string, string> = {
  bb_back_squat: 'Spotters set one notch below depth. Brace, then break at the hips and knees together.',
  bb_front_squat: 'Elbows up the whole way. If they drop, the bar rolls and the rep is over.',
  bb_rdl: 'Hips back, bar dragging the thighs. Stop where the hamstrings stop, not where the floor is.',
  bb_deadlift: 'Take the slack out of the bar before you pull. Hips and chest rise together.',
  bb_bench_press: 'J-hooks at chest height, safeties just above the ribs. Shoulder blades pinned back.',
  bb_overhead_press: 'Squeeze the glutes so the lower back does not take the press. Head through at the top.',
  bb_bent_over_row: 'Torso near parallel and still. Pull to the bottom of the ribs, not the chest.',
  bb_curl: 'Elbows pinned to the ribs. If the shoulders swing forward the weight is too heavy.',

  sm_squat: 'Guided bar lets you sit further back than a free squat. Feet slightly forward.',
  sm_bench_press: 'Set the safety catch a hand-width above the chest before the first rep.',
  sm_incline_press: 'Bench around 30°. Higher and it turns into an overhead press.',
  sm_overhead_press: 'Seated keeps the lower back out of it. Bar path just in front of the forehead.',
  sm_shrug: 'Straight up, no rolling. Pause at the top for a full second.',
  sm_calf_raise: 'Plate or block under the toes for a full stretch. Slow on the way down.',

  cb_chop: 'High pulley to low. Rotate through the ribs, not the lower back.',
  cb_lift: 'Low pulley to high, arms straight. The turn comes from the trunk and the back foot.',
  cb_pallof_press: 'Press straight out and resist the rotation. Nothing should move but the arms.',
  cb_single_arm_row: 'Single pulley, so the stack reads about double the real load. Elbow past the ribs.',
  cb_tricep_pushdown: 'Upper arms locked to the sides. Only the forearms move.',
  cb_bicep_curl: 'Step back so there is tension at the bottom. Cable stays in line with the forearm.',
  cb_lateral_raise: 'Lead with the elbow to just above shoulder height. Pinky slightly high.',
  cb_face_pull: 'Rope to eye level, hands finish wide of the ears. Rear delts, not traps.',
  cb_kickback: 'Upper arm parallel to the floor and still. Straighten fully and hold a beat.',

  cb_lat_pulldown: 'Both pulleys, so the stack is near true weight. Chest up, bar to the collarbone.',
  cb_seated_row: 'Both pulleys. Torso upright and quiet — no rowing with the lower back.',
  cb_fly: 'Slight forward lean, elbows soft and fixed. Hands meet in front of the sternum.',
  cb_straight_arm_pulldown: 'Arms straight throughout. Drive the bar to the thighs with the lats.',

  lm_press: 'Half-kneeling or standing. The arc suits a cranky shoulder better than a straight press.',
  lm_row: 'Chest over the bar, pull to the hip. The landmine keeps the path fixed for you.',
  lm_rotation: 'Arms long, pivot the back foot. The bar travels in an arc, the spine does not.',
  lm_squat_to_press: 'One movement — the press starts as the legs finish. Keep the bar close on the way up.',

  kb_swing: 'A hinge, not a squat. The bell floats; the arms never lift it.',
  kb_goblet_squat: 'Bell against the chest, elbows inside the knees at the bottom.',
  kb_single_leg_rdl: 'Hips square, back leg long. Stop when the hips start to open.',
  kb_turkish_get_up: 'Eyes on the bell the whole way up and down. Slow is the point.',
  kb_suitcase_carry: 'One side only. Do not lean away from the bell — stay square and walk tall.',

  bw_pull_up: 'Full hang at the bottom. Chest to the bar, no kipping.',
  bw_chin_up: 'Underhand, elbows in front. More biceps than a pull-up by design.',
  bw_dip: 'Slight forward lean for chest, upright for triceps. Stop before the shoulders shrug up.',
  bw_push_up: 'Hands under the shoulders, body one line. Elbows back at 45°, not flared.',
  bw_plank: 'Ribs down, glutes on. Log the seconds in the reps column.',
  bw_side_plank: 'Stack the shoulders and hips. Push the bottom shoulder away from the ear.',
  bw_hanging_leg_raise: 'Curl the pelvis up rather than just lifting the legs. Control the drop.',
  bw_split_squat: 'Back knee tracks straight down. Hold the load in the front-leg-side hand.',
  bw_glute_bridge: 'Heels close, ribs down. Finish with the glutes, not the lower back.',

  bd_pull_apart: 'Arms straight, band to the sternum. High reps, low effort — this is a warm-up.',
  bd_external_rotation: 'Elbow pinned to the side at 90°. Rotate out only as far as it stays pinned.',
  bd_pull_through: 'Face away from the anchor, hinge and let the band pull the hips back.',
  bd_lateral_walk: 'Band above the knees, quarter squat. Small steps, no bobbing.',
};

export function cueFor(exerciseId: string): string | undefined {
  return CUES[exerciseId];
}
