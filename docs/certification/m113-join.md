# M113 REPORTJOIN — integration and engine guarantees

## Accepted merges

The continuation starts with 6ae6f2142 (session, usage, project, release) and
837091cf3 (keybindings). Store/workflow/release adapters at 131614364 are
merged next. Existing uncommitted test-helper extraction was inspected and
retained. No captures or their byte hashes were rewritten.

Initial default-timeout verification on kubuntu: 647 tests pass across
sessionReportSource, paidMoneyStructure and githubWorkflowReleaseIsolation;
all 15 additional merge/helper suites pass in serial batches of at most three.
The train already supplies exact decimals for the five reviewed money leaves.
`npm run build` passes every unchanged cap and split check; `npm run duplication`
reports zero clones. Scoped qualification follows the explicit rig brief;
aggregate quality remains lead-owned.

Initial bundle bytes: `{"modelApi.js": 530683, "reportInputs.js": 72030, "reporting.js": 163442, "reportingDestinations.js": 55701, "reportingNetwork.js": 65585, "reportingPanel.js": 46860, "usagePanel.js": 74233}`.

## Remaining work

Accounts/security merge; request language, protected boundaries, row admission,
reporting exact-money proof, cooperative cancellation, dormant availability
and final registry/dependent qualification remain pending. Later playbook,
schedules and estimate branches remain held until reviewed SHAs arrive.

Accounts/security merge conflict review retains the train’s held vault and
schedule catalogue entries and translated descriptions. Generated reference,
roadmap and host API records are regenerated from the merged source. The new
accounts/security goldens carried older sentence-case labels; regeneration
intentionally uses the train’s installed Title Case English labels. No
report fact, content hash or visual UI baseline changes for this repair.

## Guarantee (c): final row admission

`collect/common.ts:section` admits rows at the display/final-schema limit,
including source disclosures, and increments `omittedRows` for every refusal.
The existing renderers name that exact count in the request language. Original
keys and duplicate evidence survive; ties sort canonically before allocating
suffixes. The kind registry also supplies forwarded headings.

`reportEngineBounds` enumerates all 15 kinds and 75 declared sections; all
75 exact-cap/disclosure/final-document cases pass. Existing identity and
determinism suites pass after adapting the two older forwarded fixtures to
real accounts/security facts. The executable row-call inventory now covers
accounts/security and keybindings factory calls: 134 tests pass.

Deliberately admitting one excess full row fires all 75 bound cases. Byte-exact
restoration SHA-256: `454615f4bb528afaff4ac20102144e646e8e8a6e8e3c76bdad336689af0d7de0`;
drill log SHA-256: `300e757526e82e734156c7ae319df29144831b17faaee82929baa5b7e491d058`. No schema cap moves.

## Guarantee (a): request language

The engine captures the request table and locale before its first await and
passes `SourceReadContext.reportText` through every local/network reader,
including the lazy input bundle. Usage reasons also receive this table.
Network bindings are per generation; cache storage remains shared. Other
report operations capture their error text before asynchronous work.

`reportEngineLanguage` enumerates all 15 kinds: 15 overlapping English/Spanish
generations resolve in reverse order, and 15 registry-derived source/collector
import checks pass. The separate-bundle German input regression, source inputs,
usage and history suites pass at repository deadlines; changed-file lint and
host typecheck pass. Two deliberate mutations fire the language and structural
guards, respectively; both source files restore byte-exactly.

- request-table: `src/runtime/reporting/engine.ts`, restoration `7769db65d9b85543f9e2d709edfb68c2ee77cca3a5fcd91e907fb4e1cb067e9c`, red log `efb0f2d6699ed47362c419c421c7a85e1bcd85ec1078c55ed0f9412eac4f4b8b`.
- structural-table: `src/core/reporting/sources/local.ts`, restoration `f975d467d035741573429d6a2ce8dd7f7a5e5866ba57d20d27cc7e09e854ce9c`, red log `1b767647e561358a28cee6dbe8b2c16decc65e85ecba47b7264dff8e100fbedb`.

## Step-1 reds, resolved on the merged tree

- `sessionReportSource`: the remaining red was `cancels a reader that
ignores the signal and enforces the per-source timeout`. Cause: guarantee
  (e) replaced the old abort race with a pure await of the read's own
  settlement, so a reader that never settles hangs past the 5 s timeout.
  Fix (`d8a32f4cc`, `src/core/reporting/sources/local.ts`): `localSource`
  races the read against the handed deadline only; a user abort still awaits
  the cooperative read's own settlement, while a signal-ignoring reader
  cannot outlive the per-source timeout. `sessionReportSource` (14) and
  `reportEngineCancellation` (62) pass together; neither guarantee moved.
- `paidMoneyStructure` (line ~1143): resolved to the train's exact-decimal
  form; the five reviewed leaves (`journalStore.ts` `apiEquivalentUsd`,
  `usd`; `reportingAmount.ts` `capUsd`, `spentUsd`, `uncertainUsd`) are
  exact decimals, guarded with no allow-list.
- `usagePanel.js`: inside its unchanged cap on the merged tree; final bytes
  in the proof section below. No cap moved.
