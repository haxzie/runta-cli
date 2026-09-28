import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import type { Command } from 'commander';
import { describe, expect, it } from 'vitest';
import { buildProgram } from './program.js';

/**
 * The docs site is now named inside `--help`, including a plain-text rendering aimed at agents.
 * That makes a wrong example worse than a missing one: an agent will run it. These tests check
 * every command and flag the docs show against the real program tree, the same way
 * `suggest.test.ts` does for hints and next steps.
 *
 * It earned its keep immediately — the first draft of the tour page used `--checkpoint`, which
 * does not exist (the flag is `--from-checkpoint`), and `.runtimes[]` for `list --json`, which
 * emits a bare array.
 */
const DOCS = join(import.meta.dirname, '..', '..', '..', 'docs');

/** Every `runta-next …` invocation shown inside a fenced code block, with its source page. */
function documentedInvocations(): { page: string; line: string; words: string[] }[] {
  const pages: string[] = [];
  const walk = (dir: string): void => {
    for (const entry of readdirSync(dir)) {
      const full = join(dir, entry);
      if (statSync(full).isDirectory()) walk(full);
      else if (entry.endsWith('.md')) pages.push(full);
    }
  };
  walk(DOCS);

  const found: { page: string; line: string; words: string[] }[] = [];
  for (const page of pages) {
    const text = readFileSync(page, 'utf8');
    let inFence = false;
    for (const raw of text.split('\n')) {
      if (raw.trimStart().startsWith('```')) {
        inFence = !inFence;
        continue;
      }
      if (!inFence) continue;

      // Command lines only: a `$ ` prompt, or a bare invocation. Never output lines.
      const line = raw.trim().replace(/^\$\s+/, '');
      if (!line.startsWith('runta-next ')) continue;
      // Shell pipelines: only the runta-next side is ours to verify.
      const ours = line.split('|')[0]?.trim() ?? line;
      found.push({ page: page.slice(DOCS.length + 1), line, words: ours.split(/\s+/).slice(1) });
    }
  }
  return found;
}

/**
 * Walks as far down the command tree as the words go, returning the deepest command reached and
 * how many words it consumed.
 *
 * Leading global flags are skipped rather than treated as the end of the path: `runta-next
 * --verbose whoami` is a real invocation, and the docs use that form deliberately. A word wrapped
 * in `<>` or `[]` is a usage placeholder, not a command, and ends the walk.
 */
function resolve(
  program: Command,
  words: readonly string[],
): { command: Command; depth: number; consumed: number } {
  let command: Command = program;
  let depth = 0;
  let consumed = 0;

  for (const word of words) {
    if (depth === 0 && word.startsWith('-')) {
      consumed += 1; // a global flag; the subcommand may still follow
      continue;
    }
    if (word.startsWith('-') || word.startsWith('<') || word.startsWith('[')) break;
    const next: Command | undefined = command.commands.find(
      (c) => c.name() === word || c.aliases().includes(word),
    );
    if (!next) break;
    command = next;
    depth += 1;
    consumed += 1;
  }
  return { command, depth, consumed };
}

/**
 * True when the line names no command because it isn't meant to: either a bare global invocation
 * like `runta-next --help`, or a usage synopsis like `runta-next [global options] <command>`, which
 * is recognisable by opening on a placeholder rather than a word.
 */
const namesNoCommand = (program: Command, words: readonly string[]): boolean => {
  const first = words[0] ?? '';
  if (first.startsWith('<') || first.startsWith('[')) return true;
  return words.every(
    (word) => word.startsWith('-') && ROOT_FLAGS(program).has(word.split('=')[0] ?? word),
  );
};

const longFlagsOf = (command: Command): Set<string> =>
  new Set(
    command.options
      .flatMap((option) => option.flags.split(/[ ,|]+/))
      .filter((token) => token.startsWith('--')),
  );

// Commander adds `--help` implicitly on every command, and `--version` on the root, so neither
// appears in `options`. Both are real and both are documented.
const ROOT_FLAGS = (program: Command): Set<string> =>
  new Set([...longFlagsOf(program), '--help', '--version']);

describe('documented commands and flags exist', () => {
  it('every `runta-next …` in the docs names a real command', () => {
    const program = buildProgram();
    const unknown = documentedInvocations()
      .filter(({ words }) => resolve(program, words).depth === 0 && !namesNoCommand(program, words))
      .map(({ page, line }) => `${page}: ${line}`);

    expect(unknown).toEqual([]);
  });

  it('every long flag in a documented example exists on that command', () => {
    const program = buildProgram();
    const root = ROOT_FLAGS(program);
    const bad: string[] = [];

    for (const { page, line, words } of documentedInvocations()) {
      const { command, depth, consumed } = resolve(program, words);
      if (depth === 0) continue;
      const allowed = new Set([...root, ...longFlagsOf(command), '--help']);

      for (const word of words.slice(consumed)) {
        // Everything past a bare `--` is the inner command, not our flags.
        if (word === '--') break;
        if (!word.startsWith('--')) continue;
        const flag = word.split('=')[0] ?? word;
        if (!allowed.has(flag)) bad.push(`${page}: ${line} → ${flag}`);
      }
    }

    expect(bad).toEqual([]);
  });

  it('scrapes a meaningful number of examples, so a broken scraper cannot pass silently', () => {
    expect(documentedInvocations().length).toBeGreaterThan(20);
  });

  it('rejects a command and a flag that do not exist', () => {
    // Guards the guard, with the two mistakes the tour page actually made.
    const program = buildProgram();
    expect(resolve(program, ['checkpoint', 'list']).depth).toBe(0);
    // A global flag must not hide the subcommand behind it.
    expect(resolve(program, ['--verbose', 'whoami']).depth).toBe(1);
    expect(namesNoCommand(program, ['--help'])).toBe(true);
    expect(namesNoCommand(program, ['[global', 'options]', '<command>'])).toBe(true);
    expect(namesNoCommand(program, ['agents', 'ls'])).toBe(false);
    expect(longFlagsOf(resolve(program, ['create']).command).has('--from-checkpoint')).toBe(true);
    expect(longFlagsOf(resolve(program, ['create']).command).has('--checkpoint')).toBe(false);
  });
});
