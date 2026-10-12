# VISFIX — release notes move no screenshot

Branch `fix/visual-release-fixture` from main `4d28a4f84`, 2026-10-11. Windows
host for edits, Prettier, changed-file ESLint and git; every Vitest run on the
Mac mini. Hooks stayed on. No push, pull request or tag. No cap, threshold or
deadline changed.

## Why

REL0171C found that a release's own notes cost a reviewed render:
`CHANGELOG.md` was a capture input, the What's New scenes rendered the newest
real release, and 0.17.1's notes moved 108 frames (one full update of 9,792
PNGs, 73 minutes on a quiet linuxlt, 113 under load). A hotfix with one Fixed
entry and a version bump would have paid the same.

## What changed

- `test/harness/whats-new/CHANGELOG.fixture.md`: two fixed releases (0.90.0 of
  2026-01-15 with five Highlights, two of them with a Try It, and three
  sections; 0.89.2 of 2025-12-01 with one) holding every kind of part the
  builder can make: a lead paragraph under the release heading, bullet and
  numbered lists, lists three levels deep, a bullet with two paragraphs,
  inline code, emphasis, strong and struck-out text, links (web and
  relative), a hard line break, a quote, a code block, a heading inside a
  section, a table, raw markup kept as text, and a word and a path that
  cannot wrap.
- `test/harness/goldens/fixtures.mjs` renders `whats-new`, `whats-new-footer`
  and `whats-new-highlights` from that file: the real builder
  (`parseChangelog`), the real schema (`encodeWhatsNewContent`,
  `parseWhatsNewContent`), the real page (`renderWhatsNewPage`), both
  releases, and the version line from the fixture's newest release. Nothing is
  read from `CHANGELOG.md` or `dist/whatsNew.json`. The manifest's contributed
  commands and settings still decide which Try Its may be shown.
- `scripts/lib/whatsNewContent.mjs` exports `constructKinds`: the kinds of
  parts some release notes are made of (24 for the fixture).
- `scripts/lib/captureInputs.mjs` is the one list of capture inputs, without
  imports, handed out by `visualManifest.mjs`. `scripts/check-visual.mjs` had
  two inline copies (the reviewed update's clean-tree guard and the
  candidate's identity); both read the list. It is now `src`, `design`,
  `test/harness`, `scripts/build.mjs`, `scripts/lib`, `package.json`,
  `package-lock.json`: `CHANGELOG.md` left, and the build's helpers and the
  dependency versions, which can move pixels, joined.

## The guard

`test/unit/whatsNewFixture.test.mjs` (10 cases):

- the real notes of the two newest releases, parsed with the same builder,
  use no kind the fixture lacks (today 14 of the fixture's 24 kinds; the first
  run of the guard found one the first draft of the fixture lacked,
  `section:untitled`, the lead paragraph);
- the fixture is two fixed releases with exactly the 24 kinds;
- six rows add a construct to a copy of the real notes in memory (a quote, a
  code block, a numbered list, a list three levels deep, struck-out text, a
  deeper heading) and see it named against a fixture without it;
- the capture reads the fixture and nothing from `CHANGELOG.md`;
- the list of capture inputs is the seven paths, the same object for both
  readers, with no inline copy left.

## Results (Mac mini)

| Suite                                                           | Result                        |
| --------------------------------------------------------------- | ----------------------------- |
| `whatsNewFixture`                                               | 10 of 10                      |
| `visualCapture` (the real capture driver, through the fixture)  | 11 of 11                      |
| `visualGate`, `m114Audit`                                       | 12 of 12, 7 of 7              |
| `whatsNew`, `whatsNewBundle`, `whatsNewContent`, `whatsNewHtml` | 18, 5, 16 and 11, all passing |
| `changelogSource`, `readmeVersion`, `cx1r2Truth`, `cx1r4Truth`  | 14, 4, 23 and 26, all passing |

## Red drills

Mac mini, whole file, repository deadlines. Each exited 1 and the file was
restored byte for byte.

| Deliberate break                                           | Failed                                                                                      |
| ---------------------------------------------------------- | ------------------------------------------------------------------------------------------- |
| Every backtick removed from the fixture (no inline code)   | 8 of 10: the guard names `inline:code` ("expected [ 'inline:code' ] to deeply equal []")    |
| `fixtures.mjs` reads `CHANGELOG.md` instead of the fixture | 1 of 10: "is what the capture renders, with the real builder and schema, and nothing from…" |
| `CHANGELOG.md` back in the list of capture inputs          | 1 of 10: the list's pin                                                                     |

## What this commit does not hold

The reviewed baseline. Until the manifest is rendered again with the fixture
in place, `npm run check:visual` fails on the three What's New scenes (their
frames show the fixture, the manifest still records 0.17.1's notes), and the
manifest's revision, which predates the fixture, cannot be rendered by this
tree's capture code. One full reviewed update follows on the release branch,
and is the last one release notes cost.

That update, its review and the one check the fixture's last screen no
longer exercises (the footer links' hover, focus and pressed states) are
recorded in `docs/certification/rel0172.md`.
