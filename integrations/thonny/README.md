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
- On Windows, the bundled .NET Framework C# compiler. The plugin compiles
  its process-job launcher in a private temporary directory; it downloads
  nothing and reports a startup error if the compiler is unavailable.

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

The provider address must be the literal IPv4 loopback address `127.0.0.1`.
The token authenticates the handshake; its timeout ends after `welcome`,
so an idle companion page keeps its provider connection. Stop and shutdown
cancel queued requests before any later Tk pump can dispatch them.

A provider `info` reply includes `target`, an opaque identity for the
current Thonny runner/backend connection. A write approval echo must carry
that `target`, `expires_at` (finite UTC Unix seconds), and `digest` (`sha256:`
followed by the lowercase SHA-256 of the exact decoded bytes). The runtime
must capture the identity and expiry when the user approves. A new runner
or backend proxy needs another approval even if its label is the same.
Immediately before each write the plugin checks the identity, digest,
expiry and request deadline under its dispatch lock. Empty files are valid.
These strengthened fields remain a proposal awaiting the R/P protocol
freeze; fake tests do not certify interoperability with an installed runtime.
If the system browser refuses to open the companion page, Open reports an
error instead of claiming success.

Open clicks are serialized. Closing Thonny cancels startup and pending
handshakes, joins the workers, and terminates the runtime tree. On Windows
the launcher owns a kill-on-close job before creating the runtime; on
macOS/Linux the runtime owns a new process group. Startup accepts the three
announcement kinds in any order. One reader drains stdout for the runtime's
whole lifetime and discards its diagnostics without logging bearer values.

Menu labels, toolbar captions and failure notices use Thonny's display
language. The package ships gettext catalogues for Czech, German, Spanish,
French, Hungarian, Italian, Japanese, Korean, Polish, Brazilian Portuguese,
Russian, Turkish, Simplified Chinese and Traditional Chinese; unsupported
languages use English. Notices use fixed translated messages rather than
displaying a peer's unchecked technical text.

## Developing

No third-party Python dependencies — only the standard library. Thonny
itself is not needed: the suite runs against fakes.

```sh
cd integrations/thonny
python -m pytest
python scripts/compile_catalogs.py  # rebuild the shipped gettext .mo files
python -m build   # needs the `build` package
twine check dist/*
```
