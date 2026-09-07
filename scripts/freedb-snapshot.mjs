/**
 * Refreshes src/db/seed/freeDbIds.ts from the live free-exercise-db dataset.
 *
 * That snapshot is what makes the hand-mapped freeDbId values verifiable
 * offline — §9 warns a wrong id fails silently and you never notice which
 * exercise lost its photo. Run this when upstream changes, then run the tests.
 */
import { writeFileSync } from 'node:fs';

const URL_ = 'https://raw.githubusercontent.com/yuhonas/free-exercise-db/main/dist/exercises.json';
const OUT = new URL('../src/db/seed/freeDbIds.ts', import.meta.url);

const response = await fetch(URL_);
if (!response.ok) {
  console.error(`free-exercise-db returned ${response.status} ${response.statusText}`);
  process.exit(1);
}

const records = await response.json();
const ids = [...new Set(records.map((r) => r.id).filter(Boolean))].sort();

/*
 * The records that carry a photo but no words. A mapped exercise pointing at
 * one of these shows its reference photo and then nothing — no numbered steps
 * at all — unless we wrote our own, and the failure is silent in exactly the
 * way a wrong id is. Snapshotting the list is what lets a test say so.
 */
const wordless = records
  .filter((r) => r.id && (!Array.isArray(r.instructions) || r.instructions.length === 0))
  .map((r) => r.id)
  .sort();

const header = `/*
 * Snapshot of every exercise id in yuhonas/free-exercise-db, taken from
 * dist/exercises.json. Imported only by the seed test, never by app code, so it
 * costs nothing in the bundle.
 *
 * Its whole job is to make the hand-mapped freeDbId values in exercises.ts
 * verifiable offline. §9 warns that a wrong id fails silently and you never
 * notice which exercise lost its photo — this turns that into a red test.
 *
 * FREE_DB_WITHOUT_INSTRUCTIONS is the same idea one step further: a handful of
 * upstream records have a photo and no words, and an exercise mapped to one
 * loses its steps just as quietly.
 *
 * Refresh with: npm run freedb:snapshot
 */
export const FREE_DB_IDS: string[] = [
`;

const quote = (id) => `  '${id.replace(/'/g, "\\'")}',`;

writeFileSync(
  OUT,
  `${header}${ids.map(quote).join('\n')}\n];\n\n` +
    `/** Upstream records with a photo but no instructions. */\n` +
    `export const FREE_DB_WITHOUT_INSTRUCTIONS: string[] = [\n${wordless
      .map(quote)
      .join('\n')}\n];\n`,
);
console.log(
  `wrote ${ids.length} ids to src/db/seed/freeDbIds.ts, ${wordless.length} of them wordless`,
);
