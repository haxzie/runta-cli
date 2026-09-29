#!/usr/bin/env bun
/**
 * Writes the machine-readable entry points beside the built site.
 *
 * A docs site is a React app by the time it reaches a browser, which is the wrong shape for
 * something that just wants to read. So the same content ships three more ways:
 *
 *   /docs/llms.txt        an index: what exists, one line each, with links
 *   /docs/llms-full.txt   every page concatenated, so one fetch is enough
 *   /docs/raw/<page>.md   the original markdown, per page
 *
 * `llms.txt` follows https://llmstxt.org. The CLI's own help points here, which is the only reason
 * an agent would know to look.
 */
import { mkdir, readdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const docsRoot = join(here, '../../../docs');
const outDir = join(here, '../.vitepress/dist/docs');
const SITE = 'https://runta.haxzie.com/docs';

/** Reading order, matching the sidebar. Pages absent from here are still published, just unlisted. */
const ORDER = [
  'index.md',
  'tour.md',
  'installation.md',
  'authentication.md',
  'configuration.md',
  'output-and-scripting.md',
  'commands/index.md',
  'commands/create.md',
  'commands/list.md',
  'commands/inspect.md',
  'commands/delete.md',
  'commands/exec.md',
  'commands/lifecycle.md',
  'commands/login.md',
  'commands/logout.md',
  'commands/whoami.md',
  'commands/upgrade.md',
];

interface Page {
  path: string;
  title: string;
  description: string;
  body: string;
}

const frontmatter = (text: string): { data: Record<string, string>; body: string } => {
  const match = /^---\n([\s\S]*?)\n---\n?/.exec(text);
  if (!match) return { data: {}, body: text };
  const data: Record<string, string> = {};
  for (const line of (match[1] ?? '').split('\n')) {
    const colon = line.indexOf(':');
    if (colon > 0) data[line.slice(0, colon).trim()] = line.slice(colon + 1).trim();
  }
  return { data, body: text.slice(match[0].length) };
};

async function markdownFiles(dir: string, prefix = ''): Promise<string[]> {
  const found: string[] = [];
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const rel = prefix ? `${prefix}/${entry.name}` : entry.name;
    if (entry.isDirectory()) found.push(...(await markdownFiles(join(dir, entry.name), rel)));
    else if (entry.name.endsWith('.md')) found.push(rel);
  }
  return found;
}

/** `commands/create.md` → `/docs/commands/create`, `index.md` → `/docs`. */
const urlFor = (path: string): string => {
  const trimmed = path.replace(/\.md$/, '').replace(/(^|\/)index$/, '');
  return trimmed ? `${SITE}/${trimmed}` : SITE;
};

/**
 * The agent-facing files are fetched by tools rather than browsers, sometimes from a page, so they
 * allow cross-origin reads. A short cache keeps them fresh across releases without going to the
 * origin on every request.
 */
const HEADERS = `/docs/llms.txt
  access-control-allow-origin: *
  cache-control: public, max-age=300

/docs/llms-full.txt
  access-control-allow-origin: *
  cache-control: public, max-age=300

/docs/raw/*
  access-control-allow-origin: *
  cache-control: public, max-age=300
`;

async function main(): Promise<void> {
  const all = await markdownFiles(docsRoot);
  // Ordered pages first, then anything new that has not been placed yet — so a page added without
  // touching this file still appears, rather than silently going missing.
  const ordered = [
    ...ORDER.filter((p) => all.includes(p)),
    ...all.filter((p) => !ORDER.includes(p)),
  ];

  const pages: Page[] = [];
  for (const path of ordered) {
    const { data, body } = frontmatter(await readFile(join(docsRoot, path), 'utf8'));
    pages.push({
      path,
      title: data.title ?? path,
      description: data.description ?? '',
      body: body.trim(),
    });
  }

  const index = [
    '# runta-next',
    '',
    '> An experimental command line interface for Runta. Not the official CLI — Runta publishes',
    '> that to npm as `@runta/runta-cli`, and it covers considerably more. This one implements the',
    '> runtime lifecycle, `exec` and authentication.',
    '',
    'Install: `curl -fsSL https://runta.haxzie.com/install.sh | sh` — the command is `runta-next`.',
    '',
    `Everything below is also available as one file: ${SITE}/llms-full.txt`,
    '',
    '## Docs',
    '',
    ...pages.map((page) => `- [${page.title}](${urlFor(page.path)}): ${page.description}`),
    '',
    '## Notes for agents',
    '',
    '- Pass `--json` to any command that returns data. The shape does not change based on whether',
    '  stdout is a terminal, so behaviour is identical interactively and in a pipe.',
    '- Branch on exit codes, not message text. Codes are stable; wording is not.',
    "- `exec` exit codes: the remote command's status passes through verbatim; `125` means it could",
    '  not start and retrying is safe; `126` means it started and the outcome is unknown, so do not',
    '  retry a command with side effects.',
    '- Authenticate with `RUNTA_TOKEN` rather than `runta-next login`, which needs a browser.',
    '- `runta-next logout` revokes the credential server-side, for every consumer of it. Avoid it in',
    '  automation; delete `~/.runta-next/config.json` instead.',
    '- Destructive commands take `--dry-run`, which prints the resolved plan as JSON.',
    '',
  ].join('\n');

  const full = [
    '# runta-next — complete documentation',
    '',
    `Generated from ${SITE}. Pages are separated by \`---\` rules.`,
    '',
    ...pages.flatMap((page) => [
      `---`,
      '',
      `# ${page.title}`,
      '',
      page.description,
      '',
      page.body,
      '',
    ]),
  ].join('\n');

  await mkdir(join(outDir, 'raw', 'commands'), { recursive: true });
  await writeFile(join(outDir, 'llms.txt'), index, 'utf8');
  await writeFile(join(outDir, 'llms-full.txt'), full, 'utf8');
  for (const page of pages) {
    const target = join(outDir, 'raw', page.path);
    await mkdir(dirname(target), { recursive: true });
    await writeFile(target, `# ${page.title}\n\n${page.description}\n\n${page.body}\n`, 'utf8');
  }

  // Cloudflare reads `_headers` from the root of the assets directory, which is the parent of
  // `outDir` because the site is mounted under /docs/. Static assets are served before the Worker
  // runs, so this is the only place response headers for them can be set.
  await writeFile(join(outDir, '..', '_headers'), HEADERS, 'utf8');

  console.log(
    `wrote llms.txt, llms-full.txt (${(full.length / 1024).toFixed(1)} KB), _headers and ${pages.length} raw pages`,
  );
  const unlisted = all.filter((p) => !ORDER.includes(p));
  if (unlisted.length)
    console.log(`  note: not in ORDER, appended at the end: ${unlisted.join(', ')}`);
  console.log(`  relative to ${relative(process.cwd(), outDir)}`);
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
