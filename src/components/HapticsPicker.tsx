import { useState } from 'react';
import { hapticsEnabled, setHapticsEnabled } from '../lib/haptics';
import { Card, Label, SegmentedToggle } from './Layout';
import { HapticTick } from './HapticTick';

/* -------------------------------------------------------------------------- */
/*  The tap you feel.                                                        */
/*                                                                           */
/*  The Test row is the same mechanism as the real buttons, not a simulation  */
/*  of it — it cannot be anything else, because on current iOS a tick only    */
/*  comes from a finger landing on a switch and never from script. So this    */
/*  button carries one too, and answering "does this phone still do it" is    */
/*  one tap.                                                                  */
/* -------------------------------------------------------------------------- */

const CHOICES = ['on', 'off'] as const;
const LABELS = { on: 'On', off: 'Off' };

export function HapticsPicker() {
  const [choice, setChoice] = useState<(typeof CHOICES)[number]>(() =>
    hapticsEnabled() ? 'on' : 'off',
  );

  return (
    <Card title="Tap feedback" collapsible summary={choice === 'on' ? 'On' : 'Off'}>
      <p className="text-[13px] text-text-dim">
        A small tick when a set is marked done, a session starts and a workout saves. Stored on
        this device only, so it is not part of a backup.
      </p>

      <div className="mt-3">
        <SegmentedToggle
          options={CHOICES}
          value={choice}
          labels={LABELS}
          onChange={(next) => {
            setChoice(next);
            setHapticsEnabled(next === 'on');
          }}
        />
      </div>

      {/* force, because this has to work even while the setting is off: its
          job is to say whether the phone is capable, not whether the app is
          currently asking. */}
      <button
        type="button"
        className="relative mt-3 h-11 w-full rounded-full bg-surface-2 text-[14px] font-medium"
      >
        Tap here to feel it
        <HapticTick force />
      </button>

      <Label className="mt-2 block">
        Nothing? Then this iPhone's iOS has closed the door on it. Apple has never shipped a
        vibration API for the web, so this rides on a switch control and they have narrowed it
        twice already.
      </Label>
    </Card>
  );
}
