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

## REDHELPREF — Runtime-owned reference redesign (2026-10-05)

Rig: Kubuntu, Node 24.18.0; base `94a1e7d3b`, branch `feat/help-reference-fix`.
This record supersedes the previous claim that the heuristic inventory was
sufficient. Both audits' 39 findings have owning regressions. The page contains
52 features, 44 commands, 58 settings, 26 static slash selectors, 116 CLI rows
and 29 keyboard rows (eight contributed shortcuts and 21 webview contexts).
Installed skills remain dynamic. Native/phone implementations, live models,
physical microphones and paid transports are outside this certification.

### Sources of truth

| Fact kind          | Runtime source and resolver                                                                                          | Independent check                                                                     |
| ------------------ | -------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------- |
| Settings           | `package.json` contributed schema; `resolveSettingDefault`; complete schema/NLS annotations                          | Actual defaults, scalar endpoints and `readSettings` refinements                      |
| Commands           | Contributed command IDs and palette menus; `resolveCommandCondition`                                                 | Every menu condition, alternate paths and enablement grouping                         |
| Keyboard           | Contributed keybindings and `WEBVIEW_KEYBINDINGS`; every handler calls `webviewKey`                                  | Recursive webview source inventory plus real callback/focus/send tests                |
| Slash              | Runtime `SLASH_REFERENCE` carried by `slashCommandsOf`                                                               | Existing goal/review/loop parsers, code-quoted Markdown grammar                       |
| CLI/ACP            | `CLI_OPTION_REGISTRY` passed directly to runtime `parseArgs`                                                         | Every route/option/alias accepted or deliberately refused by actual parser            |
| Paid               | `PAID_USE_REGISTRY` used by `PaidUsage.add` and popup window grants; `isPaidSettingOn` uses Judge's actual predicate | Identity checked independently of feature setting relationships; tally/consent suites |
| Descriptions       | Own catalogue/NLS fields in English and all 14 locales                                                               | Conditional-state, failure-reference and untranslated-fact lint                       |
| Surfaces/admission | Existing runtime registrations, pure helper selectors and reviewed host wiring witnesses                             | Independent capability/action/tool inventory and existing audit regressions           |

Enum defaults are values with meanings, never an inferred enabled boolean.
Send gestures carry their setting condition in the runtime table. Common auth,
login and Setup options retain accepted-unused/refused contracts. Headless
images have their own noninteractive admission description. All search fields
use the text actually rendered, and visible feature links retain their targets.
No parser, consent, tally, sandbox, budget or feature behavior was relaxed.

The expanded model is still zod-parsed before use. Raw pooled JSON, base-36
indices and encoded numeric tokens preserve the unchanged bundle caps without
shipping another English table into the browser page. Whole-model equality
checks every decoded fact against the committed JSON; reserved strings cannot
collide with pool or numeric tokens.

### All audit findings

R01–R23 refer to RVHELPREF; B01–B16 refer to RVHELPREF2. “Prevented” here means
the reviewed bad state is rejected or its old derivation has been removed,
backed by the regression shown; it is not a proof of arbitrary future prose.

