# Zed shim — Muse Spark Code (Unofficial)

Zed's current supported route is custom-agent registration and a native
task. Its Rust extension API no longer supplies ACP agent registration or
custom commands; ACP extensions were deprecated in Zed 1.5.0 in favor of
the ACP Registry. This package deliberately uses those supported routes.
An upstream request for extension panels/commands belongs to the owner.

Requires Python 3 and an installed `muse-spark-code-acp`. Generate settings
and tasks without changing any user settings:

```sh
python3 hosts/zed/register.py
```

The output has `settings` and `tasks` sections. Merge `settings.agent_servers`
into Zed's settings, and append the task to `.zed/tasks.json` or your user
tasks. Preserve other agents and tasks. Keep this package at the generated
absolute path; regenerate if you move it. `--agent` and `--python` can name
installed executables at paths with spaces. The script installs nothing.

Select **Muse Spark Code (Unofficial)** in Zed's Agent Panel for ACP. Use
the `Muse Spark Code (Unofficial): panel` task through `task::Spawn` to
start an independent shared companion in the workspace. Stop it using
Zed's task terminal cancellation. The task does not save dirty buffers,
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

No Zed GUI qualification, registry publication, WASM extension or
F1–F56 end-to-end conformance is claimed. The LSP broker and Zed Tab
completions endpoint remain separate runtime work; see the lane record.
