import { readFileSync } from 'node:fs';
import { chmod, mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { fail, logger } from '@runta/utils';
import { configPath } from './config.js';

/**
 * Persists the token into the config file, creating the directory if it does not exist.
 *
 * That `mkdir` is not incidental: the production Rust CLI writes its login state without
 * creating `~/.config/runta` first, so `runta-next login` fails with `os error 2` on every clean
 * machine (CLI_ISSUES.md C-02). Creating the directory is the whole fix.
 *
 * Other keys in the file are preserved — the token is one field in a shared config, not the
 * whole document — and the file is chmod 0600 because it holds a bearer credential.
 */
export async function saveToken(token: string): Promise<string> {
  const path = configPath();
  const existing = await readConfigFile(path);

  await mkdir(dirname(path), { recursive: true, mode: 0o700 });
  await writeFile(path, `${JSON.stringify({ ...existing, token }, null, 2)}\n`, {
    encoding: 'utf8',
    mode: 0o600,
  });
  // writeFile's `mode` only applies when it creates the file, so an existing file keeps
  // whatever permissions it had. Set them explicitly.
  await chmod(path, 0o600);

  logger.debug(`wrote token to ${path}`);
  return path;
}

/** Removes the stored token. Returns false when there was nothing to remove. */
export async function clearToken(): Promise<boolean> {
  const path = configPath();
  const existing = await readConfigFile(path);

  if (existing.token === undefined) return false;

  const { token: _discarded, ...rest } = existing;
  await mkdir(dirname(path), { recursive: true, mode: 0o700 });
  await writeFile(path, `${JSON.stringify(rest, null, 2)}\n`, { encoding: 'utf8', mode: 0o600 });
  await chmod(path, 0o600);

  logger.debug(`removed token from ${path}`);
  return true;
}

async function readConfigFile(path: string): Promise<Record<string, unknown>> {
  let text: string;
  try {
    text = await readFile(path, 'utf8');
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return {};
    return fail(`Could not read config at ${path}`, {
      hint: 'Fix or delete the file, then try again.',
      cause: error,
    });
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch (cause) {
    return fail(`Could not parse config at ${path}`, {
      hint: 'Fix or delete the file, then try again.',
      cause,
    });
  }

  // A JSON file whose root is an array or scalar would silently lose the user's data on
  // write, so refuse rather than clobber it. Checked outside the try: `fail` throws, and a
  // catch around it would swallow this into the parse error above.
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    return fail(`Config at ${path} is not a JSON object`, {
      hint: 'Fix or delete the file, then try again.',
    });
  }
  return parsed as Record<string, unknown>;
}

/** Where the credential in use came from, or that there isn't one. */
export type CredentialSource = 'env' | 'file' | 'none';

/**
 * Whether a credential exists, and which layer it came from — synchronously, and without ever
 * failing.
 *
 * Both properties are requirements rather than preferences. `--help` is rendered by commander from
 * a synchronous callback, so `loadConfig` is unavailable; and help has to render on a machine whose
 * config file is missing, empty or corrupt, where `loadConfig` deliberately aborts the process.
 * A file this cannot read is reported as `none`: the next real command loads it properly and
 * reports the problem with a fix, which is the right place for that.
 *
 * Precedence matches `loadConfig` — the environment wins — because the distinction changes the
 * advice. `login` writes to the config file, so telling someone with `RUNTA_TOKEN` set to run it
 * would send them to a command whose result the environment then ignores.
 *
 * This reads the token's presence, never its validity. Saying "signed in" about a token the API
 * would reject is the cost of not making a network call to render help; `whoami` is the check, and
 * that is what the help text points at.
 */
export function credentialSource(env: NodeJS.ProcessEnv = process.env): CredentialSource {
  if (env.RUNTA_TOKEN?.trim()) return 'env';

  try {
    const parsed: unknown = JSON.parse(readFileSync(configPath(), 'utf8'));
    if (typeof parsed !== 'object' || parsed === null) return 'none';
    const { token } = parsed as { token?: unknown };
    return typeof token === 'string' && token.trim() ? 'file' : 'none';
  } catch {
    return 'none';
  }
}
