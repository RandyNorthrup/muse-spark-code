# M113 X — runtime, ACP, companion and MHP

2026-10-06, Kubuntu rig, worktree `/home/randy/lanes/M113X`, branch
`m113/x`, base `9b83bc3b0` (lane 0 and R). Authority: the rig brief,
`/home/randy/lanes/_ctx/codex/common.md`, AGENTS.md, PLAN D93 and M113
(read in full), lane 0's frozen contracts and lane R's certification.
Read the referenced M71 capture/certification, M80 schema contract, M84
export/scrub certification and M93 research/runtime certification.

No network, credential-store read, paid/live model call, new dependency,
global setting, merge, rebase or push. Model attempts: zero. No source or
provider wire shape was invented. The bridge tests use the frozen method
payloads; M104's envelope and capability negotiation remain its owner's work.

## Delivered

- `reportsArgs.ts` and `reportsCommand.ts`: all named kinds, scoped
  arguments, Markdown/HTML/JSON/text, `--out`, `--as-of`, `--lang`,
  `--network`, verified `--from`, `--diff`, `--full`, `--strict`, repeated
  `--fail-on`, and `report history [kind]`. Unknown/irrelevant options
  fail with exit 2. Generation, usage, not-found and condition exits are
  0/1/2/3/4 as D93.15 specifies. Stdout contains the exact artifact,
  including its existing final newline. Fixed localized diagnostics never
  quote rejected JSON, storage failures or source exceptions.
- The existing bare `report` parser and builder are preserved.
  `report problem` is an alias with identical options and results. Named
  reports dispatch separately; neither enters the backend or auth paths.
- Saved reports pass R's schema, redaction and content-hash verification.
  Imports resolve their real path before reading bytes, refuse credential
  names with both separator styles, and the process adapter refuses a
  symbolic-link file. UTF-8 decoding is strict; the held-file reader is
  bounded at M84's existing 16 MiB import limit. Save locations are only
  the explicit `--out`, or the injected history store.
- `reportsEntry.ts` exposes `createRuntimeReports` and `createReportsHost` for the lazy
  `dist/reporting.js` entry. A requested display table is validated without
  installing global language state. Source/history factories are scoped to
  the calling workspace and session. Missing bindings return an explicit
  failure; no production fake source, collector or store is supplied.
- ACP announces and reserves `/report`; `/report`, `/report <kind>` and
  `/report history` stay local, including malformed/attached invocations
  and missing/throwing engines. `--save` calls the history port. Session
  reports receive the current session id. Markdown/text is an explicit
  client-adapter preference: ACP has no standard Markdown capability to
  guess. A cancelled/released report emits no late message and starts no
  model turn or backend cancellation.
- `reportsHost.ts` implements all five `ReportsHostPort` calls for the
  companion and native, TUI and desktop hosts. Every payload/result is
  validated. History headers and comparison text must already be scrubbed;
  the facade rejects unsafe store/diff replies before the bridge receives them. Workspace authorization precedes storage access, is checked
  again after awaits, and cannot authorize a different bound workspace.
  Saved ids are looked up by kind; get/compare verify saved hashes and
  kind/scope/header identity instead of regenerating inputs. Open renders
  with the same factory as CLI/ACP. Fake JCEF, WebView2, SWT, companion,
  TUI and desktop bridges serialize the frozen payloads and validate replies.
- The runtime CLI table registers named reports/history and the problem
  alias; reference output is regenerated. ACP packaging requires the
  separate reporting bundle and ships the report-v1 schema.

## Named integration handoffs (other lanes' files left alone)

