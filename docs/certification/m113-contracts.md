# M113 lane 0 — contracts and handoffs

2026-10-06, Windows rig `win11`, worktree `C:/lanes/M113L0`, branch
`m113/l0`, base `2aa9cbff`. Authority: `C:/lanes/_ctx/M113L0.rig.md`,
`C:/lanes/_ctx/codex/common.md`, AGENTS.md, PLAN.md D93 and M113, read in
full. Background records read: M71's GitHub captures, M80's schema contracts,
M84's export/scrub and M93's problem-report research and contracts. No new
provider parser, network request, credential read, model call, dependency,
global setting, merge, rebase or push.

This is lane 0. It supplies contracts and test material; report generation,
rendering, stores, history, CLI dispatch and editor surfaces are the later
lanes' work. The lead must review and freeze these contracts before those
lanes bind them.

## Contracts

- `src/shared/reportSchema.ts` exports the strict `reportDocumentSchema`,
  `ReportDocument`, `ReportKind`, `ReportOptions`, typed values, rows,
  sections and source records. The fixed format is `report-v1`; all 15
  D93 kinds are declared. Values carry their display type; money carries
  certainty and can be unknown. Labels are identifiers from
  `REPORT_LABEL_KEYS`, never translated text. Sources retain their status,
  reason, observation and freshness; unavailable/inapplicable sources must
  explain why.
- `needsYou` is a separate first section, with matching id and label.
  Every section declares `sortKey: key`. K sorts these keys by code unit;
  Needs-you keys start `0-` for owner questions, `1-` for failed/lagging
  channels and `2-` for default-branch CI. Row keys identify the fact, not
  its position. Columns, rows, sections and sources are unique in their
  containers; every cell belongs to a declared column and every source
  reference resolves.
- `SourceSnapshot` and `ReportSourcePort<K>` in
  `src/core/reporting/sources/types.ts` declare normalized facts for all
  sources. Readers return `SourceResult<T>`: available/partial results
  carry data; unavailable/inapplicable results carry `null`. No production
  implementation fills absent data with empty success. The snapshot names
  its one `asOf`, workspace, generator/renderer versions, ICU and locale.
- Collector: `(snapshot, options) => ReportDocument`. Renderer:
  `(document, locale, theme) => string`. No ambient clock, locale, theme or
  backend is needed by these signatures. Locale installation inside a
  renderer would change process-global state; R uses the supplied locale.
- `src/shared/hostApi/reports.ts` owns only the three method payloads:
  `reports/run`, `reports/history`, `reports/open`. Results explicitly name
  generated/listed/opened or failed with a reason. Workspace/history keys
  exclude path separators, history is capped at 50, and the port names
  its `reports` capability. M104 owns its envelope, dispatch and negotiation.
- `docs/schemas/report-v1.entry.json` declares the generator's input,
  export, output and runtime invariants. The accompanying JSON Schema is
  generated from production zod. `reportSchema.test.ts` fails on drift;
  lane R adds `scripts/schema-report.mjs` and `schema:report -- --check`
  using this entry. Refinements that JSON Schema cannot express are listed
  as `x-runtime-invariants`; consumers must still run the zod boundary.
- `constants.ts` includes all D93 limits and exit codes, conservative
  document bounds, formats, kinds and label keys. `SLASH_COMMAND_NAMES`
  reserves `report`; no palette item or command is registered by lane 0.

## Strings and fixtures

The regional block in `en.ts` supplies 116 labels, 15 kind names, 52 action,
status and delivery strings, the command/palette/slash strings, count forms
and CLI usage. All 14 `l10n/ui.*.json` tables have real translations with
the same slots and each locale's count forms. Every new key starts `report`,
so the existing `uiTextSurfaces` fallback keeps it lazy. M102's second-table
mechanism is absent on this base; the regional block is D93's stated fallback.

Test-only helpers under `test/unit/helpers/reporting/` provide the complete
snapshot builder, injected source ports, clock, journal, usage journal,
question registry, a real Git fixture with fixed dates and identities, a
plan-format fixture (including older question headings and working ids), a
quality-ledger v1 fixture derived from the vendored template, and a no-plan
fixture. Git configuration is never written; the fixture's child environment
has only its needed system paths and fixed fixture identity, without inherited
credentials or global signing/filter configuration. Two directories produce
identical commit objects. Windows path comparisons normalize separators.

Network bodies reuse M71's recorded `githubCapture.ts` pull-list and failing
check responses. Rate-floor, retry-after and ETag controls are clearly labelled
synthetic fault fixtures. They are not claimed as captured headers.

## Named integration handoffs

| Handoff               | Owner           | Binding needed                                                                                                                                                                                                                                                                            |
| --------------------- | --------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| M113-P-plan           | P               | Fill `PlanFacts`; validate the complete plan/ledger grammar, report drift, establish actual lane evidence and delivery order.                                                                                                                                                             |
| M113-S-usage          | S / M102        | Adapt `aggregate.ts` to `UsageFacts`, preserving certainty, optional cache capability and limits.                                                                                                                                                                                         |
| M113-S-questions      | S / M112        | Adapt the actual registry to `ReportQuestion`; no registry implementation is shipped here.                                                                                                                                                                                                |
| M113-X-MHP            | X / M104 lane 0 | Bind the three payload schemas and `ReportsHostPort` to the negotiated MHP envelope on every native host.                                                                                                                                                                                 |
| M113-R-schema         | R               | Implement the owned generator/script registration from `report-v1.entry.json`; hash canonical JSON excluding header `asOf` and the hash itself. Scrub sources and each output.                                                                                                            |
| M113-N-captures       | N / lead        | Supply approved recorded store responses and actual rate-limit headers. None exists on this base; shared rules prohibit new network calls. Never write a store parser from the synthetic fixtures.                                                                                        |
| M113-V-command        | V / W           | Register `museSpark.showReport`, the palette item and `/report` intercept using the prepared strings; preserve M93's problem-report command and bare runtime `report`.                                                                                                                    |
| M113-W-manifest       | W               | Reference the seven prepared `package.nls*.json` keys from `package.json`: showReport title; reports.network description and three enum descriptions; keepHistory description; agentSources description. Defaults: whenSignedIn, true, empty list; machine scope.                         |
| M113-W-reference-docs | W               | Add catalogue/help rows for Show report, `/report`, CLI kinds/history/problem alias and every report setting; regenerate the reference. Update README, CHANGELOG, ACP, CI, privacy/security and host compatibility. These files belong to W; lane 0 registers no user-facing entry point. |
| M113-W-bundles        | W / M102        | Keep report logic and UI lazy, move the regional labels to the separate report family once M102 is present, measure each new chunk and apply the brief's existing caps.                                                                                                                   |

Each editor uses the same document and rendering/source ports: VS Code,
the companion, native MHP hosts, ACP, CLI/headless, then desktop/TUI. No
editor-only production logic is added here. Provider-dependent sections are
fed by capability facts; absent integrations must be unavailable or not
applicable with their reasons.

Validation and the deliberate-break receipts are in
[the lane certification record](<m113-0-contracts,-strings,-fakes-(lead).md>).
