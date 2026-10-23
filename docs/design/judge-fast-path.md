# Design: the Judge, our Jev for speed and accuracy (D107, M125)

Status: design, 2026-10-09, revised the same day after the owner's
correction (section 1) and again after the second review (`RVJUDGEFAST2`,
section 15); revised on 2026-10-10 after the third review
(`RVJUDGEFAST3`) and the owner's answer to Q-D107 (variant B, section 9),
again after the fourth review (`RVJUDGEFAST4`): B2 is now Linux-only; and
after the fifth (`RVJUDGEFAST5`): lane F splits into F1 (B1) and F2 (B2,
redesigned as default-deny); and after the sixth (`RVJUDGEFAST6`), F2
only: its init is isolated from the check, no host endpoint is bound, and
every lookup of a hidden file is evidence; and after the seventh
(`RVJUDGEFAST7`), F2 only: the bootstrap order, the descriptor hand-off,
evidence read while the run lives, and mirrored user files instead of
exempt misses.
Nothing here is built. PLAN.md D107 is the decision of record and M125 the
milestone; this file holds the reasoning, the catalogue and the numbers
behind them.

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
memory `typesafe-assist-only`, 2026-09-27). Section 9 records the owner's
answer to the one question this design left him (variant B, 2026-10-10):
the judge becomes one of two gates for skipping the slow reviewer, never
the only one.

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
  relaxation.** The disk proof stays; what changes is when it runs, and
  only where the operating system can guarantee that the proven bytes
  cannot change unseen between proofs. Metadata is never that guarantee:
  2j rehashes on purpose because Windows may report cached metadata to an
  open reader (`local/model.ts`, `docs/certification/m98p2-j.md`), and a
  writer with attribute access can suppress the next LastWriteTime and
  ChangeTime updates (`FILE_BASIC_INFORMATION`, the third review). An
  earlier version of this design revalidated identity, size and change
  time; that is withdrawn. The shortcut needs a write-exclusion or
  write-notification mechanism, per platform:
  - **Windows: write exclusion by share mode.** A native helper (C#,
    beside `MuseSparkJob.cs`) opens every blob with read access and a
    share mode of `FILE_SHARE_READ` only (no write or delete sharing)
    **before** the full proof, and keeps those handles open. While they
    are held, the system refuses any other open for writing or deleting,
    and any rename, with a sharing violation; an open that fails because
    some process already holds the blob for writing means there is no
    exclusion, and that blob keeps the full proof before every dispatch.
    The full two-pass proof then hashes through the held handles. Per
    connection the shortcut checks that the helper is alive and still
    holds every handle, and that each path still names the held file
    (file id and volume serial, which a rename-and-replace changes).
  - **Linux: write notification by read lease.** A native helper (C,
    built beside `MuseSparkCreated.c`) takes a read lease
    (`fcntl(F_SETLEASE, F_RDLCK)`) on every blob before the full proof.
    The kernel grants a read lease only while no process has the file
    open for writing, and breaks it when one opens it for writing or
    truncates it: the opener is held until the lease holder releases (at
    most the system's lease-break time), and the helper, on the break
    signal, first marks the proof invalid and reports it, and only then
    releases. A shared writable mapping needs a writable open, so it
    breaks the lease too. A lease needs the blob to belong to the user, so
    a store owned by another account (a system Ollama) and a file system
    without leases keep the full proof before every dispatch. Per
    connection the shortcut checks that the helper is alive, every lease
    is held, and each path's device and inode equal the held descriptor's.
  - **macOS: no shortcut.** No mechanism available to an unprivileged
    process excludes or reliably reports writes by another process of the
    same user (`flock` binds only cooperating writers; the user can clear
    an immutable flag), so the full two-pass proof stays before every
    dispatch, and local engines on macOS stay P-only unless lane J finds,
    and drills, such a mechanism.

  Any identity change, a new runtime generation, a helper exit, a broken
  lease or a lost handle falls back to the full proof before the next
  dispatch, never after. Lane J is reviewed as a security change with
  M98's owner, keeps every 2j red drill, and adds, per platform with a
  shortcut: a blob rewritten in place at the same length with its
  timestamps suppressed (the third review's case; on Windows the writer's
  open fails while the handles are held, on Linux the lease breaks before
  the write); a writer present before the hold (the hold fails, the full
  proof stays); a writable mapping made before the hold; truncation; a
  rename-and-replace; the helper killed between proofs. It records the
  new complete-path timings per platform. The pinned Ollama's own opens of
  a held blob are captured on Windows first (free, local): if Ollama asks
  for write access, the hold would block it, and Windows keeps the full
  proof. Until a platform has those receipts, its local rows are P-only.

### 4.2 Resolution on this machine

The engine is chosen per timing class (section 5) and per machine, by
measured latency, not from the table above:

1. Collect the engines that are installed, consented and verified (2j for
   local, D78 consent for paid ones), in rank order. In a confidential
   workspace, only verified local engines remain.
2. Read each engine's rolling latency for this class's state size: the
   complete call (for a local engine, 2j's verified path including its peer
   check and disk proof), never raw inference. The window is the last
   `JUDGE_FAST_LATENCY_WINDOW` = 50 **attempts**, not answers, in memory
   per window and in global storage per machine, with no content. An
   attempt that ends in a deadline expiry, a timeout, a transport error or
   a `no-answer` outcome is recorded as a **miss**, with infinite latency;
   only a cancellation of our own (the turn ended, the user sent first,
   dispose) is left out. An engine with no samples gets one warm-up probe
   on synthetic text and is not used until it has a sample.
3. Keep the first engine that the class's eligibility rule (section 5)
   admits for its p95 over that window, misses included: three misses in
   50 attempts already put the p95 at infinity, so an engine that starts to
   hang or time out fails `eligible` by its third miss and is
   **suspended** for that class at once. The same function decides the
   wizard's recommendation and its Done screen. One that drifts over
   budget (a loaded CPU) is skipped in the same way. A suspended or skipped
   engine gets no real questions until it requalifies (step 5). An answer
   is never awaited past its deadline.
4. If none fits, the class runs its deterministic checks only, and the Judge
   section says why ("no engine answers within 300 ms here; local model
   3.4 s").
5. **Requalifying a skipped or suspended engine.** It gets no real
   questions, so its window cannot recover on its own, and the misses in it
   would keep its p95 infinite. A local engine gets one background probe
   on synthetic text (no workspace content, so it is allowed in a
   confidential workspace) at most every `JUDGE_FAST_REPROBE_MS` = 60 s,
   only while no turn is running, cancelled on dispose. It is re-admitted
   only after `JUDGE_FAST_REQUALIFY_PROBES` = 3 consecutive probes answer
   within the class's budget; its window then restarts from those probes,
   so the misses that suspended it no longer count. A probe that misses
   resets that count. A hosted engine is never probed in the background:
   its samples, misses included, expire after `JUDGE_FAST_SAMPLE_TTL_MS` =
   10 min, and its next use is one warm-up probe admitted under its D78
   consent and daily budget, like any call; a miss there suspends it
   again.
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
- with D77's existing consent notice, and on Muse Code through D77's fresh
  hidden session per batch, unchanged (`museCodeSameJudge.ts`: a new
  folder and session per batch, disposed after it). An earlier version of
  this design reused one judge session here; that is withdrawn (third
  review). P runs in the background after the reply, so the session's
  start-up does not delay the user, and keeping D77's isolation means no
  judged state or history carries from one batch to the next and the
  same-model adapter and its tests stay as they are.

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

**The approval veto is a window of its own.** The approval fast path's veto
(section 9) is not an I decision: the held action is waiting for the
reviewer anyway, and the owner set its window at up to
`JUDGE_FAST_VETO_WINDOW_MS` = 5,000 ms (Q-D107-VETO). `eligible` admits an
engine for it when its complete-call p95 is within that window.

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
(lane J; on Windows and Linux through its write-exclusion or lease
shortcut, never on macOS while the full proof runs before every dispatch).
† Its recorded range reaches past 2 s; B only where its measured p95 is at
most 2 s.

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
  calls; it has no round count of its own (the 50-round cap was removed on
  2026-10-17, NOLIMITS6: no provider documents one). Muse Code has nothing
  comparable. An oscillating agent (edit A→B, test fails, edit B→A) burns
  full 8–14 s rounds until a cap the person set or the user stops it.
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

| User                                         | Inline (I)                                  | Boundary (B)                          | Slack and post-turn (S, P)                                          |
| -------------------------------------------- | ------------------------------------------- | ------------------------------------- | ------------------------------------------------------------------- |
| Default, before setup                        | Deterministic checks                        | Deterministic checks                  | Deterministic checks; the chat model in P only if the user opted in |
| Default, after the wizard installs it (CPU)  | Deterministic checks                        | Deterministic checks (over 2 s)       | `tev1:4b`, batched                                                  |
| A GPU with `tev1:4b`                         | Deterministic checks (0.36 s is over 0.3 s) | `tev1:4b`                             | `tev1:4b`                                                           |
| An OpenRouter key and consent                | Deterministic checks                        | Jev only where its p95 is at most 2 s | Jev                                                                 |
| Confidential workspace                       | Deterministic checks                        | Verified local only, as above         | Verified local only; never a hosted engine                          |
| Any local engine before lane J               | Deterministic checks                        | Deterministic checks                  | P only (6.5–18.4 s verified path)                                   |
| A local engine on macOS (no lane J shortcut) | Deterministic checks                        | Deterministic checks                  | P only (the full proof runs before every dispatch)                  |

## 9. The approval fast path (variant B, the owner's choice)

Today, in Auto, an action that rules do not allow outright is held for a
reviewer: M78's Auto reviewer on the Model API, and M90's reviewer on Muse
Code (`AUTO_REVIEWER_TIMEOUT_MS` = 60 s, `MUSE_CODE_REVIEW_TIMEOUT_MS` = 45
s). Each review is a big-model call. For a plainly safe command (`cat
src/a.ts`, `ls src`, `npm test`) that is the largest single wait an agent
step can have.

### 9.1 The owner's decision

**Q-D107 answered by the owner, 2026-10-10: B, with B1 and B2.** He was
told that this design recommended A plus a deterministic read-only allow
list (9.8), and that B2 runs repository code an agent may have edited;
after that explanation he chose the full fast path. A held Auto action may
skip the slow reviewer only when:

1. it passes the deterministic floor nothing overrides (forbid and ask
   rules, evaluators, redirection, `sudo`, installs, destructive git,
   outside or protected paths, secrets, network, paid, spawn);
2. it belongs to a built-in class: **B1**, read-only inspect commands, or
   **B2**, the workspace's own unchanged check scripts;
3. the judge does not veto within its window; no answer is a veto.

Every skip leaves an audit row; undo goes through the turn's checkpoint
(M72's, as M86 rebuilt it); there are kill switches; a class turns on by
default only after zero harm in 400 labelled actions for that class. The
judge is one of two gates, never the only one.

**Q-D107-VETO answered by the owner, 2026-10-10: the window is up to 5 s
for both B1 and B2.** The decision first said 300 ms. He was told that no
measured engine answers in 300 ms and that 5 s is still about ten times
faster than the reviewer's 45–60 s timeouts, and chose up to 5 s for both
classes over "B2 5 s, B1 300 ms" and "300 ms for both". The window is the
same for both classes: up to 5 s from the moment the action is held,
whenever B2's contained run ends. A B2 run that finishes before the judge
answers waits for the answer within those 5 s; no answer by 5 s is a veto.
(An earlier record of this answer said B2's window ended at the earlier of
the run's end and 5 s; that wording was a relay error, corrected by the
lead the same day.)

Lane F builds this; it is planned work, no longer conditional. By the
lead's ruling of 2026-10-10 (after the fifth review) it is two lanes:
**F1** builds B1 (9.4) and ships when its own review is clean; **F2**
builds B2 (9.5) as a default-deny redesign and never blocks F1. The owner's
B stands for both. The rest of this section is how they are built so that
the three conditions mean what they say: the floor and the classes are
enforced by the operating system while the command runs, not only by
reading its command line, and a class is off on any platform that cannot
give it that enforcement (9.2).

### 9.2 Where B runs

| Class            | Linux                                                                                                                                                                                                      | macOS                                                                                  | Windows | Muse Code (any OS) | Extension running as root |
| ---------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------- | ------- | ------------------ | ------------------------- |
| B1 inspect       | Lane F1: Landlock (ABI 3 or later) through the confinement helper, after the self-test                                                                                                                     | Lane F1: Seatbelt through `/usr/bin/sandbox-exec`, after the capture and the self-test | Off     | Off                | Off                       |
| B2 check scripts | Lane F2: bubblewrap 0.11.0 or later, not setuid, with its own init as PID 1, a frozen snapshot under an overlay at the workspace's path, and a system-call allow-list, after the capture and the self-test | Off: nothing on macOS owns the lifetime of every descendant (9.5)                      | Off     | Off                | Off                       |

- **Muse Code.** The CLI runs an approved command itself, through its own
  shell, `PATH` and environment; the extension only answers the approval.
  It cannot confine what runs, so B does not exist on Muse Code. Its held
  approvals go to M90's reviewer exactly as today.
- **Windows.** B1's programs are not verified system executables there (in
  PowerShell `cat` and `ls` are aliases for cmdlets, Git for Windows'
  copies sit in a folder the user can write, System32's `find.exe` is a
  different program), and neither class has a confinement that an
  unprivileged process can apply without changing the user's files (9.5).
  Both are off; held actions go to the reviewer as today. A Remote-WSL or
  SSH workspace follows the rules of the system its extension host runs
  on.
- **Root.** Root can replace system files and leave any sandbox, so the
  ownership checks prove nothing. B is off.
- **A machine that fails a probe** (an older kernel, Landlock not enabled,
  user namespaces restricted, an older bubblewrap, a workspace on a file
  system that cannot be overlaid) runs the affected class
  nowhere, and the Judge section names the reason and what would enable
  it. The extension never changes a system setting, never installs
  bubblewrap, and never runs a class in place as a fallback.

### 9.3 Conditions both classes share

A held action skips the reviewer, and runs inside its class's confinement,
only when all of the following hold. Otherwise the reviewer runs exactly
as today.

1. **Mode.** Auto (Model API `onRequest`, M95 providers). Never in Manual,
   Plan, Restricted Mode, a headless run, or a conversation that started
   from untrusted content (D49).
2. **The deterministic floor, which nothing overrides.** These go to the
   reviewer or the card exactly as today:
   - any forbid or ask command rule (M78), anywhere in the line;
   - an evaluator (`eval`, `iex`, `-EncodedCommand`);
   - redirection, `tee`, any pipe, a subshell, or any other shell syntax;
   - `sudo`, a package install or remove, any `git` command (the owner's
     "destructive git"; neither class admits any git command, 9.4),
     anything with `--force`;
   - a path outside the workspace, a protected path (D24) or a private
     file (`shared/privateFiles.ts`) in the arguments, or a secret in them
     (`countSecretMatches`);
   - the network, a paid tool, a spawn (a sub-agent or a background job),
     or a non-read-only MCP tool;
   - a confidential workspace using a non-local judge engine.
3. **No process the agent's session started is alive.** Not only D25's
   background jobs: any process a command of this session started, the
   detached child of a foreground command that has finished included, as
   the harness's process registry sees them (`processTree.ts`, M107's
   resource tickets; on Linux, where M107's delegated cgroup holds the
   session's commands, its member list, which a process cannot leave by
   detaching). Outside such a cgroup the registry is not complete: a
   process that deliberately detaches (a new session, a double fork) is
   lost to it, as `processTree.ts` states. So neither class depends on this
   condition for its guarantee: B1's reads on Linux are confined to the
   files its walk opened (9.4), B2's run cannot reach any socket (9.5), and
   the residual is named in each.
4. **The class's confinement is available** on this machine and passed its
   self-test in this session (9.4, 9.5).
5. **The judge does not veto within its window**, `JUDGE_FAST_VETO_WINDOW_MS`
   = 5,000 ms from the moment the action is held (Q-D107-VETO), the same
   for both classes. For B2 the contained run starts at the hold too, and
   its end does not move the window: a run that finishes first waits for
   the judge's answer until 5 s; a run still going at 5 s goes on only if
   the non-veto has arrived. The judge answers 7.1's `risk.destructive` noul over the command (for B2
   also the script's text and the paths changed since the owner's
   baseline) with p(yes) under a calibrated threshold (a fitted profile,
   section 7.0), from an engine whose complete-call p95 on this machine,
   every attempt counted and a miss as infinite (section 4.2), is within
   the window. No answer, a late answer or an uncalibrated engine is a
   veto. 9.7 lists the engines that qualify.

