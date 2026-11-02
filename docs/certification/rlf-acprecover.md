# RLF-ACPRECOVER — the ACP agent after Muse Code dies under it (2026-11-02)

Lane RLF-ACPRECOVER, rig `macmini`, worktree `~/lanes/RLF-ACPRECOVER`,
branch `rec/rlf-acprecover`, base `5ec754534` (cc/int9, 0.19.0 era).
Muse Code CLI 1.4.14 throughout.

## 1. What RLF-M111AX saw, and what was measured

Running lane RLF-M111AX through our app on 0.19.0, `muse serve` was
stopped by SIGKILL 6,174 s into a turn. The agent answered the client
`Internal error: Muse Code was stopped by SIGKILL`; then every next
`session/prompt` on that session answered `-32002 Resource not found:
<uuid>` (three in a row) with `[warn] ... cancel failed: Error` and
`[warn] task/stopAll before releasing session ... failed: Error` in
its log, though the log also says `sessions durable`. A durable
session was lost to the person until they started over.

Reproduced on this rig against base sources with the real CLI: a real
`muse serve` killed by SIGKILL under the real ACP agent, then a
prompt. Base answers `-32002` (message `That did not work (the Muse
Spark log has the details)` on this ACP SDK; the code is the
finding's signature) and never re-attaches. See §5.

## 2. The causes, measured

- The registry retired every session on the dead backend and the agent
  kept nothing: the next prompt found no session and answered
  `resourceNotFound` with the raw id.
- `MuseSession`'s stops (`cancel`, `interrupt`, `stopAllTasks`) sent
  their commands at the dead connection; the failures surfaced as
  `cancel failed: Error` / `task/stopAll ... failed: Error`, naming
  only `Error`.
- Resume refusals (the store's not-found, and an ephemeral host's
  unserved `session/resume`) arrived as wire errors the agent never
  translated.

## 3. The fixes

- `src/acp/agent.ts`: an unexpected `hostExited` records a detached
  session (cwd + exit). The next prompt, config set, or load brings
  the backend back — a fresh host, the stored session resumed on it,
  adopted with the remembered mode/model/effort/roots/MCP and no
  replay — so the person carries on with their history. The restart
  loop is bounded by `INDUSTRY_RETRY_MAX_RETRIES` with
  `retryDelayMs`/`MODEL_API_RETRY_JITTER_MS` (D228), each wait shows
  as the panel's `turnRetry` notice, and a cancel stops it (the
  prompt answers `cancelled`). Terminal failures answer in words:
  `acpBackendRestartCliGone`, `acpBackendRestartSessionLost`,
  `acpBackendRestartGaveUp` (English + all 14 tables). The in-flight
  turn rejects with the exit's own words via `hostExitError`, never
  reported finished. Close/delete/logout give up the detached
  record. `hostExitError` is retryable for unexpected,
  non-persistent exits only.
