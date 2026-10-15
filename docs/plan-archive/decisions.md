# PLAN.md archived decision records (section 2)

The design record of decisions moved here from PLAN.md §2 to keep the plan
well under the plan reader's size bound (2026-10-11, lead decision). PLAN.md
§2 keeps every decision's heading, a paragraph that states the rule in force
and a link here; it also keeps, in place, every passage an open branch touches
together with its neighbours, every passage a test cites and every live table.
A decision's passages stand below under its heading, in their original order;
where a kept passage stood between two of them, a new block begins.

Each passage below is unchanged from PLAN.md: the bytes between a
`plan-archive:begin` marker and its `plan-archive:end` (without the blank line
after the first and before the second) hash to the marker's `sha256`, which
`test/unit/planArchive.test.ts` checks for every block; `lines` are the
passage's line numbers in PLAN.md at commit 5161b6476.

## D11 — Transcript wire facts (live captures 2026-09-21/22, Muse Code 1.3.0)

<!-- plan-archive:begin id="2-D11-01" lines="1906-1962" bytes="3932" sha256="6f432f6c6980a79f8eef654bcd4d39a5c8858fcdb2e0b6f1284fe6daaf1556ca" -->

Everything the transcript renders was shaped by two raw MSP captures
(`scratchpad/live-capture.mjs`, `live-capture2.mjs`; notifications verbatim in
`docs/certification/m4.md`) rather than by the schema alone:

- Tool vocabulary on Windows: `write_file {content, path}`, `read_file
{path}`, `edit_file {find, path, replace}`, `powershell {command,
description}` (`bash` elsewhere), `request_user_input {questions}`. Args are
  verbatim JSON strings; `visibleOutput` carries the result text (`read_file`
  numbers lines, `edit_file` emits a headerless unified diff, `write_file`
  reports bytes). Edit-family calls add `patchSummary {files, added, removed}`
  and a `patchRef` whose body (`item/readOutput`, `application/json`) is
  `{files: [{path, hunks: [{oldStart, oldLines, newStart, newLines, lines}]}]}`.
- `reasoning` items never appeared at any effort tier for the M3/M4 capture
  prompts, so the row was built from the schema (`summary.N` deltas, `text`)
  and fake-tested. They **did** appear in the shell-tool turns of the
  2026-09-22 live check (`itemStarted reasoning` → `summary.0` / `summary.1`
  deltas such as "Executing a PowerShell command to read …" →
  `itemCompleted`), so the row is now live-exercised (m4.md).
- `promptUnmatched` does **not** prompt for in-workspace file tools; only
  shell commands (and anything else policy leaves unmatched) raise
  `approval/requested`. A write outside the workspace is refused outright
  (`path escapes workspace`), no approval involved.
- Approvals are **multi-stage**: `a; b` is two stages. Deciding stage 0
  returns `terminal: false` and the host sends `approval/updated` with the
  next `currentRequirementId` and choices; ignoring it hangs the turn (the
  first probe did). The card follows `approval/updated` and shows "step n of
  N" from `subject.stages`. Choices seen: `allow_once` (approved, once),
  `allow_local_prefix` (approvedPolicyAmendment, localPersistent, with
  `rulePreview` "Always allow in this workspace: <argv[0]> ..."), `abort`
  (Reject, accepts feedback).
- `userInput/request` and `approval/request` also arrive as JSON-RPC server
  requests; the SDK facade treats the notification as the enrolled surface.
  Refusing the server request and answering with `userInput/answer` /
  `approval/decide` settles the prompt (`userInput/settled: answered`), so the
  host declines those two quietly.
- Shell tools need Muse Code's OS sandbox. Until the owner ran the elevated
  `muse sandbox windows setup` (2026-09-22), `muse sandbox windows check`
  reported `setup_required` (`sandbox users are not ready`) and every
  `powershell` call failed with `environment failure: sandbox enforcement
unavailable: windows_elevated setup_required`. The extension now handles
  this itself (D12).
- The host can repeat `approval/updated` for a stage the user has already
  decided (seen live 2026-09-22: decide stage 0 → `approval/updated` stage 1 →
  decide stage 1 → `session/statusChanged` → `approval/updated` stage 1
  **again** → `approval/resolved`). A second `approval/decide` for that stage
  is rejected (`approval … is already resolved`), so the card locks the
  decided stage (`decidedSourceIndex`) until the requirement index changes or
  the approval resolves. Pipelines count as stages too: `a | b; c | d` asked
  four times (M5 live edit turn), with the last stage repeated.
- On Windows the stored patch document names files with the extended-length
  prefix (`"path":"\\?\C:\muse-live-ws\notes.md"`, M5 live edit turn), not
  the relative `notes.md` of the M4 fixture; anything resolving those paths
  strips `\\?\` / `\\?\UNC\` first (`EditReview`).
- The model also uses a `search {glob, output_mode, pattern}` tool (M5 live
  edit turn); MCP tool calls from a session server arrive as
  `toolCall` items named `mcp__<server>__<tool>` and are gated by
  `approval/requested` in prompting modes like any unmatched tool.

<!-- plan-archive:end id="2-D11-01" -->

## D12 — The extension sets up Muse Code's Windows sandbox itself (2026-09-22)

<!-- plan-archive:begin id="2-D12-01" lines="1966-2106" bytes="9016" sha256="3ecb1a959c72d5968a50aeffd4588851da3aec4a75c07c8508fc78f257d906bd" -->

`muse sandbox` has only `windows check` and `windows setup` (verified on
Windows and on the Linux VM; Linux and macOS need no setup). `check` prints
`key=value` lines (`backend`, `status`, `reason`, `runner_path`,
`sandbox_users_ready`, `capabilities_ready`, `wfp_ready`, `diagnostic=…`) and
exits 1 while `status=setup_required`. `setup` needs elevation: it creates
the `MuseSandboxUsers` local accounts, their capabilities and a Windows
Filtering Platform rule, with credentials under `C:\ProgramData\muse`; on the
owner's machine it ran non-interactively in about one second and the
re-check reported `status=ready`.

The owner's decision: future users must not hit the failure by hand, so the
extension owns the flow (`src/core/backends/musecode/sandbox.ts` pure,
`src/host/backend/sandboxSetup.ts` orchestration, wired in `extension.ts`):

- When a chat surface opens on Windows, run the check once per extension
  host; on `setup_required` show a warning notification with **Set up now** /
  **Not now** / **Don't ask again** (the last is remembered in the
  extension's own `globalState`, never in machine configuration).
- **Set up now** relaunches the same CLI the backend spawns through Windows
  PowerShell `Start-Process -Verb RunAs -Wait -PassThru` (the UAC prompt),
  then re-runs the check and reports "ready" or the remaining `reason`. A
  declined prompt surfaces as a non-zero exit with the PowerShell error line.
  Output cannot cross the elevation boundary, which is why the re-check is
  the source of truth.
- A shell tool failing with `sandbox enforcement unavailable` re-offers the
  setup even after "Not now" (the user is hitting it now); the transcript
  notice names the command palette entry.
- **Muse Spark: Set Up Shell Sandbox** runs the same flow on demand and says
  when nothing is needed (already ready, or not Windows).
- The extension never runs the setup silently: elevation always goes through
  the OS prompt, on the user's click.

**Known CLI limitation (1.3.0, verified live 2026-09-22, m4.md "Sandbox
working directory")**: for a workspace under `C:\Users\<user>` the sandboxed
shell cannot traverse the profile folder, so commands start in
`C:\Windows\System32\WindowsPowerShell\v1.0` after a ~34 s wait (about five
minutes on the sandbox account's first logon); `muse exec` shows the same, so
it is not the extension's spawn. Workspaces outside the profile (verified
`C:\muse-live-ws`) run in place in about a second. The controller posts a
one-time notice on Windows when the workspace is under `%USERPROFILE%` and the
server version is 1.3.0 or older; file tools are unaffected. Reported
upstream as meta-models/muse-code-sdk#26 (2026-09-22); the extension will
not touch profile ACLs (the owner ruled that out, and the auto-mode
classifier refused the experiment too).

**Resolution — `museSpark.shellSandbox` (2026-09-22).** The owner's ruling:
change how the sandbox is used, never the user's folder permissions. Muse
Code's own knobs, verified against the same profile workspace with the same
headless prompt: `muse exec --disable-sandbox` runs the command in the
workspace (`C:\Users\<user>\muse-live-ws`) in 14 s end to end;
`--enable-shell-tool` (the legacy shell) still lands in PowerShell's folder
after 65 s. `muse serve --disable-sandbox` exists as a host-lifetime
posture ("Sandbox posture (fixed for the host's lifetime)"), and approval
mode stays on the wire, so the approval cards keep gating every command —
which is exactly Claude Code's model (no OS sandbox, permission prompts).
The setting has three values: `auto` (default; the sandbox except for a
Windows workspace under the user profile, `resolveShellSandbox` →
`profileWorkspace`), `muse` (always), `off` (never). The manager passes
`serveArguments(posture)` into the launch, logs the posture at spawn, the
controller posts one notice per session explaining an `auto` switch-off
(or the wrong-folder warning when `muse` is forced), the sandbox setup
offer is skipped where the window will not sandbox, and a change of the
setting drops the host so the next message respawns it (a notice says so).
Caveat from the CLI docs, kept in the README: without the sandbox Muse
Code's file tools may write outside the workspace, so the approval modes
matter more.

**Update (2026-10-04, musecode-write-asks).** A live check by the
protect-agent-folders lane found Muse Code 1.4.2, in Manual with the
sandbox off, writing `.claude/settings.json` and a file outside the
workspace without any approval. The findings, with forced tool calls
through a loopback stand-in for the provider (0 model calls) and Meta's
docs (docs/certification/musecode-write-asks.md):

- The caveat understated it. Meta's permissions page: `--disable-sandbox`
  "also removes workspace confinement from the file tools, so write_file
  and edit_file can write anywhere on the filesystem", and Muse Code asks
  for none of those writes, in Manual, Auto or Plan. With the sandbox they
  fail ("absolute path is outside the workspace"), a temp-folder target
  included. Either way only `.git`, `.muse` and `.agents` ask; in-workspace
  writes "still pass in any mode", so `.claude/settings.json` is written
  unasked with or without the sandbox. "Approval prompts still apply", the
  old notice's line, was true only for commands.
- Nothing lets a client add ask rules. MSP is "select, never create"
  (`session/start.config` admits only `mcpServers`; the experimental
  `session/setPermissionProfile` on the `next` site says "there is no
  inline-rule member and none may be added"); `muse serve` takes posture
  flags only (no `--permission-profile`, no `--approval-judge`); the
  documented settings key is `permissions.default_profile` (built-in
  profiles; custom ones are undocumented, and the binary's own startup text
  says that without the sandbox "permission-profile filesystem …
  restrictions remain recorded but are not enforced"); managed policy
  (`execution.permission_profiles`, `execution.tool_rules`) is a
  machine-wide administrator plane; hooks (a PreToolUse block) live in the
  user's settings file, a managed hooks file or the repository's
  `.muse/hooks.json`. The extension writes none of those (D17: it never
  writes the CLI's settings).
- #26 is not reliably fixed in 1.4.2-R4684.1, so the sandbox cannot stay
  on for a profile workspace. On the owner's machine a sandboxed
  `powershell` call in a workspace under `C:\Users\<user>` (and under
  `%TEMP%`) printed the workspace as its location in about 5 s. On the
  freshly set-up Windows 11 rig, in the interactive session, the same call
  first failed with "ACL publication lock
  Global\TbhWindowsSandboxAclPublication: timed out … after 120000 ms":
  Muse Code's background read worker (1.4.0's "Root:Read … through an
  optional background worker") held that lock for about 70 minutes while it
  granted the sandbox group read access to the profile's top-level entries,
  ending "refresh-partial". After it ended, the call in a profile workspace
  never finished, twice (8 minutes each); a workspace outside the profile
  (`C:\mcwrite-probe-ws`) ran in place throughout. (Runs over SSH, session
  0, hung or failed with "The pipe has been ended" and are not counted.)

Decisions (the lead's brief: keep the sandbox on wherever it can work,
warn honestly where it cannot):

- **`auto` stays as it was.** A version gate (keep the sandbox for 1.4.2 in
  a profile workspace) was built and drilled, then dropped on the rig's
  evidence: it would leave fresh setups with commands that hang without a
  message. The sandbox stays on everywhere else, as before; no rule or
  setting of Muse Code can narrow the switch-off to a precise exception.
  The extension changes no ACL.
- **The sandbox-off warning.** Whenever the host runs without the sandbox,
  for either reason, the first Muse Code conversation of the window gets a
  warning: the file tools can write anywhere the account can, without
  asking in any mode, Plan included; commands run as the user with the
  user's network; approval still covers commands and `.git`, `.muse`,
  `.agents`; a workspace outside the profile keeps the sandbox. The
  posture carries `isUnsupportedWorkspace`, and the wrong-folder warning
  (now "may start in the PowerShell folder … or never finish") stays for
  `muse` forced in a profile workspace.
- **The preparing notice.** A shell failure carrying the lock text says
  the sandbox is still being prepared and to try again later, and offers no
  setup (the setup has run).
- **Diagnostics** adds `muse code file writes:` (workspace only, or
  anywhere without asking).
- **Upstream** (draft 07): ask before file-tool writes outside the
  workspace roots when the shell sandbox is off (or keep the file tools'
  confinement independent of the shell sandbox), let a client select the
  Read-only profile for Plan (#43), protect other agents' configuration
  folders or let users name protected paths; and, on #26, the 1.4.2
  results above.

<!-- plan-archive:end id="2-D12-01" -->

## D13 — Workspace context (rules, skills, memory) follows Muse Code's own conventions and VS Code's workspace trust (2026-09-22)

<!-- plan-archive:begin id="2-D13-01" lines="2130-2264" bytes="8268" sha256="a98bfc9abc5592587e107d381648674d931b98340fd4d518833ea8867bf905b5" -->

The owner asked whether the agent "will use the skills properly and
AGENTS.md and memory". The answer had to be established, not assumed, and
it came out in two halves.

**What Muse Code does (read from the CLI's help, its `skills` command and
the strings of `muse-bin-1.3.0-R3401.1.exe`; nothing here is guessed):**

- `muse serve --trust-workspace`: "Load each session workspace's skills and
  rules". Without the flag the host skips both: `muse skills list --source
project` without `--trust-workspace` returns no rows and the diagnostic
  `project-skills-untrusted: project skills skipped because workspace is
untrusted`; with the flag the same workspace lists `.agents/skills/shout`.
  The rules loader prints the matching warning ("rules file at … exists,
  but the workspace is untrusted, so it is skipped for this session").
- Rules: the workspace `AGENTS.md` is the project rules file; `CLAUDE.md`
  is read only when `AGENTS.md` is absent in that directory ("… is ignored
  this session because AGENTS.md takes precedence in that directory").
  Rules files may sit in subdirectories: the preamble the CLI gives the
  model reads, verbatim, "Muse Code loaded standing rules at session open.
  Follow higher-priority instructions first. If user and project rules
  conflict, project rules win. If project rules files conflict, the deeper
  file wins over the shallower one." Each file has a byte load limit
  (skipped over it, with a warning to trim or split it) and the whole rules
  context has a byte limit (truncated over it, with a warning). A user
  rules file exists in the config root (`/rules import` writes it) but its
  file name is not printed anywhere reachable (Q9).
- Skills: project skills live at `.agents/skills/<id>/SKILL.md` (front
  matter `name`, `description`; `user-invocable` is the one other key the
  bundled skills use), personal skills in the managed root
  `$XDG_CONFIG_HOME/muse/skills/<id>` (else `~/.config/muse/skills`),
  bundled skills in the CLI's plugin cache. `~/.claude/skills`,
  `~/.codex/skills` and `~/.agents/skills` are import sources for `muse
skills import`, not load roots (a "personal skills fallback" setting can
  admit compatible ones). `muse skills list --json` reports a per-skill
  `context_cost.startup_bytes` of about the description's size: the
  catalogue (name and description) is in the model's context from the
  start and the body is loaded on demand through the `read_skill` tool or
  a typed `/skill` invocation, which the host expands.
- Memory: project memory is `<repo>/.agents/memory` with `MEMORY.md` as
  the index ("one line per note, `- [Title](file.md) | hook`"), read at
  session start as the "startup memory snapshot", with line and byte
  limits on the index; personal memory is the CLI's own, private store.

**What the extension did:** `serveArguments` produced `serve` or `serve
--disable-sandbox` and never `--trust-workspace`, so **every CLI session
the extension started since M1 ran with the workspace's rules and project
skills skipped**; the `skill/list` rows the palette showed were the bundled
and personal ones only. The M6 live capture's `reminderChild` items were
the bundled plugins' reminders, not rules (the trace logs count
`reminders=6` from `plugin_capability_snapshot.compose`), which is why the
gap went unnoticed. The Model API backend had a fixed system prompt, no
skills (a `/skill` went to the model as typed text) and no memory, as M7
recorded.

**Decision.** VS Code's workspace trust is the one switch, on both
backends, because it is the contract VS Code already makes with the user
about what an extension may load and run from a folder:

1. **Trusted workspace**: the CLI is spawned with `--trust-workspace`; the
   Model API backend loads the same things itself: the rules files (root
   `AGENTS.md`, else `CLAUDE.md`; a subdirectory's file is loaded the
   first time a tool touches a path beneath it, and deeper files come later
   in the prompt so they win), the project skills and the personal Muse
   skills (catalogue in the instructions, body through a new `read_skill`
   tool or a `/name arguments` invocation expanded by the host), and the
   project memory index. The preamble sentence is Muse Code's own.
2. **Restricted Mode**: neither backend loads rules, skills or memory, and
   neither runs shell commands (the CLI gets `--disable-shell`; the Model
   API tool set omits the shell tool). VS Code's rule for Restricted Mode
   is that an extension must not execute code from the workspace, and a
   model that has read the workspace composing a command line is exactly
   that. The manifest declares `capabilities.untrustedWorkspaces.supported:
"limited"` with `restrictedConfigurations` for `museSpark.museBinaryPath`
   and `museSpark.environmentVariables` (a workspace's settings must not be
   able to point the extension at another executable), and
   `virtualWorkspaces: false` (the CLI and the tools need a real file
   system). Granting trust restarts the hosts (`onDidGrantWorkspaceTrust`),
   as a sandbox setting change already does.
3. **Not loaded on the Model API backend**, each for a reason: the bundled
   plugin skills (they are the CLI's and instruct the model to run `muse`
   subcommands and `read_skill` on `bundled:` ids), personal memory (the
   CLI's private store), the user rules file (Q9), and the foreign-harness
   skill fallback (Muse classifies each candidate against a compatibility
   profile and quarantines the rest; reproducing that classifier is out of
   scope). The README's backend table says so.

Muse Code owns all of this on the CLI backend; the extension only passes
the trust flag. On the Model API backend the extension is the host, so it
mirrors the conventions above and no others: no invented file names, no
`MUSE.md`.

**Addendum — custom agents (M76, 2026-09-28, re-checked 2026-09-30).** The
CLI names no agent folder, so M76's is the extension's own, the one place
this section allows an invented name. Checked against Muse Code
1.4.0-R4302.1 (`muse-bin-1.4.0-R4302.1.exe`, run for help text only, no model
call): `muse --help` lists agents only as the ephemeral `--agents <JSON>`
overlay ("Supply one ephemeral agent-definition overlay"), `muse skills
--help` lists skills only, `muse init` takes no agent argument, and the
binary's strings name `.agents/skills`, `.agents/memory`, `.agents/plans`,
`.agents/workflows` and `.agents/skill-drafts` but no agent folder. The
folder follows the skill layout: project `.agents/agents/<id>/AGENT.md`,
personal `$XDG_CONFIG_HOME/muse/agents/<id>/AGENT.md` (else
`~/.config/muse/agents`), front matter `name` and `description` with
optional `tools`, `model`, `effort` and `permission-mode` above the agent's
own prompt. The trust rule is the skills': a repository's agent files load
only in a trusted workspace, and Restricted Mode loads no agents on the Model
API backend. Muse Code never reads the folder, and the extension sends it no
agent.

**Plans (M79, 2026-09-27).** The saved-plan location is Muse Code's own,
not the extension's. It was read from `skills/plan/SKILL.md`, the `plan`
skill bundled in `muse-bin-1.4.0-R4302.1.exe`, under "Explicit File Output":

- "If saving and no stronger convention exists, save to
  `.agents/plans/YYYY-MM-DD-<slug>.md`";
- "When creating a new dated file and the chosen file exists, add a short
  numeric suffix";
- "If you save a plan file, its content must be exactly the canonical
  body".

The extension follows all three. It does not follow the skill's
precedence for a stronger convention (an active `specs/<feature>/plan.md`,
a `docs/plans/` folder), which is the model's judgement, not a fixed
name. The skill's delivery form is the other half:

- a plan reply starts with "This is a plan, not a special mode; I haven’t
  started implementation. Reply `go` to execute this plan, or tell me what
  to change.";
- it ends with the second sentence repeated;
- the user's next message ("go") is the approval.

A live capture of a Plan-mode turn on Muse Code 1.4.0 showed exactly that
reply as an ordinary `agentMessage`, with no plan item and no approval
request (docs/certification/m79.md). The extension saves the text between
those two lines; any other reply is saved whole.

<!-- plan-archive:end id="2-D13-01" -->

## D14 — Production hardening set for 0.2.0 (2026-09-22)

<!-- plan-archive:begin id="2-D14-01" lines="2268-2286" bytes="5963" sha256="9d4a44aaf9c4cb68997cf3a856b801a8ae194dce5b3daa017b498137c9e148d7" -->

The owner's brief after D13: "fully enterprise grade and production ready
… robust and have all of the needed features for a production ready app".
An audit of the tree against what a VS Code extension that spawns
processes and edits files needs, and against the repository conventions
of a maintained open-source project, produced this list; each item is
either done in M11 or recorded as deferred with its reason.

| Area               | Finding (2026-09-22)                                                                                                              | Action                                                                                                                                                                                                                                                                                                           |
| ------------------ | --------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Workspace trust    | No `capabilities` block; the agent ran shell commands in Restricted Mode and loaded nothing differently.                          | D13: `untrustedWorkspaces: limited` + `restrictedConfigurations`, `virtualWorkspaces: false`; trust gates rules/skills/memory and the shell on both backends.                                                                                                                                                    |
| Remote hosts       | No `extensionKind`; VS Code defaults an extension with `main` to the workspace host, but the choice was implicit.                 | Declare `extensionKind: ["workspace"]`: the CLI, the tools and the workspace files are on the remote; the dictation helper then runs there too, which the README's voice section states as the remote limitation.                                                                                                |
| Webview crash      | A render error in React unmounts the whole panel and leaves it blank, with the cause only in the developer tools.                 | An error boundary around the app that shows the message and a **Reload** button (posts `hostAction: reload`; the host re-creates the webview's HTML).                                                                                                                                                            |
| Model API sessions | Live for the window only (M7/M8): a reload loses the conversation, the patches behind Open diff / Revert and the history list.    | A JSON session store under `context.storageUri` (per workspace): replay items, transcript, todos, name, model, effort, approval mode, patches; `session/list`, resume and fork read it; the store is a dependency of the host, so the core stays free of `vscode` and `fs`.                                      |
| Support tooling    | The log channel exists (secrets redacted) but there is no command to open it, and no way to collect the facts a bug report needs. | `Muse Spark: Show Logs` and `Muse Spark: Diagnostics` (writes to the log and opens it: versions, platform, backend, CLI path and version, sign-in and key presence as booleans, sandbox posture, dictation helper, workspace trust). Nothing secret is ever written.                                             |
| Release pipeline   | Publishing was by hand from a CI artifact with a PAT from the clipboard; no GitHub Release was created until the owner noticed.   | `release.yml` on `v*` tags: the shared build (`build.yml`, `workflow_call`, used by `ci.yml` too) produces the `.vsix`, the release job creates the GitHub Release with the `.vsix` and the CHANGELOG section as notes, and a publish job runs `vsce publish` only when the `VSCE_PAT` repository secret exists. |
| Repository hygiene | No `SECURITY.md`, `CONTRIBUTING.md`, `CODE_OF_CONDUCT.md`, issue or pull request templates, `dependabot.yml` or `CODEOWNERS`.     | All added under M11; Dependabot for npm and GitHub Actions weekly, grouped, with the pinned-SHA actions kept pinned.                                                                                                                                                                                             |
| Telemetry          | None, by design (`docs/PRIVACY.md`).                                                                                              | Unchanged; the Diagnostics command is the support path instead.                                                                                                                                                                                                                                                  |
| Localisation       | English strings in `UI_TEXT`; no `package.nls.json`.                                                                              | Deferred: no second language is planned; the strings are already in one table.                                                                                                                                                                                                                                   |
| Multi-root         | The first workspace folder is the root (as the Claude Code extension does).                                                       | Unchanged; documented in the README requirements.                                                                                                                                                                                                                                                                |

<!-- plan-archive:end id="2-D14-01" -->

## D18 — The owner's first F5 round on 0.4.0 (2026-09-22, night)

<!-- plan-archive:begin id="2-D18-01" lines="2358-2370" bytes="6950" sha256="778e757283c1859e33231a4d667488a7b471b57a5f149f9c25faa89719022fb4" -->

The owner drove 0.4.0 under F5 and reported, one screenshot at a time,
what differed from the Claude Code extension. Findings and decisions:

| Report                                                                                                                                   | Finding                                                                                                                                                                                                                                                                                | Decision                                                                                                                                                                                                                                                        |
| ---------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| "The models don't load until you click the pill; it has been this way the entire time."                                                  | Only a send, a resume or the pill's skill listing started the host and listed the models, so the pill read "Starting Muse Code…" until the first click.                                                                                                                                | `surfaceReady` (and a completed sign-in) starts the host and lists the models when signed in; one `model/list` in flight at a time so the first send shares it. No model call is involved.                                                                      |
| "Ctrl+N just creates a new file."                                                                                                        | By D15 the shortcut is opt-in (`museSpark.enableNewConversationShortcut`, default off) because Ctrl+N is VS Code's New File.                                                                                                                                                           | Unchanged; the answer is the setting.                                                                                                                                                                                                                           |
| "There needs to be an indicator when there are new messages, with a button to jump to the newest; at the end the scroll should be auto." | The transcript never scrolled itself.                                                                                                                                                                                                                                                  | The transcript follows new entries while the reader is within 24 px of the end and after their own send or a fresh load; scrolled up, it holds still and shows a "New messages" button that jumps to the end.                                                   |
| A red "The decision was not accepted: approval decide settlement failed: approval ledger durability fence…" after an approval that ran.  | Muse Code 1.3.0 on Windows can fail the reply to `approval/decide` on its own ledger write after applying the decision; the tool ran on. The panel reported the CLI's error as a refusal.                                                                                              | A warning that says the CLI reported an error for the decision and the tool may have run anyway. The CLI-side fault joins the Windows `session/rename` and `session/fork` write failures already recorded. Upstream: meta-models/muse-code-sdk#29 (2026-09-23). |
| "There should be a chevron to notify when an item can be expanded."                                                                      | Tool and reasoning rows opened on click with nothing to say so.                                                                                                                                                                                                                        | A chevron at the right of every row that has a body; it turns when open. Rows with nothing to show are disabled.                                                                                                                                                |
| "We need the hover button to copy the contents of the response."                                                                         | Copy existed on code blocks only.                                                                                                                                                                                                                                                      | A Copy button at the foot of each finished reply, shown on hover or focus, copying the reply's markdown; a "Copied" tick for a moment, through the same hook the code-block Copy uses.                                                                          |
| "These responses in Claude are clickable and open the output in the editor."                                                             | Claude Code opens a tool's output as a read-only tab named "Bash tool output (3g790o)".                                                                                                                                                                                                | A shell OUT, read or generic output block opens in an editor on click, Enter or Space: a `muse-output:` document named "`<label>` tool output (`<id tail>`)"; a stored output is paged in full (up to 16 MiB), else the transcript's copy is shown.             |
| "And the coding ones you can expand inline in chat … it expands into an editor … not just read-only either, you can modify."             | Claude Code clips a long inline diff behind "Click to expand", which opens an embedded, editable editor. Embedding an editor in the webview would need Monaco, a third-party package the owner has not authorised, and the real file is already editable in VS Code's own diff editor. | Inline diffs past the preview length are clipped behind "Click to expand": for an edit with a stored patch it opens the same diff editor as **Open diff** (the file side is editable); an edit without one unfolds inline. No embedded editor.                  |

<!-- plan-archive:end id="2-D18-01" -->

## D19 — The owner's second F5 round, on 0.4.1 (2026-09-22, night)

<!-- plan-archive:begin id="2-D19-01" lines="2374-2383" bytes="8738" sha256="2c78aec4be923d4da58d42e31a44563aded98fdcdc407309de89cebab5b2c0f7" -->

| Report                                                                                                                                                                                                                               | Finding                                                                                                                                                                                                                                                                                 | Decision                                                                                                                                                                                                                                                                                                                                                            |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| "The pill still does not show the loaded model until after clicked."                                                                                                                                                                 | M15 listed the models at panel open, but the pill reads `state.model`, which only a `sessionInfo` sets, and that was posted when a session started.                                                                                                                                     | The warm-up also posts `sessionInfo` with the model the first send will use (no session id), on every ready while no session exists.                                                                                                                                                                                                                                |
| "In Claude the thinking doesn't stay as expandable" (screenshots of "Thinking…" + summary, then "Thought for 14s")                                                                                                                   | Ours kept a button that expanded the summary parts after the fact.                                                                                                                                                                                                                      | While the model thinks: "Thinking…" with the summary parts streaming beneath. Done: a plain "Thought for Ns" line; nothing to expand.                                                                                                                                                                                                                               |
| "The file links in Claude open the file and highlight the change"; "you have these Open diff and Revert buttons, that's not how Claude handles that"                                                                                 | Ours had two text buttons under an edit row; the path was plain text.                                                                                                                                                                                                                   | The path of an edit or read row is a link: it opens the file and selects the changed lines (from the stored patch, else the visible diff; the first added run, else the first line shown). The buttons are gone; revert stays in the message's rewind menu (M13); the diff editor stays behind "Click to expand".                                                   |
| "We don't need the blue outline for the select-to-open responses."                                                                                                                                                                   | A hover/focus outline on the clickable output block.                                                                                                                                                                                                                                    | Removed; the pointer cursor and the tooltip remain.                                                                                                                                                                                                                                                                                                                 |
| "There is still no inline embed button that expands the code snippet into an editor."                                                                                                                                                | "Click to expand" appeared only past the preview length; Claude Code shows it on every inline diff (screenshot of a five-line diff with it).                                                                                                                                            | "Click to expand" on every edit diff with a stored patch (the diff editor, the file side editable); inline unfolding stays for a clipped diff without one. Shell and edit rows show their body from the start, as Claude Code's do; read and generic rows open on click, with the chevron.                                                                          |
| "The usage report should query when you open it, not need to wait for a chat call."                                                                                                                                                  | It does query (`usage/read`) on open; the CLI answers nothing until it has seen a reply. Re-probed 2026-09-22 with no model call: empty after a host start, after three seconds, after a session start, and five seconds later. There is no other source without using the CLI's token. | The dialog shows the last window the CLI ever reported, kept in extension global state and dated by its own "as of" time, until a fresh one arrives; a fresh one refreshes the cache. Documented as the CLI's limit.                                                                                                                                                |
| "Is this a bug? … approval ledger durability fence … (failed=0, pending=3)"                                                                                                                                                          | Yes, in Muse Code 1.3.0 on Windows: the decision applies, then the CLI's own approval-ledger flush fails and its reply to `approval/decide` carries the error. The panel relays it (M15 wording).                                                                                       | No change; recorded as a CLI fault beside `session/rename` and `session/fork`. Filed upstream on 2026-09-23 as meta-models/muse-code-sdk#29, beside #30 (rename) and #31 (fork).                                                                                                                                                                                    |
| "The question needs to be structured: stacked with checkboxes for multiple answers, radio buttons for single answer, tabbed for multiple questions, always an Other option, Submit and Cancel, Submit greyed out until a selection." | The card showed pill buttons in a row, no Other, no Cancel; Muse Code has `userInput/cancel` (the tool resolves with a cancelled result the model sees) and the answer shape carries `freeText`.                                                                                        | The card is rebuilt as described: native radio buttons or checkboxes stacked, an Other row with a text box on every question (typed text becomes `freeText`), one tab per question with a tick once answered, Submit disabled until every question has an answer, Cancel sends `userInput/cancel`; on the Model API the tool returns "the user declined to answer". |

<!-- plan-archive:end id="2-D19-01" -->

## D20 — Replying to an output and quoting the chat (2026-09-22, night)

<!-- plan-archive:begin id="2-D20-01" lines="2387-2398" bytes="3839" sha256="86a4ff224fd05ae71048847bd48a4d3b1f14adc76814e2c20bed5af32fbe0c96" -->

The owner asked for two things: a Reply action in the message actions menu
that "adds the proper context and makes the agent aware that the user is
replying to its output", and the ability to "highlight anything in the chat
and right-click on it to ask a question or make a comment about it with the
proper context payload provided to the agent". Findings and decisions:

| Question                                | Finding                                                                                                                                                                                      | Decision                                                                                                                                                                                                                                                                                                                                           |
| --------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| How the agent learns what is referenced | Neither MSP nor the Model API has a "reply to message" field; the M5 mechanism already carries hidden context as a text part (`<ide_selection>`) with the typed text kept as `displayText`.  | A `<chat_reference intent="reply\|question\|comment" from="assistant\|user\|tool">` part rides before the editor context: a lead sentence naming the intent and the author ("written by you, the assistant"), then the passage in a fenced block, clipped at 8,000 characters with a note. The transcript shows the typed text plus a chip.        |
| Where Reply lives                       | Claude Code's message menu is on user cards (fork / rewind); replies have a hover Copy. The owner wants a reply action on outputs.                                                           | Each finished reply gets a hover actions menu (⋯) beside Copy with "Reply to this output"; it sets the composer's reference chip ("Replying to: …") and focuses the box. The whole reply text is the payload.                                                                                                                                      |
| Highlight and right-click               | A webview's context menu is the browser's; a right-click can be intercepted only when there is something to offer. Menus positioned by coordinates would need inline styles the CSP forbids. | Right-click with a non-empty selection inside a transcript row (`data-entry-id` / `data-role` on user, assistant and tool rows) opens a small menu at that row's top-right: "Ask about this" / "Comment on this". Without a selection the browser menu is untouched. The selection text, the row's author and id go into the chip and the payload. |
| Several chips                           | The editor-context chip, attachments and a reference can all ride together.                                                                                                                  | One reference at a time (a new Reply or quote replaces it); it clears on send or with its ×, and the sent card keeps a "Replying to: …" / "Asking about: …" / "Commenting on: …" chip.                                                                                                                                                             |

<!-- plan-archive:end id="2-D20-01" -->

## D21 — The verification round: every screen seen, the live drills run (2026-09-23)

<!-- plan-archive:begin id="2-D21-01" lines="2402-2414" bytes="8377" sha256="f97d4ba6f8d1968122c42f907d2a18388712efd628cf52defd917937f23c0c06" -->

The owner: "finish this project, verify everything with the exception of
the market deploy … and visually verify everything as well." What was done
and what it found:

| Check                                | How                                                                                                                                                                                                                                                                                                                                                                                                             | Finding                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| ------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Every screen, M0–M17                 | The headless-Chrome harness (`npm run harness:shots`): the 30 existing scenarios re-rendered, 14 added for M13–M17 (the rewind menu, the agents pill and map, the map with delegation off, both usage modals, the banner, New messages, a thinking row, the question card on its second tab, the reply menu and chip, the quote menu and chip, a tool approval); each PNG viewed.                               | One wrong text: the usage modal said "the Model API has no local trace logs" on the CLI backend too when no logs were found; now "No Muse Code trace logs were found on this machine yet." Everything else rendered as designed.                                                                                                                                                                                                                                                  |
| Subagents live                       | The drill through the extension's own backend, delegation switched on through a temporary `XDG_CONFIG_HOME` (a settings file plus a copy of the CLI's credential file, deleted after; the owner's config untouched), first in `denyUnmatched`, then in `promptUnmatched` with the spawns allowed.                                                                                                               | **`subagent_spawn` is an approval-gated tool**: the CLI asks (`subject.kind = "tool"`, choices Allow once / Allow for this session / Reject) before spawning; `denyUnmatched` refuses it by policy and the model reports "denied by policy". In the panel's Manual mode the approval card appears and Allow once lets the agent spawn. The card now says "use `subagent_spawn`" and the row is labelled "Spawn agent". Results of the allowed run in `docs/certification/m18.md`. |
| The reply-only drill                 | `MUSE_LIVE_E2E=1 npm run test:e2e:live` on the 0.4.3 build.                                                                                                                                                                                                                                                                                                                                                     | The reply was "OK" in 79 s at 45 model attempts, over the 40 budget set from the single M13 measurement (31). Three measurements now (31, 45, 25 for a turn with two denied spawns): the CLI's three reminder agents loop a varying number of times per turn; the extension adds one hidden text part. Budget 60, the measurements in the drill's comment.                                                                                                                        |
| The integration tests                | `npm run test:integration` in a real VS Code 1.138.0.                                                                                                                                                                                                                                                                                                                                                           | 9 passing.                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| A child's items in the parent stream | The allowed drill, every item logged: a subagent's reply and tool calls reach the parent's stream as ordinary `agentMessage` / `toolCall` items whose `turnId` is the child session id (its own turn), so the panel showed the children's replies as replies of the conversation. `session/read` on a child session answers "not found" once the child is done, so the map's transcript read cannot serve them. | The reducer routes any item whose turn is a subagent's child session into that agent's transcript in the map (deltas included); the map shows the result envelope's full text as well. The trace classifier takes the CLI's own `native_subagent.child … child_run_id` marker (a child run is a `run_kind="turn"` too, so the turn flag alone misfiled it as the conversation's).                                                                                                 |
| Owner controls                       | MSP offers `subagent/interrupt`, `stop`, `resume`, `close`, `sendMessage` and `followupTask` (the SDK's `SubagentOwnerReasonParams`, `SubagentInputParams`, `SubagentTargetParams`).                                                                                                                                                                                                                            | `AgentSession.controlSubagent` / `messageSubagent` on both hosts (the Model API refuses: no subagents), the `subagentControl` / `subagentMessage` messages, and the map's controls by state: Interrupt and Stop with a note while running; Resume and Stop when paused; Close and a follow-up task once the result is ready; nothing once closed. The fake CLI answers them for the e2e.                                                                                          |
| The Marketplace                      | Published by hand on 2026-09-23 from the v0.5.0 release vsix (`npx vsce publish --packagePath`, the PAT from the clipboard, never stored); the `VSCE_PAT` repository secret was set the same day (the auto-mode classifier refused `gh secret set` and the browser route; the owner switched permission modes and the same command ran), so the release workflow publishes every later tag itself, 0.5.1 first. | 0.5.0 on the Marketplace; 0.2.0–0.4.3 were never published, each tag's GitHub Release carries its vsix. The three Windows CLI faults went upstream the same day: meta-models/muse-code-sdk#29 (approval ledger fence), #30 (`session/rename`), #31 (`session/fork`).                                                                                                                                                                                                              |

<!-- plan-archive:end id="2-D21-01" -->

## D22 — Issue #4: the prompt box grows with wrapped lines (2026-09-23)

<!-- plan-archive:begin id="2-D22-01" lines="2418-2428" bytes="3440" sha256="256b7d8fa3a7392ca3fe841cd2be8ef1dd4b1271f58e04a55406c4baa01c0aa5" -->

The first community issue, RandyNorthrup/muse-spark-code#4 (dhaw97160):
"The chat input box only displays a single line. When the input gets a bit
longer, only one line remains visible, which makes editing and reviewing
very awkward." Asked for: one row for short input, growth as lines wrap or
newlines are added, a sensible maximum, internal scrolling past it, the
behaviour of VS Code's own chat view.

| Report                                                                    | Finding                                                                                                                                                                       | Change                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| ------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| "Only a single line … when the input gets a bit longer, only one remains" | The textarea's `rows` came from `rowsFor(draft)`, the newline count, so a long line that wrapped stayed one row (M1); newlines grew it, which is why the F5 rounds missed it. | `rowsFor(draft, metrics)` takes the content height in rows when the box can be measured (a browser: `scrollHeight` over the one-row `clientHeight`), else the newline count (jsdom reports 0 for both, which keeps the existing tests meaningful); `fitRows` sets one row, measures and sets the rows, from a layout effect on the draft (before paint) and from a `ResizeObserver` when the width changes (a resized sidebar rewraps). The cap stays `COMPOSER_MAX_ROWS` (ten); past it the textarea scrolls inside. |
| "Match the VS Code built-in chat view"                                    | VS Code's chat input grows to a maximum and scrolls; so does Claude Code's.                                                                                                   | Same shape: one row, growth, ten rows, internal scroll. Verified in the harness: `composer-grow` (a two-line wrapped draft) and `composer-max` (fourteen lines, ten shown).                                                                                                                                                                                                                                                                                                                                           |

<!-- plan-archive:end id="2-D22-01" -->

## D23 — Rewind across subagents (2026-09-23)

<!-- plan-archive:begin id="2-D23-01" lines="2432-2441" bytes="4135" sha256="4009628f54d27841512b6f782c193f5ca4176c4fa9c2b8aac9ec42dec9467877" -->

A reader on Facebook asked how the rewind handles state when several
subagents touched overlapping files in one run: per-step diffs, or git
checkpoints rolling the tree back? The code answered the first half (per-edit
patches, unwound newest first, each hunk checked against the file, no git)
and exposed a gap in the second.

| Report                                                                     | Finding                                                                                                                                                                                                                                                                                                                                                                                                      | Change                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| -------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| "Does it track diffs per subagent step or roll back the tree?"             | Per edit: every edit row carries the CLI's patch document; `editsAfter` collected the completed edit rows after the message from the conversation transcript and the host reverted them newest first, each hunk matched against the file first (`revertHunks`). Since M18 a subagent's rows live in `childTranscripts`, so `editsAfter` never saw them: a delegated run's edits survived a rewind, silently. | `UiState.sequence`, a monotonic arrival counter; user cards take it as `seq`, tool rows as `completedSeq` when they complete (live, in a child transcript, or replayed from history). `editsAfter(state, messageId)` gathers the completed edit rows of the conversation and of every child transcript whose `completedSeq` is past the message's `seq` and sorts them by it, newest first, so overlapping edits from any agent unwind in the reverse of the order they landed on disk. |
| "Stepping back one agent's change gets messy once later edits build on it" | True, and the design never offered it: the rewind undoes everything after a point (the per-edit Revert button went in M16), and `revertHunks` refuses a file that no longer matches, with a notice, instead of guessing.                                                                                                                                                                                     | No change; the README says so in as many words.                                                                                                                                                                                                                                                                                                                                                                                                                                         |

<!-- plan-archive:end id="2-D23-01" -->

## D24 — The audit: security and confinement (2026-09-23)

<!-- plan-archive:begin id="2-D24-01" lines="2445-2473" bytes="18282" sha256="be7785bdd0533e3ad9f35d1b242fa8d013baab5991613efc1a38304d41fa0593" -->

The owner asked for a deep scan of the whole codebase and of other
harnesses' trackers for gotchas ("don't cite from memory, do the
research"), then: "fix it all so we have enterprise grade production ready,
no gaps or gotchas, no todos or workarounds or deferrals". Eight read-only
passes (five code sweeps, three research passes over the Claude Code,
Cline, Roo Code, Codex, Kilo Code and Continue trackers, the VS Code
documentation and issues, and the Muse SDK tracker) produced about 150
rows in six sections; the local catalogue is `temp/audit-2026-09-23.md`
(git-ignored until the fixes ship). The work is split by section: M21
(security, this decision), M22 (processes and lifecycle, D25), M23
(protocol, D26), M24 (editing correctness, D27), M25 (webview and UI state,
D28) and M26 (packaging, CI, platform and voice, D29). M25 and M26 were
built in parallel by two agents in their own worktrees under strict file
ownership; M21–M24 share their files and run in order. Section A's rows:

| Report                                                                                         | Finding                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            | Change                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| ---------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Path confinement is textual only                                                               | `resolveWorkspacePath` compared strings; a symbolic link or junction inside the workspace let every file tool read or write outside it, and reads need no approval in any mode. No `realpath` anywhere in the code. `a.txt:stream` (NTFS alternate data stream) was accepted; `..env` was refused as an escape.                                                                                                                                                                                                                                                                    | `ToolIo.realPath` (`src/host/canonicalPath.ts`: the real path of the nearest existing ancestor plus the missing tail) and `confineWorkspacePath`: the textual check, then the same check on the canonical forms. The tools, the rules loader's `touch`, the search worker (per file) and `EditReview` (before a revert or rewind writes) use it. Windows segments with `:`, device names or a trailing dot or space are refused; `..` is matched as a whole segment.                                                                                                                    |
| git runs in Restricted Mode                                                                    | The mention index and the Model API prompt's environment facts ran `git ls-files`, `status` and `log` in an untrusted folder; `.git/config` can name programs git runs (`core.fsmonitor`, `core.hooksPath`). The manifest said the extension "runs no shell commands" there. Probed 2026-09-23 (Node 24.20, libuv 1.52.1, Windows 11): with `hostname.exe` copied to `git.exe` in a folder, `execFile('git', …, { cwd: folder })` ran the planted copy whenever the parent's environment lacked `NoDefaultCurrentDirectoryInExePath`, and ran it regardless with a `.` PATH entry. | No git while the workspace is untrusted (the index uses VS Code's file search, the prompt says "no git"); the index is rebuilt when trust is granted. `src/core/executables.ts` resolves a program on absolute PATH entries only (`.exe`/`.com` on Windows); `src/host/git.ts` runs git by that path with a 15 s timeout, `windowsHide`, `GIT_TERMINAL_PROMPT=0` and `GIT_OPTIONAL_LOCKS=0` (a background `git status` never takes the index lock). The shell tool's bash or PowerShell and the Muse Code CLI search are resolved the same way; a relative `museBinaryPath` is refused. |
| Auto writes git hooks without a card                                                           | `isProtectedWrite` was hard-coded `false` on the Model API backend; in Auto (`onRequest`) and after "always allow" every edit ran, including `.git/hooks/pre-commit` and `.vscode/tasks.json`. Roo Code 3.20.3 shipped the same fix ("prevent auto-approving edits of configuration files").                                                                                                                                                                                                                                                                                       | `isProtectedPath` over the canonical path, any depth, any case: `.git`, `.husky`, `.vscode`, `.idea`, `.devcontainer`, `.github/workflows`, `.agents`, `AGENTS.md`, `CLAUDE.md`, `.envrc`, `.gitmodules`. A protected write asks in every mode but Bypass (Plan refuses), session rules never cover it, and the card carries the flag.                                                                                                                                                                                                                                                  |
| A ReDoS in the glob                                                                            | The glob became a regular expression with nested `.*`; `**a` twelve times plus `b` (37 characters) held the extension host for 25 s. §8 had claimed "bounded pieces … short relative paths": that claim was wrong.                                                                                                                                                                                                                                                                                                                                                                 | `compileGlob`: brace expansion (nested, at most 256 alternatives), then a table match over pattern × path, linear in both; no regular expression, so the §8 row is gone. `[!x]` / `[^x]` negate, `]` first in a class is a member, `./` is dropped. Compiled once per call.                                                                                                                                                                                                                                                                                                             |
| "Allow for session" on a shell approves every later command; an unknown choice counts as a yes | Session rules were keyed on the tool name; `decideApproval` treated any choice id but `abort` as approval.                                                                                                                                                                                                                                                                                                                                                                                                                                                                         | Shell rules are keyed on the exact command line (the card says which); only `allow_once` / `allow_session` approve, and an unknown id is rejected.                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| Bypass survives the setting turned off; a dev container can switch it on                       | The setting was read only when a mode was chosen. `devcontainer.json` `customizations.vscode.settings` are written as machine settings on the remote side, where both Bypass settings are honoured.                                                                                                                                                                                                                                                                                                                                                                                | Turning `allowDangerouslySkipPermissions` off moves every controller out of Bypass (and drops a session whose host refuses the change). In a remote window a conversation never starts in Bypass (a notice says why) and entering it needs a modal yes once per conversation.                                                                                                                                                                                                                                                                                                           |
| Resume can adopt a contributor-tier model silently                                             | `adopt` took the catalogue's active model without `allowsModel`.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   | The same yes (or the confidential-workspace block) as choosing one; declined or blocked, the session moves to the default standard model with a notice; a refused switch drops the loaded session.                                                                                                                                                                                                                                                                                                                                                                                      |
| "Edit automatically" behaves like Manual                                                       | No code answered edit approvals, though `permissionModes.ts` said the extension would; the README promised it. And on Muse Code, Manual applies in-workspace edits without an approval (M4, live), so the Modes menu's "ask before each edit" was false there.                                                                                                                                                                                                                                                                                                                     | The controller answers a plain file-write approval (Model API `fileWrite`, Muse Code `fileAccess` with `access: write`) with the allow-once choice and labels the resolution "Edit automatically"; protected writes, judge escalations, staged commands and other modes show the card; a refused answer shows the card after all. The Modes menu's lines come per backend (`permissionModeDetail`).                                                                                                                                                                                     |
| The shell inherits the extension host's plumbing                                               | `ELECTRON_RUN_AS_NODE=1` turns a `code` command into plain Node; the `VSCODE_*` IPC handles reach the model's commands; a pwsh 7 `PSModulePath` breaks Windows PowerShell 5.1.                                                                                                                                                                                                                                                                                                                                                                                                     | `shellEnvironment`: the removal list of VS Code's own `sanitizeProcessEnvironment` (fetched from microsoft/vscode `src/vs/base/common/processes.ts`), the user's variables kept (a developer's tests may need their own `META_API_KEY`), and the 5.1 module path set case-insensitively (`setEnvironmentVariable`: an inherited `PSMODULEPATH` would otherwise win Node's sort).                                                                                                                                                                                                        |
| Logs and the report leak more than they should                                                 | Redaction missed JWTs, basic credentials, token fields and URL user-info; CLI stderr was logged whole; the diagnostics report, meant for public issues, held the user's home path.                                                                                                                                                                                                                                                                                                                                                                                                 | Seven patterns in `redactSecrets`; stderr chunks capped at 4,096 characters; `homeDir` written as `~`.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| The manifest said "no workspace can set them"                                                  | True of `.vscode/settings.json`, false of a dev container definition in a remote window.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           | Reworded, with the remote-window behaviour above.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| The release workflow's secret scope                                                            | `VSCE_PAT` was a job-level variable while `npm ci` ran every devDependency's install script.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       | Owned by M26 (the workflows have one owner); D29 records it.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |

<!-- plan-archive:end id="2-D24-01" -->

## D25 — The audit: processes and lifecycle (2026-09-23)

<!-- plan-archive:begin id="2-D25-01" lines="2477-2569" bytes="10003" sha256="4d69d8b2119e6896379adc98b0ef05cd248e4a8681364f3c520a63cc3ad09ae6" -->

Section B of the audit (D24), plus the lifecycle rows of section G.

- **Report:** A shell timeout or Stop hangs the turn
  **Finding:** `child.kill` ended bash or PowerShell only; the result waited for the pipes to close, so a background grandchild (`server &`) held the tool call open for its whole life; Stop never reached the command (Claude Code #90672 is the same bug).
  **Change:** `runCommand`: POSIX commands lead their own process group and the group is killed; Windows uses `taskkill /T /F` (`processTree.ts`), never on a process that has exited. The result settles on exit plus a 250 ms drain; the turn's abort signal reaches the command; the result says "stopped by the user". Output is kept head and tail per stream (`BoundedText`, a `StringDecoder` per stream).

- **Report:** `taskkill /T` misses a child started during the kill (M27, found at the 0.6.0 gate)
  **Finding:** `taskkill` kills the tree it enumerated: a child PowerShell started between that enumeration and its own end survived, orphaned. Under load it happened on every kill (the gate's `toolIo.test.ts` folder stayed held by the ping); one orphan was left suspended for good. A launcher that exits (`cmd /c start`, a nested shell) leaves its child with no parent link to follow at all (the review of PR #12).
  **Change:** Each Windows command joins a named job object first (`shellJob.ts`: a C# helper compiled once into the extension's storage by `Add-Type`, self-tested), so everything it starts belongs to the job from its creation; Stop and timeouts call `TerminateJobObject`, which ends them all at once. No kill-on-close, so a command that ends normally leaves its background processes running, as on POSIX. Where no job can be made (Constrained Language Mode forbids `Add-Type`; the log says so), the fallback is `taskkill /T` and then a sweep of the process table (`Get-CimInstance Win32_Process` by `ParentProcessId`, Windows PowerShell with one `PSModulePath` spelling), one generation per round, five at most: a child counts only if it was created after the shell started and before its parent died, and each is killed in the same PowerShell run that checks its creation time. A killed command's result waits for all of it.

- **Report:** A deliberate restart is treated as a crash
  **Finding:** Trust granted, a sandbox or backend change, a sign-in: the extension disposed every controller and the host's exit listeners called `markBackendError`, so every panel refused to send; one exit listener was added per message.
  **Change:** `MuseCodeHost.close()` marks its exit expected; `HostExit { description, isExpected, isPersistent }` goes to the listeners (one per host, a `WeakSet`). Before a restart each controller cancels its running turn, ends it in the webview and remembers its session; the next message resumes it (`resumeAfterRestart`), on the same backend kind only; a sign-out ends the conversations. A crash ends the running turn the same way and says the next message continues; only a persistent exit (configuration, usage, SDK surface) shows the sign-in gate's error. `museBinaryPath`, `environmentVariables` and VS Code's proxy settings now restart the host too.

- **Report:** No handshake or command timeout
  **Finding:** The SDK waits for ever (its INV-006).
  **Change:** `withDeadline`: 30 s for the handshake (the process is closed when it misses it), 60 s per command, 180 s for resume, fork, read and compact. The fake CLI's `silent` mode proves the handshake case end to end.

- **Report:** A replaced host's late exit orphans the new one
  **Finding:** The exit handler cleared `hostPromise` whatever it held; a wrapper that failed to build left `muse serve` running.
  **Change:** A generation per spawn: an attempt clears only its own slot; a wrapper failure closes the process.

- **Report:** Mid-turn death, restart or sign-out leaves the UI running
  **Finding:** No terminal event reached the webview; the next message started a new session with no context; Clear and Resume left the CLI's turn running.
  **Change:** A synthetic `turnCompleted` (cancelled or failed, with the reason) ends the turn; the session is resumed; dropping a session cancels its running turn first.

- **Report:** An exception in the notification handler
  **Finding:** The SDK's single handler threw on a bad payload and the connection went deaf; a bad stored archive list threw on every read.
  **Change:** The handler catches and logs; a connection that closes while the process lives closes the host so the exit is reported; the archive list is `safeParse`d.

- **Report:** Races
  **Finding:** Two quick sends created two sessions; a panel closed during a start kept the session; two panels on one session shared a handle and closing one deafened (Model API: cancelled) the other.
  **Change:** A shared start (`openSessionOnce`); `isDisposed` checked after every await; handles are reference-counted on both backends.

- **Report:** The host closes the panel's own session
  **Finding:** `session/closed` was only heard by the History dialog; the next command failed `sessionNotLoaded`.
  **Change:** The controller watches its own session; `sessionNotLoaded` becomes `SessionNotLoadedError`, answered by resuming and retrying the message once.

- **Report:** The Model API host before its sessions are read
  **Finding:** Published before `load()` finished; a failed load was cached.
  **Change:** One build shared by every caller, forgotten on failure; a build that finishes after a dispose closes itself.

- **Report:** Sign-in accepts a stale credential file
  **Finding:** Success was "the file exists", so an expired sign-in counted at once; each click opened another terminal.
  **Change:** Success is a credential file written after the login started (its modification time); a second click joins the first.

- **Report:** Secret storage failing blocks the CLI backend
  **Finding:** On Linux without a keyring `SecretStorage.get` throws; the backend selection awaited it.
  **Change:** `getApiKey` reads a failure as "no key" and logs it once.

- **Report:** CLI resolution probes PATH on every message
  **Finding:** Synchronous `existsSync` over every PATH entry per send (a dead UNC share blocks the host).
  **Change:** Resolved once per inputs (setting, PATH, flags), re-checked with one probe, invalidated by the sign-in gate and the settings that change it.

- **Report:** The Windows launcher fallback
  **Finding:** Without `.muse-version` the CLI was started through its PowerShell launcher; Windows ends only the direct child, so closing it left `muse-bin` running.
  **Change:** The newest `muse-bin-*.exe` in the folder (version order); the launcher is never the command.

- **Report:** No `deactivate`; shutdown fire-and-forget
  **Finding:** Hosts were closed from a disposable nobody awaited.
  **Change:** `deactivate()` awaits the same stop, conversations ended.

- **Report:** The IDE tool server
  **Finding:** No error listener after `listen`; a failed start was never retried; a rejected request handler was unhandled.
  **Change:** A permanent error listener; a shared, retryable start; a failed request answers 500.

- **Report:** Model API retries
  **Finding:** The retry sleep ignored Stop; an HTTP-date `Retry-After` was ignored; the transcript never said a request was being retried; the model list had no deadline.
  **Change:** An abortable wait; both `Retry-After` forms; `turnRetry` events as Muse Code's; 30 s deadlines on the model list and the token count.

- **Report:** The CLI and VS Code's proxy
  **Finding:** `muse serve` did not see `http.proxy`.
  **Change:** `HTTPS_PROXY` / `HTTP_PROXY` (and `NO_PROXY` from `http.noProxy`) when the environment has none.

- **Report:** The login terminal off Windows
  **Finding:** `"path" login` in the user's default shell breaks under pwsh or nushell.
  **Change:** The terminal runs `/bin/sh`.

- **Report:** The CLI's config root drifts from the sign-in check (Claude Code #66499)
  **Finding:** An `XDG_CONFIG_HOME` in `museSpark.environmentVariables` moved the CLI's credentials and settings, but the extension looked under the host's own environment.
  **Change:** The credential file, `settings.json` and the personal skill root are read under the CLI's environment.

- **Report:** The terminal environment (Cline #7793)
  **Finding:** The Model API shell ignored `terminal.integrated.env.*`.
  **Change:** Applied as VS Code's terminal applies it (`${env:…}`, `${workspaceFolder}`, `null` removes).

- **Report:** `windowsHide` on every spawn
  **Finding:** Every spawn the extension makes hides its window; the SDK's own `spawnMspConnection` has no such option and spawns without it (VS Code's extension host has a hidden console, which children inherit, so no window shows). Filed as meta-models/muse-code-sdk#34 (2026-09-23).
  **Change:** Recorded; nothing the extension can pass. **Fixed in SDK 1.4.4 (2026-10-09, SDK144):** every `MuseServeChild.spawn`, the public `spawnMspConnection` included, passes `windowsHide: true` (FR-45141-1; the issue is still open upstream). `test/unit/museCodeSdk142.test.ts` pins it.

- **Report:** A slow start is killed, and its failure shown by every waiter (0.10.1)
  **Finding:** On a CPU-starved machine (an activation that took 211 s) `muse serve` missed the 30 s handshake deadline and was killed though its process still ran; each caller waiting on that one start (six skill listings from the palette and slash menu, the warm-up) showed its own "That did not work" card for the same failure.
  **Change:** A process still running at 30 s gets one longer wait, 120 s in all (`withSlowDeadline`, `MSP_SLOW_HANDSHAKE_TIMEOUT_MS`); one that exits fails at once. The controller shows a failure once (`shownFailures`, by the error the shared start rejected every waiter with): a message on its own card, another action's card, else the warm-up's notice after every other waiter had its turn; skill listings only log. The next action starts afresh.

<!-- plan-archive:end id="2-D25-01" -->

## D26 — The audit: protocol and backend semantics (2026-09-23)

<!-- plan-archive:begin id="2-D26-01" lines="2573-2597" bytes="18545" sha256="393f6ad45f6b6834161eb84e6f4574289e7647c85bb1e17bfbcc0f871926469c" -->

Section C of the audit (D24), plus the two `send()` companions of D28 (the
images of a refused message, a late acceptance). The Muse Session Protocol
facts come from the SDK's `msp.d.ts` and `connection.js` (0.x, pinned in
`package-lock.json`) and the live 1.3.0 capture of 2026-09-21. "Edit
automatically" was M21's (D24) and the exit codes M22's (D25).

| Report                                                       | Finding                                                                                                                                                                                                                                                                                                    | Change                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| ------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| A tool call left without an output (Model API)               | The call was saved before it ran; Stop on its card, or a tool that threw (`write_file` into a missing folder), left a `function_call` with no `function_call_output`, and every later request replayed an invalid conversation.                                                                            | `finishCall` records an output for every call: the tool's, its error, or "cancelled: the user stopped the turn" for the call Stop cut off and each one after it in the response. `write_file` creates the folders.                                                                                                                                                                                                                                                                                                                                                                                           |
| A message typed during the final answer is lost              | `turnAccepted`, then the loop ended without reading it.                                                                                                                                                                                                                                                    | The loop runs another round while anything is steered in; `steer` is refused once the turn has ended, so nothing falls between.                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| A resume parks the turn with no card                         | The CLI re-issues pending prompts as `approval/request` / `userInput/request` server requests right after the `session/resume` answer, and the extension refused them; the SDK hands every frame of one read to its handlers before the awaiting command resumes, so they arrive before the handle exists. | The request is answered with the presentation receipt `{}` (msp.d.ts `RequestReceipt`) and shown as the notification it mirrors. Events for a session a start, resume or fork has in flight wait for its handle; a handle holds its events until its first listener. `approval/listPending` pulls the prompts the resume's `pendingRequests` name. A `PromptLedger` per session shows one card per prompt and stage (the live notification and its server-request mirror, a re-issue), and gives a second surface the prompts still open. The resume's `activeTurnId` becomes the controller's running turn. |
| The handshake facts are dropped                              | `platformOs`, `schema`, `sessionDurability` were never read; rename and fork fail on Windows 1.3.0 (meta-models/muse-code-sdk#30, #31) after the user asks.                                                                                                                                                | Logged at start (a non-durable host is a warning). `HostInfo.canEditSessions` is false on Windows up to 1.3.0: the panel hides Rename and Fork (the rewind stays), and the host refuses a fork before sending it.                                                                                                                                                                                                                                                                                                                                                                                            |
| A late decision reads as an error; a failed one locks a card | `approval/decide` is admission only. A stale, resolved or missing prompt came back as a warning; any failure left the card locked.                                                                                                                                                                         | `approvalRequirementStale` / `…AlreadyResolved` / `…NotFound` and the `userInput` pair become `PromptSettledError`: an information notice, the card follows the host's own events, and a prompt the host no longer holds loses its card (`promptDropped`). Any other failure keeps the #29 warning and opens the card again (`approvalReopened`).                                                                                                                                                                                                                                                            |
| A stage re-prompted after a terminal decide                  | `change.kind` and the ack's `terminal` were dropped (the SDK facade's #37538 note).                                                                                                                                                                                                                        | A `terminal: true` ack and `change.kind: alreadyTerminal` close the approval in the ledger; later stage updates for it are dropped until it resolves.                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| Notifications dropped without a word                         | A malformed frame vanished; `view/gap`, `turn/unqueued`, `turn/retracted`, `session/modelRouteUnserved` were unhandled.                                                                                                                                                                                    | One log line per method (unshown: info; malformed: warning). A gap re-reads the session and replaces the transcript (again if another gap arrives meanwhile), the running turn and the usage kept (`historyLoaded.activeTurnId`). A withdrawn queued turn is a `turnWithdrawn` event: its message reads "Not sent" and the running turn runs on. A retract and an unserved model route are notices.                                                                                                                                                                                                          |
| Compaction is not a turn (Model API)                         | Sends during it were wiped; it could not be stopped.                                                                                                                                                                                                                                                       | It runs as a turn: sends queue behind it, Stop cancels it (the conversation stays as it was) and ends every queued message with "Not sent: Stop cleared the queued messages". A context size that cannot be counted is logged, not thrown.                                                                                                                                                                                                                                                                                                                                                                   |
| Token numbers mean different things per backend              | Muse Code sent one completion's raw counters, the Model API a session total.                                                                                                                                                                                                                               | Both report session totals: Muse Code's `cumulative.promptTokens` (counted once) and `outputTokens`. The cached rows show only where the backend can total them honestly (the Model API); Muse Code's raw cache counters do not sum across providers.                                                                                                                                                                                                                                                                                                                                                        |
| The 10 MiB frame cap                                         | The host drops an oversized frame without answering it; `onProtocolError` was not registered.                                                                                                                                                                                                              | A command over the cap is refused before sending, with the reason; protocol errors are logged by kind, never with the frame; the refused message's images stay for another try (`sendFailed.attachmentsKept`, the D28 companion).                                                                                                                                                                                                                                                                                                                                                                            |
| `session/list` over its maximum                              | 200 is the documented cap.                                                                                                                                                                                                                                                                                 | Clamped in the host.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| The SDK keeps every command for ever                         | `Connection.command` memoizes each command's canonical payload (an image turn's base64 included) for replays across reconnects the extension never makes. Filed as meta-models/muse-code-sdk#35 (2026-09-23).                                                                                              | `sendCommand` over the public `connection.request`: the same `commandId` contract (echo checked) and the same retry of `overloaded` / `backpressured` refusals (3 attempts, jittered, ≤2 s), nothing remembered.                                                                                                                                                                                                                                                                                                                                                                                             |
| SSE edge cases (Model API)                                   | `data: [DONE]` or an empty keep-alive would fail JSON parsing; a CRLF split across two chunks read as two line breaks.                                                                                                                                                                                     | Both skipped; a chunk ending in `\r` holds it for the next.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| Output pages                                                 | Model API pages were cut at byte offsets (U+FFFD mid-character in Revert patches); the CLI's `encoding: base64` was ignored.                                                                                                                                                                               | Pages start and end on character boundaries, as the CLI serves them; a base64 page is shown when it decodes as UTF-8 and refused as binary otherwise.                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| The Model API session store grows for ever                   | Every session was read whole into memory at start; a crash left `.tmp` files; Windows refuses a rename while a scanner holds the file (Codex #29812, Claude Code #89075).                                                                                                                                  | The window keeps headers and reads a session whole when it is opened (after the saves queued before it). Sessions idle past `museSpark.cleanupPeriodDays` (Claude Code's `cleanupPeriodDays`, default 30, 0 keeps them) are deleted when the list is read. A `.tmp` older than a minute is removed; `EPERM` / `EACCES` / `EBUSY` renames are tried five times, the wait doubling from 25 ms.                                                                                                                                                                                                                 |
| Stop and refusals (Model API)                                | Queued messages vanished on Stop; a refusal part rendered as an empty reply.                                                                                                                                                                                                                               | Each queued message ends with the reason above; a refusal's own words are the reply.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| A late acceptance makes a finished turn "running"            | `send()` set the active turn from the ack, which can land after its own `turn/completed` (the D28 companion), and from a queued turn.                                                                                                                                                                      | The controller remembers finished turns; neither a finished nor a queued turn becomes the running one, and a `turnCompleted` for another turn leaves the running one alone.                                                                                                                                                                                                                                                                                                                                                                                                                                  |

<!-- plan-archive:end id="2-D26-01" -->

<!-- plan-archive:begin id="2-D26-02" lines="2628-2992" bytes="22923" sha256="ccc7d68b1a2c8f7a072ba3e5fc0fced77a7f8fa7b4f09f48c4366cc29fdb7919" -->

- `windowsHide` (#34, D25): fixed in 1.4.4; nothing of ours to remove (the
  extension never had an option to pass).
- One notification handler (D3): still needed; `onNotification` replaces
  its handler.
- The deep `ChildStdioTransport` import and our own account spawner (M108):
  still needed; 1.4.4 adds no public hook before a write.
- The POSIX PID side file (M107): still needed; `MuseServeChild` still has
  no PID.
- The fingerprint map: 1.4.4-R5419.1 replaces 1.4.2-R4684.1 (served
  capture `test/fixtures/sdk144/msp-echo-1.4.4.json`); 1.4.2 now warns.
- Windows sandbox under the profile (#26, open; D12), the `.cmd` spawn
  (D1a), the approval ledger fence (#29, closed upstream 2026-10-05): not
  retested (no Windows CLI in this lane); kept.
- The approval replay fault and the event-log-failed session (1.4.2), the
  hooks that do not fire (#84 SessionFork, StopFailure): not retested; each
  needs live turns, which this lane does not make. Kept.
- PDF input on Muse Code (#48, open): still needed; 1.4.4 adds `video`, not
  a file part.

New in MSP 1.4.4, worth adopting later (not built; rule 13 needs a captured
frame for each first):

- `video` turn input parts and chunked `media/upload` (`uploadId`): video on
  the Muse Code backend, and the chunked upload path #48 asked for.
- `session/sideChat` with `SideProvenance`: Muse Code's own side chat.
- `hook/list` and `plugin/list`: the Hooks picker and plugin catalogue from
  the host.
- `skill/setActivation`: turn a skill on, off or user-invocable only.
- `userInput/interrupt` and `userInput/engaged`: answer part of a question
  and stop, and see when another surface engaged it.
- `workflow/pause` and the item status fields (`statusHealth`,
  `statusProgress`, `statusStep`, `toolReceipt`): richer workflow and tool
  cards.
- `turn/foregroundCompleted` and `Session.lastTurn`: show when the
  foreground turn ended while agents still run, and a session's last result
  in History.
- `computerUseSettings/read|update`: the host's computer-use settings.
- `MuseHostStartError` from the facade: typed spawn failures, if the facade
  is ever composed.

**Amendment 2026-09-27 (0.9.1): Windows limits hold for every version.**
D26 hid rename and fork on Windows, and D12's profile-workspace warning
applied, only up to Muse Code 1.3.0 (`WINDOWS_SESSION_EDITS_LIMITED_MAX_VERSION`,
`SANDBOX_PROFILE_LIMITED_MAX_VERSION`), on the assumption that the next
release would fix them. 1.4.0, which Meta's launcher installs by itself,
fixed neither (#26, #30, #31 re-tested live on `1.4.0-R4302.1`), so 0.9.0
offered Rename, conversation rewind and Side chat there again, and each
failed; the sandbox warning disappeared too. Both limits now apply on
Windows to every version, with no version ceiling: a limit is lifted only
by a release after a Muse Code version is verified to fix it. Showing an
action that fails is worse than hiding one that would work.
`docs/certification/release-0.9.1.md`.

**Amendment 2026-10-05 (MUSE143): #29 has a verified update floor; the
other Windows limits remain.** On `1.4.3-R5018.1`, one contributor-model
shell approval returned accepted/terminal with no ledger fault. The
upstream #29 closure supplied by the owner names 1.4.3 as the fix. An actual
ledger fault on an older attached host now suggests updating with the
existing installer command and restarting; newer or unknown hosts keep
the defensive notice. No warning is shown without an actual fault.
Rename (#30) still returns `internal` / session naming unavailable; fork
(#31) still returns `forkBoundaryInvalid` / WriteFailed. Their Windows
gates therefore retain no version ceiling. The sandbox (#26) printed the
workspace cwd here but denied a shell file write; this prepared-host
capture does not certify the fresh-setup non-completion fixed. D12's
profile workaround remains. One turn, six model attempts; exact scrubbed
frames and scope in `docs/certification/muse143.md`.

**Amendment 2026-09-27: the CLI's sign-in is read, not assumed**
(`fix/cli-sign-in-detection`; evidence in `docs/certification/sign-in-detection.md`).

- **The finding.** `muse logout` rewrites `auth.json` as
  `{"schema_version": 1, "providers": {}}` and never deletes it. This was
  seen on 1.3.0 Linux and on 1.4.0 Windows and Linux, in isolated homes.
- **What it broke.** "Signed in" had been "the file exists". So after any
  sign-out the auto backend stayed on Muse Code, and M55's logout hold
  waited for a deletion that never came.
- **macOS.** A sign-in is a login Keychain item (`ai.meta.dev.credentials`,
  account `meta`), and the file is a token-free pointer
  (`schema_version: 2`, `storage: "keychain"`).
- **The structural read (`src/core/backends/musecode/credentialFile.ts`).**
  Only four facts are kept: the schema version, which providers are
  named, each provider's `storage` lane, and whether `meta` carries
  `api_key` or `access_token` (the parse replaces a key's value with
  `true`). The parse drops every other field. Only `providers.meta` speaks
  for the sign-in: 1.4.0-R4302.1's bundled Slack connector reads its own
  `providers.slack_connector` from the same file (PR #49 review). It
  decides:
  - no file → signed out, with no process;
  - the empty version-1 file a sign-out leaves → signed out, on every OS;
  - off macOS, a `meta` entry in a captured inline shape (no `storage`,
    and `api_key` or `access_token`) → signed in;
  - a `meta` entry in any other shape (another `storage`, or no captured
    key), or other providers alone → asked of the CLI;
  - on macOS, a version-1 file holding the credential and an empty
    version-2 file → asked of the CLI: nobody captured whether 1.4.0 reads
    or migrates them there (review round 4);
  - off macOS, any version-2 file (the empty one included) or a `meta`
    whose storage is the Keychain → a named error. `muse serve` exits 3
    at startup with each of the three on Windows and on Linux
    ("unsupported auth schema version 2"; "keychain item for meta is
    unreadable"), captured 2026-09-27 on 1.4.0-R4302.1 (Windows 11 and the
    Kubuntu VM). With `META_API_KEY` set it starts with each of the three
    and answers `envKey` on both, so the key wins over those files; macOS
    was not probed with the key.
- **Asking the CLI.** A Keychain pointer on macOS, any other file on macOS
  but the sign-out's, or a file the read cannot place, is asked of the
  CLI: `account/read` on a short-lived `experimentalApi` host.
  - The answer is kept until the file's size or modification time changes,
    or until a sign-out, a device sign-in or Check again forgets it. Cancel
    only leaves an unanswered probe behind, so what it shows next asks
    nothing new; a sign-out that cancels a sign-in forgets the answer too,
    so it never skips `account/logout` on a stale `signedOut`. Presses of
    Check again while one runs join it: one host, one question.
  - On macOS the CLI is asked only on a user action (Check again, sign-in,
    sign-out, the Sign Out and Diagnostics commands), so a Keychain prompt
    follows a click.
  - `unknown` counts as signed in, as before; a turn's `authRequired`
    still corrects it.
- **Sign-out.** It uses MSP `account/logout` on a short-lived host (the
  chat host has no `experimentalApi`, and sign-out stops it first). The
  result is confirmed by `account/read`. When that does not confirm it
  (`META_API_KEY` makes it answer `envKey`), the sign-in is read afresh;
  only a sign-in still there opens the terminal `muse logout`, with
  `museSpark.environmentVariables`, confirmed later by the file or the CLI.
  A sign-out that keeps the hold is published as `error`, the state the
  panel offers Check again in. A refresh that answers after a sign-out
  ended leaves the hold as that sign-out left it.
- **M55's device flow signs in on:**
  - `account/read` turning `accountLogin` on the open host;
  - or a new file that `account/read` does not contradict.

  This supersedes M55's "accept only after a new credential-file
  modification". `account/changed` is not relied on: neither a terminal
  `muse logout` nor an expired code fired it.

- **How it ends otherwise (PR #49 review, live capture).** Every ending
  was captured on 1.4.0-R4302.1 in throwaway homes (`test/fixtures/msp/`):
  `expired`, 600 s after `loginStart`, with a message; `cancelled`;
  `granted`, `denied` and `failed`, from Approve and Deny clicked on the
  device page, and an approval whose file could not be written.
  - **`granted`.** It came 205 ms after the file was written and
    `account/read` said `accountLogin`; it never ends the flow or counts
    on its own, and `account/read` or the file decides.
  - **`denied` and `failed`.** Each ends the flow with its own message.
    No ending's message is logged: it is free text the CLI chose (`failed`'s
    names the credential file's path), so the log names each captured
    ending in fixed words (Codex on `886af682`).
  - **Every other word.** It ends the flow at once and is shown as Muse
    Code sent it (AGENTS.md rule 13); the log keeps the word only in the
    shape of a protocol word, never its message.
  - **With no first `account/read`,** a sign-in from before would pass for
    a new one, so `accountLogin` alone does not count: a file written
    since the flow began does, and so does the host's `granted` borne out
    by `account/read` saying `accountLogin` (a Keychain sign-in may leave
    the file as it was; review round 4). That captured success counts
    whatever came before, so a same-account re-sign-in on macOS, which may
    change only the Keychain while the logout hold keeps the old sign-in,
    is seen too (Codex on `328efb52`).
  - **Forced Model API.** With `museSpark.backend` set to `modelApi`, the
    choice asks the CLI nothing (`isCliSignInConsulted`), in the gate and
    in host admission.
  - **Cancel after approval.** When the file changed since the flow began,
    its structure decides, not the click. With the hold on or a Model API
    session, the code leaves the panel at once, before the refresh.
  - **A host that exits** fails the flow at once (`connection.closed`),
    unless the credential file changed since the flow began: then it
    signed in. A write that an answered `account/read` already called
    signed out (another Muse process's sign-out) stays refuted, for an
    exit and for a later `account/read` left unanswered alike.
- **The backstop.** The extension waits 11 minutes, past the code's
  lifetime, so Muse Code's `expired` ends an unapproved code. The old
  5 minutes cancelled codes that were still live.
- **A CLI that stops answering.** Cancel and the host's ending are noticed
  at once even while `account/read` is unanswered. `loginCancel` is
  bounded at 2 s before the host is closed anyway. A sign-out never waits
  on a question a finished or failed sign-in asks, and a refresh begun
  before a sign-out ended cannot publish after it. The window closing
  cancels the sign-in, waits for it, and closes every short-lived account
  host before the backends stop; a click still in its pre-flight questions
  then starts nothing (a flag `stopSignIn` sets, checked by `signIn` and
  the device flow's join).
- **Switching backends (Codex on `1ae3604f`).** Every state that could
  sign in on another backend than conversations run on is published
  through one helper, `AuthService.publishSelection`: every refresh (Check
  again, a Cancel that still landed a sign-in, a failed sign-in's refresh,
  a device sign-in's confirmation, CLI discovery after an install), a
  pasted key, and a failed install. It opens a new admission generation,
  shows `checking`, ends the running backend's conversations
  (`restartBackend(true)`) and only then publishes. `liveBackend` is the
  backend of the last signed-in state, cleared by any restart that ended
  the conversations (a sign-out included), so none is ended twice.
- **Stale answers (Codex on `886af682`).** A probe that Cancel, a sign-out
  or Check again left behind gives its late answer to no caller, the ones
  that joined it included: they look again and get the newer answer. Every
  refresh takes a ticket as it starts and publishes only if nothing newer
  has; while the browser sign-in waits, a refresh leaves its code on
  screen.
- **The log.** Text the CLI chose is never logged as sent, since the log
  channel's redactor catches only key-shaped strings (Codex on
  `886af682`):
  - the unsupported-file message names the credential file's full path, so
    the log says so in fixed words and the panel keeps the path;
  - a sign-in ending, an `account/read` state and an `authRequired` reason
    are logged only in the shape of a protocol word (`wireWordForLog`),
    captured endings in fixed words;
  - an MSP failure is logged by its kind and code (`failureForLog`), and
    `muse serve` or `muse skills` stderr by the lines 1.4.0-R4302.1 was
    captured writing (an unsupported schema version, an unreadable
    Keychain item, a failed model-catalog fetch), in fixed words; any other
    line by its length (`stderrForLog`,
    `src/core/backends/musecode/logText.ts`).
- **Where it is only as good as the schema.** `account/*` stays
  experimental.
- **Owner steps.** A real sign-in remains an owner step on:
  - macOS, for the pointer after a 1.4.0 login (and whether 1.4.0 reads a
    version-1 file there);
  - Linux, for the device-login file.

  The Windows success sequence, a declined code, a failed save and the
  logout of an OAuth slot were captured on 2026-09-27
  (`scratchpad/cred-capture/capture2.mjs`).

- **Not taken.** `TBH_CREDENTIAL_BACKEND=file` is not set. R4302.1 fixed
  #38/#53 and the launcher updates itself; the README names the switch
  only for someone stuck on R4161.1.

**Amendment 2026-10-02: one decision per approval stage, and Muse Code's
approval faults.** The owner's session of 2026-10-02 (0.10.0; Muse Code
1.4.0-R4302.1, then 1.4.2-R4684.1) was read from its durable log and its
view journal. The faults were then reproduced live with no model and no
credential: `muse serve --provider meta` against a loopback fake of the
Responses API, in an isolated home (`docs/certification/approval-decisions.md`).

- **What the "repeated answers" were.** Each "answered" line was a
  separate stage of one multi-command line, except the decisions the card
  sent again. The card reopened after every decide error and after every
  60 s deadline. 1.4.2 reports its ledger fault (#29) for decisions it has
  applied, and a busy host took one command in three minutes after it was
  sent (23:49:40 → 23:52:33). The two decisions sent again were refused as
  stale ("moved on").
- **One decision per stage.**
  - The card keeps the stage it sent in a ref, set at once (two clicks in
    one frame send one). It also keeps a decided stage locked when the same
    request is announced again.
  - The session's `PromptLedger` records the stages sent. A second decision
    for a stage, or one for a stage the approval has left, is never sent.
  - A decision with no answer is never offered again, nor one Muse Code
    applied while reporting its ledger fault. `approvalReopened` is posted
    only when the host refused it and `approval/listPending` still names
    that very stage.
- **A stage moved by policy.** After a policy amendment, 1.4.2 can present
  a stage that the new rule allows. It then refuses a decision for it with
  `approvalRequirementStale`, naming the next stage, and never sends an
  `approval/updated` for that one; `approval/listPending` also lags. The
  card moves to the stage the refusal names (`advanceTo`), with that
  stage's own `suggestedPrefix` label for the rule choice (or without the
  choice), and says on itself that it moved (`approvalMovedOn`).
  - **Not taken: carrying the choice to the next stage.** The next stage is
    a different command, so an Allow carried over approves what the user
    never saw, and an Always allow adds a different rule.
- **The replay fault.** A turn cancelled under an approval with a stage
  decided and one waiting leaves 1.4.2 refusing every `turn/start` with
  -32603 "approval replay failed: decision stage evidence contains an
  unrecorded human resolution", on Windows and Linux, until `muse serve`
  restarts. On Windows, each decide of that session then reports the
  ledger fault.
  - Rejecting the waiting stage through `approval/decide` before the cancel
    does not wedge. A Stop therefore rejects first (`rejectPartlyDecided`,
    10 s at most per try).
  - Both faults become `MuseCodeFaultError`. The controller names them
    once per session, with the way on: Restart now (the `restartMuseCode`
    host action, then D25's resume) and New conversation.
  - Filed as a draft for meta-models/muse-code-sdk, not sent; it reuses
    #29.
- **Stored outputs.** An edit's `patchRef` arrives while the item is
  `inProgress`, and a read then can answer `notFound`. The row reads its
  patch only once the item is finished. A read in flight is joined. A
  failed read is said once per conversation, at warning level, with how to
  retry (collapse and expand the row, which asks again).
  - **READS correction (2026-10-03, 0.11.0).** Automatic patch reads wait
    until the conversation's turn ends; the existing diff or written
    content stays visible meanwhile. Reopening a row requests its patch
    during a turn. At turn end, an open row without a page clears its
    request marker and asks once, including after a failed read. A loaded
    page is kept. `item/readOutput` uses the existing 180 s long-command
    deadline so the four-read limiter retains its slots longer and accepts
    replies past 60 s. No new protocol or notice text. Acceptance: deferred
    reads, explicit reopening, one turn-end retry, loaded-page preservation,
    the long deadline, and deliberate guard failures. Scoped lane gates
    replace full quality here; lead owns the full machine matrix.
    Evidence: `docs/certification/output-reads.md`.
- **Startup (no change).** 0.10.1's slow-start wait already covers the
  owner's 0.10.0 failures: 30 s, then up to 120 s while the process runs.
  The log's connects took 10.8 s and 18.7 s on a loaded machine, so 120 s
  leaves six times the slowest observed.
- **The dock (the owner's request, 2026-10-03).** A waiting approval's card
  is docked above the composer (`ApprovalDock`), outside the scrolled
  transcript. Its row keeps a compact record, then the decision.
  - **Several waiting.** The oldest is docked, in the order its row stands,
    which is the order Muse asked, with "Approvals waiting: N". Stacking all
    of them would push the composer off a 320 px panel, and Muse Code takes
    them in order anyway.
  - **Focus.** An arriving card takes focus, on the card itself, not on a
    choice a stray Enter would make. It does not when the user is typing (a
    field holding text, or a key within `DOCK_TYPING_GRACE_MS`) or a modal
    is open; the reducer's live-region announcement covers those cases.
  - The single-decision lock is the card's, so it holds in the dock.

**PR #90 review follow-up (FIX90, 2026-10-03).** Keep this correction within
D26: join simultaneous callers to the same in-flight decision and its eventual
failure; Stop waits for those decisions before rejecting the newest waiting
stage; a fault recovery restarts only Muse Code and its conversations; a
notice's recovery actions are retired on their first use, including in saved
webview state; the dock count uses every language's plural forms. Extend the
existing session, controller, App, Transcript and dock tests, drill each guard,
and record Kubuntu results in `docs/certification/approval-decisions.md`.
FIX90 explicitly delegates full quality and publication to the lead; this lane
runs its focused tests and checks on the rig, with the configured commit hooks.

**CLI recovery (2026-10-03).** The owner's session of 2026-10-02/03 on Muse
Code 1.4.2: a steer that missed its 60 s deadline was sent again as a new
turn, and Muse Code took both; the session's event log then failed every
message; at last `muse serve` stopped answering (one core busy, no frame
written), every command waited out its deadline, and only a window reload
got out. Released-behaviour fixes within D25 and D26, the lead's design
(`docs/certification/cli-recovery.md`):

- **Steer.** Only a `commandRejected` whose reason says no turn took it
  (`MSP_STEER_NO_TURN_REASONS`) is a `SteerRefusedError`, after which the
  message goes as a new turn. A steer with no answer fails the message's
  card in words that say it may still arrive (`steerUnconfirmed`); any other
  refusal keeps its own words. Nothing is sent twice. The Model API's own
  steer refusals are all `SteerRefusedError`, so its fallback is unchanged.
  The reason Muse Code sends was not captured live (§3).
- **The watchdog.** Every frame from `muse serve` is heard. At
  `MSP_UNRESPONSIVE_MISSES` (3) missed deadlines in a row with nothing heard
  for `MSP_UNRESPONSIVE_SILENCE_MS` (90 s), Muse Code is not answering: one
  log line, one event, and new commands fail at once until a frame comes.
  With no turn running in the window, Muse Code alone is restarted and each
  panel on it says so in a plain notice; while a turn runs, that panel's
  notice offers D26's Restart now. The lead moved both off VS Code's own
  messages so they sit in the chat. The ACP agent has no window to decide:
  there commands fail at once and the log says why.
- **Muse Spark: Restart Muse Code** (`museSpark.restartMuseCode`), the same
  restart as a notice's Restart now: Muse Code alone stops, a fresh host
  starts, and each conversation resumes with its next message (D25).
- **A damaged session log.** A turn that failed, or a session command
  refused, with `MUSE_EVENT_LOG_FAULT` ("event log failed") marks its session
  damaged in `workspaceState` (`museSpark.damagedSessions`, the newest
  `DAMAGED_SESSIONS_KEPT` = 50). Such a session is never resumed by itself
  (after a restart, a crash or a reload) and a message or action for it is
  refused before any Muse Code command, with a notice offering New
  conversation; History still opens it. `turn/unqueue` is not used: its
  effect on the stale queued turn is unverified.
- **Effort changes.** One `session/setReasoningEffort` in flight per
  session; a newer value replaces the one waiting and is sent when the
  first settles if it differs; a failed burst is said once.
- **Stored-output reads.** At most `MSP_READ_OUTPUT_CONCURRENCY` (4)
  `item/readOutput` per conversation at once, in order (`FifoLimiter`); a
  read whose conversation is no longer shown when its turn comes is never
  sent, and fails silently as a stale read does.

Full `npm run quality` and publication remain the lead's work; this lane ran
its focused tests on the Win11 rig and the static gates on the host.

<!-- plan-archive:end id="2-D26-02" -->

## D27 — The audit: editing correctness (2026-09-23)

<!-- plan-archive:begin id="2-D27-01" lines="2996-3017" bytes="19817" sha256="83d1bda40b5e5e59a79cf15fbc66b08723f3c4855f2f7a6f6b900a8fe9bfbcc3" -->

Section D of the audit (D24): the Model API's file tools, Edit Review and
the context the agent reads. "Rules and skills", "diagnostics", "mentions"
and "multi-root" are the context rows; the rest are the editing rows.

| Report                                                                               | Finding                                                                                                                                                                                                                                                                                                                                                                                                                                        | Change                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| ------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| An insertion reverts as "delete the file" (Cline #9555)                              | The Model API's hunks gave every insertion `oldStart: 0`, which Revert and Rewind read as a file the edit created: adding an import line and reverting it trashed the file.                                                                                                                                                                                                                                                                    | Hunks use unified numbering (an insertion's `oldStart` is the line it follows) and carry three lines of context each side; the patch file says `created` outright. A file counts as created only when nothing is left once the edit is taken out, so lines the user added since are written back, never trashed. Muse Code's documents (no `created`) keep the whole-file-add rule under the same check.                                                                                                                                                                            |
| Deleted lines put back at a line that moved                                          | A deletion-only hunk had nothing to match against.                                                                                                                                                                                                                                                                                                                                                                                             | The context lines are matched: a file that has moved on is refused with the reason, not guessed at. Refined in D31: intact lines that only moved are found where they moved to, if they occur once.                                                                                                                                                                                                                                                                                                                                                                                 |
| CRLF files (Roo #8020, Codex #25048, Claude Code #88114)                             | `read_file` showed LF lines, so a multi-line `find` never matched a CRLF file; a replacement wrote LF into it; `write_file` dropped the final line break.                                                                                                                                                                                                                                                                                      | The model sees LF text without the BOM; `edit_file` matches that text and writes the file back in its own line breaks and BOM; `write_file` keeps an existing file's BOM, line breaks and final line break. A file that mixes breaks is edited as it is.                                                                                                                                                                                                                                                                                                                            |
| Non-UTF-8 files (Claude Code #96263, #92328)                                         | Latin-1, Shift-JIS or UTF-16 files were decoded lossily and written back whole.                                                                                                                                                                                                                                                                                                                                                                | `readFile` is strict: invalid UTF-8 or a NUL refuses the file ("is not UTF-8 text …"), so nothing is rewritten; a UTF-8 BOM is kept.                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| Edits under unsaved editors; stale overwrites                                        | The tools wrote files an editor held unsaved changes to (VS Code then asks which to keep); `write_file` could replace a file the model had not seen, or one the user changed since.                                                                                                                                                                                                                                                            | The tools refuse a file with unsaved changes; `write_file` replaces an existing file only as the model last read or wrote it (Claude Code's rule, a per-session fingerprint), and the prompt says so. Before each message the panel names the unsaved files (once per set) when autosave is off, since Muse edits the saved files.                                                                                                                                                                                                                                                  |
| A flood of shell output hides how the command ended (Cline #13346)                   | Output over 64k was clipped from the start: the exit line and stderr went.                                                                                                                                                                                                                                                                                                                                                                     | Each stream keeps its beginning and its end (half the budget each, split on code points), and the exit line is never clipped.                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| Search on a large workspace                                                          | A search that ran out of time returned nothing; there was no cap on the files read.                                                                                                                                                                                                                                                                                                                                                            | The worker posts each file's hits as found: a timed-out search returns them, marked partial. At most 50,000 files are read; the output says when the glob matched more.                                                                                                                                                                                                                                                                                                                                                                                                             |
| Windows PowerShell's output (Continue #12315)                                        | PowerShell 5.1 writes a redirected stdout in the OEM code page: "héllo ✓" came back "h�llo ?" (probed 2026-09-23).                                                                                                                                                                                                                                                                                                                             | A preamble makes its output, and what it pipes to native commands, UTF-8 without a BOM. The per-chunk decoding was M22's (`StringDecoder`).                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| Revert strips a BOM (Cline #2463, Roo #1431)                                         | Edit Review read files through a decoder that dropped the BOM and wrote them back without it.                                                                                                                                                                                                                                                                                                                                                  | The BOM is read, set aside for the match and written back.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| Non-atomic writes; Edit Review without a folder                                      | A write interrupted mid-way left a half file; Edit Review with no folder resolved paths against the process's own directory.                                                                                                                                                                                                                                                                                                                   | `writeFileAtomically` (a uniquely named temporary file renamed over the target, busy renames retried, the temporary file removed on failure) for the tools and the session store. An existing file is replaced where it really is (through a symbolic link, the file it leads to) and keeps its permission bits; a read-only file is refused at once (the review of PR #11). A hard link's other names keep the old content, and the owner and Windows' hidden and system attributes are not carried, as a new file cannot carry them. Edit Review says to open the folder instead. |
| UTF-16 rules files; linked skills (Cline #12151)                                     | The loaders read files as lossy UTF-8, so a UTF-16 `AGENTS.md` (what Windows PowerShell 5.1's `>` writes) reached the model as NUL garbage; a symlinked or junctioned skill directory was dropped without a word; `AGENTS.md`, `CLAUDE.md`, `MEMORY.md` and `SKILL.md` were opened by their text path, so a committed link sent its target to the model.                                                                                       | `ContextIo` behind the loaders: `decodeContextText` reads UTF-16LE/BE by the byte-order mark and UTF-8 otherwise (its mark dropped), strictly, refusing NULs, each refusal logged with the file and the reason. Repository files are confined by canonical path (`confineWorkspacePath`); a link out of the workspace is skipped with a log line. Personal skill links are followed. One unreadable skill no longer hides the rest; a refused `AGENTS.md` does not fall back to `CLAUDE.md`.                                                                                        |
| `getDiagnostics` leaks and misses                                                    | Files outside every folder were reported by absolute path, a second folder's relative to that folder; no per-message cap; a request matched by suffix, lower-cased on every platform; a bad `%` escape made `decodeURIComponent` throw.                                                                                                                                                                                                        | Only the root's files, by root-relative path; messages clipped at `DIAGNOSTIC_MESSAGE_MAX_CHARS` (1,000) with a count, never inside a surrogate pair; the request resolved (`fileURLToPath`, or against the root) and matched exactly, case-insensitively on Windows only; a malformed or outside request is an MCP error result.                                                                                                                                                                                                                                                   |
| `@` mentions with spaces or `#`                                                      | `@path` ran to the first whitespace and `#` started the line range.                                                                                                                                                                                                                                                                                                                                                                            | `formatMention` quotes paths with whitespace, `#` or `"` (`@"my notes/a#1.md"#5-10`; `\"` and `\\` inside), used by Alt+K, the menu, the picker, uploads and drops; the composer reads mentions from the start of the draft, and the line range is no longer part of the menu's search. `[!x]` and nested braces (M21) confirmed.                                                                                                                                                                                                                                                   |
| Multi-root: the first folder is the root; remote drops (Claude Code #92403, audit G) | `asRelativePath` is relative to whichever folder holds the file, so folder 2's `src/a.ts` read as folder 1's in the chip, Alt+K, uploads, drops, the file search and diagnostics; a relative `openFile` with no folder resolved against the extension host's directory; a drop in a remote window never matched a folder, since the remote extension host sees its folders as `file:` URIs while the webview hands over `vscode-remote:` ones. | `rootRelativePath` over VS Code's folder attribution (a folder nested in the root counts as part of it); the file search limited to folder 0 (`RelativePattern`); `openFile` through `resolveAgainstRoot`; `hostSideUri` maps a dropped URI as VS Code's own URI transformer does (`vscode-remote` → `file`, a local `file` → `vscode-local`). Unit-tested; not tried in a real remote window.                                                                                                                                                                                      |
| A message typed during a card decides it (Roo #11211, audit G)                       | Checked, not affected: a message steers the running turn and never answers a card.                                                                                                                                                                                                                                                                                                                                                             | A test holds it (a regression that answers cards itself fails it); the Model API's "steers a running turn …" case decides the card after a steer, so the card was still pending.                                                                                                                                                                                                                                                                                                                                                                                                    |
| Subagent results in the parent's context (Claude Code 2.1.277, audit G)              | Not the extension's to mark: Muse Code builds the parent's context from its own children, and the Model API backend runs no subagents (D17).                                                                                                                                                                                                                                                                                                   | Recorded; nothing to change here.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |

<!-- plan-archive:end id="2-D27-01" -->

## D28 — The audit: webview and UI state (2026-09-23)

<!-- plan-archive:begin id="2-D28-01" lines="3021-3055" bytes="21213" sha256="a869da84b0b89d41bcf9b9f1bca98156d1081a024996f4907dac6c99c65a42df" -->

Section E of the audit (D24): the webview's state and its rendering. Every
row held against the code at `7db2398`; M25 fixes them all in the webview,
plus two posts from the controller (`clear()`, `surfaceReady()`) and three
additive protocol messages. Two companion changes belong to `send()` in the
controller, which another milestone rewrites (the images a failed send took,
and the active turn a late acceptance brings back).

| Report                                                           | Finding                                                                                                                                                                                                    | Change                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| ---------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Replayed child rows pulled into every rewind (an M20 regression) | The `childTranscript` replay gave each row a fresh arrival number, so any agent edit read from its session counted as newer than every message, and a read replaced the numbers of rows already seen live. | `replayChild`: a row the panel never saw complete is numbered just after the last thing known to precede it (the agent row's new `seq`, or an earlier live row of the same transcript), strictly below the next whole number. Live rows keep their numbers; without an agent row the read rows join no rewind.                                                                                                                                                                    |
| A cancelled or failed turn leaves rows running                   | `turnCompleted` only cleared `activeTurnId`: the reply kept streaming, tools kept running, cards stayed clickable.                                                                                         | `completeTurn` settles the conversation's rows: streaming stops, a thought gets its duration, a running tool that is not backgrounded becomes `interrupted` ("Interrupted") and loses its card; a later item update still wins. A subagent's own turn settles only its transcript. It covers the host's synthetic `turnCompleted` for a CLI that dies mid-turn.                                                                                                                   |
| The crash screen's Reload comes back empty                       | The reducer lived in `App`; the error boundary unmounted it, and the host's messages under the crash screen were lost.                                                                                     | A store outside the boundary (`state/store.ts`), saved to VS Code's webview state at most once a second and at once before a reload, as a versioned snapshot validated with zod on the way back (`state/snapshot.ts`, the row schemas and types in `state/transcriptEntries.ts`). `surfaceReady()` posts `surfaceState` first; the snapshot is kept only when its session is live, with the host's running turn. A state that crashed the first render is saved without its rows. |
| Ctrl+N clears only the host; it may clear the wrong panel        | `clear()` never told the webview; the active surface was the last one whose composer had focus.                                                                                                            | `clear()` posts `conversationCleared`; the panel spends the echo of its own clear (a counter). `surfaceFocused` on window focus, a tab turning active and the sidebar being shown make a surface active.                                                                                                                                                                                                                                                                          |
| Enter during an IME composition sends                            | No `isComposing` check.                                                                                                                                                                                    | The composer's keys return first for `isComposing` or the "Process" key (keyCode 229).                                                                                                                                                                                                                                                                                                                                                                                            |
| Every keystroke or delta re-renders every row                    | No row was memoised; the callbacks closed over the state; a child delta scanned every child transcript.                                                                                                    | Memoised rows, callbacks that read the store when they run, a `childOwners` index, updates searched from the end, the patch parse memoised. The draft stays in the reducer (the insert, the Add-context spacing and the snapshot read it).                                                                                                                                                                                                                                        |
| Open fences re-highlighted per delta                             | The open block sat in the tail re-rendered on every delta.                                                                                                                                                 | `splitOpenFence` shows it as plain text until it closes; `highlight` memoised; one CommonMark fence scanner for the head/tail split too (tilde fences included).                                                                                                                                                                                                                                                                                                                  |
| Replayed thoughts read "Thinking…" for ever                      | No duration meant the streaming label.                                                                                                                                                                     | "Thought".                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| Pin-to-end ignores height changes                                | The effect watched only the transcript.                                                                                                                                                                    | A layout effect and a `ResizeObserver` on the body and its children.                                                                                                                                                                                                                                                                                                                                                                                                              |
| A restored tab loses its session on a failed resume              | The app saved `{}` on mount; `takeRestoredSessionId` handed the id out once.                                                                                                                               | The webview keeps `restoredSessionId`, `webviewSetup` keeps the id, both until `historyLoaded`, a `sessionInfo` with a session, or `conversationCleared`.                                                                                                                                                                                                                                                                                                                         |
| A refused send's attachments linger on the host                  | The composer dropped the chips while the host still held the images; they counted against the limit and came back as chips after a reload.                                                                 | `sendFailed` carries `attachmentsKept`: when true the chips come back to the composer; otherwise the webview asks the host to drop any it still holds (`removeAttachment`), since the host may have consumed them. The controller's `send()` sets the flag with its rewrite.                                                                                                                                                                                                      |
| The question card's Submit posts twice                           | No lock.                                                                                                                                                                                                   | `questionSubmitted` locks the card until the host settles the question; an error notice (the host's report of a refused answer or cancel) opens it again.                                                                                                                                                                                                                                                                                                                         |
| Screen readers flooded                                           | A polite status verb every 4 s; alert roles on rows, cards and notices alongside the live region.                                                                                                          | One live region; a tool failure and a failed turn's reason read out once.                                                                                                                                                                                                                                                                                                                                                                                                         |
| No focus trap; menus stay open                                   | —                                                                                                                                                                                                          | Tab wraps inside a modal and the panel behind it is `inert`; the message menus and the quote menu close on a press outside or when the focus leaves (`useDismiss`).                                                                                                                                                                                                                                                                                                               |
| Right-click on a selection loses Copy                            | Our menu replaced the browser's.                                                                                                                                                                           | Copy first in the quote menu.                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| Show archived breaks the keys                                    | The switch took the search box's focus.                                                                                                                                                                    | It no longer takes it; a keyboard toggle gives it back; Escape and focus leaving handled on the dialog.                                                                                                                                                                                                                                                                                                                                                                           |
| `turnAccepted` after `turnCompleted`                             | A fast turn became active again.                                                                                                                                                                           | `lastCompletedTurnId`: a late acceptance marks the card sent and starts nothing.                                                                                                                                                                                                                                                                                                                                                                                                  |
| A child's items before its agent row are misrouted               | They landed in the conversation.                                                                                                                                                                           | `strayItems` by turn, moved to the agent's transcript once its row names that turn as its child session.                                                                                                                                                                                                                                                                                                                                                                          |
| A drop encodes before the size check                             | Every image was read and base64-encoded, then refused by the host.                                                                                                                                         | Size and count checked first; the banner says why, for the host's size and count refusals too.                                                                                                                                                                                                                                                                                                                                                                                    |
| Relative links refused                                           | They went to the host as URLs.                                                                                                                                                                             | `links.ts`: a workspace file at the named lines (`#L12`, `#L12-L20`, `:12`); a path climbing out or rooted is refused with a notice; react-markdown's filter lets a `name.ext:line` link through and still blanks `javascript:`.                                                                                                                                                                                                                                                  |
| Reduced motion partial                                           | Only the microphone.                                                                                                                                                                                       | Every animation and transition.                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| No `dir="auto"`                                                  | —                                                                                                                                                                                                          | Every text block; `unicode-bidi: plaintext` on the user card and the composer.                                                                                                                                                                                                                                                                                                                                                                                                    |
| Todo keys collide                                                | Keyed by text.                                                                                                                                                                                             | Keyed by position and text.                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| Approval feedback carries across stages                          | One card instance for every stage.                                                                                                                                                                         | The card is keyed by stage.                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| CRLF in the diff view                                            | Rows kept `\r`.                                                                                                                                                                                            | Split on `\r?\n`; a trailing `\r` dropped from patch lines.                                                                                                                                                                                                                                                                                                                                                                                                                       |
| Patches over 256 KB unnumbered                                   | Only the first page was fetched; a partial document fell back to the unnumbered diff.                                                                                                                      | Pages fetched to the end within `PATCH_DOCUMENT_MAX_PAGES`, chained by offset; a partial document is not parsed.                                                                                                                                                                                                                                                                                                                                                                  |

<!-- plan-archive:end id="2-D28-01" -->

## D29 — The audit: packaging, CI, platform and voice (2026-09-23)

<!-- plan-archive:begin id="2-D29-01" lines="3059-3081" bytes="5414" sha256="34bb9a5856e926b94cdecd7e16c871422075cf39081240781e8da4cbf41f953c" -->

Section F of the audit (D24), row A5 (the release workflow's secret scope)
and the two voice rows of section B, plus section G's `windowsHide` rule for
the spawns M26 owns. Section F's git-facts row belongs to M21. Owner ruling
during the milestone: the macOS helper is not signed or notarised; it stays
ad-hoc signed, and the product explains what macOS does with it. Evidence
for each row: `docs/certification/m26.md`.

| Report                                     | Finding                                                                            | Change                                                                                                                                                                            |
| ------------------------------------------ | ---------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Windows-reserved shortcuts                 | Windows takes Ctrl+Esc and Ctrl+Shift+Esc; VS Code hit the same (#217861)          | Add `win` bindings with Alt; walkthrough updated; tests reject reserved chords                                                                                                    |
| No third-party notices                     | 75 bundled packages, no notices in the vsix                                        | Notices generated from metafiles, shipped, checked by the build                                                                                                                   |
| Dictation in remote windows                | Workspace extension runs remote; `remoteName` is set on both hosts                 | Refuse when the host is remote (remoteName plus extension kind)                                                                                                                   |
| macOS permission flow                      | TCC credits VS Code, which declares no speech recognition (#307364); no quarantine | Not signed (owner); honest per-permission text; early-exit hint; the helper disclaims VS Code's responsibility and asks under its own name (M28, the owner's go-ahead 2026-09-23) |
| Plist version by hand                      | Hand-bumped literal                                                                | Derived from package.json; checked in the binary                                                                                                                                  |
| Integration tests on one version, no cache | Stable only                                                                        | Stable plus the floor; downloads cached                                                                                                                                           |
| semgrep / PSScriptAnalyzer unpinned        | Unpinned                                                                           | 1.177.0 (Dependabot pip) and 1.25.0                                                                                                                                               |
| Audit blocks tags                          | No-fix advisories dead-end a release                                               | Stays blocking; reviewed exceptions expiring within 90 days                                                                                                                       |
| No job timeouts / token persisted          | All jobs affected                                                                  | Timeouts everywhere they're allowed; `persist-credentials: false`                                                                                                                 |
| Commands always in the palette             | No `commandPalette` entries                                                        | Four `when` clauses                                                                                                                                                               |
| Category                                   | "Programming Languages" is wrong                                                   | AI, Chat                                                                                                                                                                          |
| `navigator` in the host                    | Not affected                                                                       | Build check added                                                                                                                                                                 |
| `VSCE_PAT` scope                           | Job-level env beside install scripts                                               | `verify` job, flag only, one step after `--ignore-scripts`                                                                                                                        |
| PS 5.1 `PSModulePath`; stdin EPIPE         | Both true                                                                          | Shared reset helpers; error listener and no writes after exit                                                                                                                     |

<!-- plan-archive:end id="2-D29-01" -->

## D32 — An accessibility gate: WCAG 2.2 AA with axe-core, in VS Code's own themes (2026-09-24)

<!-- plan-archive:begin id="2-D32-01" lines="3178-3252" bytes="4947" sha256="0983351a3a2072f4c54dd9b76f3cb4c4125c027974d4b8904433f3ffc5e48cc2" -->

The owner asked whether Lighthouse and WCAG scans make sense for what is,
in effect, a web app. **Lighthouse: no.** Its Performance and SEO
categories measure a page loaded over a network, and Best Practices is
mostly about HTTPS and browser APIs; the webview is a local bundle inside
VS Code. Its Accessibility category is axe-core, so the gate runs axe-core
itself. **Owner's go-ahead (2026-09-24):** "sure", for axe-core 4.13.0
(MPL-2.0) as a dev dependency and a gate of its own.

- **What is checked:** every harness scenario (`test/harness/`, the
  webview behind a fake host, 52 today) in each of VS Code's four default
  themes, against axe's WCAG 2.0, 2.1 and 2.2 rules at levels A and AA
  (tags `wcag2a`, `wcag2aa`, `wcag21a`, `wcag21aa`, `wcag22aa`), colour
  contrast included. Any violation, or a page that reports no result,
  fails the gate.
- **Real colours, not a guess:** `scripts/capture-themes.mjs` starts the
  VS Code build the integration tests use (1.139.0) once per theme
  (Default Light Modern, Dark Modern, High Contrast, High Contrast Light)
  and reads the workbench's `--vscode-*` values over the DevTools
  Protocol. Only the variables the webview uses are kept, in
  `test/harness/themes/<kind>.json`. A colour a theme leaves unset is
  unset in the harness too, so the stylesheet's own fallback is what gets
  measured, as in a real webview. Rerun it when VS Code's themes change.
- **One exemption, said out loud:** a `target-size` finding whose related
  elements all sit in a menu, popover or dialog the user opened, which does
  not hold the target and overlaps it on screen. WCAG's Understanding
  document for 2.5.8 puts targets obscured by content the user displayed
  out of scope. Every run prints each exempt element and counts it (8
  today, all in the `rewind` scenario, where an open menu covers two
  chevrons). A target crowded by its own neighbours inside a menu is not
  exempt (the review of PR #18).
- **A second exemption (PR #69, 2026-10-04):** a `scrollable-region-focusable`
  finding on a region that holds a listbox whose id a focused or focusable
  element names in `aria-controls` while its `aria-activedescendant` is one
  of that listbox's options. That is the composer's `/` and `@` lists:
  the box keeps the focus, the arrows move the active option, and the
  composer scrolls it into view, so WCAG 2.1.1 is met without a Tab stop
  on the list, which axe cannot see. A plain scrollable region, or a
  listbox no such control drives, is still reported. It is printed under
  its own "Exempt:" heading and registered in §8.
- **What axe cannot decide fails too** (the review of PR #18). axe files
  what it cannot settle under "incomplete"; the gate fails on it like a
  violation, with two exceptions. Contrast on text axe could not see where
  it looked (covered by an opened menu or dialog, or scrolled out of the
  transcript's view) and on glyph-only content is counted and printed, not
  failed: about 2,430 (a few either way between runs) and 60 elements today. The rows scrolled out of view in the
  long transcripts are the same kinds of row that other scenarios show and
  check.
- **How the violations were fixed:**
  - A control inside an ARIA option is not a control of its own (4.1.2).
    The effort dots in the palette row and the History row's archive mark
    are for the mouse only and hidden from assistive technology. The row
    carries the value and the keys: Left and Right step the effort, and
    Delete archives or restores the highlighted History row.
  - The palette and History lists are Tab stops, so they scroll from the
    keyboard (2.1.1). Focus moving into the list keeps the dialog open;
    leaving the dialog closes it, and Escape works from the list too.
  - Text below 4.5:1 takes the text colour: diff line numbers, a failed
    tool's reason (the error colour stays, as a bar beside it, which needs
    only 3:1), and the grey detail on a selected row.
  - Radio and checkbox answers in a question card get a 24 px row (2.5.8).
  - The Modes menu's effort dots are 24 px targets around the same 12 px
    dot (2.5.8; axe had left them undecided).
- **Limits:** automated rules find only part of what WCAG asks. Screen
  reader output, reflow at 400 % zoom and focus order inside the real VS
  Code window are not covered by this gate. Keyboard behaviour is covered
  by the component tests.
- **Cost:** about 2.5 minutes locally (six headless Chrome workers over
  208 pages).
- **Where it runs:** in `npm run quality` and `quality:ci`, after
  `quality:gates` has built the production bundle. In CI it is a step of
  its own on Linux (3 min 20 s) and Windows (4 min 33 s). It is not run on
  macOS: that runner's headless Chrome had not finished after 28 minutes,
  and the job timed out (PR #18's first run). This is an exception to A10's
  "full gate set on all three". The page it checks is the same web content
  on every platform.

<!-- plan-archive:end id="2-D32-01" -->

## D33 — The panel in VS Code's display languages (2026-09-25)

<!-- plan-archive:begin id="2-D33-01" lines="3256-3324" bytes="4287" sha256="f11282a48d3ea939badd3ae828efa83005cec91eeb0fcc76bcc0d783e39baceb" -->

The owner said "yes" (2026-09-24) to the fourteen languages VS Code itself
ships, with machine translations disclosed. What the survey of the code
found shaped the design: about 570 keys in `UI_TEXT`; 128 places that
splice a `UI_TEXT` fragment into a sentence (`"Thought for" + "3s"`,
`"step" 1 "of" 2`); singular and plural pairs chosen with `=== 1`; relative
times built by hand (`"min ago"`); labels outside the table
(`PERMISSION_MODE_LABELS`, `TOOL_LABELS`, `EFFORT_LABELS`, `'edit' :
'edits'`); and text that goes to the model mixed in with text the user
reads.

- **Two tables, one of them never translated.**
  - `MODEL_TEXT` holds what the model or Meta reads. It stays English
    whatever the display language, so the model's behaviour does not
    change with the user's locale. It covers the context leads, the
    compaction prompt and prefix, the steering and answer prefixes, the
    skill invocation, and the tool failures returned to the model.
  - `UI_TEXT` is what the user reads, and it is the one translated.
  - The log stays in whatever language the notice was shown in (M39 logs
    the shown line); that is accepted, since the log carries ids and
    error details, which are not translated.
- **Whole sentences with named slots.** A spliced sentence becomes one
  template, `'Thought for {duration}'`, filled by `fill(template, values)`,
  so a language can put the slots where its grammar needs them. The key
  names the slots; the gate checks every translation has the same ones.
- **Plurals by the language's own rules.** A count-dependent string is an
  entry of plural forms, `{ one: '{count} agent', other: '{count} agents' }`,
  and `plural(entry, count)` picks the form with
  `Intl.PluralRules(locale)`. Each translation carries exactly the
  categories its language uses: Russian, Polish and Czech have `few` and
  `many` as well.
- **Numbers and times from `Intl`.** Counts use `Intl.NumberFormat` and
  "5 min ago" uses `Intl.RelativeTimeFormat`, both in the display
  language, so those strings leave the table.
- **Where the tables live, and why not in the bundle.** English stays in
  TypeScript (`src/shared/l10n/en.ts`); it is the base and the type every
  translation must match. The fourteen others are JSON files in `l10n/`,
  shipped in the package and not bundled: fourteen copies of about 40 KB
  would push the webview bundle (654 KiB today) past its 900 KiB budget.
  - At activation the host maps `vscode.env.language` to a table, reads
    that one file and checks its shape with zod.
  - The host embeds that table in the webview's HTML, as a JSON
    `<script type="application/json">` (not executed, so the CSP is
    unchanged). It also sets `<html lang>` for screen readers. The webview
    installs the table before its first render.
  - A display language without a table (Arabic, say) gets English, and
    the log says so once. A table that fails its check also gets English,
    with a warning; the gate keeps such a file from shipping.
- **The manifest** (commands, settings, views, the walkthrough's titles)
  moves to `package.nls.json` and `package.nls.<language>.json`, which
  VS Code applies itself. The walkthrough's Markdown pages stay English;
  VS Code localizes the step titles and descriptions, not the pages.
- **The gate** (`scripts/check-l10n.mjs`, in `quality:gates`) checks
  every language against English:
  - every key present and no extra ones;
  - the same `{slots}` in each string;
  - the same number of code spans and bold markers;
  - exactly the plural categories `Intl.PluralRules` gives that language;
  - no value left equal to the English, except an allowlist of names and
    commands (Muse, MCP, `/export`, …);
  - the same checks for the manifest's strings.
- **Seen, not assumed:** the harness takes `?lang=` and renders any
  scenario in any table, so long German and CJK strings are checked for
  layout in screenshots, and the accessibility gate checks one full run
  in a translated table.
- **Two pull requests.** M40a is the machinery, the refactor, the English
  table and the gate. M40b is the fourteen translations, the README's
  disclosure and the screenshots.
- **Honesty:** the translations are machine-made; the README says so and
  asks for corrections through issues.

<!-- plan-archive:end id="2-D33-01" -->

## D37 — The key's paid features on the Muse Code backend (2026-09-25)

<!-- plan-archive:begin id="2-D37-01" lines="3492-3523" bytes="2040" sha256="cadcd46c3be1b985ef0e9da8cbee7a69ac0b21f455f23f6cad9ca707868972f5" -->

The owner (2026-09-25): "web search and images are pretty important to be
able to use on each". Web search already works on both: Muse Code searches
with its own tool on the subscription, the Model API backend with Meta's
paid search (M33). Images did not: Muse Code 1.3.0's `image_generation`
tool is switched off in `muse serve` with no setting that turns it on
(inventory, 2026-09-25).

- **Images come from the extension on Muse Code.** The `ide` session
  server every Muse Code session already loads (M5) offers `generateImage`
  and `editImage` while image generation is on (D30) and a Model API key
  is stored. The extension makes the image itself with the key, through the
  same pipeline as the Model API backend (`prepareImageCall`,
  `runImageCall`): every check before the question, the file reserved
  before the purchase, the PNG checked. The key never reaches `muse serve`
  (D1), and the subscription never pays for an image.
- **Asked in a dialog, every time.** Muse Code's own approval covers using
  the tool, in whatever mode it runs; the extension's modal covers buying
  the image: the path, the prompt, the sources and the price, billed to the
  key. Declining refuses the call and buys nothing.
- **Loud as on the Model API.** The rows (`mcp__ide__generateImage`,
  `mcp__ide__editImage`) are marked paid when the items are read, the
  tally counts the images, and the palette's toggles, the composer's badge
  and Account & usage show the key's features on Muse Code while a key is
  stored (`usablePaidFeatures`): images and Muse Voice, not web search.
- **Muse Voice** works the same way: the microphone's paid engine on Muse
  Code while a key is stored.
- **Image edits** (`edit_image`, Meta's `/images/edits` with the sources as
  data URLs) join generation under the same setting, gate and price, on
  both backends.
- **The tool list is read per request**, so a session started after image
  generation is turned on (or a key is stored) gets the tools; one already
  running gets them when it next starts.

<!-- plan-archive:end id="2-D37-01" -->

## D38 — Session goals on both backends (M45, 2026-09-25)

<!-- plan-archive:begin id="2-D38-01" lines="3527-3692" bytes="11158" sha256="4eaf8ac2eac581834fd7fe7e8195e7d8c7365ede20afe58243d3e1eef148f400" -->

What Muse Code 1.3.0 does, from msp.d.ts, its goal-tracking recipe and
interactive docs, the strings of its goal store, and a live capture
(2026-09-25, `C:\muse-live-m45` and `C:\muse-live-m45-stop`, three turns,
nine model attempts on the contributor model, `docs/certification/m45.md`):

- **The user's verbs** are MSP `goal/set`, `edit`, `pause`, `resume` and
  `clear`, each acknowledged at admission (`{ commandId, status, turnId? }`).
  A set, edit or resume that leaves the goal active while the session is
  idle wakes a goal-driving turn, which the ack names and which has no user
  message item; while a turn runs, the ack names that turn and nothing
  starts. Pause and clear never wake. An edit of a paused goal keeps it
  paused and wakes nothing.
- **Refusals** are `commandRejected` (-32030) with `data.reason`
  `missing_goal` (any verb but set, with no goal) or `invalid_goal_state`
  (pause, resume or edit of a finished goal). A blank objective, or an
  objective on a bare verb, is `invalidParams`.
- **The goal** arrives as `session/goalChanged`: `{ objective, status,
percentComplete, currentWork?, nextWork? }`, or `goal: null` when
  cleared. It is not repeated on a resume. Only a resume served as a
  snapshot carries it (`snapshot.state.goal`, `null` for none); inline
  history does not. The goal store's statuses are active, paused,
  complete, blocked, usage_limited and budget_limited.
- **Its loop** pins the goal for the agent, queues a turn of its own to
  continue after a turn that left the goal unfinished, reminds the agent to
  report progress after about ten model calls without any (the step
  probe), runs a completion audit (a reminder agent's model call) before
  `update_goal` may close the goal, and pauses an unfinished goal when its
  turn is stopped (Esc in the TUI; `turn/cancel`, the panel's Stop, too).

The choices:

- **Muse Code.** `session/goalChanged` and the resumed snapshot's goal
  reach the panel; a resume now asks for `history: "snapshot"` (the same
  items as inline, plus the name, the task list and the goal, so a resumed
  conversation's task list comes back too). A snapshot goal is read on its
  own: a shape that differs costs the strip, never the resume. A fork's
  history takes no preference, so a fork's goal shows once Muse Code
  reports it.
- **The Model API backend** gets Muse Code's four tools with its argument
  names, rules, failure messages and result shape (`{ goal: { session_id,
goal_id, … } }`), so the M43 rows render identically. The goal is stored
  with the session and pinned into the instructions while it is active, as
  the last section so the rest stays the same from call to call. Muse
  Code's step probe becomes a note in that section after ten model calls
  without progress, with no call of its own. Tokens used while the goal is
  active count against a budget the agent gave it, and a spent budget stops
  it. Stop pauses an active goal. The user's verbs follow MSP's rules and
  refusals; a set, edit or resume that leaves the goal active while nothing
  runs starts one visible turn whose cue is Muse Code's own ("Continue
  working toward the active session goal."), replayed for the model but
  not shown as a message, as Muse Code's goal turns have none.
- **Not on the Model API, on purpose:** no turn of its own after a turn,
  and no completion audit. Each would be a model call billed to the key
  that the user did not ask for. The audit's rule is in the pinned section
  instead. A fork carries the goal as it stands, having no history to cut.
- **The panel.** The goal strip sits above the task list while there is a
  goal: the objective, the status in words (one Muse Code adds later as it
  came), the percentage, a bar clamped to 0–100, now and next. Its buttons
  are the verbs the status allows (Pause or Resume, Edit in place, Clear).
  `/goal …` in the prompt reads the TUI's grammar and is a command, never a
  message; the palette's `/goal` leaves `/goal ` ready. A done command is a
  line in the transcript, a refusal a warning in words, and the live region
  reads each change of status.

The review of PR #31 found two Model API goal edges to close before M45
merges: when a streamed reply spends the goal's token budget, its returned
tools must get cancelled outputs and must not run or cause another automatic
model request; and a set, edit or resume accepted during a reply with no
tools must put an internal goal cue into the same turn's next request. The
second review found two more boundaries: a goal wake queued during
compaction must be withdrawn if compaction spends the goal's budget, and a
bare pause, resume, edit or clear on a fresh panel must refuse without
creating an empty session. Each needs a regression test and red drill before
the PR is certified.

The next review and a focused lifecycle audit found five more boundaries:
usage belongs to the goal active when each request attempt began, including
compaction and retries; Stop during compaction pauses an active goal; a
rejected `/goal` command keeps its draft while an accepted one clears only
the unchanged draft; the goal editor resets when the goal changes or clears;
and an incomplete compaction cannot replace history with a partial summary
or escape usage accounting. These are M45 corrections, not new quota or
model features; they require regression tests and red drills before merge.

The following PR review also requires inline goal edits to keep their
objective until the host accepts the edit, with rejection preserving the
field; and the new `session/goalChanged` notification must be parsed under
its literal method instead of adding an unregistered `as z.infer` cast.
The next review found a separate unchecked assertion in the Model API
goal-tool test; its assertion now checks the unknown response as a value
with matchers, without claiming a compiler-verified tool-array type.
The following review found that a response started before `/goal set` or
`/goal edit` could still complete the replacement goal with its old goal
tools. Each Model API request now retains the revision of user goal commands
at its start. A mutating goal tool from an older revision fails with a
replayable output, while the accepted command's wake gives the model the
current goal in its next request.
The next review found two recovery gaps: `session/read` serves inline items
without a goal, so reloading after a `view/gap` could leave a cleared or
completed goal stale in the panel; and a failed compaction recorded billed
tokens in memory but not always in the stored session. Gap reloads now use
the last durable `session/goalChanged` from backward `view/page` reads when
inline history cannot answer, and Model API usage is persisted after both
goal and cumulative counters update. The new view shape was captured live
without a model turn (M45 certification); the tests and red drills cover
clear, completion, paging and persisted failed compaction usage.
The following review found that saving each Model API usage update can
persist a function call before its pending approval or tool has produced an
output, making replay invalid after a crash. Normal turns now save at their
existing settled boundary, while compaction saves in its `finally` after
its usage and status settle. A captured-save regression test guards every
snapshot written during a pending `ask_user` call.
The independent M45 audit found that goal tools, goal commands and settings
changes could still save a pending normal-turn call, so the store now defers
any snapshot with an unanswered function call while preserving safe
turn-start saves and live session-list updates. It also found that a resume downgraded to inline
history needs the same durable goal read as a gap reload, and that a live
goal event arriving during a gap read must win over that older read. Focused
tests and red drills cover both paths.
The next PR review found that a goal accepted during the last Model API
tool round could remain idle: its pending wake was never drained before the
round cap failed the turn. The cap still ends that turn; when the goal is
active, its accepted wake is queued as a fresh bounded turn so the next
request receives the objective.
The subsequent audit found the same final-round loss for accepted steered
input, duplicate queued goal wakes when a goal is replaced during compaction,
and Stop after a compaction summary committed but before token counting
returned. Steered input now queues fresh user turns at the round cap; queued
goal wakes carry the user-command revision and withdraw when superseded;
late Stop keeps the committed summary but pauses further goal work. The
following PR review found a stale inline goal editor after gap recovery and
an old session's goal acknowledgement posted after the panel switched
History sessions. The editor reconciles with recovered goals under the same
own-edit/newer-draft rules as live events, and the controller routes goal
acknowledgements only to their operated session.
The follow-up audit found three more races: a late `sessionNotLoaded`
refusal from an old goal RPC could still replace a newer History session
inside the retry helper; Stop during post-summary counting could pause a
goal set after Stop; and steering accepted while a reply spent the goal's
budget could be silently dropped. The retry helper now checks the operated
session before resuming it, Stop pauses its goal at the time of the action,
and accepted steering gets a fresh ordinary turn when the goal budget
terminates the old turn.
The next PR review found that Model API objective validation exposed an
English model-facing error to translated users, and that a suppressed late
goal acknowledgement could leave the new session's composer stuck with the
old pending command. Objective validation now returns a reason code: model
tools keep Muse Code's English result, while user goal commands read a
localized message and format the limit with `Intl`. A History switch clears
the old pending command correlation. Both paths have focused red drills.
The final focused audit found JavaScript's UTF-16 `.length` counted a
supplementary character twice against the 4,000-character objective limit.
The Model API validator now counts grapheme clusters (so a joined emoji is
one visible character) and stops after 4,001; the 14 translated limit
messages still format the number with `Intl`.
The next PR review found that Stop on an ordinary Model API turn paused a
replacement goal if the old turn took time to unwind. Stop now pauses its
current goal synchronously, and a goal accepted while that aborted turn is
still attached queues a fresh wake. Steering after Stop is explicitly
refused instead of being accepted into a turn that cannot run it.
A follow-up cancellation audit found that a buffered completed reply could
return after Stop and take the budget-limit or round-cap branch before any
abort check, re-queuing steering that Stop had cancelled. The loop now checks
the abort before each round and immediately after each response; returned
calls receive cancelled outputs for replay validity, with no tool or
steering continuation.

<!-- plan-archive:end id="2-D38-01" -->

## D40 — Workflows: captured read-only run card and setting (2026-09-25)

<!-- plan-archive:begin id="2-D40-01" lines="3696-3767" bytes="4902" sha256="ad4219adf2954b1290c94901faf4c18d0f0f6e378ef0000707539630b833fb7e" -->

M47's live capture (one turn in an empty folder on the contributor model,
eight model attempts; `docs/certification/m47.md`) showed what a workflow
is on the wire. The `workflow` tool call carries the script the model
wrote (`{"script": …}`) and answers with a launch (`status: "launched"`,
`scriptPath`, `workflowRunId`); a separate `workflow` item follows, with
`workflowRunId`, `entryId` (`generated.model-chosen` for a script the model
wrote), `scriptId`, `triggerSource` (`guidanceAuto`), `fallbackText`, a
`children` list in each captured revision, and, on completion, a
`message` wrapping a JSON report in `<workflow-launch-reconciled>`. The
launching turn ended before the run did (8.0 s against 10.5 s); the run's
completion then started a turn of its own, the model's reply. The choices:

- **A card, not a generic row.** The item becomes its own row kind: the
  captured generated name ("Written for this task"), otherwise its raw
  `entryId` or fallback text without interpreting it as a saved name; status,
  agent count and tokens, what started it, its agents, and the report's
  `final_summary.summary` (or `latest_failure`); a message that is not the
  report is shown as it came. The card outlives its turn: it is never
  settled as interrupted when the turn ends, and its updates, which keep
  naming the launching turn, are never taken for a subagent's strays.
  A status Muse Code adds later keeps a plain dot alongside its verbatim
  text; only known failed or cancelled statuses get a failure mark.
- **Agents as Muse Code tells them.** A child is keyed by `childId`. Muse
  Code drops a field once the agent moves on (the label comes only with
  `scheduled`, the tokens only with `usage`), so the row keeps what it was
  told. The capture showed label carry within one attempt. As a conservative
  UI policy, a new attempt keeps the label and starts its own outcome,
  time and tokens; no multi-attempt frame was captured. Each supplied
  `children` list is treated as authoritative by the UI, so a child absent
  from it is removed; no omission frame was captured.
  A child whose shape differs costs that child, a field
  that differs costs that field, never the run (as `modelVisibleContent`
  since the review of PR #29).
- **Controls deferred.** Muse Code's MSP lists `workflow/cancel` and
  `workflow/childControl`, and M47 captured only rejected requests against
  a finished or missing run (`already_terminal`, `invalid_target`,
  `missing_run`). No accepted command ack, successful Skip/Retry, or running
  cancellation was captured. The panel therefore offers no workflow owner
  buttons or callable control path yet. Before a follow-up enables them,
  capture their live success shapes and outcome events, then validate the
  ack and enforce source-session ownership. Pause and resume have no MSP
  verb and remain outside the panel.
- **Resume-source evidence limit.** The live tool call captured for M47
  carried an inline `script` and its launch result carried `scriptPath`.
  No resumed-workflow tool arguments were captured, so the Workflow tool
  row does not interpret an input `scriptPath` or claim a resume-source
  file. That display waits for a live owner capture of a resumed run.
- **Child phase evidence limit.** The seven captured child revisions had no
  `phase` value. The card does not parse, carry forward or display one
  until a live frame establishes its meaning and lifetime.
- **No agent transcripts.** A workflow child has no `childSessionId`, none
  of its items reaches the parent's stream, `session/read` of its id
  answers `sessionNotFound`, and `subagent/readResult` with it is admitted
  and then sends nothing (free probes after the capture). The Agent map
  lists the runs with the same read-only view instead, and the header's
  pill counts their agents.
- **The trigger setting, read.** `run.workflow_trigger_mode` is read from
  Muse Code's settings file as `run.subagent_delegation_mode` is (D17),
  each member on its own; unset, it reads `auto`, as 1.3.0 ran (the owner's
  file has no `run` block, and the session's workflow guidance was the auto
  one). The Agent map says what the mode means and how to change it, with
  the file a click away, and Diagnostics names it. Opening the map now
  reads these account facts itself; before, the delegation note waited for
  Account & usage to have been opened.
- **Cost.** A workflow spends the subscription like any turn (each agent
  makes its own model calls, up to 1,000 over a run), so it is not a paid
  feature under D30; the auto mode's note says so. The card's token figure
  sums each child's latest reported attempt, not the subscription's billed
  total across retries (no retry run was captured).
- **Model API parity: none.** Workflows are Muse Code's own engine (its
  JavaScript script engine and child runs); the Model API backend has no
  workflow run to show.

<!-- plan-archive:end id="2-D40-01" -->

## D39 — Background work, the user's own shell, explanations, on both backends (2026-09-25)

<!-- plan-archive:begin id="2-D39-01" lines="3785-3853" bytes="4390" sha256="db909215fd610dcdbfa900098a027ff34ead336668e921d32ad64c839cc36a6b" -->

D36's rows "Background work, stop", "`!` user shell" and "Questions:
clarify" (M46). Two live captures on the contributor model (27 model
attempts, `docs/certification/m46.md`) gave the wire shapes:

- **`task/background`** on a running shell call answers
  `{commandId, status: "accepted", taskId}`, and an `item/updated` with
  `background: true, backgroundInitiator: "user"` arrives before the answer.
  The turn goes on; the model's tool result is Muse Code's background
  envelope (`execution_state`, `work_id`). **`task/stop`** ends it as
  `cancelled`, `failureReason: "cancelled by runtime client"`.
  **`task/stopAll`** is accepted over nothing too. A task that is not
  there is refused `commandRejected` with `data.reason: "invalid_target"`.
- **`session/userShell`** needs the `userShell` grant at the handshake
  (granted once asked). Its item is `userShell` with `turnId: null`,
  `commandText`, and at the end `exitCode`, `durationMs` and the output
  (no deltas): exit 0 completes, any other fails ("tool failed: exit code:
  3\nstdout: …"). With the Windows sandbox on and not set up it fails
  with "managed shell sandbox is unavailable". Its item id is not a
  UUIDv7, and `task/stop` refuses it as invalid params: a `!` command
  cannot be stopped on Muse Code. The model sees it with the next turn
  (asked, it named the word the command printed).
- **`userInput/clarify`** takes `clarification: {format: "text", content}`
  and settles the prompt `clarified`, no answers, the text beside them; the
  model answers from it.

The choices:

- **Ctrl+B** is a contributed command, **Muse Spark: Move Running Command
  to Background**, bound to `ctrl+b` on every platform (the TUI's key;
  `Cmd+B` stays VS Code's sidebar on a Mac) only while the conversation in
  view runs a shell call in the foreground: a context key the controllers
  keep, for the surface in view. It moves every such call. A running shell
  row has the same as a button. Only shell calls are offered: they are what
  the capture moved.
- **Stop** is on a background row and in the Agent map, with **Stop all**
  there and **Muse Spark: Stop Background Tasks** in the palette. A button
  waits for the host, as a decided approval card does (M25): the row's next
  update or a refusal (`taskRefused`) frees it. A stopped row reads
  "Stopped" with its reason, on both backends.
- **The Model API backend runs the same** (D36 parity, not too large to
  build): a shell call runs on its own stop, linked to the turn's until it
  moves. Moved, the call answers the model at once
  (`MODEL_TEXT.shellMovedToBackground`), the row is updated and kept in the
  history running, and the command's time limit is lifted (a
  `ShellTimeLimit` the runner binds, the job-object runner unchanged
  otherwise). When it ends, the row completes and what it printed is added
  to the replay as a user note: at once while nothing runs, else at the
  running turn's next request or its end, never inside a call and its
  output. Muse Code's runtime wakes its agent when background work ends;
  this backend makes no model call nobody asked for, so the note waits for
  the next request. The turn's Stop leaves a moved command running; its
  own Stop, Stop all and the session closing end it. A stored session
  brought back, or a fork, shows a command its original still runs as
  interrupted, and a stored one also tells the model the command ended
  with its window.
- **`!` commands** run as typed, outside any turn, with no approval card in
  any permission mode (the user typed them), and never in Restricted Mode
  (D13): the controller refuses before any session, and the Model API
  session refuses too. On Muse Code they run through the CLI's own shell
  and sandbox posture (D12), and its sandbox failure offers the setup as
  the shell tool's does. On the Model API backend they run through the
  shell tool's runner (job objects, M27) for at most ten minutes, and the
  row has a Stop; the model reads the command and its output with its next
  request, as above. A refused command comes back to an empty prompt with
  the reason.
- **Explain instead** on the question card sends up to 500 characters
  (MSP's limit, held by the box, the protocol schema and the Model API
  session); the Model API's `ask_user` returns the text to the model as
  Muse Code's clarify does, and the row reads "Explained: …".

<!-- plan-archive:end id="2-D39-01" -->

## D41 — One memory for both backends (M49, 2026-09-25)

<!-- plan-archive:begin id="2-D41-01" lines="3857-3959" bytes="6947" sha256="71940f236eef3d707d2e3938fa58f41eec098143be19d1bb43cf862e4cd2cb24" -->

Muse Code has no MSP method for memory (`memory/list` is `methodNotFound`)
and no CLI subcommand (the saved `--help` output has none); its memory is
Markdown files its agent tools read and write. What was established, and
how:

- **Where the notes live.** Found on disk (names only) and confirmed by a
  live capture with the data home moved into a throwaway folder
  (`docs/certification/m49.md`): `project` is `<workspace>/.agents/memory`;
  `personal` is `$XDG_DATA_HOME/muse/memory/personal`; `personal_project` is
  `$XDG_DATA_HOME/muse/memory/projects/<slug>-<key>`, where the data home
  is `~/.local/share` when `XDG_DATA_HOME` is unset (Windows included). The
  key is the FNV-1a 64-bit hash of the UTF-8 workspace path as Rust's
  `canonicalize` spells it (`\\?\C:\…` on Windows, the operating system's
  own letter case, so VS Code's lower-case drive letter is not used), in
  16 hex digits; the slug keeps ASCII letters, digits and hyphens, turns
  anything else into a hyphen and trims the ends. Both rules were checked
  against the two folders Muse Code made (`C:\muse-live-m43` →
  `C--muse-live-m43-7bdb42d98a06c29b`; `C:\muse-live-m49\My Proj.v2_x+é` →
  `C--muse-live-m49-My-Proj-v2-x-0175e6b82ee81b32`). A folder that already
  ends in the key is used whatever its slug, so a slug rule the capture
  could not show (a POSIX leading slash, a UNC path, a very long path)
  costs nothing once Muse Code has made the folder. Each scope root holds
  Muse Code's `.muse-memory.lock` (`pid=<n>`), an operating-system lock.
- **What the tools do** (the capture and the binary's strings): arguments
  `{path, scope}` plus `content`, optional `type` (`user`, `feedback`,
  `project`, `reference`) and `description` for `add_memory`; `offset`
  (default 1) and `limit` (default 500) for `read_memory`; `old_str` and
  `new_str` for `edit_memory`. A new note with `type` or `description` gets
  them as front matter (`---\ntype: …\ndescription: …\n---\n\n` before the
  content); an append joins after a blank line and leaves the front matter
  as it was; no trailing line break is added. A read's `content` is the
  window's lines with their own breaks, `truncated` when lines follow.
  Results are JSON (`{success, scope, path, operation, message}`; a read
  `{success, scope, path, start_line_number, content, truncated}`); a
  failure is a failed item whose reason is in Muse Code's own words, such
  as "memory file not found" or "old_str not found". Muse Code does not
  write `MEMORY.md` itself: the model keeps it.
- **Approvals in Muse Code.** In `promptUnmatched` its memory writes ran
  without a card; only calls whose path it then refused asked first.

The decisions:

1. **One store, two users.** `src/core/memory/memoryStore.ts` places,
   validates, reads and writes notes by Muse Code's rules; the Model API
   backend's tools and the Memory view both use it, in the data home
   `muse serve` sees (`museSpark.environmentVariables` included). A note
   written on one backend is read on the other.
2. **The Model API tools are Muse Code's**: same names, arguments,
   descriptions (the binary's), refusals and JSON, so the M43 rows render
   them unchanged. They are offered in a trusted workspace only (D13); in
   Restricted Mode they are not offered and a call is refused. D13's point
   3 (personal memory not loaded) is superseded: its location is now known.
3. **Approval like an edit, not like Muse Code.** A write asks in Manual,
   runs in Auto and Edit automatically (its card is a `fileWrite` naming the
   note), and is refused in Plan; a read never asks. It is never a protected
   write although project notes sit under `.agents`: the tools can write
   only Markdown notes in the memory roots, while the file tools keep
   `.agents` protected. Muse Code writes without asking in Manual; asking
   is the safer default for notes that reach every later session (the
   personal scope, every project). A path Muse Code would refuse is refused
   before any card.
4. **The index kept true by the extension.** A note the Model API tool or
   the Memory view creates gets `- [name](path) | hook` in its scope's
   `MEMORY.md` (the description, else the note's first line) unless a line
   already links to it; a note the view deletes loses its lines. Muse
   Code's own tool leaves this to the model, which on the Model API backend
   is told the tool does it. A failed index write leaves the note written
   and is logged.
5. **The session-start snapshot**, as Muse Code's docs describe it: each
   scope's `MEMORY.md` (200 lines, 32 KB, Muse Code's marker) and the paths
   of up to 48 other notes, in the instructions, read once per session.
   Notes must be UTF-8 (Muse Code: "memory file must be valid UTF-8"); the
   M10 loader's UTF-16 index support is dropped with it.
6. **No link, no hidden file.** A path through any link below the workspace
   or data-home anchor, including the scope's root itself, is refused (Muse
   Code: "memory path contains a symlink"); the listing never enters a link
   or a hidden entry. Windows device names and streams are refused as the
   file tools refuse them.
7. **Muse Code's lock is not taken.** A read-only local audit found a
   persistent `.muse-memory.lock` containing `pid=<n>` even after that PID
   exited. Muse Code 1.3.0's binary places the lock name beside `memory
lock busy: a native write holds the view` and `memory lock failed:`, and
   imports `LockFileEx`/`UnlockFileEx` on Windows. A read-only disassembly
   of 1.3.0's generic locking helpers shows shared/exclusive try-locks over
   a zero-based `0xffffffffffffffff`-byte range. It does not prove which
   helper the memory writer calls, how long that guard is held, or the
   cross-platform protocol; Node 24.20 exposes no file-lock API. A lock
   file's presence or PID is not ownership. Without proven interoperation
   the extension does not take or imitate that lock (no new native
   dependency). Existing-note writes replace the file whole (temporary file,
   rename), so a note is never half written; two writers on one note in the
   same instant may lose one write (§9). A new note needs a separate
   no-clobber publication: write and sync a hidden stage in the same folder,
   then hard-link the complete file into the target name. A filesystem that
   cannot link refuses the create; it must not fall back to a visible partial
   `wx` write or an overwriting rename. Add the index line only after the
   target has been published successfully. This does not solve the native
   lock or concurrent updates to an existing note or index.
8. **The view** is a quick pick on both backends, as M31's views are:
   up to 500 notes per scope, nested up to eight folders, with their
   summaries; open in an editor, new note (scope,
   name checked by the store's rules, `.md` added, description), delete to
   the trash after a modal. Muse Code's own settings are never written.

<!-- plan-archive:end id="2-D41-01" -->

## D42 — MCP servers on the Model API backend (2026-09-25)

<!-- plan-archive:begin id="2-D42-01" lines="3963-4069" bytes="7256" sha256="ffacda3041308faaf9dab5a40af6d8f0a53d6e4668e804d7c46f2acbe8fc42aa" -->

M50 of D36: the key backend runs the MCP servers Muse Code would, with a
client of its own and no new dependency. What Muse Code does was read from
its public pages (extending: `mcp_servers`, `transport`, `mode`, `framing`,
`${VAR}`; the 1.2.1 changelog: read-only tools run without a prompt under
on-request approvals, `startup_timeout_sec`, `tool_timeout_sec`, `cwd`,
protocol 2025-06-18 on both transports) and from its 1.3.0 binary (the
settings types `McpTransportSetting` = `stdio` | `streamable_http` and
`McpStdioFramingSetting` = `auto` | `content_length` |
`line_delimited_json`, "Probe line-delimited JSON, then fall back to
Content-Length framing", the validation messages, the migrate skill's
settings contract and its environment allowlist). No model call was made:
the backend is tested against a fake stdio server and a fake HTTP server.

- **The same servers.** M31's reader, extended to hand each entry whole
  (`readMcpServerEntries`); the view it feeds stays secret-free. The two
  faults that make Muse Code load no user server (both keys in one file,
  `required` beside `mode`) load none here either, and say so.
- **One set per window.** The servers belong to the Model API host: they
  start with the first conversation (`session/start` or a resume, as Muse
  Code starts them with a session), the first turn waits for them, and they
  stop with the host (a restart, sign-out, the window closing). Muse Code
  gives each stdio server `MUSE_SESSION_ID`; these serve every session of
  the window, so none is given. Closing while servers start waits for the
  active batch to shut down and starts no later batch.
- **Trust.** Nothing starts in Restricted Mode, stdio or remote; the next
  message after the workspace is trusted starts them.
- **Required and optional.** A required server (the default; only `mode:
optional` is optional) that is not running fails the turn with the reason
  and the fix, as Muse Code aborts its run. Its state is checked after each
  model stream and tool call, and before more work in the turn; calls left
  unrun still get replay outputs. An optional one is a warning
  notice, once per session. The palette's **MCP servers…** row now shows
  on the Model API backend too, with each server's live state.
- **Transports.** stdio: the command started directly (absolute `PATH`
  entries only, D24); a `.cmd` or `.bat` (npx's launcher on Windows)
  through `cmd.exe /d /s /c` with every part quoted and `"`, `%` and line
  breaks refused; its stderr to the log; closing ends its input, waits
  1.5 s, then ends its process tree (D25). On Windows the hidden job helper
  inherits only three binary stdio handles from the extension, creates the
  server suspended, assigns it to a kill-on-close job, then resumes it. The
  helper holds a handle to the creating extension process and closes the job
  when the server or extension exits. A separate private pipe carries a
  nonce-bearing READY/GO exchange after the helper binds that process handle;
  a dead creator cannot authorize a server even if its PID is recycled
  before the bind. The pipe and nonce never enter MCP stdio or the server's
  environment. The M50 job executable is compiled once and started directly
  for each server. If it cannot be compiled or started, stdio fails closed
  instead of starting without containment;
  streamable HTTP remains available. `auto` framing writes lines and
  switches to Content-Length when the server's first bytes are that header;
  a server that never answers a line fails its start-up with the hint to set
  `content_length`. Streamable HTTP: POST with JSON or event-stream replies,
  the session id and protocol version sent back, a server request (`ping`)
  answered, a 404 on a known session starting a new one, DELETE on close, a
  redirect refused so no header follows it.
- **Environment.** A stdio server gets the allowlist Muse Code uses (HOME,
  PATH, USER, LOGNAME, TMPDIR, TEMP, TMP, SHELL, LANG, LC_ALL, TERM,
  COMSPEC, PATHEXT, SystemRoot, WINDIR) plus USERPROFILE, APPDATA and
  LOCALAPPDATA, which npm and Python look for on Windows, then its entry's
  `env`. `${VAR}` in any string is read from the extension host's
  environment; an unset one keeps the server from starting and is named,
  never its value. (The binary's migrate skill says Muse Code does not
  expand `${VAR}`; its public changelog says it does; the public statement
  was followed.)
- **Sign-in.** `muse mcp login` tokens are Muse Code's and never read here.
  A remote server that needs a credential takes it as a header in its
  entry; a 401 or 403 says so.
- **Names and schemas.** `mcp__<server>__<tool>`, Meta's characters only
  (every other one, and every dot, becomes `_`), the server's part never
  holding `__`, 64 characters at most with a hash where a name is cut or
  taken. A configured name that normalizes to the extension's reserved
  `ide` server name is refused, so no function can collide with its IDE tool.
  A schema is cut to Meta's documented limits (depth 10, 5,000
  properties, 120,000 characters of names and values, 1,000 enum values, a
  large string enum capped, 200,000 nodes after `$ref`s are written out);
  local `$ref`s are written out and a recursive one cut, since Meta refuses
  recursion; a schema still past the limits is offered as "an object" and
  the model is told so. The server checks the arguments either way.
- **Results.** Text, and pictures as `input_image` parts of the function's
  output (the Responses schema allows content parts there), each checked to
  be a PNG, JPEG, GIF or WebP within 10 MiB first, since a picture Meta
  cannot read would fail every later request of the conversation. Audio,
  links and binary resources are described in words; structured content
  stands in when there is no text; a tool error is a failed row.
- **Approvals.** An MCP tool is arbitrary code:

  | Mode                       | A tool  | A tool its server marks read-only |
  | -------------------------- | ------- | --------------------------------- |
  | Bypass                     | runs    | runs                              |
  | Auto                       | asks    | runs (Muse Code's on-request)     |
  | Manual, Edit automatically | asks    | asks                              |
  | Plan                       | refused | asks                              |

  "Always allow in this session" is kept per tool. The card is a tool's,
  never a file write's, whatever the arguments hold, so Edit automatically
  never answers it.

- **The IDE tool.** `getDiagnostics`, which Muse Code sessions reach as
  `mcp__ide__getDiagnostics` over loopback, runs in process here under the
  same name, as a read in every mode. A user's server named `ide` is refused.
- **Limits.** Start-up 30 s and a call 300 s unless the entry says (capped
  at an hour); a message 20 MiB either way; 128 tools a server and 20
  pages of them; a description 2,048 characters; a result 64,000.
- **Not done.** Resources, prompts, sampling, roots and elicitation (the
  client declares no capabilities and refuses such requests), OAuth, the
  servers' `instructions`, and the server-initiated event stream over HTTP
  (a tool list that changes between replies is seen at the next one).

<!-- plan-archive:end id="2-D42-01" -->

## D43 — Enterprise network and posture (2026-09-25)

<!-- plan-archive:begin id="2-D43-01" lines="4073-4198" bytes="8525" sha256="6ea5befff50c406ab33a434a98b383e17650bce2d29f37b44670724192367e10" -->

D36's last row: proxies and certificates for the extension's own traffic,
Muse Code's `--sandbox-network` and `--no-session-log`, `muse config
status`, and the Model API's prompt cache. What was read or captured first
(2026-09-25; the capture is `docs/certification/m56.md`):

- **VS Code already routes an extension's `fetch` and `WebSocket`.** VS
  Code 1.125.0's `src/vs/workbench/api/node/proxyResolver.ts` (tag 1.125.0,
  with `@vscode/proxy-agent` ^0.42.0) replaces the extension host's global
  `fetch` (`createFetchPatch`, on while `http.fetchAdditionalSupport` is, by
  default) and global `WebSocket` (`createWebSocketPatch`, proxy-agent
  0.39.0, on while `http.webSocketAdditionalSupport` is, by default). Each
  request gets the proxy for its URL (`http.proxy`, else the system's
  settings or PAC file through Electron; `http.noProxy`; `http.proxySupport`
  `override` by default), proxy authentication (Basic through VS Code,
  Kerberos), and the operating system's certificates (`http.systemCertificates`,
  by default). The shipped 1.139.0 extension host carries the same code. So
  the Model API client and the Muse Voice socket need no proxy client of
  their own and no dependency.
  **Amended 2026-09-27, with M62's 1.99 floor** (`docs/certification/m62.md`,
  "The floor after M48–M56"): read again at the tags from 1.99.0 to 1.125.0,
  `fetch` is patched at every one (1.99.0: `patchGlobalFetch`, proxy-agent
  ^0.32.0), but `WebSocket` only from **1.112.0** (proxy-agent ^0.39.1; the
  `http.webSocketAdditionalSupport` setting appears there). On 1.101 to
  1.111 Muse Voice's socket therefore goes to Meta without VS Code's proxy
  and certificate handling, and on 1.99 and 1.100 there is no WebSocket at
  all. Diagnostics says per global whether the editor routes it (the
  global VS Code sets beside each patch), and the README says what to use.
- **Node 24.20** reads `NODE_EXTRA_CA_CERTS` when the process starts, for
  every TLS connection; `--use-system-ca` and `NODE_USE_ENV_PROXY` are
  process switches an extension cannot set. Its `fetch` throws `TypeError:
fetch failed` with the reason in the causes: captured, `ECONNREFUSED`;
  `DEPTH_ZERO_SELF_SIGNED_CERT` from a self-signed server; and from a proxy
  answering the tunnel with 407 or 403, `Request was cancelled.` over
  `Proxy response (407) !== 200 when HTTP Tunneling` (`UND_ERR_ABORTED`).
- **Muse Code 1.3.0's network.** Its binary reads `HTTPS_PROXY`,
  `HTTP_PROXY`, `ALL_PROXY` and `NO_PROXY` in either case (and has its own
  `endpoint_transport.proxy` settings key); its changelog: "HTTP and HTTPS
  proxy environment variables are respected for all network traffic". Its
  TLS is rustls over the operating system's store (the binary enumerates
  the Windows store) and it reads `SSL_CERT_FILE` / `SSL_CERT_DIR`, which in
  rustls-native-certs replace that store ("certificates are only loaded
  from the locations specified via environment variables and not the
  platform-native certificate store"). With a recording proxy (no model
  call), its start-up `CONNECT api.meta.ai:443` went through the proxy, and
  so did `POST http://127.0.0.1:<port>/mcp` to a loopback MCP server, the
  extension's `ide` server's address, until `NO_PROXY` listed 127.0.0.1.
- **`muse serve --sandbox-network <restricted|enabled|proxy-only>`**,
  `proxy-only` by default (each new destination asks, as a network approval
  card); a wrong value exits 2 naming the three; with `--disable-sandbox`
  the flag is ignored with a stderr line. The managed policy has
  `execution.network_sandbox_modes` and `execution.approval_modes` keys.
- **`muse serve --no-session-log`** makes the host `sessionDurability:
"ephemeral"`, and Muse Code 1.3.0's memory-only host does not work over
  MSP. One turn on the contributor model: the turn ran to completion in
  the CLI's trace log, but the client received no `turn/*` or `item/*`
  notification (the view cursor is the placeholder
  `pending:seam-c-session-view-fold`); `view/subscribe`, `view/page`,
  `session/read`, `session/resume`, `session/fork` and `session/rename`
  answer `methodNotFound`; and `session/start` and `session/setApprovalMode`
  refuse `onRequest` and `allowAll` with `commandRejected` /
  `approval_mode_ceiling`.
- **`muse config status`** prints the managed planes' state, one line per
  plane and source (`plane=policy source_class=system_file state=absent`),
  and a generation digest; `--json` is refused; nothing reached a recording
  proxy while it ran.
- **Prompt caching** (dev.meta.ai/docs/prompt-caching, protocols/responses,
  pricing-rate-limits): the prefix is cached with no key; the key routes
  requests that share a prefix together: "Use one stable key per shared
  prefix … Don't over-partition: unique keys per user or per session lower
  hit rates." `prompt_cache_retention` is `in_memory` (the default) or
  `24h`, "a hint, not a guarantee", and "Set '24h' retention for bursty
  workloads … with idle gaps". The pricing page has one cached-input rate
  and no charge for retention. The extension sent the session id as its key.

The choices:

- **No proxy client of the extension's own.** VS Code's is complete and
  follows the user's VS Code settings; the extension takes `globalThis.fetch`
  at each request (not bound at activation) so whatever VS Code has
  installed carries it. A request that never reached Meta says why, from
  its causes: an untrusted certificate (the store to check), a proxy that
  wants credentials or refused the tunnel, no route; Node's detail follows.
  The detail must redact a quoted secret field in full, including spaces,
  before it reaches a panel notice or log.
- **Loopback bypasses Muse Code's environment proxy.** Wherever its environment
  names a proxy (VS Code's `http.proxy` handed over, or the user's own),
  `127.0.0.1`, `localhost` and `::1` are added to its `NO_PROXY`; the
  entries already there stay. Before, `http.proxy` without `http.noProxy`
  cut Muse Code off from the IDE tools.
- **Validate VS Code's proxy settings before building the CLI environment.**
  `WorkspaceConfiguration.get<T>` supplies a TypeScript type, not a runtime
  check. A malformed `http.proxy` or `http.noProxy` must fall back to an empty
  value instead of becoming a process environment variable; Diagnostics
  reads the same validated values for its set/count facts.
- **Certificates for Muse Code are left to the system store.** It already
  reads it; `SSL_CERT_FILE` would replace it, so the extension never sets
  one (a `NODE_EXTRA_CA_CERTS` file holds only the extra roots). The README
  says so, and Diagnostics says whether one is set.
- **`museSpark.sandboxNetwork`**, machine-scoped (a repository must not
  open the sandbox's network): `default` passes nothing, so Muse Code's
  default or a managed configuration's decides; the three modes pass the
  flag while the sandbox is on, never without it (the log says it has no
  effect then). Changing it restarts the host, like `shellSandbox`.
- **`--no-session-log` is not offered.** A setting that makes the panel
  silent would be a broken feature; the capture and an upstream report are
  the record, and the setting comes when a Muse Code release serves a
  memory-only host's view. The host's existing warning for a non-durable
  host stays.
- **A permission mode above the ceiling** (the captured
  `approval_mode_ceiling`, from a managed `execution.approval_modes` or a
  default permission profile) is refused with a sentence that says so and
  names a stricter mode, instead of MSP's text.
- **Diagnostics** adds the network posture (booleans and counts; never a
  proxy's address, which can hold a password) and known-safe source and
  generation fields from `muse config status`, run in `muse serve`'s
  environment. Unrecognized lines and failed-command output are withheld.
- **Prompt caching as documented**: `prompt_cache_key` is
  `muse-spark-code-` and 32 hex characters of a SHA-256 over the model, the
  instructions and the tools, the prefix a workspace's conversations share
  (a compaction, which sends no tools, gets its own); and
  `prompt_cache_retention` is `museSpark.modelApiPromptCacheRetention`,
  `in_memory` by default, with `24h` only when the user chooses it. Both
  have the same cached-input price; the longer value may improve cache hits
  after a pause but asks Meta to retain the cached prefix longer. The
  setting is machine-scoped, so a repository cannot raise the user's choice
  through `.vscode/settings.json`.

<!-- plan-archive:end id="2-D43-01" -->

## D45 — Subagents on both backends (M48, 2026-09-25)

<!-- plan-archive:begin id="2-D45-01" lines="4202-4257" bytes="3818" sha256="47d9801d6180b433d7ef16280a3f014d3d66a69cda5f11ec50ced4308d823d06" -->

The Model API backend runs bounded child sessions with their own conversation
and the parent's workspace rules, tool permissions and model. The initial
prototype let Bypass spawn a child without a paid card. M48 now requires a
machine-scoped gate, price acceptance, one-use consent and a four-request
ceiling for every new child task, including retries. Merged as PR #35
(`a9dec5a`) after local and hosted gates. Each child
has a row and transcript in the Agent map, receives a note or follow-up, and
can be stopped. Child model calls use the stored Model API key and count in
the parent's token usage. The parent may continue while children work; a
limit bounds the number running and the number a conversation can create.
The child cannot spawn further children or ask the user directly. A closed
child's result remains readable. No child writes outside the existing tool
confinement and approval rules.

**Paid child admission (owner-cost rule, 2026-09-26).** The initial spawn-mode
prototype was not delivery consent for extra BYOK calls. Subagents are a
machine-scoped paid feature, off until its price is accepted. Every new
child task—spawn, follow-up, reopen or resume—requires a one-use approval
in every mode, Bypass included; Plan refuses it. The approval names the
objective, selected model and its Standard or Contributor input, cached
input and output prices, and a hard ceiling of four actual Model API
response POST attempts for that task. HTTP and whole-stream retries and
tool rounds spend the same ceiling. A note to a child already running uses
the remaining grant; it never renews it. No grant survives a process
restart. A queued task starts only while its gate, consent, key, model and
originating goal are still valid. After SecretStorage reads the key and
immediately before each child HTTP attempt, the client rechecks these and
consumes one attempt; a failed or unanswered attempt still counts, with
unknown cost if Meta supplies no usage. A spent cap, revoked gate, changed
key or model, switch to Plan, or exhausted originating goal ends the child
task with a localized visible refusal. Stop or disposal while a key read or
owner modal waits invalidates admission. A child request carrying paid web
search is refused if that gate turned off before the request is sent. A
removed key after approval receives the same localized changed-key refusal.
For a restored queued child, the new price decision names every retained
pending note in the exact task that the child will receive; changing that
task while the modal is open invalidates the decision. A
failed response with reported usage charges that usage once; a failed
attempt without usage keeps unknown cost. The output cap remains 32,768 tokens per
request; four attempts are a request ceiling, not a dollar or token-cost
maximum. Child tokens already appear in the parent's conversation total,
so their estimated cost is a subset, never added to it again. Other paid
tools keep their own separate gates and approvals.

An approval a child is awaiting is replayed to a newly attached panel as
pending, with the same no-auto-decision marker as a parent approval; a
late panel can answer it through the parent session. A child's token-usage
delta counts once in the parent's total and against the goal active when
that child turn began, while that same goal still exists. Replacing the
goal before the child answers never charges the replacement goal.

Muse Code's SDK lists `subagent/reopen` and `subagent/readResult`, but M48
captured neither an accepted command nor its resulting item update. The
Agent map keeps the captured M18 controls; those two verbs remain unavailable
until a bounded live owner-command capture establishes their success shapes.
The Model API backend's local read and reopen actions are separate from MSP.

<!-- plan-archive:end id="2-D45-01" -->

## D46 — Conversation rewind and side chat (2026-09-25)

<!-- plan-archive:begin id="2-D46-01" lines="4261-4302" bytes="2771" sha256="c04231d6fa01cf522a263b92f8869fcba9e98116f31c33aad04295543f881dfb" -->

Muse Code 1.3.0 exposes neither `session/rewind` nor `session/sideChat` over
MSP. Conversation rewind uses the supported `session/fork` cut point just
before the selected user turn, then restores that turn's prompt as a draft.
The first turn rewinds to a fresh conversation. Code rewind remains a separate
choice; its existing edit review refuses changed files. The prior session
stays in History. A Model API fork rejects a cut before its latest compaction
summary, because that summary contains later context. Images return to the
composer when the backend retained their bytes; a missing image is reported.

Side chat opens a separate tab forked from completed turns, with Plan mode
forced and the inherited goal cleared so it cannot continue there. The Model
API backend denies write tools in that mode. Muse Code
applies its project and session allow rules, so its side fork is not claimed
strictly read only. The main tab
and any running turn remain attached. Closing the side tab returns focus to
the original tab; its fork stays in History. Muse Code 1.3.0 on Windows has a
known `session/fork` failure, so both conversation actions remain unavailable
there until the CLI fixes that method. A side chat is an ordinary Model API or
Muse Code model call on the selected backend, never a paid Model API feature
called through a Muse subscription.

The Model API Plan statement covers its tool-permission engine. With M51 and
M52 merged, a durable side session suppresses hooks and refuses external MCP
tools regardless of a server's read-only hint, and core refuses scheduled
create, cancel and run before storage, claim or paid use; certified with M53
(PR #41, run 36298748478).

PR #41 review narrows the rewind boundary: a steered user card shares its
turn with the original prompt, so its fork cut must use the preceding
distinct completed turn or a fresh conversation. Rewind of a selected turn
still running is hidden and refused until its steered image replay settles.
Restored Model API image bytes must match the selected user card's persisted
item identity, never the first user-role replay entry with the same turn ID.
Accepted compaction must record its actual summarized turn across save and
resume; a missing replay entry alone does not prove a compaction boundary.
A Muse Code side panel may resume only its own side fork, never another
ordinary session from History.
Live cards retain a webview-local ID until History reload, so Model API turn
acceptance must also return the backend-reserved replay item ID. Keep the
local ID for UI reconciliation and use that durable ID for image restoration,
including steering, queued turns and acknowledgements arriving after a turn
already completed; never treat a webview-supplied ID as a durable backend ID.

<!-- plan-archive:end id="2-D46-01" -->

## D47 — File input follows each backend's proven wire (2026-09-25)

<!-- plan-archive:begin id="2-D47-01" lines="4306-4441" bytes="9642" sha256="d6a76260bb602445c8fda387f6422f9795a0f2d003d668da41e7ed60d7f6ba72" -->

Meta's [file handling guide](https://dev.meta.ai/docs/file-handling) permits
`input_file` with inline `file_data` on Responses requests, and says PDF text
comes from the first 100 pages, with page images from the first 50 sharing a
50-image request budget. The pinned Muse Code SDK 1.3.0 defines only text,
image and skill input parts. Its [file input request](https://github.com/meta-models/muse-code-sdk/issues/48)
tracks the missing MSP feature. We do not send an invented part to Muse Code.
The Muse Code attachment store budgets serialized text and image parts together,
leaving 2 MiB of its 10 MiB MSP frame for the prompt, context and envelope;
an impossible file combination is refused before it becomes a chip. The
exact outbound frame check remains the final guard for unusually large
prompts or selections.
Muse Code also recomputes this attachment budget at both `turn/start` and
`turn/steer`: an image accepted under Model API can survive a backend switch,
so the active backend must refuse its now-incompatible chip before submitting
a command, with a remove-attachment reason.
Every known localized attachment refusal keeps its specific banner text in
the composer, including PDF size/backend, shared media, text context and
private-file reasons; only an unrecognized host refusal falls back to generic
unsupported-file guidance. The live announcement still says the actual reason.
Model API text attachments have a separate 768 KiB aggregate UTF-8 content
and named-wrapper allowance. This conservative byte bound stays below the
1,048,576-token context even for dense text and reserves roughly 256K tokens
for prompt, replay and output (32,768 maximum); a large single file can be
refused despite its 1 MiB per-file read cap. It does not account for an
already long replay, which the Model API may still refuse at its context
limit.
During an active turn, its initial named text files and every accepted steer
share that same 768 KiB allowance. A steer that would cross it is refused
before entering the next replay request. Draining steering into replay does
not reset the turn's admission count; a separately queued turn validates its
own parts before it starts.

- **Model API:** PDF bytes, checked by header, may be attached from the file
  picker, clipboard or drop, up to 32 MB each; the inline base64 stays below
  Meta's 50 MB limit. No persistent Files API upload or new dependency.
  Images still work. A bounded UTF-8 text file picked from the trusted workspace and
  visible in its file index becomes a named `input_text` part after its real
  path is checked against symlink escapes; read the same checked absolute
  target after the indexed/private check so a retargeted alias cannot swap in
  private bytes. Protected/private paths are
  refused. Binary file types are refused, never decoded as text. The
  Model API `read_file` tool reads UTF-8 text, PDFs and images from confined
  workspace paths. A PDF or image read by that tool travels as a user content
  part after its function-output round, so the model actually sees it. Its
  function `output` stays English for the model, while the transcript's
  `visibleOutput` uses the installed `UI_TEXT` language, with page counts,
  byte sizes and image dimensions formatted in that locale. A known PDF page
  count takes the language's plural form; an unknown count has its own label.
  Focused tests check a non-English table and grouped numbers without changing
  the model-facing text.
- **Muse Code:** images retain their MSP path. A PDF attachment gets a clear
  refusal naming the Model API backend, including when its extension is
  disguised. A bounded text attachment becomes an MSP text part with the
  file's name and content; no invented file part. Other unsupported types
  remain path mentions or explicit refusals. Native file parts wait for an
  MSP release and a captured wire shape.
- **Budget and history:** attached images and countable PDF page images share
  50 slots per new message. An uncountable PDF reserves all 50. The Model API
  page counter reads only the page-tree dictionary's direct `/Count`; a
  nested dictionary's unrelated `/Count` must not shrink that reservation.
  If the direct count cannot be established, the PDF is uncountable here.
  An escaped page-tree `/Pages` or `/Count` name can hide a real count behind
  an unlinked visible decoy; comments between `/Type` and `/Pages` or after
  `/Count` can do the same. Treat these ambiguous forms as uncountable and
  reserve all 50 slots. A visible page-tree candidate with a missing,
  non-positive or out-of-range direct count is ambiguous too: a separate
  one-page decoy must never lower the reservation. A `/Count` followed by an
  indirect-reference suffix (`5 0 R`) names an object, not five pages; treat
  that tree as uncountable rather than trusting the reference's object number.
  An indirect `/Type` may name the real `/Pages` tree while a visible direct
  `/Type /Pages` dictionary is unlinked; reserve all 50 until the real tree
  can be established without resolving arbitrary objects. Signed object
  numbers such as `/Type +5 0 R` are equally ambiguous and reserve all 50.
  The Model API
  extension also caps base64 media to 48 million characters per new message
  and replay request. This is a conservative aggregate memory/request bound,
  separate from Meta's 50 MB **per-file** inline limit. An over-cap new
  attachment is refused with a localized banner. The Model API replay,
  including compaction, keeps newest visible media within both budgets and
  replaces older media with a plain explanation; the panel announces that
  older media was left out. After a fitted request succeeds, its replacement
  text becomes the durable replay: omitted PDF/image base64 must not remain in
  `snapshot()` or a resumed session. Transcript history keeps attachment
  names, types and counts for the UI without retaining those omitted bytes.
  A request that has not completed must not prune pending tool-read media;
  its later Stop/failure still gets the path-only cleanup in this decision.
  Tool `read_file` batches reserve both encoded characters and the same 50
  image/page slots before a file reports success. An unknown-page PDF takes
  all 50 slots. A later file that cannot fit returns the media-budget error
  before its bytes enter queued replay, so a successful earlier file is not
  silently replaced during the next request's replay fit.
  Visual parts from any function-call output in the current tool batch share
  that admission budget with queued `read_file` media. Count them once until
  a completed model request carries the parts; a failed request or Stop must
  not mark them delivered. A later read that would displace an undelivered
  image fails explicitly before its tool result reports success.
  Accepted user steering media reserves that same first-delivery budget:
  a later tool result cannot displace it silently, and a steer that arrives
  after pending tool media is refused before it enters this turn. The panel
  can submit that prompt as a later turn after the pending media is delivered.
  A successful `read_file` stays reserved after its media moves from the
  current batch into replay, including while `PostToolBatch` runs. The
  reservation ends only after the first completed request carries or durably
  omits that media, or Stop/failure scrubs it. A steer arriving during that
  hook cannot displace the unread PDF or image.
  Red/green tests bind the fitted request, snapshot, resume and unchanged
  history chips to that boundary. The
  `read_file` tool also stops collecting media in one tool round at the same
  encoded-size cap, returning a failed tool result for the excess file before
  it is retained; a burst of reads must not fill host memory before replay
  fitting runs. The
  UI shows PDF names as file chips and restores them from Model API session
  history. This does not claim the older bytes remain visible to the model
  after either budget clips them.
  A send that awaits autosave, editor context or backend selection binds the
  session and conversation generation it started with. If the backend stops
  or the session changes during those waits, the send fails before submitting
  to its old backend and keeps attachment chips for a fresh attempt. A
  disposed Model API session independently rejects new sends and steering,
  so a stale caller cannot initiate a paid HTTP request after release.
  A late submit acknowledgement is checked again before chips are released
  or `turnAccepted` is shown. The controller distinguishes its own
  `sessionNotLoaded` recovery from an external backend stop: only the owned
  recovery may adopt a new attachment generation, while an external stop
  always invalidates the original send, even during recovery lookup.
  Conversation rewind keeps its image-only behavior. PDF and named text file
  cards hide that choice in the panel, and a forged request is refused before
  fork or clear: exact file bytes cannot be restored from every backend and
  older History record, so a filename chip must not imply they came back.
  If a tool round stops or fails before its media is delivered, replay keeps
  a path-only explanation. Stop also removes a read-file media message from
  future replay when it interrupts that message's delivery request. A later
  stop or failure in the same turn must preserve PDF/image media that reached
  an earlier successful model response: only still-pending media from a later
  tool round is replaced by path-only text. Multi-round red/green tests cover
  both a later Stop and a later failed model request.

<!-- plan-archive:end id="2-D47-01" -->

## D48 — A popup before every paid use (M58, 2026-09-27)

<!-- plan-archive:begin id="2-D48-01" lines="4445-4491" bytes="3116" sha256="fcd7a1b12c20887186d8cbdeb7835bcaab7fe4c15794ddca65dc7efda3946cc7" -->

The owner (2026-09-27): "anything requiring extra payment should promt you
with a popup that asks allow once allow always in this workspace or deny".
Until then the paid features asked in four different ways: an in-chat card
with Allow once and Reject for a Model API image or child task, a native
dialog for an image on Muse Code, a scheduled run and a child task started
from the Agent map, and nothing per use for web search and Muse Voice (D34:
the price accepted once, then only the row, the badge and the tally).

- **One popup, three answers.** `PaidUseConsent.allows`
  (`src/core/paid/paidConsent.ts`) asks through `askPaidUse`
  (`src/host/paid/paidHost.ts`), a native modal naming what is about to be
  billed and its price, with **Allow once**, **Allow always in this
  workspace** and **Deny**; closing it is Deny. It asks in every permission
  mode, Bypass included. A paid call never gets an approval card or a
  session rule any more: `paidChoices`, the `paidTool` subject and the
  card's price line are gone.
- **What asks, and when.** An image, before it is bought (after every check
  that can refuse it for free, as before). A child task, before its grant;
  Plan still refuses it. A scheduled run, before its turn. A Muse Voice
  recording, before the recorder starts; a stop pressed while the popup is
  open cancels the start. Web search, once per prompt before its first
  request: Meta runs the searches inside the response and the model decides
  whether to search, so no popup can come before each search; Deny sends
  that prompt without the `web_search` tool. A child task searches only
  when its parent's prompt was allowed to (its grant carries the answer), or,
  for a task the user starts from the Agent map, when web search is allowed
  always here. A child never asks for itself.
- **"Always" is per workspace, and revocable.** It is kept in the
  workspace's own state (feature names with a grant generation, no content),
  offered and honoured only in a trusted workspace with a folder open. Every
  change to a feature's price acceptance (turned off, or a new price
  accepted) counts its generation up in global state, which voids every
  workspace's "always" for it. **Ask again every time** in Account & usage
  clears them for this workspace.
- **Still loud when silent.** A use that no longer asks keeps its paid row,
  the badge (whose tooltip names the features allowed always), and the tally;
  Account & usage marks each such feature "on, allowed always in this
  workspace". A hook's `allow` never answers the popup; a hook that demands
  a question, and a paid image aimed at a protected path (D24), ask even when
  the feature is allowed always.
- **Not asked:** an ordinary Model API turn the user types. Choosing the
  Model API backend with a pay-as-you-go key is that consent (D1, D37); the
  popup covers what costs extra beyond it.

**M80 headless amendment (D65):** interactive consent above is unchanged.
Headless images use the explicit flag, `acceptEdits`, hard cap and per-use
admission/tally; no remembered grant is accessed. Hosted search is refused.

<!-- plan-archive:end id="2-D48-01" -->

## D50 — TypeSafe, experimental: an assist to the Muse model, never a replacement (2026-09-27)

<!-- plan-archive:begin id="2-D50-01" lines="4649-4774" bytes="6251" sha256="d3eb0010d44c7d7a67a4c058d698c53bf5037bef8d2a35c91b75ee15f25d98d0" -->

The owner asked for research on TypeSafe (docs.typesafe.ai), "to see if there
is a way we can leverage this functionality somehow to improve stuff". Then:
"To be clear I would only want this as a tool to assist the muse model not
to replace", and "the typsafe stuff would be experimental opt in".

**What TypeSafe is.** Jev is a "System One" model, read 2026-09-27. It
takes text as `state` and typed questions, and returns calibrated answers
with probabilities and a confidence:

- a **Choice** among up to 255 options;
- a **Score** on up to 10 ordered levels;
- a **Noul**, the 0–1 probability that a statement is true.

It does not generate text or code. Its own docs say it is no replacement
for the model behind a coding agent, and name Muse Spark. The terms, from
docs.typesafe.ai/models, /api and /legal:

- `POST https://api.typesafe.ai/v1/systemone`, with a Bearer key;
- `jev-1.13.0`, $0.042 per million input tokens, output free;
- 64k tokens per request, 1,200 requests a minute, text only, English
  best;
- no training on customer data; zero retention on enterprise plans only;
- rate limits "can change without notice".

Its documented weak spots (docs.typesafe.ai/model-jaggedness/jev-1.13):

- literal reading;
- math, counting and dates;
- indirection;
- large irrelevant state;
- adversarial content.

**The ruling.** TypeSafe may only assist the Muse model. It never answers
the user, writes code, or decides an action alone:

- it only feeds hints, scores and relevance signals;
- the Muse model, or the extension's deterministic rules, act on them;
- where a signal is missing or unsure, behaviour is exactly what it is
  without TypeSafe.

**Constraints.**

- **Experimental and opt in.** Labelled Experimental wherever it shows
  (setting, palette, Account & usage). Off by default, with a
  machine-scoped setting under `museSpark.experimental.*`. It may change
  or be removed without notice, and nothing else depends on it.
- **Its own key.** The user's own TypeSafe key, kept in SecretStorage.
- **Disclosed.** PRIVACY names exactly what is sent and to whom.
- **Paid, with one named exception to AGENTS.md rule 12.** A TypeSafe
  call is billed to the user's own TypeSafe key, not the Model API key.
  Rule 12 names this exception; everything else in it and in D48 applies:
  - `typesafeAssist` joins the `PaidFeature` union and runs only while
    `PaidFeatureGate.isOn` says so: the setting on, machine-scoped and off
    by default, and its price accepted in the confirmation;
  - it is named in the composer's badge, shown as a row marked paid, and
    counted in `PaidUsage` for Account & usage;
  - every use asks in the paid-use popup, whose "Allow always in this
    workspace" makes per-turn assist bearable;
  - neither the Muse subscription nor the Model API key pays for it, and
    the TypeSafe key never reaches `muse serve` or any child process;
  - it is offered only where the extension itself makes the call, and
    only while a TypeSafe key is stored.
- **Timeouts.** Short. A failed call gives no assist for that decision
  and is logged; it never blocks the turn.

**Model API first.** Muse Code runs its own skill choice and approvals, so
only the extension-side uses reach it.

**The uses, ranked** (M85):

1. **Skill suggestion.** Before a turn, rank the skills against the user's
   message, then verify the top candidates. At most one "relevant skill"
   hint line goes into that turn's context; the model keeps its full index
   and its own judgement. TypeSafe's cookbook measured wrong skill loads
   falling from 16.8 % to 7.3 %, and loads when none fit from 9.8 % to
   4.0 %. The same pattern suggests a custom agent (M76).
2. **Auto risk score** (M78). A Score and Nouls on a command or write that
   the deterministic rules did not settle. The score is **advisory only**:

   - A risky score can add caution: ask where Auto would have allowed, or
     flag the call to the Muse-model Auto reviewer.
   - A "safe" score never skips a question and never becomes an allow on
     its own. Adversarial content is its documented weak spot.
   - It never overrides a rule's "forbid" or "ask".
   - It is compared against the Muse-model Auto reviewer in M85's own
     paired run, on M75's harness.

3. **Context relevance** (M73, M74, M67). Nouls on whether an old tool
   output or a file still matters to the current task, used to rank what
   is packed or kept. Adopted only if M75 shows no loss.
4. **Evaluation grading** (M75). Cheap semantic checks beside the
   deterministic verifiers, never in place of them.

**Not taken.**

- Screening untrusted content as a guarantee. It is adversarial content,
  a documented weak spot, so at most a warning signal.
- Any use as the coding model.

**Amended 2026-10-04 by D77 (M98).** The ruling and the uses above stand.
What changes:

- **TypeSafe is one engine of the Muse Judge.** It is no longer a feature of
  its own. Its client is M98's SystemOne adapter, which also serves Jev
  through OpenRouter, Cloudflare's Clef and loopback decision servers.
- **Testing.** The owner ruled that M85 ships best effort, labelled
  untested, because a TypeSafe key needs a sales call. That label still holds
  for the direct `api.typesafe.ai` route. The OpenRouter route
  (`typesafe/jev-1.13` at `/api/v1/systemone`) was tested live on 2026-10-04
  with identical shapes, so it ships tested.
- **Names.** The setting is `museSpark.judge.*`, not
  `museSpark.experimental.typesafeAssist`. The paid feature is `judge`, priced
  per engine, and the TypeSafe key keeps this decision's exception to rule 12.
- **Default.** The owner's defaults ruling of 2026-10-04 (D78) supersedes
  "Experimental and opt in, off by default" above.
  - The judge's default is `auto` (D77): the user's own chat model judges
    out of the box.
  - A separate judge (TypeSafe, Jev, Clef, a local decision model) joins it
    in a cascade once one is configured or available.
  - A paid source asks once before its first charge.

  The advisory-only ruling is unchanged.

- **Confidential workspaces.** Every remote engine, TypeSafe included, is
  still off while `museSpark.confidentialWorkspace` is on. The local judge
  (D77 section 2j) is decided by its design spike.

<!-- plan-archive:end id="2-D50-01" -->

## D51 — Turn checkpoints live in a shadow repository (M72, amended by M86)

<!-- plan-archive:begin id="2-D51-01" lines="4778-4827" bytes="3294" sha256="badc25b00acbe58dc1debec5cbd409b110f1e62c8cb0cb30982fb7ab6278a200" -->

M72 introduced whole-workspace captures in the extension's own storage.
M86 narrows restoration to the model's own file-tool writes, with the
rules in [SPEC v3.1](docs/design/m86-restore-by-tool-writes.md). A file is
restored only along an unbroken chain of recorded before/after bytes ending
in exactly what is on disk now, or is counted unchanged when it is already
at the earlier state. Commands, hooks, MCP tools, the user's edits and
other windows' writes are never undone. Personal memory outside the
workspace is never restored. A commands note records that processes or
MCP tools ran; their changed files are not listed or restored.

**Considered: hidden refs in the workspace repository.** Refused because
objects and refs in the user's `.git` could be carried by `push --mirror`,
and repository configuration and attributes could run hooks or filters.

**Taken: a shadow repository in the extension's own storage.**
`<global storage>/checkpoints/<canonical-root-key>/shadow.git` remains the
object and compare-and-swap ref store shared by windows using the same
canonical physical root and storage namespace. M86 removes captures,
shadow indices, exclude refresh and ignored-file scans. Existing M72
records remain read-only; ranges containing them cannot restore files,
and their restore records cannot be redone.

- **Isolation.** Git runs by absolute path with hooks and fsmonitor off,
  the host's `GIT_*` variables stripped and isolated configuration and
  attributes. The shadow keeps its own objects, with no alternates.
  Nothing is written or refreshed in the workspace's `.git`.
- **Writes and records.** Each model file-tool publication records its
  owner, path, earlier and intended bytes in a fsynced per-instance journal
  under `<storage>/m86/<instance>/`, before conditional publication. Blobs
  are copied from a confined opened handle. Unit records fold by write id
  into CAS refs under `refs/muse-spark/m86/`; their trees keep required
  blobs reachable. Reload recovery uses the same records and never writes
  into another instance's journal. A range with missing or incomplete
  records is refused as specified in sections 3 and 6.
- **Coverage.** File, image, workspace memory and rename tool writes are
  recorded, including ignored files they write. Format on edit is
  recorded; a formatter hook or `then_run` changes bytes outside that
  chain. The Memory view and writes made for the user are not recorded.
  Per-unit copy and intent budgets can make a path not restorable or a
  range incomplete. No command change is inferred from a capture.
- **Windows and safety.** Per-conversation sequences are allocated by CAS.
  One shared restore reservation, presence and native process fences
  remain. File restoration requires an attached Model API session and
  confirmed process safety, and is refused while any turn runs. M86 uses
  `fenced-window-v2` and refuses restoration and record deletion while a
  legacy v1 window is live. Links and junctions are refused. In Restricted
  Mode the extension runs no checkpoint git and records no new writes.
- **Limits.** Bytes cannot reveal an identical foreign write (ABA),
  foreign writes across windows are judged by bytes rather than order,
  and the final compare-to-rename gap remains (SPEC section 12).

<!-- plan-archive:end id="2-D51-01" -->

## D60 — Muse Spark Code beyond VS Code: the IDE compatibility program (2026-09-26)

<!-- plan-archive:begin id="2-D60-01" lines="4831-4887" bytes="3753" sha256="1ca8d09dbd3b9395da1fb25171d29bd518d58ecdc274692c869185cb72c8bffa" -->

The owner (2026-09-26) handed over a plan, "Muse Spark Code — IDE
Compatibility Plan" (prepared 2026-09-25 against 0.8.0, `bdaede4`), to be
worked beside M45–M56, which the owner is building in parallel. It is kept
whole in `docs/ide-compatibility.md`: the target matrix with its sources,
the architecture, the ACP plan, the release scenarios. Its links were
not re-read here (this environment's network policy blocks them,
2026-09-26); each target's claim is re-read from its source before its
milestone starts, as M41's installers are.

- **One product, four families.** The VS Code extension qualified in the
  editors built on VS Code (VSCodium, Cursor, Kiro, Positron, Theia,
  code-server, Codespaces, Che, Firebase Studio); one agent over the Agent
  Client Protocol for the editors that host agents in their own chat (Zed,
  JetBrains AI Assistant, Xcode 27, Qt Creator, Neovim, Emacs, Sublime,
  Devin Desktop); native plugins that embed the React panel (IntelliJ with
  Android Studio, Visual Studio, Eclipse, NetBeans, JupyterLab, Spyder,
  RStudio); and a terminal or adjacent interface where a host allows no
  more. The name stays "Muse Spark Code (Unofficial)" everywhere (rule
  11), and a port never proposes 1.0 (D44).
- **The engine and the UI are shared, the host is an adapter.** `AgentHost`
  and `AgentSession` stay the backend boundary; the webview reaches its
  host through one bridge; the host's services (workspace roots, documents
  and their versions, selection, edits, diffs, diagnostics, terminals,
  settings, secrets, persistence, notifications) become a contract with
  VS Code's implementation first. VS Code stays the reference client, and
  its behaviour does not change while boundaries move.
- **What already holds.** Only 11 source files import `vscode` (M60's
  record, after M61 took the logger's); the React app reaches its host
  only through `acquireVsCodeApi`, window messages, the text table
  embedded in its HTML and 57 `--vscode-*` theme variables; the protocol
  is zod-validated both ways. The work is extraction, not a
  rewrite.
- **Rulings carried into every adapter.** The key never reaches a child
  process, a launch argument, an environment variable, a webview message
  or a general IPC field (rule 8, D1): an ACP or native build signs in
  through the CLI's own login first, and its Model API backend waits for
  the credential-ownership decision (Q63). Paid features stay opt in and
  loud (rule 12): an adapter whose client cannot show the price and ask
  first offers none. Muse's approval policy is never loosened because a
  protocol allows it; a declined or cancelled request never runs by a
  translation default. Editing is claimed for a host only after its
  backend-specific tests (the plan's §6.1: dirty buffers, exactly-once
  changes, undo) pass there.
- **Support is measured, per host.** Integration type (full Muse
  interface, native agent interface, external) and release status
  (Planned, Prototype, Preview, Supported) are recorded per editor,
  version, backend and OS, with each feature tested, partial,
  unavailable or unverified. An install is the first step, not the claim.
- **Nothing is installed or billed unasked.** Another IDE is installed
  for a probe, and a dependency (the ACP SDK, a JetBrains or .NET
  toolchain) is added, only on the owner's go (Q61, Q62) and with rule 9's
  checks. Compatibility runs never use the subscription or a paid feature;
  a live check follows CLAUDE.md.
- **Numbered from 60**, so M45–M56 keep their numbers while both are built
  (M60–M66, Q60–Q64). Moves across files M45–M56 are changing (the
  stylesheet, the controller, the protocol) wait until M56 merges; the
  inventory and the narrow seams go first.

<!-- plan-archive:end id="2-D60-01" -->

## D61 — The Model API key outside VS Code (2026-09-26)

<!-- plan-archive:begin id="2-D61-01" lines="4891-4944" bytes="3567" sha256="5223405f9e672d9b63c27ec3535f2068e0104f4becea8ddac054425b82fa76ca" -->

The owner (2026-09-26): "you need to figure out the proper api key safe
storage". Inside VS Code the key stays in SecretStorage (rule 8). An agent
that another editor starts (D62), and later the native plugins (M64), run
with no VS Code, so the key needs a home of its own.

- **Rejected**: the operating system's command-line tools as child
  processes (`security`, `secret-tool`, PowerShell with DPAPI): the key
  would pass through another process, and `security
add-generic-password -w` takes it as an argument, visible to `ps`. A
  file encrypted with a key of our own: only as safe as the file's
  permissions, and crypto invented here. An environment variable, as many
  CLIs take: it invites the key into editor settings files (Zed's agent
  `env`, JetBrains' `acp.json`), which rule 8 forbids.
- **Chosen**: the operating system's credential store, reached in-process
  through `@napi-rs/keyring` 2.1.0 (MIT, the Node binding of the
  `keyring` Rust crate; prebuilt for Windows x64, arm64 and ia32, macOS
  x64 and arm64, Linux x64 and arm64 on glibc and musl, arm, riscv64,
  FreeBSD; published 2026-09-13, outside the 7-day window). Windows
  Credential Manager (DPAPI, per user), the macOS login Keychain, and on
  Linux the Secret Service (GNOME Keyring, KWallet, KeePassXC), pinned
  with `linux: { store: 'secret-service' }`: the kernel keyring the
  library would otherwise fall back to forgets the key at reboot. Without
  a Secret Service the Model API backend says how to get one; there is no
  plaintext fallback.
- **One entry per user**: service `Muse Spark Code (Unofficial)`, account
  `museSpark.modelApiKey` (the key's name in the extension's
  SecretStorage), shared by every editor that runs the agent. A missing
  entry reads as `null` from the binding, whatever its typings say (found
  against GNOME Keyring at M63); the store turns it into `undefined`.
- **Setting it**: `muse-spark-code-acp auth set` reads the key from the
  terminal with echo off (or one line from a pipe), checks its shape,
  stores it and prints only that it did; `auth status` says whether a key
  is stored, never any of it; `auth clear` removes it. Each ACP client is
  offered a terminal sign-in that runs exactly `auth set`, so the key goes
  from the keyboard to the store without passing through the editor.
- **Never**: an argument, an environment variable, a file, a log (the
  redactor stays), an ACP message, or a child process: not the environment
  of `muse serve` (D1), a tool or a check.
- **Credential variables** (the Codex review of `a209130`, 2026-09-28):
  a `META_API_KEY` in the agent's own environment is the user's for Muse
  Code, as the extension's `muse serve` inherits it (D1's amendment), and
  counts as Muse Code's credential there; the agent takes it and every
  other credential variable (`*_API_KEY`, the names hooks never get) out
  of its own environment at start (`src/runtime/credentialVariables.ts`)
  and hands them back to Muse Code's processes only, so a shell command,
  a hook, git or a helper never sees one.
- **AGENTS.md rule 8 (amended 2026-10-02, D65)** retains local OS-store
  authentication and names CI's memory-only stdin exception: the trusted
  launcher feeds only `exec --key-stdin` and the trusted
  `scan-secrets --key-stdin` child. CI does not use `auth set`, a throwaway
  keyring or an environment-key fallback inside the agent.
- **Later**: offering, in VS Code, to copy the key into the OS store for
  the other editors needs the native module in the `.vsix`, so
  per-platform packages (with M64).

<!-- plan-archive:end id="2-D61-01" -->

## D62 — The ACP agent, and the order the editors come in (2026-09-26)

<!-- plan-archive:begin id="2-D62-01" lines="4948-5095" bytes="9910" sha256="f18eeae9b998c2d44a3b47f25037818529a86f8a2c2582bea6fb64ca1af9967d" -->

The owner (2026-09-26): "the top editors come first but i want them all or
as close to all as possible", and approved the ACP SDK. One agent over the
Agent Client Protocol reaches the most editors for the least code (Zed,
the JetBrains IDEs through AI Assistant, Xcode 27, Qt Creator, Neovim,
Emacs, Sublime Text, Devin Desktop), so it comes first.

- **One executable**, `muse-spark-code-acp` (an npm package of that name;
  its bin is `dist/acp.js`, Node 22 or later), speaking ACP v1 on stdio
  through `@agentclientprotocol/sdk`, which parses every inbound frame
  against the protocol's schema before a handler runs (rule 7). stdout is
  the protocol; the log goes to stderr, redacted.
- **The panel's engine, not a second one**: the backend managers of
  `src/host/backend` (portable since M61), the same `AgentHost`,
  `AgentSession` and `AgentEvent`s. The ACP code lives in `src/acp` and the
  process wiring in `src/runtime`, both under the M60 gate's portable
  roots.
- **The backend is chosen at launch**: `--backend museCode` (the default:
  the CLI signed in on its own, the subscription pays) or `--backend
modelApi` (the key of D61). There is no "auto", so the bill is never a
  surprise; a user who wants both configures two agents.
- **What maps to what**: messages to `agent_message_chunk`; reasoning to
  `agent_thought_chunk`; tool calls to `tool_call` and `tool_call_update`
  (kind, title, locations, arguments, output, diffs for edits); a subagent
  to a tool call; the todo list to a `plan`; approvals to
  `session/request_permission` with the backend's own choices (allow or
  deny, once or for the session: `allow_once`, `allow_always`,
  `reject_once`, `reject_always`); permission modes to session modes;
  model and effort to config options; skills to available commands; the
  session's name to `session_info_update`; context use to `usage_update`.
- **Nothing runs by a translation default**: a permission request the
  client cancels, or answers with an option it was not offered, is decided
  with the backend's deny choice. A question the agent asks goes to the
  client's elicitation form where it has one; otherwise the question is
  shown as text and declined, so the model carries on and the user answers
  in the next prompt.
- **Sessions**: new, load (the history replayed as updates), list, resume,
  and fork where the backend allows it (`canEditSessions`).
- **Prompts**: text, resource links (as @mentions), embedded text
  resources (as context), images (checked by their headers, as
  attachments are).
- **Sign-in**: `initialize` offers the chosen backend's sign-in, "Sign in
  to Muse Code" (the agent's `login`, which runs `muse login`) or "Store a
  Meta Model API key" (`auth set`, D61), as a terminal method to a client
  that runs them and as a command to run by hand to one that does not;
  `session/new` answers `auth_required` until the chosen backend has its
  credential. Muse Code's is read as the panel reads it (D26, PR #49): the
  credential file's structure, and `account/read` where only the CLI can
  say; `authenticate` asks afresh.
- **Load and resume run as advertised** (the Codex review of `a209130`):
  a loaded or resumed session gets the permission mode, a listed model and
  the effort the agent shows, or the load fails; the agent never shows a
  mode stricter than the one in force. What it shows comes from the
  backend's answer or an explicit set, never from a value the session's
  handle merely holds (Codex on `4eb0156c`: Muse Code's resumed handle
  holds the model asked for, the CLI the one last used): the model is
  the one `model/list` reports active for the session where the agent
  lists it, else the default, set. A session is held, and its id
  answered, only once it is set up; a new, loaded or resumed session
  whose setup fails is let go. A session loaded again lets the one held
  go first, and one still being set up by an earlier load, as both hosts
  hand the same session back; a close lets both go. A session let go
  changes nothing more on the backend, sends the editor nothing more,
  decides nothing on the editor's late answers (a paid use is denied),
  and its running prompt ends cancelled with its turn stopped on the
  backend once its start is answered (even a failed start, which past
  its deadline may still begin). A reload follows the session only once
  the held one's turn is stopped; the backend stopping lets go of loads
  being set up too. The client's answers to the
  agent's own requests (permission, elicitation) are parsed with zod, and
  a form answer must be one the form allowed (its options, how many), or
  the question is declined. The agent's log names a backend failure by
  its kind (`failureForLog`, PR #49), never by its message.
- **Trust**: a folder's rules, skills and memory load only with
  `--trust-workspace`, the flag Muse Code itself takes (D13); ACP carries
  no workspace trust of its own.
- **Paid features are off in the agent** (rule 12, D60) until a
  confirmation over `session/request_permission` that names the price is
  built and certified. **Built 2026-09-26 (M63c):** `--web-search` and
  `--image-generation` (Model API backend only) let the first prompt ask
  for each, with the panel's title and price; only "Turn on" turns it on,
  for the life of the process, and anything else leaves it off without
  asking again. Paid rows and approvals name their price; Muse Voice has
  no microphone in the agent.
- **Amended 2026-09-27 (M58 joined, D48): every paid use asks in the
  editor.** The owner's rule, "anything requiring extra payment should
  prompt … allow once, allow always in this workspace, or deny", holds in
  the agent too, through the core's `PaidUseConsent` and the panel's own
  words (`paidUseQuestion`, moved beside it so the modal and the agent say
  the same):
  - A feature is on only with its flag (`subagents`, scheduled prompts and
    Muse Voice have none, so they are always denied); each use then asks
    over `session/request_permission` in the conversation it is for: a row
    naming what is about to be billed and its price, and the options
    `allow_once`, `allow_always` and `reject_once`. Web search asks once per
    prompt, an image before it is bought, as in the panel. The first
    prompt's "Turn on" question is gone: the price is named every time
    instead, and asking twice before one prompt would say the same thing
    twice.
  - The Model API host serves every conversation of a folder, so its
    `allowsPaidUse` now names the conversation (`sessionId`, a child task's
    being its parent's); the agent asks in that ACP session and denies when
    it holds no such session or has no client to ask. A cancelled prompt,
    an option it did not offer, or a failed request is Deny.
  - "Allow always in this workspace" is offered and honoured only with
    `--trust-workspace`, as the panel offers it only in a trusted workspace.
    It is kept per folder in the agent's data folder (`acp/paid-uses.json.d`,
    per-feature generations and workspace-hash/generation grant records,
    `src/runtime/paidGrants.ts`), read at every question so other agent
    processes' changes count. Independent records and atomic generation
    revocation prevent cross-process stale writes from restoring a revoked
    grant or replacing a newer one; the earlier JSON map is ignored and asks
    again. A filesystem that cannot safely publish the generation remembers
    nothing and keeps the explicit use as Allow once. The grant
    lapses in every folder when the agent starts without that feature's
    flag, so turning the flag on again asks again (the panel's grant
    generation, D48, in the agent's terms).
- **Headless M80 (D65):** `exec` replaces editor questions with denials.
  Only explicitly flagged, affordable, ordinary image uses in `acceptEdits`
  may proceed; protected/asking uses are denied. No grant store is touched.
  Local OS-store auth remains; CI feeds exec and scanner by private stdin.
- **Networks (Q66, 2026-09-27): loud, not re-routed.** VS Code's proxy and
  certificate settings do not reach the agent, and Node's `fetch` uses the
  environment's proxy only with `NODE_USE_ENV_PROXY=1` (Node 22.21+, 24+).
  The agent does not turn that on or add a proxy agent of its own; it logs
  one warning at start when `HTTPS_PROXY`, `HTTP_PROXY` (either case) is set
  for the Model API backend and the switch is off or this Node lacks it, and
  a request that never reaches Meta names the agent's environment
  (`NODE_USE_ENV_PROXY`, `HTTPS_PROXY`, `NODE_EXTRA_CA_CERTS`,
  `--use-system-ca`) rather than VS Code's `http.*` settings. Muse Code,
  started by the agent, reads the proxy variables itself.
- **Tools run in the agent**, as ACP allows. Routing the Model API
  backend's file reads and writes through the client (`fs/*`), so an
  unsaved buffer is seen and never overwritten, is a later step, with its
  own tests (the owner's plan, §6.1).
- **Where it is tested**: against the SDK's own client in-process and
  over a real stdio pipe to the built `dist/acp.js`, with the fake Muse
  Code CLI (`test/e2e`); in editors as each can be installed. This
  container reaches npm, PyPI, Maven Central, Gradle, NuGet, Ubuntu's
  archive and download.eclipse.org, and not JetBrains, Microsoft's
  VS Code downloads, Open VSX, Zed's site or neovim.io (2026-09-26).
- **The order**: the most-used editors first. VS Code's family (Cursor,
  Windsurf, VSCodium, Kiro, Positron, Theia, code-server, Codespaces)
  through the `.vsix` and Open VSX (M62); the JetBrains IDEs, Zed, Neovim,
  Emacs, Xcode 27, Qt Creator, Sublime and Devin through this agent (M63);
  then Visual Studio and the JetBrains full panel (M64); Eclipse,
  NetBeans, Jupyter, Spyder and RStudio (M65); and the constrained hosts
  (M66). `docs/ide-compatibility/hosts.md` tracks each editor's route and
  status.

<!-- plan-archive:end id="2-D62-01" -->

## D66 — Panel polish from the owner's requests of 2026-10-03 (M87)

<!-- plan-archive:begin id="2-D66-01" lines="5190-5661" bytes="30493" sha256="36f69ddcbe526c75e982f6769bc99d4f9a339d5d69eb3776299a9a17e924242f" -->

The owner sent sixteen requests on 2026-10-03, with screenshots of the
Codex app as inspiration. M87 takes items 1–10 and 12; item 11 is built
already (below); items 13–16 are D67. D65 is taken by M80 on PR #88. The
choices:

- **Context meter (item 1, with the owner's correction of 2026-10-03).**
  - A round meter replaces the composer's "12% context" button
    (`contextLabelFor` in `App.tsx`, `Composer.tsx`), in the same place and
    with the same click: it compacts (M14). The ring fills clockwise from
    the top with the share of the window used. The whole percent sits
    inside it, with no label beside it and no "%" sign in the ring.
  - The accessible name is "Context 42% used" followed by the existing
    detail (`contextDetail`): used and window tokens, and the wire's
    pressure word as it came (D36). The tooltip is the detail and the
    compact hint (`contextCompactTitle`).
  - **Thresholds: 70 % and 90 %.** These are `CONTEXT_PRESSURE_MEDIUM` and
    `CONTEXT_PRESSURE_HIGH`, the levels the Model API host already reports.
    The webview computes the level from used ÷ window on both backends.
    Muse Code's `pressure` vocabulary is known from one capture only
    (`"normal"`, §5.4), so it is shown, not interpreted.
  - **Colours.** Under 70 % the arc is `--vscode-progressBar-background`,
    from 70 % `--vscode-list-warningForeground`, from 90 %
    `--vscode-errorForeground`. The number carries the value, so colour is
    never the only signal (WCAG 1.4.1).
  - **Legibility at its size.** The ring is 22 px across inside the 26 px
    control (`--ms-control-size`, which keeps WCAG 2.5.8's 24 px target).
    Its stroke is 2.5 px, leaving 17 px inside. The number is
    `--vscode-foreground`, weight 600, with tabular figures: 10 px for 0–99
    and 9 px for 100. Nothing is drawn smaller than 9 px.
  - **Rounding.** The percent is rounded down, so 99.6 % reads 99 and 100
    means full. A window that is used but under 1 % reads "<1".
  - **Number contrast.** On the ring's plate in the captured themes (VS
    Code 1.140.0, `test/harness/themes/`, recaptured by lane W on
    2026-10-04) the number measures 10.3:1 in Dark Modern, 11.2:1 in Light
    Modern, 21:1 in High Contrast and 14.6:1 in High Contrast Light, and the
    same at "100". The 4.5:1 floor for small text holds with room.
  - **At 100 % and over.** The ring is full, in the 90 % colour, and reads
    "100". The name and tooltip give the true share ("104%") and say the
    window is exceeded.
  - **No reported window.** A window the host has not reported shows no
    meter, as today. No window is guessed.
  - **Arc contrast** (a graphical object, 3:1, WCAG 1.4.11), measured on
    the 1.140.0 captures: 3.6:1 (Dark Modern) to 10.6:1 (High Contrast) for
    the normal level, 3.4:1 (Light Modern) to 8.6:1 for the 90 % level, and
    for the 70 % level 7.1:1 in Dark Modern and 5.8:1 in Light Modern. Both
    high-contrast themes leave `--vscode-list-warningForeground` unset, so
    there the 70 % level keeps the normal colour through the stylesheet's
    fallback (10.6:1 and 9.0:1); no theme needed the fallback for a miss.
- **Tool In/Out boxes (item 2).**
  - A shell row's IN and OUT become one bordered block split by a rule,
    with no gap between them. The user's own `!` rows (M46) get the same
    block.
  - Each part shows five lines (`IO_PREVIEW_LINES`, new) and keeps the
    2,000-character cap. Then comes "Show more": a button styled as a link,
    with `aria-expanded`.
  - Other tool outputs keep their 12 lines: the owner named the In/Out
    boxes.
- **Step expander (item 3).** M87 reuses Focus view's `segment()` and
  `StepsGroup` (`Transcript.tsx`).
  - **Default view.** A run of two or more finished steps (tool and
    reasoning rows, with no other row between them) folds into one summary
    row. The row is collapsed and opens in place.
    - A step waiting on the user never folds (the existing `isWaiting`).
    - A running step stays outside the group, below it, until it finishes.
    - A failed step folds, but the summary names the failures and carries
      the failure dot, so no failure is hidden.
  - **The summary** is built from what ran, in first-seen order: "Edited 2
    files, ran a command, and read 3 files".
    - Files count distinct paths.
    - Each part is a plural form, joined by `Intl.ListFormat` with
      `type: 'conjunction'` and `style: 'long'`. Only the first letter is
      raised, in the display language's own case rules. (Amended
      2026-10-04, lane C: `type: 'unit'` joins with bare spaces in Turkish,
      Japanese, Korean, Russian and both Chinese tables, "X1 X2 X3", which
      no list of actions reads as; the conjunction list reads "… und …",
      "… ve …", "…、…、…". Measured on Node 24.20's ICU for all 15
      languages; `docs/certification/m87-c.md`, drill `list-unit`.)
    - The step-summary forms start lowercase in every table (the cs, de,
      pl and ru forms began with a capital, which reads wrong mid-list);
      only the first letter of the joined sentence is raised.
    - Reasoning rows are folded but not named.
  - **Focus view** keeps folding every non-waiting step, now under the same
    summary instead of "Show N hidden steps". No new setting is added:
    Focus view already switches between the two densities.
- **Working indicator (item 4).** The status line's spinning ✦ becomes the
  bullet the step rows use (`.tool-dot.tool-dot-running`: 8 px,
  `--vscode-progressBar-background`, the existing 1.2 s `pulse`). After
  the bullet comes the verb, then a heartbeat trace right after it with
  the line's gap.
  Owner's request 2026-10-04: the bullet is now a small looping
  circle-pattern mark (after Inclushe's circle pattern animation lighten,
  CodePen OPWreWR, MIT, written fresh with no pointer tracking). Owner,
  2026-10-09: the mark drawn at 75 % (12 px box) — 16 px sat a little large
  beside the text.
  - **Our own trace, Vahid's animation (amended 2026-10-04, owner's
    verdict: the first cut drew a static path with a highlight sliding
    along it; the highlight must CREATE the shape).** The trace is a
    `<canvas>` port of Vahid's HTML5 Canvas Heart Monitor (CodePen MWvmvd,
    MIT; written fresh, credited in the module): a beam moves right in
    7 ms ticks along our P/QRS/T wave, then wraps and repeats. Each frame
    clears the canvas and strokes only the beam's last
    `HEARTBEAT_BEAM_TRAIL_TICKS` (100 ticks, half a sweep) of path, fading
    by age from opaque at the beam to nothing (`trailSegments`). Nothing
    static is drawn and nothing older survives: the shape exists only as
    the blip's own trail (owner, 2026-10-04: "the shape comes from the
    blip, not the blip follows the shape"). The first canvas cut faded the
    canvas's pixels 6 % a tick with `destination-out`; on an 8-bit canvas
    the faintest pixels never reach zero, so a ghost of the whole wave
    stayed painted and the beam seemed to run along it. The beam's height follows `beamY` in
    `src/webview/heartbeatBeam.ts`, our waveform sampled in the 0..100 by
    0..24 box (flat at 12; P bump 18–29; dip at 38, spike to y=2 at 43 and
    down to 22 at 48, back at 53; T bump 63–73; flat). One sweep takes
    about 1.4 s (half a pixel per 7 ms tick: the reference's 0.6 s reads as
    frantic at this size, and 1.2 s still read a little fast — owner,
    2026-10-09), driven by one `requestAnimationFrame` loop with
    fixed ticks, paused while the page is hidden. Step and trail tunables
    are `HEARTBEAT_BEAM_*` in `src/shared/constants.ts`.
  - **Size and place.** 1.5 em high (inside one line of the 13 px text)
    and 6 em wide, backed by `devicePixelRatio`. The working line's grid
    (`auto auto 1fr`) puts the trace right after the verb box with the
    line's gap, so mark, verb and trace read as one unit. The verb box is
    as wide as the longest verb in the installed language (every verb sits
    in one grid cell, only the current one visible, the rest `aria-hidden`
    width holders), so the trace never moves while the verb changes
    (owner, 2026-10-04). A container query hides it below 260 px.
  - **Motion budget.** Only the small canvas repaints. The bullet pulses
    as the step rows' do. Nothing flashes (WCAG 2.3.1). No bezel, grid,
    glow or shadow: just the trace in brand blue.
  - **Colour.** `--vscode-progressBar-background`, read from the canvas at
    each wrap so a theme change lands within one sweep, `currentColor`
    when unset, `CanvasText` under forced colours (the canvas is cleared to
    transparent each frame, so it carries no tint).
  - **Contrast.** The beam uses `--vscode-progressBar-background`, which
    measures 3.6:1 (Dark Modern, editor background) to 10.5:1 (High
    Contrast) on the captured backgrounds. It is decorative and
    `aria-hidden`, and the line stays out of every live region (M25).
  - **Reduced motion.** There is no loop and no pulse: one still frame of
    the single beat, and the dot stands still. A unit test checks that
    every animated selector in `styles.css` has a
    `prefers-reduced-motion` rule (the beam adds no CSS animation).
- **Tasks pane (item 5).**
  - A chevron collapses the list to two lines: the title with "3 of 7
    done", and the task in progress.
  - The collapsed state belongs to the component, so a reload opens the
    list expanded.
- **Tasks pane in its own window (item 6): an editor tab that the user
  moves.**
  - **What VS Code allows.** VS Code gives an extension no floating window
    and no way to move a webview view (the sidebar) out of the window. The
    request for such an API (microsoft/vscode#213516) was closed as not
    planned. VS Code does have floating windows for editors: an editor
    tab's "Move into New Window" (`workbench.action.moveEditorToNewWindow`),
    plus "Set Always on Top" and compact mode in the releases that have
    them.
  - **The design.** "Open tasks in a tab" opens a `WebviewPanel`
    (`museSpark.tasksPanel`) beside the editor. It shows the same
    `TodoPanel`, live, for the conversation that opened it.
  - **Moving it.** The tab's "Move into new window" focuses the tab and
    runs that built-in command. The button is offered only when
    `vscode.commands.getCommands(true)` lists the command. Without it, the
    tab's own context menu does the same.
  - **Limits, stated in the README.**
    - The floating window is a VS Code window. It closes with VS Code and
      follows its theme; it is not an independent app.
    - A webview that moves reloads, so the tab rebuilds from the host every
      time it loads.
    - The tab is not restored after a reload, because it has no serializer
      (its conversation may be gone).
    - The command id is VS Code's, not API. So the host-API record (D60)
      lists it, and editors without it (D60's hosts) get the plain tab.
    - The chat itself already opens as a tab ("Open in New Tab") and moves
      the same way.
- **Menu tooltips (item 7).**
  - Every row of the command palette and the "/" list gets a one-sentence
    tip. It is the row's `title`, for the pointer, and the same text is the
    option's accessible description. A skill's tip is its own description.
    A skill without one (Muse Code's list gives an empty string,
    `skillsCli.ts`, and a `SKILL.md` may have none) gets "Run the {name}
    skill." instead, so no tip is ever empty.
  - VS Code's Command Palette shows only a command's title, category and
    keybinding, and a contributed command has no tooltip. The panel's menus
    are therefore what M87 covers.
- **Stop turns red on hover (item 8).**
  - In the light and dark themes the button takes `--vscode-charts-red`
    behind the `--vscode-button-foreground` icon. That measures 4.7:1 and
    3.6:1, over the 3:1 an icon needs.
  - The high-contrast themes are drawn with outlines. There the icon and a
    1 px border take `--vscode-errorForeground` on the unchanged background
    (8.6:1 and 6.6:1).
  - The same applies on keyboard focus.
- **Message timestamps (item 9).**
  - Hovering or focusing a message shows its time in a `<time>` at the
    card's corner: the time alone for today, otherwise the date and time.
    Its `title` gives the full date and time.
  - **Formatting.** All three forms come from `text.ts`'s `Intl` helpers in
    the display language: `formatTime` (the time alone, new),
    `formatDateTime` (as today) and `formatFullDateTime` (the full date and
    the time, new). "Today" is `isSameLocalDay` (new): the same calendar day
    in the webview's local time zone, judged when the card renders. A card
    left open past midnight keeps its time-only label, and its `title`
    still names the day.
  - **Keyboard.** Every card with a time has a keyboard stop that reveals
    it. A card with action buttons of its own (rewind, copy, the queued "…")
    shows the time while focus is inside it (`:focus-within`), and gets no
    extra stop. A card that renders none (an imported user message without
    rewind, a reply still streaming) makes the `<time>` itself focusable
    (`tabIndex={0}`), so Tab reaches it and it shows with the focus ring.
  - **Where the time comes from.**
    - On Muse Code, from `recordedAt` (RFC 3339). The M79 and M46 captures
      show it on `userMessage`, `agentMessage` and `userShell` items, both
      live and in `session/read` (AGENTS.md rule 13).
    - On the Model API, from a time the host stores with each user and
      reply item, from M87 on.
    - A live card shows the moment it was sent until the host's time
      arrives.
  - A message with no recorded time (a Model API session stored before
    M87) shows none: using the session's creation time would be a guess.
- **Diff tally (item 10).**
  - A status row sits above the goal, task and git panes; the approval dock
    stays nearest the composer. It reads "8 files changed +313 −96", with
    Review.
  - **The source is the conversation's edits:** the edit rows' patch
    summaries (`patchSummary`: files, added, removed), the same set that
    M70's review pane lists. Files count distinct paths. An edit whose patch
    names several files without a single path adds its own file count.
  - **A sum of edits, not `git diff`.** Git would count the user's own
    work, and M86's per-turn records are not built yet. The tooltip says
    so: these are lines added and removed by this conversation's edits, and
    changes made by shell commands or by the user are not counted.
  - **Review** opens M70's review pane (PR #69). Without M70 the row has no
    Review button. With no edit there is no row.
  - **Colours.** The added and removed numbers use
    `--vscode-gitDecoration-addedResourceForeground` and
    `--vscode-gitDecoration-deletedResourceForeground`. Each is measured at
    capture against 4.5:1, and the foreground colour stands in wherever one
    misses. Measured on the 1.140.0 captures: added 7.8:1 (Dark Modern),
    4.6:1 (Light Modern), 14.1:1 (High Contrast), 9.3:1 (High Contrast
    Light); removed 7.0:1, 4.6:1 and 7.5:1 in the last three, and 3.9:1 in
    Dark Modern, which misses: there (`.vscode-dark`) the foreground stands
    in, at 11.1:1.
- **Notifications (item 11): already built, no M87 work.**
  - M82 (`museSpark.notifyOnBackgroundTurn`, on by default, PR #89,
    `src/host/conversation/turnNotifications.ts`) raises VS Code's own
    notice once per event while the window is unfocused. The events are a
    turn of at least 60 s that ended (not cancelled), an approval waiting,
    and a question waiting.
  - A focused window with the panel hidden is not notified, by M82's
    acceptance.
  - The one gap is M88's: a timed send that falls due (D67).
- **Edit a queued prompt (item 12).**
  - **Queued means accepted but not yet seen by the model.**
    - On the Model API: a turn in `queuedTurns`, or steered input still in
      `turn.steered` before `drainSteered` puts it into a request.
    - On Muse Code: a submit acknowledged `queued`, until `turn/started`.
    - A Muse Code message steered into the running turn cannot be taken
      back, because MSP's `turn/unqueue` covers queued submits only. Its
      menu says it was delivered.
  - **Opening Edit.** Right-click on such a card offers Edit, as do
    Shift+F10, the context-menu key and the card's "…" button.
  - **Withdrawing.** On the Model API the host removes the message. On
    Muse Code it sends `turn/unqueue`, whose ack and late refusal are
    captured before the parser is written (rule 13). `turn/unqueued` is
    already mapped to `turnWithdrawn`.
  - **On success** the card leaves the transcript, and its text and images
    return to the composer. In an empty box they stand alone; otherwise they
    go before the draft with a blank line, so no draft is lost.
  - **Too late:** the card stays, and a notice says the message already
    reached the model.
  - Right-click on selected text keeps M17's quote menu.

- **Gooey chat menu (item 17, the owner's requests of 2026-10-03, evening).**
  Every way to act on the chat moves into one gooey radial menu (the owner:
  "the fork and rewind etc, all of the stuff to interact with the chat should
  be in this menu"). Right-clicking any transcript row, or Shift+F10 / the
  Menu key on a focused row, opens it with that row's actions:
  - on the user's message, the Rewind menu's choices (rewind the
    conversation, rewind code, rewind and restore, restore files), Fork from
    here and Fork and rewind;
  - on a reply, Copy response and Reply to this output (M17's); on a
    checkpoint, Redo; on a tool row, Open output and, for a landed edit,
    Review and Revert (`revertEdit`: that edit's stored patch reverse-applied
    after the file-action confirmation, one step of "Rewind code to here",
    never while a turn runs);
  - (Amended 2026-10-04, lane W: a reply offers no Retry. Neither backend
    has a verb that runs a turn again: MSP has none, and a Model API turn's
    tools have already run and its edits landed, so a Retry that sent the
    prompt again would run them a second time over their own results. The
    prompt's own card offers "Rewind conversation to here" in the same menu:
    it forks before the turn and puts the prompt back in the composer, the
    retry that does not double the side effects.)
  - with text selected, Copy, Ask about this and Comment on this first.
    A group with several choices (Rewind) opens a second burst from its bubble.
    **The row's hover buttons are replaced by one "…" button** (the owner's
    choice) that opens the same menu, so the actions stay discoverable. Every
    action keeps its current behaviour, guards and confirmations.
  - **The look:** after Lucas Bebber's "Gooey Menu" (CodePen LELBEo, MIT): the
    actions burst from the pointer (or the "…" button) as round icon bubbles
    that merge through an SVG goo filter (`feGaussianBlur` then an
    alpha-threshold `feColorMatrix`), written for this panel rather than
    copied, with the pen credited in a code comment.
  - **Theme, not the pen's colours:** bubbles use `--vscode-button-background`
    / `--vscode-button-foreground` (hover and focus
    `--vscode-button-hoverBackground` and the focus border), each pair
    measured at capture against 4.5:1, so light, dark and high-contrast
    themes all read: 4.5:1 and 5.3:1 focused in Dark Modern, 6.3:1 and
    7.1:1 in Light Modern, 21:1 in High Contrast and 9.0:1 in High Contrast
    Light (1.140.0), the label as its bubble.
  - **Placement:** the fan opens away from the nearest panel edges so every
    bubble stays inside the webview at 320 px.
  - **Still a menu:** `role="menu"` / `menuitem`, each bubble's accessible name
    its action, a visible label beside the focused or hovered bubble, Arrow
    keys move, Home/End, Enter or Space picks, Escape closes (a second burst
    first) and returns focus.
  - **Reduced motion and forced colours:** under `prefers-reduced-motion` the
    bubbles appear in place without the burst or the goo; under
    `forced-colors` the filter is off and the bubbles are bordered buttons.
  - **Pills with labels (amended 2026-10-04, the owner: "The gooey menu
    should have labels with the icons so the shape of the items will gain
    more of a pill shape than a circle with icon only").** This replaces the
    round bubbles and the label beside the focused or hovered one above. The
    owner's clarification the same day: "the icon and label should be in
    the same blue pill no separate".
    - **The pill.** Every item, a second burst's too, is one button: its
      icon, then its label, as high as the old bubble (40 px), with half-circle
      ends (`border-radius` 20 px). No label is drawn outside it. The
      accessible name is still the label; `role`, keys, focus return,
      disabled items and their notes behave as before. Colours as before:
      button background and foreground, the hover background and the focus
      border.
    - **Notes.** A disabled item (a Rewind note such as "File checkpoints
      need git on PATH") is the same blue pill, opaque, with its icon dimmed
      and no hover. The bubbles' 50 % opacity let the chat show through a
      pill's text; opaque, a note reads at the button pair's contrast.
      Forced colours draw it in `GrayText`.
    - **A column, not a ring.** A pill is several times as wide as it is
      high, so on the 76 px arc neighbours would overlap unless the radius
      grew past what a 320 px panel holds. The pills stack in one column,
      20 px apart, on the side of the origin with more room (away from the
      nearer side edge), centred on its height and moved whole to stay in the
      panel. Their near ends follow half an ellipse around the origin, from
      16 px out at the ends (clear of a 26 px control centred there) to 48 px
      at the middle, so the column still fans. Rows cannot overlap whatever
      the labels' widths; each pill's drawn width is measured before the
      first paint and only keeps it inside the panel. A second burst centres
      on its group's pill and scales in from it. A panel too short for 20 px
      gaps shares its height out evenly.
    - **Long labels.** A pill is at most the panel's width less 8 px a side
      (304 px at 320 px). One too wide for its side of the origin slides back
      over it first; only a label longer than the panel allows ends in an
      ellipsis, and then its tooltip gives it whole.
    - **The goo.** The filter is unchanged (blur 10, alpha 18a − 7). Two flat
      pill edges 20 px apart blur to 2Φ(−1) ≈ 0.32 alpha at the middle, under
      the 7/18 cut, so resting pills stay apart and merge only while they
      scale in from the origin, overlapping. Reduced motion: no burst, no
      goo. Forced colours: no filter, `ButtonFace` pills bordered in
      `ButtonText`. Record: `docs/certification/m87-f.md`, "Pills with
      labels".
  - **A fan of crisp pills, one size (amended again 2026-10-04, the
    owner: "the gooey menus just need the pills in the fan/arc shape not
    with the faded smudge look", then "also they should be a uniform
    size").** This replaces "The goo" and "Long labels" above; the fan's
    rows, gaps, reach and bow stay.
    - **No goo.** The SVG filter, its `defs` and the CSS that applied or
      switched it off are gone: no blur, smudge or trail between pills, at
      rest or while they burst. A pill is a flat button with clean edges;
      the focus border is its only outline.
    - **One size.** Every pill, in either burst, is 272 px wide and 40 px
      high, set inline by the layout: the widest that keeps the whole fan
      inside a 320 px panel (320 − 2 × 8 padding − 32 bow), the owner's
      narrow-view rule. The icon sits at the start and the label after it;
      a label longer than the pill (a long translation, the pseudo-locale)
      ends in an ellipsis, never wraps or grows the pill, and keeps its
      whole text as the accessible name and the tooltip. A panel narrower
      than 320 px gives every pill its width less the padding.
    - **The arc stays whole.** A fan that would leave the panel moves back
      towards the origin, and over it if need be, all at once, so the arc
      keeps its shape. Only a panel too narrow for the whole arc (under
      320 px) gets a shallower one, down to a straight column; rows never
      overlap.
    - **Motion.** Each pill scales in from the menu's origin, 30 ms after
      the one before it (`GOOEY_MENU.staggerMs`), drawn at scale 0 until its
      turn. Under `prefers-reduced-motion` they appear in place at once.
      The harness draws them at rest: headless Chrome's virtual clock does
      not run CSS animations, so a capture could catch them mid-burst.
    - Record: `docs/certification/m87-f.md`, "A fan of crisp pills, one
      size".

  - **Menus close to the opener (MENUFAN, owner 2026-10-10).** The
    selected row's text menu opens at its “…” button's viewport centre,
    using the pointer only when that row has no opener. The same fan in
    both bursts keeps a 16 px reach, a 16 px bow and 6 px gaps: centred on
    the button when it fits, shifted whole beside a panel edge. Pills stay
    crisp, equal in width to the longest label, and apart. English action
    labels and menu titles use Title Case; translations keep their own
    casing, and action ids carry behaviour. Regression coverage measures
    2/3/5-item fans at 320/690 px and the selection menu in the browser;
    the capture closes an existing menu before reselecting inert row prose;
    reverting the origin and gap separately must fail their tests and be
    restored byte-exact. Capture before/after row and selection menus at
    both widths, update reviewed visual goldens with
    `owner-2026-10-10-menu-fan`, and regenerate affected README shots and
    reference/roadmap. Record: `docs/certification/menufan.md`.
    Round 3 (RVMENUFAN2): every element-anchored burst follows ancestor
    scrolling, panel resizing and content reflow; dismiss if its opener is
    clipped out or removed. One shared lifecycle owns listeners and frame
    sampling while open. Hover/active/selected decoration stays inside each
    pill; only keyboard focus extends outside. Derive resting spacing from
    the installed CSS focus width/offset plus 2 px clear space. Certify every
    menu at 320/480/900 px in light/dark/high contrast, including adjacent
    focus/hover combinations, scroll-follow and byte-exact guard drills.
    Re-run and inspect all menu visual frames; refresh only changed menu
    scenes under `owner-2026-10-10-menu-fan-r3`.

- **The chat column (the owner's requests of 2026-10-04).** His four
  requests, word for word, then what was built.
  - **"The chat control stuff box should be centered in the chat not
    stretched to fill."** The chat is one shared column, as in Claude Code's
    panel. The transcript (queued cards, the working line and the row menus
    with it), the diff tally's text, the goal, task and schedule panes, the
    approval dock and the composer all sit in it.
    - **Width.** `--ms-column-max-width` is 760 px, side gutters included,
      so the composer box is 744 px wide at most. The column is centered in a
      wider panel; a narrower one keeps the full width.
    - **The inset is measured on the panel.** `--ms-column-inset` is
      `max(0px, (100vw − 760px) / 2)`: the webview's viewport is the panel.
      The transcript's scroller is not used, so its scrollbar (10 px in VS
      Code's webviews) does not move the transcript off the composer's edges.
      The transcript keeps a fixed start inset and caps its width; the
      scrollbar takes its room from the slack at the end.
    - **First cut.** Commit `33acd064` centered only the composer and the
      dock. Codex's review found the rows still spanning 1384 px at 1400 px
      (P2), and tests that read only the declaration text (P3).
  - **"The always allow button wraps weird and is too big in contrast to
    the allow once button."** Every approval choice is now one line at
    `--ms-button-height` (28 px). The fill alone tells approving from
    rejecting: `button-primary` against `button-secondary`.
    - A row too short for the next choice moves that choice whole onto the
      next row. A label longer than the card ellipsizes, and the button's
      `title` holds the full text (`rulePreview`, else the label).
    - In a card narrower than 340 px (a 320 px panel) the choices stack,
      each as wide as the card.
    - The order and the keys are unchanged.
  - **"The pill spacing around the model on the top and bottom is too large
    and makes the pill too tall."** The pill's fill is now
    `--ms-chip-height` (20 px, the open-file chip's height) instead of 26 px.
    - It is painted inside transparent 3 px block borders
      (`background-clip: padding-box`), so the target stays a whole
      `--ms-control-size` control (26 px, over WCAG 2.5.8's 24 px).
    - Under forced colours those borders are painted, so the pill goes back
      to 1 px.
  - **"The buttons and stuff in the mobile view look weird the buttons and
    stuff looks staggered and stacked."** In a composer narrower than 340 px,
    every control stays on one row, at one height on one centre line.
    - The icon buttons are square, the mode button shows only its icon, and
      the pill takes the room that is left, down to `--ms-pill-min-width`.
    - An open-file or reference chip that no longer fits moves to a row of
      its own below the controls, at the start.
    - Only a composer too narrow for Attach, Commands, the shortest pill and
      the right group (under about 207 px) puts the right group on a second
      row.
  - **Checked in a browser.** `columnGeometry` in the harness runs in the
    `column`, `column-narrow` (320 px) and `column-wide` scenarios. The
    `column-wide` scenario is 1400 px wide, with a scrollbar and a
    transcript long enough to scroll. The check measures:
    - the shared edges;
    - the cap and the centering;
    - each choice: its height, its single line, and where its row starts;
    - each control's height and centre line;
    - the pill's fill and the chip's height.

    A miss throws, which fails the accessibility gate.
    `docs/certification/m87-composer.md` holds the numbers and the drills.

<!-- plan-archive:end id="2-D66-01" -->

## D67 — Saved prompts, bookmarks and timed sends (M88)

<!-- plan-archive:begin id="2-D67-01" lines="5665-5936" bytes="17261" sha256="3a1a601fe446fbd9a15eac06114c4cfa5014f66d5c41787d5517400912bbb4c9" -->

Items 13–16 of the owner's requests of 2026-10-03 (D66). The choices:

- **What exists, and the gap (item 13).**
  - **Skills** are the reusable prompts both backends already run as slash
    commands (`/<id>`, M30). They live in `.agents/skills/<id>/SKILL.md`
    and the personal `~/.config/muse/skills`. M83 turns other agents' saved
    commands and prompts into skills. The panel cannot create or edit one,
    and a skill is sent as an invocation the model reads, not as text the
    user edits first.
  - **Scheduled prompts.** M52's `/loop` repeats a prompt on an interval or
    a cron schedule, on the Model API. Muse Code's own `cron_*` tools run
    only through a model turn and cannot be listed (M52).
  - **Muse Code workflows** (M47, D40) are scripts the model writes and the
    CLI runs. The panel shows their cards but cannot define, list or start
    one: MSP has no verb for it, and `muse workflows list|recover` is
    CLI-only.
  - **Plans** (M79) are files the panel opens and implements.
  - **The gap** is a library the user fills from the panel (named text put
    into the composer to edit and send), and a way to send several prompts
    one after another. For item 13, M88 builds only that.
- **Saved prompts belong to the panel, not to skills.** **Storage
  superseded 2026-10-06 by D98 (M118):** the library is built there, with a
  user scope in the agent data folder and a workspace scope in
  `.muse/prompts/`; this section's caps, damage rule and sync opt-in carry
  over; sequences and bookmarks stay M88's.
  - **Why not skills.** Writing them as skills would put files into Muse
    Code's personal folder, which the extension never does (D13), or into
    the project, where git would share them. And a skill does not behave
    like inserted text.
  - **Where they are stored.** Each prompt goes in VS Code's `globalState`
    ("All workspaces", the default) or `workspaceState` ("This workspace"),
    chosen per prompt. Both live in VS Code's state database on this
    machine, unencrypted.
  - **Sync is opt in (owner, 2026-10-03, §3).** A prompt can hold private
    text (paths, names, customer details), so nothing is synced unless the
    user asks. One setting, `museSpark.syncPromptsAndBookmarks` (boolean,
    off by default, machine-scoped so that each computer opts in itself),
    decides it for saved prompts and bookmarks together.
    - VS Code syncs only `globalState` keys registered with
      `setKeysForSync`, never `workspaceState`. One host module registers
      both keys (the "All workspaces" prompts and the bookmarks) while the
      setting is on, and an empty list while it is off, at start and on
      every change of the setting.
    - "This workspace" prompts stay in `workspaceState`, so they never sync.
      With sync on, the scope picker says so, and a prompt wanted on every
      computer is saved for "All workspaces".
    - Off, nothing is registered and everything stays on this machine.
  - **Caps** (in constants): 200 prompts per scope, 80 characters per name,
    10,000 characters per text, and 20 steps per sequence.
  - **A damaged store.** Each scope is validated on its own. A scope that
    fails its schema (a damaged value, or one that arrived through sync) is
    reported and kept as found, and it is not written again until the user
    resets it. The other scope works as usual.
    - **Reset** is a button on the damage notice, with an inline
      confirmation. It replaces that scope's value with an empty library of
      the current version, and touches nothing else.
  - **Insert** puts the text at the composer's caret; nothing is sent.
  - **Secrets.** The dialog says not to save secrets: the store is plain
    text, and D64 shows why the panel does not try to detect them.
- **Prompt sequences, not "workflows".** The multi-step part is called a
  prompt sequence in the panel, because "workflow" already names Muse
  Code's engine, whose cards the transcript shows. A sequence is an ordered
  list of steps (texts).
  - **Starting.** The start dialog lists the steps, the conversation and
    its permission mode. Auto and Bypass are named prominently.
  - **Running.**
    - Step 1 is sent as the user's own message.
    - Each later step is sent only when the previous turn ends `completed`
      and no other turn is queued.
    - The run ends when a turn fails or is cancelled, on Stop, on a session
      switch, and when the panel closes.
    - A message the user sends meanwhile steers the turn, as any message
      does, and the run goes on after it.
    - A run row shows "step 2 of 4", with Stop.
  - **Cost.** Each step is an ordinary turn. On Muse Code it is billed to
    the subscription; on the Model API it is billed to the key at the
    model's token prices, under M82's session budget.
  - **Not a paid feature** under AGENTS.md rule 12: it makes no extra-cost
    call, and the user starts it. On the Model API, the start dialog says
    that N turns will be billed.
- **Bookmarks (item 14).**
  - **Storage.** Bookmarks are per workspace, as conversations are: a list
    of `{ backend, sessionId, title, bookmarkedAtMs }`, at most 200 per
    workspace (in constants).
    - Settings Sync can carry only `globalState`, so every workspace's list
      lives there under one state key, filed under the workspace's digest:
      the start of the SHA-256 of the workspace file's URI, otherwise of
      the first folder's URI (as `workspaceKey` in
      `src/runtime/dataFolder.ts` hashes a root). No path is stored. The
      same state key serves with sync on and off, so turning the setting on
      or off moves nothing.
    - A window without a folder offers no bookmark.
    - A session id names a conversation only where its sessions are. So a
      synced bookmark resolves on another computer only in the same
      workspace with the same sessions (chiefly a remote workspace that both
      computers open). Elsewhere it shows as not available here, with Remove
      (below).
  - **Kept past retention.** A bookmarked Model API session is not deleted
    by `museSpark.cleanupPeriodDays` (D26): the session store's retention
    skips the ids the bookmark store holds. Once the bookmark is removed,
    retention takes the session at the next listing as usual. Muse Code
    keeps its own sessions, which the extension cannot keep.
  - **In History** a "Bookmarked" group comes first (`shared/sessions.ts`).
    The header has the star for the open conversation, a toggle button.
  - **History's keyboard model is kept** (M37, the listbox of PR #89's
    `paletteDialog.tsx`). Focus stays in the search box, and a row is an
    option, so it holds no button.
    - **Alt+B** toggles the highlighted row's bookmark from the search box,
      as Delete archives it. The key is matched on `event.code` (`KeyB`), so
      macOS's Option characters do not change it. The extension binds
      nothing to Alt+B (`package.json`). Lane B checks VS Code's default
      keymap on the three systems before using it; if one binds it, the lead
      picks another key, and lane 0's strings follow.
    - Each row's star is for the mouse only, `aria-hidden` like the archive
      control.
    - The option carries the state: a bookmarked row's name includes
      "Bookmarked" (visually hidden text). Its `aria-keyshortcuts` is
      "Delete Alt+B", and its description names both commands.
  - **Archived.** An archived chat that is bookmarked shows under "Show
    archived", with its star.
  - **Chats older than the loaded pages.** The Bookmarked group loads
    further pages until it finds every id or the list ends. Meanwhile the
    stored title stands in, and it is refreshed when the row is seen.
  - **A bookmark whose session is gone** (pruned by Muse Code, deleted, or
    synced from a computer that has it) keeps its stored title in the
    Bookmarked group once every page has been read. It is marked not
    available here, and its only action is Remove.
- **Timed sends (item 15) extend M52.** **Superseded 2026-10-06 by D95
  (M115):** items 15 and 16 become M115's once trigger and its Resume later,
  run unattended under a schedule's grant instead of in the conversation's
  mode; the rest of D67 stands.
  - **A one-shot cadence.** `{ kind: 'once', atMs }` joins `interval` and
    `cron` (`src/shared/schedule.ts`). It fires once and ends after its
    attempt.
    - M52's store, atomic claim (`wx` receipt), workspace check, seven-day
      lifetime and expiry rules apply unchanged. Each backend binds a job to
      its account in its own way (below).
    - The picker offers whole minutes from one minute to six days ahead
      (`TIMED_SEND_MIN_LEAD_MS`, `TIMED_SEND_MAX_LEAD_MS`), so every send
      has at least a day to be run before its job expires.
  - **Entry.** "Schedule this prompt…" (`/schedule`) opens a dialog with
    the composer's text and an `<input type="datetime-local">`, in local
    time, at the earliest a minute ahead. `/loop` keeps its grammar.
  - **At its time, on both backends (owner, 2026-10-03, §3).** A send goes
    by itself, with no Run or Send now, when the 60 s poll finds it due no
    later than `TIMED_SEND_GRACE_MS` (two minutes) after its time, its
    session is the one loaded in this window, and its backend's binding
    (below) still matches.
    - It runs in the conversation's permission mode at that moment, so
      Manual still stops at each approval, and Auto and Bypass do not.
    - The schedule dialog names the current mode, Auto and Bypass
      prominently, as the sequence start dialog does.
    - In the live transcript its user card is marked "Sent on schedule".
  - **A busy session.** `deferredSend` takes a message only while the
    session is idle, and a running prompt sequence counts as busy. A send
    that falls due during a turn stays pending and unclaimed. It keeps its
    on-time place while this window stays open, and goes when the turn
    settles (`onTurnSettled`).
    - The claim is taken only once the session can take the message: the
      scheduler checks, claims, and sends in the same step as the claim
      resolves.
    - If the session turned busy or was unloaded while the receipt was
      written, the host deletes its own receipt and the send waits again.
      No turn was admitted, so nothing can have been billed, and M52's
      no-replay rule still holds.
    - Once `sendAsUser` accepts it, the occurrence is attempted, as in M52.
  - **Otherwise it waits.** A send that was not on time (VS Code closed or
    asleep through it, or the window reloaded while it waited for a turn),
    whose session is not loaded, or, on the Model API, whose binding no
    longer matches, is due. It waits for Run on the Model API (which asks
    again), Send now on Muse Code, Cancel, or expiry. Nothing is ever sent
    late on its own. (On Muse Code a changed binding deletes the job; see
    below.)
  - **Model API: confirmed when it is scheduled (owner, 2026-10-03, §3).**
    - Creating, listing and cancelling make no call (M52).
    - Schedule needs `museSpark.modelApiScheduledPrompts` on, with its price
      accepted. Otherwise the dialog says so, offers the setting, and stores
      nothing.
    - Schedule shows the D48 popup once, for that run only: the prompt, the
      model and its price, and the time. Bypass cannot skip it. "Allow
      always in this workspace" skips it, as D48 says. Deny, or closing it,
      stores nothing.
    - The job keeps what was confirmed: the prompt, the model, the session,
      M52's key digest, and the gate's price generation (D48).
    - At its time all of these are checked again, and the gate must still
      be on. Any change sends it back to Run, which asks again. Nothing is
      billed without a match.
    - The paid row and tally work as in M52.
  - **Muse Code: unattended (owner, 2026-10-03, §3).** M52 is Model API
    only, and Muse Code's own cron jobs cannot be created or listed from the
    panel.
    - So the extension keeps Muse Code's timed sends in a store of its own
      (`storageUri/musecode-timed-sends`), with M52's store implementation
      and claim, bound to the workspace and the session.
    - No key is involved and the subscription pays, so there is no paid
      gate.
    - **Bound to the sign-in, not to an account.** The extension never
      knows the Muse Code account: `account/read`'s label is not even
      parsed, and AGENTS.md rule 8 keeps it out of storage. So a job's
      account field holds the credential file's signature as
      `cliAccount.ts` reads it (its size and modification time, never a
      value). Nothing in it identifies anyone.
      - A sign-out and a sign-in both write that file (the shapes in
        `credentialFile.ts`, D26). So a change of account changes the
        signature, even one made while VS Code is closed.
      - The host compares the signatures at start, at each poll, and on the
        panel's own sign-in or sign-out. When the current one differs from
        a job's, it deletes every Muse Code timed send of the workspace,
        prompt text included, before anything is listed, and the schedule
        pane says why. M52's listing filter and claim check refuse a
        mismatched job in the meantime.
      - Whether the CLI rewrites the file when it refreshes a token is not
        captured. Lane C records it before relying on the signature: the
        signature at the start and the end of a day of ordinary use with no
        sign-in between. If it changes, the binding uses the file's
        structure instead (`credentialFileVerdict`'s lane and providers).
        Then only the sign-outs and sign-ins the host sees clear the jobs,
        and the README says that a change of account made while VS Code is
        closed is not detected.
      - While `META_API_KEY` is set in VS Code's environment, the CLI uses
        it instead of the file. Muse Code then offers no timed send, and
        says why. Only the variable's presence is checked; its value is
        never read.
  - **The notices.** A send that waits is the due row in the schedule pane,
    the live region, and, while the window is unfocused, M82's background
    notice (a new notice kind, `scheduleDue`; PR #89). A send that goes on
    time starts an ordinary turn, which M82 already reports.
  - **While VS Code is closed nothing runs.**
    - The extension is code inside VS Code. There is no service, OS
      scheduler or background process, by design (D4, M52).
    - At the next start the host reads the store (no model call) and lists
      every due send of the workspace. A send whose session is not loaded
      gets "Open conversation".
    - A missed send says "due since …" and waits, as above, until it
      expires.
    - Sleep counts as closed: the 60 s poll catches up on wake, and a send
      it finds past its grace waits.
    - Two windows on one folder cannot both send: the claim decides.
- **Resume after a limit (item 16).** Resume is a timed send of a fixed
  English prompt (`MODEL_TEXT.resumePrompt`: "Continue where you left
  off."). It is offered as "Resume later…" on the failed turn's row, in the
  same session, under the same rules. What counts as a limit:
  - **Model API, rate limit.** The turn failed with HTTP 429 after the
    client's four retries (`client.ts`). A new error kind, `rateLimited`,
    carries the last `Retry-After` (seconds or an HTTP date). The default
    time is when it ends, otherwise five minutes after the failure.
  - **Model API, M82's session budget** (`SessionBudgetExceededError`).
    Time does not refill it, so no timer is offered. The row offers the
    budget setting, then Continue.
  - **Model API, an account quota or balance refusal.** No capture shows
    its shape, so it stays an ordinary failure until one does (rule 13).
  - **Muse Code, the subscription's usage limit.** The error that a full
    window gives has not been captured. §3 decides to capture it, and lane C
    of M88 takes the capture.
    - **The offer needs a captured usage-limit signal**, never the usage
      report alone. The signal is a turn failure in the captured shape
      (written from that capture, rule 13), or the goal status
      `usage_limited` (M45). Until the capture exists, only the goal status
      offers Resume later on Muse Code.
    - **The time** comes from a `usage/read` made after that signal: the
      reset (`resetsAtMs`) of a window it shows at 100 % (M53). With no such
      window there is no time, and no offer.
    - Any other failure stays an ordinary failure, even while a window
      reads 100 %. A network, tool or protocol error must not schedule a
      message the user never asked for.
    - The offer says that its time rests on the usage report.
  - **The default time fits the picker,** for every kind above. It is
    rounded up to the next whole minute and is never less than a minute
    ahead, so a `Retry-After` of a few seconds opens at one minute. A limit
    that lifts more than six days ahead (a `Retry-After`, or a weekly
    window's reset) gets no timer: a timed send could only go before it
    lifts. The row says when it lifts instead.

<!-- plan-archive:end id="2-D67-01" -->

## D68 — Bundled skills: high-quality-projects in the box (M89, 2026-10-03)

<!-- plan-archive:begin id="2-D68-01" lines="5940-5985" bytes="3345" sha256="95d30f74b836f06759ae67277ab208ae8f10c5697f6d138ef15c52c6378407f4" -->

The owner asked to bundle his skill package
([high-quality-projects-skill](https://github.com/RandyNorthrup/high-quality-projects-skill),
MIT, © Randy Northrup) so every user of the extension has it. It holds three
workflows (`project_setup`, `feature_delivery`, `quality_retrofit`) that depend
on the package's shared `scripts/` (Bash, PowerShell and Python helpers),
`templates/` and references, so a skill is never shipped as a lone `SKILL.md`.

- **The owner's answers (2026-10-03).** Both backends, Muse Code by opt-in;
  on by default.
- **A pinned, vendored release.** `vendor/high-quality-projects-skill/` holds
  the files of one tagged release (v0.7.0 first), copied by
  `scripts/sync-bundled-skills.mjs` from the release archive after its SHA-256
  matches the release's `SHA256SUMS.txt`. `VENDOR.json` records the tag, the
  archive's SHA-256 and each copied path's SHA-256, pinning the vendored bytes. Builds stay offline and
  reproducible; nothing is downloaded at run time. A newer tag is taken by
  rerunning the script in a PR, with its CHANGELOG entry. Only what the
  workflows read ships: `skills/`, `scripts/` (not `build-release.ps1`),
  `templates/`, `AGENTS.md`, `LICENSE`, `README.md` and the `docs/` pages the
  skills cite; never `tests/`, `docs/assets/`, `docs/evaluations/` or the
  package's own CI files. The licence is listed in `THIRD_PARTY_NOTICES.txt`.
- **Model API backend: a third skill source.** `SKILL_SOURCES` gains
  `bundled`, the lowest precedence: a project or personal skill with the same
  id shadows it, so a user's own copy always wins. Its root is the vendored
  `skills/` folder inside the installed extension, read through the same
  bounded loader as the others. `museSpark.bundledSkills` (machine-scoped
  boolean, default `true`) turns the source off. When the model reads a
  bundled skill (`read_skill` or a typed `/id`), the body is preceded by one
  line naming the package root, so the skill's `SKILL_ROOT` resolves to the
  vendored package; its scripts still run only through the shell tool, under
  the session's permission mode, like any other command.
- **Muse Code backend: an explicit install.** Muse Code reads only its own
  skill folders, so **Muse Spark: Install Bundled Skills for Muse Code** copies
  the vendored package to `<config home>/muse/skill-sources/high-quality-projects-skill/`
  and links each workflow into Muse Code's personal skills folder
  (`<config home>/muse/skills/<id>`): a junction on Windows, a directory symlink
  elsewhere, as the package's own install guide prescribes. An id that already
  exists there is left alone and named in the result. A marker file in the
  copied package records the installed tag, and only folders carrying it are
  ever replaced or removed. The install is offered once (a panel notice with
  **Install** and **Not now**, the first time a Muse Code conversation starts
  with the setting on). When the extension ships a newer vendored tag than an
  installed one, the panel offers **Update** once. **Muse Spark: Remove Bundled
  Skills from Muse Code** removes exactly what the install made. Nothing is
  written to the user's config folder without one of these actions.
- **Requirements stay the package's.** The delivery helpers need Python 3;
  the README says so, and a missing Python is the script's own error.

<!-- plan-archive:end id="2-D68-01" -->

## D78 — Enhancements available out of the box (owner, 2026-10-04)

<!-- plan-archive:begin id="2-D78-01" lines="5989-6051" bytes="4182" sha256="b9e9b864acfd1c3717155dd9c02191608bc5040df47bcd3b0c214e1f2f8e8eaa" -->

The owner chose: "On, ask once first — active out of the box and visible.
Before the first charge it asks once (Allow / Allow always / Not now)
showing the price and a daily budget. Nothing is spent without that one yes."
This supersedes D48's off-by-default clause for interactive VS Code Model
API extras. It preserves paid badges, rows, tally, revocable per-workspace
"always", and paid-use consent in Bypass. Allow once still authorizes one
use; subsequent uses ask unless "always" was chosen. Existing explicit
false settings remain false. Default-on availability needs no startup price
dialog; an explicit OFF-to-ON change still confirms its price.

Observation packing (M73's passing M75 run), hooks (inert without a file,
trusted workspace only), and reply usage default on. Web search, images,
Muse Voice availability, Auto reviewer, subagents, schedules and best-of-N
default on for Model API. Free OS dictation remains the selected engine.
Best-of-N stays an explicit separate action: an ordinary turn runs one
model; no setting multiplies every turn's cost.

Interactive extras share `museSpark.paidDailyBudgetUsd`, machine scoped,
USD 5 by default, USD 0.50–500. Reuse M82's durable claim journal under
global extension storage, one local-calendar-day scope across windows and
keys. Reserve before dispatch; recheck synchronously at send; settle known
usage, refund known nonsends, retain uncertain liability. Unreadable or
incomplete storage refuses spending. At the cap offer raise for today or
stop until tomorrow; a raise is shared on disk and expires with the day.
M94 Tab's USD 1/day ledger remains independent; Tab does not enter this
extras journal. M94 is not present in this lane's base tree.

M82 already refuses hosted search and Muse Voice under a finite cap: no
captured hard query bound or billed-duration receipt exists. Preserve those
refusals under the daily cap rather than inventing a wire limit. Availability
is visible, but those two transports remain refused pending verified bounds.
Muse Code's existing explicit paid opt-ins, confidential-workspace policy,
ACP flags and headless explicit flag plus hard budget remain unchanged.

No request prefix, tool description or golden fixture changes are authorized.
Packing stays request-local and sticky; hooks-off bodies must stay exact.
M91 is absent from this base; run its golden requests after lead integration.
No live evaluation is authorized. Q11 repo-map default stays off: next run
must add a repo-map-only M75 arm versus baseline on the same twelve paired
tasks, seven accept and five held-out (floors 6/7 and 4/5 on both arms),
`muse-spark-1.3-contributor`, fixed 1,024-token map, identical other flags,
and the existing USD 0.50 bound. Record input/cache/output tokens, total
cost, latency and engagement before deciding whether to flip Q11.

DEFAULTS acceptance: manifest and fallback defaults agree; explicit false
survives; trusted hooks only; first-use consent precedes fetch; daily claims
refuse over-cap, corrupt storage and concurrent overspend; price and daily
cap are localized; request bodies and single-model turns remain unchanged.
Reuse `paidFeatures`, `paidConsent`, `sessionBudgetJournal` and the final
HTTP admission guard. Evidence: `docs/certification/defaults.md`.

FIXDEF review follow-up (2026-10-04): a committed daily Stop must survive
every pending raise, including a delayed atomic replacement. Use a separate
monotonic day marker; never remove it when raising the numeric cap. Pass the
request's cancellation through daily admission, refund nonsends, and reject
late dialog answers/publications. Offer packed recall only when the request
contains a packed observation, preserving unused packing's whole request and
cache key. Keep setting state separate from backend availability so changing
backends cannot withdraw accepted prices or workspace grants. Correct the
Best-of-N overview. Each finding needs a Kubuntu regression/red drill.
Search's proposed one-search bound and voice's proposed 180-second bound
require verified server/billing contracts, not invented wire fields or a
recorder timer alone; live calls remain outside this lane's authorization.

<!-- plan-archive:end id="2-D78-01" -->

## D69 — Auto on Muse Code: an extension-side reviewer (M90, 2026-10-03)

<!-- plan-archive:begin id="2-D69-01" lines="6055-6118" bytes="4352" sha256="31ba331735280d77094fd9bff2c223907e13b4236c7d6f0ff0dc7348d61f5cd7" -->

The owner reported clicking as many approvals in Auto as in Manual on the
Muse Code backend. Investigation (2026-10-03; the CLI's session log and trace
for his live session, plus a three-turn live probe on the contributor model):

- The panel's modes reach Muse Code and take effect (`session/setApprovalMode`
  applied, effective mode recorded), mid-turn changes included.
- **D7's premise did not hold under `muse serve`.** D7 read `muse --help`
  (1.3.0): Auto = `onRequest`, "judge-reviewed, prompt only on need". The LLM
  approval judge exists only for the interactive and `exec` commands;
  `muse serve` has no flag for it and the protocol cannot choose a reviewer
  (`approval_reviewer.resolve outcome="disabled" reason="setting_off"`). Under
  serve, `onRequest` skips only commands the CLI classifies as simple and safe;
  every multi-statement script (all 142 approvals in his Oct 2–3 logs were
  PowerShell scripts, which also get no "always allow" because the CLI cannot
  split them into stages) still asks.
- **Manual and Edit automatically are one mode to Muse Code** (`promptUnmatched`),
  and Muse Code under serve does not ask before workspace file edits, so Edit
  automatically has nothing to answer there.

Decisions (the owner chose the reviewer on 2026-10-03):

- **The reviewer.** In Auto on the Muse Code backend, when Muse Code raises an
  approval no rule settled, the extension asks a reviewer before the user. It
  reuses M78's reviewer core (`autoReviewer.ts`: `reviewerInput`,
  `parseReviewerAnswer`, `ReviewBreaker`) and its rubric, and runs on the
  user's Muse subscription: a hidden side session in the same `muse serve`
  (Plan mode in an empty folder; the conversation's model; never listed in
  History), one short turn per review. It answers ALLOW or ASK with a reason.
- **Its reach.** It can turn an ask into an allow, nothing else. A decline, an
  unreadable answer, a timeout (`MUSE_CODE_REVIEW_TIMEOUT_MS`), an error, a
  closed or busy side session, or a tripped breaker leave the approval to the
  user, as today. It never answers a file write the extension's own rules
  protect, a paid call, a child task or a question that is not an approval.
  One review at a time per window.
- **Tool boundary.** Muse Code's SDK `SessionConfig` only configures
  `mcpServers`; it cannot disable native tools. Any review-turn item other
  than the captured ones (the prompt's echo, Muse Code's reminder agents,
  reasoning and the reply) cancels the turn, shows the normal card with the
  generic failure reason, and recreates the side session.
  Residual: a command covered by the user's always-allow rule could run in
  the empty folder before cancellation lands. The captured setup supplied
  no workspace files, rules or skills; CLI-global context is not excluded.
- **Verdict boundary (review fixes, 2026-10-03 and -04).** Changed kind,
  command, path, access, host, target or tool name invalidates both a held review and a later-stage
  allowance. Accepted messages and steering release held reviews and clear
  allowances. Queue admission rechecks the breaker; reasoning setup shares
  the deadline and cancellation. Only a completed reply in a completed
  turn carries a verdict. Unseen tool resolutions retain attribution for
  the newest 50 item ids until their rows arrive, live or from a same-session
  history read, which also keeps the outcomes the panel saw.
- **Shown, not hidden.** An approval the reviewer allowed shows in the
  transcript as allowed by the reviewer, with its reason; an ASK shows the
  reason on the card the user answers.
- **Default and setting.** On in Auto (`museSpark.museCodeAutoReviewer`,
  machine-scoped, default `true`); the first review in a window posts one
  notice saying what it does and how to turn it off. It costs one short turn
  of the user's Muse subscription per review, which the notice says.
- **Honest mode descriptions.** The mode picker, README and this plan describe
  each mode per backend: on Muse Code, Edit automatically is Manual, and Auto
  is Muse Code's own simple-command skip plus the reviewer.
- **Upstream.** A request to Meta for an approval judge under `muse serve`
  (or a way to pick the reviewer over the protocol) goes with the event-log
  report; when it lands, the extension prefers it and keeps this reviewer as
  the fallback.

<!-- plan-archive:end id="2-D69-01" -->

## D82 — Usage & cost: one local journal, one page in every editor (M102, 2026-10-05)

<!-- plan-archive:begin id="2-D82-01" lines="6260-6461" bytes="21037" sha256="c03d5310282c06673e82d9b659595ebfddece0c8912ec43983bb17352280405c" -->

The owner asked (2026-10-05): "research, plan, and implement: a price page
where you can track all of your usage across all the models with usage graphs
and charts and token consumption in and out and time limits and token cost etc
similar to the tracker in t3 code". His rule the same day: "all of the editors
should have equivalent functionality even if we need to develop it ourselves".
His standing rulings apply:

- enhancements are on by default;
- everything is multi-vendor, gated by capability;
- there is no telemetry;
- the SoL-Pi gains are invariants.

Research is in §1 of this draft (`docs/research/usage.md` when it lands).

- **One journal per machine, for every editor.** Every place that makes a model
  call appends records to one local, append-only journal. That covers the VS
  Code family, the ACP agent, the headless CLI and the native plugins' runtime.
  - **Location.** `<agentDataFolder>/usage/v1/` (`src/runtime/dataFolder.ts`).
    VS Code writes there too, not in its own global storage, so one user's
    VS Code, Cursor, Zed (through ACP) and CLI share one history. Every page
    shows all of it, broken down by **Where** (the editor, from its own name:
    `vscode.env.appName`, ACP `clientInfo.name`, `cli`).
  - **Layout.** One file per writing process per local day:
    `days/<YYYY-MM-DD>/<writerId>.jsonl`, the same pattern as Tab's ledger.
    Appends never interleave and need no lock. Each line is one record under
    4 KiB.
  - **Torn lines.** A torn last line is skipped and counted. A record whose
    version is newer than the reader's is shown as "N records from a newer
    version" instead of being dropped silently.
  - **Remote windows and containers.** The journal lives where the extension
    host or runtime runs, and the page names that host.
  - **The budget ledgers stay separate.** They admit spend; the journal only
    records. Neither reads the other's files.
- **What a record holds.**
  - **When and where:** `v`, `id`, `at` and `startedAt` (epoch ms), `day` (the
    local day, from the same function as Tab's `tabLocalDate` and D78's
    `day()`), the time-zone offset, `client`, `backend`.
  - **What was called:** `provider` (the M95 provider reference, `meta`, or
    `museCode`), `model` (the id sent), and `served` (the provider's own model
    or upstream, e.g. OpenRouter's route) where it is reported.
  - **`kind`:** `turn`, `compaction`, `sideChat`, `subagent`, `worker` (M96),
    `reviewer` (M78/M90, the judges), `bestOfN`, `tab` (M94), `schedule`
    (M52), `vscodeChat` (M95c), `hook` (only if a hook makes a model call),
    `search`, `image`, `voice`, or `count`. A kind no milestone produces yet is
    registered but unused.
  - **`tokens`:**
    - `input` (total), `cached`, `cacheWrite`, `cacheWrite1h`, `output` and
      `reasoning`.
    - Each is optional, and **absent means unknown, never 0**.
    - An `estimated: true` flag marks tokens from `countTokens` (Copilot).
  - **`units`:** `searches`, `images`, `audioSeconds`.
  - **`cost`:**
    - `usd?` plus its certainty: `reported`, `computed`, `uncertain` (sent, no
      usage, the liability kept), `plan`, `local` or `unpriced`.
    - The price's source (`list`, `catalogue`, `user`, `meta-published`) and
      date.
  - **Outcome and timing:**
    - `outcome`: completed, incomplete, failed, cancelled or refused.
    - `durationMs` and `firstTokenMs`, where known.
    - `retries` and `rateLimited`.
    - Gemini's `retryDelayMs` from the 429 body.
  - **Session:** `session` (an opaque id; titles are looked up locally when the
    page renders) and `packedAvoided` (M73's estimate).
  - **Never in a record:** prompt or reply text, tool arguments, file or
    workspace paths, keys, key digests, or headers outside the list below.
- **Limit snapshots** go in the same files, as `type: "limit"`. Each holds
  `{provider, source, observedAt, windows[{id, label?, usedPercent, resetsAt?,
windowMins?}], account?{usedUsd, limitUsd, remainingUsd, period}, raw?}`.
  - **Muse Code:** written on every `usage/changed`, de-duplicated by
    `observedAtMs`.
  - **OpenRouter:** written on each `/api/v1/key` read.
  - **Rate-limit headers:** each provider's latest headers from the allow list,
    when they change, and on every 429.
- **Prices are settled once and never rewritten.**
  - Settlement uses D74's order: reported cost, then xAI ticks, then the dated
    card. The 1-hour cache write is priced at `cacheWrite1h` (a fix to
    `settleUsageUsd`).
  - Meta's models use the published table, and paid tools use
    `PAID_PRICES_USD`. A model with no card is `unpriced`.
  - **A price that changes later does not change history.**
  - A call recorded as unpriced can be shown "priced later" with the user's new
    card. It is labelled as such and never written back.
  - **Plan usage** (Muse Code, the ChatGPT plan, Copilot) shows the plan's
    tokens and requests. It also shows an **API-equivalent** dollar figure,
    labelled as such, only when the same model id has a list price. This
    avoids Cursor's "Included"-only pitfall.
  - **Local models** show $0, with time and tokens per second.
- **"Time limits," honestly.** The page shows four kinds of limit.
  - **Provider windows.**
    - Muse Code's 5-hour window and weekly block, from `usage/changed`.
    - The ChatGPT plan's primary and secondary windows, once M95b's capture
      shows them.
    - OpenRouter's key limit, remainder and reset.

    Labels come from the reported length. **Pace** (used share against elapsed
    share, with a ±5-point band) is shown only where the duration is reported:
    the 5-hour window, never the weekly block (M53). Stale after 15 minutes;
    "awaiting fresh usage" once the reset has passed (M53).

  - **Request and token rate limits.** These come from response headers
    (`x-ratelimit-*`, `anthropic-ratelimit-*`, `x-codex-*`, IETF
    `ratelimit`/`ratelimit-policy`, `retry-after`), stored verbatim from that
    allow list, each value at most 64 ASCII characters.
    - A provider's headers are turned into a meter only after a recorded
      capture (rule 13). Until then the page shows them "as reported".
  - **What happened.** Calls that were rate-limited or retried, per provider
    and day.
  - **Our own caps.**
    - D78's daily paid budget, including Stop and today's raise.
    - M94's Tab daily budget and M95c's VS Code chat daily budget.
    - M82's conversation cap.
    - Headless `--budget`.

    Where at least 30 minutes of spend exist today, a burn-rate line projects
    to the end of the day.

  - **Providers that report no limit say so in words**, with a link to their
    console. Gemini, for example: limits set per project in AI Studio. Meta's
    limits are listed at dev.meta.ai.
- **Retention and reset.**
  - Per-call records are kept for 30 days (`USAGE_DETAIL_DAYS`). Older days are
    rolled up into `rollups/<YYYY-MM>.json`, one row per day × client × backend
    × provider × model × kind × certainty. Each row holds sums plus a fixed
    12-bucket log-scale latency histogram, so p50 and p95 survive the rollup.
    Rollups are kept for `museSpark.usageHistoryDays` (default 365, 30–1825).
  - A rollup runs under an exclusive-create lock (as What's New's claim does).
    Immutable numbered claims carry the owner token and generation; release
    marks only that token, so a paused former owner cannot unlink a successor.
    Readers take the same lock and verify ownership before returning, retrying
    one lost generation before an explicit error. A busy lock is also explicit.
    A rollup is read whole through one open handle and written to a temporary
    file, fsynced and atomically replaced with the existing Windows retries.
    It records the days it covers, and only then deletes the raw days. The reader
    ignores any raw day a rollup already covers, so a crash between the two
    steps counts nothing twice.
  - **Delete usage history…** removes only `usage/`, after a modal that names
    the record count. Budget and Tab ledgers and paid grants are never touched.
  - `museSpark.usageHistory` (machine scope, default on) stops new records. The
    ACP agent and CLI read the same two settings from their own configuration
    and take `--usage-history=off`.
- **Recording points.** Each call site makes one call after its usage has
  settled, and no request body changes. The golden request tests and M75's
  evaluation stay byte-identical: this is the SoL-Pi invariant.
  - Model API and BYO: `noteUsage`, with a kind added at compaction and side
    chat, plus the transport's duration, retries and allow-listed headers.
  - The reviewer, best-of-N, subagents and paid tools.
  - Muse Code:
    - per-turn **deltas** of `cumulative`;
    - a session's first report after a reload is a baseline, unless the session
      was created in this process;
    - every `usage/changed`.
  - Tab's settle, the CLI's `exec`, and the ACP agent's two backends.
- **One page, in shared code.**
  - The page's host side (`src/core/usage/usageService.ts`) imports no
    `vscode`. It covers the journal, rollups, aggregation, export, the text
    summary and the trace logs, and talks to the host through ports: file
    system, clock, budget readers, subscription snapshot, provider account
    usage, open external, save file and confirm. It builds to
    `dist/usageService.js`, which VS Code and the runtime both load lazily.
  - The page is a shared React entry, `src/webview/usage/usage.tsx`, the third
    entry in the shared browser build. It reaches its host only through
    `HostBridge`, with a bridge per host: VS Code (exists); HTTP (companion);
    JCEF, WebView2 and SWT (contracts and fakes here, wired by M64 and M65).
  - The protocol is zod-checked in both directions (`src/shared/usagePage.ts`).
  - Styles use `--muse-*` tokens. They default to `--vscode-*` (charts:
    `--vscode-charts-{blue,purple,orange,green,yellow,red}`, "other" as
    `--vscode-disabledForeground`), with documented fallbacks. Each native host
    maps its own theme onto them.
  - Strings live in a family of their own: `src/shared/l10n/usageEn.ts` plus
    `l10n/usage.<lang>.json` for 14 languages, checked by `check-l10n`. Only
    the page's own bundles carry them; the chat startup and `uiText.js` do not
    grow.
- **Every editor** shows the same page or its text equivalent.

  | Editor                                                                                                   | Route                      | How the page shows                                                                                                                                                                                                                                                                                                                                                      | Host side runs in                                                   | Bridge                                              | Export                                     | Delivered by                                                                                                                        |
  | -------------------------------------------------------------------------------------------------------- | -------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------- | --------------------------------------------------- | ------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------- |
  | VS Code, VSCodium, Cursor, Kiro, Positron, Windsurf (VSIX mode), Theia                                   | VSIX                       | **Usage & cost** editor tab (`WebviewPanel`), from the command, the palette, `/usage page`, and Account & usage's **Open usage page**                                                                                                                                                                                                                                   | extension host, `dist/usageService.js`                              | `vsCodeHostBridge`                                  | `showSaveDialog`                           | M102                                                                                                                                |
  | code-server, Codespaces, Remote SSH/WSL/Containers                                                       | VSIX on the workspace host | the same tab; the page names the host the journal is on                                                                                                                                                                                                                                                                                                                 | the remote extension host                                           | `vsCodeHostBridge`                                  | save dialog on the remote                  | M102                                                                                                                                |
  | JetBrains IDEs (IDEA, PyCharm, WebStorm, Rider, CLion, GoLand, Android Studio)                           | native plugin (M64)        | **Usage & cost** editor tab in JCEF, loading the same `dist/webview/usage.js`                                                                                                                                                                                                                                                                                           | the shared Node runtime, `muse-spark-code-acp usage serve --stdio`  | `jcefHostBridge` (`JBCefJSQuery`)                   | IDE file chooser → service writes the file | bridge, stdio service and fake-bridge harness in M102; the tab in M64. **Until then:** the ACP route through JetBrains AI Assistant |
  | Visual Studio (Windows)                                                                                  | native (M64)               | WebView2 tool window or document, with virtual-host mapping for local files                                                                                                                                                                                                                                                                                             | the same stdio runtime                                              | `webView2HostBridge` (`chrome.webview.postMessage`) | SaveFileDialog                             | bridge in M102; window in M64. **Until then:** the companion page from `usage open`                                                 |
  | Eclipse, NetBeans, Spyder                                                                                | native (M65)               | SWT Browser editor (Eclipse), JCEF or JavaFX (NetBeans), Qt WebEngine (Spyder)                                                                                                                                                                                                                                                                                          | the same stdio runtime                                              | `swtHostBridge` (`BrowserFunction`) and friends     | the host's file dialog                     | bridge in M102; parts in M65. **Until then:** the companion page                                                                    |
  | JupyterLab, RStudio                                                                                      | M65                        | Lumino widget / Viewer pane showing the companion page                                                                                                                                                                                                                                                                                                                  | the runtime's companion server                                      | `httpHostBridge`                                    | browser download                           | M65; the companion page is usable now                                                                                               |
  | Zed, JetBrains AI Assistant, Xcode 27, Qt Creator, Neovim (CodeCompanion), Emacs, Sublime, Devin Desktop | ACP agent                  | (1) live session cost in the client's own UI through ACP `usage_update.cost`; (2) a `/usage` command whose reply is a Markdown summary (range, providers and models, limits, budgets, certainty); (3) **Open the usage page**: the agent starts the companion server and sends the link, by URL elicitation when the client offers it, otherwise as a link in the reply | the ACP process; `dist/usageService.js` loads on the first `/usage` | `httpHostBridge` in the browser                     | browser download                           | M102                                                                                                                                |
  | Xcode 26.3 (MCP external agent), Vim, Kate, any terminal                                                 | CLI                        | `muse-spark-code-acp usage [summary\|daily\|models\|limits\|export] --range --by --json\|--csv`; `usage open` launches the companion page                                                                                                                                                                                                                               | the CLI process                                                     | — / `httpHostBridge`                                | `--out <file>` / browser download          | M102                                                                                                                                |
  | Headless and CI (M80)                                                                                    | `exec`                     | `exec` appends records (client `cli`) and prints its run ledger; `usage --json` is suited to artifacts                                                                                                                                                                                                                                                                  | the CLI process                                                     | —                                                   | `--out`                                    | M102                                                                                                                                |
  | vscode.dev, github.dev with no remote compute                                                            | none yet                   | nothing recorded or shown, because the product does not run there (D60 phase G); the page arrives with whatever runtime phase G adds, through `httpHostBridge`                                                                                                                                                                                                          | —                                                                   | —                                                   | —                                          | with D60 phase G                                                                                                                    |
  - **The companion server.** It is a lazy `dist/usageCompanion.js` in the
    runtime.
    - It listens on `127.0.0.1` only, on a random port.
    - It checks a 256-bit token: carried in the URL fragment, then sent as a
      header. Every data request also checks `Host` and `Origin` against the
      listening address and port.
    - It sends no CORS headers, and stops after 30 idle minutes.
    - Its policy is `default-src 'none'; script-src 'self'; style-src 'self';
img-src 'self' data:; connect-src 'self'; frame-ancestors 'none'`. The
      only exception is the Jupyter origin in M65.
    - Export is a download. Reset needs the token plus a confirmation from an
      in-page dialog.
  - **Equivalence** means the same service and the same numbers in every
    surface. The text summary and the CLI output are the same aggregates,
    rendered as text. M64 and M65 accept their tabs only once they pass M102's
    harness through their own bridge.

<!-- plan-archive:end id="2-D82-01" -->

## D70 — Hooks from every popular agent (M91, 2026-10-04)

<!-- plan-archive:begin id="2-D70-01" lines="9747-9983" bytes="14143" sha256="1cc1a8e42d94c8072931eb54fb4adc1d1abd75504c6b81355c49203d165f5771" -->

The owner asked on 2026-10-04: "we should have all of the hooks from the most
popular [agents], no?". When the first draft left ten concepts out, he added:
"i dont really want to leave the hooks out can you find a safe and robust way
to add them all". The research is in `docs/certification/m91-research.md`
(the agents' own documentation, 39 hook concepts, three echo-provider runs).
The step 1 captures are in `docs/certification/m91.md`.

- **The safety principle.** Every hook is the user's own code in a separate
  process, behind M51's gates: a trusted workspace, the
  `museSpark.modelApiHooks` opt-in, a per-session snapshot, an allowlisted
  environment, size and time caps, and a process-tree kill.
  - A hook may observe, refuse, narrow or suggest.
  - Anything that widens goes through the approval or paid-consent path that
    already guards it, or is refused. That covers skipping a card, paying,
    sending data off the machine, and choosing a path, a model or a tool.
  - An imported hook is never weaker than in its source agent.
  - No hook gains power (as M51): none grants a permission, a model, a path
    or a paid use.
- **Muse Code's own file** (`.muse/hooks.json` and the settings `hooks`
  block) keeps Muse Code's 19 events: the documented 17, plus `Interrupt`
  (1.4.0) and `SessionFork` (in the 1.4.2 binary, which accepts it). The
  1.4.0 PostToolUseFailure `updatedInput` correction is supported. The
  step 1 captures (2026-10-04, 1.4.2-R4684.1, echo provider, 0 model calls)
  found:
  - **Interrupt fires whenever a running turn is cancelled:**
    - `turn/cancel`, during or before the model step;
    - `turn/interrupt`;
    - a UserPromptSubmit block, after which the turn ends `cancelled` with
      the hook's reason;
    - the host closing while a turn runs.

    It does not fire when an idle session closes. Its stdin is
    `hook_event_name`, `session_id`, `turn_id`, `cwd`, `transcript_path`
    (null), `model` and `permission_mode`. Stop and StopFailure do not fire
    on a cancelled turn.

  - **SessionFork is accepted but never run by 1.4.2.** No hook process
    started for any of these:
    - seven `session/fork` calls over `muse serve` on Linux, in every
      verdict mode;
    - seven TUI `/fork`s on Linux.

    On Windows `session/fork` is still refused (`forkBoundaryInvalid`,
    WriteFailed, sdk #31) before any hook. There is no payload to capture
    (AGENTS.md rule 13). So the Model API backend accepts it the same way and
    runs nothing, and the two backends agree. Its veto is wired in the release
    whose capture shows it running. Filed upstream as
    [meta-models/muse-code-sdk#84](https://github.com/meta-models/muse-code-sdk/issues/84).

  - **StopFailure did not fire under `muse serve`** on two turns that
    failed (`modelError`). This matches the 1.4.2 trace schema's
    "production-dark" note. The Model API backend keeps firing it, and the
    Hooks picker says so.
  - **PostToolBatch cannot be reached without a model.** The echo provider
    makes no tool calls. A user shell command (`session/userShell`) runs
    PreToolUse and then PostToolUse or PostToolUseFailure (`tool_name`
    `shell`), but no batch. M91's live check captures it.
- **Extension-only events live in `spark-hooks.json`**, which Muse Code
  never reads:
  - project: `.muse/spark-hooks.json`, under the protected `.muse`;
  - user: `<config>/muse/spark-hooks.json`, beside Muse Code's
    `settings.json`.

  The file has Muse Code's shape and is parsed by the same
  `parseHookConfig`, with the extension's event list.
  - **Names.** The names are Claude Code's, unprefixed: Claude's names are
    the de facto standard, and the file itself is the namespace. Where Claude
    has no such event, the source agent's name in PascalCase is used
    (`BeforeToolSelection`, `AfterAgentThought`, `Manual`).
  - **Why a separate file.** Muse Code warns about an unknown name on every
    CLI start (research run A). It would also change the name's meaning if
    it adopted the name later. So extension names never go in Muse Code's
    file.
  - **No hook runs twice.** A name that Muse Code runs is refused in
    spark-hooks.json with "configure it in .muse/hooks.json". `Setup` is the
    exception: Muse Code recognises it but refuses to run it, so it lives in
    spark-hooks.json.
  - **Adoption.** When Muse Code adopts one of these names, the event moves
    to `HOOK_EVENTS` in the release that verifies it.

- **Every concept is adopted** (the owner, 2026-10-04): 21 extension events
  (`EXTENSION_HOOK_EVENTS`).
  - **Eleven fire at operations the extension already has:**
    InstructionsLoaded, UserPromptExpansion, PermissionDenied,
    PreModelSwitch, PostModelSwitch, TaskCreated, TaskCompleted,
    FileChanged, ConfigChange, WorktreeCreate and WorktreeRemove.
  - **Ten more get their operation built or narrowed, so that they are
    real:**
    - **Setup** (Claude). Its operations are **Muse Spark: Run Setup Hooks**
      and the ACP agent's `--trust-workspace setup [--maintenance]`, which
      runs the Setup hooks and exits with no model call. The matcher is
      `init` or `maintenance`. Observation only.
      - Claude's `--init` and `--maintenance` flags do not go on headless
        `exec`: it refuses workspace trust (D65), so it runs no hooks at all.
    - **DirectoryAdded** (Claude; Cursor's workspaceOpen). It fires when a
      trusted workspace activates and when a folder is added to the window
      (`onDidChangeWorkspaceFolders`). Observation only.
    - **CwdChanged** (Claude). The Model API shell keeps its working
      directory between calls. This is new, in lane S:
      - The directory is confined to the workspace. A directory outside it,
        or one reached through a link out of it, resets to the root, and the
        model is told.
      - The tool row shows the directory.
      - CwdChanged fires on a real change. Observation only.
    - **Elicitation and ElicitationResult** (Claude). The Model API's MCP
      client answers `elicitation/create` with a form in the panel. This is
      new, in lane M; the ACP agent's form path is `src/acp/questions.ts`.
      - A project hook may only decline or cancel.
      - A user hook may answer, and its answer is validated against the
        server's schema.
      - ElicitationResult observes. A project hook sees the field names and
        the action, never what the user typed.
    - **TeammateIdle** (Claude). It fires when a Best-of-N attempt or a
      background subagent is about to stop while its siblings run.
      - A block sends its reason back and keeps that one working.
      - This stays inside the run the user already consented to, and counts
        toward `HOOK_MAX_STOP_CONTINUATIONS` and the session budget.
      - It never starts a new attempt.
    - **MessageDisplay** (Claude). A display-only rewrite of an assistant
      message.
      - It shows with an "edited by a hook" marker that the hook cannot
        remove, and a one-click way to see the original.
      - The model's history, copy, export and every approval card use the
        original.
    - **BeforeToolSelection** (Gemini). Narrow only, enforced at call
      admission (SoL-Pi rule 1 below). The declared tool list never changes.
    - **AfterAgentThought** (Cursor). It observes a finished reasoning
      block, bounded like PostLLMCall's previews and passed through the M54
      preview scrubber.
    - **Manual** (Kiro). Its operations are **Muse Spark: Run Hook…** and
      `/hook run <name>`. It runs only when the user starts it. Observation
      only; its output is shown.
- **Which backend runs them.**
  - Events at the Model API runtime's operations run on that backend only.
  - Setup, Manual, DirectoryAdded, ConfigChange, FileChanged and
    MessageDisplay are the extension's own operations. The extension runs
    them on both backends, under the same gates.
  - The Hooks picker says which backend runs each file.
- **Handler types.** `command` stays as it is today. Four more are added:
  - **`http`**, user scope only:
    - HTTPS only, and only to hosts in a machine-scoped allowlist setting,
      empty by default;
    - only while the network posture allows the network;
    - no redirects;
    - the same bounded payload and answer schema as a command;
    - no credential name expanded into a header.
  - **`mcp_tool`**: a tool on a configured MCP server, through that tool's
    own approval path.
  - **`prompt` and `agent`**, and Kiro's agent actions, which start a model
    turn:
    - On the Model API they are paid uses under D30 and D48: available by
      default (owner ruling 2026-10-04, FINM91H/m91h-prompt.md),
      priced, asked in the paid-use popup, tallied on their own usage line,
      and within the M82 budget.
    - On Muse Code each is one turn of a hidden side session on the user's
      subscription, as M90's reviewer runs, and its notice says so.
    - Their answer is parsed like a command's: it can only refuse, narrow or
      add context.
- **Other formats** (Gemini, Cursor, Copilot and VS Code, Windsurf, Kiro,
  Cline v1) import only into spark-hooks.json, with a `format` tag.
  - An in-process adapter translates their stdin and stdout.
  - Renaming the event alone would fail open: a foreign guard's answer does
    not validate, and a failed PreToolUse hook does not block.
  - Each adapter keeps its source's fail-closed rules and none of its
    grants.
- **Plugin systems.**
  - Amp's plugins and OpenCode's (its typed hooks and a subset of its event
    bus) run out of process: in a Node child, with a shim for the hook
    subset, and with the same environment and limits. They never run in the
    extension host.
  - The shim offers no shell helper, no client and no model access. A call
    to one fails that hook.
  - Cline's per-event scripts run as command hooks through a `cline`
    adapter: TaskStart, TaskResume, TaskCancel, TaskComplete, PreToolUse,
    PostToolUse, UserPromptSubmit and PreCompact.
  - This part may move to M91b if the bundle budget needs it.
- **Codex** shares Muse Code's format (rust-v0.160.0): 11 of its 12 events
  use Claude's names, matcher grammar and JSON, and the 12th is Muse Code's
  `Interrupt`. Its hooks convert into Muse Code's files. This corrects M83.
- **Cursor's Tab hooks** (`beforeTabFileRead`, `afterTabFileEdit`). They are
  imported, kept, and listed as waiting for inline completions. **Resolved
  2026-10-04 (owner): a Tab-completions milestone.** M94 builds inline
  completions (`feature/m94-tab`), and its lane K gives these two hooks
  their operation. Until it lands they run nothing.
- **The SoL-Pi rules.** The owner (2026-10-04): nothing in M91 may break the
  optimisations taken from NVIDIA's SoL-Pi (D49, M68, M73, M74, M75).
  1. **A cache-stable prefix.**
     - Hooks never change the bytes of an earlier request: its
       instructions, its tool list or its earlier messages. So the
       `prompt_cache_key` (D43) stays the same.
     - Hook context (SessionStart, UserPromptSubmit, PostToolUse
       `additionalContext` and the rest) is appended at the tail, in that
       turn's new messages, and is never re-inserted earlier.
     - BeforeToolSelection keeps the declared tool list byte-stable. A call
       to a tool it removed is refused at admission with a fixed reason, and
       a short tail note names the tools unavailable this turn.
  2. **ObservationPack (M73).**
     - A hook may replace a tool's output: an adapter's equivalent of
       Claude's `updatedMCPToolOutput` (Muse Code's schema has none). That
       replacement applies before packing. So the archived original is what
       the model saw, and `recall_output` returns those bytes.
     - The swap stays sticky: the prefix breaks once per output.
     - Hook stdin carries the bounded preview, never the archived original.
  3. **The Evidence-Preserving Reducer (M73)** is not a hook point. The
     `prompt` and `agent` handlers share its paid-consent rules and the hard
     budget, never bypass them, and are tallied separately.
  4. **Action Fusion (`then_run`, M68).**
     - Its command keeps the shell tool's path, hooks included.
     - Imported shell guards see it too: Cursor beforeShellExecution,
       Windsurf pre_run_command, Gemini run_shell_command, Kiro execute_bash.
     - `then_run` and `run_checks` run at the workspace root, as M68 built
       them. They neither read nor move the shell's kept directory, and fire
       no CwdChanged.
  5. **Online compaction (M74).** When M74's automatic compaction lands:
     - A PreCompact block may stop the optional, todo-triggered compaction.
     - A compaction at the window's hard limit still runs. The hook is told,
       and its block reason is logged, so no hook can overflow the window.
     - The hidden "restate your todo list" follow-up and the memory flush
       are not user prompts. UserPromptSubmit, UserPromptExpansion and the
       other prompt hooks never fire on them.
     - A TaskCompleted refusal comes before M74's compaction check, so a
       refused completion triggers nothing.
  6. **The M75 evaluation.**
     - It runs with hooks off, or records the hook set in its results, so
       token and capability numbers stay comparable.
     - The savings ledger shows the tokens that hooks add on a line of their
       own, "added by hooks", never netted against the savings.
  7. **Plain cost.** With hooks off, a conversation's request bytes and tool
     list are identical to main's before M91. A golden request comparison
     against a fixture recorded before M91's changes proves it. The kept
     shell directory adds bytes only to a result whose directory is not the
     workspace root.
- **Other agents' configuration folders become protected writes:**
  `.claude`, `.codex`, `.cursor`, `.gemini`, `.github/hooks`,
  `.github/copilot`, `.devin`, `.windsurf`, `.kiro` and `.clinerules`. They
  hold hooks and MCP servers that those agents run outside our sandbox. This
  ships early as its own fix (`fix/protect-agent-folders`, 2026-10-04).

<!-- plan-archive:end id="2-D70-01" -->

## D72 — Report a problem, without recording the conversation (M93, 2026-10-04)

<!-- plan-archive:begin id="2-D72-01" lines="9987-10081" bytes="7224" sha256="f4e32215ef50aa2c62a563a627551f67b5e438a052f045b1912bc056992d7647" -->

The owner approved a local, crash-safe support workflow on 2026-10-04:
someone can report a failure after a crash, Reload Window or a new chat,
without giving the extension access to their GitHub account or recording
their prompts, code or model output. **Implemented in M93 (2026-10-05):**
`docs/certification/m93.md` records what shipped, where it differs from the
bullets below (as noted inline), and the receipts still open.
Research and the engine-floor source check: `docs/certification/m93-research.md`.
D70, D71 and D73 remain reserved for the other planning branches.

- **A flight recorder, not a log attachment.** A versioned, bounded journal
  under `ExtensionContext.globalStorageUri`, never Settings Sync or workspace
  storage; 7 days and 256 KiB, oldest entries removed first. Prune at startup,
  append and report read; a closed editor cannot expire files until next use.
  Record errors, backend exits, failed tool calls, webview `window.onerror` and
  `unhandledrejection` (scrubbed, schema-validated posts to the host), React
  boundary failures, and activation failures once the recorder
  can start. Record each event as it happens, without relying on deactivate.
  An incomplete final record after a crash is discarded; valid earlier records
  survive. Disk failures leave the extension usable and the report states that
  recording was unavailable, without recursively recording its own failure.
  Confine journal/marker reads and writes to owned storage; refuse links or
  unexpected file types that could redirect them to another file.
- **Scrub before writing.** A strict zod allowlist accepts only fixed event
  kinds, known error codes (unknown codes become a fixed word), extension/host
  versions, a retention timestamp, and bounded frames inside the installed
  extension. Frames contain verified package-relative paths and line/column
  numbers, never the stack's message, absolute roots, outside frames or arbitrary
  function names. Reject traversal, URLs and unknown entry fields. No prompts,
  code, file contents, model output, tool arguments/results, command text,
  conversation/session ids, credentials or raw MSP/stderr/error messages enter
  the file. Run every `redactSecrets` pattern too; regexes alone are insufficient.
- **Unclean shutdown is a hint.** Set an activation marker before normal
  startup and clear only this activation's marker on deactivate. On next
  activation, consume a stale marker before offering once: “Muse Spark Code
  stopped unexpectedly last time — report it?” Dismissal is remembered across
  reloads. A new abnormal exit can produce a new offer. Window ownership must
  keep a second live window from being reported as a crash; any local ownership
  metadata stays out of reports. Never promise to distinguish a crash from a
  forced exit, or capture a failure before the extension's entry point runs.
- **Build from facts.** Reuse D14's `SupportFacts`/`renderSupportReport`, not
  the log channel. Revalidate support-field values against fixed vocabularies;
  CLI install paths and failure reasons are not inherently safe. Add the last
  50 valid entries by default, a bounded stack and relative ages. These limits,
  the entry-size bound and URL limit are named tunables in `constants.ts`, not
  new settings. Gather facts locally without starting a session, authenticating,
  inspecting credential values or running workspace commands.
- **Scrub again before export.** Replace workspace roots with `<workspace>`
  before replacing home with `~`; remove other absolute user paths, user/machine
  names, emails, IPv4/IPv6 addresses, URL credentials, queries and fragments.
  Apply every `redact.ts` secret pattern to the entire final draft, including
  title and user description. Validate stored entries again; a tampered journal
  cannot become an arbitrary text attachment. No existing log file is read.
- **The exact draft comes first.** A labelled description field, section
  switches for support facts/recent events, and a read-only preview of the final
  scrubbed text. Changes rebuild the preview; actions use that same immutable
  draft. Cancel leaves without exporting. Explain that a user-written description
  can still disclose confidential information; no description is kept in the
  recorder. Keyboard operation, focus return, screen-reader labels, narrow-panel
  layout, long-line wrapping and the four VS Code themes are acceptance gates.
- **User-controlled export.** Open on GitHub opens only this repository's
  HTTPS new-issue page in the user's browser/account, with encoded title/body.
  Measure the full encoded URL against a conservative named 2,000-character
  limit. Above it, copy the same draft, then open the unfilled page with a paste
  instruction; a failed clipboard write must not pretend the draft was copied.
  Copy and Save as file are independent choices; save uses the user's picker.
  No token, automatic submission, upload, extension network call or model call.
  Opening a browser deliberately hands the draft to GitHub; clipboard history,
  saved files and browser history are outside the recorder's retention.
- **Built-in reporter, with a separate boundary.** VS Code 1.99 supports
  `workbench.action.openIssueReporter` prefill (`extensionId`, `issueTitle`,
  `issueBody`; `data` is forwarded but absent from the documented option schema).
  Use the supported body/title fields for an explicitly chosen “VS Code issue
  reporter” action after our preview. Disclose that VS Code adds its own data,
  may search GitHub, and controls sign-in/submission; its output is not our
  exact-only export. Keep the browser/Copy/Save paths available. No private
  inclusion flags, extension token access, telemetry setting changes or fallback
  that silently opens a different reporter. Missing/disabled commands show the
  normal export choices. Engine-floor and current-host receipts remain required.
- **Every entry point reaches the same workflow.** A contributed command
  `museSpark.reportProblem`; the palette's Support item replaces its bare link;
  “Report this” on error notices, transcript error rows and the render-failure
  fallback. Only a sanitized event reference is handed off, never the row text.
  After reload/new chat the command reads the journal independently of history.
  A standalone `muse-spark-code-acp report` prints the same scrubbed report to
  stdout, with no backend started, sign-in, editor required or browser opened.
  Its recorder uses the runtime's local data directory and the same policy.
  Report mode only reads retained records; it does not create an activation
  marker or consume the editor's crash offer. ACP protocol mode never writes
  report text to stdout; it remains ACP frames.
- **SoL-Pi is untouched.** Reporting observes sanitized failures after they
  occur; it never changes requests, tool declarations, admission, outputs,
  ObservationPack/archive/sticky swaps, history, paid consent/budgets, guarded
  `then_run`, todo compaction, hidden turns or M75 evaluation. No paid call is
  added. Golden request bytes must match with recording on/off and after a
  report; existing M68/M73/M74/M75 guards must still fail when deliberately broken.

<!-- plan-archive:end id="2-D72-01" -->

## D79 — What's New after an update (M99, 2026-10-04)

<!-- plan-archive:begin id="2-D79-01" lines="10085-10258" bytes="11990" sha256="ba4be706432d43028617afa0181e64d46029eae144698b9f67a55ffb755669ad" -->

The owner asked (2026-10-04): "after the app updates it opens a whats new/
changelog in whatever editor so the users can take advantage of any changes
we make". His standing ruling: enhancements are on by default.

- **When it shows.** On activation the running version is compared, by
  semver precedence (prereleases included), with the newest version What's
  New ran for (`globalState` key `museSpark.whatsNewLastSeenVersion`,
  registered with `setKeysForSync`, so a page seen on one machine is not
  shown again on another).
  - No stored version and no sign of earlier use: a fresh install. The
    version is recorded and nothing shows; the walkthrough and onboarding
    cover new users.
  - No stored version but signs of earlier use (any stored global key, a
    remembered last session in the workspace, or the extension's global
    storage folder, all read before activation writes anything): an upgrade
    from a version before this feature. Without this, everyone updating to
    the release that brings What's New would be taken for a new user and
    never see it. Its page starts at the newest release with Highlights.
  - A newer version: an upgrade, shown once. The same version or an older one
    (a downgrade): nothing, and the newer record stays, so going back up shows
    nothing again.
  - It shows on the extension's first activation after the update (its view,
    a command, a restored tab). The manifest gains no `onStartupFinished`:
    activating the 550 KiB bundle in every window to announce an update is not
    worth the startup cost.
- **One window.** Several windows activate together after an update. The
  window whose exclusive create (`open(…, 'wx')`) of
  `<global storage>/whats-new/<version>.claim` succeeds shows it; the others
  see the file and stay quiet. Chosen over a claim in `globalState` re-read
  after a delay: the file system's exclusive create is atomic on one machine,
  while `globalState`'s propagation between windows has no ordering guarantee
  (two windows can each read the other's claim last, and neither shows it).
  A claim that cannot be written (read-only storage) lets that window show
  it, logged: a second tab is better than none. Keep the zero-byte claims of
  other versions: an older window must not delete a newer window's claim
  (nor a newer one delete an older window's still-active claim), allowing
  another activation to show that version a second time.
- **When in the window.** Some seconds after activation
  (`WHATS_NEW_SETTLE_MS`), and then only while no conversation runs a turn
  and no document was edited for `WHATS_NEW_QUIET_MS` (checked every
  `WHATS_NEW_IDLE_POLL_MS`). The tab opens with `preserveFocus`, so the
  keyboard stays where it was. A pending notification's answer is ignored
  after disposal, so it cannot reopen a tab or write settings in that window.
- **Page or notice (the rule).** An update whose releases (every one after
  the version updated from, up to the running one) include one with a
  `### Highlights` list opens the page. Otherwise (a patch of fixes only) a
  quiet notification, "Muse Spark Code updated to x.y.z", offers **What's
  New** (the page for those releases) and **Don't show again** (the setting
  off). The choice is by content, not by version arithmetic; the changelog
  guard below makes every minor or major release carry Highlights.
- **What it shows.** A webview editor tab, "What's New in Muse Spark Code":
  every fork the compatibility docs list has webviews, where
  `markdown.showPreview` is not universal. For each release, newest first:
  its Highlights (each may carry a **Try it** button) and then its shipped notes.
  The footer links the full CHANGELOG and the README on GitHub and carries a
  **Don't show on updates** box bound to the setting.
- **Try it.** A Highlight ends with `<!-- try: command <id> -->` or
  `<!-- try: setting <id> -->` (an HTML comment: invisible on GitHub, the
  Marketplace and VS Code's changelog tab). The build fails on an id the
  manifest does not contribute, in `[Unreleased]` too (so the change that
  adds one fails, not the release); the page renders a button only for a
  command in `COMMAND_IDS` or a setting in `SETTING_DEFAULTS`. The page sends
  an index into the host's list of the buttons it rendered, never an id, so
  nothing else can run. (A second check at click time was dropped in review:
  that list holds only allowed entries, so it could never fire, and its red
  drill proved it.)
- **Content.** Built at build time from CHANGELOG.md
  (`scripts/lib/whatsNewContent.mjs`, mdast with GFM) into
  `dist/whatsNew.json`: released sections only (`[Unreleased]` never), as a
  tree of text-only parts read through a zod schema before use. Raw HTML never
  becomes markup (comments are dropped, other tags kept as their literal
  text); pictures are their alt text; relative links point at the repository;
  links with a scheme other than http or https are kept as text. The build
  validates every release and `[Unreleased]`, but ships full notes for only
  the newest two releases (`FULL_NOTES_RELEASES`, build-time constant in the
  generator). Eight releases measured 177,802 bytes; two cover the current
  release and its immediate predecessor within a hard 40 KiB raw content
  budget. If neither has Highlights, retain the newest earlier Highlights
  with its notes omitted. Older upgrades still have those Highlights and
  the full-changelog link; older details live at that link. The size gate
  rejects both missing content and content one byte over the budget.
  WNBUDGET round 4 (RVWNBUDGET, RVWNBUDGET2, RVWNBUDGET3,
  2026-10-09; no cap raise): replace provisional admission with exhaustive
  final-plan selection. Consider the newest and its full-notes window
  (`FULL_NOTES_RELEASES` is two releases total), plus the standing newest
  earlier Highlights fallback when the retained window has no Highlights
  (at most three releases). The newest is always full; each predecessor
  has full, Highlights + full-notes link, and omitted forms. The standing
  fallback has only Highlights + link and omitted forms: its full notes
  remain outside the window. Enumerate all complete plans (at most 27),
  build each exact JSON envelope with `shortened` present only if a window
  release is reduced/omitted or the needed fallback is omitted, and admit
  it only within the decoded bound and through the real artifact encoder.
  Choose lexicographically, newest release first: full, then Highlights +
  link, then omitted; repeat that order for the next release. Retaining the
  standing fallback alone does not set `shortened`. If no plan fits, refuse naming the newest,
  required bytes and bound (or its artifact-encoding failure); never hide
  the newest or return an envelope the encoder will reject. The page says
  "Earlier notes: see the full changelog" when shortened; the packaged
  changelog ships the same plan, including link-only patch releases.
  One heading contract: release headings are ATX
  `## [version] - YYYY-MM-DD`, LF or CRLF terminated. Markdown's one to
  three leading spaces are accepted; four-space indented and fenced lines
  remain code, never release headings. Refuse lone CR line endings and
  Setext release headings with named errors; refuse other release-heading
  spellings and unterminated release headings. The parser returns whole
  section, heading and body spans, plus Highlights and Unreleased spans,
  as non-enumerable metadata that never enters JSON. Packaging slices those
  spans only; it has no heading regex or newline search. Exhaustive small
  random-size oracle, all three reviews' regressions and byte-exact red
  drills are recorded in `docs/certification/wnbudget.md`.
  WNBUDGET round 5 (RVWNBUDGET4G, 2026-10-09): the encoder reports
  decoded or encoded size overflow as a typed result; only that result
  permits trying a smaller plan. Any other encoder or schema error stops
  selection, naming the candidate releases and preserving the cause,
  without asking to trim notes. Normalize HTTP/HTTPS schemes to lowercase
  while preserving the rest of each URL, matching the artifact schema.
  Regress uppercase HTTPS in newest and predecessor Highlights, invalid
  candidate content, and real encoded overflow; prove guards with byte-exact
  restoration drills and rerun the owned suites and scoped gates.
  The duplication gate found a pre-existing repeated fallback-link fixture
  in the owning content tests; share that expected value, keeping both
  complete assertions and the gate unchanged.
  WNBUDGET round 6 (RVWNBUDGET5G, 2026-10-09): route generated
  predecessor/fallback full-notes URLs through the same `resolveHref`
  rule as Markdown links. Resolve and validate the repository-derived URL
  before trying any selection plan; a refused repository fails with a
  named repository error, even when the full plan could encode. Packaging
  uses that same resolved full-notes URL. Regress uppercase HTTP/HTTPS
  repository schemes and unsupported repositories, including validation
  before encoding; certify byte-exact drills and the owned scoped gates
  in `docs/certification/wnbudget.md`.
- **Security.** Strict CSP (`default-src 'none'`, the stylesheet from the
  webview origin, one script by nonce, no inline style); every piece of text
  escaped on the host; links carry their address for keyboards and screen
  readers, but the page sends their index and the host opens its own copy
  through `vscode.env.openExternal`.
- **Setting and command.** `museSpark.showWhatsNewOnUpdate` (boolean,
  default `true`, machine-scoped: the manifest test allows only machine or
  window scope, and a page that opens by itself is the user's choice, never a
  repository's). **Muse Spark: What's New** opens the current version's page
  at any time (back to the newest release with Highlights), and the panel's
  palette lists it under Support.
- **Light.** The renderer, schema and tab are `dist/whatsNew.js` (D6, ≤ 50
  KiB), required on the first page or notice; the page script is
  `dist/webview/whatsNew.js` (≤ 25 KiB) with no package and no display
  table. Activation carries only the version check, the claim and the loader.
- **Language.** The page's own words are in all 14 tables; the release notes
  stay English (CHANGELOG.md is written in English), marked `lang="en"`, and
  a line says so in other languages.
- **Release process.** A minor or major release's CHANGELOG section must
  carry `### Highlights` with 1 to 5 bullets (3 to 5 recommended), and no
  release being made may have more than 5; the changelog-version test fails
  otherwise (`docs/RELEASING.md`). Older releases are taken as written
  (0.10.0 has ten).

**STAR — a quiet GitHub star line (owner, 2026-10-05).** Use the same
sentence, "Enjoying Muse Spark Code? A star on GitHub helps other people
find it.", linked to `https://github.com/RandyNorthrup/muse-spark-code`,
near the top of the GitHub, npm and packaged Marketplace/Open VSX READMEs, in
the What's New footer, and in the Getting Started welcome markdown and
step description. Translate the footer and manifest description in all
14 languages. Reuse `PageWriter.link` and the host's indexed
`openExternal` handler, with escaped display text and unchanged CSP.
**No prompts, no panel line:** Marketplace users can discover the
repository without interrupting work or growing the crowded chat bundle.
Activation gains no imports or bytes. Acceptance: the staged and actual
VSIX README retain the line; the footer renders escaped, translated text
and opens only its indexed repository URL; the welcome step retains its
existing guidance; localization, manifest, scoped tests and bundle caps
pass. Remove the packaged README line and footer separately to prove the
tests fail, restore byte-exact, then rerun. Lane checks replace full quality
only for this handoff; the release lead owns full quality after integration.
Evidence: `docs/certification/star-line.md`.

<!-- plan-archive:end id="2-D79-01" -->

## D73 — Inline completions (Tab), billed to the Model API key (M94, 2026-10-04)

<!-- plan-archive:begin id="2-D73-01" lines="10729-10821" bytes="5898" sha256="41b731f7f867f5eec1f8540a873f66557f35de4eee9ff9e55d8c993fd2467f8d" -->

- **Never the conversation's cache or history (SoL-Pi, M68/M73–M75).**
  - A Tab request never carries, reads or changes a session's input, history,
    goal or memory.
  - It has its own `prompt_cache_key`: `TAB_PROMPT_CACHE_KEY_PREFIX` plus a
    digest of the model and the Tab instructions, never a chat key (A7).
  - The request is ordered for prefix caching: instructions, context snippets
    (sorted by path), the file header, then the prefix window, the marker and
    the suffix. The prefix window starts on a line that is a multiple of
    `TAB_PREFIX_ANCHOR_LINES`, so its start stays put while the user types
    and consecutive requests share a cached prefix (A6, A7).
- **Two modes.**
  - **Fast** (automatic triggers, the default): the current file only,
    `TAB_FAST_PREFIX_CHARS` before and `TAB_FAST_SUFFIX_CHARS` after the
    cursor. It completes the rest of the line, or at most
    `TAB_FAST_MAX_LINES` lines.
  - **Multi-line**: used when the cursor's line is blank, or ends in a block
    opener with nothing after the cursor, and `museSpark.tabMultiline` is
    `auto`; and on every explicit Invoke (VS Code's
    `editor.action.inlineSuggest.trigger`). It adds context snippets:
    - the user's recent edits in other eligible files;
    - the definitions of identifiers on the cursor's line, found through
      code intelligence (`src/core/codeIntel/definitions.ts`).

    The snippets are bounded by `TAB_CONTEXT_CHARS`, and a completion by
    `TAB_MULTILINE_MAX_LINES` lines.

  - `museSpark.tabMultiline` is `auto` (default), `onInvoke` or `never`.
  - **Planned values** (lane 0 sets them; the probe may retune those marked
    \*). These are what research §7's estimate assumes:

    | Constant                                                             | Value          |
    | -------------------------------------------------------------------- | -------------- |
    | `TAB_FAST_PREFIX_CHARS` / `TAB_FAST_SUFFIX_CHARS`                    | 6,000 / 1,600  |
    | `TAB_MULTILINE_PREFIX_CHARS` / `TAB_MULTILINE_SUFFIX_CHARS`          | 12,000 / 3,200 |
    | `TAB_CONTEXT_CHARS`                                                  | 8,000          |
    | `TAB_PREFIX_ANCHOR_LINES`                                            | 32             |
    | `TAB_FAST_MAX_LINES` / `TAB_MULTILINE_MAX_LINES`                     | 3 / 16         |
    | `TAB_MAX_COMPLETION_CHARS`                                           | 2,000          |
    | `TAB_DEBOUNCE_MS`\*                                                  | 350            |
    | `TAB_FAST_MAX_OUTPUT_TOKENS`\* / `TAB_MULTILINE_MAX_OUTPUT_TOKENS`\* | 128 / 512      |
    | `TAB_CACHE_ENTRIES` / `TAB_HOOK_VERDICT_CACHE`                       | 64 / 128       |

  - VS Code's core gives `editor.action.inlineSuggest.trigger` no key here
    (research §3, UNKNOWN). M94 binds Alt+\ to it while Tab is on (the
    `museSpark.tabOn` context key). That is the key the description of
    Copilot's `github.copilot.enable` names for triggering by hand. M94 adds
    no trigger command of its own.
- **Debounce; a sent request is never aborted.**
  - VS Code's own delay is effectively 0 to 50 ms (V14), so Tab waits
    `TAB_DEBOUNCE_MS` (350, retuned once from the probe) on the token after an
    Automatic trigger. A keystroke cancels the token (V15), and then nothing is
    sent. Invoke skips the wait.
  - `museSpark.tabTrigger` is `automatic` or `onInvoke`. Its default comes
    from M94's latency probe: `onInvoke` if a fast suggestion's median first
    text is slower than `TAB_AUTOMATIC_LATENCY_CEILING_MS` (1,500 ms).
  - Once a request is sent it runs to its end, even when the token is
    cancelled. Meta does not say what an abandoned `store: false` stream bills,
    and an aborted stream reports no usage (A10). Letting it finish keeps the
    ledger exact. Its answer goes to the cache.
  - At most `TAB_MAX_IN_FLIGHT` requests (2) are open at once, and at most
    `TAB_MAX_REQUESTS_PER_MINUTE` (20) start per window, below the contributor
    tier's 100 RPM team limit (A8). A trigger that finds no slot waits; a newer
    trigger replaces a waiting one, unsent.
- **The typing-through cache** (Continue's design, research §4).
  - The window keeps an LRU of `TAB_CACHE_ENTRIES` entries. Each holds the
    document, the prefix it answered, its suffix and the completion.
  - A lookup takes the entry with the longest prefix that the current prefix
    starts with and the same suffix. It serves the rest of the completion
    only if the text typed since that prefix is the start of the completion.
    No request is sent.
  - The same key is used to read and to write: the document's raw prefix, not
    the compiled request. Research §4 notes a read/write key mismatch in
    Continue.
  - A trigger whose prefix extends an open request's prefix, matching what
    that request has streamed so far, waits for it instead of sending another
    (Continue, Zed).
- **Filters** (from Continue's, research §4).
  - **Before anything else:** a code fence or a lead-in sentence around the
    tags is stripped.
  - **No suggestion** when the reply:
    - is empty, whitespace, or outside the tags;
    - only repeats the start of the suffix (the overlap is trimmed first),
      the line above, or the next non-blank line below;
    - holds a run of three identical lines;
    - closes brackets it never opened (fast mode);
    - holds a secret (`countSecretMatches`) or the redactor's mark.
  - **Cuts:** a multi-line reply ends at its first blank line after the first
    line. A reply longer than its mode allows is cut at a line boundary, then
    at `TAB_MAX_COMPLETION_CHARS`.

  "Repeats" means equal after trimming whitespace. While the suggest widget
  has a selection, Tab returns nothing (V2). On Invoke it returns one item
  (A2). Sampling stays at Meta's tuned defaults (A11).

<!-- plan-archive:end id="2-D73-01" -->

## D77 — Muse Judge: a calibrated System One judge for any agent (M98, 2026-10-04)

<!-- plan-archive:begin id="2-D77-01" lines="11205-11787" bytes="35296" sha256="c719ea0f35136b5e7761cd46bdcadc2fc469d6c4927c5e8b364fa0a5988009dd" -->

The owner asked whether we can design our own version of TypeSafe's Jev "to
use with any agent", and approved the proposal with "yes". He then added:
"we should add the optin to use the judge engine with a local model as well".
He also pointed at jevlint, a rule linter built on Jev. **Planned; this lane
writes documentation only.** D70–D76 and M91–M97 belong to other drafts; their
absence here does not release those numbers. Research, with the probe table
and sources: `docs/certification/m98-research.md`.

**What the probe found** (2026-10-04). Two rounds: 41 live model-call
attempts, 29 completed, ≈ $0.015. Free local runs on the Kubuntu CPU and the
Win11 GPU:

- **The Jev wire is now a standard, and Jev is reachable without a sales
  call.** OpenRouter serves `typesafe/jev-1.13` at
  `POST /api/v1/systemone`, with TypeSafe's request and response shapes byte
  for byte ($0.042 per million input tokens). Ollama 0.35 serves
  `/v1/systemone` on loopback for local decision models: `tev1` (Together
  AI), `nimble` (Bespoke Labs), and `clef`/`clef-flash` (Cloudflare). Cloudflare
  Workers AI serves Clef in the same shape.
- **Token log-probabilities exist on about half the providers.**
  - A top-5 comes back from Together, Fireworks, DeepSeek, OpenRouter (with
    `provider.require_parameters`), Hugging Face (with a provider that passes
    them) and Ollama.
  - OpenAI's `gpt-5.6-luna` returns the chosen token only, on both wires.
  - xAI and Z.ai accept the parameter and drop it silently.
  - Anthropic, Muse Spark, current Gemini models, Mistral and Groq refuse
    it. Muse Spark is a reasoning model with no `none` effort.
- **Local works on CPU, and a GPU makes it about 10× faster with the same
  answers.** On a 40-item labelled destructive-command set (Kubuntu CPU;
  Win11 VM, GTX 1080 Ti):

  | Engine                                          | Accuracy | Brier | Warm latency                 |
  | ----------------------------------------------- | -------: | ----: | ---------------------------- |
  | `tev1:4b` (Ollama, GPU)                         |    0.975 | 0.031 | 0.30 s per state             |
  | `tev1:4b` (Ollama, CPU)                         |    0.975 | 0.030 | 3.1 s per state              |
  | Jev 1.13 (OpenRouter)                           |    0.975 | 0.023 | 2.1 s for all 40 in one call |
  | `qwen3:4b-instruct-2507` logprobs (Ollama, GPU) |    0.925 | 0.071 | 0.10 s                       |
  | `llama3.2:3b` logprobs (Ollama, GPU)            |    0.925 | 0.066 | 0.06 s                       |
  | `tev1:0.8b` (Ollama, CPU)                       |    0.750 | 0.176 | 0.67 s                       |
  | `qwen3:1.7b` logprobs (Ollama, GPU)             |    0.550 | 0.433 | 0.05 s                       |
  | `llama3.2:1b` logprobs (Ollama, CPU)            |    0.475 | 0.278 | 0.26 s                       |

  General models of 2B and below answered "no" to nearly everything; at 3–4B
  they reach 0.925, with confident errors. `tev1:4b` stays the recommended
  default on both CPU and GPU: it is the most accurate and best calibrated,
  and its one miss sat near 0.5.

- **Confidence and scores do not transfer between engines.** Jev's
  confidence formula differs from Ollama's `1 − H/ln N`. Jev and `tev1:4b`
  scored the same command 3.09 and 2.16.
- **Models without logprobs can still judge, and well** (round 2, 40
  judgments batched per call):
  - Stated confidence from the user's own model scored Brier 0.0025 on Muse
    Spark, 0.0075 on Haiku 4.5 and 0.0074 on DeepSeek. DeepSeek's own
    logprobs scored 0.000 on the same items. These are smoke measurements on
    one easy 40-item set, not calibration or superiority results.
  - The cascade and contrastive numbers are offline prototypes. They used a
    `|2p − 1|` gate rather than the planned entropy confidence (17
    follow-ups at 0.8, against 28 under entropy, and all 40 under the
    high-stakes rule for this family), equal raw logit weights rather than
    fitted ones, and two separate calls for "contrastive".
  - A side request that shares the main thread's cached prefix read all
    4,357 cached tokens on Haiku 4.5, at about a tenth of the uncached cost.
  - Binary-from-top-1 matched top-5 on one local model's 40 prompts. That
    is evidence for those prompts only, and D77 adds a probability floor.
  - Muse Spark refuses logprobs while reasoning, and its `none` effort is
    refused: upstream request
    [meta-models/meta-model-cookbook#57](https://github.com/meta-models/meta-model-cookbook/issues/57).

**The ruling of D50 carries over unchanged.** A judge only assists:

- it feeds hints, scores and relevance signals;
- the Muse model, or the extension's deterministic rules, act on them;
- it never answers the user, writes code, allows an action, skips a
  question or skips a rule;
- a missing or unsure answer leaves behaviour exactly as it is without a
  judge.

Decisions:

- **Policy of record.** The owner ruled three times on 2026-10-04, and the
  later ruling wins wherever they differ:
  1. Enhancements are on out of the box with whatever setup the user has.
     Paid extras ask once before the first charge, showing the price and a
     daily budget. Free local engines turn on by themselves when present.
     Downloads need consent. (D78)
  2. "i meant with just the model not with a different one": the judge works
     with the user's own chat model, and never switches models.
  3. "i want both if we can": a separate judge model is a first-class choice
     too.

  This supersedes three earlier drafts:
  - this decision's first draft (off by default, a separate opt-in for
    local);
  - `cf9e1abf`'s three-branch `auto` (local, then a paid provider, then
    nothing), with its rules that a top-1 provider is unusable, that
    sampling is never automatic, and that confidential workspaces are
    local-only;
  - `c5ccea5a`'s phase split.

  Where any earlier sentence disagrees with this section, this section
  holds. The review of 2026-10-04 (RVM98) checked the text against this
  policy, and the lead accepted its narrower first slice. Its re-review
  (RVM98C) was the third round, which under the owner's rule means a
  redesign. **Phase 1 is now the same-model judge only.** The local judge
  became section 2j, with a design spike that must answer RVM98C's C1 and
  C2.

- **One contract, the Jev wire.** `judge({state, questions})` returns
  `{model, answers, usage}`, in exactly TypeSafe's and Ollama's shapes:
  - a `noul` gives p(yes);
  - a `choice` gives the option, its probabilities and a confidence;
  - a `score` gives the expected level, the legend, the probabilities and a
    confidence.

  The schemas are zod, bounded at the intersection of the services:
  - 1–64 questions; choice 2–26 options; score 2–10 levels; a 64 KiB body;
  - state plus the longest question within 32k tokens, as a ceiling only.
    Each source's real limit is its loaded context window, read by the
    health check (see "State size").

  A question id is never sent to a model (as Jev). Our additions ride in a
  sibling `muse` object, so `answers` stays byte-compatible with any
  SystemOne client:
  - the source (`same` in phase 1; `separate` and `both` in phase 2), the
    technique, and the model that answered;
  - the label: "calibrated (logprob)", "calibrated (stated)",
    "uncalibrated" or "approximate (top-1)";
  - our `confidence`, always `1 − H(p)/ln N` and computed by us; the
    backend's own value is kept as `vendorConfidence`, never mixed with
    ours;
  - `partial` when fewer distinct semantic alternatives were seen than there
    are options (case and leading-space variants count as one);
  - the reserved and the settled cost.

  The code lives in pure `src/core/judge/**`, with no `vscode` import.

- **Two sources.**
  - **Same model.** The user's own chat model, through the backend and
    endpoint the conversation already uses, with the best technique that
    model offers. It never switches to another model.
  - **Separate judge** (phase 2: 2c, 2e and 2j). A model chosen for
    judging:
    - a local decision model (2j, after its spike; `tev1:4b`
      recommended);
    - a local general model of at least 3B, through logprobs (2j);
    - a SystemOne service (Jev through OpenRouter, TypeSafe direct, Cloudflare
      Clef);
    - another configured provider model (D74).
- **Same-model techniques.** Each is chosen per model from that model's
  captured capability record (rule 13), never per provider.
  1. **Logprobs, top-k.**
     - **Answer tokens:** `yes`/`no`, an option letter `A`–`Z` (one per
       option, matching the 26-option bound), or a level digit `0`–`9`.
     - **p:** the renormalized mass of the distinct answer tokens among the
       top-k. The residual mass and the unseen options are recorded.
     - **`partial`:** when fewer distinct options were seen than offered,
       always so above the model's top-k (at most 20 on OpenAI-shaped wires).
     - **Reasoning switch:** the capture records the setting that frees the
       first token (OpenAI and Fireworks effort `none`, DeepSeek
       `thinking.disabled`).
     - **A missing field** (xAI, Z.ai) is an engine failure, never read as
       certainty.
  2. **Binary from top-1, with a floor.** Valid only for a noul, and only
     when the top-1 token is a yes or no variant and its probability is at
     least `JUDGE_TOP1_MIN_PROB`.
     - **The value:** p for "yes", or 1 − p for "no". It is labelled
       "approximate (top-1)", because the residual 1 − p is attributed to the
       other answer although it may hold other tokens. The floor bounds that
       error at 1 − `JUDGE_TOP1_MIN_PROB`.
     - **Otherwise** the answer is `partial`, and the question falls back to
       stated confidence.
     - **The counterexample from RVM98:** P(no) = 0.60, P(yes) = 0.10, others
       0.30. The complement gives 0.40 where the two-answer renormalization
       gives 0.143. A top-1 of 0.60 is under the floor, so it falls back.
     - **Never a full distribution:** a top-1 estimate is excluded from
       choice, score and calibrated uses.
     - **The evidence:** on `qwen3:4b-instruct-2507`'s 40 probe prompts, the
       top-1 value equalled the top-5 value. That is evidence for those
       prompts, not a general result.
  3. **Stated confidence.** One structured call (a JSON schema, a forced
     tool, or JSON mode) returns `{answer, confidence 0–100}` for a noul, or a
     100-point distribution for a choice or score.
     - It is labelled "uncalibrated" until a profile exists (phase 2b).
     - It works on every model, including Anthropic, Gemini, Mistral, Groq,
       xAI, Z.ai and Muse Spark.
     - The smoke measurement (40 judgments per call, one easy set):

       | Model         | Brier  |
       | ------------- | ------ |
       | Muse Spark    | 0.0025 |
       | DeepSeek      | 0.0074 |
       | Haiku 4.5     | 0.0075 |
       | Llama-3.3-70B | 0.018  |

       DeepSeek's own logprobs gave 0.000 on the same items. They are a
       reference, not ground truth.

     - A 4B local model answered only 0 or 100, so small models use
       logprobs instead.
  4. **Contrastive framing** (phase 2d). The question and its inverse go in
     one call, combined as the mean of p and 1 − p′, for high-stakes
     families. The prototype used two separate calls (DeepSeek: Brier 0.0074
     → 0.0039). The one-call form is unmeasured.
  5. **Self-consistency sampling** (phase 2d). k parallel samples,
     `max_tokens` 1 or the provider's minimum, over a cached shared prefix,
     combined by agreement.
     - **When:** only under the cost gate (cache-capable, non-reasoning, and
       a worst-case uncached cost per question under
       `JUDGE_SAMPLING_MAX_USD_PER_QUESTION`) or for a high-stakes question.
     - **Never** on a reasoning-forced model (Muse Spark: 8.8 s per sample).
     - **Cost basis:** a cold state costs one cache write and k reads over
       two round-trips. Admission always reserves the uncached worst case.

  **Not taken:** uncalibrated verbalized probabilities presented as
  calibrated; calls conditioned on one another.

- **The engine per provider and model.** From the captures. A model that is
  not captured gets stated confidence until it is.

  | Provider / model                          | Logprobs                     | Same-model technique                                           | Also as a separate judge                   |
  | ----------------------------------------- | ---------------------------- | -------------------------------------------------------------- | ------------------------------------------ |
  | Meta Muse Spark (Model API)               | refused (reasoning)          | stated, batched, in the background; never blocks               | —                                          |
  | Muse Code (subscription)                  | none over MSP                | stated, through a hidden side session (as M90)                 | —                                          |
  | OpenAI `gpt-5.6-luna`                     | top-1                        | top-1 for nouls above the floor; otherwise stated              | yes                                        |
  | OpenAI `gpt-4o-mini` (through OpenRouter) | top-5                        | logprobs                                                       | yes                                        |
  | Anthropic Haiku 4.5, Sonnet, Opus         | none                         | stated; sampling under the cost gate in phase 2d (Haiku)       | yes                                        |
  | Gemini 3.x, Mistral, Groq                 | refused                      | stated                                                         | yes                                        |
  | xAI, Z.ai                                 | silently dropped             | stated                                                         | yes                                        |
  | OpenRouter models with `top_logprobs`     | top-5 (`require_parameters`) | logprobs                                                       | yes; Jev through SystemOne (phase 2c)      |
  | Together Llama-3.3-70B, Tev1-4B           | top-5                        | logprobs                                                       | yes (Tev1 answers with option letters)     |
  | Fireworks `deepseek-v4p1-flash`           | top-5 (effort `none`)        | logprobs                                                       | yes                                        |
  | DeepSeek `deepseek-flash`                 | top-5 (thinking off)         | logprobs                                                       | yes                                        |
  | Hugging Face router                       | per upstream                 | logprobs when the upstream returns top-k, else top-1 or stated | yes                                        |
  | Ollama decision model (`tev1:4b`)         | n/a (SystemOne)              | —                                                              | yes, in 2j: the recommended separate judge |
  | Ollama general model, at least 3B         | top-5                        | logprobs                                                       | yes                                        |

- **Modes.** `museSpark.judge.engine`: `auto` (default), `same` or `off` in
  phase 1. `separate` arrives with 2c (SystemOne) or 2j (local), and `both`
  with 2a. Machine-scoped.
  - **`same`:** only the conversation's own model.
  - **`auto`:** `same` in phase 1. From 2a: `both` when a separate judge
    that has passed its section's verification is configured or installed,
    and `same` otherwise. Explicit modes are honoured.
  - **When `auto` resolves:** never at activation. It resolves at the first
    decision point, and the result is cached per window. It re-resolves on a
    change of setting, provider, consent or confidential flag.
- **Where phase 1 intervenes** (RVM98C C3). The judge never delays an
  approval card or a verdict. It acts only through a synchronous caution
  latch read at a fence that already exists.
  - **Exact-action entries.** Each judged action has one entry, keyed by a
    hash of the backend, session, turn, tool and canonical arguments. Its
    state is `pending`, `ready(caution | none)` or `failed`.
    - A replaced session or turn, a cancelled action, or a changed argument
      discards the entry.
    - A result that arrives after its fence has passed is dropped, unused.
  - **Reviewer-held approvals.** These are approvals the extension already
    holds while a reviewer runs: M78's Auto reviewer on the Model API, and
    M90's reviewer on Muse Code (`reviewedApprovals.ts`), extension-owned
    held approvals only.
    - The judge starts when the approval is held, in parallel with the
      reviewer.
    - When the reviewer's verdict arrives, the latch is read once,
      synchronously. A ready caution turns the reviewer's ALLOW into the
      normal card (ask). `pending`, `failed` or `none` leaves the verdict as
      it is. Nothing ever waits for the judge.
  - **Card-held approvals** (a card already shown). The card renders
    immediately. A caution that becomes ready before the user answers is
    attached as a note on the card. It cannot approve, deny or change the
    choices, and it is dropped once the card is answered or replaced.
  - **Immediate allows** (Model API Auto's direct allow; Muse Code's native
    skips, which raise no approval). The judge is **not started and not
    charged**: it cannot act without waiting, and phase 1 never waits.
    - A captured pre-execution hook (M91) or a deadline-bounded fence may
      change that in phase 2f, after a measurement.
  - **Kept apart.** Judge results never enter M78's or M90's ALLOW parser,
    and their reviewers' authority to allow is not transferred to the judge.
  - **Measured before charging by default.** On M75 replays, phase 1 records
    two numbers per backend: how often a result is ready at the reviewer's
    fence, and how precise the cautions are. If the ready rate on a backend
    is under `JUDGE_MIN_READY_RATE`, the judge is off there by default, with
    the reason shown. Muse Spark's 8–14 s latency makes this likely on the
    Model API.
- **Muse Code isolation** (RVM98C C4). On Muse Code, the same-model judge
  runs a **fresh hidden session per batch**: never M90's reviewer session,
  and never a fork or resume of the main session.
  - **Its own session:** started with `session/start` in the same
    `muse serve`, with its own session id and history. Nothing from it
    enters the main session, and nothing from the main session's history is
    replayed into it beyond the redacted judged text.
  - **Its own working folder:** a new, empty temporary folder, deleted when
    the batch ends. Workspace allow rules therefore do not apply.
  - **Its own mode:** Plan, with no MCP servers. The judged text is fenced as
    data in a standalone prompt.
  - **A guard, not a proof.** M90's item guard cancels the session on any
    tool item. It reacts after the CLI's notification, so it cannot prove
    that no command ran.
  - **No user-level allow rules.** MSP cannot disable native tools (D69).
    Before each batch, the extension reads the CLI's user-level settings.
    Any standing always-allow rule for shell, write or network turns the
    Muse Code judge off, with that reason shown.
  - **The residual,** carried from M90 and recorded in §9: an unknown
    always-allow source, or a CLI default that runs a tool before
    notification, could still act inside the judge session. The claim is
    narrowed to match. On Muse Code, M98 promises a caution-only verdict and
    an isolated session, not a proof that no tool ran.
  - **Cost.** Covered by the user's Muse subscription and counted against
    its limits; the first use says so.
- **State size, without splitting the state.** The state is never split.
  Pending questions may be split across requests, each carrying the full
  state. A state over the model's context is refused with an explicit
  no-answer and its reason.
- **Billing, consent and admission: D78's ledger, not a second one**
  (RVM98C C5).
  - **Billing follows the source.**
    - **Same model on the Model API:** the `judge` paid feature, asked once
      per D78 with the price and `museSpark.paidDailyBudgetUsd`.
    - **Same model on Muse Code:** the subscription.
    - **Later sources:** their own rules (BYO in 2e as D74 bills; local in
      2j free; SystemOne in 2c asks once).

    A move from a free source to a paid one asks again.

  - **Admission reuses D78's daily ledger.** That is
    `src/host/paid/paidDailyBudget.ts`, over M82's durable claim journal
    (`src/host/backend/sessionBudgetJournal.ts`), now being corrected on the
    FIXDEF lane. M98 adds no store, lock or journal of its own.
  - **What M98 requires of that ledger.** These are lane A's entry criteria;
    a gap is filed against FIXDEF, never patched around:
    1. one canonical namespace for VS Code windows and standalone clients;
    2. a durable reservation committed before dispatch;
    3. crash recovery that keeps a sent-or-possibly-sent claim as uncertain
       liability;
    4. idempotent settlement by claim id;
    5. a fail-closed refusal on an unreadable store or a lock failure;
    6. a stable lock object, never unlinked while contenders hold it;
    7. network filesystems refused as an unsupported scope.
  - **What lane A does.**
    - It reserves the uncached worst-case price of each call before
      dispatch. A batch is one call; a retry is a new claim.
    - It refuses unpriced calls and any call over the remaining budget.
    - It settles known usage, refunds known non-sends, and leaves timeouts
      as liability.
    - It re-binds consent and dispatch, after every wait, to the current
      owner, provider, model, mode and confidential flag.
    - It is tested against the real ledger through these cases:
      - a kill after dispatch, then a restart;
      - a corrupt store;
      - lock contention and recovery;
      - a network-home refusal;
      - two windows racing for the last of the budget;
      - a held modal across a budget change;
      - M80's and D78's regression files.
- **Confidential workspaces,** consistent with the chat model's own rules
  (today, contributor-tier models are blocked; D4). In phase 1,
  same-model calls run exactly when the chat model itself may. There is no
  other source in phase 1. 2c and 2j settle their own confidential status;
  2j's fallback is never used in a confidential workspace.
- **Same-model speed, per backend** (RVM98C C6).
  - **Model API** (the extension owns the request builder).
    - **Side requests:** a side request repeats the main request's cached
      prefix exactly and appends the question at the tail.
      - Haiku 4.5: 4,357 cached tokens read, 35 added, 1.35 s.
      - Redaction comes first. If it would change a prefix byte, a redacted
        standalone request is sent instead.
      - Below the model's cacheable minimum, a minimal standalone prompt is
        used.
  - **Muse Code** (MSP exposes `turn/start` input, not the CLI's HTTP body).
    - The judge sends a **redacted standalone prompt** in its fresh hidden
      session.
    - No prefix reuse is claimed, because the CLI's HTTP bytes cannot be
      inspected through a supported mechanism.
  - **Both backends.** All pending questions over one state go in one call;
    calls run in the background; a per-window, memory-only result cache;
    Muse Spark is never awaited on a user path. Upstream:
    [meta-models/meta-model-cookbook#57](https://github.com/meta-models/meta-model-cookbook/issues/57).
- **The single-model invariant, per backend** (RVM98C C6).
  - **`off`:** no request, no file, no log line, no bundle load, on both
    backends.
  - **Model API.**
    - With no hint (all of phase 1), the main request's full body is
      byte-identical to a build without the judge. A side request's prefix
      equals the main cached prefix exactly and differs only at the tail,
      or is standalone under redaction.
    - **Certified on M91-G's corrected raw-body harness** (`6cfb19e4`, raw
      golden requests and replayed IDs). It is a delivery dependency not yet
      on this branch's base. Lane G starts when it merges, and never builds
      an independent baseline.
  - **Muse Code.**
    - The main session's MSP inputs and settings (`turn/start`,
      `session/setApprovalMode`, model, effort) are unchanged, frame for
      frame, through the real adapter against the fake CLI.
    - The judge session's frames carry only the standalone prompt.
    - No claim is made about the CLI's own HTTP bytes.
  - **Unchanged:** the judge never edits, reorders or trims a main request
    or session. The SoL-Pi invariants hold.
- **2j, the local judge: a design spike before any build** (RVM98C C1, C2).
  The owner's local-model opt-in stays planned, as phase 2j. A cached
  listener check does not authenticate a later connection (C1). A
  same-user loopback listener with valid Ollama metadata can be an SSH
  forward or a TCP relay to another machine (C2), as the probe's own tunnel
  to the GPU rig was. The spike must deliver one of two outcomes.
  - **(a) Verified local inference, checked per connection.** Before any
    body byte is written on each content-bearing connection:
    - **The peer process behind this socket:** its owner, matched by the
      connection's own four-tuple in the OS tables (Linux
      `/proc/net/tcp*` and the socket inode; the Windows TCP table's
      per-connection owning PID; macOS `lsof` for that tuple).
    - **The runtime:** a supported runtime binary (Ollama's own executable
      at its install path), not a forwarder (`ssh`, `socat`, a container
      proxy, `wslrelay`).
    - **The model:** the model's weights present on this machine's disk
      under that runtime's model directory, and matching the served digest.

    Any ambiguity gives "unverified": forwarding, namespaces, containers,
    WSL, a remote extension host whose loopback is another machine, or a
    probe that gives no answer. The fixtures include replacement within the
    old TTL, a clean close and reconnect, PID reuse, different IPv4 and IPv6
    owners, an SSH forward and a same-user relay.

  - **(b) Otherwise, a user-configured endpoint, labelled unverified.**
    - Used only when the user enters the endpoint explicitly.
    - Labelled "unverified local endpoint" wherever it shows.
    - Never used in a confidential workspace.
    - Never auto-selected by `auto`.

  The pinned `node:net` transport (an IP literal, a single loopback-only
  lookup, redirect refusal, proven in the extension host and headless Node),
  the provenance checks, consented pulls and the `tev1:4b` recommendation
  carry into 2j as its starting design, not as phase-1 work.

- **Calibration, with honest labels** (RVM98 P2; fitting is phase 2b).
  - **Each family names its target and permitted labels.**
    - `risk.destructive` asks whether the command can delete or overwrite
      data, or change shared state, irreversibly. Its labels are independent
      hand labels and M75 fixtures only. An approval does not make a command
      safe, and a passing test proves nothing about destructiveness.
    - `skill.fit` asks whether the skill applies to the request. Its labels
      come from M75's skill-routing cases.
  - **Outcome signals are not labels.**
    - Approve or deny, a suggestion accepted, a test outcome or a reviewer
      verdict are weak signals, kept in a separate opt-in, local store with
      no content.
    - They feed drift monitoring and preference ranking only, and never
      reliability metrics or fits.
  - **Methods and splits.**
    - Phase 2b starts with Platt scaling for binary families, and adds
      isotonic regression only when a family has at least 200 labels.
    - Fit, tuning (technique and threshold selection) and evaluation use
      disjoint sets, grouped by task and repository.
    - Reported ECE and Brier come from the evaluation set only. A model's
      logprobs are a reference, never ground truth.
  - **Labels on results.** An uncalibrated result is used only where
    uncalibrated output is allowed. Phase 1's Auto advisory allows it,
    because it can only add caution, under a conservative threshold.
  - **Local models.** Each keeps its own profile.
- **Uses inside the extension** (D50's list, advisory only).
  - **Phase 1:** the Auto risk advisory, at the fences above ("Where phase
    1 intervenes"). On reviewer-held approvals, a ready caution turns ALLOW
    into ask; on card-held approvals, it adds a note. It never allows,
    waits, or runs on immediate allows.
  - **Phase 2f:**
    - skill and custom-agent suggestion (at most one hint line);
    - context relevance and grading, after their M75 runs;
    - M96's orchestrator hints;
    - M90's review signal;
    - the three measured testing uses below.
- **Phase 2 surfaces,** planned and not dropped; M98's phase-2 sections hold
  their scope:
  - **2a** the cascade, `both` and the `auto` → `both` rule;
  - **2b** calibration fitting and the report;
  - **2c** the SystemOne adapters (M85: OpenRouter Jev tested, TypeSafe
    untested, Clef pending a key), with `judge serve`;
  - **2d** sampling and contrastive framing;
  - **2e** BYO providers after M95;
  - **2f** the other uses, and the Judge section in M95's panel;
  - **2g** the `judge` CLI (`ask`, `hook` after M91, `calibrate`, `report`,
    `mcp`) and the MCP tool;
  - **2h** lint;
  - **2i** the embedding fast path;
  - **2j** the local judge, after its design spike (above).

  Their designs, as settled, are:
  - **`judge serve`** (2c): `/v1/systemone` bound only to an IP literal
    (`127.0.0.1` or `::1`) on a chosen or random port.
    - A bearer token is generated per start, written once to a user-only
      file (with an ACL receipt per OS), and deleted on exit.
    - A Host header other than the bound literal and port is refused,
      against DNS rebinding.
    - Any request with an `Origin` header is refused, against CSRF.
    - Bodies are capped at 64 KiB.
    - Each request takes its own admission reservation.
    - jevlint and other SystemOne clients point `TYPESAFE_ENDPOINT` at it.
  - **The CLI** (2g): reserved before prompt parsing, as M97's
    `exec legal-scan` is. It starts no backend and writes no ACP frames.
    - **Flags:** `--engine auto|same|separate|both`, `--model`, `--separate`,
      `--budget-usd` (default 0, so a paid source is refused) and
      `--timeout-ms`.
    - **Exit codes:** 0 answered, 2 input or configuration error, 4 no
      answer.
    - **`judge hook`:** emits only caution in each agent's format (M91's
      schemas). No answer means no opinion.
  - **Lint** (2h), jevlint-compatible within declared limits (RVM98 P2):
    - **Config.** `jevlint.json`, its packs and its evals are read as they
      are, compatible with upstream revision `73a7a94a`.
      - Our reader is as strict as upstream's (`DisallowUnknownFields`).
      - A rig test runs upstream's own `jevlint doctor` and `eval` on the
        same files.
      - Muse options live in a separate `.muse/judge-lint.json` or in CLI
        flags, never inside `jevlint.json`.
    - **Answers.** Each unit's choice offers pass and fail, plus `skip` only
      when `allowSkip` is set and `abstain` only when `allowAbstain` is set,
      with upstream's criteria text. Applicable rules are batched per unit.
    - **Units.**
      - Document symbols (as M67) cover `function`, `type` and `field`,
        where a symbol provider exists.
      - Tree-sitter covers `comment`, `docComment`, `statement`,
        `localize`, and files without a provider.
      - The grammars ship in the npm ACP package, which the panel calls when
        installed: TypeScript 2.34 MB, TSX 2.41 MB, JavaScript 0.65 MB,
        Python 0.48 MB, Go 0.24 MB, Rust 0.82 MB, Java 0.43 MB, plus a
        366 KB runtime.
      - jevlint's other presets (`c`, `cpp`, `csharp`, `kotlin`, `php`,
        `ruby`) are unsupported until added.
    - **Coverage.** Every run reports the units it checked per language and
      kind, and lists each unsupported (language, kind) pair as "not
      checked". "No findings" never stands for "not checked".
    - **Mechanics.**
      - A cache with no source.
      - Flags: `--changed`, `--fail-on error|warning`, `--budget-usd`,
        `--format text|json|sarif`.
      - Exit codes: 0 no findings, 1 findings, 2 error.
    - **The first-party pack**, from the high-quality-projects standards,
      with fixtures and evals:
      - no silent fallbacks;
      - no placeholder or fake production code;
      - no mock data outside test boundaries;
      - errors that explain how to fix them;
      - no unexplained magic values;
      - honest function names.
    - **Uses.** Advisory unless the user makes it a gate; also through D68's
      bundled-skill path.
  - **The embedding fast path** (2i):
    - a logistic head per recurring family on embeddings from the same
      provider, or from a local model under an opted-in local judge;
    - it falls back to the full judge under
      `JUDGE_EMBED_FALLBACK_CONFIDENCE`;
    - training is local and opt-in, with weights in global storage and none
      in the VSIX;
    - a family's head turns on only after its own measurement with hundreds
      of labels. The 40-label prototype is no evidence.
  - **Faster testing, honestly.** A judge does not make tests faster. Three
    advisory uses, each measured before adoption:
    - flake against real-failure triage of a CI log, which never retries or
      merges;
    - a lane-diff pre-screen against the rule pack;
    - choosing which review class runs first.

- **Privacy.**
  - `src/core/redact.ts` runs before any remote call, and wins over cache
    reuse.
  - Logs carry question ids, source, technique, model, timing and cost,
    never content.
  - PRIVACY names every recipient.
  - The TypeSafe key keeps D50's named exception to rule 12.
- **Order against M95.**
  - **Phase 1 needs no M95.** It runs the same model on the Model API and on
    Muse Code.
  - **BYO providers** (2e) wait for M95's `ProviderClient`, presets and keys,
    as do the SystemOne keys for 2c. TypeSafe, OpenRouter's SystemOne route
    and Cloudflare become presets of a `systemone` format. No second key
    store or transport is built.
- **M85 is folded in** as phase 2c's adapter (D50 amended). The OpenRouter
  route was tested live, which supersedes the "untested" label for that
  route. The direct TypeSafe route stays untested until a key exists.
- **GPU.** The plan assumes CPU-only local inference.
  - On the lab's GTX 1080 Ti, `tev1:4b` went from 3.1 s to 0.30 s per state
    with the same answers, and a 1,750-token prompt was processed 38–40×
    faster.
  - Calibration batch runs drop from about an hour to minutes.

  It changes no decision. The product's local judge stays on the user's own
  machine; the rigs are development infrastructure.

<!-- plan-archive:end id="2-D77-01" -->

## D85 — Multimodal input: video, audio, documents, screen recordings and the Files API (M105, 2026-10-05)

<!-- plan-archive:begin id="2-D85-01" lines="11791-12078" bytes="17799" sha256="66ab4d3ae4140a15e8f559ed833bb48fea7d75a90ff12e02b2d92afef327d89b" -->

The Meta coverage audit of 2026-10-05
(`docs/research/meta-coverage-2026-10-05.md`) found video missing on every
surface, no Files API (every PDF and image re-sent as base64 on each tool
round), no screen recording anywhere, media costed at one token per encoded
byte, and an ACP bug that treats every embedded blob as an image. Meta's
Responses API takes video as `input_video` (a data URI, a URL or an uploaded
`file_id`, with `fps`) or as an `input_file`. The owner-authorized live
captures the same evening (§6 of the research record: 9 inference calls and
36 that inferred nothing, all on contributor models; 4 uploads, all deleted)
settled what the documentation left open:

- `POST /responses/input_tokens` does not count media at all;
- Muse Spark 1.3 does not hear a video's soundtrack, and 1.2 does;
- `input_audio` is accepted and silently ignored;
- QuickTime (mov) is accepted beside mp4, and WebM is refused;
- the Files API wire works as documented, `expires_after` included.

The owner's standing rulings apply:

- enhancements are on by default (D78);
- every feature is on exactly where the selected model can use it, whatever
  the vendor (D81.2);
- every editor gets equal functionality (D84);
- paid use is opt in and loud, asked once with its price (rule 12, D48, D78);
- real calls in testing use the contributor model and throwaway content.

1. **A modality is a capability of the selected model, never of a vendor.**
   M95 lane N's evidence-bearing `ModelCapabilityRecord`
   (`src/core/providers/capabilityRecord.ts`) gains, with provenance and
   "unknown" kept distinct from "no":
   - `modalities.video`: mime types, the inline and upload byte limits, the
     fps range and default, the maximum duration, and `hearsSoundtrack`;
   - `modalities.audio`, widened from a flag: formats, the inline limit, and
     whether a standalone `input_audio` part is actually heard;
   - `files`: which Files API the provider has (Meta's, OpenAI's, Anthropic's,
     Gemini's, or none), its per-file and pool limits, and its expiry range.

   Meta's rows come from the captures: Muse Spark 1.3 takes mp4 and mov but
   `hearsSoundtrack` is no (U4); 1.2 takes both and hears the soundtrack; on
   both, `input_audio` is not heard (U7). 1.1 stays unknown until it is
   captured. On after each one's capture: Gemini (its own Files API and inline
   data), OpenRouter routes whose record says video, and local
   vision-language servers (vLLM and SGLang serving Qwen-VL take `video_url`)
   once their served capability is established. A model whose record says
   no, or unknown, is refused before anything is sent, with a named reason.
   Nothing is withheld because one vendor lacks it.

2. **Upload once, replay the id.** Video always goes through the provider's
   Files API where the record has one. PDFs and images larger than
   `MEDIA_FILE_ID_MIN_BYTES` (1 MiB), and any media still in replay after its
   first delivery, move to a `file_id` where the capability exists, which ends
   the per-round base64 re-sends. Small images stay inline (cheap, and cached
   as part of the prefix). Providers without a Files API keep D47's inline
   path and its budgets unchanged.
   - **Transport.** The host or runtime streams the file from disk (never a
     whole-file buffer), with progress and Stop, hashing it with SHA-256 as it
     goes. The key is only in that request's header (rule 8); the upload uses
     the same endpoint checks as every other Model API request.
   - **The wire, as captured (U6).** A multipart upload with
     `purpose=user_data` and the expiry as the bracket-form fields
     `expires_after[anchor]=created_at` and `expires_after[seconds]`.
     Retrieve, list, content (byte-exact) and delete all work; a deleted file
     no longer lists. A `store: false` turn can reference a `file_id`.
   - **Expiry.** Every upload sets `expires_after`. The default is
     `MEDIA_FILE_EXPIRY_DEFAULT_S` (7 days), within Meta's documented
     3,600–2,592,000 seconds; U6 saw `expires_at` set. A crash can therefore
     never leave a file at Meta indefinitely.
   - **Lifecycle.** A per-session upload ledger maps the SHA-256 to
     `{fileId, provider, expiresAt, bytes, name, mime}`. Fork and rewind share
     an upload by reference count. Deleting a session, the
     `cleanupPeriodDays` purge and **Delete uploaded files** delete the
     provider's copy (`DELETE /v1/files/{id}`) once no session refers to it.
     A replay that meets "not found" re-uploads once after the source file's
     hash matches, and otherwise says the upload expired and asks for the
     file again.
   - **Account & usage** lists the account's files: name, size, session,
     expiry, and the total against the provider's pool (100 GiB at Meta).
     The captures found other files on the account that this product did
     not upload (Muse Code or other use), so the list shows every file and
     marks ours. **Delete** and **Delete all ours** act on ours. Another
     file is deleted only after a confirmation saying that another app may
     still use it. If the key is removed, the list stays, read-only, and
     names each file's expiry.

3. **History keeps ids and metadata, never bytes.** Session files, rewind,
   fork, export and share (M84), the problem report (M93), the usage journal
   (M102) and the logs hold only the file id, SHA-256, name, mime type, size,
   duration, soundtrack flag, dimensions, expiry and provider. Exports and
   shares carry the metadata line and no file id. Inline parts keep D47's
   after-first-delivery replacement.

4. **Sniff the bytes, never trust the name.** Ours, with no dependency and
   no frame decoding, bounded by `MEDIA_SNIFF_MAX_BYTES` from the head and a
   tail window (a `moov` box may sit at the end):
   - mp4 by its ISO-BMFF `ftyp` brand, and QuickTime by `qt  ` (sent as
     `video/quicktime`, which U5 shows Meta accepts though its documentation
     says mp4 only); duration from `moov/mvhd`, size from `tkhd`, a soundtrack
     from an `hdlr` of `soun`;
   - WebM and Matroska (EBML), which U5 shows Meta refuses at upload and
     inline, and m4a (not captured) are refused with a conversion hint;
   - wav (RIFF `WAVE`) and mp3 (ID3 or frame sync) are audio;
   - `vide` and `soun` track handlers establish the kind, independently of
     the brand. Audio-only MP4 is audio. A file whose tracks cannot be read
     within the bounded windows is refused, since the metadata contract has
     no unknown-kind state. Unknown duration with known tracks remains allowed
     unless the model sets a maximum or the session is capped (decision 6).

   **Convert to mp4** is offered only when a converter is already on the
   machine at an explicit configured path or a documented install location.
   Each probe and launch requires the shared trusted-path verifier, and a
   bounded probe must yield a strictly parsed release version. Unversioned
   converters refuse. Conversion runs with an argument array into an owner-only
   temporary file. Nothing is bundled or installed.

5. **Sound, routed to where it is heard.**
   - **A video with a soundtrack, on a model that does not hear it** (Muse
     Spark 1.3, U4). The chip says "1.3 does not hear this video's sound" and
     offers:
     - **Transcribe the sound** (the default): Muse Voice Transcribe's batch
       endpoint at $0.18 per audio hour, a paid feature under rule 12,
       available by default on interactive Model API with D78's ask-once
       popup. The transcript goes beside the video as text, and the user's
       model stays. It is offered where capture U18 shows the batch endpoint
       takes the video's container, or a converter can extract the sound.
     - **Use 1.2 for this message**, which hears it (U4). The pill says so for
       that message only.
     - **Send without sound**.
   - **A standalone audio file** (wav, mp3). `input_audio` is accepted and
     silently ignored on Meta (U7), so no Meta request carries it until
     Meta fixes it (decision 15) and a new capture shows it heard. The
     default is **Transcribe**, as above. **Send to 1.2 as a video** (the
     sound wrapped with a still frame) is offered only where a converter is
     on the machine.
   - **Other vendors.** `input_audio` goes to models whose record says it is
     heard (Gemini, OpenAI's audio models), each from its own capture.

6. **Cost is estimated from real usage, reserved at the worst case, settled
   from the bill.** One token per encoded byte goes.
   - **Meta's count route cannot help.** U1, U2, U3 and U17 show
     `POST /responses/input_tokens` returns about 170 tokens whatever the
     media: a 600-second video, 49 images, any fps or detail. It is still
     used for text.
   - **The estimator** (`src/core/media/mediaCost.ts`) is calibrated per
     model from actual billed usage: tokens per second of video at each fps,
     per image at each detail, per PDF page. Each calibration point is a
     recorded capture.
     - The first point: a 10-second, 0.5 MB clip billed 2,751 input tokens
       on 1.3 (about 2,580 for the video) and 1,671 on 1.2.
     - M105's step 1 adds lengths, fps values and image details.
   - **Reservation** takes the estimator's upper bound (the largest
     calibrated rate times the duration, times
     `MEDIA_ESTIMATE_SAFETY_FACTOR`). D78's daily ledger and M82's session
     reservation admit that figure. Settlement uses the reported usage, and
     each settled turn becomes a new calibration observation, kept locally.
   - **The chip** shows duration, size, sound, the estimated tokens and their
     price, marked as an estimate, for example "2:14 · 38 MB · sound · ~35k
     tokens (est.) · $0.05 Standard / $0.02 Contributor".
   - **Unknown means refused when capped.** In a capped session, media with
     no calibrated rate for its model, or an unknown duration, is refused
     with the reason, never sent on a guess.
   - **The 50-media limit** is enforced on our side before sending. The count
     endpoint did not refuse 51 (U3), and a real turn's behaviour is capture
     U3b.
   - **Storage.** Whether Files storage is billed could not be read from the
     API (U6). Step 1 reads the billing dashboard, signed in and read-only,
     after a day with uploads (U6c).
     - If storage is billed, uploads become a paid feature under rule 12:
       D48's popup names the storage rate and the expiry, `PaidUsage` counts
       storage-days, and the D78 ledger admits them.
     - If it is not billed, uploads ask nothing beyond decision 7.
     - The upload path ships with neither default until U6c is recorded.
     - **U6c (recorded 2026-10-08, lead decision).**
       `docs/certification/m105-captures.md` ("U6c, storage billing") read
       the signed-in billing dashboard three days after the 2026-10-05
       uploads: Pay-as-you-go balance $0.00 with no line items, no
       Files-storage metric on the Usage page, no storage rate on the
       published price list, and storage described only as a 100 GiB
       per-team quota. The finding selects the **not-billed** branch above:
       uploads ask nothing beyond decision 7. No `filesStorage` paid
       feature, storage-day tally or storage tariff is added.
     - **Caveat.** This is the absence of any storage meter or rate (the
       dashboard shows no usage for the key at all, including round 3's
       turns 25 minutes before the read), not a measured zero for storage.
     - **Re-check.** The release checklist reads the dashboard again once
       usage appears there; if Meta publishes a storage rate or the
       dashboard gains a storage metric, this decision re-opens under the
       billed branch. Until then the always-set expiry and the cleanup in
       decision 2 remain the operational constraints.

7. **The contributor tier warns.** On a contributor model (Meta may train on
   its inputs), attaching a video, an audio file or a screen recording shows
   the warning on the chip and asks once per conversation: **Send**, **Use
   the Standard model**, or **Remove**. A screen recording always asks there,
   because it holds whatever was on the screen.

8. **Every editor gets every entry point** (D84). The table below is the
   media row of M104's feature registry.

9. **The ACP blob fix.** An embedded resource's `blob` is dispatched on its
   `mimeType` and its sniffed header: an image to the image part, a PDF to
   the document part where the backend and model take it, video and audio to
   the media path above, and anything else to a named refusal (never "Only
   PNG, JPEG, GIF and WebP…"). `promptCapabilities.audio` becomes true; the
   ACP capability is the agent's, so a session whose model cannot take audio
   refuses the block with the reason.

10. **A screen recording is a user action only.** No tool, hook, schedule,
    subagent, team worker, best-of-N candidate or headless run can start one.
    - **Bounds.** At most `museSpark.screenRecordingMaxSeconds` (120 by
      default, up to 600), with a visible countdown and Stop beside the
      operating system's own indicator. The microphone and system audio are
      off unless the user ticks them for that recording.
    - **Preview first.** The recording opens in a preview (play, then
      **Attach** or **Discard**); nothing is sent before **Attach**. The file
      sits in an owner-only temporary folder and is deleted after its upload
      or its discard.
    - **macOS.** A `--record-screen` mode in the existing Swift helper, using
      ScreenCaptureKit with `AVAssetWriter` writing H.264 and AAC into mp4.
      The permission prompt names the helper, as M28's disclaim makes it do.
      Where ScreenCaptureKit is missing, `screencapture -v` (with `-G` for
      audio) followed by `avconvert`.
    - **Windows.** **Attach latest recording** takes the newest mp4 from the
      Snipping Tool's `Videos\Screen Recordings` folder (made within
      `RECENT_RECORDING_MAX_AGE_MS`). A Windows.Graphics.Capture helper in C#,
      compiled on first use by `jobBuild` like M27's, records directly
      through Media Foundation's H.264 sink.
    - **Linux.** The xdg-desktop-portal ScreenCast interface (the portal's
      own picker and consent), recorded from its PipeWire stream by
      GStreamer's `pipewiresrc` or an `ffmpeg` on PATH into mp4; plus
      **Attach latest recording** from `~/Videos/Screencasts` and Spectacle's
      folder (GNOME saves WebM, which goes through **Convert to mp4**).
    - **The companion page.** `getDisplayMedia` with `MediaRecorder` writing
      `video/mp4` where `MediaRecorder.isTypeSupported` says so (current
      Chromium and Safari); elsewhere a refusal that names the browser.
    - **VS Code webviews** have no `getDisplayMedia`, so VS Code uses the
      native helpers. In a remote window the helper would run on the remote
      host, which has no screen: there the menu offers the companion page or
      a recording file the user picks, and says why.

11. **Model switches and replay.** Switching to a model without video (or
    audio) replaces each replayed item with one line, for example "clip.mp4
    (2:14) was left out: <model> does not take video", as Muse Code itself
    does. Switching back restores the `file_id` while it has not expired.
    Compaction (M101 lane C1) keeps the `file_id` parts in the recent tail and
    names older media by its metadata.

12. **The companion page, and D30.** D84 supersedes D30's "no web app of
    ours" for the loopback companion page. Its upload endpoint sits behind
    M104 lane C's guard: a one-use launch code in the URL fragment, a
    per-window bearer, exact `Host` and `Origin`, Fetch-Metadata checks, the
    custom header, no cookies and no CORS. It has its own streamed size cap.
    The page never binds a LAN address, so nothing here makes the panel
    reachable from another device; D30's Remote Control ruling is unchanged.

13. **Nothing at startup, no dependency.**
    - The sniffers, limits, upload ledger and cost code live in a portable
      lazy `dist/media.js`, loaded at the first non-image media chip, the
      first media `read_file` or the first upload, in the extension and the
      ACP package alike.
    - The recorder drivers live in a lazy `dist/screenRecord.js`.
    - The preview and the companion's recording UI are lazy browser chunks.
    - Encoders are the operating system's; no existing cap rises (D6).

14. **Privacy.** PRIVACY says what reaches the provider (uploads persist
    until their expiry or deletion), that contributor models may train on
    them, that a screen recording holds whatever was on screen, and that
    deleting a session deletes its uploads. README carries the modality
    matrix per backend and model.

15. **Four upstream requests to Meta's Model API**, each a task in M105's
    lane 0. Each is filed after a dedupe search through Meta's developer
    support channel for the Model API (or the meta-models GitHub tracker
    where one covers the API), with no private content, and its link is
    recorded:
    1. `POST /responses/input_tokens` should count image, video, audio and
       PDF tokens.
    2. Muse Spark 1.3 does not hear a video's soundtrack; 1.2 does.
    3. `input_audio` parts are silently ignored on
       `muse-spark-1.2-contributor`, while the count endpoint accepts them.
    4. Document mov support or refuse it consistently. Also document the
       minimum `compact_threshold` (1,000) and whether `store: false`
       supports server compaction (U11; D86 keeps server compaction an
       evaluated arm only).

    The Muse Code SDK request for an MSP video/file part is D86.7's.

**Editor matrix (media).** "Runs in" is where the bytes are read and
uploaded from.

<!-- plan-archive:end id="2-D85-01" -->

## D95 — Scheduled prompts v2: unattended, stacked, with a delivery mode (M115, 2026-10-06)

<!-- plan-archive:begin id="2-D95-01" lines="17247-17604" bytes="27660" sha256="455bf041b8e57ff2e87ddad4b95f097a7c0298292061b672b567b6b5ae2e3ffe" -->

The owner, 2026-10-05, after D92 noted that scheduled prompts block on their
questions today: "scheduled prompts should be unattended and they should be
either single trigger schedule or repeating or scheduled to trigger custom
and they can be stacked so to say basically you can schedule multiple to
trigger at different times and you should be able to set the prompt as a
steer or an interrupt". Then: "the orchestrator should be able to set
scheduled prompts for agents as well", and "we should also be able to set
prompts to trigger off of a status as well ie a pr merging or a milestone
completion etc". And, for decision 13: "is there a way to setup a watchdog
type hook so if an issue is opened on git it tells our orchestrator and they
can come up with a plan of action ie they assign an agent to determine if it
is valid, if it is an issue that is being or has been addressed, and reports
back then it decides what needs to happen and orchestrates it properly to
completion then verifies and responds to the person who submitted the issue,
oh and we should also say that we are looking into it in response to the
initial filing of the issue".

**What exists** (read on main at `2d4d72bd3`):

- **M52's Model API schedules.** `src/shared/schedule.ts:7–63` has two
  cadences (`interval`, `cron`), a job bound to one session, workspace and
  key digest, and a store whose `claim` admits an occurrence once.
  `src/core/backends/modelapi/schedules.ts` parses `/loop` and computes the
  next fire (`nextScheduleFire`, line 155) with a local five-field cron
  matcher. `src/host/backend/fileScheduleStore.ts` keeps one file per job in
  VS Code's workspace storage and admits a fire by creating its receipt with
  `wx`, never rolled back (lines 1–5, 219–221). The limits are in
  `constants.ts:3137–3144`: at least one minute, at most seven days between
  fires, a seven-day lifetime, 4,000 characters, a 60-second poll, and 100
  jobs per session.
- **Every fire asks.** A due occurrence waits for **Run**, which opens a
  per-run price modal (`conversationController.ts:7015–7046`,
  `confirmScheduledRun`), then `ModelApiHost.runSchedule`
  (`ModelApiHost.ts:10825–10862`) re-checks the session, model, paid gate,
  claim and account. The run goes into the open conversation in its current
  mode, so its approvals and questions wait for a person (D92's finding).
- **Only the Model API, only a loaded session.** Muse Code's own cron tools
  (`cron_create`, `cron_list`, `cron_delete`, `SCHEDULE_TOOLS` at
  `constants.ts:1392`) run inside its turns and cannot be listed from the
  panel; nothing runs while VS Code is closed (D4). ACP has no schedules;
  headless `exec` refuses them (AGENTS rule 12).
- **Planned, not built:** M88's lane C (D67, items 15 and 16): a one-shot
  cadence, timed sends on Muse Code in an extension store, and **Resume
  later** after a limit, each running in the conversation's mode.
- **Related, unchanged:** M45's goal wakes (the model's own continuation),
  M96c's task scheduler (the team's picks and slots), D87.2's `schedule`
  governed kind, D89's unattended marking (M109 lane R), D83.8's unattended
  refusals.

1. **Scheduled prompts run unattended, end to end.** Each fire carries a run
   context, `{ unattended: true, scheduleId, runId, grant, creator }`,
   through both backends, the hooks, the tools and the paid gate:
   - **Approvals that need a person are refused,** never left waiting. The
     transcript row says "Refused on schedule: {action} needs approval and
     is not in this schedule's grant", and the model is told it was refused
     (the Model API's rejection result; Muse Code's `approval/decide` reject,
     as best-of-N's decliner does, `worktreeConversationHost.ts:200–215`).
   - **Questions defer at once** (D92), with no minute's wait, since nobody
     is there; they stay open and answerable later.
   - **Physical actions** (D83) are always refused (D83.8).
   - **Money:** the paid budget applies, and paid use beyond what the
     schedule's consent covers (decision 3) is refused before any request.
   - **The mode.** A schedule runs in the mode chosen when it was made:
     Manual, Plan, Accept edits or Auto. Bypass is never offered: the grant
     is how a schedule is trusted. Whatever that mode would ask a person
     about is matched against the grant; anything else is refused.
   - **Never granted:** protected paths (`isProtectedPath`,
     `src/core/protectedPaths.ts`), `requiresAsking` tools, and anything
     D65 denies headless runs.
   - **What the model reads.** The prompt is an ordinary user message with
     one fixed note in it (`SCHEDULE_MODEL_TEXT.unattendedNote`: sent on a
     schedule, nobody is watching, requests outside the grant are refused).
     The system prompt and the tool list are unchanged, so the request's
     prefix stays cache-stable (the golden requests).
   - **Governed:** a fire is background work of kind `schedule` (D87.2): it
     waits at M107's pause, with "waiting: machine busy", and never jumps
     its queue.

2. **A standing grant per schedule.** When a schedule is made, the user may
   grant it an allow-list:
   - **tools and commands,** in the session-rule syntax the approval card
     already offers ("Always allow" prefixes, MCP tool names);
   - **paths,** as workspace-relative globs, never outside the workspace;
   - **a paid cap** (decision 3).

   The grant is shown on the schedule's card, revocable at any time, and
   audited: its creation, each change, its revocation, and each use (the run
   id, the rule that matched, the action), without arguments or file
   contents. M109's vault grants apply to a scheduled run only when they are
   scoped to that schedule (D89's requester, `schedule:<id>`). Without a
   grant, decision 1's refusals apply to everything that asks.

3. **Paid consent once per schedule.** On the Model API a schedule is the
   `scheduledPrompts` paid feature (D34, D48, D78). Creating one shows D48's
   question once for that schedule: the prompt, the model, its price tier,
   the cadence, and the cap per local day (`SCHEDULE_PAID_CAP_DEFAULT_USD`,
   $1.00), plus any paid extras it may use (search, images), each ticked.
   Each fire then reserves inside both the cap and D78's shared daily
   budget; a fire that would pass either is refused before its request and
   recorded. A changed model, key or price tier sends the schedule back to
   ask again before its next fire. This is D48's "Allow always", scoped to
   one schedule and one cap; AGENTS rule 12 gains its line. M52's per-run
   **Run** modal goes. Muse Code's subscription pays for its own turns, so
   it has no paid gate (M88's ruling).

4. **Time triggers** (decision 11 adds events, and the two compose).
   - **Once:** a date and time.
   - **Repeating:** every N minutes, hours or days; on weekdays; or a
     weekly set of days, each with its times.
   - **Custom:** a five-field cron expression (M52's matcher), with the next
     five fire times previewed in the user's time zone before saving.
   - **End conditions,** optional: an end date, or after N runs.
   - **Time zones and daylight saving.** A schedule stores the IANA zone it
     was made in and is computed there with `Intl.DateTimeFormat` (no
     dependency), so moving the machine does not shift it. Elapsed-time
     kinds (every N minutes or hours) ignore wall-clock changes. Wall-clock
     kinds follow the zone: a time skipped by a spring-forward fires at the
     first minute after the gap; a time repeated by a fall-back fires once,
     the first time.
   - **Limits:** at least `SCHEDULE_MIN_INTERVAL_MS` (one minute) between
     fires, as now. M52's seven-day lifetime ends: `/loop` keeps Muse Code's
     grammar and its seven days as its default end date, and other schedules
     end only by their own condition. A schedule whose last
     `SCHEDULE_PAUSE_AFTER_FAILURES` (3) fires failed is paused, saying why.

5. **Stacking.** Any number of schedules (up to `SCHEDULE_MAX_PER_WORKSPACE`,
   200), each with its own prompt, kind, target and delivery mode.
   - A **timeline** shows the upcoming fires across all of them (the next
     24 hours, or 7 days), marking collisions: fires on one target within
     `SCHEDULE_COLLISION_WINDOW_MS` (60 seconds) of each other.
   - **Colliding fires run in creation order,** one after another, unless
     each is set to **Run in parallel**, which needs the new-conversation
     delivery.

6. **Delivery mode, per schedule:**
   - **Steer:** injected into the running turn (`submit`'s steer); with no
     turn running, a new turn.
   - **Interrupt:** the running turn is stopped cleanly, exactly as Stop
     stops it (on Muse Code its part-decided approvals are rejected first,
     `PromptLedger.partlyDecided`), then the prompt runs. The card warns that
     this can stop the user's own turn.
   - **Queue:** the backend's queued message (M87's queue), run after the
     current turn ends and withdrawable from the composer as any queued
     message is.
   - **New turn when idle** (the default): held by the scheduler until the
     session is idle, then sent.
   - **New conversation:** a fresh session for each fire, titled with the
     schedule's name and the fire's time.
   - **A closed target:** **Open it** (the default) resumes the session in a
     background conversation host, as best-of-N's worktree conversations run
     (`worktreeConversationHost.ts`), without switching the user's panel, and
     shows it in the Agent map and History with a notice; or **Skip**, which
     records the fire as missed.
   - **Missed fires** (the machine was off, asleep, or no host held the
     workspace): **Run once** (the default: one catch-up, as Muse Code's
     `/loop` recovers at most one) or **Skip**, per schedule.

7. **Targets:** this conversation; a named conversation (by its id, shown by
   its title); a new conversation each fire; and, where M96 has merged, a
   role or a team, as a task on M96c's board under the role's charter.

8. **Agents schedule too** (the owner's second request).
   - **Tools:** `schedule_prompt`, `schedule_list` and `schedule_cancel`, for
     orchestrators: the lead conversation, M96's team leads and roles, and
     M110's orchestrator hosts. A worker has them only if its role's charter
     allows. (The run's existing transcript row, `scheduled_prompt` at
     `constants.ts:1391`, keeps its name.)
   - **Targets:** the agent's own session, a named worker or role, a team,
     or a node (M110).
   - **Made by an agent, shown as such:** "Set by {agent} in {session}" on
     the card, in the list and the timeline, beside the user's own
     schedules, where the user can edit, pause or cancel any of them.
   - **No escalation.** An agent's schedule is bounded by its creator's
     permissions, grant and paid budget at the time of creation, and never
     by more: its grant is the intersection of what it asks for and what the
     creator itself had, and its paid cap comes out of the creator's.
   - **Asked once per schedule.** Creating one asks the user (**Allow**,
     **Always for this orchestrator**, **Never for this orchestrator**).
     Always lets that orchestrator create schedules without asking inside a
     cap: `AGENT_SCHEDULES_MAX_ACTIVE` (10) active, no fire more often than
     `AGENT_SCHEDULE_MIN_INTERVAL_MS` (15 minutes), and a total paid cap per
     day.
   - **Bounded in time and depth.** An agent's schedules end with their team
     or session unless the user pins them. A scheduled run may create
     schedules only to a depth of 1 (`AGENT_SCHEDULE_MAX_DEPTH`): a run that
     was itself scheduled by an agent cannot schedule another unless the user
     allows it for that schedule.
   - Every agent-made fire is unattended under decision 1, and stacking,
     delivery modes and collision order are the same as for the user's.

9. **One store, every editor, never twice.**
   - **Shared.** Schedules move from VS Code's workspace storage to
     `<agentDataFolder>/schedules/v1/<workspaceKey>/` (M102's folder
     convention), so every editor and the runtime see one list. M52's jobs
     are migrated on first load: copied, verified, then removed.
   - **Who fires.** Every host process holding the workspace (a VS Code
     window, the runtime for the companion page, the native plugins and ACP
     sessions, a Muse Node) runs the scheduler; M52's `wx` claim decides
     which one fires. The run id is `<scheduleId>:<occurrenceMs>`, so a fire
     is idempotent across processes, restarts and crashes. No OS service is
     added on the user's own PC (D4); a node (M110) is the always-on host for
     schedules that must fire while the PC is off.
   - **Amended 2026-10-06 (Q-M115 item 1, the owner's yes): an opt-in OS
     scheduler entry.** At the first schedule the user makes, one question
     asks "Run schedules while editors are closed?" (**Yes**, **Not now**,
     **Never ask again**). With Yes, a per-user entry (Task Scheduler on
     Windows, a launchd agent on macOS, a systemd user timer on Linux) wakes
     `muse-spark-code-acp schedule run-due` at the next due fire only; it
     fires what is due through the same claim, then exits. No elevated
     rights, no long-running service: D4's exception, recorded here. The
     entry is shown and removable in Settings › Schedules (**Remove the
     background entry**), removed with the extension's uninstall cleanup
     where the editor allows and by `schedule background off`, and the node
     stays the recommended always-on host. Until the user says yes, nothing
     is registered.
   - **Clocks and sleep.** The scheduler compares the wall clock with the
     monotonic clock on each poll. A jump (sleep, a clock change, a
     time-zone change) recomputes every schedule, applies its missed-fire
     policy, and never fires an occurrence twice.
   - **The record.** Each fire is recorded: run id, schedule, target,
     delivery, outcome (ran, refused, missed, skipped, failed), the refused
     actions, and its cost with M102's certainty. M113's `/report schedules`
     reads it.

10. **Every editor** (D84):

    | Surface                                          | Schedules                                                                                                                                                   | When                               |
    | ------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------- |
    | VS Code family                                   | the schedule list, editor (kind, preview, zone, end, target, delivery, mode, grant, cap) and timeline; `/schedule` and `/loop`; the card's audit and Revoke | M115                               |
    | JetBrains IDEs, Visual Studio, Eclipse (M104b–d) | the same panel through the bridges; MHP's `schedules/*`                                                                                                     | contract in M115; wired by M104b–d |
    | The companion page                               | the same panel                                                                                                                                              | M115, on M104 lane C               |
    | ACP clients                                      | `/schedule add\|list\|remove\|run-now\|timeline`; the run's rows as session updates                                                                         | M115                               |
    | Any terminal                                     | `muse-spark-code-acp schedule add\|list\|remove\|run-now\|pause\|resume\|timeline\|fire <id> [--json]`                                                      | M115                               |
    | Headless `exec`                                  | refuses to create or host schedules (AGENTS rule 12, unchanged)                                                                                             | unchanged                          |
    | The TUI (M110a0 lane T)                          | a Schedules view and the timeline                                                                                                                           | with lane T                        |
    | Muse Desktop (M111b)                             | the panel; the bar's agents item lists the next fire                                                                                                        | with M111b                         |
    | A Muse Node (M110)                               | hosts schedules while the user's machines are off                                                                                                           | with M110a0                        |

11. **Event triggers** (the owner's third request). A schedule's trigger is
    a time (decision 4), an event, or both composed: "after event X, at 09:00
    the next weekday".
    - **Event sources** are pluggable and gated by capability: a source that
      cannot run here (no GitHub remote, no network setting, no M108) is
      listed as unavailable with its reason, never offered silently.

      | Source              | Events                                                                                                                                    | How it is read                                                                                                                                                  | Waits for                  |
      | ------------------- | ----------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------- |
      | GitHub and GitLab   | a pull request opened, closed or merged; a review requested; a CI run finished (passed or failed); a release published; an issue labelled | M113's network sources (M71's sign-in, `gh api`, or the public API), polled with ETags under `museSpark.reports.network`; webhooks on an M110 orchestrator host | M113 b (N); webhooks M110c |
      | Local git           | a branch updated; a tag created                                                                                                           | the repository's refs, read locally                                                                                                                             | —                          |
      | The plan            | a milestone's status changed; its certification checklist complete                                                                        | M113's plan reader under `check:plan`'s grammar                                                                                                                 | M113 a (P)                 |
      | Agents and the team | a turn, lane, task or team finished; a question answered (M112)                                                                           | the hosts' own events                                                                                                                                           | M96 for team events        |
      | Usage               | an M108 account crossing a threshold                                                                                                      | M108's threshold events                                                                                                                                         | M108                       |
      | Resources           | an M107 level change                                                                                                                      | the governor's events                                                                                                                                           | M107                       |
      | Files               | a watched glob changed (debounced)                                                                                                        | the editor's or the runtime's file watcher, inside the workspace                                                                                                | —                          |
      | Release channels    | a version live on the Marketplace, Open VSX or npm                                                                                        | M113's store sources                                                                                                                                            | M113 b (N)                 |
      | Manual              | a poke                                                                                                                                    | `muse-spark-code-acp schedule fire <id>`, or a webhook on an M110 host                                                                                          | webhooks M110c             |

    - **Conditions** are simple filters on the event's fields (repository,
      branch, author, label, milestone id, status), with a preview: "would
      have fired 3 times in the last 7 days", from history where the source
      keeps one, or "no history to preview" where it does not.
    - **Firing.** Per trigger, events are debounced and coalesced
      (`SCHEDULE_EVENT_DEBOUNCE_MS`, 30 seconds); each event instance has an
      at-most-once run id (`<scheduleId>:<source>:<eventKey>`, claimed as a
      time fire is), so it never fires twice across restarts; a missed event
      (no host was running) follows the schedule's catch-up policy. Every
      fire is unattended (decision 1), with the same delivery modes and
      targets.
    - **The event reaches the prompt as data, never as instructions:** a
      fenced, typed block (the pull request's title, number and URL; the
      milestone's id and status) marked as untrusted content, carrying D89.7's
      taint, so text in an event can never widen a grant, add a tool or
      change a target. Field lengths are bounded and the export's scrub runs
      over them.
    - **Agents' event triggers** follow decision 8's no-escalation rule,
      caps and loop guard; an event that an agent's own run causes (its
      merge, its finished lane) counts toward the depth.
12. **What it replaces.** M52's per-run **Run** modal and its "only a loaded
    session" rule; M52's seven-day lifetime (kept as `/loop`'s default end);
    M52's workspace-storage store (migrated); and M88's lane C, whose
    one-shot cadence, Muse Code timed sends and **Resume later** (a once
    schedule of `MODEL_TEXT.resumePrompt` in the failed turn's session,
    under M88's limit definitions) become M115's, unattended. If M88's lane
    C lands first, M115 builds on it. M45's goal wakes and M96c's task
    scheduler stay as they are. Muse Code's own cron tools stay the model's,
    inside its turns.
13. **A schedule's action is a prompt or a report** (amended 2026-10-06,
    with D93.18). The action is `prompt` (decisions 1–8) or `report`: an
    M113 kind with its arguments, format and destinations. A report action
    makes no model call and has no paid budget; it is unattended like any
    fire, its grant names its destinations, and its triggers, stacking,
    timeline, collision order and missed-fire policy are the same. The
    orchestrator's `schedule_report` follows decision 8.
14. **The issue watchdog** (M115w, a phase of its own). An "issue opened"
    event trigger (decision 11) on GitHub or GitLab hands each new issue to
    the orchestrator, which carries it from acknowledgement to the reply that
    closes it.
    - **The trigger.** Per repository, or an organisation rule, with the
      repository, label and author filters; received by polling (M113's
      network sources) or by webhook on an M110 orchestrator host.
    - **1. Acknowledge,** within minutes: a short comment from an editable
      template ("Thanks — we're looking into it."), in the issue's language
      where it can be detected with confidence, otherwise English, from the
      14 tables; a label such as `triage`. It never promises a date.
    - **2. Triage,** by a read-only triage agent (a role whose charter grants
      reads, searches and the repository's named check commands only, run in
      an isolated copy with no credential). It checks:
      - **validity:** can it be reproduced, is the information enough, is it
        spam or abuse;
      - **duplicates** among open and closed issues, pull requests and
        commits;
      - **already fixed** on the default branch or in a release;
      - **already in hand:** the plan's milestones, the lanes, open pull
        requests (M113's plan reader and sources).

      It reports structured findings (`triageFindings` v1): the verdict
      (`valid`, `needsInfo`, `duplicate`, `alreadyFixed`, `inProgress`,
      `invalid`, `spam`), evidence links, severity, affected versions and a
      proposed plan.

    - **3. Decide.** The orchestrator picks the outcome:
      - **needs info:** posts the questions, and the issue waits on an M115
        event (the author's reply);
      - **duplicate or already fixed:** links it and asks the author to
        confirm;
      - **won't fix or invalid:** explains politely, and closes only after a
        person approves;
      - **valid:** plans the work: a PLAN entry when it is milestone-sized,
        otherwise a fix lane.
    - **4. Orchestrate to completion** with the lead's own machinery (M96's
      teams and roles, M110's nodes) and the owner's issue workflow: a branch,
      the lanes, review, a pull request, the CI gate, the merge, the close,
      the release. It stays within the orchestrator's permissions and paid
      budget; anything outside them asks the user, and M112's deferral
      applies.
    - **5. Verify.** The reproduction runs again against the fix, and against
      the released build where the issue was reported on one; the evidence
      goes on the pull request.
    - **6. Reply** on the issue: what changed, the pull request, and the
      version once it ships. It closes by the repository's policy (on merge,
      or on release) and thanks the author.
    - **Safety.**
      - **Issue text is untrusted input** (D89.7's taint, decision 11's
        fenced block): it never changes a permission, never becomes a command
        (nothing from the body is run), and never chooses what is read or
        sent where.
      - **Every post carries an automated note**, as the repository's policy
        and GitHub's terms ask.
      - **Bounded:** per-repository rate limits, a daily cap
        (`WATCHDOG_ISSUES_PER_REPO_PER_DAY`, 20), and a spam and abuse guard
        (new accounts, link-only bodies, a burst from one author) that skips
        triage and tells the user.
      - **A person approves by default** closing, a `wontfix` label, and any
        public reply beyond the acknowledgement; per repository each can be
        relaxed with Ask, Always or Never.
    - **Status everywhere.** Each watched issue is a card in the
      orchestrator's Agent map, with its stage and what it waits for, and a
      row in `/report issues` (D93); those waiting on the owner come first.

<!-- plan-archive:end id="2-D95-01" -->

## D74 — Bring-your-own model providers and subscription sign-in (M95, M95b, M95c, 2026-10-04)

<!-- plan-archive:begin id="2-D74-2-01" lines="17608-18191" bytes="39185" sha256="8c69844e7a29a76eb2eeb02e8a10b875ed2ce357806801bf9d203d86baf399dd" -->

The owner (2026-10-04): "i want to make sure we have the harness properly
built to handle byo agents via the config file, so users can plug in an api
key and model and provider info and the harness will use the proper hooks and
everything, and it would be really cool if we could make this as easy and
secure as possible", "maybe a wizard or something super easy", then "where
we can i would like to build in connecting your account subscription and use
your inference. i know openai just released this as a capability", "and
supporting models and api keys from open router?", and "i would like for the
ui for all of the byo and role stuff to be easy to use and configure with drop
downs and filters and search and prefills adaptive autofill fresh model scans
etc to make it as simple and easy for our users". The research, every fact
with its official source and the date it was read, is
`docs/certification/m95-research.md`.

What the research settled:

- **The harness already has one canonical wire.** `ModelApiHost` builds and
  reads only Meta's Responses shapes (`CreateResponseBody`, the
  `StreamEvent` union, `ResponseObject`) and reaches the network only
  through its `client`: `streamResponse`, `countInputTokens`, `listModels`,
  `currentKeyDigest`, `retryDelayMs` and `waitBeforeRetry`, plus Meta's
  image calls. The tools, permissions, checkpoints, hooks, `then_run`,
  ObservationPack, `recall_output`, the verify loop and the budgets work on
  that shape and name no host (research §3.1).
- **Five wire formats cover the requested providers.** OpenAI Responses
  (OpenAI, Azure OpenAI's v1 API, xAI; OpenAI's current reasoning models
  call tools only there), Chat Completions (OpenRouter, Groq, DeepSeek,
  Mistral, Together, Fireworks, Hugging Face's router, Z.ai, LM Studio,
  vLLM, llama.cpp, any compatible server), Anthropic Messages (Anthropic;
  Claude on Bedrock), Gemini
  `generateContent`, and Ollama's native API, which alone lets a request
  set `num_ctx`: its default under 24 GiB of VRAM is 4k, which our prompt
  and tools overflow silently through its `/v1` (research §1).
- **Caching and reasoning differ per provider, and both bind the cached
  prefix.** Explicit breakpoints on Anthropic (at most four, reads looking
  back 20 blocks, the TTL counted from the request's start); automatic
  caching with a routing key on OpenAI, xAI, Mistral, Fireworks and
  DeepSeek; implicit caching and paid stored caches on Gemini; nothing
  priced locally. Cache prices are per model (Anthropic reads 0.1×, 0.05×
  on Opus 5.5, 0.025× on Fable and Mythos 5.1; writes 1.25× or 2× on
  Anthropic, 1.25× on OpenAI's GPT-5.6 and later). Reasoning goes back only
  to its own provider, in its own form: encrypted items, signed thinking
  blocks, Gemini's thought signatures in their exact part, DeepSeek's
  `reasoning_content` on every earlier turn when tools are sent.
- **Two findings change our harness.** Anthropic's preserved thinking (Fable
  5.1, Opus 5.5, Sonnet 5.5) makes a replayed thinking block invalid once
  anything before it changes, and ObservationPack's sticky swap and the
  media budget's omission are such changes. And vLLM refuses an empty tool
  list, OpenRouter wants tools on every request, and Anthropic's cache
  breaks when tools change, where our compaction sends `tools: []`
  (research §5).
- **The leaders.** Zed and Copilot BYOK keep keys in the keychain or secret
  storage; Cline (since its move off SecretStorage), OpenCode, Kilo and
  Continue keep them in plain-text files; Continue, OpenCode and Roo let a
  workspace file redirect a stored key. Continue is read-only and Roo
  archived this year. Most require the window of an unknown model; Aider
  then assumes the model "is free", which we must not (research §2).
- **Subscriptions.** Sign in with ChatGPT with plan usage shipped on
  2026-09-29 for open-source apps that run locally, with no registration;
  Copilot's models reach another extension through `vscode.lm`, reduced;
  OpenRouter connects an account by OAuth and returns a key; Anthropic and
  Google forbid using their consumer plans from a third-party loop
  (research §6).

Decisions:

- **One canonical format; adapters only at the wire.** A `ProviderClient`
  interface (`src/core/backends/modelapi/providerClient.ts`) has exactly the
  client calls the host makes today, plus the provider's identity and the
  model's capabilities. Meta's `ModelApiClient` is its first
  implementation, unchanged on the wire. Every other provider is the shared
  transport plus a codec for its format: the codec turns a
  `CreateResponseBody` into the provider's request and the provider's stream
  back into canonical `StreamEvent`s ending in a canonical `ResponseObject`.
  `ModelApiHost` keeps building one body and reading one stream; at each of
  its nine call sites (and the Auto reviewer's one) it asks a `ProviderRegistry` for the client of the
  conversation's model.
- **The shared transport** is `client.ts`'s request loop moved to
  `transport.ts` with no change in behaviour (the retry budget,
  `Retry-After`, the idle stall, the admission guard, the scheduled-run
  confirmation, the credential read per attempt). It adds the origin check,
  `redirect: 'error'` on every request (Meta's too: today a redirect would
  carry the Bearer header), and a per-format error parser that maps each
  envelope to `ModelApiError` and to the `HTTP 429:` reason the host's
  rate-limit retry reads. Credentials come from an `AuthSource` per auth
  mode, so nothing above the transport knows how a header was obtained.
- **Auth modes.** A provider's `auth` is `apiKey` (pasted, or obtained by
  OpenRouter's OAuth), `none` (a local server) or `subscription` (M95b: a
  ChatGPT plan's tokens, or Copilot's models through VS Code). Roles in
  M96 pick models through the same registry whatever the mode.
- **Presets, not free-form.** Each provider the panel lists is a preset in
  `src/core/providers/presets.ts`: its format, fixed origin (or the fields
  the user gives: Azure's resource and deployment, a local port, a custom
  server's address), auth header, key page and key shape, the free key
  test, the models-list parser, and the format's quirks as data (the
  output-cap parameter, `parallel_tool_calls`, `tool_choice`, the reasoning
  field and replay rule, usage in the stream, the cached-token field, the
  empty-tools rule). **Custom server** (Chat Completions, Responses or
  Anthropic Messages) and the local servers are presets too, with Zed's conservative defaults (no parallel
  calls, no images, the window required).
- **Model references.** A BYO model is `<providerId>/<modelId>`
  (`anthropic/claude-sonnet-5-5`, `openrouter/deepseek/deepseek-v4-pro`,
  `ollama/qwen3:8b`), the convention OpenCode, LiteLLM and Aider use. Meta's
  models stay bare (`muse-spark-1.3`), so every Meta request, stored session
  and hook payload keeps its bytes. Provider ids match
  `^[a-z][a-z0-9-]{0,31}$`; `meta` is reserved. Price cards, capabilities,
  usage tallies and budget admission are all addressed by the reference, so
  M96 can cap a role's model without anything here changing.
- **Where providers live.** One user-level file,
  `<config home>/muse-spark-code/providers.json` (`$XDG_CONFIG_HOME` or
  `~/.config`, as the extension already finds Muse Code's config home),
  read by the extension and the ACP agent and written only by the Models &
  Agents panel, the quick pick and `muse-spark-code-acp providers`. Not Muse
  Code's `<config home>/muse/`: Muse Code 1.4.2 owns that folder and already
  has providers of its own (`--provider echo|meta|local`, research §3.4).
  The file holds ids, presets, addresses, chosen models, user-entered
  prices, OpenRouter's routing choices and the default model; never a
  credential: a provider's secret is named after its id. No VS Code setting
  names an endpoint. A workspace may only suggest a preset by id
  (`museSpark.suggestedProvider`, never a URL), which offers the panel
  with that preset chosen; nothing is configured until the user finishes
  it.
- **Credentials.** In VS Code, the SecretStorage entry
  `museSpark.provider.<id>`; in the ACP agent, the same account name in the
  OS store (D61). The value is a record parsed with zod
  (`{v, auth, origin, …}`): **every credential is bound to the exact origin
  it was obtained for** (and a subscription's refresh token to its issuer). Before every
  request the transport compares the origin it is about to call with the
  record's; a mismatch (the file edited, by hand or by anything else)
  refuses the request and asks for the credential again, naming both
  origins. Keys are entered only in VS Code's password box
  (`showInputBox({password: true})`, never the webview) or, outside VS
  Code, from standard input; never an environment variable, a setting, a
  file or an argument (AGENTS.md rule 8). Removing a provider deletes its
  secret and, for a subscription, revokes its tokens. Meta's key keeps its
  own secret and flow.
- **Transport rules.** HTTPS only, with VS Code's certificate handling and
  verification always on; plain HTTP only to a loopback address
  (`127.0.0.0/8`, `::1`, or `localhost` when every answer is loopback),
  shown as "local". No user information, query or fragment in an address.
  An HTTPS address on a private network (RFC 1918, `100.64.0.0/10`,
  `fc00::/7`) asks once when it is saved and is recorded as private;
  link-local addresses and the cloud metadata addresses are refused. Each
  request checks the name's answers again, so a public provider whose name
  later resolves to a private or loopback address is refused (M69's ranges,
  with a classifier that tells loopback, private, link-local and metadata
  apart). Proxies follow VS Code's `http.*` settings through its patched
  `fetch`, as Meta's requests do (D43); a loopback provider never goes
  through a proxy (M95 step 1 captures whether VS Code's fetch would, and if
  so loopback requests use `node:http` directly).
- **Prices drive budgets, and are never guessed.** A model's price card has
  input, cached input, cache write (and the 1 h write where it differs),
  output, per-request and per-image prices where they exist, an optional
  long-context tier, and its source and date. Sources, in order: the
  provider's own models list where it prices (OpenRouter, xAI, Together,
  Groq, and Hugging Face's router per upstream; captured 2026-10-04, when
  Fireworks' lists carried no prices), the vendored models.dev snapshot
  (MIT, filtered and checksummed as D68's vendor is, refreshed by a script
  in a PR), what the
  user entered in the panel. A local model is free; a plan's model is
  "plan" (M95b). Anything else is **unpriced**: it runs, its tokens are
  counted and shown, the UI says "unpriced", and a session with a dollar
  cap refuses it before sending (M82's `sessionBudgetUnpriced`).
  `estimateCostUsd`'s Standard-rate fallback goes: an unknown id is
  unpriced. Reservations take the worst case (full input price, the
  long-context tier when the estimate reaches it, the highest upstream
  price OpenRouter or Hugging Face's router may route to); settlement takes
  the provider's actual cost where it reports one (OpenRouter's `cost`,
  xAI's `cost_in_usd_ticks` in 1e-10 USD). DeepSeek's off-peak half price
  is ignored (the peak price bounds it).
- **Windows and output caps** come from the provider's models list where it
  gives one (Anthropic, Gemini, xAI, DeepSeek, Mistral, Groq, OpenRouter,
  Together, Fireworks, Hugging Face's router, LM Studio, vLLM, llama.cpp),
  the catalogue otherwise (OpenAI, Azure, Z.ai), and the user for a custom
  server (required). Ollama's is the
  `num_ctx` the panel sets (32k, 64k or 128k, with the memory it takes
  said), never the trained maximum.
- **OpenRouter is first-class** (the owner, 2026-10-04):
  - **Connect or paste.** **Connect OpenRouter account** runs its OAuth
    PKCE flow (S256, a loopback callback on `127.0.0.1` with a random port
    and `state`, the code exchanged for a key the user controls); in a
    remote window or the ACP agent, the flow without a callback, whose code
    the user pastes into the password box. The key is stored like a pasted
    one, bound to `https://openrouter.ai`.
  - **Models and prices** from `/api/v1/models` filtered to tool-capable
    models, with context, prices (prompt, completion, cache read, cache
    write, the 1 h write, request, image, tiers) and supported parameters,
    cached with the time they were fetched and refreshed on **Refresh** and
    when stale; per-upstream prices from the model's endpoints list bound
    the reservation.
  - **Credits and usage.** Account & usage shows the key's usage (day,
    week, month), its limit and what remains, from `/api/v1/key` (free).
    A key's own spend limit can only be set on OpenRouter's site, so the
    panel and Account & usage link to that key's page; the session budget
    (M82) is the extension's own cap.
  - **Privacy routing, private by default.** The panel's privacy choice:
    **No data retention** (`provider.zdr: true`; the default), **No
    training** (`provider.data_collection: "deny"`), or **Any provider**,
    each explained in one plain sentence, plus an optional provider order
    and whether to fall back. The model list follows the choice
    (`?zdr=true`), and a 503 for "no provider meets your routing" says the
    privacy choice ruled every provider out. The routing object is fixed
    per provider, so it never moves the prefix.
  - **Caching and reasoning pass through.** For Anthropic upstreams the chat
    codec places Anthropic's breakpoints (the same rule as the `anthropic`
    codec) on text parts; for Gemini upstreams only the last; others cache
    automatically. Reasoning goes as `reasoning {effort}` and comes back as
    `reasoning_details`, replayed unmodified and in order to the same
    model only.
  - **Attribution.** `HTTP-Referer: https://github.com/RandyNorthrup/muse-spark-code`,
    `X-OpenRouter-Title: Muse Spark Code (Unofficial)` and
    `X-OpenRouter-Categories: ide-extension`: the public name and the
    repository, nothing about the user, the same bytes on every request.
- **What stays Meta's.** Web search (`web_search` runs inside Meta's
  Responses API; offered only while the conversation's model is Meta's),
  Muse Voice (a composer feature billed to the Meta key, whatever the
  model), image generation and edits (Meta's endpoints and key: offered in a
  BYO conversation only while a Meta key is stored and through D48, as on
  the Muse Code backend), the contributor tier and its dialog, `max`
  effort's rules, and the M75 evaluation (the contributor model, so its
  baseline stays comparable). Providers' own hosted tools (search on
  OpenAI, Anthropic, Gemini, OpenRouter) are billed per use and come in M95c,
  each behind D48 with that provider's price.
- **Every harness feature works per provider.** Tools and approvals,
  checkpoints, hooks, MCP servers, skills, memory, goals, the verify loop
  and `then_run` run in the extension and do not change. Subagents, the
  Auto reviewer, best-of-N and scheduled prompts keep their D48 consent,
  stating the BYO model's price card; an unpriced cloud model refuses them
  (`PaidUsage` already throws), a local model runs them free. A custom
  agent may name a BYO model (`agentImport.ts` stops requiring
  `muse-spark-`). For a BYO model the system prompt's identity line names
  the model and provider; Meta's text is unchanged.
- **SoL-Pi invariants, per provider** (the owner's rule of 2026-10-04):
  1. A codec is a pure function of the canonical body: no clock, no random
     id, keys in a fixed order, tool schemas rewritten the same way every
     time; earlier native bytes never change. Breakpoints follow one
     documented rule per format (Anthropic: the system block, which caches
     tools and system, and the last block of the request, rolling).
  2. ObservationPack projects before encoding, so codecs see what the model
     sees; the swap stays sticky. On Anthropic models with preserved
     thinking, the swap waits for a user-turn boundary, and thinking blocks
     that follow a changed position are left out before the next user turn
     (or dropped by the API where the model offers the beta); M95 step 13
     captures both behaviours on Anthropic before this is built.
  3. Extra model calls on a BYO model share D48's gate and the budget.
  4. `then_run` is unchanged.
  5. The hard-limit compaction uses the model's own window and cannot be
     blocked. Where a provider refuses an empty tool list or needs tools
     alongside tool history (vLLM, OpenRouter; Anthropic and Bedrock to be
     captured), the compaction request keeps the turn's tools and
     `tool_choice: auto`, which also keeps the cached prefix; Meta's
     compaction is unchanged.
  6. The M75 evaluation runs Meta's contributor model only; no provider is
     configured in it.
  7. A golden request test per codec, and Meta's: with no provider
     configured, Meta's request bytes equal those recorded at `1e93c67c`.

  M74's cache economics, when built, read the model's window and price card
  (cache read, cache write, input, output) from the registry; unpriced,
  local and plan models get the window rule only.

- **Hooks fire the same on every provider.** Every M51 and M91 event runs
  from the host, whatever codec answers. `model_provider` and the model-call
  payloads' `provider` carry the provider id (`meta` for Meta, unchanged);
  `model` carries the qualified reference; the provider option keys use the
  id (`anthropic.reasoning.effort`). A matcher on `meta` matches what it
  matched before.
- **Accounts.** The Model API backend is available when a Meta key or any
  provider is configured. Its account stays the Meta key's SHA-256 while a
  Meta key is stored (stored sessions, budgets and schedules keep their
  owner); with no Meta key, a random local profile id kept in SecretStorage
  owns them. History lists both when both exist. A scheduled run's
  confirmation binds the provider id, its origin and that credential's
  digest.
- **One "Models & Agents" panel** (the lead's decision on the owner's UI
  request): a webview tab of its own, with sections. M95 builds the panel's
  framework and its **Providers** and **Models** sections; M96 adds
  **Roles** and **Agent map** to the same panel through the same section
  registry, state and components. It opens from the sign-in page, the
  model picker's **Add a model provider…** and **Manage models…** rows,
  **Muse Spark: Models & Agents**, and a provider's notice.
  - **Providers.** A searchable provider dropdown (type-ahead, a one-line
    description per provider) with filter chips: Cloud, On this computer,
    Subscription sign-in (M95b), Aggregator. Choosing one prefills all the
    preset knows: address, wire format, auth mode (key, connect, sign-in),
    the key's shape as a hint, the docs and data-use links, the privacy
    note, and **Get a key** (the provider's key page). **Scan this
    computer** probes the local servers' default loopback ports and
    prefills what answered. The key goes in through **Enter key…**, which
    opens VS Code's password box with the preset's shape checked as it is
    typed: the key never enters the webview. **Test** makes the free check,
    or states the one-token request's cost and asks before sending it.
    Nothing is saved until the form is valid; errors are inline, in plain
    words.
  - **Models.** A fresh scan of each provider's models on add, on
    **Refresh**, and when its cached scan is stale (older than
    `PROVIDER_SCAN_STALE_MS`, or a newer catalogue snapshot): cached with
    its time, cancellable, one at a time per provider, and diffed against
    the last scan ("3 new models since the last scan", removed models and
    changed prices named). A searchable, sortable table with filters (tool
    calling, vision, reasoning, a context range, input, output and cached
    price ranges, free or local, provider, family), badges (Recommended,
    Cheapest capable, Largest context, New), pinned favourites (first in
    the composer's picker), and the models the picker offers ticked.
  - **Adaptive prefill.** A local suggestion engine
    (`src/core/providers/suggest.ts`) proposes values, each with its reason
    and **Accept** or **Change**: the default model (the cheapest model
    that calls tools and fits the context the harness needs, or the
    recommended one), a session budget from the model's price card and the
    median of the user's own recent sessions (M82's local tallies; a stated
    assumption when there is no history), and the last choices made.
    M96 adds its role suggestions (the cheapest capable model for research,
    a different vendor for review than for engineering, role caps) to the
    same engine. No telemetry: only local data and the vendored or fetched
    catalogues.
  - **Undo, import and export.** A removal waits ten seconds behind
    **Undo** before its secret is deleted (or completes at the next start if
    the window closes first). The non-secret configuration exports and
    imports as JSON for a team; credentials are never in it, an imported
    file is untrusted (validated, previewed as a diff, each address shown
    and confirmed, every provider marked "needs a key").
  - **Accessible, translated, narrow.** Every control labelled; the
    dropdowns follow the combobox pattern with type-ahead; the table is a
    grid with arrow keys and Enter; at 320 px the table becomes a list of
    cards; all 14 languages; the accessibility gate with a harness scenario
    for every state.
  - **The quick-pick fast path.** **Muse Spark: Add Model Provider…** and
    `muse-spark-code-acp providers add` in a terminal run the same flow
    (`wizardFlow.ts`, one pure state machine) without the panel: pick a
    provider, enter or connect the credential, test, pick models, confirm.
  - **Start with your own model** (the owner, 2026-10-04: "as part of this
    whole push i would like to add a button to the first run screen to begin
    with a byo model and this should kick off a wizard").
    - **The first-run screen.** This is the panel's sign-in gate
      (`SignIn.tsx`, shown while no credential exists, in its sign-in state
      and its no-CLI install state). It gains a third primary choice,
      **Start with your own model**, beside **Sign in with Muse** (the
      subscription) and the Meta Model API key.
    - **No backend at all.** When no backend is set up, the three choices
      rank equally: the same button style, in a row or a stack, and Muse is
      not presumed.
    - **What it opens.** The Models & Agents panel's wizard, straight at
      "Pick a provider", through the command `museSpark.startWithOwnModel`.
      The getting-started walkthrough (`contributes.walkthroughs`) gains a
      matching step whose command link runs it.
    - **When the wizard finishes:**
      - the chosen model becomes the composer's model and the default model
        (`providers.json`'s `defaultModel`, which M96's orchestrating role
        reads as its default);
      - the panel leaves the first-run state, and the composer accepts a
        message at once;
      - a short confirmation, "You're set up with `<provider>` ·
        `<model>`", links to **Manage providers**.
    - **Cancel**, at any step, returns to the first-run screen with nothing
      saved: no provider in `providers.json`, no secret in SecretStorage.
      The wizard keeps a draft only in memory and writes the file and the
      secret together at **Save**.
- **The picker.** The composer's list shows Meta's models (with a Meta key)
  and the chosen BYO models, grouped by provider, each with its window and
  price, "unpriced", "local" or "plan". A conversation can switch between
  any of them; the previous provider's reasoning items are dropped when the
  next request goes elsewhere. On the Muse Code backend the list offers the
  panel and, for a BYO model, the existing backend switch (which ends open
  conversations, as its confirmation says). A confidential workspace
  (`museSpark.confidentialWorkspace`) hides models whose provider or route
  may train on the content (OpenRouter's "Any provider" routing, Copilot on
  individual plans), as it hides Meta's contributor tier.
- **Headless and the ACP agent.** The same `providers.json`;
  `muse-spark-code-acp auth set --provider <id>` (standard input, the OS
  store); `providers list|add|test|remove`; the agent's model options list
  the BYO models; `exec --provider <id> --model <model> --key-stdin` for CI,
  with exec's origin pin and path allowlist per codec, and only a provider
  from the runner's user file or a built-in preset's fixed origin, never a
  repository file. The credential variables the agent strips gain
  `AWS_BEARER_TOKEN_BEDROCK`, `ANTHROPIC_AUTH_TOKEN`, `HF_TOKEN` and the
  presets' key variables.
- **Redaction** gains the presets' key shapes (Groq `gsk_`, xAI `xai-`,
  Fireworks `fw_`, Hugging Face `hf_`, Bedrock `ABSK`), each in the
  `MAY_HOLD_SECRET` prefilter; a key with no prefix is caught by the header
  and field rules and by the exact value the transport registers for the
  life of each request. Account ids are redacted too, as the 2026-10-04
  captures found them: xAI's error text names the team id, OpenRouter's
  error and `/key` bodies carry `user_id`, `creator_user_id` and
  `workspace_id`, and Anthropic's and OpenAI's headers carry organization,
  workspace and project ids. So the id fields, those headers, and a UUID
  after "team", "account", "organization" or "project" in prose never reach
  a log, a notice or a hook.
- **Lazy, within budget.** The codecs, registry, transport additions and
  catalogue reader build to `dist/providers.js`, required the first time a
  BYO model is listed or used; the panel's host side and the quick pick to
  `dist/modelsPanel.js`; the panel's React app to `dist/webview/models.js`,
  a second webview entry beside `main.js`; the catalogue snapshot ships as
  data (`dist/providerCatalog.json`), not code. Activation gains only
  command registrations and loaders; a Meta-only user who never opens the
  panel loads none of it (D6).
- **Subscriptions (M95b).** Official, provider-sanctioned flows only; another
  application's client or stored tokens are never read or reused.
  - **ChatGPT plan** (`chatgpt`, Responses codec): **Continue with
    ChatGPT** runs OpenAI's documented flow (PKCE S256, the dynamic client
    `dynamic_agent_client` with `agent_name_hint` "Muse Spark Code
    (Unofficial)" and a persistent opaque host id, the issued client kept;
    the scopes including `chatgpt.tokens.use.direct` and the resource
    `https://api.openai.com/v1`; the callback on `http://127.0.0.1:<port>/auth/callback`
    from a one-shot loopback server; the system browser through
    `vscode.env.openExternal`; the ID token checked against OpenAI's JWKS
    with `node:crypto`, no dependency). Tokens live in SecretStorage, the
    refresh token bound to `https://auth.openai.com` and the access token
    to `https://api.openai.com`; refreshes are serialised across windows by
    a lock in the extension's global storage; sign-out revokes the refresh
    token. The codec follows OpenAI's preview rules: full history every
    turn, `store: false`, `stream: true`, no `max_output_tokens` (the host
    ends a reply that passes the output cap itself), no
    `prompt_cache_retention`, tools as the documented namespaces where
    plain function tools are refused. The UI follows OpenAI's rules: the
    one-time "You're using your ChatGPT plan" notice, a "Using ChatGPT plan"
    mark beside the model pill with **Manage usage**
    (`https://chatgpt.com/settings/usage`), and a usage-limit screen on
    `subscription_sharing_usage_limit_exceeded`; Plus and Pro only, said
    before sign-in. Our own code from the docs, never OpenAI's
    Noncommercial DevKit.
  - **Copilot's models** (`copilot`, VS Code only): **Use my Copilot
    models** calls `vscode.lm.selectChatModels({vendor: 'copilot'})` from
    that click, so VS Code shows its consent dialog with our justification.
    A host-side `ProviderClient` maps the canonical body onto
    `sendRequest` with tools (stable since 1.95; images feature-detected
    from 1.106), the instructions in the first user message (no system role
    in the stable API). It is labelled **reduced**: Copilot prepends its own
    rules, so the prefix is not ours; there is no cache control or usage,
    so budgets count estimated tokens (`countTokens`), M74's economics get
    the window rule only, and reasoning is not replayed; quota and rate
    errors (`Blocked`, `ChatQuotaExceeded`, `ChatRateLimited`) are said in
    plain words. GitHub's acceptable-use policy is met in the UI (an
    AI-content note, a report link) and README; its
    competitive-benchmarking clause and individual-plan training terms are
    stated in README and PRIVACY.
  - **Plan keys.** MiniMax's M Plan, Alibaba's Coding Plan and Mistral's
    plans issue keys meant for tools like ours: they are API-key presets
    whose models are marked "plan", with the plan's limits linked.
    Hugging Face's OAuth (the `inference-api` scope, PRO's monthly
    credits) comes once the owner has registered the app; its token
    preset serves meanwhile.
  - **Not offered.** Anthropic plans in our loop ("Anthropic does not permit
    third-party developers to offer Claude.ai login … or to route requests
    through Free, Pro, or Max plan credentials"); Google's consumer tiers
    (forbidden for third parties, and no longer served since 2026-06-18;
    the panel says AI Pro and Ultra's monthly Cloud credits can pay for a
    Gemini API key); xAI's, Z.ai's and Kimi Code's plan sign-ins (settled
    below).
  - **Billing honesty.** Plan use is not paid in D48's sense (the user's
    plan pays, not a key the extension spends), so it asks no paid-use
    popup; it is tallied (tokens where reported, requests always) per
    provider in Account & usage, the picker and pill say which plan pays,
    and where the provider can spend credits beyond the plan (ChatGPT's
    credit setting, Copilot's AI credits) the one-time notice says so.
- **Not taken.** Provider SDKs (`openai`, `@anthropic-ai/sdk`,
  `@google/genai`, the AWS SDK: D2's reasons and their size); LiteLLM (a
  Python proxy); fetching the catalogue at run time; environment-variable
  keys (Zed's and Aider's way; rule 8); provider settings in a workspace;
  plain HTTP off loopback; OpenAI's DevKit code (Noncommercial licence).
- **Settled on the owner's delegation.** The owner (2026-10-04): "use your
  best discretion for all of the unanswered questions but i want the app to
  be robust and feature rich". Each question is settled the fuller way the
  security rules and SoL-Pi invariants allow:
  - **Which presets ship.** All are built; each is listed once its own
    capture is recorded (rule 13). The three generic formats are captured
    first from local servers, which serve Chat Completions, Responses and
    Messages alike. _Reason:_ the widest list rule 13 permits, with no
    preset waiting on a format.
  - **Custom servers in every format.** The custom preset speaks Chat
    Completions, Responses or Anthropic Messages, as Copilot's and Kilo's
    custom endpoints do. _Reason:_ gateways (LiteLLM, vLLM, OpenRouter's
    Messages API) speak more than one.
  - **Without Meta.** The sign-in page offers BYO providers to a user with
    no Meta key and no Muse Code; the README and the listing keep Muse Spark
    first and name other providers as a feature. _Reason:_ nothing in the
    harness needs Meta, and a user can add a Meta key later.
  - **Exposing models to VS Code's chat.** Built in M95c: off by default,
    per model, machine-scoped, only for priced or local models, under a
    daily dollar cap the user sets, every call tallied under "VS Code chat"
    in Account & usage. _Reason:_ one key serves Copilot Chat and other
    extensions too, and the opt-in, the cap and the tally bound the risk of
    callers the stable API cannot name.
  - **Bedrock.** M95c takes both long-term Bedrock API keys and AWS access
    keys signed in-process with SigV4 (`node:crypto`, no SDK), each entered
    in a password box and bound to its regional origin; no `~/.aws` file or
    profile is read (rule 8). _Reason:_ AWS calls long-term keys
    exploration-only, and SigV4 is small enough to keep the SDK out.
  - **Sign out.** Keeps its meaning; its confirmation offers "Also remove
    model providers and subscriptions", off by default. _Reason:_ no
    surprise loss of keys, and one place to clear everything.
  - **The local network.** Plain HTTP stays loopback-only (the transport
    rule above). A server elsewhere on the network is reached over HTTPS
    (the private-network question, a certificate the system trusts) or an
    SSH tunnel to loopback, both documented in the README. _Reason:_ the
    security rule forbids plain HTTP off loopback; these keep such servers
    usable.
  - **Sign in with ChatGPT.** Treated as eligible with no form: the
    extension is MIT, free and runs on the user's machine with no hosted
    backend, the docs' "open-source projects … that run locally". Built to
    OpenAI's UI and brand rules beside the "(Unofficial)" naming. _Reason:_
    what OpenAI's documentation says; the interest form stays the fallback
    if OpenAI rules otherwise.
  - **Copilot's models.** Built in M95b, opt-in from the panel's click,
    labelled reduced, with GitHub's acceptable-use items in the UI and
    README, and the competitive-benchmarking clause and individual-plan
    training terms stated in README and PRIVACY. _Reason:_ the sanctioned
    way to use a Copilot plan, and the clause asks nothing of the user.
  - **Claude plans.** A separate milestone after M95b runs the user's own
    unmodified Claude Code as a third backend beside Muse Code, with its own
    sign-in and never its tokens, as Anthropic's terms allow. _Reason:_ the
    only sanctioned way to use a Claude plan; it is a backend, not a
    provider. The publisher's acceptance of Anthropic's Commercial Terms is
    an owner step.
  - **Hugging Face.** A token preset in M95 (its router speaks Chat
    Completions); its OAuth sign-in in M95b once the owner has registered
    the app. _Reason:_ nothing is registered on his behalf.
  - **Partner and allowlisted plans.** xAI's SuperGrok sign-in, Z.ai's
    coding plan and Kimi Code's plan keys are not offered (partner-only,
    allowlisted, or terms too unclear to risk a user's account); their
    pay-as-you-go APIs are presets (xAI and Z.ai in M95; Moonshot in M95c).
    Z.ai moved into M95 on the owner's word of 2026-10-04 ("i want to also
    be able to use glm models from z ai").
    Asking them to list the extension is an owner step. _Reason:_ a user's
    account is never put at risk on unclear terms.
  - **Gemini's stored caches.** Not used: implicit caching only. _Reason:_
    a stored cache is immutable and billed by the hour while idle, so a
    growing conversation gains nothing from it.
  - **Gemini's Interactions API.** Not adopted while `generateContent` is
    supported. _Reason:_ explicit caching exists only on `generateContent`,
    and one stable codec beats two.
  - **Custom request headers.** M95c, user scope only: the names in
    `providers.json`, the values in SecretStorage bound to the origin as
    keys are, never overriding the auth or content headers. _Reason:_
    gateways need tenant headers, and their values can be secrets.
  - **Remote windows and the ChatGPT callback.** M95b's step 1 checks two
    routes, and the first that works is built: `vscode.env.asExternalUri`
    giving the remote callback a `127.0.0.1` address on the user's machine,
    or a sign-in made once in a local window being readable from remote
    windows (if VS Code keeps extension secrets on the local side). Only if
    neither works does a remote window say to sign in from a local one.
    _Reason:_ OpenAI allows only a `127.0.0.1` redirect, and both routes
    keep to it.
- **Settled from the live captures** (2026-10-04,
  `docs/certification/m95-captures.md`). The twelve cloud presets' wires
  were captured with the owner's keys: 46 model-call attempts, 44 billed,
  about $0.07. Where a capture differed from the research, the fuller and
  more robust option was taken:
  - **Z.ai** is a `chat` preset at `https://api.z.ai/api/paas/v4`, with
    `tool_stream: true` and `reasoning_content` replayed, not the Anthropic
    route. _Reason:_ the general API is the documented pay-as-you-go
    endpoint; its Anthropic route is documented for the Coding Plan, signs
    with a non-Anthropic signature and reports no cache writes. Business
    codes 1113 and 1308 arrive as 429 and are not retried.
  - **Anthropic's header** is `Authorization: Bearer` on the Anthropic
    preset, accepted live; the Anthropic-format Custom server defaults to
    `x-api-key`. _Reason:_ each origin gets the header it documents (Bedrock,
    Z.ai's route and gateways take `x-api-key`).
  - **Anthropic thinking can be absent**, even on Opus 5.5 at adaptive `low`,
    and on 5.x its text is omitted with the signature carrying it. The codec
    assumes no thinking block, replays an empty-text block with its
    signature byte for byte, and keeps new fields (`tool_use.caller`,
    `container`, `stop_details`). _Reason:_ all of this was seen on the wire.
  - **The compaction rule keeps tools** on every non-Meta codec, although
    Anthropic and OpenRouter accepted tool history without `tools`.
    _Reason:_ the cached prefix and vLLM's empty-list refusal still need it.
  - **xAI** sends its own single `function_call_arguments.delta`; the
    Responses codec accepts that and never synthesises one. Its
    `cost_in_usd_ticks` settles like OpenRouter's `cost`.
  - **Together's list is not proof a model runs.** A listed model can be
    non-serverless (a free 400 `model_not_available`). Badges and default
    suggestions draw only on catalogue-marked serverless models, and the
    refusal is said in plain words with Together's link.
  - **DeepSeek** did not refuse a missing `reasoning_content` in the current
    turn; the codec replays it on every earlier turn anyway, as documented.
  - **Gemini.** Tool calls are detected by `functionCall` parts, since the
    finish reason is `STOP`. Error bodies are read by content, since a JSON
    error arrives under `text/event-stream`. Implicit caching was not seen in
    two calls, so its cached count is unknown.
  - **Chat usage can share a chunk with deltas** (Mistral sends the tool call,
    the finish reason and the usage in one chunk). The codec reads both from
    every chunk.
  - **Prices and windows from lists.** Groq and Hugging Face's router join
    the list-priced sources; Fireworks moves to the catalogue. Fireworks' and
    Hugging Face's lists give windows.

<!-- plan-archive:end id="2-D74-2-01" -->

## D98 — Prompt and chat sharing (M118, 2026-10-06)

<!-- plan-archive:begin id="2-D98-01" lines="18592-18716" bytes="7502" sha256="7ecd41c7851dc703e61502c6661357a8570396bfb3a9088e1a754a4cdb9d79c8" -->

The owner, 2026-10-06, as soon as possible: "what i would like to setup asap
is prompt sharing to share either saved prompts or from a chat and chat
sharing which shares the entire chat transcript the user chooses either long
form or without the commands and non human type stuff". And: "make sure that
part of the right click menu for prompts is save and that we can load saved
prompts into a chat in any workspace".

**What exists** (read on main):

- **Export:** `museSpark.exportConversation`
  (`src/host/conversation/exportConversation.ts:156–196`) in Markdown
  (`renderTranscriptMarkdown`), JSON (M84's portable document,
  `sessionTransfer.ts:84–100`, whose `buildSessionExport` scrubs credential
  shapes, the key digest, account ids and paths, lines 493–518) and Muse
  Code's session log. The palette's rows are `src/shared/palette.ts:293–328`,
  with M84's read-only share view (`ShareView`, opened by `openShareFile`).
- **No saved-prompts library is built.** D67 planned one (M88's lane A, in
  VS Code's `globalState` and `workspaceState`); D98 supersedes D67's storage
  for it (below), and M88's sequences and bookmarks stand.
- `museSpark.confidentialWorkspace` already keeps a workspace's content from
  leaving the machine (D77's rule).

1. **Saved prompts (new).**
   - **Save** from the composer (**Save prompt**), from any of the user's own
     messages in the transcript (the message menu's **Save as prompt**), or
     from the prompt library.
   - **Fields:** a title, the body, optional tags, optional variables
     (`{{selection}}`, `{{file}}`, `{{clipboard}}`, and named inputs asked for
     at use), and a scope:
     - **user:** in the agent data folder
       (`<agentDataFolder>/prompts/v1/`), portable across editors;
     - **workspace:** `.muse/prompts/<slug>.md`, Markdown with front matter,
       shareable through git.
   - **The library** has a picker with search and tags, **Edit**, **Delete**,
     **Duplicate**, **Insert** into the composer, and **Run**. Run asks for
     the variables; Insert never runs anything.
   - **Caps** as D67 set them: 200 prompts per scope, 80 characters per
     title, 10,000 per body. The editor says not to save secrets.
   - **Settings Sync** (D67's opt-in, the owner's 2026-10-03 answer):
     with `museSpark.syncPromptsAndBookmarks` on, VS Code also mirrors the
     user-scope library into a synced `globalState` key and merges it at
     start (the newest edit of each prompt wins).
   - **In right-click menus** (the owner's addition):
     - **Save prompt** in the context menu of the user's own transcript
       messages, of the composer (with its current text), and of an editor's
       text selection (VS Code's `editor/context`, and the native hosts'
       menus through MHP);
     - **Use saved prompt…** in the composer's context menu.
   - **Loaded anywhere** (the owner's addition):
     - user-scope prompts are available in every workspace, editor and
       surface (ACP, the CLI, the TUI, the companion page);
     - the picker shows the user-scope prompts and the current workspace's
       `.muse/prompts/`, each labelled by its scope; **Copy to my prompts**
       copies a workspace prompt into the user scope;
     - loading inserts into the active chat's composer, or starts a chat in
       that workspace; it never sends by itself.
2. **Prompt sharing.**
   - **Copy** as text or Markdown.
   - **Export** to a `.muse-prompt.md` file (front matter: the title, tags,
     variables and schema version).
   - **Phase 2:** a secret GitHub Gist through the user's own GitHub sign-in
     (M71), never public by default.
   - **Import** from a file, a pasted link or a gist, always with a preview
     first. An imported prompt is untrusted content: it is shown in full,
     never runs by itself, and its variables are listed. A link or gist is
     fetched only on the user's click, through the window's web fetch
     transport or M71's GitHub client, under a size cap.
3. **Chat sharing:** the whole chat, or a range (from message A to message
   B), in one of two modes the user picks:
   - **Full transcript:** every item: messages, tool calls and their outputs,
     commands, approvals and decisions, diffs, checkpoints, notices, and the
     reasoning summaries if they were shown.
   - **Conversation only:** the user's and the assistant's messages only. No
     tool calls, commands, outputs, approvals, system or internal notices, or
     reasoning. Assistant text that refers to a tool result keeps its text.
     Optional toggles: keep code blocks (on), keep attachments as names only
     (on), keep diffs (off).
   - **The filter is an allow-list:** conversation-only keeps the item kinds
     it names (`userMessage`, `agentMessage`) and drops every other kind,
     including one added later.
4. **Formats and destinations.**
   - **Formats:** Markdown; a self-contained, themed HTML page (M114's tokens
     once they land, the current theme's colours until then; light and dark;
     readable on a phone); JSON in a versioned schema (`chat-share` v1, its
     JSON Schema committed under `docs/schemas/`). Same transcript, options
     and `exportedAt` give the same bytes.
   - **Phase 1 destinations:** copy, save to a file, open in the browser.
   - **Phase 2:** a secret gist link.
   - **Phase 3:** a private link hosted on the user's node (M110: gated by a
     token or a passkey, expiring), the team library (M96), and email (M113's
     and M115's destinations).
5. **Privacy, always.**
   - **A preview pane** shows exactly what will be shared, with the
     redactions highlighted.
   - **The scrub:** M84's scrub (which M113's renderers also use) covers
     credential shapes and registered values (M108's and M109's as they
     land); absolute paths become workspace-relative; the user name and home
     path are replaced; attachments' contents are left out unless chosen.
   - **A confidential workspace refuses to share,** as M98's rule does.
   - **Nothing leaves the machine** without a click on the final **Share**,
     **Copy** or **Save**.
6. **Surfaces.**
   - **VS Code:** **Share** in the panel's header; the message menu; the
     palette's **Muse Spark: Share chat…**, **Share prompt…** and **Prompt
     library**; the right-click menus of decision 1.
   - **The companion page and the native hosts** through MHP (the handoff to
     M104).
   - **ACP:** `/share chat [--mode full|conversation] [--format md|html|json]`
     and `/prompt save|list|use|share`.
   - **The CLI:** `muse-spark-code-acp share …` and `prompts …`.
   - **The TUI.**
   - All editors equal; the 14 tables; the `/help` reference; accessibility.
7. **Tests.**
   - A mode-filter golden per item kind: conversation-only drops every
     non-human kind. The red drill adds a new item kind and shows it is left
     out by default, so the filter is an allow-list, not a deny-list.
   - The scrub; range selection; a prompt's round trip (save, export, import:
     nothing lost); an untrusted import never runs by itself; determinism of
     exports; the HTML's accessibility.
   - The right-click menus on each surface; user-scope prompts in every
     workspace; scope labels and duplicates.
8. **Phases.** Phase 1 (saved prompts, the menus, loading anywhere, copy,
   file export and import, chat sharing to copy, file and browser) targets
   the next patch release after 0.14.3; phase 2 (gists) the one after;
   phase 3 with M110, M96, M113 and M115.

<!-- plan-archive:end id="2-D98-01" -->

## D76 — `/legal`: evidence first, fixes only after selection (M97, 2026-10-04)

<!-- plan-archive:begin id="2-D76-01" lines="19053-19155" bytes="7900" sha256="23f81b84fc8193a24f27d9b28e935b2459466c582fd2f4f100431c03a2857908" -->

- **Project and dependency licenses.** Recognize LICENSE/COPYING and SPDX
  declarations using pinned matching data; compare project manifest and README
  declarations. Preserve custom `LicenseRef` text and unknown/UNLICENSED or
  proprietary declarations. Parse `AND`, `OR`, `WITH` and parentheses; an `OR`
  alternative is a choice, not two mandatory licenses, and an exception changes
  the analysis. Flag possible GPL/AGPL obligations when an MIT/Apache project
  combines or distributes that code, LGPL linking/source/relinking questions,
  and MPL file-level obligations, with version and usage evidence. Do not call
  permissive-to-GPL combination categorically incompatible. Flag SSPL,
  Business Source License (`BUSL-1.1`, distinct from Boost `BSL-1.0`), Commons
  Clause and CC-BY-NC restrictions; SPDX recognition is not OSI approval.
- **What actually ships.** Separate development, production, optional and
  transitive dependencies, then identify distributed ones from existing bundle
  metafiles and package manifests/inventories. A dev dependency can still ship.
  Reuse the approach in `scripts/third-party-notices.mjs`, which reads esbuild
  inputs and actual license/NOTICE files; its permissive allow-list is not a
  universal compatibility engine. Check upstream Apache NOTICE obligations
  when a NOTICE exists, complete `THIRD_PARTY_NOTICES` for bundled/vendored
  code, and inclusion through `.vscodeignore` / package `files`. Absent or stale
  build evidence leaves distribution unknown; scanning never rebuilds or packs.
- **Copied code and assets.** Find vendor folders, foreign headers and source
  references such as “adapted from”, CodePen and Stack Overflow. Preserve source
  URLs, attribution and license evidence; a source mention is only a lead.
  Stack Overflow uses CC BY-SA versions tied to contribution dates, not one
  guessed version. Check fonts, icons, images and sounds for adjacent license
  files, `.license` sidecars or REUSE declarations; known restricted families
  need provenance evidence, not a verdict from their filenames.
- **The owner's code-quality scope is header hygiene.** Check SPDX identifiers
  against the applicable license and existing copyright holders/year format.
  `museSpark.legalHeaderPolicy` is a workspace enum `required` / `optional` /
  `off`, default `optional`, honoring the detected project style and REUSE
  declarations. Generated files are excluded from header checks and the report
  names that exclusion; shipped generated code still counts for notices.
  Multiple upstream holders can be legitimate. An earlier year alone is not
  stale; flag conflicting/impossible dates or a breach of the chosen policy.
  Never invent ownership or replace third-party headers with the project owner.
- **Other risks are explicitly heuristic.** Third-party marks in names, icons
  and README, and missing disclaimers (this product remains Unofficial / not
  endorsed by Meta); apparent data collection without a privacy policy; store
  README/LICENSE and npm license-field omissions; crypto/export indicators;
  model-weight/config license conditions such as Llama community terms. No
  assertion of trademark permission, export clearance or worldwide compliance.
  Reuse `src/core/redact.ts` and the existing secret-scan rules (`security:secrets`)
  for secret/PII indicators; list location/type only, never their values.
- **Offline first; enrichment is a separate choice.** “Fetch missing license
  metadata” first lists registry hosts, exact package/version queries, request
  count and the identifiers that will leave the machine. Confirm before any
  public registry API call; obey D43's proxy/TLS/network posture, bounded
  responses, cancellation and public-address checks. No credentials, source
  upload, arbitrary URL fetch, install or persistent cache. Private names are
  not queried without explicit disclosure/consent. Capture each real response
  shape before writing its parser (rule 13); failures remain unknown.
- **An accessible report, saved only on request.** Summary and severity groups
  show evidence, limitations, suggestions and fixable markers. Labelled
  checkboxes select findings; “Fix all safe ones” previews the exact eligible
  findings and patches before confirmation. Nothing is pre-authorized by scan.
  Preserve keyboard operation, screen-reader status/labels, focus return,
  narrow-panel wrapping, zoom and all four themes (D32). Markdown is created
  only after the user requests export and chooses a destination; exported
  text has the same scrub/disclaimer policy.
- **Fix is optional and bounded.** After explicit selection/patch confirmation,
  use normal edit tools and the current permission mode's approvals; Plan or
  Restricted Mode cannot write. Recheck trust, workspace, permission state and
  evidence hashes before each selected patch; a changed file needs a fresh
  report/preview. Batch authorization names only the selected paths; formatting
  stays within them, and installs/builds/check scripts need their normal
  independent approval rather than inheriting that authorization. Add LICENSE,
  NOTICE/THIRD_PARTY_NOTICES, SPDX/copyright headers,
  attribution comments or project-owned manifest license metadata only from
  verified evidence and confirmed ownership. A supported dependency-license
  declaration in a project manifest is a correction of metadata, never a grant
  of rights. No dependency-code edits, guessed licenses, automatic removal,
  overwriting existing notices or silent change of the chosen project license.
  Missing or changed project license needs separate explicit confirmation and
  cannot enter “safe ones”; unknown ownership/terms are recommendations only.
- **One scanner, both backends and CI.** Pure `src/core/legal/`, no `vscode`;
  host/runtime adapters load it lazily as `dist/legalScan.js`, with a measured
  D6 budget proposed before implementation merges and no existing cap raised.
  Model API gets native `legal_scan`; Muse Code gets the same read-only tool
  over the authenticated loopback `ide` MCP bridge (as code-intelligence tools
  do today, `readOnlyHint` plus actual guards). Missing `sessionMcp` capability
  is reported, never a guessed protocol fallback. The bundled `/legal` skill
  uses D68's loading/install mechanism without modifying its pinned upstream
  vendor package; report authorization stays host-owned even if a user skill
  shadows it. Headless/ACP exposes `muse-spark-code-acp exec legal-scan --json`
  as a reserved deterministic subcommand before prompt parsing: no backend,
  sign-in, credential-store access, model call or ACP-frame stdout mixing.
  Exit 0 = complete/no blockers, 1 = complete/blockers, 2 = incomplete/input or
  operational failure; advice alone does not fail CI. No headless auto-fix.
- **Cost.** The deterministic scan and report cost nothing. An explicit Explain
  choice permits at most one short, bounded turn over scrubbed findings, never
  raw source or secret/PII snippets. Muse Code uses the user's subscription;
  Model API states its estimated cost and cap before consent and follows
  D30/D48's paid gate, per-use popup, badge, paid row and PaidUsage. Denial or
  unavailable consent leaves the free report usable; no automatic paid fallback.
  Fixing through a model is the user's separately requested normal coding turn,
  with its backend's existing billing and approvals.
- **Data provenance.** Vendor a pinned, checksummed SPDX identifier/matching
  dataset only with its own verified redistribution terms and recorded source.
  CC0 identifier lists are available; exception lists and tools may have other
  licenses. Preserve their notices, review updates in a PR and build offline;
  a CC0 dataset does not relicense the licenses it describes. No new package or
  tool installation is approved by this design record (D3/D9 apply at delivery).

<!-- plan-archive:end id="2-D76-01" -->

## D114 — LIMITSB recovery contract and RVLIMITSB qualifications (2026-10-14)

<!-- plan-archive:begin id="decisions-18124b446-14315" lines="14315-14372" at="18124b446" bytes="3991" sha256="c7eeca060c927178eb8c30ad75109eb6dc542c06d4fe8ec2c6da036325bf8ebe" -->

**Owner (2026-10-14).** "why are there all there arbitraty limits in the
actual app thats insane?!!!" **The owner's rule: a limit we invented binds
only if other harnesses do the same.** The lead's audit (73 rows, five
harnesses compared; its record `docs/limits-audit.md` lands with its own
pull request, branch `docs/limits-audit`) is the comparison this decision
names: on 11 of the 15 rows that most
often hit a real person, no surveyed harness publishes any corresponding
cap (Claude Code, Codex CLI, Gemini CLI, OpenCode, Cline). Where harnesses
do cap, they use subscription or rate windows, higher thresholds, or
user-set knobs — never a low fixed default that refuses work. So the lane
must remove invented refusals and make every remaining window recoverable.
The following is the acceptance contract, not a completion claim:

- **Long answers (B1).** The output cap is each model's own maximum output
  from its capability record, not our fixed 32,768 (no surveyed harness
  publishes a fixed reply cap; Claude Code's `maxOutputTokens` feeds only
  its compaction arithmetic). An answer stopped on max tokens continues
  automatically until the model finishes, subject to the person's budget
  and Stop; each continuation must be shown. Tool repetition guards do not
  detect repeated text-only continuations; the current 50-round turn bound
  still stops them and its removal requires a text-loop guard. A provider that refuses a
  continuation is reported in words. It never stops after one continuation
  waiting for a nudge.
- **Tool output, search and read, web pages, diagnostics (B3, B5, B7,
  B6).** Each call still shows the same size it did, but the rest is
  always reachable: every clipped result says how much is left and how to
  get the next part through an offset or page argument the tool already
  has, or one the lane adds. Claude Code's own file reader works this way
  (2,000 lines by default, with an offset); Codex CLI stores per-tool
  output behind its own `tool_output_token_limit` rather than dropping it.
- **Files over 10 MiB (A9).** Reading works at any size by range (offset
  and length); an edit over the size says why, and the person can still
  edit by range. No surveyed harness publishes a file-tool size cap.
- **Attachments (A10).** Per-request counts and sizes follow each
  provider's documented limits from its capability record, not our own
  numbers. An absent field means **unknown provider limit**, not a confirmed
  legacy number. The lane brief requested today's enforcement temporarily;
  that is a compatibility fallback, not provider evidence, and must be shown
  separately as local policy with its source until the owner resolves the
  conflict with the no-fallbacks rule. The current booleans are not recorded
  or surfaced as that evidence, so A10 is not accepted.

**RVLIMITSB review scope (2026-10-14).** Reuse the existing request policy,
conditional file writer, range tools and paging stores. Correct proven exec-cap,
range-read, range-edit and paging defects in separate commits; remove lane-added
stand-in tests and qualify claims against actual evidence. No new provider calls,
new abstraction or raised gate cap. Unknown attachment limits and any remaining
whole-file edit bound are unresolved obligations, not provider capabilities.
Review receipts and remaining acceptance gaps: `.lane/RVLIMITSB.report.md`.

Out of scope: compaction timing (B2, M101), money and stopping limits
(lane LIMITSA), silent drops (lane LIMITSC). **Acceptance remains open.**
The scripted-provider packed test was removed under the owner's testing rule;
it did not prove real provider termination, complete file equality, web or
editor diagnostics. Remaining gaps include the invented 128 MiB edit refusal,
HTML converter truncation, lost retained outputs after resume, search ceilings,
and configured-provider attachment evidence. Measured review receipts:
`docs/certification/limits-output.md`; handoff: `.lane/RVLIMITSB.report.md`.

<!-- plan-archive:end id="decisions-18124b446-14315" -->
