import { createHash } from 'node:crypto';
import { constants } from 'node:fs';
import {
  access,
  chmod,
  mkdtemp,
  readFile,
  rename,
  realpath as resolvePath,
  rm,
  stat,
  writeFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, dirname, join } from 'node:path';
import { fail, logger } from '@runta/utils';
import type { Command } from 'commander';
import { printNextSteps } from '../suggest.js';
import { version as currentVersion } from '../version.js';

const REPO = 'haxzie/runta-cli';
/** The npm package, for the one upgrade path this command cannot perform itself. */
const NPM_PACKAGE = '@haxzie/runta-next';
/** Release assets are named after the project, whatever the command was installed as. */
const ARTIFACT_PREFIX = 'runta-next';
const LATEST_URL = `https://github.com/${REPO}/releases/latest`;

export interface UpgradeOptions {
  check?: boolean;
  to?: string;
  dryRun?: boolean;
  yes?: boolean;
  json?: boolean;
}

/**
 * Only the part of `fetch` this command uses.
 *
 * `typeof fetch` would drag in `preconnect`, which the runtime provides and no test double should
 * have to implement.
 */
export type FetchLike = (
  url: string,
  init?: { method?: string; redirect?: 'follow' },
) => Promise<Response>;

export interface UpgradeDeps {
  write: (text: string) => void;
  fetch: FetchLike;
  /** Absolute path of the running executable. */
  execPath: () => string;
  /**
   * Where this module itself lives, which is what distinguishes an npm install from a checkout.
   *
   * Not `process.argv[1]`: for a global install that is the bin *symlink* — `<prefix>/bin/runta-next`
   * — which says nothing about where the package was unpacked.
   */
  modulePath: () => string;
  platform: () => string;
  arch: () => string;
  /** True on a musl system, where the glibc builds will not run. */
  isMusl: () => boolean;
  /** Runs a command, resolving its stdout. Rejects on a non-zero exit. */
  run: (command: string, args: string[]) => Promise<string>;
  confirm: (question: string) => Promise<boolean>;
  isInteractive: () => boolean;
}

export const defaultDeps: UpgradeDeps = {
  write: (text) => process.stdout.write(text),
  fetch: (url, init) => fetch(url, init),
  execPath: () => process.execPath,
  modulePath: () => import.meta.dirname ?? '',
  platform: () => process.platform,
  arch: () => process.arch,
  isMusl,
  run: async (command, args) => {
    const { execFile } = await import('node:child_process');
    const { promisify } = await import('node:util');
    const { stdout } = await promisify(execFile)(command, args);
    return stdout;
  },
  confirm: async (question) => {
    const { createInterface } = await import('node:readline/promises');
    const rl = createInterface({ input: process.stdin, output: process.stderr });
    try {
      return /^y(es)?$/i.test((await rl.question(`${question} [y/N] `)).trim());
    } finally {
      rl.close();
    }
  },
  isInteractive: () => process.stdin.isTTY === true && process.stdout.isTTY === true,
};

/**
 * Whether this is a musl system, which cannot run the glibc builds.
 *
 * Node reports the glibc it was built against in its process report, and that field is simply
 * absent on musl. `install.sh` answers the same question by grepping `ldd /bin/sh` for
 * `libc.so.6`; both have to agree, or `upgrade` would install a binary the installer never would.
 */
function isMusl(): boolean {
  if (process.platform !== 'linux') return false;
  const report = process.report?.getReport();
  const header = (report as { header?: { glibcVersionRuntime?: string } } | undefined)?.header;
  return !header?.glibcVersionRuntime;
}

/**
 * How this CLI was installed, which decides whether `upgrade` can do anything.
 *
 * A standalone binary is its own `process.execPath`, so anything else means node is running a
 * bundle — either the published npm package or a checkout. Only the npm package lives under
 * `node_modules`, and telling those two apart matters: sending an npm user to install.sh would
 * leave them with a second copy in ~/.runta-next/bin, racing the first on PATH.
 */
export function detectInstall(execPath: string, modulePath: string): 'binary' | 'npm' | 'dev' {
  const name = basename(execPath);
  if (name !== 'node' && name !== 'bun' && !name.startsWith('node.')) return 'binary';
  return /[\\/]node_modules[\\/]/.test(modulePath) ? 'npm' : 'dev';
}

