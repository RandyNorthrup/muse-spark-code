# CC-INT8 — merge round 8: cc/int6 + cc/int7 and the lanes finished since (2026-10-31)

Claude Code lane `CC-INT8`, worktree `/Users/user/lanes/CC-INT8`, branch `cc/int8`, on the test rig
`MacBookPro.ivettnet` (macOS, Darwin 24.6.0, Intel x86_64, Node 24.21.0, npm 11.19.0). Base: `cc/int6`
`339c1ec95` (CC-INT6's round on int/recovery `0a5ebd718`, `docs/certification/cc-int6.md`; its known failures and
CC-INT7's and CC-INT5's are not counted against a merge here). Provider calls: **0**. Model attempts: **0**.
Muse requests: **0** (the brief names no real use; no real conversation, no nested ACP or CLI session). Nothing was
pushed, rebased, stashed or tagged. The vault and real credential-store suites (`test/unit/vault/**`,
`keyringParts`, `keystoreOwner`, `credentialLease`, `providerHeadersStore`, `deviceOwner*`, `devicePairKeyDpapi`,
`keystoreSingleFlight`) were never run on this MacBook, no browser or GUI app was started (`CHROME_PATH` is
`/usr/bin/false` on the rig), and no command that reads the login Keychain was run. Scratch files lived in the
worktree's ignored `temp/` (a copy of the base, a Python venv with zopfli 0.4.3 and semgrep 1.180.0, logs, one
scratch audit project, the extracted ACP package).

Two things to disclose. One commit of mine was amended: `6a668c74e` had a wrong count in its message ("38 lines in
15 files", the diff says 33), corrected with `git commit --amend` before anything else was built on it (the hook ran;
no history that anything else refers to was rewritten). And the merge commit `20f7d5da6`'s message says "17 files of
code comments" where the follow-up commit counts 15; the follow-up is right.

## 1. The merges

Fetched with `git fetch ~/gates/muse.git "refs/heads/lanes/<name>:refs/remotes/<name>"` (all
thirteen refs were on this machine) and merged with `git merge --no-ff`, in the brief's order,
each lane's certification record read first (`cc-int5.md`, `cc-int6.md`, `cc-int7.md`,
`rvm109.md`, `rvint7.md`, `rlf-teamfit.md`, `rlf-templeak.md`, `rvtempleak.md`, `rlf-quota.md`,
`rlf-acphonest.md`, `rlf-m96cert.md`, `cc-winpath.md`, `cc-scriptentry.md`, `rlf-m123.md`,
`rlf-m112.md`). "Conflicts" are the files git left unmerged.

| #   | Branch (tip)                            | Built on    | Commits | Merge commit | Conflicts | What the merge needed                                                                                                                      |
| --- | --------------------------------------- | ----------- | ------- | ------------ | --------- | ------------------------------------------------------------------------------------------------------------------------------------------ |
| 1   | `lanes/cc-int7` (`4e6a7140c`)           | `0a5ebd718` | 89      | `d324af073`  | 15        | §2.1: the recorder stack, the secret stores, the build specs, the lock regenerated, the generated files regenerated.                       |
| 2   | `lanes/m109-reviewed` (`0e0792b37`)     | `4e6a7140c` | 4       | `4c49edb0f`  | 1         | `host-api.md` regenerated. The lane contains cc-int7 (merge 1 had brought it in already).                                                  |
| 3   | `lanes/rvint7` (`7141aafaa`)            | `4e6a7140c` | 2       | `ea9baee05`  | 0         | Clean: six PLAN status lines beside m109-reviewed's; docs only, no product change.                                                         |
| 4   | `lanes/rlf-teamfit` (`8a03edf66`)       | `0a5ebd718` | 4       | `e60e47b8b`  | 3         | Its D229 is **D251** here (§2.2). `deferredBundles.mjs` and `uiTextRegions.mjs` took both sides. `npm run build` is 0.                     |
| 5   | `lanes/templeak-reviewed` (`20768f17e`) | `dfcb45936` | 4       | `453b005a5`  | 1         | `CHANGELOG.md` only. It supersedes `lanes/rlf-templeak` (not merged).                                                                      |
| 6   | `lanes/rlf-quota` (`fccb98ce4`)         | `0a5ebd718` | 9       | `20f7d5da6`  | 6         | Its D229 is **D252** here (§2.2). The MHP lock kept int's until the one re-freeze (§2.5).                                                  |
| 7   | `lanes/rlf-acphonest` (`41199127e`)     | `0eaf17293` | 11      | `3026634fb`  | 6         | `museReplay.ts`'s two `startLiveHost` signatures became one (§2.3); the lane's replay rig builds its agent with int's `acpLocalAgentDeps`. |
| 8   | `lanes/rlf-m96cert` (`bed126155`)       | `0a5ebd718` | 2       | `5b5530f13`  | 2         | `CHANGELOG.md`, `PLAN.md`.                                                                                                                 |
| 9   | `lanes/cc-winpath` (`d696cd128`)        | `0a5ebd718` | 11      | `27c58541b`  | 5         | Contains cc-winhook, cc-winworkers and cc-winrunteam, so it is merged instead of `lanes/cc-winrunteam` (§2.4).                             |
| 10  | `lanes/cc-scriptentry` (`b2ef75dfe`)    | `b781451b9` | 2       | `9ab7edb56`  | 1         | `check-webview-archive.mjs`: both conflicting hunks from scriptentry, not the whole file (§2.6).                                           |
| 11  | `lanes/rlf-m123` (`b36d21bf0`)          | `0a5ebd718` | 3       | `9d705844b`  | 1         | `host-api.md` regenerated.                                                                                                                 |
| 12  | `lanes/rlf-m112` (`08bc94bb6`)          | `0a5ebd718` | 4       | `3417831fb`  | 3         | `CHANGELOG.md`; the two generated reference files regenerated.                                                                             |

