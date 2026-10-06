# M113 R — renderers, redaction, determinism

2026-10-06, Windows rig `win11`, worktree `C:/lanes/M113R`, branch `m113/r`,
base `145f97cdd`. Authority: `C:/lanes/_ctx/M113R.rig.md`, shared
`C:/lanes/_ctx/codex/common.md`, AGENTS.md, PLAN D93/M113 and the frozen
[lane 0 contracts](m113-contracts.md). Read the referenced M71 captures,
M80 schema record, M84 scrub/export certification and M93 research.
This certifies lane R, not the whole M113 delivery or its editor wiring.

## Delivered

- `src/core/reporting/render/` implements the shared factory
  `createReportRenderers(localePort, redaction)`, returning `md`, `html`,
  `text` and `json`, each with lane 0's `(document, locale, theme) => string`
  signature. The supplied checked table resolves labels at render time.
  It never installs global language state. Number, currency, percent,
  duration and plural formatting use explicit-locale Intl instances with
  the existing helpers' conventions; `fill` receives preformatted strings.
  The existing global number/plural helpers cannot serve simultaneous
  explicit locales without mutating shared state.
- `scrubSourceSnapshot` clones and scrubs every normalized source string,
  including dictionary keys. Colliding redacted keys fail explicitly.
  Known workspace roots become relative; matching handles Windows letter
  case, slash/backslash and JSON-escaped separators. Other roots, account
  addresses, registered credential shapes and digests use M84's actual
  scrub, exposed by the seven-line `createExportTextScrubber` factory.
- `finalizeReport` validates the document, sorts rows/cell keys/source
  references/source records by code unit, puts typed timestamps and source
  observations at the report offset, scrubs canonical bytes, then hashes.
  The hash input has two-space schema order, LF and a final newline; it
  excludes exactly `/header/asOf` and `/header/contentHash`. Narrative
  lists and section/column order retain their declared meaning.
- `verifyReport` validates saved input, checks its scrubbed canonical hash
  and refuses unredacted content. Malformed input and scrub-parser failures
  use fixed errors without quoting source text. A payload field named
  `contentHash` and every source digest still get scrubbed. Only the
  structural hash is reinserted after the output scrub.
- Markdown escapes table/markup syntax. HTML escapes entities and validates
  all five theme colors before CSS insertion; it has no script or remote
  resource, a restrictive CSP, named keyboard-scrollable tables, captions,
  scoped headers and a heading outline. Text wraps at 80 terminal cells,
  preserves graphemes and removes terminal/bidi controls. Each display row
  names its sources; the Sources table retains all statuses and freshness.
  Each footer names renderer version, ICU version and the display locale.
- `scripts/schema-report.mjs` and `schema:report` use the existing schema
  entry to generate/check the production zod boundary. The committed schema
  already matches; no second schema definition or dependency was added.
- Sixty exact-byte goldens cover every kind/format. Tests also validate
  their JSON against the generated schema after proving it equals the
  committed schema, and verify saved-input rendering in every format.
  The cross-process harness builds once in `beforeAll`, renders all kinds
  under Los Angeles/de_DE and Tokyo/tr_TR, and byte-compares both with the
  parent. It checks clock/random reads and the complete import graph.

## Observed verification

All work runs directly on win11. Every Vitest run
uses the repository default timeout, full owning files, `--maxWorkers=3`
and at most three files. No test filter, timeout override, skip, gate or
budget change was used.

- New owning files: `render.md.test.ts`, `render.html.test.ts`,
  `render.text.test.ts`, `render.json.test.ts`, `determinism.test.ts`,
  `reportRedaction.test.ts`: **108 passed**. The initial two three-file
  runs passed 107; the final whitespace regression below adds one.
- All five projects in `npm run typecheck` passed before final verification.
  The final compiler/lint/export-regression results are recorded below.
- Plain knip passed. jscpd analyzed 1,207 files and found zero clones at
  the unchanged zero threshold. The reference is current: 53 features,
  44 commands, 59 settings, 26 slash commands and 116 CLI rows.
- `npm run schema:report -- --check` passed. A stale-byte mutation failed
  the named generator-check test; exact schema bytes were restored.
- Chrome + axe-core ran WCAG 2.0/2.1/2.2 A/AA and best practices, including
  contrast, on light, dark, high contrast dark/light at 690 and 320 pixels:
  **eight checks, zero violations and zero requests**. No accessibility
  rule was excluded. [Structured receipt](m113-r-a11y.json) and
  [320-pixel screenshot](../../test/fixtures/reports/report-320-light.png).
