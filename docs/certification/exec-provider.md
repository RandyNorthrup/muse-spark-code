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
