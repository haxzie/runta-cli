# Runta — UX Audit Feedback

Consolidated, point-by-point feedback from manual UX audits of the Runta product.
Each audit's raw notes live in [`content/`](./content); this file is the running index of actionable points.

## Index

| # | Audit | Surface | Date |
|---|-------|---------|------|
| 01 | [Marketing site: homepage / first fold](./content/01-marketing-homepage-hero.md) | runta.dev homepage (logged-out, desktop) | 2026-09-25 |
| 02 | [Dashboard: load performance](./content/02-dashboard-load-performance.md) | Runta dashboard (authenticated) | 2026-09-25 |
| 03 | [Login: GitHub OAuth does nothing](./content/03-github-login-broken.md) 🔴 | Runta login screen | 2026-09-25 |
| 04 | [Modals: layout and spacing](./content/04-modal-design-api-key.md) | "New API key" modal (dashboard) | 2026-09-25 |
| 05 | [Settings → Keys: layout shift on load](./content/05-keys-page-layout-shift.md) | Settings → Keys | 2026-09-25 |

## Feedback Points

> 🔴 **Blocker outstanding:** [F-07](#login--github-oauth-blocker) — GitHub login is dead, which blocks
> sign-up, sign-in, and every authenticated surface behind it. Fix this before anything else on this list.

### Marketing site — homepage / first fold
Source: [`content/01-marketing-homepage-hero.md`](./content/01-marketing-homepage-hero.md)

- **[F-01] No login/sign-in entry point on the homepage.** _Severity: high._
  The header only offers a "Start free with $50 credit" CTA — returning users have no way back into the
  product and must guess a URL.
  → Add a secondary **Sign in** link in the top-right header, next to the primary CTA.

- **[F-02] Hero doesn't surface the CLI command.** _Severity: high._
  Runta is CLI-first, but the first fold shows no command. The only paths are a signup funnel or a quiet
  "View the quickstart" text link.
  → Put the install/run command in the hero as a terminal-style block with one-click copy, as a primary
  action alongside the credit CTA.

- **[F-03] No copy-paste affordance for agent users.** _Severity: medium._
  Nothing on the fold can be copied — no install command, no setup prompt — despite the audience running
  AI coding agents.
  → Add a **Copy prompt** button that yields a ready-made setup prompt for Claude Code / Cursor / etc.

- **[F-04] Page reads as generic and "vibecoded".** _Severity: medium._
  Dark background + orange accent, pill news badge, three evenly-sized empty feature boxes, bordered offer
  card — every default of a generated dark SaaS landing page, with nothing specific to Runta.
  → Give the fold a brand point of view: custom type treatment, real product surface, or illustration.

### Dashboard — load performance
Source: [`content/02-dashboard-load-performance.md`](./content/02-dashboard-load-performance.md)

- **[F-06] Dashboard load is slow enough to drive drop-offs.** _Severity: high._
  The authenticated dashboard takes long enough to become usable that it reads as sluggish. It sits at the
  worst point in the funnel — the first screen after signup — so the cost shows up as lost activations.
  → Measure the route (TTFB / LCP / TTI, cold vs. warm, first-load-after-signup vs. return) to find the real
  bottleneck; render a shell with skeletons on first paint so the page is never blank; stream or defer heavy
  panels so cheap content paints first; set a perf budget with monitoring to catch regressions.

### Login — GitHub OAuth 🔴 BLOCKER
Source: [`content/03-github-login-broken.md`](./content/03-github-login-broken.md)

- **[F-07] "Continue with GitHub" does nothing when clicked.** _Severity: **blocker**._
  No redirect, no popup, no spinner, no error — the button is indistinguishable from a static image, and the
  failure is entirely silent. Since GitHub OAuth appears to be the only way in, this blocks sign-up, sign-in,
  and every downstream surface (dashboard, CLI auth, billing). The audit could not proceed past this screen.
  → Diagnose via console/network on click (JS error, 4xx on the OAuth request, blocked popup, or an unwired
  handler); verify OAuth client ID and that the callback URI matches the deployed origin exactly.

- **[F-08] Login failures are silent — no loading state, no error.** _Severity: high._
  Independent of the root cause of F-07: a user gets zero signal about whether the click registered, whether
  it's their network, or whether Runta is down.
  → Show a loading state on click, surface a real error with a retry and support path on failure, and detect
  blocked popups explicitly with a same-tab redirect fallback.

### Modals — layout and spacing
Source: [`content/04-modal-design-api-key.md`](./content/04-modal-design-api-key.md)

- **[F-10] Warning box and action buttons share a row at mismatched heights.** _Severity: medium._
  In the "New API key" modal the amber warning is roughly half again as tall as the Copy/Close buttons beside
  it, and neither tops nor bottoms align — it reads as three unrelated elements rather than one action row.
  → Move the warning to full width under the key field and give the buttons their own right-aligned row; define
  a shared height scale so controls sharing a row line up by default.

- **[F-11] Warning text is cramped and wraps badly.** _Severity: medium._
  The message orphans "closing." on a second line, hanging-indented rather than aligned to the text block, with
  tight padding pressing the copy against its own border.
  → Full-width warning (fits on one line), more internal padding, set line-height, align wrapped lines.

### Settings → Keys — layout shift on initial load
Source: [`content/05-keys-page-layout-shift.md`](./content/05-keys-page-layout-shift.md)

- **[F-16] Page visibly reflows during initial load.** _Severity: medium._
  Two independently-resolving sections (SSH keys above Runta API Keys) each expand from nothing into very
  differently-sized states, so the upper one displaces everything below it as it settles.
  → Measure CLS on the route first; reserve space with skeletons sized to the final panels (skeleton empty
  state for SSH, skeleton rows for the table), set min-heights on both containers, and fetch both sections in
  parallel rather than letting them pop in independently.
