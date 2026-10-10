# Design: the Judge, our Jev for speed and accuracy (D107, M125)

Status: design, 2026-10-09, revised the same day after the owner's
correction (section 1) and again after the second review (`RVJUDGEFAST2`,
section 15). Nothing here is built. PLAN.md D107 is the decision
of record and M125 the milestone; this file holds the reasoning, the
catalogue and the numbers behind them.

## 1. The owner's request

> "the judge is currently enabled by default but it does not seem to work
> properly out of the box that needs to be designed in a meaningfully
> helpful way the purpose is to make the decision engine for the app faster
> not add an additional layer on top of the model this should complement
> and quicken the agent" (owner, 2026-10-09)

> "the judge is supposed to be a jev like system that enhances our speed and
> accuracy you are telling me muse only and thinking level adjustments now
> and i am confused" (owner, 2026-10-09, on the first version of this design)

> "there needs to be an easy wizard to setup the local model for a user
> after a scan to see if the hardware will work" (owner, 2026-10-09)

The first version led with rule checks and with turning the thinking level
down, and its day-one answer had no model in it. That was the wrong centre.
This version starts from what the owner asked for:

- **The judge is our own Jev.** A SystemOne-style decision engine inside the
  harness. Given the agent's current state and a batch of questions, it
  returns calibrated answers in a fraction of a second, on the Jev wire that
  D77 already adopted (`judge({state, questions})`).
- **It has two jobs, and both are measured.** _Speed_: decisions the big
  model now spends a slow turn or a tool round-trip on are answered by the
  judge instead. _Accuracy_: calibrated checks on the agent's own work are
  fed back to the model as hints, shown to the user, or used by
  deterministic rules.
- **It works out of the box.** The default user (no GPU, no Ollama, a Muse
  subscription only) is offered the real judge on first run through the
  **Set Up Local Judge** wizard (section 8.2): it scans the machine, says
  in plain words whether a local judge will run well on it, recommends a
  model or a hosted engine, and installs with one consent. Deterministic
  checks run until an engine is ready.
- **It serves every backend.** On the Model API and the M95 providers the
  extension runs the agent loop, so every decision applies. Muse Code, where
  Meta's CLI runs its own loop, gets a stated subset (section 10).

The standing rule from D50 and D77 does not change. The judge never answers
the user, never writes code, and is never the only gate for an action (owner
memory `typesafe-assist-only`, 2026-09-27). Section 9 keeps the one question
this design leaves to the owner.

## 2. What the judge is

```
judge({ state, questions }) -> { answers, model, usage }

state      the agent's current state, packed for the question batch:
           the user's request, the files and memories in play, the last
           tool calls and their results (head and tail), the reply so far
questions  1-64 typed questions over that one state, keyed by id:
           noul    -> p(yes)
           choice  -> one probability per lettered option
           score   -> a distribution over levels, and its expected level
```

This is the contract `m98/p2-r4` already implements (`src/core/judge/schema.ts`,
`engine.ts`; accepted code at `f131ffc88`). Every engine in section 4 speaks it,
natively (`/v1/systemone`) or through an adapter (logprobs, stated
confidence). D77's rules stay: our confidence is always `1 − H(p)/ln N`,
computed by us; the vendor's own confidence is kept apart; every answer is
labelled calibrated or uncalibrated; calibration is per engine and per
question family (2b, Platt or isotonic, extended by M125's lane L to the
SystemOne technique and the new families, section 7), because a threshold does not carry
over between engines (`docs/certification/m98-research.md`: Jev and
`tev1:4b` gave the same force push 0.55 and 0.99).

**One call, many answers.** The harness gathers every question that is due
for one state and sends them together. Jev answered 40 questions over one
state in 2.1 s; `tev1:4b` on a quiet CPU answered three questions over one
state in 2.0 s, against 3.1 s for one question per request. Batching is what
keeps a CPU engine useful. Ollama's `/v1/systemone` sees only the model's
loaded window (2,048 tokens by default; a 3,652-token packed request was
refused), so the packer bounds the state (head and tail of long outputs,
paths and symbols rather than file bodies) and splits a batch that does not
fit.

**What the judge is not.** It never produces text for the user, never
proposes code, never grants an action, and never edits or reorders anything
already sent to the big model. Every decision has a deadline and today's
behaviour as its fallback, byte for byte.

## 3. Why today's judge misses

Checked against `rel017/merge` at `647f75dfb` (phase 1) and `m98/p2-r4` at
`f131ffc88` (phase 2).

| Finding                                                                                                                                                                                                                                                      | Evidence                                                                                                                                                    |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `auto` (the default) resolves to `same`, the user's own chat model. On Muse Spark that is 8–14 s per judgment.                                                                                                                                               | `package.json` `museSpark.judge.engine`; `src/core/judge/resolve.ts` (`auto-same`); `src/shared/constants.ts` `JUDGE_ENGINES`                               |
| Its only effect is a caution latch. A ready caution turns a reviewer's ALLOW into a card; on a card it adds a note. It can only slow things down or add a click, never speed anything up.                                                                    | `src/host/review/reviewedApprovals.ts` (caution read → `showCard`); `ModelApiHost.ts` (`judgeCaution: true`); `src/core/judge/use.ts`                       |
| It is not started on immediate allows, which are most actions in Auto.                                                                                                                                                                                       | `conversationController.ts` (`autoApprovalChoice` returns before `holdForReview`/`watchJudgeCard`)                                                          |
| On Muse Code each approval opens a fresh hidden session: `session/start`, `session/setReasoningEffort('none')`, then `turn/start`, in a new temporary folder. It races a reviewer that reuses its own warm session, and usually loses.                       | `src/host/judge/museCodeSameJudge.ts`; `src/core/judge/same/sessionSpec.ts`; `same/batches.ts` (one batch per question kind)                                |
| The latch is read once, when the reviewer finishes. A result that is not ready by then is dropped. On the Model API, the first action also waits behind the consent prompt, so its fence reads empty.                                                        | `reviewedApprovals.ts` and `ModelApiHost.ts` (`fence.read()`); `use.ts` and `scheduler.ts` (late results dropped); `judgeUse.ts` (consent inside `prepare`) |
| The ready-rate switch-off (`JUDGE_MIN_READY_RATE = 0.5`) never fires. Production passes no `readyRate`, `JudgeReplayRecorder` is not wired to the M75 runner, and a new measurement is ignored after the mode first resolves.                                | `extension.ts` (judge wiring passes neither `readyRate` nor `onFence`); `src/core/eval/judgeReplay.ts` (tests only); `resolve.ts` (`shouldReResolve`)       |
| It turns itself off silently. On Muse Code any standing user-level allow rule switches it off; on the Model API a missing ledger, context limit or connection does. A failure only logs "approval unchanged".                                                | `same/allowRules.ts`; `src/host/judge/judgeEntry.ts`                                                                                                        |
| Phase 2 built the fast engines (a verified local judge, SystemOne, BYO models, calibration, embeddings), but production returns gap `install` for every local side and gap `capture` for BYO. Nothing installs them or points them at the agent's decisions. | `m98/p2-r4`: `src/core/judge/sides.ts`, `src/core/judge/local/**`, `src/core/judge/systemone/**`, `src/core/judge/providers/**`                             |

Net result: the judge runs on the slowest engine available, answers one
question, mostly too late, and its answer can only add a click. The fast
engines exist in phase 2 and are never reached.

## 4. Engines

### 4.1 Ranked by measured speed and calibration

All numbers are from `docs/certification/m98-research.md` (40-item
destructive-command set, synthetic, labelled by hand; an indication, not a
calibration result) unless marked.

| Rank | Engine                                                                                                                                   | Wire                                       | Latency (recorded)                                                                                    | Accuracy, Brier                                                 | Cost, consent                                                                               |
| ---: | ---------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------ | ----------------------------------------------------------------------------------------------------- | --------------------------------------------------------------- | ------------------------------------------------------------------------------------------- |
|    1 | **Local decision model `tev1:4b`** over Ollama (2j, verified per connection)                                                             | `/v1/systemone`                            | GPU warm p50 0.30 s, p95 0.36 s. Quiet CPU warm p50 3.1 s, p95 3.8 s; 3 questions 2.0 s. Cold 13–48 s | 0.975, 0.030; its one miss near 0.5                             | Free. 4.5 GB download, asked once (D78). Local, so allowed in confidential workspaces       |
|    2 | **Local logprob models ≥ 3B** (`qwen3:4b-instruct-2507`, `llama3.2:3b`), after calibration                                               | Ollama `/api/chat` logprobs, top-5         | GPU warm p50 62–104 ms                                                                                | 0.925, 0.066–0.071; three confident misses each                 | Free; 2.0–2.5 GB. Joins only once its calibrated Brier on M75's set reaches `tev1:4b`'s     |
|    3 | **Jev 1.13 through OpenRouter** (2c)                                                                                                     | `/api/v1/systemone`                        | 1.9–2.1 s per request; 40 questions over one state in 2.1 s                                           | 0.975, 0.023                                                    | Paid: $0.0000206 for a 491-token request. Asked once with price and daily budget (D48, D78) |
|    4 | **Cloudflare Clef** (`clef` 27B, `clef-flash` 9B)                                                                                        | Workers AI SystemOne                       | Not measured (no token held)                                                                          | Not measured                                                    | Paid; a Workers AI token. Enters the ranking only after a counted probe                     |
|    5 | **Together `Tev1-4B-experimental`**                                                                                                      | Chat, option letter with top-5 logprobs    | 1.5 s                                                                                                 | One smoke item; Together says its logprobs "are not calibrated" | Paid: $0.042 per million input tokens                                                       |
|    6 | **Other fast logprob models** (2e: `gpt-4o-mini`, `deepseek-flash` thinking off, Fireworks, OpenRouter routes with `require_parameters`) | Chat logprobs, batched                     | 2.2–3.4 s for 40 questions                                                                            | 1.00, 0.0000 (both) on the 40 items                             | Paid, BYO key. Capability per model, from the M95 capability record                         |
|    7 | **The user's own chat model**, last fallback                                                                                             | Stated confidence, batched (`json_schema`) | Muse Spark 14.2 s for 40 questions at effort `minimal`; 8.8 s for one                                 | 1.00, 0.0025 (stated)                                           | The subscription or the user's key. Background only (section 4.3)                           |

