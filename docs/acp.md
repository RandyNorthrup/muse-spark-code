# Muse Spark in other editors (ACP)

> The package's npm landing page is [`muse-spark-code-acp`](https://www.npmjs.com/package/muse-spark-code-acp); this file is the full guide.

`muse-spark-code-acp` runs Muse Spark as an agent for editors that speak
the [Agent Client Protocol](https://agentclientprotocol.com): Zed, the
JetBrains IDEs through AI Assistant, Xcode 27, Qt Creator, Neovim, Emacs,
Sublime Text, Devin Desktop and others. So far it has been run in Zed,
Neovim, Emacs and JupyterLab; the others are untested. The editor shows the chat, the tool
calls, the plan and the permission prompts; the agent runs Muse Code (or
the Meta Model API) the way the VS Code panel does. It is unofficial and not
endorsed by Meta.

Stored turn-checkpoint file Restore/Redo is a VS Code extension feature. The
standalone ACP agent has no checkpoint store in the VS Code profile and does
not share that window admission namespace. Treat its workspace writes as an
independent editor/process when using VS Code checkpoints in the same folder;
the extension's exclusion guarantee does not cover those simultaneous writes.

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

- From npm (0.11.0 and later): `npm install -g muse-spark-code-acp`.

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

## Interactive ACP options

| Argument                               | Effect                                                                                                                  |
| -------------------------------------- | ----------------------------------------------------------------------------------------------------------------------- |
| `--backend museCode\|modelApi`         | Which backend, and so who pays (default `museCode`)                                                                     |
| `--trust-workspace`                    | Load the folder's rules, skills and memory, as Muse Code's own flag does. Without it the folder is treated as untrusted |
| `--muse-binary <path>`                 | The Muse Code CLI to run; by default the agent looks where the VS Code extension looks                                  |
| `--shell-sandbox auto\|muse\|off`      | Muse Code's shell sandbox, as the extension's `museSpark.shellSandbox` setting                                          |
| `--questions-defer-after <seconds>`    | M112: 60 by default; 0 waits indefinitely; 1–9 become 10; maximum 3600. Clients without forms defer immediately.        |
| `--allow-dangerously-skip-permissions` | Offer the Bypass permissions mode                                                                                       |
| `--allow-contributor-models`           | List contributor-tier models, whose content Meta may train on; they are hidden otherwise                                |
| `--web-search`                         | Offer paid web search (Model API backend only); each prompt asks in the editor first, naming the price                  |
| `--image-generation`                   | Offer paid image generation (Model API backend only); each image asks in the editor first, naming the price             |
| `--verbose`                            | Log every detail to stderr (the editor's agent log)                                                                     |

## What the editor sees

- **Modes**: Manual, Edit automatically, Plan, Auto (and Bypass permissions
  with its flag), as in the panel, except that Auto runs without the panel's
  Auto reviewers. A session loaded or resumed runs in the
  mode the editor is told, not the one it last ran in.
  Stored sessions marked imported start in Manual (the agent has no option
  for another initial mode) before mode mapping and history replay; an imported
  Auto or Bypass choice is never restored automatically.
- **Settings**: the model and the reasoning effort. A session loaded or
  resumed runs on the model and effort the editor is shown; one last run
  on a model the agent does not list moves to the default. A session the
  agent cannot set up this way is let go, and the editor's request fails.
- **Commands**: the session's skills, run as `/name arguments`, plus M112's
  `/questions` and `/answer <n> <text>` (reserved ahead of skills).
- **Permission prompts**: the backend's own choices (allow once, allow for
  the session, reject). A prompt the editor cancels, or answers with a
  choice it was not offered, is rejected; nothing runs by default.
- **Questions** the agent asks: a form where the editor has forms,
  otherwise immediate deferral as text, answered with `/answer` (M112).
  Forms have the configurable deadline in [Questions](#questions). An early form
  that comes back with an answer that is not one of the options offered
  (text is taken only where the question has no options), or with more
  or fewer than the question allows (at least one where it sets no
  bound, as in the panel), is declined; an invalid late answer keeps the
  open question available.
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

## Questions

The launcher connects the shared question registry and private durable queue.
See [the integration certification](certification/m112.md): a scripted stdio
client exercised forms on both backends and the deadline withdrawal, open
question and late answer on Muse Code live (2026-10-06). Installed-client
capability checks remain with the release lead.

A client with forms receives `elicitation/create`. The agent owns its clock:
after 60 seconds it defers the backend question, sends cooperative withdrawal
through the SDK's `cancellationSignal` (`$/cancel_request`), and announces
the question number once. A client may still return the form after withdrawal;
a valid answer is then a late answer. An invalid, declined or cancelled late
form leaves the open question intact. An early declined/invalid form still
declines the waiting question. Stop cancels a waiting question; interrupted
or failed turns retain it as open. Closing or replacing a held session
withdraws its forms and ignores their late replies. Stop sends backend
cancellation without waiting for question storage. If deferral fails, the
waiting question is explicitly cancelled so its tool cannot hang behind a
withdrawn form. Question handling loads on the first question or local
question command.

Without forms, the question appears as text and defers immediately. Use
`/questions` to see open questions and their numbers, then `/answer 1 use blue`
to answer one. An answer is free text about the entire question card;
multi-question cards show every question under the same number. These local
commands work during a running prompt and make no model request themselves.
A late answer steers a running prompt. While idle, or when a steer is proven
not taken, it is stored before the next ordinary prompt. Uncertain delivery
is marked and never retried. Answering approves no tool, changes no permission
mode and grants no session rule. A stored answer is announced as queued;
the sent notice follows its admission with the next prompt. The next prompt
bills as usual.

Add `--questions-defer-after` and its seconds value to the editor's configured
agent arguments. The default is 60; 0 disables the interactive deadline;
1–9 are read as 10; values above 3600, negatives, fractions and nonnumeric
values are refused. This does not change immediate deferral without forms,
immediate scheduled/unattended deferral, or `exec`'s immediate decline.
Open questions are bounded to 20 per session by the shared registry and are
kept in owner-only storage, removed with their session and excluded from
logs, exports and report text. A report may include counts only.

Before sending the next prompt, the agent leases its queued answer prefix by
removing that prefix from disk. Cancellation before dispatch restores it.
After a taken or uncertain submission it is retired, so a restart cannot send
an uncertain answer again. A crash between leasing and dispatch can lose the
prefix; the policy favors avoiding a duplicate when admission is unknown.

MCP elicitation forms retain their separate five-minute deadline and cannot
be answered late. Ordinary approvals and paid-use permission prompts retain
their existing behavior and never enter the question clock.

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
The grant lapses in every folder when a Model API agent (`--backend
modelApi`, not `exec`) starts without that feature's flag, so turning the
flag on again asks again. Every paid row names its
price, and the agent log counts each billed use. Subagents, scheduled
prompts, best-of-N, the Auto reviewer and Muse Voice are not offered: the agent has no flag for them
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

## Headless execution and scanner (M80, not yet certified)

The headless commands are integrated and their fake-only tests pass on Linux,
macOS and Windows. They are not a supported-run claim until the live receipt L passes too (the
hosted matrix passes, and LA passed on 2026-10-05):

```text
muse-spark-code-acp exec [options] <prompt>
muse-spark-code-acp exec [options] --prompt-file <path>
muse-spark-code-acp exec [options] -
muse-spark-code-acp scan-secrets <file> [--key-stdin]
```

Exec makes one turn, with Plan by default or acceptEdits; trust/bypass and hosted
search are refused. Muse Code must already be signed in. Local Model API reads
the existing OS store; --key-stdin is a bounded non-TTY private pipe, held in
memory only and cleared in finally, without loading native keyring. CI launcher
feeds exec and the trusted scanner this way; no CI auth set or environment-key
fallback. The interactive options above retain their existing behavior.

Model API needs a hard USD cap and known priced model; request cap counts every
billable HTTP attempt, including retries. Context-window liability rounds upward
to integer micro-USD: contributor $0.108135 minimum ($0.118135 with image flag),
standard $1.409024 ($1.419024 with image flag). Contributor requires explicit
opt-in and training eligibility. Images require Model API, explicit flag,
acceptEdits, budget and per-use admission/tally; no grant store is used.

Outputs are text, one JSON result, or versioned JSONL. Exits: completed 0,
internal 1, usage/input 2 (no result), auth/backend unavailable 3, failed 4,
budget/request refusal or breach 5, timeout 6, fail-on-denial 7, incomplete 8,
accounting unverified 9, SIGINT 130 and SIGTERM 143. Only latest clean verified
completion plus ACP end_turn authorizes Model API success; uncertain receipts
retain full reservation. No raw tool text leaves exec; cut-short prose is
withheld whole. Windows POSIX signal e2e is explicitly skipped. On Windows a
forced stop ends the process with exit 1 and may lose buffered output; a
delivered result keeps its first-stop status and logical exit code.

Scanner is local-only, whole UTF-8 file up to 16 MiB, with a 30-second deadline
including key/stdout. It prints only match count: 0 clean, 10 found, 2 input/error/
timeout/cancelled. On POSIX a repeated signal forces the earliest latched
stop code (130/143 when a signal came first, 6 when timeout came first); an
earlier non-signal stop keeps its own code. Windows forced process exit is
1; a delivered result retains its logical first-stop code. It never prints a
match, path excerpt or secret. It catches
known patterns and the exact key literal, not every unknown secret.

Read [the complete CLI/CI guide](https://github.com/RandyNorthrup/muse-spark-code/blob/main/docs/ci.md)
for all options, limits, conditional billing theorem, Action lifecycle and
workflow templates. Schemas ship as `schemas/exec-result-v1.schema.json`
and `schemas/exec-event-v1.schema.json`; canonical
[result](https://github.com/RandyNorthrup/muse-spark-code/blob/main/docs/schemas/exec-result-v1.schema.json),
[event](https://github.com/RandyNorthrup/muse-spark-code/blob/main/docs/schemas/exec-event-v1.schema.json)
and [receipts](https://github.com/RandyNorthrup/muse-spark-code/blob/main/docs/certification/m80.md)
use absolute links because npm does not resolve relative links. Registry Action
support still requires post-release LR, beyond unsigned candidate acceptance.

## Report a problem (M93)

`muse-spark-code-acp report` prints the same kind of scrubbed problem report
the VS Code extension previews, without starting anything:

```text
muse-spark-code-acp report [--out <file>] [--description <text>] [--no-facts] [--no-events]
```

It starts no backend, signs in nowhere, opens no browser and makes no
network or model call. It reads only the agent's own failure journals and
gathers local facts: the agent and Node versions, the platform, whether the
Muse Code CLI was found and is signed in (from the credential file's
structure only), and whether a Model API key is stored or `META_API_KEY`
was set (yes or no only). The report goes to stdout, or with `--out` it is
written to `<file>` and nothing goes to stdout. `--no-facts` and
`--no-events` leave those sections out. `report` creates no activation
marker and consumes none. Exits: 0 printed or saved, 1 the report could not
be built or written, 2 bad arguments.

Each agent process writes its own journal,
`<data folder>/reports/journal-<process>.jsonl`, through the extension's own
recorder and under the same policy. The data folder is
`%LOCALAPPDATA%\Muse Spark Code` on Windows,
`~/Library/Application Support/Muse Spark Code` on macOS and
`$XDG_DATA_HOME/muse-spark-code` (or `~/.local/share/muse-spark-code`) on
Linux.

- A journal keeps records for 7 days and at most 256 KiB, oldest removed
  first. It is pruned at each new record and each time `report` reads it.
- A record holds only fixed fields: one with an unknown field is rejected,
  and a torn or tampered line is skipped. Records are validated when written
  and again when read.
- Symbolic links, hard links and unexpected files in `reports/` are
  refused.
- A journal that was never written reads as no recent events. When the
  folder cannot be used, the report says "event recording was unavailable".

In ACP mode (`muse-spark-code-acp` serving an editor) the agent records its
own failures there as fixed words (`updateNotSent`, `skillsUnavailable`,
`permissionRequestFailed`, `approvalWithoutDenial`, `questionFailed`), with
no frames, messages, paths, prompts or session ids. It never writes report
text to ACP stdout. While it serves, a marker beside its journal keeps
another process's cleanup away from that journal; outside VS Code there is
no crash offer.

The standalone report says `vscode: none (standalone agent)`, gives the
backend and sandbox as `auto`, and lists no setting names. A credential
store the process cannot read reads as no stored key. Anything typed into
`--description` is capped at 2,000 characters and scrubbed with the rest of
the draft, but like shell history it still passes through the terminal, so
keep secrets out of it.

## Help and reference

Send `/help` in an ACP session for its local command list and the [generated reference](reference.md). Run `muse-spark-code-acp help --all` in a terminal for the complete reference. Help starts no backend and makes no model request.
