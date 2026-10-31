# RLF-TEAMWORKERS — Muse Code and external ACP agents as team workers (2026-10-31)

Lane `RLF-TEAMWORKERS`, worktree `/Users/user/lanes/RLF-TEAMWORKERS`, branch
`rec/rlf-teamworkers`, on the test rig `MacBookPro.ivettnet`. Base: RLF-TEAMFIT
`8a03edf66` (`docs/certification/rlf-teamfit.md`; TEAMWIRE's open question 2 in
`rlf-teamwire.md`). The lane ran first in Muse Spark Code, which stopped when
Muse's weekly allowance ran out (429, resets 2026-11-02T00:00:00Z) with only
three uncommitted files; it was finished here in Claude Code (Sonnet 5.5) on the
same branch. **Muse requests: 0. Model turns: 0. Paid provider calls: 0.** The
Muse Code host the suites start runs Muse Code's own `echo` provider, which
answers without a model request; no Muse session record was written
(`--no-session-log`). Nothing was pushed, rebased, stashed or tagged. The real OS
credential-store suites and the vault suites were not run (MacBook rule); no
browser or GUI app was started. Scratch files lived in the worktree's ignored
`temp/`.

## 1. The lead's decisions this lane carried out (its brief, 2026-10-30/31)

- **Q2, the assembly site.** The team host binding in the lazy team bundle owns
  it. The `museCode` worker port is built as a composite beside the engine port;
  the binding starts the team's own Muse Code host through
  `startTeamMuseCodeHost` (over `startNativeTeamLifetime`) on the first
  `museCode` worker and stops it with the team. External ACP workers follow
  (`runAcpWorker`): a held ACP session per worker through `acpProcess.ts`, tool
  calls and permission requests mapped to the team's approvals, the agent's own
  sign-in untouched; "not signed in" fails the worker with words telling the
  person to sign in with that agent's CLI. `canRun` accepts all three kinds where
  the surface allows them; headless `exec --team` keeps refusing non-engine
  workers (PLAN M96b).
- **Q1** (roles file, option a) and **Q3** (governed check slots) were decided
  too and are **not built here**: §6.
- No D number added: the decisions are notes for the lead (§7).

## 2. What landed

| Piece                                                                                                                                                                                                                                                                                                                                                                                 | Where                                                                               | Proof                                                                                                                                                                                                                                        |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| One task-copy lifecycle for every worker kind (start, hand-back, unreturned-copy removal, the charter/role/handoff plan)                                                                                                                                                                                                                                                              | `src/host/team/taskCopy.ts`; the engine port now calls it                           | `teamEnginePorts` (15) and `teamHostRealParts` (3) pass; on this MacBook's `/var/folders` TMPDIR the same 8 cases fail identically on the untouched base (archived `HEAD`, a macOS temp-link fence refusal) and pass on a canonical `TMPDIR` |
| Composite worker port: each task goes to the first port that can run its kind, an unclaimed kind stays unavailable and says so                                                                                                                                                                                                                                                        | `src/core/team/workers/compositeWorkerPort.ts`                                      | `teamProcessWorkers` case 1                                                                                                                                                                                                                  |
| Muse Code worker port: the team's own host starts on the first Muse Code task (a read-only role gets the second host started `--disable-write --disable-shell`), is reused, and stops with the team; every approval the host raises is classified by the role's policy; each reported model call is metered and re-admitted, so a met cap, a stop or withdrawn trust cancels the turn | `src/host/team/teamProcessWorkers.ts` (`createProcessTeamPorts`, `museSessionPort`) | `teamProcessWorkers` cases 2–4, 9                                                                                                                                                                                                            |
| External ACP worker port: PATH resolution, the contained spawn, the SDK client, `runAcpWorker`, permission and `fs/*` handlers over the role's policy, retirement proofs only from a real OS container                                                                                                                                                                                | same file (`runExternal`, `launcherFor`, `proofOf`)                                 | `teamProcessWorkers` cases 5–7                                                                                                                                                                                                               |
| The lazy bundle `dist/teamProcess.js`, loaded by the team host entry on the first process-worker probe or task, and stopped through the service's `dispose`                                                                                                                                                                                                                           | `teamProcessEntry.ts`, `teamHostEntry.ts` (`lazyProcessWorkers`)                    | `teamProcessWorkers` case 9 (the entry), build and registry gates (§5)                                                                                                                                                                       |
| The editor supplies the deps and `canRunKind` accepts `engine`, `museCode` and `external`                                                                                                                                                                                                                                                                                             | `src/extension.ts`                                                                  | typecheck, build; no packed-editor run (§6)                                                                                                                                                                                                  |
| `own` preset's modes from our agent's own advertised modes (Plan for read-only roles, Manual for the others; Accept edits, Auto and Bypass forbidden because they answer without asking the client)                                                                                                                                                                                   | `acpWorker.ts`                                                                      | `ACP_PRESETS.own` is read by the port; not yet seen on a real `session/new` (the agent asks for sign-in first)                                                                                                                               |
| Real POSIX suites for the team's launch drivers (none existed)                                                                                                                                                                                                                                                                                                                        | `test/unit/teamProcessLifetime.test.ts` (4)                                         | §4                                                                                                                                                                                                                                           |
| The spawn inventory lists the native lifetime driver as a production launch site (it said "only tests call it")                                                                                                                                                                                                                                                                       | `docs/certification/spawn-inventory.json`                                           | read, not run (no test reads it on int)                                                                                                                                                                                                      |

