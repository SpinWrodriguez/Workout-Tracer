// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { hapticsEnabled, setHapticsEnabled, tap } from './haptics';

/*
 * The whole feature rides on an undocumented side effect — a `switch` checkbox
 * runs the Taptic Engine when it toggles, because Safari has never implemented
 * the Vibration API. Apple has narrowed it once already, so what is pinned here
 * is not that the phone buzzes: it is that nothing breaks when it does not.
 */

const store = new Map<string, string>();

beforeEach(() => {
  store.clear();
  localStorage.clear();
  document.body.innerHTML = '';
});

afterEach(() => {
  vi.unstubAllGlobals();
});

/** The hidden switch, if one has been made. */
const switchInput = () => document.querySelector('input[type="checkbox"][switch]');

describe('where the API exists', () => {
  it('uses it, and keeps the buzz short', () => {
    const vibrate = vi.fn();
    vi.stubGlobal('navigator', { ...navigator, vibrate });

    tap();

    expect(vibrate).toHaveBeenCalledWith(8);
    // No need for the iPhone workaround where the real thing is available.
    expect(switchInput()).toBeNull();
  });
});

describe('on an iPhone, where it does not', () => {
  beforeEach(() => {
    const stripped = { ...navigator };
    delete (stripped as { vibrate?: unknown }).vibrate;
    vi.stubGlobal('navigator', stripped);
  });

  it('falls back to toggling a hidden switch', () => {
    tap();
    const input = switchInput();
    expect(input).not.toBeNull();
    /* Not display:none — an element with no box is not something iOS treats as
       a switch that moved, and the whole trick is that it thinks one did. */
    expect((input as HTMLElement).style.display).not.toBe('none');
    expect((input as HTMLInputElement).checked).toBe(true);
  });

  it('makes exactly one switch however many taps there are', () => {
    tap();
    tap();
    tap();
    expect(document.querySelectorAll('input[switch]')).toHaveLength(1);
  });

  it('keeps it out of the way of anything that reads the page', () => {
    tap();
    const input = switchInput() as HTMLInputElement;
    expect(input.getAttribute('aria-hidden')).toBe('true');
    expect(input.tabIndex).toBe(-1);
    // A real finger must never land on it; only code toggles it.
    expect(input.style.pointerEvents).toBe('none');
  });
});

describe('turning it off', () => {
  it('is on unless it has been turned off', () => {
    expect(hapticsEnabled()).toBe(true);
  });

  it('does nothing at all once it is off', () => {
    const vibrate = vi.fn();
    vi.stubGlobal('navigator', { ...navigator, vibrate });

    setHapticsEnabled(false);
    tap();

    expect(hapticsEnabled()).toBe(false);
    expect(vibrate).not.toHaveBeenCalled();
    expect(switchInput()).toBeNull();
  });

  it('comes back on', () => {
    setHapticsEnabled(false);
    setHapticsEnabled(true);
    expect(hapticsEnabled()).toBe(true);
  });
});

describe('a device that will not play along', () => {
  it('never throws, because a rep must not depend on a vibration motor', () => {
    vi.stubGlobal('navigator', {
      ...navigator,
      vibrate: () => {
        throw new Error('no motor');
      },
    });
    expect(() => tap()).not.toThrow();
  });

  it('survives blocked storage', () => {
    const getItem = vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('blocked');
    });
    // Defaults to on rather than silently disabling itself.
    expect(hapticsEnabled()).toBe(true);
    expect(() => tap()).not.toThrow();
    getItem.mockRestore();
  });
});
