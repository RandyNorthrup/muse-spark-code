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

On the Model API backend, ACP and headless conversations pack long tool
outputs by default for tool-capable models: an output over 8,000 characters
is sent whole twice, then as a stable placeholder. `recall_output` reads exact
original pages, with optional case-sensitive literal `search`. Reopened
conversations keep their sticky placeholders, including after a crash while
Manual approval is pending. Recall continues the ordinary billed model turn;
it makes no separate paid-feature request. The VS Code packing setting does
not apply to this process.

ACP and headless Model API/BYO requests can share a daily spending limit that you set in the agent data folder's `settings.json`: `{"paidDailyBudgetUsd":5}` (USD; none by default), matching the extension's `museSpark.paidDailyBudgetUsd`. With no limit set, nothing is checked, read or written before a request. With one, a request whose estimate would pass what is left of today is not sent and the reason says so; each request's reported cost joins today's total after it ends, in one file per process with no lock, and a request that ended without its usage counts as cost unknown, never as its estimate. Headless also requires `--max-budget-usd`, and BYO attempts use the same usage journal as interactive turns. Image generation still requires its flag and consent (or the headless flag plus hard run budget). Hosted search runs in this runtime only with a verified per-request call bound, because its returned fees have no other dispatch bound.

The spend cap admits a request only when its full reservation fits. Verified exact
counts reserve the exact input; Anthropic reserves its estimate plus 25%, limited
by the UTF-8 byte upper bound; unverified count shapes (including Gemini) reserve
that size bound. Only the last request can exceed the cap when a provider estimate
is too low: its full actual cost is recorded, and another request is refused.
Each retry reserves separately; a sent attempt with no outcome keeps its entire
reservation permanently. Only a provably dead owner’s unsent claim is released.
The v3 ledger imports old history once without modifying it. Simultaneous spending
from an old build is outside the new shared-cap guarantee; upgrade both hosts
before relying on one cap across versions.