**The reviewer still starts when it does today** (the lead's decision,
2026-10-10). A 5 s window must not make a veto slower than today's path,
so the harness does not wait for the judge before asking the reviewer:
when the action is held, the reviewer starts exactly as today, and the
judge's question (and, for B2, the contained run) start beside it. The
fast path wins only if the judge's non-veto arrives inside its window and
before the reviewer's verdict. The skip is decided when the fast path's
result is delivered (B1 after its output passes the secret check, B2 after
its delivery rules, 9.5), and the cancel is sent to the reviewer at that
moment; until then the reviewer keeps running, so a discarded B2 run falls
back to a reviewer that is already under way. If the reviewer's verdict
comes first, or the judge vetoes, or the window closes without an answer,
today's path decides with no added wait, and a B2 run in progress is
killed and discarded. **A skip saves wall time, not tokens:** the
reviewer's request has already been sent when the skip is decided, so the
tokens it has used by then are spent, and the cancel stops only what
remains. The ship rule counts both the time saved and those tokens
(section 11).

### 9.4 B1, inspect: what runs, and what it may read

**What runs** (the second review's fix, kept). Every part must hold:

- **One argv, no shell.** The line splits into words under a strict
  grammar: plain words and single-quoted words only, with no `$`,
  backquote, `~`, `;`, `&`, `|`, `<`, `>`, parentheses, newline or unquoted
  glob character. Otherwise not B1.
- **The program** is one of `ls`, `cat`, `head`, `tail`, `wc`,
  `du`, `grep`, `find`; `stat` is answered by the helper itself, never
  started (see below). Not git (its own repository is a protected path B1
  must not read, and its configuration and attributes run filter drivers,
  `textconv`, `core.fsmonitor` and pagers), not ripgrep (no system path on
  any platform, and its `--pre`, `--search-zip` and `--hostname-bin` run
  other programs), not `tree` or `which` (not system executables
  everywhere).
- **A verified executable, not a `PATH` lookup.** The harness takes the
  program's absolute path from a fixed per-platform table (`/bin` and
  `/usr/bin` on Linux; `/bin` and `/usr/bin`, which SIP protects, on
  macOS), resolves symbolic links, and requires a regular file that is
  owned by root and is not writable by its group, by others or by the
  current user, under directories that are each owned by root and not
  group- or other-writable. It checks this immediately before the run and
  then executes **that resolved path itself**, by `execve` with the argv
  and no shell, so what was checked is what runs. The `PATH` the agent or
  its shell sees plays no part.
- **A reported `stat`, not a started one.** The helper answers `stat` with
  no options itself, from the walked operands: it runs `statx` on the
  descriptor the walk verified (`AT_EMPTY_PATH`, never by resolving the
  path again), re-applies the device, file-type and link-count predicates,
  and prints the default report with numeric owners and UTC times. No
  program is verified or executed for `stat`, and no grant beyond the
  walked operands is needed, so the result cannot depend on which
  implementation a distribution ships. The failure the helper's own
  report replaces is not reproduced by the lane-sandbox table in
  `docs/certification/m125-f1a.md` (every started program refuses there
  for a sandbox-only reason); the per-program capture on a real machine
  is still open — see that record's "Real-machine capture: run by the
  lead".
- **A neutral environment, not the inherited one.** The child gets exactly
  `PATH=/usr/bin:/bin`, `LC_ALL=C`, `TZ=UTC0` (a rule, so no time-zone
  file is read) and `HOME` set to an empty private folder, and nothing
  else: no `LD_PRELOAD`, `LD_LIBRARY_PATH`, `DYLD_*`,
  `GREP_OPTIONS`, `POSIXLY_CORRECT` or any other variable. Standard input
  is `/dev/null`, there is no terminal (so no pager or editor), no
  descriptor but the three standard ones is inherited, the working
  directory is the workspace root, and the normal tool timeout applies.
- **Per-program option shapes**, per platform, because GNU and BSD options
  differ. For example: `ls` `-l -a -A -h -R -1 -t -r -S -d -F`; `cat` `-n`;
  `head`/`tail` `-n N` and `-c N` (no `-f`, `-F` or `--follow`); `wc` `-l
-w -c -m`; `stat` with no options; `du` `-s -h -k` and a depth limit in
  the platform's spelling; `grep` `-n -i -r -l -L -c -E -F -w -v -x -h -H`,
  `-e PATTERN`, `--include=GLOB` and `--exclude=GLOB` (not `-R`, which
  follows links, and not `-f`, `-d` or `-D`); `find` the tests `-name
-iname -path -ipath -type -mtime -mmin -size -empty -maxdepth -mindepth`,
  the operators `!`, `-a` and `-o`, and the action `-print` only (not `-L`,
  `-H` or `-follow`, and `-fprint*`, `-fls`, `-exec*`, `-ok*` and `-delete`
  fail by not being listed). Any option off the list, including an unknown
  one, means "not B1".