| Handoff                 | Owner            | Binding                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| ----------------------- | ---------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| M113-X-source-collector | S/K/W            | Bind `RuntimeReportsInput.servicesFor(cwd, sessionId)` to S's runtime snapshot and K's collector; return a finalized/verified report or the typed not-found result. Respect the captured `asOf`, explicit network flag and cancellation signal.                                                                                                                                                                                                                                                                                                                          |
| M113-X-condition-facts  | K                | Supply `ReportsServices.conditions(document)` from semantic facts for drift/blocked/channelLag/ciFailing. Unavailable source status is evaluated directly. Missing semantic evaluation fails instead of falsely passing a requested gate.                                                                                                                                                                                                                                                                                                                                |
| M113-X-history-diff     | H/R/W            | Bind scoped list/get/save and pure compare/renderDiff ports. List newest saved first (the saved-sequence contract); CLI selects descending `asOf` at or before the new report, preserving the saved sequence for ties, of the same kind/scope before saving it. Explicit-file comparisons verify both inputs. Diff output follows R's redaction/hash-metadata contract.                                                                                                                                                                                                  |
| M113-X-runtime-settings | M104 B/W         | Read network and keepHistory from the runtime settings store when composing services. Default keepHistory is true; terminal network remains off unless flagged.                                                                                                                                                                                                                                                                                                                                                                                                          |
| M113-X-lazy-build       | W                | Build `src/runtime/reporting/reportsEntry.ts` as `dist/reporting.js`; the entry already exports `createReportsHost` for host composition; register its separate cap, split rule, notices and package exclusion/entries. No build/split/cap file owned by W was changed here.                                                                                                                                                                                                                                                                                             |
| M113-X-companion        | M104 C/V         | Bind the companion server's report route/view to the scoped host facade and V's shared lazy report view. That server/page is absent from this base.                                                                                                                                                                                                                                                                                                                                                                                                                      |
| M113-X-native-hosts     | M104 0/b–d       | Bind host-initiated MHP 1.2 methods after capability negotiation; construct a facade with the transport's authorized workspace and host save/open dialog. Real JCEF/WebView2/SWT receipts wait for these hosts.                                                                                                                                                                                                                                                                                                                                                          |
| M113-X-TUI-desktop      | M110a0 T / M111b | Bind Reports view and `:report` to text; desktop Reports tab/launcher to HTML, through the same port. Those host implementations are absent and are explicitly waiting.                                                                                                                                                                                                                                                                                                                                                                                                  |
| M113-X-help-docs        | W                | Add featureCatalog/report feature and flag-description metadata; README Reports and CLI exit codes, CHANGELOG Unreleased, ACP `/report`, CI `--fail-on`, privacy/security and host compatibility rows. Include RVM113X's fixed-entry handoff: local CR/LF/CRLF/tab/space/NBSP slash dispatch, refusal after history-save revocation/cancellation, explicit supported formats and honest unsupported-format refusal, and equal-`asOf` saved-sequence comparisons. W owns these files; X's generated reference includes runtime rows without claiming unmerged hosts ship. |

The `servicesFor` seam is the planned integration boundary, not a shipped
empty implementation. Main does not construct missing S/K/H stores.
`--from` operates independently of them. History formats are text, Markdown
and JSON; generation/re-rendering supports all four D93 formats. ACP reserves
its output for Markdown/text messages; use the CLI for HTML/JSON/file output.

## Validation

Intermediate default-timeout runs: CLI/M93 32 cases (two initial test/data
corrections, then green); CLI/ACP/host 22/22; ACP/entry and existing ACP
94-case regression suite 104/104; subprocess CLI, CLI/diff and host 22/22.
The subprocess suite builds once in beforeAll and runs the real runtime main
and lazy loader against a test-only S/K binding, without any backend start.
The repository timeout is unchanged; no `--testTimeout` was used.

Final default-timeout runs passed on Kubuntu: runtime command/entry/host
27/27; ACP report/new and existing agent/M93 regressions 119/119; real
subprocess CLI, entry and lazy reference regressions 26/26. Across the eight
files these are 165 distinct cases (the entry suite appears in two runs).
Logs: `temp/m113-x/final-runtime.log`, `final-acp.log`, `final-cli.log`.
Aggregate `npm run quality` is delegated to the lead by the rig/common
rules; it was not run or weakened here.

## Deliberate-break receipts

Each entire named test file ran directly on Kubuntu with `--maxWorkers=3`
and the default timeout. Every mutation exited 1 with the named test
failing, then its source was restored in finally and SHA-256 compared equal.

