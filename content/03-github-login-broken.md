# Audit 03 — Login: GitHub OAuth does nothing (blocker)

**Date:** 2026-09-25
**Surface:** Runta login screen
**Method:** Manual walkthrough
**Status:** 🔴 Blocker — audit could not proceed past this point

## Raw notes

> Couldn't get the github login working, nothing happens when clicked in the login screen.
> Blocked by login.

## Observations

### 1. "Continue with GitHub" is a dead button
Clicking the GitHub login option produces no visible response at all — no OAuth redirect, no popup,
no spinner, no error message. The screen simply stays as it is. From the user's side the button is
indistinguishable from a static image.

### 2. Failure is completely silent
Whatever is going wrong, nothing surfaces it. There's no error toast, no inline message, and no fallback
instruction. A user in this state has no signal about whether the click registered, whether it's their
network, whether Runta is down, or whether they should just try again.

### 3. This blocks the entire product
GitHub OAuth appears to be the primary way in. With it dead, a new user cannot sign up, an existing user
cannot return, and every downstream surface — dashboard, CLI auth, billing — is unreachable. Everything
promised on the marketing site ends at this screen. This is the single highest-severity item in the audit
so far; the rest of the audit is blocked behind it.

## Suggested fixes

**Immediate — diagnose the dead click:**
- Check the browser console and network tab on click. The likely candidates: a JS error thrown before the
  handler runs, the OAuth request 4xx-ing, a popup silently blocked by the browser, or the handler never
  being wired to the button at all.
- Verify the OAuth app config end to end — client ID present in the deployed environment, callback/redirect
  URI matching the deployed origin exactly, and the required scopes granted. A redirect URI mismatch is the
  classic cause of a login that appears to do nothing.
- Confirm this isn't environment-specific: test production vs. staging, and a fresh browser profile vs. one
  with an existing session or extensions.

**Regardless of root cause — never fail silently:**
- Show a **loading state** on the button the instant it's clicked, so the click is always acknowledged.
- Surface a real **error message** when the OAuth flow fails, with a retry action and a support/contact path.
- Handle **blocked popups** explicitly — detect the block and fall back to a same-tab redirect, or tell the
  user to allow popups.

## Open questions

- Does it fail on a specific browser/OS, or everywhere?
- Any console errors or failed network requests visible at click time?
- Does this reproduce on production, or was the audit run against staging/local?
