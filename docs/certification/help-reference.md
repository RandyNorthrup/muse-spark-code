# HELPREF — Help & Reference

The original certification below is historical. The FIXHELPREF record at the
end supersedes its coverage and truth claims after review RVHELPREF.

Rig: macmini. Base: `2d4d72bd` (0.14.0); branch `feat/help-reference`.
Implementation commit: `47dcf1a4`; final certification follows on the same branch.
No model calls, paid use, credentials, dependencies or external network calls.
All existing size caps and gate thresholds remain unchanged. The rig brief
prohibits full quality, merge and push; integrated quality and release remain
the lead's gates (PLAN §7). Local commits ran the hooks and staged secret scan.

The generated reference covers **41 features, 44 commands, 58 settings,
26 built-in slash commands and 12 CLI entries**. Eight reviewed global commands
have Run links; workspace/editor commands and destructive actions stay listed
without Run. Installed skills remain dynamic. `/help` is reserved in the panel
and ACP even when a skill has that selector; compact ACP help lists it once.

The shared React factory accepts the caller's React (including Fragment),
installed language and bridge. Its independent lazy entry carries neither
another React nor another English fallback. The Node implementation and model
load on the first reference action. VS Code opens `@id:<key>`; the host-neutral
handler passes the same validated key to a native settings anchor. Environment
variable settings are never read or sent. Hosts without current values get an
explicit unavailable message and still see the defaults.

ACP's companion link is the generated GitHub reference. The phone companion and
native shared-webview implementations are planned in the base repository's IDE
compatibility plan, not present to integrate or certify here. ACP compact help,
CLI full help and the shared page bridge are exercised locally. This record does
not claim a planned native host has run the page.

## Tests and checks

All runs were scoped to at most three files with `--maxWorkers=3` and
`--testTimeout=120000`. **771 distinct tests** passed across 14 owning files:

- Reference generator, host/CLI and page: 21 tests.
- ACP agent, ACP runtime and palette: 146 tests.
- App, lazy App and protocol: 294 tests.
- Manifest: 35; slash registry: 36; UI reducer: 173.
- Inline/regional English fallback: 7; flight recorder: 59.

Final checks passed: five-project typecheck, changed-file ESLint, Prettier,
localization (14 tables, 165 manifest strings, 0 problems), reference freshness,
host API record (0 problems), dead code, duplication (0 clones), production build,
bundle size/split/global checks and third-party notices (83 packages).
The React quality checklist covered stable effects, factory placement, lazy
loading, accessibility and the caller's shared runtime.

Production `help --all`, `--help` and `exec --help` succeeded. The ACP package was
built offline and its full help output matches the production launcher. No
package was published. The owning frame-vocabulary test caught the new scripts;
both exact package paths are registered without broadening stack-path retention.

## Startup and bundles

[Measured bytes](help-reference/measurements.json) compare a production build of
an archived `2d4d72bd` tree with the final source using the same installed pins.
The initial help overhead was 2,675 bytes. Reserved two-byte UTF-8 tokens in the
existing lossless English dictionary recovered that space; its complete keys,
values and plural forms round-trip exactly. The canonical table has no token
collision. No fallback, functionality, dependency or size cap was removed.

| Artifact                                       |   Bytes |
| ---------------------------------------------- | ------: |
| 0.14.0 chat startup (including static imports) | 914,658 |
| Final chat startup (including static imports)  | 899,489 |
| Startup reduction                              |  15,169 |
| Unchanged startup cap                          | 921,600 |
| Extension                                      | 448,206 |
| Model API                                      | 457,348 |
| ACP                                            | 838,806 |
| Lazy Node reference/model                      |  82,279 |
| Independent lazy reference page                |  29,357 |
| Reference stylesheet                           |   1,462 |

The unchanged aggregate deferred-chat cap also passes. The generator reads the
TypeScript RuntimeCommand inventory as an AST, including multiline variants,
and validates README anchors as well as command/setting relationships.

## Accessibility and screenshots

English and French, wide/narrow, all four captured themes: **16 pages,
0 violations, 0 undecided rules, 0 pages without results**. Axe excludes only
contrast it cannot see under the modal or beyond the viewport, under the
existing harness policy (12 English and 16 French elements). No exemption was
added. Browser verification caught a missing Fragment in the shared runtime and
undersized narrow navigation links; the runtime and target height were fixed.