Generated files were regenerated each time, never hand-merged: `ROADMAP.md`, `host-api.md`,
`src/runtime/reference.node.generated.ts`, `src/shared/reference/reference.generated.ts` (and
`.json`), `docs/devices-reference.md`, `scripts/catch-baseline.json` (written once, after merge 1;
no SWALLOW, GENERIC or CLEANUP count rose), `package-lock.json` (`npm install --package-lock-only
--ignore-scripts`, then `npm ci --ignore-scripts` installed it) and `THIRD_PARTY_NOTICES.txt` (§2.7).
Each merge interaction that is not a conflict resolution is its own `fix(int):` commit naming the
merge (§9).

Not merged, as the brief says: `lanes/hostsland-reviewed`, the M111 lanes, `lanes/rlf-m104gl`,
`lanes/rlf-templeak` (superseded), `lanes/cc-winrunteam` (contained in cc-winpath), and the lanes
still running.

## 2. What each merge needed

### 2.1 `lanes/cc-int7` (merge 1) and its two companions

Fifteen conflicted files. Resolved for current int:

- **The Windows recorder** (`windowsRecorderDeps.ts`). Int's RLF-RECORDING split holds the
  line framer and the helper port in `recordingLineFramer.ts` and `recordingHelperProcess.ts`;
  RLF-NOSTUBS (cc-int7) had moved the same code into `assembleRecorderPort` inside the file int
  moved it out of. Int's structure is kept. `test/unit/windowsRecording.test.ts` (cc-int7's, driving
  real node children) now wires each child through `recordingLineProcess(startRecordingHelper(...))`
  with a no-workspace guarded environment, and passes the host's `l10n` the deps now require.
- **Both lanes' fields and imports kept:** `MuseCodeHost.ts` (`hardwareGuard` and `stageWaiters`),
  `runtime/backends.ts` (the hardware stop runner and the vault exec service type), `runtime/main.ts`
  (cc-int7's owned secret store and key-store migration shell, then int's maker secrets), `scripts/build.mjs`
  (every bundle spec of both sides).
- **`package.json`:** `typescript-eslint` 8.72.0 and `vitest` 5.0.5 (int, RLF-UPDEPS), `vscode-jsonrpc`
  10.0.0 (RLF-LSPBUS); `package-lock.json` regenerated, never hand-merged, and `npm ci --ignore-scripts`
  installs it.
- `CHANGELOG.md`, `PLAN.md`, `docs/real-life/unproven.md`: both sides kept. `ROADMAP.md`, `host-api.md`, the
  reference files and `scripts/catch-baseline.json`: regenerated.

Three merge interactions found after the conflicts, each its own commit:

