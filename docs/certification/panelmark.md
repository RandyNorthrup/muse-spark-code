# PANELMARKR2 — RVPANELMARK review repairs

Scope: all three findings in RVPANELMARK on `1b16c9a61`, on the Mac mini.
The rig/common brief delegates aggregate quality and the release baseline to
the lead. No baseline is updated here; no paid/live request or dependency.

The dedicated brand roles use the Marketplace icon's gradient endpoints:
`#0a5cff` on light backgrounds and `#3d8bff` on dark backgrounds. They never
read a host button colour. The blue hue contract is 210–240 degrees in HSL,
with blue strictly greater than red and green; high contrast uses the theme
foreground and forced colours use CanvasText. Both the brand row and icon
gallery get the policy. The token source registers both roles for 3:1 UI
contrast and generates every consumer without a generator change.

The view box is the path bounds (3, 7.43, 18, 9.14), padded by half the
2-unit round stroke: `2 6.43 20 11.14`. `preserveAspectRatio="none"` fills
the retained 1.8 by 1.2 em box, whose computed dimensions are 28.8 by 19.2 px
(the review's rounded 28 by 19 px). The stroke scales to approximately
2.88 by 3.45 px alongside the existing 600-weight product name.

## Affected release frames

Each scene has 6 themes × 2 widths × 6 interaction states = 72 frames,
checked against `test/harness/goldens/manifest.json` by the certification
regression. Thirteen scenes retain the empty-state mark; the icon gallery
reflows because the original swap changed its alphabetically sorted exports.
The fourteen scenes total **1,008 frames**; the thirteen previously omitted
scenes account for **936 frames**. The review's seven-pixel `panel/column`
noise stays within its unchanged twelve-pixel allowance and is not a mark
change.

| Scene                         | Frames | Intended change                             |
| ----------------------------- | -----: | ------------------------------------------- |
| `panel/empty`                 |     72 | Mark paint and ink extent                   |
| `panel/context-meter-full`    |     72 | Empty-state mark                            |
| `panel/context-meter-warning` |     72 | Empty-state mark                            |
| `panel/goal-edit`             |     72 | Empty-state mark                            |
| `panel/handoff`               |     72 | Empty-state mark                            |
| `panel/mention`               |     72 | Empty-state mark                            |
| `panel/models`                |     72 | Empty-state mark                            |
| `panel/modes`                 |     72 | Empty-state mark                            |
| `panel/palette`               |     72 | Empty-state mark                            |
| `panel/prompt-library`        |     72 | Empty-state mark                            |
| `panel/questions-chip`        |     72 | Empty-state mark                            |
| `panel/slash-commands`        |     72 | Empty-state mark                            |
| `panel/stop-running`          |     72 | Empty-state mark                            |
| `panel/icons`                 |     72 | Export-list reflow plus mark paint/geometry |

## Regressions and red drills

All three drills run the complete `panelMarkBrowser.test.mjs` file with
`--maxWorkers=3` and repository timeouts. Every mutation exits 1, its
intended assertion fires, and the original file is restored byte for byte.
The initial complete three-file run (`panelMark`, `panelMarkBrowser`,
`checkTokens`) passes 26/26 tests after restoration.

| Finding       | Fix                                                                                | Regression                                                                                                     | Deliberate failure                                                                                           |
| ------------- | ---------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------ |
| P2 theming    | Independent dark/light brand tokens; theme/CanvasText overrides for both mark uses | Six-theme/two-width blue hue and computed 3:1 contrast; forced-colour cases                                    | Point `.product-mark` back at `--ms-accent`: twelve matrix cases fail; One Dark Pro 1.647:1, Dracula 1.726:1 |
| P3 size       | Stroke-padded path crop; 2-unit stroke; fill the retained box                      | Computed path/stroke transform equals the 28.8 × 19.2 px box; positions and every outside pixel stay unchanged | Restore the square view box: all twelve matrix cases fail, 15.99 px ink width versus 28.80 px box            |
| P3 frame list | All fourteen scenes above, 72 frames each                                          | `certifies every affected scene with its exact manifest frame count`                                           | Delete `panel/icons`: the certification regression fails with the missing 72-frame row                       |

- colour: `src/webview/styles.css`, before/restored SHA-256
  `30d066ffb9ec89d3a92f72bcccc80c671a90b793a16304539faeab7de0d94186` (equal).
- size: `src/webview/components/icons.tsx`, before/restored SHA-256
  `fc515a5ebbd95a0066718deadb18c5ac5b8c618dcbac4a010cb2b30c5af01779` (equal).
- frames: `docs/certification/panelmark.md`, before/restored SHA-256
  `90ad0383914eec8d31faf8d196480c4db8b206ae96d2bf598ca0ba8158edabbb` (equal).

## Production renders and layout evidence

The repository's `captureMatrix` renders `panel/empty` with production
`dist/webview` assets in headless Chrome at 320 and 690 px, every capture
theme, reduced motion, en/UTC and loopback-only traffic. All twelve marks
were visually inspected together at native pixel scale; both widths retain
the bold name and unclipped brand row. The browser/server are closed after
capture. PNGs remain only in the ignored `temp/panelmark-renders/` directory;
no image is attached or tracked. `panelmark-render.json` records the browser,
source hashes, PNG hashes, dimensions, colours, contrast and axe results.

| Theme        | Mark      | Panel background | Computed contrast (both widths) |
| ------------ | --------- | ---------------- | ------------------------------: |
| light        | `#0a5cff` | `#f8f8f8`        |                      4.958596:1 |
| dark         | `#3d8bff` | `#181818`        |                      5.356868:1 |
| hc-dark      | `#ffffff` | `#000000`        |                     21.000000:1 |
| hc-light     | `#292929` | `#ffffff`        |                     14.548198:1 |
| one-dark-pro | `#3d8bff` | `#21252b`        |                      4.644167:1 |
| dracula      | `#3d8bff` | `#21222c`        |                      4.764056:1 |

Measurement: record the mark, product-name and hint rectangles; screenshot
the complete 320/690 × 760 page; recreate the reviewed parent's square
view box, stroke and colour on the mark alone; screenshot again; compare
every RGBA pixel without tolerance, excluding only the floor/ceil of the
original logo rectangle. All twelve full-page comparisons have **zero
changed outside pixels**, and all three rectangles remain exactly equal.
The generated role is checked against each capture fixture's actual panel
background, not a generic palette assumption. Axe's WCAG 2.0–2.2 A/AA tag
set reports **zero violations and zero incomplete findings** in all twelve
production pages.

## Scoped gates

All five type projects pass; changed-file ESLint, Stylelint and Prettier
pass. Plain knip, zero-clone jscpd, localization, host API, reference, token,
plan and roadmap gates pass. Production build, every unchanged bundle cap,
split check, host-global check and notices check pass: extension **550.7
KiB / 600 KiB**, Model API **518.2 KiB / 525 KiB**. There is no new command,
setting, localization key or feature-catalog contract. The roadmap gate
confirms its unchanged milestone/status sources remain current.

The rig/common brief owns the scope: aggregate quality and the full visual
comparison/reviewed release baseline are lead gates; this lane deliberately
leaves every baseline byte unchanged. Dependent-suite receipts follow below.
