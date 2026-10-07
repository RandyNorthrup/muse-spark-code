# M117 U — estimator surfaces

Branch `m117/u`, Mac mini, 2026-10-06. Read the rig brief, shared rules,
AGENTS.md, D97 and M117 in full, the contract/G/S/R certifications and C's
prior before implementation. The authorized prerequisite merges are C
`df69a66aa` and S `c28cf3073`; PLAN/CHANGELOG conflicts retain both records.
No other merge, rebase, push, network, credential or paid call is authorized.

## Implementation plan

1. Implement strict CLI/slash options, a validated injected estimate runner,
   portable text/Markdown/HTML/JSON output, a report collector and TUI port.
2. Re-estimate on normalized lane-finished events, showing signed forecast
   drift. Cancel superseded work and discard late results after disposal.
3. Intercept ACP `/estimate` locally, with cancellation and safe errors.
   Absent bindings report waiting and never send the command to a model.
4. Build the shared React Estimator panel as a lazy entry: accessible Gantt,
   forecast marks, bottleneck, setup cards, complete inputs/disclosures,
   calibration and a provisioning port. An unbound P port disables Spin it up.
5. Exercise the surfaces on fakes, keyboard flows and axe in four themes at
   320 px. Prove each new guard with a named failing mutation and SHA-256
   restoration. Run scoped serial rig gates with default test timeouts.

## Ownership and binding boundaries

U consumes exported contracts/types only. R's exact-money repair is pending;
money presentation accepts `CatalogPrice` through an injected formatter,
with no numeric money arithmetic or conversion in U. W binds that formatter
to `src/shared/usd.ts` after R merges. No npm dependency is added.

W owns shipping build/size/split wiring, the manifest, help/catalog rows,
README/CHANGELOG/ACP guides and the runtime dispatch. Those files are not
silently changed here. The absent M113/M115/TUI sources and P implementation
use explicit ports; fixtures remain under `test/**`. Integration actions and
verification receipts follow below.

## First guard-fire receipts

All runs use the complete owning file, `--maxWorkers=3`, and the repository
default timeout on Mac mini. No test-name filter, skip or timeout override.
Each accepted mutation exits 1 with the named assertion below, and restores
the original bytes in `finally`, checked by SHA-256.

The initial extra rollover-comparison probe passed because the strict ISO
schema already rejects rollover dates. It is not a receipt. The redundant
comparison was removed in both command and panel; U01 bypasses the actual
strict date boundary and fails.

| Drill                   | Owning regression                                                                      | Exit |
| ----------------------- | -------------------------------------------------------------------------------------- | ---: |
| `U01-date-boundary`     | refuses malformed options, duplicate flags, rollover and ambiguous dates               |    1 |
| `U02-duplicate-flags`   | refuses malformed options, duplicate flags, rollover and ambiguous dates               |    1 |
| `U03-request-boundary`  | validates the request before dispatch and rejects damaged or mismatched engine replies |    1 |
| `U04-result-schema`     | validates the request before dispatch and rejects damaged or mismatched engine replies |    1 |
| `U05-result-request`    | validates the request before dispatch and rejects damaged or mismatched engine replies |    1 |
| `U06-abort-boundaries`  | aborts before dispatch and discards a result returned after cancellation               |    1 |
| `U07-html-escape`       | escapes hostile HTML and Markdown and uses only the injected price formatter           |    1 |
| `U08-event-relevance`   | refreshes only relevant newer lane-finished events and unsubscribes on close           |    1 |
| `U09-event-time`        | refreshes only relevant newer lane-finished events and unsubscribes on close           |    1 |
| `U10-drift-sign`        | shows signed finish-date drift with complete new disclosures                           |    1 |
| `U11-output-TZ`         | renders byte-identical terminal output across process time zones and languages         |    1 |
| `U12-acp-cancel`        | cancels the local estimate, denies overlapping prompts and suppresses a late result    |    1 |
| `U13-acp-error-privacy` | scrubs a throwing injected adapter from ACP output                                     |    1 |

Restoration hashes for this command/ACP piece:

- `src/runtime/estimator/command.ts`: `54f0caf9108b74864809fe389c4453d8eff5b854094788b15cbf6f79b818e432`.
- `src/runtime/estimator/session.ts`: `60e6103cc51af77082c55d41e14671fd1058aa7a574869191e55e9bb55ebbd5a`.
- `src/acp/agent.ts`: `d6577d1258f0dbc5cdb0f82b11d94a697196758ad52a4ffddf65abd684bb9a03`.

