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
  observations at the report offset, scrubs decoded values/keys, serializes
  canonically, then hashes (corrected after RVM113R below).
  The hash input has two-space schema order, LF and a final newline; it
  excludes exactly `/header/asOf` and `/header/contentHash`. Narrative
  lists and section/column order retain their declared meaning.
- `verifyReport` validates saved input, checks its scrubbed canonical hash
  and refuses unredacted content after re-walking decoded values/keys.
  Malformed input and key collisions use fixed errors without quoting source
  text. A payload field named
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

## Review RVM113R corrections (FIXM113R, 2026-10-06)

Authority: the current `C:/lanes/_ctx/M113R.rig.md` and the complete
`C:/lanes/_ctx/codex/RVM113R.report.md`, starting from `9b83bc3b0`.
All four findings are fixed; **no review finding is deferred**. These
corrections supersede the earlier canonical-byte scrub and parser-failure
drill claims. No schema, dependency, timeout, gate or budget was changed.

| Finding                            | Fixed behavior and regression                                                                                                                                                                                                                                                                                                                                                                             | Red drill                                                                                    |
| ---------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------- |
| P1, escaped password               | `scrubCanonical` walks cloned, decoded report values and object keys with the shared `scrubFields`/export scrubber before JSON serialization. Independently hashed unsafe saved input and every renderer refuse the reviewer's password; clean finalization removes it in all four formats. The Unicode-escaped password-key regression decodes the saved JSON and exercises the same boundary.           | Remove the structured walk: both named password regressions fail.                            |
| P2-1, already-redacted assignments | Text scrubbing never runs on canonical JSON bytes. Source changelog `password="fixture-value-8729"` and `META_API_KEY=fixture-value-8729` scrub once, finalize, serialize as valid JSON, and round-trip through verification unchanged.                                                                                                                                                                   | Replace the structured walk with canonical-byte scrubbing: both named assignment cases fail. |
| P2-2, Windows relative paths       | Map the complete known workspace path before the export scrub, normalize slash/backslash runs, and match Windows root case-insensitively. The spaced root `C:/Users/Private Person/work` retains exactly `./src/main.ts` through snapshot/finalization, all formats and saved verification; slash/backslash spellings yield identical documents/hashes. Home/sibling/outside paths remain fully redacted. | Remove relative separator normalization: the complete-filename/hash regression fails.        |
| P3, terminal width                 | `text.ts` contains 122 generated Unicode 16.0.0 East Asian Width W/F ranges, including default wide unassigned ranges, from the rig's installed CPython 3.14.7 `unicodedata`. Existing emoji/grapheme handling remains. New cases cover U+FFE5, U+3000 and emoji, all at 80 terminal cells.                                                                                                               | Remove the W/F table check: both named fullwidth cases fail.                                 |

An additional drill disables object-key scrubbing in the reused walker and
fails `scrubs source dictionary keys and refuses collisions after redaction`.
Every drill runs the complete owning test file, with repository-default
timeouts and `--maxWorkers=3`. All five exit 1 on the expected named tests,
restore the saved source bytes in `finally`, and compare equal SHA-256
digests: [structured receipts](m113-r-review-drills.json).

The retired JSON-parser-failure test mocked a parser that the structured
pipeline no longer calls. The saved-input validation/error tests remain;
the new assignment round trips prove serialization stays valid, and the
password tests prove decoded verification rejects unsafe input. No gate
or existing validation boundary was weakened.

The width table is reproducible without a dependency or network access:
enumerate code points `0..0x10ffff` with CPython's Unicode **16.0.0** database,
retain `unicodedata.east_asian_width(chr(point)) in ('W', 'F')`, coalesce
adjacent points into inclusive ranges, and emit each as a Unicode-flagged
regex alternative. Each range has its own class so escaped combining marks
cannot resemble a composed character in the regex source. The source
version is also committed beside the table in `text.ts`.

Initial default-timeout controls reproduced the review's escaped-password
leak, both assignment parse failures, the lost Windows filename and both
fullwidth overflow cases. The final scoped gate results follow below.

### Final review-fix verification on win11

- **176 tests passed** across the nine owned renderer/scrub/contract files,
  in three runs of at most three files with `--maxWorkers=3`, default
  repository timeouts and no filter/skip: redaction + JSON + text (**73**),
  determinism + HTML + Markdown (**42**), and M84 session transfer + report
  schema + report contracts (**61**). All 60 goldens and cross-process
  TZ/LANG comparisons pass. After factoring duplicated password-fixture
  setup, all five drills and the 73-test affected run pass again.
- All five `npm run typecheck` projects pass; the unit project is rechecked
  after the final test-only fixture factoring. Changed-file ESLint and
  Prettier pass. jscpd initially detected that repeated setup, then passes
  with **zero clones** after the fix, at the unchanged zero threshold.
  Plain knip passes. The schema and help reference checks are current.
- `npm run build` exits 0, including size, split, host-global and notices
  checks. Extension **439.5/600 KiB**, Model API **446.9/475**, ACP
  **821.5/850**, startup **797.7/900**, deferred JS **50.0/50**, shared
  English **53.3/125**. R's renderer still has no shipped activation import;
  W retains the joined reporting-engine bundle measurement/registration.
- Localization still fails only on the **seven existing unused W-owned
  report manifest keys**; all 14 UI tables pass. The host API inventory
  still fails only on the already-recorded **`node:crypto` 46 to 47** row.
  These are the original named W handoffs, not new review residuals.
  PLAN §7 records the bounded certification and the lead's full-quality
  integration obligation. No gate or inventory is edited to hide them.