The optional embedding heads (2i) answer in under 2 ms once trained, but
need hundreds of labels per family; they are a later fast path for the
relevance questions, not a ranked engine today.

**The latencies above are raw inference, not what the judge will take.**
Ranks 1 and 2 were timed as direct Ollama requests (`m98-research.md`; the
GPU through an SSH tunnel). A local engine in M125 is reached only through
2j's verified source, which before every content dispatch checks the
serving peer and proves the model on disk by hashing every blob twice
(`src/core/judge/local/source.ts`, `local/model.ts` at `f131ffc88`). The
accepted receipts in `docs/certification/m98p2-j.md` measure that complete
path:

| Platform (receipt)             | Model                        | Complete verified call, warm | Of which disk proof | Inference after proof |
| ------------------------------ | ---------------------------- | ---------------------------- | ------------------- | --------------------- |
| Windows 11, CPU (Xeon 4210 VM) | `qwen3:4b-instruct-2507`, Q4 | 16.280 s and 17.204 s        | 14.801–14.893 s     | 0.654–0.690 s         |
| Linux (Kubuntu rig), CPU       | `tev1:0.8b`                  | 6.471 s and 10.663 s         | not split out       | not split out         |
| macOS (Mac mini)               | the receipt's final source   | 18.420 s                     | 14.143 s            | not split out         |

So, as built today, no local engine meets any budget in section 5 except
P, on any of the three rigs. Two rules follow:

- **Only verified-path numbers decide.** The resolver's samples (4.2), the
  recommendation table's latency columns (8.2) and the wizard's Done screen
  all use the complete verified call, from dispatch to the parsed answer,
  on the path setup actually runs. Raw inference timings may be shown as
  information, never used for eligibility.
- **Making the verified path fast is M125 work (lane J), not a
  relaxation.** The disk proof stays; what changes is when it runs. The
  full two-pass hash runs at registration, after a preload and whenever the
  model's identity may have changed. Between full proofs, each content
  connection keeps 2j's per-connection peer check and revalidates the
  retained blob handles (2j's retained-handle snapshot: same file
  identity, size and change time, zero bytes written) instead of rehashing
  4.5 GB. Any identity change, a new runtime generation or a failed
  revalidation falls back to the full proof before the next dispatch,
  never after. Lane J is reviewed as a security change with M98's owner,
  keeps every 2j red drill, adds drills for a blob replaced, truncated or
  rewritten in place between proofs, and records the new complete-path
  timings per platform. Until a platform has those receipts, its local
  rows are P-only.

### 4.2 Resolution on this machine

The engine is chosen per timing class (section 5) and per machine, by
measured latency, not from the table above:

1. Collect the engines that are installed, consented and verified (2j for
   local, D78 consent for paid ones), in rank order. In a confidential
   workspace, only verified local engines remain.
2. Read each engine's rolling latency for this class's state size: the
   complete call (for a local engine, 2j's verified path including its peer
   check and disk proof), never raw inference. The window
   is the last `JUDGE_FAST_LATENCY_WINDOW` = 50 answers, in memory per window
   and in global storage per machine, with no content. An engine with no
   samples gets one warm-up probe on synthetic text and is not used until it
   has a sample.
3. Keep the first engine that the class's eligibility rule (section 5)
   admits for its p95. The same function decides the wizard's
   recommendation and its Done screen. One that drifts
   over budget (a loaded CPU) is skipped until it requalifies (step 5). An
   answer is never awaited past its deadline.
