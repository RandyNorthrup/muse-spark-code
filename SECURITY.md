# Security policy

Muse Spark Code (Unofficial) runs a coding agent inside VS Code: it reads
and edits files in your workspace, runs shell commands with your approval,
and sends your prompts to Meta. Security problems in that surface are taken
seriously and fixed first.

## Reporting a vulnerability

Please do not open a public issue for a vulnerability.

- Use GitHub's private vulnerability reporting on this repository:
  **Security → Report a vulnerability** at
  https://github.com/RandyNorthrup/muse-spark-code/security/advisories/new.
- Include the extension version (`Muse Spark: Diagnostics` in the Command
  Palette writes the versions and the configuration facts to the log; it
  contains no credentials), the steps to reproduce, and what an attacker
  gains.

You will get an acknowledgement within seven days. A confirmed
vulnerability is fixed in a patch release and credited in the changelog
unless you prefer otherwise.

## Supported versions

Only the latest release receives fixes: the extension on the Visual Studio
Marketplace, Open VSX and GitHub Releases, and the ACP agent on GitHub
Releases and npm.

## What the extension protects, and how

- **Muse Judge (M98 phase 1).** The same model can only add caution at an
  existing reviewer/card fence; it cannot allow, override a rule or enter an
  ALLOW parser. Off loads no Judge source or admission bundle. Replaced
  actions, models, turns and sessions invalidate the latch and abort its
  lifetime. Redaction precedes remote content and prefix reuse. Muse Code
  uses fresh hidden Plan sessions, no MCP servers and empty temporary
  folders removed afterward; standing native allow rules and unreadable
  settings disable it. Its tool-item guard reacts to notification and does
  not prove that no native command ran. Unknown allow sources or execution
  before notification remain the D77/M90 residual. The subscription source
  never asks a Model API price or receives its key. The metered path requires
  live consent/account/binding checks after every wait and a durable daily
  reservation; absent D78 disables production dispatch before consent.
  Unknown receipts retain liability. No local listener, separate provider,
  guessed wire field, calibration label from approvals or new ledger is
  introduced. See [Judge](docs/judge.md) and its
  [certification record](docs/certification/m98.md).

- **Accounts and local profiles (M108).** Account credentials use separate
  origin-bound slots in SecretStorage or the runtime's OS credential store;
  metadata contains no credential. Removal fences pending reads and queued
  writes in the shared process. Stored-origin cleanup remains possible after
  an endpoint change; dispatch at a new origin requires an explicit rebind.
  Every read registers the credential with the shared redactor. Labels and
  credentials stay off usage/device frames; confirmations stay machine-local.
  Independent windows/processes still need M109's broker fences before
  installed pooling is enabled. Developer profiles require isolated state,
  credential slots and processes; their unbound runtime resource operations
  refuse, retaining the ownership ledger instead of claiming cleanup.
  Vendor policy, replay identity, first-charge consent and shared budgets
  apply unchanged. The [M108 record](docs/certification/m108.md) names the
  capture and installed-owner prerequisites.

- **Credentials.** A pasted Model API key lives only in VS Code's
  SecretStorage, is sent only to `api.meta.ai`, and is never passed to a
  child process, written to settings or logs, or shown in the panel. The
  extension reads the Muse Code CLI's own credential file but keeps only its
  structure, never a token from it: the schema version, which providers it names
  (only `meta` speaks for the sign-in), each one's storage lane (the macOS
  Keychain), and whether `meta` has an `api_key` or `access_token` entry
  (the parse keeps the fact, never the value). When that is not enough, it
  asks the CLI (`account/read`) and discards the account label and avatar
  address the answer carries. It never reads the Keychain's secret.
  In-panel sign-in, that question and sign-out (`account/logout`) run in a
  temporary `muse serve` that owns no conversation and is closed on
  success, cancel, timeout, error or when the window closes, after which
  no sign-in starts; a sign-in whose host exits fails at once unless the
  credential file changed first, by a write no `account/read` answer
  called signed out. The only page sign-in opens must be on
  `https://auth.meta.com`. The log channel redacts key-shaped strings, in
  Meta's current `LLM_…` form and the older `LLM|<id>|<secret>` one; it
  cannot catch a path or an e-mail address, so free text Muse Code writes
  (sign-in endings, MSP error messages, `muse serve` and `muse skills`
  stderr/stdout, including failed skill activation) is logged in fixed
  words, by its kind/code or by its length. MSP RPC notices retain redacted detail while their logs use the
  kind/code summary. Both backends redact diagnostic event reasons before
  event subscribers receive them; the panel boundary applies the shared
  redactor to diagnostic events and notices before webview snapshots.
  Failed MCP picker details and voice error/close notices use this redactor
  too. Other external error text (git, MCP/helper processes, Model API
  failures) redacts known credential shapes. Ordinary conversation/tool
  content remains intact; credential shapes outside the known patterns
  remain unrecognised.