**Why operand checks were not enough (third review).** The previous
version checked that each operand, after resolving links, lay inside the
workspace and outside protected paths, and then let the program open it.
That binds a name, not the file the program reads: a background process
can replace `src` with a link to another project between the check and the
open, and the program follows it. `grep -r -e url .` names one ordinary
folder, yet reads `.git/config` and every other protected file below it.
And the claim that the admitted recursive forms never follow links was
wrong: GNU grep follows a symbolic link named on its command line. B1
therefore confines the read set at the moment of each open, in the kernel.

**The operands, opened without following links.** Lane F1's confinement
helper (`MuseSparkConfine`, native C built for Linux and macOS like
`muse-created`) opens the workspace root once and checks its identity
(device and inode) against the workspace's resolved root; links above the
root are accepted, as everywhere (D105). Each operand must be a plain
workspace-relative path with no `..` component, and is opened from that
root without following a link at any depth: on Linux by `openat2` with
`RESOLVE_BENEATH`, `RESOLVE_NO_SYMLINKS`, `RESOLVE_NO_MAGICLINKS` and
`RESOLVE_NO_XDEV`; on macOS by `openat` with `O_NOFOLLOW_ANY`. The opened
descriptor must be a directory, or a regular file with a link count of 1
(a hard link can name a file outside), on the root's device, and its
workspace-relative name must be neither protected (D24) nor private. Any
failure means "not B1".

**The allowed read set.** For a non-recursive form it is the operands
themselves. For `ls -R`, `grep -r`, `find` and `du`, the helper walks each
operand tree through the same no-follow descriptors, within
`JUDGE_FAST_B1_WALK_MAX_ENTRIES` = 20,000 entries and
`JUDGE_FAST_B1_WALK_MAX_MS` = 100 ms (over either, not B1). It excludes
every protected or private entry, every link, every regular file with more
than one link, every entry on another device (a mount), and every device,
FIFO or socket. What remains is the allowed set: a list of the regular
files the walk opened, and of the folders it walked.

**What B1 guarantees, and what it does not.** The privacy boundary is file
contents: B1's program reads the bytes of no file outside the allowed set
and the few public system files it needs to start, which are listed per
platform below and are part of the set. Names and metadata are a narrower
matter, per platform:

- **Linux** grants listing a folder only as a hierarchy (a Landlock rule on
  a folder covers everything below it, and no rule can take a protected
  descendant back out), and Landlock does not restrict `stat`. So `ls -R`,
  `find` and `du` over an operand tree list the names, sizes, times and
  modes of protected and private entries inside it, `.git` included,
  without reading their contents. That is outside B1's guarantee on Linux,
  and the design says so rather than claiming a pruned view it cannot
  build. The helper's own `stat` report stays narrower: it covers only
  walked operands that passed the device, file-type and link-count checks.
  The agent's own read and list tools run without a card in every
  mode today (`permissions.ts`).
- **macOS** denies both data and metadata reads on the protected and
  private patterns, so a listed folder shows such an entry's name and
  nothing under or about it.

**Linux: Landlock.** The helper sets `no_new_privs` and creates a Landlock
ruleset that handles every file-system right of the running ABI (at least
3, which adds truncation; on ABI 4 or later it also refuses TCP bind and
connect). It grants **read-file on each allowed regular file by itself**,
from the descriptor the walk opened, and never on a folder; read-directory
on the operand folders; and, for a started program, **read and execute
on exact files only**: the verified program, its dynamic loader and each
shared library it needs, which the helper resolves from the program's own
dependency list and opens by descriptor, plus read on `/etc/ld.so.cache`
(`stat` starts no program and takes none of these grants);
never a library folder and nothing else under `/etc`. A Landlock rule
cannot tell the loader's open from the program's, so these few files are
the only system files in B1's read set, and a swapped operand can reach
nothing beyond them (the third finding of the fifth review; drill B1-14).
They are public system files, the same on every machine with that
release. No user or group database is granted, so `ls -l`, the helper's
own `stat` report and `find` print numeric owners, and times print in UTC.
A seccomp filter
refuses every socket call, `io_uring`, the key-management calls,
`ptrace`, and every way of creating a process (B1's programs never start
one, so none can outlive the run); B1 runs fixed, verified system programs
with a positive option grammar, not repository code, so this filter only
narrows what those programs could be steered into. The helper closes every
descriptor but the three standard ones and calls `execve` on the verified
program, or answers `stat` itself without starting one. Landlock checks each open against the file the path actually
reaches: an ancestor or leaf swapped for a link after the rules were made
leads to a file with no rule, and the open fails with "Permission denied";
so does a link met during recursion. Because read-file is granted per file
and never through a folder, **a file that appears in a walked folder after
the walk, by creation, rename, a hard link or a mount, has no rule and
cannot be read**, whoever put it there. Writing, creating, removing,
truncating and running any other program are refused because no rule
grants them.

**macOS: Seatbelt.** The helper runs the verified program through
`/usr/bin/sandbox-exec` (a root-owned, SIP-protected system file, verified
like the programs) with a profile it writes for this run: deny by default;
execute only the verified program, and no `process-fork`; read data only
at the literal paths of the allowed files, and list only the walked
folders; read the system part (the dynamic loader and its shared cache,
captured on the Mac mini and committed as literal paths, which are B1's
only system files on macOS and part of its stated read set); deny data and
metadata reads of any path under the workspace that matches a protected or
private pattern; no network; service lookups limited to the captured
minimum (directory services for user names). Seatbelt checks the path an
open resolves to, so a swapped link resolves to a path with no allow and
is refused, and a new
path that appears after the walk has none either. Seatbelt's rules are
paths, not files, so an allowed path that is **replaced** after the walk
(its file removed and a hard link to another file put in its place) would
be read; see the residual below. Apple marks `sandbox-exec` deprecated but
ships it; if a release removes it, or the self-test fails, B1 is off on
that Mac.

**The residual: a process that is already running with the user's
rights.** Condition 3 refuses B1 while any process the session started is
alive, as far as the registry sees, but a process that deliberately
detached itself after an earlier reviewed command is lost to it, and the
user's own processes are not the session's. Such a process already holds
every right the user has: it can copy any bytes into an ordinary workspace
file at any time, before the walk as easily as after it, and B1 then reads
them as workspace content, exactly as the agent's own read tool would
without a card today. On macOS it can also replace an allowed path with a
hard link after the walk. No confinement of B1's program can tell such
bytes from the workspace's own, so B1's guarantee is about which paths and
(on Linux) which files its program opens, not about where their bytes came
from.

**The self-test.** Once per session, before the first B1 run, the helper
runs `cat` and `grep -r` over a canary tree it writes in the extension's
storage. The allowed file must be read; a file outside reached through a
link, a hard-linked outside file, a `.git/config` and a `.env` canary, and
(on Linux) a file hard-linked into a walked folder after the rules were
made, must not appear in the output; and the helper confirms, after
applying its filter or profile, that creating a process fails. Any failure
turns B1 off, with the reason.

**What the agent sees.** The program's output, as today, except that on
Linux owners show as numbers and times in UTC. An excluded entry
shows as the program's own "Permission denied" line, and the transcript
row counts the entries not read. An output with a secret match is withheld
and the action goes to the reviewer; B1 has no side effect, so nothing
else needs undoing.

**Red drills (lane F1),** each expected to go to the reviewer or to return
no byte of the forbidden file:

| Drill                       | Case                                                                                                                                                                                                                          | Expected                                                                                                                                                                                                                                                                                                 |
| --------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| B1-1 ancestor swap          | `cat src/a.ts`; `src` replaced by a link to another project's `src` before the helper opens it, and again after the rules are made                                                                                            | Before: refused by the no-follow open (reviewer). After: the open fails. No byte of the other project                                                                                                                                                                                                    |
| B1-2 leaf swap              | The same, with `src/a.ts` replaced by a link to an outside canary                                                                                                                                                             | As B1-1                                                                                                                                                                                                                                                                                                  |
| B1-3 protected descendants  | `grep -r -e url .` over `.git/config`, a nested `pkg/.git/config`, `.claude/settings.json`, `.env`, `config/.env.production`, `certs/dev.pem` and `AGENTS.md`, each holding the pattern                                       | None of their bytes; each counted as not read                                                                                                                                                                                                                                                            |
| B1-4 hard link              | `notes.txt` a hard link to an outside canary, as an operand and inside a recursive walk                                                                                                                                       | Operand: reviewer. Walk: not read                                                                                                                                                                                                                                                                        |
| B1-5 command-line link      | `grep -r x linkdir`, `linkdir` a link to outside                                                                                                                                                                              | Reviewer (GNU grep would follow it)                                                                                                                                                                                                                                                                      |
| B1-6 link in recursion      | `ls -R`, `find .` and `grep -r` over a tree with a link to outside and one to a protected folder                                                                                                                              | Not read                                                                                                                                                                                                                                                                                                 |
| B1-7 mount                  | A mount inside the workspace (where the rig allows one; otherwise a fake device id in unit tests)                                                                                                                             | Not read                                                                                                                                                                                                                                                                                                 |
| B1-8 live session process   | A background job, and a detached child of a finished foreground command that the registry tracks, alive                                                                                                                       | Reviewer                                                                                                                                                                                                                                                                                                 |
| B1-9 no confinement         | Landlock below ABI 3 or not enabled; `sandbox-exec` missing; a self-test canary read; process creation not refused                                                                                                            | B1 off, with the reason                                                                                                                                                                                                                                                                                  |
| B1-10 inherited descriptor  | A descriptor to an outside canary open in the parent                                                                                                                                                                          | Not inherited; not read                                                                                                                                                                                                                                                                                  |
| B1-11 secret in output      | A workspace file with a secret-shaped line                                                                                                                                                                                    | Output withheld; reviewer                                                                                                                                                                                                                                                                                |
| B1-12 post-walk insertion   | An untracked, detached helper waits for the rules, then hard-links an outside canary into a walked folder, renames a protected file into it, and replaces an allowed file with a hard link to a protected one; `grep -r` runs | Linux: none of their bytes. macOS: the new paths are refused; the replaced path is the named residual                                                                                                                                                                                                    |
| B1-13 names and metadata    | `find . -name '*.pem' -size +1 -print` and `ls -R .` over `.git` and `certs/dev.pem`                                                                                                                                          | No contents. Linux lists the names and sizes (outside the guarantee, as stated); macOS shows only `.git` and `certs/dev.pem` by name                                                                                                                                                                     |
| B1-14 swap to a system file | After the walk, `src/a.ts` is replaced by a link to `/etc/passwd`, to a file under a library folder the program does not use, to the program's own `libc`, and to `/etc/ld.so.cache`                                          | Linux: the first two are refused (no rule); the last two are the only system files that can be read, and they are in the stated read set. macOS: `/etc/passwd` and the unused library are refused; the loader and its shared cache, the captured system part, can be read and are in the stated read set |

