# M113 lane 0 — contracts, strings, fakes (lead)

2026-10-06, Windows rig win11, branch m113/l0, base 2aa9cbff,
worktree C:/lanes/M113L0. Scope and signatures are in
[m113-contracts.md](m113-contracts.md). The brief and shared rules were read
before edits. The lead owns review/freeze and full integration certification.

## Observed validation

- Four owned unit files: reportContracts.test.ts, reportFixtures.test.ts,
  reportSchema.test.ts and reportStrings.test.ts; 51 tests passed. Runs use
  the repository's default timeout, at most three files and maxWorkers=3.
- All five projects in npm run typecheck passed.
- ESLint on every changed TypeScript file passed with zero warnings.
- Plain knip passed; jscpd found zero clones without changing its threshold.
- The host API gate reports zero problems and the help reference is current
  (53 features, 44 commands, 59 settings, 26 slash commands, 116 CLI rows).
- Prettier's explicit check of all 46 changed files passed.
- Production `npm run build` passed the unchanged size, split, host-global and
  third-party notice gates: extension 439.5 KiB, Model API 446.9 KiB, ACP
  821.5 KiB, webview startup 797.6 KiB, deferred webview JavaScript 50.0 KiB,
  core English 53.3 KiB and lazy surfaces English 4.8 KiB. This lane adds no
  report engine or panel bundle; W measures those when it wires their entries.
- Implementation commit `de30f7a69558d837ef2605879dd2c65bd3d7f4eb` ran the
  repository's normal lint-staged ESLint/Prettier and gitleaks hooks. They
  passed; gitleaks found no leaks. The worktree was clean after that commit.
- The translation assertions check all 14 locales with strict existing
  tableProblems, including slots, plurals and untranslated values. The runtime
  German test uses the real installed-table loader and restores English.
- node scripts/check-l10n.mjs reports exactly seven problems, all unused
  manifest keys because package.json belongs to W. The report UI tables have
  zero translation problems. No localization ignore or gate was changed.
- The real Git fixture initially failed its date-string assertion because this
  Git build writes UTC as Z. The assertion now recognizes Z and +00:00 as the
  same offset; fixed dates, identities and identical commit hashes still hold.
- No npm run quality or full unit run: common.md explicitly reserves the full
  gate for the lead. No network, credentials, model attempts or paid calls.

## Deliberate breaks

Each mutation ran its complete owning unit file (and the schema file for
contract changes), without filtering tests or raising timeouts. A named
semantic assertion failed with exit 1. The original file was restored in
finally from its saved bytes and SHA-256 compared. All 33 mutations below
were observed to fail; logs and machine-readable receipts are in the ignored
temp/m113-drills folder on this rig.

Two initial drill runs exposed assertions that tested overlapping guards:
the Needs-you invariant also rejected a translated label, and unresolved row
references also rejected an empty source list. Dedicated ordinary-section
label and reference-free empty-source assertions now isolate those guards;
both then failed under their corresponding mutations. These setup attempts
are not counted as semantic receipts for those guards.

