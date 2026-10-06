# M114 S screenshots, visual regression and docs

Kubuntu, 2026-10-06. Lane S integrates P2 `871597b49` and F `c33755507`
with the brief's explicit `--no-ff` merges. Plan conflicts were resolved
additively. Hooks exist at `.husky/_/pre-commit`; all commits use them.
No credentials, live/paid calls, shared installation changes or other lane's
production UI edits. The common lane brief prohibits aggregate quality;
scoped checks run here and the lead owns that final integration gate.

## First completed piece: inherited host-API handoff

The old scanner saw only the webview directory after CSS moved into imports.
`collectThemeVariables` now follows local CSS imports recursively, normalizes
Windows separators, terminates cycles and refuses an import outside the tree.
The generated record includes the actual importing files and F's new Node
uses: **332 VS Code APIs, 31 import files, 25 Node built-ins, 62 theme variables**.
Both `node scripts/check-host-api.mjs --write` and its read-only check exit 0.

`themeInventory.test.mjs`: **2/2 passed**, repository default timeout,
three workers. Disabling `pending.push(relative)` failed both named tests:
“follows nested CSS imports, terminates cycles and normalizes Windows paths”
and “records the real generated host roles imported by both polished surfaces”.
The source was restored byte-exact, SHA-256
`a7aa377f9c6e0a106e8f9a3bce8bc2288a8d379bd34b4f5a2a4079114c62274d`.
Log: ignored `temp/m114-s-theme-import-red.txt`.

The first synthetic-file run also encountered a transient `/tmp` write quota
error. Test scratch now uses this lane's ignored `temp/`; no rig-wide cleanup
or setting was performed. A mistaken test expectation put widget-shadow in
the extended roles; it correctly belongs to `tokens.css`. The regression
still specifically checks the imported placeholder role.

## Visual implementation and documentation piece

The gate uses the complete A scene/component inventory, six captured themes,
320/690 px and six scene states. Strict pixelmatch 7.1.0 compares decoded PNGs
with threshold 0, antialiasing included and zero changed pixels. The pinned
ISC source/notice is unmodified in `vendor/pixelmatch/`; npm reported no peer
requirements. No npm dependency, lockfile or shared `node_modules` changed.
The package acquisition is the only install/network operation in this lane.

PNG sets stay outside git under a **512 MiB** hard budget. The tracked manifest
contains source revision, named review, hashes, dimensions and coverage.
Missing archives/platform/browser/font-rasterization differences reconstruct
that source revision in ignored scratch, with no skip or baseline download.
Default checks never write the manifest. The font probe and actual browser
context pin locale, timezone, scale, colour scheme and reduced motion.
Representative CSS pseudo-states keep menus open without invoking actions;
selected/disabled applicability is explicit. Real-interaction checks stay
with P1/P2; the visual contract does not imply axe or native-host certification.

README/CONTRIBUTING/AGENTS now document the token source, scales, motion,
fonts, visual gate, external storage/review rule and equal editor bindings.
The editor rows keep C/M104, N/M110 and D/M111 explicitly awaiting their
milestones. F's asset-publication/help-reference binding remains with the lead;
featureCatalog/reference generator are absent on this base. The fonts command
ran successfully with a local seed and lane-local XDG data; no owner settings
or credential store were touched.

