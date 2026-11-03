# CC-INT11 — merge round 11 on cc/int10 (started 2026-11-03)

Branch `cc/int11` starts at cc/int10 `5ecbaa766` (record: `docs/certification/cc-int10.md`, open items in its §8).
The round runs in four batches, each a fresh session; this record is what the next batch reads to carry on.

Rig `linuxlt`, `umask 022` for every command (the rig's `0002` makes the product's owner-only checks refuse fixture
folders). `npm rebuild node-pty` was run once in this worktree (merge 1: `shell.test.ts`'s real-shell case could not
load `pty.node` before it).

## Batch A — the foundations and every CI fix (budget $14)

Order (brief): rvint9, acpteam-reviewed, cc-m104gw, m109h-reviewed, cc-winfix6, rlf-cifixm, rlf-cifixc, cc-winteam,
rlf-judgep2; then build, typecheck, lint, check:mhp, check:plan, check:reference, check-l10n. The whole unit suite is
not run here: the lead sends the head to hosted CI next.

### Merge 1 — `lanes/rvint9` (72d8d5003)

Reviewed fixes: Desktop/external agent workspace path leaving through a symlink or junction; the stdio team bridge
posting its bearer to any URL (now literal loopback); the protected-path check missing `\` on Windows.

Conflicts:

- `desktop/app/terminals.ts` (header comment only): int has lane BP's node-pty header, rvint9 rewrote WB's to say the
  person's own shell keeps non-`*_API_KEY` credential names and an external agent's child is scrubbed by
  `withoutCredentials`. Merged into one header carrying both, and int's H13 read-only sentence.
- `test/unit/desktop/shell.test.ts` (imports): int's `DESKTOP_LAYOUT_FILE` and `DEFAULT_WORKBENCH_LAYOUT_V2` kept,
  rvint9's `scratchDir` helper added.
- `docs/ide-compatibility/host-api.md`: generated; regenerated with `node scripts/check-host-api.mjs --write` (exit 0,
  0 problems).

- `desktop/app/files.ts` (auto-merged): rvint9's new symlink skip sat beside the ignored-name skip, and int's
  unicorn 79 `prefer-combined-guards` refused it in the pre-commit hook; combined into one guard in the merge commit
  (the hook would not take the merge otherwise).

Interactions:

- rvint9 made `files.ts`'s `confinedPath` async (`confineToRoot` walks each link); int's lane-BP
  `confineTerminalCwd` still called it synchronously, so a terminal's working directory got a Promise and skipped the
  symlink check. `fix(int)` commit after the merge: `confineTerminalCwd` is async, `main.ts` awaits it before
  creating the terminal, `panelSessions.test.ts` awaits it and adds a symlink leaving the workspace as a refused cwd.

`shell.test.ts` 7/7 after `npm rebuild node-pty` (exit 0).

### Merge 2 — `lanes/acpteam-reviewed` (1739998fe)

ACP teams (RLF-ACPTEAM) with RVACPTEAM's fixes (one session saw another's tasks; cancel/close left a waiting merge and
its copy; a capped worker reported done; an unanswered permission now says so). Its 5 P3s stay open for the small lane
after the round (lead's notes). `rlf-acpteam` is not merged.

Conflicts:

- `src/acp/agent.ts`: int's maker tools (`makerTools`, `muse_spark_maker` server) and the lane's team preparation
  (`teamPrepared`, `withTeamMcp`) both kept: `adopt` takes both, new and resumed sessions pass the maker server
  through `withTeamMcp`; `outboundTemplates` takes the lane's list (the stored-team refusals) and int's
  `quotaOutboundSentence` stays after it.
- `src/host/teamHostBinding.ts`: int's `admitScheduledBoardTask` (C-M115-8) and the lane's `taskDiffFiles`,
  `taskReport`, `taskSession`, `stopSessionTasks` all kept; imports joined.
- `src/runtime/backends.ts`: int's `isHardwareWorkspace` and the lane's `listTeamWorkerModels` both kept;
  `startTeamWorker` takes the lane's guard (an ACP Muse Code orchestrator's engine workers run on the Model API host).
- `src/runtime/main.ts`: `runtimeFor` takes int's `maker` then the lane's `teamFor`; the ACP agent gets int's
  `userMcpServersRefusal` and the lane's `team`.
- `scripts/lib/deferredBundles.mjs`: int's external-entry list plus the lane's `acpTeamEntry`.
- `docs/acp.md`: int's table (no-limit `--questions-defer-after`, `--no-user-mcp-servers`, "When the editor leaves")
  plus the lane's `--team` row. `CHANGELOG.md`: both. `test/unit/execTeamFlags.test.ts`: int's (same assertions,
  RLF-M96CERT's comment).
- `docs/roadmap/entries.json` M96b: one summary carrying int's headless facts and the lane's ACP fact, cut to the
  260-character limit `gen-roadmap` enforces.
- Generated, regenerated: `ROADMAP.md` (`gen-roadmap`), `docs/ide-compatibility/host-api.md`, the three
  `reference*.generated.ts` (`gen-reference`, which also rewrote `docs/devices-reference.md`'s count).

Interactions:

- `src/acp/acpTeamEntry.ts` loaded `TeamMcpServer`/`teamRosterAnswer` from `teamHostEntry`; int (RLF-TEAMFIT) moved
  them to their own bundle, `teamMcpEntry` (`dist/teamMcp.js`), with `createTeamMcpRuntime(table, locale)`.
  Typecheck exit 1 (TS2339 ×2). `fix(int)`: the ACP team loads `teamMcpEntry` the way the extension does.

Decision asked by the lead — ACP's `canRunKind` stays engine-only at this merge. D250 says the team slots offer
engine, Muse Code and external agents on every surface, and M96b's "Muse Code, external and subscription workers
never start" is the headless `exec --team` rule, not the interactive ACP session's. So engine-only in an ACP session
is a gap against D250, not a design: the ACP agent has the person in the editor to answer, but it does not yet carry
the team's process-worker bundle or its credential scrub for children. Recommended: a lane after round 11 that runs
Muse Code and external workers from the ACP agent through the same `teamProcess`/`externalOrchestrator` bundles,
with the editor's permission prompt, and keeps `exec --team` engine-only. `dist/acpTeam.js` budget is checked at the
batch's build.

### Merge 3 — `lanes/cc-m104gw` (94e2f3e07, contains hosts2-reviewed)

Visual Studio and the VS Code family qualified on the owner's PC, on top of RLF-HOSTS2 with RVHOSTS2's fixes (MHP
1.6.0: `window/didChangeTheme`, `attachments/*`; panel media and schedule bundles; the editor's GitHub lease; the
recording-root `..` refusal; hosts' live-argv checks). `hosts2-reviewed` and `rlf-hosts2` are not merged separately.
Open items carried from its records: JetBrains and Eclipse payload check by reading only; VS trust adapter and
`workspace` group; VS 2026 not on the PC; `[IdeFact]` hosted reliability unmeasured (cc-m104gw.md "Still open").

MHP — one re-freeze at 1.6.0, a superset of int's 1.5.1 (D226; rvhosts2.md "What the merge with int must carry"):

- `constants.ts` `MHP`/`MHP_PANEL`, `mhp-schema.mjs` prose, the nine `hosts/*/distribution.json`, the Eclipse,
  JetBrains and Visual Studio sources and tests, `contract.json`, the two MHP unit suites, `README.md`,
  `host-api-panel-1.1.md`: the lane's 1.6.0 (int's side differed only by version; checked hunk by hunk, the ones
  that differed in more were read and are below).
- Both locks set back to `mhp/1.5.1`, `node scripts/mhp-schema.mjs --adopt-version=mhp/1.6.0` (exit 0): the v1 lock
  came out byte-identical to the lane's (`51a84a44…`), the v1.1 lock moved from the lane's `5bf914e6…` to
  `dae78eca…`. `npm run check:mhp` (`--check`) exit 0. Superset proof against int's 1.5.1 snapshots, every JSON path
  compared: v1.1 has 0 int paths missing but the one invariant sentence naming `mhp/1.5.1` (now `mhp/1.6.0`), 15
  changed (all version strings, `mhp` wire consts `1.5`→`1.6`, and F16 attachments' fallback now `react-ui` with its
  four methods), 701 added; v1 has 0 missing, 6 changed (versions), 700 added. `"external"` occurs 18 times in v1.1
  as on int; `quota` is in v1.1 (4). `expiresAt` was not added to `auth/githubLease`. scheduleV2/questions/
  usageJournal keep `museCode | modelApi`: int's 18 `external` come from the panel payloads' own enum (D250), as
  on int; the schedule hold is typed to the schedule backends (interaction below).
- PLAN D226 rewritten for 1.6.0, naming the 1.5.1 additions and this re-freeze; round 11's later MHP additions
  (RLF-PINNED, RLF-GEMPRIVACY, per the lead's notes) fold into this same 1.6.0 in batch C.

Other conflicts:

- `src/runtime/panel/nativeGitHub.ts` (add/add) and `panel/git/panelGit.ts`: two implementations of D104's source
  (a). int's M123 `editorLeaseSource` (gated on the editor offering `auth`, covered by `runtimePanelGitLease`'s four
  cases over real git) is kept as the one source; the lane's `createNativeGitHub`/`panelLeaseSource`, its unit suite
  `nativeGitHubLease.test.ts` and its `gitHubLeaseRefused` text key (en.ts and 14 tables) are not taken (no duplicate
  implementation). Its "foreign or expired lease refused in words" has no path in int's design (the lease id never
  enters from outside; an expired credential is dropped and the editor asked again), so the lane's CHANGELOG line
  saying so is not taken. The lane's own lease case in `runtimePanelGit.test.ts` passes on int's source.
  PLAN §6 gets a CC-INT11 status line saying this.
- `panelBundle.ts`, `build.mjs` (7 hunks), `check-bundle-size.mjs`, `knip.jsonc`: int's panel companion
  (`runtimePanelCompanion.js`), node, vault and crash-hook bundles and the lane's `runtimePanelMedia.js` and
  `runtimePanelSchedules.js` all kept, each with its own budget (none raised).
- `panelEntry.ts`: int's companion-era structure kept, the lane's `attachments/*` request route added to it.
- `extension.ts`: the lane's `vscodeReviewPorts` import; `createRevertIo` moved into `reviewPorts.ts` with it, and
  int's deferred verify editor stays (the lane's eager `createVerifyEditor` import is not taken).
- `portable.tsx`: int's companion root nonce stays required for the companion page; a native host's page falls back
  to its script nonce (the lane's VS fix).
- `package-vsix.mjs`: the lane's form (same exclusion of `portable/`, with its reason).
- `CHANGELOG.md`, `PLAN.md` statuses and M104 records: both sides.
- Generated, regenerated: `host-api.md`, `catch-baseline.json` (`--write-baseline`; swallow/generic counts equal to
  int's but runtime GENERIC 168→167), `lazyBundles.generated.ts` (after `node scripts/build.mjs --production`,
  exit 0).

Interactions (`fix(int)` commits after the merge):

- `panelSchedules.ts` passed core's `BackendKind` (now with D250's `external`) to the schedule hold, which takes
  `museCode | modelApi` (typecheck TS2322). The hold is typed to the schedule backends; the runtime conversation's
  `backendKind()` is already that type.
- `runtimePanelGit.test.ts`: the lane's lease case called `repositoryRun()` with no arguments; int's shared fixture
  helper takes `(runs, prefix)` (TS2554).
- Merge 2's ACP team now loads `teamMcp.js`, which the ACP package did not carry (`gen-lazy-registry`: "loads
  teamMcp.js in the agent, and its package does not carry it"): `scripts/lib/acpBundles.mjs` carries it.
- Pending for the end of the batch: HOSTS2's shim suites (Emacs, Neovim, Zed, Qt Creator, Sublime) pin
  `supervise panel --companion` as refused; int now has `panel --companion` (RLF-M104LC), so the refusal should go
  away (lead's notes: prove it).

Suites after the merge: `runtimePanelGit`, `runtimePanelGitLease`, `mhpPanelContract` 38/38; `mhpContract`,
`runtimePanel`, `runtimePanelSchedules` 46/46 (exit 0).

### Merge 4 — `lanes/m109h-reviewed` (cafc74231)

Vault hardening on POSIX (core limit, dumpable off on Linux, ancestry bound to start times, headless taint real) with
RVM109H's four fixes. `rlf-m109h` is not merged. Its delegated broker suite and the Linux `/proc` case could not run in
its sandbox; they are not run here either (budget, and the brief keeps the unit suite for hosted CI): hosted CI and
the lead's linuxlt run decide them before they are claimed.

Conflicts:

- `docs/real-life/unproven.md`: int's 1.6.0/HOSTS2 passage kept (the lane's "MHP on this branch is 1.5.0" bullet is
  stale) and the lane's "Lane RLF-M109H named, not fixed" section added after it.
- `desktop/crates/l10n/qml/UiText.qml`: generated; `npm run desktop:l10n` (exit 0) rewrote it and
  `desktop/crates/l10n/src/tables.rs`. tables.rs had been stale since merge 2: acpteam-reviewed's keys
  (`acpTeamFixedForSession`, `acpTeamRolesUnavailable`, `acpTeamUnanswered`, the `serve --team` reference row) were
  in en.ts and the tables but not in the desktop's generated tables; the lane adds `vault.environmentWarning`.

Interactions: none beyond the regenerated desktop tables.

### Merge 5 — `lanes/cc-winfix6` (c694aad72, contains cc-winfix2..5, rlf-cifixa, cc-cifixw)

The Windows CI fixes: vault pipe helper (D216 `parentProcessId` against the helper's strict schema), DPAPI slot
reference, `prepare()` in `brokerBindings.ts`, `check-bundle-split` report written whole, `teamModelsFirstPaint`'s
bundle in global setup, `judgeP2Delivery` cut from 282 gate runs to 5 with its 104th case, Windows vault hooks bounded
at 300 s (the lead reports that narrowing to the owner). None of its contained lanes is merged separately.

Conflicts:

- `src/runtime/node/firstBoot/installMuseCode.ts`: the lane's `path.posix.join` (the node's install path is POSIX on
  every runner) in int's guard shape (int's unicorn 79 `no-negated-condition` refused the lane's).
- `test/unit/resourceHarness.ts` and the two relocation suites: CC-INT10's `darwinMemoryFixture` and the lane's
  `liveSamplerSuite` solved the same duplication; the lane's helper is kept (its hooks live in the helper), int's
  `launchHostOver` import in the devices suite stays. Both suites 16/16 (exit 0).
- `docs/real-life/unproven.md`: both (int's ORCHEXT/HOSTSLAND/M109H passages, the lane's CC-CIFIXW section).
- `host-api.md`: regenerated (exit 0).

Interactions: none found by unit typecheck (exit 0); the batch's build and lint follow at the end.

### Merge 6 — `lanes/rlf-cifixm` (13147dfbb)

macOS CI re-earned on Node 22: a global-setup build replaces the 60 s setup hook, three real-deadline timeouts kept
with reasons, the vault scope case opens its legacy slot from the record.

Conflicts:

- `test/unit/teamModelsFirstPaint.test.mjs` (the lead's "decide at the merge"): cc-winfix6's hook kept whole — the
  bundle from global setup, Chrome's first page warmed in the hook, the `step` the teardown names when the hook
  never finished (the failing-with-words behaviour), and its `60_000` hook deadline (run 41578891657's Windows VM
  took this hook past 60 s; a test deadline, not a limit on the person). The lane's version drops the step, the warm
  page and the deadline.
- `test/unit/helpers/vault/posixPanelFixture.ts`: two fixes for the same macOS red (run 41516831678, "posix: scoped
  anchor exists"). The lane copied the keyring binding into every staged root and failed fast without it; int
  (cc-winfix4) links it only for the suite that passes `osStore: true`, because a staged package has none and other
  suites need it absent. Taking both would make the `osStore` link fail with EEXIST after the copy. int's opt-in link
  is kept and the lane's copy and fail-fast are not taken (the file is int's byte for byte).
- `test/unit/vault/vaultStoreScope.test.ts` (imports): both (`windowsVaultContainerSchema` for int's Windows case,
  the lane's `openOsStoreSlot`).

Not run here: `teamModelsFirstPaint` (real Chrome) and the vault suites; hosted CI on the three systems decides them.

### Merge 7 — `lanes/rlf-cifixc` (777490540)

The hosted CI reds (makerReviewBrowser and accessibility's maker scenarios, teamModelsFirstPaint, pathGuardSpawns,
resourceForkProtection and others; record `docs/certification/rlf-cifixc.md`).

Conflicts:

- `test/unit/pathGuardSpawns.test.ts`: the lane's reviewed rows (the stricter `'System32', 'reg.exe'` anchor, which
  is the code's spelling at `hardwareContext.ts:271`, and its powershell reason).
- `test/unit/judgeP2Delivery.test.ts` (10 hunks): three versions meet here (cc-winfix6 on int, this lane, and
  rlf-judgep2 at merge 9). int's (cc-winfix6) is kept whole: it keeps every per-source case (`vitest list`: 13 case
  groups, each per source, with its 104th case) on 5 gate runs and fails a hung gate (`GATE_HUNG_MS`); this lane's
  folds the per-source cases into one case per family ("for every child source"), which drops cases.

`pathGuardSpawns` exit 0; host and unit typecheck exit 0.

### Merge 8 — `lanes/cc-winteam` (375a42d86)

The Windows crash legs of M96c: a landing holds under any spelling of its folders, recovery removes what a killed
write staged, the window scheduler's process lease and owner probe get their product binding (`boardOwner.ts`),
pause and kill proved by real processes. `landTeamTask`/`recoverOpenLandings` still have no product caller (lead's
decision 2026-11-02: lane CC-WINLAND after round 11).

Conflicts:

- `knip.jsonc`: both child entries (int's `scheduleBoardClaimChild.entry.ts`, the lane's `teamWindowChild.entry.ts`).
- `test/unit/teamLandingChild.entry.ts`: the lane's child (its plan schema carries the stop file, the stop-at-rename
  point and the recovery mode its pause and kill cases need); int's shared `readChildPlan` stays for the other
  children.
- `PLAN.md` M96c: both statuses.

Interactions:

- The lane moved `ownerBirth`/`probeOwner` out of `TeamHostServiceDeps` into the window runtime's own binding; int's
  real-parts rig (RLF-TEAMWORKERS, `test/unit/helpers/teamRealRig.ts`) still picked them (TS2344). `fix(int)`: the
  rig no longer passes them.

### Merge 9 — `lanes/rlf-judgep2` (1668253ef)

judgeP2Delivery made to fit a shard (103/103 in about 10 minutes, from 5,340 s and excluded).

Conflicts:

- `test/unit/judgeP2Delivery.test.ts`: int's (cc-winfix6) kept whole, as at merge 7: it keeps every case, 104 with
  cc-winfix6's added one, on 5 gate runs (this lane's runs a gate per mutation family, about 10 minutes). On this
  tree it ran in 190 s (exit 1, see below).
- `ROADMAP.md`: regenerated (`gen-roadmap`, exit 0); the lane's entry and CHANGELOG/PLAN lines merged clean.

Back in the shards: the repository has no exclusion list (CI's forty unit shards collect every file); the suite was
left out of CC-INT10's own merge-round run because it hung there (cc-int10.md §4). From this round on it is run with
the shards like any suite. Its run on this tree: 102 passed, 2 failed, both from the tree's build state
("bundle size budget exceeded or a bundle is missing"), read with the batch's build below.

### Red/green drills (batch A)

- Merge 1, terminal cwd through a link: `confineTerminalCwd` made lexical-only for in-root names →
  `panelSessions.test.ts` exit 1 ("promise resolved … instead of rejecting"); reverted → exit 0.
- Merge 2, ACP team MCP loader: `acpTeamEntry.ts` back to the lane's `teamHostEntry` import →
  `acpTeamSession.test.ts -t 'serves the team tools'` exit 1 (and typecheck TS2339 ×2); the fix restored → exit 0.
  The three ACP team suites 69/69 (exit 0).
- Merge 3, schedule hold type: lane's `BackendKind` parameter → `npm run typecheck` exit 1 (TS2322); typed to the
  schedule backends → exit 0. Lane's lease case: `repositoryRun()` → TS2554; int's helper call → typecheck exit 0
  and the case passes on int's lease source.
- Merge 2/3, ACP package without `teamMcp.js`: `node scripts/gen-lazy-registry.mjs` exit 1 ("its package does not
  carry it"); carried in `acpBundles.mjs` → exit 0.
- Merge 8, real-parts rig: `ownerBirth`/`probeOwner` still passed → unit typecheck exit 1 (TS2344); removed → exit 0.
  `teamHostRealParts`, `teamLandingKilled`, `teamLandingPause` 14 passed, 1 skipped (exit 0).

### Batch A gates on the merged head (after merge 9)

| Gate                          | Exit | Note                                                                                                                                                                                                                                                                                                                                |
| ----------------------------- | ---- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `npm run build`               | 1    | D6: `dist/runtimeMaker.js` 129,095 B of 129,024 (126 KiB; rlf-cifixc's maker storage link walk and LAN policy, merge 7) and `dist/runtimePanelSession.js` 123.0 of 120 KiB (merge 3's panel media/schedules/lease wiring beside int's companion). Not fixed: the batch's budget ran out. Never raise them: move words or lazy-load. |
| `npm run typecheck`           | 1    | `test/integration/m104Conformance.test.ts:163` (cc-m104gw) builds `VerifyEditorDeps` without a field int's deferred verify editor requires (TS2345). Every other project 0.                                                                                                                                                         |
| `npm run lint`                | 0    |                                                                                                                                                                                                                                                                                                                                     |
| `npm run check:mhp`           | 0    | MHP 1.6.0 (merge 3).                                                                                                                                                                                                                                                                                                                |
| `npm run check:plan`          | 0    |                                                                                                                                                                                                                                                                                                                                     |
| `npm run check:reference`     | 0    |                                                                                                                                                                                                                                                                                                                                     |
| `node scripts/check-l10n.mjs` | 0    |                                                                                                                                                                                                                                                                                                                                     |

`judgeP2Delivery` on this head: 102/104, the two failures are the build's budget state above.

### Open for the next batch (in this order)

1. The two D6 budgets above, then `npm run build` exit 0 (which also makes `judgeP2Delivery` 104/104).
2. `m104Conformance.test.ts:163` against int's `VerifyEditorDeps`, then `npm run typecheck` exit 0.
3. Merge 3's pending proof: the shim suites (Emacs, Neovim, Zed, Qt Creator, Sublime) pin `supervise panel
--companion` as refused; int now has `panel --companion`, so those cases must flip to the live page and be run.
4. Not run here: the whole unit suite (the lead's hosted CI), vault and broker suites, `teamModelsFirstPaint`,
   m109h-reviewed's delegated broker suite and Linux `/proc` case, `npm run test:integration`.
5. ACP `canRunKind` (merge 2): engine-only stays; a lane after round 11 runs Muse Code and external workers in ACP
   sessions (D250), `exec --team` stays engine-only (M96b).

## Batch A2 (rig randy-lt): making the head buildable

Commits `6c8968e23` (D6) and `08942de56` (typecheck), each `fix(int):`.

- **D6, `dist/runtimePanelSession.js`:** the session imported MHP's whole method table (`methods.ts`, 10.8 KB)
  only to check six host notifications. `runtimePanel.js` already has the table for the handshake and now
  passes it in as `methods`; the session imports only its type. 125,985 → 114,625 B of 122,880. No budget raised.
- **D6, `dist/runtimeMaker.js`:** maker storage now reuses code the bundle already carries: deviceLog's
  `isWithinWorkspace` (the same check), `isErrno` for the missing file, the key's file computed once, and
  the service's own LAN default passed as is. 129,095 → 128,923 B of 129,024. No budget raised.
- **Typecheck:** `m104Conformance.test.ts` passes `redact: redactSecrets`, the same redactor the product's
  verify bundle uses.
- **Red/green:** `npm run build` exit 1 before (both budgets OVER), exit 0 after. `npm run typecheck`
  exit 1 (TS2345) before, exit 0 after. The Emacs suite (exit 1, `muse-panel-real-agent-refusal-cleans-up`
  waited 30 s for the refusal) and `check.lua` (exit 1 at line 76, "real companion refusal is visible") are
  red on this head, as expected now that int has `panel --companion`.
- Suites: `makerRegistryLog`, `runtimeMakerHost`, `runtimePanelSessions` 86/86;
  `runtimePanelConversation`, `mhpPanelContract`, `runtimePanel` 41/41;
  `judgeP2Delivery` 104/104 (`umask 022`, repository timeout). All exit 0.

| Gate                          | Exit |
| ----------------------------- | ---- |
| `npm run build`               | 0    |
| `npm run typecheck`           | 0    |
| `npm run lint`                | 0    |
| `npm run check:mhp`           | 0    |
| `npm run check:plan`          | 0    |
| `npm run check:reference`     | 0    |
| `node scripts/check-l10n.mjs` | 0    |

### Still open after batch A2

1. Item 3 is not done: the lane's $3 budget ran out. The cases that pin `panel --companion` as refused
   still need to expect the live page: Emacs `muse-panel-real-agent-refusal-cleans-up`, Neovim
   `check.lua` lines 68–80, Zed `test_custom_agent_and_companion_task`, Qt Creator `test_launch.py` near line 126,
   and Sublime `muse_harness.py` (refused child exit). The live companion prints its launch URL as the first
   line on stdout, and the shims discard stdout. Each case should therefore prove a live child that keeps
   serving, then Stop that clears ownership, rather than a non-zero exit. The companion also runs the OS
   opener itself (`openOsBrowser`), so on a machine with a display it opens a browser; give the run no display.
2. Items 4 and 5 of batch A's list stand unchanged.

## Batch B (rig randy-lt): the shim suites, then groups 1–7

### The five shim suites expect the live companion

int's `panel --companion` serves, so each case that pinned its refusal now proves a live child that keeps
serving its page, then a Stop that ends it and clears ownership. Every case runs its children with no
`DISPLAY`/`WAYLAND_DISPLAY` (the companion runs the OS opener itself). The page is found by the launch URL
where the test can read stdout (Emacs, Zed, Qt Creator) and by the supervised child's own loopback listener
in `/proc` where the shim discards it (Neovim, Sublime); `GET /` with the page's own `Host` answers 200.

- Emacs `muse-panel-real-agent-serves-until-stop`, Neovim `check.lua` (the companion block), Zed
  `test_task_shell_companion_serves_until_stop_task` (the brief's `test_custom_agent_and_companion_task` is a
  pure configuration case; the refusal lived in `test_task_shell_reaches_the_real_agent`), Qt Creator
  `test_panel_serves_until_stop`, Sublime `muse_harness.py` (`observe`).
- **Shim defect found and fixed (Emacs, Neovim, Sublime):** Stop sent its own kill to the companion at the
  same moment as the `stop` verb. Emacs's `delete-process` is a KILL, which orphaned the supervised
  `panel --companion` (still serving, measured: 200 after Stop). In all three the race also made the verb find
  no run and fail (`EPANEL_STOP` after Stop that worked; Sublime's verb even waited behind the exit watcher).
  Now ownership clears at once, the verb ends the supervised run, and only then does the shim send TERM to
  whatever is left (Emacs falls back to `delete-process` when TERM cannot be sent).
- Open, not this batch: a TERM to `supervise` in its first moments (before its child is set up) can still
  leave the child running; the Neovim case waits for the second companion's listener before its Stop.
  macOS: the shims' cases there would let `open` start a browser (no display variable governs it).
- Runs (`umask 022`): Emacs 5/5 (exit 0), `check.lua` 9 PASS (exit 0), Zed 8 OK (exit 0), Qt Creator 6 OK
  (exit 0), Sublime in-editor under `xvfb-run` 1 OK (exit 0). No `panel` process left after any of them.
- Red/green: Emacs shim reverted to its KILL-first Stop → exit 1 (`(= (process-exit-status stop) 0)`,
  `(= 1 0)`), restored → exit 0. Qt Creator's launcher given `--stdio` instead of `--companion` → exit 1
  (`test_panel_serves_until_stop`: no launch URL), restored → exit 0.

### Group 1 (merges 10–15)

Every conflict below is "both sides add" unless named; each resolution keeps int's text and adds the lane's.
Generated files (`ROADMAP.md`, `reference*.generated.*`, desktop l10n `UiText.qml`/`tables.rs`) were
regenerated by their scripts, never hand-merged.

- **Merge 10, `lanes/rlf-m88`** (`b8284f298`): `extension.ts` keeps int's `teamBoards` beside the lane's Muse
  Code once admission and once-send outcome voice; `conversationController.ts` keeps int's
  `settleScheduledQuestion` beside the lane's `notifyScheduleOutcome`; `unproven.md` keeps int's HOSTS2 and
  later sections, drops the lane's stale "MHP is 1.5.0" line, adds its M88 section, and corrects the HOSTS2
  bullet that said every shim's Panel start is refused (batch B's shim suites prove the live page).
- **Merge 11, `lanes/rlf-outputcap`** (`b41301acd`): CHANGELOG, PLAN, roadmap entries.
- **Merge 12, `lanes/rlf-compactcap`** (`796023fdb`): CHANGELOG.
- **Merge 13, `lanes/rlf-editfuzz`** (`0d5bc8c37`): CHANGELOG, PLAN, roadmap entries.
- **Merge 14, `lanes/rlf-emptycat`** (`e19078b6e`): PLAN (beside RLFJUDGEP2), roadmap entries.
- **Merge 15, `lanes/rlf-firstrun`** (`2a4a45e97`): CHANGELOG, roadmap entries.
- **Interaction (group 1):** int's lint rules (`unicorn/prefer-combined-guards`, `no-negated-condition`,
  `prefer-simple-condition-first`) refused editfuzz's `overflow.ts` guard and m88's `seedDraft.ts`; both
  rewritten to the rules, same behaviour.
- Gates after group 1: typecheck 0, build 0, lint 1 → 0 after the fix, check-l10n 0, check:reference 0,
  check:plan 0.

### Group 2 (merges 16–19)

- **Merge 16, `lanes/rlf-acprecover`** (`5ec4bb1cc`): `src/acp/agent.ts` — the lane moved the resume into
  `openAndResume` (shared with its new backend-restart path); int had added the team MCP to the inline resume
  (RLF-ACPTEAM). **Interaction fixed in the merge:** `openAndResume` now opens with int's folder check
  (`openHost(cwd, true)`), prepares the team (`teamPrepareResume`, `withTeamMcp`) and returns `teamPrepared`,
  so both the load and the restart path adopt the session with its team (the restart path would otherwise
  have brought a team session back without its team tools). The refusal sentence list keeps int's folder
  sentences and adds the lane's restart sentences. Int's `unicorn/prefer-ternary` refused the lane's cancelled
  check: rewritten as a ternary inside the merge (the hook refuses the commit otherwise). CHANGELOG, PLAN,
  entries: both kept.
- **Merge 17, `lanes/rlf-makerfence`** (`f78f521a1`), against CC-CIFIXW's Windows inventory, per the lead's
  note "keep both": `hardwareContext.ts` keeps int's real Windows registry read and takes the lane's rule that
  an unknown inventory reports no board (unknown is never positive evidence; commands still latch through
  `isInventoryKnown`). `hardwareContextOwner.test.ts`: the lane's unreadable-Linux assertions plus int's
  Windows block, whose "another shape" case now expects `{ hasConnectedBoard: false, isInventoryKnown: false }`;
  the lane's "win32 is always unknown" lines dropped (int reads the registry). `backends.ts`: the lane's
  `isPositivelyHardware()` beside int's `listTeamWorkerModels`. `startText.ts`: the lane's
  `{ text, isRefusal }` shape plus int's native-helper/Muse-start branch. `agent.ts` outbound templates: int's
  list (with no `subscriptionQuotaExhausted` template — int's D252 quota rule is the stricter) plus the lane's
  start-failure and registry templates; the start refusals list keeps both. `hardwareGuardSplit.mjs` adds
  `isBoardVolumeWorkspace` to int's list. Tests `acpTurnFailure`, `startText`: both sides' cases.
- **Merge 18, `lanes/rlf-sectext`** (`ff5054ef0`): roadmap entries; `host-api.md` regenerated
  (`check-host-api.mjs --write`).
- **Merge 19, `lanes/rlf-wonder`** (`531be9dbe`): CHANGELOG.
- **Interactions fixed after group 2:**
  - D6, `dist/museCode.js` 128,816 B of 128,000 (each lane fit alone): the rare `session/delete` body moved
    into the already deferred `approvalModes` chunk (`deleteHostSession`, loaded on the first delete; the
    listener still goes in before the command), the hardware fence's mode call is one `prepareHardware()`,
    the unused `hardwareState()` removed, `ifLive` logs its skip once; lazy registry regenerated.
    127,951 B; `approvalModes.js` 21,960 B of 27 KiB (`c00ff698e`). No budget raised.
  - `check:plan` (PLAN.md 3,568,825 B over the 85% tripwire): the FIXM100*/M98P2INT/FIXM98* §7 gate records
    (2026-10-05/06, 12,034 B) archived byte for byte with `scripts/plan-archive.mjs`; none is touched by an
    unmerged lane of this batch (`3b66de528`).
  - `hardwareContextOwner.test.ts` "a machine whose inventory cannot be read…": int's case expected the old
    unknown-reports-a-board shape; now `{ hasConnectedBoard: false, isInventoryKnown: false }` (makerfence's
    rule, kept per the lead), commands still fail safe.
