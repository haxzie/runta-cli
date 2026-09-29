import type { CredentialSource } from '@runta/core';
import { describe, expect, it } from 'vitest';
import { __groups, rootHelp } from './help.js';
import { buildProgram } from './program.js';

const program = () => buildProgram();
// Always pass a credential state: the default probes the real filesystem, so tests that omitted it
// would pass or fail depending on whether the machine running them happens to be logged in.
const plain = (source: CredentialSource = 'none') => rootHelp(program(), false, source);

describe('grouped root help', () => {
  /**
   * The groups are hand-ordered, which means they can fall behind the code. A command that belongs
   * to no group would silently vanish from the help — the same defect as Runta's docs describing a
   * smaller CLI than the one that ships (CLI_ISSUES.md C-05). This is the guard.
   */
  it('groups every registered command', () => {
    const grouped = new Set(__groups.flatMap((group) => group.commands));
    const registered = program().commands.map((command) => command.name());

    expect(registered.filter((name) => !grouped.has(name))).toEqual([]);
  });

  it('lists every registered command in the output', () => {
    const text = plain();
    for (const command of program().commands) {
      expect(text).toContain(command.name());
    }
  });

  it('puts no command in two groups', () => {
    const all = __groups.flatMap((group) => group.commands);
    expect(all).toHaveLength(new Set(all).size);
  });

  it('names no command that does not exist', () => {
    // The mirror of the first test: a group entry left behind after a rename.
    const registered = new Set([...program().commands.map((c) => c.name()), 'help']);
    const unknown = __groups.flatMap((g) => g.commands).filter((name) => !registered.has(name));

    expect(unknown).toEqual([]);
  });

  it('shows each command with its real description', () => {
    const text = plain();
    for (const command of program().commands) {
      if (command.description()) expect(text).toContain(command.description());
    }
  });

  it('includes every global option', () => {
    const text = plain();
    for (const option of program().options) {
      expect(text).toContain(option.flags);
    }
  });
});

describe('the introduction adapts to whether you are signed in', () => {
  /**
   * The opening line is the most valuable one in the help, and "start with login" spends it on
   * advice a signed-in user has already taken. These assert the three states say something
   * different and, in every case, something actionable.
   */
  it('tells a signed-in user how to see who they are, not how to log in', () => {
    const text = plain('file');

    expect(text).toContain('Signed in');
    expect(text).toContain('runta-next whoami');
    expect(text).not.toContain('Not signed in');
  });

  it('offers login as the way to switch user or organisation', () => {
    expect(plain('file')).toMatch(/switch user or organisation/);
  });

  /**
   * `login` writes the config file, which the environment outranks — so for an env-authenticated
   * user it would appear to succeed and change nothing. The help has to say what actually works.
   */
  it('tells an env-authenticated user to change the variable, not to run login', () => {
    const text = plain('env');

    expect(text).toContain('RUNTA_TOKEN');
    expect(text).toContain('precedence');
    expect(text).toContain('runta-next whoami');
  });

  it('names whoami in every signed-in state, because presence is not validity', () => {
    // No branch makes an API call, so an expired token still reads as signed in. `whoami` is the
    // only thing that actually asks, so every path has to point at it.
    for (const source of ['env', 'file'] as CredentialSource[]) {
      expect(plain(source)).toContain('runta-next whoami');
    }
  });

  it('still opens with the command groups, whatever the state', () => {
    for (const source of ['env', 'file', 'none'] as CredentialSource[]) {
      expect(plain(source)).toContain('Runtimes:');
    }
  });
});

describe('the introduction', () => {
  it('tells a new user to log in', () => {
    expect(plain()).toContain('runta-next login');
  });

  it('appears before the command groups, so it is read first', () => {
    const text = plain();
    expect(text.indexOf('Start with')).toBeLessThan(text.indexOf('Runtimes:'));
  });
});

