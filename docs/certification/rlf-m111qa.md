# RLF-M111QA — M111 lane QA: the desktop test rig

Base: int/recovery at `0a5ebd7189` (contains lane 0, RLF-M111L0). Rig:
linuxlt (Ubuntu 25.10, x86_64). Date: 2026-10-30; the resumed guest
proof was completed on 2026-11-01.

## What this lane builds (PLAN.md M111a0, lane QA)

- `test/desktop/harness/**` — the harness: desktop scenes, the compositor
  session, the private D-Bus test bus and its test-only services, the
  Playwright Electron driver, review screenshots.
- `scripts/desktop-harness.mjs` — one command: check tools, list scenes,
  run a scene under headless Hyprland, drive Electron, tear down.
- `scripts/qemu-desktop-test.mjs` — QEMU desktop boot/install runner
  (swtpm, two virtual outputs, serial log, QMP screenshots and keys).
- `.github/workflows/desktop.yml` — the desktop CI (amd64 and arm64);
  `ci.yml` gains the desktop job that calls it for the smoke tier.
- Regions: `scripts/lib/harnessServer.mjs` (desktop scenes),
  `scripts/readme-shots.mjs` (desktop review shots).

## Decisions taken on this lane (from current main's rules)

1. **Review screenshots are for people, never compared.** PLAN's Tests
   paragraph still says "screenshot goldens"; the owner's rule (no
   screenshot or frame comparison) wins. The harness captures review
   shots per mode and language and uploads them as CI artifacts; tests
   assert scene geometry, token and string wiring in a real browser,
   never pixels.
2. **No D-Bus stand-ins for system services.** PLAN's "D-Bus mocks for
   every system service" contradicts the no-fakes rule. The D-Bus test
   services are harness-owned canary endpoints on a private bus (an
   echo/policy canary and a notifications sink that records what real
   code sent). Nothing pretends to be NetworkManager, BlueZ or logind;
   lane SY is tested against the real services in a VM.
