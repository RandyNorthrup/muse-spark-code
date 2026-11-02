# The M111 desktop test rig (lane QA)

One harness for every Muse Desktop lane: SH1, SH2, CP, ED, WB, AX and
the screenshot review run under it. It is deliberately boring: one
command checks the machine, one starts a headless Hyprland on Mesa
llvmpipe, runs a scene, screenshots it, and tears everything down.

## The commands

```sh
npm run desktop:harness -- check [--for compositor|scenes|dbus|electron|input|qemu] [--json]
npm run desktop:harness -- scenes
npm run desktop:harness -- shot greeter --theme hc-dark --lang ja
npm run desktop:harness -- serve
npm run desktop:harness -- bus
npm run desktop:harness -- electron [--app dir] [--expect-title text]
npm run desktop:harness -- session --out temp/session [--input script.txt] -- foot
npm run desktop:harness -- verify-config
npm run desktop:qemu -- --arch x86_64 --out temp/boot --timeout 120 --memory 4096 --image os.img --marker READY
npm run readme:shots -- --desktop [--languages='*']
```

`--help` on each script is the contract. Everything the harness starts
is private to the run (runtime directory, D-Bus daemon, QEMU machine)
and stopped by the same command; nothing is left running.

## What lives where

| Path                                                | What it is                                                                                                                                                                                                                  |
| --------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `lib/scenes.mjs`, `scenes.css`, `review-shots.json` | The desktop scenes, one per approved mockup sheet, rendered from lane 0's contracts, the M114 tokens and the real string tables. A scene is a labelled shell until its lane replaces the content under the same id.         |
| `lib/sceneServer.mjs`                               | Loopback scene server; also mounted by `scripts/lib/harnessServer.mjs` at `/desktop-scene/<id>`.                                                                                                                            |
| `lib/reviewShots.mjs`                               | Review screenshots per mode and language. For people to look at; never compared by a test.                                                                                                                                  |
| `lib/compositor.mjs`                                | The Hyprland session: private runtime, generated Lua config, two aquamarine headless outputs, grim screenshots, full teardown.                                                                                              |
| `lib/dbusBus.mjs`, `dbus/*.py`                      | A private session bus plus two harness-owned canary endpoints (an echo/policy canary and a notifications sink that records). Nothing stands in for a system service; SY tests run against the real services in a VM.        |
| `virtual-input/`                                    | The Rust virtual keyboard/pointer driver (Wayland virtual-input protocols). `us.keymap` was captured 2026-10-30 with `xkbcli compile-keymap --layout us` (libxkbcommon-tools 1.7.0, Debian 13), sha256 `9927c7ab…f0376582`. |
| `lib/electronDriver.mjs`, `electron-fixture/`       | Playwright's Electron driver and the disposable fixture app its own tests launch. Real runs point it at lane WB's workbench.                                                                                                |
| `lib/qemuDesktop.mjs`                               | The QEMU desktop machine: two-output virtio-gpu, swtpm TPM, UEFI, QMP screenshots and keys, serial marker, `result.json`.                                                                                                   |
| `guest/`                                            | The proof guests: a busybox kernel-marker guest, and the cloud-init seed plus share builder that run a full compositor session inside a Debian guest.                                                                       |

## The compositor session needs a KMS device

Aquamarine's headless backend provides outputs but no buffer
allocator: the allocator comes from a DRM device. So `session` runs
where a KMS device exists — inside this rig's QEMU guest
(virtio-gpu), on a machine with a GPU or a vkms device, or nested in a
parent Wayland session with `--nest-display`. Upstream Hyprland tests
itself the same way (a QEMU VM with virtio-gpu). Where none exists the
harness refuses and says why; it never reports a session it did not
start. Rendering is Mesa llvmpipe everywhere
(`LIBGL_ALWAYS_SOFTWARE=1`, `GALLIUM_DRIVER=llvmpipe`).

## Running a session inside a guest

```sh
cargo build --release --manifest-path test/desktop/harness/virtual-input/Cargo.toml
sh test/desktop/harness/guest/build-session-share.sh . temp/guest-session \
  test/desktop/harness/virtual-input/target/release/muse-virtual-input
cp debian-13-genericcloud-amd64.qcow2 temp/guest-session/cloud-run.qcow2
qemu-img resize temp/guest-session/cloud-run.qcow2 12G
node scripts/qemu-desktop-test.mjs --arch x86_64 --out temp/guest-boot \
  --timeout 1500 --memory 3072 --cpus 2 \
  --image temp/guest-session/cloud-run.qcow2 \
  --target temp/guest-session/share.img \
  --seed temp/guest-session/seed.iso --marker M111QA-SESSION-OK
```

Do not pass `--snapshot` here: QEMU snapshots every drive, including
the share the guest writes its results to. Read them back afterwards
with `debugfs -R "dump /session-out/run.log out.log" share.img`.

Inputs arrive over the network only where the boot needs them: the
guest installs the pinned compositor from trixie-backports itself, as a
real machine would. No model or provider calls anywhere in this rig.
