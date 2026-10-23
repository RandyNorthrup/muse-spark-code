# Muse Judge

> **Phase 2 built (D107, M125).** The redesign below is implemented:
> a fast, batched, calibrated decision engine that makes the agent
> quicker and checks its work, set up through a Set Up Local Judge
> wizard that scans the machine first, with the approval fast path
> the owner chose (Q-D107, 2026-10-10): a held Auto action that
> is a confined read-only inspect command (Linux and macOS), or the
> workspace's own unchanged npm or pnpm check script run in a contained
> sandbox (Linux only), may skip the slow reviewer when the judge does not
> veto it within 5 seconds of the hold, for both kinds (the reviewer still
> starts as it does today, so a veto adds no wait, and a skip saves time
> rather than the reviewer's tokens). The
> design is in [design/judge-fast-path.md](design/judge-fast-path.md).
> The engine, the wizard and the CLI below are built and tested; no
> paid/live judge call or production calibration is claimed yet, and
> no model is downloaded without the owner's go. The rest of this page
> describes phase 1 as it ships today.

Muse Spark Code (Unofficial) uses the conversation's own model to advise on
an action's risk. Judge cannot allow an action, write code, bypass a rule or
answer the user. The Muse Code source uses the subscription; Model API dispatch uses D78’s
shared durable daily budget and paid-use consent. Local inference,
separate providers, calibration, cascade, CLI/MCP and other uses are phase 2.

## Settings and fences

`museSpark.judge.engine` is machine-scoped: `auto` (default) resolves to
`same`, `same` is explicit, and `off` stops future judgments. The settings
also accept passive `separate` and `both` configuration, with an empty
`museSpark.judge.separate` source/model identifier by default. These values
cannot dispatch until their source and adoption gates pass. The same-model source
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
Paid dispatch requires consent and a shared daily-budget reservation.

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

The metered path, verified with the real local journal and fake transport, asks through `PaidUseConsent` before
the first charge, naming the verified model price and shared
`museSpark.paidDailyBudgetUsd`. Allow once stays once; Allow always uses the
existing revocable trusted-workspace grant; Deny or closing refuses. The shared setting and `src/host/paid/paidDailyBudget.ts` supply the same
account/day journal as other interactive extras. Read-only claim lookup and
the current day’s retained liability survive reopening the adapter. The
remaining D77 acceptance criteria are listed in
[the integration record](certification/m98.md).

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

# Phase 2 libraries

Muse Judge is advisory: an answer never grants an action, skips a question
or replaces a deterministic check. This integration packages B's
offline calibration, D's sampling/contrastive techniques and CS's loopback
boundary, plus G's reviewed bounded CLI/MCP implementation. An explicit
judge command loads the shared factory without starting an ACP connection
or chat backend. Source, admission and offline/surface command adapters
remain required; MCP initialization and tool listing work without inference.
GH, H, J and FU are packaged as lazy children; C/E/A/I/FP remain pending. TypeSafe/Jev remains
experimental, untested and opt-in; historical research is not product
certification.

`dist/judgeP2.js` is a CommonJS bundle beside shared `dist/uiText.js` and
`dist/validation.js`,
included in both the VSIX and the ACP npm package. The type-only
`judgeFeaturesLoader` in `src/runtime/judge/judgeBundle.ts` loads it on the
first explicit call, retries missing/corrupt files, and installs the caller's
current language before every use. Its factory exposes:

- `parseCalibrationDataset`, `parseCalibrationProfile`, `fitCalibration`,
  `reportCalibration` and `applyCalibration`, with required caller-supplied
  limits. Fitting/tuning/evaluation groups stay disjoint. Profiles bind the
  provider, source, model/version/endpoint, technique, family and prompt,
  criteria and fit versions. Synthetic or partial evidence cannot activate
  a calibrated label. Reports measure evaluation groups only.
- `sampleJudge` and `contrastiveJudge`, with the captured source,
  measurement and per-attempt admission dependencies required by D.
  Sampling requires explicit opt-in and refuses forced reasoning; the cold
  run's first sample establishes the prefix without an extra inference.
  Contrastive sends each binary question and its explicit inverse together
  in one admitted request. Neither technique inherits a calibrated label.
- `startJudgeServer` (from the `judgeServe.js` child through the parent's `loadServe`, not from the parent factory itself), with a required `JudgeRuntime` and existing token
  parent directory. It accepts only literal `127.0.0.1`/`::1`, exact bound
  Host, no Origin, and a per-start bearer from a private owner-only file.
  Input/output validation and streamed size limits precede inference.
  Shutdown cancels calls, closes sockets and removes the token. A hard kill
  can leave a private stale token, which never authenticates a restart.
- `runJudgeCommand` and `runJudgeMcp`, preserving G's validated argument,
  request, result and cancellation boundaries, deadlines and bounded stdio.
  Paid dispatch requires the injected durable admission adapter and a positive
  run cap; no fake source or ledger is installed. The CLI refreshes the lazy
  factory's language after its initialization reads the caller's table.

The factory selects no model, creates no backend, reads no API key, starts
no listener and makes no inference call. Phase 1 retains its shipped `dist/judge.js` factory and synchronous approval
fences. Phase 2 uses the distinct explicit-action factory; shared parser,
English fallback regions and wire schemas retain main's delivery boundaries. The judge retains its
75 KiB cap; the build rejects phase-2 implementations in any other bundle,
missing implementations and duplicated English fallback. Both package
inventories require the new member, and its dependencies enter notices and
SBOM inventories through the production metafile.

Before a dispatcher enables inference, it must inject the canonical D78
durable daily ledger and source policy: a new uncached worst-case claim
before every attempt/retry, first-charge consent with price and shared daily
budget, rebinding after waits, idempotent settlement, known-nonsend refunds
only, and retained uncertain liability. Repeated per-answer cost metadata
must not be summed as separate charges. No production fake or fallback
substitutes for these dependencies.

Independent calibration and paired M75 technique measurements, captured
eligible sources, real-ledger/M80/FIXDEF checks, installed Windows ACLs and
the integrated CLI/VS Code/npm receipts remain open with their owners.
macOS Node/socket/ACL tests and Linux's prior receipts do not certify Windows.
Full quality, coverage and hosted checks run on the lead's final integrated
tree. This slice made zero live, paid or local model calls; the
[round-2 integration receipt](certification/m98-p2int-round2.md) records its exact checks,
drills and artifact hashes.

Round 3 exposes `loadLint()` and `loadHook()` through the same lazy factory.
Their separate bundles install the caller's language before use. Lint keeps
its captured-tree/symbol and admission dependencies; the hook adapter borrows
the parent's existing ask runner. Cursor's five blocking rows are excluded
from the registration list regardless of later neutral-parser changes;
observation rows retain validated caution/neutral delivery. Installed command
and real-source/grammar receipts remain separate acceptance work.

Round 4 exposes `loadLocal()` and `loadUses()` in separate lazy children.
`createLocalJudge` supplies the packaged platform helper; vetted installation
records, per-platform certification, full serialized-request token measurement
and captured model wording remain mandatory caller dependencies. Its factory
and helper preparation start no listener or inference. Windows and Linux
sources compile into caller-owned storage with a fixed compiler, empty
credential environment and a bounded deadline; the universal macOS helper is
verified in its package. Downloads remain a separate explicit, consented action.

FU exposes independent use admission, hint/advice helpers, deadline fences and
`JudgeUses` caution holders. No production policy or source is injected into
conversations: all nine uses remain inactive without their own matching paired
M75 and borrowed-golden evidence. Immediate/native actions still have no new
fence. Held review actions never await judge output, share one dispatch and keep
each approval's lifetime independent. The shared portable libraries serve VS
Code, ACP/headless and future editor bridges with the same evidence rules.
No C/E/A/I/FP surface is implemented by this round. Round 4's universal package
exceeded the existing VSIX cap. The 0.16.0 train must verify the integrated
universal archive against that same cap and complete the hosted and installed receipts.

Phase-2 integration keeps the repaired SystemOne and BYO adapters behind the
explicit `judgeP2.js` → `judgeSources.js` loader. Every source replacement or
revocation advances the assembly generation; the host still supplies M95's
client and D78's durable claims. Missing captured native codecs refuse a route.
No separate provider is auto-selected or certified by this merge. The Models
panel keeps its honest unavailable state until a source port is connected.
Account & usage receives the current same-model judge status through the shared
validated bridge; unavailable accounting amounts remain unknown. The shared
React rows also apply to hosts using that bridge; ACP/headless expose the
portable assembly but have no Models panel. Installed-editor receipts remain
required before claiming those source routes are supported.

The phase-2 fix round (RVM98P2R) settles how the experimental SystemOne route
is admitted. Its consent is a window grant bound to the route's recipient,
model and captured price ceiling (`PaidUseConsent.allowsRoute`); no
feature-level Judge grant covers it, and "Ask again" or a price change revokes
it. The window fences its admission, key read and POST on the action's trigger
generation (owner, chat model, engine, separate source, turn), so a change
refunds before anything is sent. Every sent call settles into a paid Judge row
at the route's rates. The request uses the M95 providers' pinned transport
behind their endpoint policy, and the reply is scrubbed of the active key
before any result. The CLI checks the key before any claim and settles into
the D78 daily journal on top of its hard run budget. One served-model rule
(`isServedJudgeModel`) serves the cascade and the CLI/MCP checks.

The route is gated by its own availability only (multi-vendor rule): an
explicit `separate`/`both` engine and its key, never the Meta judge's paid
gate, price acceptance or the window's backend. An explicit `separate` run on
a buildable route needs no Meta judge consent and never shows its popup. The
settings stay machine-scoped; a separate judge selected only in the
workspace's settings files is named with gap `scope` in the status line and
logged once, never honoured.

Fix round 2 (RVM98P2R2) closes the waits. The route's grant stays
window-scoped by the lead's decision (as Tab's), and its popup now says so:
"Allow in this window" or Deny. The run's identity (owner, chat model, source,
turn and the route grant's revocation count) is captured before the popup and
read again after the popup, the key read, name resolution and once the
connection is up, before any request byte is written (`pinnedPostRequest`'s
`shouldWrite` fence); the same fence reads the durable D78 claim's live check
(Stop, day change, reduced cap). A withdrawn request refunds; an answer whose
grant was revoked in flight is charged but never answers. The paid row opens
at dispatch, credential-bearing property names are dropped at every depth,
and workspace settings files are read within bounds (regular files only, 256
KiB each, 1 MiB and 32 files in all). Money on this path is exact nano-USD:
the route's tariff and receipts, the CLI's `--budget-usd` (nine decimals) and
run cap, and the D78 journal's totals. A C-only run's status and Account &
usage project the route's own source, model, tariff and grant, with its own
Ask again.

# Setting up the local judge (M125)

The **Muse: Set Up Local Judge** command (palette, walkthrough, the
Models & Agents Judge section, or a status item until setup or
deferral) opens a wizard: it scans the machine, recommends a model
with its reasons (or says honestly when nothing fits), asks for the
model's licence, installs with byte progress, and finishes on the
timing classes, accuracy checks and smoke count the install earned.
One panel per window. The Judge section afterwards manages the
install: open, change (which rescans), or remove behind a native
question; removal deletes only what setup added. The wizard's
driver loads on first open, never at activation.

The same setup runs headless in the agent:

```text
muse-spark-code-acp judge scan
muse-spark-code-acp judge setup [--yes]
muse-spark-code-acp judge remove [--yes]
```

`scan` prints the OS, RAM, CPU, GPU backend, free disk, any existing
Ollama and the recommendation; it writes nothing and makes no network
call. `setup` and `remove` change nothing without `--yes`. `setup`
refuses when nothing fits (`Cannot set up (fits-nothing).`); `remove`
answers `No local judge installed.` when there is nothing to remove.
Exit codes: 0 done, 2 usage, 4 failed.

`museSpark.judge.fastPathOff` (machine-scoped, default false) stops
the fast judge's deterministic checks and engine calls, leaving only
the same-model caution judge. Account & usage and the Judge section
show the window's fast-decision rolls — turns, applied turns, judge
calls and tokens, each evaluated decision's state — with a measured
time saving once a paired evaluation exists.
