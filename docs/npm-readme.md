<p align="center"><img src="https://raw.githubusercontent.com/RandyNorthrup/muse-spark-code/main/media/readme/banner.png" alt="Muse Spark Code: Meta's Muse Spark as a coding agent in your editor" width="100%"></p>

<p align="center">
  <a href="https://www.npmjs.com/package/muse-spark-code-acp"><img alt="npm version" src="https://img.shields.io/badge/npm-v{version}-3b6cf6"></a>
  <a href="https://www.npmjs.com/package/muse-spark-code-acp"><img alt="npm weekly downloads" src="https://badgen.net/npm/dw/muse-spark-code-acp?color=3b6cf6"></a>
  <a href="https://github.com/RandyNorthrup/muse-spark-code/releases/latest"><img alt="GitHub release" src="https://img.shields.io/badge/GitHub%20release-v{version}-3b6cf6"></a>
  <a href="https://github.com/RandyNorthrup/muse-spark-code/actions/workflows/ci.yml"><img alt="CI" src="https://github.com/RandyNorthrup/muse-spark-code/actions/workflows/ci.yml/badge.svg"></a>
  <a href="https://github.com/RandyNorthrup/muse-spark-code/blob/main/package.json"><img alt="Node 22 or later" src="https://img.shields.io/badge/node-%3E%3D22-2b7de9"></a>
  <a href="https://github.com/RandyNorthrup/muse-spark-code/blob/main/LICENSE"><img alt="MIT license" src="https://img.shields.io/badge/license-MIT-green"></a>
  <img alt="Unofficial — not endorsed by Meta" src="https://img.shields.io/badge/Unofficial-not%20endorsed%20by%20Meta-2b7de9">
</p>

