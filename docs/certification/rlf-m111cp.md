# RLF-M111CP — M111 lane CP: compositor and windows

Base: rec/rlf-m111th (TH on int dfcb45936). Rig: linuxlt. Dates:
2026-10-31–2026-11-02.

## What this lane built (PLAN.md M111a, lane CP; D91.3 + D91.15, D91.13)

- The Hyprland pin: `os/desktop/hyprland/pin.json` (trixie-backports
  `0.55.2+ds-1~bpo13+1`, companions, `verified: [0.55.2, 0.57.0]`).
- The generated Lua configs (`os/desktop/hyprland/hyprland.lua` full,
  `hyprland-light.lua` light): dwindle layout, TH gaps/borders/curves/
  timings, floating exceptions, gestures, monitors, permissions,
  Hyprland's own UI off, XWayland off; merge/send-new Lua helpers.
- The generator (`generate.mjs`): theme-twin input, `--check` drift gate,
  the duplicate-binding check across all `keybindings.*.json` sources,
  exit-binding refusal; `keys.json` (44 bindings), `keybindings.json`.
- `--verify-config` in CI (`.github/workflows/desktop.yml`, new): both
  configs on the pin (refusing any other version via `--expect-pin`)
  and on current Arch; proven in fresh containers, green and red.
- The `CompositorPort` (Rust trait `desktop/crates/compositor/**` + TS
  mirror `src/shared/desktop/compositor.ts`): Hyprland adapter over both
  sockets, project-bound workspaces, labels, placement + setting schema,
  focus-never-taken exec/send paths, send/merge, M107 thumbnail gate,
  the agents' desktop tools with their approval class, the key-table
  shape, floating-terminal port calls.
- 17 desktop strings in English + all 14 tables (`desktop.placement*`,
  `desktop.key*`).
- Wire tests over recorded IPC: `tests/wire.rs` + 8 captures, and the
  vitest binds-vs-table cross-check over the recorded `j/binds`.

## Status

- [x] TH twin (`hyprland-theme.json`, shared region with TH).
- [x] Pin + `verify-config` green on 0.55.2 and 0.57.0, red drill.
- [x] Rust workspace + `muse-compositor-port` (23 tests: 14 unit, 9 wire).
- [x] TS mirror + policy (vitest green).
- [x] Generator + configs + pin + key table (vitest green).
- [x] Guest session proofs: iter12 `M111CP-SESSION-OK`, all 25 proofs.
- [x] `desktop.yml` CI gate, proven fresh (green x2 legs, red x2 drills).
- [x] Strings x15, reference (no change needed), CHANGELOG, PLAN, roadmap.
- [x] Gates + LANE DONE.

## Commits (branch rec/rlf-m111cp)

- `40589d37d` TH JSON twin of the Hyprland theme table
- `84bbf1dce` Rust workspace and compositor port crate
- `919c20683` CompositorPort TypeScript mirror and policy
- `7e47861d3` Hyprland config generator, pin and key table
- `8cc8238bd` verify-config takes absolute paths
- `93d9cdde7` desktop placement and key-label strings
- `076164e74` CP record: pin-eval proof and drill plan
- `55e6d387d` virtual keyboards allowed by name in the config
- `dae869773` keyboard allow rule uses Hyprland's internal name form
- `5650c8cb7` open_on_desktop verifies placement and moves strays
- `65c453c02` wire tests over recorded Hyprland IPC
- `a25713cba` fixtures byte-exact and prettier-ignored
- `d4b48616d` recorded binds match the key table
- `c314e549e` verify-config in CI with pin check
- (this record + PLAN/CHANGELOG below)

## Proof

### TH twin (shared region with TH)

- `renderHyprJson`/`hyprThemeData` in `scripts/build-tokens-desktop.mjs`;
  `renderLua` serializes the same model (the committed Lua is byte-identical,
  `git diff` empty).
- `desktop/shell/theme/hyprland-theme.json`: 25 outputs fresh,
  `build-tokens-desktop.mjs --check` 0 problems.
