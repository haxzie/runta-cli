# Runta — UX Audit Feedback

Consolidated, point-by-point feedback from manual UX audits of the Runta product.
Each audit's raw notes live in [`content/`](./content); this file is the running index of actionable points.

## Index

| # | Audit | Surface | Date |
|---|-------|---------|------|
| 01 | [Marketing site: homepage / first fold](./content/01-marketing-homepage-hero.md) | runta.dev homepage (logged-out, desktop) | 2026-09-25 |

## Feedback Points

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

- **[F-05] Fold has no product imagery and dead space below it.** _Severity: medium._
  The hero is entirely typography and empty boxes; the lower half of the fold is blank.
  → Replace the empty feature boxes / dead space with a terminal recording, product screenshot, or a
  before/after token-cost visual.