| Drill               | Source                                    | Named failing test                                                              | Restored SHA-256                                                   |
| ------------------- | ----------------------------------------- | ------------------------------------------------------------------------------- | ------------------------------------------------------------------ |
| legacy-bare         | `src/runtime/cliArgs.ts`                  | `test/unit/reportsCommand.test.ts`: keeps bare report                           | `140ed3f51064a0af3ac50eb5f6e6a8b6d6939db53085719ad17eac8a8f53ffea` |
| format-guard        | `src/runtime/reporting/reportsArgs.ts`    | `test/unit/reportsCommand.test.ts`: refuses malformed arguments                 | `b0fcf991aa99f04ad785b952f5b28a1bce966e700a7593d610ee0617bd7c5476` |
| offline-default     | `src/runtime/reporting/reportsArgs.ts`    | `test/unit/reportsCommand.test.ts`: renders all four formats                    | `b0fcf991aa99f04ad785b952f5b28a1bce966e700a7593d610ee0617bd7c5476` |
| saved-kind          | `src/runtime/reporting/reportsCommand.ts` | `test/unit/reportsCommand.test.ts`: wrong-kind saved input                      | `8bd133360fa59fae9a4314b4bb3cb8202f695cd38aa48f69fe218436eca8cd28` |
| strict-exit         | `src/runtime/reporting/reportsCommand.ts` | `test/unit/reportsCommand.test.ts`: returns all five exits                      | `8bd133360fa59fae9a4314b4bb3cb8202f695cd38aa48f69fe218436eca8cd28` |
| history-save        | `src/runtime/reporting/reportsCommand.ts` | `test/unit/reportsCommand.test.ts`: saves exact output and history              | `8bd133360fa59fae9a4314b4bb3cb8202f695cd38aa48f69fe218436eca8cd28` |
| cancel-guard        | `src/runtime/reporting/reportsCommand.ts` | `test/unit/reportsCommand.test.ts`: does not produce output or save a cancelled | `8bd133360fa59fae9a4314b4bb3cb8202f695cd38aa48f69fe218436eca8cd28` |
| scope-authorization | `src/runtime/reporting/reportsHost.ts`    | `test/unit/reportsHost.test.ts`: authorizes workspace                           | `750881580f40c7aae0136da462d0749bafdb24870e00156e8ad7e67ef97357ec` |
| saved-history-kind  | `src/runtime/reporting/reportsHost.ts`    | `test/unit/reportsHost.test.ts`: rejects missing/foreign/tampered               | `750881580f40c7aae0136da462d0749bafdb24870e00156e8ad7e67ef97357ec` |
| comparison-headers  | `src/runtime/reporting/reportsHost.ts`    | `test/unit/reportsHost.test.ts`: compares saved inputs only                     | `750881580f40c7aae0136da462d0749bafdb24870e00156e8ad7e67ef97357ec` |
| credential-name     | `src/runtime/reporting/reportsEntry.ts`   | `test/unit/reportsEntry.test.ts`: refuses lexical and resolved credential paths | `25c41a90963af1e53bf0df8367cc071e35fec3e0bbffd221ee215b83f66f68e3` |
| acp-local-intercept | `src/acp/agent.ts`                        | `test/unit/acpReports.test.ts`: announces the reserved command                  | `cf309ba850ffb94dd7f8346a80e74a64a0492e945cd992278f911386c06db503` |
| acp-availability    | `src/acp/agent.ts`                        | `test/unit/acpReports.test.ts`: announces the reserved command                  | `cf309ba850ffb94dd7f8346a80e74a64a0492e945cd992278f911386c06db503` |
| acp-format          | `src/acp/reports.ts`                      | `test/unit/acpReports.test.ts`: passes the explicit text-client                 | `5e588a367b8617b76e439875459f509a6ca8459467fe3340a739bc52d3bcc367` |
| bundle-export       | `src/runtime/reporting/reportsLoader.ts`  | `test/unit/reportsEntry.test.ts`: loads on demand                               | `cf11cb2b9ad4060a3e106298d76ed7bb3a8bf0ff6716373922ff337fa5e5ccf6` |

All 15 mutations fired and all 15 restorations matched. The ACP fall-through
drill intentionally timed out fake backend turns; restored runs require no
raised timeout. Receipts/logs: `temp/m113-x/drills.json` and its named logs
(in this worktree, ignored), summarized above for the lead.

The subsequent diagnostic-table correction has its own red drill:
`uses the requested table for diagnostics` failed when `text: table` was replaced with
`text: input.table`; exit 1, exact restoration SHA-256
`a4c32fd3d2a1157831e6c5be38ada4dbda942a41972cc5cf9cf401ef2b8feded`. Total: 16 guards drilled successfully.

## Static and focused coverage receipts

All five `npm run typecheck` projects passed on Kubuntu. Changed-source
ESLint and changed-file Prettier passed. Plain `npm run deadcode` passed
after the test-only collector was exercised through its exported factory;
`npx jscpd` found zero clones. `schema:report -- --check` and `check:reference` passed
with the regenerated runtime rows. The default-timeout three-file runtime
coverage run passed 27/27 tests and the repository thresholds unchanged:
90.96% statements, 88.81% branches, 93.61% functions, 95.59% lines.
Logs are `temp/m113-x/typecheck-final.log`, `final-runtime.log` and
`duplication-final.log`.

