// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { needsSwitchOverlay, tap } from './haptics';

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

describe('where a real vibration API exists', () => {
  it('uses it, and keeps the buzz short', () => {
    const vibrate = vi.fn();
    vi.stubGlobal('navigator', { ...navigator, vibrate });

    tap();

    expect(vibrate).toHaveBeenCalledWith(8);
  });

  it('says the switch overlay is not needed there', () => {
    vi.stubGlobal('navigator', { ...navigator, vibrate: vi.fn() });
    expect(needsSwitchOverlay()).toBe(false);
  });
});

describe('on iOS, where there is none', () => {
  beforeEach(() => {
    const stripped = { ...navigator };
    delete (stripped as { vibrate?: unknown }).vibrate;
    vi.stubGlobal('navigator', stripped);
  });

  it('asks for the switch overlay instead', () => {
    /* The first version poked a hidden switch from inside the click handler.
       iOS 26.5 closed that: only a finger landing on a real switch fires the
       Taptic Engine now, which is what HapticTick is for. */
    expect(needsSwitchOverlay()).toBe(true);
  });

  it('does not pretend to buzz', () => {
    expect(() => tap()).not.toThrow();
    expect(document.querySelector('input[switch]')).toBeNull();
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

});
