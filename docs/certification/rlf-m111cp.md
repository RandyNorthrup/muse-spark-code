# RLF-M111CP — M111 lane CP: compositor and windows

Base: rec/rlf-m111th (TH on int dfcb45936). Rig: linuxlt. Date: 2026-10-31.

## What this lane builds (PLAN.md M111a, lane CP; D91.3 + D91.15, D91.13)

- The Hyprland pin (`os/desktop/hyprland/pin.json`, consumed by IM/OS1).
- The generated Lua config (`os/desktop/hyprland/hyprland.lua`, full and
  light profiles): layouts, gaps, animations from TH's theme twin, floating
  rules, gestures, monitors, permissions, Hyprland's own UI off, XWayland
  off; the key table with the duplicate-binding check.
- `--verify-config` on the pinned 0.55.2 and current 0.57 (CI gate script;
  QA's desktop.yml wires it at merge).
- The `CompositorPort` (Rust trait + TS mirror) and its Hyprland adapter
  over both sockets; project-bound workspaces; Alt+Tab; labels, placement,
  send/merge; thumbnails under M107; agents' desktop tools + approval
  classes; floating-terminal rules.

## Status

- [x] TH twin: `hyprland-theme.json` beside the Lua table (shared region).
- [x] Docked Hyprland 0.57 (Arch) + pinned 0.55.2 (Debian backports).
- [x] Rust workspace + `muse-compositor-port` crate (unit-tested; fixtures next).
- [x] `src/shared/desktop/compositor.ts` (TS mirror, tools, policy).
- [x] `os/desktop/hyprland/` sources + generator + configs + pin.
- [ ] Suites green (vitest + cargo over recorded real IPC).
- [ ] VM session proofs (binds, merge, rename, events, permission drills).
- [ ] Strings x15, reference, CHANGELOG, PLAN, roadmap.
- [ ] Gates + LANE DONE.

Commits: 40589d37d (twin), 84bbf1dce (crate), 919c20683 (mirror),
7e47861d3 (generator).

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
  in a QEMU virtio-gpu VM (Arch live), the way upstream tests itself.
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
  `cycle_next`, `focus`, `event`, `exec_cmd`, `exit`). Two open
  proofs for the live session: the `window` param's string form
  (`"address:…"`) and the `exec_cmd` rules-table shape
  (`{ workspace = "1 silent" }`).
- No bind-triggering dispatcher exists (`send_shortcut`/`send_key_state`
  push keys into windows, they do not fire binds), so the binds
  themselves are proven by `--verify-config` plus the `hyprctl binds`
  listing; key round-trips wait for QA's input-injecting harness.