Two integration gates explicitly remain red, without an ignore or lowered
threshold:

- `check:l10n`: 7 problems, all seven prepared lane-0 manifest keys still
  unused by the unchanged `package.json` (Show report, network description
  and its three enum descriptions, keepHistory and agentSources). No new
  string key or translation was added by X; all fourteen existing tables
  supply the texts this lane uses. W owns the manifest binding.
- `check:host-api`: generated record freshness, Node `crypto` import count
  46 → 47 and `util` 5 → 6. The API inventory remains 332 VS Code APIs,
  31 importing files, 25 Node built-ins and 61 theme variables. W owns
  `docs/ide-compatibility/host-api.md`; X did not overwrite it.

These are named M113-X-lazy-build/help-docs handoffs, not permission to
weaken the gates or a claim of full-milestone certification.

## Production build receipt

`npm run build` exited 0 on Kubuntu, with every existing size/split gate
unchanged: extension 439.5 / 600 KiB; Model API 446.9 / 475 KiB; ACP
824.8 / 850 KiB; webview main 359.0 KiB; deferred JavaScript 50.0 / 50
KiB. The ACP activation carries the loader and local command interception,
not the reporting implementation. Log: `temp/m113-x/build.log`.

This base's W-owned build list does not yet emit `dist/reporting.js`; the
normal production build's green result certifies the existing bundles, not
a complete report package. The package script now deliberately refuses
a missing reporting chunk. Registering that chunk, its dedicated cap and
notices is the explicit M113-X-lazy-build handoff above. No existing cap
was raised, and no unfinished report UI was inserted in the full deferred
webview budget.

## Final host-output guards and package probe

The added history-header and comparison-text regression cases both failed
against the first committed facade (`unredacted-before.log`); its successful
schema parsing was not sufficient to establish output redaction. After the
fix, both pass. Removing each guard individually fired its named test,
exit 1, then restored `reportsHost.ts` byte-exact at SHA-256
`a4ea74bb56067ab9bde878d9d3977ca010669a671a0d77b5ac04e15732528d22`.
Receipts: `temp/m113-x/drills-host-output.json`,
`history-output-redaction.log`, `comparison-output-redaction.log`.
Total successful guard drills: **18**. Verified document-header hashes are
excluded only at their structural paths, rather than exempting arbitrary
hash-looking source text. The same lazy entry now exports the host facade.

A separate production-style Node 20.18/minified build of that entry,
using shared English and shared wire and keeping report validation inline,
is **96,194 bytes (93.9 KiB)**. Both exported factories load successfully;
its metafile has zero backend, paid-engine or host-adapter inputs. This is
X/R's component measurement, not a budget for the joined S/K/H engine.
Logs: `temp/m113-x/reporting-size.log` and `reporting.meta.json`.

An initial probe with the existing `sharedValidation` plugin failed to load
because its exports lack the report schema's `globalRegistry`. R already
records that integration limitation. W must retain inline report validation
or deliberately extend the shared validator and its split guard; blindly
externalizing it is not a shipping configuration. No shared entry or gate
was changed in this lane.

After placing that isolated build in ignored `dist/reporting.js`,
`node scripts/package-acp.mjs` passed locally. The tarball contains the
reporting bundle and report-v1 schema. A sanitized-environment smoke run of
the staged real ACP package matched all four saved-report golden files
byte for byte and loaded the real German table. No keyring, backend or
source/history binding was used; there was no publish or install. Logs:
`temp/m113-x/package-acp.log`, `package-smoke.log`. This manual supplement
proves the package layout; the standard W-owned build still needs the entry
registration and notices/metafile coverage before packaging is integrated.

Local implementation commit: `df3afec80`, with lint-staged and gitleaks
passing under the existing hooks. Final host-output/export and certification
changes are a follow-up commit, also with hooks enabled. All source and
test changes remain confined to the lane's assigned worktree and files.

## RVM113X repairs — 2026-10-06

Authority: `/home/randy/lanes/_ctx/M113X.rig.md`, the complete shared
`codex/common.md` and `codex/RVM113X.report.md`. Started from `ce59782f0`
on Kubuntu. All four P2 findings are fixed; there were no P1/P3 findings,
and **no review residual is left**. No dependencies, schema fields, shared
build guards or thresholds were added or widened. No model, paid, network
or credential-store call ran; no merge, rebase or push ran. The existing
integration handoffs above remain explicitly open.