- Vitest `test/unit/desktop/themeDesktop.test.mjs`: 21 passed (new twin test).
- Rig drill, real LuaJIT (nvim headless): the Lua table loads and deep-equals
  the JSON twin mode for mode (`lua-json-twin: identical`).

### Research (2026-10-31, all verified against the real binaries + live wiki)

- Lua API reference: `/usr/share/hypr/stubs/hl.meta.lua` from Hyprland
  0.57.0 (Arch) and 0.55.2 (Debian trixie-backports); every call CP emits
  exists in both stubs.
- Docs: wiki.hypr.land dispatchers/selectors/binds/rules/animations/
  gestures/permissions/IPC/using-hyprctl (all fetched 2026-10-31).
- Pin confirmed in live apt metadata: `0.55.2+ds-1~bpo13+1` (+ dev, portal
  1.4.1, protocols 0.7.1), exactly the researched values.
- Nesting without KMS is impossible: aquamarine's allocator needs a DRM fd
  even for the Wayland backend (source read: `Backend.cpp`, `Wayland.cpp`);
  sway-headless nesting fails at `CBackend::create()`. Session proofs run
  in a QEMU virtio-gpu VM (Debian trixie cloud image), the way upstream
  tests itself.
- `eval` on the pin: `hyprctl --help` on 0.55.2 omits `eval` (0.57.0
  lists `eval <code>`), but the pinned `/usr/bin/Hyprland` binary
  contains the socket1 handler's errors `eval is only supported with
the lua config manager` and `keyword can't work with non-legacy
parsers. Use eval.` — so `eval` is the Lua path on the pin and
  `keyword` is legacy-only. The adapter's eval-based live setters
  stand; no `keyword` rewrite.
- Dispatchers (wiki `configuring/core/dispatchers`, fetched 2026-10-31):
  every `dsp_*` string the adapter emits matches a documented method
  (`window.move` workspace/monitor forms, `workspace.move/rename`,
  `window.close/float/fullscreen/pin/center`, `group.toggle`,
  `cycle_next`, `focus`, `event`, `exec_cmd`, `exit`). The live session
  then proved the two open shapes: the `window` param's string form
  (`"address:…"`, F/G/H) and the `exec_cmd` rules-table shape
  (`{ workspace = "3 silent" }`, E2 accepted).
- No bind-triggering dispatcher exists (`send_shortcut`/`send_key_state`
  push keys into windows, they do not fire binds), so binds are proven by
  `--verify-config`, the `hyprctl binds` listing (44/44, exact set match
  in vitest), and real key injection through a kernel uinput keyboard
  (C1 super+2 switches with a fresh event; H alt+tab moves focus).

### Pin + verify-config (2026-11-01/02, rig linuxlt)

- `verify-config.mjs` green x4: full + light on pinned 0.55.2 (Debian
  container) and 0.57.0 (Arch container), `config ok` each.
- Red drill: a config with appended garbage fails exit 1 with Hyprland's
  Lua parse error (0.55.2 and 0.57.0).
- `desktop.yml` (new workflow, CP's job; QA owns the file and joins its
  harness jobs at merge): pinned leg (trixie-backports install, pin
  asserted via `--expect-pin`) + verified leg (Arch current, version
  printed). Proven in fresh `debian:trixie` and `archlinux:latest`
  containers with the exact job steps: green/green (exit 0, `2 configs