| Mutation          | File                                        | Named failing assertion           | Exit | Restoration |
| ----------------- | ------------------------------------------- | --------------------------------- | ---: | ----------- |
| strict            | `src/shared/reportSchema.ts`                | rejects unknown fields            |    1 | exact       |
| labels            | `src/shared/reportSchema.ts`                | rejects foreign versions          |    1 | exact       |
| version           | `src/shared/constants.ts`                   | accepts the shared shape          |    1 | exact       |
| kind              | `src/shared/reportSchema.ts`                | rejects foreign versions          |    1 | exact       |
| sort-key          | `src/shared/reportSchema.ts`                | rejects foreign versions          |    1 | exact       |
| hash              | `src/shared/reportSchema.ts`                | rejects foreign versions          |    1 | exact       |
| timestamp         | `src/shared/reportSchema.ts`                | rejects foreign versions          |    1 | exact       |
| reason            | `src/shared/reportSchema.ts`                | requires an honest reason         |    1 | exact       |
| freshness         | `src/shared/reportSchema.ts`                | cannot claim freshness            |    1 | exact       |
| uniqueness        | `src/shared/reportSchema.ts`                | unique sections                   |    1 | exact       |
| column-membership | `src/shared/reportSchema.ts`                | every row cell                    |    1 | exact       |
| column-count      | `src/shared/reportSchema.ts`                | every row cell                    |    1 | exact       |
| source-reference  | `src/shared/reportSchema.ts`                | every row cell                    |    1 | exact       |
| needs-you         | `src/shared/reportSchema.ts`                | Needs you first                   |    1 | exact       |
| source-list       | `src/shared/reportSchema.ts`                | cannot claim freshness            |    1 | exact       |
| row-cap           | `src/shared/constants.ts`                   | bounds document arrays            |    1 | exact       |
| text-cap          | `src/shared/constants.ts`                   | bounds document arrays            |    1 | exact       |
| column-cap        | `src/shared/constants.ts`                   | bounds document arrays            |    1 | exact       |
| section-cap       | `src/shared/constants.ts`                   | bounds document arrays            |    1 | exact       |
| source-cap        | `src/shared/constants.ts`                   | bounds document arrays            |    1 | exact       |
| id-cap            | `src/shared/constants.ts`                   | bounds document arrays            |    1 | exact       |
| id-grammar        | `src/shared/reportSchema.ts`                | bounds document arrays            |    1 | exact       |
| count             | `src/shared/reportSchema.ts`                | bounds document arrays            |    1 | exact       |
| cost              | `src/shared/reportSchema.ts`                | keeps cost certainty              |    1 | exact       |
| storage-key       | `src/shared/hostApi/reports.ts`             | validates run, history and open   |    1 | exact       |
| history-cap       | `src/shared/constants.ts`                   | validates run, history and open   |    1 | exact       |
| bridge-failure    | `src/shared/hostApi/reports.ts`             | validates run, history and open   |    1 | exact       |
| schema-drift      | `docs/schemas/report-v1.schema.json`        | matches the generated JSON Schema |    1 | exact       |
| fixed-git-date    | `test/unit/helpers/reporting/repository.ts` | produces identical commit objects |    1 | exact       |
| journal-copy      | `test/unit/helpers/reporting/snapshot.ts`   | injectable clock, journal         |    1 | exact       |
| translation       | `l10n/ui.cs.json`                           | has real cs translations          |    1 | exact       |
| bridge-strict     | `src/shared/hostApi/reports.ts`             | validates run, history and open   |    1 | exact       |
| columns-nonempty  | `src/shared/reportSchema.ts`                | bounds document arrays            |    1 | exact       |

The restored SHA-256 values at the drill boundaries:

- `src/shared/reportSchema.ts`: `61c5124551007f9c240eaa39508fb4a9e4eb14f072c3f8bd4ddcb14225bd757e`
- `src/shared/constants.ts`: `d3149a7efee383cc6996d0feb7ed6b15e66116d6a8970a4a8f53de414d30dec4`
- `src/shared/hostApi/reports.ts`: `fd448b9af751d79f72f6e43f69eea0d9f1b19403771e40b8a1a45ed5c4ee370e`
- `docs/schemas/report-v1.schema.json`: `98720dc06b790fed417c4a69af95c66492737f3a28c9b2e1ab335746ae0bb766`
- `test/unit/helpers/reporting/repository.ts`: `ec714221db57e46f0810a36e456c7b02696cd1575145eb90189bc773f6814fff`
- `test/unit/helpers/reporting/snapshot.ts`: `e30fb062a1707efea5411764899e75ccf2a363e08c13df2ae41e60aed1c1ad75`
- `l10n/ui.cs.json`: `fed395a802fc44e398d847a123a85b28e60344e6ebb4b016d0365116e9574b93`