/**
 * Which package manager installed this copy, inferred from where it was unpacked.
 *
 * Each one has its own global root, and upgrading with the wrong one does not fail loudly — it
 * installs a *second* copy under a different root, leaving whichever comes first on PATH to win.
 * So this reads the path rather than reaching for whatever `npm` happens to be installed.
 */
export function detectPackageManager(modulePath: string): 'npm' | 'pnpm' | 'yarn' | 'bun' {
  if (/[\\/]\.bun[\\/]/.test(modulePath)) return 'bun';
  if (/[\\/]\.?pnpm[\\/]/i.test(modulePath)) return 'pnpm';
  if (/[\\/]\.?yarn[\\/]/i.test(modulePath)) return 'yarn';
  return 'npm';
}

/** The global-install invocation for each manager. Yarn is the one that does not take `add -g`. */
export function installCommand(
  manager: 'npm' | 'pnpm' | 'yarn' | 'bun',
  version: string,
): [string, string[]] {
  const spec = `${NPM_PACKAGE}@${version}`;
  switch (manager) {
    case 'pnpm':
      return ['pnpm', ['add', '-g', spec]];
    case 'yarn':
      return ['yarn', ['global', 'add', spec]];
    case 'bun':
      return ['bun', ['add', '-g', spec]];
    default:
      return ['npm', ['install', '-g', spec]];
  }
}

/**
 * The release asset for this machine.
 *
 * Deliberately a mirror of `detect_target` in `scripts/install.sh` — the same names, the same
 * supported set, the same musl split. `upgrade.test.ts` asserts every name this can produce is one
 * `scripts/build-binaries.ts` actually publishes, so the two cannot drift apart silently.
 */
export function detectTarget(platform: string, arch: string, musl: boolean): string {
  const os = platform === 'darwin' ? 'darwin' : platform === 'linux' ? 'linux' : undefined;
  if (!os) {
    fail(`Unsupported operating system: ${platform}`, {
      hint: 'Releases are published for macOS and Linux only.',
    });
  }

  const cpu = arch === 'x64' ? 'x64' : arch === 'arm64' ? 'arm64' : undefined;
  if (!cpu) {
    fail(`Unsupported architecture: ${arch}`, {
      hint: 'Releases are published for x64 and arm64 only.',
    });
  }

  const libc = os === 'linux' && musl ? '-musl' : '';
  return `${ARTIFACT_PREFIX}-${os}-${cpu}${libc}`;
}

/** Strips a leading `v` so `--to v0.4.1` and `--to 0.4.1` mean the same thing. */
const normalize = (version: string): string => version.replace(/^v/, '');

/**
 * Compares two semver-ish versions. Returns >0 when `a` is newer.
 *
 * Only the numeric release parts are compared; a prerelease suffix is ignored rather than ordered,
 * because getting that subtly wrong is worse than not claiming to handle it. `upgrade` never
 * *blocks* on the comparison — it only decides whether to say "already current" and whether a
 * `--to` is a downgrade worth confirming.
 */
export function compareVersions(a: string, b: string): number {
  const parts = (v: string): number[] =>
    (normalize(v).split('-')[0] ?? '').split('.').map((n) => Number.parseInt(n, 10) || 0);
  const [left, right] = [parts(a), parts(b)];

  for (let i = 0; i < Math.max(left.length, right.length); i += 1) {
    const diff = (left[i] ?? 0) - (right[i] ?? 0);
    if (diff !== 0) return diff;
  }
  return 0;
}

/**
 * The newest published version, via the `/releases/latest` redirect.
 *
 * `install.sh` resolves it the same way and for the same reason: the unauthenticated GitHub API is
 * rate-limited per IP, and an upgrade check is exactly the sort of thing a user runs repeatedly.
 * The redirect target has no such limit.
 */
export async function resolveLatest(fetchImpl: FetchLike): Promise<string> {
  let response: Response;
  try {
    response = await fetchImpl(LATEST_URL, { method: 'HEAD', redirect: 'follow' });
  } catch (cause) {
    return fail('Could not reach GitHub to check for a newer version.', {
      hint: 'Check your network, or pass --to <version> to install a specific one.',
      cause,
    });
  }

  const tag = response.url.split('/').pop();
  if (!response.ok || !tag || tag === 'latest') {
    return fail('Could not determine the latest version.', {
      hint: 'Pass --to <version> to install a specific one.',
    });
  }
  return normalize(tag);
}

