// @vitest-environment jsdom

import '../test/dom';

import { screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { setHapticsEnabled } from '../lib/haptics';
import { draw, user } from '../test/dom';
import { HapticTick } from './HapticTick';

/*
 * The overlay is a real switch laid over a button, because on iOS 26.5 and
 * later a tick only comes from a finger landing on one — script cannot ring it.
 * Nothing here can test that a phone buzzes. What it can test is everything
 * around it that would quietly stop the buzz happening, all of which looks
 * harmless in a diff:
 *
 *   - styling the control away, which is the obvious tidy-up and kills it
 *   - dropping the clip, which hands it taps from outside the button
 *   - swallowing the click, which would break the action to keep the tick
 */

function Button({ onClick }: { onClick: () => void }) {
  return (
    <button type="button" onClick={onClick} className="relative">
      Save
      <HapticTick />
    </button>
  );
}

const overlay = () => document.querySelector('input[type="checkbox"][switch]');

describe('the switch laid over a button', () => {
  it('is a real switch, which is the only reason iOS ticks', () => {
    draw(<Button onClick={vi.fn()} />);
    const input = overlay() as HTMLInputElement;
    expect(input).not.toBeNull();
    // `switch` has to be the attribute; a class or a data- flag is just a
    // checkbox and checkboxes do not tick.
    expect(input.getAttribute('switch')).toBe('');
  });

  it('keeps its native look, hidden only by opacity', () => {
    draw(<Button onClick={vi.fn()} />);
    const input = overlay() as HTMLElement;
    /* Stripping the appearance is the reflex, and it disables the haptic —
       WebKit only rings for a control it is still drawing. So: transparent,
       never restyled and never display:none. */
    expect(input.className).toContain('opacity-0');
    expect(input.className).not.toContain('appearance-none');
    expect(input.className).not.toContain('hidden');
  });

  it('covers the button and is clipped to it', () => {
    draw(<Button onClick={vi.fn()} />);
    const input = overlay() as HTMLElement;
    // Full size, or the uncovered parts of the button feel dead.
    expect(input.className).toContain('inset-0');
    expect(input.className).toContain('size-full');
    // Clipped, or the control's own shape takes taps beyond the button.
    expect(input.style.clipPath).toMatch(/^inset\(0 round \d+px\)$/);
  });

  it('lets the tap through to the button underneath', async () => {
    const onClick = vi.fn();
    draw(<Button onClick={onClick} />);
    const ui = user();

    // What a thumb actually hits: the overlay, not the button.
    await ui.click(overlay() as HTMLElement);

    /* Nested inside the button so the click keeps its normal path. A
       re-dispatched click would be the alternative, and re-dispatched clicks
       are how this sort of thing starts firing twice. */
    await waitFor(() => expect(onClick).toHaveBeenCalledTimes(1));
  });

  it('stays out of the way of anything reading the page', () => {
    draw(<Button onClick={vi.fn()} />);
    const input = overlay() as HTMLInputElement;
    expect(input.getAttribute('aria-hidden')).toBe('true');
    expect(input.tabIndex).toBe(-1);
    // The button is still the thing with the name and the role.
    expect(screen.getByRole('button', { name: 'Save' })).toBeTruthy();
  });
});

describe('when it is turned off', () => {
  it('is not there at all, since the element is the feature', () => {
    setHapticsEnabled(false);
    draw(<Button onClick={vi.fn()} />);
    /* Off has to mean gone. The tick comes from iOS reacting to the switch,
       so a switch left on the page would keep ticking however the app felt
       about it. */
    expect(overlay()).toBeNull();
    setHapticsEnabled(true);
  });

  it('is still there for the Settings test, which asks about the phone', () => {
    setHapticsEnabled(false);
    draw(
      <button type="button" className="relative">
        Tap here to feel it
        <HapticTick force />
      </button>,
    );
    expect(overlay()).not.toBeNull();
    setHapticsEnabled(true);
  });
});