First green checks: 18 command/ACP tests with default timeouts; 6 panel
unit tests; 8 actual Chrome/axe theme-width cases (four captured themes,
690/320 px), all green. Heavy checks run serially. Final receipts follow.

## Panel and request-snapshot guard-fire receipts

The adapter-mutation regressions first failed against the mutable request
comparison. Both paths now save the request's canonical bytes before calling
an adapter. The panel keeps its own parsed request for refresh correlation.
The unrelated-refresh regression uses a _newer_ timestamp, so the time guard
cannot mask a missing goal guard. A pending request is aborted when a newer
matching section arrives, and its late reply cannot replace that section.

An initial U16 probe matched the subscription guard instead of the goal guard;
it failed the wrong named test and is not accepted. The corrected probe is
anchored to the goal guard. All rows below fail the named owning test and
restore the source byte-exact. Same default timeout and serial rig policy as
U01–U13. Final date and calibration-evidence presentation edits came after these hashes.

| Drill                              | Owning regression                                                                          | Exit |
| ---------------------------------- | ------------------------------------------------------------------------------------------ | ---: |
| `U14-command-request-snapshot`     | rejects an adapter that mutates the requested goal before returning its reply              |    1 |
| `U15-panel-request-snapshot`       | refuses an adapter that mutates the submitted request                                      |    1 |
| `U16-panel-goal-boundary`          | validates goals and refuses malformed or mismatched replies without showing a forecast     |    1 |
| `U17-panel-result-schema`          | validates goals and refuses malformed or mismatched replies without showing a forecast     |    1 |
| `U18-panel-refresh-schema`         | accepts newer matching refreshes and shows drift while ignoring stale or unrelated updates |    1 |
| `U19-panel-refresh-relevance`      | accepts newer matching refreshes and shows drift while ignoring stale or unrelated updates |    1 |
| `U20-panel-refresh-time`           | accepts newer matching refreshes and shows drift while ignoring stale or unrelated updates |    1 |
| `U21-panel-close-abort`            | aborts in-flight work and unsubscribes when the panel closes                               |    1 |
| `U22-panel-refresh-abort`          | aborts a pending calculation when a newer refresh arrives and ignores its late reply       |    1 |
| `U23-panel-late-reply`             | aborts a pending calculation when a newer refresh arrives and ignores its late reply       |    1 |
| `U24-panel-waiting-disabled`       | shows forecasts, calibration and all inputs, with an honestly disabled Spin it up          |    1 |
| `U25-panel-advice-disabled`        | keeps advice-only rentals disabled and hands an eligible setup to the injected P port      |    1 |
| `U26-gantt-expanded-state`         | opens Gantt lane details using native focusable buttons and labels the setup radios        |    1 |
| `U27-gantt-screen-reader-controls` | opens Gantt lane details using native focusable buttons and labels the setup radios        |    1 |
| `U28-palette-binding`              | offers estimate only after the local composer binding is available                         |    1 |
| `U29-finished-event-schema`        | refreshes only relevant newer lane-finished events and unsubscribes on close               |    1 |
| `U30-refresh-snapshot-boundary`    | refreshes only relevant newer lane-finished events and unsubscribes on close               |    1 |
| `U31-panel-unsubscribe`            | aborts in-flight work and unsubscribes when the panel closes                               |    1 |

Restoration hashes for this second piece:

- `src/runtime/estimator/command.ts`: `158a9b6f5cf13a46e37b83ac3741cd863ae7ac5d2bb74f4707c633be8e0c00bc`.
- `src/webview/estimator/EstimatorPanel.tsx`: `8de2b146ec6e9db63195ad4a702ea96d3dd88d1c8e373293450d0a3bda2d3c8c`.
- `src/shared/palette.ts`: `16b5b3732a52cfecc74504dbbae3be7604f87e637f4b1e651b52b734fe8bfe74`.
- `src/runtime/estimator/session.ts`: `60e6103cc51af77082c55d41e14671fd1058aa7a574869191e55e9bb55ebbd5a`.

## Concrete integration handoffs

- **M117-W-panel-binding:** lazy-import `EstimatorPanel` only when opening
  the Estimator, supply `initial` from the composer, and bind
  `EstimatorPanelPort`. The component forms a separate lazy JavaScript closure in the harness;
  its emitted stylesheet is linked by the harness page. Build, budget and split registration for the
  shipping panel and `dist/estimator.js` belong to W. No startup/deferred cap
  is changed and no shipping estimator bundle is claimed on this base.