- `usageIntegration.test.ts`: the case that times out at 5 s on busy
  machines also does so on main; named in the final lane report, not fixed
  here.

## Guarantee (b): the engine owns every boundary

`src/core/reporting/sources/boundary.ts` exposes `readReportField`,
`awaitReportRead`, `readReportRows`, `readReportSource` and
`readReportFacts`. Kind readers admit rows through `readReportRows`
(`collectValidRows` in `reportInputs.ts` delegates with remaining
capacity); kind sources decode facts through `readReportFacts`
(`accounts.ts`, `security.ts`); the engine wraps every port read in
`readReportSource`. Each kind's own partial guard is deleted; their tests
stay and pass. RVCM1133D closes in the helpers, for every kind:

- (i) `readReportRows` reads length and each index inside its own
  protection and never touches the iterator: `[valid, throwing slot,
valid]` keeps both valid rows with one named problem, and later facets
  still read. Proven by `reportEngineBoundaries` (every kind ×
  slot/iterator/length) and `reportJoinAccounts` through the real
  accounts/security readers.
- (ii) `localFailureOf` is total: brand, code and prototype access on a
  caught value happen inside its guard and degrade to the generic named
  problem. Proven with throwing brand/code/prototype getters, including an
  `Error` carrying a throwing code getter on a rejected read.
- (iii) Admission reserves the disclosure: `section`/`sourcedSection` admit
  at the final-schema bound with `omittedRows` named. Proven end to end
  (reader, source, collector, section validator, final document schema) for
  every kind and every section by `reportEngineBounds` (15 kinds, 75
  sections), plus the exact-cap and combined-limits cases in
  `reportJoinAccounts`. No schema limit moves.
- (iv) Absent-facet names come from the request table
  (`reportText.reportLabels`), never English identifiers. Proven with the
  Spanish table: the sentence carries `Uso, Cambios de cuenta,
Confirmaciones`, never `usage, swaps, confirmations`.

Deliberately replacing per-slot isolation with an unguarded iterator fires
150 of 180 boundary cases. Byte-exact restoration SHA-256:
`f6b16ba11613f115e6f45173dc32a02533a9ac2904ad6d8232a91d9b6b0c61c6`;
drill log SHA-256:
`0f96b215ab2a4f7d5a4de842435e8d9103d0b7a3e83ca116a8b856364acd0a82`.

## Guarantee (d): exact money, source to text

No amount under `src/core/reporting` or `src/runtime/reporting` is a
JavaScript number: `UsdAmount` (branded string) from journal to rendered
cell, sums and currency formatting included. `reportExactMoney` proves it
twice: a type-checker inventory over every reporting file with no
sanctioned exception, and an end-to-end decimal case
(`9007199254740993.000000001`) through `usageReportFacts`. The five
step-1 leaves are exact at the journal boundary, so `limitDollars`-style
crossings cannot return. Two drills: reintroducing the historical
`limitDollars` crossing fails the decimal case (restoration
`a85f9e3ccdbe497ae11acd72f2a65e3fffc05a30a5b32dbee3e6867a28beda62`,
red log
`1cb62aae7eae9339ea8f564cd5752decf08c56d921de8ac939a9e269e588acde`);
a numeric `spentUsd` leaf in a reporting file fails the inventory with
`core/reporting/collect/usage.ts:spentUsd` (restoration
`a8027c3a740ccdb2766f0304ee753aa3ff90a13fd99148b556ae42eac4b54dc2`,
red log
`d62545dd962917bbc50adc9c0ca962841a961ea9cb36e0a76eff3cb59f7f53f7`).
Scope note: the inventory names declared shapes (properties, aliases,
literal-initialized money variables); a numeric local built by a call
expression is rejected by the typechecker at the `UsdAmount` use site,
because the brand admits no plain number.

## Guarantee (e): a cancelled or timed-out read stops

The engine hands every source one `AbortSignal` and one deadline
(`engine.ts`); `localSource` enforces the handed deadline (defaulting to
`REPORT_SOURCE_TIMEOUT_MS` for older callers), awaits a cancelled
cooperative read through its own settlement instead of abandoning it, and
reports a resource held by a valid writer as `busy` (never cancelled).
`reportEngineCancellation` enumerates all 15 kinds: no read starts past an
abort, no resource call happens after the abort, post-abort settlement is
awaited, held resources read busy, the handed deadline (not the default)
is enforced, and repeated refreshes leave no waiting admission readers.
Removing the upfront abort check fires the 15 per-kind no-start cases.
`src/core/reporting/sources/local.ts` restoration SHA-256:
`13c1747b91d7e45d3a936b6e1dd00b6b8c1d330f5b6e5841cc76117dc71b17e5`;
drill log SHA-256:
`3bb56015c84a37c8a20e0ec9e0cc90a89df54f73704addef69f2b026c89443a9`.

## Step 3: availability

