# CC-INT10 — merge round 10: the CI fixes, the small fixes, the judge's rows, the companion routes, M111 QA/CP/OB/BP, unicorn 79 (2026-11-02, finished 2026-11-03)

Integration lane `CC-INT10`, branch `cc/int10`. Base: `cc/int9` at `5ec754534` (CC-INT9's join,
`docs/certification/cc-int9.md`; its known failures are not counted against a merge here). Provider calls: **0**.
Model attempts: **0**. Muse requests: **0** (the brief allows none). Nothing was pushed, rebased, stashed or tagged.

Two runs made this round, said plainly. The merges and the `fix(int):` commits through `c96b77367` were made in
Muse Spark Code on the MacBook (`MacBookPro.ivettnet`, darwin-arm64), which stopped at Muse's weekly limit before
SAST, the unit suite's classification and this record. The lane was taken over in Claude Code on the Linux rig
`randy-lt` (Linux 7.0.0-42, x86_64, 8 cores, Node 24.21.0, npm 11.19.0) at `c96b77367`, worktree
`/home/randy/lanes/CC-INT10`, with nothing uncommitted; nothing was re-merged. Everything from §3 on was run on this
rig and is reported from these runs; the MacBook's darwin-arm64 packaging is reported from its own step list (§3).

Two facts of this rig shape §4. Its shell `umask` is `0002`, so every folder a suite creates with `mkdir` is
group-writable, and the product's trusted-path and owner-only checks refuse such a folder by design ("group/other
writable ancestor"); CI runs with `0022`. And the worktree's `node_modules/node-pty` had no compiled binding
(`build/Release/pty.node`) until `npm rebuild node-pty` ran (exit 0). Neither was worked around in the product or
the suites: each suite they touch was re-run once with the condition named (§4). The default `TMPDIR`
(`/var/tmp/l-CC-INT10`, `drwx------`, under the root-owned sticky `/var/tmp`) was used for every run; no canonical
`TMPDIR` was needed (CC-INT9 §2.7's `connectorRemoteIssuer` passed with the default here). Scratch files lived in
the worktree's ignored `temp/` (gate logs, the pinned semgrep and zopfli venvs, the suite logs) and under `TMPDIR`
(shared clones of the base and of two lane tips, removed at the end).

## 1. The merges

Merged by the MacBook run with `git merge --no-ff`, in this order. Commits are
`git rev-list --count <merge>^1..<merge>^2`.

| #   | Branch (tip)                        | Commits | Merge commit | What it brings                                                                                    |
| --- | ----------------------------------- | ------- | ------------ | ------------------------------------------------------------------------------------------------- |
| 1   | `lanes/rvint8` (`70d0c611a`)        | 3       | `bdc11fdd5`  | RVINT8, the review of CC-INT8: the quota sentence carries no request id; unreleased claims fixed  |
| 2   | `lanes/rlf-cifixa` (`97beeba6e`)    | 17      | `1dd942e44`  | RLF-CIFIXA: hosted CI's non-Windows failures on Node 22, native helper imports, gitleaks          |
| 3   | `lanes/rlf-smallfix1` (`1a3349306`) | 3       | `6ac563376`  | RLF-SMALLFIX1: a missing native helper says what is missing; the serial helper's absolute python3 |
| 4   | `lanes/rlf-smallfix2` (`9aad9dd83`) | 8       | `6300eadc1`  | RLF-SMALLFIX2: honest words where helpers and sessions fail; the serial interpreter setting       |
| 5   | `lanes/rlf-m96crec` (`6b71e2977`)   | 2       | `134a69d95`  | RLF-M96CREC: the M96c acceptance record, golden-frame consumers                                   |
| 6   | `lanes/rlf-m115t` (`0dec498da`)     | 4       | `d04fbb170`  | RLF-M115T: schedule role and team targets (C-M115-8)                                              |
| 7   | `lanes/rlf-m125` (`e319dc1a5`)      | 4       | `0eaf3854d`  | RLF-M125: the judge's open rows; macOS stat from the walk                                         |
| 8   | `lanes/rlf-m104lc` (`b65a5753a`)    | 11      | `fb59d6837`  | RLF-M104LC: companion MHP routes, `panel --companion` (carries M104 lane D)                       |
| 9   | `lanes/rlf-m111qa` (`410b1ae4f`)    | 16      | `9d245e90b`  | RLF-M111QA: the desktop test rig                                                                  |
| 10  | `lanes/rlf-m111cp` (`4de18d4b0`)    | 17      | `647307060`  | RLF-M111CP: compositor and windows                                                                |
| 11  | `lanes/rlf-m111ob` (`ada941ce7`)    | 8       | `11d8b3ddc`  | RLF-M111OB: observability                                                                         |
| 12  | `lanes/rlf-m111bp` (`9d8ade3df`)    | 13      | `38d365e5c`  | RLF-M111BP: the bottom panel (node-pty 1.1.0, four xterm add-ons)                                 |
| 13  | `lanes/rlf-unicorn79` (`579237ba7`) | 16      | `16e34dd0b`  | eslint-plugin-unicorn 77.0.0 → 79.0.0, whole-repo lint                                            |

The MacBook run's commit subjects number merges by its own brief's list ("merge 4", "merge 8", "merge 10"); the
table above is the order on the branch, and §2 names each fix by what it touched.

## 2. Each interaction fixed

| Commit      | Run     | What the joined tree needed                                                                                                                                                                                                                                                                          |
| ----------- | ------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `e330ebaec` | MacBook | Both maker entries build their native serial dependencies once, so `runtimeMaker` holds its budget (D6; the serial interpreter setting of merge 4 with the maker)                                                                                                                                    |
| `b63850dbc` | MacBook | `dist/node.js` holds its budget on the joined tree: journal files split, the Diagnostics payload schema in its own `dist/nodeDiagnostics.js`, readiness evaluated by its supplier (D6, never raised)                                                                                                 |
| `9e25295f5` | MacBook | The MHP schema prose says `mhp/1.5.1`, the version the negotiation already speaks                                                                                                                                                                                                                    |
| `4b9829012` | MacBook | The unsent-update suite waits for the destroyed stream's close, so the next update fails as a real editor exit does                                                                                                                                                                                  |
| `78e9d1d5f` | MacBook | unicorn 79's new reports fixed at the code on everything the earlier merges brought in                                                                                                                                                                                                               |
| `b70560668` | MacBook | unicorn 79 clean in the test trees too, nested ternaries restructured                                                                                                                                                                                                                                |
| `4ad2b0fd1` | MacBook | The runner helper's nested ternary split so prettier and unicorn agree                                                                                                                                                                                                                               |
| `fa41711e7` | MacBook | Two more combined guards (`ModelApiHost.ts`, `execTeamRecovery.ts`) stay separate so `check:catches` reads them NARROW; PLAN §8 row to 23 sites                                                                                                                                                      |
| `d913f3b9e` | MacBook | The two relocation suites share one memory fixture from `resourceHarness.ts`, so `duplication` finds no clone                                                                                                                                                                                        |
| `c96b77367` | MacBook | `.vscodeignore` ships the desktop `uiText` region (`dist/uiTextDesktop.js`) in the VSIX                                                                                                                                                                                                              |
| `2724cb25f` | rig     | `deploy/container/policy.json`, `deploy/install/layout.sh` and the install suite's staged files name `dist/nodeDiagnostics.js` (from `b63850dbc`) and `dist/uiTextDesktop.js` (the desktop lanes' region `uiText.js` now loads): `packagedBundles` failed on the joined tree, green on the base (§4) |

