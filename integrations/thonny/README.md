# thonny-muse-spark — Muse Spark companion plugin for Thonny (unofficial)

A Thonny plugin (`thonnycontrib.muse_spark`) that connects Thonny to the
Muse Spark runtime: it starts the runtime, opens the companion page in the
system browser, and offers Thonny's already-open device connection to the
runtime as its serial provider — so the engine goes through Thonny instead
of fighting it for the port.

Part of M103 lane T. License: MIT (see `LICENSE`).

## What you get

- **Tools → Open Muse Spark.** Starts the installed `muse-spark-code-acp`
  runtime (or reuses the live one), connects the serial-provider bridge,
  and opens the companion page.
- **Tools → Stop machine** (also a toolbar button). Sends the machine's
  own stop sequence through the runtime's out-of-band `stop-machine`
  call. It is never gated: no approval, no running runtime required.

## Requirements

- Thonny 4.x or 5.x.
- The installed `muse-spark-code-acp` runtime on `PATH`. The plugin never
  bundles or downloads it; without it, Open Muse Spark says so and stops.
- Python 3.10 or newer (Thonny's own interpreter is fine).

## Install

Inside Thonny: **Tools → Manage plug-ins**, search for
`thonny-muse-spark`, install, and restart Thonny. Or, with Thonny's
Python:

```sh
thonny_python -m pip install thonny-muse-spark
```

## Safety

- Device actions (connect, program, actuate) always ask first, in the
  runtime's UI, showing exactly what will be sent. The plugin never sends
  anything to the device on its own: it only fulfils requests the engine
  approved, each carrying the engine's approval echo.
- **A software stop is not an emergency stop.** A machine needs its own
  physical E-stop (ISO 13850, IEC 60204-1).
- Thonny owns the port while connected. The plugin never opens a serial
  port itself; a second program holding the port is reported busy, never
  taken.

## How it works

```
Thonny (menus, runner) ⇄ this plugin ⇄ runtime (companion + engine)
                              │                │
                              │  hello/token   │ device_request (approved)
                              └────────────────┘ device_response
```

The runtime announces its companion URL, launch code and provider
endpoint on its stdout when started in `panel` mode; the plugin opens
`<url>#launch=<code>` (fragment only, loopback only) and connects to the
provider endpoint. The v1 frame schema lives in
`src/thonnycontrib/muse_spark/protocol.py` and is currently this lane's
proposal for the runtime lanes (M103 R/P) to freeze; a peer speaking any
other version is refused before a byte reaches the device.

## Developing

No third-party Python dependencies — only the standard library. Thonny
itself is not needed: the suite runs against fakes.

```sh
cd integrations/thonny
python -m pytest
python -m build   # needs the `build` package
twine check dist/*
```
