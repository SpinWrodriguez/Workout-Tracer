import { useEffect, useMemo, useState } from 'react';
import { readInventory, writeInventory } from '../db/settings';
import { kg } from '../lib/format';
import {
  DEFAULT_INVENTORY,
  cableStackWeights,
  loadableWeights,
  type Inventory,
  type PlatePair,
} from '../lib/loadable';
import { Card, Label } from './Layout';

/* -------------------------------------------------------------------------- */
/*  Plate inventory editor — spec Phase 2.                                    */
/*                                                                            */
/*  Every ladder in the app derives from this, so the generated rungs are      */
/*  shown right below the inputs: if the inventory is wrong, the ladder makes  */
/*  it obvious immediately.                                                    */
/* -------------------------------------------------------------------------- */

const PLATE_OPTIONS = [25, 20, 15, 10, 5, 2.5, 2, 1.5, 1.25, 1];
const BELL_OPTIONS = [8, 10, 12, 16, 20, 24, 28, 32];

function NumberField({
  label,
  value,
  onChange,
  suffix,
  step = 1,
}: {
  label: string;
  value: number;
  onChange: (next: number) => void;
  suffix?: string;
  step?: number;
}) {
  return (
    <label className="flex-1">
      <Label>{label}</Label>
      <span className="mt-1.5 flex h-11 items-center rounded-xl bg-surface-2 px-3">
        <input
          type="number"
          inputMode="decimal"
          min={0}
          step={step}
          value={value}
          onChange={(event) => onChange(Number(event.target.value))}
          className="w-full bg-transparent text-[15px] font-medium outline-none"
        />
        {suffix && <span className="ml-1 text-[12px] font-medium text-text-dim">{suffix}</span>}
      </span>
    </label>
  );
}

