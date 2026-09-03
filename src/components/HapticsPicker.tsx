import { useState } from 'react';
import { hapticsEnabled, setHapticsEnabled, testTap } from '../lib/haptics';
import { Card, Label, SegmentedToggle } from './Layout';

/* -------------------------------------------------------------------------- */
/*  The tap you feel.                                                        */
/*                                                                           */
/*  With a Test row, which is not decoration: whether this works at all is a  */
/*  property of the phone and its iOS version, and the only way anyone finds  */
/*  out is by feeling it. Apple never shipped the Vibration API, so on an     */
/*  iPhone this rides on a side effect of a switch control that Apple has     */
/*  already narrowed once. One tap here answers it.                          */
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
            // Fired from the tap that turned it on, which is the only moment
            // iOS will allow it.
            if (next === 'on') testTap();
          }}
        />
      </div>

      <button
        type="button"
        onClick={() => testTap()}
        className="mt-3 h-11 w-full rounded-full bg-surface-2 text-[14px] font-medium"
      >
        Test it
      </button>

      <Label className="mt-2 block">
        Nothing? Then this iPhone's version has closed the door — the app cannot tell the
        difference, and nothing else changes.
      </Label>
    </Card>
  );
}