- **Workspace trust.** In VS Code's Restricted Mode the agent loads no
  workspace rules, skills, custom agents or memory, runs no shell commands, and the
  extension runs no `git` (a repository's `.git/config` can name programs
  git runs, such as `core.fsmonitor`). With `museSpark.modelApiHooks` on,
  hook commands (yours, your administrator's and the project's) run only in
  a trusted workspace. The settings that choose what runs and what is
  billed (`museBinaryPath`, `environmentVariables`, `backend`,
  `shellSandbox`, `sandboxNetwork`, `initialPermissionMode`,
  `allowDangerouslySkipPermissions`, `modelApiHooks`, `modelApiRepoMap`,
  `modelApiObservationPacking`, `modelApiPromptCacheRetention`,
  `turnCheckpoints`, the verify loop's `checkCommands`,
  `formatOnEdit` and `diagnosticsAfterEdits`, `bundledSkills`,
  `modelApiSessionBudgetUsd`, the permission settings `modelApiCommandRules`,
  `modelApiPermissionProfiles` and `modelApiPermissionProfile`,
  `museCodeAutoReviewer`, and the seven paid `modelApi*` features) are machine-scoped in every workspace, trusted or
  not: a repository's
  `.vscode/settings.json` cannot point the extension at its own executable. In a remote window a dev container
  definition can write machine settings, so there Bypass permissions is
  never the starting mode and needs an explicit confirmation.
- **Git and pull requests (M71).** Commit and push go through VS Code's
  built-in Git extension, never in Restricted Mode. A push always asks,
  naming the remote (credentials in its address masked), the branch and the
  commit count, and never forces: the extension passes the Git extension no
  force mode, refuses a branch behind its upstream, and refuses a branch,
  upstream or remote whose name git would read as an option or a force
  (`+`, `-`, `:`, whitespace). Pull requests go to `api.github.com` only,
  with VS Code's GitHub sign-in token read per call; every GitHub reply is
  validated against a captured shape. Credential-shaped strings in a commit
  message or pull request are masked and returned to the form before
  anything is sent.
- **Someone else's pull request.** "Open a pull request in a conversation"
  checks a pull request by another author out under the extension's own
  storage. A window whose folder is anywhere under that storage is held,
  decided by location and not by VS Code's trust (which may already cover
  the folder through a trusted parent, or be switched off): the
  conversation stays in Plan mode, runs no `!` command, and the project's
  rules, skills, hooks and MCP servers stay off (Muse Code without
  `--trust-workspace`, the Model API backend without them), until the user
  confirms trust for that worktree in the extension's card. Other
  extensions follow VS Code's own trust, which the card says.
- **Programs the extension starts.** git, PowerShell, bash and the Muse
  Code CLI are found by absolute path only: an empty or relative `PATH`
  entry (which means the working directory, the workspace) is never
  searched, and `museBinaryPath` must be absolute.
