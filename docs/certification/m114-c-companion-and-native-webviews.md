# M114 C — Companion and native webviews

Date: 2026-10-06. Rig: Kubuntu. Base: `m114/p2`, `871597b49`.
Scope: D94.5 and M114 C, after the lane-0 contract and lane-A audit. No
model attempts, paid/live calls, dependencies or tools installed.

## Delivered on this base

`src/webview/bridges/theme/` contains the lazy consumer and its injected
`ThemePort`. It imports the generated role map by its named export: the
palette JSON and contrast data are absent from JavaScript. Existing generated
CSS supplies all colours, typography, scales and accessibility overrides.
The scoped surface rule applies those roles to the opted-in root. No token
source, generated output, existing panel style, host bootstrap, native plugin,
wire schema or other lane's implementation is edited.

Every full snapshot validates before mutation. Original keys are checked
before Zod can discard `__proto__`; colours use literal syntax and the browser
parser, font families reject CSS expressions/declaration injection and
CSS-wide keywords, and sizes are positive pixels. Failure notifies through
the injected callback, without keeping/logging the snapshot. Missing roles
clear earlier inline values, allowing the selected Muse palette's fallbacks.
All 61 generated host roles map onto both `--ms-*` and the compatibility
variables shared components still read. The first shared alias wins (raised
before overlay). Both HC modes also set the existing shared-panel classes.

Subscription precedes the initial read. Disposal is idempotent, ignores late
callbacks, restores prior owned values and priorities, theme marker and mode
classes, and restores even if unsubscribe throws. Failed setup restores the
root. The lazy loader observes the injected surface lifetime before mounting
and after an initial callback; abort cleans up an already-mounted consumer.

The two owning suites use fake **internal port producers**, labelled
companion/JCEF/WebView2/SWT. These are not faked MHP frames or native browser
engines. Chromium checks the actual bundled consumer/CSS against lane-0 Muse
palettes and the four captured VS Code harness theme fixtures. Capture input:
`test/harness/themes/{light,dark,hc-light,hc-dark}.json`, in this worktree;
counted model attempts: **0**. No external theme archive is read or installed.

## Acceptance and limits

| Item                                                                           | Evidence / result                                                                  |
| ------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------- |
| Four Muse modes; all generated roles; change after mount                       | Owning DOM and Chromium suites                                                     |
| Captured host colours and fonts; shared aliases; scoped mutation               | Four labelled port producers; host fixtures in Chromium                            |
| HC flat/opaque; reduced motion/transparency; increased contrast/forced colours | Real Chromium preference media queries and generated CSS, across all modes         |
| Lazy load and cancellation; setup failure; disposal restoration                | Owning DOM suite                                                                   |
| 320 px layout; focus/draft preservation and composition events                 | Chromium input fixture; does not claim actual native IME certification             |
| CSP/remote assets/font files                                                   | Fixture denies remote/unknown requests; no font file or remote asset is introduced |
| Real companion and JCEF/WebView2/SWT/editor captures                           | **Waiting: M114-C-M104-BINDING**, below                                            |
| Final integrated visual/axe certification and screenshots                      | **Waiting: M114-C-S-CERTIFICATION**                                                |

## Named integration handoffs

1. **M114-C-M104-BINDING (M104 lane 0/D and C integration).** This base has
   no `src/shared/hostApi/**`, companion page/server or native bridge. Convert
   the captured, validated MHP theme frame to the documented `ThemePort`
   snapshots; connect updates and the surface's abort controller; call
   `loadThemeBridge` for companion/native roots before mounting the shared
   panel. Companion mode/font choices feed the same port. Leave VS Code's
   existing host-controlled bootstrap intact. This applies equally to
   JetBrains/JCEF, Visual Studio/WebView2, Eclipse/SWT, Xcode and the other
   native/companion editor rows. Capture those real hosts on their rigs at
   320/690 px in four modes; append actual adapter/page audit grades to A's
   record. No guessed wire schema or production fake is supplied here.
2. **M114-C-LAZY-ASSETS (build/budget owner).** Include the consumer as a
   separate lazy closure in the companion/native browser build; load the
   matching emitted CSS **after** shared panel CSS, using only local CSP
   sources. Dynamic esbuild JS imports do not inject extracted CSS. Register
   independent 25 KiB JS / 25 KiB CSS caps and a split guard on this closure
   in the shipped build. The owning browser test already checks those caps
   and that the loader's eager JS contains no consumer/JSON/Zod input. No
   existing cap is raised. The shipping build on this base has no M104 entry
   to attach this closure to; startup growth here is zero.
