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
    // Deliberately not `runta-next auth login`: this mirrors Runta's own CLI, and is the shape
    // the docs and every hint string promise.
    expect(names()).toContain('login');
    expect(names()).toContain('logout');
  });

  it('has no auth command group', () => {
    expect(names()).not.toContain('auth');
  });

  it('registers exactly the commands we document', () => {
    // `help` is synthesised by commander and is not in `program.commands`.
    expect(names()).toEqual([
      'create',
      'delete',
      'exec',
      'inspect',
      'list',
      'login',
      'logout',
      'pause',
      'runtime',
      'start',
      'stop',
      'upgrade',
      'whoami',
    ]);
  });

  it('exposes the runtime verbs both under the noun and at the top level', () => {
    // Noun-first is canonical so every resource reads the same way and an agent can predict
    // `runta-next checkpoint list` from one example; the top-level forms exist because runtimes are
    // what you type all day. See Improvements.md I-2.
    const group = program().commands.find((c) => c.name() === 'runtime');
    const verbs = group?.commands.map((c) => c.name()).sort();

    expect(verbs).toEqual(['create', 'delete', 'inspect', 'list', 'pause', 'start', 'stop']);
    for (const verb of verbs ?? []) expect(names()).toContain(verb);
  });

  it('keeps the two forms of each verb in step', () => {
    // Registered from one function, so a flag added to one form cannot go missing from the other.
    const group = program().commands.find((c) => c.name() === 'runtime');
    for (const verb of ['create', 'delete', 'inspect', 'list', 'pause', 'start', 'stop']) {
      const flat = optionsOf(verb);
      const nested = (group?.commands.find((c) => c.name() === verb)?.options ?? [])
        .map((o) => o.long ?? o.short ?? '')
        .sort();
      expect(nested).toEqual(flat);
    }
  });

  it('has no run or ps command', () => {
    // Improvements.md I-1: `run` would name the command that runs nothing, and `ps` is ambiguous
    // about whether it lists runtimes or processes inside one.
    expect(names()).not.toContain('run');
    expect(names()).not.toContain('ps');
    expect(names()).not.toContain('rm');
  });

  it('keeps the login flags', () => {
    expect(optionsOf('login')).toEqual(['--json', '--no-browser', '--output']);
  });

  it('keeps the logout flag', () => {
    expect(optionsOf('logout')).toEqual(['--json', '--output']);
  });

  it('keeps the exec flags', () => {
    expect(optionsOf('exec')).toEqual(['--env', '--interactive', '--json', '--tty']);
  });

  it('keeps the whoami flag', () => {
    expect(optionsOf('whoami')).toEqual(['--json', '--output']);
  });

  // `exec` streams the remote command's own bytes, so it is deliberately the one command
  // without `-o`: auto-detecting a pipe would wrap a redirected binary in a JSON envelope.
  it('leaves exec out of the output-mode flag', () => {
    expect(optionsOf('exec')).not.toContain('--output');
  });

  it('declares the global options', () => {
    expect(
      program()
        .options.map((o) => o.long)
        .sort(),
    ).toEqual(['--quiet', '--verbose', '--version']);
  });
});
