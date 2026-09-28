import { describe, expect, it } from 'vitest';
import { colorEnabled } from './color.js';

const tty = { isTTY: true };
const pipe = { isTTY: false };
const term = { TERM: 'xterm-256color' } as NodeJS.ProcessEnv;

describe('colorEnabled', () => {
  it('colours a terminal', () => {
    expect(colorEnabled(tty, term)).toBe(true);
  });

  it('does not colour a pipe', () => {
    expect(colorEnabled(pipe, term)).toBe(false);
  });

  it('does not colour a stream that cannot say', () => {
    expect(colorEnabled({}, term)).toBe(false);
  });

  it('honours NO_COLOR even on a terminal', () => {
    // Any non-empty value, per no-color.org. The production CLI drops the colour but keeps the
    // bold here, which is the inconsistency this single rule exists to prevent (C-25).
    expect(colorEnabled(tty, { ...term, NO_COLOR: '1' })).toBe(false);
    expect(colorEnabled(tty, { ...term, NO_COLOR: 'anything' })).toBe(false);
  });

  it('ignores an empty NO_COLOR, which is unset by another name', () => {
    expect(colorEnabled(tty, { ...term, NO_COLOR: '' })).toBe(true);
  });

  it('does not colour a dumb terminal', () => {
    expect(colorEnabled(tty, { TERM: 'dumb' })).toBe(false);
  });

  it('does not colour when TERM is unset', () => {
    // Common in CI and under `script`, where escapes end up in a log rather than on a screen.
    expect(colorEnabled(tty, {})).toBe(false);
  });
});
