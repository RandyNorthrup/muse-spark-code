# M113 C-M113-3 certification — accounts and security report kinds

2026-10-11, kubuntu rig, branch `c/m113-3`.
Base `a0b69a03b` (C-M113-2 session and usage kinds) plus the listed first
merge `990a48cf7` (merge of vault core round 4 `d37823d5f`, whose audit
records the security kind reads; no vault file edited by this lane).
No new dependency, paid/live call, credential, push, rebase or gate
relaxation. Hooks on for every commit. Shared core/runtime logic serves
VS Code (`reportPanelEntry`), ACP and CLI (`servicesFor` in `main.ts`);
no webview paint changed.

## Scope (completion program C-M113-3)

M108 registry; M109 audit and developer audit, without values.
Acceptance: goldens; canary absent. Certification: drills; Codex review
(review itself is a lead step and is pending).

## What is complete

- `security` kind: sections `security/vault` (state, tier, item count),
  `security/breakdown` (items by kind), `security/grants` (by
  roles/workspaces shape), `security/usage` (allows by kind and outcome),
  `security/denials` (deny decisions and denied outcomes),
  `security/locks` (locked outcomes), `security/developerAudit` (actions by
  source). Counts, kinds, decisions and outcomes only (RVCM1133: the
  Outcome column used to carry the authority).
- `accounts` kind: sections `accounts/accounts` (per provider with limit
  group; Count counts the account, never its placement order — RVCM1133),
  `accounts/limits` (spend/count/percent thresholds), `accounts/usage`,
  `accounts/swaps`, `accounts/refusals` (stops), `accounts/confirmations`.
  Labels resolved locally.
- Sources validate every fact with strict zod schemas, sort by code unit,
  and stay kind-scoped (`disabled` outside their kind, `unbound` without a
  reader, `missing`/`invalid`/`failed`/`refused` with the shared reasons).
  One `keepReason` helper (`src/runtime/reporting/reportInputs.ts`) keeps
  each source's own true reason in its partial beside the good rows: a
  schema-invalid registry entry is skipped with the invalid reason while
  the good entries still report (only a registry with no good entry reads
  as invalid); a vault view that fails validation is invalid and never
  hides a readable developer audit; with neither vault nor developer audit
  the kind is partial naming both reasons, never a generic missing file;
  linked registry and audit files refuse like linked session files.
- Runtime binds the on-disk registry (`providers.json`, metadata only) and
  the developer audit (both rotations) in both engine constructions.
  Unbound facets stay empty and are named in the partial, never invented.
- Goldens: `test/fixtures/reports/collect/{accounts,security}.{md,html,
text,json}.golden`, compared byte for byte.
- Canary: `reportSecurityCanary` plants item names, labels, handles,
  targets, requester/grant ids, digests, hashes, macs, a role name and a
  grant origin through the real reader, source, collector and all four
  renderers, and asserts none appears in any output.
- Live CLI: two e2e cases run `report accounts` and `report security`
  through production's engine construction against fixture data.

## What is not, and why

- Accounts use, swaps/stops and confirmations have no production adapter:
  no `AccountUsageSource`, event or confirmations read port exists at
  runtime. The reader interface carries them; both construction sites pass
  none until the owning lane binds `reportAccountsUsage` and
  `reportAccountsEvents` (`ReportingWindowDeps` in
  `src/host/reporting/reportPanelEntry.ts`) and the same fields in
  `servicesFor` (`src/runtime/main.ts`). Those facets stay empty and named.
- The vault view has no production caller: the vault service lives in the
  lazy `dist/vault.js` bundle and commands refuse while closed, so no
  unlock-capable session is reachable from the report bundles. The vault
  lane must pass `reportVaultSnapshot` into the same two call sites. Until
  then the vault facets stay empty and named while the developer audit
  reports.
- Nothing removed or hidden by the 0.17.1 truth pass needed restoring:
  the README row this lane replaced ("future source bindings unavailable")
  was current text, and no command, setting or Help row for these kinds
  was removed.