| Finding | Claim                 | Prevention                                                                           | Regression                          |
| ------- | --------------------- | ------------------------------------------------------------------------------------ | ----------------------------------- |
| R01     | Plan/Auto safety      | Captured backend limits retained; no generic read-only promise                       | Generator R01                       |
| R02     | Thinking              | Own catalogue field describes requested effort, not a display toggle                 | Generator R02                       |
| R03     | Setup                 | Operation description names the runtime init event                                   | Generator R03                       |
| R04     | Paid labels           | Runtime paid identities exclude cache, budget and subscription review                | Generator R04                       |
| R05     | Paid contexts         | Explicit host/backend pairs and separate admission/ledger facts                      | Generator R05                       |
| R06     | ACP workflows         | Independent capability inventory distinguishes extension workflows                   | Generator R06                       |
| R07     | MCP/skills            | Backend-specific registry descriptions preserve ownership                            | Generator R07                       |
| R08     | Best-of-N             | Separate paid feature and complete requirements; board stays free                    | Generator R08                       |
| R09     | Tab                   | Contributed Invoke default and either-backend key path retained                      | Generator R09                       |
| R10     | Voice                 | Actual helper probes and host refusal witnesses retain availability                  | Generator R10                       |
| R11     | CLI contracts         | Runtime parser table supplies routes, flags, aliases and contracts                   | Generator R11, B12                  |
| R12     | Slash/skills          | Runtime slash registry supplies grammar; dynamic skill limitation shown              | Generator R12, B07                  |
| R13     | Actions               | Dedicated translated catalogue fields and runtime action inventory                   | Generator R13                       |
| R14     | Settings              | Complete contributed schema plus runtime refinement probes                           | Generator R14                       |
| R15     | Conditions/keys       | Menu resolver and shared handler table retain prerequisites/actions                  | Generator R15, command visibility   |
| R16     | Surface parity        | Shared generated model rendered by page, terminal and Markdown                       | Entry/Page R16                      |
| R17     | First ACP help        | Existing refresh-before-help regression retained; no model turn                      | ACP Agent R17                       |
| R18     | Independent gate      | Runtime tools/actions/capabilities/parser/paid/key sources checked separately        | Generator R18, B06, B08             |
| R19     | Release placement     | Help remains under Unreleased; history test retained                                 | Generator R19                       |
| R20     | Unavailable values    | Real producer-to-page empty-values contract retained                                 | Entry/Page R20                      |
| R21     | Loading failures      | Explicit error/retry and real activation-closure regression retained                 | Entry/Page R21                      |
| R22     | Terminal localization | Installed NLS resolves command/settings/nested annotations                           | Entry R22                           |
| R23     | Operation prose       | Command-specific catalogue fields, including auth status/clear                       | Generator R23                       |
| B01     | Judge default         | Typed enum resolver preserves auto and its NLS meaning; actual on predicate tested   | Generator B01                       |
| B02     | Headless images       | Own description and parser/admission contracts state flag/mode/budget, no question   | Generator B02                       |
| B03     | Shortcut prose        | Each handler context owns its text; Tab fallback restricted to inline invoke         | Page B03                            |
| B04     | Delegation state      | Conditional translated prose; unconditional-state lint rejects old claim             | Generator B04/B05                   |
| B05     | Sandbox state         | Explicit Windows/use/off conditions; same lint rejects old prerequisite              | Generator B04/B05                   |
| B06     | Semantic drift        | Paid identity independent of feature settings; raw dispatch rejected; action tests   | Generator B06; Modal/keyboard truth |
| B07     | Markdown slots        | Grammar code-quoted; description slots escaped                                       | Generator B07                       |
| B08     | All key contexts      | Recursive webview inventory and 21 runtime contexts; real actions tested             | Generator B08; owning UI suites     |
| B09     | English facts         | Prose has catalogue/NLS fields; technical fact identifiers; raw prose lint           | Generator B09; localization gate    |
| B10     | Search                | Localized displayed fields, key text, schema/default/current values searched         | Page B10                            |
| B11     | Links                 | Visible feature relationships retain their command anchors under filtering           | Page B11                            |
| B12     | Auth flags            | All six common-parser routes share the actual option table                           | Generator B12; ACP Runtime          |
| B13     | Fixture regression    | Existing fixture builds reference; emitted referencePage script expected             | Deferred Bundles/Webview Bundle     |
| B14     | Tab choices           | Own translated Snooze/Menu fields list all durations and conditional Copilot choices | Generator B14/B15                   |
| B15     | Board prose           | Own translated field describes filtering/state/changes/approvals/activation          | Generator B14/B15                   |
| B16     | Exec option prose     | Exhaustive typed operation-description map; failure-key reuse rejected               | Generator B16                       |

### REDHELPREF failure receipts

[Executed mutations, commands, diagnostics and hashes](help-reference/redhelpref-drills.json)
record **19 deliberate red runs**, with nonzero exits, the expected named failure
and byte-exact SHA-256 restoration in every case. The first 17 ran against
implementation commit `091a5ba8e`; the last two also prove that a schema-valid
wrong billing fact fails the named whole-model equality test and that a failure
key with a suffix such as `execDeniedStop` cannot bypass the description guard.

