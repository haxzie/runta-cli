import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import type { Command } from 'commander';
import { describe, expect, it, vi } from 'vitest';
import { buildProgram } from './program.js';
import { printNextSteps } from './suggest.js';

describe('printNextSteps', () => {
  it('writes to stderr, so stdout stays parseable even with --json', () => {
    const stderr = vi.spyOn(console, 'error').mockImplementation(() => {});
    const stdout = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);

    printNextSteps([{ command: 'runta-next list', why: 'see what exists' }]);

    expect(stderr).toHaveBeenCalled();
    expect(stdout).not.toHaveBeenCalled();
  });

  it('prints nothing at all for no steps', () => {
    const stderr = vi.spyOn(console, 'error').mockImplementation(() => {});

    printNextSteps([]);

    expect(stderr).not.toHaveBeenCalled();
  });

  it('aligns the reasons so the commands read as a column', () => {
    const lines: string[] = [];
    vi.spyOn(console, 'error').mockImplementation((...args: unknown[]) => {
      lines.push(args.join(' '));
    });

    printNextSteps([
      { command: 'runta-next list', why: 'REASON_A' },
      { command: 'runta-next inspect a-much-longer-name', why: 'REASON_B' },
    ]);

    // Distinct sentinels: a reason like 'long' would also match inside the command text.
    const [first, second] = lines.filter((l) => l.startsWith('  runta-next'));
    expect(first?.indexOf('REASON_A')).toBe(second?.indexOf('REASON_B'));
  });
});

/** Every command path the CLI mentions in a suggestion or a hint, scraped from source. */
function suggestedCommands(): { file: string; text: string; path: string[] }[] {
  const root = join(import.meta.dirname, '.');
  const files: string[] = [];
  const walk = (dir: string): void => {
    for (const entry of readdirSync(dir)) {
      const full = join(dir, entry);
      if (statSync(full).isDirectory()) walk(full);
      else if (entry.endsWith('.ts') && !entry.endsWith('.test.ts')) files.push(full);
    }
  };
  walk(root);

  const found: { file: string; text: string; path: string[] }[] = [];
  for (const file of files) {
    const source = readFileSync(file, 'utf8');
    // Strip block comments: they discuss commands that deliberately do not exist yet.
    const code = source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
    for (const match of code.matchAll(/runta-next ((?:[a-z][a-z-]*)(?: [a-z][a-z-]*)*)/g)) {
      const words = (match[1] ?? '').split(' ');
      // Stop at the first word that is not a literal subcommand — a flag, a placeholder or prose.
      const path: string[] = [];
      for (const word of words) {
        if (word.startsWith('-') || word.includes('$') || word.includes('<')) break;
        path.push(word);
      }
      if (path.length > 0) found.push({ file, text: match[0], path });
    }
  }
  return found;
}

const resolve = (program: Command, path: readonly string[]): boolean => {
  let current: Command = program;
  for (const word of path) {
    const next: Command | undefined = current.commands.find(
      (c) => c.name() === word || c.aliases().includes(word),
    );
    if (!next) return false;
    current = next;
  }
  return true;
};

describe('suggested commands exist', () => {
  /**
   * Runta's own agent skill documents a `runta-next agents ls` command and `--agent`/`--no-shell` flags
   * that do not exist, and its `resume` points callers at `resume` (CLI_ISSUES.md C-30, C-11).
   * Both are the same underlying mistake: text that names commands nothing verifies. This test is
   * the verification.
   *
   * It caught a real one — `create` suggested `runta-next exec` before `exec` was implemented.
   */
  it('every `runta-next …` in a suggestion or hint resolves against the real program', () => {
    const program = buildProgram();
    const missing = suggestedCommands()
      .filter(({ path }) => !resolve(program, path))
      .map(({ file, text }) => `${file.split('/src/')[1]}: ${text}`);

    expect(missing).toEqual([]);
  });

  it('finds a meaningful number of suggestions, so a broken scraper cannot pass silently', () => {
    // If the regex stops matching, the test above would trivially pass with an empty list.
    expect(suggestedCommands().length).toBeGreaterThan(8);
  });

  it('fails when a suggestion names a command that does not exist', () => {
    // Guards the guard: proves resolve() actually rejects. `checkpoint` is the next resource we
    // expect to build, which makes it a good stand-in for "documented but not shipped".
    expect(resolve(buildProgram(), ['checkpoint'])).toBe(false);
    expect(resolve(buildProgram(), ['runtime', 'nope'])).toBe(false);
    expect(resolve(buildProgram(), ['exec'])).toBe(true);
    expect(resolve(buildProgram(), ['runtime', 'list'])).toBe(true);
  });
});