4. If none fits, the class runs its deterministic checks only, and the Judge
   section says why ("no engine answers within 300 ms here; local model
   3.4 s").
5. **Requalifying a skipped engine.** A skipped engine gets no real
   questions, so its window cannot recover on its own. A skipped local
   engine gets one background probe on synthetic text (no workspace
   content, so it is allowed in a confidential workspace) at most every
   `JUDGE_FAST_REPROBE_MS` = 60 s, only while no turn is running, cancelled
   on dispose; a probe within budget re-admits it. A hosted engine is never
   probed in the background: its samples expire after
   `JUDGE_FAST_SAMPLE_TTL_MS` = 10 min, and its next use is one warm-up
   probe admitted under its D78 consent and daily budget, like any call.
6. **An unloaded local model is recovered by a preload, not a judgment.**
   2j refuses with `source-unavailable` before any inference when the
   registered model is not in `/api/ps` (a fresh runtime, or keep-alive
   expiry; the Linux receipt in `m98p2-j.md` records exactly this). A
   synthetic judgment therefore cannot load it. When 2j reports that
   refusal, the engine is marked _unloaded_, not slow, and gets the same
   preload as setup (section 8.2, step 3): one load request for the
   registered digest through 2j's verified transport, no workspace content,
   only while no turn runs, cancellable, bounded by
   `JUDGE_FAST_PRELOAD_MS` = 120,000 ms, at most once per
   `JUDGE_FAST_REPROBE_MS`, and only under the consent the user gave at
   setup to keep that model loaded. After the load, `/api/ps` must report
   the registered digest and its context window, exactly as 2j requires
   today, and the synthetic reprobe of step 5 measures it. The check that
   the served model is the registered one is never relaxed. A preload that
   fails or times out leaves the engine unloaded, with the reason in the
   Judge section.

**One decision, deterministic first.** Each decision is a cascade within
one deadline, fixed when the decision is due. Its deterministic check runs
first. If the check decides (a recognised test summary, an exact repeat),
that is the answer. If it does not recognise the input, that is a _miss_,
not an abstention: the engine resolved for the class is asked in the time
left. Only the end of the cascade can abstain, and an abstention means
today's behaviour. A deterministic check that recognises its input is
never overruled by an engine, so a GPU never makes a recognised case
slower.

### 4.3 The chat model is the last fallback, never the inline engine

Muse Spark always reasons, and costs 8–14 s per call. It is never the engine
for a decision that blocks a request. It may serve only when no ranked
engine 1–6 is available, and then only:

- for the post-turn class (section 5), in the background; it is never
  eligible for B's 2 s budget;
- as one batched call per state (all due questions together), never one per
  question;
- with D77's existing consent notice, and on Muse Code in one reused judge
  session rather than a new hidden session per batch.

A user on this fallback is told plainly that a local or hosted judge may
answer faster, with the measured times of the engines this machine could
use and one click to set it up.

## 5. Timing classes, budgets and what a CPU does

| Class           | When it runs                                                                                                                          | Eligible when the engine's p95 on this machine is                                            | Applied                                                       |
| --------------- | ------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------- | ------------------------------------------------------------- |
| **I inline**    | Between Send and the first request, or between a tool result and the next request                                                     | ≤ `JUDGE_FAST_INLINE_DEADLINE_MS` = 300 ms                                                   | That request                                                  |
| **S slack**     | In a window that opens when the question's input is complete and closes at a later point the harness already waits for (listed below) | ≤ the window's predicted length, and never more than `JUDGE_STATE_LATENCY_MAX_MS` = 5,000 ms | The first request boundary after the answer, as a tail change |
| **B boundary**  | While the user types; at compaction                                                                                                   | ≤ `JUDGE_FAST_BOUNDARY_DEADLINE_MS` = 2,000 ms, never on the Send path                       | The next turn's tail, or the compaction                       |
| **P post-turn** | After the reply ends                                                                                                                  | Any; the answer is dropped if the user sends first                                           | A note under the reply; the next turn's hint                  |

**One eligibility rule.** `eligible(class, p95, window)` above is a single
function in lane 0's contract. The resolver (4.2), the wizard's
recommendation and its Done screen (8.2) and the Judge section all call
it with the same verified-path p95. No table, message or screen states a
class as on that this function rejects. The p95 is the complete call
(section 4.1), never raw inference.

**S windows that exist.** An S decision judges only input that is complete
when it starts, and its answer can only add to the tail at the first
boundary after it arrives. The windows are:

- the big model's own generation, for questions about the state that
  request was sent with (loops, done, scope, edit fit): the answer shapes
  the request after that generation, not the one already running;
- a tool result that settles while other tool calls of the same round are
  still running (the scheduler runs non-barrier tools together); the window
  closes when the round's last call settles;
- post-tool hooks, a verification step or a compaction the harness runs
  anyway before the next request.

A lone tool result that the next request carries straight away has **no**
S window: a shell call is a serial barrier, and nothing else delays the
next request. A decision that must act at that request (first-send triage,
6.2) gets an engine there only through I.

**Worked from the recorded numbers** (raw inference unless marked; the
verified path is slower, section 4.1):

| Engine, p95                                            | I       | B     | S                                                                 | P                        |
| ------------------------------------------------------ | ------- | ----- | ----------------------------------------------------------------- | ------------------------ |
| GPU `tev1:4b`, raw 0.36 s                              | No      | Yes\* | Yes\*                                                             | Yes                      |
| GPU logprob ≥ 3B, raw p50 62–104 ms (p95 not recorded) | Unknown | Yes\* | Yes\*                                                             | Yes                      |
| Quiet CPU `tev1:4b`, raw 3.8 s                         | No      | No    | In windows at least as long as its p95 (the big model's 8–14 s)\* | Yes                      |
| Jev through OpenRouter, 1.9–2.1 s                      | No      | No†   | Yes                                                               | Yes                      |
| Verified local path as built (6.5–18.4 s, section 4.1) | No      | No    | No                                                                | Yes                      |
| Chat model, 8–14 s                                     | Never   | Never | Never                                                             | Yes, background, batched |

\* Only once the verified path on that machine measures within the budget
(lane J). † Its recorded range reaches past 2 s; B only where its measured
p95 is at most 2 s.

Deterministic checks (section 8.4) run in every class in microseconds to a
few milliseconds, and stand in whenever no engine fits.

Most of the speed comes from S. Muse Spark's own 8–14 s per call is a
window in which a 2–4 s engine finishes unseen, and its answer shapes the
_next_ request. On a CPU the judge is therefore an S and P engine: it does
not gate the first request of a turn or answer while the user types, but it
decides what the request after a generation carries, whether a further
round is needed, and whether the reply is checked. On a loaded CPU (this
lane's probe: 17–22 s for a short state, 60–78 s for a long one, section 13) the resolver drops it from S and keeps it for P. No measured engine
meets I today; I runs deterministic checks until one does.

## 6. Speed: decisions the judge takes so the big model does not

Each entry gives the slow path today, the question, its class, its effect,
the fallback, and how its win is measured. The fallback is always today's
behaviour, byte for byte.

### 6.1 What to include (context relevance)

- **Today.** Optional context goes in by fixed rule: the open editor,
  mentions, rules, the skill list, memories. Irrelevant items cost tokens on
  every later request; a missed one costs a model round to fetch it.
- **Question.** `score` (0–3) per candidate file, memory, skill body or old
  tool result, batched over the user's request (`context.relevance`, a 2f
  use).
- **Class.** B while the user types (ready for Send), where an engine is
  eligible for B; I only where one is eligible for I (none measured yet).
  Otherwise the deterministic ranking (BM25 over the repo map and paths).
- **Effect.** Decides only what is appended with the new user message, or
  what a compaction keeps. Never removes or reorders anything already sent
  (SoL-Pi). Items the user attached or mentioned are always included.
- **Measured by.** Input tokens per turn; harm is a later `read` of an item
  the judge left out.

### 6.2 Does this tool result need full reading (output triage)

- **Today.** On the Model API, M73 packs an output over 8,000 characters
  only after it has ridden whole for 2 requests (`observationPack.ts`).
  Passing test logs and build noise are paid for twice or more.
- **Question.** `noul`: "does the agent need this output in full to
  continue?", from a bounded head-and-tail excerpt.
- **Class.** I for the deterministic parser (exit code 0 plus a recognised
  vitest, jest, pytest, cargo, tsc, eslint, `npm install` or `git status`
  summary). For outputs the parser does not recognise, the engine is asked
  only where the decision can still land before the output's first send:
  - **I**, with an engine eligible for I, for any output, including the
    ordinary single-tool result;
  - **S**, only in a real window (section 5): the output settled while
    other calls of the same round still run, or a hook, verification or
    compaction step comes before the next request anyway.
    Otherwise, and that includes a lone shell output on a machine with no I
    engine (every machine measured so far), the engine is not asked: the
    output goes in whole, exactly as today, and M73 packs it later by its
    own rule. A late answer is discarded, never applied to an output already
    sent. The Judge section shows the share of unrecognised outputs that had
    no window, so the missing win is visible.
- **Effect.** Before the output is first sent, M73's own sticky placeholder
  (the same text on every later request), so nothing already sent changes.
  `recall_output` stays available. Off when M73 is off. Model API and M95
  only: off on Muse Code until its `ide` server has a recall tool
  (section 10).
- **Measured by.** Input tokens; harm is a `recall_output` of a packed
  output within 3 requests. The fake replays release each output at its
  real boundary (the tool settles, the next request is due), never with an
  engine answer seeded while the tool still runs, and include the lone
  shell output with no window, which must go out whole.

### 6.3 Is the agent looping or stalled

- **Today.** The Model API stops after `TOOL_REPEAT_LIMIT` = 3 identical
  calls and `MODEL_API_MAX_TOOL_ROUNDS` = 50. Muse Code has nothing
  comparable. An oscillating agent (edit A→B, test fails, edit B→A) burns
  full 8–14 s rounds until a cap or the user stops it.
- **Question.** `choice`: progressing, repeating, oscillating, stalled.
- **Class.** I for the deterministic part (hashes of tool, canonical
  arguments and result digest over a sliding window: exact repeats, A↔B
  oscillation, the same failing test id three times); S for the engine on
  softer cases (different commands, no progress).
- **Effect.** A one-line harness note at the tail of the next request ("the
  last three edits alternate between two versions; the same test fails");
  at the hard pattern, a stop with the reason, as `RepeatGuard` does today.
  On Muse Code, a "Looks stuck" chip with Stop and Steer.
- **Measured by.** Big-model calls avoided per looping episode on M75 traces
  with injected loops; harm is a note or stop on a progressing trace.

### 6.4 Is the task done

- **Today.** The big model decides alone when to stop; it sometimes runs
  extra verification rounds after the work is finished, or stops early.
- **Question.** `choice`: done with evidence, done without evidence, not
  done.
- **Class.** S during the last rounds; P after the reply.
- **Effect.** "Done with evidence" while the model is still verifying: a
  tail note that the request's checks already passed (Model API, M95).
  "Not done" after a reply that claims done: see 7.4. The judge never ends a
  turn by itself.
- **Measured by.** Rounds after the first passing check; harm is a turn the
  user had to continue.

### 6.5 Which skill or command fits

- **Today.** The model reads the skill list and picks on its own, or the
  user types the command. A missed skill costs exploratory rounds.
- **Question.** `noul` per candidate skill or command (`skill.fit`, a 2f
  use), batched, top one only.
- **Class.** B while the user types.
- **Effect.** One composer hint ("`/review` may fit"). Nothing enters the
  model's request unless the user accepts it.
- **Measured by.** Acceptance and turns to the first useful tool call on
  M75's skill-routing cases.

### 6.6 How hard to think (one item among many)

- **Today.** Every turn runs at the slider's effort.
- **Question.** `choice` over the model's effort levels, capped at the
  user's setting: the judge may lower effort, never raise it.
- **Class.** I, so only where an engine fits 300 ms (a GPU) or a
  deterministic rule matches (a rename, a typo).
- **Effect.** The Model API's `reasoning.effort` (not part of the
  prompt-cache key in `promptCache.ts`); M95 through the codec's capability
  record. Both are a field of the request itself: an abstention sends the
  user's level, byte for byte as today, and adds no wait.
- **Off on Muse Code.** There, effort is not a request field but a
  mutation: `session/setReasoningEffort` waits through `commandWithin`
  under the normal 60 s timeout, and its `effortChanged` notification
  updates the composer's preference (`MuseCodeHost.ts`,
  `conversationController.ts`). The previous version of this design gave
  the setter a 500 ms apply deadline and, when the acknowledgement did not
  arrive, reset the user's level and waited for that reset before starting
  the turn. Review showed that this cannot meet either invariant: 500 ms
  already exceeds I's 300 ms, the reset can wait up to another 60 s, and
  today's unchanged turn sends neither frame, so the "fallback" is neither
  bounded nor byte-identical. No captured mechanism can do better: an
  uncertain mutation cannot be undone without another round-trip. So 6.6
  is **not built for Muse Code in M125**. It becomes possible only with a
  captured per-turn effort field on `turn/start`, or a setter whose
  acknowledgement is captured as bounded within I's budget; both are asked
  of Meta (section 10). Until then no judge decision sends an effort frame
  on Muse Code, and main-session frames are unchanged.
- **Measured by.** Turn wall time and reasoning tokens, with M75 floors
  held. Muse Spark at `minimal` still took 8.8 s for a tiny sample, so this
  may save tokens more than time; it ships only if measured, and only where
  wall time does not regress (section 11).

## 7. Accuracy: checks on the agent's own work

Each check is a calibrated answer over the state the agent already has. Its
answer goes to one of three places:

- **A hint to the model**, as a harness note at the tail of the next request
  (Model API, M95) or of the next turn's input (Muse Code). The model decides
  what to do with it.
- **A note to the user**, under the reply or on the approval card. The user
  decides.
- **A deterministic rule's input**, which may only add caution (a card, a
  hold), never allow.

