# EXECPROV: configured provider exec repairs

Base: main `4d28a4f84`, 0.17.1. Kubuntu, 2026-10-11. Fake-only; no
live/paid calls, credentials, dependency, gate, hook or timeout changes.

## A1: unsent ownership

Daily reservation is acquired in `attempt.prepare`. Between it and dispatch:
`daily.reserve` awaits journal locking, seeding/recovery and publishing; its
post-await abort/day check refunds. Run admission is synchronous; refusal or a
throw refunds immediately. Final model/key/context/consent guards are synchronous;
transport abort, stale confirmation and start-callback throws unwind the stream's
finally, withdrawing both daily liability and the run ticket/count. Retrying
preparation first settles the previous attempt. Sent unknown usage remains held.
Daily claims record owner PID and a synchronous send-intent directory. Under the
admission lock, ESRCH proves owner exit; only a claim without send intent refunds.
Live/reused PIDs, EPERM, sent and legacy claims remain held (legacy claims cannot
prove whether dispatch happened). No age-based recovery.

Green (default timeout): runtimeAccounting, sessionBudgetJournal, paidDailyBudget:
105/105, including a thrown start callback. The post-publication admission-lock
release also refunds if it throws before handing the claim to its caller.
Red drill: disabled recovery and replaced run withdrawal with close: six tests
failed (unstarted tickets plus dead-owner recovery). Byte-exact SHA-256 restoration
`1c5c6e6ad46dbe39e3ab0ae5f61945b14b87975562608c672b1fa642fad7d835`.
Final verification and remaining items are recorded below as completed.

## A3: refusal identity

One `isUserRefusal` predicate in `src/core/refusal.ts` guards configured, Meta,
codec and subscription wrappers. Dynamic media and Gemini capability refusals
are tagged locally, and durable budget refusal uses its budget error class.
The headless daily-budget refusal latches the budget exit before dispatch.
Subscription adapters preserve prepare guards.

Green: providerRefusals, providerTransport, runtimeAccounting: 56/56. The table
passes every typed refusal through Meta and all five configured wire formats,
asserting object identity and zero sends; unknown errors keep the generic
sentence. HTTP diagnostics still redact keys, account text and kind/code fields
(the existing privacy suite caught an initial overly broad preservation path;
the corrected boundary preserves redaction).

Additional A3 suites: mediaCost/mediaAccounting/geminiCodec 103/103;
subscriptionIntegration/copilotClient/modelApiClient 132/132; host typecheck 0.
Red drill: predicate forced false, six table cases failed; SHA-256 byte-exact
restoration `c95b0ccdf96d2115084c25e53c3c96ce8dda42e46ef10473cacc7789de76edec`.

## A2 / A4: actual request quotes and provider turns

One resolved headless output cap (default 1024, optional --max-output-tokens) feeds
the body, request schema, ledger shape check and first real reservation. Startup
no longer rejects a small prompt against the one-million-token context. The
standalone daily wrapper shares estimateInput/requestParts with session admission;
the selected model's card bounds cold writes and captured context tiers. Meta's
wire body bytes conservatively bound its run quote. Refusal arithmetic is rendered
once, with Intl amounts and plural token units in all 14 languages, before the
stop latch can replace it.

Real runtime → ACP → manager → configured client → loopback HTTP: Responses,
Chat, Anthropic, Gemini and Ollama all run and settle exactly at the ledger's
micro-USD precision. Each family also proves budget refusal, default selection
and unknown-price refusal with zero sends and no daily claim left behind.
Captures: openai/03-tool-result-stream, mistral/03-tool-result-stream,
anthropic-opus-thinking/02-tool-result-stream, gemini/03-tool-result-stream,
ollama/03-plain-stream under docs/certification/m95-captures (their original
workspace/attempt receipts stay beside them in calls.json). This lane's temporary
workspaces are m80b-* under TMPDIR; zero live model attempts. The Opus card's
4/20 USD per million and 5 USD cold-write premium run under a 0.10 USD cap.

Green: execRun 114/114, including all five loopback families;
runtimeAccounting/execArgs/execFetch 108/108 before added event checks.
The obsolete context-sized reservation assertions were replaced by the admitted
request's retained liability; missing/invalid usage, cancellation and retries
still hold the full admitted amount. Documentation now says provider exec runs.

A2 red drill: restoring full-context input caused the small-request quote test to
fail; SHA-256 byte-exact restoration
`1364d18157c8313ee03ff8069ad9f3743e30f97ce5eb7d980d16f1d796b95fa7`.
Final execRun remains 114/114 after admission/settlement events were added.

## B–G: defaults, catalogue and terminal workflows

Exec passes the assembled configured default into ACP session creation. ACP honors
the selected provider default and refuses a missing/unavailable default before
creating a session, listing configured refs. Muse Code keeps its native selection.
Bare native IDs resolve only when a single advertised ref matches.

The captured 2026-10-05 catalogue already contains Fable 5.1 (10/50), Opus 5.5
(4/20) and Sonnet 5.5 (2/10), USD per million input/output. The owner's report
names Haiku 5.5 but provides no published price/capability receipt. Its separate unpriced row
has id/name and dated source metadata, unknown price and capabilities; the original
captured-tool validation remains intact, and the new strict unpriced-row validator
refuses prices, capabilities, mismatched IDs and replacement of captured rows.
VENDOR.json records that
addition separately from the unchanged capture date/download hash. Unknown
catalogue models have a specific local refusal. No tariff is invented.

Provider setup errors use terminal flags in all fourteen translations; successful
free probes print server model IDs for --model. No panel Tick/Click/Open prompt
remains in the provider/auth terminal path. Command --help routes to command-local
options; help reference (and existing help --all) explicitly loads the catalogue.