Screenshots were inspected at 1000×760 and 320×760. README does not link these
shots, so `media/readme` is untouched:

- [Wide light](help-reference/light/help.png)
- [Narrow light](help-reference/light/help-narrow.png)
- [Wide dark](help-reference/dark/help.png)
- [Narrow dark](help-reference/dark/help-narrow.png)

## Deliberate red drills

[Receipts](help-reference/drills.json) record failing exits/diagnostics and
SHA-256 before and after restoration. **20 mutations fired and every file was
restored byte-exactly**, followed by green scoped tests and checks:

1. Add a command without a catalogue entry.
2. Append stale generated output.
3. Disable the known-setting guard.
4. Disable the safe-command allowlist.
5. Read environment variable settings.
6. Disable translated dictionary parsing.
7. Disable nested reference-model parsing.
8. Expose unsafe Run buttons.
9. Break a README documentation anchor.
10. Overfill the Node reference bundle.
11. Overfill the independent page bundle.
12. Import the generated model into chat startup.
13. Duplicate the English fallback in the independent page.
14. Let an installed skill replace `/help`.
15. Disable the dictionary collision guard.
16. Disable dictionary decoding.
17. Add an undocumented multiline CLI route.
18. Duplicate reserved `/help` in compact ACP help.
19. Omit a shipped reference script from the frame vocabulary.
20. Hide the unavailable-current-values message.

## FIXHELPREF — RVHELPREF truth repairs (2026-10-05)

Rig: Kubuntu, Node 24.18.0; base `6d39a3bf`, branch `feat/help-reference-fix`.
All 23 review findings are fixed; no P1/P2/P3 false or missing-reference claim is
deferred. The pre-existing native/phone integration boundary remains named in
PLAN §9 as **HELPREF-native-companion-integration**. Those implementations are
absent; the reference explicitly identifies ACP’s local help/installed skills,
extension workflows and the implemented host/backend pairs. No native or phone
adapter, physical microphone, live CLI/model or paid transport is certified.

The model contains **52 features, 44 commands, 58 settings, 26 static panel
slash selectors, 78 CLI route/option/argument entries and 19 keyboard rows**.
Installed skill selectors are dynamic; first-prompt ACP help refreshes them and
announces commands before replying, while making no model turn.
The separate ACP row also retains its implemented session operations, model and
effort controls, permission/question requests, trusted project context and
Muse Code editor-MCP forwarding. Request names come from the registrations;
context/configuration names come from their constants. This distinguishes
existing ACP capabilities from the extension-only controls above.

Facts come from the paid registries, complete manifest schemas, runtime defaults
and scalar validators, CLI parseArgs declarations/aliases and admission probes,
slash parsers, menu conditions, keyboard-handler keys, shipped skill folders,
tool registries and existing constants. Explicit reviewed capability pairs are
checked independently of the feature catalogue; source witnesses invalidate
changes to the inspected host/admission wiring. Platform lists invoke the actual
pure helper selectors with helper/recorder presence assumed; this establishes
supported routes and remote refusals, not device access on this rig. Paid Linux
recording requires arecord or parec; free OS recognition excludes Linux. Model
API voice is explicitly unavailable in the current host wiring, even at zero
session cap. Search’s finite-budget prohibition remains visible.

The generated setting schemas retain nested required fields, bounds, enums,
additionalProperties and collection limits. Numeric endpoints/refusals and the
unique-check-name, valid-host and boolean-language-map refinements are checked
against readSettings. Environment-variable current values are never read or
sent. Unsupported hosts return an empty value set; the producer-to-page test
observes the unavailable notice. Failed NLS/model/bundle loads reply with an
explicit error and retry action; the bundle test evaluates the actual activation
closure, rather than a substitute handler.

