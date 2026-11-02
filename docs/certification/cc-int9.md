# CC-INT9 — merge round 9: the team workers, any agent leading, shutdown, the native hosts, M111's first lanes (2026-10-31, finished 2026-11-02)

Integration lane `CC-INT9`, worktree `/Users/user/lanes/CC-INT9`, branch `cc/int9`, on the test rig
`MacBookPro.ivettnet` (macOS, Darwin 24.6.0, Intel x86_64, Node 24.21.0, npm 11.19.0). Base: `cc/int8`
`810b320fc` (CC-INT8's join, `docs/certification/cc-int8.md`; its known failures and CC-INT6/7's are not counted
against a merge here). Provider calls: **0**. Model attempts: **0**. Muse requests: **0** (the brief names no
real use; no real conversation, no nested ACP or CLI session beyond §6's help and refusal, which send nothing).
Nothing was pushed, rebased, stashed or tagged. The vault and real credential-store suites were never run on this
MacBook, no browser or GUI app was started, and no command that reads the login Keychain was run by hand (the
shutdown suite's own attribute checks are §4). Scratch files lived in the worktree's ignored `temp/` (a copy of
the base, a Python venv with semgrep, logs, the extracted ACP package).

Two runs made this round, said plainly. The merges and every `fix(int):` commit through `5fb118e35` were made on
2026-10-31 in Claude Code on this rig; the owner then paused the project. The lane was resumed in Muse Spark Code
on 2026-11-01 with one uncommitted file (`src/host/team/externalOrchestrator.ts`, the guarded spawn of §2.2): it
was read, tested and committed as `633b3e2ea`, with its generated host-api row as `11663376e`. Everything from
§3 on was then re-run on the final tree in the resumed session and is reported from those runs, not from the
first run's logs; where the first run's October 31 logs are the only evidence, the record says so (§4, §8).

One environment fact shapes §4 and §5. The resumed session's sandbox denies `/bin/ps`
(`/bin/sh: /bin/ps: Operation not permitted`), and the product's process-identity reads go through the fixed
`/bin/ps` (`src/core/executables.ts`, `src/core/resources/trees/posixTable.ts`). Every suite that confirms a
child's OS identity times out here (`TEAM_CONFIRMATION_TIMEOUT`, `src/host/team/processLifetime.ts`). Per the rig
rules nothing was shimmed or worked around: those suites are reported as blocked in this session, classified
against the untouched base run in the same session (§5), and listed for a session where `ps` runs (§8). The
first run of October 31 had `ps` and its lane-suite logs are green for the same files (§4).

## 1. The merges

Each lane's certification record read first, fetched from this machine's bare repo and merged with
`git merge --no-ff` in the brief's order. Commits are `git rev-list --count <merge>^1..<merge>^2`.

| #   | Branch (tip)                             | Commits | Merge commit | What the merge needed                                                                                                                         |
| --- | ---------------------------------------- | ------- | ------------ | --------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | `lanes/rlf-teamworkers3` (`87801e524`)   | 17      | `4bb0ef6ac`  | Contains teamworkers 1–2 on rlf-teamfit (already on int). Its CHANGELOG stays withheld until a packed run. §2.1.                              |
| 2   | `lanes/rlf-orchext` (`f981de8cb`)        | 14      | `35d87f421`  | D250 kept. New `externalOrchestrator.js` and `teamHttpBridge.js` (§3 budgets). Its README/CHANGELOG sentences held (§2.3). §2.2, §2.4.        |
| 3   | `lanes/rlf-shutdown` (`110d60360`)       | 9       | `a1b734209`  | RLF-SHUTDOWN plus SHUTDOWN2; its suite drives the real CLI (§4).                                                                              |
| 4   | `lanes/hostsland-reviewed` (`566143f3a`) | 14      | `af9fdef89`  | The nine native hosts; supersedes `lanes/rlf-hostsland`; `rec/rlf-m104gl` already inside it, never merged. Hosts moved to `mhp/1.5.1` (§2.5). |
| 5   | `lanes/rlf-m111wb` (`ce2e19068`)         | 5       | `50e8dac7f`  | M111 workbench. §2.6.                                                                                                                         |
| 5   | `lanes/rlf-m111ed` (`67d10916f`)         | 2       | `83ad6baf6`  | M111 editor group. §2.6.                                                                                                                      |
| 5   | `lanes/rlf-m111th` (`4cd815974`)         | 4       | `99dc58856`  | M111 theme. §2.6.                                                                                                                             |
| 5   | `lanes/rlf-m111in` (`464f70b24`)         | 6       | `013094d98`  | M111 languages. §2.6.                                                                                                                         |
| 6   | `lanes/rvint6` (`503dc5862`)             | 1       | `dabb0985d`  | RVINT6's record of CC-INT6: docs only, no suites.                                                                                             |

Generated files were regenerated, never hand-merged (`ROADMAP.md`, the reference files, the desktop Rust/QML
language tables `3679dbb0e`, `docs/ide-compatibility/host-api.md` `11663376e`). Each merge interaction is its own
`fix(int):` commit naming the merge (§9). No lane added a decision number beyond the assigned ones: D250
(RLF-ORCHEXT) and D251 (TEAMFIT, already on int) stand; **highest decision number used: D252**; D253–D259 unused.

## 2. What each merge needed

### 2.1 Merge 1 (team workers) and merges 1–2 (the bundle fits)

- `a91136652`: the team MCP instructions and the process workers' words are model-text blocks of their own, so
  `teamMcp.js` and `teamPanel.js` hold their budgets (§3: 7.9 of 25 KiB and 99.3 of 100 KiB; no budget raised).
- `f1e85e4d3`: a Muse Code worker turn that hit its round limit is a capped stop, never a finished one.
- `5fb118e35`: the suites that start children share one `isProcessAlive`
  (`test/unit/helpers/processAlive.ts`); `npm run duplication`: 0 clones.

### 2.2 Merge 2 (an external agent leads): the guarded spawn and its gate rows

- `fd48af664`: the usable-reply guard lists the external orchestrator's tool-call status read with its reason.
- `633b3e2ea` (resumed session): the D250 host spawned the agent with a raw `child_process` spawn and an
  unbranded environment. It now starts through `spawnGuarded` with `workspaceChildEnvironment` for its cwd
  (`src/host/team/externalOrchestrator.ts`, `startProcess`), like every other `src/` spawn, so neither the agent
  nor anything it starts by bare name resolves to a program planted in the workspace. This was the one failure in
  the first run's related shard 2 (`pathGuardSpawns`: `src/host/team/externalOrchestrator.ts: spawn:1000`); with
  the change `pathGuardSpawns` and `team/externalOrchestrator` pass (17 of 17), drilled red/green in §7.
- `11663376e`: the same change reads `realpathSync` from `node:fs`; the generated host-api record is regenerated
  (`node:fs` 197 to 198) and `check:host-api` exits 0 (it was 1 before the regeneration, §3).
- The lane's two gate-file edits were reviewed and kept: `check-bundle-split`'s classic-zod carrier (the
  production build's split check exits 0 with the carrier named, §3) and `teamChunkPackaging`'s spawned-bundle
  set (the suite passes on the merged tree, §4).

### 2.3 Held claims (merges 1–2 and the post-merge list)

- RLF-TEAMWORKERS3's and RLF-ORCHEXT's README/CHANGELOG sentences stay out of the release notes until the
  packed run and the lead's Claude Code check; they wait in the lanes' records and `docs/real-life/unproven.md`.
- `b10e6f7fb`: the README's "Local headless `exec --vault`" section (CC-INT8's open item 4) is held out the
  same way, word for word into `docs/certification/rlf-m109.md` §7 beside RLF-M109's two CHANGELOG lines,
  and listed in `docs/real-life/unproven.md`. The README no longer documents `exec --vault`.
- ROADMAP and README stay false-free on teams: the M96 entry says the external lead and the Muse Code and
  external workers are built but not yet used through the packed product; the M96b entry says the ACP agent
  does not run teams yet (RLF-ACPTEAM has not landed); the README's teams text names only headless
  `exec --team` and says Muse Code and external workers cannot run headlessly. All three re-read on the
  final tree in the resumed session.

### 2.4 Merge 2 and the second MHP re-freeze at `mhp/1.5.1`

`62d320f63`: D250's third conversation host kind, `external`, is on the panel's wire: the `backend` enum of
the panel payloads gains `"external"` at 18 places of `mhp-v1.1.schema.json`, and nothing else changed
(`mhp-v1.schema.json` and its lock are byte-identical; the v1.1 lock moved from `6a85876c…` to `2100041d…`
through the same adoption route as CC-INT8's, both locks put back to `mhp/1.5.0` first). Neither 1.5.0 nor
1.5.1 has shipped (CC-INT8 §2.5), so the re-freeze at the same unreleased version is the recorded route;
`npm run check:mhp` exits 0, drilled in §7. The hosts of merge 4 name 1.5.1 to match (`c7b1353c9`, §2.5);
their recorded conformance receipts still record runs at 1.5.0 and are not edited, which is why
`check:editor-matrix` is red until those hosts re-run (§3, §8).

### 2.5 Merge 4 (the nine native hosts)

- `c7b1353c9`: every host literal that named `mhp/1.5.0` names `mhp/1.5.1` (the nine `distribution.json`
  files, JetBrains' and Eclipse's range minimum, Eclipse's `surfaceHtml` probe, Visual Studio's peer, the
  hosts' own unit tests, the conformance contract). Not compiled or run here (no JDK, Gradle, .NET or Emacs
  on this rig): literal replacements, for hosted CI or the JVM rig (§8).
- `e892d8075`: the hosts' runners, generator table and test drivers are declared knip entries;
  `npm run deadcode` exits 0.

### 2.6 Merge 5 (M111 WB/ED/TH/IN)

- `125886546`: the editor group's two language-chunk catches test for a chunk that cannot load and reject
  anything else (the catch rule; `npm run check:catches` exits 0, no count rose).
- `a2fc8f7aa`: the four scripts the desktop theme and the native hosts added start through `isEntryPoint`
  (CC-SCRIPTENTRY's lint block, already on int).
- `a057eb5cc` (merges 2 and 5): the node page's inline English carries `backendExternal`
  (`nodeWorkspaceBuild`, `nodeWorkspaceUi` green, §4).
- `b62b5d4a8`: the desktop footer's tab label is a per-call lookup, never read at module load (D33).
- `3679dbb0e`: the desktop's generated Rust and QML language tables regenerated for the merged keys.
  Budgets per D6; none raised (§3).

### 2.7 The post-merge list: `connectorRemoteIssuer` with the default TMPDIR

`00c7c543b`: `connectorRemoteIssuer` failed alone with macOS's default temporary folder (CC-INT8 §5 row 3).
The cause is the connector's storage guard, not the test: `verify()` read the chain above its anchor as
given while the data folder did not exist yet, so `/var` (a link on macOS) refused the first start with
reason `"kind"`, while the same chain passes once the folder exists. The missing-root case now resolves the
anchor the way the system does, keeping it as given only while the anchor itself is missing
(`src/runtime/connector/storageGuard.ts`), with a new real-link case in `connectorStorageGuard.test.ts`.
Re-verified in the resumed session with the platform default (`env -u TMPDIR`, no pin in the test):
`connectorRemoteIssuer` 3 of 3, exit 0; drilled in §7. `connectorStorageGuard`'s three legacy-storage cases
fail identically on the untouched base (§5) and are not touched.

## 3. Proof on the final tree

Every command ran directly in the worktree in the resumed session, at `11663376e` (the commits after it are
PLAN status lines, the regenerated `ROADMAP.md` and this record); `PATH` carried the venv under `temp/`
(semgrep for the SAST gate; `SSL_CERT_FILE=/etc/ssl/cert.pem`, `SEMGREP_ENABLE_VERSION_CHECK=0`), and
`DEVELOPER_DIR=/Library/Developer/CommandLineTools` (this rig's Xcode.app path is gone, so the `/usr/bin/git`
shim fails without it — a rig fact, named here because every test child inherits it).

| Command                                                                                                              | Exit    | Result                                                                                                                                                                                                                                                                                          |
| -------------------------------------------------------------------------------------------------------------------- | ------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `npm run format:check`                                                                                               | 0       | all files                                                                                                                                                                                                                                                                                       |
| `npm run typecheck`                                                                                                  | 0       | all projects                                                                                                                                                                                                                                                                                    |
| `npm run lint`                                                                                                       | 0       | `lint:ps` skipped: PSScriptAnalyzer runs on Windows only                                                                                                                                                                                                                                        |
| `npm run check:badges` / `check:tokens` / `check:l10n`                                                               | 0, 0, 0 | l10n: 14 UI tables, 14 usage tables, 288 manifest strings, 2,714 source files, 5 rust files, 3 qml files; 0 problems                                                                                                                                                                            |
| `npm run check:reference` / `check:host-api` / **`check:mhp`**                                                       | 0, 0, 0 | host-api: 404 VS Code APIs, 62 files importing vscode, 30 Node built-ins; it was 1 once on the `node:fs` count and is 0 after the regeneration (§2.2)                                                                                                                                           |
| `npm run check:plan` / `check:roadmap`                                                                               | 0, 0    | 250 milestones, 0 drift; 250 entries, `ROADMAP.md` current                                                                                                                                                                                                                                      |
| `npm run check:catches`                                                                                              | 0       | all catch sites and counts match the baseline; no SWALLOW, GENERIC or CLEANUP count rose                                                                                                                                                                                                        |
| `check:usable-reply`, `check:wrap-up-request`, `check:no-output-cap`, `check:no-round-cap`, `check:workflow-scripts` | 0 each  |                                                                                                                                                                                                                                                                                                 |
| `npm run check:editor-matrix`                                                                                        | **1**   | `MHP_MATRIX_REPORT:jetbrains:[… "protocol" … "mhp/1.5.1" …]`: the JetBrains and Eclipse receipts record runs at `mhp/1.5.0` and no longer validate against the 1.5.1 contract — red by the gate's own design until those hosts re-run (§2.4, §8). The receipts are evidence and were not edited |
| `npm run check:font-coverage`                                                                                        | **2**   | `Noto Sans Regular resolves to Hiragino Sans…; install the image fonts`: the image fonts are not installed on this MacBook; the gate belongs to image CI (RLF-M111IN's record)                                                                                                                  |
| `npm run deadcode` / `cycles` / `duplication`                                                                        | 0, 0, 0 | knip: tag hints only; no circular dependency; 0 clones                                                                                                                                                                                                                                          |
| `npm run security:audit`                                                                                             | 0       | 2 advisories, 0 exceptions                                                                                                                                                                                                                                                                      |
| `npm run security:sast`                                                                                              | 0       | 699 rules on 6,016 files: **0 findings**                                                                                                                                                                                                                                                        |
| **`npm run build`**                                                                                                  | **0**   | tokens, production build (extension and desktop), size gate, bundle split, lazy registry, host-globals, notices, legal build records; **no budget raised**                                                                                                                                      |
| `node scripts/package-vsix.mjs --target win32-x64`                                                                   | 0       | **`VSIX: 4662368 bytes (budget 4915200)`** (CC-INT8: 4,550,553)                                                                                                                                                                                                                                 |
| `npm run package:acp -- --target win32-x64` and `--target darwin-x64`                                                | 0, 0    | 156 of 156 packaged-bundle checks each (CC-INT8: 155); the darwin-x64 package needed `native/darwin/build.sh` and `build-local-judge.sh` first (0, 0)                                                                                                                                           |

Bundle sizes this round moves (D6; no existing budget raised; the two new bundles carry the lane's own
measured budgets):

| Bundle                         | Base `810b320fc` | Final tree    | Budget (KiB) | How                                                                                  |
| ------------------------------ | ---------------- | ------------- | ------------ | ------------------------------------------------------------------------------------ |
| `dist/externalOrchestrator.js` | (new, merge 2)   | **211.0 KiB** | 250          | RLF-ORCHEXT's measured budget                                                        |
| `dist/teamHttpBridge.js`       | (new, merge 2)   | **2.2 KiB**   | 25           | RLF-ORCHEXT's measured budget                                                        |
| `dist/teamHost.js`             | 122.7 KiB        | **123.9 KiB** | 130          | the workers' host code                                                               |
| `dist/teamPanel.js`            | —                | **99.3 KiB**  | 100          | holds only with its own model-text block (§2.1)                                      |
| `dist/teamMcp.js`              | 7.0 KiB          | **7.9 KiB**   | 25           | its own model-text block (§2.1)                                                      |
| `dist/teamRunners.js`          | 33.3 KiB         | **34.3 KiB**  | 75           | existing                                                                             |
| `dist/teamScheduler.js`        | 60.4 KiB         | **61.2 KiB**  | 75           | existing                                                                             |
| `dist/teamTraffic.js`          | 47.3 KiB         | **47.3 KiB**  | 75           | existing                                                                             |
| `dist/uiText.js`               | 114.1 KiB        | **114.9 KiB** | 125          | the merged lanes' sentences                                                          |
| `dist/extension.js`            | 534.5 KiB        | **538.2 KiB** | 600          | existing (tightest rows unchanged: `wire.js` 74.7 of 75, `modelApi.js` 521.2 of 525) |

## 4. Each merged lane's own suites, final tree, repository timeouts

`npx vitest run <files> --maxWorkers=3`, three files a run, no `--testTimeout` anywhere. The 38 files the
lanes' lists name (37 unique under the root config, `test/hostApi/listings.test.mjs` under its own
`test/hostApi/vitest.config.mjs`, and `acpShutdown` on its own):

- **32 files pass in full** in the resumed session: 321 tests passed across the 37 root-config files, plus
  `listings` 6 of 6. This includes merge 2's `team/externalOrchestrator` (10), `team/externalAgents`,
  `team/teamHttpBridge`, `teamChunkPackaging`, merge 4's `conformanceDrivers`, `mhpPanelContract`,
  `bridgeFailure`, `bridgeState`, `panelThemePort`, `selectionQuote`, and every M111 file (`desktop/*`,
  `editor/*`, `nodeWorkspaceBuild`, `nodeWorkspaceUi`, `fontCoverage`).
- **5 files are blocked in this session by the denied `/bin/ps`** (27 tests): `teamCheckSlotsGoverned` (3),
  `teamHostRealParts` (3), `teamProcessLifetime` (6), `teamProcessWorkers` (12), `teamWorkerChecks` (3) —
  every failure is the process-identity confirmation timing out (`TEAM_CONFIRMATION_TIMEOUT`) or a governed
  check that never starts. The first run of October 31, same tree content with `ps` available, has these
  files green in its batch logs (kept under `temp/`); that evidence is the first run's, not re-earned here,
  and §8 lists the re-run for a session where `ps` runs.
- **`acpShutdown` (merge 3), run alone: 4 passed, 12 failed.** The four states that need no Muse Code pass.
  The twelve real-CLI states fail at their setup (`Muse Code did not start as the case needs`): the suite
  makes no Muse request by construction (dead proxy, no prompt), but its real-CLI cases are written for a
  screenless login session and read process state this session cannot. Not run green here; listed in §8 for
  the rig and session the lane's own record used. `serveHandshakeWait` (its sibling) passes.
- `rvint6` adds no suites (docs only).

## 5. `npx vitest related` over the round's changed sources, and the base

The 100 `src/` and `scripts/` files of the round's changed-source list (the first run's
`temp/lists/changed-src.txt`, re-checked: it already names `externalOrchestrator.ts`), in twelve
`--shard i/12` runs, the repository's own timeouts, `--maxWorkers=3`. Excluded: the vault and
credential-store suites of the rule, the five browser suites, `judgeP2Delivery`, `runtimeLsp` and
`acpShutdown` (own run, §4). Together: **1,423 files (1,333 passed, 53 failed, 37 skipped), 31,087 tests
(30,456 passed, 197 failed, 434 skipped)**. Every failing file was then run again in the same batches of
three on the merged tree and on an extracted copy of the untouched base (`git archive 810b320fc` under
`temp/base`, the merged `node_modules` linked in, the darwin helper builds copied in, built with
`node scripts/build.mjs --production`, exit 0), in this same `ps`-denied session so both trees face the
same machine:

| Class                                           | Files                                                                                                                                                                                          | Evidence                                                                                                                                                                                                                                                                                                    |
| ----------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Base, identical counts**                      | 47 of the 48 files that exist on the base                                                                                                                                                      | The same failing-test count per file on both trees (`makerLease` 28/28, `makerSerialSession` 24/24, `osImageBuildUpdateTryboot` 14/14, `connectorStorageGuard` 3/3, `runtimeMakerStop` 6/6, …). Most are CC-INT5–CC-INT8's rows; the `ps` denial inflates both trees equally. Causes UNMEASURED beyond that |
| **Load, not a class**                           | `scheduleFireFailures` (3 merged, 1 base in batches; every failure a 5 s timeout), `conformanceDrivers` and `resourceProbesDarwin` (failed in a shard, passed in classification on both trees) | `scheduleFireFailures` alone on the merged tree: 8 of 8, exit 0                                                                                                                                                                                                                                             |
| **New files, blocked here**                     | `teamProcessWorkers` (12), `teamProcessLifetime` (6), `teamCheckSlotsGoverned` (3), `teamWorkerChecks` (3)                                                                                     | Not on the base; every failure is the `ps`-denied confirmation (§4). The fifth new file, `conformanceDrivers`, passes                                                                                                                                                                                       |
| **Merge interactions, fixed before the shards** | `pathGuardSpawns` (the raw spawn, §2.2 — the single failure in the first run's shard 2), the `fix(int):` commits of §2                                                                         | each green in its lane run (§4) and in the shards                                                                                                                                                                                                                                                           |

**No file that passes on the untouched base in this session fails on the merged tree for a code reason
measurable here.** The base was run with the merged tree's `node_modules`, so a base-only effect of those
cannot be excluded (as CC-INT8 §5). `runtimeLsp` was not re-run: no merge of this round touches it, and
CC-INT8's three-supervisor-case classification (the 103-byte socket-path limit) stands.

## 6. Real use through the built product

No Muse request, no model attempt, no paid provider call, no real conversation and no nested ACP or CLI
session were made (**Muse requests: 0**). What the built product was used for, with none of them:

- **The packages.** The win32-x64 VSIX and both ACP packages, §3, with their packaged-bundle checks.
- **The packed agent, extracted into an empty folder** (`dist/muse-spark-code-acp-0.19.0-darwin-x64.tgz`
  under `temp/real/pkg`, a fresh HOME and an empty workspace): `node dist/acp.js exec --team --backend
museCode "hello"` prints `These options require the Model API backend (--backend modelApi): --team.` and
  exits 2 — the refusal still names the option through the packed product after merges 1–2. `exec --help`
  exits 0 and lists the options. No credential store was opened.

Not run, because each needs a Muse request, a person at the machine, a browser, Windows or another OS: a
real conversation through the packed VSIX or ACP package; a team run with Muse Code or external workers;
an external ACP agent leading a conversation; `exec --team` or `exec --vault` end to end; Muse Desktop
itself; `npm run ui:look`; `test:a11y`; the VS Code integration suites (Electron cannot start on a macOS
lane); and everything Windows-only (§8).

## 7. Red/green drills

Each drill hashes the file, breaks it on purpose, runs the gate or suite, restores it byte-exact (hash
checked, `git status` clean) and runs it again (`temp/drills.sh`, kept in the ignored `temp/`).

| #   | Guard                                                 | Break                                                                            | Red                                                                                                                                               | Restored, green                                                                                                                 |
| --- | ----------------------------------------------------- | -------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------- |
| 1   | the spawn inventory vs merge 2's host                 | `externalOrchestrator.ts` put back to its pre-`633b3e2ea` form (the raw `spawn`) | `pathGuardSpawns` exit 1, "unguarded process start" naming the file                                                                               | exit 0 (7 of 7)                                                                                                                 |
| 2   | the connector storage guard's missing-root resolution | `storageGuard.ts` put back to its pre-`00c7c543b` form                           | `connectorStorageGuard` exit 1 with **4** failures, the new "accepts a first start whose data folder is reached [through a link]" case among them | the 3 legacy-storage failures that also fail on the untouched base (§5); `connectorRemoteIssuer` 3 of 3 with the default TMPDIR |
| 3   | the MHP v1.1 lock                                     | one hex digit of the frozen digest changed in `mhp-v1.1.lock.json`               | `npm run check:mhp` exit 1, `MHP_VERSION_LOCK: … frozen wire contract changed`                                                                    | exit 0                                                                                                                          |

Reds seen without being provoked, each followed by its fix and a green: `check:host-api` on the `node:fs`
count (§2.2); the first run's related shard 2 on the raw spawn (§2.2), fixed by `633b3e2ea` and green in
this round's shards.

## 8. Not run, and open items

Not run, with the reason:

- The vault and OS credential-store suites (rule): `test/unit/vault/**` and every real-credential suite.
  No command that reads the login Keychain was run by hand.
- The five browser suites, `ui:look`, `test:a11y`, `test:legal-a11y` (no browser or GUI app on this
  MacBook), and the VS Code integration suites (Electron cannot start here).
- `judgeP2Delivery` (about 90 minutes here, CC-INT6 §4) and `runtimeLsp` (§5).
- **The four Windows legs and the M111 Electron suites cannot run here and are listed for hosted CI**, as
  the brief requires: hosted CI's Windows jobs must confirm the merged tree (the worker, hook and
  contained-job paths the merged lanes touch, `lint:ps`), and M111's Electron suites must run where
  Electron starts. The nine hosts' Java, Kotlin and C# literal edits (§2.5) likewise wait for hosted CI or
  the JVM rig.
- **`check:editor-matrix` green**: needs the JetBrains and Eclipse hosts re-run against the `mhp/1.5.1`
  runtime so their receipts record 1.5.1 runs (§2.4). Until then it is red by design (exit 1, §3).
- **`check:font-coverage` green**: needs the image fonts installed; image CI runs it (exit 2 here, §3).
- **The `ps`-dependent suites green in this session**: the sandbox denies `/bin/ps`
  (`Operation not permitted`). Blocked, not failed: the five lane files of §4 (27 tests), `acpShutdown`'s
  twelve real-CLI states, and every base-identical count of §5 that reads process identity. The first run's
  October 31 logs have the lane files green with `ps` available; a session where `ps` runs must re-earn
  them on the final tree. Nothing was shimmed to get past the sandbox.

Open items, for the lead:

1. **Re-run the hosts at `mhp/1.5.1`** (JetBrains, Eclipse first: their receipts are the red gate), then
   regenerate `matrix.md`. Recommendation: on the JVM rig with the other seven hosts' compilation checks.
2. **The packed runs still owed** (unchanged by this round, claims held in §2.3): a real team run through
   the packed product (Muse Code and external workers), an external ACP agent leading a conversation
   (plus the lead's Claude Code check), `exec --vault` end to end, Muse Desktop's own look. Only then do
   the held README/CHANGELOG/ROADMAP sentences land.
3. **`acpShutdown`'s real-CLI states** on the screenless rig the lane used, and the five `ps`-blocked lane
   suites in a session where `ps` runs — both are one `npx vitest run` each (§4 names the files).
4. **Carried from CC-INT8, unchanged:** the maker host's activation wiring; the serial helper's bare
   `python3`; `judgeP2Delivery`'s cost; the MHP lock frozen for real from the release that ships 1.5.1;
   RLF-VAULTUNDO's terminal `vault undo`; RLF-M118's surface and live GitHub run; RLF-M124RO's and
   RLF-M109's owed checks; RLF-QUOTA's spent window; RLF-M96CERT's checklists; CC-INT4's dated items
   (Marketplace publishing off the personal access token by 2026-12-01).
5. **Decision numbers:** the highest used is **D252** (D250 RLF-ORCHEXT kept, D251 TEAMFIT already on
   int); D253 to D259 are free.

## 9. Commits

Merge commits and the commits that carry a merge interaction or a post-merge fix, in order (first parent of
`810b320fc..HEAD`; the commit carrying this record is the last):

| Commit      | What                                                                                                                   |
| ----------- | ---------------------------------------------------------------------------------------------------------------------- |
| `4bb0ef6ac` | Merge lanes/rlf-teamworkers3 (RLF-TEAMWORKERS 1 to 3: Muse Code and external-agent workers, --no-user-mcp-servers…)    |
| `35d87f421` | Merge lanes/rlf-orchext (RLF-ORCHEXT, D250: an external ACP agent leads the conversation) into cc/int9                 |
| `a91136652` | fix(int): the team MCP instructions and the process workers' words are model-text blocks of their own (merges 1, 2)    |
| `a1b734209` | Merge lanes/rlf-shutdown (RLF-SHUTDOWN and SHUTDOWN2: the ACP agent ends when its client leaves) into cc/int9          |
| `af9fdef89` | Merge lanes/hostsland-reviewed (RLF-HOSTSLAND and RVHOSTS: the nine native hosts on the real panel --stdio)            |
| `e892d8075` | fix(int): the native hosts' runners, generator table and test drivers are declared knip entries (merge 4)              |
| `c7b1353c9` | fix(int): the nine native hosts name mhp/1.5.1, the version int's runtime serves (merge 4)                             |
| `50e8dac7f` | Merge lanes/rlf-m111wb (RLF-M111WB: Muse Desktop's workbench shell, M111 lane WB) into cc/int9                         |
| `83ad6baf6` | Merge lanes/rlf-m111ed (RLF-M111ED: the shared editor group, M111 lane ED) into cc/int9                                |
| `99dc58856` | Merge lanes/rlf-m111th (RLF-M111TH: the shared desktop theme from M114's tokens, M111 lane TH) into cc/int9            |
| `013094d98` | Merge lanes/rlf-m111in (RLF-M111IN: Muse Desktop's languages, pseudo-RTL, font coverage, IME flags) into cc/int9       |
| `3679dbb0e` | fix(int): the desktop's generated Rust and QML language tables are regenerated for the merged keys (merge 5)           |
| `dabb0985d` | Merge lanes/rvint6 (RVINT6: the independent review of merge round 6, docs only) into cc/int9                           |
| `62d320f63` | fix(int): the MHP v1.1 lock is re-frozen a second time at mhp/1.5.1 for the external host kind (merge 2)               |
| `00c7c543b` | fix(int): the connector's storage guard reads the chain above a not-yet-existing data folder as the system resolves it |
| `b10e6f7fb` | docs(int): the README's exec --vault section waits for the real-life run; the M96 roadmap entry stays unproven-true    |
| `125886546` | fix(int): the editor group's two language-chunk catches test for a chunk that cannot load (merge 5)                    |
| `a057eb5cc` | fix(int): the node page's inline English carries backendExternal (merges 2 and 5)                                      |
| `a2fc8f7aa` | fix(int): the four scripts the desktop theme and native hosts added start through isEntryPoint (merges 4 and 5)        |
| `b62b5d4a8` | fix(int): the desktop footer's tab label is a per-call lookup (merge 5)                                                |
| `f1e85e4d3` | fix(int): a Muse Code worker turn that hit its round limit is a capped stop, never a finished one (merge 1)            |
| `fd48af664` | fix(int): the usable-reply guard lists the external orchestrator's tool-call status read with its reason (merge 2)     |
| `5fb118e35` | fix(int): the suites that start children share one isProcessAlive (merge 1)                                            |
| `633b3e2ea` | fix(int): the external orchestrator starts through the guarded child environment for its workspace (merge 2)           |
| `11663376e` | fix(int): the host-api record counts the external orchestrator's node:fs import (merge 2)                              |

Nothing was pushed. Highest decision number used: **D252**.
