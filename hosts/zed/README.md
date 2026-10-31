# Zed shim — Muse Spark Code (Unofficial)

Zed's current supported route is custom-agent registration and a native
task. Its Rust extension API no longer supplies ACP agent registration or
custom commands; ACP extensions were deprecated in Zed 1.5.0 in favor of
the ACP Registry. This package deliberately uses those supported routes.
The [upstream feature-request draft](upstream-request.md) is ready for the
owner to submit; this lane sends no request.

Requires Python 3 and an installed `muse-spark-code-acp`. Generate settings
and tasks without changing any user settings:

```sh
python3 hosts/zed/register.py
```

The output has `settings` and `tasks` sections. Merge `settings.agent_servers`
into Zed's settings, and append the task to `.zed/tasks.json` or your user
tasks. Preserve other agents and tasks. Keep this package at the generated
absolute path; regenerate if you move it. `--agent` and `--python` can name
installed executables at paths with spaces. For Windows npm installations
that need Node instead of the `.cmd` wrapper, use `--agent` for `node.exe`
and `--agent-script` for the installed absolute `dist/acp.js` path. ACP and
panel launch preserve that argv prefix. ACP uses literal argv. Tasks select
`/bin/sh` on macOS/Linux and PowerShell on Windows, with every executable
and argument quoted for that shell. A real `/bin/sh` receipt verifies literal
spaces, quotes, semicolons and command substitutions; Windows PowerShell
and Zed's native task runner remain unqualified. The script installs nothing.

Select **Muse Spark Code (Unofficial)** in Zed's Agent Panel for ACP. Use
the `Muse Spark Code (Unofficial): panel` task through `task::Spawn` to
start an independent shared companion in the workspace. Use the independent Stop task to reach the workspace supervisor. The task does not save dirty buffers,
display its command or permit concurrent copies. Same-session pairing is
the controller-based ACP agent's `/panel` command/link (lane B); a new
companion task does not silently attach to an unrelated existing session.

The page redeems the one-time code in its URL fragment and keeps a unique
bearer in memory. Every request and fetch-streamed event channel uses its
Authorization header. The shim does not use cookies, tokens in URLs,
provider keys in settings or guessed runtime stdout. The trusted bootstrap
receives the editor's initial environment and removes every `*_API_KEY`
and the existing named credential variables before execing the runtime.
That initial OS process environment is still inspectable by the same user;
this is not a memory-zeroization claim. Stored runtime keys never enter it.

The configuration and bootstrap tests use a Zed API contract stub, plus
real process execution with test-only sentinels:

```sh
python3 -m unittest discover -s hosts/zed/test -v
```

No Zed GUI qualification, registry publication, compiled WASM artifact or
F1–F56 end-to-end conformance is claimed. LSP source and its qualification
boundary are recorded below.

## LSP source and independent Stop task

`extension.toml`, `Cargo.toml` and `src/lib.rs` supply a language-server
extension using pinned `zed_extension_api` 0.7.0. The command is the installed
agent's `lsp` route; `lsp.muse_spark.binary` can supply its path and extra
arguments. A Node binary can put the installed `dist/acp.js` path first in
those arguments; the shim preserves that script prefix before `lsp` and
passes the worktree root explicitly. In `languages`, enable `muse_spark` alongside the language's usual
server. Opt into paid Tab with `--tab --trust-workspace` in the extra argv.
The shared runtime owns consent, the OS-store key and daily accounting.

This is an ordinary LSP completion route. Zed's dedicated edit-prediction
provider API does not accept extension providers according to the checked-in
research; native ghost-text qualification is not claimed. Offline compilation
was attempted but the rig has no cached 0.7.0 SDK, and this lane forbids
network downloads. The source needs a reviewed SDK/native receipt before
installation or publication.

The generator now emits a separate concurrent `stop` task, preserving shell
quoting for every argument. ACP and panel tasks launch through `supervise`;
Stop reaches the authenticated workspace control channel independently of a
busy task. B's composed panel controller is still absent. See the updated
upstream request in `docs/research/zed-editor-api-request.md`.