The expanded data initially exceeded the unchanged 100 KiB reference cap.
Lossless interning of repeated JSON subtrees/tokens restored the budget; a
whole-model equality test compares decoding with the generated JSON, and a
reserved-token guard prevents collisions. There is no additional dependency or
fallback copy in the independent page. Every user-facing key has all 14 tables;
terminal command titles, setting prose/enums and nested annotations use installed
manifest NLS. CHANGELOG places Help under Unreleased.
The final ACP inventory briefly measured 100.2 KiB. Token admission now checks
the actual space saved by pooling, restoring the complete Node reference to
99.9 KiB without omitting facts. CLI descriptions select option lines rather
than unrelated usage lines; Markdown fills executable templates. Accepted but
unused login/Setup options are marked `acceptedUnused`, and `--maintenance`
identifies the maintenance event. These effects were checked against
`src/runtime/main.ts`'s login and Setup handlers.

### Finding certification

Generator = `test/unit/referenceGenerator.test.mjs`; Entry =
`test/unit/referenceEntry.test.ts`; Page = `test/unit/ReferencePage.test.tsx`;
ACP Agent = `test/unit/acpAgent.test.ts`. Each R-prefixed name is an owning test.

| Finding | Status and repair                                                         | Regression                                 | Deliberate failure                                                                           |
| ------- | ------------------------------------------------------------------------- | ------------------------------------------ | -------------------------------------------------------------------------------------------- |
| R01     | Fixed — Backend-specific Plan/Auto safety limits                          | Generator: R01                             | R01                                                                                          |
| R02     | Fixed — Thinking changes requested effort                                 | Generator: R02                             | R02                                                                                          |
| R03     | Fixed — Setup executes init, not Manual                                   | Generator: R03                             | R03                                                                                          |
| R04     | Fixed — Subscription review, cache and budgets are not paid extras        | Generator: R04                             | R04                                                                                          |
| R05     | Fixed — Explicit paid pairs, opt-ins and separate budgets                 | Generator: R05                             | R05                                                                                          |
| R06     | Fixed — Panel-only workflows exclude standalone ACP                       | Generator: R06                             | R06, R06-acp-*, source-acp-operations                                                        |
| R07     | Fixed — MCP ownership and skill loading/management differ                 | Generator: R07                             | R07                                                                                          |
| R08     | Fixed — Best-of-N has its own paid/trusted/Model API entry                | Generator: R08                             | R08                                                                                          |
| R09     | Fixed — Tab defaults to Invoke and supports either chat backend           | Generator: R09                             | R09                                                                                          |
| R10     | Fixed — Free recognition and paid recording have distinct platform rules  | Generator: R10                             | R10, R10-platforms, source-platforms                                                         |
| R11     | Fixed — CLI aliases, options, limits, private stdin and refusals          | Generator: R11; Entry: full help           | R11, source-cli, R11-markdown-slots, R11-key-stdin, R11-flag-description, R11-unused-options |
| R12     | Fixed — Slash grammar and dynamic-skill limitation                        | Generator: R12                             | R12                                                                                          |
| R13     | Fixed — Attachment, agent, conversation, output and recovery explanations | Generator: R13                             | R13, R13-slots                                                                               |
| R14     | Fixed — Nested setting contracts and runtime refinements retained         | Generator: R14                             | R14, source-bounds, source-refinements                                                       |
| R15     | Fixed — Menu prerequisites and component keyboard actions retained        | Generator: R15                             | R15, source-keyboards                                                                        |
| R16     | Fixed — CLI/page data parity and explicit ACP/current-value limits        | Entry/Page: R16                            | R16, R16-page                                                                                |
| R17     | Fixed — First ACP help refreshes installed skills without a model turn    | ACP Agent: R17                             | R17                                                                                          |
| R18     | Fixed — Independent action/tool/feature and semantic source gates         | Generator: R18 (six cases)                 | R18-*; source-actions/tools/adapters/facts                                                   |
| R19     | Fixed — Help appears under Unreleased                                     | Generator: R19                             | R19                                                                                          |
| R20     | Fixed — Unsupported producer yields empty values and a visible notice     | Entry/Page: R20                            | R20                                                                                          |
| R21     | Fixed — Read, model and synchronous bundle errors show retry and recover  | Entry/Page: R21; actual activation closure | R21-host, R21-load, R21-page                                                                 |
| R22     | Fixed — Full terminal help uses installed NLS                             | Entry: R22; production French launcher     | R22                                                                                          |
| R23     | Fixed — Command-specific sandbox, skills, browser, Tab and auth effects   | Generator: R23                             | R23                                                                                          |

