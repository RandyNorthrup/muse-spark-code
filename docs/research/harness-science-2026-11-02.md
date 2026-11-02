# Harness science — what is actually measured to make coding agents better

Research lane RSCH-HARNESS. Read 2026-11-02. Base: `rv/int9` at `72d8d5003`
(`PLAN.md`, `src/`, `ROADMAP.md` in this worktree). Open lane branches listed
with `git for-each-ref refs/heads/lanes` were checked before anything was
called missing (2026-11-02: `cc-*`, `rlf-m104*`, `rlf-m109`; none changes a
verdict below). No paid call was made. No upstream issue was filed. Ideas only:
no code was copied into our tree; licences are noted in §6.

This report covers one topic only: the harness — the loop, tools, context,
verification and evaluation around a model. Sibling lanes cover providers,
competitors, security and performance; where a finding belongs to them it is
named and left there.

## How to read the evidence grades

Every claim below carries one grade. A measurement is never presented as
stronger than its method.

| Grade       | Meaning                                                               |
| ----------- | --------------------------------------------------------------------- |
| **Strong**  | Controlled experiment or ablation, named sample, replicates or is the |
|             | only controlled study and its method survives inspection.             |
| **Medium**  | Real measurement (lab eval, benchmark run, production count) with a   |
|             | stated method, but one lab, one model family, or no replication.      |
| **Weak**    | Vendor claim, leaderboard number, or post without method/sample.      |
| **Opinion** | Experienced judgement with no measurement behind it. Useful, never a  |
|             | reason by itself to change shipped behaviour.                         |

"I read in code" means this lane read the file in our tree at the base above.
"A page claims" means the source says it and this lane did not reproduce it.
"Inference" is this lane's conclusion from two or more stated facts.

## Executive summary

Five findings should change what we do next. Everything else in this report
supports, qualifies, or warns against them.

1. **Context length itself is the enemy, well before any window fills**
   (Strong). Chroma's 18-model study and Anthropic's context-engineering post
   agree: accuracy falls monotonically as input grows, even on trivial tasks.
   Our 1M-token window (`MODEL_API_CONTEXT_WINDOW`, `src/shared/constants.ts:3739`)
   is headroom, not a working set. The harness job is to keep the working set
   small, not to fill the window well.
2. **Cheap elision first, summarisation second; recoverability is mostly
   unused** (Strong, two independent studies). JetBrains (NeurIPS 2025 DL4C)
   and Fan et al. (2026, 176 matched settings) both find rule-based removal of
   old tool outputs matches or beats LLM summarisation at far lower cost, and
   that staging elision _before_ summarisation is the most efficient shape.
   Our observation packing is the right mechanism and already ships; our
   recoverable `recall_output` paging is the part the newest ablation says
   models rarely use. That is testable in our own harness for under 300 calls.
3. **Compaction silently drops constraints** (Medium–Strong, several 2026
   preprints, one direction). Summaries keep the goal and lose side rules —
   the exact failure our playbook and permissions exist to prevent. We already
   pin open todos as host data; the evidence says pin _all_ user-stated
   constraints verbatim, outside the summary, and prove it with eval tasks
   that carry side constraints. Our current 16 eval tasks carry none.
4. **Tool surface is a cost and an accuracy tax; deferred loading is now the
   measured default** (Strong). Every controlled study finds accuracy falling
   as the offered tool count grows; Anthropic's tool-search numbers (about
   −85% definition tokens, higher MCP accuracy) are the production version of
   the same finding. Our core tool set is disciplined; our MCP surface is the
   unbounded one, and it also threatens the cache-stable prefix we worked hard
   to keep.
5. **Our eval harness is methodologically ahead of most published practice and
   too small to steer by** (code read + Strong external method). Frozen arms,
   paired order rotation for cache warmth, held-out splits, verifier tokens
   that exit-0 alone cannot pass, exact spend accounting — this is what
   Anthropic's evals guide prescribes and few ship. But 16 single-file toy
   tasks, one run each, no repeats (no pass^k), no multi-file or long-horizon
   task, cannot detect the effects §1 reports (several are 2–6 points, inside
   infrastructure noise). The highest-value harness work available to us is
   not a new mechanism; it is a bigger, repeated, more realistic task set on
   the harness we already have.

What the evidence does **not** support: chasing SWE-bench Verified (retired by
its own sponsor for contamination and flawed tests), embedding-first code
retrieval as a default (grep + structural + LSP won; embeddings are an opt-in
fourth tool), LLM judges as sole graders (documented biases; execution first),
parallel writers sharing one tree without isolation (the one multi-agent
finding both camps now agree on), and letting a harness rewrite itself in the
product without an eval gate (promising preprints, no production replication).

---

## 1. What is new or what we had not read, with sources

Sources are listed in full in §6 (URL, date read, version). This section states
each finding, its grade, and what it would change. §2 then checks every finding
against our tree.

### 1.1 Context rot: length hurts before limits bite (Strong)

Chroma Research (Hong, Troynikov & Huber, July 2025) evaluated 18 frontier
models on controlled retrieval, replication and reasoning tasks at increasing
input lengths. Every model degraded as input grew — non-uniformly, sometimes
abruptly — even on deliberately simple tasks and far below its window limit.
Anthropic's context-engineering post (Sep 29, 2025) endorses the same shape
and gives the operating principle this lane recommends we adopt verbatim as a
design test: _find the smallest set of high-signal tokens that maximises the
probability of the desired outcome_. The post's three long-horizon techniques
are compaction, structured note-taking, and sub-agents returning condensed
(roughly 1,000–2,000 token) summaries to a coordinator. All three already exist
in our product in some form (§2); the new information is the _priority_: small
working sets beat clever use of large windows.

Consequence: a mechanism that keeps a 900k-token history "available" is not
neutral. It is measurably worse than the same facts in 30k focused tokens.
Any feature that grows the default prompt (rules files, repo maps, memory
snapshots, tool definitions) must pay for its tokens in measured task success,
not in plausibility.

### 1.2 Prompt caching: the stability rules are settled (Strong for the rules, Medium for exact prices)

The rules did not change in 2025–2026; the measurements of what breaking them
costs did. Caching is a byte-exact prefix match on every major provider:
static content first (tools, system prompt, large stable documents), dynamic
content last; any change invalidates everything after it. Cached reads cost
roughly a tenth of base input on Anthropic, OpenAI and Gemini; cache writes
carry a premium (Anthropic 1.25× at 5-minute TTL, 2× at 1-hour); minimum
prefixes are about 1,024 tokens; TTLs are short (5 minutes typical, longer
retention now offered at a price). Multiple 2026 practitioner measurements
call caching the single largest cost lever for agents — larger than model
choice. Tool-definition churn is a first-class cache breaker: the MCP
specification now asks servers to return `tools/list` in deterministic order
for exactly this reason.

Our implementation already follows the settled rules (§2): one stable key per
shared prefix, goal progress moved out of the cached prefix, session-fixed
date, `recall_output` declared for the whole packing session so the tool list
changes once. The open exposure is MCP: server tool lists that change mid-
session, or arrive in unstable order, rewrite the prefix and forfeit the
discount on every later request. We log cache misses; we do not yet attribute
them to the change that caused them (tool list, rules file, model switch).

### 1.3 Compaction: elision beats summarisation; summaries lose constraints (Strong + Medium)

This is the area with the most new measurement since our M101 design, and it
partly contradicts the design's emphasis. Two controlled studies, plus a
cluster of 2026 preprints:

- **JetBrains Research, "The Complexity Trap"** (arXiv:2508.21433, NeurIPS
  2025 DL4C workshop; SWE-agent on SWE-bench Verified, five model
  configurations, plus an OpenHands probe). Simple observation masking —
  replacing old tool outputs with placeholders while keeping reasoning and
  actions verbatim — halved cost against the raw agent while matching or
  slightly exceeding LLM summarisation's solve rate (reported +2.6 points at
  52% lower cost in one configuration). A hybrid (mask, then summarise only
  when still needed) cut a further 7–11%. Summarisation also lengthened
  trajectories 13–15% in their analysis: smoothing over failures hides the
  signal that the agent is stuck. Grade: Strong (controlled comparison, code
  and data released).
- **Fan et al., "An Empirical Study of Harness Design for Coding Agents"**
  (arXiv:2609.20804, Sep 2026; fixed loop, 176 matched settings, four models,
  SWE-bench Verified + Terminal-Bench 2.1, windows 32k–128k). Finding (1):
  context management's value rises as the budget tightens, mostly by
  preventing overflow failures. (2): staging rule-based elision _before_ LLM
  summarisation is the most efficient strategy; making elided content
  recoverable "adds machinery that models rarely use and yields no accuracy
  gain." (3): planning is an accuracy scaffold for weaker models and a cost
  saver for stronger ones. (4): predefined tools help models with weaker bash
  proficiency; bash-capable models do as well bash-only at substantially lower
  cost. Grade: Strong (the first component-level ablation at this scale;
  models are open/mid-tier, so magnitudes may not transfer to frontier models
  — directions likely do).