Sources were changed one at a time in `finally`-protected runners. Direct
`check:reference` drills changed a manifest enum default, raw/computed keyboard
access, an actual parser option, paid identity, slash grammar, conditional prose,
failure references, unlocalized facts and a reserved numeric token. Complete
owning test files proved menu-condition loss, a wrong Modal action, shortcut
search loss, dangling filtered links, a missing deferred metafile, corrupt pool
indices and the schema-valid fact corruption. The localization gate proved a
missing translated option description. No test-name filters, skipped tests,
snapshot acceptance, threshold changes or timeout increases were used.

### REDHELPREF validation

All runs were local on Kubuntu. Vitest used at most three files per invocation,
`--maxWorkers=3 --testTimeout=120000`. Commands and results are retained in
[the validation receipt](help-reference/redhelpref-validation.json).

| Owning files                                | Tests passed |
| ------------------------------------------- | ------------ |
| Keyboard truth, Composer, PopoverMenu       | 86           |
| Palette, Modal, GooeyMenu                   | 32           |
| HistoryDialog, SessionBoardDialog, AgentMap | 29           |
| GoalPanel, elicitationCard, DeferredSurface | 19           |
| BestOfNDialog, toolRows, backgroundRows     | 49           |
| paidFeatures, paidConsent, paidHost         | 83           |
| ACP runtime and agent                       | 132          |
| deferredBundles and webviewBundle           | 36           |
| Reference generator, entry and page         | 75           |
| **Distinct total (25 files)**               | **541**      |

Five-project typecheck, changed-file ESLint/Prettier, plain knip, zero-clone
jscpd, localization, reference freshness, host API and production build passed.
The commit hooks ran exactly as configured: lint-staged with concurrency one,
ESLint/Prettier, then staged gitleaks with zero leaks. No dependencies were added,
no tools installed and no gate changed. The rig brief explicitly forbids the
aggregate quality run, merges and pushes; those were not run.

Production sizes: extension **437.8 KiB / 600**, Model API **446.6 / 475**,
Node reference **97.8 / 100**, reference page **33.8 / 50**, all deferred webview
JavaScript **49.8 / 50**, ACP **820.0 / 850**. The build's size, split,
model-text, host-global and third-party notice checks passed. Localization:
14 tables, 165 manifest strings, zero problems. Host API: 332 APIs, zero problems.

No live/paid call, credential read, device operation, native/phone integration,
full aggregate suite, push or merge is certified. The pre-existing integration
boundary stays explicit; none of the 39 audited repairs is deferred.

## FIXHELPREF3 — Third truth audit repairs (2026-10-06)

Rig: Kubuntu; base `c98f6b67c`. All six RVHELPREF3 findings are in scope.
The first completed piece repairs C03–C05:

| Finding              | Fix                                                                             | Regression                                                             | Deliberate failure                      |
| -------------------- | ------------------------------------------------------------------------------- | ---------------------------------------------------------------------- | --------------------------------------- |
| C03 — JSON search    | One formatter supplies both display and search for schemas, facts and contracts | ReferencePage C03 copies visible JSON fragments into search            | Remove JSON indentation; C03 fails      |
| C04 — Markdown slots | Escape angle brackets in every prose field while retaining code spans           | Generator C04 parses Markdown and checks literal slots across sections | Remove prose escaping; C04 fails        |
| C05 — Shift+Tab      | Modal forward/backward actions and the reference use the same gesture table     | Modal C05 compares inventory and actual focus movement                 | Replace backward Tab with F9; C05 fails |

[Mutation receipts](help-reference/fixhelpref3-drills.json) record the complete
owning-file runs, nonzero exits, named failures and matching before/restored
SHA-256 hashes. Baseline: three new regressions failed before their fixes;
afterwards all **68 tests in three files passed**. Five-project typecheck passed.
No test filter, skip, snapshot acceptance, relaxed guard or new dependency.

### C01–C02 — Permission and answer privacy