The second review's drills stay: a workspace `bin/cat` first on `PATH`; a
`cat` reached through a link into a user-writable folder; a user-writable
copy in `/usr/local/bin`; `LD_PRELOAD`, `GREP_OPTIONS` and
`RIPGREP_CONFIG_PATH` set in the parent (absent in the child); every
writing `not_match` example (the `find` actions, `tail -f`); any `git` or
`rg` command; root; a Windows host; a Muse Code approval.

### 9.5 B2, check scripts: lane F2, a default-deny contained run (Linux only)

**Why a hash is not enough, and what is.** A check script runs repository
code: the tests, the sources they import, setup files, dependencies in
`node_modules`. The agent may have edited any of it. Pinning the script's
definition establishes only that the _command_ is the owner's own; it says
nothing about what the code does. B2's safety therefore comes from
containment, and its correctness from evidence that the containment did
not change the result.

**Default-deny, not a growing deny-list (the lead's ruling, 2026-10-10).**
Each review so far found one more route out of a run that was told what it
may not do: a pathname socket, then a socket pair and `io_uring`, then the
inherited kernel keyring. F2 is therefore built the other way round: the
run gets only the system calls, files and environment a check needs, from
a frozen copy of the workspace, under an init that owns every process and
that the check cannot reach, with no host endpoint bound, and its result
is delivered only with evidence that nothing was refused or hidden. B2 is
lane F2. Lane F1 (B1) does not wait for it.

**What qualifies.**

- `npm test`, `npm run <script>`, `pnpm <script>` or `pnpm run <script>`,
  with `<script>` one of `JUDGE_FAST_B2_SCRIPTS`: `test`, `test:unit`,
  `lint`, `typecheck`, `type-check`, `check`, `format:check`. No option.
  After `--`, only plain workspace-relative path operands (a test-file
  filter), never an option, which could name a setup file or update
  snapshots.
- **Not Yarn, and not a repository whose package manager runs its own code
  first.** Yarn's configuration loads code before it runs any script (the
  `plugins` bodies `.yarnrc.yml` names, the release `yarnPath` names,
  Plug'n'Play's `.pnp.cjs` loader), so a Yarn repository (a `yarn.lock`, a
  `.yarnrc` or a `.yarnrc.yml`) is not B2. Nor is a repository with a
  `.pnpmfile.cjs`.
- **Every effective configuration source holds only safe keys.** npm and
  pnpm read settings that start code before a script runs (`node-options`
  and pnpm's `nodeOptions`, `script-shell` and `scriptShell`, `shell`,
  `pnpmfile`, `shellEmulator`) from several places, YAML included (fifth
  review). Each source the run would read must contain only keys from
  `JUDGE_FAST_B2_CONFIG_KEYS`, keys that name no program, file or code
  (`engine-strict`, `save-exact`, `save-prefix`, `fund`, `audit`,
  `legacy-peer-deps`, `strict-peer-dependencies`, `auto-install-peers`,
  `package-lock`, and pnpm's `packages` list in `pnpm-workspace.yaml`):
  the workspace's `.npmrc`; `pnpm-workspace.yaml`; the `pnpm` field of
  `package.json`; the global `npmrc` in the bound `node` install and npm's
  built-in `npmrc`. A key outside the list in any of them means not B2;
  the repository is excluded rather than its named bodies pinned. The
  user's own configuration in the home folder is not read (the run has no
  home folder), and inherited `npm_config_*` variables are cleared.
- The package manager is resolved from the extension host's `PATH` with
  every folder inside the workspace removed. Changing the toolchain
  itself, outside the workspace, already takes a reviewed action.
- **The definition is the owner's.** Every part of the command's
  definition closure is byte-identical to the owner's baseline:
  - **the scripts reached**, found by a fail-closed walk: start from the
    script with its `pre` and `post` entries; split each script's text
    under a strict grammar (simple commands joined by `&&` or `||`; plain
    or quoted words; optional leading `NAME=value` assignments; anything
    else, a `;`, a pipe, a redirection, a `$` or a backquote, means not
    B2); a command that runs the package manager again (`npm run <x>`,
    `npm test`, `pnpm <x>`) adds script `<x>` of the same `package.json`
    with its `pre` and `post` entries, to a depth of 4 and with no cycle;
    a command that selects other packages (`--workspace`, `--workspaces`,
    `-w`, `--filter`, `-r`, `--recursive`, `--prefix`, `-C`, `--dir`) or
    runs any other package-manager subcommand means not B2;
  - in `package.json`, those `scripts` entries, the `packageManager`,
    `workspaces` and `pnpm` fields;
  - the configuration files above, and every workspace file a reached
    script names (`scripts/check.js`, `vitest.config.ts`).

  The closure makes the command, and everything that selects or
  bootstraps it, the owner's. What those named files import, the tests,
  the sources and `node_modules` stay mutable by design: they are what a
  check checks, and the containment bounds them.

- **The owner's baseline** is the version at the last HEAD that moved
  while no agent turn was running (the user's own commit, pull or
  checkout), read by the harness from git's object store with no filter,
  hook or text conversion; on first use, HEAD at the start of the first
  turn in which the closure has no uncommitted change. A HEAD that moves
  during a turn is attributed to the agent and never becomes the baseline.
  No git repository, or no baseline, means not B2.

**1. A frozen snapshot, never the live workspace.** Before the run, the
helper copies the workspace, without `.git` and without any FIFO, socket
or device, into a private folder in the extension's storage on the same
file system: by reflink (`FICLONE`) where the file system has it (Btrfs,
XFS, bcachefs), by plain copy elsewhere, within
`JUDGE_FAST_B2_SNAPSHOT_MAX_MS` = 3,000 ms and
`JUDGE_FAST_B2_SNAPSHOT_MAX_MIB` = 4,096 (past either, the run is
abandoned, the reviewer decides, and the workspace is recorded as too large
for F2 on that file system until its size changes). The folder is made
read-only and nothing else writes it. **The closure is validated against
the snapshot**, not the live workspace, so what runs is exactly what was
admitted: a save in the editor while the run is set up or running changes
the live workspace, never the run (fifth review: an overlay over the live
workspace is undefined when the workspace changes underneath it). The
snapshot is the overlay's lower layer; the overlay is mounted at the
workspace's own path, so paths in the output are the workspace's. On a
file system without reflink the copy costs time in proportion to the
tree, `node_modules` included, which is why F2 may only pay off there for
small workspaces; the ship rule decides per machine.

**2. A real init that owns every process, out of the check's reach.** The
system's bubblewrap, 0.11.0 or later (the release that added overlay
mounts; they are not available to a setuid install), verified like B1's
programs, starts lane F2's init (the confinement helper in its init mode)
as the first process of the run's own PID namespace, with `--as-pid-1`,
`--unshare-all` (its own user, PID, network, IPC, UTS and cgroup
namespaces), `--die-with-parent`, `--new-session`, `--clearenv`,
`--cap-add CAP_SYS_ADMIN` and `--cap-add CAP_SETPCAP`. Both capabilities
hold only inside the run's own user namespace; only trusted helper code
ever holds them, and only during the bootstrap below. The init never runs
repository code, and it is isolated from the check it supervises (sixth
review: as built in round 6, the check had the init's credentials and
could reach `/proc/1/mem` and `/proc/1/fd`).

**The descriptors at the start.** The harness passes the init exactly five
descriptors: standard input (`/dev/null`), standard output and error (the
two output pipes), the write end of the **evidence channel** (a pipe the
harness reads), and the read end of the **control channel** (a pipe the
harness writes, for Stop). The init closes anything else it finds.

**The bootstrap, in order** (seventh review: the earlier order dropped the
bounding set without the capability that permits it, and closed the
listener's hand-off channel before using it):

1. The init marks itself not dumpable (`PR_SET_DUMPABLE` 0), joins a
   fresh, empty session keyring (fifth review), and makes a connected
   `AF_UNIX` stream pair for the listener hand-off, both ends
   close-on-exec.
2. The init starts the child in a nested PID namespace and mount
   namespace (`clone` with `CLONE_NEWPID` and `CLONE_NEWNS`, which takes
   `CAP_SYS_ADMIN`). From here the init needs no capability: it drops its
   bounding set while it still holds `CAP_SETPCAP`, then clears its
   ambient, inheritable, permitted and effective sets, and confirms all
   five are empty.
3. The child, which is trusted helper code and holds both capabilities,
   first closes what it must never hold: the evidence channel, the control
   channel and the init's end of the hand-off pair. It keeps only its
   standard descriptors and its own end of the pair.
4. It mounts a fresh `/proc` for its namespace, so its `/proc` lists only
   its own processes, and masks `/proc/keys` and `/proc/key-users` there
   (`CAP_SYS_ADMIN`).
5. It drops its capabilities in the only order that works: the bounding
   set first, one capability at a time (`PR_CAPBSET_DROP`, which needs
   `CAP_SETPCAP` in its effective set, so this comes before anything else
   is cleared); then sets the no-root securebits, locked; then clears the
   ambient set; then sets its inheritable, permitted and effective sets
   empty (`capset`), which removes `CAP_SETPCAP` and `CAP_SYS_ADMIN` last.
   It then reads all five sets back from `/proc/self/status` and stops
   with an error, failing the run before any repository code exists in
   it, unless every one is empty.
6. It sets `no_new_privs` and installs the system-call allow-list below
   with a user-notification listener, which returns a new descriptor.
7. It sends that listener descriptor to the init over its end of the pair
   and waits for the init's one-byte acknowledgement. Between installing
   the filter and receiving the acknowledgement it makes no call that the
   filter reports to the listener (sending and reading on the pair are
   plain allowed calls), so nothing waits on a listener nobody holds yet.
8. On the acknowledgement it closes the listener and its end of the pair,
   closes every descriptor from 3 upward (`close_range`) as a final sweep,
   and confirms through `/proc/self/fd` that only 0, 1 and 2 remain.
9. It marks itself not dumpable and becomes the nested namespace's
   reaper: it starts the package manager as its child, with the
   allow-list inherited, reaps every process in its namespace, and exits
   with the package manager's exit status. The reaper holds nothing but
   the standard descriptors; even so, nothing it reports is trusted beyond
   what the check's own code could choose (a check decides its own exit
   status in any sandbox).

Meanwhile the init, on the listener's arrival, sends the acknowledgement,
closes its end of the pair, and closes its copies of standard output and
error, so the harness sees the end of the output when the check's last
process ends. From then on it holds standard input, the evidence channel,
the control channel and the listener, and nothing in the run holds any
capability. It answers every notification: a call outside the allow-list
is recorded and refused, and, since any refusal discards the run (5), the
run is then stopped; a path-taking call is recorded with its path and let
through (5, lookups).

