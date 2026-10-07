# Editors: route and status

Every editor Muse Spark Code aims at (PLAN.md D60, D62), the route it takes,
and how far it has got. **Status** moves Planned → Prototype → Preview →
Supported, and only on recorded evidence: an install is the first step,
not the claim. **Route**: _VSIX_ (the VS Code extension as it is), _ACP_
(the `muse-spark-code-acp` agent in the editor's own chat), _Native_ (a
plugin that embeds the Muse panel), _External_ (a terminal or adjacent
window with a limited link to the editor).

Where it can be tested: this project's cloud container reaches npm, PyPI,
Maven Central, Gradle, NuGet, Ubuntu's archive and download.eclipse.org,
and not JetBrains, Microsoft's VS Code downloads, Open VSX, Zed's site or
neovim.io (2026-09-26). An editor the container cannot install is
qualified in CI or on the owner's machines.

The ACP agent itself is built (M63a) and certified against the ACP SDK's
own client, over stdio and in process, with the fake backends
(`docs/certification/m63.md`). Zed, Emacs with agent-shell, Neovim with
CodeCompanion and JupyterLab with Jupyter AI have run it; every other ACP
row stays Planned until its editor has.

CI keeps these rows honest (`test/hosts/`): the Hosts workflow runs
VSCodium and code-server (the 1.99 floor and the latest), Eclipse Theia,
JupyterLab, Emacs and Neovim on every pull request that touches the
product and every Monday; the Forks workflow runs the latest Cursor,
Devin Desktop, Kiro and Positron every Monday. Zed and the editors that
need macOS, Windows or a JetBrains download are checked by hand.

VSCodium's integration runner activates the development extension from this
checkout. Fork runners separately verify VSIX installation and listing, then
run that development-extension integration suite. These are distinct proofs;
code-server and Theia's packaged browser checks keep their recorded scope.

M114's [design rows](m114-design.md) record the shared theme/font contract,
S's six-theme panel evidence and the named C/N/D bindings for native,
companion, node and desktop surfaces. Existing support statuses below do not
change merely because their shared panel styles are polished.

## The most used