| Finding                    | Fixed behavior and files                                                                                                                                                                                                                                                                                                                                                              | Regression                                                                                                                                                                                                                                                                                                                                           |
| -------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| RVM113X-1 slash boundary   | `src/acp/reports.ts` owns one quote-aware tokenizer, re-exported through `reportsArgs.ts`. The local head and runtime arguments accept CR, LF, CRLF, tab, space and NBSP. Only the head is consumed before interception, so malformed argument quotes still fail locally. MHP keeps its frozen structured options and invokes the same engine; there is no guessed raw-command field. | `acpReports.test.ts`: **intercepts CR, LF, CRLF, tab, space and NBSP report separators without model dispatch**. The real ACP agent gets `/report\r\nproject`; the fake backend rejects immediately if dispatched. `reportsCommand.test.ts` also checks the same separators in arguments.                                                            |
| RVM113X-2 asynchronous run | `reportsHost.ts` checks cancellation before authorization and after its await, reauthorizes immediately after generation, and reauthorizes after history saving before returning the document. A save already admitted may finish, but a revoked/cancelled caller receives only the fixed refusal.                                                                                    | `reportsHost.test.ts`: **refuses a document when authorization is revoked while history saving awaits**; **refuses a document when cancellation occurs while history saving awaits**. Deferred saves let the tests change state while the operation is actually pending. A pre-cancelled request touches neither authorization nor generation.       |
| RVM113X-3 format contract  | `reportsArgs.ts` retains whether format was explicit; `reportsEntry.ts` uses it rather than replacing it with the adapter default. Markdown ACP supports explicit md/text; text-only ACP defaults to text and refuses explicit md/html/json (exit 2, before source/history access). CLI and MHP retain all four renderers; a refusing host opener returns an honest failed result.    | `reportsEntry.test.ts`: **honors explicit ACP text and Markdown formats and refuses unsupported transport formats**, including `--format=text`. Existing CLI/golden subprocess cases exercise all four formats. `reportsHost.test.ts` checks byte-exact renderer output for all four through the serialized fake bridge, plus refused opening.       |
| RVM113X-4 previous history | `reportsCommand.ts` includes `asOf` equality, chooses descending timestamp and then latest saved sequence, and compares before saving. H's list port is explicitly newest-saved-first; stable sorting preserves that authoritative sequence for timestamp ties, without adding a wire field or using opaque ids as time.                                                              | `reportsCommand.test.ts`: **includes equal-asOf reports and selects by timestamp then latest saved sequence**. Two reports share a fixed timestamp, have ids opposite their saved sequence, and coexist with older/future/foreign-scope entries. Removing the second exposes the identical-hash previous report and succeeds with “No change since”. |

The regression-first runs against original production code exited 1:
`before-acp-host-entry.log` had four named failures (separator, format,
revocation, cancellation), with 19 existing cases passing;
`before-command.log` had the equal-timestamp failure, with 14 passing.
After the repairs, final complete default-timeout runs passed **172 distinct
tests across eight files**: ACP reports/host/entry 24/24; runtime
command/existing ACP agent/M93 report 129/129; CLI subprocess/lazy reference
19/19. At most three files and three workers ran at once. No test filter,
skip or `--testTimeout` was used. The existing subprocess suite shares its
build in `beforeAll`. Logs: `temp/m113x-fix/final-acp-host-entry.log`,
`final-command-acp-legacy.log`, `final-e2e-reference.log`.

All eight deliberate breaks ran the complete named test file with the same
default timeout and `--maxWorkers=3`. Every mutation exited 1 and its named
regression failed; every source was restored in `finally` and its SHA-256
matched byte-exact. The save drill failed both revocation and cancellation
tests. Receipts: `temp/m113x-fix/drills.json`, `drills.log`, and each drill's
named log.