## Red-drill receipts

Full runs at repository deadlines (`npx vitest run <files>
--maxWorkers=3`, at most three files per run). Restored byte-exact by
SHA-256; no red mutation is retained.

- Drill 1 (canary guard fires): leaked the audit target into the projected
  `kind` in `src/runtime/reporting/reportInputs.ts`. All four
  `reportSecurityCanary` cases failed. Restored to
  `1c83fe2991eca1d52316c38c9ba2f79a299c58784efdee905711b14567da40c0`.
  (Before RVCM1133 a variant leaking into the projected `outcome` stayed
  green by design, because the collector never rendered fact outcomes;
  since the Outcome column honestly renders outcomes, that variant fails
  the canary suite too.)
- Drill 2 (golden guard fires): renamed the vault state row in
  `src/core/reporting/collect/security.ts`. The security golden case
  failed. Restored to
  `f6ba0826634f51d90c089a85dcc34e1f3b6893d04f49c0b9678276a904a425f7`.

## RVCM1133 red-drill receipts (2026-10-11, this lane)

Each fix below was broken on purpose, the named test failed, and the
file was restored byte-exact (SHA-256 compared against a backup before
and after; no red mutation is retained). Base commit `a222a4187`.

| Finding                          | Breakage                                            | Named test failure                                                         | Restored SHA-256                                 |
| -------------------------------- | --------------------------------------------------- | -------------------------------------------------------------------------- | ------------------------------------------------ |
| P2 both-absent security          | re-added `return null` for vault+audit absent       | `reportSourceReasons` > security/both absent (1 failed, 10 passed)         | `2eea078c…e7ff8dd07d` (`reportInputs.ts`)        |
| P2 registry entries              | dropped the bad-entry `continue`                    | `reportSourceReasons` > one bad entry + no good entry (2 failed, 9 passed) | `2eea078c…e7ff8dd07d` (`reportInputs.ts`)        |
| P3 accounts Count                | `count(1)` back to `count(account.order)`           | `reportAccountsSecurityGoldens` > accounts golden (1 failed, 1 passed)     | `0cc74714…8035f5f2` (`collect/accounts.ts`)      |
| P3 security Outcome              | usage grouping back to `entry.authority`            | `collect.security` > vault aggregates case (1 failed, 3 passed)            | `85ce97f3…03f41ab03f883` (`collect/security.ts`) |
| P3 linked files                  | ELOOP mapping back to `failed`                      | `reportSourceReasons` > both linked cases (2 failed, 9 passed)             | `2eea078c…e7ff8dd07d` (`reportInputs.ts`)        |
| P3 vault before audit            | `keepReason` replaced with `throw invalid`          | `reportSourceReasons` > invalid vault keeps audit (1 failed, 10 passed)    | `2eea078c…e7ff8dd07d` (`reportInputs.ts`)        |
| Outcome-leak canary (cert claim) | canary snapshot outcome set to `canary-target-Z9x8` | `reportSecurityCanary` all 4 formats failed                                | `3a36585c…4c03d3c5448b` (`canaryVault.ts`)       |

## RVCM1133 gates (kubuntu, this lane)

- `npm run typecheck`: exit 0, all five projects (re-run after the dedup below).
- ESLint `--max-warnings=0` over every changed file: exit 0. Prettier: clean.
- `node scripts/check-l10n.mjs`: 0 problems (no new key; the fixes reuse
  the shared invalid/refused sentences and the existing detail reasons).
- `npx jscpd`: 0 clones. The first run of this round found 2: the new
  table test's repeated source-read tails (mine), and the e2e/unit
  developer-audit write block the lane's 0-clone claim missed
  (pre-existing duplication between two files this lane owns, byte-identical
  at the base `c51b6dc34`). Extracted `readAccounts`/`readSecurity` plus
  shared want blocks, and a shared `writeDeveloperAudit` fixture helper now
  used by the e2e setup, both unit reader files and the table test.
