---
'@haxzie/runta-next': patch
---

Link the `image` commands from the docs sidebar.

`docs/commands/images.md` shipped, released and deployed without a sidebar entry,
so for two releases it was reachable only by typing the URL. The sidebar is
hand-ordered on the argument that reading order is a judgement — which is true, and
whose cost is that a page can ship with no entry at all. A test now fails the build
when a page under `docs/commands/` has no link, and when a link points at a page
that does not exist.
