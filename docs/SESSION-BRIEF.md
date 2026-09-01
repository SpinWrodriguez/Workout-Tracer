# Brief for an unattended session

Paste the opener below into a fresh Claude Code session in this repo. Everything
it needs is in this file and `docs/BACKLOG.md`.

> Read `docs/SESSION-BRIEF.md` and `docs/BACKLOG.md`, then do **item N** from
> the backlog. Follow the standing rules exactly. Commit each coherent step. Do
> not push. When you finish, write a short summary of what you did, what you
> verified, and anything you decided that I should check.

Change `item N` to whichever task you want, and change `Do not push` to
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

The six flows that kept breaking are now guarded by jsdom suites — see
`src/test/dom.ts` and the `*.dom.test.tsx` files. Extend those for a flow they
already touch; they are not a substitute for looking at a layout change, since
jsdom has no layout at all.

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

**Line endings.** Check before you edit — the working tree is CRLF when checked
out on Windows and LF in a Linux container, and `head -1 | grep` will tell you
which. Editing with Python needs `newline=''` on read and the matching value on
write, or replacements silently no-op.

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

- **A workout is not a day, and placement is one week.** `BlockSchedule[slot]`
  is the workout — its name, effort, focus. `DatePlan` says what is on a
  specific date, and it is the only thing generation writes. The optional
  `weekday` is a standing day the user sets deliberately ("Do this every
  Monday") and nothing else may write it: doing so put a generated workout into
  every week of the block at once. Conflating the two is also what made moving
  one Wednesday move every Wednesday. See `src/lib/program.ts`.
- **The week's rules are judged by date.** `ProgramScreen.templateFor` derives a
  workout's weekday from the date it sits on in the week being viewed, and
  validation runs over that week. An unplaced workout is not judged for
  placement, because it has none to be wrong about — inventing a weekday to
  judge it against is how a lat pulldown once passed two days before a round.
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

# Task A — automated UI tests (done)

Kept as a worked example of what "done" looks like for one of these.

**What was built.** `src/test/dom.ts` is the harness: it loads `fake-indexeddb`
before anything reaches for `db`, clears and reseeds between tests, stubs
`scrollIntoView` (jsdom has no layout), and calls testing-library's `cleanup`
explicitly — vitest runs without `globals`, so the automatic one never
registers and renders otherwise stack up in one document.

jsdom is per-file (`// @vitest-environment jsdom`) rather than the global
default: it is far slower to stand up and the four hundred pure-logic tests
have no use for it.

**Covered:** logging a set through the keypad; the save button appearing only
when there is something to save and going away after; creating a workout and
*not* placing it in the week; moving a session to one date without touching the
standing weekday; renaming a workout across a remount; applying the fix on a
spinal-stacking violation.

**How it was verified.** Each behaviour was broken on purpose — a new workout
given a weekday, `movePlanned` writing the pattern instead of the date, the fix
button made a no-op, the name field's blur commit removed, the keypad made to
buffer, the save button made unconditional — and the matching test was
confirmed to fail. Do this for anything new here; a UI test that cannot fail is
worse than no test, because it reads like cover.

**Queried by role and text**, never by test id, and the database is seeded
through `db` rather than clicked through setup.