## Integration gaps, deliberately not hidden

1. **Manifest wiring.** Seven package.nls keys are translated in English and
   all 14 languages but cannot be referenced without editing W's package.json.
   The brief says not to edit another lane's files. A ruling was requested;
   no approval is assumed. W must register the prepared title/settings before
   check:l10n can be green. The gate's unused-key check stays intact.
2. **Capture provenance.** This base and the shared context contain no approved
   recorded store responses or actual GitHub rate-limit headers. M71's existing
   recorded pull/check bodies are reused. Headers are explicitly synthetic
   fault injections, and missing stores remain unavailable. N/lead must supply
   captures before writing the new service parsers (AGENTS rule 14).
3. **W-owned docs/reference/gates.** No command or setting is registered here.
   Catalogue, README, CHANGELOG, ACP/CI/security/privacy, host inventory and
   bundling changes stay with W. The exact entries and defaults are named in
   m113-contracts.md; no unsupported feature is advertised in help.
4. **Missing milestone bindings.** M102, M112 and M104 are absent on this base.
   The normalized injected ports are real contracts, with no production fake.
   The regional report strings use the existing lazy surfaces fallback until
   M102 supplies the second-table family. R owns the schema CLI; the committed
   schema and entry already have a freshness test.

## RVM113L0 fixes — 2026-10-06, win11

Read the entire rig brief, common rules and RVM113L0 review. Fixed all four
P2 and both P3 findings; **no review residuals**. No dependency, transport
handshake, source-service parser, registered command or setting was added.
The existing P/S/K/R/N/H/X/W implementation handoffs remain; this certifies
the contracts, fakes and vocabulary, not the unbuilt renderer or native host.
PLAN D93/M113 and §9 now record the lead's decisions. README, catalogue and
CHANGELOG wiring remains W-owned; the exact Unreleased fixed-entry handoff
is recorded in m113-contracts.md.

| Finding                   | Fixed contract                                                                                                                                   | Regression test                                                                                                           | Drill                                          |
| ------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------- |
| P2-1 missing declarations | PlanMilestone.requiredGates; package.qualityScripts with declared names/commands, never executed                                                 | retains required milestone gates and declared package scripts even before any run                                         | P2-1-required-gates; P2-1-script-command       |
| P2-2 lost session facts   | Actual activity turns and approved/denied/auto/expired counts from the portable export's history source; unavailable is independent and reasoned | retains actual turns and approvals independently of a flattened portable transcript                                       | P2-2-decisions; P2-2-unavailable-reason        |
| P2-3 unscoped CI          | Per-run ref kind/name, SHA, workflow, conclusion and URL; pending and future conclusions retained                                                | keeps green HEAD, failing default-branch and pending release CI separately attributable                                   | P2-3-ref-scope                                 |
| P2-4 inaccessible history | reports/get and reports/compare under history's same workspace/kind authorization; strict structured row diff                                    | retrieves saved ids and compares row fields within history authorization scope                                            | P2-4-saved-id; P2-4-compare-diff; P2-4-row-key |
| P3-1 hash scrub order     | Scrub canonical output, then hash; only /header/contentHash exempt by schema path; hash input excludes /header/asOf and itself                   | scrubs canonical output before hashing and exempts only the structural hash                                               | P3-1-hash-path; P3-1-hash-input                |
| P3-2 missing labels       | inputTokens/outputTokens/cachedTokens/current/lagging in the enum, English and all 14 translations                                               | labels input/output/cache totals and current/lagging stores through the closed vocabulary; strict per-locale translations | P3-2-label; P3-2-translation                   |

The normalized-fact schemas are application contracts, not guessed upstream
wire parsers. Tests retain required-but-never-run gates, both-message/one-turn
facts, two histories with identical exports but different actual activity,
unknown history with reasons, green HEAD beside failing main and a pending
release, saved documents across reconnects, denied workspace/kind/missing-id
selection, Windows separators and invalid ids. The hash handoff test uses
M84's actual scrub with a synthetic registered credential shape and a source
64-hex digest, preserves the structural hash through a second scrub, verifies
the scrubbed hash and excludes asOf. Canonical ordering and production hash
verification remain R's acceptance work.

