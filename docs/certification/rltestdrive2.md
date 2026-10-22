# RLTESTDRIVE2 — the owner's 0.19.0 test drive, items 11-15

Rig `linuxlt`, branch `rec/rltestdrive2`, base main at 0.19.0
(`f3941b8548`). RLTESTDRIVE fixed items 1-10; this lane fixes 11-15 on
current main. Each symptom was reproduced on the published packed
0.19.0 first (npm tarball, isolated `XDG_CONFIG_HOME`/`XDG_DATA_HOME`,
no credentials), then fixed, then re-proven on a fresh staged build
from this branch. Nothing here touches a backend, so no model was
called and no real-life run applies. RLM108's branch is not on this
machine (checked `~/gates/muse.git`, 2026-10-22): nothing of its
stored-row bridge is duplicated here.

## 11. Lock Vault Now and Open Estimator, findable (`187d7173b3`)

Like Vault (item 10, `a4b06e3ea2`), both commands were
`menus.commandPalette` `when: false`, so the owner could not find them.
The three `when: false` entries are gone from the manifest (vault with
them, identical to item 10's removal); the catalog marks all three
runnable so Help offers Run (lock keeps its own sentence); the manifest
test pins their absence from the hidden map. Open Estimator refuses
with words where its runtime is off (`estimateRuntimeUnavailable` —
availability is hardcoded off pending M117's binding, out of scope).

Files: `package.json`, `src/shared/featureCatalog.ts`; test
`manifest.test.ts`.

Drills: the pin test updated first (red on the hidden manifest), then
the manifest fixed. Palette visibility itself has no VS Code API
(`getCommands` lists hidden commands too), so it is proven on the
packed VSIX below.

## 12. Absent keybindings input is not invalid data (`9024621d2f`)

Every report kind read the keybindings source as "The source has an
unsupported format or invalid data." Cause, measured on the packed
0.19.0: the source reads the install's package.json `contributes`
section, and the packed agent's npm manifest has none. An absent file
now reads as undefined and any manifest without keybindings reports
notApplicable with "There are no custom keybindings."; a manifest with
keybindings but no command list still reports its bindings (commands
carry no facts). The reader parses JSONC (comments and trailing commas,
sharing the settings-file stripper); only a file that really fails to
parse stays invalid.

Files: `src/core/reporting/sources/keybindings.ts`,
`src/runtime/reporting/reportInputs.ts`,
`src/runtime/sharing/confidential.ts` (shared stripper),
`src/shared/l10n/en.ts` + 14 tables (`reportUi.noCustomKeybindings`);
test `keybindingsReportSource.test.ts`.

Drills (each: break, exit 1, restore, green): the source throw
temporarily back to `invalid` (2 failures), then restored. The reader
and source run over real temp files, including a commented manifest.

## 13. checkRuns names its cause (`ab76ea2a63`)

Every report kind read checkRuns as "The report could not be
generated." with no reason. Cause, measured on the packed 0.19.0: the
journal source threw that report-level sentence for a missing journal
(a fresh checkout, where no checks have run), for skipped lines, and
for every failure alike. A missing journal now reports notApplicable
with "No check runs have been recorded yet."; corrupt lines report
partial with the unreadable count (`checkRunsUnreadable` plurals); a
cancelled read says cancelled and any other failure says the source
could not be read — the local-source taxonomy every sibling uses.

Files: `src/core/reporting/checkRuns.ts`, `src/shared/l10n/en.ts` + 14
tables (`reportUi.noCheckRuns`, `checkRunsUnreadable`); test
`reportSourceFailures.test.ts`.

Drills (each: break, exit 1, restore, green): the absent branch
temporarily back to the generation throw (1 failure), then restored.
Real `ReportStorage` journals in temp dirs, including a directory in
place of the journal file (kernel errno on every platform).

## 14. Bare providers usage (`71d91c8845`)

`providers usage` with no id answered "Unknown argument: providers
usage <id>" (exit 2, reproduced on packed 0.19.0). It parses to the
usage command with no provider now, and the handler prints "A provider
id is needed: muse-spark-code-acp providers usage <id>." plus the
configured ids (or that none are configured), exit 2 — the ids live in
the user's providers file, which the parser cannot see. The top-level
help line shows `usage <id>`. The id form and every misuse keep their
shapes.

Files: `src/runtime/cliArgs.ts`, `src/runtime/main.ts`,
`src/runtime/providersCommands.ts`, `src/shared/l10n/en.ts` + 14
tables (`providerUsageNeedsId`, help line); test
`providersUsageTargets.test.ts` (new).

Drills (each: break, exit 1, restore, green): the parse temporarily
back to `invalid` (1 failure), then restored. The handler reads a real
temp providers file through the real reader.

## 15. No accounts entry names itself (`12f4b9bfc9`)

`providers accounts list --provider anthropic-s2` answered "Accounts
are unavailable until this runtime is connected to the shared account
service." Finding, measured on the packed builds: the binding is
intact — `meta` lists on packed 0.19.0 AND packed 0.18.0, and a
configured non-meta provider fails identically on both, so 0.19.0
regressed nothing. The runtime metadata simply has no row for
non-`meta` providers (PLAN CM108ACC fixed only `meta`; "a later owner
supplies" the rest — RLM108's bridge). The store refusal now carries
that cause, so the terminal names the missing entry
("Accounts are unavailable (testprov has no accounts entry in this
runtime.)."); ACP and the panel map by code and keep their fixed
sentences. `docs/acp.md` states the precondition (README already did);
the 0.18.0 notes are shipped history and stand.

Files: `src/core/providers/accounts.ts`, `src/shared/l10n/en.ts` + 14
tables (`accounts.noAccountsEntry`), `docs/acp.md`; test
`accountErrorTruth.test.ts` (extended).

Drills (each: break, exit 1, restore, green): the store throw
temporarily bare (1 failure), then restored. Real runtime account
services over a scratch dir, with a vault that throws if touched.

## Packed drills

Fresh staged build from this branch
(`dist/muse-spark-code-acp-0.19.0-linux-x64.tgz`, isolated dirs):

- `report project --format json`: `checkRuns | notApplicable | No
check runs have been recorded yet.`, `keybindings | notApplicable |
There are no custom keybindings.` (packed 0.19.0 before: both
  `unavailable` with the invalid-data / generation sentences)
- `providers usage`: need-id sentence + `testprov` (the configured id),
  exit 2; `--help` shows `usage <id>` (packed 0.19.0 before: Unknown
  argument, exit 2)
- `providers accounts list --provider testprov`: "Accounts are
  unavailable (testprov has no accounts entry in this runtime.).",
  exit 1; `--provider meta` still lists `[{"id":"default",...}]`,
  exit 0 (packed 0.19.0 and 0.18.0 before: the connection sentence,
  exit 1)
- VSIX manifest drill: `extension/package.json` in the staged
  linux-x64 VSIX holds 20 palette entries, none hiding
  `museSpark.vault`, `museSpark.lockVault` or `museSpark.estimate`
  (the zopfli recompress step is unavailable on this rig — pinned
  package absent, pre-existing environment gap; the packed VSIX itself
  is complete)

## Gates

Every exit code (recovery rules), final verification runs:

- prettier on touched files: exit 0
- eslint on touched source files: exit 0
- `npm run typecheck` (host, webview, unit, e2e, integration): exit 0
- `node scripts/check-l10n.mjs`: exit 0 (0 problems)
- `npm run check:reference`: exit 0 (current)
- `npm run check:host-api`: exit 0 (0 problems)
- `npm run check:plan`: exit 0 (0 drift)
- `npm run check:roadmap`: exit 0 (after adding the internal
  RLTESTDRIVE2 entry and regenerating)
- `npm run check:catches`: exit 0 (after re-baselining the one removed
  GENERIC site item 12 deleted: `03312ab749`)
- `npm run duplication`: exit 0 (0 clones)
- `npm run cycles`: exit 0 (none)
- `npm run deadcode` (knip): exit 0
- `npm run build`: exit 0 (after moving reportInputs 100 to 101 KiB on
  the measured 100.0: `db80efee1b`)

## Suites

Per-item suites (all green, repo-default timeout): manifest (40),
providersUsageTargets (3), cliHelp, commandHelp, accountErrorTruth
(12), accountsHandlerErrors, providerKeyConfirm, keybindingsReportSource
(12), reportForwardAdmission, reportSourceRecordBoundaries,
sharingConfidential, runtimeCatchHandlers, reportSourceFailures (25),
collect.rowIdentity, reportEngineLanguage.

`vitest related` over the 10 changed source files (`--run`,
`--maxWorkers=3`, repo timeouts), first run: 22055 passed, 31 failed
out of 727 files / 22206 tests. 30 of the 31 are the known
pre-existing rig-environment failures, re-verified file by file on
this branch with identical counts (inspectNative 18, privateDirectory
3, privateRootLease 2, mediaConvert 1, vsixCompression 2,
brokerSocketDirectory 3, scheduleBackgroundReconcile 1). Second run
with those 7 files excluded: 8 failed out of 720 files, every one
proven green in isolation or small batches on this branch
(reportEngineBounds 77, attachments, legalTemplateSlots2,
legalLocalization alone after a busy-rig 5 s timeout in a 3-up batch,
runtimePullRequestInterleavings + skillArchive + evalArmSources 44,
reports.e2e 27) — load flakes on a busy rig. The first run's one
remaining failure is either among the second run's 8 (all
isolated-green) or passed there outright — green outside full-load
contention in both cases, so a flake by the same evidence, not a
systematic failure. A blast-radius battery
over every direct consumer of the changed code is green on top: cliArgs,
accountsCommand, accounts (69), collect.rowSources, collect.accounts,
accountsReportSource (161), cliReference, cliHelpConsistency,
providerExec (45), modelsPanelSchemas, shareContracts, judgeAdmission
(67), reportAccountsSecurityGoldens, qualityLedgerPlan,
AccountsSection (27). Zero lane regressions.
