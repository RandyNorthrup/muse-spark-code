# cc/m104h — M104 lane H on int/recovery: `lsp`, `supervise` and `stop`

Claude Code lane. Base: int/recovery `de0c671a28` (after cc/rlm104's
join). Branch `cc/m104h`, worktree `C:\Users\Randy\Coding\mx-cc-m104h`.
Source read, never merged: RLM104's branch
`refs/rigs/linuxlt/rec/rlm104` (`src/runtime/lsp/**`,
`src/runtime/tabServe.ts`, its tests). The design this lane follows is
remainder item 5 of `docs/certification/cc-rlm104.md`.

Environment: Windows 11 workstation, Node 24.20.0. Vitest ran with
`TMP`/`TEMP` under the worktree's `temp/tmp` and `GIT_CEILING_DIRECTORIES`
at the worktree's `temp/`. No push, no paid or live model call, no
provider request of any kind; the vault and credential-store suites
(`**/vault/**`, keyringParts, keystoreOwner, credentialLease,
providerHeadersStore) were not run. No bundle budget was raised; the two
new bundles have rows of their own.

## What was built

### `lsp` — Tab for LSP editors (dist/lsp.js)

`muse-spark-code-acp lsp [--workspace <dir>] [--trust-workspace] [--tab]
[--tab-model …] [--tab-daily-budget-usd …] [--tab-max-output-tokens …]
[--tab-trigger automatic|onInvoke] [--verbose]` is a language server on
standard I/O for one editor (`src/runtime/lsp/`):

- **Protocol.** LSP 3.17's initialize/initialized/shutdown/exit (exit 0
  only after shutdown), full document synchronization, `positionEncoding`
  UTF-16, LSP 3.18 `textDocument/inlineCompletion` when the client offers
  it, the completion list for older clients, and the commands
  `muse.tabInvoke`, `muse.tabAccepted`, `muse.usage`, `muse.help` and
  `muse.stop` through `workspace/executeCommand`. Every message is
  parsed with zod (`protocol.ts`); framing counts UTF-8 bytes and bounds
  only the header (8 KiB, the common HTTP bound), never a document. A
  request before initialize answers ServerNotInitialized, an unknown
  method MethodNotFound, bad parameters InvalidParams, and a cancelled
  request RequestCancelled at once (`unlessAborted`): the work it began
  runs to its own end, as a sent Tab request does in VS Code.
- **Tab through int's single copy** (`lspTab.ts`), in this order:
  the paid gate (`--tab`), trust, language, the request's model; the
  hook policy bound at the start (`createTabHookBridge`, the same bridge
  VS Code now builds); the file's path (links resolved, inside the
  workspace, not private or protected, `isTabPathEligible` with a fresh
  `TabIgnoreCache` for every request); the file's text through
  `isTabFileEligible`, which runs the workspace's `beforeTabFileRead` on
  the editor's buffer; only then the credential store (key presence);
  then D48's keyed question; then the cross-window ledger's reservation
  at the output cap — the person's `--tab-max-output-tokens`, else the
  model's record maximum (`tabRequestMaxOutputTokens` with the key
  client's `recordMaxOutputTokens`) — and the engine. An accepted
  suggestion's command (`muse.tabAccepted`, or `muse.tabInvoke`'s
  applied edit) reaches `afterTabFileEdit`.
- **Consent** (`lspConsent.ts`): `createTabConsent` over the shared
  `PaidUseConsent.askScope`, asked through `window/showMessageRequest`
  with D48's answers. Allow once covers the connection; Always is offered
  and kept only with `--trust-workspace`, its feature grant in the ACP
  agent's own grants store (`runtime/paidGrants.ts`) and its key (model,
  price) in `<data>/tab-consent/<workspace key>.json`; Deny snoozes the
  connection. A server started without `--tab` forgets the Tab grant in
  every folder, as the ACP agent does for an unflagged feature.
- **No store read without `--tab`.** The store and the key client are
  reached only through two ports main passes in; the paid gate quiets
  every request before either. With `--tab`, an ineligible file, an
  untrusted workspace or a hook that gives no permission never reads
  the store either. The key client (dist/modelApi.js) loads on the first
  request D48’s question allowed (its record maximum prices the reservation).
