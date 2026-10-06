# muse-spark.el — Muse Spark Code (Unofficial)

Requires Emacs 29 or later and an installed `muse-spark-code-acp` runtime.
Add this directory to `load-path` and load `muse-spark`. Install agent-shell
and its acp.el dependency separately for the native chat route.

`M-x muse-spark-start` starts agent-shell with the Muse ACP agent. The
configuration uses the actual agent-shell 0.77.4 client-maker interface.
`muse-spark-command` is an argv list, so paths with spaces stay intact.

`M-x muse-spark-panel` starts `panel --companion` in `default-directory`;
the runtime opens its browser. For an existing ACP session, pass its fresh
`/panel` link to `(muse-spark-panel url)`. An Emacs build with xwidgets opens
that same-session page using `xwidget-webkit-browse-url`; other builds use
`browse-url`. No key or URL is saved in customization or a file. The page
redeems the launch fragment once and keeps its per-window bearer in memory,
using an Authorization header on every request and fetch-streamed events.

`M-x muse-spark-stop` cancels the turn when called in this shim's agent-shell buffer,
and terminates the companion owned by this shim. An editor shutdown cleans
it up too. Stopping a supplied `/panel` link's ACP session remains the ACP
client's or shared panel's responsibility. Duplicate companion starts fail
explicitly. A failed launch releases its stderr pipe and exposes only a
technical failure code. Stop isolates an agent-shell interruption failure
from companion termination and retains the child when termination fails,
so a later Stop can retry. Only `EPANEL_STOP` is shown. Raw CLI output is discarded.

The shim removes `*_API_KEY` and the runtime's six named credential variables
from child environments, including reconnects created by the ACP client
factory. It reads no credential store, downloads nothing and changes no
paid settings. The shared runtime and UI remain integration dependencies.

From the repository root:

```sh
emacs --batch -Q -L hosts/emacs -l hosts/emacs/test/muse-spark-test.el -f ert-run-tests-batch-and-exit
```

ERT uses test-only agent-shell/browser doubles and a real companion-process
cleanup check. These tests do not claim the pending shared controller's
F1–F56 conformance; see `docs/certification/m104-h.md`.

## LSP and independent workspace Stop

`M-x muse-spark-lsp` starts Eglot synchronously under a credential-free
environment. `muse-spark-lsp-arguments` supplies optional runtime flags, such
as `("--tab" "--trust-workspace")` for invoked paid Tab. Eglot normally owns
one server per buffer, so choose this route when configuring that project's
completion server. Diagnostics/Fix/Explain await B's controller. Native Emacs
batch qualification is pending on the Mac rig, which has no Emacs binary.

ACP and companion launch use `supervise`; `muse-spark-stop` also starts an
independent `stop` command in the project root and releases its private stderr
pipe on failure. The runtime owns paid consent, accounting and credentials.
