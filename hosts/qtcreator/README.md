# Qt Creator Lua shim — Muse Spark Code (Unofficial)

Copy `musespark/` to a Qt Creator Lua plugin search directory. Enable the
Lua plugin and **Muse Spark Code (Unofficial)** in About Plugins. The plugin
uses the current Id/Name/Version Lua manifest and the documented Action,
Process, Utils, Project and async modules. Actual Qt Creator GUI
qualification remains pending: Qt Creator offers no headless way to drive
a Lua plugin's actions, so the Lua half is unproven in the real editor
(`docs/real-life/unproven.md`); the Python bootstrap below is proven
against the real agent.

Install Python 3 and `muse-spark-code-acp` separately. `config.lua` names
those installed executables. For an npm Windows installation whose `.cmd`
cannot be launched directly, set `agent` to the installed `node.exe` and
`agentScript` to the absolute installed `dist/acp.js` path. Both remain
separate argv entries; this is covered by bootstrap tests, with a native
Windows receipt still pending. No language server or runtime is downloaded.
Open a project: **Tools → Muse Spark Code (Unofficial): panel** starts
`supervise panel --companion` in the startup project's directory, using argv rather
than shell text. **Tools → Muse Spark Code (Unofficial): stop** terminates
the workspace supervisors and owned launcher. A failed stop retains ownership so it can be retried.
Missing Python, missing project, duplicate launch and failed start/stop
produce explicit technical errors.

Qt Creator's built-in ACP client remains the native chat route: register
the installed agent in its ACP settings. For a fresh same-session ACP
`/panel` URL, the shim's `require("init").open_companion(url)` opens the
browser from a coroutine. It accepts only IP-literal loopback fragment
launches. The companion page redeems the code once, keeps its per-window
bearer in memory, and authenticates all requests and fetch-streamed events.
No cookie, HTTP client, stored URL or provider key is introduced here.

The source-checked Lua Process API has no environment override. Its trusted
Python bootstrap therefore runs in isolated mode (`-I`), receives the
editor's initial environment, removes every `*_API_KEY` and the six existing
named credential variables before any child, and execs the runtime/browser.
Stored runtime keys never enter that process. The same user can inspect the
bootstrap's initial OS environment; removal does not zero it. Browser
opening via this helper is macOS/Linux only; Windows needs a native opener
integration and remains unqualified. The explicit Node/script runtime route
is implemented; Windows runtime launch qualification remains pending.
The Lua shim discards process stdout/stderr instead of logging raw paths or
launch codes. The browser bootstrap discards opener output and reports only
`EPANEL_LAUNCH` on failure. It owns native Process objects for each launch and
reserves a runtime before executable lookup yields. Stop cancels pending
lookups and attempts runtime cleanup even when an independent opener fails.

From the repository root, run the bootstrap tests (they start this
tree's real `dist/acp.js`; run `npm run build` first):

```sh
python3 -m unittest discover -s hosts/qtcreator/test -v
```

The former Lua suite doubled Qt Creator's Lua API in Neovim and was
deleted under the no-stand-ins rule. F1–F56 shared-panel qualification
is tracked in `docs/certification/m104-h.md`.

## LSP and independent workspace Stop

In Qt Creator's native generic language-client settings, use the installed
agent with argument `lsp --workspace <project-root>`, selecting the languages
you want. For the isolated Python launch route, the argv is Python, `-I`, the
absolute `launch.py`, `lsp`, then the installed agent (and optional
`--agent-script` Node prefix). Add paid flags to a direct installed-agent LSP
command only when opting into Tab. Inline-completion support is unqualified;
ordinary completion items are the negotiated fallback. No user settings are
changed by this repository. The Lua API alone does not certify this GUI route.

The panel bootstrap now uses `supervise panel`. The Stop action independently
launches `stop` through the sanitized bootstrap before local cleanup. B's
controller remains necessary for panel/review behavior.