Usage writer probe against the production bundle and an isolated disk-backed
folder: zero errors, one persisted record. Ephemeral runs deliberately omit
durable history, never load its writer, and report usageHistory=omitted_ephemeral
in the validated JSON result. Real loopback families prove no usage warning.
Non-ephemeral failures remain visible; no real owner's storage was inspected.

Final focused green: execRun/execProvider/commandHelp, 175/175 at repository
timeout and maxWorkers=3, including five JSON-output family cases. All five
typecheck projects passed. Combined red drill: disable strict default selection,
local-help routing, ephemeral history omission and unknown-price admission;
42 tests fail across all three files. Restored byte for byte (SHA-256):

- src/acp/agent.ts: `d21e624311b5efe32eb1f589df3b8ffa1b357375a9869197ef4e90ad5e22585b`
- src/runtime/cliArgs.ts: `0ed6728e32e4149c5d1a34a4d566ecc18394f33050537ca97972e1e1b23fd235`
- src/runtime/exec/runExec.ts: `4254ee676ba4f0f9215cdfacd17c611fabb260a955554c074c9423cab003b81f`
- src/runtime/runtimeAccountingEntry.ts: `cb1e907708d20a70aed45212be6d70a7f4a9e5e5ecff671a31919414a152fe15`

Cancellation snapshot retains an interrupted active reservation as uncertain
liability before asynchronous cleanup; daily sent claims remain retained without
a verified receipt. The final pinned DNS check tags a provably unsent refusal,
clears send intent and refunds both claims. There are no awaits between daily
admission and transport dispatch other than that abort-aware DNS check; transport
pacing and credential reads precede admission.

Verification logs are lane-local under temp/. Aggregate npm run quality and
installed/live proof are lead-owned, as required by the rig brief. No caps, gates,
hooks, dependencies or test deadlines changed.

The headless size gate fired at 104,699 bytes (100 KiB cap); optional provider
assembly and endpoint helpers now load through the existing runtimeAccounting
bundle on first provider use. No new artifact, dependency or size exemption.
The initial catalogue build also refused a non-tool-capable row, prompting the
separate strictly unpriced section described above rather than weakening that
captured-tool guard.

Production build passed with unchanged caps after sharing the portable journal:
headless.js 82,292 bytes; modelApi.js 531,482; extension.js 563,352;
usagePanel.js 67,567; runtimeAccounting.js 46,620. The source subsequently received
a type-only formatting-call correction; final verification is listed in the lane
report. The dependent run completed 18 of 207 selected suites before the time box;
two outdated expectations were corrected (explicit contributor selection and root
help route). The exact remaining list is exec-provider-remaining.md. It is not an
all-dependents green claim. HUB: constants, l10n tables, feature catalogue and
generated reference are integration-run inputs.

## Round 2 B: slash-containing native IDs

The parser defers slash-containing native IDs to provider assembly, which resolves
against that provider's configured IDs and rejects ambiguity or another provider.
ACP already resolves a unique advertised native suffix, including slashes.
New bare `deepseek/v4` regression failed on the prior bytes (b-red.log).
Final execProvider/execArgs/providersX: 111/111, default timeout. No
wire shape changes. Dependency expectations now match terminal Azure refusal and
printed native IDs; the repeated --model setup regression exposed the serve-only
single-model guard incorrectly preceding provider-add parsing, now scoped correctly.

## Round 2 auth methods

Registry-style ACP initialize now offers only actual sign-ins: Muse Code login
(or Model API auth set) and ChatGPT Add. Remove and Status remain CLI commands.
The terminal/manual initialize and authenticate tests plus factory test failed
before the repair (auth-red.log); final runtimeChatGpt/acpAgent 177/177 at
default timeout. No external registry/network call was made.

## Round 2 effort and persistent history probes

Provider registry summaries now carry only known supported effort values. ACP's
picker and validation read the selected summary; exec reads ACP's advertised
options, including xhigh for the catalogue's Opus row. Unsupported choices name
--effort and the permitted technical values in the installed language. The
registry and ACP regression tests failed before repair (effort-red.log).
Final modelApiProviders/execProvider/execRun: 165/165, repository default timeout.
The loopback Anthropic request asserts output_config.effort=xhigh, using the
existing capture and locally configured capability overrides.

The initial persistent-history drill failed for all five families because its
owned fixture did not build usageService.js. Building the real writer entry
eliminated the warning. A second exploratory run used the actual production dist
and asserted one durable usage record per family: 124/124, including exact tokens.
Final regressions use only owned builds (no cold-checkout dist coupling).
The original real-store warning is not reproduced by these healthy synthetic
stores; no warning was suppressed on persistent runs and no owner's store read.
STREAMCLASS owns streaming helper deadlines, typed idle errors, Copilot idle
limits and upload progress limits. TOOLROUNDS owns the tool-loop ceiling.

## Round 2 A: interruption proof and final dispatch ownership

The real-child matrix pauses after daily claim publication (while admission owns
its lock), during final pinned DNS, awaiting response headers, awaiting stream EOF,
and during durable settlement. Each gets SIGKILL, cancellation and injected
transport/IO failure. All 15 cases use the real disk journal and run ledger.
Twelve cases failed before repair (a-interruptions-red.log). Final owning suites:
runtimeAccountingInterruptions/runtimeAccounting/sessionBudgetJournal 85/85,
default timeout, three workers. Children are joined and all roots removed.

