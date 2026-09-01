# AI workout generation — prompt draft

Draft only. Nothing here is wired up: the transport does not exist yet
(backlog item 1, how the app gets an API key, still blocks it). The prompt and
the output contract are the parts that do not depend on that decision, so they
can be settled first and reviewed on their own.

Goal, in the user's words: pass the workouts already created, the whole exercise
list, and a plain-language goal — *"today I feel tired, generate a nice easy
workout"* — and get back JSON that loads into the Program tab.

---

## 1. Where this plugs in

`fillDay` in `src/lib/blockBuilder.ts` is the seam, and the shape of that seam
is the whole design:

> `fillDay` is handed the pattern targets, effort, exclusions and a time budget
> **for one day**, and never sees or picks a date.

So the model **replaces the selector, not the scheduler**. It chooses which
exercises fill a workout. It does not choose a weekday, it is not told which
weekday, and it cannot be — which is what makes it structurally incapable of
putting a deadlift the day before a round.

```
goal + library + existing workouts
        │
        ▼
   askModel()                     ← the only new I/O
        │  proposal (ids, sets, reps)
        ▼
   validateBlock()                ← recomputes; does not trust the model
        │  violations?
        ├─ yes → formatViolationsForModel() → retry, bounded by
        │        MAX_VALIDATION_ATTEMPTS (already 3)
        └─ no  → writeDay() → Program tab
```

Turning it off must fall back to the deterministic selector with no behaviour
change. That is the acceptance bar in backlog item 3 and it is not negotiable:
the app has to work on a train with no signal.

### One thing the model does get to decide

The free-text goal has to be able to say "easy today". `focus` and `intensity`
are already first-class on a workout, so the model returns them as part of its
answer. What it does **not** get is the constraints those imply — the grip
exclusion, the spinal limit, the time budget and the rep shift are all derived
by `workoutTemplate()` from the focus and intensity it returned, then enforced
by the validator. The model proposes *what kind of session*; the app decides
what that means.

---

## 2. What gets sent

Two payloads, deliberately ordered for prompt caching. The library and the
rules are identical on every call and go first, behind a cache breakpoint; the
goal and the current week change every call and go last.

### 2a. The exercise library (stable, cached)

All 73 rows minus the 2 `isMobility` ones — mobility work is never programmed
as a working set, so offering it invites a violation. Trimmed to the fields
selection actually needs:

```json
{ "id": "bb_rdl", "name": "Romanian deadlift", "pattern": "hinge",
  "primary": ["hamstrings", "glutes"], "secondary": ["lower_back", "lats"],
  "station": "free_bar", "gripLoad": "high", "spinalLoad": "high",
  "isHinge": true, "isExplosive": false, "skill": "intermediate",
  "reps": [6, 10], "unit": "reps" }
```

Dropped on purpose: `loadMultiplier`, `barWeight`, `attachment`, `freeDbId`,
`restSeconds`. None of them inform *which exercise to pick*, and `restSeconds`
in particular would invite the model to compute a time budget the app already
computes. Roughly 6-7k tokens, well past the caching minimum.

`reps` is that exercise's own `[repMin, repMax]` and `unit` is its `repUnit`.
Both must travel: a Turkish get-up is 1-5 reps and a plank is measured in
seconds. A global rep range applied to either is nonsense, and the validator
rejects it as `rep_range`.

### 2b. The request (volatile, after the breakpoint)

```json
{ "goal": "today I feel tired, generate a nice easy workout",
  "existingWorkouts": [
    { "slot": "A", "name": "Upper Body + Core", "focus": "upper",
      "intensity": "heavy", "exerciseIds": ["bb_overhead_press", "bw_chin_up"] }
  ],
  "history": [
    { "id": "bb_back_squat", "lastTopSetKg": 50, "weeksSinceUsed": 1 }
  ] }
```

`existingWorkouts` is what stops the new workout repeating the week. It is
scoped to what is **in the block** — never to what an earlier discarded
proposal suggested, which is the trap the comment above `pickFrom` documents:
exclusion is subtractive, so feeding it rejected proposals walks the quality
downhill on every press.