export async function upgrade(
  options: UpgradeOptions = {},
  deps: UpgradeDeps = defaultDeps,
): Promise<void> {
  const install = detectInstall(deps.execPath(), deps.modulePath());

  // A checkout has nothing to upgrade and never did. Fail before the network call.
  if (install === 'dev') {
    fail('This looks like a development checkout, not an installed binary.', {
      hint: 'Run the installed `runta-next upgrade`, or reinstall with: curl -fsSL https://runta.haxzie.com/install.sh | sh',
    });
  }

  // An npm install is upgraded by npm. Resolving the binary would fail, and the path this command
  // knows how to take — download a release asset and rename it over itself — would be wrong even
  // if it succeeded. `--check` still answers below, because "is there a newer version" has an
  // answer here; only the install half is somebody else's job.
  const installed = install === 'npm' ? deps.modulePath() : await locateBinary(deps);
  const target = detectTarget(deps.platform(), deps.arch(), deps.isMusl());

  const wanted = options.to ? normalize(options.to) : await resolveLatest(deps.fetch);
  const comparison = compareVersions(wanted, currentVersion);

  // `--check` is a question, not an action, so it answers and stops — and exits 0 either way.
  // Making "an upgrade exists" a non-zero exit would break every `runta-next upgrade --check` in a
  // `set -e` script that only wanted to know.
  if (options.check) {
    report(
      {
        action: 'upgrade',
        checked: true,
        current_version: currentVersion,
        latest_version: wanted,
        upgrade_available: comparison > 0,
        target,
        path: installed,
      },
      options,
      deps,
      comparison > 0
        ? `A newer version is available: ${currentVersion} → ${wanted}`
        : `Already on the latest version (${currentVersion}).`,
    );
    if (comparison > 0 && !options.json) {
      // `runta-next upgrade` now works on both, so it is the right suggestion either way.
      printNextSteps([{ command: 'runta-next upgrade', why: 'install it' }]);
    }
    return;
  }

  if (comparison === 0) {
    report(
      {
        action: 'upgrade',
        upgraded: false,
        reason: 'already_current',
        current_version: currentVersion,
        target,
        path: installed,
      },
      options,
      deps,
      `Already on ${currentVersion}. Nothing to do.`,
    );
    return;
  }

  // An npm install is replaced by the package manager that put it there, not by renaming a
  // downloaded asset over it. Same command, same flags, same confirmation — only the mechanism
  // differs, and the user should not have to know which one they got.
  if (install === 'npm') {
    await upgradeViaPackageManager(wanted, comparison, installed, options, deps);
    return;
  }

  const baseUrl = `https://github.com/${REPO}/releases/download/v${wanted}`;

  if (options.dryRun) {
    report(
      {
        action: 'upgrade',
        dry_run: true,
        current_version: currentVersion,
        target_version: wanted,
        downgrade: comparison < 0,
        target,
        url: `${baseUrl}/${target}.tar.gz`,
        path: installed,
      },
      options,
      deps,
      [
        `Would ${comparison < 0 ? 'downgrade' : 'upgrade'} ${currentVersion} → ${wanted}`,
        `  asset    ${target}.tar.gz`,
        `  from     ${baseUrl}`,
        `  replacing ${installed}`,
      ].join('\n'),
    );
    return;
  }

  await confirmDowngrade(wanted, comparison, options, deps);

  logger.info(`Downloading ${target} ${wanted}…`);
  const staged = await download(baseUrl, target, installed, wanted, deps);

  await rename(staged, installed);
  logger.info(`Upgraded ${currentVersion} → ${wanted}.`);

  if (options.json) {
    report(
      {
        action: 'upgrade',
        upgraded: true,
        previous_version: currentVersion,
        current_version: wanted,
        target,
        path: installed,
      },
      options,
      deps,
      '',
    );
  }
}

/**
 * Going backwards is a legitimate thing to want and a surprising thing to do by accident, so it is
 * the one case here that asks. Never under --json or in a pipe, where nothing could answer.
 */