- `00739fee6` (cc-int7 × CC-INT6's merge of RLM103). RLF-APPROVALS' `museCodeApprovalPersistence` starts its
  session at the invented path `<capture-workspace>`. Int's M103 hardware guard scans the session's folder, takes
  one it cannot read as hardware (its fail-safe) and refuses every shell approval ("cannot verify the approved
  target"). The suite starts in a real empty folder under the OS temp directory (removed after); both cases pass.
- `838392ddb` (cc-int7's RLF-GOVFORK). `supervisor.ts` launches a supervised run on Windows through
  `spawnResourceProcess('contained', ...)`; `pathGuardSpawns` reads source from disk, so `vitest related` never
  selected it for CC-INT7 and the governed-launch inventory was one entry short. The entry is reviewed in with its
  reason; 7 of 7.
- `edf8ecdbf` (CC-SCRIPTENTRY × int, §2.6).

`lanes/m109-reviewed` (merge 2) is cc-int7 plus three vault fixes and its record; `lanes/rvint7` (merge 3) is
its docs and six PLAN status lines. Neither added a decision number.

### 2.2 Decision numbers

`### D<n>` headings the lanes add, against `PLAN.md`:

| Lane             | On its branch | On int   | Why                                                                                            |
| ---------------- | ------------- | -------- | ---------------------------------------------------------------------------------------------- |
| `rlf-teamfit`    | D229          | **D251** | D229 is RLF-MUSESETUP's since CC-INT6; the brief renumbers TEAMFIT's.                          |
| `rlf-quota`      | D229          | **D252** | The same collision; D250 is RLF-ORCHEXT's and D251 TEAMFIT's, so the next free number.         |
| cc-int7          | D240 to D243  | same     | CC-INT7 renumbered its own (net D240, cred D241, m118 D242, rlf-m109 D243); CC-INT6 used D229. |
| every other lane | none          | none     |                                                                                                |

Every reference the two renumbered lanes added was changed line by line, only where the lane itself wrote
the line: TEAMFIT's one PLAN heading, its one other PLAN sentence, its record and its two code comments; QUOTA's
PLAN heading and two other PLAN references, its record and 33 comment lines in 15 files (`6a668c74e`; the merge
commit's message says "17 files", the diff says 15). Both headings and both records say "numbered D229 on its branch
until the int/recovery join of 2026-10-31". No other lane adds a heading. Highest number used this round: **D252**.
D253 to D259 are free.

### 2.3 `lanes/rlf-acphonest` (merge 7)

Six conflicts. `test/unit/helpers/museReplay.ts` had two incompatible `startLiveHost` signatures: int's
`(answer, features, wires, timeouts)` (CC-INT7's merge 6) and the lane's `(answer, features, options)`.
They are one: `(answer, features, options?: LiveHostOptions, timeouts?)`, with `LiveHostOptions` holding
`initializeResult`, `startResult` and `log`; every caller of both lanes keeps its shape. The lane's replay
rig (`acpReplayRig.ts`) builds its agent's non-backend dependencies with int's `acpLocalAgentDeps`, not a copy
of them (the duplication gate: 0 clones). `sessionTitles.test.ts` takes the lane's shared rig.

Interaction `d959ed9dd` (acphonest × RLM103): int's `resumeSession` reads the stored session first (it finds the
workspace for the hardware fence); `musecodeDispose` did not script `session/read`. The suite serves the capture
the lane already carries (`session-read-1.4.11.json`, recorded with its other 1.4.11 answers); the three resume
cases pass.

### 2.4 `lanes/cc-winpath` (merge 9)

The brief's step 7 names `lanes/cc-winrunteam` and says to merge `lanes/cc-winpath` instead if it exists. It
does, and contains cc-winrunteam (and so cc-winhook and cc-winworkers). Five conflicts: `CHANGELOG.md` (both
sides), `toolIo.ts` (int's curl exit constant beside the lane's `governedHookLauncher` and `hookArguments`),
`createdNative.ts` (templeak's `developerDir()` and the lane's `cwd` parameter), `playbookContainedJob.test.ts`
(CC-INT7's real-process cases with the lane's `endJobArgs` API; the `end` stand-ins CC-INT7 left in that file are
as it left them) and `runtimeLsp.test.ts` (CC-INT7's bounded `answer()` wrapper with the lane's `position`
argument). The Windows-only suites skip on this macOS rig.

The CHANGELOG keeps what the winhook lane claims (Tab hooks start no PowerShell; a hook that exits 2 blocks;
the old-DLL sweep, "used for real with the terminal agent") and the winpath lane's Security entry. CC-WINWORKERS
and CC-WINRUNTEAM add no claim of their own beyond the old-DLL sweep, and none was added.

### 2.5 `lanes/rlf-quota` and the single MHP re-freeze

RLF-QUOTA moved the one MHP version to `mhp/1.5.1` in the same change as its adoption of the lock. On the merged
tree `check:mhp` failed with `MHP_VERSION_LOCK: v1.1 frozen wire contract changed (expected 6a85876c…)`. The
adoption route was run once, on the final tree (`ea41454b4`):

1. `mhp-v1.lock.json` (the legacy-named snapshot) put back to int's `mhp/1.5.0` content (`81e74f3c…`), so the
   script, which adopts both locks in one run and refuses a lock already at the new version
   (`MHP_VERSION_ALREADY_ADOPTED`), could do both;
2. `node scripts/mhp-schema.mjs --adopt-version=mhp/1.5.1`: exit 0. The v1 lock came out byte-identical to the
   lane's own adoption (`14fbd539…`); the v1.1 lock moved from `mhp/1.5.0` / `abeeefae…` to `mhp/1.5.1` /
   `6a85876c…`; the generated schema files needed no rewrite;
3. `npm run check:mhp`: exit 0.

**Every contract change since the 1.5.0 lock** (the v1.1 snapshot of `339c1ec95` against the final one, compared
structurally, five differences and no others):

- the version: `protocol`, `range.minimum` and `initialize`'s `protocolVersion` const, `mhp/1.5.0` to `mhp/1.5.1`;
- the optional `quota` detail `{ limitKind: string, resetsAtMs: number }` (both required inside it, nothing else
  allowed) on the panel's `turnCompleted` and `turnRetry` agent events, in `panel.envelope` and in
  `embeddedBridge.onMessage` (RLF-QUOTA, D252).

Nothing else changed the snapshot: not the cred lane's vault-undo messages, not RLF-M123's lease client, not
RLF-LSPBUS, not TEAMFIT's bundle moves.

**1.5.0 is unreleased.** `mhp/1.5.0` first appears in `src/shared/constants.ts` in `c08ed1b8d` (2026-10-24, the
M104 lane 0 contract, D226); 0.19.0 was released on 2026-10-21 (the release merge `0cab9f323`, PR #258) and its tree
has no `mhp/` version string at all. No release has been cut since, and `main` here has no tag after 0.19.0. 1.5.1
has not shipped either. From the release that ships 1.5.1 the lock is frozen for real; D226 says so.

### 2.6 `lanes/cc-scriptentry` (merge 10)

The one conflict is `scripts/check-webview-archive.mjs`, in two hunks (the import block and the entry condition).
**The brief says "take scriptentry's side whole". I took scriptentry's side of both hunks and not the whole
file**, which is what the lane's own record (section 10) describes: `import { isEntryPoint }` and
`if (isEntryPoint(import.meta.url))`, no `pathToFileURL`, `path` or `realpathSync`. Taking the whole file would also
have put back the two `unzip` calls that CC-WINFAIL (already on int, `f1716241f`) had replaced with the packager's
own ZIP reader; `spawnSync unzip ENOENT` is what a Windows shell outside Git Bash gives. The file keeps `readZip`;
`entryPoint` and `webviewArchiveCheck` pass (66). If the lead wanted the `unzip` calls back, it is a two-line
revert, but I read that as the lane's wording, not its aim.

Interaction `edf8ecdbf`: `scripts/lib/portableModules.mjs` (RLF-M104D), `scripts/package-arduino.mjs` and
`scripts/typecheck-arduino.mjs` (RLM103) came after the lane's base and compared `process.argv[1]` with
`import.meta.url`; the lane's own lint block (`no-restricted-syntax` over `scripts/**`) refused all three (six
errors). They ask `isEntryPoint(import.meta.url)` now; `eslint scripts/` exits 0 and `arduinoBuild` passes (7).

### 2.7 After the merges: the bundles, the audit, the notices and the claims

- **`npm run build` exits 0.** TEAMFIT's four fits hold on the merged tree with no budget raised: `teamHost.js`
  122.7 KiB (budget 130), `teamRunners.js` 33.3 (75), `teamScheduler.js` 60.4 (75), `uiText.js` 114.1 (125), the
  new `teamTraffic.js` 47.3 (75) and `teamMcp.js` 7.0 (25). `uiText.js` was 115.5 KiB after merges 1 to 3 (CC-INT6's packing, key lists inside the packed payload and the maker
  words in the runtime region, had already taken it from 125.3 to 115.0; CC-INT7's connector, vault, gist, feeder and
  supervision sentences add 0.5), and TEAMFIT's watchdog move takes it to 113.9; it is **114.1** on the final tree, so
  no change of its own was needed. The build stopped
  once, at the notices check (`9affc5e78`): the regenerated lock moves the top-level `mime-types` from 2.1.35 to 3.0.2
  and `mime-db` from 1.52.0 to 1.54.0, so one licence-text variant of each left the file (the other two variants of each
  stay named); regenerated with `--write`, a four-line diff, 134 packages. **The message of `9affc5e78` gives a wrong
  reason** ("no longer put bytes into any shipped bundle"; `dist/meta/connectorRemote.json` still has 150 KB of
  `mime-db` in its output). The reason here is the right one, found after the commit and not rewritable without a
  rebase.
- **`follow-redirects`** (`913ed4106`). The override held 1.16.1 and npm reports GHSA-mrwp-f3q8-3g9p (high) against
  it, fixed in 1.16.2. The override now names 1.16.2. On the merged tree the package is not in `package-lock.json`
  at all (`ovsx` 1.3.0, RLF-UPDEPS, dropped the dependency that brought it in; CC-INT7's lock on `ovsx` 1.2.0 had
  it), so `npm run security:audit` exits 0 (two moderate notes, 0 exceptions) with or without the pin. The pin keeps a
  return of the package from coming back vulnerable. 1.16.2 was published 2026-10-25, inside the repository's 7-day
  `min-release-age` until 2026-11-01 21:32 UTC, which is why nothing resolves it now. Drilled on a scratch project
  under `temp/`: `audit.mjs --report` exits 1 on 1.16.1 and 0 on 1.16.2.
- **Claims** (`1305d6302`). RLF-M109's two CHANGELOG lines (the key-store migration in the terminal agent and
  headless runs; `exec --vault` shell calls with vault secrets) left `[Unreleased]` and wait in the lane's record,
  section 7, with the steps a real run takes, and in `docs/real-life/unproven.md`. ROADMAP's M96b entry said the ACP
  agent runs engine teams; it now says headless `exec --team` runs them and the ACP agent does not yet (the packed
  agent has no team session path, RLF-M96CERT §1). The README still documents `exec --vault` (around
  "Local headless `exec --vault`"); the brief named the CHANGELOG, so the README is open item 8.
- **D49** (`fb5042f34`), the lead's ruling on CC-INT6's open decision 4: D49's rules (and the M81 stub) now say the
  browser check reaches only the exact origins the person lists in the user-level `museSpark.browserCheckExtraHosts`
  (README, "Where a page may go"), not loopback by default; loopback, link-local and private addresses stay refused,
  and the maker companion's ports 47830 to 47839 are always refused. The archive's M81 record keeps the first
  rule as history (archive blocks are never edited). `machines panel` stays the maker page's word.

## 3. Proof on the final tree

Every command ran directly in the worktree; `PATH` carried the venv under `temp/` (zopfli 0.4.3 for the VSIX,
semgrep 1.180.0 for the SAST gate; `SSL_CERT_FILE=/etc/ssl/cert.pem`, `SEMGREP_ENABLE_VERSION_CHECK=0`). The
build, SAST, audit and package runs were made at `9affc5e78`; the commits after it change tests and documents
only (checked in §9), and the fast gates were run again on the very last tree, after this record (the last
column of the table says which).

| Command                                                                                                              | Exit    | Result                                                                                                                                                                                                                                                                                                                   |
| -------------------------------------------------------------------------------------------------------------------- | ------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `npm ci --ignore-scripts` (after `npm install --package-lock-only --ignore-scripts`)                                 | 0       | the lock agrees with `package.json`; run once after merge 1                                                                                                                                                                                                                                                              |
| `npm run format:check`                                                                                               | 0       | last tree                                                                                                                                                                                                                                                                                                                |
| `npm run typecheck`                                                                                                  | 0       | all six projects                                                                                                                                                                                                                                                                                                         |
| `npm run lint`                                                                                                       | 0       | `lint:ps` skipped: PSScriptAnalyzer runs on Windows only                                                                                                                                                                                                                                                                 |
| `npm run check:badges` / `check:tokens` / `check:l10n`                                                               | 0, 0, 0 | l10n: 14 UI tables, 14 usage tables, 287 manifest strings, 2,685 source files; 0 problems                                                                                                                                                                                                                                |
| `npm run check:reference` / `check:host-api` / **`check:mhp`**                                                       | 0, 0, 0 | host-api: 404 VS Code APIs, 62 files importing vscode, 30 Node built-ins. **`check:mhp` was red** ("MHP_VERSION_LOCK: v1.1 frozen wire contract changed") **and is green after the one re-freeze** (§2.5)                                                                                                                |
| `npm run check:plan` / `check:roadmap`                                                                               | 0, 0    | 249 milestones, 0 drift; 249 entries, `ROADMAP.md` current (last tree)                                                                                                                                                                                                                                                   |
| `npm run check:catches`                                                                                              | 0       | "All catch sites and counts match the baseline": no SWALLOW, GENERIC or CLEANUP count rose; the baseline was written once, after merge 1, with some counts lower (host GENERIC 94 to 92, runtime SWALLOW 30 to 29)                                                                                                       |
| `check:usable-reply`, `check:wrap-up-request`, `check:no-output-cap`, `check:no-round-cap`, `check:workflow-scripts` | 0 each  |                                                                                                                                                                                                                                                                                                                          |
| `npm run deadcode` / `cycles` / `duplication`                                                                        | 0, 0, 0 | knip: tag hints only; no circular dependency; **0 clones**                                                                                                                                                                                                                                                               |
| `npm run security:audit`                                                                                             | 0       | 2 advisories (moderate: glob, minimatch), 0 exceptions; was red on both bases for `follow-redirects` (§2.7)                                                                                                                                                                                                              |
| `npm run security:sast` (semgrep 1.180.0)                                                                            | 0       | 694 rules, 5,726 files, **0 findings**                                                                                                                                                                                                                                                                                   |
| **`npm run build`**                                                                                                  | **0**   | tokens, production build, size gate, bundle split, lazy registry (205 bundles, 308 loads), host-globals, notices (134, 4 optional fonts), legal build records (181 bundles, 3,608 files, 0 problems). It was 1 at the notices step once (§2.7) and 1 at the size gate on both bases. 287 rows hold, **no budget raised** |
| `node scripts/package-vsix.mjs --target win32-x64`                                                                   | 0       | **`VSIX: 4550553 bytes (budget 4915200)`**: 364,647 under (CC-INT6: 4,487,474; CC-INT7: 4,630,087)                                                                                                                                                                                                                       |
| `npm run package:acp -- --target win32-x64` and `--target darwin-x64`                                                | 0, 0    | 155 of 155 packaged-bundle checks each (CC-INT6: 149, CC-INT7: 146); 5.5 MB and 5.6 MB packed, 685 and 694 files; the darwin-x64 package needed `native/darwin/build.sh` and `build-local-judge.sh` first (0, 0)                                                                                                         |

Bundle sizes this round moves (D6; **none of the existing budgets was raised**, no budget was added by this round):

| Bundle                  | Base (the lane's own base)           | Final tree    | Budget (KiB) | How                                                                                         |
| ----------------------- | ------------------------------------ | ------------- | ------------ | ------------------------------------------------------------------------------------------- |
| `dist/teamHost.js`      | 140.2 KiB (over; CC-INT6, CC-INT7)   | **122.7 KiB** | 130          | RLF-TEAMFIT: the team MCP server in its own `teamMcp.js`                                    |
| `dist/teamRunners.js`   | 78.7 KiB (over)                      | **33.3 KiB**  | 75           | Traffic in its own `teamTraffic.js`                                                         |
| `dist/teamScheduler.js` | 76.5 KiB (over)                      | **60.4 KiB**  | 75           | its schemas read from `team.js`                                                             |
| `dist/uiText.js`        | 115.0 (CC-INT6); 129,202 B (CC-INT7) | **114.1 KiB** | 125          | the watchdog's words ride the runtime region; CC-INT6's packing                             |
| `dist/teamTraffic.js`   | (new, TEAMFIT)                       | 47.3 KiB      | 75           | the lane's own measured budget                                                              |
| `dist/teamMcp.js`       | (new, TEAMFIT)                       | 7.0 KiB       | 25           | the lane's own measured budget                                                              |
| `dist/extension.js`     | 531.9 (CC-INT6)                      | 534.5 KiB     | 600          | existing; the merged lanes' activation code                                                 |
| `dist/modelApi.js`      | 521.1 (CC-INT6); 522.1 (CC-INT7)     | 521.2 KiB     | 525          | existing                                                                                    |
| `dist/wire.js`          | 74.6 (CC-INT6)                       | 74.7 KiB      | 75           | existing (the tightest row, with `validation.js` 49.8 of 50 and `museCode.js` 124.3 of 125) |

## 4. Each merged lane's own suites, final tree, repository timeouts

`npx vitest run <files> --maxWorkers=3`, three files a run (28 runs), no `--testTimeout` anywhere. Every test file
a lane adds or changes from its own base (95 files, `git diff --diff-filter=AM`), less the eleven the vault and
credential rule excludes, is 84 files: **865 tests passed, 12 failed, 100 skipped** (the skips are the Windows-only
cases). The 12 failures, each rerun alone:

| Lane (files; not run by the rule)                                                                                                      | Not passed on first run                | After                                                                                                                                                                    |
| -------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `cc-int7` (53; 10 vault, keyring and device-owner suites)                                                                              | `connectorRemoteIssuer` (3)            | passes with `TMPDIR` inside the worktree, with `connectorRemote` and `connectorServe`: 22 of 22 (§5 row 3)                                                               |
|                                                                                                                                        | `connectorStorageGuard` (3)            | fails identically on the untouched base (§5)                                                                                                                             |
|                                                                                                                                        | `runtimeLsp` (3, the supervisor cases) | fail identically on the base (240 s timeouts there; here they refuse in 0.5 s with the lane's new sentence, the macOS socket-path limit)                                 |
| `m109-reviewed` (2; both vault suites), `rvint7` (0)                                                                                   |                                        |                                                                                                                                                                          |
| `rlf-teamfit` (4)                                                                                                                      | `teamHostRealParts` (3, 30 s timeouts) | fixed (`fix(int)` after merge 4: the suite took the real path of its temp root); 3 of 3                                                                                  |
| `templeak-reviewed` (6), `rlf-quota` (5), `rlf-acphonest` (7), `rlf-m96cert` (2), `cc-scriptentry` (1), `rlf-m123` (3), `rlf-m112` (1) |                                        | all pass                                                                                                                                                                 |
| `cc-winpath` (14)                                                                                                                      |                                        | all pass or skip: five suites are Windows-only (`hookLaunchWindows`, `jobHostHijack`, `teamLaunchWindows`, `actuatorsWindowsNative`, `windowsTreeReader`'s native cases) |

Suites run beyond the lane lists because a merge touched them: `pathGuardSpawns` (7), `windowsRecorderDeps`,
`arduinoBuild` (7), `webviewArchiveCheck` and `entryPoint` (66 with it), `cx1r2Truth` (18), `questionManifest` (3),
`legalReceipts` (35, after §5 row 1).

## 5. `npx vitest related` over the round's changed sources, and the base

The 189 `src/` and `scripts/` files changed since `339c1ec95` (every added or modified one but `src/shared/constants.ts`,
`src/shared/l10n/en.ts` and `src/extension.ts`, whose `related` closure is the whole battery; the l10n, reference, catch and
build gates stand for them), in twelve `--shard i/12` runs, the repository's own timeouts, `--maxWorkers=3`.
Excluded: the vault and credential-store suites of the rule, the five browser suites, `judgeP2Delivery` (about 90
minutes, CC-INT6 §4) and `runtimeLsp` (own run, §4). Together: **1,408 files (1,386 passed, 22 failed), 30,962 tests
(30,555 passed, 41 failed, 363 skipped)**. Every failing file was then run alone on the merged tree (all 22 failed
alone, so none is load) and, where it exists there, alone on an extracted copy of the untouched base
(`git archive 339c1ec95` under `temp/base`, the merged `node_modules` linked in, the darwin helper builds copied in,
built with `node scripts/build.mjs --production`, the same `TMPDIR`):

| #   | Files (failing tests)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          | Merged tree alone | Untouched base alone | Class                                                                                                                                                                                                                                                       |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ----------------- | -------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | `legalReceipts` (1: "issues only the reviewed lz-string receipt")                                                                                                                                                                                                                                                                                                                                                                                                                                                              | failed            | **passes**           | **Merge interaction, fixed** (§2): CC-INT7's net lane added three reviewed receipts to `licence-review.json` and left the suite; 35 of 35 now                                                                                                               |
| 2   | (found earlier in the round and fixed before the shards ran: `museCodeApprovalPersistence`, `musecodeDispose`, `pathGuardSpawns`, `teamHostRealParts`, `windowsRecording` (types), `entryPoint`'s lint block)                                                                                                                                                                                                                                                                                                                  | pass              | n/a                  | **Merge interactions, fixed** (§2.1, §2.3, §2.6, §4)                                                                                                                                                                                                        |
| 3   | `connectorRemoteIssuer` (3)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    | failed            | not on the base      | The lane's own: macOS's default temporary chain, which the connector's storage guard refuses; passes with a worktree `TMPDIR` (22 of 22 with its two siblings); same cause as `connectorStorageGuard`, row 4                                                |
| 4   | `acpServeHandshake` (1), `connectorStorageGuard` (3), `judgeLocalDarwinPid` e2e (1), `judgeLocalDarwinDeadline` (1), `makerLease` (1), `makerSerial` (2), `nodeDashboardPage` (5), `nodeTerminalPage` (6), `playbookGovernor` (1), `playbookSchedulesInputs` (1), `providerSpend` (1), `resourceProbesDarwin` (1), `resourceStatusCpu` (1), `runtimeMakerStop` (1), `teamEnginePorts` (5), `teamLandingKilled` (1), `teamLandingPause` (1), `teamPlaybookIntegration` (1), `teamWorkerCreateBundle` (1), `vsixCompression` (2) | the same 37       | the same 37          | **Base.** The same failing-test count in each of the 20 files on both trees. Most are CC-INT5 to CC-INT7's rows; `resourceProbesDarwin` (a live GPU and disk read on this Mac) is new to the lists and fails on the base too. Causes UNMEASURED beyond that |

**No file that passes on the base fails on the merged tree after the fixes.** The one that did (row 1) is fixed;
the other 21 failing files have the same failing-test counts on the untouched base, or (row 3) pass with the
`TMPDIR` the guard accepts. `runtimeLsp` alone: three failures on the merged tree and on the base (the supervisor
cases); its two `--tab` cases (a hook bound of 1.5 s against a busy Mac) failed in one early run at 120 s each
under load and passed in the lane run, so they are load, not a class. The base was run with the merged tree's
`node_modules` (vscode-jsonrpc 10.0.0, the connector's packages), so a base-only effect of those cannot be excluded.

## 6. Real use through the built product

No Muse request, no model attempt, no paid provider call, no real conversation and no nested ACP or CLI session
were made (**Muse requests: 0**). What the built product was used for, with none of them:

- **The packages.** The win32-x64 VSIX and both ACP packages, §3, with their packaged-bundle checks.
- **The packed agent, extracted into an empty folder** (`dist/muse-spark-code-acp-0.19.0-darwin-x64.tgz` under
  `temp/real/pkg`, a fresh HOME and an empty workspace): `node dist/acp.js exec --team --backend museCode "hello"`
  prints `These options require the Model API backend (--backend modelApi): --team.` and exits 2: the sentence
  RLF-M96CERT fixed, with the option filled in and no `{options}` placeholder, through the packed product. `exec --help`
  lists the options. No credential store was opened.
- **The MHP lock, the audit and the notices gates each ran as a command** and were drilled (§7).

Not run, because each needs a Muse request, a person at the machine, a browser, Windows or another OS: a real
conversation through the packed VSIX or ACP package; `exec --team` or `exec --vault` end to end; the quota words
against a real spent window; Muse Node `serve`; `npm run ui:look`; `test:a11y`; the VS Code integration suites
(Electron cannot start on a macOS lane); and everything Windows-only (§8).

## 7. Red/green drills

Each drill hashes the file, breaks it on purpose, runs the gate or suite, restores it byte-exact (hash checked) and
runs it again (`temp/drill.py` printed one JSON line each, kept in the ignored `temp/`).

| #   | Guard                                         | Break                                                                                 | Red                                                                                             | Restored, green                                |
| --- | --------------------------------------------- | ------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------- | ---------------------------------------------- |
| 1   | the MHP v1.1 lock                             | one hex digit of the frozen digest changed in `mhp-v1.1.lock.json`                    | `npm run check:mhp` exit 1, `MHP_VERSION_LOCK: … frozen wire contract changed`                  | exit 0                                         |
| 2   | the spawn inventory (the supervisor's launch) | the supervisor's entry renamed in `pathGuardSpawns.test.ts`                           | exit 1 (an unreviewed governed launch and a missing entry)                                      | exit 0                                         |
| 3   | the entry-point lint block                    | `isEntryPoint(import.meta.url)` back to the typed comparison in `package-arduino.mjs` | `eslint --max-warnings 0` exit 1, four `no-restricted-syntax` errors naming `isEntryPoint`      | exit 0                                         |
| 4   | the approval suite's real workspace           | `workspaces.make(...)` back to the invented `'<capture-workspace>'`                   | exit 1, 2 of 2 cases refused by the hardware guard                                              | exit 0                                         |
| 5   | the dispose suite's recorded `session/read`   | its `case 'session/read'` renamed                                                     | exit 1, 3 of 7 cases                                                                            | exit 0                                         |
| 6   | the notices check                             | a package name in `THIRD_PARTY_NOTICES.txt` changed                                   | `third-party-notices.mjs` exit 1, "does not match the packages in the production bundles"       | exit 0                                         |
| 7   | the size gate (a TEAMFIT fit)                 | `teamHost.js` budget 130 to 100 KiB in `check-bundle-size.mjs`                        | exit 1, "bundle size budget exceeded"                                                           | exit 0 (on the restored file the gate exits 0) |
| 8   | the real-parts suite's resolved temp root     | `realpath(...)` removed around the `mkdtemp`                                          | exit 1, 3 of 3 cases ("The team copy is outside canonical storage")                             | exit 0                                         |
| 9   | the legal receipts suite                      | one digit of the `deep-equal` receipt's digest changed in `licence-review.json`       | exit 1, `expected '435a6722…' to be '035a6722…'`                                                | exit 0, 35 of 35                               |
| 10  | the audit gate on `follow-redirects`          | a scratch project (under `temp/`) pinned at 1.16.1 against 1.16.2                     | `node scripts/audit.mjs --report` exit 1 (high GHSA-mrwp-f3q8-3g9p) on 1.16.1, exit 0 on 1.16.2 | (no tracked file)                              |

Reds seen without being provoked, each followed by its fix and a green: the typecheck error on the merged recorder
test (§2.1), the unit-type error in `LiveHostOptions` (§2.3), `pathGuardSpawns` (§2.1), the lint block (§2.6),
`legalReceipts` (§5), `teamHostRealParts` (§4), `npm run build` at the notices step (§2.7).

## 8. Not run, and open items

Not run, with the reason:

- The vault and OS credential-store suites (rule): `test/unit/vault/**` (the eight vault files the lanes changed,
  RVM109's `vaultPersonPolicy` and `feederRuntimeDir` and RLF-M109's `vaultExecDelegated` among them),
  `keyringParts`, `keystoreSingleFlight`, `deviceOwnerVaultUses`, and every other real-credential suite
  (`keystoreOwner`, `credentialLease`, `providerHeadersStore`, `deviceOwnerBind*`, `devicePairKeyDpapi`). No command
  that reads the login Keychain was run.
- The five browser suites (`devicesPhase2Harness`, `teamModelsFirstPaint`, `feedbackBrowser`, `makerReviewBrowser`,
  `nodeBrowserWorkspace`; `CHROME_PATH` is `/usr/bin/false` on the rig), and no GUI app, no `ui:look`, no `test:a11y`.
- `judgeP2Delivery` (about 90 minutes here, CC-INT6 §4) and `runtimeLsp` in the related shards (its own run is §5).
- Everything Windows-only: the hook, governor, worker, contained-job and team-launch suites of CC-WINHOOK,
  CC-WINWORKERS, CC-WINRUNTEAM and CC-WINPATH skip on macOS (`hookLaunchWindows`, `jobHostHijack`, `jobHostNative`'s
  native cases, `teamLaunchWindows`, `actuatorsWindowsNative`, `windowsTreeReader`'s native cases, `playbookContainedJob`'s
  Windows block); `lint:ps` (Windows only). **Hosted CI's Windows leg must confirm the merged tree**: the four
  PowerShell-free launch paths, the job helper's closed DLL search and the Windows recorder port are proven by the
  lanes' own records on Windows 11, not here.
- Any model request, real conversation, paid provider call, `exec --team`, `exec --vault`, `mcp serve-http` through the
  packed product, a live GitHub run, the Muse Code CLI. **Muse requests this round: 0.**

Open items, for the lead (each with its options and a recommendation where there is a choice):

1. **A later lane (the brief's): the maker host's activation wiring.** `src/extension.ts` still creates neither
   `createMakerHost`, `MakerCommands` nor `createMakerPreviewPanel` (CC-INT6 open item 3). Recommendation, as
   CC-INT6's: (a) wire them through a lazy loader like the Devices one, with a real-use run of the preview in the
   packed VSIX.
2. **A later lane (the brief's): the serial helper's bare `python3`.** `nativeSerial.ts` gives it a child
   environment without the run workspace on PATH, but still resolves `python3` by name. Recommendation: resolve it
   with `resolveExecutable` outside the workspace and start the absolute path, when the serial helper next changes.
3. **A later lane (the brief's): `judgeP2Delivery`'s cost.** About 90 minutes on a Mac (hundreds of real gate runs
   while the file is collected, a `vsce ls` per allowlist case). Recommendation: one gate run shared between
   controls that mutate the same metafile, and the `vsce ls` walk kept off scratch folders.
4. **The README still documents `exec --vault`** (around "Local headless `exec --vault`", README lines ~6427 to 6440)
   although its CHANGELOG lines now wait for the real-life run. The brief named the CHANGELOG. Options: (a) leave the
   README, since it documents the code and states the ceiling and grant rules; (b) hold the section until
   the run is recorded. Recommendation: (b), with the CHANGELOG.
5. **The brief's "take scriptentry's side whole"** (§2.6): I took scriptentry's side of the two conflicting hunks and
   kept CC-WINFAIL's ZIP reader instead of putting `unzip` back. Option: the two-line revert. Recommendation: as done.
6. **`follow-redirects`** is not in the lock (§2.7). The override now names the fixed version and is harmless; option:
   delete the override as a dead pin. Recommendation: keep it until `ovsx` or another dependency has been seen not
   to need the package across a release.
7. **The MHP lock is frozen for real from the release that ships 1.5.1.** Nothing else changes the snapshot until
   then without a version bump.
8. **Macs: `runtimeLsp`'s three supervisor cases and `connectorStorageGuard`'s three cases cannot pass here** (same
   on the untouched base; §5): the first by the 103-byte socket-path limit with a temporary HOME, the second by the
   storage guard refusing macOS's default temporary chain. `connectorRemoteIssuer` passes with a worktree `TMPDIR`.
   Recommendation unchanged from CC-INT7: a short HOME on darwin for `runtimeLsp`; whether hosted CI has a macOS
   leg that runs these decides urgency.
9. **Still open from the lanes, unchanged by this round:** RLF-VAULTUNDO's terminal `vault undo`; RLF-M118's missing
   surface and live GitHub run; RLF-M124RO's owed packed-product, Inspector and dual-era checks; RLF-M109's git,
   askpass, sudo and SSH surfaces and Windows feeder containment; RLF-QUOTA's own receipt is one packed-ACP
   normal-path turn on `muse-spark-1.3-contributor` (1 request, recorded in its record) and a real spent window
   was never provoked; RLF-TEAMFIT's real team run through the packed product; RLF-M96CERT's checklists (no box
   closes); the shutdown observations of CC-INT7 §9 item 5 (RLF-SHUTDOWN is still running); CC-INT4's dated items
   (Marketplace publishing off the personal access token by 2026-12-01).
10. **Decision numbers:** the highest used is **D252** (D251 TEAMFIT, D252 QUOTA); D253 to D259 are free.

## 9. Commits

Merge commits and the commits that carry a merge interaction or a post-merge fix, in order (first parent of
`339c1ec95..HEAD`; the commit carrying this record is the last):

| Commit      | What                                                                                                                   |
| ----------- | ---------------------------------------------------------------------------------------------------------------------- |
| `d324af073` | Merge lanes/cc-int7 (CC-INT7's round: net, cred, m118, maccred, rlf-m109, approvals, safefix, govfork, nostubs, lsp... |
| `4c49edb0f` | Merge lanes/m109-reviewed (RVM109: a linked or shared vault policy file refused; the feeder sees the broker's runti... |
| `ea9baee05` | Merge lanes/rvint7 (RVINT7: the independent review of merge round 7, docs and six PLAN status lines) into cc/int8      |
| `e60e47b8b` | Merge lanes/rlf-teamfit (RLF-TEAMFIT: the four over-budget bundles fit; new teamTraffic.js and teamMcp.js; finalAdm... |
| `453b005a5` | Merge lanes/templeak-reviewed (RLF-TEMPLEAK plus RVTEMPLEAK's removal fixes: dead creators' temp trees reclaimed, a... |
| `20f7d5da6` | Merge lanes/rlf-quota (RLF-QUOTA: a spent Muse Code window is its own outcome, said with its local reset time; ACP ... |
| `6a668c74e` | fix(int): RLF-QUOTA's code comments say D252, the number its decision has on int (CC-INT8, merge 6)                    |
| `3026634fb` | Merge lanes/rlf-acphonest (RLF-ACPHONEST: ACP mode honesty, orderly shutdown, the started lifecycle reader) into cc... |
| `00739fee6` | fix(int): the approval-persistence suite decides in a real, empty workspace (CC-INT8, merges 1 and 6)                  |
| `d959ed9dd` | fix(int): the dispose suite answers session/read with its recorded capture (CC-INT8, merge 7)                          |
| `5b5530f13` | Merge lanes/rlf-m96cert (RLF-M96CERT: the --team refusal says the option it refuses; its record of what M96 waits f... |
| `27c58541b` | Merge lanes/cc-winpath (CC-WINHOOK, CC-WINWORKERS, CC-WINRUNTEAM and CC-WINPATH: hook launches, the governor, worke... |
| `838392ddb` | fix(int): the supervisor's governed launch is reviewed into the spawn inventory (CC-INT8, merge 1)                     |
| `9ab7edb56` | Merge lanes/cc-scriptentry (CC-SCRIPTENTRY: isEntryPoint for 28 scripts and its lint block) into cc/int8               |
| `edf8ecdbf` | fix(int): three scripts the maker and portable lanes added start through isEntryPoint (CC-INT8, merge 10)              |
| `9d705844b` | Merge lanes/rlf-m123 (RLF-M123: the editor's GitHub lease in the runtime panel, the push's kept Git routes) into cc... |
| `3417831fb` | Merge lanes/rlf-m112 (RLF-M112: the deferral docs say D121, as the code and translations already do) into cc/int8      |
| `913ed4106` | fix(int): follow-redirects is pinned at 1.16.2, the version that fixes GHSA-mrwp-f3q8-3g9p (CC-INT8)                   |
| `ea41454b4` | fix(int): the MHP v1.1 lock is re-frozen once at mhp/1.5.1 through the adoption route (CC-INT8)                        |
| `fb5042f34` | docs(plan): the browser check reaches only listed origins (D49 amended); D226 notes the single MHP re-freeze (CC-INT8) |
| `1305d6302` | docs(int): RLF-M109's two CHANGELOG lines wait for the real-life run; the roadmap stops saying the ACP agent runs t... |
| `9affc5e78` | fix(int): THIRD_PARTY_NOTICES.txt follows the merged bundles (CC-INT8, merges 1 and CC-INT6's 2)                       |
| `768c272da` | fix(int): the team real-parts suite resolves its temp root (CC-INT8, merge 4)                                          |
| `e7f96e0bb` | fix(int): the legal receipts suite checks every reviewed receipt against its installed package (CC-INT8, merge 1)      |

Between `9affc5e78` (where the build, SAST, audit and package runs were made) and this record's commit, the only
files that changed are `test/unit/legalReceipts.test.ts`, `test/unit/teamHostRealParts.test.ts`, `PLAN.md` (three
dated status paragraphs) and this record (`git diff 9affc5e78 HEAD --stat`).

Nothing was pushed. Highest decision number used: **D252**.