- **Not ported from RLM104.** The per-workspace broker (sockets, tokens,
  recovery locks, a supervised shared worker): int's ledger and grants
  are already shared across processes, so one server per editor (the
  LSP norm) keeps one budget and one Always; the broker's other purpose,
  one controller serving every editor's review, belongs with lane B.
  The review commands (`muse.fix`, `muse.explain`, `muse.apply`, code
  actions, published suggestions) and `muse.openPanel` need lane B's
  controller and are remainder. `tabServe.ts` is replaced by
  `lspTab.ts` over RLF-TAB's modules (RLM104's skipped every Tab hook).

### `supervise` and `stop` (dist/supervise.js)

`supervise <command>` runs one of this runtime's commands as a child it
owns whole (`src/runtime/supervise/`), passing stdin, stdout and stderr
through. On Windows the child runs in the MCP servers' kill-on-close job
(`spawnMcpJob` with no lease): ending the helper ends every process in
the job, and the helper ends with the supervisor (it waits on the
supervisor's handle). On POSIX the child leads its own process group: a
stop sends SIGTERM to the group (the runtime then stops what its own
governor launched), SIGKILL to what remains after `TREE_EXIT_WAIT_MS`,
and waits for the group to empty. A stop arrives from the supervisor's
own signals or through its private endpoint (a named pipe, or a socket
in the owner-only folder) carrying the run's token, compared in constant
time. Records live in `openPrivateRoot('<data>/supervised')`, one per run,
named by the folder's key.

`stop` asks every run started in the folder to stop and reports
`Stopped N supervised run(s).` (exit 0), nothing to stop (exit 1), or a
run that could not prove its tree gone (exit 1). The caller's own run is
asked last (`MUSE_SPARK_SUPERVISED_OWNER` in its environment), so a
supervised language server's `muse.stop` stops the others before its
own. A record whose endpoint stays gone for `TREE_EXIT_WAIT_MS` belonged
to a supervisor that died without cleaning up, and is removed.

Not the governor's registered trees, and not RLM104's process authority:
the governor applies D100's per-job fork protection (128 processes, 64
births in 15 s) to every tree it registers, which would stop a whole
supervised agent under ordinary tool use, while the runtime already
governs each launch it makes itself. RLM104's own authority (its
`privateDirectory.ts` +311, `MuseSparkJob.cs` +177, the watchdog with
receipts, `Dictation.swift`'s StrictModes walk) would be a second copy of
int's governor, job launcher and private-root modules.

Known limits, recorded rather than claimed away:

- POSIX: a supervised runtime that ignores SIGTERM past the grace is
  killed; a child its own governor started in another process group is
  then not reached by the group kill. On SIGTERM the runtime's governor
  stops those itself.
- POSIX: a supervisor killed with SIGKILL leaves its child to end at its
  standard input's end (the runtime's commands do); Windows ends the job
  with the supervisor.
- Credential variables never reach the supervised child (the runtime
  takes them out at start), so a `META_API_KEY` meant for Muse Code does
  not follow a supervised agent; `muse login` or `auth set` do.

### A VS Code finding fixed on the way

