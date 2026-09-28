import { createHash } from 'node:crypto';
import { chmod, mkdtemp, readdir, readFile, realpath, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { isCliError, setLogLevel } from '@runta/utils';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { version as currentVersion } from '../version.js';
import {
  compareVersions,
  detectTarget,
  resolveLatest,
  type UpgradeDeps,
  upgrade,
  verifyChecksum,
} from './upgrade.js';

const REPO_ROOT = join(import.meta.dirname, '..', '..', '..', '..');

/**
 * A response that reports a final URL, as a followed redirect does.
 *
 * `Response.url` is a getter with no setter, so it has to be defined rather than assigned —
 * `Object.assign` silently leaves it as the empty string, which made every one of these tests look
 * like a network failure.
 */
const redirectedTo = (url: string): Response => {
  const response = new Response(null, { status: 200 });
  Object.defineProperty(response, 'url', { value: url });
  return response;
};

describe('detectTarget', () => {
  it('names the asset for each supported platform', () => {
    expect(detectTarget('darwin', 'arm64', false)).toBe('runta-next-darwin-arm64');
    expect(detectTarget('darwin', 'x64', false)).toBe('runta-next-darwin-x64');
    expect(detectTarget('linux', 'arm64', false)).toBe('runta-next-linux-arm64');
    expect(detectTarget('linux', 'x64', false)).toBe('runta-next-linux-x64');
  });

  it('picks the musl build only on linux', () => {
    expect(detectTarget('linux', 'x64', true)).toBe('runta-next-linux-x64-musl');
    // A musl flag on darwin would be nonsense; there is no such asset.
    expect(detectTarget('darwin', 'arm64', true)).toBe('runta-next-darwin-arm64');
  });

  it('refuses a platform no release supports, rather than guessing', () => {
    expect(() => detectTarget('win32', 'x64', false)).toThrow(/Unsupported operating system/);
    expect(() => detectTarget('linux', 'riscv64', false)).toThrow(/Unsupported architecture/);
  });

  /**
   * The whole command rests on these names matching the published assets. `install.sh` builds them
   * in shell and `build-binaries.ts` publishes them, so there are three copies of one convention;
   * this is what stops them drifting.
   */
  it('only produces asset names that build-binaries.ts actually publishes', async () => {
    const source = await readFile(join(REPO_ROOT, 'scripts/build-binaries.ts'), 'utf8');
    const published = new Set(
      [...source.matchAll(/artifact: '([^']+)'/g)].map((match) => match[1] as string),
    );

    expect(published.size).toBe(6);
    for (const platform of ['darwin', 'linux']) {
      for (const arch of ['arm64', 'x64']) {
        for (const musl of [false, true]) {
          expect(published).toContain(detectTarget(platform, arch, musl));
        }
      }
    }
  });

  it('agrees with install.sh about which names exist', async () => {
    const script = await readFile(join(REPO_ROOT, 'scripts/install.sh'), 'utf8');
    // install.sh assembles `$ARTIFACT_PREFIX-$os-$arch$libc`; assert the pieces it maps to.
    expect(script).toMatch(/ARTIFACT_PREFIX="runta-next"/);
    expect(script).toMatch(/Darwin\) os=darwin/);
    expect(script).toMatch(/Linux\) os=linux/);
    expect(script).toMatch(/x86_64 \| amd64\) arch=x64/);
    expect(script).toMatch(/arm64 \| aarch64\) arch=arm64/);
    expect(script).toMatch(/libc="-musl"/);
  });
});

describe('compareVersions', () => {
  it('orders releases', () => {
    expect(compareVersions('0.4.1', '0.4.0')).toBeGreaterThan(0);
    expect(compareVersions('0.4.0', '0.4.1')).toBeLessThan(0);
    expect(compareVersions('0.4.0', '0.4.0')).toBe(0);
    expect(compareVersions('1.0.0', '0.9.9')).toBeGreaterThan(0);
    expect(compareVersions('0.10.0', '0.9.0')).toBeGreaterThan(0);
  });

  it('ignores a leading v, so --to v0.4.1 and --to 0.4.1 agree', () => {
    expect(compareVersions('v0.4.1', '0.4.1')).toBe(0);
  });

  it('compares the release parts of a prerelease, not the suffix', () => {
    expect(compareVersions('0.5.0-beta.1', '0.4.0')).toBeGreaterThan(0);
    expect(compareVersions('0.4.0-beta.1', '0.4.0')).toBe(0);
  });
});