describe('the agent section', () => {
  it('explains when to reach for --json', () => {
    const text = plain();
    expect(text).toContain('For agents:');
    expect(text).toContain('--json');
  });

  // Output defaults to `auto`, so an agent that spawns the CLI is already getting JSON. What it
  // must be told is how to stop depending on that detection, which is the explicit flag.
  it('says a pipe is already JSON, and names the flag that pins it', () => {
    const text = plain();
    expect(text).toMatch(/a pipe is\s+already JSON/);
    expect(text).toMatch(/-o table forces the table back/);
  });

  it('never claims the shape is independent of the terminal, which stopped being true', () => {
    expect(plain()).not.toMatch(/does not change based on/);
  });

  it('explains that state-changing commands wait, and what --detach trades away', () => {
    const text = plain();
    expect(text).toContain('Waiting:');
    expect(text).toMatch(/wait for the change to finish/);
    // The trap worth naming: a detached stop reports the status it had on acceptance.
    expect(text).toMatch(/detached stop still reads/);
  });

  it('points at exit codes rather than message text', () => {
    expect(plain()).toContain('Branch on exit codes');
  });

  it('mentions RUNTA_TOKEN, which is how an agent authenticates', () => {
    expect(plain()).toContain('RUNTA_TOKEN');
  });
});

describe('the docs pointer', () => {
  it('names the docs site, so a reader can go deeper than --help', () => {
    expect(plain()).toContain('https://runta.haxzie.com/docs');
  });

  /**
   * The whole point of naming this one: an agent that has read `--help` can fetch the entire
   * manual in a single request instead of crawling rendered HTML page by page.
   */
  it('points agents at the plain-text rendering of the whole site', () => {
    const text = plain();
    expect(text).toContain('https://runta.haxzie.com/docs/llms-full.txt');
    expect(text.indexOf('llms-full.txt')).toBeGreaterThan(text.indexOf('For agents:'));
  });
});

describe('colour', () => {
  it('emits no escape sequences when told not to colour', () => {
    // `skills --help` emits bold even when piped; that is the C-25 mistake, and piped help has to
    // stay clean for anything reading it.
    // biome-ignore lint/suspicious/noControlCharactersInRegex: matching the escape is the point.
    expect(plain()).not.toMatch(/\x1b\[/);
  });

  it('emits bold headings when colour is on', () => {
    // biome-ignore lint/suspicious/noControlCharactersInRegex: matching the escape is the point.
    expect(rootHelp(program(), true)).toMatch(/\x1b\[1mRuntimes:/);
  });
});

describe('subcommand help is left to commander', () => {
  it('still generates flags from the real command, not from this file', () => {
    const create = program().commands.find((command) => command.name() === 'create');
    const text = create?.helpInformation() ?? '';

    expect(text).toContain('--memory-max');
    expect(text).toContain('--from-checkpoint');
  });
});

/**
 * Per-command waiting text. One helper feeds every command that has `--detach`, because five
 * copies would let the guarantee drift — and a user who believes `--detach` means something
 * different on `stop` than on `create` has been misled by the docs, not by the code.
 */
describe('detachHelp', () => {
  const withDetach = ['create', 'delete', 'start', 'stop', 'pause'];

  /**
   * What the command actually prints, not `helpInformation()`.
   *
   * `addHelpText('after', …)` is applied by `outputHelp`, so `helpInformation()` returns the
   * formatted body without it — a test built on that would pass while the text never reached a
   * user, which is the exact failure this suite exists to catch.
   */
  const helpFor = (name: string): string => {
    const command = buildProgram().commands.find((c) => c.name() === name);
    if (!command) throw new Error(`no such command: ${name}`);

    let captured = '';
    command.configureOutput({
      writeOut: (text) => {
        captured += text;
      },
    });
    command.outputHelp();
    return captured;
  };

  it.each(withDetach)('documents waiting on %s', (name) => {
    const text = helpFor(name);

    expect(text).toContain('Waiting:');
    expect(text).toMatch(/-d, --detach returns as soon as the request is accepted/);
    expect(text).toMatch(/a receipt, not a\s+state/);
  });

  it('names what each command waits for, because they differ', () => {
    expect(helpFor('create')).toMatch(/the runtime can accept commands/);
    expect(helpFor('stop')).toMatch(/the transition settles/);
    expect(helpFor('delete')).toMatch(/the runtimes are gone/);
  });

  it('adds nothing to a command that cannot detach', () => {
    expect(helpFor('inspect')).not.toContain('Waiting:');
  });
});
