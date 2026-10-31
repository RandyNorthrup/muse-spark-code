# RLF-SHUTDOWN — the ACP agent ends when its client leaves, even while Muse Code is starting (2026-10-31)

Claude Code lane `RLF-SHUTDOWN`, worktree `/Users/randy/lanes/RLF-SHUTDOWN`,
branch `rec/rlf-shutdown`, on the test rig `Macmini.ivettnet` (macOS 15.7.4,
Intel x86_64, Node 24.21.0, npm 11.19.0). Base: `cc/int7` (`4e6a7140c`, CC-INT7's
merge round, `docs/certification/cc-int7.md`). The brief's other source,
`rlf-acphonest.md` (B3, orderly session release), is not on this base: its lane
(`rec/rlf-acphonest`) is not merged here, so this lane neither read its code
into the base nor touched the session-release path it changes. An earlier run
of this lane in Muse Spark Code stopped on a 429 after reading files and left
nothing in the tree; nothing was carried from it.

Provider calls: **0**. Model attempts: **0**. Muse model requests: **0** (no
prompt was ever sent; every run used a throwaway HOME and every proxy variable
at the dead `127.0.0.1:9`). Nothing was pushed, rebased, stashed or tagged.

## 1. What CC-INT7 saw, and what was measured

CC-INT7 §6.1 and §9 item 5: with `muse serve` stuck starting, "closing the
agent's standard input doesn't end it, and SIGTERM leaves the CLI orphaned.
This is UNMEASURED beyond the observation."

**Method.** The packed agent (`npm run package:acp -- --target darwin-x64`, 146
of 146 package checks, extracted into an empty folder) and a real Muse Code
1.4.11-R6667.1 (`~/.local/bin/muse`, found through `PATH`, `MUSE_NO_AUTO_UPDATE=1`
so the launcher touches nothing in its install folder). Every run: a fresh HOME
(`HOME`, `USERPROFILE`, every `XDG_*_HOME` and `TMPDIR` under the lane's
gitignored `temp/runs/<label>/`), the placeholder sign-in
`test/fixtures/maccred/v1-auth-set.json` as its `auth.json` (so `session/new`
starts the CLI), the dead proxy. A real parent process (the driver, or a
separate "editor" process for the parent-kill case) speaks ACP with the SDK's
own client: `initialize`, then `session/new`, which starts `muse serve` and never
answers. After five seconds the driver does one action and samples `ps` every
250 ms for the processes of the run, following them after they are reparented.

**The CLI is stuck in the Keychain.** `sample` of the CLI during the wait: the
main thread is in `SecItemAdd` > `SecKeychainItemCreateFromContent` >
`StorageManager::defaultKeychainUI` > `makeLoginAuthUI` > `AuthorizationCopyRights`,
the same stack CC-INT7 recorded. It happens with the placeholder inline sign-in,
with the CLI's `--provider echo` as well (a `--muse-binary` shim that only added
that documented flag, run once), and `launchctl managername` in this session is
`Background` (no screen). A real CLI therefore never answers `initialize` on this
rig in this session: the state "Muse Code answered" cannot be reached here (§7).

**Before** (base `4e6a7140c`, one run each, the action at about 8 s):

| Action                                       | Agent ended                  | Muse Code (`muse-bin`)                                            |
| -------------------------------------------- | ---------------------------- | ----------------------------------------------------------------- |
| (a) the agent's input closed                 | **30.37 s** after, exit 0    | ended at 30.37 s (the SDK's SIGTERM, after its 30 s drain window) |
| (b) SIGTERM to the agent                     | 0.31 s, killed by the signal | **left running** (ppid 1, still blocked 70 s later)               |
| (c) SIGINT to the agent                      | 0.32 s, killed by the signal | **left running** (ppid 1, 70 s later)                             |
| SIGHUP to the agent (a terminal closing)     | 0.31 s, killed by the signal | **left running** (ppid 1, 70 s later)                             |
| (d) the editor killed, log piped to it       | **10.36 s** after            | **left running** (ppid 1, 70 s later)                             |
| (d) the editor killed, log to a file         | 30.38 s after                | ended at 30.07 s                                                  |
| input and log closed together (editor crash) | **exit 1** at 10.35 s        | **left running** (ppid 1, 50 s later)                             |