Daily locks now publish a PID/UUID marker synchronously before reservation work;
only ESRCH plus removal of that exact marker permits recovery. Legacy empty,
live/reused PID and uncertain locks remain closed. The daily claim is marked sent
at the bound fetch's final synchronous fence after DNS; a DNS interruption has
zero requests, no uncertain amount and a zero settlement. Sent unknown usage is
closed durably at its full reserved amount with hasUnknownCost, never refunded.
Dead sent owners receive the same conservative settlement on next start. A
transient settlement write failure retries the same idempotent settlement, with
ownership retained until success. Accounting callback failures cannot strand the
run ticket. No provider transport stream limits or tool-loop ceiling changed.

Await inventory after the first durable daily row: claim publication returns;
reserveAdmitted/withReservationLock returns (daily unlock is now synchronous);
runtime daily reserve's abort/day check and any compensating settle; the attempt
prepare return to transport; final DNS unlessAborted; bound fetch/headers; each
decoded body read/yield through EOF; and owned.settle's atomic journal write.
Retry settlement is the same owned path, before another reservation. Internal
atomic-write awaits after publication and before settlement belong to the two
publication/settlement fault points. Before first publication, seed/history and
credential/pacing awaits have no handed-out reservation; damaged legacy intents
still fail closed. A kill after send intent cannot prove the provider saw nothing,
so recovery preserves the full liability, even without a response receipt.

## Round 2 D/F: complete terminal help routes

The public command table now enumerates deep CLI invocations, including account,
schedule background, report kinds/history, developer, vault, playbook and prompt
commands. commandHelp walks the entire table, so a new route with no useful local
help fails. Seven new cases failed on prior bytes (help-red.log). Prompt help's
old sharingHelp call actually printed editor command IDs; the CLI now renders
terminal syntax and its installed-language privacy sentence. Every route ends
with --help. Auth help lists its own provider/account flags. The dependency
reference test's missing --max-output-tokens sample is updated to the existing
single-cap contract; estimate --help now follows the shared command-local help
route in its reference oracle. Final commandHelp/cliUsage/referenceGenerator:
173/173, default timeout, three workers. No gate or assertion is weakened.

## Round 2 progress, partial answers and bounded uncertainty

JSON attempt events now print localized start/end progress to stderr, including
reservation, plural token totals and exact settled/uncertain cost. Stdout remains
one validated JSON object. Progress has real translations in all 14 tables.
Final results retain the latest redacted answer prefix, finalMessageComplete=false,
non-success status/exit and all settled/uncertain liability on interruption or
unverified accounting. Incomplete reasoning and structured output remain withheld;
no action/publication success is granted. No ModelApiHost tool-loop end changed:
TOOLROUNDS still owns that boundary.

Progress and timeout regressions failed before repair (progress-partial-red.log).
Broader exec proof caught bounded daily uncertainty being mistaken for unknown
historical fees; new owner-PID daily rows retain their full liability and uncertainty
without that legacy-fee stop, while legacy/unbounded claims retain it. Six existing
retry/accounting cases failed before correction. Existing cut-short text oracles
now assert redacted partial text and the explicit incomplete marker, retaining
all non-success, spend, invalid-usage and no-credit checks. Final
execOutput/execRun/runtimeAccountingInterruptions 186/186, default timeout;
check:l10n: 14 UI and usage tables, 0 problems.

## Round 2 E: invalid settings no longer hide behind the generic warning

Cause, proven with full provider runs (canned fetch; loopback is sandbox-blocked
on this rig, see below): a healthy persistent store records silently and exactly.
When `usage-settings.json` exists but is invalid (unparsable, wrong types,
out-of-range days), `readUsageHistorySettings` throws on every `isEnabled()`
check, so every note fails and the run logs only "Usage history could not be
recorded" while the run itself succeeds — the exact reported symptom. Genuine
store failures (unwritable paths, file where a folder belongs, no permission)
warn the same generic line, correctly; a stale rollup lock does not gate appends.

Fix: the writer's `isEnabled` (src/runtime/usage/usageServiceEntry.ts) pauses
history on invalid settings (never a guess) and reports once through a new
optional `onInvalidSettings` (src/core/usage/recording.ts), wired in exec, ACP
serve and the VS Code host with the repair sentence (delete usage-settings.json
or toggle history off and on). Other read errors still throw; genuine write
failures keep the generic warning. Ephemeral omission is unchanged.

Matrix (canned-fetch full dispatch, exit 0, one request, production bundles):
fresh green with one record; lived-in healthy green with append; corrupt settings
specific warning and zero records; days-root/today as files and read-only dirs
generic warning and zero records; stale lock green. Red drill: restored the old
one-line `isEnabled`, the new writer test failed (0 reports); SHA-256 verified
restoration before committing. Committed run-level loopback tests (persistent
invalid settings; ephemeral with a bundle-less distDir) mirror these assertions
for the lead's unsandboxed run. The pre-existing usageIntegration companion-page
case (HTTP 502 vs 401 from its loopback server) fails identically with and
without this change: sandbox-blocked loopback, named for the lead.

## Round 2 dependency sweep: three caused-here reds found and fixed

The 189-file sweep caught three failures this branch introduced (all green at
base, all red here before the fix, all green after; red drills observed):

- cx1r5Truth dormant-claim gate: the new deep-help doc examples named
  `providers accounts ...` and `schedule background ...`, which the publication
  truth matrix gates as dormant. The examples now use routed
  developer/playbook/report commands (README.md, docs/acp.md).
- estimateCommand production-entry help: the new command-local `--help`
  routing rendered estimate's `--format` from the shared flag text, losing the
  `md|html|json|text` enum the estimator suite expects. `formatCommandHelp`
  now prefers the registry's per-route option words (the design the generated
  reference already uses: `estimate-format`), affecting only the estimate route.
