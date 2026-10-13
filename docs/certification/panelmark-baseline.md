# The landing mark's baseline and README images

On `111afdfa1d` (the release branch with the panel's product mark,
`docs/certification/panelmark.md`), 2026-10-11 into 10-12. Windows host for
edits, Prettier and git; the render and the README images on the Linux
laptop, kept empty for them; Vitest on the Mac mini. Hooks stayed on for both
commits. No push, pull request or tag from this lane; no dependency, cap,
threshold or deadline changed.

## The render machine

The laptop was off the network when the branch was ready, so Kubuntu was
tried as a second render machine and ruled out before anything was rendered
for the release. A control of 864 frames that could not have moved (twelve
scenes that are byte-stable across the laptop's own renders, rendered from
0.18.0's release commit and compared with its committed hashes):

| Kubuntu's browser                                 | Identical | Different |
| ------------------------------------------------- | --------- | --------- |
| Its own Chrome 150.0.7871.186                     | 735       | 129       |
| Chrome for Testing 153.0.8010.52 (the baseline's) | 813       | 51        |

With the baseline's browser `prompt-library` still differed in 48 of 72
frames, the same 48 each time (the four themes that are not high contrast),
and a second run minutes later at load 18 to 21 changed 43 of `handoff`'s 72
frames against the first. A matching browser is not enough, and that machine
under load does not draw the same frame twice. The browser folder, the slot
and the frames were removed; only these numbers were kept.

## The reviewed baseline (the last commit)

Review `REL0181-baseline-2026-10-11` (named before the release was renumbered
0.18.2). linuxlt, Chrome 153.0.8010.52, the browser and rasterization
fingerprint of 0.18.0's baseline; one `npm run check:visual -- --update` of
the full matrix into a new archive,
`/var/tmp/l-REL0171C/visual-rel0181-111afdf`: 9,864 PNGs, 446,077,919 bytes,
3,437 s (11:08 PM to 12:05 AM PT). The render ran on the rig's snapshot of
the worktree at `111afdfa1d` (`eddaa1e48`); both commits have the same tree,
and the manifest names `111afdfa1d`. PNGs stay outside git. The manifest was
written by the update and then changed in two ways only: `revision` and
Prettier's layout.

No frame depends on the version number or on the release notes: scenes get a
fixed version from the harness and What's New renders its fixture
(`docs/certification/visfix.md`). The baseline stands for any release built
on top of `111afdfa1d` that changes no other capture input.

Against 0.18.0's archive (`/var/tmp/l-REL0171C/visual-rel0180-f04ce52`):

| Result                                        | Frames |
| --------------------------------------------- | ------ |
| Identical bytes                               | 8,580  |
| Within the unchanged allowance (1 px at most) | 300    |
| Over it                                       | 984    |

All 984 are the landing screen's mark: the Meta logo beside "Muse Spark"
became the product's own squiggled "m". No other frame is over the
allowance, and no row's target, state or component record changed.

### The lane's list against what moved

`docs/certification/panelmark.md` names fourteen scenes at 72 frames each,
1,008 frames. The render says sixteen scenes and 984 frames, with one cause
throughout:

| Scenes                                                                                                                                                           | Frames moved | Against the list                                                                                                                        |
| ---------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------ | --------------------------------------------------------------------------------------------------------------------------------------- |
| `empty`, `context-meter-full`, `context-meter-warning`, `goal-edit`, `mention`, `models`, `modes`, `palette`, `questions-chip`, `slash-commands`, `stop-running` | 72 each, 792 | As listed (171 to 209 px a frame: the mark's box)                                                                                       |
| `icons`                                                                                                                                                          | 72           | As listed: `MetaLogo` leaves the gallery, `ProductMark` joins it and the alphabetical grid reflows                                      |
| `handoff`, `prompt-library`                                                                                                                                      | 24 each, 48  | Listed at 72. The mark moves only at 320 px in the four themes that are not high contrast, where it shows through the dialog's backdrop |
| `git-pr-narrow`, `schedules-narrow`                                                                                                                              | 36 each, 72  | Not listed. Both show the landing screen above their card at 690 px, so the same mark moves there                                       |

### What was looked at

At original size: `empty` at 320 px in all six themes, theme beside theme,
and at 690 px in light and high-contrast dark; `empty`, `git-pr-narrow`,
`schedules-narrow`, `icons` and `prompt-library` before beside after in
light. The mark is blue in light, dark, One Dark Pro and Dracula and takes
the theme's text colour in both high-contrast themes, as the notes say; it
sits in the old logo's box beside the name, nothing beside it shifts and
nothing is clipped. No defect was found. The counts and every moved frame
are in `docs/certification/panelmark-baseline-review.json`.

## README images (the commit before the baseline)

`test/unit/readmeShots.test.mjs` was red: the fingerprint of the README
images' pixel inputs moved with the mark's tokens and styles. All 19 images
were taken again in the render's slot and compared with the committed ones
under the visual gate's pixel policy:

| Result                             | Images | Which                                                                      |
| ---------------------------------- | ------ | -------------------------------------------------------------------------- |
| Unchanged (identical or 0 px)      | 8      |                                                                            |
| Changed by the mark                | 4      | `modes`, `palette`, `slash-commands`, `voice` (172 to 177 px)              |
| Changed by the capture moment only | 7      | `agents`, `approval`, `question`, `turn`, `resources`, `rewind`, `history` |

- **Replaced: the four that show the landing screen.** In each, the only
  changed region is the mark's box, 27 by 18 px.
- **Left as committed: the seven that follow the clock.** Five differ in the
  phase of the heartbeat trace; `rewind` in one "PM" that became "AM" and
  `history` in its day labels, because the shots were taken after midnight.
  None is a change of the interface. Freezing the harness clock for README
  shots is on the follow-up list.
- The pinned fingerprint is
  `2571b9fb9e9b8ad59e655c81437a98a222be04f24a14e186ffcc76ca793f7678`.

## Gates

The branch's full gate ran on Kubuntu on the same tree (the lead's record:
build, lint, Prettier, knip, cycles, duplication and the document gates 0;
1,317 of 1,335 unit files green, the 8 red none of them code, `readmeShots`
among them until these images).

| Gate (Mac mini, this tree)                                                                                                                  | Result     |
| ------------------------------------------------------------------------------------------------------------------------------------------- | ---------- |
| `readmeShots` 17, `panelMark` 5, `panelMarkBrowser` 15, `checkTokens` 7, the visual gate, truth, changelog and What's New suites (15 files) | 264 of 264 |

Left to the pull request's hosted run: `check:visual` (hosted shards render
`111afdfa1d` and the head and compare them), the whole unit suite on three
systems, `test:a11y`, `test:legal-a11y` and `security:sast`.
