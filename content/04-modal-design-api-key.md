# Audit 04 — Modals: layout and spacing (New API key)

**Date:** 2026-09-25
**Surface:** "New API key" modal (dashboard)
**Method:** Manual walkthrough

![New API key modal as audited](./assets/04-modal-design-api-key.png)

## Raw notes

> The ui design of modals is quite bad, the buttons and messages, none of them are of same height
> and text feels cramped.

## Observations

### 1. Warning box and action buttons are different heights on the same row
The amber warning block and the Copy/Close buttons share a row but are nowhere near the same height — the
warning is roughly half again as tall as the buttons, and neither their tops nor their bottoms line up.
The result reads as three unrelated elements that happened to land next to each other rather than one
deliberate action row.

### 2. Warning text is cramped and wraps badly
The message breaks as "This API key is shown once. Copy it before / closing." — orphaning a single word on
the second line, indented to hang under the first line rather than aligning to the text block. Padding
inside the amber box is tight relative to the two lines of text, so the copy presses against its own border.
Giving the warning the full modal width would let it sit on one line and remove the problem entirely.

### 3. A warning and the primary actions shouldn't share a row
Squeezing the warning beside the buttons is what forces both problems above. A caution message is
full-width context; the buttons are the action row. Stacking them — warning below the key field, actions
right-aligned on their own row — resolves the height mismatch and the wrapping in one move.

## Suggested fixes

- **Restructure the layout:** full-width warning under the key field, then a right-aligned action row with
  Copy and Close. This alone fixes the height mismatch and the awkward wrap.
- **Normalise control heights:** give buttons, inputs, and inline blocks a shared height scale so anything
  sharing a row lines up by default rather than by coincidence.
- **Loosen the text:** increase padding inside the warning box and set line-height so two-line messages
  breathe; align wrapped lines to the text block instead of hanging-indenting them.

## Open questions

- Is there an existing spacing/size scale in the design system that these modals are diverging from, or does
  one need defining?