## 3. Proof on the merged tree

Every gate ran on this rig at `c96b77367` through `temp/run-gates.sh`, one after another, each log in
`temp/gates/`. `PATH` carried `temp/venv-semgrep/bin` first (semgrep **1.180.0**, the pin in
`.github/semgrep/requirements.txt`; the user-level semgrep on this rig is 1.177.0 and was not used). The one commit
after them (`2724cb25f`) touched two deploy lists and one suite: its files passed the hook's eslint and prettier, its
two suites are green (§4), and the final `npm run build` below ran on it.

| Command                                                                                                                | Exit   | Result                                                                                                                                                                                                                                                                                                                                     |
| ---------------------------------------------------------------------------------------------------------------------- | ------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `npm run format:check`                                                                                                 | 0      | all files                                                                                                                                                                                                                                                                                                                                  |
| `npm run lint`                                                                                                         | 0      | `lint:ps` skipped by its own script: PSScriptAnalyzer runs on Windows only                                                                                                                                                                                                                                                                 |
| `npm run typecheck`                                                                                                    | 0      | all seven projects                                                                                                                                                                                                                                                                                                                         |
| `npm run check:catches`                                                                                                | 0      |                                                                                                                                                                                                                                                                                                                                            |
| `npm run check:plan`                                                                                                   | 0      |                                                                                                                                                                                                                                                                                                                                            |
| `npm run check:l10n`                                                                                                   | 0      |                                                                                                                                                                                                                                                                                                                                            |
| `npm run check:reference`                                                                                              | 0      |                                                                                                                                                                                                                                                                                                                                            |
| `npm run check:mhp`                                                                                                    | 0      |                                                                                                                                                                                                                                                                                                                                            |
| `npm run check:roadmap`                                                                                                | 0      |                                                                                                                                                                                                                                                                                                                                            |
| `npm run check:host-api`                                                                                               | 0      |                                                                                                                                                                                                                                                                                                                                            |
| `check:usable-reply` / `wrap-up-request` / `no-output-cap` / `no-round-cap` / `workflow-scripts` / `tokens` / `badges` | 0 each |                                                                                                                                                                                                                                                                                                                                            |
| `npm run check:lazy-registry` (standalone)                                                                             | 1      | `dist/meta` absent before any build; the same check runs inside `npm run build` and passed there                                                                                                                                                                                                                                           |
| `npm run check:editor-matrix`                                                                                          | 1      | `MHP_MATRIX_REPORT:jetbrains:[`; the same exit on the untouched base: the JetBrains and Eclipse receipts were recorded at `mhp/1.5.0` (CC-INT9 §3, §8)                                                                                                                                                                                     |
| `npm run check:font-coverage`                                                                                          | 2      | `hb-shape is missing` on this rig (desktop CI installs `libharfbuzz-bin`); not run                                                                                                                                                                                                                                                         |
| `npm run deadcode`                                                                                                     | 0      | knip                                                                                                                                                                                                                                                                                                                                       |
| `npm run cycles`                                                                                                       | 0      |                                                                                                                                                                                                                                                                                                                                            |
| `npm run duplication`                                                                                                  | 0      | 0 clones                                                                                                                                                                                                                                                                                                                                   |
| `npm run security:audit`                                                                                               | 0      | 2 moderate notes (`glob` GHSA-3g3m-2fjr-6pw4, `minimatch` GHSA-g3hv-75wg-m249), 0 exceptions                                                                                                                                                                                                                                               |
| `npm run security:secrets`                                                                                             | 0      | gitleaks: 9,295 commits, no leaks                                                                                                                                                                                                                                                                                                          |
| `npm run security:sast`                                                                                                | 0      | semgrep 1.180.0, `--config auto`: 699 rules on 6,107 files, **0 findings** — the SAST the MacBook could not run                                                                                                                                                                                                                            |
| `npm run build`                                                                                                        | 0      | at `c96b77367`; again **exit 0** at `2724cb25f` (§7's VSIX drill follows it)                                                                                                                                                                                                                                                               |
| `node scripts/exec-schema.mjs --check && node scripts/package-acp.mjs --target linux-x64`                              | 0      | the ACP package for linux-x64                                                                                                                                                                                                                                                                                                              |
| `node scripts/package-vsix.mjs --target linux-x64`                                                                     | 1      | first run: compression refused without the pinned zopfli, as designed (no zlib fallback)                                                                                                                                                                                                                                                   |
| the same, `temp/venv-zopfli/bin` first (`zopfli==0.4.3`, `.github/vsix-compress/requirements.txt`)                     | 0      | 4,656,546 bytes (budget 4,915,200), packed after removing `dist/webview/node`, which `nodeBrowserWorkspace.test.mjs` had built into `dist/webview/` during §4's run. The first zopfli run packed that leftover and measured 4,952,332 bytes, over budget; the base's VSIX, packed the same way from a clean clone, is 4,624,687 bytes (§8) |
| `npm run check:node-image`                                                                                             | 1      | usage only: it checks a built OCI tarball and its receipt (`package:node-image`), none built here                                                                                                                                                                                                                                          |

The darwin-arm64 VSIX was built on the MacBook and not rebuilt here: its step list records "Re-run targeted VSIX
with zopfli (exit 0)" after the venv with the pinned zopfli, then "Commit vscodeignore fix (exit 0)" (`c96b77367`).
Its following step "Build darwin-arm64 packages" carries no exit code in that list.

## 4. The unit suite, each lane's suites, and the classification

`npx vitest run` at `c96b77367`, the config's own three workers and the repository's own timeouts (no
`--testTimeout`), output in `temp/unit/`. It contains every merged lane's `test/unit` and `test/e2e` files.

```
 Test Files  17 failed | 1476 passed | 43 skipped (1537)
      Tests  35 failed | 31565 passed | 365 skipped (31965)
     Errors  1 error
   Duration  2770.78s
exit 1
```

The one error is `test/unit/judgeP2Delivery.test.ts`: its worker sat 40 minutes after every other file had finished
and was stopped with SIGTERM so the run could report. Each failed file then ran alone on this tree and alone on the
untouched base (a shared clone of `5ec754534` under `TMPDIR`, the same `node_modules`), at the same time, through
`temp/classify.sh`; a file the base does not have ran on its own lane's tip instead.

| File                                         | Full run      | Alone, this tree            | Base `5ec754534`                       | Class                                                                                                                                                                                                                                  |
| -------------------------------------------- | ------------- | --------------------------- | -------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `packagedBundles.test.mjs`                   | 1 failed      | 1 failed                    | 10 passed                              | **From the merge**: `nodeContainer`/`nodeInstall` lacked `dist/nodeDiagnostics.js` and `dist/uiTextDesktop.js`. Fixed `2724cb25f`; with `nodeInstall.test.mjs`, 37 of 37                                                               |
| `osImageBuild.test.mjs`                      | 1 failed      | 149 passed                  | 149 passed                             | Load only: the Pi firmware `gpgv` case under the full run's load; green alone                                                                                                                                                          |
| `desktop/panelSessions.test.ts` (M111 BP)    | 7 failed      | 8 passed                    | absent                                 | Rig: `pty.node` was not compiled; green after `npm rebuild node-pty`                                                                                                                                                                   |
| `desktop/shell.test.ts`                      | 1 failed      | 6 passed                    | 5 passed                               | Rig: the same `pty.node`                                                                                                                                                                                                               |
| `portalRecord.test.ts`                       | 2 failed      | 2 failed                    | 9 passed, 1 skipped                    | Rig umask: the native helper verification the round's small fixes added refuses the group-writable fixture folder; 9 passed, 1 skipped with `umask 022`                                                                                |
| `helperWords.test.ts` (RLF-SMALLFIX2)        | 1 failed      | 1 failed                    | absent                                 | Rig umask: "group/other writable ancestor" where the case wants "not executable"; green with `umask 022`                                                                                                                               |
| `createdRegistrySpaces.test.ts`              | 1 failed      | 1 failed                    | 1 failed                               | Reproduces on the base (rig umask: green with `umask 022`). Left                                                                                                                                                                       |
| `createdRegistrySaveErrors.test.ts`          | 1 failed      | 1 failed                    | 1 failed                               | Reproduces on the base. Left                                                                                                                                                                                                           |
| `connectorStorageGuard.test.ts`              | 1 failed      | 1 failed                    | 4 failed                               | Reproduces on the base (the base fails more of it). Left                                                                                                                                                                               |
| `runtimeLsp.test.ts`                         | 3 failed      | 3 failed                    | 3 failed                               | Reproduces on the base: supervision refuses the data folder chain ("a folder only you can write to"). Left                                                                                                                             |
| `runtimeMakerStop.test.ts`                   | 1 failed      | 1 failed                    | 1 failed                               | Reproduces on the base (RVM103W6 P1 case). Left                                                                                                                                                                                        |
| `teamProcessWorkers.test.ts`                 | 2 failed      | 2 failed                    | 2 failed                               | Reproduces on the base: two 60 s case timeouts. Left                                                                                                                                                                                   |
| `vault/chatgptSubscriptionMigration.test.ts` | 7 failed      | 7 failed                    | 7 failed                               | Reproduces on the base: "the operating system's credential store is not available" (no Secret Service session on this headless rig). Left                                                                                              |
| `vault/posixVaultPanelFlow.test.ts`          | 2 failed      | 2 failed                    | 2 failed                               | Reproduces on the base, the same credential store. Left                                                                                                                                                                                |
| `vault/vaultStoreScope.test.ts`              | 2 failed      | 2 failed                    | 2 failed                               | Reproduces on the base, the same credential store. Left                                                                                                                                                                                |
| `museStartFault.test.ts` (RLF-SMALLFIX2)     | 1 failed      | 1 failed                    | absent; lane tip `9aad9dd83`: 1 failed | Not from the merge: fails the same on its own lane's tip, with either umask. The 126 case gets `write EPIPE` (the shell exits before the handshake is written) and `museStartFailure` leaves a non-protocol error untouched. Open (§8) |
| `o11y/crashHook.test.ts` (RLF-M111OB)        | 1 failed      | 1 failed                    | absent; lane tip `ada941ce7`: 1 failed | Not from the merge: the owner-only node hook case fails the same on its own lane's tip, with either umask. Open (§8)                                                                                                                   |
| `judgeP2Delivery.test.ts`                    | hung, stopped | stopped at 600 s (exit 124) | stopped at 600 s (exit 124)            | Reproduces on the base: the file never finishes on this rig. Left                                                                                                                                                                      |

The fork protection and credential suites the MacBook run had started to classify passed in this rig's full run,
apart from the three vault suites above.

## 5. `npx vitest related`

Not run as its own command. Every file `vitest related` would select over the round's changed sources is in the
full run of §4 (its include list is the same), and each failure there is classified above; a second, partial run of
the same files would only repeat them, and the lane's budget did not stretch to it (§8).

## 6. Real use

None: the brief allows no Muse request and no provider call, and this round's proof is the gates and suites.

## 7. Red/green drills

Each drill hashes the file, puts back its pre-fix form from git, runs the gate, restores it (`git checkout --`, hash
checked) and runs the gate again (`drill` in `temp/classify.sh`).

| #   | Guard                            | Break                                                     | Red                                                                                  | Restored, green                                                                                                                                                  |
| --- | -------------------------------- | --------------------------------------------------------- | ------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | `check:catches` vs `fa41711e7`   | `src/runtime/exec/execTeamRecovery.ts` at `fa41711e7^`    | exit 1, `execTeamRecovery.ts:593: new GENERIC catch site`; runtime GENERIC 168 → 169 | exit 0, hash same                                                                                                                                                |
| 2   | `check:mhp` vs `9e25295f5`       | `src/shared/hostApi/mhp-v1.1.schema.json` at `9e25295f5^` | exit 1, `MHP_SCHEMA_DRIFT: …/mhp-v1.1.schema.json`                                   | exit 0, hash same                                                                                                                                                |
| 3   | the VSIX package vs `c96b77367`  | `.vscodeignore` at `c96b77367^` (no `uiTextDesktop` line) | exit 1, `Required production bundles excluded from VSIX: dist/uiTextDesktop.js`      | exit 1 first: 4,952,332 bytes with the suite's leftover `dist/webview/node` packed (§3); exit 0 at 4,656,546 bytes once that test output was removed (hash same) |
| 4   | `packagedBundles` vs `2724cb25f` | the tree before the fix (the full run and the alone run)  | exit 1, `nodeContainer: ["dist/nodeDiagnostics.js", "dist/uiTextDesktop.js"]`        | exit 0, 37 of 37 with `nodeInstall`                                                                                                                              |

## 8. Not run, and open items

- **`vitest related`** as its own command (§5).
- **`npm run test:integration`** (merge 8 changed `test/integration/teamPanelAvailability.test.ts`): it downloads VS
  Code and needs a display; not run on this budget. The next lane with a display runs it.
- **`check:font-coverage`**: needs `hb-shape` (libharfbuzz-bin), absent here; desktop CI runs it.
- **`check:node-image`**: needs a built OCI tarball and receipt; no node image was built.
- **`check:editor-matrix`**: red on the base and here until the JetBrains and Eclipse hosts re-run at `mhp/1.5.1`
  (CC-INT9 §8).
- **`museStartFault.test.ts`** (RLF-SMALLFIX2): red on its own lane tip on Linux; the lane decides whether
  `museStartFailure` maps a start whose handshake write fails with `EPIPE` before the exit, or the suite waits for
  the exit first.
- **`o11y/crashHook.test.ts`** (RLF-M111OB): the owner-only node hook case red on its own lane tip on this rig.
- **The base's own reds on this rig** (§4: `createdRegistry*`, `connectorStorageGuard`, `runtimeLsp`,
  `runtimeMakerStop`, `teamProcessWorkers`, the three vault suites): not from this round, left with their files named.