- No dependency/tool install, network request, credential read, live/paid
  attempt, merge, rebase, push, stash or git-config write occurred. Product
  README/CHANGELOG/catalogue and wiring remain the existing named W
  handoff; this internal bug fix adds no command, setting or feature.
  Commits use explicit file paths and the unchanged normal hooks.

## Review RVM113R2 correction (FIXM113R2, 2026-10-06)

Authority: `C:/lanes/_ctx/M113R.rig.md`, shared `codex/common.md` and the
complete `C:/lanes/_ctx/codex/RVM113R2.report.md`, starting from
`f69558e98b0d97c74faa9a3fec154ca3c12895e3` on win11. The review has one P2,
fixed here with **no deferred review finding**. PLAN M113 records the scope
before code; §7 records the bounded rig certification and §9 the outcome.

| Finding                               | Fixed behavior and regression                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 | Red drill                                                                                                                           |
| ------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------- |
| P2, workspace separators after spaces | The workspace prefix still matches case-insensitively for Windows roots in either separator. Its suffix consumes spaces through the path's quote, field end or invalid character, then normalizes every slash/backslash run. `preserves complete spaced workspace-relative Windows paths and hashes equivalent spellings identically` covers `src/main.ts`, `src/My Folder/main.ts` and `My Dir/file name.ts`, each in forward, backslash, doubled and mixed spellings. Snapshots, final documents/hashes, all four formats and saved-JSON round trips agree. | Reintroduce whitespace as a suffix terminator: both spaced-path cases and the text/JSON/HTML token test fail.                       |
| Same P2, path boundaries              | `normalizes spaced workspace path tokens through their real end in text, JSON and HTML` covers `C:\Users\Private Person\work\My Dir\file name.ts` as a whole field, quoted prose, escaped JSON and HTML. Quotes, angle brackets, pipe, question mark, asterisk, colon, newline, carriage return, tab and NUL end normalization. Sibling-prefix paths remain redacted in text, JSON and HTML; another-drive and home/outside controls remain.                                                                                                                  | Removing the colon terminator, then separately removing the control-character terminator, fails the named token test in each drill. |

The initial unmodified-source control failed all three new spaced-path
regressions at the default timeout, showing retained backslashes after a
space. The fixed control passes. All three subsequent drills run the whole
`reportRedaction.test.ts` file with `--maxWorkers=3`, no filter, skip or
timeout override; each exits 1 on its named regression and restores the
source in `finally`, with equal before/after SHA-256. Receipts are appended
as `RVM113R2-P2-spaced-relative-path`, `RVM113R2-P2-path-colon-end` and
`RVM113R2-P2-path-control-end` in
[the existing review drill record](m113-r-review-drills.json).

**Existing named residual: M113-R-shape-only-source-prose.** The review's
boundary probes clarify the existing D93 contract, rather than finding
another regression: nested source JSON with Unicode-escaped credential
keys or another escaped credential field, percent/base64-encoded keys and
credentials split across text-list entries are not recursively decoded.
Outer saved-document Unicode escapes are decoded and covered by the
existing regression. This is accepted under the shared shape-only export
contract; saved verification proves known-shape compliance, not absence of
arbitrary secrets in source prose. Follow-up belongs to the shared-export
scrub owner: design bounded decoding if the contract expands. PLAN §9
names the same residual explicitly.

W retains the existing product-doc/reference/wiring handoff, including the
Unreleased entry: "Report exports preserve complete workspace-relative
Windows paths containing spaces and produce the same canonical hash for
equivalent separator spellings." This internal correction adds no command,
setting or feature-catalogue row. Full quality remains the lead's gate;
the rig brief forbids running it here. No gate, schema, timeout, dependency,
bundle budget or shared scrub rule is changed.

### Final second-review verification on win11

- **179 tests passed**, in complete owning files at repository-default
  timeouts and `--maxWorkers=3`, at most three files per run: redaction +
  JSON + text (**76**), determinism + HTML + Markdown (**42**), M84 session
  transfer + report schema + report contracts (**61**). The no-space control,
  all 60 format goldens and cross-process TZ/LANG comparisons pass.
- All five `npm run typecheck` projects pass. Plain knip passes; jscpd
  analyzes **1,207 files with zero clones** at the unchanged threshold.
  The schema and help-reference freshness checks pass. Scoped ESLint,
  Prettier and the base-to-working-tree diff check pass.
- `npm run build` exits 0, including the production size, split,
  host-global and notices gates: extension **439.5/600 KiB**, Model API
  **446.9/475**, ACP **821.5/850**, startup **797.7/900**, deferred JS
  **50.0/50**, shared English **53.3/125**. These are the currently shipped
  bundles; W retains the reporting-engine registration/measurement handoff.
- Localization exits 1 only for the same **seven unused W-owned report
  manifest keys**, with all 14 UI tables passing. The host API inventory
  exits 1 only for the same **`node:crypto` count 46 → 47** mismatch.
  Both remain the named integration handoffs; neither is weakened or
  claimed green. Full quality remains the lead's integration obligation.
- No installed tool/dependency, external request, credential read,
  live/paid attempt, message posting, merge, rebase, push, stash or git
  config write occurred. The rig brief's merge prohibition takes precedence
  over the stale merge step in the shared common brief. Commits stage only
  the five lane-owned files explicitly and run the unchanged repository
  hooks; `.husky/_/pre-commit` exists before committing.