- **Constraint loss under compaction** (2026 preprints: COMPINT "Lost in
  Compaction", ConstraintRot/"Governance Decay", "Benchmarks Are Surprisingly
  Compaction-Friendly" arXiv:2610.31778, Slipstream arXiv:2605.08580). The
  shared result: summarisation preferentially drops side constraints (rules
  the user stated that are not the main goal). Reported magnitudes vary —
  about a third of task rules dropped in a first summary on ProgramBench;
  17% average retention of injected side constraints across compactors in
  COMPINT; policy violations rising from 0% to 30% after compaction in
  ConstraintRot's 1,323 episodes; up to 20 points lost by aggressive methods
  on some models and none on others. No method beat default
  self-summarisation on outcome benchmarks — which is itself the warning:
  outcome benchmarks barely notice constraint loss, so "compaction-friendly"
  scores hide the failure. Grade: Medium (preprints, magnitudes unsettled;
  direction consistent across independent groups).
- **When to compact** (Medium/Opinion). Fixed token thresholds fire mid-work;
  "Self-Compacting Language Model Agents" (June 2026, as reported) lets the
  model choose the moment and matches or beats threshold triggers. Our design
  already compacts only at settled tool boundaries and only when economics
  say so (§2), which is closer to the decision-based shape than a raw
  threshold. Anthropic productised compaction as an API primitive (default
  trigger reported at 150k input tokens, configurable, minimum 50k) —
  evidence the mechanism is now standard, not evidence for any one trigger.

Net: keep packing (it _is_ observation masking with recovery), test dropping
recovery, keep economic admission, and add verbatim constraint pinning plus
eval tasks that would catch its absence.

### 1.4 Tools: fewer, consolidated, token-budgeted, deferred at scale (Strong)

Anthropic's "Writing effective tools for agents — with agents" (Sep 11, 2025)
is the canonical statement: tools are contracts with non-deterministic
callers; consolidate rather than wrap every endpoint; namespace; return
meaningful, token-efficient context (pagination, filtering, truncation that
tells the agent how to narrow the next request; a concise/detailed response
format where verbosity varies — concise at roughly a third of detailed);
Claude Code caps tool responses at 25,000 tokens by default; their SWE-bench
team spent more time on tool descriptions than on the prompt. SWE-agent's
agent-computer interface work (NeurIPS 2024) remains the academic root;
AutoCodeRover's structured, AST-aware retrieval resolving comparable tasks at
roughly a sixth of SWE-agent's token cost is the standing reminder that tool
_shape_, not tool count, buys efficiency.

Tool _count_ is now measured from several sides, all in one direction:

- RAG-MCP (arXiv:2505.03275, May 2025): with the full catalog in the prompt,
  tool-selection accuracy collapsed to 13.6%; retrieval of a relevant subset
  held 43.1% — more than triple — on stress tests scaling to thousands of
  servers. Grade: Medium (stress-test setting; direction replicated below).
- OSWorld-MCP (arXiv:2510.24563): removing retrieval and dumping all 158 tools
  dropped accuracy 20.5 → 15.5 (Gemini-2.5-Pro ablation); the authors attribute
  much of the drop to long tool-description context — which is the same tax by
  another name (§1.1). Grade: Medium.
- LangChain's ReAct study (Feb 2025, as reported): more tools hurt every model
  tested; single-domain agents beat multi-domain by 50%+. Grade: Medium.
- Anthropic Advanced Tool Use (Nov 2025): a typical 5-server MCP setup spends
  ~55,000 tokens on tool definitions before any work; their systems reached
  134,000. Tool Search with `defer_loading` cuts definition tokens by over
  85% (a worked example: ~77k → ~8.7k) and _raised_ internal MCP eval accuracy
  (Opus 4: 49% → 74%; Opus 4.5: 79.5% → 88.1%, second figure as widely
  reported). Recommended from ~10 tools or ~10k definition tokens; Claude Code
  made deferred MCP loading the default in January 2026. Programmatic tool
  calling (the model writes code that orchestrates tools; intermediate results
  never enter context) is reported at −37% tokens on suitable tasks. Grade:
  Medium (one lab's production evals, method summarised not published in
  full; consistent with the independent studies above).

Fan et al. add the model-conditional twist (§1.3, finding 4): for bash-strong
models a bare shell matched predefined tools at much lower cost (one reported
cell: 65.8% → 69.4% at $2.33 → $1.11 per task); for bash-weak models predefined
tools were worth large margins (a reverse cell drops 68.6% → 45.4%). Tool
surface should therefore be a _model capability decision_, which is exactly
the shape our capability records already support — we just have not measured
it per model.

### 1.5 Edit formats: exact-match blocks won; failure modes are the design surface (Medium–Strong)

Aider remains the richest public dataset. Its formats — `whole` (entire file),
`diff` (SEARCH/REPLACE blocks), `diff-fenced`, `udiff` (unified diff without
line numbers), and editor variants for architect mode — are per-model tuned,
and its polyglot leaderboard (225 Exercism exercises, last updated Nov 2025)
publishes a "correct edit format" column beside pass rate, which is the right
way to separate format errors from reasoning errors. The most-cited industry
number is older but still instructive: on a refactoring ("laziness") benchmark,
GPT-4 Turbo went from 20% with SEARCH/REPLACE blocks to 61% with unified
diffs, mainly by suppressing lazy elisions (`// ... rest unchanged`). Later
benchmarks complicate any single-winner story: `whole` beats `diff` for some
locally served models with large windows; exact-match tools in the Claude
Code / Codex / Aider family differ mainly in their fallback cascades. A 2026
same-machine edit-apply benchmark (Weak–Medium: small, self-published, but
with fixtures) found the failure modes that matter for us: whole-file rewrites
silently revert concurrent changes; SEARCH/REPLACE edits the wrong occurrence
when text repeats; CRLF and tab/whitespace drift break exact matching across
tools. Aider deliberately _removed_ fuzzy edit-distance application.

Our `edit_file` requires the `find` text to match exactly once, supports
several non-overlapping replacements atomically in one call, and falls back to
byte-range editing past the whole-read size (§2). That is the measured-good
shape. The open questions are empirical, not architectural: what is our
per-model edit-format error rate (not currently reported as its own number),
and does a whitespace-tolerant second chance — reported to the model as such,
never silent — recover enough failed edits to pay for its risk? Both are
countable from existing traces plus one eval pair.

### 1.6 One agent or many: reads parallelise, writes stay single-threaded (Medium, converging)

The June 2025 juxtaposition is now resolved into a narrower consensus.
Cognition's "Don't Build Multi-Agents" (June 2025) argued parallel coding
agents fragment context and make conflicting decisions. Anthropic's
multi-agent research system (June 2025) reported +90.2% over single-agent Opus
4 on an internal _research_ eval with an Opus lead and Sonnet workers — at
about 15× chat tokens (single agents about 4×), with token spend explaining
about 80% of variance on BrowseComp. Cognition's follow-up, "Multi-Agents:
What's Actually Working" (Apr 22, 2026), holds the line narrowly: systems work
"when writes stay single-threaded and the additional agents contribute
intelligence rather than actions" — read-only explorers, consultants, and a
clean-context reviewer (Devin Review: an average of 2 bugs per PR by their
count, roughly 58% severe). A managed multi-Devin mode with a coordinator now
ships, which confirms the shape rather than retracting it. A reported October
2026 Anthropic enterprise note (fold most subagents back into a single loop;
one customer measured the single loop ~2× faster) could not be verified to a
primary source by this lane and is graded Weak — it is included only because
it points the same way as the verified sources.

What is _not_ in the literature: a controlled study showing parallel _writers_
in one tree beating one writer with parallel readers, at equal spend. Until
one exists, the evidence-based default is: parallelise reading, reviewing and
verification; serialise writing per tree; give parallel writers isolated trees
(worktrees) and a merge step with a reviewer — which is precisely our team
design, and precisely not our Model API subagent default (§2).

Cost honesty matters here. Multi-agent gains are bought with tokens: ~15× for
Anthropic's research system. Any claim that a team is "better" must state cost
per solved task beside it. Our estimator (M117) already models fleet cost;
our eval harness does not yet measure team-vs-single at equal budget.

### 1.7 Planning, verification loops, and test-first work (Medium)

Planning: Fan et al. (§1.3) find explicit planning helps weaker models'
accuracy and stronger models' cost, with little accuracy change for the
latter; trajectory analysis says planning changes _where trajectories stop_.
That matches Anthropic's lighter-touch guidance (structured note-taking,
todo-style state outside the model's head) better than heavyweight
plan-then-execute scaffolds. Our `todo_write` plus host-owned todo state is
the measured-good shape; a separate planner agent is not supported by the
ablation.

Verification: the reproduce → fix → re-run loop is the oldest measured win in
this field (SWE-agent lineage) and remains unchallenged in direction: ground
truth from execution beats model confidence. What is new is the _selection_
version of the same idea. Best-of-N with an execution verifier (run the tests
on each candidate, keep the first that passes) repeatedly beats longer
single-trajectory repair loops per dollar in small studies (one 2026 report:
best-of-8 at 93% vs agentic loop 90%, at roughly a third of the cost per task;
n=29, wide intervals — Weak–Medium). LLM-as-verifier selection without
execution recovers most but not all of the oracle gap (reported SWE-bench
Verified best-of-3: 76.1% single → 78.2% selected → 84.4% oracle; Terminal-
Bench V2 best-of-5: 83.1% → 86.5% → 92.1% oracle; lab reports, Medium).
Execution-grounded selection on HumanEval captured the full oracle ceiling in
one reproduced study while self-consistency left ~10 points on the table
(Medium). Direction: verify by running, select by running, use a model judge
only where nothing can be run — and say so.

OpenAI's "Harness engineering" post (Feb 11, 2026) is the production-scale
version of the same loop: a million lines in five months with zero hand-written
code (their claim, Medium — detailed, first-party, unaudited), where the
engineers' job became repository legibility (short `AGENTS.md` as a table of
contents into deeper docs), enforced architecture, and a review loop ("review
its own changes, request agent reviews, iterate until reviewers are
satisfied"). The transferable content is not the scale claim; it is that
_feedback loops and legibility_ were the lever, not prompt cleverness.

### 1.8 Judges and evaluators: useful, biased, never sole graders (Strong for bias existence)

"Don't Judge Code by Its Cover" (2025) shows code judges systematically
swayed by superficial variation across five languages. The wider literature
(ICLR 2025's 12-bias catalogue; IJCNLP-AACL 2025 position-bias study; 2026
test–retest work) documents position bias, verbosity bias, self-enhancement
bias, and prompt-attitude sensitivity (strict/lenient framings move scores).
Pointwise and pairwise protocols both exhibit them. Judges are worst exactly
where coding needs them most: detecting functional bugs without execution.

Anthropic's "Demystifying evals for AI agents" (Jan 9, 2026) gives the
constructive counterpart: grade outcomes in the environment (unit tests over
the state the agent left), expect creative solutions to break naive graders,
read transcripts, and treat evals as compounding infrastructure. Our eval
design already grades this way (§2). Our judge system (M98/M125, fast
per-turn decisions with calibrated labels) is more careful than most shipped
judges; the literature still says its verdicts must stay advisory where
execution can decide, and every fast decision needs the paired measurement
our judge arms were built for. Six decisions have arms; the binding live runs
for them remain the open item (§2).

### 1.9 Retrieval: grep won; structure and LSP are the upgrade, embeddings are opt-in (Medium–Strong)

The 2025–2026 consensus across vendors that _removed_ vector search (Claude
Code, Cursor's agent defaults debated publicly, Cline, Devin, Sourcegraph
Cody — embeddings replaced by search + code intelligence) and those that kept
it as one tool among several is unusually consistent: agentic lexical search
(ripgrep/BM25) plus structural search plus compiler-accurate navigation
(LSP/SCIP) is the default stack; semantic embeddings are a fourth, opt-in tool
for large, unfamiliar or inconsistently named corpora. Numbers: Augment
reports grep beating embeddings in their SWE-bench agent (vendor, Weak–Medium);
Cursor (Nov 2025) reports semantic search adding +12.5% average QA accuracy
(range 6.5–23.5% by model) _alongside_ grep, concluding hybrid (vendor eval,
Medium); Sourcegraph's CodeScaleBench reporting (370 tasks, 1,281 runs;
vendor, Medium) claims graph/code-intel tooling roughly doubling file recall
(0.127 → 0.277) at ~30% lower cost, with a thrashing example collapsing from
96 calls/84 minutes to 5 calls/4.4 minutes. Hybrid sparse+dense fusion wins in
general retrieval benchmarks (87% vs 71% vs 62% top-10 in one production
report), but code agents prefer the simplest tool that works (one log analysis:
7,993 keyword searches vs 2,449 semantic).