- **Turn checkpoints.** They live in a git repository of the extension's
  own in a canonical-root namespace under extension global storage, never
  in the workspace's `.git` (no object,
  ref or index change, so a push cannot carry one). That git runs with the
  host's `GIT_*` variables removed, no system or global configuration, hooks
  pointed at an empty folder, fsmonitor off, and every conversion attribute
  unset, so no clean or smudge filter a repository names ever runs; its
  folder is 0700 on macOS and Linux. No checkpoint is taken when the
  storage and the workspace hold one another, compared as written and as
  resolved through links and junctions, and the tools never write inside
  the storage, so a model cannot plant a hook or filter there. Each window owns its write journal
  (with its staged copies) and presence; nothing of the workspace is
  captured; records use Git compare-and-swap
  refs, and a file restore/Redo claims one shared CAS ref before changes.
  Cleanup preserves a live window's resources and recent unreferenced
  objects, so another window can finish its ref writes. A stopped restore
  completes its Redo metadata before removing presence and releasing its
  reservation. Panel submissions and all Model API turns, including queued,
  scheduled and child turns, await their running marks before edits.
  Stored destructive Restore/Redo requires the actual attached Model API
  session; backend/trust is rechecked before file mutation and atomic commit.
  Every workspace-cwd Muse Code serve, including account-only probes, and
  configured local stdio MCP server publishes
  sticky unsafe presence before spawning. Extension-managed CLI commands, sandbox helpers and
  interactive/auth/MCP/installer terminals await the same native marker
  before process or terminal creation, then recheck application shutdown and
  manager generation. Terminal closure does not prove every descendant stopped.
  Shell/hook I/O retains an activity
  mark until its actual promise settles; without locally owned full shutdown
  proof it first publishes sticky unsafe presence. Current launched-process
  runners provide no such proof: normal exit, pipe drain, native host/window
  close and owner PID death do not prove all descendants stopped. A shell
  that could not start at all (no interpreter on `PATH`, `spawn` refused by the
  operating system or throwing) proves that no process exists and publishes no
  unsafe presence. Native,
  active-on-crash and old/unknown presence never age-expire into safety.
  Restoration is refused until explicit confirmed recovery removes only the
  exact stale unsafe presence JSON; saved records/refs/history are preserved.
  Current-version windows sharing the physical canonical root and this
  global-storage namespace share these fences; old workspace-specific stores
  remain read-only and unchanged. Older versions, different profiles/users/hosts,
  independently managed editors/processes and remote HTTP MCP services are
  outside that ownership guarantee. Pure file-tool Model API sessions can
  remain eligible. Native pre-edit
  exclusion and full shutdown still need upstream proof; their unsafe
  destructive path is disabled. A tool write whose preimage cannot be staged fails with a
  localized reason; failure logs contain error kinds rather than storage
  paths.
  A restore refuses a path whose canonical form is not the workspace's
  canonical root plus the path (a link or junction on the way) before each
  write or delete. A restore deletes only regular files, checks each file's
  content against what it expects just before changing it, writes through a
  temporary file that keeps an existing file's permissions (a re-created
  file gets default permissions with the execute bit it had), and leaves a file changed outside
  the conversation's turns, by another conversation's overlapping turn, or
  with unsaved editor or notebook changes as it is. File names reach git as
  literal paths, never as pathspec magic. None are taken in Restricted Mode.
- **Path confinement (Model API backend).** Every path a file tool names is
  resolved through the file system (links, junctions and short names)
  before it is read or written, and refused when it leaves the workspace,
  except that the memory tools are confined to their memory folders (the
  personal ones are outside it) and `read_file` may also read under the
  permission profile's `extraRoots`;
  the search worker skips any listed file that does. Edit Review and the
  rewind apply the same check before writing a file back. Windows names
  that would be reinterpreted are refused: alternate data streams
  (`a.txt:x`), device names (`NUL`, `COM1`), trailing dots or spaces.
- **Code intelligence (both backends).** The file a code intelligence tool
  is asked about is confined the same way, and a result VS Code's language
  service returns from outside the workspace (a library's declarations,
  another folder, a file reached through a link that leaves it) is left out
  and counted: its location and lines are never shown. A hover shows what a
  declaration says, so a hover for a symbol defined only outside the
  workspace is held back, unless the definition is in a language's library
  inside VS Code's installation or an extension's folder. What a language
  service infers still flows through: a symbol defined in the workspace
  whose type comes from a file outside it (an import from `../`, a
  `tsconfig` path) shows that type in its hover and its diagnostics, as it
  does in the editor. `rename_symbol` refuses a rename that would touch any
  file outside the workspace, create, move or delete files (seen through
  the edit's internal entry list, since VS Code's API lists only text
  edits; an edit that does not show its list is refused too), or change a
  file with unsaved changes, one VS Code holds differently from the disk,
  or one whose edit ranges no longer cover the old name (an edit the service
  made from an older version of the file). On the Model API backend it asks
  as an edit (a protected write when any of its files is one, named first on
  the card), and every file is confined and read again after the card and
  once more right before its own write, so nothing a formatter, a hook or
  the user wrote meanwhile is overwritten; a Stop before the first write
  writes nothing. On the Muse Code backend the `ide` server's code intelligence tools
  change nothing and declare themselves read-only (its image tools write
  images and its web fetch is not read-only); its rename returns the edits for
  Muse Code's own edit tool, and Muse Code 1.4.0 asks its own card for these
  tools in its on-request mode. The repo map reaches the Model API's
  instructions only in a trusted workspace.