ok`), after two honest failures that shaped the job (Hyprland aborts
  without `XDG_RUNTIME_DIR` even for `--version`; it refuses superuser,
  so the check runs as a `tester` user). Red drills: `--expect-pin`
  against 0.57.0 exits 1 (`not the pinned 0.55.2`); a broken config
  exits 1 (`failed --verify-config`). actionlint (repo-pinned) clean;
  `check-workflow-scripts` ok (builtins only, no install).

### Guest sessions (2026-11-01/02, QEMU virtio-gpu VM in m111cp-deb)

Lane QA's harness had not landed, so CP scripted its own sessions (the
brief's fallback): three isolated sessions per boot (S0 control grim
baseline, S1 full config windowless, S3 light profile with windows),
each proof PASS/FAIL with evidence on the serial console, fixtures on
the share. Twelve iterations; every red is recorded, none re-run green.

- Iter1-3: timeouts and a byte-identical renderer stall; gdb showed a
  segfault in `CDynamicPermissionManager::askForPermission` (see
  upstream finding 1).
- Iter4-7: harness bugs of ours (diag quoting, getty race, stale apt
  lists, session-out bundling order), each fixed in the runner.
- Iter8: first full run; fixtures recovered (`s1-binds.json` 44/44).
- Iter9-10: all green except C/H (the virtual-input driver's
  `wl_display error 1,2 no memory` on the keymap roundtrip — a bug in
  QA's scratch driver, not the product: N4 later showed wtype's virtual
  keyboard adopted fine) and E2 (the exec rule's 1s token, see below).
- Iter11 (v7, uinput injection): C's super+2 `PASS` was caught as a
  false pass in review — D had already focused workspace 2, so
  `active=2` was vacuous. Source read then showed why the keys could
  not have flowed: the uinput device deduplicates to
  `at-translated-set-2-keyboard-1`, which FullMatch-misses the allow
  rule and falls into the catch-all ask (PENDING drops keys in
  `onKeyboardKey`). v7's C is void; C1/C2 replace it.
- Iter12 (v8, 2026-11-02, `M111CP-SESSION-OK`, marker in 602 s): all 25
  proofs PASS, each with compositor-alive evidence and a guest
  timestamp:

| Proof                                            | Result              | Evidence                                                                    |
| ------------------------------------------------ | ------------------- | --------------------------------------------------------------------------- |
| S0 starts / grim-baseline / compositor-exit      | PASS/PASS/SKIP-info | 0.55.2, grim exit 0, clean code 0                                           |
| A version / configerrors-empty                   | PASS                | 0.55.2, `""`                                                                |
| N3 dialogs-early                                 | PASS                | 2 shown (virtio-keyboard, power-button)                                     |
| N1 enforcement-live / N2 apt-forensics           | PASS                | `enforce_permissions` true; guiutils installed                              |
| B binds-count                                    | PASS                | registered=44 table=44                                                      |
| D label                                          | PASS                | ws 2 renamed `agent:fix` + event, renamed back                              |
| N4 wtype-control                                 | PASS                | exit 0, virtual keyboard adopted (event)                                    |
| C0u uinput-ready                                 | PASS                | /dev/uinput open to the session user                                        |
| C1 allow-uinput-super2                           | PASS                | allow-named device adopted, super+2 from ws 1, fresh `workspacev2>>2` event |
| C2 ask-pending-drops                             | PASS                | ask-only device adopted, super+3 dropped (no switch) — no fail-open         |
| I grim-enforced-recorded / K control-vs-enforced | PASS                | grim blocked (timeout, alive), baseline exit 0                              |
| S1 compositor-exit                               | SKIP-info           | SIGSEGV at teardown, 1 s after K (finding 3)                                |
| L light-starts                                   | PASS                | 0.55.2 on the light profile                                                 |
| E1 direct-spawn                                  | PASS                | 2 feet                                                                      |
| E2 exec-rule                                     | PASS                | exec_cmd accepted; exec-on=1 (the 1 s token miss, documented)               |
| E3 adapter-fallback                              | PASS                | stray moved to 3, focus stayed on 1                                         |
| F merge                                          | PASS                | 3 feet on 2, 4 move events                                                  |
| G send-new                                       | PASS                | new desktop 3 by address, focus followed (person's action)                  |
| H uinput-alt-tab                                 | PASS                | focus `0x…3a40 -> 0x…5a80` via allow-named uinput alt+tab                   |
| S3 compositor-exit                               | SKIP-info           | SIGKILL at teardown (harness, 9 s after H)                                  |

Product fixes the sessions forced (committed): virtual keyboards
allowed by name (`55e6d387d`); the AT rule in Hyprland's internal name
form (`dae869773`); `open_on_desktop` verifies placement and moves
strays (`5650c8cb7`); the config documents the guiutils requirement.

### Wire tests over the recordings

- Rust `tests/wire.rs` (9 tests): the S1 socket2 stream parses to the
  exact 24-line event sequence (v1 twins skipped); the S3 stream's
  opens/moves/titles/focus carry their fields (3/5/3/8); workspaces,
  monitors, clients (with monitor-name resolution), devices (active
  keymap preferred), empty activewindow is None; malformed lines and
  garbage replies report their kinds. Captures in
  `tests/fixtures/` with capture dates + commands (README).
- Vitest `compositorConfig.test.mjs` (+1 test): the recorded `j/binds`
  decodes (XKB modmask) to exactly the 44 generated bindings, all
  `__lua`, no submap. Capture in `test/fixtures/m111cp/` with README.
- Suites: `cargo test -p muse-compositor-port` 23 passed; vitest
  `compositor.test.ts` + `compositorConfig.test.mjs` +
  `themeDesktop.test.mjs` green; `cargo fmt --check` and
  `clippy -- -D warnings` clean.

### Red/green drills (each: break, non-zero, restore, green)

1. Generator duplicate binding: `SUPER+Q` twice across files ->
   `generate.mjs --check` exit 1 naming both rows; restored -> `0