- Gates after group 2: typecheck 0, build 1 → 0 (D6 above), lint 0, check-l10n 0, check:reference 0,
  check:plan 1 → 0. Suites: `musecodeLifecycle`, `sessionDelete`, `acpBackendRecover` 25/25;
  `hardwareContextOwner` 11 passed 2 skipped (Windows-only), `startText`, `acpTurnFailure` passed (exit 0).

### Group 3 (merges 20–22)

- **Merge 20, `lanes/rlf-m103wire`** (`8bd7c8bab`): the lane pinned the serial helper's `python3` with its own
  `resolveSerialPython`; int already had RLF-SMALLFIX1/2's `resolveSerialInterpreter` (absolute path outside
  the workspace, the `museSpark.serialPythonPath` machine setting, a sentence when none, found on every call).
  **Interaction:** `nativeSerial.ts` keeps int's resolver; the lane's `resolveSerialPython`/`isHelperFile` and
  their tests are dropped as superseded (int's covers the planted-copy case), the spawn inventory's two
  descriptions name `resolveSerialInterpreter`. `featureCatalog.ts`: the lane's maker commands with int's
  `serialPythonPath` setting. `deferredBundles.mjs`: int's pattern plus `makerEngineEntry`. `lease.ts`: the
  lane's comment. CHANGELOG, PLAN (both status paragraphs), generated files regenerated. `makerSerial`,
  `pathGuardSpawns` 21/21.
- **Merge 21, `lanes/rlf-m105bind`** (`f662b0385`): CHANGELOG; generated files regenerated.
- **Merge 22, `lanes/rlf-m98bind`** (`ce4fa3b31`): clean.
- **Interaction fixed after group 3:** int's `unicorn/prefer-smaller-scope` and `no-negated-condition` refused
  m103wire's `makerDevicesUi.ts`; autofixed, same behaviour.
- **Open after group 3 (not fixed: this batch's budget):** D6 `dist/runtimeMaker.js` 129,923 B of 129,024
  (126 KiB), 899 B over. Cause: merge 20 (rlf-m103wire) moved the machine engines into
  `src/core/maker/machineEngines.ts` (3,056 B in the bundle) and grew `machines/http.ts` (read options) and
  `deviceLog.ts` (no-folder window); batch A2 had left 101 B of room. The runtime maker bundle has no lazy
  chunk yet (no `await import` under `src/runtime/maker`); the fix is a deferred runtime entry in
  `scripts/lib/deferredBundles.mjs` (`DEFERRED_OUTFILES`, its own budget, lazy registry regenerated) for the
  rarely used enrollment/PrusaLink or lease-takeover paths, or moving `lease.ts`'s stale-holder proof
  (11,142 B, the largest input) behind one. Never raise the budget.
- Gates after group 3: typecheck 0, build 1 (the D6 line above, the only OVER), lint 1 → 0, check-l10n 0,
  check:reference 0, check:plan 0.

### Group 4 (merges 23–25)

- **Merge 23, `lanes/rlf-upsdk`** (`ed014decb`, D260): `acpServeHandshake.test.ts` keeps int's empty-folder
  PATH for the CLI-missing case (the lane's PATH scrub solved the same thing); its then-unused
  `MUSE_CMD_FILE`/`MUSE_POSIX_EXECUTABLE` import dropped inside the merge (the hook refuses it otherwise).
- **Merge 24, `lanes/rlf-updeps2`** (`d27d77c8d`): `package.json`/`package-lock.json` keep int's
  `@muse-code/sdk` 1.4.14 (upsdk's, newer than the lane's 1.4.12); the lane's other bumps (Electron 45.2.1,
  vitest 5.1.0, eslint 10.14.0, MCP SDK 1.32.2, …) merged as they were. Not re-installed here: the gates
  below ran on this worktree's existing `node_modules`; hosted CI's `npm ci` is the lock's proof.
- **Merge 25, `lanes/rlf-unproven`** (`5c70dadfa`): PLAN, roadmap entries. **Interaction:** its status phrase
  "built and gated, pending integration" is not a plan status, so `check:plan` and `gen-roadmap` refused;
  now "built" (it is integrated). PLAN.md crossed the 85% tripwire again: a second §7 range (2026-10-0x
  records, 9,467 B) archived byte for byte.
- Gates after group 4: typecheck 0, build 1 (only the runtimeMaker D6 line from group 3), lint 0,
  check-l10n 0, check:reference 0, check:plan 0.

### Groups 5–7 (merges 26–29)

- **Merge 26, `lanes/rlf-m111ar`** (`4b5ff1664`): `package.json`/lock keep int's SDK pins and add the lane's
  `@resvg/resvg-js` 2.6.2; PLAN keeps RVINT9's and the lane's status paragraphs.
- **Merge 27, `lanes/rlf-m111st1`** (`6d0aa4de9`, own string chunk): `en.ts` and the 13 `l10n/ui.*.json`
  keep int's desktop reference keys beside the lane's `referenceSettingsKeys`; `untranslated.json` both
  lists; `check-bundle-size.mjs` keeps int's terminal-engine budgets and adds the lane's new settings
  renderer budgets (new bundles, not raised ones); `uiTextRegions.mjs` keeps int's CC-INT10 desktop region
  split (the lane's surfaces pattern still held `desktop$|editorGroup$`). Generated tables regenerated.
- **Merge 28, `lanes/cc-licence`** (`0cbbe4c2c`): its base predates cc-sigstore and M124 remote. Kept int's
  side in both conflicts: the koa-compose override in `third-party-notices.mjs` (the lane's base had no
  koa) and PLAN's `@sigstore/{tuf,verify,bundle}` row with the lead's 2026-10-24 resolution (the lane still
  described the whole `sigstore` package). Its clean parts (BlueOak-1.0.0 review, vendored licence) came in.
- **Merge 29, `lanes/rlf-m102byo`** (`d8df46966`): its record says finished (suites listed, packed live
  `exec --provider` unrun by design). CHANGELOG; generated files regenerated.
- **Not merged: `lanes/rlf-m104gl`.** Its record says both runs finished (cases execute, receipts, matrix,
  drills, gates; open notes for the lead). None of its 26 commits is on int by patch id (`git cherry`), so
  cc-m104gw does not hold it as is; comparing the two (JetBrains/Eclipse/Emacs Linux conformance, the runtime
  checkpoint adapter, the VS Code checkpoint fixture) to merge only what is missing did not fit this
  batch's budget. Next batch: diff `HEAD...lanes/rlf-m104gl` (85 files) against cc-m104gw's hosts work and
  merge or cherry-pick what int lacks.
- Gates after groups 5 and 6 (run once on the head after merge 28): typecheck 0, build 1 (only the
  runtimeMaker D6 line), lint 0, check-l10n 0, check:reference 0, check:plan 0.
- Gates on the head after merge 29: typecheck 0, build 1 (only `OVER dist/runtimeMaker.js: 126.9 KiB (budget
126 KiB)`), lint 0, check-l10n 0, check:reference 0, check:plan 0.

### Open for the next batch (after batch B, in this order)

1. D6 `dist/runtimeMaker.js` 129,923 B of 129,024 (group 3's entry above has the cause and the way):
   `npm run build` exits 1 on that line alone. Never raise the budget.
2. `lanes/rlf-m104gl`: compare with cc-m104gw and merge what int lacks (group 7 entry).
3. Updated dependencies (merge 24) were not installed here: run `npm ci` and the build on a fresh tree.
4. The shim suites' open edge: a TERM to `supervise` before its child is set up can leave the child serving
   (batch B's first entry); macOS shim cases would start a browser through `open`.
5. Batch A's items 4–5 stand (the whole unit suite and the vault/broker/integration suites are hosted CI's
   and the lead's; ACP `canRunKind` engine-only per D250/M96b).

## Batch C (rig randy-lt): security, research and the newest lanes (budget $13)

- `npm ci` exit 0 (batch B's updated dependencies installed; install scripts not run by npm 11, `esbuild` 0.28.2
  works); `npm rebuild node-pty` exit 0.
- **Merge 30, `lanes/cc-int11fix`** (fixes for hosted run 41619068707 on `298f078c7`): clean. Its record §7 leaves
  macOS `posix_spawnp`, `harnessCompositor` off Windows and `crashHook` on real Ubuntu/macOS to hosted CI.
- **D6 `dist/runtimeMaker.js`** (`ccbe1d3a9`): 129,923 B of 129,024 → 110.5 KiB of 126. The maker panel's
  companion page server, its assets and the Thonny bridge (`companionServer.ts`, `assets.ts`, `thonnyServer.ts`)
  are a deferred chunk, `dist/runtimeMakerPanel.js` (entry `runtimeMakerPanelEntry.ts`, loader `panelLoader.ts`,
  18.1 KiB, new budget 21 KiB = measured +15%), loaded on the first `maker panel` or ACP companion; a chunk that
  cannot load refuses that panel with the chunk named. Wired in `build.mjs`, `deferredBundles.mjs` (DEFERRED list,
  `DEFERRED_OUTFILES`, cohort pattern), `acpBundles.mjs`, `check-host-globals.mjs`; lazy registry regenerated.
  Red/green: `npm run build` exit 1 (`OVER dist/runtimeMaker.js: 126.9 KiB`) before, exit 0 after.
  `runtimeMakerCommands`, `runtimeMakerAcp`, `runtimeMakerTransport` 77/77; typecheck 0; lint 0.
