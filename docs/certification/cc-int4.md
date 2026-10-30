# CC-INT4 — merge round 4a on int/recovery (2026-10-30)

Claude Code lane `CC-INT4`, worktree `/Users/user/lanes/CC-INT4`, branch
`cc/int4`, on the test rig `MacBookPro.ivettnet` (macOS, Darwin 24.6.0, Intel
x86_64, Node 24.21.0, npm 11.19.0). Base: int/recovery `94b15b376` (CC-INT3's
round, `docs/certification/cc-int3.md`, whose known failures and CC-INT2's and
CC-INT1's (`cc-int2.md`, `cc-int1.md`) are not counted against a merge here).
Model attempts: **0**. Provider calls: **0**. Muse requests: **0** (the
allowance is used up until 2026-10-25 17:00 Pacific by the brief's rule; no
real conversation, no nested ACP or CLI session). Nothing was pushed, rebased,
stashed or tagged. The vault and real credential-store suites (`keyringParts`,
`keystoreOwner`, `credentialLease`, `providerHeadersStore`,
`test/unit/vault/**`, `deviceOwnerVaultUses`, `deviceOwnerBind`,
`devicePairKeyDpapi`) were never run on this MacBook, and no browser or GUI app
was started. Scratch files lived in the worktree's ignored `temp/` (two Python
venvs, a scratch `HOME` and workspace, an extracted copy of the base, drill
backups, logs); the copy of the base, the venvs and the scratch folders were
removed at the end.

## 1. The merges

Fetched with `git fetch ~/gates/muse.git "refs/heads/lanes/<name>:refs/remotes/<name>"`
and merged with `git merge --no-ff`, in the brief's order, each lane's
certification record read first (`rvint5.md`, `cc-notices.md`, `cc-pkgreg.md`,
`cc-estplan.md`, `cc-winfail.md`, `rlf-upagent.md`, `rlf-upprov.md`).

| #   | Branch (tip)                      | Built on    | Commits | Merge commit | Conflicts                                                                                                                                                                                                     |
| --- | --------------------------------- | ----------- | ------- | ------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | `lanes/int5` (`613b36e7a`)        | `b781451b9` | 3       | `bf25ea48b`  | none                                                                                                                                                                                                          |
| 2   | `lanes/rlf-notices` (`50c644370`) | `9b090e87c` | 2       | `817248fb0`  | `PLAN.md` and `docs/roadmap/entries.json` (both lanes added a section/entry after RLFSAFELIMITS; both kept), `ROADMAP.md` (generated; regenerated with `npm run roadmap:generate`)                            |
| 3   | `lanes/rlf-pkgreg` (`29fa2cd6f`)  | `9b090e87c` | 2       | `e9fc53eeb`  | none                                                                                                                                                                                                          |
| 4   | `lanes/rlf-estplan` (`9fadfcd60`) | `9b090e87c` | 2       | `cf0423cb2`  | `ROADMAP.md` (generated; regenerated)                                                                                                                                                                         |
| 5   | `lanes/cc-winfail` (`000bdb67d`)  | `9b090e87c` | 11      | `ed3c63378`  | `CHANGELOG.md`: both lanes added entries at the head of the `### Fixed` list under `[Unreleased]`; both kept                                                                                                  |
| 6   | `lanes/rlf-upagent` (`3ff044994`) | `b781451b9` | 3       | `ae67d372e`  | `CHANGELOG.md` (same place; both kept), `ROADMAP.md` (regenerated); `package.json` and `package-lock.json` auto-merged with rlf-notices' dependency moves                                                     |
| 7   | `lanes/rlf-upprov` (`e7da28f10`)  | `b781451b9` | 3       | `0942e4d05`  | `CHANGELOG.md` (same place; both kept). The catalogue (`vendor/models-dev/*`) merged without a conflict; `node scripts/sync-provider-catalog.mjs --check` accepts it as sealed, so no regeneration was needed |

