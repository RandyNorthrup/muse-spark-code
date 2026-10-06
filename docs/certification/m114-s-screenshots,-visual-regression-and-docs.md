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