The new worker texts live in `TEAM_MODEL_TEXT` beside the existing `host*`
answers (model-readable English, the block the team bundles already read):
`hostKindNotOffered`, `hostExternalNotSignedIn`, `hostExternalNotFound`,
`hostExternalNoSwitch`, `hostExternalNoMode`, `hostMuseNotFound`,
`hostNoApprovalChoice`, `hostJournalForeign`.

### How a worker's approvals are answered

A worker has no approval card of its own in any surface today (the engine port
declines every approval). The Muse Code and external ports keep the role's
policy as the first word: a path outside the copy, an edit outside
`write-paths`, a git command that moves a ref, a command off the role's list and
a fetch for a role without the network are **always refused without asking**
(`classifyMuseWorkerApproval`, `answerAcpPermission`). Whatever the policy
allows to ask is then answered from the person's own saved permission mode for
the role (`isAskedApprovalAllowed`): Bypass answers yes; Accept edits answers
yes to file edits only; Manual, Plan and Auto answer no. Only the once options
are ever chosen; `allow_always` is never forwarded.

### Measured facts (captured 2026-10-31, Muse Code 1.4.10 `1.4.10-R6427.1`, no model request)

- `muse serve --provider echo -c 'mcpServers={}'` refuses: "address one server
  (`mcpServers.<name>`) or field, never the whole map" (exit 2).
- `muse serve --provider echo -c 'mcpServers.<name>.enabled=false'` is accepted
  for any name (exit 0); `-c 'mcpServers.<name>.disabled=true'` refuses
  "unknown key". The switch for leaving out a user's MCP server on Muse Code is
  therefore `-c mcpServers.<name>.enabled=false` per server name. No product code
  reads those names yet (§6). **Corrected by RLF-TEAMWORKERS2:** that held only for
  names the settings do not hold; on 1.4.14 a configured name is refused ("the
  server name is reserved"), so the switch never left a configured server out
  (`rlf-teamworkers2.md` §3).
- `muse serve --provider echo` answers a turn with the prompt echoed; the suites
  hand the worker a brief that carries a `muse-team-report` block, so the real
  host, session and turn produce a report the real parser reads.

## 3. Decisions for the lead (notes, no D number)

1. **Asked approvals follow the role's saved permission mode** (above). A
   surface that wants a card (the panel's `teamWorker` label exists on
   transcript rows, nothing produces a worker approval card) or the ACP agent's
   `session/request_permission` (M96b) replaces `isAskedApprovalAllowed` at one
   call site; RLF-ACPTEAM owns the ACP surface.
2. **`exclusiveUserServers` is `[]`** for Muse Code workers: the product has no
   marking of a user server as exclusive, so the inventory the worker fence
   requires is empty by definition. Marking a server exclusive needs a setting.
3. **The Muse Code probe is the CLI's presence**, not the model's: the lead's
   rule starts the host on the first Muse Code _worker_, and a probe runs when
   the Agent map opens. A model the host does not know fails at the first task
   with Muse Code's own words.
4. **Retirement proofs come only from the OS container**: a Windows job proves
   `windowsJob`, a Linux systemd scope `linuxCgroup`, a bare process group
   (macOS, Linux without a delegated scope) proves nothing and keeps the slot
   until the landing decision (D229) or a user decision retires it, as the board
   already does for every unproved attempt. The shared Muse Code host gives no
   per-task proof at all: the host outlives its tasks.

## 4. Real suites and red/green drills

Real code only: the real `createTeamHostService`, window scheduler, engine merge
ports and git binary; the real native process lifetime and journal; a real
`muse serve` on Muse Code's echo provider; the real packed ACP agent (staged by
`stageAgentBundle`, started with an empty home and no sign-in). The engine's
`listModels`/`startWorker` are tripwires. Repository timeouts throughout; the
launch-driver and worker cases carry one named per-test timeout each with its
reason in the file (a real host start and its handshake, or the OS identity
probes, are genuinely long). `TMPDIR` was set to a canonical folder under `temp/`
because this MacBook's `/var/folders` is a link the fence refuses (measured on
the untouched base: same 8 failures).

