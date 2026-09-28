#!/usr/bin/env bun
/**
 * Cross-compiles the CLI into standalone binaries with `bun build --compile`, then
 * tarballs them and writes a checksum manifest for `scripts/install.sh` to verify.
 *
 * Bun cross-compiles every target from a single host, so CI needs one runner.
 */
import { createHash } from 'node:crypto';
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { $ } from 'bun';

interface Target {
  /** Bun's --target triple. */
  bun: string;
  /** Artifact name; must match the detection logic in scripts/install.sh. */
  artifact: string;
}

const TARGETS: Target[] = [
  { bun: 'bun-darwin-arm64', artifact: 'runta-next-darwin-arm64' },
  { bun: 'bun-darwin-x64', artifact: 'runta-next-darwin-x64' },
  { bun: 'bun-linux-arm64', artifact: 'runta-next-linux-arm64' },
  { bun: 'bun-linux-x64', artifact: 'runta-next-linux-x64' },
  { bun: 'bun-linux-x64-musl', artifact: 'runta-next-linux-x64-musl' },
  { bun: 'bun-linux-arm64-musl', artifact: 'runta-next-linux-arm64-musl' },
];

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..');
const entrypoint = join(repoRoot, 'apps/cli/src/index.ts');
const outDir = join(repoRoot, 'dist');
/** Raw binaries live here; only tarballs and checksums land in dist/ itself. */
const binDir = join(outDir, 'bin');

async function cliVersion(): Promise<string> {
  const pkg = JSON.parse(await readFile(join(repoRoot, 'apps/cli/package.json'), 'utf8')) as {
    version: string;
  };
  return pkg.version;
}

async function sha256(path: string): Promise<string> {
  return createHash('sha256')
    .update(await readFile(path))
    .digest('hex');
}

async function main(): Promise<void> {
  const version = await cliVersion();
  const only = process.argv.slice(2).filter((arg) => !arg.startsWith('-'));
  const targets = only.length ? TARGETS.filter((t) => only.includes(t.artifact)) : TARGETS;

  if (!targets.length) {
    throw new Error(`No targets matched ${only.join(', ')}`);
  }

  await rm(outDir, { recursive: true, force: true });
  await mkdir(binDir, { recursive: true });

  const checksums: string[] = [];

  for (const target of targets) {
    const binary = join(binDir, target.artifact);
    console.log(`==> ${target.artifact} (${target.bun})`);

    // No --sourcemap: every target would write the same dist/index.js.map, so only the
    // last one would be correct. Stack traces from a minified binary stay readable enough.
    await $`bun build ${entrypoint} \
      --compile \
      --minify \
      --target=${target.bun} \
      --define RUNTA_VERSION=${JSON.stringify(version)} \
      --outfile ${binary}`.cwd(repoRoot);

    // Archive as `runta-next` so the tarball extracts to the final command name.
    const tarball = `${target.artifact}.tar.gz`;
    await $`cp ${binary} ${join(outDir, 'runta-next')}`;
    await $`tar -czf ${tarball} runta-next`.cwd(outDir);
    await $`rm -f ${join(outDir, 'runta-next')}`;

    checksums.push(`${await sha256(join(outDir, tarball))}  ${tarball}`);
  }

  await writeFile(join(outDir, 'checksums.txt'), `${checksums.join('\n')}\n`, 'utf8');
  console.log(`\nBuilt ${targets.length} target(s) for v${version} into ${outDir}`);
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
