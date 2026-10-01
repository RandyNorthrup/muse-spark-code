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

Only the latest release on the Visual Studio Marketplace receives fixes.

## What the extension protects, and how

- **Credentials.** A pasted Model API key lives only in VS Code's
  SecretStorage, is sent only to `api.meta.ai`, and is never passed to a
  child process, written to settings or logs, or shown in the panel. The
  extension reads only the structure of the Muse Code CLI's own credential
  file, never a token in it: the schema version, which providers it names
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
  stderr) is logged in fixed words, by its kind, or by its length, never
  as sent.
- **Workspace trust.** In VS Code's Restricted Mode the agent loads no
  workspace rules, skills or memory, runs no shell commands, and the
  extension runs no `git` (a repository's `.git/config` can name programs
  git runs, such as `core.fsmonitor`). With `museSpark.modelApiHooks` on,
  hook commands (yours, your administrator's and the project's) run only in
  a trusted workspace. The settings that choose what runs and what is
  billed (`museBinaryPath`, `environmentVariables`, `backend`,
  `shellSandbox`, `sandboxNetwork`, `initialPermissionMode`,
  `allowDangerouslySkipPermissions`, `modelApiHooks`, `modelApiRepoMap`,
  `modelApiPromptCacheRetention`, `turnCheckpoints`, the verify loop's `checkCommands`,
  `formatOnEdit` and `diagnosticsAfterEdits`, and the five paid
  `modelApi*` features) are machine-scoped in every workspace, trusted or
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
  folder is 0700 on macOS and Linux. Each window owns its index, pinned
  captures, staged copies and presence; records use Git compare-and-swap
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
  Git for Windows walks into junctions, so a capture
  leaves out, and names, any path under a folder link or junction, and a
  restore refuses a path whose canonical form is not the workspace's
  canonical root plus the path (a link or junction on the way) before each
  write or delete. A restore deletes only regular files, checks each file's
  content against what it expects just before changing it, writes through a
  temporary file whose permissions are the old file's with only the
  execute bits set from the checkpoint, and leaves a file changed outside
  the conversation's turns, by another conversation's overlapping turn, or
  with unsaved editor or notebook changes as it is. File names reach git as
  literal paths, never as pathspec magic. None are taken in Restricted Mode.
- **Path confinement (Model API backend).** Every path a tool names is
  resolved through the file system (links, junctions and short names)
  before it is read or written, and refused when it leaves the workspace;
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
  writes nothing. On the Muse Code backend the `ide` server's tools change
  nothing and declare themselves read-only; its rename returns the edits for
  Muse Code's own edit tool, and Muse Code 1.4.0 asks its own card for these
  tools in its on-request mode. The repo map reaches the Model API's
  instructions only in a trusted workspace.
- **Protected writes (Model API backend).** Writing `.git/**`, `.husky/**`,
  `.vscode/**`, `.idea/**`, `.devcontainer/**`, `.github/workflows/**`,
  `.agents/**`, `.muse/**`, `AGENTS.md`, `CLAUDE.md`, `.envrc` or
  `.gitmodules`, at any depth and in any letter case, shows an approval card
  in every mode but Bypass (Plan refuses it), and no "always allow" rule
  covers it. The one exception is a Markdown note written by the memory
  tools inside a memory folder, which is an ordinary edit. Muse Code flags
  its own protected writes, and "Edit automatically" never answers those
  for you.
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
  output cap, and only after the user's approval in the modes that ask. On
  the Muse Code CLI backend the CLI runs the commands inside its OS sandbox
  where that is set up; `museSpark.shellSandbox` at `auto` starts the CLI
  without the sandbox for a Windows workspace under the user's profile
  (where the sandbox cannot enter), and `off` never sandboxes; both leave
  the approval cards in place.
- **Check commands and `then_run` (Model API backend).** The commands the
  extension runs after the agent's edits (`museSpark.checkCommands`,
  machine-scoped, none by default) and the one an edit's `then_run` names
  take the shell tool's own hooks and permission path: the user's
  PreToolUse, PostToolUse and PostToolUseFailure hooks see each as a call
  of the shell tool (a denial, a rewrite or a demanded question holds), as
  does PermissionRequest wherever the shell's card would show; they ask wherever a shell command would ask (every mode
  but Bypass permissions), never run in Plan mode or Restricted Mode, and
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
  protected write: a paid call always reaches the paid-use popup, unless
  the user allowed that feature always in this (trusted) workspace, and a
  paid image aimed at a protected path asks even then.
- **MCP servers (Model API backend).** Started only in a trusted
  workspace. A local server sees only an allow-listed part of VS Code's
  environment plus its own `env`; the Model API key is never passed. On
  Windows each stdio server runs in a job object that ends its descendants.
  Remote error bodies and authentication challenges stay out of tool
  errors and logs.
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
- **Webview.** `default-src 'none'`, a per-load script nonce, no remote
  origins, no inline styles; every message between the host and the
  webview is validated against a schema.
- **Prompt injection.** Workspace files, rules and skills reach the model by
  design in a trusted workspace, and so do fetched web pages (marked as
  untrusted content); the permission modes and the approval cards are the
  control, and the Diagnostics report and the log show what ran.
- **Release pipeline.** A tag is released only when it names the manifest
  version and points at a commit on `main`; the Marketplace PAT reaches one
  step, after an install that runs no package scripts; no checkout keeps a
  token; every job has a timeout.
- **The macOS dictation helper** is ad-hoc signed, not notarised (owner
  decision); VS Code's installer does not quarantine it, so Gatekeeper does
  not assess it.

More detail: `docs/PRIVACY.md` and PLAN.md §9.
