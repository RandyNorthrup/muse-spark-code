# 0.18.2: the product's own mark, and every picture looked at

Release branch `release/0.18.2`, 2026-10-12, prepared on the owner's PC
(edits, Prettier, ESLint on changed files, git) with the Kubuntu rig and the
Mac mini for builds and tests. Hooks stayed on for every commit. No cap, pin,
threshold or deadline moved. Hosted CI on the pull request is the gate; its
results and the real conversations through the packed candidate are in the
release record in `PLAN.md` section 10.

The owner asked on 2026-10-12 at 1:17 PM PT why Meta's logo was still in the
screenshots, and at 1:21 PM how that could happen "if we are looking at over
9000 screenshots". This file answers both with what was measured.

## What the branch is

- Cut from `int/train-0182` at `5bc38fbe0`: the panel's own mark
  (`docs/certification/panelmark.md`, review RVPANELMARKC without a
  finding), the four README pictures taken again for it
  (`docs/certification/panelmark-baseline.md`) and the version.
- Merged with main at `e763f4938d` (0.18.1 as released, with its record).
  The train had merged the 0.18.1 hotfix only up to `39153196d`. Two
  conflicts, each resolved by reading both sides: `PLAN.md` section 10 (both
  sides had added a paragraph at the top of the release records; both are
  kept, the newer first) and `ROADMAP.md` (generated; written again by
  `scripts/gen-roadmap.mjs`).
