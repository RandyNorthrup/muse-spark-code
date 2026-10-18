# Lane PARITYMAC certification — fast judge, OpenCode plugins, headroom on macOS

Rig: MacBookPro15,1 (Intel i9-8950HK, x86_64), Darwin 24.6.0, Node v24.21.0,
libuv 1.52.1. Worktree `/Users/user/lanes/PARITYMAC`, branch `fix/macos-parity`.
Probe: `temp/now-probe.ts` bundled with esbuild and run on this machine.

## First result — now (measured 2026-10-17 on this Mac), after

- Fast judge (`InspectRunner.run('cat x', …)` on darwin): now `{"kind":"refused",
"reason":"platform"}` (`inspectExec.ts:328`). After: runs on macOS under a
  Seatbelt profile via `/usr/bin/sandbox-exec`; Windows stays refused
  (`platform`: no Landlock/seccomp and no Seatbelt equivalent wired).
- OpenCode plugins (`resolvePluginRuntime('opencode', {platform:'darwin'})`):
  now `{ok:false, reason:"opencode: bun's memory cannot be bounded on darwin"}`
  (`pluginHost.ts:295-296`). After: runs `bun -e` directly, like OpenCode
  itself does — no kernel memory cap on macOS; timeout, frame and tree bounds
  still hold.
- Probes (`createOptionalResourceProbes` on darwin): now `gpu: null`,
  `disk: null`. After: real readings — GPU `%` from `ioreg IOAccelerator
PerformanceStatistics "Device Utilization %"`, disk busy `%` from the
  `IOBlockStorageDriver` `Total Time` delta. Headroom already reads:
  `availableMemory: 16800477184` (libuv 1.52.1 clears the D87 gate, ≥ 52).

## Rig notes (environment, not product)

- The rig's `xcode-select` points at a missing `/Applications/Xcode.app`, so
  the `/usr/bin/{git,cc}` shims fail. All git and C work here uses the direct
  CommandLineTools paths (`/Library/Developer/CommandLineTools/usr/bin` first
  on PATH, `DEVELOPER_DIR` override for builds). Nothing in the repo was
  changed for this; healthy machines and CI are unaffected.
- This shell runs inside an agent sandbox: `sandbox-exec` fails with
  `sandbox_apply: Operation not permitted`, `ps` and `setrlimit(RLIMIT_AS)`
  are denied. Live Seatbelt confinement drills (item 1) cannot execute in this
  shell; they are committed gated on sandbox-exec availability (visible skip
  here) and must run green outside the sandbox / on hosted macOS CI.
  Everything else below ran for real on this Mac.

## Item 3 — macOS GPU and disk probes (TODO)

## Item 2 — OpenCode plugins on macOS (TODO)

## Item 1 — fast judge on macOS (TODO)

## Gates

## Drills