Observed before committing: 57 owned tests passed (40 in the contracts,
fixtures and schema run; 17 strings), default repository timeouts and at most
three files/maxWorkers=3. All five typecheck projects and changed-file ESLint
passed. Host API: zero problems; help reference current. Localization still
reports exactly seven pre-existing unused manifest keys assigned to W, with
all 14 UI tables passing; no guard or ignore was widened. The dead-code gate
caught a new unused ReportDiff type; it was removed rather than ignored.
Final scoped gate results are recorded below after verification.

### Review red drills

All 13 mutations ran the complete owning test file, with no test filter or
timeout override. Each named regression failed with exit 1. A finally block
restored the original file bytes and verified SHA-256 equality. The additional
facts-strict mutation proves normalized source boundaries reject extra fields.
Logs and receipts: ignored temp/m113-review-drills on this rig.

| Mutation                | File                                  | Named failing test                                                                        | Exit | Restored SHA-256                                                   |
| ----------------------- | ------------------------------------- | ----------------------------------------------------------------------------------------- | ---: | ------------------------------------------------------------------ |
| P2-1-required-gates     | `src/core/reporting/sources/types.ts` | retains required milestone gates and declared package scripts even before any run         |    1 | `6e7a8a4512e0e3727e5b6b918162b05a72af1e7e136c9b3c8c982b217a2af57c` |
| P2-1-script-command     | `src/core/reporting/sources/types.ts` | retains required milestone gates and declared package scripts even before any run         |    1 | `6e7a8a4512e0e3727e5b6b918162b05a72af1e7e136c9b3c8c982b217a2af57c` |
| P2-2-decisions          | `src/core/reporting/sources/types.ts` | retains actual turns and approvals independently of a flattened portable transcript       |    1 | `6e7a8a4512e0e3727e5b6b918162b05a72af1e7e136c9b3c8c982b217a2af57c` |
| P2-2-unavailable-reason | `src/core/reporting/sources/types.ts` | retains actual turns and approvals independently of a flattened portable transcript       |    1 | `6e7a8a4512e0e3727e5b6b918162b05a72af1e7e136c9b3c8c982b217a2af57c` |
| P2-3-ref-scope          | `src/core/reporting/sources/types.ts` | keeps green HEAD, failing default-branch and pending release CI separately attributable   |    1 | `6e7a8a4512e0e3727e5b6b918162b05a72af1e7e136c9b3c8c982b217a2af57c` |
| P2-4-saved-id           | `src/shared/hostApi/reports.ts`       | retrieves saved ids and compares row fields within history authorization scope            |    1 | `6387c94532b20f0851aa11422a50ee9aefb6f1b77f1156a23ce59bd85294057c` |
| P2-4-compare-diff       | `src/shared/hostApi/reports.ts`       | retrieves saved ids and compares row fields within history authorization scope            |    1 | `6387c94532b20f0851aa11422a50ee9aefb6f1b77f1156a23ce59bd85294057c` |
| P2-4-row-key            | `src/shared/reportSchema.ts`          | retrieves saved ids and compares row fields within history authorization scope            |    1 | `3ca802f9588c0362a2ec57fe8edd1b9accda0d5c8cc2612c1f9bb93009bba2ef` |
| P3-1-hash-path          | `docs/schemas/report-v1.entry.json`   | scrubs canonical output before hashing and exempts only the structural hash               |    1 | `e723fc2d56918cbd2586809248cfaa52975d7462c6c4215f2ffd24d759712c66` |
| P3-1-hash-input         | `docs/schemas/report-v1.entry.json`   | scrubs canonical output before hashing and exempts only the structural hash               |    1 | `e723fc2d56918cbd2586809248cfaa52975d7462c6c4215f2ffd24d759712c66` |
| P3-2-label              | `src/shared/constants.ts`             | labels input/output/cache totals and current/lagging stores through the closed vocabulary |    1 | `a810f1ff1d33e6639b3221b6b2fb881314eb57e9e3c6966b10e6ad081bdb9c43` |
| P3-2-translation        | `l10n/ui.de.json`                     | has real de translations, preserved slots and correct count forms                         |    1 | `4c8756e60bdce5fba46915eaf085c2ada1b1ca24b34e8df017f56b1f1e109327` |
| facts-strict            | `src/core/reporting/sources/types.ts` | retains required milestone gates and declared package scripts even before any run         |    1 | `6e7a8a4512e0e3727e5b6b918162b05a72af1e7e136c9b3c8c982b217a2af57c` |