**The drain.** When the reaper exits, or the control channel says Stop, or
the tool's timeout fires, the init kills every process left in the nested
namespace and its own, waits until none is left, writes the final status
(the check's exit status, the number of records it sent and "drained") to
the evidence channel, and exits.

**Output, evidence and control, all read while the run lives.** The
harness reads three pipes concurrently, each on a reader that does nothing
else, so no writer in the run ever waits on a reader that waits for the
end (sixth and seventh reviews):

- **Output.** Standard output and error into bounded buffers with the
  tool's own caps (`SHELL_OUTPUT_MAX_CHARS`, the middle dropped with a
  count past it, as today). Output is content, never evidence.
- **Evidence.** The init writes each record as it happens, as a numbered,
  length-prefixed frame (a refusal; a path lookup, each distinct path once
  per run), and the final status last. The harness reads it into a buffer
  bounded by `JUDGE_FAST_B2_EVIDENCE_MAX_MIB` = 64, with the init's own
  distinct-path table bounded by `JUDGE_FAST_B2_LOOKUPS_MAX` = 200,000.
  Hitting either cap is a verdict of its own, **evidence overflow**: the
  harness stops the run, the result is discarded, the reviewer decides as
  today, and the check is marked "not B2 in this workspace" until its
  definition changes. A gap in the frame numbers, a malformed frame, a
  final status whose count does not match, or no final status at all also
  discards the run.
- **Control.** The harness writes one byte for Stop. If the init has not
  reported "drained" within `JUDGE_FAST_B2_STOP_GRACE_MS` = 2,000 ms, the
  harness kills bubblewrap, whose death kills the init (`--die-with-parent`)
  and with it every process of the namespace; the run is discarded.

Reading is concurrent; trusting is not. The evidence is validated, the
writes compared and anything delivered only after bubblewrap itself has
exited, which happens only after the init has been reaped, which the
kernel completes only once every process of the namespace has ended. The
scratch area is removed only then too.

**What still relies on the kernel.** The isolation of PID and mount
namespaces, the capability rules of user namespaces (including that
`CAP_SYS_ADMIN` and `CAP_SETPCAP` held inside the run's user namespace give
nothing outside it), the access check that keeps a non-dumpable process's
`/proc` entries from a process without `CAP_SYS_PTRACE`, seccomp and its
notifications, and overlayfs. A flaw in one of them is outside what F2 can
bound. The isolation does not depend on the host's optional Yama setting;
the lookup record does, a little: the init reads each reported path from
the check's memory, which Yama's two strictest settings forbid even to an
ancestor, so on such a host the self-test fails and B2 is off there, with
the reason. A second user id for the check is not available: an
unprivileged user namespace maps only the user's own id (more ids need the
setuid `newuidmap` and `/etc/subuid` entries, which the extension does not
configure), so non-dumpability and the nested namespaces stand in for it.

**3. The system-call allow-list.** Everything a check may call is listed;
every other call is reported to the init and refused, and **any refused
call discards the run** (5). The list is derived from the calls Node 22
(libuv and V8), `/bin/sh`, npm, pnpm and the native tools common checks
start (esbuild's Go runtime) make, and is confirmed by a capture before F2
relies on it: `strace -f` over fixture checks (`npm test` with Vitest and
with Jest, `eslint .`, `tsc --noEmit`, `prettier --check .`, `pnpm test`)
on x86_64 and arm64 on a Linux rig (free, local). A call the capture finds
missing is added by name, with its reason in the certification record;
because a missing entry is refused and discards the run, an incomplete list
fails closed. The derived list has **188 calls on x86_64**; arm64 lacks 28
of their legacy forms (`open`, `stat`, `fork`, `poll` and the like), so 160
there:

```
files      read write readv writev pread64 pwrite64 preadv pwritev preadv2
           pwritev2 open openat openat2 creat close close_range lseek stat
           fstat lstat newfstatat statx statfs fstatfs access faccessat
           faccessat2 readlink readlinkat getdents64 mkdir mkdirat rmdir
           unlink unlinkat rename renameat renameat2 link linkat symlink
           symlinkat chmod fchmod fchmodat fchmodat2 chown fchown fchownat
           lchown utimensat truncate ftruncate fallocate fadvise64 fsync
           fdatasync flock fcntl dup dup2 dup3 pipe pipe2 ioctl* getcwd
           chdir fchdir umask copy_file_range sendfile splice memfd_create
           inotify_init1 inotify_add_watch inotify_rm_watch getxattr
           lgetxattr fgetxattr listxattr llistxattr flistxattr
memory     mmap munmap mprotect mremap madvise brk msync mincore membarrier
           pkey_alloc pkey_free pkey_mprotect
processes  clone* fork vfork execve execveat exit exit_group wait4 waitid
           kill tkill tgkill pidfd_open pidfd_send_signal getpid getppid
           gettid getpgid getpgrp setpgid getsid setsid getuid geteuid
           getgid getegid getresuid getresgid getgroups capget
           set_tid_address set_robust_list get_robust_list rseq futex
           sched_yield sched_getaffinity sched_setaffinity sched_getparam
           sched_getscheduler sched_get_priority_max sched_get_priority_min
           getpriority setpriority prctl* arch_prctl prlimit64 getrlimit
           setrlimit getrusage times sysinfo uname
signals    rt_sigaction rt_sigprocmask rt_sigreturn rt_sigsuspend
           rt_sigtimedwait sigaltstack alarm setitimer getitimer
time       clock_gettime clock_getres clock_nanosleep nanosleep
           gettimeofday time timerfd_create timerfd_settime timerfd_gettime
events     epoll_create epoll_create1 epoll_ctl epoll_wait epoll_pwait
           epoll_pwait2 poll ppoll select pselect6 eventfd eventfd2
pairs      socketpair* sendmsg recvmsg sendto* recvfrom shutdown
           getsockopt setsockopt getsockname getpeername
random     getrandom
```

\* Allowed only with checked arguments: `clone` without any namespace
flag; `socketpair` only as `AF_UNIX` with `SOCK_STREAM` (and the
close-on-exec and non-blocking flags); `sendto` only with no destination
address; `ioctl` only for `TCGETS`, `TIOCGWINSZ`, `FIONBIO`, `FIONREAD`,
`FIOCLEX`, `FIONCLEX` and `FICLONE`; `prctl` only for the few options the
capture shows (naming a thread, the parent-death signal, `no_new_privs`,
naming a memory area). `clone3` and the three `io_uring` calls answer
"not supported", which libc and libuv already handle by falling back, so
they are neither run nor counted as refusals.

Outside the list, among others: `socket` in every family, `connect`,
`bind`, `listen`, `accept`, `accept4`, `sendmmsg`, `recvmmsg`, `keyctl`,
`add_key`, `request_key`, `bpf`, `perf_event_open`, `ptrace`,
`process_vm_readv` and `process_vm_writev`, every mount call old and new,
`unshare`, `setns`, `chroot`, `pivot_root`, `userfaultfd`, the `fanotify`
calls, `name_to_handle_at`, `open_by_handle_at`, `mknod` and `mknodat`,
the extended-attribute setters, `personality`, `seccomp` and the Landlock
calls. With `socket` refused, the only sockets in the run are connected
stream pairs it made itself; a stream socket refuses a destination address
(`EISCONN`) on `sendmsg`, and the filter refuses one on `sendto`, so the
socket-pair-and-datagram route of the fifth review, and the `io_uring`
socket route, do not exist.

Three outcomes are therefore distinct, and the drills keep them apart: a
**recorded refusal** (a call outside the list, or a listed call whose
arguments fail their check, such as a datagram pair or an addressed
`sendto`), which discards the run; an **emulated "not supported"**
(`clone3`, `io_uring`), which is neither run nor recorded, because the
program falls back; and a **kernel refusal** of an allowed call (an
addressed `sendmsg` on a stream pair answered `EISCONN`), which the
filter does not see and which reaches nothing.

**Path lookups are reported, not refused.** The calls that take a path
(the `open`, `stat`, `access`, `readlink`, `exec`, `chdir` and directory
families) are on the list, but the filter reports each one to the init,
which records the path and lets the call proceed unchanged. After the run
the harness uses that record to find lookups of files the run could not
see (5). Each report costs a round trip to the init, and a module-heavy
check makes many of them; the ship rule measures that cost, and it may
keep F2 off for large projects.

**4. The rest of the sandbox.**

- **The file system holds only what the run needs.** Read-only: `/usr`
  (with the system's `/bin`, `/sbin` and `/lib*`, which on most systems
  are links into it); from `/etc` only the loader cache, `passwd`,
  `group`, `nsswitch.conf`, `hosts` and `localtime`, each a regular file
  bound by itself; the resolved install folders of `node` and the package
  manager, each bound by its own path. Fresh and empty: `/tmp`,
  `/var/tmp`, `/run` (and so `/var/run`), and the home folder, mounted at
  the home folder's own path so `HOME` keeps its value; in it only exact,
  read-only copies of the mirrored user files that hold no secret (5,
  lookups). New: `--proc` and
  bubblewrap's minimal `--dev` (null, zero, full, random, urandom, tty and
  new pseudo-terminals; none backed by a host process). The workspace,
  through the overlay on the snapshot. Nothing else exists inside the run:
  not the rest of `/var`, `/opt`, `/srv`, `/mnt`, `/media` or other users'
  homes; no `~/.ssh`, `~/.aws`, `~/.config`, `~/.npmrc` or
  `~/.gitconfig`. The workspace's own files, `.env` and other private
  files included, **are** readable: a check may need them.
- **No host endpoint is bound** (sixth review: a named pipe in a bound
  folder, read by a process outside, would carry what the run writes past
  every other boundary). A FIFO, socket or device file is an endpoint, so
  the run sees none that the host backs. The snapshot copies none. Every
  bound folder is checked before it is bound: one that is root-owned and
  not writable by the user at any level (`/usr` on a normal system, a
  system-wide `node`) is scanned for special files once per session, and
  no process without root can add one afterwards; one the user can write
  (a `node` from nvm, fnm or Volta) is scanned at every bind, and any
  special file in it, or in `/usr`, means not B2 on this machine, with the
  reason. The `/etc` files are bound one by one and must be regular files.
  A process with the user's own rights that deliberately creates an
  endpoint inside the run's private folders after these checks is the same
  residual as B1's (9.4): it already holds every right the run lacks and
  does not need the run to use them.
- **The environment the command would have had, minus secrets.** Cleared,
  then the variables in `JUDGE_FAST_B2_ENV_KEYS` copied from the
  environment the command would have run with (`NODE_ENV`, `CI`, `TZ`,
  `LANG`, `LC_ALL`, `LC_CTYPE`, `FORCE_COLOR`, `NO_COLOR`), so a check
  sees the same mode it would see in place (an earlier version forced
  `CI=1`, which changes how some test runners treat new snapshots); then
  `PATH` (the install folders and `/usr/bin`), `HOME` (its own path, now
  empty) and `TMPDIR` (the fresh `/tmp`), with no terminal. No token or
  other variable is inherited.
