import { db } from './db';
import { DEFAULT_INVENTORY, clearLadderCache, type Inventory } from '../lib/loadable';

/* -------------------------------------------------------------------------- */
/*  Settings are key-value rows so a new one never needs a schema bump.        */
/*  Reads merge over the defaults, so a partially written row still boots.     */
/* -------------------------------------------------------------------------- */

export const INVENTORY_KEY = 'inventory';

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
