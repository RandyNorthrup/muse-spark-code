# Muse Spark in other editors (ACP)

`muse-spark-code-acp` runs Muse Spark as an agent in any editor that speaks
the [Agent Client Protocol](https://agentclientprotocol.com): Zed, the
JetBrains IDEs through AI Assistant, Xcode 27, Qt Creator, Neovim, Emacs,
Sublime Text, Devin Desktop and others. The editor shows the chat, the tool
calls, the plan and the permission prompts; the agent runs Muse Code (or
the Meta Model API) the way the VS Code panel does. It is unofficial and not
endorsed by Meta.

On the Model API backend, `web_fetch` reads public HTTPS pages using the
same address checks, pinned connections and bounded page-converter worker
as the extension. It is available only in a trusted workspace and follows
the session's network permission mode. The package carries the converter;
it provides no VS Code language service. In this standalone process the
transport is Node's `https` implementation: VS Code proxy/PAC settings do
not apply. Its proxy and certificate behavior follows the installed Node
version and environment, rather than VS Code's network patch.

The configuration below names the command and its arguments. Where each
editor keeps its agent settings is in that editor's documentation, linked
from [the compatibility plan](https://github.com/RandyNorthrup/muse-spark-code/blob/main/docs/ide-compatibility.md#32-ides-and-editors-reached-through-a-shared-acp-agent);
[hosts.md](https://github.com/RandyNorthrup/muse-spark-code/blob/main/docs/ide-compatibility/hosts.md) records which editors have been
tested, at which version, and what was found.

## Install

Node.js 22 or later is required.

- From a GitHub Release, by the package's URL:

  ```sh
  npm install -g https://github.com/RandyNorthrup/muse-spark-code/releases/download/v<version>/muse-spark-code-acp-<version>.tgz
  ```

  or download `muse-spark-code-acp-<version>.tgz` and run
  `npm install -g ./muse-spark-code-acp-<version>.tgz`.

- From npm, once the first release is published there:
  `npm install -g muse-spark-code-acp`.

`muse-spark-code-acp --version` confirms the install.

On Windows, npm installs the command as a `.cmd` launcher, which some
editors cannot start. If the editor reports that it cannot find or start
`muse-spark-code-acp`, give it `node` as the command and the agent's
script as the first argument, before the others:
`node "<npm root -g>\muse-spark-code-acp\dist\acp.js"`, where
`<npm root -g>` is the folder `npm root -g` prints (usually
`%APPDATA%\npm\node_modules`). The same form works on every platform.

## Choose who pays

The agent runs on one backend, chosen when the editor starts it; it never
switches on its own.

| Backend                             | Arguments            | Who pays                     | Needs                                                    |
| ----------------------------------- | -------------------- | ---------------------------- | -------------------------------------------------------- |
| Muse Code (the default)             | (none)               | Your Muse Code subscription  | The Muse Code CLI, signed in                             |
| Meta Model API (bring your own key) | `--backend modelApi` | Your Model API key, per call | A key stored with `muse-spark-code-acp auth set` (below) |

Configure two agents in the editor if you want both.

## Sign in

Editors that run sign-ins in a terminal offer the right one when the agent
asks for it. Elsewhere, run it yourself once:

- **Muse Code**: `muse-spark-code-acp login` runs Muse Code's own sign-in.
  The agent tells whether Muse Code is signed in as the VS Code panel
  does: from the structure of the CLI's credential file (the emptied file
  `muse logout` leaves counts as signed out); `META_API_KEY` in the
  agent's environment counts too, and is handed to Muse Code only: no
  command, hook or program the agent itself runs sees it or any other
  `*_API_KEY` variable. Where only the CLI can say (a macOS
  Keychain sign-in), the agent asks it when the editor checks the sign-in
  again after you sign in (ACP's `authenticate`), and otherwise assumes
  the sign-in holds until a turn says it does not.
- **Model API key**: `muse-spark-code-acp auth set` asks for the key without
  showing it and keeps it in the operating system's credential store:
  Windows Credential Manager, the macOS Keychain, or on Linux the Secret
  Service (GNOME Keyring, KWallet, KeePassXC). `auth status` says whether
  one is stored; `auth clear` removes it.

The key is never read from an environment variable, a settings file or an
argument, and never passed to Muse Code. On Linux without a running,
unlocked Secret Service the Model API backend is unavailable; there is no
plaintext fallback. On Windows, Credential Manager cannot be used from a
session opened over SSH with a key (Windows reports
`ERROR_NO_SUCH_LOGON_SESSION`): run `auth set` from a desktop session, and
expect a Model API agent started in such a session to say the credential
store cannot be used.

## Configure the editor

Every editor needs the same two things: the command,
`muse-spark-code-acp`, and the arguments. The configurations below were
tested with the editor versions they name; check each editor's current
documentation if the format has moved on.

In Zed (tested with 1.20.2), a custom agent goes in `settings.json`; it
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

In Emacs, [agent-shell](https://github.com/xenodium/agent-shell) takes an
agent configuration; this one was tested with agent-shell 0.79.2 and
Emacs 29.3 (add `"--backend" "modelApi"` to the arguments for the other
backend):

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

In Neovim, [CodeCompanion](https://github.com/olimorris/codecompanion.nvim)
takes an ACP adapter; this one was tested with CodeCompanion v19.25.0 and
Neovim 0.11.4:

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

In JupyterLab 4, [Jupyter AI](https://github.com/jupyterlab/jupyter-ai) 3
(`pip install jupyter-ai`; tested with 3.2.0 and JupyterLab 4.6.3) runs
ACP agents as chat personas. Save this as
`.jupyter/personas/muse_spark_persona.py` in the folder JupyterLab serves
(the file name must contain `persona`), with any square SVG beside it as
`muse_spark.svg`, then open a new chat and pick Muse Spark:

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

Jupyter AI offers the agent its notebook tools as an MCP server, which
the agent passes to Muse Code (below).

Other editors take the same command and arguments in their own agent or
ACP settings (JetBrains AI Assistant, Xcode's Intelligence settings, Qt
Creator's ACP Client, sublime-acp, Devin Desktop's custom agents).

## Options

| Argument                               | Effect                                                                                                                  |
| -------------------------------------- | ----------------------------------------------------------------------------------------------------------------------- |
| `--backend museCode\|modelApi`         | Which backend, and so who pays (default `museCode`)                                                                     |
| `--trust-workspace`                    | Load the folder's rules, skills and memory, as Muse Code's own flag does. Without it the folder is treated as untrusted |
| `--muse-binary <path>`                 | The Muse Code CLI to run; by default the agent looks where the VS Code extension looks                                  |
| `--shell-sandbox auto\|muse\|off`      | Muse Code's shell sandbox, as the extension's `museSpark.shellSandbox` setting                                          |
| `--allow-dangerously-skip-permissions` | Offer the Bypass permissions mode                                                                                       |
| `--allow-contributor-models`           | List contributor-tier models, whose content Meta may train on; they are hidden otherwise                                |
| `--web-search`                         | Offer paid web search (Model API backend only); each prompt asks in the editor first, naming the price                  |
| `--image-generation`                   | Offer paid image generation (Model API backend only); each image asks in the editor first, naming the price             |
| `--verbose`                            | Log every detail to stderr (the editor's agent log)                                                                     |

## What the editor sees

- **Modes**: Manual, Edit automatically, Plan, Auto (and Bypass permissions
  with its flag), as in the panel. A session loaded or resumed runs in the
  mode the editor is told, not the one it last ran in.
- **Settings**: the model and the reasoning effort. A session loaded or
  resumed runs on the model and effort the editor is shown; one last run
  on a model the agent does not list moves to the default. A session the
  agent cannot set up this way is let go, and the editor's request fails.
- **Commands**: the session's skills, run as `/name arguments`.
- **Permission prompts**: the backend's own choices (allow once, allow for
  the session, reject). A prompt the editor cancels, or answers with a
  choice it was not offered, is rejected; nothing runs by default.
- **Questions** the agent asks: a form where the editor has forms,
  otherwise the question as text, answered in your next message. A form
  that comes back with an answer that is not one of the options offered
  (text is taken only where the question has no options), or with more
  or fewer than the question allows (at least one where it sets no
  bound, as in the panel), is declined.
- **Sessions**: listed, loaded with their history, resumed and closed.
  Closing a session (or loading it again) ends its running prompt as
  cancelled and stops that turn, and an answer you give it afterwards
  decides nothing.
- **Prompts**: text, files as @mentions, attached excerpts, and PNG, JPEG,
  GIF and WebP images up to 10 MB.
- **MCP servers** the editor offers (Zed's context servers, Jupyter AI's
  notebook tools): passed to Muse Code for the session, over stdio or
  HTTP, and optional, so one that fails to start does not stop the
  session. SSE servers are not taken; the Model API backend runs none.

## Paid features

Web search ($2.50 per 1,000 searches) and image generation ($0.01 per
image) cost money on top of tokens and are billed to your Model API key.
They are off unless the editor starts the agent with `--web-search` or
`--image-generation` (with `--backend modelApi`). Then every use asks
first in the editor's permission prompt, as the VS Code panel's popup
does, naming what is about to be billed and its price: each prompt that
may search the web (Meta runs the searches inside the reply, so the
question comes once per prompt, not per search) and each image. The
answers are **Allow once**, **Allow always in this workspace** and
**Deny**; Deny sends the prompt without web search, or makes no image.
A cancelled prompt, an answer the prompt did not offer, or an editor
that cannot ask counts as Deny.

**Allow always in this workspace** is offered only when the agent runs
with `--trust-workspace`. It is kept for that folder in the agent's data
folder (`paid-uses.json.d` under `%LOCALAPPDATA%\Muse Spark Code\acp`,
`~/Library/Application Support/Muse Spark Code/acp` or
`$XDG_DATA_HOME/muse-spark-code/acp`), holding feature directories, workspace
hashes and random revocation identifiers. Each feature has a current generation;
each workspace grant names that generation. Concurrent processes cannot restore
a revoked grant or overwrite a newer explicit grant. Legacy `paid-uses.json`
maps are ignored, so their next use asks again. Storage that cannot safely
publish a generation keeps the explicit use as Allow once and asks next time.
The grant lapses in every folder when the agent starts without that feature's
flag, so turning the flag on again asks again. Every paid row names its
price, and the agent log counts each billed use. Subagents, scheduled
prompts and Muse Voice are not offered: the agent has no flag for them
(Muse Voice needs the VS Code panel's microphone).

## Networks and proxies

The agent runs outside VS Code, so VS Code's `http.proxy`,
`http.noProxy`, proxy authentication, `http.systemCertificates` and PAC
files do not reach it, and neither does anything the extension's
`museSpark.environmentVariables` sets. Both backends see only the
environment the editor starts the agent with: the editor's own, plus any
`env` in the agent's configuration (Zed's `agent_servers` entry, for
example). Keep proxy credentials out of settings files you share.

**The Model API backend** (the agent's own requests: the conversation, web
search, images) uses Node's built-in `fetch`, which by default **ignores
proxy variables**: with only `HTTPS_PROXY` set it connects to Meta
directly. To send it through a proxy, set `NODE_USE_ENV_PROXY=1` beside the
proxy variables (Node 22.21 or later on Node 22, any Node 24; checked
against a local proxy with Node 22.0.0, 22.20.0, 22.21.0, 22.23.3, 24.0.0,
24.5.0 and 24.20.0). Node then reads:

- `HTTPS_PROXY` (or `https_proxy`) for Meta's HTTPS address, falling back
  to `HTTP_PROXY`; a `user:password@` in the proxy's address is sent to
  the proxy as its credentials (`Proxy-Authorization`);
- `NO_PROXY` for hosts to reach directly;
- not `ALL_PROXY`, and no system proxy settings or PAC file.

`NODE_OPTIONS=--use-env-proxy` does the same from Node 22.21 and 24.5.
Without the switch, or on an older Node, there is no way to route the
agent's own requests through a proxy.

**Public page fetches** use Node's `https.request` instead of `fetch` so
the checked address stays pinned. Its environment-proxy support starts on
Node 22.21 or Node 24.5. Node 24.0–24.4 can proxy Meta calls while page
requests still go directly; the agent warns about that separately at start.
For page requests, `NO_PROXY` matches the pinned IP address, not the
original hostname; hostname rules do not bypass the proxy for a page.
The request's TLS server name and `Host` header still name the original
site. [Node's network documentation](https://nodejs.org/learn/http/enterprise-network-configuration)
records the different transport version floors.

Certificates: Node trusts its own bundled roots. A network that inspects
HTTPS needs its root named in `NODE_EXTRA_CA_CERTS` (a PEM file, read when
the agent starts; checked with Node 22.0.0 to 24.20.0), or
`NODE_OPTIONS=--use-system-ca` to trust the operating system's store
(accepted from Node 22.15; not exercised here, since that needs a root
installed in the store).

**Muse Code** (`muse serve`, started by the agent) inherits the same
environment and reads the proxy variables itself, as it does under VS Code
([the extension's README](https://github.com/RandyNorthrup/muse-spark-code/blob/main/README.md#proxies-and-certificates)):
`HTTPS_PROXY`, `HTTP_PROXY`, `ALL_PROXY` and `NO_PROXY`, with loopback
added to `NO_PROXY` whenever a proxy is set. It trusts the operating
system's certificate store, which `SSL_CERT_FILE` or `SSL_CERT_DIR`
replace entirely, and has its own `endpoint_transport.proxy` setting. It
needs no `NODE_USE_ENV_PROXY`.

The agent says so rather than guessing: when `HTTPS_PROXY` or
`HTTP_PROXY` (either case) is set for the Model API backend and Node's
switch is off, or this Node does not have it, the agent's log says at
start that the requests will go to Meta directly and what to set. A Model
API request that never reaches Meta is reported with Node's own detail and
advice in the agent's terms: the proxy variables and `NODE_USE_ENV_PROXY`,
or `NODE_EXTRA_CA_CERTS` and `--use-system-ca` for a certificate it does
not trust.

## Not yet

- The Model API backend reads and writes files itself, so it does not see
  unsaved changes in the editor; save before asking it to edit a file you
  have open.
- MCP servers on the Model API backend.