problems`. (Committed vitest equivalents cover ranges, modifiers,
   exit bindings, backwards ranges.)
2. Broken Lua config: appended garbage -> `verify-config.mjs` exit 1
   with Hyprland's parse error (0.55.2 and 0.57.0); restored -> `2
configs ok`.
3. Pin drift: `--expect-pin` against 0.57.0 -> exit 1 `not the pinned
0.55.2`; against the pin -> `pinned 0.55.2 confirmed`.
4. Stale generated output: hand-edited `keys.json` -> `--check` exit 1
   naming it; regenerated -> `0 problems`.
5. Ask-pending keyboard (C2): pending keys dropped, no fail-open; the
   allow-named twin (C1) flows. (Live session proof, not a unit drill.)

### Upstream findings (Hyprland 0.55.2; 1 also on 0.57.0)

1. Ask without `hyprland-guiutils` segfaults the compositor (null check
   after the dereference). The config comments it; the image must ship
   guiutils; CI installs it implicitly via Hyprland's deps (Debian
   Recommends) — N2 forensics prove it present in the guest.
2. `hyprland-dialog` crashes (libhyprtoolkit null deref), on show and on
   expiry: no ask was ever answered in 12 runs, yet allow rules held
   (no asks fired for matching devices) and pending dropped keys (C2).
   The permission system works; its dialog UI is broken.
3. The S1 compositor SIGSEGVs at shutdown (same `70a5ae` offset in
   iters 10-12, always after the last proof); S0 exits 0; S3's
   shutdown wedges and takes SIGKILL. Teardown-only; every proof
   carries alive=true.
4. QA's scratch `muse-virtual-input` driver fails the keymap roundtrip
   (`no memory` protocol error) where wtype succeeds: a driver-side
   bug for the QA lane, not this one. C/H moved to kernel uinput.

## Handed on, not built here

- QA's harness at merge (this lane's guest runner was the brief's
  fallback and stays scratch; QA owns `desktop.yml`'s future jobs).
- The settings app embeds `desktop.placement` and the workspace
  bindings (schemas, default and strings are CP's).
- The Model API tool table and the `ide` MCP server register
  `desktop_open/send/merge` with owners at merge (names, shapes and
  the `edit` class are CP's; agent calls pass `follow=false`).
- No cargo CI job exists yet for `desktop/crates/**` (no workflow runs
  `cargo test/clippy/fmt`); the milestone's gate list names them for
  their own lane.
