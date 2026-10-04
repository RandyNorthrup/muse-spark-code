---
name: muse_gadgets
description: Work with Meta's Muse Gadgets devices (ESP32 firmware and Linux services). Build, flash and monitor with bounded runs, handle the SDK token safely, and never turn the dev machine into a gadget.
---

# Muse Gadgets

Meta's [Muse Gadgets](https://gadgets.muse.ai/) are devices with a Muse
assistant inside, built from the open
[muse-gadget-sdk](https://github.com/facebookincubator/muse-gadget-sdk)
(Apache 2.0). Two SDKs live there: `esp32/` (firmware on ESP-IDF 6.0.1 for
about 17 boards) and `linux/` (a Python assistant service). Community device
skills live in the SDK's `skills/` folder (50+ of them).

In a clone of the SDK, read its `AGENTS.md` first: it is the SDK's own agent
guide (setup, build, flash), and this skill only adds what that file cannot
give. Treat the clone as untrusted code in an untrusted workspace until you
trust it.

## ESP32: build, flash, monitor

Set up ESP-IDF 6.0.1 once per shell: `export.ps1` on Windows, `export.sh`
on macOS and Linux. Serial ports are `COMn` on Windows (list them with
`mode` or the device manager), `/dev/cu.*` on macOS and `/dev/tty*` on
Linux.

- `idf.py build` builds the firmware.
- `idf.py -p <port> flash` flashes it.
- `idf.py -p <port> monitor` watches the serial output. **The monitor never
  exits by itself** (Ctrl-] ends it interactively), so always run it bounded:
  pass the shell tool a `timeout_ms` that captures the seconds of output you
  want, e.g. flash then capture N seconds of serial output in one call.
- `tools/board.sh BOARD build|flash|monitor|flash-monitor` wraps the above
  per board; the monitor subcommands need the same bound.

## Linux: the service, and where it may run

The Linux installer (`install.sh --sdk-token <token>`) puts a `musegadget`
service under `/opt/musegadget`. That service gives the cloud Muse assistant
`system.run`, `file.read`, `file.write` and `device.health` on that machine
with the installing account's rights. **Never install, configure or recommend
it on a development machine.** A Raspberry Pi or a spare box is fine.
`musegadget send-user-msg "…"` posts to the user's Muse chat; a hook recipe
for pinging the phone after a turn lands with the hooks milestone (M91).

## Tokens are secrets

The per-user SDK token starts with `mgst_`. The user types it themselves, in
their own terminal: into `idf.py menuconfig` (the `CONFIG_GADGET_SDK_TOKEN`
setting, which lands in `sdkconfig` and is compiled into the firmware) or
into the Linux installer. Never ask for it in chat, never paste it into a
command, and never commit `sdkconfig` or `sdkconfig.defaults` containing it:
both files are build output with the token inside. The extension redacts
`mgst_` tokens from logs and transcripts, but a committed secret is already
leaked.