- **Protected writes (Model API backend).** A file tool's write to `.git/**`, `.husky/**`,
  `.vscode/**`, `.idea/**`, `.devcontainer/**`, `.github/workflows/**`,
  `.agents/**`, `.muse/**`, another coding agent's folder (`.claude/**`,
  `.codex/**`, `.cursor/**`, `.gemini/**`, `.github/hooks/**`,
  `.github/copilot/**`, `.devin/**`, `.windsurf/**`, `.kiro/**`,
  `.clinerules/**`, `.amp/**`, `.opencode/**`, `.continue/**`, `.roo/**`:
  hooks, MCP servers, plugins and settings that agent runs outside these
  approvals), an agent's MCP or instruction file (`.mcp.json`,
  `opencode.json`, `opencode.jsonc`, `AGENTS.md`, `CLAUDE.md`, `GEMINI.md`,
  `.cursorrules`, `.windsurfrules`, `.roomodes`, `.clinerules`,
  `.github/copilot-instructions.md`: an instruction steers the next agent
  that reads it), `.envrc` or `.gitmodules`, at any depth and in any letter
  case, and judged by where links and junctions lead, shows an approval card
  in every mode but Bypass (Plan refuses it), and no "always allow" rule
  covers it. The one exception is a Markdown note written by the memory
  tools inside a memory folder, which is an ordinary edit.
- **Protected writes (Muse Code backend).** Muse Code flags its own
  protected writes. The extension also judges each Muse Code file-write
  approval (`fileAccess`, any access but a read) by the list above. Muse
  Code names the file by its absolute path, so both separators split it and
  a file outside the workspace (`~/.claude/settings.json`) counts. Such a
  write is shown as protected, "Edit automatically" and the Auto reviewer
  never answer it, and its card offers no "Always allow" rule Muse Code
  could answer later writes by. A write Muse Code makes without asking is
  outside the extension's reach: in a live check (Muse Code 1.4.2, sandbox
  off, Manual) it wrote `.claude/settings.json` and a file outside the
  workspace without asking.
- **Saved plans (both backends).** **Save plan** is the extension's own
  write to `.agents/plans/`, and it asks in a modal first, as a protected
  write does. It creates a new file by a hard link from a hidden stage, so
  it never replaces a file. The plans folder must be the workspace's own
  `.agents/plans`: a link or junction to anywhere else is refused, and the
  folder is checked again after it is made and just before the link, so
  one swapped for a junction after the check is refused too (memory notes
  get the same re-check). A file system without hard links refuses the
  save rather than risk replacing a file. Restricted Mode refuses both
  saving a plan and implementing one.
- **A plan file is untrusted content.** Anything in `.agents/plans/` may
  have been written by a cloned repository or a tool, so a plan picked
  from **Plans…** starts a conversation in Manual (Plan when that is the
  starting mode), whatever `initialPermissionMode` says, and the model is
  told nobody confirmed who wrote it. Only a reply saved from a Plan-mode
  turn of the conversation on screen is sent as the plan the user
  approved; even then Bypass is never the starting mode in a remote
  window. What the model gets is what the panel showed, by construction:
  a plan reply is rendered, and its brief written, from one rewritten
  Markdown tree in which a link's destination, a picture's source, a
  title, a definition, a footnote and a code fence's info string are all
  shown text. Raw HTML, which the panel never renders, is the exception: a
  reply holding it is saved with a warning and not started. A control or
  format character (a direction override, a zero-width character, DEL or a
  C1 control) makes the panel paint text otherwise than the model reads
  it, so a reply or a plan file holding one is neither saved nor started.
- **Shell commands.** On the Model API backend the extension's own shell
  tool runs the command as an argument array through PowerShell or bash,
  never as a shell string, in the workspace root, with a timeout and an
  output cap, and, in the modes that ask, only after the user's approval, a
  matching allow rule, or (in Auto) the opt-in Auto reviewer's ALLOW. On
  the Muse Code CLI backend the CLI runs the commands inside its OS sandbox
  where that is set up; `museSpark.shellSandbox` at `auto` starts the CLI
  without the sandbox for a Windows workspace under the user's profile
  (where the sandbox does not reliably run commands: 1.4.2 ran one there
  on the owner's machine and never finished one on a freshly set-up rig,
  2026-10-04), and `off` never sandboxes; both leave the approval cards in
  place for commands.
- **Muse Code's file writes.** Muse Code asks before none of its file-tool
  writes except those to `.git`, `.muse` and `.agents`, in every mode, Plan
  included (Plan is its `denyUnmatched`, which still lets the file tools
  edit). With its sandbox the file tools cannot write outside the workspace
  ("absolute path is outside the workspace"); without it (`--disable-sandbox`)
  they can write anywhere the user can, with no approval, as Meta's
  permissions page documents and the 2026-10-04 probes confirmed. Other
  coding agents' configuration folders inside the workspace (`.claude`,
  `.cursor` and the like) are ordinary files to Muse Code. The extension can
  judge only what Muse Code asks about (by the protected-write list above),
  and the MSP protocol offers no way
  to add rules ("select, never create"), so it warns once per window when
  the sandbox is off and says in the Diagnostics report where the file
  tools can write; the rest is Muse Code's to change.