- `teamProcessLifetime.test.ts` (POSIX; the Windows leg is the hosted CI's,
  where the job helper compiles): launch record before the command, OS identity
  confirmed, retire on request; refused while the host is busy with no launch
  record; dispose stops every child and later launches refuse; a second window
  sees the first window's live child as an orphan, keeps it without the person's
  confirmation and stops it with it.
- `teamProcessWorkers.test.ts` (9): the composite claims each kind and leaves an
  unclaimed one unavailable; a Muse Code worker runs on the team's own host, the
  host is reused for a second task and stops with the team; a read-only role runs
  on a second host started `--disable-write --disable-shell`; a Muse Code gone
  after setup is named and nothing starts; an entry whose Muse Code is absent
  stays out of the roster; the team host entry loads the process ports on the
  first task and its `dispose` stops them; an external agent without a captured
  switch is not started and the person is told; a command gone from the PATH is
  named; the real agent with no sign-in fails with the sign-in words and its
  contained child is gone with the task.
  The two real-Muse cases and the entry case skip (named) where Muse Code is not
  installed, as on hosted CI: **NOT RUN there**.

Each drill: one break, the owning suite's non-zero exit, restore checked
byte-exact by SHA-256, green again (`temp/drill/drill.py`).

| Break                                                            | Caught by                                       | red | green |
| ---------------------------------------------------------------- | ----------------------------------------------- | --- | ----- |
| Composite `canRun` answers true for every kind                   | composite case                                  | 1   | 0     |
| Process port `canRun` answers false                              | composite case                                  | 1   | 0     |
| A new Muse Code host for every worker (reuse removed)            | host-reuse case (`expected 2 to have length 1`) | 1   | 0     |
| The read-only host provider returns the team host                | read-only case (no `--disable-write`)           | 1   | 0     |
| Muse Code missing: raw word instead of the sentence              | gone-after-setup case                           | 1   | 0     |
| `auth_required` not turned into the sign-in sentence             | real-agent case                                 | 1   | 0     |
| No-switch refusal not turned into its sentence                   | no-switch case                                  | 1   | 0     |
| Missing command not turned into its sentence                     | PATH case                                       | 1   | 0     |
| The launch-busy check removed from `launch`                      | launch-driver busy case                         | 1   | 0     |
| Orphan stop ignores the missing confirmation                     | orphan case                                     | 1   | 0     |
| The process dispose removed from the service's `dispose` wrapper | host-entry case                                 | 1   | 0     |
| `dispose` stops nothing (early return)                           | host-reuse/stop case                            | 1   | 0     |

Two single breaks stayed **green**, and are recorded as measured: removing only
`host.close()` from `dispose`, and removing only `native.dispose()`, each leave
the Muse Code host stopped, because `host.close()` retires the contained child
and `native.dispose()` retires every launch: the two stops are redundant for
the Muse Code host. The `native.dispose()` stop is what ends an external agent
still running at team stop, and no suite holds one running (the sign-in case
ends its agent first); that stop has no drill of its own.