- **M117-W-composer-binding:** call `wasEstimateComposerHandled` before
  normal submit/model dispatch in every shared-webview host; bind its `open`
  and `notice`. Set `PaletteContext.estimateAvailable` only once that handler
  is installed. The optional flag is false by default; ordinary prompts and
  existing palette rows retain their behavior.
- **M117-W-cli-binding:** dispatch the `estimate` route lazily to
  `runEstimateCommand(argv, dependencies)`; its strict parser handles the
  goal, `--by`, `--fleet`, `--format`, `--seed`, and local help. Add the route
  to `RuntimeCommand`/`parseCommandLine`, the CLI option/help registry and
  `runtime/main.ts` together. Adding a parser route alone would leave the
  executable with an unhandled command. W owns the public registration and
  featureCatalog rows; the function is tested directly here.
- **M117-W-acp-binding:** supply `AcpAgentDeps.estimate` from a lazy factory
  using `createAcpEstimate`, with the caller's installed table and cwd.
  Agent imports its port as a type only. Local command interception,
  announcement, cancellation, error privacy and absence of model dispatch
  are exercised through the real ACP SDK. Missing binding produces
  `Waiting for M117-W-estimator-binding.` and never dispatches a model turn.
- **M117-W-engine-and-money:** compose G/C/S/R into `EstimateRunPort`, passing
  only complete validated `EstimateSection` results. Preserve each resource
  disclosure, S's unknown-account/disk qualifications, C's `skippedRecords`
  and R's selected recommendation evidence in the complete inputs/honesty
  document. Bind `price(CatalogPrice)` to `src/shared/usd.ts` after the lead
  merges FIXM117R. No dollar arithmetic, credential access, price lookup or
  guessed external frame exists in U. The one pre-repair numeric catalog
  fixture in the test must follow R's repaired type when it merges.
- **M113-estimate-collector:** bind `collectEstimate` as the `estimate`
  section producer in M113's collector/renderers. U supplies a validated
  section and complete md/html/json/text output; the absent `report-v1`
  envelope, source discovery and collector registration remain with M113.
- **M115-lane-finished:** project the captured event to the explicit
  `EstimateFinishedPort` shape `{laneId, asOf}`. `EstimateViewSession`
  validates it, filters relevant/newer completions, refreshes from the new
  snapshot and computes signed drift against the last completed result.
  Bind its published sections to the panel/report subscription.
- **M110a0-T-estimate-view:** bind the real terminal/MHP view to
  `openEstimateTui`'s `show/error` and `refresh/close` callbacks. The port is
  exercised on a fake host. Actual terminal integration is waiting; there
  is no terminal emulator or production fake in U.
- **M117-P-start/provision:** keep `provision: {state:'waiting', dependency}`
  until P exists. It yields a disabled, described Spin it up button. Only P
  may provide a ready `spinUp` implementation with the board prerequisite
  audit, connected provider, budget and per-spend confirmation. Advice-only
  recommendations remain disabled even with a ready fake P port.
- **M117-W-docs-and-reference:** register `/estimate`, Open Estimator,
  the CLI/TUI/report kind and settings in featureCatalog/help/reference;
  update README, CHANGELOG, ACP, privacy/security and editor guides. These
  W-owned files are untouched. No new localization key or dependency is
  added: the surfaces use lane 0's existing translated estimator table.

All editors can bind the same runtime collector/session and shared React
panel; none of the portable surface modules imports `vscode` or a backend.
No live, paid, provisioning, source-network or credential call was run.

## Panel piece verification

Before committing the panel piece: 27 tests in estimateCommand, acpEstimate
and estimatorPanel, then 37 existing/new palette tests plus all 8 Chrome
scenarios, pass on the Mac mini with repository default timeouts. The browser
scenarios build the panel through a dynamic import once in beforeAll and serve
every asset locally under a reserved fake origin. Four captured VS Code
themes at 690/320 px pass WCAG 2/2.1/2.2 AA axe tags, keyboard Gantt expansion,
native radio switching and disclosure expansion, zero page errors, no
horizontal page overflow, newer drift and disabled pending-P action. Temporary
build directories are removed by afterAll. Final static/build receipts follow.