- Against main the merged tree differed only by the mark's sources and
  tokens, its tests, the four pictures, the frame manifest, four source
  hashes of the component audit, the panelmark records, the identity-rewrite
  record of 2026-10-11 (documents only, kept on the lead's word) and the
  version.
- Added on this branch: two more pictures taken again, and the removal of
  the screenshot comparison from CI, each below. No test was added.
- The mark's way here: first prepared as 0.18.1 on `release/0.18.1`
  (`111afdfa1d`, cut from the release train `int/train-1011` at
  `07f7aa69f`) before the provider hotfix took that number.
  `int/train-0182` started from the mark's frame manifest `0b6259982`
  (sixteen scenes and 984 frames moved, every one of them the mark) and
  merged the hotfix.
- Left off the train before this branch was cut, as the train recorded: the
  governed pull-request checkout (`ef5bb8c52`), which adds three strings to
  `src/shared/l10n/en.ts`; the commit-credit guard (`280b3f964`), which had
  left four tests of the CI structure red and went back to its lane; the
  packaged dogfood harness (`490de5e01`), whose size gate and certification
  digest test fail on its own head.
- Not in 0.18.2, and where each goes: the spend ledger and the false error
  sentences (a provider's low-credit answer shown as "Models & Agents is not
  available in this build", with the reservation booked as uncertain) are
  for 0.18.3; the contributor-price fix is for 0.18.4. The 0.18.1 record's
  "next release" (the guard that a file meant for one bundle is an input of
  one built output only) and its "follow-up" (the five findings of the last
  review) are not in 0.18.2 either.

## Every picture, opened and looked at

Each file was opened at its original size and looked at for one thing: does
it show Meta's logo, or any other company's, as this product's mark. The SVG
files were also read as text and drawn in Chrome 150 on the rig.

| Pictures                                                                                                                                                                                                                                                   | Who receives them                                              | Result                                                                                                                                                                      |
| ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `resources/walkthrough/open.png`, `chat.png`                                                                                                                                                                                                               | Everyone who installs the extension (the Get Started pages)    | **Both showed Meta's logo** beside "Muse Spark". Taken again (next section)                                                                                                 |
| `resources/walkthrough/welcome.png`, `sign-in.png`                                                                                                                                                                                                         | The same                                                       | No logo: a finished turn; the sign-in screen                                                                                                                                |
| `media/readme/modes.png`, `palette.png`, `slash-commands.png`, `voice.png`                                                                                                                                                                                 | Readers of the README on GitHub, the Marketplace and Open VSX  | Our mark, the blue squiggled "m" (taken again on the train)                                                                                                                 |
| `media/readme/banner.png`                                                                                                                                                                                                                                  | The same, and npm                                              | Our mark                                                                                                                                                                    |
| `media/readme/agents.png`, `approval.png`, `deterministic-report.png`, `help.png`, `history.png`, `languages.png`, `open-question.png`, `paid.png`, `paid-always.png`, `question.png`, `quote.png`, `resources.png`, `rewind.png`, `turn.png`, `usage.png` | The same                                                       | No logo. In `help`, `history`, `languages` and `usage` a dialog covers the place where the empty screen draws its mark; the others show a conversation, which draws no mark |
| `media/icon.png` (the manifest's `icon`), `media/marketplace-icon.svg`                                                                                                                                                                                     | The Marketplace, Open VSX and the editor's extension list      | Our mark on a dark tile                                                                                                                                                     |
| `media/icon.svg` (the activity bar)                                                                                                                                                                                                                        | Everyone who installs the extension                            | Our mark in one colour                                                                                                                                                      |
| `media/banner.svg`, `media/social-preview.svg`, `media/social-preview.png`                                                                                                                                                                                 | The sources of the banner; the repository's preview on GitHub  | Our mark                                                                                                                                                                    |
| `design/companion/anim/*.png` (12), `design/companion/source/reference-sheet.jpg`                                                                                                                                                                          | Nobody yet: neither package ships them, no document shows them | A penguin character; no company's logo                                                                                                                                      |

That is 39 raster pictures and 4 SVG files: every picture file under
`media/`, `resources/` and `design/`. The manifest's `galleryBanner` is a
colour and a theme, no picture. The agent's npm package has no icon of its
own; its README shows `media/readme/banner.png`. No shipped document embeds
a picture as data.

Not looked at: the 754 pictures under `docs/certification/`. They are the
evidence of earlier milestones, neither package ships them and no README
shows them; many of them show the panel as it was, Meta's logo included.

Seen on the way and not part of this release: `resources/walkthrough/own-model.md`
shows `sign-in.png` under a description of "the first-run screen's third
choice", which that picture does not show; `welcome.png` and `sign-in.png`
are from an older build of the panel.

## The two walkthrough pictures, taken again

Both from the production build of this branch on the Kubuntu rig (Chrome
150.0.7871.186, 690 by 760, light theme), then re-encoded without loss
(`optipng -o7 -strip all`; the decoded pixels were compared and are
identical):

| File                             | Before   | After    | What it is now                                                                                                  |
| -------------------------------- | -------- | -------- | --------------------------------------------------------------------------------------------------------------- |
| `resources/walkthrough/open.png` | 44,833 B | 44,039 B | The harness scene `empty` (`node scripts/harness-shots.mjs empty --theme=light`)                                |
| `resources/walkthrough/chat.png` | 39,823 B | 42,356 B | The pixels of `media/readme/palette.png` as the train took it again (the same scene, the same size), re-encoded |

SHA-256: `open.png` `f49467d6994ccd6b37891316cc96ec048783c0d01642c5af23d39824d3ebec91`,
`chat.png` `dd4c0b6c5edff7f0953440f7d9491b0497e097d4fe21ad7a8c5e8759f6e4c980`.

## The one look at the changed screen

The owner's order of 1:30 PM PT: "no more ci screenshot runs. if we change
the ui is gets a small local verification and thats it." The change in this
release is the mark on the chat panel's empty screen. It was built
(`npm run build`, exit 0, on the rig) and the empty screen was opened from
the built webview behind the harness's fake host, once in the light theme
and once in the dark theme, and looked at:

- ![The empty screen in the light theme](release-0182/empty-light.png)
- ![The empty screen in the dark theme](release-0182/empty-dark.png)

In both, the blue squiggled "m" stands beside "Muse Spark" where Meta's logo
stood; nothing beside it moved and nothing is cut off. That is the whole
visual check of this release. No frame was rendered for comparison, no
baseline was compared or adopted on this branch.

## The built files

After `npm run build` on the rig, all 364 files under `dist/` were searched:

| Searched for                              | Files that carry it |
| ----------------------------------------- | ------------------- |
| `M27.651 112.136` (the logo's first path) | 0                   |
| `M21.802 33.206` (its second path)        | 0                   |
| `M73.312 27.802` (its third path)         | 0                   |
| `MetaLogo`, `meta-logo`, `--ms-meta-`     | 0                   |

The mark's own class is in `dist/webview/main.css` and in one webview chunk.
This search was done once, by hand, for this release; it is not a test. The
same search over the packed candidate is in the release record.

## What the screenshot comparison checked, and what it could not

The comparison rendered 9,864 frames of the panel and compared each with the
frame that had been accepted before it. It answered one question: did this
frame change. A frame that did not change passed, whatever it showed. Meta's
logo was put on the empty screen in milestone M3 (`docs/certification/m3.md`),
long before the comparison existed, so it was in the first frames the
comparison ever accepted, and every run that left it alone was green.
Nothing in the comparison asked whether a frame's content was allowed; no
number of frames changes that. What protects the product here is that the
code that drew the logo is deleted, and that a person looked: at the changed
screen once, and at every picture once.

Nobody looked at 9,864 frames. For the mark's baseline on the train
(`docs/certification/panelmark-baseline.md`, before the owner's order):
8,580 frames were byte-identical to 0.18.0's and 300 differed by at most one
pixel, and none of those 8,880 was opened; 984 frames changed, all of them
the mark, and of those 13 were opened and looked at at their original size
(the empty screen at 320 px in the six themes and at 690 px in two, and five
other scenes in the light theme, each beside its frame from before). On this
branch no frame was rendered; a person looked at the two pictures above and
at the 43 picture files in the table.

## The screenshot comparison leaves CI

By the owner's order of 1:30 PM PT. Removed on this branch:

- `.github/workflows/build.yml`: the job `visual-shards` (six shards) and
  the job `visual` that merged them; `visual` in the `needs` of the
  `required` aggregate, with its variable and its test line. The seven
  required checks of main's ruleset are unchanged: none of them was a
  screenshot job.
- `package.json`: `check:visual` in `quality:gates`. The script stays as a
  tool that nothing runs.
- `test/unit/visualGate.test.mjs` (the comparison's own arithmetic, its
  manifest, its shards and its place in the workflow) and
  `test/unit/visualSource.test.mjs` (its copy of a recorded revision): both
  existed only for that gate.
- `test/unit/manifest.test.ts`: the assertions that named the two jobs.

Kept, for the lane that removes the machinery: the scripts, the frame
manifest as the train committed it (nothing in a gate reads it now), and
`visualCapture`, `visualReadiness`, `visualStability` and `visualMatrix`,
which open real scenes of the panel in a browser through the driver the
accessibility run also uses and measure layout. One test in
`visualStability` and the mark's own browser test still compare two renders
of the same scene inside a unit test.

`AGENTS.md` (rule 5 and the command table), `CONTRIBUTING.md`, the README's
command table and `test/harness/goldens/README.md` say what is true now.

## Sizes

Measured on the rig's production build of this branch: `dist/modelApi.js`
519,354 B, the number its exact-size test already holds; `dist/headless.js`
100,078 B; `dist/webview/main.js` 116,537 B, as on main. No pin moved and no
cap moved.

The extension package had 9,268 B of room under its cap on 0.18.1
(3,779,532 of 3,788,800 B, hosted). The rig cannot pack the universal
package (it has no arm64 helper), so the files the package ships were
compared between the two builds, compressed as a package compresses them:
this branch is about 8.3 KB smaller. The two pictures add 2.3 KB, the notes
0.6 KB; What's New's content is 10.7 KB smaller, because its window of two
releases now holds 0.18.2 and 0.18.1 and no longer 0.18.0's long notes
(they stay one link away, in the changelog). The hosted package job
measures the real file.

## Gates

| Where                | What                                                                                                                                                                                                                                                        | Result              |
| -------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------- |
| Mac mini, 2:04 PM PT | `manifest`, `panelMark`, `panelMarkBrowser`, `activityIcon`, `readmeShots`, `readmeVersion`, `changelogVersion`, `whatsNewContent`, `whatsNewFixture`, `visualMatrix`, `m114Audit`, `deferredBundles`, `walkthrough`, `cx1r2Truth`, `cx1r5Truth` (15 files) | 383 of 383, 41.80 s |
| Kubuntu, 1:45 PM PT  | `npm run build` (tokens, bundle sizes, bundle split, the lazy-bundle registry, host globals, notices)                                                                                                                                                       | exit 0              |
| Host                 | Prettier on the whole tree; ESLint and a type check of the root project on the changed files; `check:plan`, `check:roadmap`                                                                                                                                 | exit 0              |

Everything else is the hosted run's to say: the whole unit suite on three
systems, the static gates, accessibility, integration and the packages.

## The plan's size

The first hosted run of pull request 153 (38308581634) was red in one job,
the Ubuntu static gates: `check:plan` exits 1 once `PLAN.md` passes 85% of
the plan reader's 4 MiB bound, and this branch's first 0.18.2 record took
the file to 3,565,740 bytes, 582 over. It had been read as a warning here
because its exit code was taken through a pipe; it is a failure. The record
in `PLAN.md` now says what a reader of the plan needs and the branch's
history is in this file. `PLAN.md` is at its archive threshold: closed
history has to move to `docs/plan-archive/` by the procedure in
`CONTRIBUTING.md` before much more is added.
