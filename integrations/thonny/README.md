# thonny-muse-spark — Muse Spark companion plugin for Thonny (Unofficial)

An experimental Thonny plugin (`thonnycontrib.muse_spark`) for the Muse
Spark runtime and companion page. The plugin never sends device commands
through Thonny's runner, queues, shell, or backend. While Thonny owns the
port, the runtime can request only bounded text already shown in its shell.

M103 lane T, MIT. Not yet published. The v2 interface below is a proposal
awaiting R/P integration and installed-runtime certification.

## Controls

- **Tools → Open Muse Spark.** Starts the installed `muse-spark-code-acp`
  runtime, connects the local control bridge, and opens the companion page.
- **Tools → Hand the port to Muse Spark.** Requires Open first and a concrete
  serial port selected in Thonny's interpreter configuration (`auto` and
  WebREPL are refused). Uses Thonny's public `destroy_backend()` API to
  disconnect and clear its pending queue before asking the runtime to acquire
  the port through lane P's cross-process lease and serial session.
- **Tools → Give the port back to Thonny.** Requests serial close and lease
  release. Only a matching acknowledgement permits `restart_backend(clean=True)`.
  If the selected interpreter, port or runner changed, reconnection is refused.
- **Tools → Stop machine**, also a toolbar button. Calls the runtime's
  independent `stop-machine` command without approval, a provider connection,
  a running companion, or a transfer prerequisite. When the runtime owns the
  port, this is lane P's out-of-band Stop.

Hand-over and return require user clicks. Opening, receiving a model request,
errors, disconnecting the provider and closing Thonny never transfer or
reconnect a port automatically. A refused, timed-out or malformed transfer
leaves Thonny disconnected. Reopen Muse Spark and explicitly give the port
back after the runtime can confirm release. The runtime must clean up its
leased session on provider closure; the plugin never asserts release on its
own. A software Stop does not replace a physical emergency stop.

The runtime retains exact-byte, target-bound per-action approval, bounded
serial reads and ungated Stop. No device payload or approval is accepted by
this plugin. A device held by another process remains busy.

## Requirements

Thonny 4.x or 5.x, Python 3.10+, and the installed `muse-spark-code-acp` runtime
on PATH. The plugin downloads nothing. On Windows it uses the bundled .NET
Framework compiler to build a process-job launcher in a private temporary
directory. The plugin fails explicitly if the runtime/compiler/browser is
unavailable. Its Python code uses only the standard library; the package
declares the Thonny versions it supports (`thonny>=4.1.7,<6`) so Thonny's
plug-in manager can read the range from PyPI.

## Local control interface (v2 proposal)

Panel startup still announces `MUSE_SPARK_COMPANION_URL`,
`MUSE_SPARK_COMPANION_LAUNCH`, and `MUSE_SPARK_PROVIDER <host> <port> <token>`
on stdout, in any order. The host must be literal `127.0.0.1`. The browser
gets the launch code only in a URL fragment. The socket starts with the
plugin's `hello` (`provider: thonny`, token); the runtime answers `welcome`.
Only strict integer `v: 2` is accepted. V1 peers are refused.
Hand-over is available only after a validated welcome; a click during
connection leaves Thonny connected and sends no port request.

Frames are newline-delimited JSON, at most 65,536 bytes plus the newline,
in both directions. The runtime may send `device_request` with exactly
`v`, `type`, bounded nonempty `id` (128 characters), and `op: context|info`.
The plugin answers `device_response` with that id and `ok`/`result` or
`error`. Context is the last 4,096 characters already displayed in Thonny's
shell, read on the Tk thread, only while its backend exists. Info reports
`connected` and `read_only: true`. Legacy `read`, every `write` (including
empty files), approvals, paths and payload fields are refused. An unsendable
result becomes a bounded error, never an oversized success.

Only a user click sends `port_request` with `v`, `type`, unique `id`,
`op: acquire|release`, and the concrete `port`. The runtime returns
`port_response` echoing id, op and port, with boolean `ok`. Success requires
`owner: runtime` after lease acquisition and serial open, or `owner: released`
after serial close and lease release. Release is idempotent for that
provider's port, so an uncertain acquire can be recovered explicitly.
The runtime must reject ports not admitted by lane P's enumeration and
approval policy, release on provider closure, and cancel outstanding
acquisitions before reconnecting the same provider. The plugin does not
open the port or implement a second lease.

Handshake deadlines end at welcome, preserving idle connections. Closing
wakes socket and control waiters; expired/cancelled context cannot reach Tk.
Peer values never enter logs or notices. Open starts are serialized;
shutdown owns and joins Open, provider, transfer and Stop workers. Every
runtime/Stop process belongs to a Windows kill-on-close job or POSIX process
group, including command shims and exited parents. Stdout is drained as bytes
for the child's whole lifetime and decoded as UTF-8 independently of the
Windows locale. Invalid UTF-8 diagnostics produce a fixed warning and draining
continues. An unreadable pipe produces a fixed error and stops the owned child;
diagnostic contents never enter logs. Stop stdout/stderr go to the null device.

## Languages and publishing

Menus and notices follow Thonny's current display language through gettext:
Czech, German, Spanish, French, Hungarian, Italian, Japanese, Korean, Polish,
Brazilian Portuguese, Russian, Turkish, Simplified Chinese and Traditional
Chinese. Unsupported languages use English. The shipped PO and MO files are
checked against the actual UI messages.

The PyPI workflow builds/tests/checks artifacts in a separate job without the
publish environment. Upload uses Twine 6.2.0's Trusted Publishing with OIDC,
`id-token: write` only on that job, and the `pypi` environment. The owner must
register this repository and `.github/workflows/publish-thonny.yml` as a
trusted publisher in PyPI. No stored token or fallback is used. No upload or
hosted workflow was run by this lane.

## Developing

The tests need pytest; they use fake backends/ports and local sockets, never
a real board or model. From the repository root:

```sh
python -B -m pytest -p no:cacheprovider integrations/thonny
python integrations/thonny/scripts/compile_catalogs.py
```

CI runs the Python 3.10/3.14 suite and package checks on its hosted matrix.
Windows fake-process and isolated Thonny smoke receipts are recorded in
`docs/certification/m103-t.md`; real POSIX and installed R/P receipts remain
integration prerequisites.

## Publishing

The first release goes out on a tag of the form `thonny-v<version>` (for
example `thonny-v0.1.0`, matching `version` in `pyproject.toml`). The tag
starts `.github/workflows/publish-thonny.yml`, which builds, checks and
uploads with the `pypi` environment through PyPI Trusted Publishing: the
workflow file name and the environment name are what the PyPI trusted
publisher record must name exactly, so neither may be renamed. The wheel
is what Thonny's Manage plug-ins dialog installs; the sdist carries the
same sources plus the catalogue compiler, never the tests.

Measured on this branch (isolated `python -m build`, `twine check`
PASSED on both files):

- `thonny_muse_spark-0.1.0-py3-none-any.whl`, 56,996 bytes
- `thonny_muse_spark-0.1.0.tar.gz`, 34,124 bytes

The wheel holds the nine `thonnycontrib.muse_spark` modules,
`windows_job.cs`, all 14 locale folders with `muse_spark.mo` and
`muse_spark.po`, and the MIT licence in `.dist-info`; its metadata says
`Requires-Python: >=3.10` and `Requires-Dist: thonny<6,>=4.1.7`. Every
`python -m build` also writes an untracked `src/thonny_muse_spark.egg-info`
directory beside the sources; delete it after building, it is not shipped.
