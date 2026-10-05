# Muse Judge phase 1

Muse Spark Code (Unofficial) uses the conversation's own model to advise on
an action's risk. Judge cannot allow an action, write code, bypass a rule or
answer the user. In this tree the Muse Code source runs; Model API dispatch
remains disabled until the real D78 daily ledger joins. Local inference,
separate providers, calibration, cascade, CLI/MCP and other uses are phase 2.

## Settings and fences

`museSpark.judge.engine` is machine-scoped: `auto` (default) resolves to
`same`, `same` is explicit, and `off` stops future judgments. The source
resolves at an eligible approval and its bundle loads only then. An unused
or off Judge creates no request, temporary folder or Judge log. The small
setting predicate and existing approval glue stay in activation; sources,
math and admission do not.

On reviewer-held Auto approvals, Judge runs beside M78/M90. Its latch is
read once, synchronously. A ready caution changes ALLOW to a normal card;
pending, failed and safe leave the reviewer unchanged. A Manual or Auto
card renders immediately and can acquire a fixed caution note before the
answer; choices never change. Immediate allows start no Judge. Session,
turn, action, model and policy replacement invalidate the old job. Late
results cannot affect another action or enter the cache. Judge answers
never enter the ALLOW parsers.

The concrete sources use batched stated confidence, labelled
**uncalibrated**. The pure core also tests logprob normalization and the
bounded binary-from-top-1 fallback; no production logprob capability is
claimed for Muse Spark or MSP. The question asks whether the action can
delete or overwrite data, or irreversibly change shared state. A safe answer
leaves every existing decision unchanged.

## Single-model invariance and privacy

The Model API source reads the last actually sent, keyed body without
rebuilding it. If redaction changes any byte, the side request is
standalone; otherwise it copies that body and appends a redacted tail,
preserving the cached prefix and key. A prefix with hosted billable tools
also uses a standalone body with no tools; Judge never grants a hosted
search charge. No main request is trimmed, reordered
or given a Judge hint. The conventional 1,024-token cache floor is unmeasured
on Meta; production prefix length is unknown and no saving is promised.
Paid dispatch is currently blocked.

Muse Code receives a redacted standalone prompt in a fresh hidden session
per batch, never the main or M90 reviewer session. It uses Plan, thinking
off, no MCP servers and an empty OS temporary folder removed afterward.
Only CLI settings are read for standing rules; unreadable or malformed
settings fail closed. The item guard cancels on a tool item's first
observed start, update or completion. An unknown allow source or a CLI tool
that runs before notification can still act: this promises an isolated
session and caution-only verdict, not proof that no tool ran. The byte
invariant covers main MSP frames, not the CLI's own HTTP. See
[PRIVACY](PRIVACY.md) and [SECURITY](../SECURITY.md).

The bounded window cache holds exact-action outcomes in memory and clears
on a source/model/owner change. Logs carry fixed failures or reason words,
without state, prompts, answers, probabilities, profile paths or account
labels. Pattern redaction does not remove every private fact. Confidential
rules follow the chat model; contributor models are refused there. No local
endpoint is contacted in phase 1.

## Cost, consent and admission

Muse Code uses the subscription and consumes its limits, with a first-use
notice once per window. A subscription-only user needs no Model API key and
sees no Judge price prompt. Dispatch rows remain separate from main tokens,
without paid markings. Missing receipt fields remain unknown.

The metered path, exercised with fakes, asks through `PaidUseConsent` before
the first charge, naming the verified model price and shared
`museSpark.paidDailyBudgetUsd`. Allow once stays once; Allow always uses the
existing revocable trusted-workspace grant; Deny or closing refuses. The
shared setting and `src/host/paid/paidDailyBudget.ts` are **absent from this
checkout**, so production availability is false before a popup or dispatch.
No competing ledger is shipped. The exact adapter and open entry criteria
are listed in [the integration record](certification/m98.md).

With a real ledger, A reserves each call's full uncached input bound and
whole output allowance before sending. Bindings are read after admission
waits; the client's synchronous account/binding/claim guard runs after its
credential wait, adjacent to fetch. A known non-send refunds to zero.
Complete receipts settle known usage; timeouts, missing/failed streams or
failed settlement retain liability. The side transport does not retry a
billable attempt. Rows start at dispatch and keep costs apart from main
usage. No paid/live Judge call was authorized or made for integration.

## Limits and certification

The core refuses an over-context state rather than splitting it; split
questions repeat the whole state. Production uses a conservative UTF-8 byte
bound because MSP exposes no tokenizer, and checks the full standalone
prompt against the loaded window. Metered admission checks the whole body
plus output allowance. This can refuse text that a tokenizer would fit.

M75 replay callers can pass independently labelled fences to
`JudgeReplayRecorder` and measured ready rates to the window factory.
Approval answers and passing tests are never calibration labels. A ready
rate under `JUDGE_MIN_READY_RATE` disables `auto` on that backend; explicit
`same` bypasses that default. No live M75 ready-rate or caution-precision
receipt exists here: both are unmeasured, not zero. Fake replays certify the
wiring only.

The [aggregate record](certification/m98.md) links the lane captures, red
drills, integration checks and remaining ledger/host receipts. Unchecked
PLAN certification items stay unchecked until their receipts exist.
