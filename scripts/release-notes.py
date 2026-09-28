"""
Extracts one version's section from apps/cli/CHANGELOG.md, for the GitHub release body.

Every package here is private and pinned to one version, so changesets appends an "Updated
dependencies" bullet listing the whole workspace at the same number to every entry. That is noise to
anyone reading a release, so it is dropped — but only that bullet and its indented continuation.

An earlier version of this dropped the entire "### Patch Changes" heading instead, which works right
up until a release has nothing but patches: 0.4.1 was exactly that, and the release failed with empty
notes. Filter the bullet, not the section.
"""

import re
import sys

DEPENDENCY_BULLET = re.compile(r'^- Updated dependencies\b')
BULLET = re.compile(r'^- ')
HEADING = re.compile(r'^## ')


def extract(changelog: str, version: str) -> str:
    lines = changelog.split('\n')
    try:
        start = next(i for i, l in enumerate(lines) if l.strip() == f'## {version}')
    except StopIteration:
        return ''

    out: list[str] = []
    skipping = False
    for line in lines[start + 1:]:
        if HEADING.match(line):
            break
        if DEPENDENCY_BULLET.match(line):
            skipping = True
            continue
        # A dependency bullet's continuation lines are indented; the next top-level bullet or
        # heading ends it.
        if skipping:
            if BULLET.match(line) or line.startswith('### '):
                skipping = False
            else:
                continue
        out.append(line)

    # Drop a trailing heading with nothing under it, and collapse the blank lines at both ends.
    while out and not out[-1].strip():
        out.pop()
    if out and out[-1].startswith('### '):
        out.pop()
    while out and not out[0].strip():
        out.pop(0)
    return '\n'.join(out)


def main() -> None:
    version, path = sys.argv[1], sys.argv[2]
    with open(path, encoding='utf8') as handle:
        notes = extract(handle.read(), version)

    if not notes.strip():
        print(f'::error::No changelog section found for {version} in {path}', file=sys.stderr)
        raise SystemExit(1)

    print(notes)


if __name__ == '__main__':
    main()
