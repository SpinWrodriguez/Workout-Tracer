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

  /* --- Rotational, explosive, staples and mobility ---------------------- */
  lm_rotational_press: 'Drive from the back hip, then the ribs, then the arm. The bar finishes across the body.',
  lm_scoop: 'Load the back hip and throw through it. Speed is the point here, not the weight.',
  cb_rotational_row: 'Row and rotate as one movement, finishing with the chest open to the handle side.',
  cb_pallof_rotation: 'Press out, then rotate away from the stack. Hips stay square the whole time.',
  cb_punch: 'Back heel drives, hips turn, arm follows last. Short and sharp.',
  kb_russian_twist: 'Rotate the ribs, not just the arms. Heels down, chest tall.',
  bw_side_plank_reach: 'Thread the arm under, then open all the way back. The hips never drop.',
  kb_clean: 'The bell lands, it does not crash. Tame the arc by keeping it close to the body.',
  kb_high_pull: 'Same hinge as the swing. The elbow leads and the bell stays under the shoulder.',
  sm_push_press: 'Short vertical dip, drive, then lock out. The legs start it, the shoulders finish it.',
  bw_jump_squat: 'Land quietly on the same spot. Stop the set as soon as the landings get loud.',
  bb_hip_thrust: 'Shoulders on the bench, chin tucked, ribs down. Finish with the glutes, not the back.',
  kb_bulgarian_split: 'Back foot on the bench, front shin near vertical. Slow down before the knee.',
  sm_rdl: 'The guided bar lets you sit back further than a free RDL. Stop where the hamstrings stop.',
  sm_inverted_row: 'Set the Smith bar low, heels out, body in one line. The one pull that spares the grip.',
  cb_pull_through: 'Face away from the low pulley. Let the cable pull the hips back, then stand tall.',
  kb_reverse_lunge: 'Step back, not forward. Kinder on the knee and easier to control.',
  kb_step_up: 'Drive through the top foot. Do not push off the floor with the trailing leg.',
  bw_neutral_pull_up: 'Neutral grip on the multi-grip bar, the kindest angle for a cranky shoulder.',
  bw_captains_knee_raise: 'On the dip station, so nothing hangs from the hands. The grip-free leg raise.',
  kb_overhead_carry: 'Bell locked overhead, biceps by the ear. Walk tall and do not lean away from it.',
  mb_open_book: 'Knees stacked, top arm opens to the floor. Warm-up only, never a working set.',
  mb_90_90: 'Switch the hips side to side without pushing off the hands. Warm-up only.',
};

export function cueFor(exerciseId: string): string | undefined {
  return CUES[exerciseId];
}

/* -------------------------------------------------------------------------- */
/*  How it is performed, for the movements nothing upstream describes.        */
/*                                                                           */
/*  Seven exercises have no usable record in free-exercise-db: the landmine   */
/*  scoop toss, the cable row with rotation, the standing cable punch, the    */
/*  Bulgarian split squat, the overhead carry and the two mobility drills.    */
/*  An audit of all 876 upstream records found either nothing at all or a     */
/*  different movement wearing a similar name.                                */
/*                                                                           */
/*  Nor is there a photo to borrow. Wikimedia Commons has generic squat and   */
/*  hip images under share-alike licences and nothing for any of these seven, */
/*  and a picture of the wrong movement teaches the wrong movement. So these  */
/*  are written out instead — our own words, about this rack, needing no      */
/*  network and no licence.                                                   */
/*                                                                           */
/*  Ordered as you would do them: set up, move, and the part people get       */
/*  wrong. Short enough to read between sets.                                 */
/* -------------------------------------------------------------------------- */

