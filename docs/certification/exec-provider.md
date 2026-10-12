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
