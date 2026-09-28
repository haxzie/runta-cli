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