- `src/core/backends/musecode/MuseCodeHost.ts`: `cancel`,
  `interrupt` and `stopAllTasks` run through `ifLive`, which skips
  on a dead host, logging `session <id> <verb> skipped: host
exited`: a processed exit (the channel), a broken pipe, or the
  SDK's own closed-connection refusal (its two local wordings;
  every other `ProtocolError` still throws, and a refused stop on
  a live host still warns with its kind). Resume refusals
  (`sessionNotFound` and an ephemeral host's `methodNotFound`) map
  to `SessionNotFoundError`. `stopAllTasks` returns the guard's
  promise without an extra `await`, so a refused stop still settles
  inside the release's flush. The MuseCode bundle holds its
  125 KiB budget at 127,987 bytes.
- One seam, shared with the panel backend
  (`src/runtime/panel/controllerRegistry.ts`,
  `src/runtime/panel/runtimeConversation.ts`): the whole `HostExit`
  travels `hostExited`/`hostStopped`; the panel keeps its
  close-then-release behaviour.

## 4. Proof: real-CLI suites

No model call leaves the machine in any suite: the unsigned leg runs
the echo provider under a throwaway home with a dead proxy, and the
agent leg sends no prompt with a live backend except local echo
turns. Every suite gates on what one `muse serve` answers about
itself (`test/unit/helpers/acpRecoverRig.ts`, no guess from files).

### Suite A: `test/unit/acpBackendRecover.test.ts` (host + registry)

Five tests over a real `muse serve` killed by SIGKILL: idle exit
reporting with the whole exit crossing the shared seam, mid-turn
honesty (the submission rejects; no completion lands after the
exit), `task/stopAll`/`turn/interrupt` skip with the state named
plus the kill-race, resume-refused reading as not-found, and the
handshake-fast pin for a CLI that cannot stay up. 5/5 green
(~13–27 s on the shared rig; each test carries the named
`RECOVER_TEST_TIMEOUT_MS` with its reason).

Red drill: the suite copied onto base sources (`5ec754534`,
`$TMPDIR/rlf-red`, removed after) fails 4/5 — the four behaviour
tests — while the handshake pin passes on both, as it pins
unchanged CLI behaviour. Green on the branch: 5/5.

### Suite B: `test/unit/acpBackendRecoverAgent.test.ts` (agent)

Nine tests driving the real agent over real backends the test
kills, in three gates plus the words:

- Durable (3: idle re-attach with a live round trip, mid-turn error
  plus history replay, load-fresh after close): skip where the CLI
  serves ephemeral sessions.
- Where sessions open (4: quiet close of a dead session, CLI-gone
  words with no retries, give-up words after exactly
  `INDUSTRY_RETRY_MAX_RETRIES + 1` attempts with both retry
  notices, stop-while-waiting answering `cancelled` with no second
  attempt).
- Ephemeral (1): the store without the session answers the
  lost-session words through both the load branch and the prompt's
  re-attach.
- The three sentences in all 15 languages through the real table
  loader, each install verified by locale, each rendering checked
  for slots, UUIDs and `Resource not found`.

Here the CLI serves ephemeral sessions with a 4-model catalogue
(measured 2026-11-02; the credential file verifies `inline`, yet
the CLI will not honor it in this lane's home — the structural
gate passed and the functional probe correctly gates on served
behaviour instead). Result here: 6 passed, 3 durable skipped.
An ephemeral host refuses a session that selects a permission
profile (`an ephemeral host fixes its permission surface and cannot
select a profile`, measured), so the legs that run there open in
Plan, which selects none.

Red drill: the suite on base sources fails all 6 runnable tests —
each fails at detach recording (`the agent never recorded the dead
session as detached`), the mechanism the finding lacked — and a
base probe answers the post-kill prompt with `-32002`. Green on
the branch: 6/6 with the same 3 durable skips.

### What runs where

- Here (macmini, ephemeral CLI): Suite A 5/5, Suite B 6 passed + 3
  durable skipped, words in 15/15.
- Lead env / CI with a durable CLI: Suite B's durable three run
  (idle re-attach, mid-turn with history, load-fresh). The mid-turn
  test turns on echo only where echo itself is durable, else skips
  naming why.

## 5. The packed agent

`npm run package:acp` builds after the two darwin helpers are
compiled (`native/darwin/build-local-judge.sh`,
`native/darwin/build.sh`; universal also wants the Linux helpers,
so the run used the targeted
`dist/muse-spark-code-acp-0.19.0-darwin-arm64.tgz`). The packed
binary runs (`--help` answers).

The packed kill-by-hand run is blocked on this rig, not by the
sandbox but by pre-existing product behaviour outside this lane:
the packed agent opens sessions in Manual, Manual selects a
permission profile, and the ephemeral CLI here refuses any session
that selects one — so `session/new` itself fails before any kill.
No flag changes the initial mode. The lead-env run (durable CLI)
is: install the tarball in an empty folder, open a session, SIGKILL
the agent's `muse serve` child, send the next prompt. Expected
model calls: 0 stated before (no turn runs before the re-attach;
ephemeral answers words, durable resumes) — or, to prove history
with content, one `muse-spark-1.3-contributor` turn before the
kill and one after (2 calls, stated here, counted from the CLI's
session records afterwards). No paid call was made in this lane.

Observed alongside (not this lane, named for the lead): unsigned
users can only open Plan/Bypass sessions, since Manual/Auto select
a profile the ephemeral host refuses. Omitting the profile there
would change who reviews unsigned Manual sessions, so it needs a
design decision, not a lane-side edit.

## 6. Gates

All run in the worktree on macmini; exit codes shown.

- `prettier --check` on touched files: 0.
- `eslint --max-warnings 0` on touched files: 0.
- `npm run typecheck`: 0.
- `node scripts/check-l10n.mjs`: 0 (after `npm run desktop:l10n`
  regenerated the desktop tables for the 3 new keys).
- `npm run check:reference`: 0.
- `npm run check:host-api`: 0.
- `npm run check:plan`: 0.
- `npm run check:roadmap`: 0 (after the RLFACPRECOVER entry and
  `npm run roadmap:generate`).
- `npm run check:catches`: 0 (baseline match; the restart loop
  carries its cause and a stop returns `undefined`, adding no
  SWALLOW/GENERIC/CLEANUP).
- `npm run duplication`: 0.
- `npm run cycles`: 0.
- `npm run deadcode`: 0.
- `npm run build`: 0 (budgets hold).
- `npx vitest run test/unit/acpBackendRecover.test.ts
test/unit/acpBackendRecoverAgent.test.ts
test/unit/acpTurnFailure.test.ts --maxWorkers=3`: green (repo
  timeouts; the two recovery files carry the named
  `RECOVER_TEST_TIMEOUT_MS`).
- `npx vitest related <each changed source file> --run`: the
  recovery suites green; the heavy related sets shed load flakes
  with varying victims run to run (`acpUpdateNotSent.test.ts`,
  `teamProcessWorkers.test.ts`, `runtimePanelGit.test.ts`,
  `runtimePanelGitLease.test.ts`, `team/externalOrchestrator.test.ts`).
  Each passes alone on the branch, and the base worktree fails the
  same way under load (`teamProcessWorkers` 10 failed on base in a
  busy window after 15/15 in a quiet one; `acpUpdateNotSent` fails
  identically on base) — left to hosted CI. One related failure
  was real and is fixed: `musecodeDispose.test.ts` ("a failed stop
  names its kind") needs the refused stop to settle inside the
  release's `listModels` flush, and the guard's extra `await` in
  `stopAllTasks` pushed it past; `stopAllTasks` now returns the
  guard's promise directly (7/7 three times).

## 7. Not proven, and open questions for the lead

- Suite B's durable three (idle re-attach, mid-turn with history,
  load-fresh) need a CLI that serves durable sessions; they skip
  here and await the lead env or signed-in CI.
- The packed kill-by-hand run awaits the lead env (§5); 0 model
  calls if words suffice, else 2 named `muse-spark-1.3-contributor`
  calls to prove history with content.
- Windows CI must verify the SIGKILL wording branch (guarded
  `process.platform !== 'win32'` in Suite A) and the native
  packaging path.
- `acpUpdateNotSent.test.ts` fails in the related set on base too
  (pre-existing); left to hosted CI.
- The ephemeral-profile refusal (§5, unsigned Manual/Auto
  sessions) is observed product behaviour, not this lane's to
  change.

## 8. Commits

- `15bef9686` — the fix: detached-session re-attach with backoff,
  dead-host skip, registry exit passthrough, 3 l10n keys in 15
  tables.
- `567ee9a6f` — Suite A (5 real-CLI tests).
- `176991ebc` — the shared serve rig both suites use.
- `9c051c676` — Suite B (9 agent-level tests).
- `0e1180e6c` — shared resume-open, bundle fit, release-flush fix.
- (records) — this file, CHANGELOG, PLAN §6 + roadmap entry.