async function confirmDowngrade(
  wanted: string,
  comparison: number,
  options: UpgradeOptions,
  deps: UpgradeDeps,
): Promise<void> {
  if (comparison < 0 && !options.yes && !options.json && deps.isInteractive()) {
    const ok = await deps.confirm(
      `This will replace ${currentVersion} with the older ${wanted}. Continue?`,
    );
    if (!ok) fail('Aborted.', { exitCode: 1 });
  }
}

/**
 * Hands the upgrade to the package manager that owns this install.
 *
 * There is no staging step to make this atomic the way the binary path is — the manager owns that
 * — so the guarantee is weaker by nature. What it does keep is the surface: the same flags mean
 * the same things, and a failure says which command failed rather than leaking a raw exit code.
 */
async function upgradeViaPackageManager(
  wanted: string,
  comparison: number,
  installed: string,
  options: UpgradeOptions,
  deps: UpgradeDeps,
): Promise<void> {
  const manager = detectPackageManager(installed);
  const [command, args] = installCommand(manager, wanted);
  const printable = [command, ...args].join(' ');

  if (options.dryRun) {
    report(
      {
        action: 'upgrade',
        dry_run: true,
        current_version: currentVersion,
        target_version: wanted,
        downgrade: comparison < 0,
        install: 'npm',
        package_manager: manager,
        command: printable,
        path: installed,
      },
      options,
      deps,
      [
        `Would ${comparison < 0 ? 'downgrade' : 'upgrade'} ${currentVersion} → ${wanted}`,
        `  via      ${printable}`,
        `  replacing ${installed}`,
      ].join('\n'),
    );
    return;
  }

  await confirmDowngrade(wanted, comparison, options, deps);

  logger.info(`Running ${printable}…`);
  await deps.run(command, args).catch((cause: unknown) => {
    const message = cause instanceof Error ? cause.message : String(cause);
    // A global install into a root owned by another user is the common failure, and npm's own
    // wording for it is buried under a stack of paths.
    const denied = /EACCES|permission denied/i.test(message);
    return fail(`\`${printable}\` failed; you are still on ${currentVersion}.`, {
      hint: denied
        ? `No permission to write to the global install root. Re-run with sudo, or reinstall ${NPM_PACKAGE} somewhere you own.`
        : `Run it yourself to see why: ${printable}`,
      cause,
    });
  });

  logger.info(`Upgraded ${currentVersion} → ${wanted}.`);

  if (options.json) {
    report(
      {
        action: 'upgrade',
        upgraded: true,
        previous_version: currentVersion,
        current_version: wanted,
        install: 'npm',
        package_manager: manager,
        command: printable,
        path: installed,
      },
      options,
      deps,
      '',
    );
  }
}

/**
 * Downloads, verifies and stages the new binary, returning the staged path.
 *
 * Every step happens before anything replaces the installed binary: a bad download, a checksum
 * mismatch or a binary that will not run leaves the working install untouched. The staging file is
 * created in the *install directory* rather than a temp dir so the final `rename` is within one
 * filesystem, which is what makes it atomic — across devices it would fail with EXDEV.
 */
async function download(
  baseUrl: string,
  target: string,
  installed: string,
  wanted: string,
  deps: UpgradeDeps,
): Promise<string> {
  const tarball = `${target}.tar.gz`;
  const work = await mkdtemp(join(tmpdir(), 'runta-next-upgrade-'));

  try {
    const archive = join(work, tarball);
    await writeFile(archive, await get(`${baseUrl}/${tarball}`, deps));

    const checksums = await get(`${baseUrl}/checksums.txt`, deps);
    verifyChecksum(await readFile(archive), checksums.toString('utf8'), tarball);

    // `tar` is required by install.sh too, so this adds no new dependency.
    await deps.run('tar', ['-xzf', archive, '-C', work]);

    const extracted = join(work, ARTIFACT_PREFIX);
    if (!(await exists(extracted))) {
      fail(`The ${wanted} archive did not contain a \`${ARTIFACT_PREFIX}\` binary.`);
    }
    await chmod(extracted, 0o755);

    // Run it before trusting it. The release workflow smoke-tests the linux-x64 build only, so this
    // is the first time this platform's binary has been executed anywhere.
    const reported = (
      await deps.run(extracted, ['--version']).catch((cause: unknown) => {
        return fail(`The downloaded ${wanted} binary does not run; keeping ${currentVersion}.`, {
          cause,
        });
      })
    ).trim();

    if (reported !== wanted) {
      fail(`The downloaded binary reports ${reported}, not ${wanted}.`, {
        hint: 'The release may be mid-publish. Try again, or pass --to <version>.',
      });
    }

    const staged = join(dirname(installed), `.${basename(installed)}.upgrade`);
    await rename(extracted, staged).catch(async (cause: unknown) => {
      // Different filesystem: fall back to a copy, which is still staged beside the target so the
      // final rename stays atomic.
      if ((cause as NodeJS.ErrnoException).code !== 'EXDEV') throw cause;
      await writeFile(staged, await readFile(extracted), { mode: 0o755 });
    });
    await chmod(staged, 0o755);
    return staged;
  } finally {
    await rm(work, { recursive: true, force: true });
  }
}

