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