Auto's setting enum and permissions entry now contain both backend menu
resolutions with each reviewer on and off. Both settings default true. Commands
already settled by rules follow those rules; the Model API reviewer additionally
needs paid-use consent and budget admission. Either eligible reviewer can allow
once without a user approval card; unsuccessful reviews leave the decision to
the user. Ordinary ACP has neither reviewer.

The ordinary Submit feature now says that Muse receives submitted answers and
clarifications. MCP elicitation has a separate Model API feature and action
identity. Its form values go to the requesting server, outside the model
conversation/transcript; the server may later include them in tool output.

| Finding              | Regression against code                                                                                                                                                        | Red drill                                                  |
| -------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------- |
| C01 — Auto reviewers | Generator C01 compares both reviewer states with `permissionModeDetail`; traces ModelApiHost approval/paid admission and controller/ReviewedApprovals allow-once before a card | Remove the reviewed Muse Code limit; C01 fails             |
| C02 — Answer privacy | Generator C02 checks distinct entries and ModelApiHost question serialization/replay versus elicitation's server result                                                        | Restore the false ordinary-answer privacy claim; C02 fails |

Both P1 tests failed against the prior implementation and passed with the fixes.
The reference generator, entry and page pass **79 tests**. Existing fake transport
suites (`modelApiHost`, `modelApiElicitation`, `museCodeReviewer`) pass **676 tests**,
including reviewer ALLOW running `npm test` with no card, question answers and
clarifications reaching the next model request, and MCP answers absent from
emitted events and logs. These are fake requests, with no paid/live calls.
All 14 UI and manifest translations contain the corrected descriptions.

### C06 and the complete prose pass

Conditional prose now has a typed `conditions` field containing a technical
selector and a localized text reference. The generator validates nonempty
conditions, selector syntax and text references, and renders them in Markdown.
The shared formatter renders the same conditions for terminal help and the
webview, including installed translations and search. An explicit typed registry
marks existing conditional descriptions; no prose heuristic promotes a claim
into a condition. The plain-description lint rejects generic state wording,
including newly authored sentences and state words inside quotes or code spans.

The regression rejects new enabled/disabled/on/off/currently/when claims, retains
the native delegation explanation in its condition, and rejects empty condition
source data. Separate page and terminal regressions prove installed-language
rendering/search and the parsed model boundary. This supersedes the earlier
blanket description-guard claim: typed structure and generic wording are checked;
arbitrary semantic truth still requires a source audit and owning truth tests.

The [complete prose inventory](help-reference/fixhelpref3-description-audit.md)
records **334 distinct text references**, with owners and runtime witnesses:
53 features, 44 commands, 58 settings including enum meanings and nested
annotations, 26 slash rows, 116 CLI command/option rows and 29 keyboard rows.
Beyond C01–C06, the pass found and corrected **C07**:

- Hooks previously described only Muse Code. Its handler supports both backends
  and project, user, managed and `spark-hooks.json` sources; both catalogue
  strings and all 14 translations now say so.
- The `scan-secrets` command row previously described only its optional stdin
  key. It now describes UTF-8 patch scanning, failure on detection, optional
  exact in-memory key matching and no stored key, against the actual scanner.

The shared-identifier packing needed to preserve the existing hard bundle cap:
the first condition build correctly failed at **100.9 KiB / 100**. The generated
model and its validator now share one text-key tuple, avoiding duplicated
identifiers. The whole-model equality regression and a schema-valid identifier
swap drill prove that decoded facts and text retain their meaning. The production
build passes at **99.7 KiB / 100**; no budget or guard changed.

| Finding                         | Status    | Owning regression                               | Deliberate failure                                                               |
| ------------------------------- | --------- | ----------------------------------------------- | -------------------------------------------------------------------------------- |
| C01 — Auto reviewers            | Fixed     | Generator C01; fake reviewer runtime suites     | Remove Muse Code reviewed limit                                                  |
| C02 — Question privacy          | Fixed     | Generator C02; fake question/elicitation suites | Restore false ordinary-question privacy                                          |
| C03 — Displayed JSON search     | Fixed     | ReferencePage C03                               | Remove JSON indentation                                                          |
| C04 — Markdown slots            | Fixed     | Generator C04, parsed Markdown AST              | Remove prose escaping                                                            |
| C05 — Backward modal focus      | Fixed     | Modal C05, handler action and focus movement    | Replace Shift+Tab with F9                                                        |
| C06 — Structural condition rule | Fixed     | Generator, ReferencePage and referenceEntry C06 | Disable generic lint; remove condition selector display; remove boundary minimum |
| C07 — Additional prose audit    | Fixed     | Generator C07; hooks/scanner runtime suites     | Revert Hooks text; restore stdin-only scanner row                                |
| Shared text-key packing         | Preserved | Entire decoded-model equality                   | Swap two schema-valid text identifiers                                           |