A further command-help regression failed before its fix (the complete owning
file exited 1 in `prints help or usage without reading snapshots or starting
the engine`): the CLI showed slash usage and omitted format/seed. It now keeps
the localized usage sentence, substitutes the technical CLI command token and
prints both technical option suffixes. Help/invalid syntax still calls neither
the snapshot source nor the engine.

The harness's ninth test, `keeps the Estimator panel in its own lazy chunk`,
checks esbuild's metafile for distinct scene/panel output and a dynamic-import
edge. U32 changes the dynamic panel import to a static import; the complete
nine-test e2e file exits 1 in that named test. Restored
`test/harness/estimator/scene.tsx` SHA-256: `4a7943665f1d8d6836c267ce17e40bef09d7ddbfd78758a507cf304bfd545ebe`. This certifies the
harness closure, not W's absent shipping build registration.

Scoped static checks so far: all five project typechecks and the extra harness
typecheck pass; knip passes (two pre-existing configuration hints); jscpd
reports zero clones; localization reports 14 tables, 166 manifest strings and
0 problems; reference freshness reports 53 features, 44 commands, 59 settings,
26 slash and 116 CLI rows current. The unregistered estimator additions must
still be added to the reference by W when their real bindings ship.

The first dead-code check correctly found the scene's relative string build
entry unreferenced. The e2e now resolves that actual build entry through
`fileURLToPath(new URL(..., import.meta.url))`, which knip can follow and which
also makes it independent of the caller's working directory. No ignore or entry
exemption is added. jscpd found four test clones; the panel shares its rejected
forecast assertion and the ACP test concatenates message chunks with a loop.
No rule, timeout, coverage or budget was weakened. CSS specificity ordering
was fixed and its scoped stylelint check passes.

**Known W-owned gate failure:** `node scripts/check-host-api.mjs` exits 1.
The generated record must add one import each for node:buffer, node:crypto,
node:fs, node:fs/promises and node:path from the prerequisite calibration
merge, and include `src/webview/estimator/estimator.css` in its stylesheet
list. Counts remain 332 VS Code APIs, 31 vscode-importing files, 25 Node
built-ins and 61 theme variables; exactly one generated-document problem.
The shared record is W-owned and is not rewritten in U.

The final honesty review strengthened two assertions, which both failed before
their fix in the complete owning suites: non-JSON CLI output had retained the
inputs and disclosures but dropped the numeric calibration model, and the
panel's honesty details likewise omitted its model parameters. All CLI
formats now retain the entire validated section in the evidence block; the
panel includes the full calibration rows alongside their disclosures. The
new assertions check the prior's contract value and actual review-round-rate
field rather than only a human summary or disclosure pointer.

Final owning runs before the panel commit: 27 command/ACP/panel tests and
46 palette/browser tests (37 palette + 9 browser), all pass with the default
Vitest timeout and at most three files/workers per run. Accepted mutation
receipts total 32, each with a named failure and SHA-256 restoration; help and
calibration-evidence regressions also failed before their fixes.

## Multipart ACP command regression

A final regression exposed model dispatch for `/estimate` with an attached
resource. It failed before the fix: the fake model dispatcher deliberately
rejects any call and the real ACP SDK returns Internal error. The initial fix
looked for text in normalized turn parts; that still failed when the resource
came first, because the existing ACP converter turns a resource link into a
text part. The final fix looks at the original validated ACP text blocks. Both
attachment orders now return local usage, call neither the estimator nor
`sendTurn`, and end normally. Ordinary prompts keep the existing path.

| Drill                   | Owning regression                                                           | Exit |
| ----------------------- | --------------------------------------------------------------------------- | ---: |
| `U33-acp-original-text` | keeps an estimate with extra context local instead of sending it to a model |    1 |
| `U34-acp-extra-context` | keeps an estimate with extra context local instead of sending it to a model |    1 |

Both restore `src/acp/agent.ts` byte-exact to `7a0a5a60f94b43f8ab96a817f6750c2ee1c88ce61cc3b36efe3b23c255e2ba2c`. Accepted guard-fire receipts now total 34.

After the multipart fix: the complete command/ACP/panel run passes 28 tests
(default timeout); together with the unchanged 46-test palette/browser receipt,
74 owning tests pass. Scoped ACP ESLint, host typecheck and unit typecheck pass
on the final fix. All five projects passed together on the panel commit; the
webview/e2e/integration and harness code is unchanged by this final ACP fix.

## Deadline fidelity regression