- **Bounds.** The shell tool's own timeout and output caps, as today
  (`SHELL_DEFAULT_TIMEOUT_MS`, `SHELL_MAX_TIMEOUT_MS`,
  `SHELL_OUTPUT_MAX_CHARS`); the upper folder within
  `JUDGE_FAST_B2_SCRATCH_MAX_MIB` = 2,048 (polled; past it the run is
  stopped and discarded); bubblewrap's start within
  `JUDGE_FAST_B2_SETUP_MAX_MS` = 2,000 ms. CPU and memory are bounded no
  more than a reviewer-approved run's are today.
- **Undo.** The step's checkpoint is taken as for any action (M72's turn
  checkpoint, as M86 rebuilt it). B2 adds nothing to undo: its writes
  never reach the workspace. It never runs in place relying on a
  checkpoint instead (M86 does not undo command writes), so where no
  overlay or snapshot is possible, B2 is off.

**5. Evidence, then delivery.** After the drain, the harness has four
records it trusts because the run could not write them: the init's record
of refused calls, its record of path lookups, the overlay's upper folder
over a frozen lower, and the check's exit status.

**The write evidence is the net difference from the snapshot, in full.**
Every path in the upper folder is compared with the snapshot without
following links: its type; its permission bits; for a regular file its
size, its bytes, and, when the bytes are equal, its modification time (a
touch, which incremental tools read); for a symbolic link its target; which
changed files are hard links of one another; and every new folder, empty
or not, and its mode. Whiteouts and opaque folders count as deletions.
Folder times are not compared, because creating and deleting a temporary
file in a folder changes only them; owners cannot change (the run maps a
single user id) and extended attributes cannot be set (their setters are
refused). Because the snapshot is private and frozen, this is the run's
exact lasting effect on the workspace (sixth review: a mode change with
equal bytes, as in a `chmod +x` the check then relied on, is a lasting
effect and now counts). It is not a history: a file the run creates, uses
and deletes leaves no effect (fifth review). That is the intended
criterion: a real run in place would leave the same workspace and reach
the same verdict, so such a file is not a write the agent could be misled
by; what B2 must not deliver is a result whose effect the agent would
expect to find and will not.

**The lookup evidence finds files the run could not see.** For every path
the run looked up outside what it can see (the snapshot, which leaves
`.git` out, the bound folders and its own fresh folders), the harness
checks afterwards, on the host and as the user, whether that path exists
there. A path that exists for the user but not in
the run (a file under the real home folder, `.git`, `/opt`) is a **hidden
lookup**: in place the check would have found it, so the contained verdict
may differ. **No lookup is exempt.** The previous version kept a list of
misses "known" not to change a verdict, such as npm's user `.npmrc` when
its keys were safe; the seventh review showed why that cannot be shown: a
test can read the file, or ask `npm config get`, and see the difference.
Equivalence is made instead of assumed, for the few user files the tools
read on every run (`JUDGE_FAST_B2_MIRRORED_FILES`, from the capture:
npm's `~/.npmrc` and pnpm's `~/.config/pnpm/rc`): when such a file holds no
secret (no credential key, such as `_auth`, `_authToken`, `_password` or a
registry-scoped one, and no `countSecretMatches` hit), the run's fresh home
gets an exact, read-only copy at the same path, so the run and an in-place
run read the same bytes and the lookup finds the file in both. When it
holds a secret it is not copied, its lookup counts like any other, and
every B2 run on that machine is discarded and the check marked: a user
whose `~/.npmrc` holds a registry token gets no B2, because the run cannot
be given that file without the token and is not equivalent without it.
Every other lookup of a file that exists for the user but not in the run
counts. The record is made by
the init from the kernel's notifications, outside the check's reach; a
check written to defeat it (by changing the path between the notification
and the call) can steer its own verdict, as hostile test code can always
do, but cannot use that to escape the containment, which does not depend
on this record.

The result goes to the agent as the command's result, passing or failing,
only when all of these hold:

- **no refused call**: the init's record is empty, so no refused system
  call can have changed the result. A test that catches a refused
  connection and fails quietly ("Expected true; received false") is
  discarded here, whatever its output says (fifth review);
- **no hidden lookup**: the run looked up no file that exists for the user
  but not in the run, so no hidden file can have changed the result. A
  test that catches the absence of an existing home file and fails
  quietly is discarded here, whatever its output says (sixth review);
- **the check agrees with an in-place run for this exact invocation**: a
  check, by its closure's digest and its exact argument list (a different
  test-file filter is a different invocation) in this workspace, becomes
  deliverable only after a contained run's verdict class (pass or fail)
  matched the verdict of the same invocation run in place after the
  reviewer allowed it. Until then its contained runs are shadow runs:
  started beside the reviewer, compared with the in-place result, never
  delivered. A disagreement seen at any later in-place run takes the
  check out of B2 until its definition changes. Agreement no longer
  carries the file question, which the lookup record answers per run; it
  covers what no record shows: the environment's other differences (the
  host name, an empty home folder and `/tmp`, the copied variables);
- **no net write** outside `JUDGE_FAST_B2_CACHE_PATHS`
  (`node_modules/.cache/`, `node_modules/.vite/`, `node_modules/.vitest/`,
  `*.tsbuildinfo`, `.eslintcache`, `coverage/`, `.nyc_output/`): a check
  that changes the workspace (a `lint` script running `eslint --fix`) is
  not a pure check;
- **no environment-failure marker** in the output
  (`JUDGE_FAST_B2_ENV_MARKERS`: name resolution, `command not found` or
  exit 127, "not a git repository", a permission, read-only or not-found
  error on a path outside the workspace), a third, heuristic signal;