async function get(url: string, deps: UpgradeDeps): Promise<Buffer> {
  let response: Response;
  try {
    response = await deps.fetch(url);
  } catch (cause) {
    return fail(`Download failed: ${url}`, { hint: 'Check your network and try again.', cause });
  }
  if (!response.ok) {
    return fail(`Download failed: ${url} (HTTP ${response.status})`, {
      hint:
        response.status === 404
          ? 'That version may not exist, or may not publish an asset for this platform.'
          : 'Try again in a moment.',
    });
  }
  return Buffer.from(await response.arrayBuffer());
}

/** Verifies the archive against `checksums.txt`, exactly as install.sh does. */
export function verifyChecksum(archive: Buffer, checksums: string, name: string): void {
  const expected = checksums
    .split('\n')
    .map((line) => line.trim().split(/\s+/))
    .find(([, file]) => file === name)?.[0];

  if (!expected) fail(`No checksum published for ${name}.`);

  const actual = createHash('sha256').update(archive).digest('hex');
  if (actual !== expected) {
    // Unlike install.sh, there is no "no sha256 tool" escape hatch to fall through — node always
    // has one — so a mismatch here is always fatal.
    fail(`Checksum mismatch for ${name}.`, {
      hint: `Expected ${expected}, got ${actual}. Do not use this download.`,
    });
  }
}

/**
 * The binary this command would replace.
 *
 * Only ever called for a standalone binary; `detectInstall` has already turned away the checkout
 * and npm cases, where `process.execPath` is node and there is no binary to replace. Refuses when
 * the file is not writable, which is the `sudo`-installed case: saying so beats a confusing EACCES
 * from halfway through.
 */
async function locateBinary(deps: UpgradeDeps): Promise<string> {
  const execPath = deps.execPath();

  const real = await resolvePath(execPath).catch(() => execPath);
  try {
    // Writability of the *file*, since that is what gets renamed over.
    await stat(real);
  } catch (cause) {
    return fail(`Cannot find the installed binary at ${real}.`, { cause });
  }

  try {
    // The directory must be writable too: the staged file is created there and renamed over.
    await access(dirname(real), constants.W_OK);
    await access(real, constants.W_OK);
  } catch (cause) {
    return fail(`No permission to replace ${real}.`, {
      hint: `Re-run with sudo, or reinstall into a writable location with RUNTA_INSTALL_DIR.`,
      cause,
    });
  }

  return real;
}

const exists = async (path: string): Promise<boolean> =>
  await stat(path).then(
    () => true,
    () => false,
  );

/** One place that decides JSON versus prose, so every branch above emits both. */
function report(
  payload: Record<string, unknown>,
  options: UpgradeOptions,
  deps: UpgradeDeps,
  message: string,
): void {
  if (options.json) {
    deps.write(`${JSON.stringify(payload, null, 2)}\n`);
    return;
  }
  if (message) logger.info(message);
}

export function registerUpgrade(program: Command): void {
  program
    .command('upgrade')
    .description('Upgrade this CLI to the latest release')
    .option('--check', 'report whether a newer version exists, and change nothing')
    .option('--to <version>', 'install a specific version instead of the latest')
    .option('--dry-run', 'show what would be installed and exit')
    .option('-y, --yes', 'skip the confirmation when moving to an older version')
    .option('--json', 'print the result as JSON')
    .action(async (opts: UpgradeOptions) => {
      await upgrade(opts);
    });
}