Our stack — `search` (ripgrep-class), `list_files`, LSP-backed code
intelligence, and an Aider-style repo map ranked by cross-file name use at a
1,024-token prompt budget — is already the winning shape (§2). The decision
the evidence _forbids_ spending on is an always-on embedding index as the
primary retriever. A semantic search tool as an explicit, person-enabled
extra is a different, defensible feature; it is not a harness-correctness fix.

### 1.10 Repository context files can hurt (Medium, surprising, directly actionable)

"Evaluating AGENTS.md" (Gloaguen et al., arXiv:2602.11988, 2026) tested
repository context files in two settings (SWE-bench tasks with LLM-generated
context files per vendor recommendations; a new 138-task set from repositories
with developer-committed files). Headline: context files did not generally
improve success rates — LLM-generated ones reduced performance slightly
(about −0.5 to −3% across settings) — while _increasing inference cost by over
20% on average_. Developer-written files fared no better in aggregate. A
companion empirical study (2,303 context files) finds real files are long,
functional-instruction heavy, and light on security/performance content.
OpenAI's harness post (§1.7) is the qualitative mirror: keep `AGENTS.md`
short, as a map into deeper documents, not an encyclopedia.

This does not say rules files are useless; it says _unmeasured bulk_ is a tax
with no proven return, and generated bulk is worse. Our loader allows 64 KiB
per file and 256 KiB total before truncating (§2) — roughly 64k tokens of
always-on context, deep into context-rot territory (§1.1) before the user has
typed anything. Our own repository's `AGENTS.md` is 722 lines / ~50 KB. The
product must not cap what a person chooses (D121), but it should _tell_ them
what their rules cost per request and let the eval harness measure whether a
given rules file earns its tokens. Today neither number is shown.

### 1.11 Cost per solved task and reasoning effort (Medium)

Per-token prices mislead; per-solved-task cost is the metric every serious
2026 comparison now reports (Artificial Analysis per-task figures; community
cost benchmarks; Terminal-Bench cost columns). Two harness-relevant results:

- **Effort is frequently wasted at defaults.** A 2026 seven-model measurement
  (small task set, Medium–Weak) found low effort passing everything high
  passed, at 1–10× lower cost; one model's default spent 6,389 reasoning
  tokens for the score its low setting got with zero. A 2026 prompt-waste
  study (PointFive, as reported) finds instruction phrasing alone multiplying
  reasoning tokens 2.4–7.4×, and harness choice multiplying cost per solved
  task 5–30× on the same prompt (Claude Code vs a lighter harness in their
  setup). Direction (Medium): effort and prompt bulk are budget decisions
  that must be measured per model; magnitudes vary wildly.
