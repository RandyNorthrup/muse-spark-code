# RLF-M111QA — M111 lane QA: the desktop test rig

Base: int/recovery at `0a5ebd7189` (contains lane 0, RLF-M111L0). Rig:
linuxlt (Ubuntu 25.10, x86_64). Date: 2026-10-30.

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
5. **Scenes are harness shells until the shell lanes land.** SH1, SH2
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

Part A done (604be0c20); Part B done (this commit); Parts C–G next.

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

- `test/unit/desktop/harnessCompositor.test.mjs` (8 tests, green):
  generated config pins both headless outputs and disables the rest;
  tool/KMS probing on real directories; capture and group-stop on real
  child processes; argument parsing; the script as a child process
  (scenes JSON exit 0, unknown command exit 1).
- Real Hyprland in an Arch container (Hyprland 0.57.0, aquamarine
  0.15.1): `desktop-harness check --for compositor` reports ready, and
  `desktop-harness verify-config` generates the config and the real
  binary prints `config ok` (exit 0). A deliberately broken config
  (`hl.broken(`) prints the parse error instead.
- On this host and in the container without `/dev/dri`,
  `desktop-harness session` refuses with the allocator reason and the
  VM directions; the full session proof runs inside the QEMU guest in
  Part F, the way upstream Hyprland tests itself.
