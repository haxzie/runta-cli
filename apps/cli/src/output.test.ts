import { isCliError } from '@runta/utils';
import { describe, expect, it } from 'vitest';
import { resolveOutput, wantsJson } from './output.js';

const tty = { isTTY: true };
const pipe = { isTTY: false };

describe('wantsJson', () => {
  describe('auto, the default', () => {
    it('gives a human at a terminal the table', () => {
      expect(wantsJson({}, tty, {})).toBe(false);
    });

    // The whole point: `runta-next list | jq` with no flag.
    it('gives a pipe JSON', () => {
      expect(wantsJson({}, pipe, {})).toBe(true);
    });

    it('treats a missing isTTY as not a terminal', () => {
      expect(wantsJson({}, {}, {})).toBe(true);
    });
  });

  describe('explicit flags', () => {
    it('--json forces JSON at a terminal', () => {
      expect(wantsJson({ json: true }, tty, {})).toBe(true);
    });

    // This is the half CLI_ISSUES.md C-08 says upstream is missing: a way back to the table
    // when stdout is a pipe, so `| less` and `| grep` stay usable.
    it('-o table forces the table into a pipe', () => {
      expect(wantsJson({ output: 'table' }, pipe, {})).toBe(false);
    });

    it('-o json forces JSON at a terminal', () => {
      expect(wantsJson({ output: 'json' }, tty, {})).toBe(true);
    });

    it('-o auto falls back to the shape of stdout', () => {
      expect(wantsJson({ output: 'auto' }, tty, {})).toBe(false);
      expect(wantsJson({ output: 'auto' }, pipe, {})).toBe(true);
    });
  });

  describe('RUNTA_OUTPUT', () => {
    it('pins the table across pipes', () => {
      expect(wantsJson({}, pipe, { RUNTA_OUTPUT: 'table' })).toBe(false);
    });

    it('pins JSON at a terminal', () => {
      expect(wantsJson({}, tty, { RUNTA_OUTPUT: 'json' })).toBe(true);
    });

    // Otherwise `RUNTA_OUTPUT=json` in a CI job would make `-o table` a lie.
    it('loses to an explicit flag', () => {
      expect(wantsJson({ output: 'table' }, pipe, { RUNTA_OUTPUT: 'json' })).toBe(false);
      expect(wantsJson({ json: true }, tty, { RUNTA_OUTPUT: 'table' })).toBe(true);
    });

    it('is ignored when empty, rather than treated as a mode', () => {
      expect(wantsJson({}, tty, { RUNTA_OUTPUT: '' })).toBe(false);
    });
  });

  describe('bad values', () => {
    it('names the flag and lists what it accepts', () => {
      const error = (() => {
        try {
          wantsJson({ output: 'yaml' }, tty, {});
        } catch (e: unknown) {
          return e;
        }
      })();

      expect(isCliError(error)).toBe(true);
      expect(String(error)).toMatch(/--output/);
      expect((error as { hint?: string }).hint).toMatch(/auto, table, json/);
    });

    it('names the variable when the environment is at fault', () => {
      const error = (() => {
        try {
          wantsJson({}, tty, { RUNTA_OUTPUT: 'yaml' });
        } catch (e: unknown) {
          return e;
        }
      })();

      expect(String(error)).toMatch(/RUNTA_OUTPUT/);
    });
  });
});

describe('resolveOutput', () => {
  it('collapses the modes down to the json boolean commands already take', () => {
    expect(resolveOutput({ output: 'json' }, tty, {})).toEqual({ output: 'json', json: true });
    expect(resolveOutput({ output: 'table' }, pipe, {})).toEqual({ output: 'table', json: false });
  });

  it('leaves every other option untouched', () => {
    const options = { all: true, limit: 5, output: 'table' };

    expect(resolveOutput(options, tty, {})).toEqual({
      all: true,
      limit: 5,
      output: 'table',
      json: false,
    });
  });
});