`REPORT_WORKING_KINDS` is the switch: ten working kinds
(`project`, `milestone`, `release`, `changes`, `quality`, `usage`,
`session`, `keybindings`, `accounts`, `security`); five stay dormant
(`playbook`, `issues`, `estimate`, `fleet`, `schedules`). Parsers and
history keep accepting every kind, but no Help, picker, README or command
mentions a dormant one; unbound kinds answer `unavailable` with
`unsupportedKind`/`unbound` wording pinned in 15 languages. `cx1r4Truth`
compares the flip against the register in both directions (working kinds
present in the ACP entry, dormant kinds absent; `REPORT_WORKING_KINDS`
exactly equals the ten). `cx1r2Truth` asserts no `/report <kind>` for the
five dormant kinds; `reportingPanel` asserts the ten-entry picker. Left
off: the five dormant kinds.

## The one-page rule a kind's author follows

1. **Language travels with the request.** Take every sentence, label and
   reason from `context.reportText`. Never import the process-wide table
   (`UI_TEXT`, `setUiText` reads) in a kind file: the structural test
   lists kind files from the registry and fails the import.
2. **Never discard good rows.** Return rows plus problems through the
   engine helpers: `readReportRows` for arrays (length, slots and iterator
   are guarded; a throwing slot is one named problem), `readReportField`
   for scalars, `awaitReportRead` for awaits, `readReportFacts` for whole
   facts. A facet with nothing valid is named unavailable in the report's
   language (labels from `reportText.reportLabels`); never an empty
   section, never a silent null. There is no opt-out: the source type
   returns rows plus problems.
3. **Rows carry identity and stop at the cap.** Admit through
   `collectValidRows` (readers) or `section`/`sourcedSection` (collectors)
   at `REPORT_MAX_ROWS`; limit rows admitted, limit-plus-one refused with
   `omittedRows` named. Identity is (kind, source key); two generations
   over the same data are byte-identical.
4. **Money is `UsdAmount`, never `number`.** From the journal to the cell,
   sums and formatting included. The inventory fails any numeric money
   leaf in a reporting file; the brand plus typecheck rejects the rest.
5. **Observe the signal and the deadline.** Do one abort-aware read per
   source; after an abort start no further read, write or publish. A
   resource held by a valid writer reports `busy`, not cancelled.
6. **Land dormant.** New kinds arrive outside `REPORT_WORKING_KINDS` with
   no Help, picker, README or command line; the register's lines return
   only when the lead flips the switch, in all 14 tables.

## Proof

Production build exits 0; all 157 size rows ok, no cap moved. Exact
bytes on the merged tree: `modelApi.js` 530683 (budget 537600, byte-
identical with the train: nothing added to the Model API bundle),
`reportInputs.js` 98267 (102400), `reporting.js` 175861 (179200),
`reportingDestinations.js` 55630 (76800), `reportingNetwork.js` 67731
(76800), `reportingPanel.js` 47412 (51200), `usagePanel.js` 74233
(76800; the report line's 76938-byte, 138-over red stays inside on the
train's diet), `validation.js` 47933 (51200).

- Suites (repo default timeout, `--maxWorkers=3`, serial batches of at
  most three files): every merged kind's report suites, `reportEngine`,
  the five registry-enumerated guarantee suites (`reportEngineLanguage`
  30, `reportEngineBoundaries` 180, `reportEngineBounds` 75 sections,
  `reportExactMoney`, `reportEngineCancellation` 62,
  `reportJoinAccounts`), all collectors, inputs, sources, goldens,
  adapters, stores, destinations, truth and panel suites green. Two
  load flakes re-ran green alone (`reportHistory` 37; rig load 14-30).
  One inherited red stays, as briefed: `usageIntegration.test.ts`
  `settles two vendor host turns and one MSP subscription turn …`
  expects HTTP 401 from the panel harness, observes 502 on the busy
  rig; the failure is in the HTTP-auth harness before any report logic
  and no file this lane changed serves HTTP. Not fixed here.
- Dependents: every suite importing a changed non-hub source, plus the
  hub-naming suites (`cx1r4Truth`, `cx1r2Truth`, `reportingPanel`) for
  `REPORT_WORKING_KINDS`. HUB: `src/shared/constants.ts`,
  `src/shared/l10n/en.ts`, `src/shared/featureCatalog.ts`, generated
  reference/roadmap/schema files.
- Gates: all five typechecks exit 0; eslint `--max-warnings=0` clean
  over all 191 lane-changed files; prettier clean; cycles zero;
  duplication zero clones; `check:l10n` 0 problems (14 UI + 14 usage
  tables); `check:reference`, `check:host-api`, `check:roadmap` green;
  `schema:report` regenerated for the merged label keys.
- Not green: `knip` reports 12 unused exports, all in
  `src/core/vault/broker/windowsPipe.ts` (9 constants/schemas, 3
  interfaces), inherited via the c/m113-3 merge. That file is M109's
  Windows pipe wire contract for the pending C-M109-1c C# helper,
  documented in `docs/design/vault-windows-pipe-helper.md`; deleting or
  de-exporting another lane's cross-language contract to green the gate
  would be destructive, and adding ignores would weaken the gate. Left
  for the vault lane with the lead's decision. No other knip findings.
- Live e2e (`reports.e2e.test.ts`) not run here: it bills the owner's
  key; its one stale (iv) assertion was updated to the installed
  labels for the lead's run.