describe('verifyChecksum', () => {
  const body = Buffer.from('tarball bytes');
  const digest = createHash('sha256').update(body).digest('hex');

  it('accepts a matching digest', () => {
    expect(() => verifyChecksum(body, `${digest}  asset.tar.gz\n`, 'asset.tar.gz')).not.toThrow();
  });

  it('rejects a mismatch', () => {
    const wrong = 'f'.repeat(64);
    expect(() => verifyChecksum(body, `${wrong}  asset.tar.gz\n`, 'asset.tar.gz')).toThrow(
      /Checksum mismatch/,
    );
  });

  it('rejects an asset with no published checksum, rather than skipping the check', () => {
    expect(() => verifyChecksum(body, `${digest}  other.tar.gz\n`, 'asset.tar.gz')).toThrow(
      /No checksum published/,
    );
  });

  it('reads the right line when several assets are listed', () => {
    const checksums = [`${'0'.repeat(64)}  a.tar.gz`, `${digest}  asset.tar.gz`, ''].join('\n');
    expect(() => verifyChecksum(body, checksums, 'asset.tar.gz')).not.toThrow();
  });
});

describe('resolveLatest', () => {
  it('reads the version from the /releases/latest redirect target', async () => {
    // Typed params, so asserting on the second argument below is not an index into an empty tuple.
    const fetchImpl = vi.fn(async (_url: string, _init?: { method?: string }) =>
      redirectedTo('https://github.com/haxzie/runta-cli/releases/tag/v1.2.3'),
    );

    expect(await resolveLatest(fetchImpl as never)).toBe('1.2.3');
    // A HEAD, because the body is never needed and the redirect is the whole answer.
    expect(fetchImpl.mock.calls[0]?.[1]).toMatchObject({ method: 'HEAD' });
  });

  it('fails with an actionable hint when the redirect did not resolve', async () => {
    const fetchImpl = async () =>
      redirectedTo('https://github.com/haxzie/runta-cli/releases/latest');

    await expect(resolveLatest(fetchImpl as never)).rejects.toThrow(
      /Could not determine the latest version/,
    );
  });

  it('names the network as the cause when the request throws', async () => {
    const fetchImpl = async () => {
      throw new Error('ENOTFOUND');
    };

    await expect(resolveLatest(fetchImpl as never)).rejects.toThrow(/Could not reach GitHub/);
  });
});

// ---------------------------------------------------------------- the command

let dir: string;
let installed: string;
let written: string[];

/** A stand-in for the installed binary, so a test can prove it was or was not replaced. */
beforeEach(async () => {
  setLogLevel('info');
  // Resolved, because the command resolves symlinks before touching anything — on macOS $TMPDIR
  // lives under /var, which is a link to /private/var, so an unresolved path would not match what
  // the command reports.
  dir = await realpath(await mkdtemp(join(tmpdir(), 'runta-next-upgrade-test-')));
  installed = join(dir, 'runta-next');
  await writeFile(installed, 'OLD BINARY', { mode: 0o755 });
  written = [];
});

afterEach(() => {
  vi.restoreAllMocks();
});

const NEW_VERSION = '99.0.0';

/**
 * Deps wired to a fake release: a tarball whose checksum matches, and a `tar` that "extracts" the
 * new binary. `run` also stands in for executing the downloaded binary.
 */
function deps(overrides: Partial<UpgradeDeps> = {}): UpgradeDeps {
  const tarball = Buffer.from('FAKE TARBALL');
  const digest = createHash('sha256').update(tarball).digest('hex');

  return {
    write: (text) => written.push(text),
    execPath: () => installed,
    platform: () => 'linux',
    arch: () => 'x64',
    isMusl: () => false,
    isInteractive: () => false,
    confirm: async () => true,
    fetch: async (url) => {
      if (url.endsWith('/releases/latest')) {
        return redirectedTo(`https://github.com/x/y/releases/tag/v${NEW_VERSION}`);
      }
      if (url.endsWith('checksums.txt')) {
        return new Response(`${digest}  runta-next-linux-x64.tar.gz\n`);
      }
      if (url.endsWith('.tar.gz')) return new Response(tarball);
      return new Response('nope', { status: 404 });
    },
    run: async (command, args) => {
      if (command === 'tar') {
        // Where tar would have put it.
        const into = args[args.indexOf('-C') + 1] as string;
        await writeFile(join(into, 'runta-next'), 'NEW BINARY', { mode: 0o755 });
        return '';
      }
      // The staged binary being asked its version.
      return `${NEW_VERSION}\n`;
    },
    ...overrides,
  };
}

