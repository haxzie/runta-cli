import { mkdir, mkdtemp, readFile, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { isCliError } from '@runta/utils';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { configPath } from './config.js';
import { clearToken, saveToken } from './credentials.js';

let home: string;
const previous = process.env.RUNTA_CONFIG_HOME;

beforeEach(async () => {
  home = await mkdtemp(join(tmpdir(), 'runta-next-creds-'));
  // Point at a directory *inside* the temp dir that does not exist yet, so every test
  // starts from the clean-machine state that breaks the production CLI.
  process.env.RUNTA_CONFIG_HOME = join(home, 'config', 'runta-next');
});

afterEach(() => {
  if (previous === undefined) delete process.env.RUNTA_CONFIG_HOME;
  else process.env.RUNTA_CONFIG_HOME = previous;
});

const readJson = async (): Promise<Record<string, unknown>> =>
  JSON.parse(await readFile(configPath(), 'utf8')) as Record<string, unknown>;

describe('saveToken', () => {
  it('creates the config directory when it does not exist', async () => {
    // The production CLI fails here with `os error 2` — see CLI_ISSUES.md C-02.
    const path = await saveToken('rt_abc');

    expect(path).toBe(configPath());
    expect(await readJson()).toEqual({ token: 'rt_abc' });
  });

  it('writes the file 0600, since it holds a bearer credential', async () => {
    await saveToken('rt_abc');

    expect((await stat(configPath())).mode & 0o777).toBe(0o600);
  });

  it('tightens permissions on a file that already exists', async () => {
    await mkdir(process.env.RUNTA_CONFIG_HOME as string, { recursive: true });
    await writeFile(configPath(), '{}\n', { mode: 0o644 });

    await saveToken('rt_abc');

    expect((await stat(configPath())).mode & 0o777).toBe(0o600);
  });

  it('preserves other config keys', async () => {
    await mkdir(process.env.RUNTA_CONFIG_HOME as string, { recursive: true });
    await writeFile(configPath(), JSON.stringify({ apiUrl: 'https://self.hosted' }));

    await saveToken('rt_abc');

    expect(await readJson()).toEqual({ apiUrl: 'https://self.hosted', token: 'rt_abc' });
  });

  it('replaces an existing token', async () => {
    await saveToken('rt_old');
    await saveToken('rt_new');

    expect(await readJson()).toEqual({ token: 'rt_new' });
  });

  it('refuses to clobber a config file that is not a JSON object', async () => {
    await mkdir(process.env.RUNTA_CONFIG_HOME as string, { recursive: true });
    await writeFile(configPath(), '["not", "an", "object"]');

    const error = await saveToken('rt_abc').catch((e: unknown) => e);

    expect(isCliError(error)).toBe(true);
    expect((error as Error).message).toContain('not a JSON object');
  });

  it('reports unparseable JSON rather than silently overwriting it', async () => {
    await mkdir(process.env.RUNTA_CONFIG_HOME as string, { recursive: true });
    await writeFile(configPath(), '{ this is not json');

    const error = await saveToken('rt_abc').catch((e: unknown) => e);

    expect(isCliError(error)).toBe(true);
    expect((error as Error).message).toContain('Could not parse config');
  });
});

describe('clearToken', () => {
  it('removes the token and reports that it did', async () => {
    await saveToken('rt_abc');

    await expect(clearToken()).resolves.toBe(true);
    expect(await readJson()).toEqual({});
  });

  it('leaves other keys intact', async () => {
    await mkdir(process.env.RUNTA_CONFIG_HOME as string, { recursive: true });
    await writeFile(configPath(), JSON.stringify({ apiUrl: 'https://self.hosted' }));
    await saveToken('rt_abc');

    await clearToken();

    expect(await readJson()).toEqual({ apiUrl: 'https://self.hosted' });
  });

  it('is a no-op when no config file exists', async () => {
    await expect(clearToken()).resolves.toBe(false);
  });

  it('is a no-op when the file exists but holds no token', async () => {
    await mkdir(process.env.RUNTA_CONFIG_HOME as string, { recursive: true });
    await writeFile(configPath(), JSON.stringify({ apiUrl: 'https://self.hosted' }));

    await expect(clearToken()).resolves.toBe(false);
  });
});