- **Check commands and `then_run` (Model API backend).** The commands the
  extension runs after the agent's edits (`museSpark.checkCommands`,
  machine-scoped, none by default) and the one an edit's `then_run` names
  take the shell tool's own hooks and permission path: the user's
  PreToolUse, PostToolUse and PostToolUseFailure hooks see each as a call
  of the shell tool (a denial, a rewrite or a demanded question holds), as
  does PermissionRequest wherever the shell's card would show; they ask wherever a shell command would ask (Manual,
  Edit automatically and Auto, unless one of your command rules allows them),
  never run in Plan mode or Restricted Mode, and
  run with the shell tool's runner, job object and time cap. The agent can
  change what a check runs (a `package.json` script), which is why they
  ask. Their "Always allow in this session" is kept apart from the shell
  tool's rules (in both directions: a check's grant never answers for the
  agent's own shell call of the same command, nor a shell grant for the
  check), and before any live Model API conversation or subagent in this
  workspace starts writing a file that may decide what a command
  runs (the manifest, a `Makefile`, a tool's configuration, a file the
  command names by its path, its name, its path without extension, as a
  dotted module or as its folder's entry file; for a command with quotes,
  escapes, variables, substitutions, globs or operators, any file) it no
  longer answers until the user's next message. A pending write still
  invalidates the grant after a new message and in newly opened sessions;
  a check started during the write cannot certify its completed state.
  Project memory writes and a new note's index notify the same ledger when
  inside the workspace. That is judged on the
  command the rule is keyed on (after a hook's rewrite) and again right
  before the command runs. The shell tool's own session rules keep their
  earlier behaviour (PLAN §3 Q12). Edited file names reach a check only as quoted
  arguments after `--`, and only files that exist in the workspace; a name
  that starts with `-` or `@` or holds a control character keeps the check
  from running, and on Windows so does one holding `"`, `&`, `|`, `<`, `>`,
  `^`, `%` or `!`, which Windows PowerShell 5.1's argument passing and
  `cmd.exe` (for a `.cmd` or `.bat` program) would read as syntax (measured:
  `x&echo.INJECTED` ran a second command through a `.cmd`). `then_run` runs
  only if the file still holds what the edit wrote.
- **Opening files for their diagnostics.** VS Code's language servers
  report only on files an editor shows, so the verify loop and the
  `getDiagnostics` tool open files. Opening a file can make an extension
  load its configuration as code (an ESLint or Prettier JavaScript config,
  `package.json`, `node_modules`), so neither ever opens or formats such a
  file, and once any live conversation or subagent starts writing one the
  loop opens and formats nothing
  more until the user's next message. `getDiagnostics` opens only a file
  inside the workspace by its real path (links and junctions resolved).
  Every later act on an edited file (format on edit's write-back, `then_run`,
  the diagnostics' show and read, a check's file arguments) uses the real
  path and canonical name confinement found at the edit and checks, just
  before, that the file is still there and still holds what the edit left
  (a check's arguments: still there). Format on edit's write-back is a
  conditional write: the file's bytes are compared with what the edit wrote
  before the write and again immediately before the rename, and a changed
  or removed file, or one an editor holds unsaved text for (by either name), is left alone (its folder is not made again). What
  remains is the moment between the last comparison and the rename: on
  POSIX a change saved in it is replaced, and a program still writing
  through a handle it held on the old file writes into a file that no
  longer has a name; on Windows a program holding the file open makes the
  rename wait and compare again, but a change saved and closed in that
  moment is replaced.
  Muse Code's own edits are not seen by the extension, so after Muse Code
  writes such a config, a later `getDiagnostics` request for an ordinary
  file can still open that file and let the extension load the config.
- **Installing Muse Code.** The panel runs only Meta's published install
  command for the platform (`constants.ts` `MUSE_INSTALL_COMMANDS`), and
  only after a confirmation that shows it, in a visible terminal. It never
  runs it silently or with arguments from the workspace.
- **Hooks (Model API backend).** Off by default and machine-scoped, and
  loaded only in a trusted workspace. Hook commands run as the user outside
  the agent sandbox, with an environment that excludes the Model API key
  and any `*_API_KEY`, standard input capped at 256 KiB, output capped at
  16 KiB, a timeout of at most 600 s, and the process tree ended on cancel.
  A hook can approve an ordinary tool call but never a paid call or a
  protected write: a paid call always reaches the paid-use popup (Plan
  refuses it), unless
  the user allowed that feature always in this (trusted) workspace, and a
  paid image aimed at a protected path asks even then.
- **MCP servers (Model API backend).** Started only in a trusted
  workspace. A local server sees only an allow-listed part of VS Code's
  environment plus its own `env`; the Model API key is never passed. On
  Windows each stdio server runs in a job object that ends its descendants.
  Remote error bodies and authentication challenges stay out of tool
  errors and logs.
- **Import from other agents (D64).** Import copies an item only to a place no more exposed than where it was: personal stays personal, a git-ignored file is never copied into a tracked one. It does not look for credentials in what it copies.
  Canonical paths classify personal versus project scope; `git check-ignore`
  through the safe metadata runner distinguishes ignored from tracked.
  A non-repository folder counts as tracked; unknown classification refuses
  the item. Targets are classified again after final path checks at write
  or editor edit time. Project sources require trust. Project target
  components refuse symbolic links and junctions, including dangling links;
  bounded reads verify file identity, creates publish whole exclusively,
  and rules appends refuse changed prior text or a result past the limit.
  The current folder, trust and activation are checked synchronously after
  the last await and before showing or editing a project target. Config
  entries are unsaved WorkspaceEdits for user review and save, never direct
  writes or clipboard transfers. Preview/picker output contains metadata
  only; logs contain counts and fixed reasons only. Active MCP transport
  values stay unchanged; inactive and unknown fields are dropped by name.
  Unsupported hook restrictions are refused, so nothing is widened.
  Item names remain visible; the import makes no content-based promise that
  a file is free of credentials. Native writer races at the last filesystem
  step remain bounded by the existing checks, not eliminated.
- **Web fetch (both backends).** The model can ask the extension to read a
  page. Only `https://` URLs without credentials, of at most 2,048
  characters, on public internet addresses: the name is resolved on the
  user's machine and refused when any answer is loopback, private,
  link-local, carrier-grade NAT, a cloud metadata address or reserved
  (IPv4 carried inside IPv6, the network's own NAT64 prefix included, is
  judged as IPv4; while that prefix cannot be learned, no IPv6 answer is
  used), and local or reserved names, with any trailing dots, are
  refused before any lookup. The connection is pinned to the checked
  addresses, raced as RFC 8305 says (TLS verifies the name); through a proxy
  the tunnel is asked for that address, and only an answer that arrived over
  TLS is read. Same-host redirects are checked and pinned again (at most
  five); another host's is handed back to the model, which asks again.
  5 MiB after decompression, 30 seconds, text types only. HTML is parsed
  by parse5 on a worker thread per page (at most two at once) stopped at
  10 seconds or 512 MiB, its output bounded; only what is never page text
  by structure (scripts, styles, template content, `<noscript>`, embedded
  media, form controls, SVG, MathML) is left out, and no rendering is
  emulated, so the model gets the page's text as served, including text a
  stylesheet, a hiding attribute or a script would keep off screen, all of
  it marked untrusted; XHTML is refused. On the Model API backend each host asks in
  every mode but Bypass (Plan refuses), and a `PermissionRequest` hook's
  allow does not replace that card; on Muse Code the `ide` tool is listed
  only in a trusted workspace without `sandboxNetwork: restricted`, carries
  `readOnlyHint: false, openWorldHint: true`, the extension asks before
  every call, and a call Muse Code stops waiting for (its request closed, or
  `notifications/cancelled`) fetches nothing more. The page reaches the model
  between random markers as untrusted content; only short tokens of what a
  server sent appear outside them. Residual risk: an intranet service on a
  public address looks like the internet, the URL itself can carry
  conversation text to the host the user approved, and the proxy decides
  for the address, not the name (PLAN.md §9).
- **Browser check (both backends, M81).** The page runs in Google's Chrome
  for Testing headless shell, one version pinned per extension release,
  downloaded only after the user's consent (or `browserCheckRuntime` set
  to `download`, machine-scoped, never a repository's) through VS Code's own
  network stack, with at most three redirects that stay on the pinned
  storage origin and path. The archive's length (1% slack while it streams)
  and SHA-256 are checked before any byte of it is read; the ZIP reader takes
  only what the pinned archives use (one disk, no ZIP64, no data
  descriptors, stored or deflate, regular files, safe and unique names,
  every write inside its folder, every entry's length and CRC, output
  bounded while inflating), files are created private (0600, the pinned
  executables 0700), the executable's length and SHA-256 are checked, and a
  receipt and one rename publish it; another window's winner is used only
  after it verifies. Before each check the executable's metadata is read
  again (hashed again when it changed), and a pin 45 days past Google's
  publication refuses. The browser starts with a fixed command line (CDP
  over a pipe, never a port; a fresh private profile; a projected
  environment), and its own report of that command line is held to it: each
  switch exactly once, none of the forbidden ones (another proxy or
  resolver, a debugging port, extensions, the sandbox off, features, policy).
  Its network goes to the check's own proxy on 127.0.0.1 (Chrome's implicit
  loopback bypass removed, the same proxy on the private context): plain
  HTTP only to loopback or a host the user widened, parsed strictly, heads
  bounded (16 KiB, a request head within 3 s, 64 connections), sign-in
  challenges and credentials removed both ways, CONNECT only to a widened
  host. The browser's resolver rule fails every name but the loopback
  addresses; integrated sign-in is allowed only for a reserved name that
  cannot exist, and a CDP sign-in request is cancelled. The check's own
  canaries (default, page and audit phases, fresh nonces, exceptions bound
  to one frame and phase) must show the route, the sign-in stripping, WebRTC
  and WebTransport held, or the check refuses; a network-service restart
  refuses too. Residual risk: `https` and WebSocket tunnels to a widened host
  are opaque, and a site there may use this computer's account (on Windows
  especially); the network service runs with Chrome's own sandbox settings,
  not an OS sandbox of the extension's; and the confinement is the
  browser's construction checked at runtime, not a kernel boundary
  (`docs/certification/m81.md`).