A check uses a hint or a note only above a calibrated threshold that met its
precision bar on labelled data (section 11). Below it, the check is shown
nowhere and only logged for measurement. "Expected gain" below is the bar a
check must meet to ship on by default, not a measured result.

### 7.0 Calibration: what 2b covers, and lane L

2b as accepted (`src/core/judge/calibration/schema.ts` at `f131ffc88`)
fits only the families `risk.destructive` and `skill.fit`, only the
techniques `logprob` and `stated`, and only binary labels; it rejects
anything else as `unsupported-family` or `unsupported-technique`, and
`calibration/apply.ts` applies the same gate. The local and SystemOne
adapters label their answers `uncalibrated` (`local/wire.ts`,
`systemone/wire.ts`). So unchanged 2b cannot calibrate `tev1:4b`, Jev or
Clef for any family, and cannot calibrate any engine for the new families.

M125's **lane L** (with M98's owner) extends 2b and keeps its guarantees:

- **Technique `systemone`.** A noul's p(yes) is fitted exactly like a
  logprob p(yes) (Platt or isotonic), with the same splits (fit, tuning,
  evaluation), task and repository groups and identity gate.
- **New families, still binary.** Each model-backed question is calibrated
  as the binary event that triggers its action, so 2b's 0-or-1 labels and
  its binary-family checks stay as they are: `triage.needFull` (6.2),
  `loop.stuck` (repeating, oscillating or stalled against progressing,
  6.3), `done.unbacked` (done without evidence or not done, against done
  with evidence, 6.4 and 7.4), `context.include` (score at least the
  inclusion level, 6.1), `effort.lower` (the chosen level below the
  user's, 6.6), `edit.misfit` (7.2), `failure.unmentioned` (7.3),
  `scope.outside` (7.5) and `claim.inconsistent` (7.6). No multi-class
  calibration is added.
- **Profiles are fitted, not smoked.** A profile is fitted per engine
  identity (technique and model digest, or hosted model id and version)
  and family, from independent labelled sets of at least
  `JUDGE_FAST_ACCURACY_MIN_LABELS` = 400 items (lane V's sets), and is
  evaluated on its held-out split against the family's bar. Profiles ship
  as committed, dated files keyed by that identity. The wizard's
  ten-question smoke (8.2) and any number of weak signals never create or
  replace a profile.
- **No profile, no model-backed use.** A family with no shipped profile
  for the installed engine's identity stays off for that engine: its
  checks are log-only and its speed decisions use the deterministic check
  alone. The Done screen and the Judge section say "Not yet calibrated for
  this model". At M125's start that is every model-backed family on every
  engine: unchanged 2b could fit only `risk.destructive` and `skill.fit`
  for logprob and stated engines, and no such profile has been fitted on
  independent labels yet. Each family turns on per engine only as lane
  V's profiles land. `tev1:0.8b` is never profiled for
  7.1.

### 7.1 Is this command destructive or irreversible

- **Question.** `noul` `risk.destructive` (D77's family, phase 1's
  question): "Can this command delete or overwrite data, or change shared
  state, in a way that cannot be undone?"
- **When.** Every command action, in S while the reviewer runs or before the
  card shows; not only held approvals.
- **Effect.** A note on the approval card; a held action with a high p(yes)
  stays held (the caution latch, now fed by a fast engine that is ready in
  time). Never an allow.
- **Expected gain.** The phase-1 latch reads empty because its engine is too
  slow; a ranked engine answers within the reviewer's run. Bar: recall ≥
  0.95 on destructive commands at precision ≥ 0.8.
- **Measured by.** M75's labelled command sets (the 40 items grow to
  `JUDGE_FAST_ACCURACY_MIN_LABELS` = 400 per family) and the reviewer's own
  verdicts as a weak signal.

### 7.2 Does this edit address the request

- **Question.** `noul` over the request, the edit's paths and a bounded diff
  excerpt.
- **When.** S, after each edit tool result.
- **Effect.** Below the threshold, a hint: "this edit may not address the
  request: it changes X; the request names Y".
- **Expected gain.** Fewer turns where the user has to point out a misread
  request. Bar: precision ≥ 0.9.
- **Measured by.** Labelled M75 replays; the big model's own later
  correction (it reverts or rewrites the edit within the turn) as a
  positive label; the user's "that's not what I asked" retry as a weak
  signal.

### 7.3 Do the test or build results show a failure the reply does not mention

- **Question.** `noul` over the last test and build outputs (head and tail)
  and the reply.
- **When.** P, after the reply. The deterministic part (a non-zero exit or a
  failing count in a recognised summary, with no mention of failure in the
  reply) runs first.
- **Effect.** A note under the reply ("The last test run reported 2
  failures; the reply does not mention them") and a hint at the start of the
  next turn.
- **Expected gain.** No reply claims passing tests against a failing run the
  agent itself saw. Bar: precision ≥ 0.9, recall ≥ 0.9.
- **Measured by.** Labelled M75 replays with injected failing runs; the
  model's own later fix of the failure as a positive label.

### 7.4 Is a claimed "done" backed by evidence

- **Question.** `choice` from 6.4, asked over the reply and the turn's tool
  results.
- **When.** P.
- **Effect.** A note under the reply ("Says done; no test or build ran after
  the last edit"), with a one-click "Verify" that sends that request.
- **Expected gain.** Fewer unverified "done" replies. Bar: precision ≥ 0.9.
- **Measured by.** Labelled replays; a later turn that fixes the "done" work
  as a positive label.

### 7.5 Is this change outside the requested scope

- **Question.** `noul` per changed path or hunk, over the request.
- **When.** S after each edit; P over the turn's whole diff.
- **Effect.** A hint while the turn runs ("`config/production.yml` is
  outside the request"); a note under the reply listing out-of-scope paths.
- **Expected gain.** Fewer unrequested edits reaching review. Bar: precision
  ≥ 0.9.
- **Measured by.** Labelled replays; the user's undo of a path through M72's
  checkpoint as a weak signal.

### 7.6 Is the answer consistent with the files read

- **Question.** `noul` per claim the reply makes about a named file or
  symbol, over excerpts of the files the agent read this turn.
- **When.** P.
- **Effect.** A note under the reply ("The reply says `parse` returns null;
  the file read shows it throws").
- **Expected gain.** Fewer answers that contradict code the agent read.
  Bar: precision ≥ 0.9; a check with lower precision stays log-only.
- **Measured by.** Labelled question-answering replays.

## 8. Out of the box

### 8.1 The first run

The default user has no GPU, no Ollama and only a Muse subscription. On the
first turn after install (or after this change), the extension looks before
it asks, with no network call:

1. **An existing local judge.** Ollama on `127.0.0.1:11434` with a decision
   model from the recommendation table (`tev1:4b`, `tev1:0.8b`, `nimble`,
   `clef-flash`): verified per 2j and used at once, with a status note. No
   prompt and no wizard when the model is already loaded (`/api/ps`). When
   it is present but not loaded, the note offers **Load the Judge Model**
   with its memory size, because loading it into the user's Ollama is a
   change the user consents to; nothing loads before that click.
2. Otherwise, one card in the panel, shown once and never blocking the
   turn:

> **Set Up Local Judge.** The judge answers the agent's small decisions and
> checks its work while the model is busy, so the agent waits less and catches
> more of its own mistakes. Check whether this computer can run it: about
> 10 seconds, nothing is downloaded.
>
> **Scan This Computer** · **Set Up Later**

**Set Up Later** is remembered; the Status line and Settings › Judge keep
the way back (section 8.2). The deterministic checks run either way
(section 8.4).

### 8.2 The Set Up Local Judge wizard

One wizard, in every editor, owned by M125's lanes H (the shared scan,
recommendation and setup module, pulled forward from M110's lane TJ) and W
(the wizard and its entry points). Labels are in Title Case.

**Entry points.** The first-run card (8.1); the judge's Status line item
("Judge: Not Set Up — Set Up"); **Set Up Local Judge…** in Settings › Judge;
the command **Muse: Set Up Local Judge** in the command palette and in the
Help reference (`featureCatalog.ts`). Other editors reach the same command
through their command surface over MHP (D84); the ACP agent and headless
runtime get the same steps as text from phase 2's judge CLI (`scan`,
`setup`, `remove`).

**On every step:** **Back**, **Cancel** and **Set Up Later**; progress
where something runs; plain words, no jargon without its explanation.
Nothing machine-wide changes without the user's explicit consent for that
change, and before anything is installed the wizard says what it will
install and where.

#### Step 1: Scan

Local only: no network call, no file written except the scan's result (a
hardware summary with no content and no serial numbers) in the extension's
global storage. It reads:

- the OS and architecture;
- RAM, and free RAM;
- the GPU's vendor, model and VRAM, and the backend the pinned Ollama can
  use on it: CUDA (a supported NVIDIA card and driver), ROCm (a supported
  AMD card), Metal (Apple silicon), Vulkan where the pin supports it, or
  CPU only. Each "no" carries its reason ("NVIDIA driver too old for
  CUDA");
- CPU model, cores and features (AVX2 or AVX-512 on x86-64, NEON on ARM64);
- free disk where the judge would be installed;
- an existing Ollama: installed or not, its version, running or not
  (`/api/version` on loopback), and the models it already has
  (`/api/tags`);
- **a micro-benchmark** with a strict budget, `JUDGE_SCAN_BENCH_MS` =
  5,000 ms: one warm judgment on a synthetic fixture when a running Ollama
  already has a table model, through 2j's verified path (if that model is
  not loaded, the benchmark does not load it and falls back to the probe
  below); otherwise a fixed CPU (and, where available,
  GPU) throughput probe in a worker, mapped to the table's hardware classes
  through the rigs' verified-path measurements and labelled "estimated". The exact
  benchmark of D90.27 (download `tev1:0.8b`, 811 MB, within
  `JUDGE_BENCH_BUDGET_MS` = 20 s) is offered under **Advanced** with its
  size.

The result is shown in plain words:

> This computer: 16 GB of memory (9 GB free); NVIDIA GeForce GTX 1080 Ti
> with 11 GB, usable through CUDA; 8 cores with AVX2; 120 GB free on C:.
> Ollama is not installed.

#### Step 2: Recommendation

The recommender reads a committed, dated table
(`src/shared/judgeModels.json`, zod-checked; the schema D90.27 gave lane
TJ). Each row: the model and tag, its digest, quantization, download and
resident size, the backends it runs on, the warm latency (p50 and p95, one
question and a batch of eight) per hardware class and platform, measured
on the rigs **through the complete verified path setup will run** (2j's
peer check, disk proof and inference, section 4.1; raw inference may be
recorded beside it for information only), its accuracy from our
measurements (the 40-item set today, M75's families once labelled), which
families have a fitted calibration profile for its digest (section 7.0),
its licence, and its source and check date. A row with no verified-path
measurement for a platform is not recommended on that platform. The
wizard shows the date ("recommendations checked 2026-10-09").

- **Pick.** Among rows that fit in memory with `JUDGE_MEMORY_HEADROOM_GIB`
  = 1.5 to spare and fit on disk, keep those for which section 5's
  `eligible` function admits at least S (verified-path p95 at most
  `JUDGE_STATE_LATENCY_MAX_MS` = 5,000 ms) on this machine's class; pick
  the most accurate, a tie going to the faster. The classes the wizard
  lists for the pick are exactly those `eligible` admits, class by class
  (I at 300 ms, B at 2 s, S, P), never a blanket "fast enough".
  `tev1:0.8b` is offered only
  where `tev1:4b` cannot run, labelled lower quality, and serves speed
  decisions only, never 7.1 or a variant B veto.
- **Reasons, in plain words**, including which timing classes it will
  serve and which checks are calibrated for it. Two illustrations (the
  numbers come from the row; the 0.36 s and 3.8 s here are the raw
  figures from section 4.1, standing in for verified-path rows that lane J
  must measure first):

> **Recommended: tev1:4b** (4.5 GB). It fits in your GPU's memory and
> should answer in about 0.36 s at worst: fast enough to decide while you
> type and while the model works, and to check each reply, but not under
> the 0.3 s needed to decide before each request. 39 of 40 right on our
> safety test. Checks on replies stay off until it is calibrated for them.

> **Recommended: tev1:4b** (4.5 GB), on the CPU. About 3.8 s per decision
> at worst: too slow to decide before a request or while you type, fast
> enough to decide while the model works and to check each reply.

- **Too slow or too small.** When no row fits, the wizard says so plainly
  ("A local judge would take about 9 s per decision here; it needs under
  5 s to help. This computer is too slow for a local judge.") and offers
  the hosted engines instead, each asked once with its price and a daily
  budget (D78): **Use Jev Through OpenRouter** (a key already saved for
  M95, or one the user pastes; about 2 s and about $0.00002 per decision)
  and **Use Cloudflare Clef** (a Workers AI token; its speed shown as "not
  yet measured" until a counted probe). Declining keeps the deterministic
  checks. In a confidential workspace hosted engines are not offered, and
  the wizard says why.
- **Advanced** (D90.27): another size from the table, CPU only, a hosted
  engine instead, or skip.
- **Licence.** The model's licence (recorded in its row) is shown, with an
  accept step where its terms need one. The user clicks it, never us.

#### Step 3: Install

One consent screen lists everything, with sizes, places and the expected
time (at two typical download speeds before it starts; live once it runs):

> **Ollama 0.35.1** (pinned; checked by SHA-256), about N MB, into
> `<global storage>/judge/runtime/0.35.1/`. It runs only while the editor
> is open, for this user, on this computer only (127.0.0.1). No service, no
> administrator rights, nothing added to your PATH.
>
> **tev1:4b**, 4.5 GB, into `<global storage>/judge/models/`. 115 GB will
> be left free on C:. While the editor is open, the judge keeps it loaded,
> using about N GB of memory.
>
> About 6 minutes at 100 Mbit/s.
>
> **Install** · **Back** · **Set Up Later**

- **Ollama.** The default is a private copy: the pinned release's archive
  for this platform and backend, its SHA-256 recorded in the repository
  (rule 9), unpacked into the extension's global storage, started on
  demand on a free loopback port with its model store in the folder above,
  one process shared by the user's editor windows and stopped with the
  last one. 2j's per-connection check verifies the peer is that binary. An
  **existing Ollama** at or above the pin's minimum is reused instead
  (**Use My Ollama**, the default when present): nothing is installed, and
  it is never updated, restarted or reconfigured without its own consent.
  A machine-wide install (the platform's official installer, a service or
  app for all users) is only an **Advanced** choice, and the wizard states
  that it needs administrator rights before the OS asks.
- **The model** is fetched by digest from the Ollama registry through lane
  H's fetcher, resumable by HTTP range, each blob checked by SHA-256; a
  blob that fails its check is fetched once more, then the step stops with
  the reason. Through a reused Ollama the model is pulled by that Ollama
  and its served digest is checked against the table; a mismatch stops the
  step and removes nothing of the user's.
- **Load.** 2j answers only for a model that `/api/ps` reports as loaded,
  and a fresh runtime (or a reused Ollama that has unloaded it) reports
  none, so a judgment cannot load it. Setup therefore preloads: one
  synthetic load request for the model's digest through 2j's verified
  transport (peer checked, no workspace content), bounded by
  `JUDGE_FAST_PRELOAD_MS` = 120,000 ms, with progress ("Loading the judge
  model: about 15–50 s the first time") and **Cancel**. Then `/api/ps` must
  report that digest, equal to `/api/tags`' and the table's, and gives the
  loaded context window. The preload request and its response are captured
  once (free, local, counted) before lane H parses them (AGENTS rule 13).
  For the private runtime the keep-alive is set on our own process; for a
  reused Ollama it is a per-request keep-alive under the user's consent
  above, and its server settings are never changed. Section 4.2 step 6
  uses the same preload when the model later unloads.
- **Register** with 2j: the endpoint, the model id and digest, the
  runtime's path for the provenance check, the loaded context window read
  after the preload, and the timeout.
- **Health check:** one judgment of a fixture with a known answer, through
  the verified path.
- **Ten-question smoke** (the owner's "calibration smoke"; a health and
  latency check, not a fitted calibration): ten committed labelled
  questions across the families (destructive, triage, loop, relevance,
  done), batched, warm, local only, through the complete verified path. It
  reports the verified-path latency (p50, p95) and the number right. Below
  `JUDGE_SETUP_SMOKE_MIN_CORRECT` = 9 of 10 the engine is registered but
  left off, as likely broken, with the reason. The smoke's p95 feeds
  section 5's `eligible` function, which alone decides the class states
  shown on Done. Passing the smoke never turns an accuracy check on: that
  needs a fitted profile for this digest (section 7.0).
- **Cancel** stops at once. Verified parts are kept for a later resume, and
  their size is shown with **Remove Partial Download**. A closed editor or a
  dropped network resumes from the same point. No hosted engine is called
  during the install.

#### Step 4: Done

Every class line is `eligible(class, smoke p95)` from section 5; every
check line also needs a fitted profile for this digest (section 7.0). An
illustration for a GPU whose verified-path p95 came out at 0.34 s:

> **Local judge ready.** tev1:4b on your GPU: 0.34 s per decision at worst,
> ten questions in 1.2 s, 10 of 10 right.
>
> - Decisions before each request: **Off** — they need under 0.3 s; this
>   computer takes 0.34 s. The quick built-in checks run there instead.
> - Decisions while you type: **On**
> - Decisions while the model works: **On**
> - Checks on each reply: **Off** — not yet calibrated for this model.

On a CPU at 3.8 s, "while you type" also reads Off ("they need under 2 s").
A class line can read On only when `eligible` admits it, and a check line
only when its profile exists; the step has no other source for them. The
step links to the Usage view's Judge row (section 11), which tracks the time
and tokens the judge saves from here on, unknown until measured.

### 8.3 Re-scan, change and remove

- **Re-scan when hardware changes.** At startup a hardware fingerprint
  (CPU model, RAM size, GPU models and VRAM, OS and architecture; no serial
  numbers) is compared with the last scan's. A change, or a judge whose
  measured latency no longer fits its classes, shows "Judge: Hardware
  Changed — Re-scan" on the Status line. Nothing downloads without the
  wizard's consent.
- **Settings › Judge** shows the model, its size, the hardware and backend,
  the last health check and smoke, and **Re-scan**, **Change Model**,
  **Update** (a new pin or table row, through the same consent) and
  **Remove Local Judge**.
- **Remove** stops the runtime and deletes only what the wizard added: the
  private runtime folder, the model blobs it fetched, and the registration.
  A model or an Ollama the user already had is never removed. A
  machine-wide install is removed through the platform's uninstaller, with
  its own consent. Afterwards the deterministic checks remain and the
  Status line reads "Judge: Not Set Up".

### 8.4 Until an engine is ready

The deterministic checks run from the first turn, with no download, key,
network call or prompt:

- loop detection (exact repeats, A↔B oscillation, same failing test id);
- output triage by exit code and recognised summary (6.2);
- a failure the reply does not mention, from recognised summaries (7.3);
- "done" with no check run after the last edit (7.4);
- edits to paths outside the workspace or under protected paths (D24), and
  M78's command rules, as today.

The Status line shows the judge's state: "Judge: Installing (62 %)",
"Judge: Not Set Up — Set Up", "Judge: Loading Model", "Judge: Local
(3.8 s)", "Judge: Jev (2.0 s)", always with the verified-path p95. One click opens the wizard at the step that is missing.

### 8.5 What each user gets

Each cell is what section 5's `eligible` admits on the recorded numbers,
once lane J's verified path meets them; model-backed accuracy checks
also need their profiles (7.0).

| User                                        | Inline (I)                                  | Boundary (B)                          | Slack and post-turn (S, P)                                          |
| ------------------------------------------- | ------------------------------------------- | ------------------------------------- | ------------------------------------------------------------------- |
| Default, before setup                       | Deterministic checks                        | Deterministic checks                  | Deterministic checks; the chat model in P only if the user opted in |
| Default, after the wizard installs it (CPU) | Deterministic checks                        | Deterministic checks (over 2 s)       | `tev1:4b`, batched                                                  |
| A GPU with `tev1:4b`                        | Deterministic checks (0.36 s is over 0.3 s) | `tev1:4b`                             | `tev1:4b`                                                           |
| An OpenRouter key and consent               | Deterministic checks                        | Jev only where its p95 is at most 2 s | Jev                                                                 |
| Confidential workspace                      | Deterministic checks                        | Verified local only, as above         | Verified local only; never a hosted engine                          |
| Any local engine before lane J              | Deterministic checks                        | Deterministic checks                  | P only (6.5–18.4 s verified path)                                   |

## 9. The approval fast path: the owner's question

Today, in Auto, an action that rules do not allow outright is held for a
reviewer: M78's Auto reviewer on the Model API, and M90's reviewer on Muse
Code (`AUTO_REVIEWER_TIMEOUT_MS` = 60 s, `MUSE_CODE_REVIEW_TIMEOUT_MS` = 45
s). Each review is a big-model call. For a plainly safe command (`cat
src/a.ts`, `ls src`, `git diff`) that is the largest single wait an agent
step can have.

### Variant A: advisory only

- The judge takes no part in granting approvals. The speed comes from
  section 6, the accuracy from section 7 (7.1 may keep an action held, never
  release one).
- Approval behaviour is byte-identical to today whenever 7.1 does not fire.

### Variant B: A, plus a bounded approval fast path

**Why the command line is not enough.** The second review showed that a
command's spelling cannot prove read-only execution. `cat src/a.ts` runs
whatever `cat` comes first on `PATH`, and a workspace `bin/cat` the agent
wrote can do anything. A genuine program can read configuration the
command line does not show: ripgrep takes `--pre` (a program it runs) from
`RIPGREP_CONFIG_PATH`; git runs filter drivers, `textconv`, `core.fsmonitor`
and pagers from repository configuration and `.gitattributes`, and `git
status` refreshes the index. Today's shell tool runs the line through the
shell with the inherited environment (`src/host/backend/toolIo.ts`), and
the vault fence strips neither `PATH` nor those variables
(`src/core/vault/exec/fence.ts`). So B is built only where the harness
itself fixes **what runs and what it reads**, and is dropped where it
cannot.

**Where B cannot be built, and is dropped.**

- **Muse Code.** The CLI runs an approved command itself, through its own
  shell, `PATH` and environment; the extension only answers the approval.
  It cannot fix the executable or its configuration, so B does not exist
  on Muse Code. Its held approvals go to M90's reviewer exactly as today.
- **Windows.** The B1 programs are not verified system executables there:
  in PowerShell `cat` and `ls` are aliases for cmdlets, Git for Windows'
  copies sit in a folder the user can write, and System32's `find.exe` and
  `tree.com` are different programs. B1 is empty on Windows, so B gives
  nothing there.
- **git.** Its effective configuration includes the repository's own
  `.git/config` and `.gitattributes`, which the agent can write, and git
  cannot read a repository while ignoring that repository's configuration.
  `-c` overrides cannot name filter drivers or diff drivers it has not
  seen, and `git status` writes the index. No option set makes git
  read-only against an agent-controlled repository, so git leaves B1.
- **ripgrep (`rg`).** It is not a system executable on any platform (a
  user's install, Cargo's folder or the editor's bundled copy), and its
  `--pre`, `--search-zip` and `--hostname-bin` run other programs. It
  leaves B1. `tree` and `which` leave too: neither is a system executable
  everywhere, and neither is worth a verified path.
- **The extension running as root** (uid 0): root can replace system
  files, so the ownership check below proves nothing. B is off.

**What remains: Model API and M95, on Linux and macOS.** A held action
skips the reviewer, and is allowed, only when **all** of the following
hold. Otherwise the reviewer runs exactly as today.

1. **Mode.** Auto (Model API `onRequest`, M95 providers). Never in Manual,
   Plan, Restricted Mode, a headless run, or a conversation that started
   from untrusted content (D49).
2. **The deterministic floor, which nothing overrides.** These go to the
   reviewer or the card exactly as today:
   - any forbid or ask command rule (M78), anywhere in the line;
   - an evaluator (`eval`, `iex`, `-EncodedCommand`);
   - redirection, `tee`, any pipe, a subshell, or any other shell syntax;
   - `sudo`, a package install or remove, any `git` command, anything with
     `--force`;
   - a path outside the workspace, a protected path (D24) or a secret in
     the arguments (`countSecretMatches`);
   - the network, a paid tool, a spawn, or a non-read-only MCP tool;
   - a confidential workspace using a non-local judge engine.
3. **The built-in class B1, inspect.** Deterministic, in code, with
   `match`/`not_match` examples like M78's rules. Every part must hold:
   - **One argv, no shell.** The line splits into words under a strict
     grammar: plain words and single-quoted words only, with no `$`,
     backquote, `~`, `;`, `&`, `|`, `<`, `>`, parentheses, newline or
     unquoted glob character. Otherwise not B1.
   - **The program** is one of `ls`, `cat`, `head`, `tail`, `wc`, `stat`,
     `du`, `grep`, `find`.
   - **A verified executable, not a `PATH` lookup.** The harness takes the
     program's absolute path from a fixed per-platform table (`/bin` and
     `/usr/bin` on Linux; `/bin` and `/usr/bin`, which SIP protects, on
     macOS), resolves symbolic links, and requires a regular file that is
     owned by root and is not writable by its group, by others or by the
     current user, under directories that are each owned by root and
     not group- or other-writable. It checks this immediately before the
     run and then executes **that resolved path itself**, by `execve` with
     the argv and no shell, so what was checked is what runs. The
     `PATH` the agent or its shell sees plays no part.
   - **A neutral environment, not the inherited one.** The child gets
     exactly `PATH=/usr/bin:/bin`, `LC_ALL=C` and `HOME` set to an empty
     private folder, and nothing else: no `LD_PRELOAD`,
     `LD_LIBRARY_PATH`, `DYLD_*`, `GREP_OPTIONS`, `POSIXLY_CORRECT` or any
     other variable. Standard input is `/dev/null`, there is no terminal
     (so no pager or editor), the working directory is the workspace root,
     and the normal tool timeout applies. None of the nine programs reads
     a configuration file, alias or hook.
   - **Per-program option shapes**, per platform, because GNU and BSD
     options differ. For example: `ls` `-l -a -A -h -R -1 -t -r -S -d -F`;
     `cat` `-n`; `head`/`tail` `-n N` and `-c N` (no `-f`, `-F` or
     `--follow`); `wc` `-l -w -c -m`; `stat` with no options; `du` `-s -h
-k` and a depth limit in the platform's spelling; `grep` `-n -i -r -l
-L -c -E -F -w -v -x -h -H`, `-e PATTERN`, `--include=GLOB` and
     `--exclude=GLOB` (not `-R`, which follows links, and not `-f`, `-d`
     or `-D`); `find` the tests `-name -iname -path -ipath -type -mtime
-mmin -size -empty -maxdepth -mindepth`, the operators `!`, `-a` and
     `-o`, and the action `-print` only (not `-L`, `-H` or `-follow`, and
     `-fprint*`, `-fls`, `-exec*`, `-ok*` and `-delete` fail by not being
     listed). Any option off the list, including an unknown one, means
     "not B1".
   - **Operands.** Every path operand, after resolving links, is inside the
     workspace, not a protected path, and a regular file or directory (not
     a device, FIFO or socket). The recursive forms allowed (`ls -R`,
     `grep -r`, `find` without `-L`) do not follow links, so a link inside
     the workspace is never read through to a file outside.
4. **The judge does not veto** within the inline deadline. It answers 7.1's
   `risk.destructive` noul with p(yes) under a calibrated threshold (a
   fitted profile, section 7.0), from an engine eligible for I. No answer,
   a late answer or an uncalibrated engine means a veto, so the reviewer
   runs. Since no engine measured so far is eligible for I (section 5), B
   skips nothing until one is.

**B2 (the workspace's own check scripts) is not part of variant B.** A
stored hash of the script's text does not cover what it runs (the agent
can change `scripts/check.js` and leave `"test"` unchanged), and command
writes are outside M86's checkpoints, so "Restore files" could not undo
them. B2 would need a real execution boundary (a sandbox with a write
snapshot), which is not in M125.

The safety envelope:

- **Audit.** Every fast-path allow is a transcript row ("Allowed without
  review: inspect command") and a flight-recorder entry: class, program,
  resolved executable, engine, p(yes), threshold and deadline. No content
  goes in logs.
- **Nothing to undo.** B1 admits no option that writes or runs another
  program; its executable is a root-owned system file the agent cannot
  replace; its environment is fixed by the harness. Red drills, each
  expected to go to the reviewer or to run the verified system binary
  unaffected: a workspace `bin/cat` wrapper first on `PATH`; a `cat`
  reached through a link into a user-writable folder; a user-writable copy
  in `/usr/local/bin`; `LD_PRELOAD`, `GREP_OPTIONS` and
  `RIPGREP_CONFIG_PATH` set in the parent's environment (absent in the
  child); every writing `not_match` example (the `find` actions, `tail
-f`); a link operand that leads outside; any `git` or `rg` command; the
  extension running as root; a Windows host; a Muse Code approval. No
  checkpoint is promised.
- **Kill switches.** Per class in the Judge section, per session from the
  row ("Review these again"), and machine-wide.
- **Harm bound.** A class turns on by default only after M75 replays and an
  independent labelled set show zero floor bypasses and a measured harm
  rate of 0 in at least `JUDGE_FAST_APPROVAL_MIN_LABELS` = 400 labelled
  actions per class.

**What B costs, and what it buys.** It costs a second execution path in
lane F, beside the shell every other command uses (argv execution of a
verified executable in a fixed environment), per-platform executable
tables and GNU and BSD option grammars kept current, the red drills
above, a fitted `risk.destructive` profile for an I-eligible engine, and
400 labelled actions per class before it turns on. It buys a skipped
review for a single read-only command from nine programs, on Linux and
macOS, on the Model API and M95 only. It skips nothing on Windows, on Muse
Code, for git, for `rg`, for any pipe, or on any machine without an
I-eligible engine.

### How B relates to the standing rule

Under B the judge is not the only gate. The deterministic class must admit
the action first, and the judge can only take a skip away. But it is one of
two gates for skipping the reviewer, so B narrows how the owner's rule has
been read: until now the judge has only ever added caution. That is why it
is the owner's decision.

### Recommendation: A

- A keeps the standing rule exactly as written.
- Most of the speed sits elsewhere. The reviewer runs only for held
  approvals in Auto. The speed decisions act on every turn, in every mode,
  on every backend.
- B's reach is now small and its cost real (above). Its safety comes from
  its deterministic part, so the same win, with the same limits, is
  reachable as a **built-in deterministic allow set** under M78's rules
  with no judge in the decision. That would be a separate M78 change for
  the owner to approve, and it would need B1's whole execution boundary
  (verified executable, argv execution, fixed environment), not only its
  grammar, because spelling alone proves nothing.
- B2 (running the workspace's own scripts) was dropped from B after review:
  a script can do anything, a model's opinion of the _command line_ says
  little about the script's _body_, and its writes cannot be restored.

If the owner picks B, M125's lane F builds B1 off by default, on the Model
API and M95 on Linux and macOS only, and turns it on only after the harm
bound above is met.

## 10. Backends

On the **Model API** and the **M95 providers** the extension runs the agent
loop, so every decision in sections 6 and 7 applies: hints go in as tail
harness notes, triage through M73, effort through the request or the codec's
capability record.

On **Muse Code**, Meta's CLI runs its own loop. Through MSP the extension
can reach:

| Applies on Muse Code                                                                                                                  | Needs Meta (asked upstream)                                                                                                                                                                                               |
| ------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Hints in the next `turn/start` input (6.1 context, 6.5 skills, 7.2–7.6 carried into the next turn)                                    | A hint inside a running turn (`turn/steer` as a hint carrier is uncaptured; AGENTS rule 14)                                                                                                                               |
| Approval-path checks on extension-owned held approvals (`reviewedApprovals.ts`): 7.1 only (variant B cannot be built here, section 9) | Approvals the CLI grants natively, without asking the extension                                                                                                                                                           |
| —                                                                                                                                     | Triage (6.2) of any tool output: CLI-native output (D49's "tool-output projection")                                                                                                                                       |
| Post-turn accuracy notes to the user (7.3–7.6) from the observed items                                                                | Selecting what the CLI itself keeps in its context                                                                                                                                                                        |
| Loop, stall and done detection (6.3, 6.4) on the observed item stream, with a chip                                                    | —                                                                                                                                                                                                                         |
| —                                                                                                                                     | Effort (6.6): a per-turn effort field on `turn/start`, or a setter whose acknowledgement is bounded within 300 ms (today it waits under the 60 s timeout); and whether `none` is accepted for a main session (uncaptured) |

Triage of the extension's own `ide` MCP tool outputs is **off on Muse
Code**. M73's placeholder tells the model to call `recall_output`, but that
tool and its store belong to the Model API host; the `ide` MCP server has
no such tool and no session identity to scope one. It turns on only after
an owner-scoped `recall_output` on that server, with its lifecycle and
security tests, is planned and built (not in M125).

**All editors.** The engines, resolver, packer and classes live in
`src/core/judge/**` and are runtime-portable. The ACP agent and headless
runtime use the same code and settings; the Set Up Local Judge wizard,
Status line, notes and Judge section live in the shared webview behind the host bridge, so
JetBrains, Visual Studio, Eclipse, Zed, Xcode and the terminal editors get
them through MHP like other panels.

## 11. Measurement

- **Where.** M75's paired runner (`src/core/eval/runner.ts`) gains one arm
  per decision (that decision on, all else equal) and wires
  `JudgeReplayRecorder` into the runner, which it is not today. Live
  receipts come from the owner's normal use, on each backend, with the
  existing usage trace logs.
- **Speed, per decision and backend:** turn wall time (p50, p95); big-model
  calls avoided; input and reasoning tokens saved; harm (a refetch, a
  recall, a retry, a false stop) against decisions applied, under
  `JUDGE_FAST_HARM_MAX` = 2 %.
- **Accuracy, per check and engine:** precision and recall against labelled
  M75 replays (with injected failures, scope slips and destructive commands)
  and against the big model's own later corrections (a revert, a fix, a
  refetch inside the same turn) as positive labels. A check ships a hint or
  note only at precision ≥ `JUDGE_FAST_HINT_MIN_PRECISION` = 0.9 (7.1:
  recall ≥ 0.95 at precision ≥ 0.8) on at least
  `JUDGE_FAST_ACCURACY_MIN_LABELS` = 400 labelled items per family. The
  end-to-end measure is task success on M75 tasks with and without the
  checks.
- **Engines:** latency (p50, p95, deadline misses) per engine and state
  size, always the complete call (2j's verified path for local engines);
  Brier and ECE per family after calibration (lane L's profiles).
- **Fake replays keep real boundaries.** A tool's output becomes available
  when the tool settles, and the next request is due at once unless the
  trace has a real window (section 5); no fake seeds an engine answer
  before its input exists.
- **Ship rule.** A decision is on by default on a backend only when its win
  (time, calls or tokens) is positive, its M75 floors hold, its harm or
  precision bar is met, **and** turn wall time does not regress: p50 and
  p95 per backend and model no worse than without it, counting deadline
  misses, fallbacks, preloads, any extra control round-trip and
  cache effects (cached input tokens per request, which must not fall). A
  token win never excuses a slower turn.
  Until then it is available but off by default, and the Judge section says
  "not yet measured on this backend".
- **Shown to the user.** Account & usage gets a "Judge" row: estimated time
  saved, tokens saved, calls avoided, and checks raised and acted on, per
  decision, today and this week, with the method named. Missing data shows
  as unknown, never as zero.
- **Units of the estimate.** The paired arm measures a per-turn effect, so
  time saved is counted per turn, never per decision: the paired median
  wall-time difference per eligible turn, for that backend and model,
  times the turns in which the decision applied at least once. Ten
  decisions in one turn count once. Tokens and calls are counted per
  request directly. Where a turn cannot be attributed (several decisions
  with no matched arm), the row shows unknown.
- **Honesty.** Approve and deny, accepted suggestions and test outcomes are
  weak signals kept apart from labels (D77). Fake replays certify wiring,
  not wins.

## 12. Migration and reuse

- **`museSpark.judge.engine`** keeps its values and its machine scope.
  - **`auto`** (default): the best ready engine from section 4, per timing
    class, plus the deterministic checks. The chat model is used only as
    section 4.3's background fallback, after D77's consent.
  - **`same`:** the chat model only, as today's phase 1, for users who want
    it; it never serves the inline class.
  - **`separate`** and **`both`** (from `m98/p2-r4`): a configured separate
    engine, or both combined, as D77 defines them.
  - **`off`:** nothing runs: no request, no file, no log line, no bundle
    load. Golden requests and MSP frames are byte-identical.
- **Per-decision switches.** One machine-scoped setting,
  `museSpark.judge.fastPathOff` (an array of decision ids), edited from the
  Judge section.
- **Reused from `m98/p2-r4` at `f131ffc88`** (accepted code, not
  redesigned): the contract and Jev wire (`schema.ts`, `engine.ts`); 2j's
  local source with per-connection peer verification and consented pulls
  (`src/core/judge/local/**`), whose production gap `install` closes in
  M125's lanes H and W (the Set Up Local Judge wizard, section 8.2); 2c's SystemOne adapter (`src/core/judge/systemone/**`) with
  D78 claims; 2e's BYO logprob runner once its capability capture exists;
  2i embeddings; the 2f use definitions (`skill.fit`,
  `context.relevance`, `risk.destructive`), the usage rows and the Judge
  section.
- **Changed, not redesigned, with M98's owner:** 2j's source gains lane
  J's proof-once, revalidate-per-connection disk proof (section 4.1) and
  the preload of section 8.2, keeping every provenance check; 2b gains lane
  L's `systemone` technique and binary families (section 7.0), keeping its
  binary labels, splits and identity gate.
- **Retired from the default path:** the hidden Muse Code session per batch
  for any I or S decision, and one-question-per-call judging.

## 13. Local probe, 2026-10-09 (free, first version of this lane)

- **Hardware.** The Kubuntu rig: a VMware VM, Intel Xeon Silver 4210 at
  2.20 GHz, 10 vCPUs, 62 GB, no GPU. Ollama 0.35.1 in user space, loopback
  only. The rig was shared with other lanes: load average 2.8 at the start,
  15.9 during the 4B run.
- **Method.** 24 synthetic items written for this lane, labelled by hand,
  no repository content: 8 effort `choice`s (minimal, standard, high), 8
  output-triage nouls, 4 loop nouls and 4 relevance nouls. One request per
  item to `/v1/systemone`, warm after one load call. Script:
  `fastpath-probe.mjs`, run from the lane's temporary folder; not committed.
- **Results.**

  | Model       | Effort | Triage | Loop | Relevance | Warm latency p50 (per family)                                            | Load   |
  | ----------- | -----: | -----: | ---: | --------: | ------------------------------------------------------------------------ | ------ |
  | `tev1:4b`   |    6/8 |    5/8 |  4/4 |       4/4 | 16.8–22.5 s for ~130–215-token states; 60–78 s for 1,045–1,341 tokens    | 44.9 s |
  | `tev1:0.8b` |    7/8 |    7/8 |  4/4 |       3/4 | 2.4–10.3 s for ~130–215-token states; 16.6–26.0 s for the 3 long outputs | 28.4 s |

  The 0.8b run followed the 4B run, at load average about 13.

- **What it shows.**
  - On a loaded CPU, a 4B decision model is 5–7 times slower than on the
    same CPU when quiet (3.1 s, 2026-10-04), and prompt length dominates.
    The resolver must use measured latency, and the packer must keep states
    short.
  - The triage misses were both long, passing outputs judged "needed"
    (p = 0.56 and 0.57) and one short failing output judged "not needed"
    (0.39). The deterministic parser gets all three right; it runs first
    for triage, and the engine only on outputs it does not recognise.
  - Effort: 6 of 8; one trivial request was rated "high" (p 0.43).
  - `tev1:0.8b` scored 21 of 24 here, against 0.75 on the 2026-10-04
    destructive set, where all ten of its misses rated a destructive command
    safe. It may serve speed decisions after M75 measurement; it is never
    the engine for 7.1 or a variant B veto.
  - 24 items are a smoke check, not a calibration result. None of the
    accuracy checks in section 7 has been probed yet.

## 14. Open risks

- **CPU contention.** A local model shares the user's CPU with the build and
  the editor. A busy machine pushes it out of S into P only; the resolver
  handles it, but the win shrinks.
- **The install is large.** 4.5 GB plus Ollama is a real ask. The wizard
  states it before anything moves, and users who decline get deterministic
  checks and, at most, the slow fallback. The wizard's completion and
  abandonment per step are counted on this machine only (no content).
- **The scan's estimate can be wrong.** Without a model already present,
  the micro-benchmark maps a throughput probe to a hardware class. The
  ten-question smoke after install measures the real verified-path
  latency, and the Done step shows the measured numbers, not the estimate.
- **The verified path is slow today.** 2j's complete call took 6.5–18.4 s
  warm on the three rigs, mostly its disk proof (section 4.1). Until lane J
  brings it within the budgets without weakening provenance, a local
  engine serves P only, and the wizard says so. If lane J cannot, the
  local judge stays a P engine and the hosted engines carry S.
- **The model unloads.** Keep-alive expiry or a restarted Ollama empties
  `/api/ps`; recovery needs the consented preload (4.2 step 6), which
  costs memory while the editor is open and 15–50 s per cold load.
- **GPU detection varies by platform and driver.** Lane H's fixtures cover
  each hardware class (no GPU, NVIDIA, AMD on ROCm, Apple silicon, an old
  driver); an unknown GPU is treated as CPU only, with that reason shown.
- **Accuracy bars are unmeasured.** Section 7's bars are targets. A check
  that cannot reach its precision stays log-only, and the design says so in
  the Judge section rather than shipping noise.
- **Hints can mislead.** A wrong hint costs a round. Precision bars, labels
  apart from weak signals, and the harm metric bound it.
- **Calibration does not travel.** Thresholds are per engine and family;
  switching engines (GPU to Jev) changes them. A fitted profile (lane L,
  section 7.0) is required before any threshold is used, so every
  model-backed family starts off on every engine until its profile lands.
- **Muse Code reach.** Mid-turn hints, native tool output and native
  approvals need Meta (section 10).
- **Effort and the cache.** Whether a changed effort affects Meta's prefix
  cache is unknown; receipts record cached tokens per turn.
- **Variant B.** A wrong skip runs a command without review. The floor,
  B1's verified executable, fixed environment and positive grammar limit
  the damage; git, `rg`, Windows and Muse Code were dropped because the
  harness cannot fix what runs there; B2 was dropped because it runs
  repository code.
- **Measurement cost.** The M75 arms and the Clef probe make live or paid
  calls (D48). M125's live checks need the owner's go, with counts first.

## 15. Sources

- `docs/certification/m98-research.md` (probe tables, round 2, the
  `/v1/systemone` ecosystem and its sources).
- PLAN.md D49 (SoL-Pi, M73, the backends' reach), D50, D77, D78, D90.27's
  judge amendment (the scan, table, licence step and Advanced choices),
  M73, M75, M78, M90, M98, and M110's lane TJ (whose module M125 lane H now
  builds).
- The first version's review: `RVJUDGEFAST` (findings on B1's grammar, B2,
  the ship rule, Muse Code effort, the cascade, `ide` triage, requalifying
  engines and the saved-time unit), addressed in sections 4.2, 6.2, 6.6,
  9, 10 and 11.
- The second review: `RVJUDGEFAST2` (B1's executable and configuration;
  Muse Code effort recovery; verified-path timings; class tables against
  their budgets; the model preload; calibration of SystemOne engines and
  new families; S and first-send triage), addressed in sections 4.1, 4.2,
  5, 6.2, 6.6, 7.0, 8.2, 8.5 and 9.
- `docs/certification/m98p2-j.md` at `f131ffc88` (2j's complete
  verified-path timings on Windows, Linux and macOS, and the keep-alive
  refusal).
- Code at `647f75dfb` and `m98/p2-r4` at `f131ffc88`, as cited in section 3.
- Ollama `/v1/systemone` and `confidence`: <https://docs.ollama.com/api/systemone>.
- TypeSafe SystemOne shapes: <https://docs.typesafe.ai/api>.
