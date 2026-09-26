import { describe, expect, it } from 'vitest';
import { buildProgram } from './program.js';

const program = () => buildProgram();

const names = (): string[] =>
  program()
    .commands.map((command) => command.name())
    .sort();

const optionsOf = (name: string): string[] => {
  const command = program().commands.find((c) => c.name() === name);
  if (!command) throw new Error(`no such command: ${name}`);
  return command.options.map((option) => option.long ?? option.short ?? '').sort();
};

describe('command surface', () => {
  it('exposes login and logout at the top level', () => {
    // Deliberately not `runta auth login`: this mirrors Runta's own CLI, and is the shape
    // the docs and every hint string promise.
    expect(names()).toContain('login');
    expect(names()).toContain('logout');
  });

  it('has no auth command group', () => {
    expect(names()).not.toContain('auth');
  });

  it('registers exactly the commands we document', () => {
    // `help` is synthesised by commander and is not in `program.commands`.
    expect(names()).toEqual(['hello', 'login', 'logout', 'whoami']);
  });

  it('keeps the login flags', () => {
    expect(optionsOf('login')).toEqual(['--json', '--no-browser']);
  });

  it('keeps the logout flag', () => {
    expect(optionsOf('logout')).toEqual(['--json']);
  });

  it('keeps the whoami flag', () => {
    expect(optionsOf('whoami')).toEqual(['--json']);
  });

  it('declares the global options', () => {
    expect(
      program()
        .options.map((o) => o.long)
        .sort(),
    ).toEqual(['--quiet', '--verbose', '--version']);
  });
});