The panel's previous date picker silently changed an initial explicit
`2026-10-08T04:00:00.000Z` to midnight. The new complete-panel regression
failed on that exact before/after mismatch. The deadline field now preserves
the UTC instant as entered, and accepts a strict ISO calendar date as UTC
midnight. The existing request schema rejects rollover dates before dispatch.
An invalid submission clears the old result and active view correlation so a
subsequent old-view refresh cannot restore that result or its action.

| Drill                          | Owning regression                                                                     | Exit |
| ------------------------------ | ------------------------------------------------------------------------------------- | ---: |
| `U35-deadline-precision`       | preserves an explicit UTC deadline and accepts strict calendar dates without rollover |    1 |
| `U36-deadline-calendar`        | preserves an explicit UTC deadline and accepts strict calendar dates without rollover |    1 |
| `U37-invalid-view-correlation` | preserves an explicit UTC deadline and accepts strict calendar dates without rollover |    1 |

Each restores `src/webview/estimator/EstimatorPanel.tsx` byte-exact to `8dc480180d7f08e98a97f2a94dd5e083e03b68821af04d6c3544ae16c87a4ad3`. Accepted mutation receipts now total 37.

The final production build exits 0, including size, split, host-global and
third-party-notices checks. Measured shipping sizes: extension 439.5/600 KiB;
Model API 446.9/475; ACP 822.7/850; webview startup including static imports
797.3/900; deferred JavaScript 50.0/50; reference 98.2/100. No cap changes.
These are the existing shipped surfaces plus U's ACP interception/palette
flag, **not** certification of the absent shipping estimator registration.
W must measure and guard the estimator's real lazy entries when binding them.
All five typecheck projects passed on the committed panel; host and unit were
checked again after the multipart ACP fix. Final panel checks follow below.

## Browser gate-fire receipts

Both new browser gates are seen to fail independently of keyboard setup.
U38 breaks only the goal label association; the completed scene still loads,
and axe returns a label violation in all eight theme/width cases. U39 forces
the container to 900 px; the scroll-width assertion fires at 320 px (and the
wide cases). Each run uses the entire nine-test e2e file with default timeout.

| Drill              | Named browser case                                           | Exit | Restoration SHA-256                                                |
| ------------------ | ------------------------------------------------------------ | ---: | ------------------------------------------------------------------ |
| `U38-axe-label`    | passes axe and keyboard Gantt/setup flows in light at 690 px |    1 | `8dc480180d7f08e98a97f2a94dd5e083e03b68821af04d6c3544ae16c87a4ad3` |
| `U39-narrow-width` | passes axe and keyboard Gantt/setup flows in light at 320 px |    1 | `cc0e1d0f67d2a161af27e86187b3d7972020544fd9f6fdb6fcbeceeab3bb44b7` |

Accepted mutation receipts total 39. The final owning unit run passes 29
tests (14 command, 6 ACP, 9 panel); the palette/browser run passes 46
(37 palette, 9 browser). Total 75, default Vitest timeout, at most three
files/workers per run. After the final panel change, scoped ESLint and the
webview and unit typechecks pass. The entire nine-test browser file passes
again after U38/U39 restoration (11.52 s, default timeout). Final plain
`npx jscpd` exits 0 with zero clones. Full quality, aggregate unit coverage
and shipping estimator entry registration remain W/the lead's integration
work under this scoped brief.

Final localization check exits 0: 14 tables, 166 manifest strings, 624
source files, zero problems. Final scoped Prettier and commit-hook checks
cover the deadline fix and this record. No threshold, ignore, timeout,
dependency or localization key was added.

## Final lane receipt and resume action

Implementation pieces are committed as `85af46b32` (portable command/ACP/
refresh surfaces), `63e766c86` (panel, harness, palette and certification)
and `4b689cba4` (multipart ACP local interception); the final deadline fix
and receipts follow those commits. Every commit retains hooks, scoped lint/
format checks and secret scanning. No live or paid call was made. All 39
accepted drill receipts were checked before deleting their 48 owned scratch
files; their named failures and byte-restoration hashes are retained here.

The first integration action is **M117-W-engine-and-money**: after merging
FIXM117R, bind the exported engine contracts and exact-money formatter to
the injected runner and update the pre-repair numeric test fixture. Then
W can register and budget the real lazy panel/CLI/ACP entries, regenerate
its host API record and run the aggregate gates. M113/M115/TUI/P bindings
remain the explicit handoffs above; no production fake stands in for them.