3. **M114-C-S-CERTIFICATION (S/lead).** Bind actual companion/native surfaces
   into final screenshots, visual regression and axe; run integrated quality.
   S owns README, CHANGELOG and editor compatibility records. README text:
   “The companion uses the four Muse palettes; native editor panels map
   their editor's colours and fonts onto the same shared design roles.”
   CHANGELOG text: “Add a lazy companion/native theme consumer with complete
   host-role mapping, palette fallbacks, high-contrast modes and safe lifecycle
   cleanup.” Publish these claims only after the actual M104 binding is
   verified. No command, setting, slash command or localization key is added;
   `featureCatalog.ts` is absent on this base. Integration should add/update
   the design feature's row if that catalog exists by then.
4. **M114-C-HOST-ERROR (lane 0).** A's distinct `--vscode-errorForeground`
   gap remains in the frozen role source. C reads the generated map, so the
   additional semantic role will bind automatically once lane 0 adds it.

## Verification and red drills

Date: 2026-10-06 (second session, same rig/base `871597b49`). Full
quality/full unit runs are prohibited by the shared lane brief and remain
with the lead. No gate is weakened. No model call, dependency, install or
live/paid call.

Scoped receipts (all at the repo's default vitest timeout; no `--testTimeout`):

- `npx vitest run test/unit/themeBridge.test.ts --maxWorkers=3` — **40/40
  pass** (~2 s, Kubuntu rig).
- `npm run typecheck` — exit 0 (all five projects).
- `npx eslint --max-warnings=0` on the five lane JS/TS files — exit 0.
- `npx stylelint "src/webview/bridges/theme/*.css" --max-warnings=0` — exit 0.
- `npx prettier --check` on the lane files, cert doc and PLAN.md — clean.
- `node scripts/check-l10n.mjs` — 0 problems (lane adds no strings).
- `npm run check:tokens` — 0 problems (lane reads generated outputs only).
- `npm run deadcode` (knip) — exit 0, only the two pre-existing config hints.
- `npm run duplication` (jscpd) — 0 clones.
- `npm run build` — exit 0. `dist/extension.js` 438.4 KiB (cap 600),
  `dist/modelApi.js` 446.9 KiB (cap 475); no existing cap raised. The lane's
  consumer is not yet attached to a shipped entry (handoff M114-C-LAZY-ASSETS
  below), so startup growth on this base is zero.

Lazy-budget probe (no browser): `temp/m114c-budget-probe.mjs` replicates the
browser suite's first test through esbuild only — **PASS**: lazy JS 25,580 B
and lazy CSS 21,843 B against the separate 25 KiB caps each (JS headroom is
20 B; integration must watch it), dynamic import present, eager JS free of
`themeBridge.ts`/`consumers.json`/zod inputs, no palette/contrast/font/remote
leak. The probe is scratch in gitignored `temp/`, not committed.

Byte-exact red drills (each: break, watch the named test fail, restore,
`sha256sum -c` OK on all three files, full DOM file green):

- **D1 unknown/`constructor`/`__proto__` role keys.** Removed the pre-record
  refinement so `roles` is a bare `z.record`. The `refuses an invalid
snapshot atomically` cases for `colour.unknown`, `constructor` and
  `__proto__` fail (3 failed, rest pass); restore → 40/40.
- **D2 shared-alias first-wins.** Removed the `aliases.has` guard so the last
  role wins. All four producer tests
  (`companion/JCEF/WebView2/SWT … changes every role and mode`) fail;
  restore → 40/40.
- **D3 pre-load abort.** Removed the `if (isAborted()) return undefined`
  after the dynamic import. `does not subscribe or style a surface cancelled
while its chunk loads` fails; restore → 40/40.
- **D4 disposal class restore.** Removed `root.classList.remove(...themeClasses)`
  from `restore`. `restores prior values, priorities, attributes and
classes, and ignores late events` fails; restore → 40/40.

Chromium suite status — **BLOCKED on this rig session, not a code failure.**
`test/unit/themeBridgeBrowser.test.mjs` (14 tests) cannot launch any browser
under this session's tool sandbox: system Chrome, Playwright's bundled
Chromium 1234 and its headless shell all die at startup (`socketpair:
Operation not permitted`, then SIGTRAP; `strace`/Firefox exec also denied),
and unsandboxed execution needs human approval, which is disabled for this
session. The `beforeAll` launch therefore fails before any assertion. The
esbuild half of its first test is proven by the probe above; the 13
Chromium-rendered assertions (four-mode palettes, JCEF/WebView2/SWT captured
hosts, preference media queries, focus/IME/draft) are unverified here and go
to the assigned rig with the M104 binding: **M114-C-CHROMIUM-RERUN** — run
the two owning files on Win11 VM (this lane's assigned rig) or another
unsandboxed host at integration, at default timeouts, before S certifies.