Then `01431a6fb docs(plan)`: the dated integration statuses (§6) and this
record's commit. No merge-interaction `fix(int)` commit was needed: no gate
fired red on the merged tree (§3) and the only conflicts were generated files,
the CHANGELOG and adjacent PLAN additions. Each is resolved for current int by
keeping both sides; `ROADMAP.md` was never hand-merged.

## 2. What each merge needed

### 2.1 `lanes/int5` (RVINT5, the Grok review): the security fixes

Read in place, not taken on the record's word.

- **P1, `src/runtime/node/packs/verify.ts`.** `packVerificationPolicy()` now
  anchors and escapes the pack workflow's identity (`^…$` over every regular
  expression metacharacter), because `@sigstore/verify` matches
  `subjectAlternativeName` with `String.prototype.match`; `readPackBundle()`
  refuses a bundle that is not a message signature (`unsupported-bundle`) and a
  bundle the parser rejects (`malformed-bundle`) before the trust-root fetch.
  What makes "the signature covers the index bytes" true is the library, which
  this round read: `toSignedEntity(bundle, Buffer.from(bytes))` hands the index
  bytes to `MessageSignatureContent`, whose signature is verified over the
  artifact (`node_modules/@sigstore/verify/dist/bundle/message.js`), while a DSSE
  envelope is verified over its own payload and never sees the bytes. So a
  DSSE bundle is now refused where the old code let it reach the verifier.
  `verifyIndexBundle` still requires one transparency-log entry, one
  certificate-transparency entry and one timestamp, and still returns `verified`
  only after `verifier.verify` returns.
- **P2, `src/core/watchdog/{decide,poll,guard}.ts`.** A spam hold now returns
  `closed: false` (so `watchdog decide` no longer says "Closed." for an issue
  GitHub still has open) and the poll event stays `polled` for a held issue
  (so it is not triaged again every poll). A record closed because GitHub
  closed, then found open, is still `reopened`.
- **Not changed, said plainly.** The lane's tests feed the real code values
  they build (`watchdogSteps.test.ts`) and bundles the real parser accepts
  ("Not a captured signature", `nodePacksVerify.test.ts`); neither stands in
  for GitHub, Sigstore or one of our modules. Whether a hand-built bundle
  counts as invented data is open (§8, item 1). No bundle signed by the real
  pack workflow was verified against the live TUF mirror, by the lane or here.

### 2.2 `lanes/rlf-notices` (manifest 41 of 41)

