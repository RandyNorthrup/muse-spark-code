# M113 K — report kinds

Authority: M113K.rig.md, codex/common.md, AGENTS.md, PLAN D93 and M113,
and lane 0's frozen contracts and certification. Worktree: M113K;
branch: m113/k. Implementation and verification run directly on Kubuntu.
No delegation, network, credential reads or model calls are required.

## Implemented within K's ownership

Pure collectors under `src/core/reporting/collect/` implement all frozen
kind contracts. They retain source records, require explicit unavailable
facts, sort keys by code unit, cap rows, and put Needs you first. Shared
edit counting moves to `src/shared/diffTally.ts` so portable session facts
and the webview use the same edit classification and path normalization.

The collector factory returns lane 0's `(snapshot, options) => ReportDocument`
signature. Its injected finalizer owns output scrubbing and content hashing
(R); K never manufactures a content hash. Its next-step limit is supplied
by W from constants.ts (D93's three). Pure selection ports carry ancestry
filtered commits (S) and risks/residuals added since the last release (P/S).
The frozen GitFacts has no ancestry graph, and PlanFacts has no revision
dates for risks; absent selectors produce explicit unavailable records.
Existing source ports carry M102/M112 and later milestone facts. No
production fallback invents those facts.

README, CHANGELOG, featureCatalogue, command dispatch, build entries and
purity lint configuration remain with W/X/V/R. Their named integration
handoffs and final test/drill receipts are recorded below.

## Shared edit tally — first piece

The panel's existing edit classifier now lives in shared code and accepts
the portable `toolCall` fields as well as the panel's `tool` fields. It
retains pathless patch counts and normalizes Windows separators before
deduplicating paths. No user-facing command or setting is registered.

Two whole-file red drills (default timeout, Kubuntu) each exited 1 at
`diffTally > shares portable history counts and normalizes Windows separators`:
remove path normalization; reject portable tool kinds. Each restored the
exact original bytes and compared SHA-256:
`e6fcea3cfcc915dad357aa67bc54cdef4cf3d6cac14c47ca2b73016c26bc5b05`.
Receipts and failed-run logs are in ignored `temp/m113-k-drills/`.
The baseline and restored final whole file each passed all 17 tests with
the default timeout. Webview typecheck and changed-file ESLint passed.
Hooks exist at `.husky/_/pre-commit`; commits use the normal hooks.

## Collector behavior

`createReportCollector` implements the frozen collector signature with seven
local collectors: project, milestone, release, changes, session, usage and
quality. Eight kinds consume the frozen typed `ReportSection[]` source ports:
fleet, security, accounts, estimate, playbook, issues, schedules and keybindings.
Each requires all its declared facets; a missing facet has a derived unavailable
source and an explicit row. These ports bind planned dependencies without a
production fake, guessed wire parser or editor-specific fallback.

Needs you orders owner questions, session questions, lagging/failed channels,
then failing default-branch CI. A green HEAD never hides a failing default
branch. Unknown future CI outcomes remain source text. Milestone matching is
exact, case-insensitive, with optional M and suffixes preserved; not-found
errors carry deterministic nearest ids for X's exit-code mapping.

Next steps use the first three ready delivery-order entries through an injected
limit. Unmerged or unknown needs never count as complete. Keys carry the plan's
declared priority, rather than the filtered display position, so completing an
earlier entry does not rename the surviving facts. Changing the plan's declared
priority intentionally changes that key; the frozen schema permits only `key`
as a sort field. All other keys encode the fact's identity, never its row index.

Session turns and approvals use the actual captured activity facts, independently
of transcript message/tool counts. Legacy unavailable activity stays unknown
with its reason. Tools are grouped by name and outcome; paid uses, questions and
checks remain visible. Shared edit counting retains patch-only file counts and
normalizes Windows separators. Usage retains nullable costs and certainty,
capability-gates cache columns and names other-agent usage/limit files.
Quality shows scripts as declared without executing them, explicit never-run
checks, the latest local check by timestamp instant, all scoped CI, and
certification records. Local release evidence remains visible when another
source is unavailable; date ordering uses instants, not timestamp spelling.
Changes use the injected ancestry range and the AGENTS layout for file areas.

All rows sort by code unit before the ten-row cap; `--full` keeps all available
rows and rejects facets already truncated upstream. Partial/unavailable sources
remain explicit with their reason and freshness. Facets and finalized documents
cross zod boundaries. Conflicting evidence ids, unsupported runtime kinds,
asOf mismatches and invalid next-step policies fail explicitly. No source is
read, command run, clock/environment sampled or backend called by a collector.

Generated identifiers use split SHA-256 hex, avoiding M84's contiguous key-digest
redaction. Namespaces are encoded if invalid, oversized or digest-shaped; derived
source ids respect the schema cap. The compatibility test uses the real
`buildSessionExport` scrub on every kind's generated keys, and separately proves
that source text containing a 64-hex value is still scrubbed. The test-only
fixture finalizer hashes synthetic safe facts; it does not implement or certify
R's canonical output scrub/hash pipeline.

## Named integration handoffs

| Handoff                      | Owner                       | Binding needed                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| ---------------------------- | --------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| M113-K-finalize              | R/W                         | Inject the real canonicalizer: second scrub, then content hash excluding exactly header asOf/contentHash; preserve only the hash's schema-path exemption. Collectors hand it an unhashed draft and validate its returned report.                                                                                                                                                                                                                        |
| M113-K-next-steps            | W                           | Supply D93's three through a named shared constant and `nextStepLimit`; K adds no literal production policy in W-owned constants.ts.                                                                                                                                                                                                                                                                                                                    |
| M113-K-changes-range         | S/W                         | Bind `selections.changes(snapshot, options)` to bounded Git ancestry/ref/date evidence. GitFacts has no graph; use an unavailable SourceResult when selection cannot be proven.                                                                                                                                                                                                                                                                         |
| M113-K-release-risks         | P/S/W                       | Bind `selections.risksSinceRelease(snapshot)` to plan revision evidence for newly added §8/§9 entries. Frozen PlanFacts has no revision dates.                                                                                                                                                                                                                                                                                                          |
| M113-K-milestone-residuals   | P/W                         | Frozen residuals carry id/text, without milestone ids; milestone reports retain them rather than silently infer a relationship. Add normalized relationship evidence in a coordinated contract revision if filtering is required.                                                                                                                                                                                                                       |
| M113-K-later-facets          | S/X/N and dependency owners | Fill the frozen fleet/security/accounts/estimate/playbook/issues/schedules/keybindings source ports from M96/M100/M108/M109/M110/M111/M115/M115w/M116/M117 and editor bindings. Keep source status/freshness and scrub-safe stable keys; credential values never enter a facet. Missing integrations remain explicit unavailable or notApplicable.                                                                                                      |
| M113-K-purity-gates          | W                           | Add D93's restricted ambient-input/import ESLint block and shipped reporting bundle split rule; the owned AST/runtime guard already fires on Date.now and a real Model API import.                                                                                                                                                                                                                                                                      |
| M113-K-lazy-engine           | W                           | Wire the factory into lazy dist/reporting.js and bind it identically from V/X/MHP, ACP, CLI, companion, desktop and TUI. Measure the integrated chunk; K introduces no startup loader or UI chunk.                                                                                                                                                                                                                                                      |
| M113-K-host-api-record       | W                           | Regenerate the inventory: the new pure node:crypto import increases the core count from 46 to 47. The portability checks themselves pass.                                                                                                                                                                                                                                                                                                               |
| M113-K-localization-manifest | W                           | Wire the seven prepared manifest report keys named by lane 0. The frozen base has seven unused manifest keys, while every UI translation passes.                                                                                                                                                                                                                                                                                                        |
| M113-K-reference-docs        | W                           | Register report-kind catalog/CLI rows and regenerate reference when wiring surfaces. README Reports should document source-derived Needs you, delivery readiness, ten-row/full behavior, capability-gated usage, actual session activity and honest missing data. Unreleased entry: add pure deterministic collectors for all report kinds, shared portable edit totals, and explicit source/facet availability. No command/setting is registered by K. |

All integrations use the same portable core; none is reachable only through
VS Code. README/CHANGELOG/catalogue, manifests, host API inventory, ESLint and
build configuration remain with their assigned owners. No dependency, UI text
key, escape hatch, gate waiver or global configuration was added.

## Red-drill receipts

Every successful mutation below ran whole test files, at most three at once,
with `npx --no-install vitest run <files> --maxWorkers=3`, default timeouts,
and exit 1 at the named test. The harness saved original bytes, restored in
finally, then compared their SHA-256 exactly. Hashes below identify the tested
restored file version; later implementation/formatting changes are verified by
the final green runs, rather than misrepresented as the same bytes. Full logs
and machine-readable receipts stay in ignored `temp/m113-k-drills/`.

Three attempted mutations initially passed because another condition masked the
assertion: the long commit group fixture still had a short M12 branch; a long
numeric namespace also triggered digest-shape encoding; and completing M12
unlocked M15 at the same display position. Fixtures now remove the short branch,
use a non-hex long prefix, and keep M15 blocked respectively. The isolated
mutations then fail; passing attempts are not counted as proof. No guard was
weakened.

| Drill                         | Named failing test                                                                                                                                    | Restored file version                                                                                                 |
| ----------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------- |
| windows-paths                 | `diffTally.test.ts > diffTally > shares portable history counts and normalizes Windows separators`                                                    | `src/shared/diffTally.ts` SHA-256 `e6fcea3cfcc915dad357aa67bc54cdef4cf3d6cac14c47ca2b73016c26bc5b05`                  |
| portable-tool-kind            | `diffTally.test.ts > diffTally > shares portable history counts and normalizes Windows separators`                                                    | `src/shared/diffTally.ts` SHA-256 `e6fcea3cfcc915dad357aa67bc54cdef4cf3d6cac14c47ca2b73016c26bc5b05`                  |
| stable-order                  | `collect.determinism.test.ts > collector determinism > project repeats byte-identically and ignores source insertion order`                           | `src/core/reporting/collect/common.ts` SHA-256 `e4a98ba9cdb1b2f8ed8a193d591479caad1002dc8e309c42c4f95d28f08f3ca5`     |
| ambient-clock                 | `collect.contract.test.ts > collector boundary and policy > does not read the ambient clock, randomness or installed language`                        | `src/core/reporting/collect/index.ts` SHA-256 `0e264b9e396511999092f877669972186cae2af2327c746ccd923dec73d6bfbd`      |
| backend-import                | `collect.determinism.test.ts > collector determinism > guards pure collectors against ambient inputs and backend imports`                             | `src/core/reporting/collect/common.ts` SHA-256 `e4a98ba9cdb1b2f8ed8a193d591479caad1002dc8e309c42c4f95d28f08f3ca5`     |
| unavailable-row               | `collect.contract.test.ts > collector boundary and policy > preserves partial source reasons and freshness and rejects conflicting evidence ids`      | `src/core/reporting/collect/common.ts` SHA-256 `e4a98ba9cdb1b2f8ed8a193d591479caad1002dc8e309c42c4f95d28f08f3ca5`     |
| row-cap                       | `collect.contract.test.ts > collector boundary and policy > caps ordinary rows and Needs you only after sorting, and --full retains every row`        | `src/core/reporting/collect/common.ts` SHA-256 `e4a98ba9cdb1b2f8ed8a193d591479caad1002dc8e309c42c4f95d28f08f3ca5`     |
| needs-you-priority            | `collect.project.test.ts > project report collector > puts owner questions, lagging channels and failing default-branch CI first`                     | `src/core/reporting/collect/needsYou.ts` SHA-256 `a684ac55cc5e4a999e75feb649b866849d2fa535a99674101a070ae62c7ea9da`   |
| ready-dependencies            | `collect.project.test.ts > project report collector > uses delivery order for the next three ready milestones, never unmerged needs`                  | `src/core/reporting/collect/plan.ts` SHA-256 `2172a9b3d56e79c1a3a555f9d792fb643ac056af6a96d4733208111191a2bc84`       |
| exact-milestone-id            | `collect.milestone.test.ts > milestone collector > matches 12 exactly and retains declarations before gates run`                                      | `src/core/reporting/collect/plan.ts` SHA-256 `2172a9b3d56e79c1a3a555f9d792fb643ac056af6a96d4733208111191a2bc84`       |
| actual-turns                  | `collect.session.test.ts > session collector > retains actual turns and approval decisions independently of message count`                            | `src/core/reporting/collect/session.ts` SHA-256 `21b07c7f01df7d0844c1ebf55af27777109a37a743e55fd6cb7c0c6c1682d945`    |
| approval-counts               | `collect.session.test.ts > session collector > retains actual turns and approval decisions independently of message count`                            | `src/core/reporting/collect/session.ts` SHA-256 `21b07c7f01df7d0844c1ebf55af27777109a37a743e55fd6cb7c0c6c1682d945`    |
| cache-capability-source       | `collect.usage.test.ts > usage collector > omits unsupported cache columns while naming the capability as not applicable`                             | `src/core/reporting/collect/index.ts` SHA-256 `0e264b9e396511999092f877669972186cae2af2327c746ccd923dec73d6bfbd`      |
| finalized-boundary            | `collect.contract.test.ts > collector boundary and policy > hands an unhashed document to the injected finalizer and validates its result`            | `src/core/reporting/collect/index.ts` SHA-256 `0e264b9e396511999092f877669972186cae2af2327c746ccd923dec73d6bfbd`      |
| full-source-completeness      | `collect.facets.test.ts > injected milestone facets > caps injected editor keybindings and preserves conflicts; --full shows all`                     | `src/core/reporting/collect/index.ts` SHA-256 `0e264b9e396511999092f877669972186cae2af2327c746ccd923dec73d6bfbd`      |
| source-identity-conflict      | `collect.contract.test.ts > collector boundary and policy > preserves partial source reasons and freshness and rejects conflicting evidence ids`      | `src/core/reporting/collect/index.ts` SHA-256 `0e264b9e396511999092f877669972186cae2af2327c746ccd923dec73d6bfbd`      |
| as-of-match                   | `collect.contract.test.ts > collector boundary and policy > requires one asOf stamp and a positive bounded next-step policy`                          | `src/core/reporting/collect/index.ts` SHA-256 `0e264b9e396511999092f877669972186cae2af2327c746ccd923dec73d6bfbd`      |
| next-step-policy              | `collect.contract.test.ts > collector boundary and policy > requires one asOf stamp and a positive bounded next-step policy`                          | `src/core/reporting/collect/index.ts` SHA-256 `0e264b9e396511999092f877669972186cae2af2327c746ccd923dec73d6bfbd`      |
| last-check-instant            | `collect.quality.test.ts > quality collector > selects last checks by instant with stable ties and preserves new CI outcomes`                         | `src/core/reporting/collect/quality.ts` SHA-256 `8776e06065623edc2f4a49394cd9130fad2baa7276aead8b0e433591e08a1e7d`    |
| never-run-gates               | `collect.quality.test.ts > quality collector > lists declared scripts even before any local run and keeps CI refs separate`                           | `src/core/reporting/collect/quality.ts` SHA-256 `8776e06065623edc2f4a49394cd9130fad2baa7276aead8b0e433591e08a1e7d`    |
| missing-facets                | `collect.facets.test.ts > injected milestone facets > fleet retains its typed facet, including column keys and provenance`                            | `src/core/reporting/collect/index.ts` SHA-256 `0e264b9e396511999092f877669972186cae2af2327c746ccd923dec73d6bfbd`      |
| bounded-row-identities        | `collect.changes.test.ts > changes report > keeps long source-derived group identities inside the report id bound without truncating data`            | `src/core/reporting/collect/common.ts` SHA-256 `e4a98ba9cdb1b2f8ed8a193d591479caad1002dc8e309c42c4f95d28f08f3ca5`     |
| windows-layout-areas          | `collect.changes.test.ts > changes report > maps the declared layout areas with Windows paths before comparing them`                                  | `src/core/reporting/collect/repository.ts` SHA-256 `eddda1a667049c23922a34421f41e75664c9a23c116524fd14c5bd756e6d19d3` |
| latest-release-instant        | `collect.release.test.ts > release report > orders release dates by instant and retains local tags when the changelog is unavailable`                 | `src/core/reporting/collect/repository.ts` SHA-256 `eddda1a667049c23922a34421f41e75664c9a23c116524fd14c5bd756e6d19d3` |
| input-facet-boundary          | `collect.contract.test.ts > collector boundary and policy > validates injected facets before handing them to the finalizer`                           | `src/core/reporting/collect/index.ts` SHA-256 `0e264b9e396511999092f877669972186cae2af2327c746ccd923dec73d6bfbd`      |
| unsupported-runtime-kind      | `collect.contract.test.ts > collector boundary and policy > rejects unsupported runtime kinds with an explicit error`                                 | `src/core/reporting/collect/index.ts` SHA-256 `0e264b9e396511999092f877669972186cae2af2327c746ccd923dec73d6bfbd`      |
| invalid-row-namespace         | `collect.contract.test.ts > collector boundary and policy > encodes invalid namespace characters without losing distinct identities`                  | `src/core/reporting/collect/common.ts` SHA-256 `e4a98ba9cdb1b2f8ed8a193d591479caad1002dc8e309c42c4f95d28f08f3ca5`     |
| scrub-safe-digest             | `collect.contract.test.ts > collector boundary and policy > keeps generated row identities through the real M84 scrub while scrubbing source digests` | `src/core/reporting/collect/common.ts` SHA-256 `dc4eeeecd4b9938bbf686fca62f74966f30161c1adc750ac09a9fc723a699b9d`     |
| scrub-safe-namespace          | `collect.contract.test.ts > collector boundary and policy > keeps generated row identities through the real M84 scrub while scrubbing source digests` | `src/core/reporting/collect/common.ts` SHA-256 `dc4eeeecd4b9938bbf686fca62f74966f30161c1adc750ac09a9fc723a699b9d`     |
| derived-source-bound          | `collect.contract.test.ts > collector boundary and policy > bounds derived source ids while retaining distinct facets and their provenance`           | `src/core/reporting/collect/common.ts` SHA-256 `dc4eeeecd4b9938bbf686fca62f74966f30161c1adc750ac09a9fc723a699b9d`     |
| bounded-row-identities-final  | `collect.contract.test.ts > collector boundary and policy > encodes invalid namespace characters without losing distinct identities`                  | `src/core/reporting/collect/common.ts` SHA-256 `dc4eeeecd4b9938bbf686fca62f74966f30161c1adc750ac09a9fc723a699b9d`     |
| invalid-row-namespace-final   | `collect.contract.test.ts > collector boundary and policy > encodes invalid namespace characters without losing distinct identities`                  | `src/core/reporting/collect/common.ts` SHA-256 `dc4eeeecd4b9938bbf686fca62f74966f30161c1adc750ac09a9fc723a699b9d`     |
| delivery-fact-identity        | `collect.project.test.ts > project report collector > retains next-step identities when earlier delivery work completes`                              | `src/core/reporting/collect/plan.ts` SHA-256 `6abd54b5bf6de5242deca0e567296592d35b45381aa771e1088c5abe81339736`       |
| agent-usage-windows-identity  | `collect.usage.test.ts > usage collector > normalizes agent usage file identities before comparing rows across platforms`                             | `src/core/reporting/collect/usage.ts` SHA-256 `5c59a9ac2b525f50ade1f7203dbca2e74e618f83641e320ba99e851f7bf7e718`      |
| agent-limits-windows-identity | `collect.usage.test.ts > usage collector > normalizes agent usage file identities before comparing rows across platforms`                             | `src/core/reporting/collect/usage.ts` SHA-256 `5c59a9ac2b525f50ade1f7203dbca2e74e618f83641e320ba99e851f7bf7e718`      |

## Final verification on Kubuntu

The twelve owned/affected test files pass in four batches of three (47, 31,
10 and 24 tests): **112 tests**, repository default timeout, maxWorkers=3.
All fifteen kinds repeat byte-identically; source insertion order changes
nothing. Fresh Node processes with TZ/LANG America/Los_Angeles/de_DE and
Asia/Tokyo/ja_JP produce identical report bytes. The process fixture builds
once in beforeAll and runs comfortably inside the default test timeout.

Final static/build results follow. Full quality,
coverage, installed-editor checks, integrated report render goldens, end-to-end
redaction and cross-platform performance remain with the lead/R/W; the lane
brief forbids the full quality/test suite here. No threshold was weakened.

| Check                                                                                                                  | Result                                                                                                                                                      |
| ---------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `npm run typecheck`                                                                                                    | Exit 0, all five projects (host, webview, unit, e2e, integration).                                                                                          |
| Changed-file `npx --no-install eslint … --max-warnings=0`                                                              | Exit 0; collectors, shared tally, affected App/component, all owned tests/helper.                                                                           |
| Changed-file `npx --no-install prettier --check …`                                                                     | Exit 0; code, tests and certification.                                                                                                                      |
| `npm run deadcode`                                                                                                     | Exit 0, plain knip; two existing configuration hints, no unused code.                                                                                       |
| `npx --no-install jscpd`                                                                                               | Exit 0, 1,211 files, zero clones. Duplicate certification/limit cell builders found during development were shared, without ignores or threshold changes.   |
| Scoped `dpdm --no-warning --no-tree --exit-code circular:1 -T src/core/reporting/collect/index.ts src/webview/App.tsx` | Exit 0, no circular dependencies.                                                                                                                           |
| `npm run build`                                                                                                        | Exit 0, all production size/split/host-global/notices gates; no budgets changed.                                                                            |
| `npm run check:reference`                                                                                              | Exit 0: 53 features, 44 commands, 59 settings, 26 slash entries, 116 CLI rows, current.                                                                     |
| `node scripts/check-l10n.mjs`                                                                                          | Exit 1: exactly seven frozen-base manifest keys unused by package.json; 14 translated UI tables pass. W owns manifest wiring, M113-K-localization-manifest. |
| `npm run check:host-api`                                                                                               | Exit 1: exactly the node:crypto count 46 → 47; W owns inventory regeneration, M113-K-host-api-record. No portable vscode import failure.                    |
| `git diff --check`                                                                                                     | Exit 0.                                                                                                                                                     |

Production sizes: extension **439.5 / 600 KiB**, Model API **446.9 / 475 KiB**,
checkpoint store **76.9 / 225 KiB**, ACP **821.5 / 850 KiB**, shared fallback
uiText **53.3 / 125 KiB**, webview startup with static imports
**797.8 / 900 KiB**, deferred webview JS **50.0 / 50 KiB**. These are the
existing shipped entries with K's shared tally move; the collectors await W's
lazy engine entry and its measured budget. No report UI code is added here.
Build log: ignored `temp/m113-k-build.log`. Final test logs:
`temp/m113-k-final-tests-{1,2,3,4}.log`, 2026-10-06 14:03 Pacific.

Successful red receipts: **35** including final re-proofs of both identifier
guards after scrub compatibility changed their implementation. Hooks remain
on; the first shared-tally commit is `9d5cb8097` and its normal lint-staged and
gitleaks checks passed. Final collector/receipt commit recorded in the lane's
git history. Nothing is pushed, merged or rebased.

## RVM113K corrections — first piece (2026-10-06, Kubuntu)

The review found no P1 and seven P2s. Findings 1–6 are corrected in this
piece; finding 7 follows in the next local commit. No dependencies, gate
thresholds, wire shapes, startup entries or editor surfaces change.

| Finding                                   | Correction                                                                                                                                                                                        | Regression / deliberate break                                                                                                                                                                                             |
| ----------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| F1 repeated checklist keys                | Canonical equal-text ordering plus a per-text occurrence ordinal retains completed/open and identical-state duplicates.                                                                           | `collect.milestone.test.ts`: `retains repeated checklist lines with unique keys` (short/full, reordered input). F1-checklist removes the ordinal.                                                                         |
| F2 premature release absence              | Only four complete, agreeing release sources can cause not-found; partial/unavailable/notApplicable evidence yields an unknown scope row listing unresolved source ids, with each failure reason. | `collect.release.test.ts`: `keeps release absence unknown…` (each source partial/unavailable; only empty plan readable). F2-absence replaces all-complete with any-readable.                                              |
| F3 GitHub-only release lost               | GitHub joins release candidates, retaining provenance and supplying latest/project/channel evidence.                                                                                              | `collect.release.test.ts`: `selects the latest release from GitHub alone with source-labelled project evidence`. F3-github removes those candidates.                                                                      |
| F4 zero files unavailable                 | A complete no-edit export records observed zeros. Missing edit summaries and incomplete sources remain unknown. Panel tally visibility is unchanged.                                              | `collect.session.test.ts`: `reports observed zero files…` and `keeps missing edit summaries…`. F4-zero removes zero counts; F4-summary removes the missing-summary guard; F4-complete treats partial exports as complete. |
| F5 forwarded partial facets silent        | Every supplied facet uses `sourcedSection`, preserving arbitrary typed columns, upstream omissions and full-source guard while adding the affected source row before capping.                     | `collect.facets.test.ts`: `%s retains partial-source rows in every supplied empty facet` for all eight kinds, short/full. F5-facets removes the source from the shared builder.                                           |
| F6 delivery aliases lose milestones/lanes | Project selection uses the same `isSameMilestone`/`normalizeMilestone` identity as readiness and lookup.                                                                                          | `collect.project.test.ts`: `selects the ready milestone and its lanes for delivery alias` (`14`, `m14`, dependency `1`). F6-aliases restores literal equality.                                                            |

All eight deliberate-break runs use whole owning test files, maxWorkers=3
and the repository default timeout. Each exits 1 at the named regression,
then restores the exact source bytes and verifies SHA-256. Receipts:
ignored `temp/m113-k-fix/drill-receipts-1.json` and `drill-F*.log`.
Before-fix runs reproduced ten failures in milestone/release/project and
nine in session/facets. Restored milestone/release/project pass 28 tests;
session/facets/determinism pass 48 tests (76 total). The initial typecheck
exposed Vitest's tuple-callback typing in the facet test table; single-arg
cases now use the table's kind projection.

The first-piece guards were re-fired after lint's naming fixes. Restored hashes:

| Guard file                             | SHA-256                                                            |
| -------------------------------------- | ------------------------------------------------------------------ |
| `collect/plan.ts` (F1)                 | `5c90f64e218ec351c39bd33da80aa37c6f3c27bf8fe12a796606b2a259cc539c` |
| `collect/repository.ts` (F2, F3, F6)   | `0d199a57b2a46a8583b9c8d302e5823b870241d930e3ba2ba74e09eb8d555a51` |
| `collect/session.ts` (three F4 guards) | `2eb71ca3002a84bbc4127330c24c2e96baa35ab8e5a71c3316382ab0265c4ae4` |
| `collect/index.ts` (F5)                | `f9d6baedc3165e6c339ff657483f6086b7c1c9c6ef2624f3a99b482d19d382b7` |

Host/webview typecheck and corrected unit typecheck pass. Changed-file
ESLint passes with zero warnings; no suppressions or casts are added.

Changed-file lint, final typecheck/static/build results and ancestry receipts
follow with the completed review record. Documentation/manifest/catalogue
registration remains W's existing ownership: K adds no command or setting.