- **The rig's `umask 0002`** turns every `mkdir`-made fixture folder group-writable; a suite that wants the
  product's owner-only answers on such a rig would need its own fixtures made `0700`. Named, not changed here.
- **The worktree's `node-pty` binding** had to be compiled with `npm rebuild node-pty`; a fresh install on this rig
  should be checked for the same.
- **A suite's leftover in `dist/`**: `test/unit/nodeBrowserWorkspace.test.mjs` builds the node page into
  `dist/webview/node` (`buildNodeWorkspace`'s default output, since `f6821a988`, 2026-10-06); `npm run build` does
  not clear it and `package-vsix.mjs` packs all of `dist/webview` but its named exclusions, so a VSIX packed after
  the unit suite carries 1.37 MB more webview text and fails its budget. Not from this round, and CI packs in a fresh
  job; the suite building into a temporary folder, or the packer excluding `node/`, is the open choice.
- **The base's `npm run build`** exited 1 on this rig (`temp/fix/base-build.log`); its output was complete enough
  to pack the base VSIX used for comparison in §3. Not chased.
- **Mac- and Windows-only cases** were not chased here (brief). The darwin-arm64 VSIX is the MacBook's (§3).
- **Real-life run** through the packed product: not this round's (no Muse request allowed).

## 9. Commits

| Commit      | Subject                                                                                                                                         |
| ----------- | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| `2724cb25f` | fix(int): the container image and the installed node lay out dist/nodeDiagnostics.js and dist/uiTextDesktop.js, which the node bundles now load |
| this record | docs(int): CC-INT10's record                                                                                                                    |

The MacBook run's merges and `fix(int):` commits are §1 and §2. Nothing was pushed. Highest decision number used:
**D252** (no new decision this round; D252 is CC-INT9's).