- **Webview.** `default-src 'none'`, a per-load script nonce, no remote
  origins, no inline styles; every message between the host and the
  webview is validated against a schema.
- **Review (M70).** A review's git material (diffs, file names, branch
  name, commit message) reaches the model between random markers under
  a sentence that calls it untrusted data; a marker the material already
  holds is replaced. Git runs for a review only in a trusted workspace, as
  the prompt's git facts do: no `core.fsmonitor` hook (an empty value, which
  older Git reads as disabled too), no signature program, no replace refs
  (`--no-replace-objects`), no external diff driver or text conversion
  (`--no-ext-diff`, `--no-textconv`), and every configured clean and
  process filter program and its required flag overridden for each call
  (their names are read, never their commands; the working-tree diff
  compares saved text). A revision the user names can never read as a git
  option. Each request is bound to its folder's physical identity (canonical
  path, device and inode), so a link or junction retargeted while a picker
  is open or git runs cancels the request before foreign material is
  returned; the last check before the turn is sent is synchronous and does
  not exclude an unrelated replacement after it (the residual every
  path-then-act check has). Files that may hold secrets are left out of every
  diff. Repository branch names and recent commit subjects are omitted from
  Reviewer system instructions: git material belongs in the untrusted turn
  block. The date and trusted workspace rules remain. On the Model API the
  Reviewer has only tools that read, and any
  other call is refused in every mode, Bypass included; on Muse Code the
  review turn runs in Plan mode, which Muse Code's own allow rules still
  apply to, so it is not claimed strictly read-only, and the mode the user
  had comes back when it ends (Bypass only while its setting still allows
  it). The review pane's Revert writes back through the same workspace
  confinement as Edit Review (canonical path, links and junctions), refuses
  a file whose editor has unsaved changes, serializes writes to one file,
  and runs as a checkpointed edit like any other explicit edit. Its writer and
  deletion adapter invoke the original/canonical dirty-buffer predicate inside
  that admission, immediately before I/O; a buffer dirtied during the wait
  refuses the operation and releases the activity lease.
