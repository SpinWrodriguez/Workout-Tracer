# Brief for an unattended session

Paste the opener below into a fresh Claude Code session in this repo. Everything
it needs is in this file and `docs/BACKLOG.md`.

> Read `docs/SESSION-BRIEF.md` and `docs/BACKLOG.md`, then do **Task A** from
> the brief. Follow the standing rules exactly. Commit each coherent step. Do
> not push. When you finish, write a short summary of what you did, what you
> verified, and anything you decided that I should check.

Change `Task A` to whichever task you want, and change `Do not push` to
`Push when the suite is green` if you want it deployed while you sleep — see
**Committing and pushing** for why the default is not to.

---

## What this app is

Workout Tracer: a personal hypertrophy tracker for a garage gym, scheduled
around weekend golf. React 19 + TypeScript + Vite, Tailwind v4, Dexie over
IndexedDB, installed as a PWA on an iPhone. Deployed to GitHub Pages at
`/Workout-Tracer/`. `docs/SPEC.md` is the original build spec.

One user. His live data is in the deployed origin's IndexedDB and in Supabase
`workout_data`. There is no staging environment.

## Standing rules

**Build gate.** `npm run build` is the gate — it runs `tsc -b`, which includes
the test files. `npx tsc -p tsconfig.app.json` does **not** and has let a broken
build through twice. Also run `npm test` and `npx oxlint src`.

**Verify in a browser.** Every UI claim in this project has been checked by
driving real Chrome. Do not report a UI change as working on the strength of a
passing typecheck.

```bash
npm run build
npx vite preview --port 4300 --strictPort &
# then drive http://localhost:4300/Workout-Tracer/ with puppeteer-core
```

`puppeteer-core` is installed (not saved to package.json — reinstall with
`npm i --no-save puppeteer-core` if an `npm install` has removed it). Chrome is
at `C:/Program Files/Google/Chrome/Application/chrome.exe`. Two gotchas that
have wasted time before: click via `element.click()` inside `page.evaluate`
rather than by coordinate, because the fixed bottom nav intercepts real clicks
near the fold; and `innerText` returns uppercase for `.screen-title` elements,
so match case-insensitively or on body text rather than headings.

**Scratch files** go in `.scratch/` (gitignored). Delete them before committing.

**Line endings.** The working tree is CRLF. Editing files with Python needs
`newline=''` on read and `newline='\r\n'` on write, or replacements silently
no-op. There is a helper pattern in the git history.

## Committing and pushing

Commit each coherent step with a message that says **why**, not what — the
diff already says what. Match the existing history's style.

**The default is: do not push.** A push triggers the Pages workflow and lands
on the user's phone within about two minutes. Unattended and unreviewed, that
is not a good default for a personal app someone trains with. Commit locally and
let him review in the morning.

Note that something in this environment has auto-pushed commits before. If you
see your commits reach `origin` without you pushing, say so in your summary
rather than assuming it was intended.

## Architecture you must not break

These are load-bearing and were each the fix for a real bug. Read the comments
at the top of the file before changing any of them.

- **A workout is not a day.** `BlockSchedule[slot]` is the workout — its name,
  effort, and the weekday it *usually* falls on (optional). `DatePlan` says what
  is on a specific date and wins over the pattern. Conflating them is what made
  moving one Wednesday move every Wednesday. See `src/lib/program.ts`.
- **Nothing self-reports compliance.** `blockValidation.ts` recomputes rather
  than trusting what a generator claims. If you add a model anywhere, its output
  is a proposal to be validated, never an answer.
- **The generator never picks a date.** `fillDay` gets pattern targets, effort,
  exclusions and a time budget for one day. That is why it cannot put a deadlift
  the day before a round.
- **Variety is rotation, not exclusion.** Regeneration must not ban what a
  previous attempt proposed — that walks downhill on every press. See the
  comment above `pickFrom` in `blockBuilder.ts`.
- **Sync: local edits win, and "empty" means nothing the user made** — not
  merely "no sessions logged". Getting that wrong silently discarded a week of
  program edits. See `workoutSync.ts`.
- **Units.** Holds and carries are counted in seconds (`Exercise.repUnit`).
  Resolve through `src/lib/repUnit.ts`; never assume reps.

## Style

Match the surrounding code. Comments explain *why* something is the way it is,
especially where it is non-obvious or was a bug — not what the line does. Tests
are named as sentences about behaviour and carry the reasoning for the case.
Prefer deleting a thing over adding a flag to it.

If you find a bug outside your task, fix it if it is small and mention it, or
add it to `docs/BACKLOG.md` if it is not.

---

# Task A — automated UI tests

**Why this one.** Every UI claim here has been verified by hand-driving Chrome
from throwaway scripts. That caught real bugs — a keypad covering the RIR badge,
setup controls silently resetting, a save button that never appeared — but
nothing guards them afterwards. This is the highest-leverage task in the backlog
and the only one that needs no decisions from the user.

**Set up.** There is no DOM test environment yet: vitest runs in `node` with
`fake-indexeddb`. Add `jsdom`, `@testing-library/react`, `@testing-library/dom`
and `@testing-library/user-event` as dev dependencies. Keep the existing
node-environment tests working — use a per-file environment docblock
(`// @vitest-environment jsdom`) rather than switching the global default, so
the 348 existing tests are untouched.

**Cover these flows.** Each has broken at least once:

1. **Log a set.** Start a programmed session, enter a weight and reps on the
   custom keypad, mark the set done, save. Assert the `setLog` rows.
2. **Save only when there is something to save.** No save button on a clean
   session; it appears once a set is logged; it goes away after saving.
3. **Create a workout.** New workout → a focus and an effort → it appears in
   the list, is named from its contents, and is **not** placed in the week.
4. **Move a session to another date.** Via the day editor, not drag — jsdom's
   pointer support is too weak for the drag path, and `planDate` is already
   unit-tested. Assert the other weeks are unaffected.
5. **Rename a workout** and assert the name survives a remount.
6. **Fix a rule violation.** Stack two heavy spinal lifts, assert the problem
   appears with a fix, apply it, assert it clears.

**Watch out for.** `useLiveQuery` resolves asynchronously — use `findBy*` and
`waitFor`, never a bare `getBy*` straight after an action. Seed the database
directly through `db` rather than clicking through setup. Reset Dexie between
tests the way `workoutSync.test.ts` does.

**Done when:** `npm test` covers those six flows in a real DOM, they fail when
the behaviour breaks (prove it by breaking one on purpose and putting it back),
and the existing suite still passes.

**Do not:** refactor components to make them easier to test, add test ids
throughout, or pull in a browser-mode runner. Query the way a user would — by
role and text.