### Failure receipts

[Exact hashes and named failures](help-reference/fixhelpref-drills.json) record
59 executed red runs. Each source was restored in finally and its SHA-256
matched the pre-mutation bytes. Every regression drill runs its complete owning
file(s), at most three, with `--maxWorkers=3 --testTimeout=120000`; no test-name
filter, skip, threshold change or snapshot acceptance is used. The final
boolean-map drill repeats with a probe-specific fixture so scalar defaults
cannot hide or impersonate the refinement guard. The packing drill corrupts a
schema-valid expanded surface; the named whole-model equality test fails.

Direct check:reference drills mutate real parser declarations, protocol actions,
model-tool registry, component key handler, runtime adapter, manifest numeric
bound, runtime boolean-map refinement and actual voice platform selector. The
first seven fail with semantic diagnostics; changed derived attachment/platform
facts fail generated freshness. A reserved JSON token also fails generation.
These are source-to-gate drills, in addition to disabling each corresponding
guard and observing the named R18 test fail.
Direct CLI branch flags and ACP registrations also have source-to-gate drills;
ACP inventory removal fails R06, and source registration drift fails freshness.

### Final validation

All checks below ran directly on Kubuntu. Owning vitest runs used at most three
files, `--maxWorkers=3 --testTimeout=120000`, without name filters or skips.

| Check                                              | Result                                                                                          |
| -------------------------------------------------- | ----------------------------------------------------------------------------------------------- |
| Reference generator / entry / page                 | 54 tests passed in three files                                                                  |
| ACP agent                                          | 94 tests passed                                                                                 |
| UI state / shared protocol / ACP runtime           | 352 tests passed in three files                                                                 |
| Manifest / palette registry                        | 71 tests passed in two files                                                                    |
| Total                                              | **571 distinct tests passed in nine files**                                                     |
| Five-project `npm run typecheck`                   | Exit 0                                                                                          |
| Changed-file ESLint / Stylelint / Prettier         | Exit 0; final edits checked and hook checks enabled                                             |
| Plain `npm run deadcode`                           | Exit 0; existing vendor and axe-core configuration hints only                                   |
| `npx jscpd`                                        | Exit 0, zero clones; repeated test assertion removed                                            |
| `npm run check:l10n`                               | Exit 0: 14 tables, 165 manifest strings, zero problems                                          |
| `npm run check:reference`                          | Exit 0; inventories and all generated files current                                             |
| `npm run check:host-api`                           | Exit 0: 332 APIs, zero problems                                                                 |
| Production `npm run build`                         | Exit 0; size, split, model-text, host-global and notices gates passed                           |
| Production CLI                                     | Ten exit-0 help/version invocations; full subcommand parity and installed French NLS verified   |
| Wide/narrow help accessibility, English and French | 16 pages across four themes: zero violations, undecided findings, exemptions or missing results |
| Red drills                                         | **59 runs fired; every source restored with matching SHA-256**                                  |

Production CLI receipts cover `help --all`, plain `help`, `--help`, `-h`,
`exec --help`, `report --help`, `scan-secrets --help`, `--version`, `-v`, and
`LC_ALL=fr_FR.UTF-8 help --all`, executed through the built `dist/acp.js`.
The three subcommand help outputs equal full help byte for byte. French output
contains the installed sidebar title, backend prose and Invoke enum text, with
no English sidebar title or unfilled command/server template.

`node scripts/a11y.mjs help help-narrow` and its `--lang=fr` variant passed.
Axe separately reports eight offscreen/obscured contrast elements per language
that it cannot measure; those limits remain visible and no exemption was added.
Other locales have table/schema validation, not new browser execution receipts.

Final unchanged budgets: extension **437.8/600 KiB**, Model API **446.6/475 KiB**,
chat startup **884.3/900 KiB**, lazy page **33.0/50 KiB**, Node reference
**99.9/100 KiB**, ACP **819.9/850 KiB**, deferred webview JS **49.7/50 KiB**.
No native/phone adapter, physical microphone, live model or paid transport was
exercised. Aggregate quality, merging, rebasing and pushing are forbidden by the
rig brief; the lead retains full integrated quality and the second truth audit.
No dependency, paid/live call, credential access or gate/cap weakening occurred.