## 5. Gates (final tree)

Exit codes are each command's own; suites ran with the repository's own
timeouts, `--maxWorkers=3`.

| Command                                                                                                                                                                                                 | Exit    | Result                                                                                                                                                                                                                                                                                                                                                                                                      |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `npm run build`                                                                                                                                                                                         | 0       | every size row holds (`dist/teamProcess.js` 313.0 of 375 KiB, new, measured 319,882 B x 1.15 rounded up to the next 25 KiB, PLAN D6; `dist/teamHost.js` 124.6 of 130, was 122.5; no existing budget changed); split gate, lazy registry (187 bundles, 295 loads), host-globals, notices (93), legal records (168 bundles) green                                                                             |
| `npm run typecheck`                                                                                                                                                                                     | 0       | six projects, no errors                                                                                                                                                                                                                                                                                                                                                                                     |
| prettier `--check` on all 28 touched files, PLAN.md, ROADMAP.md                                                                                                                                         | 0       |                                                                                                                                                                                                                                                                                                                                                                                                             |
| eslint `--max-warnings 0` on every touched `.ts`/`.mjs`                                                                                                                                                 | 0       | (also enforced by the commit hooks)                                                                                                                                                                                                                                                                                                                                                                         |
| `node scripts/check-l10n.mjs`                                                                                                                                                                           | 0       | 14 UI tables, 14 usage tables, 0 problems                                                                                                                                                                                                                                                                                                                                                                   |
| `npm run check:reference`                                                                                                                                                                               | 0       | current                                                                                                                                                                                                                                                                                                                                                                                                     |
| `npm run check:host-api`                                                                                                                                                                                | 0       | after `--write`: the inventory counts the two Node imports the process ports add (`node:crypto` 327, `node:fs` 177)                                                                                                                                                                                                                                                                                         |
| `npm run check:plan`                                                                                                                                                                                    | 0       | 244 milestones, 0 drift                                                                                                                                                                                                                                                                                                                                                                                     |
| `npm run check:roadmap`                                                                                                                                                                                 | 0       | 244 entries, current (M96's summary updated, ROADMAP.md regenerated)                                                                                                                                                                                                                                                                                                                                        |
| `npm run check:catches`                                                                                                                                                                                 | 0       | counts equal the baseline; the one GENERIC site the first draft added is now REPORTED (the refusal is logged by kind)                                                                                                                                                                                                                                                                                       |
| `npm run duplication`                                                                                                                                                                                   | 0       | 0 clones (the real-rig parts shared into `test/unit/helpers/teamRealRig.ts`)                                                                                                                                                                                                                                                                                                                                |
| `npm run cycles`                                                                                                                                                                                        | 0       | none                                                                                                                                                                                                                                                                                                                                                                                                        |
| `npm run deadcode`                                                                                                                                                                                      | 0       | knip clean; the five `@unwired` tags on pieces the ports now call were removed                                                                                                                                                                                                                                                                                                                              |
| Touched suites (`teamProcessLifetime` 4, `teamProcessWorkers` 9, `teamHostRealParts` 3, `teamEnginePorts` 15, `teamChunkPackaging`, `acpTeamPackage`, `lazyBundleFiles`)                                | 0       | canonical `TMPDIR`, repository timeouts                                                                                                                                                                                                                                                                                                                                                                     |
| `npx vitest related <9 changed sources> --run` (credential-store and vault suites excluded by the MacBook rule; `constants.ts` and `extension.ts` are covered by typecheck, build and the suites above) | 1       | 22 files: 18 passed, 2 skipped, 2 failed, 326 tests passed, 2 failed. Both failures fail identically on the untouched base (archived `HEAD`, same `TMPDIR`): `execTeamSweep` "removes the dead run with its owned ref and keeps the live one" (CC-INT5's known failure: the governed contained `git --version` exits 1) and `teamWorkspaceRefs` "throws a broken repository instead of reporting it absent" |
| `npm run package:acp -- --target darwin-arm64`                                                                                                                                                          | 1       | **NOT RUN to a result here**: `Required native helper is missing for darwin-arm64: native/darwin/muse-vault-peer-arm64` (a prebuilt helper this rig does not hold); the build and `acpTeamPackage` already check that the package carries `teamProcess.js`                                                                                                                                                  |
| `npm run security:audit`, `npm run security:sast`                                                                                                                                                       | not run | not in this brief's gate list; no dependency changed                                                                                                                                                                                                                                                                                                                                                        |

The `/var/folders` TMPDIR measurement (§2): `teamEnginePorts` (5 of 15) and
`teamHostRealParts` (3 of 3) fail on this MacBook with its default `TMPDIR`
both on the untouched base and on this tree, and all pass with a canonical
`TMPDIR` on this tree. The hosted CI's temp folders are not links.

## 6. Not built, and not claimed

- **Q1 — the roles-file snapshot.** Built nothing. Capture at
  `TeamHostBinding.reload()` and threading a `RolesLoad` through the engine
  ports changes nothing a person can see until the panel offers file-role ids
  from the same catalogue, and the panel's Roles section builds its roles from
  `builtinRoles()` only. The loader (`loadRoles`) also needs the extension's
  agent-folder roots and the session environment snapshot (tools, delegates,
  approval mode, paid ceilings), none of which the editor assembles today. It is
  the Models panel's Roles section plus the extension's loader deps: one lane.
  Recommendation: build it as that lane, keeping the lead's staleness rule (a
  running service keeps the snapshot it was created with; the next service
  creation reads the latest).
- **Q3 — governed check slots.** Not built in this lane. `requestCheckSlot`
  needs a `GovernedTeamSlots`, which needs the M107 governor's queue, its
  `capacity(kind)` and its running-work count; `ResourceLaunchHost` kept all
  three private. **Built by RLF-TEAMWORKERS2** (`rlf-teamworkers2.md` §4): the
  host lends exactly those three through `teamSlotPorts`, `CheckSlots` builds
  the governed slots and calls `requestCheckSlot`, and `dist/resourceGovernor.js`
  stayed within its 125 KiB (120.4). **Wired by RLF-TEAMWORKERS3**
  (`rlf-teamworkers3.md` §3): a Muse Code worker's `run_checks` is the caller
  (`bridgeRunChecks` → `routeWorkerCheck` → the governed `CheckSlots`, built through
  `loadRunners`); the engine route, external agents and SSH runners are not on it.
- **External agents cannot start yet.** `acpSpawnArgs` refuses any preset whose
  switch for leaving out the person's own MCP servers is not captured, by design
  (M96 step 1). When this lane ended none of `claude`, `codex`, `gemini`,
  `copilot` or `own` had one, so every external worker failed with
  `hostExternalNoSwitch`. **Superseded by RLF-TEAMWORKERS2**
  (`rlf-teamworkers2.md` §2 and §3): `claude` (a `session/new` option) and
  `gemini` (an allow-list flag) have a captured switch, `codex` and `copilot`
  still refuse, and `own` takes `--no-user-mcp-servers`. The option (a) this
  section recommended does not work as written: Muse Code 1.4.14 refuses
  `-c mcpServers.<name>.enabled=false` for any name the settings hold, so the
  flag refuses to open a session while the settings turn a server on.
- **No real model turn through either kind.** Muse's allowance is out until
  2026-11-02T00:00:00Z. The report parse, session, approval, usage and host
  paths run on the real echo host; the model's own tool use (an approval the
  classifier answers, a metered `tokenUsage`) is not exercised, and
  `museApprovalRequest`'s mapping of the host's subject kinds (`shell`,
  `fileWrite`, `fileAccess`) rests on the captured kinds `MuseCodeHost` already
  reads, not on a new capture.
