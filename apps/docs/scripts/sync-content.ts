#!/usr/bin/env bun
/**
 * Copies `docs/` into this package so Vite can resolve modules for the pages.
 *
 * Vite resolves imports relative to the file being compiled, so pages outside the package root
 * cannot reach its `node_modules` under pnpm's strict layout. The copy is generated on every build
 * and gitignored: `docs/` at the repository root stays the only place anyone edits.
 */
import { cp, mkdir, rm } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const source = join(here, '../../../docs');
const target = join(here, '../content');

await rm(target, { recursive: true, force: true });
await mkdir(target, { recursive: true });
await cp(source, target, { recursive: true });
console.log(`synced docs/ → ${target.split('/apps/')[1]}`);
