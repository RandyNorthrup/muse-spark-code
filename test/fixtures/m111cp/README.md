# Recorded Hyprland captures (RLF-M111CP)

Outside-world input for the desktop vitest suites: byte-exact replies
Hyprland 0.55.2 (Debian trixie-backports `0.55.2+ds-1~bpo13+1`) sent
during the lane's QEMU guest sessions on 2026-11-02 (QEMU 10.0.13,
virtio-gpu, `m111cp-deb` container on rig linuxlt).

| File                | Capture                                                                                             | Session                                |
| ------------------- | --------------------------------------------------------------------------------------------------- | -------------------------------------- |
| `binds-0.55.2.json` | `j/binds`: the 44 registered binds of the generated full config, saved verbatim by the guest runner | iter12 (`boot12`, `M111CP-SESSION-OK`) |

Nothing here is hand-written. The socket1/2 captures the Rust suite
parses live beside it (`desktop/crates/compositor/tests/fixtures/`).
