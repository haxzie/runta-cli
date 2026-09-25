# Audit 02 — Dashboard: load performance

**Date:** 2026-09-25
**Surface:** Runta dashboard (authenticated)
**Method:** Manual walkthrough

## Raw notes

> The dashboard loading is very slow, much higher chances for user drop offs.

## Observations

### 1. Dashboard load time is slow enough to risk drop-off
The authenticated dashboard takes long enough to become usable that it reads as sluggish in normal use.
This lands at the worst possible moment in the funnel — right after signup, on the first screen a user sees
after committing — so the cost is measured in abandoned activations, not just annoyance.

## Suggested fixes

- **Measure first.** Capture real numbers for the dashboard route — TTFB, LCP, and time-to-interactive — so
  the fix targets the actual bottleneck rather than a guess. Worth splitting cold vs. warm loads, and
  first-load-after-signup (likely the slowest, and the one that matters most) vs. return visits.
- **Identify what's blocking.** The usual suspects on a dashboard route: serial/waterfalled API calls that
  could run in parallel, unindexed or unbounded queries, a large JS bundle shipped before any content, and
  data fetched on the server before the shell can render at all.
- **Render a shell immediately.** Ship the layout, nav, and skeleton placeholders on first paint so the page
  is never blank while data resolves — perceived speed moves the drop-off number even before real latency does.
- **Stream or defer the expensive panels.** Let the cheap parts of the dashboard paint first and let heavy
  widgets (usage charts, aggregates, history) arrive independently instead of gating the whole page.
- **Set a budget and watch it.** Pick a target for the dashboard route and add monitoring so regressions
  surface before users find them.

## Open questions

- Which parts of the dashboard are slow — the initial shell, or specific data panels?
- Is it consistently slow, or only on cold load / first load after signup?
- Is the bottleneck server-side (queries, API latency) or client-side (bundle size, hydration)?