- **Prompt injection.** Workspace files, rules, skills and custom agents
  reach the model by design in a trusted workspace, and so do fetched web
  pages (marked as untrusted content); the permission modes and the approval
  cards are the control, and the transcript shows each tool call.
- **Custom agents (Model API backend, M76).** An `AGENT.md` is input someone
  else may have written: it is read only up to 64 KB and only as a regular
  file, parsed with a schema, and refused when its front matter cannot be
  read whole (so a list or a repeated key never reads as "every tool"); its
  fields are bounded and free of control and direction characters. It can
  only narrow the session: its tool list binds every call, its permission
  mode never exceeds the session's (and survives a mode switch), and a model
  it names passes the contributor-tier checks of your own choice.
  Contributor models are blocked in a confidential workspace
  (`museSpark.confidentialWorkspace`); a model different from the parent's
  asks the paid-use popup even when subagents are allowed always. The agent's
  prompt is explicitly labelled as untrusted, with its source, below the workspace rules; in
  an untrusted workspace no agent is offered and a project file's prompt is
  left out of a resumed child's instructions. A model writing an agent file
  is a protected write (`.agents/**`) and asks in every mode but Bypass
  (Plan refuses it).

- **Imported sessions (M84).** A session-export file may come from anyone.
  Parser failures do not quote the file, and field names are scrubbed before
  bounded validation details reach notices or logs. Export scrubbing covers
  every string value, including arbitrary ids and error labels, and removes
  the credential shapes the log redactor knows (`src/core/redact.ts`, the
  one list) and the key digest; a secret in any other shape is not
  recognised, so the redacted file is shown before it is saved. Ordinary
  UUIDs and protocol words stay intact. The share view's section keys include
  their position and import remints ids, so redacted ids carry no live reference.
  It is parsed whole before use: at most 16 MiB and 20,000 items, the known
  format and version, and no field the schema does not name. An import
  takes nothing privileged from it (no permission mode, model, session
  rules, goals, schedules, patches or ids), hands the model each imported
  turn as untrusted data in a user message, and opens the conversation in
  Manual (or Plan) every time, whatever the initial mode; only the user's
  own mode change relaxes it; a plan written in it is implemented as
  untrusted content, in that asking mode too. A share file renders
  read-only: its code blocks have no Insert or Apply, nor do an imported
  conversation's, and its links go through the same http, https and mailto
  filter as a reply's.