`readme:shots` refreshed the existing curated **15** images, totaling
**1,225,115 / 2,097,152 bytes**, banner included. The new 2 MiB guard is tested.
Chrome's CLI virtual-time capture hung before its first image; the owned
README script now uses the existing bounded Playwright capture path, a fixed
clock, font/deferred-load settling and the declared exact viewport. Six smoke
scenes (approval, composer, What's New, deferred modal, Tasks, slash commands)
produced **36** valid PNGs; representative approval/turn images were inspected.

`visualGate`, `themeInventory` and `readmeShots`: **21/21 passed**, default
Vitest timeout, at most three files/workers. Token generation/staleness gate,
localization (14 tables, 599 source files, zero problems), scoped ESLint and
the production build passed. Builds retain all caps: extension 438.4/600 KiB,
Model API 446.9/475 KiB, webview eager JavaScript 793.2/900 KiB, ACP 819.3/850
KiB, fonts installer 11.4/25 KiB. All notices pass, including F's four fonts.

The shared `/tmp` rejected profile and Vite-cache writes (quota errors,
ENOENT and Chrome cache failures). Final tool runs set TMPDIR to this lane's
ignored scratch; new visual profiles also live there. No rig-wide cleanup,
settings, timeouts or hooks were changed. Environmental failed attempts are
not claimed as guard drills.

## Deliberate guard failures

Each mutation below exited 1 in its complete owning test file with default
timeouts. It was restored in `finally`, and SHA-256 verified byte-exact.
The first import-traversal drill is recorded above. Logs and the structured
receipt remain in ignored `temp/m114-s-red-*` / `temp/m114-s-drills.json`.

| Drill | Named test(s) that failed | Restored SHA-256 |
| ----- | ------------------------- | ---------------- |

| pixel-silent-pass | fails a planted single visible pixel and an antialiased pixel with no tolerance | `eebf058a21953dbd00cbd477c2ac07c1119f0ba10ef8b1bc0f4429c6d6402dca` |
| pixel-tolerance | fails a planted single visible pixel and an antialiased pixel with no tolerance; requires complete unique scene/state/theme/width and actual component coverage, accepting Windows separators | `eebf058a21953dbd00cbd477c2ac07c1119f0ba10ef8b1bc0f4429c6d6402dca` |
| png-dimensions | decodes Chromium PNG filters and refuses dimensions, unsupported encoding, truncation and corrupt data | `eebf058a21953dbd00cbd477c2ac07c1119f0ba10ef8b1bc0f4429c6d6402dca` |
| png-predictor | decodes Chromium PNG filters and refuses dimensions, unsupported encoding, truncation and corrupt data | `eebf058a21953dbd00cbd477c2ac07c1119f0ba10ef8b1bc0f4429c6d6402dca` |
| archive-hash | verifies exact baseline bytes before decoding, failing valid-looking hash and size tampering | `eebf058a21953dbd00cbd477c2ac07c1119f0ba10ef8b1bc0f4429c6d6402dca` |
| archive-size | verifies exact baseline bytes before decoding, failing valid-looking hash and size tampering | `eebf058a21953dbd00cbd477c2ac07c1119f0ba10ef8b1bc0f4429c6d6402dca` |
| named-review | requires named reviewed updates and rejects unknown or check-time update flags | `6d5cf1e146d6f439841ed37e48bcde03b4fcb3d36925f5ed9d4e4ffa10afc27d` |
| missing-capture | requires complete unique scene/state/theme/width and actual component coverage, accepting Windows separators | `f2f6d8a533e7b24f97466498264b0a1476646da7a1badad61b631882aa50e5c6` |
| duplicate-capture | requires complete unique scene/state/theme/width and actual component coverage, accepting Windows separators | `f2f6d8a533e7b24f97466498264b0a1476646da7a1badad61b631882aa50e5c6` |
| component-render | requires complete unique scene/state/theme/width and actual component coverage, accepting Windows separators | `f2f6d8a533e7b24f97466498264b0a1476646da7a1badad61b631882aa50e5c6` |
| state-applied | requires complete unique scene/state/theme/width and actual component coverage, accepting Windows separators | `f2f6d8a533e7b24f97466498264b0a1476646da7a1badad61b631882aa50e5c6` |
| capture-path | rejects traversal, wrong dimensions, malformed metadata, relaxed pixel policy and oversized archives | `f2f6d8a533e7b24f97466498264b0a1476646da7a1badad61b631882aa50e5c6` |
| archive-budget | rejects traversal, wrong dimensions, malformed metadata, relaxed pixel policy and oversized archives | `f2f6d8a533e7b24f97466498264b0a1476646da7a1badad61b631882aa50e5c6` |
| readme-budget | keeps the actual curated set below 2 MiB and fails an oversized set | `2d264beb4083cbdbe0866ef85953db5fb2e4a3d1934245d71ede26628c750fee` |
| css-path-escape | refuses stylesheet traversal outside the repository | `a7aa377f9c6e0a106e8f9a3bce8bc2288a8d379bd34b4f5a2a4079114c62274d` |

Full integrated baseline, comparison, reconstruction and accessibility receipts follow in the final capture piece.

## Full-matrix repairs and explicit capture handoff

The first update stopped after 40 images: disabling Session board's focused
search input triggered its real blur-to-close handler. The driver now selects
an unfocused native control for disabled shots, records the target separately
for each state, and selects only a visible selected control. The fake clock
is paused between explicit advances, so pending timers do not change pixels
while screenshots are taken. This changes test capture only, not product UI.

`visualCapture.test.mjs` shares the actual fixture/browser capture in beforeAll;
**2/2 passed in 2.79 seconds**, default timeouts. It verifies the real narrow
palette stays open, its disabled button/selected option, exact PNG dimensions,
actual reduced-motion emulation and font fingerprint. Removing the focused
control exclusion reproduced the CSS node-disappearance failure in this named
suite (exit 1); the source restored byte-exact to SHA-256
`d65a36ee93f3dee553e32b2b53297d964ba4b717e6c100bd6569d8eceafa7bc1`. No skipped test exists in the finished suite.
The initial 40-image incomplete archive is retained outside git and is not
referenced by a golden manifest.

P1's final certification explicitly hands S both source inventories. The
strict visual-matrix source scan now uses the same imported-CSS traversal,
with Windows separators normalized. Its **7/9 tests pass**, and its two
unchanged exact-fixture assertions now fail for **only**
`--vscode-contrastActiveBorder`: P1 introduced the read, but neither third-party
capture includes it. This is a real capture gap, not stale import scanning.
No fixture, provenance, contrast threshold or equality assertion was changed.
Lane 0 owns the fixtures; S stops that path and records the named live-capture
handoff in PLAN §7. That gate remains failing until its owner supplies the
captured value/unset/provenance; no source value or wire shape is guessed.

All five TypeScript projects passed (`npm run typecheck`, exit 0).

## Capture isolation and stylesheet certification

A concurrent supplementary axe run rewrote the shared What's New fixture's
CSP origin during the second capture attempt. The candidate manifest was
removed: its 4,824-image archive is retained outside git but is **not a
baseline**. Fixtures now have a directory per server port, including in
source reconstructions, and each run cleans only its own fixture directory.
The renderer refuses a scene whose Segoe UI stylesheet failed to load. The
supplementary axe driver resumes browser timers only after its frozen PNG;
its earlier paused-clock attempt is not a completed accessibility receipt.
Exceptional component fixture documents now have an actual title. Dynamic
fixture imports use a file URL so the same driver works on Windows.

The complete owning browser suite now passes **3/3**, with 18 real captures
shared in beforeAll, at the repository default timeout. Removing the
stylesheet link failed with `Stylesheet failed to load:
deferred-modal/light/320`; source restored to SHA-256
`73e7ab738eed3ab82e40769a7c9ac793f6401896c7a5dc1003e1b2bd60a22e79`.
Replacing the per-port directory with a shared directory failed the named
`isolates fixture CSP origins for concurrent capture runs` test; source
restored to `e7690a4a7d9323ffbac1ac5f9bad4786c1743795d94eefe6d023d3fd587ec163`.
Final scoped ESLint and all three owning files passed **13/13** with default
timeouts. `check:visual:a11y` exposes the supplementary six-theme observation
without replacing or changing the canonical accessibility gate.

The inherited integrated controls passed **158/158** (complete P1/P2 panel
and conversation suites, default timeouts). Plain knip, jscpd (zero clones)
and regenerated host API pass. The integrated startup receipt in
`temp/m114-s-startup.json` counts both production CSS and JavaScript:
869,689 bytes before, 882,430 after, **12,741 bytes growth**. This exceeds
the milestone's 4 KiB target while all hard artifact caps stay green; the
owning lanes/lead retain the explicitly recorded compaction handoff.

## Complete before bytes and bounded PNG work

S read all **804** A-before archive PNGs: every SHA-256, byte size and decoded
320/690 × 760 dimension matched the tracked before manifest, totaling
**40,041,082 bytes**. These remain before observations, not the post-polish
regression baseline.

The native PNG decoder now computes its predictor without allocating two
arrays per decoded byte. Its independent known scanline test retains every
PNG filter, dimensional and encoding assertion. Replacing the Average
predictor with zero failed the complete named `decodes Chromium PNG filters
and refuses dimensions, unsupported encoding, truncation and corrupt data`
test (exit 1); restored SHA-256
`b43b569784250826d793fdbab81bfb9acbeb3dca77e7bdf21990c84d6a6c049c`.
All three pure owning suites passed **21/21** with default timeouts afterward.
This changes decoding cost, not captured pixels or the strict comparison
policy. No gate is relaxed.

## Reconstruction failure cleanup and canonical accessibility

A missing Git source revision exposed an incomplete-reconstruction directory
left behind by `snapshot`. The complete new test failed on that leftover;
the error path now removes its own directory before rethrowing the explicit
Git failure. Removing that cleanup deliberately reproduced the named
`fails a missing recorded revision and removes its incomplete source
reconstruction` failure (exit 1). The script restored byte-exact to SHA-256
`4b58ea24fafb326d91f3f2c5824ed9dff69c6c95818970a7c6901e2c401ac738`.
The owning source/gate suites passed **8/8**, then the restored source suite
passed **1/1**, at default timeouts. Scoped lint passed.

The canonical `npm run test:a11y` passed **620 pages** (155 scenarios × four
VS Code themes): zero violated/undecided rules, zero exempt, zero missing
results. Its printed limits remain **1,446** obscured/off-view and **20**
glyph-only contrast observations that axe cannot measure. P1/P2's owning
checks cover non-text focus/control contrast. The six-theme supplementary
observations are separately recorded when their complete run finishes.
A real narrow default-state probe also found **zero** audited components
whose entire selector set was outside the viewport; all 65 renderer rows
have visible scene evidence, not only a mounted off-screen node.

The lead's CI binding is now explicit in PLAN §7: the workflow's manual
static command includes neither token nor visual gates and its checkout is
shallow. The workflow owner must add them and supply the tracked Git object;
S does not edit that foreign file or quietly fetch baselines over the network.

## Extra scene control applicability and complete six-theme observations

Review of the first styled full candidate found 16 extra variants with no
canonical A component row. They had real controls but `targetFor` searched
only row scopes, incorrectly marking every state unavailable. That candidate
manifest was removed and its archive retained outside git as an unaccepted
attempt. Extra scenes now discover controls in the actual document when no
row scope exists; canonical rows still use their component scope. The
new actual What's New highlights regression failed before the fix and after
intentionally removing the fallback, on `applied: false, target: null`.
The source restored byte-exact to SHA-256
`531abc48c98466386b0d48cdb53aa2b4065f9c9f0c9c843ee7a3de550a68e2a3`.
The complete browser suite passes **4/4**, sharing 24 actual captures in
beforeAll, default timeouts. No product CSS or handler was changed.

The complete six-theme supplementary axe run passes with **804/804 page
results** and **zero pages with violations**. It retains **1,152** incomplete
nodes: 1,026 `elmPartiallyObscured`, 42 `bgOverlap`, 60
`elmPartiallyObscuring` and 24 `nonBmp`. There are zero unclassified reasons;
these are exactly the obscured/glyph limits named by the canonical gate,
not assertions that axe measured their contrast. The durable after receipt
retains every node. This default-view observation uses the identical product
UI; the capture-driver fallback changes extra scenes' state discovery only.

## Corrected candidate and actual CLI failures

The candidate source is `c311144b9`, with a named integrated six-theme review.
It is not a certified regression baseline: the repeat failure below remains open.
Its **4,824** PNGs total **246,338,755 / 536,870,912 bytes** in
`/home/randy/archive/m114-s-c311144`, outside Git. The after index links all
67 scenes in six themes at both actual widths, and the manifest records all
65 renderer rows and six control states. Representative narrow composer,
approval, Tasks, Session board, mode menu and What's New views across all
six themes were inspected; What's New's actual Try it focus ring was also
inspected after the extra-scene repair.

Nine complete CLI red drills exit 1: missing named review, missing archive
argument, inside-repository archive, existing update archive, dirty capture
inputs, explicitly missing archive, missing capture, missing Git source and
an actual planted browser pixel. The latter fails with exactly
`panel/agents-details/default/light/320: Visual regression: 1 changed pixel(s)`.
The [durable CLI receipt](m114-s-after/cli-drills.json) records every expected
failure and the byte-exact restored helper/manifest SHA-256 values. Normal
check and reconstruction receipts follow. No full-resolution PNG is added
to Git; the only committed PNG changes are the 15 curated README images.

Archive audit now checks every original byte's SHA-256 and size without
redundantly decoding pixels that a reconstruction will not use. Each actual
compared baseline/candidate is still decoded and dimension-checked, under
the unchanged zero/AA-inclusive pixel policy. Direct bare-byte and decoded
integrity assertions both pass. Disabling the shared size/hash predicate
failed the complete named baseline-integrity test; source restored to
`6755dc2bfb7d0475cbdffbf03751a53ece315f586bac66fc3efe273344da78d8`. The owning gate/source suites pass **8/8**, default
timeouts. This removes repeated work, not an integrity check.

## Strict repeat failure — repair path stopped per brief

The real full comparison fails at
`panel/approval-moved/focus-visible/light/320`: **2 changed pixels**, at
(210, 13) and (212, 13), on the header's focus-outline raster. Sources,
viewport and font fingerprint are identical. An independent real repeated
scene-prefix test also fails on `agents-details/pressed` with **5 pixels**.

Two different repairs were tried: advancing the frozen clock before/after
state shots to settle frames, then Chrome `--disable-gpu` software raster.
The first still fails the repeat. The second passed alone but fails again
in the final three-file concurrent run, still 5 pixels. The brief's exact
rule is: “If the same test fails twice after two different fixes, STOP that
path: write down in your report what you tried and why it failed, and move
on or end the lane.” S stops this path. Both ineffective changes and their
unaccepted renderer metadata are removed byte-exact; no product style, AA
filter, threshold, equality assertion or gate is weakened. The repeat test
collects both actual captures before its assertion, so a mismatch is a failed
test rather than a beforeAll-induced skipped test.

The candidate's complete hashes/dimensions, named visual review and external
archive remain reviewable evidence. **Visual acceptance is not certified**;
`check:visual` remains genuinely failing and no normal/reconstructed green
receipt is claimed. The lead must resolve browser raster stability before
release. PLAN §7 names this deferral alongside the fixture and CI bindings.

The restructured final owning gate/source/repeat run passed **9/9** at
repository defaults with no skips, showing the raster problem is intermittent;
this does **not** supersede the failed full-matrix check. Deliberately changing
one captured RGBA channel failed the actual repeat test assertion (not setup),
then the test restored byte-exact to `456746f8e80f10655194896240a8620762e53612680b4b92cb606f5254bff440`. No claim of
repeat certification is based on an intermittently passing unit run.

## Final source replay and scoped gates

The real absent-default-archive drill rebuilt Git source
`c311144b99ac4d113a1bed7bbdedc4aa05c47665` and rendered **all 4,824 baseline
images** in Chrome 150.0.7871.186/Linux. Comparison then failed on
`panel/agents-details/pressed/light/320`, **5 pixels**, independently confirming
the repeat blocker. The manifest restored SHA-256
`548a7d33462495c131cc524b927ade317983c2c8238191d03274117b9a6fe7c0`.
Both temporary source and baseline directories were empty before and after:
cleanup passes even though comparison fails. The original comparison uses
the same unchanged manifest. [Comparison/cleanup receipts](m114-s-after/comparison.json)
retain the failure; source reconstruction is implemented but its full visual
acceptance is **not green**.

Final scoped ESLint, Prettier (the two raw receipt formats were corrected),
all five compiler projects, localization (14 tables/165 manifest strings/599
source files, zero problems), host API, plain knip and jscpd (zero clones)
pass on Kubuntu. The final production build passes token contrast/staleness,
all unchanged caps/split/host-global checks and **87 notices, four optional
fonts**. Sizes remain extension **438.4/600 KiB**, Model API **446.9/475 KiB**,
eager browser JavaScript **793.2/900 KiB**, ACP **819.3/850 KiB**, lazy fonts
installer **11.4/25 KiB**, browser deferred JS **49.7/50 KiB**.

The lane does not claim full quality: the brief prohibits that aggregate run.
Release still needs the strict visual repeat/reconstruction green, lane 0's
missing `contrastActiveBorder` capture, the workflow's token/visual/history
binding, the measured 12,741-byte startup-growth compaction, and C/N/D's
named future milestone bindings. S makes zero live/paid model calls, changes
no dependency lockfile/node_modules, pushes nothing and merges only the two
ordered branches named by the brief.

## Final pin/binding fire record and archive verification

Two final deliberate failures close the pin/binding assertions: adding one
newline to the vendored comparator and removing `check:visual` from the
quality command each failed `keeps the pinned ISC comparator unmodified and
wires the gate into quality`. Byte-exact restoration SHA-256 values are
`972e5a5387dde3b6d85ab77337d59ebafca988bf220145caa4b27dc742134dc5` (vendor) and
`21a09401c8e9d3b4369ab2ddebcb91aad8982267f6b46b720955573b1b43be7b` (package manifest). The restored owning gate/source
files pass **8/8**, default timeouts. No vendor or package bytes remain changed.

After commit hooks, S reread all **4,824 actual archive files**: every hash,
byte size and PNG header dimension matches; total **246,338,755 bytes**.
The tracked manifest still has SHA-256
`548a7d33462495c131cc524b927ade317983c2c8238191d03274117b9a6fe7c0`.
No capture PNG exists under the repository's golden/evidence directories.
The final theme/import, README/media and real-capture suites pass **18/18**
(default timeouts); the gate/source/repeat batch passes **9/9** intermittently.
The failed complete normal/reconstructed visual receipts remain controlling.

## Continuation: lead rendering-noise decision (2026-10-06)

The continuation brief supersedes the strict-repeat stop above: the lead
classifies the 2/5-pixel differences as antialiasing/subpixel rendering noise.
The named constants in `visualImages.mjs` now specify colour threshold **0.1**,
`includeAA: false`, and a per-image allowance of
`floor(min(width * height * 0.0001, 12))`: **at most 0.01% or 12 pixels**.
The manifest records this dated review decision; all 4,824 original capture
hashes, dimensions, source revision and bytes are retained. No baseline PNG
set is committed, downloaded or substituted. Comparisons report counted
changed pixels and the maximum for one image rather than claiming exact equality.

The updated tolerance test failed under the original policy before the fix.
The restored gate/source/repeat batch passes **9/9** with the repository's
default timeout. Actual complete CLI red drills all exit 1 in the first
`panel/agents-details/default/light/320` capture, with allowance 12:

| Deliberate product change                     | Changed pixels | Result |
| --------------------------------------------- | -------------: | ------ |
| Header border grows from 1 px to 2 px         |          2,252 | FAIL   |
| One generated border-colour token becomes red |          1,659 | FAIL   |
| Header shifts horizontally by 1 px            |            434 | FAIL   |
| New-conversation icon hidden, button retained |             54 | FAIL   |

[The UI drill receipt](m114-s-after/tolerance-drills.json) records each
source and its byte-exact restored SHA-256. Ten additional owning-suite
red drills cover the area/cap policy, CI visual command, required aggregate,
history, token binding and the missing theme observation; every named test
fails and every file is SHA-256-restored. Their durable receipt is
[continuation-guard-drills.json](m114-s-after/continuation-guard-drills.json).

The missing theme observation is now captured, completing that handoff.
S verifies both supplied VSIX archives and selected theme members against
the existing full SHA-256 pins. Only each actual JSON theme is loaded through
a temporary data-only development contribution in installed VS Code 1.130.0,
under Xvfb, with an isolated profile and empty extensions directory. The
existing CDP schemas and settle logic check the active theme's real class
and read its computed variables. Both archives omit `contrastActiveBorder`;
both active workbenches leave `--vscode-contrastActiveBorder` **unset**.
Each fixture adds it to `absentInArchive` and `unset`; every previous colour
and its resolved-colour digest is unchanged. [The capture receipt](m114-s-after/missing-theme.json)
names the workspace, classes, source/member pins, raw-capture hashes and
**zero model attempts**. Temporary theme JSON/profile directories are deleted;
raw observations and the reused capture driver remain in ignored lane scratch.
No extension code from either archive executes and no network call occurs.

The existing reusable `build.yml` now runs `check:tokens` in static gates
and a dedicated **visual** job on Ubuntu in **both tiers**. It checks the
manifest's full coverage and 512 MiB budget, supplies complete history and
fetches the recorded SHA only when absent, then runs the real visual CLI.
Baseline PNGs regenerate from that source in the runner's Chrome/fonts and
are cleaned afterwards. Only the small comparison receipt is uploaded.
The unchanged seven required names reject failed/cancelled/skipped visual
jobs. The job has a 45-minute deadline; hosted duration/execution is not
claimed by this local lane. Actionlint passes; no workflow is dispatched
and nothing is pushed. Startup-growth compaction remains the integration
handoff at **12,741 bytes**; its 4 KiB target and all bundle caps stay unchanged.

Complete consecutive comparisons and final scoped checks are recorded below.

## Full-run discovery: settle native composer fitting before capture

The first continuation full check exits 1 at
`panel/approval-several/default/light/320`: **33,778 changed pixels**, allowance 12. The original candidate was explicitly never repeat-certified. A byte-exact
`git diff c311144b9 HEAD -- src design test/harness/index.html` is empty;
this is an inconsistent capture of the same product, not an accepted pixel
exemption. The failing archive/PNG and its initial receipt remain evidence.
Actual geometry probes show the empty composer sometimes has one row and
sometimes two; the difference moves the dock by **19.5 px**. The earlier
visual inspection's shorter/taller description was reversed: the two-row
capture has the taller composer. Advancing a frozen clock before the initial
React mount/host messages settle races the composer's initial placeholder fit.

The renderer now waits for the real harness root to mount and settles a
1 px width change followed by restoration to the declared width. A native
ResizeObserver observes each real layout change; the frozen clock flushes
the component's existing RAF handler. No textarea rows, product state or
product source are assigned. These are the component's normal responsive
behaviour and the original captured viewport, with the same final six states.
The first root-only attempt still failed a repeat by 2,154 pixels. An initial
extra-screenshot settling implementation made the expanded setup exceed the
unchanged 10 s hook deadline. Native layout observation removes that redundant
PNG work. The reusable baseline is captured in beforeAll and each fresh
candidate in beforeEach, so each actual browser capture fits its default hook
deadline. The original full scene-prefix coverage is retained, and the new
approval geometry shares the real-capture suite's setup. No CLI/per-test/global
timeout or gate threshold is raised, and no test is skipped in the final run.

The gate/capture/repeat files pass **15/15** at default timeouts (8.24 s for
the final three-file run). The actual capture tests now verify all six busy-composer
row counts and the final computed root width. Two deliberate failures remove
width restoration and the native RAF flush; the named actual-geometry/width
tests fail and the renderer restores SHA-256-exact. Their receipt is
[layout-drills.json](m114-s-after/layout-drills.json).

The replacement baseline review is named
`M114-S-mounted-native-layout-and-lead-tolerance-2026-10-06`. Its source is the
committed capture repair, with byte-identical product code. All original
candidate receipts remain historical; the new manifest/index and complete
repeat/reconstruction evidence follow below. Startup compaction is still
integration-owned.

## Capped viewport correction

The first replacement completed all 4,824 captures at 246,738,652 bytes,
but its real comparison rejected `approval-narrow/default/light/320` with
33,778 changed pixels. It remains an **unaccepted candidate**, preserved at
`/home/randy/archive/m114-s-settled-88d57fbe1`. The scenario's `max-width: 320px`
clamped the temporary widening, so the component's observer saw no size change.
Temporarily narrowing by one pixel and then restoring the declared width
triggers the native handler even under that cap. The real-capture regression
now covers both approval variants in all six states and checks twelve actual
one-row measurements; restoring the widening deliberately fails its named
row-fitting test. [The byte-exact drill receipt](m114-s-after/capped-layout-drill.json)
records that failure. The owning three-file run passes 15/15 in 7.95 s at
default timeouts. No product source or tolerance changes.

The final local requirement is two consecutive **complete archive comparisons**.
A scoped real Git-source replay also exercises the reconstruction pipeline;
full source reconstruction runs in the new CI job, whose hosted execution
belongs to the lead. The scoped replay limits local reconstruction time
without describing it as a full source comparison. The final receipts
distinguish both paths explicitly.

## Final replacement baseline and source replay

The completed replacement names source
`c4f37c6f748f2ea009271cb5cf8dbd462a6a88b0`, review
`M114-S-mounted-native-layout-and-lead-tolerance-2026-10-06`, and archive
`/home/randy/archive/m114-s-settled-c4f37c6f7-complete`. All **4,824 PNGs**
cover the original 67 scenes and 65 renderers at both widths, in all six
themes and six states. Their **246,807,746 bytes (235.37 MiB)** fit the
unchanged 512 MiB cap. Only their manifest and receipts are tracked. The
manifest is formatted before replay; its SHA-256 is
`1f33b677df78738c328925802451c5b386d779129b153cee07b1fc3801c5fba6`.
The two corrected light/narrow approval views were inspected after capture;
both show the actual one-row empty composer at the restored width.
[The baseline receipt](m114-s-after/continuation-baseline.json) names the
browser, font fingerprint, fixed environment and exact policy.

An earlier generation was terminated with exit 143 after 1,650 images;
it produced no visual failure and no completed manifest. Its partial archive
is retained as **unaccepted**, outside Git, and is not used by the final
manifest. [The interruption receipt](m114-s-after/interrupted-generation.json)
distinguishes it from the complete replacement. The sequential verification
worker then completed generation without altering repository test timeouts.

All four actual UI drills were repeated against this final archive and
failed at the first image with the same **2,252 / 1,659 / 434 / 54** pixel
counts and allowance 12. All product files were SHA-256-restored. Together
with the ten policy/CI/theme, two native-layout and one capped-layout owning
drills, the continuation has **17 deliberate failures**, each restored.

[The scoped source receipt](m114-s-after/continuation-source-smoke.json)
records a real `git archive`/production-build replay of the recorded source:
`agents-details`, `approval-narrow` and `whats-new-highlights`, all six
themes and six states at 320 px. **108/108** captures pass with **zero**
changed pixels. Actual control targets, applied states and renderer coverage
match the reviewed archive; browser and font fingerprints match too. The
manifest remains byte-identical and the source, profile and fixture directories
are cleaned. No PNG is retained from this smoke check. This is explicitly
scoped; the new hosted visual job performs the complete source reconstruction.

## Final scoped checks and remaining certification failure

Final Kubuntu runs use the repository's own test/hook deadlines with no
`--testTimeout`: gate/matrix/source **19/19** (1.37 s), capture/repeat **6/6**
(14.37 s). All **25 tests** pass. The five compiler projects, changed-file
ESLint/Prettier, plain knip, duplication (zero clones), token/localization/host-API
gates, production build and Actionlint pass. Localization reports all 14
tables and zero problems. Production sizes are extension **438.4/600 KiB**,
Model API **446.9/475 KiB**, ACP **819.3/850 KiB** and deferred webview JS
**49.7/50 KiB**. No cap, hook, lint level or test deadline changes.

The complete CLI comparison remains **red**. It reports **4,752 completed
captures** before `page.waitForSelector('#root > *')` exceeds the unchanged
30,000 ms page deadline. No pixel regression is reported. The log lacks
scene context, so no exact failing scene is inferred. The comparison cleans
its browser/fixtures, restores the exact manifest and exits 1; the sequential
worker stops before a second comparison. [The failed-run receipt](m114-s-after/mount-comparison-failure.json)
and [comparison record](m114-s-after/continuation-comparison.json) therefore
claim **zero of the required two complete passes**. The manifest/index point
to a complete but **unaccepted candidate**, not a certified baseline.

At the continuation's 90-minute timebox, the mount failure and two complete
replays remain open for the lead. The reviewed tolerance, four real UI drills,
native-layout owning tests, actual missing-theme capture and both-tier CI
binding are completed; visual certification is **not completed**. The CI job
will correctly block on a failed capture. Hosted execution, aggregate quality
and the unchanged **12,741-byte startup-growth** compaction remain integration
handoffs. No full quality run, workflow dispatch, push or live/paid call occurs.

## Continuation 3: deterministic CI batches

Read the latest certification, rig brief, complete shared rules, AGENTS,
D94/M114 and the token contract before editing. The rig brief supersedes
the shared brief's obsolete merge step; no branch is merged. The current
candidate and all historical failed receipts are retained unchanged.

The comparison now supports `--shard=<index>/<count>`, selecting contiguous
scene/theme/width groups from the validated reviewed manifest and retaining
every state in each group. Six shards contain **804 captures each**, exactly
**4,824 unique keys**, with no skipped component or state. An update cannot
use a shard. Each shard independently verifies archived hashes, replays the
recorded source when needed and fails its own pixel/coverage checks. Receipts
bind the manifest, selected keys, candidate Git revision/diff, browser,
platform and font fingerprint. `--merge-shards=<directory>` requires every
index once, exact counts/hashes and one candidate/environment, and checks
the combined baseline and candidate sizes against **512 MiB each**.

Both CI tiers use six source-reconstructing jobs and the required visual
merge. A failed, cancelled or skipped shard fails that merge; the existing
required aggregate still rejects a failed visual job. The 45-minute shard
deadline and pixel policy remain unchanged. This bounds reconstruction work
per job and permits rerunning one failed batch without restarting every
successful batch. Hosted execution remains the lead's verification.

Five new owning-suite red drills deliberately omit a state, accept a missing
receipt, relax the combined budget, remove candidate binding and omit a CI
shard. Each exits 1 in the complete owning suite at default Vitest deadlines;
each source is restored SHA-256-exact. The durable receipt is
[c3-shard-drills.json](m114-s-after/c3-shard-drills.json).

The page-mount diagnostic, consecutive complete comparisons and four final
UI drills follow below; this intermediate piece does not claim certification.