No full quality run (common.md reserves it to the lead), paid/live calls,
credential reads, external network requests, merges, rebases or pushes.
No install was needed. Hooks exist at this worktree's .husky/_/pre-commit.

### Final scoped verification, win11

Implementation commit: `1b6a05eb`. Its normal lint-staged ESLint/Prettier and
staged gitleaks hooks passed; no leaks found. The worktree was clean after
the implementation commit and production build.

- Final `npx.cmd --no-install vitest run test/unit/reportContracts.test.ts
test/unit/reportFixtures.test.ts test/unit/reportSchema.test.ts --maxWorkers=3`:
  40 passed. Final separate `reportStrings.test.ts` run: 17 passed. Both used
  the repository default timeouts, with no test filtering or timeout override.
- `npm.cmd run typecheck`: all five projects passed; `typecheck:unit` passed
  again after the last test/fixture edits.
- ESLint on the 12 changed TypeScript files: zero warnings/errors, including
  the implementation commit's normal hook check.
- `npm.cmd run deadcode`: plain knip passed. `npx.cmd --no-install jscpd`:
  1,192 files, zero clones at the unchanged zero threshold.
- Explicit Prettier check of all 31 changed files: passed. `git diff --check`:
  passed.
- `node scripts/check-host-api.mjs`: zero problems. `node scripts/gen-reference.mjs
--check`: current (53 features, 44 commands, 59 settings, 26 slash commands,
  116 CLI rows). No user-facing command or setting was registered by this lane.
- Final `node scripts/check-l10n.mjs`: exit 1, exactly the same seven unused
  W-owned manifest keys; 14 UI tables, zero UI translation problems. This
  pre-existing handoff is item 1 above, not an RVM113L0 residual. No gate,
  ignore, rule level, budget or hook was changed.
- `npm.cmd run build`: exit 0, including size/split/host-global/notice gates.
  Extension 439.5/600 KiB; Model API 446.9/475; ACP 821.5/850;
  webview startup 797.7/900; deferred JavaScript 50.0/50; core English
  53.3/125; lazy surfaces English 4.8/25. No report engine/panel entry was
  added; its renderer and native binding remain the named implementation
  handoffs. All six reviewed findings remain fixed with no residuals.

## RVM113L02 fix — 2026-10-06, Kubuntu

Authority: M113L0.rig.md's FIXM113L02 brief, shared common.md, the entire
RVM113L02 report, AGENTS.md and PLAN D93/M113. Base: `398d311bc`, branch
`m113/l0`. The one P2 is fixed; **no review residuals**.

| Finding                           | Fixed                                                                                                                            | Regression                                                                                                                                                      | Red drills                                                                                                                                                   |
| --------------------------------- | -------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| P2 incomplete comparison capacity | Derive the diff bound from reportDocumentSchema's section schemas through an exhaustive required-key map; retain document limits | compares changed rows in Needs you and every ordinary section at the document limit; compares the union of disjoint section ids without raising document bounds | old-capacity, needs-you-capacity, union-capacity, comparison-overflow, exhaustive-section-map-final, exhaustive-optional-section-map, bounded-section-source |