export const STEPS: Record<string, string[]> = {
  lm_squat_to_press: [
    'Bar end in the landmine, far sleeve held at the shoulder in both hands, feet under the hips.',
    'Squat to depth with the chest tall and the bar close.',
    'Stand hard, and let the press start as the legs finish — one movement, not two.',
    'If the press needs a second effort after standing, the bell is too heavy for this version.',
  ],
  lm_rotational_press: [
    'Bar end in the landmine, far sleeve in one hand at the shoulder, feet in a square athletic stance.',
    'Drive from the back hip, turn through the ribs, and press across the body as you turn.',
    'The bar finishes over the opposite shoulder with the hips square to it.',
    'Turn the feet with the hips. A knee that stays planted while the hips turn is how this one hurts.',
  ],
  bw_side_plank_reach: [
    'Elbow under the shoulder, feet stacked or staggered, hips lifted in one line.',
    'Top arm to the ceiling to start.',
    'Thread that arm under the ribs, turning the chest toward the floor, then open all the way back.',
    'The hips stay up throughout — when they drop, the set is over.',
  ],
  bw_neutral_pull_up: [
    'Neutral handles on the multi-grip bar, palms facing each other.',
    'Start from a dead hang with the shoulders pulled down away from the ears.',
    'Lead with the elbows into the ribs, chest to the bar, and lower under control.',
    'The kindest angle for a cranky shoulder — if it still pinches, narrow the grip rather than swinging.',
  ],
  lm_scoop: [
    'Bar end in the landmine, hands stacked on the far sleeve, held low by one hip.',
    'Athletic stance, weight into the back hip, chest tall.',
    'Push the floor away and turn — hips first, then ribs, then arms — driving the bar up and across to the opposite shoulder.',
    'Catch it and reset between reps. Speed is the point, so stop the set the moment the bar slows down.',
  ],
  cb_rotational_row: [
    'Single handle at chest height. Stand side-on in a split stance, arm long, chest turned toward the pulley.',
    'Row the elbow past the ribs and turn the chest away from the pulley in the same movement.',
    'Finish with the chest open to the handle side and the shoulder blade back.',
    'Unwind in reverse — turn back first, then let the arm out. The lower back does not twist; the ribs do.',
  ],
  cb_punch: [
    'Pulley at chest height, cable in the hand furthest from the stack, split stance facing away.',
    'Drive the back heel into the floor, turn the hips, then the ribs — the arm goes last.',
    'Finish long, hips square to the front, shoulder relaxed away from the ear.',
    'Do not step or lunge into it. The distance comes from the turn.',
  ],
  kb_bulgarian_split: [
    'Back foot on the bench laces down, front foot far enough forward that the shin stays near vertical.',
    'Bell in the front rack or one in each hand, ribs down.',
    'Drop straight down until the back knee is just off the floor, then drive through the front heel.',
    'If the front knee dives inward or the shin runs past the toes, step the front foot further out.',
  ],
  kb_overhead_carry: [
    'Press one bell overhead. Wrist over elbow over shoulder, biceps by the ear.',
    'Ribs down, same-side glute squeezed, eyes forward.',
    'Walk in short steps for the time on the card, then switch sides.',
    'Ends the moment the ribs flare, the arm drifts forward or you start leaning away from the bell.',
  ],
  mb_open_book: [
    'Lie on your side, knees stacked and bent to 90, a towel under the head.',
    'Arms straight out in front, palms together.',
    'Slide the top hand over the bottom one, then open that arm to the floor behind you, following it with your eyes.',
    'The knees stay stacked and glued together — if they come apart, the turn has left the ribs and gone to the lower back.',
  ],
  mb_90_90: [
    'Sit with both knees bent to 90: one leg in front, one out to the side, feet wide.',
    'Sit tall, hands light on the floor for balance only.',
    'Turn both knees to the other side without pushing off the hands, and settle before turning back.',
    'Slow, and no rocking — the range comes from the hips, not from momentum.',
  ],
};

/** The written-out how-to, for the exercises with no upstream record. */
export function stepsFor(exerciseId: string): string[] | undefined {
  return STEPS[exerciseId];
}