Int's lazy Tab path never ran the Tab hooks in VS Code: activation hands
`hookDispatch` to `createTabLoaded`, which passed it to the raw provider,
and the provider reads only an injected `hooks` bridge. A configured
`beforeTabFileRead` or `afterTabFileEdit` therefore never ran. The bridge
moved into `src/host/tab/tabHookBridge.ts` and both hosts build it
(`tabEntry.ts`'s `hooksOf`). Tab's portable shapes moved with it into
`src/host/tab/tabContract.ts` (tabBundle.ts re-exports what VS Code
reads), and the engine-and-ledger factory into `tabServices.ts`, so the
runtime composes Tab without reaching `vscode` (`check:host-api`).

## Tests

`test/unit/runtimeLsp.test.ts` (9 cases) drives `node dist/acp.js` from
the shared production build (`productionBuild.ts` lists the suite) with
the official LSP JSON-RPC client, `vscode-jsonrpc/node` 9.0.3 (new exact
devDependency; 10.0.0 was two days old, inside the repository's
`min-release-age=7`), over real stdio. Every per-user folder the runtime
reads points into the suite's own temporary folder. Cases:

1. initialize negotiates UTF-16, full sync, inline completions and the
   five commands, and the server exits 0 after shutdown;
2. a request before initialize is ServerNotInitialized, an unknown
   method MethodNotFound, malformed parameters InvalidParams;
3. without `--tab`, inline and list requests return nothing, the trace
   names `paid-off` and never `no-key`, and `muse.usage` / `muse.help`
   answer and show their messages;
4. with `--tab` in a trusted workspace a project `beforeTabFileRead`
   hook (`test/unit/helpers/hookHoldRecorder.mjs`) receives the editor's
   unsaved buffer in Cursor's envelope; it gives no permission, so the
   read is refused (`beforeTabFileRead: denied`, `ineligible-file`) and
   nothing reaches the store or a question;
5. with `--tab` in an untrusted workspace the hook never runs;
6. a request cancelled while its hook runs answers RequestCancelled;
7. `supervise lsp` serves the client through the supervisor, one record
   exists, `stop` from another process prints `Stopped 1 supervised
run.` and exits 0, the supervisor exits 0 and the record is gone;
8. `muse.stop` from the supervised server ends its own run, and `stop`
   then finds nothing (exit 1);
9. a supervisor killed outright leaves its record; `stop` removes it.

Tab's own hook bound (`TAB_HOOK_TIMEOUT_MS`, 1.5 s) refuses a read whose
hook has not answered in time, as designed; on a busy machine, or while
the resource governor takes its first reading, the hook may not start
inside it. Measured: one run of the touched suites had the first hook
miss the bound, and one run beside the gates had both hook cases miss it
again after a single warm-up. Cases 4 and 6 now ask until the hook has
recorded its input (case 6 cancels only a request whose hook is running,
and asks again when the bound refused one first): they still pass only if
the hook receives the buffer and the cancel answers RequestCancelled
(drills D1 and D2b, rerun on the final cases). The suite then passed 9/9
beside a full `npm run typecheck` and 9/9 on a quiet machine.

Results on the final tree (`ff77203c93`): `runtimeLsp` 9/9; the touched
suites (`runtimeLsp`, every `tab*` suite, `cliArgs`, `cliHelp`,
`cliHelpConsistency`, `cliReference`, `ciReference`, `lazyBundleFiles`,
`wireEntry`, `chatReference`): 38 files, 382 tests, all passing.

Not proven here: the paid path itself (the key read, D48's question
answered Allow, a sent request, its settlement and `afterTabFileEdit` on
an accept) needs a stored key and a provider call, so it waits for the
release's real-life run on the cheapest model; the VS Code hook fix needs
the integration suite inside VS Code, not run on this PC.

## Red drills

Each drill broke one line, rebuilt the production bundles (the shared
build's generation check), ran the case, restored the file from HEAD and
proved it byte-exact by blob hash.

| Drill | Break                                                                  | Case                          | Result                                                    |
| ----- | ---------------------------------------------------------------------- | ----------------------------- | --------------------------------------------------------- |
| D1    | `lspTab.ts`: the request's checks carry `hooks: undefined`             | 4 (beforeTabFileRead)         | exit 1: `the hook never ran` after the case's 120 s       |
| D2b   | `server.ts`: `$/cancelRequest` parsed but not acted on                 | 6 (RequestCancelled)          | exit 1: `undefined` where `-32800` (the request answered) |
| D3    | `supervisor.ts`: the stop endpoint answers the opposite word           | 7 (stop from another process) | exit 1: `[1, …]` where `[0, 'Stopped 1 supervised run.']` |
| D4    | `stop.ts`: a record whose endpoint is gone is never removed            | 9 (killed supervisor)         | exit 1: one record left where none                        |
| D5    | `server.ts`: a zod parse failure answers InternalError                 | 2 (malformed parameters)      | exit 1: `-32603` where `-32602`                           |
| D2    | `server.ts`: the reply waits for the request (`unlessAborted` removed) | 6                             | exit 0: not caught (below)                                |

Every file was restored from HEAD and matched it by blob hash
(`d846359d8b`, `0c20f725b2`, `4b69d350c7`, `8d45a3e5eb`), and the cases
went back to green. D2 is recorded as not caught: Tab's own hook bound
(1.5 s) ends every wait a request can reach without a key before a
client could tell a prompt RequestCancelled from a late one, so case 6
proves the cancellation route (D2b), not its promptness. The only
unbounded wait it shortens is D48's question, which needs a stored key.

## Commits

| Commit       | Part                                                               |
| ------------ | ------------------------------------------------------------------ |
| `3cd678bf29` | Tab's portable contract, services and hook bridge; the VS Code fix |
| `b0443a8e5d` | `lsp`, `supervise` and `stop`, with the suite                      |
| `ff77203c93` | the hook cases ask until the hook has run (load misses above)      |
| (this)       | this record and the PLAN status line                               |

Every commit ran the repository hooks (lint-staged's eslint and prettier,
gitleaks); none was skipped, and each committed diff was re-read.

## Final gates on this lane's tree

| Gate                                                                       | Exit | Note                                                                                     |
| -------------------------------------------------------------------------- | ---- | ---------------------------------------------------------------------------------------- |
| `format:check` (prettier)                                                  | 0    | whole repository, this record included                                                   |
| `lint` (eslint, stylelint, PSScriptAnalyzer)                               | 0    |                                                                                          |
| `typecheck` (all six projects)                                             | 0    |                                                                                          |
| `check:catches`                                                            | 0    | every new catch NARROW or REPORTED; baseline unchanged                                   |
| `duplication` (jscpd, threshold 0)                                         | 0    | 0 clones                                                                                 |
| `deadcode` (knip)                                                          | 0    |                                                                                          |
| `check:host-api`                                                           | 0    | record regenerated: Node built-in counts only; 57 files import `vscode`, none in runtime |
| `check:mhp`                                                                | 0    | contract untouched                                                                       |
| `check:plan`                                                               | 0    | PLAN.md 3,564,928 of 3,565,158 bytes                                                     |
| `check:reference`, `check:l10n`, `check:roadmap`, `check:tokens`, `cycles` | 0    | reference and lazy registry regenerated; 14 tables translated                            |
| `build` (size, split, lazy registry, globals, notices, legal)              | 0    | new rows: `dist/lsp.js` 100 KiB, `dist/supervise.js` 50 KiB                              |

Size lines (base `de0c671a28` → this tree): `dist/lsp.js` new, 83.0 KiB
(budget 100); `dist/supervise.js` new, 30.8 KiB (budget 50); `dist/acp.js`
388.8 → 394.9 KiB (budget 850: the three parsers, help topics, loaders and
main's wiring); `dist/tab.js` 59.1 → 59.1; `dist/extension.js` 512.3 →
512.3; `dist/wire.js` 74.3 → 74.3; the panel's surface English 24.7 →
24.7 KiB (25,332 bytes). The new text groups are named `languageServer`
and `supervision`, not `lsp` and `supervise`: the generated reference's
route names would otherwise pull them into the panel's English, which
measured 25,686 bytes, over its 25 KiB budget, before the rename.

## Remainder

1. **The paid path in real use.** A stored key, D48's question answered,
   a sent request on the cheapest model, its ledger settlement and
   `afterTabFileEdit` on an accept, through the packed product's `lsp`
   in Neovim 0.12 (inline completions) and one completion-list editor:
   the release's real-life run, with its stated calls and cap. Until
   then no README, CHANGELOG or feature-catalogue line claims Tab in LSP
   editors (the Tab feature's editors stay `vscode`); only the help
   paragraph names `lsp`, `supervise` and `stop` among the commands
   that document themselves.
2. **The packed package.** `npm run package:acp -- --target win32-x64`
   stops at the ACP notices on int: nine packages of sigstore's tree in
   dist/packsVerify.js need a licence review (BlueOak-1.0.0 or no
   licence file). This lane adds no production dependency; the packed
   run of `lsp`/`supervise`/`stop` waits for that review.
3. **VS Code's hook fix in VS Code.** The integration suite inside VS
   Code (a configured `beforeTabFileRead` refusing a Tab read) was not
   run on this PC.
4. **POSIX supervision.** Cases 7–9 ran on Windows (the job path); the
   process-group path runs in hosted CI's Linux and macOS jobs.
5. **One ledger with VS Code.** The runtime's ledger and Always records
   live in the agent's data folder, VS Code's in its global storage:
   one budget across VS Code and the LSP editors needs lane B's shared
   settings and storage store.
6. **With lane B** (cc-rlm104 item 1): the review commands
   (`muse.fix`, `muse.explain`, `muse.apply`, code actions, published
   suggestions), `muse.openPanel`, and a shared workspace runtime for
   every editor (RLM104's broker) if the controller needs one.
7. **Native shims** (cc-rlm104 item 6): the editor hosts that start
   `lsp` and `supervise` for their users.