The 25 starts of the stuck CLI through the agent in this lane (9 on the base
build, two of them inspection runs, and 16 on the fixed builds) were all ended by the driver's cleanup or by the agent; none
completed a Keychain write (each was blocked in the authorization wait until it
was signalled). Which login keychain macOS resolved for the blocked write (the
throwaway HOME's, or the account's own) is UNMEASURED.

Process table before the action and 70 s after SIGTERM, base build:

```
pid 25118 agent:       ppid 25116 pgid 25112 S    node .../dist/acp.js
pid 25131 agent-child: ppid 25118 pgid 25131 Ss   muse-bin-1.4.11-R6667.1 serve --disable-shell
  ACTION: sigterm
pid 25118 agent: GONE (0.31s after the action)
pid 25131 agent-child: ppid 1 pgid 25131 Ss etime 01:19   muse-bin-1.4.11-R6667.1 serve --disable-shell
RESULT: 1 process(es) remain after 70s: 25131 (agent-child)
```

## 2. The causes, measured

1. **The serving agent handled no signal.** `serve()` in `src/runtime/main.ts`
   waited on `connection.closed` and nothing else: SIGTERM, SIGINT and SIGHUP took
   Node's default action, so no `finally` ran and the CLI was left. The CLI is a
   process-group leader the SDK made, so the terminal's own SIGHUP and Ctrl-C do
   not reach it either.
2. **The unstarted CLI got the SDK's drain window.** The close ladder (EOF, 30 s
   `shutdownTimeoutMs`, SIGTERM, 2 s, SIGKILL on the group) is right for a host
   that answered and has sessions to drain; for a process that never answered
   `initialize` it is 30 s of waiting on a process that reads nothing. That is
   CC-INT7's "stdin close does not end it": it ends at 30.4 s.
3. **A closed log pipe killed the agent.** An editor that crashes closes the
   agent's stdout, stderr and input. The input ends the session, but the agent's
   next log line (here the 10 s `resources.admission` warning, and at the end of
   any shutdown the "Ignoring error while closing muse serve" line) fails with
   EPIPE on `process.stderr`, which had no `error` listener: an uncaught exception,
   exit 1, no cleanup, CLI left.
4. **A dispose during the launch window hung the shutdown** (found by the new
   suite, not by CC-INT7). `MuseCodeBackendManager.dispose` aborts `resourceStop`
   and then replaces it with a new controller; `spawn` read `this.resourceStop.signal`
   again when it began to wait for `initialize`, so a dispose that landed between
   the process starting and that wait ended a wait on a signal nobody would abort:
   the shutdown waited on a start that never ends. The window is the launch (about
   100 ms: the pid file poll) and every editor restart can land in it.
5. **A wait whose signal was already aborted left its answer unread**
   (`waitForAnswer`'s early `throw`). With fix 4 the already-aborted case became
   reachable, and the CLI dying after its stop was an unhandled rejection
   (`ProtocolError: connection reached EOF`) that crashed the agent with exit 1
   in the middle of its shutdown.

## 3. The fixes

- `src/runtime/serveLifetime.ts` (new), wired in `serve()`: SIGTERM, SIGINT and
  SIGHUP abort a signal that ends the agent's input stream exactly as the client
  closing it does (`webReadable(source, leave)`), so one orderly path (registries,
  schedules, usage, governor, `runtime.close()`, journal) ends the backend first
  and the agent exits 0. A closed log pipe (EPIPE) is ignored; any other error on
  it stays loud.
- `src/host/resources/museResourceLaunch.ts`: a close of a handshake that has not
  answered `initialize` ends the process at once: SIGTERM to its process group (the
  pid the launch wrapper wrote is the group the SDK made), `RESOURCE_MUSE_TERMINATE_GRACE_MS`
  (2 s) to exit, then SIGKILL to the group; a signal is sent only while its exit has
  not been seen. On Windows the lease's job-helper stop (`resource.kill()`, the
  existing path, no second one). A handshake that answered keeps the SDK's ladder.
  Where no group is known (no lease) the SDK's own ladder still ends it.
