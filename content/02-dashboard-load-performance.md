# Audit 02 — Dashboard: load performance

**Date:** 2026-09-25
**Surface:** Runta dashboard (authenticated)
**Method:** Manual walkthrough

## Raw notes

> The dashboard loading is very slow, much higher chances for user drop offs.

> Page load speeds are terrible in the dashboard, where there is 2-3 second delay in navigating to
> uncached pages. Likely need to implement prefetch for top level pages.

## Observations

### 1. Dashboard load time is slow enough to risk drop-off
The authenticated dashboard takes long enough to become usable that it reads as sluggish in normal use.
This lands at the worst possible moment in the funnel — right after signup, on the first screen a user sees
after committing — so the cost is measured in abandoned activations, not just annoyance.

### 2. Navigating to an uncached page takes 2-3 seconds
The cost isn't confined to first load — moving between dashboard pages stalls for 2-3 seconds whenever the
destination isn't already cached. Once cached the same navigation is fine, which points at the per-route
data/bundle fetch rather than the app shell. At that duration the UI feels unresponsive on every first visit
to a section, so the penalty repeats throughout the session rather than being paid once at signup.

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
- **Prefetch the top-level pages.** Warm each primary destination's route bundle and data ahead of the click —
  on app load for the main sections, and on hover/focus of a nav link for the rest — so navigation hits a warm
  cache instead of a cold fetch.
- **Set a budget and watch it.** Pick a target for the dashboard route and add monitoring so regressions
  surface before users find them.

## Open questions

- Which parts of the dashboard are slow — the initial shell, or specific data panels?
- Which top-level pages are worst on first navigation?
- Is it consistently slow, or only on cold load / first load after signup?
- Is the bottleneck server-side (queries, API latency) or client-side (bundle size, hydration)?