const jsonOf = (): Record<string, unknown> =>
  JSON.parse(written.join('')) as Record<string, unknown>;

describe('upgrade --check', () => {
  it('reports an available upgrade without touching the binary', async () => {
    await upgrade({ check: true, json: true }, deps());

    expect(jsonOf()).toMatchObject({
      checked: true,
      current_version: currentVersion,
      latest_version: NEW_VERSION,
      upgrade_available: true,
    });
    expect(await readFile(installed, 'utf8')).toBe('OLD BINARY');
  });

  /**
   * A query exits 0 whatever the answer. Making "an upgrade exists" non-zero would break every
   * `upgrade --check` in a `set -e` script that only wanted to know.
   */
  it('exits 0 when an upgrade is available', async () => {
    await expect(upgrade({ check: true, json: true }, deps())).resolves.toBeUndefined();
  });

  it('says so when already current', async () => {
    const d = deps({
      fetch: async () => redirectedTo(`https://github.com/x/y/releases/tag/v${currentVersion}`),
    });

    await upgrade({ check: true, json: true }, d);

    expect(jsonOf()).toMatchObject({ upgrade_available: false });
  });
});

describe('upgrade --dry-run', () => {
  it('prints the resolved plan as JSON and changes nothing', async () => {
    await upgrade({ dryRun: true, json: true }, deps());

    expect(jsonOf()).toMatchObject({
      dry_run: true,
      target_version: NEW_VERSION,
      target: 'runta-next-linux-x64',
      url: `https://github.com/haxzie/runta-cli/releases/download/v${NEW_VERSION}/runta-next-linux-x64.tar.gz`,
      path: installed,
    });
    expect(await readFile(installed, 'utf8')).toBe('OLD BINARY');
  });

  it('makes no request for the asset itself', async () => {
    const asked: string[] = [];
    const base = deps();
    await upgrade(
      { dryRun: true, json: true },
      {
        ...base,
        fetch: async (url, init) => {
          asked.push(url);
          return await base.fetch(url, init);
        },
      },
    );

    expect(asked.some((url) => url.endsWith('.tar.gz'))).toBe(false);
  });
});