- **no secret** in the output (`countSecretMatches`);
- a complete status (9.5, 2), the judge's non-veto within its window
  (9.3), and the bounds held or the run timed out (a timeout is delivered
  as today's timeout result when nothing else above failed).

Otherwise the run is discarded whole and the reviewer, which started when
the action was held (9.3), decides exactly as today. A refused call, a
hidden lookup, a write or a marker also marks that check, by its closure's
digest, "not B2 in this workspace" until its definition changes. A
discarded run adds no wait; it costs the CPU it used, which the ship rule
counts (section 11).

**macOS: off.** Seatbelt confines what a process may do, and every child
inherits its profile, but nothing on macOS owns the lifetime of every
descendant: there is no PID namespace, cgroup or job object for an
unprivileged process, so a child that starts a new session and is
reparented escapes enumeration and group kills (`processTree.ts` says so),
and there is no overlay over a frozen copy to measure the net effect.
Held check scripts go to the reviewer exactly as today.

**Windows: off.** No mechanism an unprivileged process can use gives these
properties without changing the user's files: an AppContainer reaches only
objects whose access lists grant it, loopback inside one needs an
administrator's exemption, there is no unprivileged overlay, and
copy-on-write copies exist only on ReFS (a Dev Drive); Windows Sandbox
needs Pro or Enterprise and virtualization and has none of the user's
toolchain. B2 on Windows or macOS would be a milestone of its own; it is
not planned.

**Risks that remain, each bounded or audited.**

- **A difference no record shows.** The lookup record catches a file the
  run could not see, and the refusal record a call it could not make.
  What neither shows is the environment's other differences: the host
  name, an empty home folder and `/tmp`, the copied variables. A check
  that agreed with its in-place run for this invocation, and whose code
  then changes to depend on one of those and hide it, can deliver a
  sandbox-caused verdict. This is a weaker correctness contract than
  per-run proof, accepted explicitly: it counts as harm in the labelled
  set, which must stay at zero for B2 to turn on. Hostile test code can
  steer its own verdict in any sandbox or none; F2's containment does not
  depend on any verdict.
- **The workspace's own secrets are readable inside the run.** Nothing can
  leave by a network, a socket, a key or a host endpoint, so the only way
  out is the check's output to the model, which is scanned; a secret the
  scanner does not recognise can reach the model, as under a
  reviewer-approved `npm test` today.
- **A process with the user's own rights outside the run.** It can reach
  into the run's private folders, plant an endpoint there after the
  checks, or simply act for itself; it already holds every right the run
  lacks. This is B1's residual too (9.4), and no unprivileged mechanism
  removes it.
- **The kernel.** Namespaces, user-namespace capabilities, the
  non-dumpable access check, seccomp and its notifications, and overlayfs
  (2). An escape needs a flaw in one of them or in bubblewrap, through a
  call the run may make; the refused calls (sockets, keys, `io_uring`,
  `bpf`, mounts, `ptrace`) are not reachable at all.
- **CPU, memory and time**, bounded as a reviewer-approved run's are, plus
  the snapshot's cost and the lookup notifications' cost, both counted by
  the ship rule.
- **Persistence and egress.** None from the run's own code: no write
  survives, no process survives the namespace, no key, socket or host
  endpoint is reachable, and the init's records are out of its reach.

**Red drills (lane F2, on Linux):**

| Drill                       | Case                                                                                                                                                                                                                                                                                                                                                                                      | Expected                                                                                                                                                                                                                                                                                                                          |
| --------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| B2-1 script body            | The agent edits `scripts/check.js`, which the `test` script names; `package.json` unchanged                                                                                                                                                                                                                                                                                               | Reviewer                                                                                                                                                                                                                                                                                                                          |
| B2-2 script line or hook    | The agent edits `scripts.test`, or adds `pretest`                                                                                                                                                                                                                                                                                                                                         | Reviewer                                                                                                                                                                                                                                                                                                                          |
| B2-3 manager config         | `.npmrc` with `node-options=--require ./x.js`, a `script-shell`, or any key outside the list                                                                                                                                                                                                                                                                                              | Reviewer                                                                                                                                                                                                                                                                                                                          |
| B2-4 agent commit           | The agent commits B2-1's change; HEAD moves during the turn                                                                                                                                                                                                                                                                                                                               | Reviewer (the baseline is unchanged)                                                                                                                                                                                                                                                                                              |
| B2-5 extra option           | `npm test -- --globalSetup=./x.js`, `npm test -- -u`                                                                                                                                                                                                                                                                                                                                      | Reviewer                                                                                                                                                                                                                                                                                                                          |
| B2-6 sockets, by outcome    | Recorded refusals: `socket()` for `AF_INET` and for `AF_UNIX`; an `AF_UNIX` `SOCK_DGRAM` pair; a `sendto` with a destination address that names live host datagram canaries in the host's `/tmp` and `$XDG_RUNTIME_DIR`, which are not bound, so the preflight scan does not see them and the run goes ahead. Emulated: `io_uring_setup`. Kernel: an addressed `sendmsg` on a stream pair | The refusals recorded and the run discarded (the filter refuses the addressed `sendto` on its argument alone, so no destination needs to exist in the run); `io_uring_setup` answers "not supported", is not recorded and the program goes on; `sendmsg` fails with `EISCONN`, is not recorded; every host canary records nothing |
| B2-7 home secrets           | The test reads canaries at `~/.ssh/id_ed25519`, `~/.aws/credentials` and `~/.npmrc` and a file under `/opt`, and `GITHUB_TOKEN` set in the parent                                                                                                                                                                                                                                         | None present; the lookups recorded as hidden; discarded                                                                                                                                                                                                                                                                           |
| B2-8 workspace write        | The test rewrites `src/a.ts` with different bytes of the same length and restores its modification time, with no other change                                                                                                                                                                                                                                                             | Workspace byte-identical; the net write found; discarded; reviewer                                                                                                                                                                                                                                                                |
| B2-9 write outside          | The test writes `~/x` and `/tmp/x`                                                                                                                                                                                                                                                                                                                                                        | Absent outside the run                                                                                                                                                                                                                                                                                                            |
| B2-10 secret out            | The test prints the workspace's `.env`                                                                                                                                                                                                                                                                                                                                                    | Output withheld; reviewer                                                                                                                                                                                                                                                                                                         |
| B2-11 lingering process     | A Node helper starts a detached child in a new session that starts a grandchild, records its PID and keeps writing a file in the overlay; the intermediate exits early; checked after the run and after Stop                                                                                                                                                                              | The grandchild started and is gone; evidence is read as it comes but nothing is trusted, compared or delivered before the drain; its late writes never reach the diff                                                                                                                                                             |
| B2-12 bounds                | Output over the cap; scratch writes over the cap; a run past its timeout                                                                                                                                                                                                                                                                                                                  | Stopped and discarded, or today's timeout result                                                                                                                                                                                                                                                                                  |
| B2-13 no containment        | bubblewrap missing or 0.9, user namespaces refused, the allow-list not applied, a self-test canary leaked                                                                                                                                                                                                                                                                                 | B2 off, with the reason; never run in place                                                                                                                                                                                                                                                                                       |
| B2-14 elsewhere             | A macOS or Windows host, a Muse Code approval, root                                                                                                                                                                                                                                                                                                                                       | Reviewer                                                                                                                                                                                                                                                                                                                          |
| B2-15 bootstrap code        | A Yarn repository whose `.yarnrc.yml` names an edited plugin; a `.pnpmfile.cjs`                                                                                                                                                                                                                                                                                                           | Reviewer (not B2)                                                                                                                                                                                                                                                                                                                 |
| B2-16 package selection     | The agent edits `package.json`'s `workspaces`; a script runs `npm run check --workspaces`                                                                                                                                                                                                                                                                                                 | Reviewer                                                                                                                                                                                                                                                                                                                          |
| B2-17 indirect script       | `check` runs `npm run lint`; the agent edits `scripts.lint`; and a script with a `;`, a pipe or a `$`                                                                                                                                                                                                                                                                                     | Reviewer                                                                                                                                                                                                                                                                                                                          |
| B2-18 kernel keyring        | The editor's session keyring holds a synthetic user key with possessor read and write; the test searches for it, reads it, updates it and revokes it, and reads `/proc/keys`                                                                                                                                                                                                              | Not found; the key unchanged afterwards; the refusals recorded; discarded                                                                                                                                                                                                                                                         |
| B2-19 configuration bodies  | `pnpm-workspace.yaml` with `nodeOptions: --require ./hooks/preload.cjs` (the agent edits only that file), or a `scriptShell`; the same in `package.json`'s `pnpm` field                                                                                                                                                                                                                   | Reviewer (not B2)                                                                                                                                                                                                                                                                                                                 |
| B2-20 save during the run   | The user saves a changed `package.json` and script body while the snapshot is taken and while the check runs                                                                                                                                                                                                                                                                              | The run executes the snapshot's validated definition; a save before the snapshot is validated against it                                                                                                                                                                                                                          |
| B2-21 caught refusal        | A test catches a refused connection and fails with only "Expected true; received false"; another, in a check that already agreed, catches "not found" on an existing home-file canary the same way                                                                                                                                                                                        | The first is discarded by its recorded refusal; the second by its hidden lookup                                                                                                                                                                                                                                                   |
| B2-22 transient file        | The test creates `generated.json` outside the cache paths, uses it, and deletes it; another keeps it                                                                                                                                                                                                                                                                                      | The first has no lasting effect and may be delivered; the second is a net write, discarded                                                                                                                                                                                                                                        |
| B2-23 supervisor            | The test opens `/proc/1/mem`, `/proc/1/fd/*` and `/proc/1/environ`, writes to descriptors 3 to 64 and to the init's PID from the outer namespace through `/proc`, and calls `ptrace`; then the same with the nested `/proc` removed in a fault build                                                                                                                                      | Nothing of the init's is visible; with the nested `/proc` removed, non-dumpability still refuses each open; the records and status arrive intact; a forged or missing status discards the run                                                                                                                                     |
| B2-24 host endpoint         | A live host-reader FIFO canary placed in a user-writable `node` install folder before the run                                                                                                                                                                                                                                                                                             | Not B2 on that machine, with the reason; the canary receives nothing                                                                                                                                                                                                                                                              |
| B2-25 lasting metadata      | Equal bytes with a new executable bit (`chmod +x` then run); a symbolic link retargeted; a new empty folder; a new hard link between two files; a touch                                                                                                                                                                                                                                   | Each found as a lasting effect; discarded                                                                                                                                                                                                                                                                                         |
| B2-26 output above a pipe   | A passing check that writes 128 KiB to standard output and to standard error, under the output cap                                                                                                                                                                                                                                                                                        | Finishes in its own time, delivered whole; no stall                                                                                                                                                                                                                                                                               |
| B2-27 another invocation    | A check that agreed for `npm test` runs as `npm test -- src/other.test.ts`                                                                                                                                                                                                                                                                                                                | A shadow run first; delivered only after that invocation agrees                                                                                                                                                                                                                                                                   |
| B2-28 evidence above a pipe | A module-heavy passing check whose lookup record is larger than a pipe holds; and one that looks up more distinct paths than `JUDGE_FAST_B2_LOOKUPS_MAX`                                                                                                                                                                                                                                  | The first finishes in its own time with every frame read and its final status matching its count; the second is stopped as evidence overflow, discarded and marked                                                                                                                                                                |
| B2-29 bootstrap order       | Fault builds that skip one step each: the bounding set not dropped, a capability left in any set, the hand-off pair closed before the listener is sent, a descriptor above 2 left open, the evidence or control channel left in the child                                                                                                                                                 | Each is caught by the bootstrap's own check before repository code runs, and the run fails; the production build passes every check                                                                                                                                                                                               |
| B2-30 mirrored user file    | The user's `~/.npmrc` holds only `engine-strict=true`, and a test reads it and runs `npm config get engine-strict`; then the same file with a registry token                                                                                                                                                                                                                              | The first is copied exactly, both runs see it, no hidden lookup, delivered; the second is not copied, its lookup counts, discarded and marked                                                                                                                                                                                     |
| B2-31 Stop                  | Stop during a run; and Stop with the init made unresponsive in a fault build                                                                                                                                                                                                                                                                                                              | The init drains and reports; in the fault build bubblewrap is killed after the grace period and the namespace ends; both discarded, nothing delivered, the scratch removed only after bubblewrap exits                                                                                                                            |

### 9.6 The safety envelope

- **Audit.** Every fast-path allow is a transcript row ("Allowed without
  review: inspect command", or "…: check script, contained") and a
  flight-recorder entry: class, program or script, resolved executable,
  confinement and its version, the closure's digest (B2), engine, p(yes),
  threshold and deadline, the entries not read (B1), and the writes found
  and discarded and the delivery decision with its reason (B2). No content
  goes in logs.
- **Undo.** B1 writes nothing (the kernel refuses every write). B2 writes
  nothing that survives. The turn's checkpoint covers the model's own file
  edits as today.
- **Kill switches.** Per class in the Judge section, per session from the
  row ("Review these again"), and machine-wide.
- **The design's invariants hold.** With lanes F1 and F2 off, a class off, or the
  judge not answering, nothing runs before the reviewer, and the reviewer
  fence's frames, tool outputs and model requests are byte-identical to
  today (goldens with F off and with the judge abstaining). Nothing already
  sent changes: a B1 or B2 result is a new tool output. The skip decision
  has the veto window (at most 5 s) as its deadline and today's reviewer
  path, started at the same moment as today, as its fallback, so a veto,
  a missing answer or a discarded B2 run adds no wait. In a confidential
  workspace the veto can come only from a deterministic check or a
  verified local engine; a hosted engine is never one of the two gates
  there.
- **Harm bound.** A class turns on by default only after M75 replays and
  an independent labelled set show zero floor bypasses and zero harm in at
  least `JUDGE_FAST_APPROVAL_MIN_LABELS` = 400 labelled actions for that
  class, counted on each platform where it runs, because the confinement
  differs. Until then it is available and off, and the Judge section says
  why. Harm includes a forbidden byte read (B1), anything surviving a run,
  a connection to a socket or a key outside the run, and a sandbox-induced
  verdict delivered (B2).

### 9.7 What B costs, what it buys, and which engines can veto

It costs lane F1's confinement helper for Linux and macOS (native, per
architecture); lane F2's init mode of that helper, its snapshot, its
system-call allow-list and the shadow runs that establish agreement; the
owner-baseline tracker, the per-platform captures and self-tests, the
drills above, a fitted `risk.destructive` profile for an engine that
answers within the 5 s window, the tokens of a reviewer request started
and then cancelled per skip (a skip saves wall time, not those tokens),
and 400 labelled actions per class and platform. It buys a
skipped review for a single read-only inspect command on Linux and macOS,
and for the workspace's own unchanged npm or pnpm check scripts on Linux
with bubblewrap 0.11.0 or later, on the Model API and M95 only. It skips
nothing on Windows, on Muse Code, for B2 on macOS, for Yarn, for git, for
`rg`, for any pipe, or on a machine with no engine that qualifies below.

**Which engines can veto (Q-D107-VETO's 5 s window).** An engine serves
the veto on a machine when its complete-call p95 there is within 5 s and
it has a fitted `risk.destructive` profile for its identity (section 7.0).
From the recorded numbers (section 4.1), and only where B exists (B1 on
Linux and macOS, B2 on Linux):

| Engine (recorded latency)                                   | Linux                                                                                                       | macOS                                                       |
| ----------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------- |
| GPU `tev1:4b` (raw p95 0.36 s)                              | Yes on latency once lane J's lease shortcut has its Linux receipts; not on today's 6.5–10.7 s verified path | No: the full disk proof runs before every dispatch (18.4 s) |
| Quiet-CPU `tev1:4b` (raw p95 3.8 s; three questions 2.0 s)  | Yes on latency after lane J, if its receipts stay within 5 s; a loaded CPU (17–22 s) is suspended           | No, as above                                                |
| Local logprob models of 3B and more (GPU raw p50 62–104 ms) | After lane J, and once calibrated to `tev1:4b`'s Brier (section 4.1)                                        | No, as above                                                |
| Jev 1.13 through OpenRouter (1.9–2.1 s per request)         | Yes on latency, with D78 consent and daily budget; never in a confidential workspace                        | The same                                                    |
| Together `Tev1-4B-experimental` (1.5 s, one sample)         | Yes on latency; its accuracy is one smoke item                                                              | The same                                                    |
| Other fast logprob models, 2e (2.2–3.4 s for 40 questions)  | Yes on latency, once 2e's capability capture exists; BYO key                                                | The same                                                    |
| Cloudflare Clef (not measured)                              | Only after a counted probe                                                                                  | The same                                                    |
| `tev1:0.8b`                                                 | Never (not for 7.1 or the veto)                                                                             | Never                                                       |
| The user's chat model (8.8 s for one question)              | No: over the window, and never blocks an action (section 4.3)                                               | No                                                          |

The common gate is the profile: none is fitted yet, so at M125's start B
skips nothing anywhere until lane V's 400 independent labels for
`risk.destructive` and lane L's fit land for an engine. The first engine
likely to qualify on both platforms is Jev through OpenRouter (hosted,
paid, consented; never in a confidential workspace); on Linux a local
`tev1:4b`, on a GPU or a quiet CPU, follows once lane J lands. On macOS,
where only B1 exists, only hosted engines qualify, so a confidential macOS
workspace never skips the reviewer. The resolver measures every engine on the machine itself;
these rows are where to expect a fit, not receipts. With the reviewer
running alongside (9.3), an engine that answers in 2–4 s still beats the
reviewer's big-model call (8–14 s on Muse Spark, 45–60 s timeouts); for B2,
a run that ends before the answer arrives waits for it until 5 s after the
hold, and with no answer by then it is discarded and the reviewer, already
running, decides with no added wait.

### 9.8 How B relates to the standing rule, and what was recommended

Under B the judge is not the only gate. The deterministic floor and class
must admit the action first, the operating system confines what runs, and
the judge can only take a skip away. But it is one of two gates for
skipping the reviewer, which narrows how the owner's rule had been read
(until now the judge only ever added caution); the owner made that choice
knowingly. Before his answer this design recommended A, plus a built-in
deterministic read-only allow set under M78 with no judge in the decision,
and kept B2 out because it runs repository code. He heard both and chose
B. The allow set is not planned separately; B1 is its stronger form.

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
  size, always the complete call (2j's verified path for local engines),
  every attempt counted and a miss as infinite (section 4.2); Brier and
  ECE per family after calibration (lane L's profiles).
- **Approval fast path (section 9), per class and platform:** reviewer
  calls avoided, step and turn wall time, the share of B2 runs discarded
  and the time they cost, entries not read (B1), and harm as section 9.6
  defines it.
- **Fake replays keep real boundaries.** A tool's output becomes available
  when the tool settles, and the next request is due at once unless the
  trace has a real window (section 5); no fake seeds an engine answer
  before its input exists.
- **Ship rule.** A decision is on by default on a backend only when its win
  (time, calls or tokens) is positive, its M75 floors hold, its harm or
  precision bar is met, **and** turn wall time does not regress: p50 and
  p95 per backend and model no worse than without it, counting deadline
  misses, fallbacks (for B2, discarded runs), preloads, any extra control
  round-trip and cache effects. A token win never excuses a slower turn.
- **Cache effects are measured as misses, not as cached totals.** The
  previous version required cached input tokens per request not to fall.
  That rejects the savings this design exists for: when triage or context
  selection keeps 8,000 tokens of noise out of a request, every later
  request of that arm carries 8,000 fewer cacheable tokens, so its cached
  total falls even with perfect reuse (third review). The gate is instead
  the arm's cache misses on material it already sent, by
  `cacheMissTokens`' definition (`promptCache.ts`: the smaller of the
  previous and current input, minus the cached tokens), per request, p50
  and p95: the judge-on arm's misses must be no more than the off arm's.
  That is the whole cache gate. Tokens a decision adds at the tail (a
  50-token loop or done hint after an unchanged prefix) are new input,
  not a cache regression; the round-4 version also required uncached
  input per request not to rise, which rejected exactly such a hint even
  when it saved two later model calls (fourth review). New tail tokens are
  counted instead in the paired per-turn totals (input, cached, output and
  billed cost per turn), which feed the decision's win and are shown as
  they are. Absolute cached tokens are reported, not gated. The end-to-end
  wall-time gate above is unchanged.
- **Until then** a decision is available but off by default, and the Judge
  section says "not yet measured on this backend".
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
  J's proof-once disk proof where the platform holds the proven bytes
  unchanged (Windows: write-excluding handles; Linux: read leases; macOS:
  none, the full proof stays before every dispatch; section 4.1) and the
  preload of section 8.2, keeping every provenance check; 2b gains lane
  L's `systemone` technique and binary families (section 7.0), keeping its
  binary labels, splits and identity gate.
- **Retired from the default path:** the hidden Muse Code session per batch
  for any I or S decision, and one-question-per-call judging. The P-class
  chat-model fallback on Muse Code keeps D77's fresh session per batch
  unchanged (section 4.3); no reused judge session is introduced.
- **New with lanes F1 and F2 (section 9):** the approval fast path in the Model API
  host's reviewer fence (M78) and M95's loop, the confinement helper, the
  B2 runners and the owner-baseline tracker. Phase 1's caution latch and
  M90's reviewer on Muse Code are unchanged.

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
  engine serves P only, and the wizard says so. On macOS no shortcut is
  planned, so a local engine there stays P-only. Where lane J cannot, the
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
- **Variant B (chosen).** A wrong skip runs a command without review. For
  B1 the floor, the verified executable, the fixed environment, the
  positive grammar and the kernel's confinement of every open limit it to
  reading the contents of allowed workspace files (on Linux, the very
  files its walk opened) and the few public system files it needs to
  start; names and metadata inside its operand trees are outside that
  guarantee on Linux, and a process already running with the user's
  rights is the named residual (9.4). For B2 (lane F2) the owner's
  baseline limits it to the owner's own npm or pnpm check command, and a
  default-deny sandbox limits what that command can do: a frozen
  snapshot, an init that owns every process, a system-call allow-list (no
  socket, key, `io_uring` or mount call), no surviving write, no secrets
  outside the workspace; and its result is delivered only with no refused
  call and an established agreement with in-place runs. What remains is
  in section 9.5: an environment difference no record shows that a
  changed check depends on and hides, the workspace's own secrets in the
  output, a process with the user's own rights outside the run, the
  kernel, and a run's CPU. B2 exists on Linux only; neither class exists on
  Windows or Muse Code, or for git or `rg`. Both skip nothing until an
  engine within the 5 s veto window (Q-D107-VETO) has a fitted
  `risk.destructive` profile (9.7).
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
- The third review: `RVJUDGEFAST3` (B1's actual read set; lane J's
  Windows metadata shortcut; qualification without misses; the absolute
  cached-token gate; the reused Muse Code judge session), addressed in
  sections 9.4, 4.1, 4.2, 11 and 4.3.
- The fourth review: `RVJUDGEFAST4` (Linux B2's pathname Unix sockets;
  macOS B2's process lifetime; agent-started writers beyond D25's jobs;
  macOS write detection by metadata; Linux B1's directory metadata; the
  package-manager bootstrap and selection closure; the per-request
  uncached-input gate), addressed in sections 9.5 (findings 1, 2, 4 and
  6), 9.3 and 9.4 (3), 9.4 (5) and 11 (7).
- The fifth review: `RVJUDGEFAST5` (socket pairs and `io_uring`; the
  inherited session keyring; B1's system-read exceptions through a
  swapped operand; teardown before the result is read; pnpm's YAML
  bootstrap settings; the live workspace as the overlay's lower layer;
  sandbox-caused results the output does not show; the upper folder as a
  final state, not a history), and the lead's ruling to split lane F into
  F1 and F2 and redesign F2 as default-deny, addressed in sections 9.1,
  9.4 (finding 3) and 9.5 (findings 1, 2 and 4 to 8).
- The sixth review: `RVJUDGEFAST6` (F1 clean; in F2 the init within the
  check's reach, a named pipe in a bound folder, agreement that did not
  cover the code run, metadata effects, output pipes held until exit, and
  drills that contradicted the "not supported" answers), addressed in
  section 9.5 (parts 2 to 5, the risks and drills B2-6, B2-21 and B2-23
  to B2-27).
- The seventh review: `RVJUDGEFAST7` (F1 unchanged; in F2 the bounding
  set dropped without `CAP_SETPCAP`, the hand-off channel closed before
  use, the evidence channel read only after exit, a missing user `.npmrc`
  claimed equivalent, and a drill its own preflight would refuse),
  addressed in section 9.5 (part 2, the lookup paragraph of part 5, and
  drills B2-6 and B2-28 to B2-31).
- The owner's answer to Q-D107 (2026-10-10: B, with B1 and B2) and to
  Q-D107-VETO (2026-10-10: a veto window of up to 5 s for both classes),
  recorded in PLAN.md §3 and D107, and designed in section 9.
- Landlock: <https://docs.kernel.org/userspace-api/landlock.html> (ABI
  versions, `no_new_privs`, hierarchy-based rules, the unrestricted
  `stat`); `openat2(2)` (`RESOLVE_BENEATH`, `RESOLVE_NO_SYMLINKS`); `fcntl(2)`
  leases (`F_SETLEASE`, lease breaking on open for writing and truncation).
- bubblewrap 0.11.0, which added `--overlay`, `--tmp-overlay`,
  `--ro-overlay` and `--overlay-src`, not available to a setuid install:
  <https://github.com/containers/bubblewrap/releases> (2024-10-30).
- Windows `CreateFile` share modes (a held handle without write or delete
  sharing refuses later writers with a sharing violation) and
  `FILE_BASIC_INFORMATION` (a writer suppressing timestamp updates, as the
  third review cites).
- `docs/research/muse-node-2026-10-05.md` §1.5 (Landlock, seccomp) and
  PLAN.md's record that Muse Code's own Linux sandbox needs bubblewrap.
- `docs/certification/m98p2-j.md` at `f131ffc88` (2j's complete
  verified-path timings on Windows, Linux and macOS, and the keep-alive
  refusal).
- Code at `647f75dfb` and `m98/p2-r4` at `f131ffc88`, as cited in section 3.
- Ollama `/v1/systemone` and `confidence`: <https://docs.ollama.com/api/systemone>.
- TypeSafe SystemOne shapes: <https://docs.typesafe.ai/api>.