- `npm run build` exited 0, including size, split, host-global and notices
  checks. Extension 439.5/600 KiB, Model API 446.9/475, ACP 821.5/850,
  webview startup 797.7/900, deferred JS 50.0/50, core English 53.3/125.
  R registers no startup import or webview entry. W owns shipping and
  measuring the lazy reporting engine/panel; these sizes do not claim a
  shipped M113 engine.
- An isolated minified Node-20.18 renderer/finalizer/snapshot-scrub probe,
  using the existing shared-English and shared-wire plugins but keeping
  report-schema validation inline, measures **82,305 bytes (80.4 KiB)**.
  This is a renderer-component measurement, not a final collector/source
  engine budget. W must measure the joined engine. The existing shared
  mini-parser entry does not export `globalRegistry`, `ZodMiniArray` or
  `toJSONSchema`, which lane 0's report schema reads; W must preserve those
  APIs in the lazy engine or bind the shared boundary deliberately, rather
  than applying the current `sharedValidation` plugin blindly.

## Red drills and exact restoration

All 23 deliberate breaks failed the expected named regression with exit 1.
Each ran the complete owning test file. Every mutation restored its saved
file bytes in `finally` and compared SHA-256. The first script attempt
stopped before the second mutation because its match crossed a formatted
line; the match was corrected and the remaining drills ran. Nothing was
left mutated. [Complete receipts, including hashes](m113-r-drills.json).

| Drill                  | Named regression                                                                                       |
| ---------------------- | ------------------------------------------------------------------------------------------------------ |
| snapshot-scrub         | scrubs commit subjects, PR titles, changelog lines and tool output in the snapshot without mutating it |
| snapshot-key-collision | scrubs source dictionary keys and refuses collisions after redaction                                   |
| canonical-scrub        | scrubs canaries and every untrusted digest while preserving only verified hash metadata                |
| output-scrub           | scrubs the final formatted output boundary                                                             |
| hash-verification      | hashes scrubbed canonical bytes excluding exactly header asOf and contentHash                          |
| hash-excludes-asof     | hashes scrubbed canonical bytes excluding exactly header asOf and contentHash                          |
| schema-errors-fixed    | refuses malformed saved input without quoting source text                                              |
| parse-errors-fixed     | refuses a scrubbed JSON parse failure without quoting source text                                      |
| stable-row-order       | ignores fact-row, source, cell-field and source-reference insertion order                              |
| clock-read             | renders twice in process without clock or randomness reads                                             |
| backend-import         | the complete renderer import graph contains no backend, paid gate or host module                       |
| source-honesty         | puts Needs you before releases and shows omitted counts and every source status                        |
| markdown-escaping      | escapes table pipes, source HTML, links, images and entity syntax as data                              |
| html-escaping          | escapes source markup and rejects CSS, closing-tag and URL injection in every theme field              |
| theme-injection        | escapes source markup and rejects CSS, closing-tag and URL injection in every theme field              |
| terminal-width         | wraps long unbroken text, CJK and emoji at 80 cells and removes terminal controls                      |
| terminal-controls      | wraps long unbroken text, CJK and emoji at 80 cells and removes terminal controls                      |
| report-offset          | writes timestamps with the report offset in every format                                               |
| pre-escape-scrub       | scrubs freshly emitted md output even after the document was finalized                                 |
| schema-drift           | runs the schema generator check against the committed production boundary                              |
| valid-theme-color      | escapes source markup and rejects CSS, closing-tag and URL injection in every theme field              |
| nested-hash-scrub      | does not exempt a source cell named contentHash                                                        |
| terminal-empty-details | omits trailing whitespace from empty source details                                                    |

The clock drill injects `Date.now()` into the owned canonical pipeline.
K owns the collector clock rule, and W owns the final shipped-bundle split
guard. R's graph drill imports the Model API client into its renderer entry
and sees the import assertion fail, including Windows separator normalization.

## Named integration handoffs