describe('upgrade', () => {
  it('replaces the installed binary', async () => {
    await upgrade({}, deps());

    expect(await readFile(installed, 'utf8')).toBe('NEW BINARY');
  });

  it('leaves the new binary executable', async () => {
    await upgrade({}, deps());

    expect((await stat(installed)).mode & 0o111).not.toBe(0);
  });

  it('reports the move in JSON', async () => {
    await upgrade({ json: true }, deps());

    expect(jsonOf()).toMatchObject({
      upgraded: true,
      previous_version: currentVersion,
      current_version: NEW_VERSION,
    });
  });

  it('does nothing when already on the latest version', async () => {
    const d = deps({
      fetch: async () => redirectedTo(`https://github.com/x/y/releases/tag/v${currentVersion}`),
    });

    await upgrade({ json: true }, d);

    expect(jsonOf()).toMatchObject({ upgraded: false, reason: 'already_current' });
    expect(await readFile(installed, 'utf8')).toBe('OLD BINARY');
  });

  it('installs an explicit --to without consulting the latest release', async () => {
    const asked: string[] = [];
    const base = deps();
    await upgrade(
      { to: 'v99.0.0' },
      {
        ...base,
        fetch: async (url, init) => {
          asked.push(url);
          return await base.fetch(url, init);
        },
      },
    );

    expect(asked.some((url) => url.endsWith('/releases/latest'))).toBe(false);
    expect(await readFile(installed, 'utf8')).toBe('NEW BINARY');
  });

  // ---- the binary must survive every failure ----

  it('keeps the old binary when the checksum does not match', async () => {
    const d = deps({
      fetch: async (url) => {
        if (url.endsWith('checksums.txt')) return new Response(`${'f'.repeat(64)}  x.tar.gz\n`);
        if (url.endsWith('/releases/latest')) {
          return redirectedTo(`https://github.com/x/y/releases/tag/v${NEW_VERSION}`);
        }
        return new Response(Buffer.from('FAKE TARBALL'));
      },
    });

    await expect(upgrade({}, d)).rejects.toThrow(/No checksum published|Checksum mismatch/);
    expect(await readFile(installed, 'utf8')).toBe('OLD BINARY');
  });

  it('keeps the old binary when the download 404s', async () => {
    const base = deps();
    const d = deps({
      fetch: async (url, init) =>
        url.endsWith('.tar.gz')
          ? new Response('missing', { status: 404 })
          : await base.fetch(url, init),
    });

    await expect(upgrade({}, d)).rejects.toThrow(/Download failed.*404/s);
    expect(await readFile(installed, 'utf8')).toBe('OLD BINARY');
  });

  /**
   * The release workflow smoke-tests only the linux-x64 build, so for every other platform this is
   * the first time the downloaded binary has been executed anywhere. Running it before the swap is
   * what makes a bad build a failed upgrade rather than a broken install.
   */
  it('keeps the old binary when the downloaded one will not run', async () => {
    const base = deps();
    const d = deps({
      run: async (command, args) => {
        if (command === 'tar') return await base.run(command, args);
        throw new Error('Exec format error');
      },
    });

    await expect(upgrade({}, d)).rejects.toThrow(/does not run/);
    expect(await readFile(installed, 'utf8')).toBe('OLD BINARY');
  });

  it('keeps the old binary when the downloaded one reports the wrong version', async () => {
    const base = deps();
    const d = deps({
      run: async (command, args) => (command === 'tar' ? await base.run(command, args) : '0.0.1\n'),
    });

    await expect(upgrade({}, d)).rejects.toThrow(/reports 0\.0\.1, not 99\.0\.0/);
    expect(await readFile(installed, 'utf8')).toBe('OLD BINARY');
  });

  it('keeps the old binary when the archive has no binary in it', async () => {
    const d = deps({ run: async () => '' });

    await expect(upgrade({}, d)).rejects.toThrow(/did not contain/);
    expect(await readFile(installed, 'utf8')).toBe('OLD BINARY');
  });

  it('cleans up its temporary directory even when it fails', async () => {
    const before = (await readdir(tmpdir())).filter((e) => e.startsWith('runta-next-upgrade-'));
    const d = deps({ run: async () => '' });

    await expect(upgrade({}, d)).rejects.toThrow();

    const after = (await readdir(tmpdir())).filter((e) => e.startsWith('runta-next-upgrade-'));
    expect(after.length).toBe(before.length);
  });

  // ---- refusing to run in the wrong place ----

  it('refuses in a development checkout rather than clobbering it', async () => {
    const d = deps({ execPath: () => '/usr/local/bin/node' });

    await expect(upgrade({}, d)).rejects.toThrow(/development checkout/);
  });

  it('refuses when the binary is not writable, naming the path', async () => {
    await chmod(installed, 0o500);
    await chmod(dir, 0o500);
    try {
      const error = await upgrade({}, deps()).catch((e: unknown) => e);
      expect(isCliError(error)).toBe(true);
      expect(String(error)).toMatch(/No permission to replace/);
    } finally {
      await chmod(dir, 0o700);
      await chmod(installed, 0o755);
    }
  });

  // ---- going backwards ----

  it('confirms before installing an older version', async () => {
    const asked: string[] = [];
    const d = deps({
      isInteractive: () => true,
      confirm: async (question) => {
        asked.push(question);
        return false;
      },
      run: async (command, args) =>
        command === 'tar' ? await deps().run(command, args) : '0.0.1\n',
    });

    await expect(upgrade({ to: '0.0.1' }, d)).rejects.toThrow(/Aborted/);
    expect(asked[0]).toMatch(/older/);
    expect(await readFile(installed, 'utf8')).toBe('OLD BINARY');
  });

  it('never prompts under --json, where nothing could answer', async () => {
    let prompted = false;
    const base = deps();
    const d = deps({
      isInteractive: () => true,
      confirm: async () => {
        prompted = true;
        return true;
      },
      run: async (command, args) => (command === 'tar' ? await base.run(command, args) : '0.0.1\n'),
    });

    await upgrade({ to: '0.0.1', json: true }, d);

    expect(prompted).toBe(false);
  });

  it('skips the downgrade prompt with -y', async () => {
    let prompted = false;
    const base = deps();
    const d = deps({
      isInteractive: () => true,
      confirm: async () => {
        prompted = true;
        return true;
      },
      run: async (command, args) => (command === 'tar' ? await base.run(command, args) : '0.0.1\n'),
    });

    await upgrade({ to: '0.0.1', yes: true }, d);

    expect(prompted).toBe(false);
    expect(await readFile(installed, 'utf8')).toBe('NEW BINARY');
  });
});