**Muse Spark Code (Unofficial)** puts Meta's Muse Spark model to work as a
coding agent in any editor that speaks the
[Agent Client Protocol](https://agentclientprotocol.com): Zed, the JetBrains
IDEs through AI Assistant, Neovim, Emacs, JupyterLab and others — plus
one-turn headless `exec` runs and a GitHub Action for CI. It runs on your
Muse subscription through the Muse Code CLI, or pay as you go on a Meta
Model API key, and never mixes the two. The same project ships the
[VS Code extension](https://marketplace.visualstudio.com/items?itemName=RandyNorthrup.muse-spark-code)
(also on [Open VSX](https://open-vsx.org/extension/RandyNorthrup/muse-spark-code)).

> Unofficial. Not affiliated with or endorsed by Meta. "Muse Spark" and
> "Muse Code" are Meta trademarks. You bring your own credentials.

## Install

Node.js 22 or later is required.

```sh
npm install -g muse-spark-code-acp
muse-spark-code-acp --version
```

On Windows, npm installs the command as a `.cmd` launcher, which some
editors cannot start. If the editor reports that it cannot find or start
`muse-spark-code-acp`, give it `node` as the command and the agent's
script as the first argument, before the others:
`node "<npm root -g>\muse-spark-code-acp\dist\acp.js"`, where
`<npm root -g>` is the folder `npm root -g` prints (usually
`%APPDATA%\npm\node_modules`). The same form works on every platform.

## Quick start

Every editor needs the same two things: the command,
`muse-spark-code-acp`, and the arguments. Add `"--backend", "modelApi"` to
the arguments to use the Model API backend instead of Muse Code.

**Zed** (tested with 1.20.2): a custom agent goes in `settings.json`; it
then appears under External Agents in the Agent Panel's new-thread menu:

```json
{
  "agent_servers": {
    "Muse Spark": {
      "type": "custom",
      "command": "muse-spark-code-acp",
      "args": [],
      "env": {}
    }
  }
}
```

**JetBrains AI Assistant**: this setup follows JetBrains' documentation and
has not been tested here yet — see
[Configure the editor](https://github.com/RandyNorthrup/muse-spark-code/blob/main/docs/acp.md#configure-the-editor).

**Neovim** with [CodeCompanion](https://github.com/olimorris/codecompanion.nvim)
(tested with CodeCompanion v19.25.0 and Neovim 0.11.4):

```lua
require("codecompanion").setup({
  adapters = {
    acp = {
      muse_spark = function()
        return require("codecompanion.adapters").extend("goose", {
          name = "muse_spark",
          formatted_name = "Muse Spark",
          commands = { default = { "muse-spark-code-acp" } },
        })
      end,
    },
  },
  interactions = { chat = { adapter = "muse_spark" } },
})
```

`:CodeCompanionChat` opens a chat; a permission prompt lists its keys
(Accept, Reject, Cancel) in the chat buffer.

**Emacs** with [agent-shell](https://github.com/xenodium/agent-shell)
(tested with agent-shell 0.79.2 and Emacs 29.3; add `"--backend"
"modelApi"` to the arguments for the other backend):

```elisp
(require 'agent-shell)

(defun muse-spark-agent-config ()
  (agent-shell-make-agent-config
   :identifier 'muse-spark
   :mode-line-name "Muse Spark"
   :buffer-name "Muse Spark"
   :shell-prompt "Muse> "
   :shell-prompt-regexp "Muse> "
   :client-maker (lambda (buffer)
                   (acp-make-client :command "muse-spark-code-acp"
                                    :command-params '()
                                    :context-buffer buffer))))

(defun muse-spark ()
  "Start a Muse Spark shell."
  (interactive)
  (agent-shell-start :config (muse-spark-agent-config)))
```

`M-x muse-spark` opens the shell; a permission prompt takes `y` to allow
once and `C-c C-c` to reject (which also stops the turn).

**JupyterLab 4** with [Jupyter AI](https://github.com/jupyterlab/jupyter-ai) 3
(`pip install jupyter-ai`; tested with 3.2.0 and JupyterLab 4.6.3): save
this as `.jupyter/personas/muse_spark_persona.py` in the folder JupyterLab
serves (the file name must contain `persona`), with any square SVG beside
it as `muse_spark.svg`, then open a new chat and pick Muse Spark:

```python
import os

from jupyter_ai_acp_client.base_acp_persona import BaseAcpPersona
from jupyter_ai_persona_manager import PersonaDefaults


class MuseSparkAcpPersona(BaseAcpPersona):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, executable=["muse-spark-code-acp"], **kwargs)

    @property
    def defaults(self) -> PersonaDefaults:
        return PersonaDefaults(
            name="Muse Spark",
            description="Muse Spark Code (Unofficial) through its ACP agent.",
            avatar_path=os.path.join(os.path.dirname(__file__), "muse_spark.svg"),
            system_prompt="unused",
        )
```

## Headless runs and CI

`exec` makes one turn, with Plan by default or acceptEdits; trust/bypass
and hosted search are refused. Muse Code must already be signed in; exec
never initiates login. A Model API run requires a hard `--max-budget-usd`
cap (a positive ASCII decimal up to $20 with at most six fractional
digits); the minimum reservation at 32,768 output tokens is $0.108135 for
the contributor model ($0.118135 with images) and $1.409024 for standard
($1.419024). These runs are integrated but not yet certified.

```sh
muse-spark-code-acp exec 'Review this workspace.'
muse-spark-code-acp exec --backend modelApi --max-budget-usd 2.00 --ephemeral --output json 'Review this workspace.'
muse-spark-code-acp scan-secrets fix.patch
```

The same-repository GitHub review and fix Action (`action/`, with an
`action/apply` sub-action) runs `exec` behind a bounded trusted launcher:
the key reaches only the run step, only completed runs post or publish,
and a candidate tarball is pinned by digest. Read
[the complete CLI/CI guide](https://github.com/RandyNorthrup/muse-spark-code/blob/main/docs/ci.md)
for all options, exit codes, bounds and workflow templates.

## Backends, sign-in and cost

The agent runs on one backend, chosen when the editor starts it; it never
switches on its own. Configure two agents in the editor if you want both.

| Backend                             | Arguments            | Who pays                     | Needs                                                    |
| ----------------------------------- | -------------------- | ---------------------------- | -------------------------------------------------------- |
| Muse Code (the default)             | (none)               | Your Muse Code subscription  | The Muse Code CLI, signed in                             |
| Meta Model API (bring your own key) | `--backend modelApi` | Your Model API key, per call | A key stored with `muse-spark-code-acp auth set` (below) |

Editors that run sign-ins in a terminal offer the right one when the agent
asks for it. Elsewhere, run it yourself once: `muse-spark-code-acp login`
runs Muse Code's own sign-in, and `muse-spark-code-acp auth set` asks for
the Model API key without showing it and keeps it in the operating
system's credential store (Windows Credential Manager, the macOS Keychain,
or on Linux the Secret Service). `auth status` says whether one is stored;
`auth clear` removes it.

Paid extras (web search at $2.50 per 1,000 searches, image generation at
$0.01 per image) cost money on top of tokens and are billed to your Model
API key. They are off unless the editor starts the agent with
`--web-search` or `--image-generation` (with `--backend modelApi`); then
every use asks first in the editor's permission prompt, naming what is
about to be billed and its price.

## Privacy and security

- A pasted Model API key lives only in the operating system's credential
  store, is never read from an environment variable, a settings file or an
  argument, and is never passed to any child process the agent runs.
- On Linux without a running, unlocked Secret Service a stored Model API
  key is unavailable; there is no plaintext fallback. A headless run with
  `--key-stdin` still works, because it never opens the credential store.
- Headless `--key-stdin` keys stay in memory only and are cleared in
  `finally`; `scan-secrets` prints only a match count, never a match, an
  excerpt or a secret.
- The agent loads a folder's rules, skills and memory only with
  `--trust-workspace`, and the Model API backend does not see unsaved
  changes in the editor — save before asking it to edit a file you have
  open.
- Paid features are off until flagged on, and the subscription never pays
  for one. In an editor every use asks first, naming its price. A headless
  run asks no one, so an image there needs `--image-generation`, the
  `acceptEdits` permission mode and a hard `--max-budget-usd`, and each one
  is reserved against that budget before it is sent.

## Links

- [The full ACP guide](https://github.com/RandyNorthrup/muse-spark-code/blob/main/docs/acp.md)
- [Headless and CI guide](https://github.com/RandyNorthrup/muse-spark-code/blob/main/docs/ci.md)
- [Issues](https://github.com/RandyNorthrup/muse-spark-code/issues)
- [Changelog](https://github.com/RandyNorthrup/muse-spark-code/blob/main/CHANGELOG.md)
- [VS Code extension on the Marketplace](https://marketplace.visualstudio.com/items?itemName=RandyNorthrup.muse-spark-code)
- [VS Code extension on Open VSX](https://open-vsx.org/extension/RandyNorthrup/muse-spark-code)
- [MIT license](https://github.com/RandyNorthrup/muse-spark-code/blob/main/LICENSE)

## Local usage history

`/usage` prints the shared journal summary; `/usage page` supplies the authenticated
loopback companion link. The terminal also accepts `usage`, `usage --json`,
`usage --csv`, `usage open`, `usage serve --stdio` and root `--usage` JSON.
Use `--usage-history=off` when serving ACP to stop new records. The history and
exports stay on this machine; raw calls roll up after 30 days and daily history
defaults to 365 days. Deleting it leaves spend ledgers and grants intact. The
companion uses a one-use fragment code, an in-memory bearer per window and
fetch-streamed events, with no cookies. See the README Usage and cost section
for storage folders and the M102 certification for editor/rig receipts.
