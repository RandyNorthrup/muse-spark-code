# M114 visual-regression contract

`manifest.json` is the only golden payload in Git. Full-resolution PNGs live
in its external archive; total archive bytes must not exceed **512 MiB**.
Each image records SHA-256, byte size, dimensions, surface, scene, state,
theme, actual component renders and control-state applicability. A scene can
cover several components; its `components` list must match A's complete
inventory. Paths use `{surface}/{scene}/{state}/{theme}/{width}.png`, with
scene as the component-group identifier in lane 0's golden layout.

The matrix is A's 67 scenes × six themes × 320/690 px × six states, at 760 px
height and scale 1. It includes every current audited React renderer, Tasks
and What's New. Five exceptional surfaces use test-only fixtures of their
actual components; What's New uses its actual renderer and packaged notes.
Before observations remain in `/home/randy/archive/m114-a-before-17d7`.
They are evidence, not visual-regression baselines.

Capture pins English, UTC, a fixed clock, disabled animations and reduced
motion; only the loopback repository server is reachable. It uses the captured
host colours and editor font stacks in all six themes, including the exact
One Dark Pro/Dracula fixtures. No remote font, theme code or model runs. Before scenario time advances,
the actual harness root must mount. After fonts/host messages settle, a 1 px
resize followed by restoration to the declared width lets the component's
native ResizeObserver and RAF refit the composer. No textarea rows or product
state are assigned by the renderer.

Default state preserves the scenario. Hover, focus-visible and pressed use
Chromium's CSS pseudo-state forcing on a recorded visible real control; this
keeps menus open without invoking actions. Extra scene variants and host-rendered
pages with no canonical audit row discover actual controls in the document. Disabled uses the existing native
control state. Selected records an already selected real option/toggle/input.
`applied: false` explicitly marks a scene with no applicable target/selection;
it is never a claim that an unavailable interaction was tested. These are
representative scene screenshots. P1/P2's owning suites separately test all
control classes, actual keyboard/mouse behavior, 2 px/3:1 focus, reduced motion,
forced colours, no pill blur, target sizes and approval parity. Axe remains a
separate gate; visual equality alone makes no accessibility claim.

`npm run check:visual` verifies archived bytes and compares the current render
using **pixelmatch 7.1.0**, ISC, pinned unmodified under `vendor/pixelmatch/`.
Policy (lead decision, 2026-10-06): colour threshold **0.1**,
`includeAA: false` uses pixelmatch's antialiasing detection. Each image allows
at most **0.01% of its pixels or 12 pixels**, whichever is smaller, rounded
down. The observed 2/5-pixel focus raster differences are rendering noise.
Border/outline, token colour, layout and missing-icon regressions still fail. Mismatches save
the candidate PNG under ignored `temp/m114-visual-failures/` and name its key.
Normal checks never modify the manifest.

A small rendered UI/code-font probe records the rasterization fingerprint.
When the local archive is absent, or the platform/browser/fingerprint differs, the gate
extracts the recorded Git revision into ignored `temp/`, builds its real
bundles and renders it in the candidate's browser/font environment. It then
compares the candidate against those generated baseline pixels. The committed
hashes certify the original archive; they are not expected to match another
OS's font rasterization. Missing Git objects, baseline images, altered archive
bytes, missing components or changed state applicability fail explicitly.
The reusable CI workflow runs the visual job in both tiers, checks the
size-bounded manifest, and supplies full Git history with an explicit fetch
of the recorded revision if needed. Its required aggregate rejects a failed,
cancelled or skipped visual job. PNGs regenerate on the Ubuntu runner with
its installed Chrome/fonts; only the comparison receipt is uploaded.
Both full capture sets stay size-bounded; temporary reconstructed sources and
PNGs are cleaned after comparison. No golden download or silent skip exists.

For a reviewed update, first commit every capture input. Run:

```sh
npm run check:visual -- --update --review=M114-S-reviewed-integrated-panel --archive=/path/to/new/external/archive
```

The named review is written into the candidate manifest; the command refuses
an existing archive or one inside the repository. Inspect the images and
coverage, then commit the manifest with the review evidence. This initial S
update is within the owner's requested lane; independent release review and
aggregate quality remain the lead's gates. To verify a copied exact archive,
pass `--archive=<directory>` without `--update`; an explicitly missing archive
fails instead of reconstructing a different location.