- `npm run deadcode` (knip): only the two pre-existing configuration hints.
- `npm run build`: every reporting budget holds (`reportInputs.js`
  87.8 KiB of 100 KiB, up 0.4 KiB for the reason propagation). One failure
  is pre-existing and untouched by this lane: `dist/usagePanel.js`
  75.1 KiB over its 75 KiB budget (identical size on the untouched base;
  no lane file feeds that bundle).

## Gates and results (kubuntu, this lane)

- Host, unit and e2e typechecks: exit 0.
- ESLint over every changed file: exit 0. Prettier: clean.
- `node scripts/check-l10n.mjs`: 0 problems (3 new reason strings in all
  15 tables).
- `gen-reference --check`: current. `gen-roadmap`: no diff.
  `check-host-api`: 0 problems.
- knip: no findings beyond the two pre-existing configuration hints.
  jscpd: 0 clones (one collector helper plus two shared test helpers
  extracted to remove the four this lane introduced). dpdm cycles: none.
- `npm run build`: every reporting budget holds (`reportInputs.js`
  87.4 KiB of 100 KiB). One failure is pre-existing and untouched by this
  lane: `dist/usagePanel.js` 75.1 KiB over its 75 KiB budget. Proven on
  the untouched base: a clean worktree at `a0b69a03b` with linked
  `node_modules` builds the identical 75.1 KiB (no lane file feeds that
  bundle; the new strings are not embedded in it). Left for the lead;
  no budget was changed.
- Unit suites at repository deadlines: collect.accounts (4),
  collect.security (4), accounts/security sources (8), inputs incl. the
  migrated sibling file (32 across the three files), canary (4), goldens
  (2), collect contract/determinism/facets (63), session source (11),
  engine/redaction/contracts/invariants/fixtures/schedule-action — all
  green.
- `test/e2e/reports.e2e.test.ts`: 24 of 24 green, including the two new
  live accounts/security cases.

## RVCM1133B repairs (2026-10-11, this lane, kubuntu rig)

Review round 2 left one P2 (a developer-audit parse failure throws
`invalid` for the whole security read, discarding accepted rows) and one
P3 (`readDataFile` never checks `nlink`, so a hard-linked registry or
audit reads like a normal file). Both are fixed as classes, not lines.