export function InventoryEditor() {
  const [inventory, setInventory] = useState<Inventory | null>(null);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    void readInventory().then(setInventory);
  }, []);

  const patch = (next: Partial<Inventory>) => {
    setInventory((prev) => (prev ? { ...prev, ...next } : prev));
    setSaved(false);
  };

  const ladders = useMemo(() => {
    if (!inventory) return null;
    return {
      free: loadableWeights(inventory.barWeights.free_bar, inventory.plates),
      smith: loadableWeights(inventory.barWeights.smith, inventory.plates),
      hand: loadableWeights(0, inventory.plates),
      cable: cableStackWeights(inventory.cableStackKg, inventory.cableStepKg),
    };
  }, [inventory]);

  if (!inventory || !ladders) {
    return (
      <Card title="Equipment">
        <Label>--</Label>
      </Card>
    );
  }

  const setPlate = (index: number, next: Partial<PlatePair>) =>
    patch({
      plates: inventory.plates.map((plate, i) => (i === index ? { ...plate, ...next } : plate)),
    });

  const save = async () => {
    await writeInventory(inventory);
    setSaved(true);
  };

  const ladderRow = (label: string, rungs: number[]) => (
    <div className="mt-3">
      <div className="flex items-baseline justify-between gap-3">
        <Label>{label}</Label>
        <Label>
          {rungs.length} rungs · ceiling {rungs.length ? kg(rungs.at(-1) as number) : '--'} kg
        </Label>
      </div>
      <p className="mt-1 text-[12px] leading-relaxed font-medium text-text-dim">
        {rungs.length === 0 ? '--' : rungs.map((r) => kg(r)).join('  ')}
      </p>
    </div>
  );

  return (
    <>
      <Card title="Plate inventory">
        <p className="text-[13px] text-text-dim">
          Counted in pairs — a bar takes one plate from each pair per side. Every weight input in
          the app snaps to what this can actually load.
        </p>

        <div className="mt-3">
          {inventory.plates
            .slice()
            .sort((a, b) => b.kg - a.kg)
            .map((plate) => {
              const index = inventory.plates.indexOf(plate);
              return (
                <div key={`${plate.kg}-${index}`} className="flex items-center gap-2 py-1.5">
                  <span className="w-20 text-[15px] font-semibold">{kg(plate.kg)} kg</span>
                  <div className="flex flex-1 items-center justify-end gap-2">
                    <button
                      type="button"
                      onClick={() => setPlate(index, { pairs: Math.max(0, plate.pairs - 1) })}
                      className="size-9 rounded-xl bg-surface-2 text-lg font-semibold"
                      aria-label={`One fewer pair of ${plate.kg} kg`}
                    >
                      −
                    </button>
                    <span className="w-16 text-center text-[15px] font-semibold">
                      {plate.pairs}
                      <span className="ml-1 text-[11px] font-medium text-text-dim">
                        {plate.pairs === 1 ? 'pair' : 'pairs'}
                      </span>
                    </span>
                    <button
                      type="button"
                      onClick={() => setPlate(index, { pairs: plate.pairs + 1 })}
                      className="size-9 rounded-xl bg-surface-2 text-lg font-semibold"
                      aria-label={`One more pair of ${plate.kg} kg`}
                    >
                      +
                    </button>
                    <button
                      type="button"
                      onClick={() =>
                        patch({ plates: inventory.plates.filter((_, i) => i !== index) })
                      }
                      className="ml-1 text-[12px] font-medium text-text-dim"
                    >
                      Remove
                    </button>
                  </div>
                </div>
              );
            })}
        </div>

        <Label className="mt-3 block">Add a plate size</Label>
        <div className="no-scrollbar -mx-1 mt-1.5 flex gap-1.5 overflow-x-auto px-1">
          {PLATE_OPTIONS.filter((size) => !inventory.plates.some((p) => p.kg === size)).map(
            (size) => (
              <button
                key={size}
                type="button"
                onClick={() => patch({ plates: [...inventory.plates, { kg: size, pairs: 1 }] })}
                className="shrink-0 rounded-lg bg-surface-2 px-2.5 py-1.5 text-xs font-medium text-text-dim"
              >
                + {kg(size)}
              </button>
            ),
          )}
        </div>

        <div className="mt-4 flex gap-3">
          <NumberField
            label="Free bar"
            value={inventory.barWeights.free_bar}
            suffix="kg"
            step={0.5}
            onChange={(free_bar) => patch({ barWeights: { ...inventory.barWeights, free_bar } })}
          />
          <NumberField
            label="Smith bar"
            value={inventory.barWeights.smith}
            suffix="kg"
            step={0.5}
            onChange={(smith) => patch({ barWeights: { ...inventory.barWeights, smith } })}
          />
        </div>

        {ladderRow('Free bar ladder', ladders.free)}
        {ladderRow('Smith ladder', ladders.smith)}
      </Card>

      <Card title="Kettlebells and hand-held" className="mt-3">
        <p className="text-[13px] text-text-dim">
          Goblet squats, carries and loaded split squats snap to these plus anything the plates can
          make.
        </p>
        <div className="mt-3 flex flex-wrap gap-1.5">
          {inventory.kettlebells
            .slice()
            .sort((a, b) => a - b)
            .map((bell) => (
              <button
                key={bell}
                type="button"
                onClick={() =>
                  patch({ kettlebells: inventory.kettlebells.filter((k) => k !== bell) })
                }
                className="rounded-lg bg-surface-2 px-2.5 py-1.5 text-xs font-medium"
              >
                {kg(bell)} kg <span className="ml-0.5 text-text-dim">×</span>
              </button>
            ))}
          {inventory.kettlebells.length === 0 && <Label>--</Label>}
        </div>
        <Label className="mt-3 block">Add a kettlebell</Label>
        <div className="no-scrollbar -mx-1 mt-1.5 flex gap-1.5 overflow-x-auto px-1">
          {BELL_OPTIONS.filter((size) => !inventory.kettlebells.includes(size)).map((size) => (
            <button
              key={size}
              type="button"
              onClick={() => patch({ kettlebells: [...inventory.kettlebells, size] })}
              className="shrink-0 rounded-lg bg-surface-2 px-2.5 py-1.5 text-xs font-medium text-text-dim"
            >
              + {size}
            </button>
          ))}
        </div>
        {ladderRow('Hand-held ladder', ladders.hand)}
      </Card>

      <Card title="Cable stacks" className="mt-3">
        <div className="flex gap-3">
          <NumberField
            label="Stack"
            value={inventory.cableStackKg}
            suffix="kg"
            step={5}
            onChange={(cableStackKg) => patch({ cableStackKg })}
          />
          <NumberField
            label="Selector step"
            value={inventory.cableStepKg}
            suffix="kg"
            step={0.5}
            onChange={(cableStepKg) => patch({ cableStepKg })}
          />
        </div>
        {ladderRow('Stack selections', ladders.cable)}
        <p className="mt-3 text-[12px] font-medium text-text-dim">
          Ratios stay per-exercise on the seeded rows — ×0.49 single pulley, ×0.98 both pulleys,
          ×1.0 dual adaptor — because one global number cannot tell a single-arm row from a
          pulldown.
        </p>
      </Card>

      <div className="mt-3 flex gap-2">
        <button
          type="button"
          onClick={() => patch(DEFAULT_INVENTORY)}
          className="h-11 flex-1 rounded-full bg-surface-2 font-medium text-text-dim"
        >
          Reset to spec
        </button>
        <button
          type="button"
          onClick={() => void save()}
          className="h-11 flex-1 rounded-full bg-cta font-semibold text-bg"
        >
          {saved ? 'Saved' : 'Save equipment'}
        </button>
      </div>
    </>
  );
}