`history` is optional and small. It is what a model can do that the
deterministic selector cannot — notice a lift has not moved in five weeks.
Leave it out of v1 if it complicates the first cut.

---

## 3. The system prompt

```
You choose exercises for one workout in a home gym, from a fixed list.

The gym is a Cortex SM-26 multi-gym, an Olympic barbell, a few kettlebells and
bands, in a garage. The lifter is a returning intermediate training two, at
best three times a week around weekend golf. Sessions are about 40 minutes.

You will be given the complete exercise library, the workouts already in the
current block, and a goal in the lifter's own words. Return one workout.

Rules:

- Use only `id` values from the library. Never invent an exercise, a name, or
  an id. An id that is not in the library fails the whole response.
- Respect each exercise's own `reps` bounds and `unit`. A hold measured in
  seconds is not a number of reps.
- Do not repeat what the other workouts in the block already contain, unless
  the goal explicitly asks for it.
- Read the goal for effort and emphasis and set `focus` and `intensity` from
  it. "Tired", "easy", "gentle" mean `intensity: "light"`. Trust the words:
  a request for an easy session is not an invitation to program a hard one
  differently.
- Order the exercises the way they should be performed. Explosive work first,
  then hinges while the position still holds, then everything else. A hinge
  late in a fatigued session is a form risk.
- Two exercises with `spinalLoad: "high"` in one workout is a mistake.

Say nothing about the calendar. You are not told which day this workout falls
on, how far it is from a round, or what else is scheduled that week, and any
statement you make about spacing, rest days, recovery or being clear of
anything will be wrong and will be discarded. The `why` field is for why these
exercises suit this goal — nothing else.

Your answer is a proposal. Every id, rep range, set count and weight is
recomputed against the real inventory and the real calendar before anything is
shown. If a rule is broken you will be given the specific violations and asked
to return the whole workout again.
```

Notes on the wording, since some of it is load-bearing:

**The calendar paragraph is not boilerplate.** `stripScheduleClaims` exists in
`blockValidation.ts` because a model already claimed a Thursday session was
"clear of Sat and Sun by at least 3 days" when it was two days out. The prompt
now forbids it *and* the code still strips it. Telling a model not to lie is
not a substitute for not trusting it.

**"Your answer is a proposal"** is there deliberately. A model told its output
will be checked hedges less and invents less than one that believes it is the
final word.

**No worked example.** With a strict output schema (below) the shape is already
guaranteed, and a single example of a "good" workout biases selection toward
whatever that example contained. If real use shows the model misreading the
*goal* — not the format — add examples of goal → focus/intensity mappings only.

---

## 4. The output contract

Use structured outputs (`output_config: { format: ... }`), not a "return only
JSON" instruction. The API then guarantees the shape, which removes an entire
class of parse-failure handling and makes the prompt shorter.

```json
{
  "type": "json_schema",
  "name": "workout",
  "schema": {
    "type": "object",
    "additionalProperties": false,
    "required": ["name", "focus", "intensity", "why", "exercises"],
    "properties": {
      "name": { "type": "string", "maxLength": 40 },
      "focus": { "enum": ["full", "upper", "lower", "push", "pull", "core"] },
      "intensity": { "enum": ["heavy", "light"] },
      "why": { "type": "string", "maxLength": 300 },
      "exercises": {
        "type": "array", "minItems": 3, "maxItems": 7,
        "items": {
          "type": "object",
          "additionalProperties": false,
          "required": ["exerciseId", "sets", "repLow", "repHigh"],
          "properties": {
            "exerciseId": { "type": "string" },
            "sets": { "type": "integer", "minimum": 1, "maximum": 5 },
            "repLow": { "type": "integer", "minimum": 1, "maximum": 120 },
            "repHigh": { "type": "integer", "minimum": 1, "maximum": 120 }
          }
        }
      }
    }
  }
}
```