| Editor                                             | Route                                         | Milestone | Status    | Evidence and notes                                                                                                                                                                                                                                                |
| -------------------------------------------------- | --------------------------------------------- | --------- | --------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| VS Code (desktop, Remote, WSL)                     | VSIX                                          | —         | Supported | The reference client, on the Marketplace since 0.1.0                                                                                                                                                                                                              |
| Visual Studio (Windows)                            | Native (VSSDK, WebView2)                      | M64       | Planned   | Needs Windows to build and test                                                                                                                                                                                                                                   |
| IntelliJ IDEA, PyCharm, WebStorm, GoLand, PhpStorm | ACP (AI Assistant), then Native (JCEF)        | M63, M64  | Planned   | JetBrains downloads are blocked in the container                                                                                                                                                                                                                  |
| CLion, RustRover, RubyMine, DataGrip               | ACP (AI Assistant), then Native (JCEF)        | M63, M64  | Planned   | As above                                                                                                                                                                                                                                                          |
| Rider                                              | ACP (AI Assistant), then Native (JCEF)        | M63, M64  | Planned   | Deeper C# features would need its ReSharper backend                                                                                                                                                                                                               |
| Android Studio                                     | Native (the IntelliJ plugin, built for it)    | M64       | Planned   | ACP through AI Assistant not established there                                                                                                                                                                                                                    |
| Cursor                                             | VSIX (Open VSX)                               | M62       | Preview   | 2026-09-26, `forks.yml`: Cursor 3.22.7 (VS Code 1.128.0, Linux AppImage) installs the `.vsix` with its CLI and passes the integration tests (9); weekly on the latest                                                                                             |
| Windsurf / Devin Desktop                           | ACP (documented custom agents), VSIX to check | M62, M63  | Preview   | 2026-09-26, `forks.yml`: Devin Desktop 3.10.35 (VS Code 1.126.0, Linux) installs the `.vsix` and passes the integration tests (9); weekly on the latest. The ACP route is plan-dependent there and untried                                                        |
| Vim                                                | External (terminal), then a plugin            | M66       | Planned   |                                                                                                                                                                                                                                                                   |
| Neovim                                             | ACP (CodeCompanion first)                     | M63       | Preview   | See CodeCompanion under the ACP agent below; in CI (`hosts.yml`)                                                                                                                                                                                                  |
| Jupyter (JupyterLab 4, Notebook 7)                 | ACP (Jupyter AI 3), native later              | M63, M65  | Preview   | 2026-09-26: JupyterLab 4.6.3 with Jupyter AI 3.2.0 runs the agent as a chat persona: model, mode and effort pickers, a reply, a command allowed and one rejected (fake CLI). Its notebook tools (an HTTP MCP server) reach Muse Code through the agent since M63c |
| Sublime Text                                       | ACP (`sublime-acp`)                           | M63       | Planned   | A community package                                                                                                                                                                                                                                               |
| Eclipse IDE                                        | Native (SWT Browser)                          | M65       | Planned   | Installable in the container from download.eclipse.org                                                                                                                                                                                                            |
| Xcode 27                                           | ACP (Intelligence settings)                   | M63       | Planned   | Needs macOS                                                                                                                                                                                                                                                       |
| Xcode 26.3                                         | External (Xcode's MCP tools)                  | M66       | Planned   |                                                                                                                                                                                                                                                                   |
| Zed                                                | ACP (custom agent, then the ACP Registry)     | M63       | Preview   | See Zed under the ACP agent below; the registry wants an npm package (Q65)                                                                                                                                                                                        |
| Notepad++                                          | External                                      | M66       | Planned   | Windows only                                                                                                                                                                                                                                                      |

## The VS Code family

| Editor                            | Route                            | Milestone | Status  | Evidence and notes                                                                                                                                                                                                                                                            |
| --------------------------------- | -------------------------------- | --------- | ------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| VSCodium                          | VSIX (Open VSX)                  | M62       | Preview | 2026-09-26: the integration tests pass in 1.99.3 and 1.135 (9 each), using the development extension; Open VSX from the next tag                                                                                                                                              |
| Kiro IDE                          | VSIX (Open VSX)                  | M62       | Preview | 2026-09-26, `forks.yml`: Kiro 1.1.70 (VS Code 1.131.0, Linux) installs the `.vsix` and passes the integration tests (9); weekly on the latest                                                                                                                                 |
| Positron                          | VSIX (Open VSX)                  | M62       | Preview | 2026-09-26, `forks.yml`: Positron 2026.09.1 (VS Code 1.130.0, Linux `.deb`) installs the `.vsix` and passes the integration tests (9); weekly on the latest                                                                                                                   |
| Eclipse Theia IDE                 | VSIX                             | M62       | Preview | 2026-09-26: Theia 1.75 (browser, built from npm; it claims VS Code API 1.134) runs the panel, a conversation and an approval (fake CLI). Its sidebar stays blank until the extension starts (Ctrl+Esc or any Muse Spark command): Theia fires no `onView:` for a webview view |
| code-server                       | VSIX, in the server's host       | M62       | Preview | 2026-09-26: 4.99.4 (VS Code 1.99.3, Node 20.18.3) installs the `.vsix`, and the panel runs a conversation and an approval in the browser (fake CLI)                                                                                                                           |
| GitHub Codespaces                 | VSIX, in the remote host         | M62       | Planned |                                                                                                                                                                                                                                                                               |
| Eclipse Che, OpenShift Dev Spaces | VSIX with a Code-OSS editor      | M62       | Planned |                                                                                                                                                                                                                                                                               |
| Firebase Studio                   | VSIX (Open VSX)                  | M62       | Planned |                                                                                                                                                                                                                                                                               |
| Google Antigravity                | VSIX, if it installs extensions  | M62       | Planned | Not established that it takes arbitrary extensions                                                                                                                                                                                                                            |
| vscode.dev, github.dev            | A browser entry and remote agent | M66       | Planned | The extension has no `browser` entry today                                                                                                                                                                                                                                    |

## Through the ACP agent

| Editor                  | Client                      | Milestone | Status  | Evidence and notes                                                                                                                                                                                                                                                       |
| ----------------------- | --------------------------- | --------- | ------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Zed                     | Built in                    | M63       | Preview | 2026-09-26: Zed 1.20.2 (Linux, software rendering): a Muse Spark thread from the External Agents menu with its model and effort selectors, a streamed reply, a command allowed and one rejected from its permission card (fake CLI); the ACP Registry waits on npm (Q65) |
| JetBrains IDEs          | AI Assistant                | M63       | Planned | WSL not supported by JetBrains' ACP                                                                                                                                                                                                                                      |
| Xcode 27                | Built in                    | M63       | Planned |                                                                                                                                                                                                                                                                          |
| Qt Creator              | The ACP Client extension    | M63       | Planned |                                                                                                                                                                                                                                                                          |
| Neovim                  | CodeCompanion               | M63       | Preview | 2026-09-26: Neovim 0.11.4 with CodeCompanion v19.25.0: a streamed reply, a command accepted and one rejected from its approval prompt (fake CLI); setup in `docs/acp.md`                                                                                                 |
| Emacs                   | agent-shell                 | M63       | Preview | 2026-09-26: Emacs 29.3 with agent-shell 0.79.2 (acp.el 0.15.2, shell-maker 0.97.3): modes, model and effort, a streamed reply, a tool call allowed and one rejected (fake CLI); setup in `docs/acp.md`                                                                   |
| Sublime Text            | sublime-acp                 | M63       | Planned |                                                                                                                                                                                                                                                                          |
| Windsurf, Devin Desktop | Custom agents               | M63       | Planned |                                                                                                                                                                                                                                                                          |
| Kate                    | Its ACP work, once released | M66       | Planned | Still an open merge request when reviewed                                                                                                                                                                                                                                |

## M112 question routes — integration status

2026-10-06: integration connects the real private registry and durable ACP
queue. Windows 11 fake-only engine, UI and pinned ACP SDK 1.5.0 checks are
recorded in [M112's record](../certification/m112.md). Installed-editor rows
above retain their existing status; native MHP bridges remain M104 work.

| Surface                                                                                                         | Clock and question path                                                                    | Late answer and count                                                                            | Binding / evidence                                                                                      |
| --------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------- |
| VS Code family, Remote SSH, WSL, containers, Codespaces                                                         | Host clock; attention dock and transcript                                                  | Steer or new turn; badge, tab title and History count; focus-scoped next/previous keys           | Integrated Q/U bindings; controller/UI fakes; installed-host checks: lead                               |
| JetBrains native/JCEF, Visual Studio/WebView2, Eclipse/SWT                                                      | Runtime clock; same shared panel                                                           | MHP open/list/answer/dismiss/defer methods and status-item count                                 | M104b–d; native keys must avoid the lane-0 default-map conflicts                                        |
| Companion page                                                                                                  | Runtime clock; same panel                                                                  | Steer or new turn; document-title count and page keys                                            | M104 lane C and M112 integration                                                                        |
| ACP with forms: Zed, Xcode 27, JetBrains AI Assistant, Qt Creator, Neovim, Emacs, Sublime and other ACP clients | Agent clock; `elicitation/create`, withdrawal by `cancellationSignal` / `$/cancel_request` | Late form or `/answer`; idle answer before next prompt; `/questions` and one notice per deferral | A's real SDK client plus fakes; each installed client's capability/withdrawal support still needs a run |
| ACP without forms, including clients that only show text                                                        | Defer immediately; no clock, including setting 0                                           | `/answer <n> <text>`; `/questions`                                                               | A's real SDK client plus fakes; installed-client checks remain open                                     |
| Headless exec                                                                                                   | Immediate decline; no form, registry or clock                                              | No late answer; `question_declined`                                                              | Explicit decline selected by runExec; fake ACP/runtime checks                                           |
| TUI                                                                                                             | Runtime clock; question view above input                                                   | MHP methods, status count and next-open key                                                      | M110a0 lane T; waiting for its integration                                                              |
| Muse Desktop                                                                                                    | Node clock; shared panel                                                                   | MHP methods; agents-item count                                                                   | M111b; waiting for its integration                                                                      |
| Muse Code on every surface                                                                                      | The holding process above; captured `userInput/clarify` deferral                           | `turn/steer` or surface's queued/new-turn path                                                   | Q's backend binding and lead's live checks                                                              |

Scheduled/unattended prompts defer immediately and keep the question open,
including with interactive deferral disabled; headless exec, best-of-N,
worktrees and the evaluation retain their distinct immediate policies.

## Native and scientific

| Editor                    | Route                               | Milestone | Status  |
| ------------------------- | ----------------------------------- | --------- | ------- |
| Apache NetBeans           | Native (HTML UI)                    | M65       | Planned |
| Spyder                    | Native (Qt), Conda distribution     | M65       | Planned |
| RStudio (Desktop, Server) | Native (an R addin with a web view) | M65       | Planned |
| MATLAB                    | External (`uihtml` app)             | M66       | Planned |

## Constrained and watched

| Editor                                       | Starting point                             | Milestone | Status  |
| -------------------------------------------- | ------------------------------------------ | --------- | ------- |
| Replit                                       | The agent in the project shell             | M66       | Planned |
| StackBlitz, Codeflow                         | A runtime experiment                       | M66       | Planned |
| CodeSandbox, Ona                             | Remote-editor attachment                   | M66       | Planned |
| Arduino IDE 2, Code::Blocks, CodeLite, Geany | External tool, or a native plugin if asked | M66       | Planned |

## M118 sharing integration (2026-10-06)

The VS Code/shared React bridge binds `sharingAction`, `sharingResult` and
`openSharing` to the lazy shared prompt/chat core. VS Code derivatives take the
same VSIX path; this integration does not repeat their installed-host receipts.
ACP binds `/help`, `/prompt save|list|use|share` and `/share chat`. On this base
ACP can return prepared prompt text and an exact share preview, but has no
composer or final-click bridge: Use never sends; sharing cancels safely.

| Editor/surface          | M118 evidence                                                                                                                                    | Remaining integration                                                                          |
| ----------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------- |
| VS Code and derivatives | Own-message/history menus, composer, editor selection and shared React tested with fake host/backend; real VSIX packaging checked in M118 record | Per-derivative installed GUI receipts remain required                                          |
| JetBrains               | Shared native-menu adapter fake tests                                                                                                            | M104 validated envelopes for menu snapshots/invocations, prompt load, preview and confirmation |
| Visual Studio           | Same shared adapter                                                                                                                              | Same M104 ports                                                                                |
| Eclipse                 | Same shared adapter                                                                                                                              | Same M104 ports                                                                                |
| Zed                     | Existing ACP local command route; shared adapter fake tests                                                                                      | M104 composer/final-click and menu ports                                                       |
| Xcode                   | Existing ACP local command route; shared adapter fake tests                                                                                      | Same M104 ports                                                                                |
| Neovim                  | Existing ACP local command route; shared adapter fake tests                                                                                      | Same M104 ports                                                                                |
| Emacs                   | Existing ACP local command route; shared adapter fake tests                                                                                      | Same M104 ports                                                                                |
| Sublime Text            | Shared adapter fake tests; ACP local command implementation                                                                                      | Same M104 ports; installed ACP client receipt                                                  |
| Companion page          | Shared React implementation                                                                                                                      | M104 mounting and validated envelopes                                                          |
| TUI                     | Shared runtime builder and adapter fake tests                                                                                                    | M110a0 lane T picker, `SharingUi.preparePrompt`, `insertPrompt`, exact-preview `confirmShare`  |
| Standalone CLI          | Real lazy runtime entry and installed fake-only receipts in M118 record                                                                          | No composer; Use returns prepared text                                                         |

M104 is absent on this base, so no new MHP wire method is invented. Existing
React envelopes are named above. Their action names are `list`, `saveDraft`,
`remove`, `duplicate`, `insert`, `importPreview`, `acceptImport`,
`sharePromptPreview`, `confirmPromptShare`, `saveText`, `saveHistory`, `use`,
`shareSaved`, `chatContext`, `chatPreview`, `chatConfirm`, `remember`, `invalidate`.
The pending native DTOs are `nativePromptMenus`/`invokeNativePromptMenu` with
host-owned `{menuId, contextId}` snapshots, `promptLoadSchema` with
`{promptId, scope, chat, action: 'insert', send: false}`, and
`confirmedShareSchema` with `{step: 'confirmed', previewId, request}`.
M104 must carry equivalent strict DTOs through its validated envelopes and abort
pending actions on closure/replacement. These are local DTO names, not claims
that MHP message methods are already available. Phase 2 gists and phase 3
node/team/email destinations remain unavailable.

## Deterministic reports (M113)

Every editor uses the same report-v1 engine and scoped reports/run, history, get, compare and open contracts. VS Code mounts the lazy shared ReportApp; CLI and ACP render the same document as Markdown/text (CLI also HTML/JSON). JCEF, WebView2, SWT, desktop, companion and terminal adapters have fake contract receipts in M113 X. Installed JetBrains, Visual Studio, Eclipse, Zed, Xcode, Neovim, Emacs and Sublime report-page receipts remain with their host owners; this integration does not claim they ran. Missing usage, fleet, security, accounts, estimates, playbook, issues, schedules and keybindings adapters remain named unavailable sources in all editors.