The [drill receipt](help-reference/fixhelpref3-drills.json) retains commands,
mutations, named failures and matching before/restored SHA-256 hashes. All owning
files run without test-name filters. Every mutation is restored byte-exact in
`finally`; no skipped test, snapshot acceptance, timeout increase or gate change.
No C01–C07 finding is deferred. The pre-existing native/phone implementation
boundary and the lead's integrated quality gate remain explicitly outside this
scoped source and fake-runtime certification.

### Final scoped validation

All validation ran directly on Kubuntu, with one heavy process at a time.
Vitest ran at most three owning files per invocation, with
`--maxWorkers=3 --testTimeout=120000`.

| Owning suites                                       | Distinct tests passed |
| --------------------------------------------------- | --------------------- |
| referenceGenerator, referenceEntry, ReferencePage   | 83                    |
| Modal, museConfigCommands, scanSecrets              | 32                    |
| modelApiHost, modelApiElicitation, museCodeReviewer | 676                   |
| acpRuntime                                          | 38                    |
| **Total (10 files)**                                | **829**               |

There are **12 deliberate red runs**: all six findings, both extra C07 fixes,
shared text-key preservation, and condition rendering/model-boundary checks.
The final reference suites pass after every source restoration.
Five-project typecheck, changed-file ESLint/Prettier, plain knip, zero-clone
jscpd, localization, reference freshness, host API and production build pass.
Localization covers 14 tables and 165 manifest strings with zero problems;
host API reports 332 APIs with zero problems. The configured commit hooks use
lint-staged/ESLint/Prettier and staged gitleaks; no bypass is authorized.

Build sizes: extension **437.8 KiB / 600**, Model API **446.6 / 475**, Node
reference **99.7 / 100**, reference page **36.9 / 50**, deferred webview
JavaScript **49.8 / 50**, ACP **820.0 / 850**. Size, split, model-text,
host-global and third-party notice checks pass with their original limits.

The production ACP bundle successfully prints `help --all` in English and
French and `exec --help`, `report --help`, `scan-secrets --help`. These commands
make no model request. The help harness in English/French at ordinary and narrow
widths passes **16 pages across four themes**, zero violations, undecided rules,
exemptions or missing results. As printed by the existing gate, axe cannot
measure contrast for eight obscured/scrolled-out elements in each language run;
no new exemption or rule change was made.

[Machine-readable validation](help-reference/fixhelpref3-validation.json)
retains commands and results. No dependencies or tools were installed, no live
or paid request or credential read occurred, and no aggregate quality, merge,
rebase or push was run. The rig brief reserves integration and aggregate quality
for the lead.

## FIXHELPREF4 — Final focused truth audit repairs (2026-10-06)

Rig: Kubuntu; base `3a5da96d6`; scope: RVHELPREF4's P1 and both P2 findings.
No finding is deferred. This record supersedes FIXHELPREF3's incomplete C06
coverage claim.

| Finding                              | Status                                                                        | Regression                                                                                                                                                   | Deliberate failure                                                    |
| ------------------------------------ | ----------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------- |
| P1 — Best-of-N budget prerequisite   | Fixed in English, all 14 translations and every generated output              | Generator `RVHELPREF4 P1` runs production manager admission: the same finite cap refuses without a parent scope and admits a candidate with its owned scope  | Restore the false finite-budget prohibition; named P1 test fails      |
| P2-1 — Missing state predicates      | Fixed: closed predicate vocabulary in any plain description                   | Generator `RVHELPREF4 P2-1` covers the exact delegation sentence, all four verbs with all 14 states, right now, the future-feature control and neutral prose | Remove available from the predicate vocabulary; named P2-1 test fails |
| P2-2 — Skipped shortcut descriptions | Fixed: recursive walk of the complete emitted model, independent of row kinds | Generator `RVHELPREF4 P2-2` rejects both exact modal sentences and a future nested row; neutral shortcut prose passes                                        | Omit shortcuts from the output walk; named P2-2 test fails            |