- **No packed-editor run** (no GUI on this MacBook). The packed VSIX and the ACP
  package were not built here; the build, the registry and the packaging suites
  were.
- **No CHANGELOG line** and no README claim: nothing here was used through the
  packed product yet. Teams stay off until a second model is set up (D227).

## 7. The live run for the lead, after the reset (not run here)

Updated by RLF-TEAMWORKERS2 (2026-10-31): the external half now starts, with the
conditions below; updated by RLF-TEAMWORKERS3 (2026-10-31): the contributor model on
`own` is decided and built, and a Muse Code worker can run the person's checks
(steps 6 and 7). Nothing here has run.

Prerequisites: a build of this branch (`npm run build`; `node
scripts/package-vsix.mjs --target <platform>`), Muse Code signed in with
contributor mode on in its own settings, and an **empty workspace** that is a git
repository with one commit. For the external half also:

- **The Muse settings the agent reads turn on no MCP server.** `own` is started
  with `--no-user-mcp-servers`, which refuses every session while
  `~/.config/muse/settings.json` (a worker's environment drops `XDG_CONFIG_HOME`)
  names a server not set `enabled: false`. Use a profile with none, or set them
  `enabled: false` for the run.
- **The contributor-tier model on `own` is decided** (the lead, option a): `own` is
  started with `--allow-contributor-models` exactly when its pool entry names a
  contributor-tier id the product's model table lists, so the entry below selects
  `muse-wonder-full-1.0-contributor`. Check the agent's argument line (`ps -o args=`
  while it runs) ends in `--no-user-mcp-servers --allow-contributor-models`, and that
  the model is in its list: the agent lists it only after its sign-in, which the
  suites could not show (`rlf-teamworkers3.md` §2).