- P2 class: no read in `src/runtime/reporting/reportInputs.ts` discards
  rows it already accepted, or partial reasons it already collected,
  because one later record or one sub-source failed. Each registry entry,
  usage, event and confirmation row, vault item, grant and audit record,
  and developer audit line validates on its own and yields a row or a
  skip with the invalid reason; a registry, adapter, vault view or audit
  rotation that fails outright keeps its own true sentence
  (`failureReason`: the failure's own code, else the generic failure)
  beside the rows the other sub-sources still return. Only a missing
  registry file still reads as null (fresh install). New sub-source
  inventories (`ACCOUNTS_REPORT_SUB_SOURCES`,
  `SECURITY_REPORT_SUB_SOURCES`) name every consumed sub-source.
- P3: `readDataFile` refuses a hard-linked final component (`nlink !==
1`, like the sibling session reader) with a handle/path identity
  re-check against an open/lstat swap; the vault view's `state`/`tier`
  validate against `vaultStatusSchema` before use; every injected usage,
  event and confirmation row validates against its source row schema
  (newly exported from `src/core/reporting/sources/accounts.ts`) before
  use. Reasons carry only fixed sentences, so no secret, key material or
  vault item value can reach one; the resilience table asserts `{nope}`
  and `bogus` never appear in a reason.
- Behaviour changes locked by updated cases: a corrupt registry or audit
  is now partial with the invalid reason (adapters/rotations survive),
  not unavailable; a linked file is partial with the refused reason, not
  unavailable; a registry with no good entry is partial, not invalid; a
  snapshot with one bad item reports zero counts with the invalid reason
  instead of dropping the whole vault view.

## RVCM1133B red-drill receipts (2026-10-11, this lane)

Each guard below was broken on purpose, the named test failed, and the
file was restored byte-exact (SHA-256 compared before and after; no red
mutation is retained). Base commit `ce0be6648`.

| Finding          | Breakage                                              | Named test failure                                                                                                                 | Restored SHA-256                                         |
| ---------------- | ----------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------- |
| P2 audit lines   | bad-line skip back to `throw invalid` (both branches) | 7 failed, 31 passed: corrupt-audit, developerAudit unparseable/badRecord/wrongVersion, previous unparseable/badRecord/wrongVersion | `3f23191f…5d3185e9eb` (`reportInputs.ts`)                |
| P3 hard links    | `nlink` refusal replaced with `void`                  | 3 failed, 35 passed: registry/developerAudit/developerAuditPrevious unreadable                                                     | `3f23191f…5d3185e9eb` (`reportInputs.ts`)                |
| P3 vault scalars | state/tier pick replaced with pass-through            | 1 failed, 37 passed: vault wrong version                                                                                           | `3f23191f…5d3185e9eb` (`reportInputs.ts`)                |
| Coverage guard   | one resilience case deleted                           | 1 failed, 35 passed: covers every sub-source in every way it can fail                                                              | `c0b66c63…7d2844382a520` (`reportSourceReasons.test.ts`) |

The coverage drill's restore first landed the re-inserted case at the
array end and dropped the closing bracket; repaired by moving the block
back and re-adding the bracket, verified byte-exact by SHA-256 and a
clean `git status` before continuing.

## RVCM1133B gates (kubuntu, this lane)

- `npx tsc --noEmit -p tsconfig.json`: exit 0.
- ESLint `--max-warnings=0` over every changed file: exit 0. Prettier: clean.
- `node scripts/check-l10n.mjs`: 0 problems (no new key; the fixes reuse
  the shared invalid/refused/failed sentences and existing detail reasons).
- `npm run duplication` (jscpd): 0 clones. The first dense table
  introduced 18; extracted the shared reason context/assertion into
  `test/unit/helpers/reporting/reasonCases.ts`, one-line survivor
  assertions (`checkAccounts`/`checkSecurity`) and data-driven entries,
  and pointed the sibling reader suite at the shared context.
- `npm run build`: `dist/reportInputs.js` 91.4 KiB of its 100 KiB budget
  (was an unconfirmed 87.8 KiB). The only failure is the pre-existing,
  untouched `dist/usagePanel.js` 75.1 KiB over 75 KiB overage recorded
  above; no budget was changed.
- Unit suites at repository deadlines (`npx vitest run <files>
--maxWorkers=3`, at most three files per run):
  `reportSourceReasons` (38: 11 reason cases + 26 resilience cases + the
  coverage case), `reportInputsAccountsSecurity` + `reportInputs` +
  `reportSecurityCanary` (32), `accountsReportSource` +
  `securityReportSource` + `reportAccountsSecurityGoldens` (10),
  `collect.accounts` + `collect.security` (8) — all green.
- `test/e2e/reports.e2e.test.ts` (`--maxWorkers=1`): 24 of 24 green.
- No new dependency, no widened guard, no Meta endorsement change, no
  paid or live model call. Windows was not executed: hard-link cases use
  `fs.link` and reason assertions avoid separator compares, and the
  `nlink`/`sameFile` checks mirror the session reader that already runs
  on Windows CI.

## CM1133R4 / RVCM1133C repairs (2026-10-11, kubuntu)

Input branch `c/m113-3`, base `f58bbc3e8`. This round fixes all five P2
findings and the P3. Before changing the readers, `reportInputBoundaries.test.ts` injected failures across the actual
reader graph; its first run exposed null adapters, nested accounts/limits,
invalid vault scalars, missing-registry early return, short body reads and
row-limit rejection at final validation. Test preparation failures (a native
ESM spy and an inventory spelling mismatch) were corrected separately from
product failures. The first typecheck overlapped an exploratory test launch;
that excluded run is not the final verification receipt. Subsequent Vitest, tsc, ESLint and
production-build commands ran serially.

The mechanical inventory follows local helper calls from both reader factories
and the final source wrappers. It counts repeated boundaries, including both
file-identity checks and all collection sites, and connects each entry to a
real test title. Adding an awaited boundary or a reachable validation helper
without a case fails the inventory. Network bodies, pages and request limits
are absent from these local readers; their owning network suite is included
in the dependency replay. File bodies are exercised with ordinary stream
exceptions, later-read failures, invalid UTF-8, short reads, growing files and
unchanged byte caps. Each case goes through the real source's final validation.

| Review finding               | Repair                                                                                                                                                                                                                                                       | Regression oracle                                                                                  | Deliberate red drill                                                                               |
| ---------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------- |
| P2 unit typecheck            | Correct the union name, void setup return, required fixture row and exact optional properties; typed split-body mock has no implicit `any`.                                                                                                                  | All five repository typecheck projects.                                                            | Restore the nonexistent `ResilienceCase` type; unit compiler must reject it.                       |
| P2 nested account/limit loss | Validate provider metadata, account metadata and every limit independently; retain the strict stored-contract invalid disclosure and validate projected rows against the final source's own schemas.                                                         | `threshold records`, `registry records`, malformed threshold containers and future account fields. | Reintroduce whole-account-array validation in the provider envelope.                               |
| P2 vault view/audit loss     | Validate the envelope before access; parse the audit independently of state/tier. Isolate throwing snapshot getters and record validators.                                                                                                                   | `vault results/scalars`, `throwing snapshot facet`, `throwing record getters`.                     | Gate audits on valid state; drop undefined availability handling; rethrow record/facet exceptions. |
| P2 null adapters             | Both null and undefined results name usage or swaps/confirmations as unavailable; successful empty arrays remain successful reads.                                                                                                                           | `adapter results`, `usage absence`, existing empty-history case.                                   | Skip the null usage result without its unavailable reason.                                         |
| P2 unbounded collection      | Every row is admitted through the unchanged `REPORT_MAX_ROWS` cap, including limits, accounts, providers, injected histories, vault records and combined developer rotations. Byte caps take precedence where they cannot physically contain that many rows. | `row bounds ... final assembled validation`, byte bounds and growing-body cases.                   | Admit row 20,001 with `>` instead of `>=`.                                                         |
| P3 escape-hatch accounting   | Remove assertion-helper and fixture casts from the original table; all malformed ports use one test-only cast with an inline reason and PLAN §8 entry, optionally inferred from a valid exemplar.                                                            | `records the only malformed-port cast ...`.                                                        | Remove the helper's register entry; the accounting test must fail.                                 |

Additional guards: a missing registry still reads bound adapters, ordinary
short reads continue to EOF, accepted rows before and after throwing record
getters survive, and an unknown account field is disclosed instead of silently
accepted. The body-loop, exception and new-boundary inventory drills exercise
these siblings of the reviewed class. No live/captured vendor frame was added;
existing canary vault contracts and local synthetic fixtures are reused. No
credential access, network request, paid/live model call, dependency, hook,
cap or gate setting changed.

Final gate and byte-exact restoration receipts follow below.

### R4 byte-exact restoration receipts

Every test drill exited 1; the compiler drill exited 2 and included
the named `ResilienceCase` diagnostic. Every mutation was restored from
the exact original bytes in `finally`, then SHA-256 compared. No red mutation
is retained. The compiler also caught two preparation errors in the new
boundary fixture (union-key indexing and the overloaded file-read mock);
these were repaired with narrowed keys and a Buffer type guard, without casts.
The compact-provider fixture now reaches row admission within the unchanged
file-byte bound; its final admission drill proves that provider guard too.

| Drill                  | Named failures                                                                                   | Restored SHA-256                                                   |
| ---------------------- | ------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------ |
| nested-account         | threshold records / registry records / row bounds: 16 failed, 129 passed                         | `6fdb45c94a01219de9f6336471ec0cb9c00c44fb220a9ad66ec2db500f635a8c` |
| vault-audit            | vault results/scalars (bogus state), throwing snapshot state: 3 failed, 142 passed               | `6fdb45c94a01219de9f6336471ec0cb9c00c44fb220a9ad66ec2db500f635a8c` |
| vault-undefined        | vault results/scalars (undefined): 1 failed, 144 passed                                          | `6fdb45c94a01219de9f6336471ec0cb9c00c44fb220a9ad66ec2db500f635a8c` |
| null-adapters          | usage absence (null): 1 failed, 144 passed                                                       | `6fdb45c94a01219de9f6336471ec0cb9c00c44fb220a9ad66ec2db500f635a8c` |
| row-admission          | usage/events/confirmations/limits/accounts/vault row bounds: 8 failed, 137 passed                | `6fdb45c94a01219de9f6336471ec0cb9c00c44fb220a9ad66ec2db500f635a8c` |
| split-body             | split body reads: 1 failed, 144 passed                                                           | `6fdb45c94a01219de9f6336471ec0cb9c00c44fb220a9ad66ec2db500f635a8c` |
| escape-register        | malformed-port escape register: 1 failed, 144 passed                                             | `1cbc5dbd041d30d43ebe25fbcd4a91f96bb600ef4cacb239ebb84e215169a289` |
| inventory-new-boundary | mechanical boundary inventory: 1 failed, 144 passed                                              | `6fdb45c94a01219de9f6336471ec0cb9c00c44fb220a9ad66ec2db500f635a8c` |
| record-exception       | throwing record getters (all six record streams): 6 failed, 139 passed                           | `6fdb45c94a01219de9f6336471ec0cb9c00c44fb220a9ad66ec2db500f635a8c` |
| snapshot-exception     | throwing snapshot facets (all five): 5 failed, 140 passed                                        | `6fdb45c94a01219de9f6336471ec0cb9c00c44fb220a9ad66ec2db500f635a8c` |
| unit-typecheck         | ResilienceCase compiler diagnostic: compiler exit 2                                              | `d52255a527dee72e324c294d91907f654ad8c3dc8b5a2fccc28c954ce4d50b67` |
| final-admission        | all nine reachable row-bound cases, including the compact providers fixture: 9 failed, 98 passed | `e550b928bede5d5e4d146ecc8b2d94694a36544b24c9bab36ee6f15db0668f0b` |
| account-facet          | throwing account facet events plus inventory: 2 failed, 107 passed                               | `b46e5d9fe7550b2b344010b5628125d5033b9688a0369ecce7b48098080a440e` |
| validation-split       | bundle split rejects unavailable zod/mini.omit: gate exit 1                                      | `8014b96446ba8de43eeafc1c31cc727835130065d56ad7927340ec4d6bd6ca66` |

The final sweep added two account-result getter cases. Before their source
repair, `throwing account facet events retains its sibling and earlier reasons`
failed (1 failed, 108 passed): confirmations vanished. The same per-facet
reader used for vault snapshots now isolates events and confirmations too.
The follow-up deliberate guard removal failed in the named regression and
mechanical inventory, then restored the source byte-exact as recorded above.

### R4 final dependency and host replay

All tests ran directly on kubuntu, serially between commands, at repository
default timeouts with `--maxWorkers=3` and at most three files per run. No
suite was blocked or skipped. No Windows/macOS or installed-editor
qualification is claimed; path comparisons normalize Windows separators.

`npx vitest related --run src/runtime/reporting/reportInputs.ts
src/core/reporting/sources/accounts.ts src/core/reporting/sources/security.ts
--shard=N/6 --maxWorkers=3` ran every N from 1 through 6: 24, 26, 115,
66, 25 and 21 passed tests, with the one inherited exact-money failure in
shard 5. Total: 277 passed, 1 inherited failure; 16 passing files and 1
failing file. The selected unit files were accountsReportSource,
agentUsageSource, changelogSource, gitSource, paidMoneyStructure,
reportEngine, reportInputBoundaries, reportInputs,
reportInputsAccountsSecurity, reportNetworkBinding, reportSecurityCanary,
reportSourceReasons, reportsEntry, reportsHost, securityReportSource,
sessionReportSource and spawnBoundaries (each `.test.ts`).

Additional owning-host coverage: reportInputBoundaries + acpReports +
reportAccountsSecurityGoldens: 117 passed; collect.accounts +
collect.security + test/e2e/reports.e2e.test.ts: 32 passed, including all
24 fake-only CLI cases. Removing the repeated boundary suite gives 317
passing tests and the one inherited failure across 22 unique files.
The final boundary/reason/reader replay passed all 153 tests after the two
new fixture callbacks were changed to explicit Promise returns to satisfy
`require-await`; no lint rule was suppressed or weakened.

The exact-money failure still names only unchanged fields:
`core/usage/journalStore.ts:{apiEquivalentUsd,usd}` and
`core/usage/reportingAmount.ts:{capUsd,spentUsd,uncertainUsd}`. The owner
expressly excluded this inherited failure; its guard and fields are untouched.

The separate production split check exposed `zod/mini.omit` and
`zod/mini.pick` calls absent from the shared shipped validation bundle.
Account metadata and vault view projection now reuse the original individual
field schemas directly. Their accepted values, strict vault view and final
source caps are preserved; no validation export or split guard was changed.
The additional validation-split red drill above restores the final reader
byte-exact. These production-compatible forms receive the full dependency,
ACP/CLI and five-project compiler replay below.

Final production-compatible source replay: the same six dependency shards
again passed 277 tests with only the unchanged exact-money failure.
acpReports + reportAccountsSecurityGoldens + collect.accounts passed 12;
collect.security + all 24 fake CLI cases passed 28. Total remains 317
passed, one inherited failure, across all 22 selected/owning files.
Changed-file ESLint again exited 0 after direct field-schema reuse.

### R4 scoped gate receipts

- Final `npm run typecheck`: exit 0 for host, webview, unit, e2e and
  integration, after the production-compatible schema projection.
- Changed-file ESLint `--max-warnings=0`: exit 0. All 12 changed files
  passed Prettier. Plain knip, jscpd and cycles exited 0; duplication
  reported zero clones. No ignore, rule, threshold or hook changed.
- Localization, host API, reference, roadmap and plan checks: exit 0.
  No new localization key, command, setting or feature catalogue entry.
  The existing M113 roadmap entry was updated and regenerated.
- Final `npm run build`: exit 1 only for the owner-excluded, unchanged
  `dist/usagePanel.js` 76,938 bytes against 76,800 (138 bytes over).
  `dist/reportInputs.js` is 95,599 bytes, 93.4 KiB against 100 KiB.
- The checks after the budget step ran separately: bundle split, host
  globals and third-party notices each exited 0. A smoke check loaded the
  actual production `dist/reportInputs.js` and shared English bundle:
  account metadata and its valid spend limit survived an invalid request
  limit; the vault view parsed its original state/tier. Both passed.
  Its isolated scratch directory was removed in finally.
- Aggregate `npm run quality` is explicitly lead-owned and was not run.
  No UI/CSS paint changed; no visual or installed-editor qualification
  is claimed. No live or paid call, credential read, network call,
  dependency change, hook edit, push, merge or rebase was performed.
- Mandatory final verification extended slightly past the 90-minute box
  after the production split repair; implementation was already finished.