- `src/host/backend/museCodeBackendManager.ts`: `spawn` keeps the stop signal it
  started under.
- `src/core/timeouts.ts`: an already-aborted signal stops the wait through the same
  race, so the answer is always read.
- `docs/acp.md` ("When the editor leaves"), CHANGELOG `[Unreleased]` (Fixed),
  PLAN.md §6 `RLFSHUTDOWN`, the roadmap entry.

**Research for the grace.** The MCP stdio transport's shutdown is: close the
child's input, wait, SIGTERM, then SIGKILL; the specification leaves the waits to
the client
([MCP stdio transport](https://modelcontextprotocol.io/specification/latest/basic/transports/stdio)).
The MCP Python SDK's stdio client waits `PROCESS_TERMINATION_TIMEOUT = 2.0` s and
terminates the process group on POSIX with a 2.0 s default grace
([issue 1364](https://github.com/modelcontextprotocol/python-sdk/issues/1364),
[PR 765](https://github.com/modelcontextprotocol/python-sdk/pull/765); PR 2773
changes the group handling and was not confirmed merged). The Muse SDK's own
`SIGTERM_GRACE_MS` is 2 s, "the same two seconds" as Codex's stdio launcher
(`node_modules/@muse-code/sdk/dist/src/connection/spawn.js`). Two seconds is the
value; it is a safety limit after an error, not a limit on the person's work (D121,
D208), and the process that ignores SIGTERM is ended by SIGKILL after it. For a
process that never read its input the spec's first step (closing the input) has
nothing to tell it, so the ladder starts at SIGTERM and the SDK's EOF follows
once the process is gone.

## 4. Proof: real-process suites

`test/unit/acpShutdown.test.ts` (POSIX; Windows is skipped with its reason in the
file's header, it needs process groups): the production build's `dist/acp.js`
(shared build, `productionBuild.ts`'s list) under the SDK's ACP client, started
with `--muse-binary` naming Node itself so the "Muse Code" is the folder's
`serve.js`, a real process that never reads its input and never answers and has a
child of its own in its group (it imitates no part of the protocol; it is what the
Keychain-blocked CLI is to the agent). 11 cases, 0.5 s to 2.8 s each:

- before any backend started: the input closing, SIGTERM, SIGINT, SIGHUP each end
  the agent with exit 0;
- while Muse Code is still starting: the same four plus the editor vanishing with
  its pipes (input and log closed) each end the agent with exit 0 within 10 s (the
  old path took 30 s), and the CLI, its child and its whole group are gone;
- a Muse Code that ignores SIGTERM is ended by SIGKILL after the grace (the agent
  took at least the 2 s grace, under 10 s);
- another agent's Muse Code and an unrelated process are never touched, and the
  other agent still ends its own when its client leaves.

`test/unit/serveHandshakeWait.test.ts`: a stop asked before the wait still reads an
answer that fails later (no unhandled rejection).

Final run with the repository's own timeouts (the files' named 30 s per-case
budget: a case starts the production agent and a child and waits for both to exit),
three runs, `--maxWorkers=3`: **16 passed of 16, each time**; no process of any
run left behind (`ps` after each).

### Red/green drills

Each: one edit, the owning suite, non-zero exit, restored from a saved copy, the
same command green (logs in `temp/drill/`, gitignored).

| #   | Break                                                                                        | Caught by                                           | Red                                           | Green |
| --- | -------------------------------------------------------------------------------------------- | --------------------------------------------------- | --------------------------------------------- | ----- |
| D1  | `main.ts`: `webReadable(process.stdin, leaving.signal)` back to `webReadable(process.stdin)` | "SIGTERM ends it" (no backend)                      | 1: the agent never ended, timed out at 30 s   | 0     |
| D2  | `serveLifetime.ts`: the stderr EPIPE listener removed                                        | "the editor vanishing with its pipes"               | 1: agent exit `code: 1`, expected 0           | 0     |
| D3  | `museResourceLaunch.ts`: the abandon of an unanswered handshake removed                      | "its input closing" while starting                  | 1: 30 s drain, timed out at 30 s              | 0     |
| D4  | `museResourceLaunch.ts`: the SIGKILL after the grace removed                                 | "ignores SIGTERM after the grace"                   | 1: timed out at 30 s (the SDK's ladder)       | 0     |
| D8  | `museResourceLaunch.ts`: SIGKILL straight after SIGTERM, no grace                            | the same case                                       | 1: `expected 116 to be >= 1900`               | 0     |
| D5  | `museCodeBackendManager.ts`: `waitForAnswer` back on `this.resourceStop.signal`              | "SIGTERM ends the agent and the process it started" | 1: timed out at 30 s (the launch-window hang) | 0     |
| D6  | `timeouts.ts`: the early `throw` on an aborted signal back                                   | "a stop asked before the wait still reads…"         | 1: `expected [ …(1) ] to deeply equal []`     | 0     |

## 5. The packed agent, before and after

The same driver, the same machine, the packed agent rebuilt from the final tree
(`npm run package:acp -- --target darwin-x64`, 146 of 146 package checks),
real Muse Code 1.4.11 stuck in the Keychain wait, the action about 8 s after the
start (and, as "early", as soon as the CLI process appears, inside the launch
window of cause 4):

| Action                                   | Agent               | Muse Code | Whole run ended after  |
| ---------------------------------------- | ------------------- | --------- | ---------------------- |
| input closed                             | exit 0              | gone      | **0.32 s** (was 30.37) |
| SIGTERM                                  | exit 0              | gone      | **0.32 s** (was never) |
| SIGINT                                   | exit 0              | gone      | **0.32 s** (was never) |
| SIGHUP                                   | exit 0              | gone      | **0.32 s** (was never) |
| the editor killed, log piped to it       | gone                | gone      | **0.32 s** (was never) |
| input and log closed together            | exit 0 (was exit 1) | gone      | **0.32 s** (was never) |
| input closed, as the CLI process appears | exit 0              | gone      | 0.31 s                 |
| SIGTERM, as the CLI process appears      | exit 0              | gone      | 0.32 s                 |

(The driver samples every 250 ms: 0.31 to 0.32 s is "by the first sample after
the action".) The after process table, SIGTERM:

```
pid 55776 agent:       ppid 55774 pgid 55626 S    node .../dist/acp.js
pid 55790 agent-child: ppid 55776 pgid 55790 Ss   muse-bin-1.4.11-R6667.1 serve --disable-shell
  ACTION: sigterm
agent stderr: [info] SIGTERM: the client is leaving, ending the session
pid 55776 (agent) ended 0.32s after the action
pid 55790 (agent-child) ended 0.32s after the action
RESULT: all processes ended 0.32s after the action
cleanup check: none of the tracked pids remain
```

## 6. Gates

All on the final tree, exit codes as run:

| Gate                                                                                               | Exit   | Note                                                                                                                                                                                                             |
| -------------------------------------------------------------------------------------------------- | ------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `prettier --check`, `eslint --max-warnings 0` on the touched files                                 | 0, 0   | (the pre-commit hook ran both on each commit as well)                                                                                                                                                            |
| `npm run typecheck` (all six projects)                                                             | 0      |                                                                                                                                                                                                                  |
| `node scripts/check-l10n.mjs`                                                                      | 0      | no new text a person reads                                                                                                                                                                                       |
| `npm run check:reference`, `check:host-api`, `check:plan`, `check:roadmap`                         | 0 each | the roadmap and plan carry `RLFSHUTDOWN`                                                                                                                                                                         |
| `npm run check:catches`                                                                            | 0      | no count rose; one existing CLEANUP site (the pid-file poll) changed identity because its `try` gained a line, baseline regenerated                                                                              |
| `npm run duplication`                                                                              | 0      | 0 clones (one in the new test found and removed)                                                                                                                                                                 |
| `npm run cycles`, `npm run deadcode`                                                               | 0, 0   |                                                                                                                                                                                                                  |
| `npm run build`                                                                                    | **1**  | the **base's four rows over, no fifth, no budget raised**: `dist/teamHost.js` 140.2 of 130 KiB, `teamRunners.js` 78.4 of 75, `teamScheduler.js` 76.5 of 75, `uiText.js` 126.2 of 125                             |
| the build's other steps, run alone (tokens, split, lazy registry, globals, notices, legal records) | 0 each | `check-bundle-size` alone: 1, the same four                                                                                                                                                                      |
| `npm run security:sast` (`SSL_CERT_FILE=/etc/ssl/cert.pem`)                                        | 1      | the same 6 blocking findings as CC-INT1 to CC-INT5 and CC-INT7, in `scripts/build-packs.mjs`, `src/core/backends/modelapi/mcp/headers.ts`, `src/runtime/node/keyStore.ts` and `os/`; none in a file of this lane |
| `npm run security:audit`                                                                           | 1      | `follow-redirects` (high), the base's, CC-INT7 §9 item 3                                                                                                                                                         |

The four bundle rows are byte-identical to the base's: `teamHost.js` 143,574,
`teamRunners.js` 80,329, `teamScheduler.js` 78,313, `uiText.js` 129,202 (the
base's sizes in CC-INT7 §7 and the CC-INT7 worktree's `dist/`). This lane
changes none of the four.

**`npx vitest related`**, the repository's own timeouts, `--maxWorkers=3`, with
the real OS credential-store and vault suites excluded as CC-INT7 excluded them:

| Changed source                                        | Result                                                                                                                                                                                         |
| ----------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `src/host/resources/museResourceLaunch.ts`            | 105 files passed, 6 skipped; 944 tests passed                                                                                                                                                  |
| `src/host/backend/museCodeBackendManager.ts`          | 6 files passed, 4 skipped; 35 tests passed                                                                                                                                                     |
| `src/core/timeouts.ts`                                | 432 files passed, **14 failed**, 17 skipped; 5,991 tests passed, 29 failed (below)                                                                                                             |
| `src/runtime/webStreams.ts`                           | `acpServeHandshake` 1 failed (below), the rest passed                                                                                                                                          |
| `src/runtime/main.ts`, `src/runtime/serveLifetime.ts` | no test file imports them: the agent runs from `dist/acp.js` in `acpShutdown` and `acpServeHandshake`                                                                                          |
| `src/shared/constants.ts`                             | **NOT RUN**: every suite imports it (its closure is the whole battery); the change adds one constant; the l10n, reference, catch, plan, roadmap and build gates stand for it, as in CC-INT7 §7 |

The 14 failing files of `related(timeouts.ts)`: `acpServeHandshake` (1),
`connectorRemoteIssuer` (3), `connectorStorageGuard` (3), `nodeTerminalPage` (6),
`playbookGovernor` (1), `playbookSchedulesInputs` (1), `providerSpend` (1),
`resourceStatusCpu` (1), `runtimeLsp` (3), `scheduleFireFailures` (1),
`teamEnginePorts` (5), `teamLandingKilled` (1), `teamLandingPause` (1),
`teamWorkerCreateBundle.test.mjs` (1): CC-INT7's list (§7 rows 1 and 4, `runtimeLsp`
§3.6). Measured, not assumed: the 13 files other than `runtimeLsp` were run together
here and on an extracted copy of the untouched base (`git archive 4e6a7140c` under
`temp/base`, `node_modules` linked): **the same 25 tests fail on both**. Here five
more `scheduleFireFailures` cases failed in that loaded run (the file took 27 s); run
alone, twice each, it passes **8 of 8 here and 8 of 8 on the base** (a 5 s test
under load; the file imports none of this lane's code). `runtimeLsp`'s three
supervisor cases are the macOS socket-path limit of CC-INT7 §3.6 (the same sentence).

Before the exclusions were in place, one `related(timeouts.ts)` run also ran
`providerHeadersStore` and the `test/unit/vault/**` suites on this Mac mini (the
shared rules allow them on the Mac mini, not on a MacBook): `providerHeadersStore`
(2 of 3 failed), `chatgptSubscriptionMigration` (7 of 7), `posixVaultPanelFlow` (1 of
2), `vaultStoreScope` (1 of 5). They are failures of this rig's session (no screen
for the Keychain), not a result for this lane; whether they left items in this
rig's keychain is UNMEASURED and was not looked at (no keychain command was run).

## 7. Not proven, and open questions for the lead

1. **Fail with words when Muse Code waits on an OS prompt that cannot appear.**
   Not built; a question. Checked: `muse serve --help` offers no non-interactive
   mode, credential-store switch or start timeout; `-c KEY=VALUE` refuses unknown
   keys and lists no valid ones (`-c bogus_key=1` exits 2 at once); the binary names
   `credential_backend`, `keychain_fallback_file` and `interaction_not_allowed`
   (internal outcome names, no documented setting); `TBH_CREDENTIAL_BACKEND=file`
   is named in D26's archive only for R4161.1 and, on a Mac, signs the person out
   (`constants.ts`, the CLI's credential file note), so it is not a flag the product
   can pass. The CLI blocks at start whatever the provider. Failing the start by
   our own timer is a limit of ours (D121); failing on proof needs the CLI's cooperation.
   Options: **(A, recommended)** file it upstream with CC-INT7 §6.1's stack and this
   record's `launchctl managername` finding: `muse serve` should fail its Keychain
   write with `interaction_not_allowed` when it has no UI session, an outcome it
   already words; **(B)** a person-set start timeout (none by default) that fails the
   start in words, a new setting; **(C)** on a macOS `Background` session, name the
   likely cause in the "Still waiting: muse serve starting" notice (hedged, log only,
   fails nothing). Until (A) lands, closing the editor now ends the stuck start in
   0.3 s, which is the part this lane fixes.
2. **A Muse Code that already answered** keeps the SDK's drain ladder (EOF, up to 30
   s, SIGTERM, 2 s, SIGKILL) and the new signal handling reaches it through
   `runtime.close()`; no real CLI can start in this session (§1), so that state is
   UNMEASURED here. The hosted macOS and Linux legs run `acpShutdown`; a signed-in
   Mac with a screen, or the real-life run, is the proof for the answered state.
3. **Windows is not measured** (no Windows host in this lane; the suite is POSIX only).
   The Windows stop of an unanswered start is the lease's job-helper `resource.kill()`
   (the existing path); an input close and a log pipe closing are the same code on
   Windows. Hosted CI's Windows leg runs `serveHandshakeWait` and the unit battery,
   not `acpShutdown`.
4. **Where no group is known** (a launch without a governor lease, POSIX) an
   unanswered start is ended by the SDK's own ladder after its 30 s drain. The ACP
   agent always has a lease (measured: the CLI's `TMPDIR` is the lease's); an
   embedding without one keeps today's 30 s.
5. **A second signal does not force.** SIGTERM/SIGINT/SIGHUP start the orderly end,
   and a repeat is ignored while it runs (up to the SDK's drain for an answered host).
   A force-on-repeat convention (as `exec` has) is a small follow-up if wanted.
6. **The base's four over-budget bundles and the audit** stay red (CC-INT7 §9 items 1
   and 3), unchanged by this lane.

## 8. Commits

`4e6a7140c` to the commit carrying this record: `5a8a1f3a7` (the fixes and the
real-process suite) and the commit with the `waitForAnswer` unit case, the comment
on the constant, the docs, CHANGELOG, PLAN, roadmap and this record.