State first: **at most 16 requests**, all contributor tier, named explicitly:
orchestrator `muse-spark-1.3-contributor`; the Muse Code workers on
`muse-spark-1.3-contributor`; the external worker (our own `muse-spark-code-acp`)
on `muse-wonder-full-1.0-contributor`. Expected: 3–4 requests per conversation,
four conversations (orchestrator, two workers, the checks worker of step 6).
Never any other Muse id in any session started here (an unknown tier is refused).

1. Install the VSIX in a clean VS Code profile; open the empty workspace; in
   Models & Agents add two pool entries on role `engineering`: kind Muse Code,
   model `muse-spark-1.3-contributor`; and (with the answers above) external
   agent `own`, model `muse-wonder-full-1.0-contributor`. Set the role's
   permission mode to Accept edits (the worker's file edits then answer yes;
   shell commands and everything else still answer no).
2. In a new Muse Code conversation on `muse-spark-1.3-contributor`, ask the
   orchestrator to delegate one task per entry: "write `a.txt` containing `ok`"
   and "write `b.txt` containing `ok`".
3. Watch the Agent map: each task runs on its own copy and branch; the first
   Muse Code task starts one `muse serve` (one launch record `muse-host-team`
   under `<storage>/team/journal/<window>/`), the external task one
   `muse-spark-code-acp` child, whose arguments (`ps -o args=`) end in
   `--no-user-mcp-servers`. With a server turned on in the settings the external
   task must instead fail with the sentence that names the flag. Collect both;
   merge each through the merge card.
4. Close the window: both children must be gone (`ps`).
5. Count: the requests of each session from Muse Code's session records
   (`~/.local/share/muse/sessions/<year>/<month>/<day>/<session id>`, the
   `countSessionCalls` audit in `test/e2e/team.live.e2e.test.ts`) plus the ACP
   agent's own session record; the sum must be ≤ 16. Record the commands, the
   counts and the merge diffs here.
6. (RLF-TEAMWORKERS3) Put one check in `museSpark.checkCommands`, for example
   `{"name": "version", "command": "node --version"}`, and ask the orchestrator to
   delegate "run the project's checks and report what they say" to the Muse Code
   `engineering` entry. That role has the checks group, so its session starts with
   one session MCP server, `muse-team-checks`. Record, from the session record and
   the log: the approval Muse Code raised for the `run_checks` call (its `subject`
   and `toolName`; the team answers yes once to a tool whose reported name contains
   `muse-team-checks`, and refuses anything else, so a different shape shows as a
   refusal here and is the one constant to change), and that the call returned the
   check's exit code and output.
7. While step 6 runs, `ls <storage>/team/check-slots` shows a folder with a clone of
   the task's copy, and with the machine held at throttle (Settings, memory limit
   0%) two such tasks started together run their checks one after the other. On
   Linux with a delegated systemd scope and on Windows the check ends with its tree
   proved; **on macOS it ends in the uncertain-attempt sentence and the folder
   stays held** (`rlf-teamworkers3.md` §7 item 1): record which you saw.