The saved-input pair has SHA-256 content hashes (excluding header/asOf and
header/contentHash) and a changed row
in Needs you and each of 64 ordinary sections. The complete 65-entry result
passes the actual reports/compare boundary with every before/after row intact.
Disjoint ordinary ids require the union of both inputs: 129 entries including
Needs you. Entry 130 and document section 65 are rejected. Existing row,
source, column, string, id and strict-object guards are unchanged. The payload
shape is unchanged; only its capacity now follows the document contract.

The typed map selects section and section-array fields from ReportDocument,
including optional fields, and requires each key. The optional-field drill
initially revealed that a mapped type preserves optional keys; `-?` now makes
comparison entries required. Adding either a required section or an optional
section array without a comparison entry fails the host compiler at TS1360.
Array bounds come from the selected schema's generated maxItems; an unbounded
section-array source fails closed during schema initialization. No duplicated
section cap or new dependency was introduced.

### Exact-restoration drills

Runtime mutations ran the entire reportContracts.test.ts file with
`--maxWorkers=3`, no test filter or timeout override. Static mutations ran
`npm run typecheck:host`. Each mutation restored the saved bytes in finally
and compared SHA-256. Receipts/logs: ignored temp/m113-comparison-drills.

| Mutation                        | Observed failure                                                                  | Exit |
| ------------------------------- | --------------------------------------------------------------------------------- | ---: |
| old-capacity                    | 65-entry changed-row regression rejected at diff.sections, maximum 64             |    1 |
| needs-you-capacity              | 129-entry union regression rejected after omitting the singleton slot             |    1 |
| union-capacity                  | Union regression rejected after counting only one input's ordinary sections       |    1 |
| comparison-overflow             | Union regression's overflow assertion received true instead of false              |    1 |
| exhaustive-section-map-final    | TS1360: Property extraSection is missing from the comparison map                  |    2 |
| exhaustive-optional-section-map | TS1360: Property optionalSections is missing from the comparison map              |    2 |
| bounded-section-source          | Owning suite refused initialization: Report section arrays require a finite bound |    1 |

Restored reportSchema.ts SHA-256 for the four runtime-capacity drills:
`6ccb62252601b9aaae4f5ba307190d25e14e47462977e2c6a894f9e0fab83f0d`.
After the type-only `-?` correction, the final static/bounded-source drills
restored `68e63f2d3df710b45fbbc0173af65cc8214c2b3462315135924b3f5e9b419197`.
The initial pre-fix complete contract run also failed both new regressions at
maximum 64 (32 existing tests passed).

### Scoped verification

Final complete files ran separately, directly on Kubuntu, with the repository
default timeouts: contracts 34, fixtures 6, schema 2, strings 17; **59 passed**.
Two three-file attempts failed during Vitest loading with missing temporary
SSR files (ENOENT), before contracts/schema tests ran. Individual complete
files passed; no timeout, test, config, dependency or gate was changed.

README/catalogue/CHANGELOG remain W-owned; m113-contracts.md extends the
Unreleased fixed-entry handoff with complete schema-derived comparison
coverage. No registered command, setting or runtime surface was added.
Full quality remains reserved to the lead by common.md. No install, network,
credential read, model/paid call, merge, rebase or push occurred.

All five `npm run typecheck` projects and changed-file ESLint passed.
Plain knip passed; jscpd found zero clones across 1,192 files. Host API:
zero problems; reference current (53 features, 44 commands, 59 settings,
26 slash commands, 116 CLI rows). Localization: exit 1, exactly the seven
pre-existing unused W-owned manifest keys; all 14 UI tables pass.
Production `npm run build`: exit 0, size/split/host-global/notice gates passed.
Sizes: extension 439.5/600 KiB; Model API 446.9/475; ACP 821.5/850;
webview startup 797.7/900; deferred JavaScript 50.0/50. No bundle cap changed.
