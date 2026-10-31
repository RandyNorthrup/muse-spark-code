# CC-INT6 — merge round 6 on int/recovery: twelve lanes (2026-10-30)

Claude Code lane `CC-INT6`, worktree `/Users/user/lanes/CC-INT6`, branch
`cc/int6`, on the test rig `MacBookPro.ivettnet` (macOS, Darwin 24.6.0, Intel
x86_64, Node 24.21.0, npm 11.19.0). Base: int/recovery `0a5ebd718` (CC-INT5's
round, `docs/certification/cc-int5.md`, whose known failures and CC-INT4's,
CC-INT3's, CC-INT2's and CC-INT1's are not counted against a merge here).
Model attempts: **0**. Provider calls: **0**. Muse requests: **0** (the brief
names no real use; no real conversation, no nested ACP or CLI session; the
allowance rule of the brief held throughout). Nothing was pushed, rebased,
stashed or tagged. The vault and real credential-store suites (`keyringParts`,
`keystoreOwner`, `credentialLease`, `providerHeadersStore`, `test/unit/vault/**`,
`deviceOwnerVaultUses`, `deviceOwnerBind`, `devicePairKeyDpapi`) were never run on
this MacBook, no browser or GUI app was started (`CHROME_PATH` is `/usr/bin/false`
on the rig; the five suites that launch a browser were excluded by name, §5), and
no command that reads the login Keychain was run. Scratch files lived in the
worktree's ignored `temp/` (a copy of the base, two Python venvs, logs, shard
results) and in `$TMPDIR` (one extracted copy of `rlm103`'s tip).

One slip to disclose: during merge 6 a `git add -A -- .` was typed. The brief
forbids `git add -A`; the staged set was listed before the commit and was exactly
the files the merge touched (nothing from `temp/`, which is ignored), and every
later commit used explicit paths.

## 1. The merges

Fetched with `git fetch ~/gates/muse.git "refs/heads/lanes/<name>:refs/remotes/<name>"`
and merged with `git merge --no-ff`, in the brief's order, each lane's
certification record read first. "Files" is the merge commit's own combined diff
(`git diff-tree --cc`): the files that differ from both parents, that is, the
conflicts and the interaction edits kept inside the merge commit.

| #   | Branch (tip)                            | Built on    | Commits | Merge commit | Files | What the merge needed                                                                                                                                                                                                    |
| --- | --------------------------------------- | ----------- | ------- | ------------ | ----- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 1   | `lanes/rlf-sast-reviewed` (`149bf1710`) | `b781451b9` | 4       | `48ecd584a`  | 1     | `PLAN.md` (both status blocks kept). The six blocking SAST findings are accepted as reasoned `nosemgrep` suppressions with PLAN §8 rows; the GCM decrypt now requires the full tag length.                               |
| 2   | `lanes/rlf-updeps` (`391a780cc`)        | `b781451b9` | 18      | `46043f6b9`  | 3     | `package.json`, `package-lock.json` (regenerated from the merged `package.json`, stable under `npm install --package-lock-only --ignore-scripts`), `CHANGELOG.md`. ink 8.0.0, `@codemirror/merge` 6.12.3, keyring 2.1.2. |
| 3   | `lanes/rlf-playbook` (`0f7795e5c`)      | `b781451b9` | 4       | `ae4fa4cf9`  | 0     | Clean.                                                                                                                                                                                                                   |
| 4   | `lanes/rlf-harvest` (`0eaf17293`)       | `b781451b9` | 3       | `e785e3ea4`  | 3     | `CHANGELOG.md`, `src/shared/constants.ts`, `museCodeLatest.test.ts` (a duplicate import, fixed in `d1cd9de41`).                                                                                                          |
| 5   | `lanes/rlf-recording` (`3249a95dc`)     | `397aca3dd` | 5       | `89e1469c1`  | 38    | The 14 tables, the generated reference files, `scripts/build.mjs`, `check-bundle-size.mjs`, `check-host-globals.mjs`, `deferredBundles.mjs`, `src/extension.ts`, `previewPanel.ts`, `screenRecordEntry.ts`, CI.          |
| 6   | `lanes/rlm103` (`8864b7635`)            | `0cab9f323` | 202     | `1486ecb05`  | 137   | The maker stack beside int's RLF-DEVICES one (§2.1). Five budget interactions, the spawn inventory, the `panel` word, the VSIX archive.                                                                                  |
| 7   | `lanes/rlf-maclive` (`b6739143e`)       | `d057bf203` | 6 (4)   | `0633e654c`  | 0     | Recorded with `-s ours` (its two lineage merges are int's own re-lands); its four own commits applied on top as one three-way patch (`f378b4430`).                                                                       |
| 8   | `lanes/rlf-m110os2` (`15df6deba`)       | `5ae946464` | 25      | `3e2429ccd`  | 9     | The lane cherry-picked RLF-M110OS's commits onto 0.19.0, so 40 files conflicted with int's own copies; int's later work was kept over the older copies, the OS2 work kept (§2.3).                                        |
| 9   | `lanes/rlf-musesetup` (`0bf06006e`)     | `15df6deba` | 11      | `29ab474a0`  | 36    | Its D227 collides with int's D227: int keeps D227, the lane's decision is **D229** (§2.4). The 14 tables, CHANGELOG, PLAN statuses.                                                                                      |
| 10  | `lanes/rlf-nodeserve` (`79aee4ca8`)     | `5ae946464` | 271 (3) | `1987745cd`  | 0     | Recorded with `-s ours` (the whole original rec/rlm104 lineage, 266 commits and 917 files, lies beneath its own three); the three commits applied on top (`0bf9c7bcf`, §2.5).                                            |
| 11  | `lanes/rlf-m108` (`79f774baf`)          | `583c1a9f4` | 17 (16) | `19d43940a`  | 0     | Recorded with `-s ours` (a plain merge conflicts in 37 files, all of them the original RLM108 lineage int carries); the lane's sixteen commits applied on top (`ae8bda858`, §2.6).                                       |
| 12  | `lanes/rlf-m104d` (`af519a959`)         | `bae1f9e9f` | 10      | `30bb80e95`  | 38    | Twelve files conflicted (§2.7): the chat mount, the runtime English region, the portable graph, the MHP lock.                                                                                                            |

Each merge interaction that is not a conflict resolution is its own `fix(int):`
commit naming the merge (§9). Several interactions of merges 6, 8, 9 and 12 are
inside their merge commits instead, and each merge commit's message lists them.

Decision numbers (`### D<n>` added by a lane, against `PLAN.md` and
`docs/plan-archive/decisions.md`): the round adds one heading, **D229** (Meta's
Muse Code CLI installs at setup, never in our images), the lane's D227. Int keeps
D227 (teams stay off until a second model is set up, CC-INT5). Its heading says
"numbered D227 on its branch until the int/recovery join of 2026-10-30", and every
reference the lane added (PLAN, its record, code comments, tests, `os/check.py`, the
add-on check) now says D229. No other lane adds a heading. rlf-nodeserve's "D212"
(the brief's collision note) is the old rec/rlm104 lineage's number for what int
already holds as D226; its own three commits add no decision and mention no D212, so
nothing needed renumbering. D230 to D239 are free for the next rounds.

## 2. What each merge needed

### 2.1 `lanes/rlm103` (M103: makers, serial, machines, the maker panel and previews)

The one large merge (202 commits, 137 files in its own combined diff). Int already
holds a maker stack of its own (RLF-DEVICES: the exact-payload surface), so two
maker stacks coexist after this merge; the record `docs/certification/rlm103.md` and
its `m103-*.md` parts are kept as the lane wrote them.

- **Names that collided, resolved for int.** The lane's ACP maker module is
  `src/acp/makerTools.ts`; int's `src/acp/maker.ts` keeps its name and its
  `deps.maker`. The lane's agent deps and session members are `makerTools`; its
  approval test is `makerToolApproval.test.ts`. `runtimeFor(options, log, questions,
accounts, unsavedFiles, maker)` in `src/runtime/main.ts` takes int's maker surface as
  its last argument. Five lane files that import `vscode` moved under
  `src/host/vscode/` (`check:host-api`).
- **Budgets (D6), none raised.** The lane had raised `dist/modelApi.js` to 530 KiB
  and `dist/reportingPanel.js` to 52 KiB; both are back at 525 and 50.
  `modelApi.js` fits by moving the shell reader and the command rules into a new
  sibling, `dist/modelApiShell.js` (`modelApiShellEntry.ts`, the way `modelApiAcp`
  is split; the split gate's `MODEL_API_SHELL_ONLY` keeps them out of the parent):
  measured **10.7 KiB**, +15% is 12.3, so the new budget is **25 KiB**. The report
  panel reads the four settings it needs instead of all of them. `dist/wire.js` shares
  one optional-boolean schema (and, after merge 11, one string schema). `dist/uiText.js`
  carries each region's key list inside its packed payload and the maker words ride
  the runtime region: **119.4 KiB of 125** (the base was 125.3, over).
- **Catch baseline** lowered by the lane's narrowed sites (nothing rose). One clone
  between two test helpers was factored into `test/unit/helpers/loopbackPort.ts`.
- **`src/core/maker/serial/windowsHelper.ts`** imports `compileJob` from `jobBuild` and
  `removeStaleJobs`/`jobFileName`/`JobBuild` from `staleJobs` (int's split of the same
  module).
- **VSIX (`424b3372c`).** The lane (and rlf-recording) listed `dist/webview/usage`,
  `whatsNew` and `makerPreview` as loose `!` entries in `.vscodeignore`; on int every
  `dist/webview` file ships inside `dist/webview.json.br` (VSIXWEB), so those six
  lines excluded the chunks the packaged-bundles check requires and
  `package-vsix` refused. The lines are removed, and `makerPreviewPanel.ts` takes its
  bundle directory from `resolveWebviewBundleDir` like the other panels, with the same
  fixed-sentence page when the archive cannot be verified.
- **Process starts (`18cab8fc3`).** `pathGuardSpawns` and `windowsPowerShellModules`
  failed on the merged tree: the lane's starts are not in int's inventory. The serial
  helpers now get `workspaceChildEnvironment` in `nativeSerial.ts` (the run workspace
  and relative entries leave PATH, so the bare `python3` resolves outside the
  workspace); the Pi probes, `perl`, `findmnt`, `pkcheck` and the two Windows
  PowerShell 5.1 starts (an env of nothing, or of `PSModulePath` alone) are reviewed
  into the records with anchors that must stay; the runtime's `runProgram` callers are
  listed as guarded.
- **The word `panel` (`3382fb0f5`).** The lane's companion page was `panel`; int's
  M104 lane B already holds `panel --stdio` (D84). `runtimeMakerTransport` failed
  (`parses "panel"`) and `panel` help read the maker's usage line. Int's word stays;
  the maker's page is `machines panel` (same action, flags and presence rules), its
  reference rows, usage line and README follow, the lane's three suites use the new
  spelling.
- **The static Stop shell (`d5376e9e4`, `33099cfb3`).** The merge had shortened the label's
  escape in `html.ts` to numeric references (`&#60;`) to save bytes; rlm103's `html.test`
  asserts the named entities. Three chained `replaceAll` calls satisfied it but are the form
  semgrep's `detect-replaceall-sanitization` blocks (the finding the lane's own "clear the SAST
  findings" commit removed); the lane's regex-plus-lookup form is back, byte for byte, and no
  budget moved (`extension.js` 531.9 KiB, `reportingPanel.js` 44.7).
- **Browser rules (`6ccc3e199`).** The lane made loopback reachable from the browser check only
  through an exact dev origin in the user-level `browserCheckExtraHosts` (README, "Where a page
  may go"), which replaces the loopback-by-default rule of PLAN D49. `browserCheckNoCaps` placed
  `http://localhost:3000/` with no configured hosts and now names that origin (its subject is the
  removed 8-action cap). `browserUiText` now installs the maker surface's English the way
  `installMakerTable` does before it reads its keys, like the vault group beside it. Both fail
  identically on rlm103's own tip. Open item 4 (§8).
- **Two merged tests (`f1050c484`).** `arduinoBuild` stages a fixture VSIX whose file
  list predates int's required lazy Devices runtime (`dist/devices.js` added);
  `nodeWorkspaceBuild` pinned `@codemirror/merge@6.12.2` where rlf-updeps ships 6.12.3.
- **Not wired, on the lane's own tip as well as here.** Nothing in `src/extension.ts`
  creates the VS Code maker host, its commands or `createMakerPreviewPanel`
  (`src/host/maker/makerEntry.ts` has no caller beyond the lazy registry); the lane's
  `extension.ts` has the same single `createHardwareContexts` import. Open item 3 (§8).

### 2.2 `lanes/rlf-sast-reviewed`, `lanes/rlf-updeps`, `lanes/rlf-playbook`, `lanes/rlf-harvest`, `lanes/rlf-recording`

Merges 1 to 5 were small. Only the status blocks of `PLAN.md` (1), the dependency
files (2) and the `CHANGELOG` (2, 4, 5) conflicted besides what the table lists. The
lockfile is regenerated from the merged `package.json`, never hand-merged: ink 8.0.0 and
`@codemirror/merge` 6.12.3 (devDependencies), keyring 2.1.2 (dependencies). rlf-updeps' typescript-eslint 8.72.0 also flags `verbatim` in the egress proxy's `lookup`
(deprecated for `order: 'verbatim'`, same resolution, the package needs Node 22): `npm run lint`
was green on the base and red on the merged tree for that one line (`0a051b448`). Merge 4
duplicated an import in `museCodeLatest.test.ts` (`d1cd9de41`). Merge 5's conflicts were
the 14 tables (kept in the English key order), the generated reference, host-API and lazy
registry files (regenerated, never hand-merged), `deferredBundles.mjs` (both stanzas),
`check-bundle-size.mjs`, `check-host-globals.mjs`, `extension.ts`, `previewPanel.ts`,
`screenRecordEntry.ts`; its unused `DICTATION_QUIT_GRACE_MS` import in `macos.ts` blocked
the hook and was removed.

### 2.3 `lanes/rlf-m110os2` (the second OS-image pass)

The lane cherry-picked RLF-M110OS's fifteen commits onto 0.19.0, so most of its 120
files are int's own already (40 conflicts, 30 files differ). The lane's OS2 work is
kept (the builder container and pipeline, the ext4 hash seed, chunked repro hashing, the
boot driver's q35 shape and acceleration receipts, the IPv6 neighbour-discovery firewall
rule, the OS records); int's later work is kept over the cherry-picks' older copies (the
Windows junction links in the node OS suites, the MSYS-safe gpg keyring read,
`armHttpServerShutdown`, the vendored licences, the node workspace stylesheet name, the
desktop English group). ROADMAP, host-api and the lazy registry are regenerated.

### 2.4 `lanes/rlf-musesetup` (D229)

The lane's D227 is int's D227 (teams, CC-INT5): int keeps it, the lane's decision is D229
(§1). Conflicts were positional (the English table and its 14 translations, CHANGELOG,
PLAN statuses). `dist/nodeSetup.js` is new (**142.4 KiB** measured; budget 175 KiB, the
measurement +15% rounded up to 25 KiB steps) and `dist/node.js` holds its 75 KiB cap
(70.8). The setup step runs Meta's installer with `bash` and then asks the installed CLI
for `--version`; both now go through the guarded launcher (`18cab8fc3`, above) with the
no-workspace child environment, since the first boot has no workspace.

### 2.5 `lanes/rlf-nodeserve` (Muse Node `serve`)

Applied as a three-way patch after `-s ours` (`0bf9c7bcf`). Interactions:

- The lane's rename of `src/webview/bridges/nodeSurface.ts` and its `NODE_WORKSPACE_STYLE`
  constant are dropped: int's m110os2 merge already spells the stylesheet
  `NODE_WORKSPACE_STYLESHEET`.
- Int's certificate issuance is a governed launch, so `serve` configures the process
  governor when none is configured (`runNodeServe` in `src/runtime/node/serveEntry.ts`;
  `hasResourceAdmission()` reads it, `NODE_RESOURCES_DIRECTORY` names its machine
  folder). The in-process serve suite runs under the real governor (`useRuntimeGovernor`,
  which on macOS needs the darwin helper app built by `native/darwin/build.sh`); the
  mini-dist case that started a standalone serve was removed (it cannot carry the
  governor's bundles and native helper). Wiring the governor in `cliMain` instead took
  `dist/node.js` to 88.9 KiB, so it lives in the new entry: `dist/nodeServe.js`
  **77.6 KiB** (budget 100 KiB by D6).
- `dist/nodeAuth.js` moves out of the separate A1 build into the main build with the 500
  KiB cap it had (470.0 KiB); `dist/packsVerify.js` keeps int's 250 KiB cap.
- The deploy lists (`deploy/install/layout.sh`, `deploy/container/policy.json`,
  `test/unit/nodeInstall.test.mjs`) gain the six bundles the node bundles require beside
  themselves under int's admission: resourceAdmission, resourceGovernor, resourceJournal,
  resourceProcess, execGuard, vaultBoundaries.
- `serveEntry.ts` is a knip entry (`1f04fd2ed`).
- `packagedBundles` ("lays every file the node bundles load") found `dist/resourceGovernorWindows.js`
  missing from the container policy and the install layout: the governor loads it by name, and
  the six bundles added in `0bf9c7bcf` stopped one short (`295a42ac4`).

RVNET's review of this lane (`docs/certification/rvnet.md` on `lanes/net`, "What remains")
found nothing to fix and left, for Node `serve`: a body over 2 MiB, an absolute-form
request line, a duplicate Host, a WebSocket that is allowed and then silent, a listen
address of `::1`, and the modes of the data tree beyond the TLS key. Section 6 says which
of those this round exercised.

### 2.6 `lanes/rlf-m108` (account placement on devices; developer options and local profiles)

Applied as a three-way patch after `-s ours` (`ae8bda858`). The lane adds no decision of
its own (its D106 is the old lineage's, int's D216). Interactions:

- The window's developer owner and its pure rendering are reached through the lazy
  accounts bundle (`dist/runtimeAccounts.js`, `accountsEntry.ts`, `accountsBundle.ts`)
  instead of static imports, so `dist/extension.js` carries none of the accounts, team or
  backend modules the split gate keeps out of activation.
- `DEVELOPER_COMMAND_ID` and `COMMAND_IDS.developerOptions` share one literal
  (`DEVELOPER_OPTIONS_COMMAND`): reading the id through `COMMAND_IDS` pulled the whole
  command table into the vault, questions, node and panel bundles (+2.6 KiB each, five
  over budget). `protocol.ts` shares its string schema (56 inline copies) so
  `dist/wire.js` holds its 75 KiB cap with the lane's three developer messages.
- The Developer options page gets its own webview budget group (**7.1 KiB**, 25 KiB by
  D6), out of the deferred aggregate (46.3 of 50 KiB); its webview metafile is exempt from
  the Node bundles' mini-parser rule like the other page entries.
- `placement.ts`'s pin check catches only the unreadable-providers-file condition (a bare
  catch would have raised the GENERIC count); one churned identity in the catch baseline,
  counts unchanged.
- Test follow-ups: the lane's suites repeated vault, scratch folder, profile rig and pool
  wiring (19 clones in `npm run duplication`): they share `test/unit/helpers/{accountFixtures,
accountPoolBase,developerFixtures,memoryVault,scratchFolders,loopbackPort}.ts` and
  `test/e2e/driverArgs.ts` (its own import-free module: the drivers are bundled alone)
  (`1f04fd2ed`). Vitest does not typecheck, so two lane suites merged with errors only tsc saw
  (rlf-maclive's journal rig returned plain numbers where int's usage journal takes branded
  epoch times; the developer-options suite built the account services without the log int
  now requires): `dbabb62ce`.

### 2.7 `lanes/rlf-m104d` (M104 lane D: the portable webview)

Twelve files conflicted. Resolved for current int:

- `chat.tsx` is the lane's extraction of the chat mount with int's later additions carried
  into it (the `PANEL_RELOAD_EVENT` flush; the maker listener stays in VS Code's `main.tsx`,
  which passes the bridge); chat takes a `HostBridge<WebviewToHostMessage>` so VS Code's
  wider bridge still fits.
- The runtime English region takes both the lane's words (host service, language server,
  CLI reference and help) and the maker words; its key lists stay inside the packed payload.
- `build.mjs` keeps the portable graph beside makerPreview and int's serve and auth
  metafiles; the split gate exempts the portable metafile like the other page graphs; knip,
  `acpBundles` and the PLAN status keep both sides.
- `makerPreviewConstants`' rotation step is the literal `Math.PI/12` (0.2617993877991494): a
  computed export is a statement every bundle importing `constants.ts` keeps (18 B each).
- The MHP v1.1 panel lock is re-frozen on the merged tree (`85f8fd4e…` to `abeeefae…`): the
  snapshot gains the developer request, reply and open messages (rlf-m108),
  `surfaceFocused`'s focused flag (rlm103), the theme frame (this lane) and `moveTeamTask` and
  `reportFailed`, which int carried but its snapshot had not recorded. `check:mhp` is green.
- **VSIX (`a04283dda`).** The lane builds a second webview graph under
  `dist/webview/portable/` (about 2 MB of text). `package-vsix` packs the whole
  `dist/webview` tree into `dist/webview.json.br`, whose decoded size is bounded at
  4,000,000 bytes (`WEBVIEW_ARCHIVE_MAX_BYTES`), so the merged archive passed the bound and
  the stage crashed (`ERR_BUFFER_TOO_LARGE`). VS Code never serves the portable graph (the
  lane's allowlist never named it; only the ACP package ships it): the archive now excludes
  `portable/` as it already excludes sourcemaps and the voice companion.
- **`8593477c4`.** `estimatorPricePackaging` reads the literal `outfile` declarations of
  `build.mjs`; the portable loader's was a template string over `PORTABLE_OUTDIR`, which
  that reader cannot resolve. The same path has a constant of its own.

## 3. Proof on the final tree

Every command run directly in the worktree, `PATH` carrying a Python venv under `temp/` (zopfli
0.4.3 for the VSIX, semgrep 1.180.0 for the SAST gate; `SSL_CERT_FILE=/etc/ssl/cert.pem`,
`SEMGREP_ENABLE_VERSION_CHECK=0`). The final tree is `33099cfb3` plus this record and the
PLAN status paragraphs (docs only; `format:check`, `check:plan` and `check:roadmap` were run
again over them, §9).

| Command                                                                                                              | Exit      | Result                                                                                                                                                                                                                                                                                                                                           |
| -------------------------------------------------------------------------------------------------------------------- | --------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `npm run format:check`                                                                                               | 0         |                                                                                                                                                                                                                                                                                                                                                  |
| `npm run typecheck`                                                                                                  | 0         |                                                                                                                                                                                                                                                                                                                                                  |
| `npm run lint`                                                                                                       | 0         | `lint:ps` skipped: PSScriptAnalyzer runs on Windows only. (Red once on the merged tree: the egress `verbatim` line, §2.2; green after `0a051b448`.)                                                                                                                                                                                              |
| `npm run check:badges` / `check:tokens` / `check:l10n`                                                               | 0 / 0 / 0 | The 14 tables in the English key order.                                                                                                                                                                                                                                                                                                          |
| `npm run check:reference` / `check:host-api` / `check:mhp`                                                           | 0 / 0 / 0 | host-api: 404 VS Code APIs, 62 files importing vscode (regenerated twice during the round, `83dd1325c`); mhp: the v1.1 lock `abeeefae…`.                                                                                                                                                                                                         |
| `npm run check:plan` / `check:roadmap`                                                                               | 0 / 0     | 244 milestones, 0 drift; `ROADMAP.md` current.                                                                                                                                                                                                                                                                                                   |
| `npm run check:catches`                                                                                              | 0         | "All catch sites and counts match the baseline": no SWALLOW, GENERIC or CLEANUP count rose.                                                                                                                                                                                                                                                      |
| `check:usable-reply`, `check:wrap-up-request`, `check:no-output-cap`, `check:no-round-cap`, `check:workflow-scripts` | 0 each    |                                                                                                                                                                                                                                                                                                                                                  |
| `npm run deadcode` / `cycles` / `duplication`                                                                        | 0 / 0 / 0 | duplication: **0 clones** (19 on the merged tree before `1f04fd2ed`).                                                                                                                                                                                                                                                                            |
| `npm run security:audit`                                                                                             | 0         | 3 advisories (moderate: glob, minimatch, qs), 0 exceptions (CC-INT5: 7).                                                                                                                                                                                                                                                                         |
| `npm run security:sast` (semgrep 1.180.0)                                                                            | 0         | 694 rules, 5,671 files, **0 findings** (CC-INT5: the same 6 blocking findings as CC-INT1 to CC-INT4; rlf-sast-reviewed's suppressions and GCM fix clear them). One run found 3 in `html.ts` (§2.1); fixed. Semgrep times out on `ModelApiHost.ts` for a few rules (3 in a single-file scan, on the merged tree and on the untouched base alike). |
| `npm run build`                                                                                                      | **1**     | The size gate, the first step after the production build, reports only **`teamRunners.js` 78.7 KiB (75), `teamHost.js` 140.2 KiB (130), `teamScheduler.js` 76.5 KiB (75)**: the base's, never raised. Open decision 1.                                                                                                                           |
| The steps `npm run build` does not reach, each on its own                                                            | 0 each    | `check-tokens`, `build.mjs --production`, `check-bundle-split` (green), `gen-lazy-registry --check` (198 bundles, current), `check-host-globals`, `third-party-notices`, `check-legal-build-records`.                                                                                                                                            |
| `node scripts/package-vsix.mjs --target win32-x64`                                                                   | 0         | **`VSIX: 4487474 bytes (budget 4915200)`**: 427,726 under (CC-INT5: 4,362,815); 154 packaged bundles match the baseline. Red before `a04283dda` (§2.7).                                                                                                                                                                                          |
| `npm run package:acp -- --target win32-x64`                                                                          | 0         | 5.3 MB packed, 10.0 MB unpacked, 679 files; 149 of 149 packaged-bundle checks pass.                                                                                                                                                                                                                                                              |

Bundles this round adds or moves (D6; none of the existing budgets was raised):

| Bundle                                 | KiB now | Budget (KiB) | How the budget was set                                                                                                                            |
| -------------------------------------- | ------- | ------------ | ------------------------------------------------------------------------------------------------------------------------------------------------- |
| `dist/modelApiShell.js` (new)          | 10.6    | 25           | measured 10.7 (10.6 now) + 15% = 12.3, rounded up to the next 25 KiB                                                                              |
| `dist/modelApi.js`                     | 521.1   | 525          | existing; the lane's 530 put back                                                                                                                 |
| `dist/reportingPanel.js`               | 44.7    | 50           | existing; the lane's 52 put back                                                                                                                  |
| `dist/uiText.js`                       | 115.0   | 125          | existing; 125.3 over on the base, fits now (key lists packed in the payload, maker words in the runtime region)                                   |
| `dist/wire.js`                         | 74.6    | 75           | existing; shared optional-boolean and string schemas                                                                                              |
| `dist/nodeSetup.js` (new)              | 142.7   | 175          | measured 142.4 at merge 9 (142.7 with the guarded launcher) + 15% = 163.8, rounded up to 175                                                      |
| `dist/nodeServe.js` (new)              | 77.6    | 100          | measured 77.6 + 15% = 89.2, rounded up to 100                                                                                                     |
| `dist/node.js`                         | 73.0    | 75           | existing                                                                                                                                          |
| `dist/nodeAuth.js`                     | 470.0   | 500          | existing, the cap it had in the separate A1 build                                                                                                 |
| `dist/runtimeAccounts.js`              | 171.3   | 300          | existing                                                                                                                                          |
| webview: Developer options (new group) | 7.1     | 25           | measured 7.1 + 15% = 8.2, rounded up to 25; out of the deferred JS aggregate (46.3 of 50)                                                         |
| `dist/teamRunners.js` (base: over)     | 78.7    | 75           | **was 78.4 on the base**: +209 B, all of it the account placement schemas (`hostApi/accounts.ts` +149, `accountsPanel.ts` +32, `accounts.ts` +28) |

## 4. Each merged lane's own suites, final tree, repository timeouts

Every test file the twelve lanes add or change (303 files by `git diff --diff-filter=AM` from the lane's
merge base, lineage files included) ran in the related shards (§5) or in the targeted runs below,
`npx vitest run <files> --maxWorkers=3`, at most three files each, no `--testTimeout`. After the
fixes of §2 these pass; the exceptions are named.

| Lane                | Test files | Passed on the final tree | Not passed                                                                                                                                                          |
| ------------------- | ---------- | ------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `rlf-sast-reviewed` | 1          | 1                        |                                                                                                                                                                     |
| `rlf-updeps`        | 0          |                          | (no test file; its pins are in `nodeWorkspaceBuild`, fixed)                                                                                                         |
| `rlf-playbook`      | 2          | 2                        |                                                                                                                                                                     |
| `rlf-harvest`       | 1          | 1                        |                                                                                                                                                                     |
| `rlf-recording`     | 8          | 8                        |                                                                                                                                                                     |
| `rlm103`            | 52         | 48                       | `makerLease` (1), `makerSerial` (2), `runtimeMakerStop` (1): fail identically on rlm103's own tip on this rig (§5); `makerReviewBrowser` not run (starts a browser) |
| `rlf-maclive`       | 14         | 14                       |                                                                                                                                                                     |
| `rlf-m110os2`       | 11         | 11                       |                                                                                                                                                                     |
| `rlf-musesetup`     | 10         | 10                       |                                                                                                                                                                     |
| `rlf-nodeserve`     | 59         | 52                       | 7 under `test/unit/vault/**`: not run on this MacBook (rule)                                                                                                        |
| `rlf-m108`          | 32         | 31                       | `providerSpend` (1): fails identically on the base                                                                                                                  |
| `rlf-m104d`         | 113        | 108                      | `nodeDashboardPage` (5), `nodeTerminalPage` (6): fail identically on the base; `devicePairKeyDpapi` (rule) and `nodeBrowserWorkspace` (browser) not run             |

`judgeP2Delivery` (in rlf-m104d's list by lineage) ran alone: 103 tests, 101 passed, 2 failed, **5,340 s**
(it runs several hundred real gate runs while the file is collected, ten seconds each here, and a
real `vsce ls` per allowlist case, each of those about four minutes with this worktree's 59,000
scratch files; it cannot finish inside the 10-minute command limit, so it ran as a background command with a
90-minute bound, watched until it ended). The two failures, `fires the new size and host-global
guards without changing caps` (line 461) and `leaves every restored artifact green` (line 491),
assert that `check-bundle-size` exits 0 on the restored artifacts, and the size gate exits 1 on the
untouched base for the same three team bundles (base run: `temp/base`, exit 1). Class: base.
The base itself was not re-run through the 90 minutes.

## 5. `npx vitest related` over the round's changed sources, and the base

The 327 `src/` and `scripts/` files changed since `0a5ebd718` (every added or modified file there but
the data and document files; without `src/shared/constants.ts`, `src/shared/l10n/en.ts` and `src/extension.ts`, whose `related`
closure is the whole battery; the l10n, reference, catch and build gates stand for them). Excluded by
the MacBook rule: `keyringParts`, `keystoreOwner`, `credentialLease`, `providerHeadersStore`,
`test/unit/vault/**`, `deviceOwnerVaultUses`, `deviceOwnerBind*`, `devicePairKeyDpapi`; also
`runtimeLsp` (CC-INT1 §5 row 11) and the five suites that start a browser
(`devicesPhase2Harness`, `teamModelsFirstPaint`, `feedbackBrowser`, `makerReviewBrowser`,
`nodeBrowserWorkspace`; the rig sets `CHROME_PATH=/usr/bin/false`). `judgeP2Delivery` has its own
run (§4).

`npx vitest related … --run --maxWorkers=3` took one command per shard because a single run
outlasts the 10-minute command limit: `--shard i/12` for 1 to 9, 11 and 12, and `--shard 19/24` and
`20/24` for the tenth twelfth (the two halves of `10/12`, which ran past two background limits
because of `judgeP2Delivery`, §4, until it was excluded from the shards). Together: **1,376 files
(1,347 passed, 29 failed), 30,758 tests (30,375 passed, 48 failed, 332 skipped)**, the repository's own
timeouts. The sharded results of the earlier shards predate the fixes of §2, so every failing
file was then run alone here and, where it exists there, on an extracted copy of the untouched base
(`git archive 0a5ebd718` under `temp/base`, `node_modules` linked, the darwin helper builds copied in,
built with `node scripts/build.mjs --production`, same `TMPDIR`):

| #   | Files (tests in the related run)                                                                                                                            | Merged tree alone                       | Untouched base alone | Class                                                                                                                                                      |
| --- | ----------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------- | -------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | `pathGuardSpawns` (2), `windowsPowerShellModules` (1), `runtimeMakerTransport` (1: `parses "panel"`), first shard                                           | passed after `18cab8fc3`, `3382fb0f5`   | passed               | **Merge interaction, fixed** (§2.1)                                                                                                                        |
| 2   | `arduinoBuild` (suite), `nodeWorkspaceBuild` (1)                                                                                                            | passed after `f1050c484`                | passed               | **Merge interaction, fixed** (§2.1)                                                                                                                        |
| 3   | `browserCheckNoCaps` (1), `browserUiText` (1), `html` (1)                                                                                                   | passed after `6ccc3e199`, `33099cfb3`   | passed               | **Merge interaction, fixed** (§2.1); the first two fail identically on rlm103's tip                                                                        |
| 4   | `estimatorPricePackaging` (suite)                                                                                                                           | passed after `8593477c4`                | passed               | **Merge interaction, fixed** (§2.7)                                                                                                                        |
| 5   | `packagedBundles` (1: node bundles in the container and install lists)                                                                                      | passed after `295a42ac4` (alone, 125 s) | passed               | **Merge interaction, fixed** (§2.5)                                                                                                                        |
| 6   | `estimatorHistorySources` (1), `scheduleFireFailures` (5), `judgeLocalDarwin` (1)                                                                           | pass                                    | pass                 | Load: failed in the 3-worker run, pass alone on both                                                                                                       |
| 7   | `runtimeMakerStop` (1), `makerSerial` (2), `makerLease` (1)                                                                                                 | the same 4                              | not on the base      | Lane's own on this rig: fail identically on `refs/remotes/rlm103`'s tip, extracted under `$TMPDIR` (the lane was verified on Windows 11). Cause UNMEASURED |
| 8   | `teamEnginePorts` (5), `teamLandingKilled` (1), `teamPlaybookIntegration` (1), `teamLandingPause` (1), `teamWorkerCreateBundle` (1), `playbookGovernor` (1) | the same 10                             | the same 10          | Base. Causes UNMEASURED beyond that                                                                                                                        |
| 9   | `nodeDashboardPage` (5), `nodeTerminalPage` (6), `playbookSchedulesInputs` (1), `resourceStatusCpu` (1), `providerSpend` (1), `vsixCompression` (2)         | the same 16                             | the same 16          | Base                                                                                                                                                       |
| 10  | `judgeLocalDarwinPid` e2e (1), `judgeLocalDarwinDeadline` (1), `acpServeHandshake` (1), `connectorStorageGuard` (3)                                         | the same 6                              | the same 6           | Base                                                                                                                                                       |

Rows 8 to 10 are 16 files with the same failing-test counts alone on both trees. No file that passes
on the base fails on the merged tree after the fixes; the 4 lane-own failures have no base to pass on.

## 6. Real use through the built product

No Muse request, no model attempt, no paid provider call, no real conversation and no nested
ACP or CLI session were made. The built product was used for what needs none:

- **The packages.** The win32-x64 VSIX and the ACP package built from the merged tree (§3), the
  latter with its 149 packaged-bundle checks.
- **Muse Node `serve`, live, twice.** `node dist/node.js` from the production build, a scratch data root
  under `temp/`, once on `127.0.0.1:7463` and once on `[::1]:7464`; `init` (exit 0), `serve`
  (stays up and prints the fingerprint; the leaf a TLS client receives on the port hashes to it), then raw TLS requests with the listener's Host, Origin and fetch-metadata rules, then
  `stop` (exit 0, `serve` exits 0, the port refuses). The product's own certificate issuance ran
  through the process governor `serveEntry.ts` configures (§2.5). On both listeners:

  | Request                                                                                                | Answer                                                                                                                          |
  | ------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------- |
  | `POST /node/dashboard/read`, no bearer / `Bearer not-a-real-token`                                     | `401 {"code":"unauthenticated"}` both                                                                                           |
  | the same with `Host: evil.example`                                                                     | `403 {"code":"forbidden"}`                                                                                                      |
  | the same with a body of 2 MiB + 1 byte, and of exactly 2 MiB                                           | `401 unauthenticated` both (authentication runs before the body is read; the cap on an authenticated request was not exercised) |
  | an absolute-form request line, `POST https://evil.example/node/dashboard/read` and the configured host | `404 {"code":"notFound"}` both: never routed                                                                                    |
  | two `Host` headers, the configured one first and last                                                  | `403 forbidden` both orders                                                                                                     |
  | a WebSocket upgrade to `/node/terminal/stream` with the configured origin, then silence                | `101 Switching Protocols`, closed by the server after about 5 s (the probe would have waited 45 s)                              |
  | the same upgrade with `Origin: https://evil.example`                                                   | no upgrade, connection closed                                                                                                   |
  | modes of the data tree (15 entries)                                                                    | files `0600`, folders `0700`; none group- or other-accessible                                                                   |

  These cover RVNET's "what remains" list for Node `serve` (`rvnet.md` on `lanes/net`) except two
  things: an authenticated request over the 2 MiB cap (it needs a passkey enrollment) and the
  waits the node record already names (the maker action, the operator control transport, a second
  PC joining). The first attempts failed for the driver's reasons, not the product's: a data root
  made with the default umask is refused by the private-files rule (`forbidden`); requests without
  `Sec-Fetch-Mode` and `Sec-Fetch-Dest` get the guard's 403; and a driver whose event loop is blocked
  leaves the `serve` child a zombie that `stop` then waits on for ever.

Not run, because each needs a Muse request, a person at the machine, a browser or another OS:
a real conversation through the packed VSIX or the ACP package (including the maker panel, the
Developer options page, the recording drivers and the portable page), `exec --team`, a live
`panel --stdio` with an editor host, `npm run ui:look` for the Developer options page and the
maker preview, `test:a11y`, the VS Code integration suites (Electron cannot start on a macOS lane),
and everything Windows-only: the CLR paths, the two PowerShell 5.1 starts the maker detection makes
with an empty or `PSModulePath`-only environment (§2.1), `lint:ps`, `deviceWorkerHostNative`. Hosted
CI's Windows and Linux legs must confirm the merged tree.

## 7. Red/green drills

Each drill hashes the file, breaks it on purpose, runs the gate or suite, restores it byte-exact
(hash checked) and reruns. `temp/drill.py` printed one JSON line each (kept in the worktree's
ignored `temp/`).

| #   | Guard                                                  | Break                                                                                                              | Red                                                                                           | Restored, green                                                                                                                            |
| --- | ------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------ |
| 1   | `pathGuardSpawns` anchors                              | `/usr/bin/pkcheck` renamed in `userPresence.ts` (a first try, `pkcheckX`, stayed green: the anchor is a substring) | exit 1, `every listed mechanism is still wired`                                               | exit 0                                                                                                                                     |
| 2   | `pathGuardSpawns` + `windowsPowerShellModules` anchors | `WINDOWS_PSMODULEPATH_SEGMENTS` renamed everywhere in `projectIoWindows.ts`                                        | exit 1 (both suites)                                                                          | exit 0                                                                                                                                     |
| 3   | `windowsPowerShellModules` reviewed entry              | `volumeLabel` renamed everywhere in `projectIo.ts`                                                                 | exit 1, `every file that names Windows PowerShell 5.1 applies the rule or is reviewed`        | exit 0                                                                                                                                     |
| 4   | the maker page word                                    | `isPanel = false` in `commandArgs.ts`                                                                              | exit 1, `runtime maker arguments parses "machines"`                                           | exit 0                                                                                                                                     |
| 5   | the VSIX archive's portable exclusion                  | ` \|\| file.startsWith('portable/')` removed in `package-vsix.mjs`                                                 | exit 1, `RangeError [ERR_BUFFER_TOO_LARGE]: Cannot create a Buffer larger than 4000000 bytes` | the drill's own second leg ran without the zopfli venv on `PATH` and failed there; the green is the separate final VSIX build, exit 0 (§3) |
| 6   | `dist/modelApiShell.js` budget                         | 25 to 1 KiB in `check-bundle-size.mjs`                                                                             | `OVER dist/modelApiShell.js: 10.6 KiB (budget 1 KiB)`                                         | line gone (the gate itself exits 1 either way: the base's team bundles)                                                                    |
| 7   | `dist/nodeServe.js` budget                             | 100 to 1 KiB                                                                                                       | `OVER dist/nodeServe.js` present                                                              | line gone                                                                                                                                  |
| 8   | the Developer options group                            | 25 to 1 KiB in `webviewBundles.mjs`                                                                                | `OVER dist/webview Developer options` present                                                 | line gone                                                                                                                                  |
| 9   | the `modelApiShell` split rule                         | `commandRules.ts` added to `dist/meta/modelApi.json`'s inputs                                                      | exit 1, `bundle split: 2 problem(s)`                                                          | exit 0                                                                                                                                     |
| 10  | the MHP v1.1 lock                                      | one digit of the frozen digest changed                                                                             | exit 1, `MHP_VERSION_LOCK: … frozen wire contract changed`                                    | exit 0                                                                                                                                     |
| 11  | the packaging inventory reader                         | `outfile: PORTABLE_LOADER_FILE` back to a template string in `build.mjs`                                           | `estimatorPricePackaging` fails (`Unresolved production output`)                              | exit 0                                                                                                                                     |
| 12  | the static Stop shell's named entities                 | `'<': '&lt;'` to `'&#60;'` in `html.ts`                                                                            | exit 1, `renders localized Stop in the static shell …`                                        | exit 0                                                                                                                                     |

Reds seen without being provoked, each followed by its fix and a green: the VSIX crash (§2.7), the
certificate issuance's `Resource admission unavailable` when `serve` ran with no governor (§2.5), the
lint error, the two jscpd rounds and the over-budget bundles of §2.

## 8. Not run, and open decisions

Not run, with the reason: §6's last paragraph; the vault and OS credential-store suites, `devicePairKeyDpapi`
and the five browser suites (rule); `runtimeLsp`; `lint:ps` (Windows only). No hosted CI was available to
this lane. The brief's "Muse's allowance" rule was kept: no step needed a Muse request.

Open decisions for the lead, each with the options and a recommendation:

1. **Three bundle budgets are still over, `npm run build` is red, and one of them grew.** The base's
   `teamRunners.js`, `teamHost.js`, `teamScheduler.js` (§3); the fourth of CC-INT5, `uiText.js`, now fits
   (115.0 of 125 KiB). `teamRunners.js` grew 78.4 to 78.7 KiB here: the account placement schemas of
   rlf-m108 (+209 B). Options, from CC-INT5 §8: (a) the team MCP server in its own lazy `dist/teamMcp.js`
   (about 10 to 12 KB, enough for `teamHost.js`); (b) Traffic in a lazy bundle and the window-only
   members out of `TaskBoard` and `TeamScheduler`; (c) share the account schemas
   `teamRunners` pulls through the wire (the cheapest +0.3 KiB). Recommendation: one team-budget lane
   does (a) and (b) and takes (c) with them; until then keep counting the three as the base's.
2. **The maker's page is `machines panel`.** `panel` is the MHP host's word (D84), so int's contract
   (`panel` needs `--stdio`) stayed and the lane's command moved. Alternatives: `maker panel` (a new
   top-level word), or choosing by flag (a bare `panel` opens the maker page, `panel --stdio` the host;
   rejected: it changes int's tested refusal and makes one word mean two things). Recommendation:
   keep `machines panel`; the spelling is in `commandArgs.ts`, one `cliCommands.ts` row and the README.
3. **The VS Code maker host has no activation wiring**, on rlm103's own tip too: nothing in
   `src/extension.ts` creates `createMakerHost`, `MakerCommands` or `createMakerPreviewPanel`
   (`makerPreviewPanel.ts` now takes `globalStoragePath` for its bundle). The runtime and ACP makers
   work. Options: (a) wire them in `activate` through a lazy loader like the Devices one
   (`makerLoader`), with a real-use run of the preview in the packed VSIX; (b) leave them dormant until
   M103's VS Code piece. Recommendation: (a), as its own lane.
4. **PLAN D49 still says the browser check reaches loopback by default; rlm103 changed it to an exact
   dev origin in the user-level `browserCheckExtraHosts`** (README "Where a page may go"; the maker
   companion ports are always refused). The lane carries no amendment of D49. Options: amend D49
   to the new rule (recommended: the rule is documented, tested and security-motivated, and a person
   checking a dev server adds its origin once), or restore the loopback default and keep the
   companion ports and machine UIs refused.
5. **The three lane-own failures on this rig** (`runtimeMakerStop`, `makerSerial`, `makerLease`): same on
   rlm103's tip, cause unmeasured, probably the macOS process and pty paths the lane never ran here.
   Recommendation: the hosted Linux and Windows legs decide; if they pass, mark the three as macOS
   gaps; if not, they are rlm103's to fix.
6. **Windows code unproven here:** the two PowerShell 5.1 starts of the maker detection run with an
   empty environment or with `PSModulePath` alone (they are reviewed into the WINPSMOD record on that
   reasoning, not applied through `windowsPowerShell`), and `dist/resourceGovernorWindows.js` joined
   the container and install lists. Recommendation: the Windows leg of hosted CI, plus one real run of
   `muse maker` detection on Windows 11.
7. **The serial helper's bare `python3`** now resolves on a PATH without the run workspace
   (`workspaceChildEnvironment` in `nativeSerial.ts`). Option: resolve it explicitly with
   `resolveExecutable` outside the workspace and start the absolute path. Recommendation: do that when
   the serial helper next changes.
8. **`judgeP2Delivery` costs about 90 minutes** here (§4): hundreds of real gate runs while collecting, a
   `vsce ls` per allowlist case. Recommendation: a lane that shares one gate run between controls that mutate the same metafile and
   keeps the `vsce ls` walk off scratch folders, so it fits a normal command.
9. **RVNET's remaining Node `serve` items:** an authenticated request over the 2 MiB cap, and the waits
   the node record names (the maker action, the operator control transport, a second PC joining).
10. **Decision numbers:** D229 is the only new one (§1); D230 to D239 are free for CC-INT7 (D240 to D249 are
    its own).

## 9. Commits

Merge commits and the `fix(int):` commits that carry a merge interaction, in order (first parent):

| Commit                    | What                                                                                              |
| ------------------------- | ------------------------------------------------------------------------------------------------- |
| `48ecd584a`               | merge 1, rlf-sast-reviewed                                                                        |
| `46043f6b9`               | merge 2, rlf-updeps                                                                               |
| `ae4fa4cf9`               | merge 3, rlf-playbook                                                                             |
| `e785e3ea4`               | merge 4, rlf-harvest                                                                              |
| `d1cd9de41`               | fix(int): museCodeLatest imports `MSP_KNOWN_SCHEMA_FINGERPRINTS` once (merge 4)                   |
| `89e1469c1`               | merge 5, rlf-recording                                                                            |
| `1486ecb05`               | merge 6, rlm103                                                                                   |
| `0633e654c` / `f378b4430` | merge 7, rlf-maclive (`-s ours`), then its four commits                                           |
| `3e2429ccd`               | merge 8, rlf-m110os2                                                                              |
| `29ab474a0`               | merge 9, rlf-musesetup (D229)                                                                     |
| `1987745cd` / `0bf9c7bcf` | merge 10, rlf-nodeserve (`-s ours`), then its three commits                                       |
| `19d43940a` / `ae8bda858` | merge 11, rlf-m108 (`-s ours`), then its sixteen commits                                          |
| `30bb80e95`               | merge 12, rlf-m104d                                                                               |
| `dbabb62ce`               | fix(int): the lanes' tests follow int's types (merges 7, 11)                                      |
| `1f04fd2ed`               | fix(int): shared fixtures, the serve entry is a knip entry (merges 10, 11)                        |
| `424b3372c`               | fix(int): the packed webview archive carries usage, what's new and the maker preview (merge 6)    |
| `a04283dda`               | fix(int): the VSIX webview archive leaves the portable graph out (merge 12)                       |
| `18cab8fc3`               | fix(int): the lanes' process starts stand in int's spawn inventory (merges 6, 9)                  |
| `3382fb0f5`               | fix(int): the maker's page opens with `machines panel` (merge 6)                                  |
| `f1050c484`               | fix(int): two merged tests follow int's packaging and rlf-updeps' pin (merges 2, 6)               |
| `8593477c4`               | fix(int): the portable loader's output is a named file (merge 12)                                 |
| `83dd1325c`               | docs(int): the host-API record (merges 6, 9)                                                      |
| `0a051b448`               | fix(int): the egress proxy's lookup uses the `order` option (merge 2)                             |
| `d5376e9e4`               | fix(int): the static Stop shell escapes its label with named entities (merge 6)                   |
| `6ccc3e199`               | fix(int): two int browser tests follow rlm103's browser rules (merge 6)                           |
| `295a42ac4`               | fix(int): the container image and the installed node carry the Windows governor bundle (merge 10) |
| `33099cfb3`               | fix(int): the static Stop shell escapes with the lane's SAST-clean form (merge 6)                 |

Nothing was pushed. This record and the PLAN status paragraphs are the last commit.
