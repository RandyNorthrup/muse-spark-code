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
runtime opens the shared panel. `MusePanel http://127.0.0.1:PORT/#k=CODE`
opens a **fresh**, runtime-issued ACP `/panel` link, preserving its session.
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
Arguments and workspace paths are never shell-expanded. Companion/browser
children get credential-free environments; CodeCompanion's inherited
credential variables are overridden with empty values when its adapter
factory runs. Recreate the adapter after changing the editor environment.

From the repository root, the offline test command is:

```sh
nvim --headless -u NONE -l hosts/neovim/test/check.lua
```

The tests use editor APIs and test-only CodeCompanion/process doubles, plus
a real sanitized child. They certify launch and cancellation, not the
pending shared controller's F1–F56 end-to-end conformance. That qualification
is recorded in `docs/certification/m104-h.md`.