Note what is **absent**: no `weekday`, no `date`, no `slot`. The model cannot
express a placement, so it cannot get one wrong. The slot is assigned by
`freeSlot()` exactly as `createWorkout` does today, and where it lands in the
week stays a separate act on the calendar.

`repLow`/`repHigh` are bounded loosely here because the real bound is
per-exercise and the schema cannot express it. `workingRepRange()` clamps them
to that exercise's own `repMin`/`repMax`, and the validator reports `rep_range`
if the model strayed. The wide schema bound is the loose outer fence; the
per-exercise clamp is the real one.

`why` maps onto an input that already exists: `GenerateInput.modelRationale`
in `blockBuilder.ts`, documented as *"Model prose, if a proposal came from one.
Schedule claims are stripped."* So the seam for the model's prose is already
built, already sanitised, and already recombined with a `scheduleSentence()`
the app generates from the validated calendar. Feed `why` into it and the
rationale the user reads is the model's reasoning plus the app's facts, with
the model's facts removed.

`name` and `why` are the two fields worth having a model write. Everything else
it returns is a decision the deterministic selector could also make — but
"Tired Legs Maintenance" and a sentence explaining the choice are not.
`describeDay()` still generates a fallback name if `name` is unusable.

### Mapping to what the Program tab loads

```
proposal.exercises[i]  →  BlockExercise {
  blockId,                              // caller
  exerciseId,                           // model, validated against the library
  daySlot,                              // caller — freeSlot()
  targetSets: sets,                     // model, clamped
  repRangeLow/High: workingRepRange(),  // model, clamped per exercise
  order: i,                             // model's ordering, preserved
  startWeightKg                         // NOT from the model — snapped to a
}                                       // real rung by loadableWeights()
```

`startWeightKg` is deliberately not in the schema. Asking a model for a weight
invites `unloadable_weight` violations, and the app already knows every weight
the plates can actually make. Let it come from the ladder and last session's
top set.

Then `ScheduledDay { focus, intensity, name, generated: true, variant: 0 }` —
the same row `createWorkout` writes today, so the workout is indistinguishable
from a hand-made one afterwards and every existing control keeps working.

---

## 5. The retry turn

`formatViolationsForModel()` already produces exactly the right text:

```
The previous response was rejected. Fix every point below and return the whole
block again:
1. [rep_range] Romanian deadlift asks for 12-15 reps; 6-10 is its range.
2. [spinal_stacking] Back squat and Romanian deadlift both load the spine heavily.
```

Append it as a user turn with the previous assistant message intact, and ask
again. Bounded by `MAX_VALIDATION_ATTEMPTS` (3). If it still fails, fall back
to the deterministic selector silently — the user asked for a workout, not for
an apology about a model.

Only `problem`-severity violations should trigger a retry. Retrying on
`suggestion` (a session seven minutes long) spends money and latency on
something the lifter is allowed to overrule anyway.

---

## 6. Request settings

Model `claude-opus-5`, adaptive thinking, and the caching breakpoint after the
library. Effort `medium` is likely right — this is constrained selection from a
73-row list, not open-ended reasoning — but that is worth measuring against
`high` on real goals before fixing it.

One call per generated workout. This must never run on app open, on the Program
tab rendering, or per session — the deterministic path stays the default and
the model is something the lifter asks for by pressing a button.

---

## 7. Open questions

1. **Transport.** Still backlog item 1. Nothing here is buildable until an
   `askModel()` exists. The Supabase Edge Function option keeps the key
   server-side and reuses the auth that already guards `workout_data`; the
   pasted-key option is far less work but puts the key in `localStorage` on
   every device separately.
2. **Is `history` in v1?** It is the most interesting input and the one most
   likely to make the payload awkward. Easy to add later.
3. **Effort level.** Guessing `medium`. Measure.
4. **Failure visibility.** When all three attempts fail, does the lifter get a
   silently deterministic workout, or a note saying the model was overruled? I
   lean towards a quiet note — a silent swap makes "why is this different from
   what I asked for" unanswerable.