- execResources bare `--help`: the same routing sent bare flags to the serve
  options, dropping the machine flags the resources suite expects. Bare flags
  now resolve to no route (the compact general help, which names them), and an
  empty route renders the same general help so the command-table walk keeps
  every invocation above its line floor (src/runtime/cliArgs.ts,
  src/runtime/cliOptions.ts).

Not caused here (named for the lead's unsandboxed run): files.test.ts fails
only on sandbox-proxied fetch (`fetch failed`, proxy 502 on HTTP tunneling);
its transport and cost paths are untouched by this lane. runtimeChatGpt and
the loopback exec/provider families cannot run where loopback sockets are
blocked (direct probe: `fetch` to 127.0.0.1 throws at once).

## Round 4: onto the current release (0.18.0 + 0.18.1 hotfix)

Base: `snap/hotfix-0181` head `d90646575` merged into `fix/exec-provider`
as `00abc0ca9`. Kubuntu, 2026-10-12. Fake-only; no live/paid calls. The
branch was cut before 0.17.2/0.18.0, so the merge brings the stream-limit
fix (no total-time stream timeout; idle limit with its sentence) and the
account work, and keeps the round-3 D1-D6 fixes on top.

Conflict unions (all 33 resolved, none taken blindly):

- `configured.ts`: paid stop, user refusal and abort pass through first
  (D1), then stale confirmation, then the idle-limit stall — both
  round-3 and hotfix lines kept. The stream call keeps the release's
  no-total-timeout form.
- `transport.ts`: key rotation keeps its own sentence (P3-2,
  `execKeyRotated`); other stale confirmations use the runKind-aware
  helper; `markSent` runs beside the release's confirm/admit calls.
- `runExec`/`runLedger`/`execFetch`: the release's policy-driven
  `outputCap` replaces the round-3 fixed 1024 default and the
  `--max-output-tokens` option (removed from code, tests, tables, docs
  and PLAN). The ledger keeps `reject`/`releaseResponse`; the admission
  check keeps the slash-model minimum with the policy cap.
- `runtimeAccountingEntry`: our lifecycle kept (late claim clear,
  unsent-ticket withdrawal); cost-zeroing unions the release's
  rate-limited flag with our 429/bad-request flags; settlement adopts the
  release form (skip on sent-unpriced, wrap store failures).
- `en.ts` + 14 tables: union of both key sets in English key order (the
  packaged archive compares byte-for-byte, so order matters); the removed
  option's key is gone everywhere. `referenceAuthStatus` reworded without
  conditional-state words for the catalogue lint.
- Generated files (`reference.*`, `reference.node.*`, `ROADMAP.md`,
  `docs/reference.md`) regenerated with their scripts, not hand-edited.

Size work (no pin or budget moved):

- The refusal classifier (`isPaidStop`, `isUserRefusal`) rides
  `dist/configuredProviders.js` behind new entry exports; the Model API
  bundle reads it across the boundary only on an error via dynamic
  import (new `deferredCohort` mapping). Provider assembly
  (`assembleProviderRun`, `providersFilePath`, `resolveEndpointHost`)
  rides the same lazy bundle the same way.
- Build guard line: `ok cross-bundle members: 2137 reads of 39 sibling
bundles, each exported by the bundle read (...)`.
- Rows: modelApi.js 520.8 KiB (budget 525 KiB), headless.js 80.4 KiB
  (100), runtimeAccounting.js 44.0 KiB (50), configuredProviders.js
  39.9 KiB (50), providers.js 139.3 KiB (150), extension.js 551.0 KiB
  (600). Exact bytes: modelApi.js 533,327; runtimeAccounting.js 45,026;
  headless.js 82,290; configuredProviders.js 40,836.

FINDING, not a deferral: the Model API exact-byte pin
(`deferredBundles`, 532,827 B) reads 533,327 B (+500 B). Metafile
attribution is exact: transport.ts +250 (paid/rotation branches and the
dynamic classifier read), ModelApiHost.ts +147 (configured-default
hunk), client.ts +103 (refusal catch). Each is pinned hot-path behavior
(the drills below and the refusal suites); the pin is not moved. The
lead disposes: re-measure with owner decision (as the hotfix did at
+290 B) or direct further diet.

Round-3 results on the merged tree (repo default timeout, maxWorkers=3):

| Suite                             | Result                      |
| --------------------------------- | --------------------------- |
| execPaidRefusal                   | 9/9                         |
| execCliFindings                   | 24/24                       |
| providerRefusals                  | 7/7                         |
| execRun                           | 109/132 (23 ENV, see below) |
| paidDailyBudget                   | 36/36                       |
| execProvider                      | 27/27                       |
| runtimeAccounting + interruptions | 50/50                       |
| configuredProviders               | 40/45 (5 ENV, see below)    |
| execFetch + execSchema            | all green                   |
| runLedger + bundleExports         | 40/40                       |
| modelApiEntryExports              | 3/3                         |
| deferredBundles                   | 122/123 (pin, see above)    |

Also green: all five typechecks; production build incl. split guard;
`check:l10n` (0 problems), `check:reference` (current),
`check:roadmap` (current), `check:host-api` (0 problems). The tiny-budget
preflight sentence now quotes the release minimum reservation
(`This run requires at least ...`); one test expectation updated to it.

Red drills (break once, show red, restore byte-exact, green):

- D1 (a paid limit says what it is): forced `isPaidStop` false —
  execPaidRefusal 3 failed; restored SHA-256
  `c13710cd8c73c64e32603f323e2e14ce941433d155b2a4af0de2dccd91641ad0`,
  9/9 green.
- D2 (a dead run's hold is released): `releaseResponse` made a no-op —
  `releases both reservations` 5 failed; restored SHA-256
  `f44a68399891c0a8c0ac22750fc6c1c8dd65a59337f53453cb298cf282cf20f3`,
  6/6 green.
- D3 (a budget stop keeps its work): `partialText` forced undefined —
  `D3 a budget stop keeps the first request work` failed (`to contain
'first progress'`); restored SHA-256
  `3b1b97616db4b48af59bda83bb69ac692b49d690adb816747cfa446281d4410e`,
  green.

Blocked here, named for the lead's unsandboxed run (no product change,
same probe as round 2: `fetch` to 127.0.0.1 throws at once):

- execRun 23 (21 loopback families + persistent-invalid-settings +
  ephemeral-bundle cases, all provider-turn shaped) and
  configuredProviders 5 (loopback pin + 4 stream-limit cases): the turn
  fails before any HTTP response with the pinned-send refusal.
- E8 (`execStdio` packed package): packaging now passes the l10n gate
  (the English-order fix above) but stops at `npm pack`: the sandbox
  leaves `/home/randy/.npm/_logs` read-only and the pack scandir fails.
  The Mistral-capture turn itself never runs here.

## Round 5: a budgeted run can be sized; six loopback reds; two ledger defects

Kubuntu, 2026-10-12, head `e659e5bed`. Fake-only; no live/paid calls.
Loopback/socket files do not run in this sandbox (each `fetch` to
127.0.0.1 throws at once; panel servers answer 502 through the sandbox
proxy); the lead runs them outside it. Where this round states an exact
sentence or number the sandbox cannot print, the arithmetic is pinned by
a unit test on the same code path (micro-unit exact, no float).

### (1) `--max-output-tokens` returns as an optional lowering limit

- Default stays the policy cap (`resolveExecOutputCap`, at most 32,768).
  `runExec`'s one `outputCap` closure returns `min(flag, policyCap)`:
  the same value feeds the request body (via `modelOutputMaxTokens`)
  and the run ledger's admission, so what is reserved is what the
  provider may produce. A value above the absolute ceiling (32,768) is
  refused at parsing with `execOutputCapExceeded`; below-minimum and
  non-integers keep `execNumberInvalid`; Muse Code refuses the flag
  (`execModelApiOnly`). Reference regenerated: the flag is back in the
  CLI table, the contract and `docs/reference.md` (min 16, max 32768).
- A budget refusal names both remedies with numbers from the refusal's
  own exact-decimal arithmetic (`responseReservationMessage`, terminal
  scope): the cap that admits it (committed + ceilinged reservation,
  rounded up to the cent) and the largest `--max-output-tokens` that
  fits the remaining cap (binary search with the request's own reserve
  function and the admission's own ceiling). When even the input alone
  does not fit, the flag half is omitted and the note says so. ACP and
  the editor read the same typed refusal (`error: { kind: 'budget',
message }`) through the shared scope, which carries the cap remedy
  only — no terminal flag is printed in a non-terminal sentence. No
  separate ACP/editor rendering site for exec errors exists (verified:
  `ExecResult` is rendered only by the exec output sink), so the shared
  shape is unit-pinned for the surface that lands.
- The exact ten-cent refusal sentence (policy cap, no flag):

  `Input at most 7,825 tokens ($0.039125) + output cap at most 32,768
tokens ($0.655360) = $0.694485; run cap $0.100000, $0.000000 used.
Request not sent. Raise --max-budget-usd to at least $0.70 to admit
it. Or retry with --max-output-tokens 3043.`

  3043 is exact: 39,125 + 20m micro-units <= 100,000 iff m <= 3043.

- Tests: the five anthropic loopback modes carry `--max-output-tokens
2000` (what a person would give a ten-cent run; captures emit at most
  41 tokens, so costs are unchanged); a new loopback test asserts the
  sentence above, then re-runs with exactly 3043 (admitted, one
  request, wire `max_tokens` 3043) and 3044 (refused, zero requests).
  `execArgs` pins absent-stays-absent, 32768 accepted, 32769 refused at
  parsing, and the Muse Code refusal. A fake-path test pins a lowered
  limit reaching every request body (first + continuation) with the
  provider stopping at it (`incompleteReason: max_output_tokens`).
  Note: on the Meta path the preflight minimum (context-window worst
  case) fires before admission, so suggest-and-rerun is reachable only
  on the provider path (no preflight) — stated in the test.

### (2) The sixth red: settings folder created by the test

The persistent-invalid-settings test wrote `usage-settings.json` into
a data folder it never created. The product creates that folder on
writer start (`usageServiceEntry`: `mkdir(dataFolder, recursive)` —
no data-folder helper creates it), so the test creates it with
`mkdirSync(..., { recursive: true })` before writing. Audited the
lane's other new tests: the loopback provider config helper already
mkdirs; the ephemeral-bundle and effort/persistent modes only read
folders the product itself creates. The failure here is now the
sandbox transport block, not ENOENT (verified in the run below).

### (3) The pinned size: 533,368 B, none of it movable here

`dist/modelApi.js` reads 533,368 B against the exact pin 532,827
(+541; +500 carried, +41 this round for the `unpriced` status, its
exit-code rule and its label). The pin is not moved. The 500 B sit in
three files, verified against the merge diff `00abc0ca9^1..00abc0ca9`:

- `transport.ts` +250: the confirmed-dispatch gate
  (`assertConfirmedAllowed`, `staleConfirmedError`,
  `isStaleConfirmedError`, `noteConfirmedRequestStarted`, the `check`
  fence) called inline around every HTTP try. Request-path fence;
  cannot defer. The refusal classifier it replaced already rides a
  dynamic `import('../../refusal')` — the lazy part is done.
- `ModelApiHost.ts` +147: the configured-default hunk (argument
  previews, `modelOutputMaxTokens` plumbing, compaction guard types).
  Request-body construction; cannot defer.
- `client.ts` +103: the refusal catch (`assertConfirmedAllowed`
  try/catch, `admitAttempt?.check?.()` before the stream, lazy
  `isUserRefusal` classifier in the catch). Request path; the
  classifiable half already lazy.

The Model API diet lane (after the hotfix) owns the bytes; the hotfix
pin move 532,537 -> 532,827 still awaits the owner.

### (4) E8: the exact command and what it must print

No config name exists (single `vitest.config.ts`, no projects; the
shared production build arrives via `globalSetup` injection):

`npx vitest run test/e2e/execStdio.e2e.test.ts --maxWorkers=3`

It must print every case green, including `E8 completes one
plan-mode turn on a configured provider through the built bundles`:
exit 0, `status: completed`, `model:
mistral/ministral-3b-latest`, `usage.requests: 1`, exactly one
provider call ending in `/chat/completions`. Stops in this sandbox
at packaging (`npm pack` cannot write its log folder); the turn
itself never runs here.

### (5a) A missing price is not a budget stop

New `ExecStatus` `unpriced` (exit 4, `EXEC_EXIT.failed`; the limit
stays 5): JSON status, exit-code rule (regenerated
`exec-result-v2`/`exec-event-v2` schemas), info line (`Unpriced;
requests 0; ...`), and ACP/editor (same typed `error` field) all
carry the reason and the remedy. Provider runs name the model and the
runner's own providers file (`execUnpricedProvider`); anything else
names a priced model (`execUnpricedModel`). `finalMessage` for a
pre-first-request refusal is its own sentence, never another kind's
words. Refusal-kind sweep (every kind the ledger returns):

| Ledger refusal       | Status                  | Exit | Sentence                                                            |
| -------------------- | ----------------------- | ---- | ------------------------------------------------------------------- |
| `budget`             | `budget_exceeded`       | 5    | quote + both remedies (error); `execBudgetProgress` kept-work final |
| `requests`           | `request_cap`           | 5    | `execRequestCapReached`                                             |
| `unpriced`           | `unpriced`              | 4    | missing-price remedy (error and final)                              |
| `request_shape`      | `failed`                | 4    | `execRequestShape` (error and final)                                |
| `closed`             | `internal`              | 1    | never latches as its own cause; mapped before latch                 |
| `breach`             | `budget_exceeded`       | 5    | `execBudgetBreach`                                                  |
| `accounting_invalid` | `accounting_unverified` | 9    | `execAccountingInvalid`                                             |

14 translations for the two sentences, the `execStatus.unpriced`
label, and the touched keys; `check:l10n` 0 problems. The loopback
`unpriced` mode now asserts exit 4, `status: unpriced`, `error.kind`
and `ledger.refusal` both `unpriced`, the sentence naming model and
file, `finalMessage` equal to it, and the `Unpriced; requests 0`
info line with no `Budget Exceeded` anywhere.

### (5b) Ownerless holds close by age

Bound: `DAILY_BUDGET_OWNERLESS_MAX_AGE_MS` = 21,605,000 ms =
`EXEC_MAX_TIMEOUT_SECONDS` (21,600 s, the longest a run may live)
plus `EXEC_STOP_GRACE_MS` (5 s, a stopped run's settle window).
The journal records no claim timestamp, so age comes from the
claim file's modification time (the claim directory's when the file
is absent); unreadable age keeps the claim open. Older than the
bound, an ownerless open claim closes exactly like a dead owner's
sent claim: settled at its reservation, unknown cost. A claim with
an owner keeps the owner test only, at any age. Each recovery
names its closures through `onOwnerlessClosed`; the runtime logs
one info line per run (`execStaleHoldsClosed`: `Closed {count}
stale hold(s) ({total})`). Fail-closed consequence: the amount
stays in today's total — `usage` already shows that share as the
uncertain row (`readExisting` carries `uncertainUsd` into
`readToday`, rendered by `usageText`), pinned by test at $4.524288.

### Round-5 results (repo default timeout, maxWorkers=3)

| Suite                               | Result                                                                                                                        |
| ----------------------------------- | ----------------------------------------------------------------------------------------------------------------------------- |
| execArgs (new parse test)           | 56/56                                                                                                                         |
| execLimits (new sweep test)         | part of 76-file green                                                                                                         |
| execPaidRefusal (3 new aging tests) | 12/12                                                                                                                         |
| execSchema (new unpriced A16 row)   | 29/29                                                                                                                         |
| referenceEntry + executables        | 19/19                                                                                                                         |
| actionRunExec                       | green (with usageIntegration file run)                                                                                        |
| execRun                             | 113 local green; 24 loopback-shaped red here only (sandbox transport block; ENOENT gone)                                      |
| configuredProviders                 | 5 red here only (loopback pin + 4 stream limits; lead green at round head)                                                    |
| usageIntegration                    | 1 red here only (panel 502 via sandbox proxy; unrelated path)                                                                 |
| deferredBundles                     | 122/123 (the pin above, unmoved)                                                                                              |
| commandHelp                         | 1 red, pre-existing on `e659e5bed` (scratch worktree at base fails identically; prompt-setting names in help, untouched here) |

Also green: all five typechecks; eslint (0 warnings); `format:check`;
knip (hints only); `check:l10n` (0 problems); `check:reference`
(current); exec schema `--check` (match); production build (every
bundle budget ok; rows below); `check:host-api` (0 problems).

Red drills, round 5 (break once, show red, restore byte-exact by
SHA-256, green):

- Remedy search forced to the top: `names the cent-rounded cap`
  failed (suggested 32768, not 3043); restored
  `a8b7cb871e1e1a4a4f4da47f74042d51cd26e378ff1ab6ef2bbab1d7ca8fee6c`,
  green.
- Ownerless branch forced to keep: `closes an older-than-the-bound
ownerless claim` failed (settledUsd stayed undefined); restored
  `abdf16fe556d06281372025c2f9c09627965b6617cbe97a36c466ac0827b0c7b`,
  12/12 green.
- `statusForStop` unpriced reverted to `budget_exceeded`: the sweep
  test failed; restored
  `c43993139f687998ddfd5512c0f945649add6dc1d200e21452f7369d25eb8c7e`,
  green.
- Parse ceiling disabled: `keeps the policy cap` failed (32769
  admitted); restored
  `c86cdd830cb378cb82ab2fa28e89fe390d5b77cc5bc0b20936c6d1d1f254772b`,
  56/56 green.

(The restore used `git checkout` on uncommitted files by mistake and
wiped the four product files; they were rewritten from the recorded
edits and verified SHA-256 identical to the pre-drill state above,
then re-greened. Lesson recorded: back the file up before breaking
it. No commit existed yet, so nothing committed was affected.)

Byte rows (production build, exact bytes): modelApi.js 533,368;
runtimeAccounting.js 46,428; headless.js 82,654;
configuredProviders.js 40,874; providers.js 142,714; extension.js
564,229. Budgets: every row `ok`, including modelApi.js 520.9 KiB
(budget 525 KiB), runtimeAccounting.js 45.3 KiB (50), headless.js
80.7 KiB (950 KiB exec row), configuredProviders.js 39.9 KiB (50),
providers.js 139.4 KiB (150), extension.js 551.0 KiB (600).

Lead run list (outside the sandbox, repo default timeout, no
`--testTimeout`):

- `npx vitest run test/unit/execRun.test.ts --maxWorkers=3` (the 24
  loopback-shaped cases above, incl. the five flag-carrying modes,
  the ten-cent refusal with the 3043/3044 pair, and the fixed
  invalid-settings case)
- `npx vitest run test/unit/configuredProviders.test.ts
test/unit/usageIntegration.test.ts --maxWorkers=3` (5 + 1 above)
- `npx vitest run test/e2e/execStdio.e2e.test.ts --maxWorkers=3`
  (E8 as in (4))
- `npm run quality:gates` (deferredBundles pin fails: 533,368 >
  532,827, owned by the diet lane; everything else green)

## Round 6: the reservation's input bound (R1–R4)

### R1: what "Input at most N tokens" counts, and the two measured stops

On the configured-provider path the input side of a run-cap reservation is
not a token count at all. `withRuntimeAccounting`
(`src/runtime/runtimeAccountingEntry.ts`) computes
`estimateInput(requestParts(body), undefined).inputTokens`, and
`estimateInput` (`src/core/backends/modelapi/sessionBudget.ts`) counts the
UTF-8 bytes (`Buffer.byteLength`) of the JSON of every request part —
instructions, tool schemas and every input item, attachments' text included —
at `SESSION_BUDGET_MIN_BYTES_PER_TOKEN = 1`, i.e. one "token" per byte, with
no base (`undefined`: each request counts its whole replayed body). That
count is then priced by `model.price.reserve` with no cached-token share, so
every counted token pays the card's uncached input rate
(`reserveRequestAmount` in `src/core/providers/priceCard.ts`; the registry
additionally reserves cache writes on the full input, which is a third,
smaller looseness where the card prices writes). Settlement, by contrast,
prices the provider's reported usage, where cached reads pay the card's
cached rate. The reservation is a true upper bound — a byte-level tokenizer
never makes a token of less than one byte — but it is loose in two
multiplicative ways: bytes where tokens are fewer, and the uncached price
where most of a long conversation is a cache read.

Run 1, exactly: the refused request's body was 1,828,002 bytes
(~2 MB of attached text, JSON-escaped). At the card's $5.00/M uncached input
rate that is 1,828,002 × 5/1,000,000 = $9.140010; the 32,768-token output cap
at $20.00/M is $0.655360; the hold is $9.795370. The cap held $14.53 with
$5.584157 settled, leaving $8.945843 < $9.795370, so the request was not
sent. The requests before it really cost about $0.30–$0.45 each on roughly
80,000 fresh input tokens: the reservation overshot reality by 21.8x–32.7x
($9.795370 / $0.45 – $9.795370 / $0.30). Of that factor, about 4x is bytes
versus English text (~4 bytes per token plus JSON framing of the replayed
conversation), and the remaining 5x–8x is pricing the whole replayed body at
the uncached rate while the bulk of it bills as cache reads at a fraction.
Run 2 shows the same mechanism one step later: 20 requests, $8.48 settled of
a $20.00 cap, and the 20th request holding $11.388990 — the byte-bound hold
grows ~1:1 with the replayed conversation until it no longer fits, with over
half the cap unspent. (The Meta path bounds differently — a full context
window minus the output cap at uncached price, $5.734400 at the same tier —
and is not the measured defect.)

### R2: the exact count, where the repository evidences one

`ModelClient.countInputTokensDetailed` (a same-body count plus the count
call's own billed cost, `undefined` when free) is offered only where the
repository documents a counting call for the exact request:

- the OpenAI preset in Responses format: `POST {request-path}/input_tokens`
  with the request's own native body, returning `input_tokens`
  (`docs/certification/m95-research.md` §1.1 [O8, O13, O14]; Meta's own
  client documents the same shape as not billed in
  `src/core/backends/modelapi/client.ts`);
- nothing else: Anthropic's `count_tokens` is documented in the same notes
  as free and _an estimate_, which cannot bound a reservation; Gemini's
  `:countTokens` has no exactness evidence; chat/ollama/custom name no
  endpoint. Those providers keep the byte bound, and the headless Meta path
  keeps its byte estimate as well: `test/unit/execRun.test.ts` D16 pins
  that the Meta run sends no `input_tokens` request, a contract this round
  does not renegotiate.

The offer lives on the bound provider client
(`src/core/providers/configured.ts`): the count posts the request's own
native wire body to the request path's documented sibling (derived from the
path, never a fixed string), bounded by `MODEL_API_REQUEST_TIMEOUT_MS` and
the attempt signal, with rate-limit-only retries. The entry switch
`exactInputCount` (`src/core/providers/providersFile.ts`, default on)
turns the offer off; with it off, or where no offer exists, no count request
is sent and behaviour is exactly today's. Only run-ledger runs count:
interactive runs without a ledger keep the byte bound and send no extra
request. On any failure, refusal or invalid
answer the byte bound is used and the admitted ticket is marked
`bytes-after-failure`, which the run logs on the info line with the fixed
reason (`execCountBytesFallback`: the provider's own error never reaches the
line). An exact success marks the ticket `exact` and reserves the count at
the uncached price; a billed count is folded into the hold and the settled
charge, so it is in both ledgers.

Proof (`test/unit/execExactCount.test.ts`, 13 tests, no sockets): the exact
count shrinks the hold (100 counted tokens reserve $0.00178 against a
multi-cent byte hold); a failing count falls back to the byte-identical
reservation; a client without the offer sends no count request; a billed
$0.01 count reserves $0.01178 and settles $0.0107; the OpenAI entry posts the
request's own body to `/v1/responses/input_tokens` and returns the count
while `exactInputCount: false` and the Anthropic preset offer nothing. The
lying-count case (count 1, usage 40,000) latches `breach`, keeps the full
hold as uncertain, settles nothing, and closes the ledger: the run cannot
exceed its cap, because after each response the next admission is checked
against settled plus uncertain exactly as before. The worst overshoot that
remains is one request's actual cost above its hold when the count lies
maximally (a zero count against full-context usage); the breach latch stops
the run at once, the ledger never admits past the cap, and the JSON marks
the breach. Gate-fire drills, each restored byte-exact by SHA-256: forcing
the remedy helper to null fails the remedy test; swapping the final-sentence
branches fails the kept-text test; bypassing the exact count fails the
shrinking test.

### R3: the run says what fits before it spends, and tells the truth after

At the start of a capped run the info line states the next reservation and
what is left: on the Meta path with the preview's exact numbers
(`execBudgetStartExact`: cap, remaining, at most the preview hold); on the
provider path with the reservation rule and the numbers known
(`execBudgetStartRule`: cap, remaining, the output cap every request
reserves) — the first body is not built yet, so no honest input number
exists, and the first admission carries it instead. Every run-cap refusal
logs its full sentence (quote plus remedies) on the info line in every
output mode, including the Meta pre-first-request minimum, which previously
reached only the JSON result. The final sentence is true for what happened:
kept text is shown with the kept-work sentence; with nothing produced yet
the run was still reading and no answer exists (`execBudgetStillReading`),
followed by both remedies with numbers — the output-limit half only when it
alone can make the next request fit, the input note only when the input
alone already costs more than is left (`budgetFinalMessage`, sharing the
refusal arithmetic with the quote through `budgetRefusalDetails`, so the two
can never disagree). The JSON result carries the same facts in typed
`budget` fields (`neededUsd`, `remainingUsd`, `admitCapUsd`,
`maxOutputTokens`, `inputAloneExceeds`, `inputCostUsd`; new
`docs/schemas/exec-result-v2.schema.json` and `exec-event-v2.schema.json`
rows), present on every run-cap budget stop and absent otherwise; a breach
keeps its kept-work final line and no `budget` field, because no request was
refused. Proof: the three loopback `budget` modes assert the reading
sentence, the remedies, the typed fields and the info lines end to end on
the provider path; the canned minimum-refusal test asserts the same on the
Meta path; the suggested-output test admits the suggested limit and refuses
one token more on the same ledger.

### R4: where the providers-file path may and may not appear

| Surface                                               | Shows                                  | Rule                                                                                                                                     |
| ----------------------------------------------------- | -------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------- |
| Terminal stdout/stderr (text final, usage-error line) | Model and absolute providers-file path | Correct: the person's own machine, where the price is added                                                                              |
| JSON result `error.message`                           | Same sentence with the path            | Kept: local output; the remedy needs the file, and no report, log or client error-data field ingests it                                  |
| ACP catalogue/model errors                            | Model only, never a path               | Correct: `execProviderNotCatalogue` fills `{model}`; the ACP agent never invokes `runExec` (`src/acp/agent.ts` only cites its sentences) |
| Editor session error                                  | Model only, never a path               | Correct: `sessionBudgetUnpriced` fills `{model}`                                                                                         |
| Problem report, flight journal, telemetry             | No exec error text at all              | Verified by inspection: the report builder takes no exec input, the CLI writes no journal, no telemetry exists on the exec path          |

Nothing breaks the rule, so R4 changes no product code: it pins the five
sentences in `test/unit/execUnpricedSurfaces.test.ts` (the terminal sentence
names the file; the other four name nothing local).