The three regressions failed against the reviewed implementation: the P1 failure
shows its stale sentence after the production manager's finite-cap admission
checks, and both P2 failures show accepted plain state claims. The corrected
reference suites first passed 86 tests. New enum/prefix assertions and the
existing real-journal shared-budget suite are included in final validation.

The complete output walk also caught existing state prose in free dictation,
paid voice, bundled skills, restart help, enum descriptions and Judge's paid
availability facts. Those claims retain their original wording in explicit
typed conditions. Localized manifest references with English fallback support
conditional enum meanings. Page display/search, terminal help, Markdown and
nested facts preserve their selector and installed translation. Metadata keys
and technical enum values are not descriptions; resolved aliases are checked
through their authoritative typed text. Source audits remain necessary for
semantic claims outside the closed vocabulary.

The first production build correctly failed its unchanged reference cap:
**103,230 bytes / 102,400**. The existing lossless pool now packs repeated
technical string prefixes. Complete decoded-model equality, a corrupt-prefix
index regression, a reserved-marker gate drill and byte-exact restoration
certify the extension. The production reference measures **101,667 bytes
(99.3 KiB) / 100 KiB**; every bundle cap remains unchanged.

[Drill receipts](help-reference/fixhelpref4-drills.json) contain mutation text,
complete owning-file commands, named failures, nonzero exits and matching
before/restored SHA-256 hashes. Additional drills remove prefix decoding and
its index guard, installed-language enum resolution, and the page's enum
condition renderer. No test-name filter, skip, snapshot acceptance, changed
threshold, timeout increase or new dependency is used.

Final scoped validation is recorded in
[the validation receipt](help-reference/fixhelpref4-validation.json). All runs
use the worktree directly and one heavy process at a time. Vitest uses at most
three files, three workers and the rig-mandated 120-second test timeout. The
lead retains aggregate quality and integration/release certification under
the explicit rig brief. No credential read, live/paid request, dependency or
tool install, merge, rebase or push is part of this lane.

### FIXHELPREF4 final validation

All **95 distinct tests in four owning files pass**: 50 in the reference
generator, 15 in the terminal/model entry, 24 in the reference page and six
in the production-manager/shared-journal budget suite. The three generator
regressions failed against the reviewed implementation before their fixes.

Eight planned red drills have named failures and nonzero exits; every mutated
file was restored byte-exact. A ninth exploratory UI-only marker mutation
fired Markdown freshness because the model carries that text by reference.
The subsequent serialized CLI marker probe reached the intended reserved-token
guard; both probes are retained without conflating their outcomes.

Five-project typecheck and the final changed-file ESLint/Prettier, plain knip,
zero-clone jscpd, localization, reference freshness, host API and production
build pass. The receipt retains the initial lint findings and their final
green replacement; no lint rule or ignore was changed. Localization reports
14 tables, 165 manifest strings, 602 source files and zero problems. Host API:
332 APIs, zero problems.

Production sizes: extension **437.8 KiB / 600**, Model API **446.6 / 475**,
Node reference **99.3 / 100**, reference page **37.0 / 50**, chat startup with
static imports **895.1 / 900**, deferred chat JavaScript **49.8 / 50**, ACP
**820.0 / 850**. Size, split, model-text, host-global and notices checks pass.
The production ACP bundle prints corrected full help in English and French,
and successfully prints `exec --help`, `report --help`, `scan-secrets --help`.
Those routes load no backend or credential store and make no model request.

The existing pre-commit hook remains enabled (`.husky/_`): serial lint-staged
ESLint/Prettier and staged gitleaks. Local commit only; aggregate quality,
integration and publication remain with the lead under the rig brief.