- **Release pipeline.** A tag is released only when it names the manifest
  version and points at a commit on `main`; the Marketplace PAT reaches one
  step, after an install that runs no package scripts; no checkout keeps a
  token; every job has a timeout.
- **The macOS dictation helper** is ad-hoc signed, not notarised (owner
  decision); it is not quarantined when VS Code installs the extension, so
  Gatekeeper normally does not assess it; a copy that carries the quarantine
  attribute is assessed and refused.

Fixed runtime account ports keep their backend identity through display-order
changes and account removal. A missing non-default binding cannot use the
legacy Meta key; only an absent Meta default record uses that fallback.
Malformed configured provider records refuse before any fallback key read.

More detail: `docs/PRIVACY.md` and PLAN.md §9.

## Headless CI boundary (M80, PLAN D65)

The frozen M80 contract adds memory-only stdin authentication to exec and a
second trusted installed scanner child. Lanes A to D are implemented and the
hosted fake-only Action check passes; the live receipt LA passed on 2026-10-05,
L and LR acceptance is pending, and this policy defines its required boundary.
The Action step directly execs its trusted absolute launcher. Only that initial
run-step environment holds the Model API key; launcher deletes variable before
children and holds it in memory until cleanup. It sends key only by private
stdin to exec and scan-secrets. Neither stores it or passes it to children.
Git/tools/hooks/checks/install/apply/publish never receive it via env/argv/file.
Local OS credential authentication is unchanged; CI uses no auth set/keyring.

One bounded owner covers diff generation, exec, extraction, patch Git, scanner
and publication. Stop revokes eligibility, starts no later child, forwards exact
signal, escalates/reaps under fixed bounds and clears references/staging in
finally. Scanner failure/cancellation/overflow withholds entire patch. Exact
staged-byte scan includes removed/context/deleted lines; binary/image changes
withhold the whole fix. No redaction rewrites published patch bytes. A
stopped or failed wrapper publishes nothing, not even its result.
Every Git command runs with no system and an empty global configuration, no
inherited `GIT_*`, empty hooks, fsmonitor, external diff/textconv and signing
off, and its configuration closed by shape: any effective configuration name a
fresh `git init` does not write (URL rewrites, includes, ssh commands,
upload/receive-pack, credential helpers, filters among them) refuses the
command before it starts. Network commands use only the validated remote's own
transport and never discover a parent repository. Tokens are explicit
one-command headers only. A candidate digest is visibly unsigned. Registry
installation requires npm 11.19.0's same verified bundle, subject/lock/registry
SHA-512, release predicate and signing-certificate URI identity.

Residuals: initial OS environment remains inspectable by same user; deleting
variable cannot erase that record or guarantee memory zeroization. Private
self-hosted warns; public self-hosted refuses. Collaborators can change workflows
under GitHub trust. Use secret-free checkout: ordinary readable workspace files
can reach Meta; no M78 deny-read guarantee exists. Instruction markers do not
prove prompt-injection immunity. Redaction/scanning covers known patterns/exact
literals only. A patch can change unprotected scripts/actions that execute later.
Run proposal, secret-free tests and privileged push in separate jobs, and **read
proposal before maintainer approval**. Passing tests are information, not approval.
POSIX signal e2e is skipped on Windows; argv/injected-env hashes do not establish
full environment-block audit. Full boundaries, bounds and pending receipts are
in [docs/ci.md](docs/ci.md) and [m80.md](docs/certification/m80.md).
