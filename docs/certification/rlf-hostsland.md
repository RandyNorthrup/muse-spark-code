# RLF-HOSTSLAND — M104's native hosts re-landed on int, on the real panel, no fake runtimes

Lane `RLF-HOSTSLAND`, rig `linuxlt`, branch `rec/rlf-hostsland`. Base:
int/recovery `0a5ebd7189` (CC-INT5; its known failures, including the
three over-budget team bundles, are not counted against this lane and
are unchanged). Model attempts: **0**. Provider calls: **0**. Nothing
pushed, rebased, stashed or tagged. Toolchains (Maven 3.9.11, Neovim
0.12.6, emacs-nox 30.1) lived in the worktree's ignored `temp/`.

## Done

1. **Portable webview first**: merged `rlf-m104d` (`65cbc999a`); six
   conflicts, generated files regenerated.
2. **JetBrains** (`5248de7d2`): conformance 9/9 runnable legs green
   against `dist/acp.js panel --stdio`; full Gradle suite 52/52; node
   suites 17/17. The five pattern literals int's schema gained joined
   the embedded bridge's reviewed set. Six scripted python peers and
   seven suite files that needed them deleted; the runtime checkpoint
   adapter (`src/runtime/features/checkpoints.ts`) landed over int's
   store so the checkpoint leg runs real.
3. **Eclipse** (`90f6ee1ed`): conformance 9/9 under Xvfb/Tycho; full
   verify 59/61 (two need WebKitGTK, absent here). Fake `runtime.py`,
   `SessionTest` and `runtime-fixture.test.mjs` deleted. The launch
   suite now expects the LSP error code on bare EOF.
4. **Emacs + Neovim** (`2b6671c8b`): ERT 3 real-code tests green
   (six `cl-letf` stand-in tests deleted); Neovim headless harness
   green on pinned 0.12.6.
5. **Zed, Sublime, Qt Creator** (`eb97de47c`): Zed 6 and Qt Creator 4
   real-subprocess tests green plus the Lua harness; mocked-exec tests
   deleted. Sublime's whole suite ran on a fake `sublime` module:
   deleted, nothing claimed. Zed's Rust extension unbuilt (no Rust
   toolchain; the install was not approved here).
6. **Visual Studio + Xcode** (`1419e695a`): ported; fake-runtime
   suites deleted; VS test project compiles clean on Linux (runs on
   Windows, net48). Both conformance runners report pending with
   their need. `XCODE_HOST`/`XCODE_MODEL_TEXT` and 18 xcode strings
   landed in English and the 14 tables; the bundle-split gate guards
   the native block; `Scripts/generate.mjs` runs green.
7. **Matrix and receipts** (`86ba018f9`): `check:editor-matrix`
   wired; `docs/ide-compatibility/matrix.md` and `m104-*.{md,json}`
   receipts record this lane's runs. Sublime is honestly pending (a
   bare `subl --version` had falsely qualified it; fixed).

Source lanes A/B/C/G/GX/GL: GL is the port base; GX's Xcode is ported
whole; G is inside GL; A adds nothing under `hosts/` beyond GL; C's
host deltas were fake-harness migrations (deleted with the fakes) and
its runtime attachments binding targets a panel shape int does not
have (not ported; needs its own lane). B's extra hosts (Spyder,
RStudio, NetBeans, Jupyter) are outside this brief's nine and are not
ported. The GX lineage's release pipeline (`hosts-native.yml`) is
not landed; see `docs/real-life/unproven.md`.

## Next

- Live conformance legs (conversation, approval, session-reload,
  tab-completion) on `muse-spark-1.3-contributor`, ≤4 requests per
  host, counted — lead-authorized.
- Per-document 1-based versions for dirty-buffer and atomic-edit.
- The M105D attachments binding on int's panel shape.
- The native release pipeline against int's release workflow.
- Zed's Rust extension build (needs a Rust toolchain).

## Waiting

- **Visual Studio**: the lead's Windows PC (VSSDK + experimental
  instance; net48 suites execute there).
- **Xcode**: the Mac mini (XCTest harness).
- **Sublime**: a run inside Sublime Text (installed here, Build 4200,
  but no in-editor test harness is wired).
- **Eclipse browser tests**: WebKitGTK.

## Red/green drills

| Break                                                 | Caught by                     | red | green |
| ----------------------------------------------------- | ----------------------------- | --- | ----- |
| `embedded.mjs`: the `--muse-` pattern literal removed | `embedded.test.mjs`           | 1   | 0     |
| `matrix.md` hand-edited stale                         | `npm run check:editor-matrix` | 1   | 0     |

## Gates (final tree, exit codes)

| Gate                                                                                    | Exit    | Note                                                                     |
| --------------------------------------------------------------------------------------- | ------- | ------------------------------------------------------------------------ |
| prettier `--check` (82 touched files)                                                   | 0       |                                                                          |
| eslint `--max-warnings 0` (touched)                                                     | 0       |                                                                          |
| `npm run typecheck`                                                                     | 0       |                                                                          |
| `node scripts/check-l10n.mjs`                                                           | 0       | 0 problems                                                               |
| `npm run check:reference`                                                               | 0       |                                                                          |
| `npm run check:host-api`                                                                | 0       | regenerated                                                              |
| `npm run check:plan`                                                                    | 0       |                                                                          |
| `npm run check:roadmap`                                                                 | 0       | regenerated                                                              |
| `npm run check:editor-matrix`                                                           | 0       | 10 editors                                                               |
| `npm run check:mhp`                                                                     | 0       | schemas match                                                            |
| `npm run check:catches`                                                                 | 0       | baseline match                                                           |
| `npm run cycles`                                                                        | 0       |                                                                          |
| `npm run deadcode`                                                                      | 0       |                                                                          |
| `npm run duplication`                                                                   | 0       | 0 clones                                                                 |
| `npm run build`                                                                         | 1       | only the base's three team bundles over (CC-INT5 §8.1); no budget raised |
| build chain by hand (split, lazy, globals)                                              | 0, 0, 0 |                                                                          |
| `node test/hostApi/run.mjs jetbrains`                                                   | 0       | 9 legs, 13 waiting                                                       |
| `node test/hostApi/run.mjs eclipse`                                                     | 0       | 9 legs, 13 waiting                                                       |
| Emacs ERT / Neovim / Zed / Qt harnesses                                                 | 0       | 3 / 19 PASS / 6 / 4+19 PASS                                              |
| hostApi vitest project                                                                  | 0       | 67 passed                                                                |
| `runtimePanel*`, `conversationCheckpoints`                                              | 0       | 13 passed                                                                |
| checkpoint suites (`checkpointRecords`, `checkpointStorageGuard`, `checkpointNoLimits`) | 0       | 13 passed                                                                |
| SAST (`SEMGREP_ENABLE_VERSION_CHECK=0`)                                                 | 1       | the base's same 6 findings; none in this lane's files                    |
| `npm run security:audit`                                                                | 1       | 10 advisories; no dependency changed in this lane (scripts only)         |