3. **The compositor session needs a KMS allocator.** Measured on this
   rig (Hyprland 0.57.0, aquamarine 0.15.1, Arch container): aquamarine's
   headless backend always loads and takes `hyprctl output create
headless` outputs, but `CBackend::create()` fails with no DRM device
   and no Wayland parent, because the GBM allocator comes from a DRM fd
   (aquamarine `Backend.cpp`: "Cannot open backend: no allocator
   available"). Nesting under weston 15 headless also fails
   (`wl_compositor` version error from aquamarine's bind). Upstream
   Hyprland runs its own compositor tests in a QEMU VM with
   `-device virtio-gpu-pci` (nix/tests). So the harness session runs
   where a KMS device exists — a virtio-gpu VM (this lane's QEMU
   runner), a vkms device, or a rig's GPU — with Mesa llvmpipe forced,
   and creates the two aquamarine headless outputs scenes run on. Where
   no KMS device exists the harness refuses and says why; it never
   reports a session it did not start.
4. **Virtual input is the Wayland virtual-keyboard/virtual-pointer
   protocols.** Aquamarine's headless backend has no input devices, and
   a `/dev/uinput` device only reaches a DRM/libinput session. The Rust
   driver is a Wayland client speaking `zwp_virtual_keyboard_v1` and
   `zwlr_virtual_pointer_v1`, which Hyprland implements in every
   session type. Backed by `wayland-client` (rule 9 record below).
5. **The scene outputs keep clear of Hyprland's fallback name.**
   Measured in the Debian guest (Hyprland 0.55.2): an output named
   `HEADLESS-1` is claimed as the compositor's internal fallback and
   renamed `FALLBACK`, so it never appears as a usable monitor. The
   harness defaults are therefore `MUSE-HEADLESS-1` and
   `MUSE-HEADLESS-2`; a session refuses `HEADLESS-1` and `FALLBACK`
   by name instead of waiting for an output that cannot appear. A
   creation request can also be lost while Hyprland settles that
   fallback at startup, so the session re-creates only outputs absent
   from `hyprctl monitors all -j` until its ready deadline and reports
   both listings if the deadline passes.
6. **Scenes are harness shells until the shell lanes land.** SH1, SH2
   and WB are not on int. Desktop scenes render the lane-0 contract
   frame (regions, sizes from the M114 tokens) with the real desktop
   strings in all 15 tables, so TH, IN and AX can prove the token,
   language and geometry plumbing now. A scene shell is labelled as
   one in its title bar annotation; no test asserts product behaviour
   from it. Each shell lane replaces its scene's content with the real
   surface under the same scene id.

## Rule 9 records (new dependencies and tools)

- Rust crates for the virtual-input driver only (pinned in its
  `Cargo.toml`/`Cargo.lock`, security-audited by `cargo audit` in the
  desktop workflow): `wayland-client`, `wayland-protocols` (the
  maintained Rust Wayland stack; raw wire marshalling with fd passing
  was rejected as the fragile option).
- System tools the harness drives, never bundled: Hyprland + hyprctl
  (the compositor, D91.3), grim (wlroots screencopy capture), Mesa
  (llvmpipe software rendering), dbus-daemon (the private test bus),
  python3-gi (GDBus, for the test-only D-Bus services), QEMU + swtpm
  (this lane's boot runner). CI installs them from the distribution;
  versions are reported by `desktop-harness check`, not assumed.
- Electron, for the driver fixture only, pinned to WB's record
  (`electron` 45.0.0 on RLF-M111WB) in the fixture's own
  `package.json`; the driver normally launches WB's app with WB's
  Electron and adds no root dependency.

## Status

Parts A–G done. The harness, QEMU runner and workflows landed in
604be0c20 through 04aaa6caa; the guest-session and gate fixes landed
in 8d2585683, 608afd943, a1c19a7b2, 2b64a5737, dbcbff58e and
8b3632b87. This record and the PLAN status were brought up to date
in the closing change.

### Part A proof (scenes and review screenshots)

- `test/unit/desktop/harnessScenes.test.mjs` (10 tests, green): scene
  registry vs `DESKTOP_SIZED_SCENARIOS`; the greeter renders the real
  German table strings; unknown scene/theme/language refuse by name;
  15 languages listed; plural forms picked per language; the review
  plan expands scenes × themes × languages and `*` to all 15;
  `readme-shots --desktop` routes away from the README list; in real
  Chrome the compact workbench's bar, rail, chat, sidebar, panel and
  status sizes equal `DESKTOP_FRAME`/`COMPACT_PANES`, and the RTL scene
  keeps code classes left-to-right.
- Red/green drill: `scenes.css` bar height changed from
  `var(--ms-bar-height)` to `40px` → the geometry test fails (1 failed,
  suite exit non-zero); restored → 10 passed.
- Local look: `readme-shots --desktop --only greeter,workbench-1280
--languages en,de` wrote 16 shots under `temp/desktop-review/`;
  `greeter.dark.en.png` and `workbench-1280.light.de.png` were opened
  and inspected (real strings, German plural "2 Agenten laufen",
  annotation present; rail on the right as the mockups have it).

### Part B proof (compositor session and CLI)

- `test/unit/desktop/harnessCompositor.test.mjs` (10 tests, green):
  generated config pins both harness outputs and disables the rest;
  the captured guest monitors listing pins which outputs still have
  to be created; Hyprland's reserved fallback names refuse before any
  tool lookup; tool/KMS probing on real directories; capture and
  group-stop on real child processes; argument parsing; the script as
  a child process (scenes JSON exit 0, unknown command exit 1). The
  new expectations were watched failing first (3 failed, 7 passed,
  exit 1) and then passing (10 passed, exit 0).
- Real Hyprland in an Arch container (Hyprland 0.57.0, aquamarine
  0.15.1): `desktop-harness check --for compositor` reports ready, and
  `desktop-harness verify-config` generates the config and the real
  binary prints `config ok` (exit 0). A deliberately broken config
  (`hl.broken(`) prints the parse error instead. The renamed defaults
  were re-verified with the guest's own Debian Hyprland
  0.55.2+ds-1~bpo13+1 binary, also `config ok` (exit 0).
- On this host and in the container without `/dev/dri`,
  `desktop-harness session` refuses with the allocator reason and the
  VM directions; the full session proof runs inside the QEMU guest in
  Part F, the way upstream Hyprland tests itself.

### Part C proof (D-Bus test bus)

- `test/unit/desktop/harnessDbus.test.mjs` (5 tests, green on this
  host): canary ping round-trips and counts, the named failure error,
  notification ids and records with `CloseNotification` semantics, a
  bus whose policy denies the canary its name refuses to start (the
  drill is a test), and no daemon survives `stop()`. `desktop-harness
bus` round-trips the same path by hand; its records show sender,
  summary and id as the real client sent them.

### Parts D+E proof (virtual input, Electron)

- Rust driver: `cargo test` 5 passed, `cargo fmt --check` and
  `cargo clippy -- -D warnings` clean, `cargo deny check` and
  `cargo audit` exit 0 (26 crates; rust:1-bookworm container,
  rustc 1.99.1). The binary refuses a missing Wayland socket by name.
  The guest first exposed a real staging bug that the unit tests had
  not covered: the keymap file was created write-only, so the
  compositor's `mmap` of the passed descriptor failed with `EACCES`
  (shown as `wl_display@1: no memory`); an strace of Sway receiving
  the same request shows that exact `mmap` result. The new
  read-back test was watched failing on the old staging (`Bad file
descriptor`, cargo exit 101) and passing after the descriptor was
  opened read/write and rewound. The fixed binary then drove a real
  Sway pixman-headless session (text, key, move, button and scroll
  all acknowledged) before its in-session run in the Part F guest
  proof.
- Electron driver: `test/unit/desktop/harnessElectron.test.mjs`
  3 passed under Xvfb — the real Electron 45 fixture opens, is typed
  into through its page, and reports back; resolution refuses with
  every place searched when no Electron exists. The CLI smoke
  (`desktop-harness electron --expect-title "Electron fixture"`)
  prints the title and wrote `temp/desktop-electron/first-window.png`.

### Part F proof (QEMU runner and in-guest session)

- `test/unit/desktop/harnessQemu.test.mjs` (8 tests, green):
  composition per arch (two outputs, the right TPM device each time),
  refusals, transcript scanning, the script as a child process.
- Real boots in a Debian 13 container (QEMU 10.0.13, swtpm 0.7.1):
  x86_64 firmware-only passed (OVMF live frame; the captured head
  shows the UEFI interactive shell), aarch64 firmware-only passed
  (`UEFI firmware (version 2025.02…)` on the serial line), and a real
  Debian kernel with the proof guest reached its marker in 17 s with
  the kernel console on the virtio frame buffer and both heads
  captured. On this host directly, QEMU dies at the TPM handshake
  (`Failed to send CMD_SET_DATAFD` — fd passing is blocked in the lane
  sandbox), so host-side QEMU runs through the container, exactly as
  CI does; the failure is the sandbox's, recorded here, not worked
  around.
- The in-guest compositor session is proven on a fresh Debian 13
  cloud image in that same container with KVM passed through: stage 1
  installs Hyprland 0.55.2+ds-1~bpo13+1, grim, foot and Node from
  trixie-backports plus the full 7.2.11 kernel (`M111QA-APT-EXIT=0`),
  reboots, and stage 2 arms the logind autologin on tty1. Hyprland
  then runs on the virtio-gpu KMS device with Mesa llvmpipe and
  reports `MUSE-HEADLESS-1 1920x1080, MUSE-HEADLESS-2 1280x800`;
  the foot client opens on the first output, the virtual-input
  driver is acknowledged for all 3 script lines, and grim captures
  both outputs (1920×1080 and 1280×800 PNGs, opened and inspected:
  the foot window shows the typed text; they were never compared).
  The host runner returns `ok: true`, reason `marker`, in 220218 ms,
  with both QMP head captures written. The guest syncs its share
  before announcing
  `M111QA-SESSION-OK` on the serial device, so `run.log` and both
  grim screenshots survive the host stopping QEMU at the marker.
- The failing runs that led here were each kept as evidence, not
  rerun into green: with the old output names the guest timed out
  with only `HEADLESS-2 1280x800` visible (decision 5 above); with
  the readable-fd fix missing, the session reached both outputs and
  then failed at the virtual-keyboard keymap (Part D above); with
  the marker sent to `/dev/console` the guest succeeded but the
  host saw only `eof (qemu exit 0)`, and with the marker on the
  serial device but no sync the host passed while the share lost
  its files to the stop. Each cause was fixed in the harness and
  the next fresh-image run is the one recorded above.

### Part G proof (workflows and records)

- `.github/workflows/desktop.yml` carries the harness suites on
  amd64 and arm64, the Rust format/clippy/test/build and supply-chain
  legs, the Electron fixture under Xvfb, the compositor config check
  against trixie-backports Hyprland, the review screenshots as
  artifacts only, QEMU firmware boots on x86_64 and aarch64, the
  kernel-marker boot, and the schedule/dispatch-only in-guest
  session. `ci.yml` calls it in smoke mode for pull requests. This
  record, the PLAN status, the roadmap and the changelog move with
  the code in the same change; hosted CI remains the lead's gate.

### Final gate record (2026-11-01)

- Touched-file Prettier and ESLint (`--max-warnings 0`) exit 0;
  `npm run typecheck`, `node scripts/check-l10n.mjs`,
  `check:reference`, `check:host-api`, `check:plan`,
  `check:roadmap`, `check:catches`, `check:tokens`, `duplication`,
  `cycles` and `deadcode` exit 0. `check:workflow-scripts` first
  exited 1 because the compositor-config job mounted a fresh
  checkout with no `node_modules`; after adding its `npm ci` step it
  exits 0 (77 workflow Node loads checked). Shell syntax and
  ShellCheck, Python `py_compile`, the scene stylesheet's Stylelint
  and parsing all 14 workflow YAML files exit 0.
- The desktop suites pass with the repository's own 5 s test
  timeout: scenes 10, compositor 10, D-Bus 5, QEMU 8, input 2,
  contracts 5 and Electron 3 under Xvfb (43 tests). The Rust crate
  passes 5 tests plus fmt, clippy, release build, `cargo deny check`
  and `cargo audit` (all exit 0).
- `npm run build` exits 1 on four bundle budgets
  (`teamRunners.js` 78.4/75 KiB, `teamHost.js` 140.2/130 KiB,
  `teamScheduler.js` 76.5/75 KiB, `uiText.js` 125.3/125 KiB). The
  untouched base `0a5ebd7189`, built in a separate worktree, exits 1
  with the same four files byte-identical (80329, 143526, 78313 and
  128341 bytes; `cmp` clean), so the overruns pre-date this lane and
  no budget was raised.
- `vitest related` over every changed JS/TS source exits 1 on this
  busy rig (37 files, 1874 passed, 20 failed) and is not claimed
  green. Its estimator failures came from the run's `TMPDIR` pointing
  inside this worktree, so "outside a repository" fixtures were in
  one; the same three files pass 41 tests with the lane's normal
  outside-repository temp root, and `planReader` passes 55 alone.
  The remaining failures are Chrome readiness/test timeouts in the
  devices and feedback harness suites at host load averages of
  12–18; the devices suite on untouched base fails the same 2 s
  readiness wait (exit 1, 9 passed, 1 failed), so they are recorded
  as rig-load failures for hosted CI to judge, not rerun into green.
- Two wider configured checks also fail identically on base and are
  not this lane's change: `check:mhp` (the frozen v1.1 wire digest)
  and `security:audit` (high `GHSA-mrwp-f3q8-3g9p` in
  follow-redirects), both exit 1 here and on `0a5ebd7189`.