The configuration below names the command and its arguments. Where each
editor keeps its agent settings is in that editor's documentation, linked
from [the compatibility plan](https://github.com/RandyNorthrup/muse-spark-code/blob/main/docs/ide-compatibility.md#32-ides-and-editors-reached-through-a-shared-acp-agent);
[hosts.md](https://github.com/RandyNorthrup/muse-spark-code/blob/main/docs/ide-compatibility/hosts.md) records which editors have been
tested, at which version, and what was found.

## Install

Node.js 22 or later is required.

- From npm (0.11.0 and later):

  ```sh
  npm install -g muse-spark-code-acp
  ```

- Or from a GitHub Release, by the package's URL:

  ```sh
  npm install -g https://github.com/RandyNorthrup/muse-spark-code/releases/download/v<version>/muse-spark-code-acp-<version>.tgz
  ```

  or download `muse-spark-code-acp-<version>.tgz` and run
  `npm install -g ./muse-spark-code-acp-<version>.tgz`.

The project ships from four places: the agent from npm and GitHub Releases,
and the VS Code extension from the
[VS Code Marketplace](https://marketplace.visualstudio.com/items?itemName=RandyNorthrup.muse-spark-code),
[Open VSX](https://open-vsx.org/extension/RandyNorthrup/muse-spark-code) and
[GitHub Releases](https://github.com/RandyNorthrup/muse-spark-code/releases).

`muse-spark-code-acp --version` confirms the install.

On Windows, npm installs the command as a `.cmd` launcher, which some
editors cannot start. If the editor reports that it cannot find or start
`muse-spark-code-acp`, give it `node` as the command and the agent's
script as the first argument, before the others:
`node "<npm root -g>\muse-spark-code-acp\dist\acp.js"`, where
`<npm root -g>` is the folder `npm root -g` prints (usually
`%APPDATA%\npm\node_modules`). The same form works on every platform.

## Deterministic legal scan (M97)

From the workspace you want to inspect, run:

```sh
muse-spark-code-acp exec legal-scan --json
muse-spark-code-acp legal --format text
muse-spark-code-acp legal --format json --out legal-report.json
```

These invocations use the packaged local scanner. No model, backend, sign-in,
credential store, package manager, build or ACP connection is started. The
scan is free and offline by default. `--out` writes only the report destination
you explicitly name; ordinary scans do not change the workspace. Without
`--out`, JSON stdout is one `{ disclaimer, result, registry }` envelope, with
no ACP frames; `--out` leaves stdout empty. Status words go to stderr. Keep reports private when they contain package names, paths or source
URLs. Known secret formats and email values are scrubbed; universal PII
recognition is not promised.

| Exit | Meaning                                                                         |
| ---- | ------------------------------------------------------------------------------- |
| 0    | Complete coverage, with no blocker; should-fix and advice findings are allowed. |
| 1    | Complete coverage, with a blocker.                                              |
| 2    | Incomplete coverage, invalid input, interruption or operational failure.        |

A missing lock, unresolved license, binary file, excluded link or read bound
can make coverage incomplete even when there are no blockers. Findings,
rule/data versions, distribution assumptions, exclusions and incomplete checks
are in `result`. No automatic fix is available. The reserved
`exec legal-scan --json` route is admitted before prompt, credential and paid
argument parsing. The older `legal --format json` invocation remains an alias.
Both refuse prompt text and model/credential flags.

The current scanner also lists human review, full license-text matching and
artifact freshness as incomplete checks on every real run. Even a fixture
with no findings therefore returns exit 2; the complete exit-0/1 branches are
tested with injected reports and are not yet real-scanner CI receipts.

Registry enrichment uses npm/PyPI HTTPS metadata, sends only package names and
versions, refuses redirects and never reads private registry configuration.
Headless commands require `--registry`; their default stays offline. Scanner
prose, counts and the disclaimer follow the installed supported language.

Within an ACP editor, `/legal` directly invokes the shared scanner on either
backend without sending a model turn. Before the first registry lookup in
that workspace during this agent process, the editor's permission prompt names
every registry and exactly what is sent. Declining leaves local unknowns in the
report; `/legal --offline` skips both notice and lookup. The one-time notice
resets when the agent process ends. JetBrains, Zed, Neovim, Emacs and other ACP
clients receive ordinary text report updates; Visual Studio, Eclipse, Xcode,
Sublime and companion adapters can invoke the same keyless reserved runtime
command. The optional panel paid explanation uses a portable core executor;
this ACP command itself stays free. Native editor UI adapters retain their
existing compatibility milestones. **Not legal advice; for distribution
decisions consult a lawyer.**

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
  `muse logout` leaves counts as signed out). The standalone agent strips
  credential variables, including `META_API_KEY`, and never restores them
  to a child. Muse Code receives an explicit allowlist of process, profile,
  configuration-home, proxy and certificate-path variables. Where only the CLI can say (a macOS
  Keychain sign-in), the agent asks it when the editor checks the sign-in
  again after you sign in (ACP's `authenticate`), and otherwise assumes
  the sign-in holds until a turn says it does not.
- **Model API Key**: `muse-spark-code-acp auth set` asks for the key without
  showing it and keeps it in the operating system's credential store:
  Windows Credential Manager, the macOS Keychain, or on Linux the Secret
  Service (GNOME Keyring, KWallet, KeePassXC). `auth status` says whether
  one is stored; `auth clear` removes it.

`--help` on any deep subcommand prints that command’s terminal usage, including
`developer status --help`, `playbook status --help` and
`report usage --help`. `help reference` loads the full catalogue.

ACP effort options and `exec --effort` use the selected model’s capability record; unsupported choices list the allowed values. Opus 5.5’s captured record includes `xhigh`.

**ChatGPT subscription sign-in (M95b preview):** the agent advertises
`providers add chatgpt` as a terminal sign-in method. Maintenance remains available
through `providers remove chatgpt` and `providers status chatgpt` in the terminal. Editors without terminal authentication
show the full commands to run manually. These use the same runtime adapter,
OS credential store and process lock in JetBrains, Visual Studio, Eclipse,
Zed, Xcode, Neovim, Emacs, Sublime and companion clients. Add prints the
Plus/Pro eligibility and credit notice before the browser URL and writes
only eligible account catalogue models to the user-level providers file.
Status makes no network request; Remove attempts revocation and clears the
local grant and configuration. ACP authentication verifies the local action
independently of Meta sign-in. An unavailable store gives a fixed message to
sign in from an interactive desktop session with the store unlocked; Linux
also requires Secret Service. For ChatGPT inference, configure the agent with its existing `--backend model-api`
argument; it uses the account catalogue and the same subscription dispatch as
the extension. Fake-server inference now passes; installed-editor and live
success certification remain open. Copilot requires VS Code and is unavailable
in the standalone agent.

Configured API-key and local providers use the same captured codecs and
pinned request factory as VS Code, reading the user-level `providers.json`
and origin-bound records from this agent's OS credential store. Mistral's
captured plan-key preset is marked **plan**, links its limits, and records
request/token tallies outside USD caps. No Meta key is needed for its
inference. General `providers list|add|test|remove` commands and
`auth set|status|clear --provider <id>` use the same origin-bound records.
Free probes use the shared request transport. `exec --provider` dispatches through
that same configured client, reserving each request's conservative input and
capped output at its model's price before sending, then settling its usage.
Unknown prices refuse without sending. With no `--model`, exec and ACP use the configured `defaultModel`;
a missing or unavailable default refuses and lists the configured models.
Ephemeral exec omits durable usage history and records
`usageHistory: "omitted_ephemeral"`; ordinary runs retain usage history.
Command `--help` prints only its own usage; `help reference` prints the catalogue.
Unsent daily and run claims are refunded.
Each request is capped at the model's own output limit. For a configured Anthropic key:

```sh
muse-spark-code-acp exec --backend modelApi --provider anthropic --model anthropic/claude-opus-5-5 --max-budget-usd 0.10 --max-requests 1 --ephemeral --output json "Reply with the single word: ready"
```

The npm package includes the shared catalogue and lazy provider bundles.
Installed-editor and live provider certification remain open.

Output caps below the selected provider's known minimum are refused when saved
and before sending, including older stored values. The same translated message
names the minimum; Meta requires 16 tokens. Custom provider entries declare a
minimum with `modelCapabilities.<model>.output.minTokens`; their capability cap
and custom output limit must meet it. ACP config options and CLI/exec flags
expose `exec --max-output-tokens <n>` (at least 1; the selected provider's own minimum applies); ACP retains the model policy cap.

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
  `/questions` and `/answer <n> <text>` (reserved ahead of skills), and
  M116's `/playbook <status|record|settings ...>`, answered locally with no
  model turn.
  Scheduled prompt delivery remains unavailable pending shared certification.
  M117's `/estimate <goal> [--by <date>] [--fleet current|minimum|optimum]`
  when the estimator binding is present; it runs the same engine as the
  panel with no model call.
  M108's `/accounts <list|current|thresholds [id]>` on the Model API
  backend, answered locally with no model turn; `/accounts use <id>` is
  refused and names the account the session keeps.
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

M105 media commands are parsed between turns: `/attach <path>` confines an
approved local source; `/record` requires an interactive recorder and private
preview before Attach. Embedded PDF/image blobs keep their established routes;
video/audio blobs and media links require the selected-model media port.
Ordinary source links remain mentions and URLs remain links. A missing media
binding refuses before dispatch; it never claims that bytes were delivered.
Production capability, Files ownership/storage billing, paid transcription and
recording bindings remain pending. Fakes prove the portable adapter contract,
not installed editor or provider availability. Headless `/attach` and `/record`
are usage errors; use repeated `exec --attach` flags after the real media
binding exists. See [M105 certification](certification/m105.md).

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

Before sending the next ordinary prompt, the agent takes a non-destructive
lease on its durable queued-answer prefix. A `started` submission commits
when the turn starts with the model; a `queued` submission holds the lease
until its own turn starts. Model API waits for actual request dispatch after
submit hooks and request admission, because its start ack precedes those
checks. Withdrawal, unqueue, Stop, session release, process exit and refused
or failed submission retain answers without a sent announcement. Only a
successful commit announces that the answer was sent. Failed commit writes
retain answers, warn that they may repeat, and keep an active turn busy and
stoppable. A restart before commit retains the prefix; a crash after dispatch
but before persistence can repeat it on the next prompt.

MCP elicitation forms retain their separate five-minute deadline and cannot
be answered late. Ordinary approvals and paid-use permission prompts retain
their existing behavior and never enter the question clock.

## Playbook

`/playbook status`, `/playbook record` and `/playbook settings ...` read the
orchestrator playbook's journal-backed settings and evidence for the
session's workspace, with no model turn. The same surface answers the
standalone `playbook` command. Rule changes need a reason and record the
owner; turning a rule off and naming the fallback reviewer for
classifier-blocked reviews need a real user decision, and residuals stay
open per milestone until a lead or owner accepts them. Record views show
unbound legacy acceptances and why they cover no residual. Local commands
leave queued late answers untouched; only a prompt that starts with the model
removes its leased prefix. A restart before that commit retains the
answers, and failed sends release without writing. Panel enforcement
(leases, outcome receipts, dispatch gating) is not installed here; see
[the milestone certification](certification/m116.md) for what is bound and
what waits for M96's planner.

## Several accounts per provider (M108)

On the Model API backend `/accounts list`, `/accounts current` and
`/accounts thresholds [id]` read local metadata without a model turn, and the
`account` session option shows the same accounts. The Muse Code backend runs
on its subscription and has neither. Changing the session's account
(`/accounts use <id>`, or another choice in the picker) is still refused: the
refusal names the account the session keeps, and the agent never reports a
swap while retaining another account's key. A session starts without accounts
when their metadata cannot be read.

The terminal's `providers accounts` commands manage metadata, ordering,
thresholds and stored API keys. Keys are read only from standard input,
never an argument or file.

## Paid features

Web search ($2.50 per 1,000 searches) and image generation ($0.01 per
image) cost money on top of tokens and are billed to your Model API key.
They are off unless the editor starts the agent with `--web-search` or
`--image-generation` (with `--backend modelApi`). Then every use asks
first in the editor's permission prompt, as the VS Code panel's popup
does, naming what is about to be billed and its price: each prompt that
may search the web (Meta runs the searches inside the reply, so the
question comes once per prompt, not per search) and each image. The
answers are **Allow Once**, **Allow Always in This Workspace** and
**Deny**; Deny sends the prompt without web search, or makes no image.
A cancelled prompt, an answer the prompt did not offer, or an editor
that cannot ask counts as Deny.

**Allow Always in This Workspace** is offered only when the agent runs
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
price, and the agent log counts each billed use. Subagents,
best-of-N, the Auto reviewer and Muse Voice are not offered: the agent has no flag for them
(Muse Voice needs the VS Code panel's microphone).

Automatic scheduled prompt delivery remains disabled in VS Code, ACP and the
terminal pending shared certification. The candidate engine uses standing grants,
session-owned output and durable records. Closing a runtime settles only its own
in-flight fires; unhanded admissions remain pending for the next owner. Confirmed
queue withdrawals release their held amount; genuinely unknown outcomes retain
liability and never replay.

The candidate Model API policy requires schedule-specific consent naming model
rates, cadence and both daily caps. Allow once covers one fire; Allow always covers
that schedule. Workspace grants do not authorize scheduled spending. Changes to
payer, model, key, tariff or shared budget require renewal. The running runtime
neither asks this candidate question nor reserves its caps while delivery is
uncertified. Headless exec cannot create or host schedules.

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

**Muse Code** (`muse serve`, started by the agent) receives the allowlisted
proxy variables and reads them itself, as it does under VS Code
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

The headless commands are integrated. They are not a supported-run claim until
the live receipt L passes too (LA passed on 2026-10-05):

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
to integer micro-USD using this request's conservative input estimate plus its
resolved output cap (1024 by default), including cache-write premiums. The refusal
shows the arithmetic. Contributor requires explicit
opt-in and training eligibility. Images require Model API, explicit flag,
acceptEdits, budget and per-use admission/tally; no grant store is used.

Outputs are text, one JSON result, or versioned JSONL. Exits: completed 0,
internal 1, usage/input 2 (no result), auth/backend unavailable 3, failed 4,
budget/request refusal or breach 5, timeout 6, fail-on-denial 7, incomplete 8,
accounting unverified 9, SIGINT 130 and SIGTERM 143. Only latest clean verified
completion plus ACP end_turn authorizes Model API success; uncertain receipts
retain full reservation. No raw tool text leaves exec. Stopped runs return the
redacted partial answer with `finalMessageComplete: false` and their non-success
exit and accounting. JSON mode prints request progress on stderr; stdout remains
one JSON result. Structured output is withheld until it validates. Windows POSIX signal e2e is explicitly skipped. On Windows a
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
workflow templates. Schemas ship as `schemas/exec-result-v2.schema.json`
and `schemas/exec-event-v2.schema.json`; canonical
[result](https://github.com/RandyNorthrup/muse-spark-code/blob/main/docs/schemas/exec-result-v2.schema.json),
[event](https://github.com/RandyNorthrup/muse-spark-code/blob/main/docs/schemas/exec-event-v2.schema.json)
and [receipts](https://github.com/RandyNorthrup/muse-spark-code/blob/main/docs/certification/m80.md)
use absolute links because npm does not resolve relative links. Version 2 is the
canonical contract: USD amounts are exact decimal strings. The historical v1
numeric-money schemas and reader are legacy compatibility only; current output
and Action validation require v2. Registry Action
support still requires post-release LR, beyond unsigned candidate acceptance.

ACP advertises `/compact` alongside skills. An exact text-only `/compact`
prompt calls the backend's shared compaction core and waits for its updates
before returning. Cancellation stops the compaction; another prompt is refused
while it runs. The headless runtime uses this same ACP dispatch and its existing
request/budget ledger. On an empty headless session, `/compact` is a no-op and
sends no model request. Its exec result retains the response-proof contract:
`incomplete` (exit 8), null terminal and `no_compactable_history`, rather than
claiming a completed model response. Attachments or additional arguments remain ordinary
prompts, rather than being silently discarded as command input.

## Local usage history

Text summaries disclose that they are read-only and link interactive work to
the companion. The same companion page serves JetBrains, Eclipse, Visual Studio,
Neovim, Emacs, Sublime, Qt Creator, Zed and Xcode. Its disabled editor settings,
folder and Models-panel actions are explained on the page; native stdio adapters
can supply those actions explicitly. Browser downloads have a visible 8-MiB
encoded bound and return an explicit error above it, leaving refresh available.
Use a smaller range or the terminal output path for larger exports.

`/usage` prints the shared journal summary; `/usage page` supplies the authenticated
loopback companion link. Summary rendering and journal aggregation load on the
first usage action; headless execution loads on the first `exec`.
The terminal also accepts `usage`, `usage --json`,
`usage --csv`, `usage open`, `usage serve --stdio` and root `--usage` JSON.
Use `--usage-history=off` when serving ACP to stop new records. The history and
exports stay on this machine; raw calls roll up after 30 days and daily history
defaults to 365 days. Deleting it leaves spend ledgers and grants intact. The
companion uses a one-use fragment code, an in-memory bearer per window and
fetch-streamed events, with no cookies. See the README Usage and cost section
for storage folders and the M102 certification for editor/rig receipts.

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

## Local prompts and sharing

`/help` lists the sharing catalog. ACP reserves `/prompt save|list|use|share`
and `/share chat` as local commands: they never become skills or model turns.
Save preserves the text after the unquoted `--` separator, including CRLF
and trailing spaces. Personal prompts use the same agent data folder as the
extension and appear in every workspace. Workspace prompts stay in
`.muse/prompts/`. Use returns prepared text when no composer bridge exists;
variable/untrusted review without that bridge refuses explicitly.

Examples of the standalone installed command:

```sh
muse-spark-code-acp --help
printf 'Review this code without changing it.\n' | muse-spark-code-acp prompts save --title Review --scope user
muse-spark-code-acp prompts list
muse-spark-code-acp prompts use PROMPT_ID --scope user --cwd EMPTY_WORKSPACE
muse-spark-code-acp prompts share PROMPT_ID --format md --destination save --out review.md
```

Replace `PROMPT_ID` and `EMPTY_WORKSPACE` with the saved id and a workspace
folder. Save/list/use load no backend or key. Use produces prepared text,
without sending. In an interactive terminal, untrusted prompts and variables
are reviewed before inputs are expanded and again before use.

Chat sharing uses `muse-spark-code-acp share chat SESSION_ID --mode
conversation --format md`; `full` includes portable activity. Markdown, HTML
and JSON share the same scrub. Copy/save/open are local destinations;
`--destination save` requires `--out` within the workspace; `open` creates a
private local HTML file within that workspace. Standalone chat reads the Muse Code
backend; ACP reads its selected backend. A confidential
workspace refuses; the standalone policy reads `.vscode/settings.json`, and
malformed or unreadable policy refuses. Settings with JSON comments currently
refuse rather than guessing. Full mode never disables privacy.

A noninteractive share prints exact scrubbed content and a JSON cancelled
preview, with exit 7. Review it, then repeat the identical command with an
explicit `--destination`, the same `--exported-at`, `--out`, and
`--confirm PREVIEW_ID`. The digest binds cwd, path/root, options, time and
bytes. Any change needs a new preview; there is no blanket `--yes`. Interactive
sharing asks for a final confirmation. No file/clipboard/browser operation
occurs during preview. Private atomic writes recheck live policy and abort. Sharing also scrubs the
agent's already-known credential values; active Model API ACP sessions refresh
their stored key for preview and release. A newly sensitive document refuses
release and needs a new preview.

ACP currently returns exact previews through its existing text response and
cancels release: it has no final sharing button or composer insertion on this
base. These wait for M104's validated host bridge, alongside native menus and
the companion page. The TUI waits for M110a0 lane T. See the
[M118 record](certification/m118.md) for exact actions and editor rows. Gist
publishing, hosted links, team destinations and email remain phase 2/3.

## Help and reference

Send `/help` in an ACP session for its local command list and the [generated reference](reference.md). Run `muse-spark-code-acp help reference` in a terminal for the complete reference. Help starts no backend and makes no model request.

## Resource status and resume

M107's candidate package carries the same lazy governor as the extension.
It ships the universal Darwin helper and both Linux helper architectures;
Windows helpers compile from the included sources on first use.
It uses portable machine settings, never a workspace setting or credential.
The runtime data folder's `resources.json` is a JSON object whose keys are the
full `museSpark.resource…` setting names in the [README table](../README.md#keeping-your-machine-responsive).
A missing file uses defaults. Malformed, oversized or inaccessible settings
fail explicitly. Native editors can inject `ResourceMachineStore` for their
own machine store; they must not substitute project configuration.

```sh
muse-spark-code-acp resources status --json
muse-spark-code-acp resources resume --json
```

Text output omits `--json`. Status samples this new command process; it cannot
observe a separately running editor session's queue. Resume writes
`resource-resume.json` with a fifteen-minute deadline. Running runtime hosts
apply it on refresh without extending that deadline; explicit OFF stays off.
Neither command signs in or makes a model call.

On macOS with libuv older than 1.52 (including Node 22), memory headroom and
memory use report unknown: that runtime counts only free pages, which can
falsely pause session startup. Newer libuv versions include reclaimable pages.

The shared session adapter registers `/resources`, `/resources resume` and
`/usage resources`, delivers notices for affected work and validates deferred
tool `_meta`. It needs the injected runtime resource port. `/usage resources`,
`resources history` and `usage resources` print the machine's resource journal,
the same summary as the usage page's Resources section (`--json`: the
validated aggregate). The agent records its own governor's minute readings and
events there while usage history is on; one-shot commands only read. An
unreadable journal is an explicit error, never empty history. Zed, Xcode,
Neovim, Emacs, Sublime and native editor plugins
have equivalent routes; see the [resource matrix](ide-compatibility/resources.md).
These component receipts do not certify installed-editor resource behavior.

Stop and permission/paid prompts remain responsive at pause. Unknown readings
are neither a fabricated zero nor evidence of recovery. No resource action
changes model capabilities, paid consent or the shared budget. Runtime spawn,
native control, journal and relocation bindings remain named in
[M107's integration record](certification/m107.md).

## Structured headless answers

`exec --output-schema <file>` reads a bounded JSON Schema file through an open
file descriptor, verifies its identity and confines its real path to the
workspace. `--output-schema-outside` explicitly permits an external path.
The strict subset supports bounded local `$defs`/`$ref` references. It rejects
external references, reference-only cycles and unsupported constraints such as
regular expressions. Objects are closed and require every declared property;
arrays declare their item type. Recursive object definitions are permitted.
Both schemas and answers have byte, depth, node and validation work limits. Its closed schema and digest are fixed before session dispatch;
a changed model, active session or repeated configuration is refused.

The captured `muse-spark-1.3-contributor` record selects provider strict JSON
Schema. An unknown model uses the explicitly announced local validator with
the schema appended outside the reusable prefix. The runtime does not invent
a forced-tool codec. This is a local wiring receipt, not release qualification
for providers whose transports/capability records are absent from this base.

Successful version-2 results add `output.value` and `output.validation`
(`provider` or `local`), paired with `ledger.outputSchemaSha256`. Event and result
readers validate the same canonical contract; schema mismatch or validation
budget exhaustion exits 10, retaining incurred spend and the schema digest.
No repair call runs for the final answer. Partial invalid JSON is withheld,
secret scanning still precedes output, and calls without these flags retain
the ordinary request and result bytes. The schema body is not stored in the
ledger. The attached schema does not change headless paid-feature opt-ins,
consent exclusions or the conditional budget theorem above.

The portable core shares strict declarations, safe parallel reads, bounded
retry/idle waits, fresh repeat witnesses and output continuation with the
extension. Provider-specific evidence is injected at the backend factory;
unknown capabilities stay off. Native Muse Code effort, deletion and feedback
remain unavailable until their captured feature ports are supplied. These
limits apply equally to every ACP editor and to headless execution.

## Deterministic reports (M113)

`muse-spark-code-acp report project` collects locally through the same engine
as the editor. `report quality`, `report milestone M113`, `report release
latest` and `report changes` select other local reports. `report history`
lists verified, workspace-scoped saved entries. Bare `report`, and `report
problem`, retain M93's problem report.

The report command accepts `--format md|html|json|text`, `--out <file>`,
`--as-of <ISO>`, `--lang <locale>`, `--network`, `--from <file.json>`,
`--diff previous|<file.json>`, `--full`, `--save`, `--strict` and
`--fail-on <conditions>`. `--from` verifies and renders the saved data without
collecting again. A fixed observation time stabilizes the canonical report;
comparison uses semantic rows. `--save` stores the report outside the workspace.
ACP exposes `/report <kind>` in its available commands and replies in Markdown
through the same portable report methods, without sending the command to a model.

Network collection requires `--network`; `gh` owns terminal GitHub authentication.
No Model API key is needed or read. The [README report guide](../README.md#report) describes the kinds and settings.

Exit codes are 0 for a generated/rendered report, 1 for a collection or output
failure, 2 for invalid arguments or unsupported format, 3 for an unknown exact
scope (with nearest ids), and 4 when a requested `--fail-on` condition holds.
Conditions are `unavailable`, `drift`, `blocked`, `channelLag` and `ciFailing`.
History-save revocation or cancellation fails explicitly. Equal observation
times preserve the newest saved sequence when selecting the previous report.

Initial HTTP validation, sign-in, permission and quota refusals before any output
settle at zero. Interrupted processing (including HTTP 408/499), server errors
and stream loss keep unresolved liability separately from money spent. Final
provider usage settles even when the response is incomplete. Stopping a stream
without final usage cannot prove a smaller bill: a provider can charge unseen
generated tokens after disconnect. The retained amount is a possible charge,
never a confirmed spend. `--max-output-tokens` lowers the actual request cap;
startup no longer prices the model's full context window before building it.
