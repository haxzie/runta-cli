# Audit 01 — Marketing site: homepage / first fold

**Date:** 2026-09-25
**Surface:** runta.dev marketing homepage (logged-out, desktop)
**Method:** Manual walkthrough

![Homepage hero as audited](./assets/01-marketing-homepage-hero.png)

## Raw notes

> There is no login button in the home page, and the website can be improved a lot — currently it looks
> completely vibecoded. It would be amazing to have the CLI command directly in the hero/first fold to
> quickly get started, or a copy prompt button to get the agents started off.

## Observations

### 1. No login / sign-in entry point in the header
The top nav offers Resources, Pricing, About, Careers, social icons, and a single "Start free with $50
credit" CTA. There is nothing for an **existing** user who just wants to get back into the product.
Returning users have to guess a URL or dig through the docs.

### 2. Overall visual design reads as generic / "vibecoded"
The page hits every default of a generated dark SaaS landing page — dark background with an orange accent,
pill-shaped news badge, three evenly-sized feature boxes, a bordered offer card on the right. Nothing on the
fold is specific to Runta as a product or brand.

### 3. Hero doesn't show the fastest path to value — the CLI command
Runta is a CLI-first product, but the first fold never shows a command. The only route to "doing something"
is the credit CTA (a signup funnel) or a quiet "View the quickstart" text link below the fold line. A
developer who is already convinced has no way to start from this page.

### 4. Nothing for the agent-driven user to copy
There is no copy-to-clipboard affordance anywhere on the fold — not for an install command, not for a
prompt an agent could be handed to set Runta up. For a product whose users are running AI agents, handing
them a paste-ready block is the most natural possible onboarding.

## Suggested fixes

- Add a **Sign in / Log in** link in the top-right header, visually secondary to the primary CTA
  (text link or ghost button next to "Start free with $50 credit").
- Put the **install/run command in the hero** as a real terminal-style block with a one-click copy button —
  ideally as the primary action, with the credit CTA sitting next to it as the secondary path.
- Add a **"Copy prompt" button** that copies a ready-made prompt for setting Runta up via a coding agent
  (Claude Code, Cursor, etc.), so agent users can paste and go.
- Give the fold a brand point of view: custom type treatment, real product surface, or an illustration,
  rather than the default dark + orange accent template.
