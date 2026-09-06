// @vitest-environment jsdom

/*
 * The portrait gate is decided in CSS, not in React, so what is testable here
 * is the two halves that a change could quietly break: that the element is
 * rendered at all, and that the media query still cannot reach anything but a
 * phone. jsdom does not evaluate media queries, so the query itself is checked
 * as source — crude, but it is the rule that would otherwise start covering an
 * iPad or a short desktop window with a "turn your phone" screen.
 */

import '../test/dom';

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { screen } from '@testing-library/react';
import { draw } from '../test/dom';
import { PortraitOnly } from './PortraitOnly';

// From the repo root: vitest serves this file over http, so import.meta.url
// is not a file: URL to resolve against.
const CSS = readFileSync(join(process.cwd(), 'src/index.css'), 'utf8');

describe('the gate itself', () => {
  it('renders, and says what to do about it', () => {
    draw(<PortraitOnly />);
    const gate = screen.getByRole('alertdialog', { name: 'Turn your phone upright' });
    expect(gate.className).toContain('portrait-only');
    expect(gate.textContent).toMatch(/Turn your phone upright/);
    // The reassurance matters: a full-screen cover mid-workout reads as a crash.
    expect(gate.textContent).toMatch(/your session is still here/i);
  });

  it('leaves its own display to the stylesheet', () => {
    /* A Tailwind display utility here would fight `.portrait-only` for which
       one wins, and the loser decides whether the gate is permanently on. */
    draw(<PortraitOnly />);
    const gate = screen.getByRole('alertdialog');
    // By class, not by regex: `flex-col` sets a direction, not a display.
    const classes = gate.className.split(/\s+/);
    for (const utility of ['flex', 'block', 'hidden', 'grid', 'inline-flex']) {
      expect(classes, utility).not.toContain(utility);
    }
  });
});

describe('who the media query can reach', () => {
  const query = /@media \(orientation: landscape\)([^{]*)\{/.exec(CSS)?.[1] ?? '';

  it('is hidden by default, so a missing query cannot leave it covering the app', () => {
    expect(CSS).toMatch(/\.portrait-only\s*\{\s*display:\s*none/);
  });

  it('needs a landscape phone: short viewport and a coarse pointer', () => {
    expect(query, 'the landscape media query').not.toBe('');
    // Short enough that an iPad in landscape (744px and up) cannot trip it.
    const maxHeight = Number(/max-height:\s*(\d+)px/.exec(query)?.[1]);
    expect(maxHeight).toBeGreaterThan(0);
    expect(maxHeight).toBeLessThan(744);
    // And a coarse pointer, so no desktop window can trip it at any size.
    expect(query).toMatch(/pointer:\s*coarse/);
  });
});
