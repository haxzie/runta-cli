import { defineConfig } from 'vitepress';

/**
 * Content is copied in from `docs/` at the repository root by `scripts/sync-content.ts`, into a
 * gitignored `content/` directory. The copy exists because Vite cannot resolve modules for pages
 * living outside the package root — not because there are two sources. `docs/` remains the only
 * place anyone edits, and the copy is regenerated on every build.
 */
export default defineConfig({
  srcDir: 'content',
  outDir: '.vitepress/dist/docs',
  base: '/docs/',
  title: 'runta-next',
  description: 'An experimental command line interface for Runta',
  cleanUrls: true,
  lastUpdated: true,
  ignoreDeadLinks: [/^https?:\/\/(localhost|127\.0\.0\.1)/],

  head: [
    ['meta', { name: 'theme-color', content: '#111111' }],
    // Agents look for this before crawling; see /docs/llms.txt.
    ['link', { rel: 'alternate', type: 'text/plain', href: '/docs/llms.txt' }],
  ],

  themeConfig: {
    nav: [
      { text: 'Tour', link: '/tour' },
      { text: 'Commands', link: '/commands/' },
      { text: 'Install', link: '/installation' },
      { text: 'For agents', link: '/llms.txt', target: '_blank' },
      { text: 'GitHub', link: 'https://github.com/haxzie/runta-cli' },
    ],

    // Hand-ordered rather than derived from frontmatter: the reading order of a docs site is a
    // judgement, and `sidebar_position` numbers are the thing that rots when a page is inserted.
    sidebar: [
      {
        text: 'Getting started',
        items: [
          { text: 'Overview', link: '/' },
          { text: 'A tour of runta-next', link: '/tour' },
          { text: 'Installation', link: '/installation' },
          { text: 'Authentication', link: '/authentication' },
          { text: 'Configuration', link: '/configuration' },
          { text: 'Output and scripting', link: '/output-and-scripting' },
        ],
      },
      {
        text: 'Commands',
        items: [
          { text: 'Overview', link: '/commands/' },
          { text: 'create', link: '/commands/create' },
          { text: 'list', link: '/commands/list' },
          { text: 'inspect', link: '/commands/inspect' },
          { text: 'delete', link: '/commands/delete' },
          { text: 'exec', link: '/commands/exec' },
          { text: 'login', link: '/commands/login' },
          { text: 'logout', link: '/commands/logout' },
          { text: 'whoami', link: '/commands/whoami' },
          { text: 'upgrade', link: '/commands/upgrade' },
        ],
      },
    ],

    search: { provider: 'local' },
    editLink: {
      pattern: 'https://github.com/haxzie/runta-cli/edit/main/docs/:path',
      text: 'Edit this page on GitHub',
    },
    socialLinks: [{ icon: 'github', link: 'https://github.com/haxzie/runta-cli' }],
    footer: {
      message: 'An experiment, not the official Runta CLI.',
      copyright: 'Install with <code>curl -fsSL https://runta.haxzie.com/install.sh | sh</code>',
    },
  },
});
