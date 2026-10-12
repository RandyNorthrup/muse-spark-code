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