- **Harness swings dwarf model deltas.** Repeated same-model-different-harness
  comparisons (Terminal-Bench 2.0 cells differing by ~16 points between
  harnesses; scaffold studies reporting up to 40× token differences at similar
  pass rates) mean leaderboard gaps under a few points are not model facts.
  Grade: Medium (each cell is one lab's run; the pattern is consistent).

Our product already exposes per-role effort, prices requests from capability
cards, paces by provider headroom, and accounts every paid use (§2). What we
do not do is _recommend_ an effort from measurement, or report cost per solved
task in eval output as the headline (we report pass rate with cost beside it —
close, but the floors gate on pass rate alone).

### 1.12 Reliability: horizons double, consistency is the product (Strong for trend, Medium for levels)

METR's time-horizon work (Mar 2025; Time Horizon 1.1, Jan 2026, 228 tasks)
measures the human-time length of task an agent completes at 50% (and 80%)
success. The 50% horizon has doubled roughly every 7 months since 2019
(~196 days long-run; ~131 days since 2023; ~89 days since 2024 — acceleration
claimed, intervals wide). The 80% horizon — the one a person can delegate
without watching — sits about 5× shorter (e.g. ~59 vs ~15 minutes in one
sample; frontier ~17h at 50% vs ~3h at 80% in the 1.1 data, with METR itself
calling >16h measurements unreliable on the current suite). tau-bench's
pass^k makes the same point per task: GPT-4o-class agents at ~61% pass^1 fall
to ~25% pass^8. A model that "can do it" usually cannot do it _every_ time.

For harness design this reframes priorities: recovery, checkpointing,
idempotent retries with industry-standard bounds, and honest "stuck" signals
are worth more than another point of pass@1, because the gap between
sometimes and reliably is where long-running work lives. Our checkpoint/
restore-by-tool-writes, repeat guard (names loops, never silently caps —
D121), pacing, and playbook journal are aimed at exactly this gap (§2). Our
eval harness, running each task once per arm, cannot see it at all.

### 1.13 Benchmarks: Verified is retired; Pro, Terminal-Bench and private tasks are the successors (Strong)

OpenAI stopped reporting SWE-bench Verified and published why (Feb 23, 2026,
as reported by Epoch AI's review): frontier models reproduce gold patches
from memory under elicitation, and an audit of 27.6% of tasks found over half
of commonly unsolved items had tests rejecting functionally correct
submissions (Epoch: reasonable confidence >20% of items have scoring issues;
designation: Flawed). Independent work agrees: "The SWE-Bench Illusion"
(2025) shows up to 76% buggy-file identification from the issue text alone vs
53% off-benchmark; "Does SWE-Bench-Verified Test Agent Ability or Model
Memory?" (arXiv:2512.10218, Dec 2025) finds ~3× better performance on Verified
than on fresh SWE-rebench tasks and ~6× better file-finding without project
context. A third of Verified needs only 1–2 line changes.

Successors: SWE-bench Pro (Scale, Sep 2025; 1,865 problems, 41 repositories;
frontier ~23% vs >70% on Verified; a 2026 Pro V2 hardens grading — network
restricted to the model endpoint, patches re-graded in clean containers) and
Terminal-Bench 2.0 (Nov 2025; 89 tasks, ~3 reviewer-hours each, frontier below
65% then; later versions recalibrated, scores across versions not comparable).
Anthropic's infrastructure-noise study (Feb 2026) adds the metrology warning:
resource allocation alone swung Terminal-Bench 2.0 scores by 6 points
(p < 0.01; strict enforcement: 5.8% infrastructure errors, uncapped: 0.5%);
differences under 3 points without matched, documented configuration deserve
scepticism.

For us: never tune to Verified; treat any public-benchmark claim (ours or a
competitor's) as Weak without matched infrastructure; keep our private,
frozen, contamination-free-by-construction task set — and make it look more
like Pro (multi-file, multi-hundred-line, realistic) than like Verified's
one-line fixes. Our 16 tasks are currently one-line-fix shaped (§2).

### 1.14 Self-improving harnesses: real preprints, no production proof (Weak–Medium)

SIA (arXiv:2605.27276, 2026) couples harness rewriting (a meta-agent edits
prompts, tool dispatch, retry policy) with weight updates, reporting large
gains on LawBench and kernel tasks. Continual Harness (arXiv:2605.09998, 2026) does reset-free in-context harness refinement, evaluated on Pokémon
speedruns. A Tsinghua-reported system (Nov 2026 press coverage, Weak) claims
Terminal-Bench 2 gains (+4.5 points, −34% cost) from agents rewriting their
own scaffolding, including runtime hooks that nag about batching after 14
tool calls. Anthropic's tools post describes the tame, shipped version: use
an agent to optimise tool descriptions _against an eval_, offline.

The line the evidence supports today: automated harness search belongs in our
development loop, gated by the frozen eval harness (propose → paired run →
human-reviewed merge), never as silent self-modification in a person's
session. Our frozen-arm machinery is unusually well suited to exactly this —
an arm _is_ a harness variant with provenance. Nobody has published a
production coding product doing more, and the failure mode (a harness that
optimises against a flawed grader) is §1.13's lesson applied to ourselves.

### 1.15 Memory: notes and retrieval lose to files the agent can grep — with one exception (Medium/Opinion)

No 2025–2026 controlled study found by this lane shows a vector-memory layer
beating plain files + grep + an index the agent maintains, for coding work.
Anthropic's sanctioned pattern is structured note-taking in files (their
Pokémon example; Claude Code memory files). The measured exception is
_trajectory_ memory inside teams: Cognition's June 2025 advice to share full
agent traces, not summaries, between collaborators — because summaries are
where constraints die (§1.3). Our memory (Muse Code-compatible files, index
maintained by the host, §2) matches the sanctioned pattern. The improvement
the evidence suggests is not a new store; it is ensuring team handoffs carry
traces/decisions verbatim where they carry constraints, which our playbook
journal partially does (§2).

## 2. The comparison table, feature by feature, with file:line on our side

Verdicts: **ours is better**, **equal**, **worse**, **partial**, **missing**,
or **deliberately not** (decision named). "Evidence" grades follow §1. File
paths are relative to the worktree root; line numbers are at base `72d8d5003`.

| #   | Harness feature (evidence)                                       | Verdict                                            | Ours, with file:line                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| --- | ---------------------------------------------------------------- | -------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | Small high-signal working set (§1.1, Strong)                     | partial                                            | Mechanisms exist (packing, compaction, repo map budget) but defaults still allow a huge always-on prompt: rules up to 256 KiB (`src/shared/constants.ts:4537`), 1M-token window treated as usable (`src/shared/constants.ts:3739`). No per-request "what this context costs you" readout.                                                                                                                                                                                                                                                   |
| 2   | Cache-stable prefix (§1.2, Strong)                               | ours is better                                     | One stable key per shared prefix, digest of model+instructions+tools (`src/core/backends/modelapi/promptCache.ts:24`); miss detector (`src/core/backends/modelapi/promptCache.ts:33`); M101 lane A moved goal progress out of the prefix, fixed the date per session, declared `recall_output` once per packing session (PLAN.md M101). Miss _attribution_ (which change broke the prefix) is missing.                                                                                                                                      |
| 3   | Observation elision before summarisation (§1.3, Strong)          | equal, unproven order                              | Packing = masking with sticky placeholders over 8,000 chars after 2 whole sends (`src/shared/constants.ts:5725`, `:5726`; `src/core/backends/modelapi/observationPack.ts:29`). Auto-compaction is a separate, economically admitted path. Whether elision reliably fires _before_ any summarisation pressure in long sessions is not asserted in code as an ordering invariant; no eval arm tests elision-only vs elision+summary.                                                                                                          |
| 4   | Recoverable elided content (§1.3, Strong: rarely used)           | worse (carries cost, unmeasured benefit)           | Full recoverable paging ships: `recall_output` with offset + literal search (`src/core/backends/modelapi/observationPack.ts:29`), persisted packed ids across resume/fork (PLAN.md M101). Fan et al. find no accuracy gain and rare use. Our eval _forces_ recall (phase files instruct it, `src/core/eval/tasks.ts:138`), so our own data cannot estimate natural use.                                                                                                                                                                     |
| 5   | Economic compaction admission (§1.3, Medium)                     | ours is better                                     | `AutoCompact.decide` prices cache-write premium, cached reads, summary cost, carried debt and a todo-derived horizon; fires on cost, near-window (0.9) or overflow, with cooldown (`src/core/backends/modelapi/autoCompact.ts:84`, `:146`; `src/shared/constants.ts:3768`). Two binding live runs passed (274 attempts/$0.06285; 265/$0.059742; PLAN.md M101). No competitor documents an equivalent break-even model.                                                                                                                      |
| 6   | Constraint pinning across compaction (§1.3, Medium)              | partial                                            | Open todos are appended as host data, never model guesswork (PLAN.md M101 lane C1); Pi-style structured summary. Arbitrary user-stated side constraints ("never edit X", "keep API Y") have no verbatim pinned block outside the summary, and no eval task carries a side constraint.                                                                                                                                                                                                                                                       |
| 7   | Consolidated core tools, token-budgeted results (§1.4, Strong)   | equal                                              | 24 named core tools (`src/shared/constants.ts:4093`) plus conditional families (subagents or team, never both: `src/core/backends/modelapi/subagentTools.ts:205`); results bounded to a quarter-window share with spill files; strict schemas where the model card allows (eval arm, `src/core/eval/armDefinitions.ts:22`). No concise/detailed response-format knob on read/search tools.                                                                                                                                                  |
| 8   | Deferred tool loading at scale (§1.4, Strong)                    | missing                                            | No tool-search/defer mechanism found in the Model API backend or MCP pool (`src/core/backends/modelapi/mcp/` loads server tools into the request). MCP-heavy workspaces pay full definition tokens every request and risk prefix churn (§1.2). Core tools alone stay under Anthropic's ~10k-token trigger; MCP does not.                                                                                                                                                                                                                    |
| 9   | Programmatic tool calling (§1.4, Medium)                         | deliberately not (yet)                             | No code-orchestrates-tools mode. The shell tool gives bash-capable models a partial equivalent. Evidence is one lab's; security review belongs to RSCH-SECURITY. Listed here so the absence is a decision, not an oversight.                                                                                                                                                                                                                                                                                                                |
| 10  | Per-model tool surface / bash-only mode (§1.4, Strong direction) | missing                                            | Capability records gate features per model (PLAN.md D81.2/D86), but no record field selects reduced/bash-lean tool sets, and no eval arm measures it.                                                                                                                                                                                                                                                                                                                                                                                       |
| 11  | Parallel read-only tool calls (§1.4 practice)                    | equal                                              | Allowlisted parallel reads, max 4 in flight, preparation/settlement strictly in call order (`src/core/backends/modelapi/toolScheduler.ts:24`, `:29`; `src/shared/constants.ts:3786`). Writes and shell never parallelise — matches the safety consensus.                                                                                                                                                                                                                                                                                    |
| 12  | Exact-match edit format (§1.5, Medium–Strong)                    | equal                                              | `find` must match exactly once; multi-edit atomic; byte-range path for large files (`src/core/backends/modelapi/tools.ts:836`). No silent fuzzy fallback — correct per Aider's removal. Per-model edit-format error rate is not reported; CRLF/whitespace second-chance (announced, not silent) does not exist.                                                                                                                                                                                                                             |
| 13  | Parallel readers, single writer (§1.6, Medium)                   | partial                                            | Teams: isolated workspaces, merge queue, review before merge (`src/core/team/teamHost.ts:1` header; `src/core/team/teamTools.ts:46`). Model API subagents: same workspace, `worktree_isolation` explicitly unavailable (`src/core/backends/modelapi/subagentTools.ts:96`), spawn text advises "independent, bounded work" (`src/core/backends/modelapi/subagentTools.ts:64`) but nothing enforces read/write separation. Reviewer role is read-only — the Cognition-endorsed shape — but is one role among equals, not the default pattern. |
| 14  | Orchestrator rules enforced in code (§1.6/§1.7)                  | ours is better                                     | D200: anti-duplication/failure rules are harness code on the orchestrator role, never a playbook document (AGENTS.md product rules; `src/core/orchestration/playbook/policy.ts:1`; `src/core/team/` admission, ceilings, scheduler). No surveyed competitor documents code-enforced orchestration at this depth. Cost: complexity a person must trust without team-vs-single measurements (row 21).                                                                                                                                         |
| 15  | Lightweight planning / host-owned todos (§1.7, Medium)           | equal                                              | `todo_write` with host-tracked state feeding compaction horizon and summaries (`src/core/backends/modelapi/autoCompact.ts:127`). No heavyweight planner agent — correct per Fan et al. No no-plan eval arm, so the cost claim for strong models is untested here.                                                                                                                                                                                                                                                                           |
| 16  | Execution verification loop (§1.7, Strong direction)             | ours is better                                     | Diagnostics after edits, format-on-edit, configured check commands, versioned ledger that only judges runs on current file versions, fix loop stops checks after 3 failing rounds (`src/core/backends/modelapi/verifyLoop.ts:24`; `src/core/backends/modelapi/verifyLedger.ts:1`; `src/shared/constants.ts:7615`). The 3-round stop is a _checks_ stop with a stated reason, not a silent work cap; keep it person-visible (D121/D208 safety-limit clause).                                                                                 |
| 17  | Best-of-N with verifier selection (§1.7, Medium)                 | partial                                            | Best-of-N ships: N worktree conversations, one paid popup, side-by-side diff, person picks (`src/core/bestOfN/bestOfNRunner.ts:1`). Selection is human-only; no run-the-checks auto-selection, no "first passing wins, stop spending" mode, no verifier ranking. The measured win in the literature is precisely the automatic execution selection we lack.                                                                                                                                                                                 |
| 18  | Judges advisory, calibrated, paired-measured (§1.8, Strong)      | ours is better (design), partial (proof)           | Judge with techniques (logprob/top-1/stated), honest labels ("uncalibrated", "approximate (top-1)"), fast per-turn decisions each with an isolating eval arm (`src/core/judge/judge.ts:1`; `src/core/eval/mechanisms.ts:98`, `:162`). Binding live runs for the six judge arms are still open per PLAN.md; until they run, fast decisions are unproven by our own standard.                                                                                                                                                                 |
| 19  | Grep + structure + LSP retrieval (§1.9, Medium–Strong)           | equal                                              | `search`/`list_files` + LSP code-intel tools + repo map ranked by cross-file name use, 1,024-token prompt budget, partial-map honesty (`src/core/codeIntel/repoMap.ts:1`; `src/shared/constants.ts:3652`). No embedding index — deliberately not (evidence §1.9); an opt-in semantic tool remains a possible _feature_, not a fix.                                                                                                                                                                                                          |
| 20  | Rules-file budget honesty (§1.10, Medium)                        | worse                                              | Loader truncates at 64 KiB/file, 256 KiB total with a warning (`src/core/context/rules.ts:87`; `src/shared/constants.ts:4536`). No token-cost-per-request display, no guidance toward short map-style files, template is minimal (good) but nothing measures a workspace's rules file. Our own repo runs a ~50 KB `AGENTS.md` — we pay the tax we warn nobody about.                                                                                                                                                                        |
| 21  | Cost per solved task as headline (§1.11, Medium)                 | partial                                            | Eval reports attempts, requests, tokens, cached tokens and exact USD per task/split (`src/core/eval/report.ts:1`); product accounts every paid use (D78/D34). Floors gate pass rate only (`src/shared/constants.ts:10413`); no cost-per-solved-task verdict, no measured effort recommendation. Estimator forecasts fleet cost (M117, `src/core/estimator/simulate.ts:1`) but from plan assumptions, not solved-task history.                                                                                                               |
| 22  | Reasoning-effort tuning (§1.11, Medium)                          | partial                                            | Per-role/per-model effort from capability records, intensity shifts for teams (PLAN.md M106/M95). No low-vs-default eval pair; defaults are vendor/record values, never validated for waste on our tasks.                                                                                                                                                                                                                                                                                                                                   |
| 23  | Long-horizon reliability & recovery (§1.12, Strong trend)        | ours is better (mechanisms), missing (measurement) | Turn checkpoints with restore-by-tool-writes over an unbroken byte chain (`src/core/checkpoints/restoreChain.ts:1`); repeat guard names loops without capping work (`src/core/backends/modelapi/repeatGuard.ts:10`); provider-headroom pacing with foreground priority (`src/core/backends/modelapi/pacing.ts:1`); playbook journal/outcomes (`src/core/orchestration/playbook/`). No pass^k, no long-horizon task, no failure-injection eval — reliability is engineered, not measured.                                                    |
| 24  | Contamination-free private eval (§1.13, Strong)                  | ours is better (method), worse (realism)           | Frozen digest over the whole source closure, arms as restricted child programs, paired order rotation against cache warmth, accept/heldout splits, verifier private-token + assertion counts (`src/core/eval/mechanisms.ts:86`; `src/core/eval/tasks.ts:170`; `src/core/eval/runner.ts:1`). But: 16 tasks, all single-file, most 1–4 line fixes — Verified-shaped, not Pro-shaped. Floors 0.75/0.75 on 8+8 tasks cannot resolve 2–6 point effects; one run per task-arm gives no variance estimate.                                         |
| 25  | Infrastructure-noise control (§1.13, Strong)                     | partial                                            | Frozen source digest, pinned plan (model, budgets, environment allow-list: `src/core/eval/plan.json:91`), per-task call budgets. Machine/resource configuration of the run host is not recorded in the report; repeats that would expose noise do not exist (row 24).                                                                                                                                                                                                                                                                       |
| 26  | Offline harness search gated by eval (§1.14, Weak–Medium)        | partial                                            | The substrate is ideal: an arm is a frozen harness variant with provenance (`src/core/eval/armDefinitions.ts:6`). No proposer (human checklist or agent) systematically generates candidate arms (tool descriptions, thresholds) for paired runs. In-product self-modification: deliberately not (no production evidence; grader-overfitting risk §1.13).                                                                                                                                                                                   |
| 27  | File memory + verbatim handoffs (§1.15, Medium)                  | equal                                              | Muse Code-compatible memory files, host-maintained index, exact-string edits (`src/core/memory/memoryStore.ts:1`). Team handoffs carry structured records (`src/core/team/handoff.ts` via `teamHost.ts`); whether constraint-bearing handoffs stay verbatim end-to-end is untested (row 6).                                                                                                                                                                                                                                                 |
| 28  | Strict tool schemas (wire quality)                               | equal                                              | Strict subset sent for capable models from capability records; dedicated eval arm held both floors in binding runs (`src/core/eval/armDefinitions.ts:22`; PLAN.md M101/M106). Keep.                                                                                                                                                                                                                                                                                                                                                         |
| 29  | No limits of ours; safety limits kept (product rule)             | ours is better                                     | D121/D208 implemented as: provider/person limits only for work; bounded retries/rounds only to survive errors, stated when they stop (e.g. verify rounds row 16; `SUBAGENT_CAPACITY = 0` = no concurrency cap of ours, `src/shared/constants.ts:6990` via `subagentTools.ts:64`). The literature's loop/stuck detectors must follow the same rule here: name and notify, never silently cap. Our repeat guard already does (row 23).                                                                                                        |

Two stale-record findings from reading PLAN.md against the tree:

- **M101's status line undersells and oversells at once.** It says "building"
  with "remaining upstream port items open" while its own binding-run records
  show compaction evaluated, latched on and connected per host. A reader
  cannot tell from the status line which M101 items (BYO provider rows) are
  actually unfinished. Recommend the lead split the status: compaction done;
  named port items open. (Docs finding; no code change in this lane.)
- **Judge arms exist without binding runs.** PLAN.md M125/D107 arms are in
  code (`src/core/eval/mechanisms.ts:162`) but this lane found no binding-run
  receipt beside the M101 ones in `docs/certification/`. By the owner's rule
  ("nothing is claimed until it works in real use"), fast judge decisions
  should be described everywhere as unevaluated until those runs land. §4
  includes the lane that runs them.

## 3. Ranked: what to do, and what NOT to do

Ranked by value to a person per unit effort, with evidence strength. Every
"do" item names the experiment our own eval harness can run and its call
count. Call-count arithmetic uses the frozen plan (`src/core/eval/plan.json`):
per-task `callBudget` values sum to **147 attempts per arm** worst case over
16 tasks; the two binding runs actually spent **274 and 265 attempts across
four arms** (≈66–69 per arm) at **$0.063 / $0.060** against the $0.50 stop.
Estimates below state both the worst-case budget sum and the expected spend
at binding-run rates. All live runs stay on `muse-spark-1.3-contributor`
(`src/shared/constants.ts:10373`) under the existing D78 accounting; none was
run by this research lane.

### Do, in order

**H1. Grow the eval task set until it can see the effects we argue about.**
Value: highest — every other item's proof depends on it. Effort: medium
(tasks + verifiers, no product change). Evidence: Strong (§1.8, §1.13).
Add: (a) 8–12 multi-file tasks (3–6 files, one cross-file defect, verifier
imports the package), split accept/heldout; (b) 4 side-constraint tasks
(prompt states a rule — "do not change the public signature", "no new files" —
verifier asserts the rule _and_ the fix); (c) 2 long-horizon tasks (sequenced
sub-goals needing 15–30 tool calls); (d) repeats k=3 per task-arm with pass^3
and per-task variance in the report; (e) run-host record (OS, CPU, memory,
Node) in every report. Experiment cost of the new set at current budgets:
28–32 tasks × 4 arms × k=3 — worst case ≈ 32 × 9.2 avg budget × 12 ≈ 3,500
attempts; at binding-run efficiency ≈ 32 × 4.2 × 12 ≈ 1,600 attempts ≈ $0.40;
must run under a raised, explicitly approved run budget (the $0.50 stop in
`plan.json` is a run-safety stop, not a product cap — raising it for a named
run is a lead decision). A cheaper first step (new tasks, k=1, 4 arms):
≈ 540 attempts worst case, ≈ $0.13 expected. Lane brief: §4-H1.

**H2. Pin constraints verbatim across compaction; prove it with H1(b).**
Value: high (correctness/trust on long tasks). Effort: small–medium.
Evidence: Medium direction, high downside asymmetry (§1.3). Carry a
host-owned, never-summarised constraint block (user-stated rules captured at
turn starts, plus open todos as today) verbatim past every compaction, shown
to the person as pinned. Experiment: one new arm pair on the 4
side-constraint tasks + 2 long-context tasks, compaction forced via the
existing small-window harness condition: 6 tasks × 2 arms, worst case
6 × 14 × 2 = 168 attempts + ≤12 summary attempts ≈ 180; expected ≈ 90
attempts ≈ $0.03. Success = constraint assertions pass at the baseline rate;
today's arm is expected to fail some — that failure is the finding. Lane
brief: §4-H2.

**H3. Test non-recoverable elision against today's recoverable packing.**
Value: high (cost + simplicity; possible deletion of machinery). Effort:
small (one arm flag + natural-recall tasks). Evidence: Strong (§1.3). New arm
`packing-elide`: same threshold/whole-sends, placeholders without
`recall_output` (tool not declared — also tests the smaller tool surface).
Rewrite the two long-output tasks so recovery is _possible_ (re-read the file)
but not _instructed_, and count recalls in the control arm. Experiment: 16
tasks × 2 arms (packing vs packing-elide), worst case 294 attempts, expected
≈ 135 attempts ≈ $0.03. Keep recovery only if it wins on heldout pass rate or
cost per solved task; otherwise remove the tool from default sessions (keep
spill files for the person). Lane brief: §4-H3.

**H4. Deferred MCP tool loading with a cache-stable manifest.**
Value: high for MCP users (cost + accuracy), nil for others. Effort: medium.
Evidence: Strong (§1.4, §1.2). Ship: deterministic sorted tool order always;
above a person-visible definition-token threshold (suggest Anthropic's ~10k,
shown in the UI, person-settable — never a silent product cap, D121), offer a
tool-search tool and load full schemas on demand; log definition tokens per
request beside cached tokens. Experiment needs no live MCP server for the
first proof: offline, replay recorded real `tools/list` captures through the
request builder and assert token counts + prefix stability (0 model calls).
Live confirmation pair (deferred vs full) on the 16 tasks with a real MCP
server attached: worst case 294 attempts, expected ≈ 135 ≈ $0.03, plus the
server's own zero model calls. Lane brief: §4-H4.

**H5. Run the binding judge-arm evaluations; keep judges advisory until then.**
Value: high (unblocks honest claims for M125). Effort: small (arms exist).
Evidence: Strong that unmeasured judges mislead (§1.8). The nine judge arms
(`src/core/eval/mechanisms.ts:162`) over existing tasks: worst case 9 × 147 =
1,323 attempts; expected ≈ 600 ≈ $0.14 under the existing $0.50 stop. Each
decision ships only if its pair holds both floors _and_ improves cost per
solved task or constraint-keeping; otherwise it stays off by default with the
receipt saying why. Lane brief: §4-H5.

**H6. Best-of-N: add execution selection ("first checks-passing wins").**
Value: medium–high (turns a comparison viewer into the measured win).
Effort: medium. Evidence: Medium (§1.7). Opt-in per run (paid popup names N
and the stop rule): attempts run the workspace's configured checks; the first
attempt whose checks pass on current file versions (verify ledger rules) is
presented as the winner and remaining attempts stop — saving their unspent
budget. Person can still pick another. Experiment (offline-first): drive the
coordinator with real git worktrees and recorded attempt outcomes — 0 model
calls for selection logic. Optional live smoke on 4 accept tasks, N=3: worst
case 4 × 3 × 12 = 144 attempts ≈ $0.04. Lane brief: §4-H6.

**H7. Effort and tool-surface per model: measure, then recommend (never impose).**
Value: medium (cost). Effort: small (two arms). Evidence: Medium (§1.11,
§1.4). Arms: `effort-low` (record's lowest non-trivial effort) vs baseline on
16 tasks: worst case 294, expected ≈ 135 attempts. Arm `tools-lean`
(bash + read/search/list + edit only) vs baseline, same counts, run per model
family as keys allow — contributor model first. Results become _advice_ in
model/role settings ("measured: low effort solved the same tasks at 0.4×
cost on 2026-…"), never a changed default without the person's click (D121).
Fold into H5's run window to share warmup: combined expected ≈ 1,000 attempts
≈ $0.25. No separate lane brief; include as Part B of §4-H5.

**H8. Rules-file cost readout + short-file guidance.**
Value: medium (every workspace, every request). Effort: small. Evidence:
Medium (§1.10, §1.1). Show estimated rules tokens per request (and cached
share) in the context/rules UI; template and Help recommend a short map file
linking deeper docs (OpenAI shape); warn — in words, with the number — past a
person-settable size. No product cap (D121): the person decides; we show the
meter. Experiment: offline token accounting on fixture rules files (0 calls);
optional eval pair with/without this repo's real `AGENTS.md` on 8 tasks:
worst case 8 × 9 × 2 = 144 attempts ≈ $0.03 — publish the result either way,
including if our own file does not earn its tokens. No lane brief (small;
lead can fold into H4's token-accounting work).

**H9. Cache-miss attribution.**
Value: medium (turns a log line into a fix list). Effort: small. Evidence:
Strong rules (§1.2). On a detected miss, record which prefix component changed
since the previous request (tools hash, instructions hash, model) — hashes and
counts only, never content. 0 model calls; prove with recorded request pairs.
No lane brief; fold into H4.

**H10. Edit-format error accounting (then, maybe, an announced second chance).**
Value: medium. Effort: small. Evidence: Medium (§1.5). Count edit failures by
kind (no match, multiple matches, stale range) per model in traces/eval
reports (0 calls). Only if no-match dominates, add one eval pair testing a
whitespace/CRLF-normalised retry that _tells_ the model it was normalised:
worst case 294 attempts. Never silent fuzzy application. No lane brief until
counts justify it.

### What NOT to do, and why

- **Do not chase SWE-bench Verified or quote it.** Retired by OpenAI for
  contamination + flawed tests (§1.13, Strong). If a public number is ever
  needed, use SWE-bench Pro / Terminal-Bench current versions with matched,
  documented infrastructure — and expect it to be a marketing cost, not an
  engineering signal. Our frozen private set is the engineering signal.
- **Do not build an always-on embedding index as primary retrieval.**
  The measured default is grep + structure + LSP (§1.9). An opt-in semantic
  _tool_ is a feature decision for the providers/competitor lanes, not a
  harness fix; do not let it displace code-intel investment.
- **Do not let any LLM judge be the sole grader** for shipping decisions,
  best-of-N selection where checks exist, or eval verdicts. Biases are
  documented at Strong level (§1.8). Execution first; judge where nothing can
  run, labelled as such.
- **Do not add parallel writers to a shared tree** (including "just for small
  edits"). No controlled study supports it; both multi-agent camps converged
  against it (§1.6). Parallelism budget goes to readers, reviewers, verifiers,
  and isolated worktrees with reviewed merges.
- **Do not ship in-product self-rewriting harness behaviour** (prompts, tool
  descriptions or thresholds that mutate silently from usage). Preprint-level
  evidence, grader-overfitting risk, and it violates our "every refusal/change
  is said" rule. Offline search through frozen arms only (§1.14).
- **Do not replace economic compaction with a fixed token threshold** or copy
  a vendor's 150k trigger. Our break-even admission is strictly more informed
  (§2 row 5); thresholds are what it improves on.
- **Do not grow the default prompt** (more always-on instructions, bigger repo
  maps, larger memory snapshots) without a paired eval win. Context rot makes
  "harmless context" a measured falsehood (§1.1). This includes well-meant
  harness advice text: prompt phrasing alone multiplies reasoning spend
  (§1.11).
- **Do not add turn/tool/step caps as loop protection.** D121 forbids ours;
  the literature's stuck-detectors must notify the orchestrator/person and let
  them decide (our cap-notification product rule). Bounded retries that
  survive _errors_ keep industry-standard limits and say why they stopped
  (D208) — that is the only kind of limit to add.

## 4. Lane briefs (launch unchanged)

Each brief is complete on its own. "Machine: linuxlt" means run tests directly
in the worktree (`npx vitest run <files> --maxWorkers=3`, at most 3 files per
run, repository timeouts, never `--testTimeout`). Every brief inherits the
rig note and the recovery-release rules from the launch prompt. Decisions
needed are named at the end of each brief; where none is named, PLAN.md
already decides.

### 4-H1 — Eval task realism + repeats (do first; blocks H2/H3 verdicts)

```text
LANE H-EVAL-TASKS: Grow the M75/M101 eval task set so paired runs can resolve
2-6 point harness effects, and report reliability (pass^k), not only pass@1.

Base: rv/int9 72d8d5003 (or current main at launch; re-freeze after merge).
Machine: linuxlt. Model for any live run: muse-spark-1.3-contributor only.

Goal:
1. Add to src/core/eval/tasks.ts (EVAL_TASKS): (a) 8-12 multi-file tasks
   (3-6 files each, one cross-file defect, ES-module fixtures, verifier
   imports the package and asserts behaviour, split accept/heldout evenly);
   (b) 4 side-constraint tasks whose prompt states an explicit rule and
   whose verifier asserts the rule AND the fix (2 accept, 2 heldout);
   (c) 2 long-horizon tasks (sequenced sub-goals, designed for 15-30 tool
   calls, verifier asserts final state only). Every task follows the
   existing schema: planted defect, private-token verifier, declared
   assertion count. No task may require network, paid features, or
   credentials. Tasks are fixtures we author; verifiers run real Node code.
2. Runner/report: optional repeats k (default 1 = today's behaviour,
   byte-compatible reports); with k>1 report per-task pass^k, pass@k and
   Wilson or bootstrap interval per split. Record run-host facts (OS,
   arch, CPU count, total memory, Node version) in every report.
3. plan.json: add the new tasks with measuredAttempts [0,0,0,0] and
   callBudget by the existing rule (highest observed +50%, floor 6; unrun
   tasks: prior-plan scale +50% - state the number you chose and why).
   Re-freeze with the repository step; frozen.json digest must verify.
4. Floors: recompute accept/heldout floors for the enlarged splits so a
   5-point regression on heldout fails the run; document the arithmetic in
   the certification record. Do not lower a floor to make a run pass.

Proof (real code only, no fakes):
- Offline: full eval unit suites + new verifier drills - each new verifier
  fails on the planted defect and passes on a correct fix, with the private
  token and assertion count enforced (plant a premature-exit verifier and
  show it fails). npx vitest run <eval files> --maxWorkers=3 at repo
  timeouts. Typecheck all projects, eslint/prettier on touched files,
  npm run build (bundle budgets hold; stop and report if exceeded).
- Live (lead-approved, counted): state the expected count FIRST in the
  certification record - Phase A (new tasks only, 4 arms, k=1): worst case
  = sum of new callBudgets x 4 (estimate ~540 attempts, expect ~$0.13 at
  binding-run rates). Run via scripts/m101-e.mjs --live-m75 on the frozen
  digest; report actual attempts/requests/USD from the run receipt.
  Phase B (k=3 full set) runs ONLY if the lead approves the larger budget
  in writing (expected ~1,600 attempts / ~$0.40; the $0.50 plan stop stays
  unless the lead raises it for that named run).
- Red/green drills with byte-exact restores in
  docs/certification/h-eval-tasks.md for: digest mismatch refusal,
  premature-exit verifier, pass^k arithmetic.

Safety limits (industry standard, D121/D208): per-task call budgets and the
run USD stop are run-safety stops that fail the task/run loudly - keep them;
add no product cap. Retry loops you touch keep their existing bounds and
stop messages. No paid call beyond the counted live run above. No new
dependency. Commit with hooks on, explicit git add paths, never push.

Decision needed: lead approval for Phase B budget (default: Phase A only).
Also confirm new floors arithmetic before the first live run.
```

### 4-H2 — Verbatim constraint pinning across compaction

```text
LANE H-CONSTRAINT-PIN: Carry user-stated side constraints verbatim past every
(auto and manual) compaction, outside the LLM summary, and prove with eval
tasks that today's summarisation loses them.

Base: after H-EVAL-TASKS merges (needs its 4 side-constraint tasks); else
rv/int9 72d8d5003 plus authoring those 4 tasks first. Machine: linuxlt.
Model for any live run: muse-spark-1.3-contributor only.
Read first: src/core/backends/modelapi/autoCompact.ts,
autoCompactionAdmission.ts, the /compact path in ModelApiHost.ts, PLAN.md
M101 lane C1 (todos pinning), docs/research/harness-science-2026-11-02.md 1.3.

Goal:
1. Host-owned constraint block: rules the person states in user turns
   (captured deterministically - explicit "Constraints:" section and
   imperative must/never/always lines; when in doubt capture, the person
   can unpin in the UI) plus open todos as today. The block is stored with
   the session, survives resume/fork/rewind like packedCallIds, is NEVER
   sent through the summariser, and is re-sent verbatim after the summary
   entry on every post-compaction request. Show the pinned block in the UI
   ("Pinned across compaction: ...") with per-item unpin. All user-visible
   strings in en.ts + 14 tables; node scripts/check-l10n.mjs = 0 problems.
2. Eval: new frozen arm pair via src/core/eval/armDefinitions.ts -
   auto-compaction as today vs auto-compaction + pinning - on the 4
   side-constraint tasks + 2 long-context tasks, small-window harness
   condition unchanged (same window both arms). Add constraint-kept rate
   to the report (verifier already asserts the rule).
3. Update featureCatalog + npm run check:reference; CHANGELOG [Unreleased]
   in the person's words; PLAN.md M101 status note (dated, evidence-bound).

Proof (real code only):
- Offline: unit tests over real session/compaction code - block captured,
  survives an accepted compaction byte-for-byte, unpin removes it, rejected
  compaction leaves history untouched. Break the pin (route block through
  summariser input) and show the test fails; restore byte-exact. Record in
  docs/certification/h-constraint-pin.md.
- Live (counted, state first): 6 tasks x 2 arms, worst case 168 attempts +
  <=12 summary attempts = 180; expected ~90 attempts (~$0.03). Verdict
  rule fixed in advance: pinning ships default-on only if constraint-kept
  rate >= baseline task pass rate on heldout AND floors hold; publish the
  receipt either way. If today's arm keeps constraints already, say so and
  ship only the UI visibility - do not invent a win.
- Gates: typecheck, eslint --max-warnings 0 + prettier on touched files,
  check-l10n, check:reference, check:plan, npm run build, touched suites +
  npx vitest related <changed src> --run at repo timeouts.

Safety limits: compaction spend stays under the existing D78 admission;
no new cap of ours (D121). Capture is additive context: count its tokens in
session budget accounting and say so. Hooks on, explicit adds, never push.
Decision needed: none if capture stays conservative (explicit + imperative
lines). Broader ML-based constraint extraction is OUT of scope - propose
separately with its own eval.
```

### 4-H3 — Elision-only packing arm (test deleting recall)

```text
LANE H-ELIDE: Measure whether recoverable observation packing earns its
machinery against pure elision, with naturally-occurring (not instructed)
recovery.

Base: rv/int9 72d8d5003 (independent of H-EVAL-TASKS; better after it).
Machine: linuxlt. Model: muse-spark-1.3-contributor only.
Read first: src/core/backends/modelapi/observationPack.ts,
observationPacking.ts, src/core/eval/tasks.ts long-output tasks,
docs/research/harness-science-2026-11-02.md 1.3 (JetBrains; Fan et al.).

Goal:
1. New frozen arm packing-elide: identical threshold (8000 chars) and whole
   sends (2) as packing, placeholders carry NO recall id and recall_output
   is NOT declared for the session. Everything else identical; the pair
   differs by recovery alone (plus the one-tool-smaller surface - name it
   as part of the mechanism in the report).
2. Task fix: the two long-output tasks currently INSTRUCT recall via phase
   files (tasks.ts PHASE_FILES). Add natural variants (new task ids, keep
   old ones frozen for comparability): phase-two says only "recover the
   middle record before writing" - re-reading the file is available and
   sufficient. Count recall_output calls in the packing arm (report field
   exists: recalls).
3. Report cost per solved task per arm as a headline column (report.ts)
   without changing existing verdict fields.

Proof (real code only):
- Offline: arm schema/freeze tests, placeholder-shape tests, natural-task
  verifier drills (fail on defect, pass on fix). Red drill: declare
  recall_output in the elide arm -> freeze/arm test must fail; restore.
  docs/certification/h-elide.md.
- Live (counted, state first): packing vs packing-elide on 16 tasks (or the
  enlarged set if H-EVAL-TASKS landed): worst case 294 attempts, expected
  ~135 (~$0.03). Decision rule fixed in advance: recovery stays default
  only if packing beats elide on heldout pass rate OR cost per solved task
  beyond the report's variance; tie or loss -> follow-up lane removes
  recall_output from default sessions (spill files stay for the person).
  This lane does NOT delete product code on its own verdict; it reports.
- Gates as in H-CONSTRAINT-PIN.

Safety limits: run budgets/stops as today; no product change ships from
this lane beyond the eval arm + report column. Hooks on, never push.
Decision needed: lead confirms the deletion follow-up only after reading
the receipt.
```

### 4-H4 — Deferred MCP loading + cache-stable manifest + token meters

```text
LANE H-MCP-DEFER: Deterministic MCP tool order always; deferred schema
loading above a person-set token threshold; per-request definition-token
and cache-miss-attribution meters.

Base: rv/int9 72d8d5003. Machine: linuxlt. No live model call required for
Parts 1-3; Part 4 model: muse-spark-1.3-contributor only.
Read first: src/core/backends/modelapi/mcp/ (pool, functions, servers),
tools.ts request assembly, promptCache.ts, PLAN.md D43/D81/D86,
docs/research/harness-science-2026-11-02.md 1.2 + 1.4. Wire shapes only
from live captures (AGENTS.md rule 14): capture real tools/list frames
from a locally run real MCP server (no account, throwaway HOME) and keep
the capture command/date with the fixture.

Goal:
1. Sort every MCP server's tools deterministically (server id, then tool
   name) before they enter any request; a mid-session tools/list change
   applies at the next user turn, never mid-turn (prefix changes once,
   said in the log with counts only).
2. Meter: per request, log + Account/usage-visible counts for tool-
   definition tokens (estimated by the existing chars/token rule), rules
   tokens, cached tokens; on a cache miss (existing detector) record which
   component changed (tools/instructions/model hash - hashes only).
3. Defer: a person-settable threshold (default suggestion 10,000 definition
   tokens, 0 = never defer; setting text says what it does; this is a
   person-set display/load preference, NOT a work cap - D121). Above it,
   declare one tool-search tool (name/description/argument-name search
   over the local catalog) + always-load core tools; full schemas enter
   context only on discovery, stay for the session (append-only tool list
   keeps the prefix stable). Every deferral and discovery is shown in the
   transcript tool row words, never silent.
4. Feature catalog + reference + Help + README + CHANGELOG; 14 l10n tables.

Proof (real code only):
- Offline (0 model calls): replay captured tools/list frames through the
  real request builder - assert sorted order bytes, token counts before/
  after deferral on a >=55k-token catalog fixture, prefix digest stable
  across a no-op list refresh, changed exactly once on a real change.
  Red drills (unsorted order; mid-turn apply) with byte-exact restores in
  docs/certification/h-mcp-defer.md.
- Live (counted, state first; optional but preferred): full vs deferred
  pair, 16 eval tasks, one real local MCP server attached: worst case 294
  attempts, expected ~135 (~$0.03). Ship deferral default-suggested only
  if floors hold; the threshold itself stays person-set regardless.
- Packed-product check: npm run build; package; exercise settings UI text
  via npm run ui:look on the touched scene (light + dark) if UI changed.
- Gates as in H-CONSTRAINT-PIN, plus npm run check:host-api.

Safety limits: tool search never executes anything; discovered tools pass
the same permission engine as today. No credential reaches any child.
Bounded retries on MCP list fetches keep existing limits (D208). Hooks on.
Decision needed: threshold default (10k suggested) is a product default
for a person-settable preference - lead approves the number; D121 is
satisfied because the person can set 0 and nothing about their work stops.
```

### 4-H5 — Binding judge arms + effort/tools-lean pairs (measurement lane)

```text
LANE H-JUDGE-BIND: Run the frozen judge arms to binding verdicts and, in the
same window, measure effort-low and tools-lean. No product default changes
without a passing receipt + lead review.

Base: rv/int9 72d8d5003 (after H-EVAL-TASKS if available - more tasks,
same arms). Machine: linuxlt for code; live runs where the lead directs.
Model: muse-spark-1.3-contributor only. Read: src/core/eval/mechanisms.ts
(JUDGE_EVAL_ARMS), judgeReplay.ts, PLAN.md D107/M125, M101 binding-run
receipts in docs/certification/ as the format to match.

Goal:
Part A (judges): execute JUDGE_EVAL_ARMS (3 baselines + 6 isolated
decisions) over the frozen task set via scripts/m101-e.mjs. For each of
triage.needFull, context.include, loop.stuck, effort.lower,
failure.unmentioned, done.unbacked: verdict vs its paired baseline on
(a) both 0.75 floors (or H-EVAL-TASKS floors), (b) cost per solved task,
(c) decision precision/recall ONLY where an independent labelling pass
exists (D77 - judgeConditions are design intent, never ground truth).
A decision with no labels gets outcome verdicts only; say so.
Part B (H7): two new frozen arms - effort-low (capability record's lowest
non-trivial effort for the eval model) and tools-lean (bash/powershell by
platform + read_file/search/list_files/edit_file/write_file only).
Same floors + cost-per-solved reporting. Results feed settings ADVICE text
drafts in the certification record only; changing any default is a
separate lead-approved change (D121: recommend, never impose).

Proof / counts (state expected FIRST, report actual after):
- Offline: freeze/digest verify, arm-schema tests for the two new arms,
  fake-replay judge recorder suites at repo timeouts. 0 live calls.
- Live Part A: 9 arms worst case 9 x 147 = 1,323 attempts; expected ~600
  (~$0.14) under the existing $0.50 stop. Part B: 2 arms + shared baseline
  worst case 441; expected ~200 (~$0.05). Combined expected ~800 attempts
  / ~$0.19. If the stop would truncate, split into named sub-runs - never
  raise the stop silently.
- Receipts byte-exact in docs/certification/ (report json + md + log),
  PLAN.md M125 status updated to exactly what the receipts prove, per-
  decision ship/stay-off table. Any decision that fails stays OFF by
  default and its fast path is described as unevaluated/negative in Help.
- Gates as in H-CONSTRAINT-PIN (code touched: armDefinitions, mechanisms,
  plan/frozen, report columns if added).

Safety limits: D78 admission governs every attempt including judge side
calls - count them in the totals (requests vs attempts fields exist).
No product behaviour change in this lane. Hooks on, never push.
Decision needed: lead runs or authorises the live window (keys, machine);
per-decision defaults decided on the receipts, not in this brief.
```

### 4-H6 — Best-of-N execution selection

```text
LANE H-BESTOFN-SELECT: Add opt-in "first attempt whose configured checks
pass wins" selection to best-of-N, stopping unspent attempts.

Base: rv/int9 72d8d5003. Machine: linuxlt. Live smoke model (optional):
muse-spark-1.3-contributor only. Read: src/core/bestOfN/bestOfNRunner.ts,
bestOfNCoordinator.ts, verifyLedger.ts (current-version judging rule),
checkCommands settings, PLAN.md M77/D49/D78.

Goal:
1. Run option (default OFF, named in the one paid popup with N): after each
   attempt completes, run the workspace's configured check commands in its
   worktree through the existing permission/hook path (attempts decline
   anything that would ask - unchanged). Judge with verify-ledger rules:
   latest run per check on current file versions; timed-out counts as
   failed-for-selection and says so.
2. First attempt (completion order) with all configured checks passing is
   marked Winner (checks) in the comparison; if the person enabled
   "stop when one passes", cancel remaining attempts cooperatively and
   refund/report unspent reservations through the existing D78 tally.
   Person can always pick a different attempt; winner marking never
   auto-applies. With no checks configured the option refuses in words
   (nothing to select by) instead of falling back to a model judge.
3. Report per attempt: checks run, outcome, wall time, attempts/USD spent
   and saved-by-stopping. 14 l10n tables for every new string; feature
   catalog + reference + CHANGELOG.

Proof (real code only, offline-first):
- Real git worktrees + real check commands (node --test fixtures authored
  for the test) driving the real coordinator: passing attempt wins,
  failing-all yields no winner, stop-when-passes cancels a still-running
  attempt and settles its tally, no-checks refusal fires. 0 model calls
  (attempt conversations are the existing injected drivers ONLY where the
  current suites already do this with real code - if a needed seam would
  require a stand-in for our own modules, STOP and report instead of
  faking it; the no-fakes rule wins).
- Optional live smoke (counted, state first): 4 accept eval tasks, N=3,
  worst case 144 attempts (~$0.04), packed product, empty workspace.
- Red drills: stale-version check run must not select; byte-exact restore.
  docs/certification/h-bestofn-select.md. Gates as in H-CONSTRAINT-PIN.

Safety limits: selection checks are shell commands - same approvals,
sandbox and protected-path rules as verify today; per-check timeouts are
the existing person/command settings (D208: a timed-out check stops and
says so). Spend stays inside the run's single D78 popup; stopping early
only ever spends LESS. Hooks on, never push.
Decision needed: none (default off, person opts in per run). If tests
cannot be written without stand-ins, the lane stops at a design note -
lead decides the seam.
```

## 5. What a person would notice

The evidence supports one honest paragraph, and it is about proof rather than
features. Most coding agents ask to be trusted: their compaction fires at a
magic number, their tools crowd every request whether used or not, their
benchmark is a contaminated leaderboard, and their "teams" spend fifteen
times the tokens without saying so. Muse Spark Code already holds itself to
a stricter account than the field — compaction that must prove it pays,
tools that stay cache-stable, checks that only count on current files, every
paid call consented and tallied — and the work in §3–§4 extends that account
where the newest measurements say it matters: your stated rules survive
compaction word for word, long outputs stop taxing every later request,
MCP catalogues load on demand instead of billing you for their full text on
every turn, multiple attempts stop spending the moment one's tests pass, and
every one of those behaviours carries a dated, counted receipt from our own
frozen eval harness instead of a vendor chart. A person would notice it as
longer tasks that stay on-rails, bills that match the work, and an agent that
can show its working when challenged — which no surveyed alternative
currently does end to end.

## 6. Sources, licences, and what could not be verified

All web sources read 2026-11-02. "Version" is the arXiv version, post date,
or commit where the source names one. Our tree was read at `72d8d5003`.

| #   | Source (what it is)                                                                                          | URL / identifier                                                                                                              | Version / date          | Grade used                         |
| --- | ------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------- | ----------------------- | ---------------------------------- |
| S1  | Anthropic, Effective context engineering for AI agents (lab post, fetched in full)                           | https://www.anthropic.com/engineering/effective-context-engineering-for-ai-agents                                             | 2025-09-29              | Medium                             |
| S2  | Anthropic, Writing effective tools for agents — with agents (fetched in full)                                | https://www.anthropic.com/engineering/writing-tools-for-agents                                                                | 2025-09-11              | Medium                             |
| S3  | Anthropic, Demystifying evals for AI agents (fetched in full)                                                | https://www.anthropic.com/research/demystifying-evals-for-ai-agents                                                           | 2026-01-09              | Medium                             |
| S4  | Anthropic, Quantifying infrastructure noise in agentic coding evals (abstract + reports)                     | https://www.anthropic.com/research/infrastructure-noise                                                                       | 2026-02-05              | Medium                             |
| S5  | Anthropic, How we built our multi-agent research system (via reports; +90.2%, ~15× tokens)                   | https://www.anthropic.com/engineering/multi-agent-research-system                                                             | 2025-06                 | Medium                             |
| S6  | Anthropic, Advanced Tool Use / Tool Search / Programmatic Tool Calling (via reports + API docs summaries)    | https://www.anthropic.com/engineering (Advanced Tool Use)                                                                     | 2025-11-24              | Medium                             |
| S7  | Hong, Troynikov & Huber (Chroma), Context Rot (technical report, via full-text summaries)                    | Chroma Research, July 2025 (trychroma.com research)                                                                           | 2025-07-14              | Strong                             |
| S8  | Lindenbauer et al. (JetBrains), The Complexity Trap (abstract fetched; DL4C camera-ready)                    | arXiv:2508.21433 v3                                                                                                           | 2025-10-27              | Strong                             |
| S9  | Fan et al., An Empirical Study of Harness Design for Coding Agents (abstract fetched)                        | arXiv:2609.20804 v1                                                                                                           | 2026-09-17              | Strong                             |
| S10 | Constraint-loss cluster: COMPINT; ConstraintRot; Benchmarks Are Surprisingly Compaction-Friendly; Slipstream | arXiv:2610.31778; arXiv:2605.08580; COMPINT/ConstraintRot as reported 2026                                                    | 2026 preprints          | Medium                             |
| S11 | Gan & Sun, RAG-MCP (via reports)                                                                             | arXiv:2505.03275                                                                                                              | 2025-05                 | Medium                             |
| S12 | OSWorld-MCP tool-count ablation (via verified evidence roundup)                                              | arXiv:2510.24563 v2                                                                                                           | 2025-11-11              | Medium                             |
| S13 | Aider edit formats, unified-diff study, polyglot leaderboard (via aider.chat + reports)                      | https://aider.chat/docs/more/edit-formats.html; https://aider.chat/docs/leaderboards/                                         | leaderboards 2025-11-20 | Medium                             |
| S14 | Yan (Cognition), Don't Build Multi-Agents; Multi-Agents: What's Actually Working (second fetched)            | https://cognition.ai/blog/dont-build-multi-agents; https://cognition.com/blog/multi-agents-working                            | 2025-06-12; 2026-04-22  | Opinion→Medium (production counts) |
| S15 | Lopopolo (OpenAI), Harness engineering (fetched in full)                                                     | https://openai.com/index/harness-engineering/                                                                                 | 2026-02-11              | Medium                             |
| S16 | OpenAI, Why we no longer evaluate SWE-bench Verified (via Epoch AI review)                                   | https://openai.com/index/why-we-no-longer-evaluate-swe-bench-verified/; https://epoch.ai/benchmarks/swe-bench-verified/review | 2026-02-23              | Strong (audit)                     |
| S17 | The SWE-Bench Illusion; Does SWE-Bench-Verified Test Agent Ability or Model Memory?                          | arXiv:2506.12286 v4; arXiv:2512.10218 v2                                                                                      | 2025-12-01; 2025-12-22  | Strong–Medium                      |
| S18 | Deng et al. (Scale), SWE-Bench Pro; Pro V2                                                                   | arXiv:2509.16941 v2; arXiv:2610.24206 v1                                                                                      | 2025-11-14; 2026        | Medium                             |
| S19 | Terminal-Bench 2.0 (89 tasks; later versions recalibrated)                                                   | tbench.ai / Harbor (via reports)                                                                                              | 2025-11                 | Medium                             |
| S20 | Kwa et al. (METR), Measuring AI Ability to Complete Long Software Tasks; Time Horizon 1.1                    | metr.org (via reports + data summaries)                                                                                       | 2025-03; 2026-01        | Strong trend                       |
| S21 | Yao et al. (Sierra), tau-bench / tau2-bench, pass^k (via reports)                                            | ICLR 2025 proceedings                                                                                                         | 2025                    | Medium                             |
| S22 | Don't Judge Code by Its Cover; judge-bias literature (12-bias catalogue; position bias)                      | arXiv:2505.16222; arXiv:2410.02736 (ICLR 2025)                                                                                | 2025                    | Strong (bias exists)               |
| S23 | Gloaguen et al., Evaluating AGENTS.md (abstract/PDF via reports)                                             | arXiv:2602.11988 v3                                                                                                           | 2026                    | Medium                             |
| S24 | Retrieval reports: Augment grep-vs-embeddings; Cursor semantic search; Sourcegraph CodeScaleBench/Cody       | vendor posts, 2025-09 / 2025-11 (via reports)                                                                                 | 2025                    | Weak–Medium each, Medium jointly   |
| S25 | Best-of-N / verifier selection: LLM-as-a-Verifier (Kwok et al.); execution-selection studies                 | github.com/llm-as-a-verifier (as reported); 2026 reports                                                                      | 2026                    | Medium                             |
| S26 | Effort/cost measurements: 7-model effort study; PointFive prompt-waste; per-task cost indexes                | 2026 reports (datallmlab; arXiv:2608.01347 as reported; Artificial Analysis)                                                  | 2026                    | Weak–Medium                        |
| S27 | Self-improving harnesses: SIA; Continual Harness                                                             | arXiv:2605.27276; arXiv:2605.09998                                                                                            | 2026                    | Weak–Medium                        |
| S28 | Prompt-caching provider rules/prices (Anthropic/OpenAI/Gemini docs via 2026 guides)                          | platform docs (via reports; Meta rules read in our code, D43)                                                                 | read 2026-11-02         | Strong rules / Medium prices       |
| S29 | Yang et al., SWE-agent / ACI; Zhang et al., AutoCodeRover (foundational, via reports)                        | arXiv:2405.15793 (NeurIPS 2024); arXiv:2404.05427 (ISSTA 2024)                                                                | 2024                    | Medium                             |

**Licences.** Papers and blog posts: ideas and numbers cited with attribution;
no text reproduced beyond short quoted phrases. Nothing in §3–§4 requires
porting code. For reference where a port were ever considered: NVIDIA SoL-Pi
(our packing's stated design reference, `src/core/backends/modelapi/observationPack.ts:2`)
is MIT; OpenAI Codex harness is Apache-2.0 (as reported Aug 2026 — verify
before any use); Aider is Apache-2.0. This lane copied no code from any of
them; all recommendations are implementable from the descriptions here plus
our own tree.

**What could not be verified** (excluded from verdicts or graded Weak):
the reported Oct 2026 Anthropic "fold subagents back" enterprise note (no
primary source found); single-cell Terminal-Bench harness comparisons in
blog posts (Cursor 93% vs Claude Code 77% for one model — plausible,
unaudited); vendor best-of-N and self-improving-harness press numbers
(MiMo Code, Tsinghua system) without methods; exact current cache prices/
TTLs for every provider (RSCH-PROVIDERS owns live price cards — §1.2 states
rules, not a tariff); METR horizons above 16h (METR itself flags them);
whether Anthropic's compaction API trigger is exactly 150k today (product
detail, not load-bearing). Hands-on competitor runs were not attempted:
they need accounts/keys, this lane makes no paid call, and competitor
behaviour belongs to the sibling lanes. Every "ours" claim, by contrast,
was read in code at the base commit.

**Method note.** Search and fetch were used to locate primaries; four
primaries were fetched as full posts (S1, S2, S3, S15), two as arXiv
abstracts with full bibliographic records (S8, S9), and the rest read
through abstracts plus independent reporting, cross-checked where numbers
were load-bearing (compaction, tool count, Verified retirement each have
≥2 independent sources above). Where only reporting exists, the grade says
so. Newer work contradicting older work is flagged in place: compaction
(§1.3 vs the 2024–2025 summarisation default), retrieval (§1.9 vs the
2023–2024 embedding default), Verified (§1.13 vs its own leaderboard era),
multi-agents (§1.6, June 2025 vs April 2026 from the same author).

LANE DONE