Seven dependencies that ship in no bundle's metafile (`codemirror`,
`@codemirror/merge`, `@xterm/*`, `ink`, `string-width`) moved to
`devDependencies`; the three `@sigstore/*` packages, which only the ACP agent's
`dist/packsVerify.js` carries, are exempt from the extension-notices case,
guarded on that carrier still shipping; the RELFAST pin moves 7 to 8. On the
merged tree `package.json`/lockfile merged without a conflict beside
rlf-upagent's SDK pin: `npm ci` exits 0 and `npm install --package-lock-only
--ignore-scripts` leaves the lockfile byte-identical (`cmp`). `manifest.test.ts`
passes 41 of 41, and `npm run build`'s notices check passes against the
committed `THIRD_PARTY_NOTICES.txt` (93 notices; no regeneration).

### 2.3 `lanes/rlf-pkgreg` (lazy registry)

`resolveRequest` keeps a relative name's full subpath instead of its basename.
The generated registry needed no regeneration: `node scripts/gen-lazy-registry.mjs
--check` (inside `npm run build`) reports "178 bundles, 282 loads by file name
resolved … `lazyBundles.generated.ts` is current" (the lane's 175 is its older
base). `packagedBundles.test.mjs` passes 9 of 9 (§4).

### 2.4 `lanes/rlf-estplan` (PLAN's M100 tables, the roadmap row)

`estimatorPlanSnapshotRealPlan` (43) and `cx1r2Truth` (18) pass on the merged
tree; both were base failures in CC-INT1 to CC-INT3. `check:plan` reports 243
milestones, 0 drift, and `check:roadmap` is current after the regeneration.

### 2.5 `lanes/cc-winfail` (made on the owner's Windows PC)

`storageGuard.ts`, `privateDirectory.ts` and `tokenFile.ts` read and write the
ACL through the CLR (`[IO.File]::GetAccessControl` and the directory twins)
instead of `Get-Acl`/`Set-Acl`; `cliOptions.ts` prints the usage sentence for a
route whose options table holds only `--help` (`providers headers`);
`scripts/check-webview-archive.mjs` reads the `.vsix` itself and runs through a
linked directory. Its tests fix the PowerShell 5.1 module path, find OpenSSL
outside Git Bash, load the resource-history English group, stage the report
input chunks in the connector stdio e2e, and wait for the worker marker until
its own deadline. Read in place: no `vi.mock`, `vi.spyOn`, `vi.stubGlobal` or
fake timer in any test it changed. **Windows-only cases skip here** (§4):
`deviceWorkerHostNative` (20 of 20 skipped), `windowsPowerShellModules`'s
Windows block, the Linux-only `privateRootLease` cases; the lane measured them
on Windows 11.

### 2.6 `lanes/rlf-upagent` (Muse SDK 1.4.12)

`@muse-code/sdk` 1.4.11 → 1.4.12 in `package.json` and the lockfile, the survey
`docs/research/agents-sdks-2026-10-30.md`, and `museCodeLatest.test.ts`'s
fingerprint cases. `npm ci` installs 1.4.12 (checked:
`node_modules/@muse-code/sdk/package.json` says 1.4.12); `museCodeLatest` (56),
`museCodeDecisions` (4) and `mapNotification` pass. The served 1.4.12
fingerprint was not captured here (no Muse Code at 1.4.12 on this rig; no Muse
request).

### 2.7 `lanes/rlf-upprov` (catalogue 2026-10-30, DeepSeek peak, 128 MB)

The sealed catalogue passes `sync-provider-catalog.mjs --check`; Moonshot and
Ollama Cloud now have sections (read from the sealed snapshot: `moonshot` 6 of 6
models priced, `ollama-cloud` 22 of 23). `cataloguePriceCard` scales DeepSeek's
rates to the documented peak (×2); `ANTHROPIC_MAX_REQUEST_BYTES` is
128,000,000. The only preset that speaks the Anthropic wire is the first-party
one (`presets.ts`, `format: 'anthropic'`, origin `https://api.anthropic.com`),
so the first-party cap is the right one for that codec. No other mention of the
old 32 MB cap needs a change (the ones left are history or other limits). The
live calls the lane listed for the real-life run (DeepSeek peak/off-peak,
Moonshot and Ollama Cloud captures) were not made: they are provider calls.

## 3. Proof on the final tree

Every exit code is the command's own. The tree is `01431a6fb` plus this record.