| Drill                                | Broken guard                                        | Named failing regression                                                                 | Restored source SHA-256                                            |
| ------------------------------------ | --------------------------------------------------- | ---------------------------------------------------------------------------------------- | ------------------------------------------------------------------ |
| slash-separators                     | Shared whitespace tokenizer reduced to space/LF/tab | ACP **intercepts CR, LF, CRLF, tab, space and NBSP…**                                    | `26314be9615dbcde01f1bd6834624918dc58edce307d098e62e4560677c19337` |
| post-generation-authorization        | Removed authorization after generation              | Host **rejects missing/foreign/tampered…revocation during generation**                   | `afa8a0fd64826a48f7346f05764e3c31a4b3af281fe49b7034a61acda5dded3b` |
| post-save-authorization-cancellation | Removed authorization after history save            | Host **refuses a document when authorization is revoked…** and **…cancellation occurs…** | `afa8a0fd64826a48f7346f05764e3c31a4b3af281fe49b7034a61acda5dded3b` |
| preauthorization-cancellation        | Removed initial signal check                        | Host **refuses a cancelled run before awaiting authorization or generation**             | `afa8a0fd64826a48f7346f05764e3c31a4b3af281fe49b7034a61acda5dded3b` |
| explicit-acp-format                  | Forced the adapter default                          | Entry **honors explicit ACP text and Markdown formats…**                                 | `3e413dca36a59673c0a09b92e94e5bc5fed89346a47af70588e3851d5adbb647` |
| text-only-format-refusal             | Allowed Markdown on text-only ACP                   | Entry **honors explicit ACP text and Markdown formats…**                                 | `3e413dca36a59673c0a09b92e94e5bc5fed89346a47af70588e3851d5adbb647` |
| equal-asof-history                   | Restored strict earlier-than filtering              | Command **includes equal-asOf reports…latest saved sequence**                            | `bb35c5d2811a5cda576d1a7ec3387730232b3eef0647385c43e14b58a0ed6f33` |
| saved-sequence-history               | Restored opaque-id tie breaking                     | Command **includes equal-asOf reports…latest saved sequence**                            | `bb35c5d2811a5cda576d1a7ec3387730232b3eef0647385c43e14b58a0ed6f33` |

The shared README/CHANGELOG/featureCatalog update is the existing W-owned
`M113-X-help-docs` handoff, now amended above with the exact four repairs.
The lane brief confines changes to X's files, so those shared files remain
with W. PLAN's M113 scope, §7 and §9 record this review and its boundaries.

### Final repair checks and commits

Implementation commit **`00d3b2deb`** ran the real pre-commit hook:
lint-staged's ESLint/Prettier and staged gitleaks both passed. The worktree's
`core.hooksPath` is `.husky/_` and its pre-commit shim exists. The final
follow-up contains only the duplicate-test setup cleanup and these receipts,
also committed with hooks enabled and explicit paths.

All five `npm run typecheck` projects passed; after the final test-only
cleanup, `typecheck:unit` passed again. Changed-source ESLint and all
changed-file Prettier checks passed. Plain `npm run deadcode` passed.
`npx jscpd` initially caught one 97-token clone in the new ACP test setup;
using the existing typed spy's `mockResolvedValue` and direct session lookup
removed it, and the final gate found **zero clones**. The test remains
independent with the same assertions and name. Its complete six-case file
passed, the separator drill was repeated and exited 1 with that regression
failing, and the restored complete file passed 6/6 at the repository timeout.
Source restoration still matches
`26314be9615dbcde01f1bd6834624918dc58edce307d098e62e4560677c19337`.
These are eight distinct guard drills, nine successful mutation executions.
Logs: `duplication-final.log`, `final-acp-restored.log`,
`slash-separators-final.log` and `.json` under `temp/m113x-fix/`.

Reference freshness passed (53 features, 44 commands, 59 settings, 26 slash
commands, 118 CLI entries), and report-schema freshness passed. Localization
reproduced the **same seven unused manifest keys**, with all fourteen
tables present; host API freshness reproduced **only the existing crypto
46 → 47 and util 5 → 6 count differences**, with the API inventory unchanged.
Both exit 1, remain the W-owned handoffs above and have no new failure or
ignore. Aggregate `npm run quality` remains reserved for the lead under the
rig/common instructions and PLAN §7; it was not run or weakened here.

`npm run build` exited 0: extension **439.5/600 KiB**, Model API
**446.9/475 KiB**, ACP **825.1/850 KiB**, webview main **359.0 KiB**,
deferred JavaScript **50.0/50 KiB**. All existing size, split, host-global
and notice guards passed. No cap was raised. Log: `temp/m113x-fix/build.log`.

As already recorded for this base, the normal build does not emit the
W-owned reporting entry. A separate production-equivalent Node 20.18,
minified component build with shared English/wire and inline report
validation produced **96,414 bytes (94.2 KiB)**. Both factories loaded;
its normalized metafile paths include **zero** backend, paid-engine or
host-adapter inputs. The supplemental ignored `dist/reporting.js` is a
component proof, not standard-build registration or complete-package
certification. Logs: `temp/m113x-fix/reporting-build.log` and
`reporting.meta.json`. Existing source/history/host and W integration
handoffs remain open; none of RVM113X's four findings remains open.