| Handoff               | Owner            | Binding                                                                                                                                                                                                                                                                                                                                                                |
| --------------------- | ---------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| M113-R-snapshot       | S / N            | Call `scrubSourceSnapshot(snapshot, roots)` once before K sees facts; roots come from the host's workspace/home context, never a renderer environment read.                                                                                                                                                                                                            |
| M113-R-finalize       | K / H / X        | Finalize collector documents with `finalizeReport`; use `verifyReport` on saved/from JSON before render, history or comparison. The hash includes canonical LF and the final newline.                                                                                                                                                                                  |
| M113-R-locales        | V / X / W / M102 | Bind `ReportLocalePort.textForLocale` to the checked table for the requested locale, including the second report family when it lands; preserve the explicit locale and avoid process-global installs inside a renderer.                                                                                                                                               |
| M113-R-surfaces       | V / X            | Use the same factory on VS Code, shared/companion UI, native MHP hosts, ACP and CLI; desktop/TUI consume HTML/text through the same shared engine port. No editor-specific implementation is added by R.                                                                                                                                                               |
| M113-R-bundles        | W                | Register the lazy engine and UI entries, their measured budgets, shared English fallback and no-backend split guard; account for the reused export scrub's conversation-text block among the engine's declared readers. Startup/deferred caps stay unchanged.                                                                                                          |
| M113-R-docs-reference | W                | Document `npm run schema:report` and `npm run schema:report -- --check` in README; add the planned reports/reference rows only with their actual command/setting wiring. Unreleased entry: deterministic four-format report renderers, snapshot/output redaction, verified canonical hashes and schema generation with all-kind goldens and cross-process determinism. |
| M113-R-host-api       | W                | Regenerate `docs/ide-compatibility/host-api.md`: the new canonical renderer adds one `node:crypto` import, count 46 → 47. VS Code APIs, imports of vscode and theme variable counts are unchanged.                                                                                                                                                                     |

Two integration gates remain visible. Localization reports exactly the
seven pre-existing unused W-owned manifest keys, with all 14 UI tables
passing; R adds no translation key. The host API check reports the single
new crypto inventory row above. R does not edit W's manifest wiring,
generated inventory, product docs, catalogue, builds or split/budget gates
to hide these handoffs. Full `npm run quality` is reserved to the lead by
the shared brief. They must be green at integration; no gate was weakened.

No installed tools/dependencies were added. Hooks exist in this worktree's
`.husky/_/pre-commit`. No model/paid call (zero attempts), credential read,
external request, message posting, merge, rebase, push, stash or git config
write occurred. M93's runtime command and problem-report implementation
are unchanged. Unknown credential shapes remain PLAN D93/§9's existing
redaction residual, not a claim that arbitrary source prose is secret-free.

## Final scoped checks before implementation commit

- All five `npm run typecheck` projects passed on the final source.
- ESLint passed on all 16 changed TypeScript files and the schema script,
  with zero warnings/errors; the normal commit hook runs it again.
- The three-file M84/contract regression run passed **61 tests**:
  `sessionTransfer.test.ts`, `reportSchema.test.ts`, `reportContracts.test.ts`.
  Together with the 108 new tests this is **169 passing tests**, default
  repository timeouts throughout.
- Both `npm run schema:report` and its `-- --check` succeeded. The write
  produced the same committed schema bytes. `git diff --check` passed.
- Plain knip, zero-clone jscpd, production build and current reference pass
  as above. Localization and the generated host API inventory retain only
  the explicitly named W integration work. No product README, CHANGELOG,
  catalogue, manifest setting registration or host-inventory file was edited
  outside this lane's ownership.

## Local commit receipt

Implementation commit: `a9e467e61d2c46ccdcb03be4ae32ea3bb15b09ad`.
The repository's normal pre-commit hook ran ESLint and Prettier on all 17
staged code files, Prettier on the five staged document/JSON files, and
gitleaks on 312,823 staged bytes. All exited 0; the scan found no leaks.
The worktree was clean after that commit. This receipt is a separate
documentation commit with hooks enabled; history is not rewritten.
The branch remains local and unmerged for lead integration.

## Final committed-diff correction

The final base-to-HEAD diff check found trailing spaces after an empty
`Reason` field in each text golden. Earlier `git diff --check` did not
cover those then-untracked goldens. The text renderer now trims trailing
cell whitespace. All 15 text goldens changed only `Reason: ` to `Reason:`;
the 45 other goldens are byte-identical. A new regression rejects trailing
line whitespace. Removing that trim failed the named regression with
exit 1, then restored the source byte-exact (receipt 23).
The final affected run passed **49 tests** across `render.text.test.ts`,
`determinism.test.ts` and `reportRedaction.test.ts`, with default timeouts.
All five typecheck projects and changed-file ESLint passed again after
this correction. The production build passed again with the same shipped
sizes and unchanged budgets. The full base-to-working-tree diff check now
exits 0.