| Command                                                                                                            | Exit             | Result                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| ------------------------------------------------------------------------------------------------------------------ | ---------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `npm ci`                                                                                                           | 0                | 22 s, 997 packages added; npm 11 withholds four install scripts (`@vscode/vsce-sign`, `esbuild`, `fsevents`, `keytar`), as in CC-INT3; `.husky/_/pre-commit` present; `npm install --package-lock-only --ignore-scripts` afterwards: exit 0, lockfile unchanged (`cmp`)                                                                                                                                                                                                  |
| `prettier --check --ignore-unknown` on the 51 files changed since `94b15b376`                                      | 0                | re-run on `PLAN.md` after the status edit: 0                                                                                                                                                                                                                                                                                                                                                                                                                             |
| `eslint --max-warnings 0` on the 33 changed JS/TS files                                                            | 0                |                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| `npm run typecheck`, as its six projects one by one (host 42 s, webview 20 s, unit 75 s, e2e, integration, faults) | 0, 0, 0, 0, 0, 0 | no `error TS` line in any log                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| `node scripts/check-l10n.mjs`                                                                                      | 0                | 14 UI tables, 14 usage tables, 283 manifest strings, 2457 source files; 0 problems                                                                                                                                                                                                                                                                                                                                                                                       |
| `npm run check:reference`                                                                                          | 0                | 92 features, 68 commands, 110 settings, 33 slash, 359 CLI; current                                                                                                                                                                                                                                                                                                                                                                                                       |
| `npm run check:host-api`                                                                                           | 0                | 392 VS Code APIs, 57 files importing vscode, 30 Node built-ins, 76 theme variables; 0 problems (no record change)                                                                                                                                                                                                                                                                                                                                                        |
| `npm run check:plan`                                                                                               | 0                | 243 milestones; 0 drift (no archive needed)                                                                                                                                                                                                                                                                                                                                                                                                                              |
| `npm run check:roadmap`                                                                                            | 0                | 243 entries; `ROADMAP.md` current (regenerated three times, §1)                                                                                                                                                                                                                                                                                                                                                                                                          |
| `npm run check:catches`                                                                                            | 0                | all catch sites and counts match the baseline; nothing rose, nothing fell, no regeneration                                                                                                                                                                                                                                                                                                                                                                               |
| `npm run cycles`                                                                                                   | 0                | no circular dependency                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| `npm run deadcode`                                                                                                 | 0                | knip clean (configuration hints only)                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| `npm run duplication`                                                                                              | 0                | 0 clones                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| `npm run build`                                                                                                    | 0                | 97 s; every one of the 257 size rows holds (0 `OVER`); tightest `dist/uiText.js` 124.9 of 125 KiB, `dist/wire.js` 74.8 of 75, `dist/validation.js` 49.8 of 50, `dist/modelApi.js` 522.4 of 525; `dist/extension.js` 517.3 of 600; `dist/acp.js` 406.2 of 850; `dist/acpWatchdog.js` 69.6 of 75; webview surface English 23.4 of 25; lazy registry 178 bundles, current; notices 93; 162 legal bundles, 2865 files, 0 problems. No budget raised                          |
| `node scripts/package-vsix.mjs --target win32-x64` (zopfli 0.4.3 in a venv under `temp/`)                          | 0                | **`VSIX: 4323743 bytes (budget 4915200)`**: 591,457 bytes under the budget (CC-INT3: 4,322,472)                                                                                                                                                                                                                                                                                                                                                                          |
| `npm run package:acp -- --target win32-x64`                                                                        | 0                | **125 of 125** packaged-bundle checks (CC-INT3: 125); notices pass                                                                                                                                                                                                                                                                                                                                                                                                       |
| `npm run security:audit`                                                                                           | 0                | **7** advisories, 0 exceptions needed (CC-INT3: 7); `package.json` changes only by rlf-notices' dependency moves and the SDK pin; the lockfile by those two lanes' changes                                                                                                                                                                                                                                                                                               |
| `npm run security:sast` (semgrep 1.180.0 in a venv under `temp/`; `SSL_CERT_FILE=/etc/ssl/cert.pem`)               | 1                | 688 rules, 5220 files: the **same 6 blocking findings as CC-INT1 to CC-INT3**, in `os/build.py`, `os/pi/compose.py` (2), `scripts/build-packs.mjs`, `src/core/backends/modelapi/mcp/headers.ts`, `src/runtime/node/keyStore.ts`; none of those five files changed in this round (`git diff --name-only 94b15b376 HEAD` is empty for each), and none of the round's changed sources has a finding. Semgrep stopped rules on `ModelApiHost.ts` after 3 timeouts, as before |

