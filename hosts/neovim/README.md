# muse.nvim — Muse Spark Code (Unofficial)

Use Neovim 0.12 or later and the installed `muse-spark-code-acp` runtime.
Add this directory to `runtimepath` (or install it as a local lazy.nvim
plugin). No runtime, language server or model is downloaded by the shim.

```lua
local muse = require("muse")
muse.setup({ command = { "muse-spark-code-acp" } })
require("codecompanion").setup({
  adapters = { acp = { muse_spark = muse.acp_adapter } },
  interactions = { chat = { adapter = "muse_spark" } },
})
```

`MusePanel` starts `panel --companion` in Neovim's current workspace. The
runtime opens the shared panel. `MusePanel URL` opens a **fresh**,
runtime-issued ACP `/panel` link, preserving its session. The command removes
entries containing that link from Ex history before launch so ShaDa does
not persist the code, including modified/abbreviated commands, Lua calls
and opening failures. Programmatic callers can
use `require("muse").open_companion(url)` without command-line history.
Do not copy a used link, bearer token or API key into configuration. The page
exchanges its fragment once, holds its bearer in memory and authenticates
every request, including its fetch-streamed event channel. The shim does
not exchange codes, send HTTP requests, use cookies or store URLs.

`MuseStop` cancels the active Muse CodeCompanion chat and terminates the companion
owned by this shim. Quitting Neovim also performs cleanup. A second launch
while that companion is alive fails explicitly. Opening a supplied ACP
link does not transfer ownership of its runtime to this shim; cancel that
turn in CodeCompanion or the panel.

On macOS the opener is `open`; on Linux it is `xdg-open`. On Windows supply
an argv opener, for example `{ "C:/Program Files/Mozilla Firefox/firefox.exe" }`.
Browser failures report only `EPANEL_LAUNCH`; raw browser output is discarded.
Stop still reaches the owned companion when CodeCompanion cancellation fails;
a failed termination retains the handle for another Stop.
Arguments and workspace paths are never shell-expanded. Companion/browser
children get credential-free environments; CodeCompanion's inherited
credential variables are overridden with empty values when its adapter
factory runs. Recreate the adapter after changing the editor environment.

From the repository root, the offline test command is:

```sh
nvim --headless -i NONE -u NONE -l hosts/neovim/test/check.lua
```

The tests use editor APIs and test-only CodeCompanion/process doubles, plus
a real sanitized child. They certify launch and cancellation, not the
pending shared controller's F1–F56 end-to-end conformance. That qualification
is recorded in `docs/certification/m104-h.md`.

## LSP and independent workspace Stop

`MuseLsp` starts the native LSP client at the project root. Neovim 0.12's
inline-completion API is negotiated and enabled where present. Ordinary
completion remains available with inline support: use Neovim's LSP omnifunc
in Insert mode (`Ctrl-X Ctrl-O`) for an invoked request. Automatic inline
requests spend nothing under the default Invoke-only policy. Neovim 0.12.5
has no public API to invoke and display a fresh inline request; the proposed
API is drafted in `docs/research/neovim-inline-invoke-api-request.md`.
Set `lsp_args = { "--tab", "--trust-workspace" }`
in `require("muse").setup` to opt into invoked, paid Tab. A native-store key
and editor consent are required before any dispatch. Budget and model flags
are documented in `docs/acp.md`.

ACP and companion launch run through `supervise`. `MuseStop` runs a separate
credential-free `stop` command at the same project root, so it reaches busy
runtimes and the shared LSP broker. Panel/review features require B's absent
controller; the production LSP refuses those routes explicitly.

The real-client offline check builds a fake-only service and runs:

```sh
node -e "require('esbuild').buildSync({entryPoints:['test/unit/helpers/fakeLsp.ts'],outfile:'temp/native-fake-lsp.js',bundle:true,platform:'node',format:'cjs',target:'node22',logLevel:'silent'})"
M104_NODE="$(command -v node)" nvim --headless -u NONE -l hosts/neovim/test/lsp.lua
```