Not the same number as one lane's note: `docs/certification/rlf-upagent.md`
records SAST exit 0 with 1,074 rules; the pinned recipe here (`semgrep==1.180.0`,
`.github/semgrep/requirements.txt`, 688 rules) is what CC-INT1 to CC-INT3 ran,
and it finds the base's six. That lane's different rule count is its rig's
scanner, not a difference in the code.

## 4. Each merged lane's own suites, final tree, repository timeouts

`TMPDIR` at its real path (`/private/var/folders/…/T`), `--maxWorkers=3`, three
files at a time, no raised timeout anywhere in this lane. The macOS helper app
was built first with `bash native/darwin/build.sh` (exit 0; git-ignored output).

| Suites                                                                            | Exit  | Result                                                                                                                                       |
| --------------------------------------------------------------------------------- | ----- | -------------------------------------------------------------------------------------------------------------------------------------------- |
| `nodePacksVerify`, `watchdogSteps`, `watchdogSurface`                             | 0     | 13 passed (int5)                                                                                                                             |
| `watchdogCaptures`, `watchdogContracts`, `manifest`                               | 0     | 66 passed; `manifest` 41 of 41 (rlf-notices)                                                                                                 |
| `nodeWorkspaceBuild`, `nodeTerminalSession`, `nodeWorkspaceUi`                    | 0     | 33 passed (the moved dependencies' consumers)                                                                                                |
| `tuiDesign`, `noticesInput`, `lazyBundleFiles`                                    | 0     | 177 passed (rlf-notices, rlf-pkgreg)                                                                                                         |
| `packagedBundles` (alone, 121 s)                                                  | 0     | 9 passed (rlf-pkgreg)                                                                                                                        |
| `estimatorPlanSnapshotRealPlan`, `cx1r2Truth`, `commandHelp`                      | 0     | 113 passed (rlf-estplan; cc-winfail's help walk)                                                                                             |
| `browserEnglish`, `browserUiText`, `webviewArchiveCheck`                          | 0     | 53 passed (cc-winfail)                                                                                                                       |
| `osImageBuildUpdateChannel`, `windowsPowerShellModules`, `deviceWorkerHostNative` | 0     | 30 passed, **22 skipped**: `deviceWorkerHostNative` is Windows/Linux-gated (20 skipped here), `windowsPowerShellModules`'s Windows block (2) |
| `privateRootLease`, `museCodeLatest`, `museCodeDecisions`                         | 0     | 70 passed, **6 skipped** (`privateRootLease`'s Linux-only and Darwin-skipped cases)                                                          |
| `mapNotification`, `providerUsageFields`, `anthropicCodec`                        | 0     | 176 passed (rlf-upagent, rlf-upprov)                                                                                                         |
| `providersPresets`, `providersModel`, `providerUnpriced`                          | 0     | 56 passed (rlf-upprov)                                                                                                                       |
| `connectorStorageGuard`, `connectorStdio` e2e                                     | **1** | 12 passed, **3 failed**, all in `connectorStorageGuard`: base (§5 row 1). `connectorStdio` e2e passes (cc-winfail's staging fix)             |

## 5. `npx vitest related` over the merges' changed sources

The 13 `src/` and `scripts/` files the merges changed
(`scripts/{check-webview-archive,lib/lazyRegistry,sync-provider-catalog}.mjs`,
`src/core/backends/modelapi/codecs/anthropic.ts`,
`src/core/providers/priceCard.ts`, `src/core/watchdog/{decide,guard,poll}.ts`,
`src/runtime/{cliOptions,privateDirectory,tokenFile}.ts`,
`src/runtime/connector/storageGuard.ts`, `src/runtime/node/packs/verify.ts`),
without `src/shared/constants.ts` (its `related` closure is the whole battery;
its only change, `ANTHROPIC_MAX_REQUEST_BYTES`, is read by `codecs/anthropic.ts`
and `anthropicCodec.test.ts`, both inside this run). Excluded by the MacBook
rule: `keyringParts`, `keystoreOwner`, `credentialLease`, `providerHeadersStore`,
`test/unit/vault/**`, `deviceOwnerVaultUses`, `deviceOwnerBind*`,
`devicePairKeyDpapi`; also `runtimeLsp` (CC-INT1 §5 row 11: three cases that
cannot pass under any macOS temp folder, 240 s each) and the browser suite
`devicesPhase2Harness`. The `--exclude` globs worked; no file the rule bars ran.

`npx vitest related … --run --maxWorkers=3`, the repository's own timeouts: exit
**1**, 150 files (1 failed, 148 passed, 1 skipped), 1879 tests (**3 failed**,
1858 passed, 18 skipped), 152 s.

| #   | Files (tests)               | Merged tree                                                                                                                                                                                | Untouched base (`94b15b376`, `git archive` under `temp/base`, `node_modules` linked, same `TMPDIR`)           | Class                                                                                                                                                                                                                                   |
| --- | --------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | `connectorStorageGuard` (3) | the same 3 failing alone and in the related run: `refuses storage planted the legacy way`, `refuses to serve untrusted storage` (5 s timeout), `reports the refusal instead of the grants` | the same 3, the same messages (`storage refusal expected`, `Test timed out in 5000ms`, `expected +0 to be 1`) | Base (CC-INT1 §5 row 9): on POSIX the "legacy" storage is planted by an unbound `ConnectorStore` that already creates folders `0700` and files `0600`, so nothing is untrusted. Not from a merge; cc-winfail's edit is the Windows case |

Nothing in the table comes from a merge. The failures CC-INT1 to CC-INT3
recorded for files this round's sources select and that the lanes fixed now
pass: `estimatorPlanSnapshotRealPlan` (8) and `cx1r2Truth` (1) (rlf-estplan),
`manifest` (2) (rlf-notices), `commandHelp` (1), `browserEnglish` (2),
`browserUiText` (1) and `connectorStdio` (2) (cc-winfail). The files CC-INT3
listed as base failures that the changed sources do not select
(`acpServeHandshake`, `playbookGovernor`, `resourceStatusCpu`,
`playbookSchedulesInputs`' churn case, `scheduleFireFailures` and friends,
`runtimeLsp`) were not in this run and are unchanged; they were not re-run.

## 6. Real use through the built product

`dist/acp.js` and `dist/packsVerify.js` from this tree's `npm run build`, a
scratch `HOME` under `temp/`, an empty workspace folder, no network call and no
Muse request:

```
providers headers --help   → "muse-spark-code-acp providers headers" and
                             "Usage: muse-spark-code-acp providers headers <id> [set|unset <name>];
                              a value is read from standard input." then the --help line      exit 0
stop --help                → the topic screen (Usage, the stop sentence, Options)             exit 0
verifyPackIndexBundle(<DSSE envelope, as the real parser accepts>, <index bytes>)
                           → {"verified":false,"failure":"unsupported-bundle"}                exit 0
verifyPackIndexBundle({}, …) and ({mediaType:"nope"}, …)
                           → {"verified":false,"failure":"malformed-bundle"} (both)           exit 0
```

The pack verifier lines call the shipped bundle's one export directly. They prove
the two refusals the P1 fix added, both before any trust-root fetch (no network).
They do not prove acceptance of a real signature: no bundle signed by the pack
workflow was verified, because that needs the live Sigstore TUF mirror and a
captured bundle (§8, item 1). Not run through the product, and why: the
packed (win32-x64) agent (a Windows package does not run here; the
unpackaged `dist/` bundles were used), a pack fetch end to end, `watchdog poll`
and the other GitHub steps (need the person's sign-in and a repository), Tab and
the editor (Electron cannot start here), the Windows CLR ACL paths and the
Windows job suite (Windows-only), and any provider or Muse request (the
catalogue, the DeepSeek peak card and the 128 MB cap are proven by their suites
only).

## 7. Red/green drills

Each: one edit on the merged tree, the owning suite, the non-zero exit, restored
(`cmp` against a copy), the same suite green. No gate or test was added in this
round, so these confirm the merged lanes' own guards still fire on int.

| Break                                                                | Caught by                                                                                                  | red | green |
| -------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------- | --- | ----- |
| `verify.ts`: the identity pattern loses its leading `^`              | `nodePacksVerify` "accepts only the pack workflow identity, exactly" (a lookalike host's URI was accepted) | 1   | 0     |
| `verify.ts`: any parsed bundle is accepted as a message signature    | `nodePacksVerify` "refuses a bundle that is not a signature over the index bytes…"                         | 1   | 0     |
| `decide.ts`: `spamHoldResult` returns `closed: true`                 | `watchdogSteps` "keeps a held issue held and does not say it was closed"                                   | 1   | 0     |
| `poll.ts`: a closed spam record is `reopened` again                  | the same case (`'reopened'` against `'polled'`)                                                            | 1   | 0     |
| `lazyRegistry.mjs`: a relative name is reduced to its basename again | `lazyBundleFiles` "matches a relative name by its full path, never its basename"                           | 1   | 0     |
| `package.json`: `ink` back in `dependencies`                         | `manifest` packaging case (`ink: expected … to contain '\nink ('`)                                         | 1   | 0     |
| `priceCard.ts`: `DEEPSEEK_PEAK_MULTIPLE` = 1                         | `providerUsageFields` "maps reasoning per-token…" (1 failed of 27)                                         | 1   | 0     |
| `constants.ts`: `ANTHROPIC_MAX_REQUEST_BYTES` back to 32,000,000     | `anthropicCodec` (2 failed of 101)                                                                         | 1   | 0     |
| `cliOptions.ts`: the `providersHeaders` usage entry removed          | `commandHelp` "walks every public command…" (`providers headers: expected 2 to be greater than 2`)         | 1   | 0     |
| `vendor/models-dev/snapshot.json`: one byte appended                 | `node scripts/sync-provider-catalog.mjs --check` ("Catalogue SHA-256 mismatch")                            | 1   | 0     |

The lanes' own drills (int5's two, notices A to C, pkgreg's two, estplan A to C,
winfail's per-row drills, upagent's, upprov's) are in their records and ran on
their bases. No gate fired red on the merged tree (§3).

## 8. Not run, and open decisions

Not run, with the reason:

- `test/integration/tab.test.ts`, `editorChat.test.ts` and the other VS Code
  integration suites: Electron cannot start on a macOS lane. Their compile is
  covered by the integration typecheck project.
- Windows-only suites and code paths (`deviceWorkerHostNative`, the
  `windowsPowerShellModules` Windows block, the CLR ACL reads and writes in
  `storageGuard.ts`, `privateDirectory.ts`, `tokenFile.ts`): **skipped or
  unreachable here**; cc-winfail measured them on Windows 11. Hosted CI's
  Windows legs must confirm them on the merged tree.
- `npm run test:a11y`, `test:legal-a11y`, `ui:look` (browser suites: "NOT RUN:
  browser suite on the MacBook").
- The vault and OS credential-store suites (rule), `devicesPhase2Harness`
  (browser), `runtimeLsp` (cannot pass under a macOS temp folder).
- Any Muse request, real conversation, paid provider call, GitHub run for the
  watchdog, or a verification of a real signed pack index.

Open decisions for the lead (none blocks the merge):

1. **A real signed bundle for the pack verifier.** The P1 fix refuses what it
   should (§6), but no test or run shows a bundle signed by the real pack
   workflow still verifies, and the two negative tests feed hand-built bundles
   to the real parser ("Not a captured signature"). Options: (a) accept as built;
   (b) when the pack CI emits a bundle, record one real bundle with its capture
   date and command and verify it against a pinned trust root offline, with the
   tampered and wrong-identity variants. Recommendation: (b), as a small lane
   with the pack CI's first signed index; (a) until then.
2. **The watchdog's GitHub steps still have no real proof** (CC-INT2 §8 item 1,
   RVINT5). Options: (a) a real run with a GitHub sign-in against a repository
   the owner chooses, in the release's real-life run; (b) restore the six
   stand-in suites (breaks the rule). Recommendation: (a). Until then
   `docs/acp.md`'s Issue-watchdog section describes behaviour no real run has
   used; trim it to the proven commands if a release ships first.
3. **RVINT5's two open P3s.** (i) A reporter who quotes our acknowledgement
   marker is not read as an answer (`isReporterAnswer`). (ii) A failed deferred
   schedule event is retried with no bound and no sentence
   (`src/runtime/schedules/engine.ts:524`): D121's clarification says every
   retry after a failure keeps a sensible limit and, after the last attempt,
   stops and says why. Options for (ii): (a) leave it (RVINT5's
   recommendation); (b) a bounded retry count at a cited industry value with a
   sentence when it parks the event. Recommendation: (b), as a schedule lane,
   because (a) contradicts the clarification; (i) stays open until a live run
   shows the quote.
4. **`lspTab.ts` still has the order cc-winruns fixed in the VS Code
   provider** (CC-INT3 §8 item 1: the paid-use question before the
   `secret-at-cursor` decision). Still open; recommendation unchanged: reorder
   and add a real LSP stdio test.
5. **cc-winfail's leftovers** (its §3 and §4): (i) `runtimeLsp`'s two hook cases
   pass on a quiet Windows PC and fail when it is saturated because a Windows hook
   launch costs about 2 s against Tab's 1.5 s bound (its recommendation: leave
   them to hosted CI now, cut the launch's PowerShell starts as its own lane);
   (ii) about twenty scripts in `scripts/` compare `import.meta.url` with the
   start path as typed and exit 0 without running through a linked directory
   (one fixed); (iii) `test/unit/helpers/shellBash.mjs` imports
   `resolveExecutable` from `src/core/executables`, which does not export it.
   Recommendation: (ii) and (iii) as one small tooling lane; the rule that a
   check script has no main-module comparison covers (ii).
6. **rlf-notices' follow-ups.** The TUI (`src/runtime/tui/design/*`, `ink`) and
   the node workspace (`codemirror`, `@xterm/*`) ship in no bundle, so their
   dependencies sit in `devDependencies` and their licence records do not reach
   the notices. Options: a build entry carries each into a shipped bundle and the
   notices build covers it, or the modules go. A product decision; no change here.
7. **Dated items from rlf-upagent and rlf-upprov.** B7 (Marketplace publishing
   off the personal access token, **by 2026-12-01**, needs the owner's
   Marketplace policy) and B1 (ACP SDK 2.0.2, past the 7-day window on
   2026-10-31, for CRLF stdio framing) are time-bound; B2 (Muse 1.4.13/1.4.14
   currency), B3 to B6, B8 to B10 and the provider briefs B1 to B7 are
   dispatchable. The provider lane's live calls (DeepSeek peak and off-peak,
   Moonshot and Ollama Cloud captures) belong to the lead's real-life run; I
   made none.
8. **The Moonshot and Ollama Cloud presets are now priced from the catalogue
   without a wire capture** (the lane's live-call list, items 2 and 3, asks
   for the captures; the sync table change makes their prices appear). Recommendation: capture
   with the real-life run, as the lane says.

## 9. Commits

`94b15b376` → this record: the seven merges (`bf25ea48b`, `817248fb0`,
`e9fc53eeb`, `cf0423cb2`, `ed3c63378`, `ae67d372e`, `0942e4d05`), the lanes' own
26 commits beneath them, `01431a6fb docs(plan)` and the commit carrying this
record (51 files changed, +2,858 / −181 before the record).
