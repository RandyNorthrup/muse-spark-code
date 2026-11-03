# Research synthesis — one plan (2026-11-02)

Written for the owner. It joins the nine research reports of
2026-11-02 (Pi/SoL-Pi, Claude Code, Codex, alternatives, Muse Code,
providers, harness science, agent security, performance) and the
open-work list (`open-work.md`), all on base `rv/int9` at `72d8d5003`.
The goal in your words: "the highest quality best product with all of
the best features and optimizations, and security", better than Pi,
SoL-Pi, T3 Code, Claude Code, Muse Code, Codex Desktop, OpenCode and
the rest.

**The short answer.** We cannot truthfully say that today, and this
document does not say it. What the evidence does support is narrower
and still strong: we are the only product in the field that asks
before it spends your money, puts no limits of its own on your work,
runs two backends plus your own providers from one surface, and has
already shipped several things rival users are still begging for.
We are behind in five places a person would feel: MCP tools can
change under you after you approved them; Muse can empty its model
list and take us with it; every MCP schema taxes every turn; long
conversations lose your side rules when they are summarised; and
there is no phone or web control of work running on your own PC.
Fifteen moves close those gaps. Sixteen lanes are already started
from these reports; §6 places them and everything else in order.

**How this was checked.** Every headline claim below was checked
against the report it came from, and — where the report cites our
code — against the code on this tree. Two report mistakes were found
and corrected here, not repeated:

- The alternatives report says observation packing is "off by
  default". The code says on: `package.json:1118` sets
  `museSpark.modelApiObservationPacking` with `"default": true`.
  That matters, because whether packing saves money in dollars is
  still unproven (§7). The Pi report has the same fact right.
- The Pi report reads Pi at git v1.5.0; the performance report
  measures the npm package `@mariozechner/pi-coding-agent` 0.73.1.
  Both measure the same lean prefix (about 1.9k tokens), so the
  conclusion holds, but the version numbers are two lines of the
  same project and are kept separate below.

Two more honesty rules run through the whole document. "Built" means
in the code on this base; it does not mean proven through the packed
product in real use. The real-life run and hosted CI on the merged
head are still open (open-work, release level), so held claims stay
held. And fixes the security and performance lanes already made on
their own branches (extra protected paths, wider secret redaction,
faster agent start) are **not** on this base yet — they are merge
candidates, not current product facts. Where that changes a
verdict, the text says so.

Lane names starting `RLF-` in the "already started" list are placed
in the order in §6 and are not re-proposed as new ideas in §2.

---

## 1. Where we stand against each alternative

Each product gets the same three lines: ahead, equal, behind. Only
claims with evidence behind them appear. "Cannot claim yet" means
the reports do not prove it either way.

### Pi (and SoL-Pi on top of it)

Pi is a minimal terminal harness people extend themselves. Its real
strength is measured smallness: prompt plus 4 tools is 1,334 tokens
(Pi lane, measured by building the clone and running its builders).

- **Ahead.** Our instructions alone are already smaller than Pi's
  prompt (440 vs 517 tokens on a plain turn, same measurement).
  Auto-compaction decides on break-even economics, not a fixed
  threshold, and prices the summariser — SoL-Pi's economics do not
  (`src/core/backends/modelapi/autoCompact.ts:84`; latch on at
  `src/shared/constants.ts:3768`, both verified). We ship sub-agents,
  teams, plan mode, approvals and paid consent; Pi skips them on
  purpose. That is what our extra fixed tokens buy.
- **Equal.** Observation packing (their ObservationPack) and
  `then_run` after an edit (their Action Fusion) are in and
  working. Cache-miss detection and path cleanup match theirs.
- **Behind.** Three concrete gaps. Our compaction summary is still
  capped at a fixed 8,192 tokens
  (`src/shared/constants.ts:3761`, verified) — the exact bug Pi
  fixed when reasoning models spent the budget thinking and failed
  every time. We declare every tool on every request (12 tools,
  2,511 fixed tokens on a plain turn, from
  `test/fixtures/golden-requests/01-plain-turn.json`) where Pi
  defers rarely used tools behind search. And our edit tool matches
  text exactly only, where Pi retries once with normalised quotes
  and whitespace. **Cannot claim yet:** that our packing saves
  dollars. It was judged on prompt tokens; October evidence says
  that metric can invert under caching (§7).

SoL-Pi's headline "49% fewer tokens" should not steer our defaults.
Read from its own tables (Pi lane): the full stack loses about 6%
relative score for about 33% cost saving on 51 tasks, and its
"Performance" point is a different single mechanism per backend,
picked after seeing the results. A trade, not a free win.

### Claude Code

Claude Code is the deepest harness in the field: 33 hook events,
skills, agents, plugins, marketplaces, four rungs of parallelism,
every major surface, and the best-documented cache discipline.

- **Ahead.** Multi-account and multi-provider support — Claude
  Code's loudest unmet ask (three of its top-reacted open issues,
  Claude lane §1.4) — is shipped here. Metering is per request with
  consent before extra spend; cost opacity is Claude Code's deepest
  complaint well. Our Auto reviewer can only turn an ask into an
  allow, never deny by timeout; Claude's classifier with
  no-verdict-equals-deny has blocked whole tools at once. We import
  hooks and setups from more rival agents than Claude reads.
  Checkpoints restore along a checked chain; Claude's docs state
  that shell-only and most sub-agent edits are not tracked.
- **Equal.** The five permission-mode names, plan-before-edit,
  auto memory with the same index discipline, effort controls,
  worktrees, dictation. Observation packing is arguably ahead
  (faithful and recallable where Claude summarises away), but that
  is a design judgement, not a measured win — kept as equal here.
- **Behind.** No deferred MCP tool search (every schema rides
  every request), no fork sub-agents that inherit the parent's
  history (verified: no fork kind in
  `src/core/backends/modelapi/subagentTools.ts`), no Claude-format
  plugin loader or marketplace, no idle compaction, no script
  statusline or output styles, and our ACP agent speaks v1 only
  (SDK pinned at 2.0.1, `package.json:2128`, verified; verified
  capabilities at `src/acp/agent.ts:4286` are list/resume/close/
  delete) where their adapter already serves draft v2 with child
  sessions per sub-agent. **Cannot claim yet:** that our compaction
  is better than Claude's. Both summarise; two 2026 papers beat
  summarising (§2, move 6).

### Codex (CLI, desktop, IDE)

Codex has the strongest OS sandbox design on paper and the clearest
approval vocabulary in the field. Its users' top complaints are
operational: that same sandbox breaking builds on Windows, a
persistent daemon, and missing basics.

- **Ahead.** Undo that reverts code and conversation, real language
  intelligence for the model, and chats scoped to the workspace are
  Codex's #1, #2/#5 and #7 most-reacted open issues (Codex lane
  §1.9) — all shipped here. The agent here cannot propose a
  standing allow-rule; a 2026 paper measured 58% elicitation
  against products that let it (abstract read only, §7). No
  auto-start daemon. A changelog in the person's words, where
  Codex's is a pointer to release bodies.
- **Equal.** Headless exec with structured output (ours is stricter
  about money), custom agents, skills, reviewer mechanism. Our
  economics-driven compaction beats Codex's token threshold on
  design; neither side has a published head-to-head, so the honest
  grade is equal-until-measured, not ahead.
- **Behind.** The Model API shell runs unconfined — our own code
  says so (`src/core/backends/modelapi/permissionPolicy.ts:10`,
  verified) — where Codex confines with bubblewrap/seccomp,
  Seatbelt and, on new Windows builds, execution containers. No
  "human checkpoint" rule that no automation can satisfy. Our
  Codex hook-import table is stale: it lists 12 events labelled
  rust-v0.160.0 (`src/shared/constants.ts:5252`, verified) where
  Codex now has 14. Our own engine fires 20 event names
  (`src/core/backends/modelapi/hooks.ts:47`, verified), so the gap
  is the import mapping, not our hook surface. **Cannot claim yet:**
  ACP sub-agent/steering parity with the live `codex-acp` adapter —
  nobody has compared them line by line (Codex lane §1.8).

### Muse Code (Meta's CLI) and the Model API

This is home ground: one of our two backends, plus the API the
other backend speaks.

- **Ahead.** There is no official ACP package for Muse; the
  request has sat open since September (Muse lane §1.4; the npm
  check is measured: `@muse-code/acp` returns 404). We ship that
  agent today. We never send on an unknown billed tier; Meta's own
  headless default can (contributor mode can be on for a machine
  that never saved the setting).
- **Equal.** Most of what CLI 1.4.4–1.4.12 added for hosts is wired:
  session handoff, approval-reviewing, task list, skill import,
  feedback, price and effort tables (verified exact against the
  published tariffs).
- **Behind.** SDK pinned at 1.4.12 (`package.json:2143`, verified)
  with 1.4.13/1.4.14 payloads (background-terminal completions,
  held approvals, computer-use card facts) stripped and never
  shown. No `muse usage` allowance read, no `--preset`, no
  `--disable-request-user-input` for unattended runs — and since
  1.4.13 `--yolo` keeps the question tool, so an unattended run can
  park forever on a question nobody sees. One limit of ours still
  binds the person: headless exec refuses `--max-output-tokens`
  above our 32,768 constant (verified at
  `src/runtime/exec/execArgs.ts:308`) below the provider's
  documented 131,072. Windows session editing is hidden by a
  platform guess instead of the capability the CLI now reports.
  Worst of all for trust: when Meta's catalogue comes back empty
  for a signed-in subscriber (three tracked reports), our
  `listModels` returns it as truth (verified at
  `src/core/backends/musecode/MuseCodeHost.ts:4295`) — empty picker,
  dead sessions, misleading "lack access" sentence.

### OpenCode, Cline, Kilo, Goose, Crush, Aider, Roo

The open harnesses. OpenCode (MIT) has become the shared substrate
— Kilo's CLI is now built on it (alternatives lane, read in code).
Roo Code is archived; Aider has stalled (last commit 2026-05-22).

- **Ahead.** We _are_ the VS Code extension OpenCode's users ask
  for most (177 reactions). We have a calibrated Judge where they
  ask for a permission classifier. Consent before every paid use,
  in every mode including Bypass, with a daily ledger for Tab —
  the alternatives lane found nobody else doing this. Fifteen
  languages with a gate, an accessibility gate, a credential
  vault, maker/hardware support: unmatched in this set.
- **Equal.** Verify-after-edit, code intelligence, web fetch,
  review, git/PR, checkpoints, best-of-N, teams, custom agents,
  schedules, headless exec, Tab, session share, zero-markup
  bring-your-own-keys.
- **Behind.** No agent-published artifacts (OpenCode added them in
  v2.2.4; verified absent here: no `artifact_publish` tool in
  `src/`). No installable agent packages or marketplace (Kilo,
  Cline, OpenCode all ship one). No vendor-cloud run option
  (Cline Cloud, Kilo Cloud) — deliberate (§3). No no-key first run;
  Kilo and Cline win that by reselling inference, which we will
  not do (§3). **Cannot claim yet:** better task scores. The one
  controlled harness comparison (arXiv:2610.04433) finds heavy vs
  light harnesses within 5 points and harness swaps flipping as
  many tasks as reruns — nobody gets to claim a quality crown from
  harness shape alone.

### T3 Code (and Conductor, Superset)

T3 controls agents you already have, from a phone. That control
surface is the single most repeated new feature across the field
since September (T3, Cursor iOS, Conductor iOS, Amp web).

- **Ahead.** We bring our own harness, backends, vault and consent
  ledger; T3 brings none. No telemetry; T3's users filed a trust
  complaint about exactly that. Our home node keeps code in the
  house with no per-minute bill.
- **Equal.** Parallel work in worktrees.
- **Behind.** Phone and web control of running agents: **missing**
  here, shipped there. The node exists (`src/runtime/node/`) but
  has no phone client. This is the clearest single gap against T3.

### Cursor, Devin Desktop (ex-Windsurf), Kiro, Warp, Copilot, Amp, Zed, Antigravity

Closed products, read through changelogs and docs only — internals
unverified, prices as read on 2026-11-02 and already ageing.

- **Ahead.** Price honesty. Cursor's October move (own models only
  on the cheap plan, third-party models at API rates) is the
  market's loudest complaint; our answer — free product, your own
  credentials, provider limits only, consent naming model and
  price before spend — is exactly what the revolt asks for.
  Browser checks run a pinned verified runtime behind its own
  proxy, never your logged-in browser. Voice, screen recording
  and media input are ahead of most of this set.
- **Equal.** Cloud-style parallelism by different means (teams,
  best-of-N, schedules — ours local-first). Spec-first work is
  partial: Kiro's requirements/design/tasks trio is first-class
  there, plans-as-files here.
- **Behind.** Hosted cloud sessions that outlive the editor
  (Copilot, Cursor, Warp Oz) — deliberate, not missing by
  accident (§3). Interactive canvases (Cursor) — same gap as
  artifacts above. Driving your own GUI apps (Cursor computer
  use) — surfaced only through Muse Code here. **Cannot claim
  yet:** anything about their model quality. No rival was run
  hands-on in any lane; every closed-product claim above is
  changelog-grade.

### Providers and protocols (not products, but we compete on them)

- **Ahead.** Compaction that stays typed and local sits in the
  safe class of the compaction-laundering paper (abstract read,
  §7); opaque server summaries cannot be audited. Spend shows the
  provider's own figures beside our estimate.
- **Equal.** Thinking/effort controls, prompt-cache controls
  (except Gemini explicit caching), strict tools where measured.
- **Behind.** Two silent degradations a person pays for: the
  capability record promises structured outputs on Anthropic and
  Gemini but neither codec sends a schema (verified: Anthropic
  sends only `output_config.effort` at
  `src/core/backends/modelapi/codecs/anthropic.ts:880`; Gemini
  emits no `responseSchema`), so side calls pay prompt-and-repair
  rounds. New paid Gemini projects store every request by default
  since 2026-10-26 and we never opt out (the codec drops `store`
  as Meta-only). No fast/priority mode on any API-key route, and
  the catalogue sync throws the price data away
  (`scripts/sync-provider-catalog.mjs:173`, verified). Gemini ids
  Google reroutes on 2026-12-01 still show the old prices. No
  Cerebras preset at all; several presets still uncaptured and
  therefore refused. No Bedrock or Vertex (planned since October,
  design now stale).

### Summary table

| Rival           | Ahead (short)                                  | Equal                    | Behind (short)                                    |
| --------------- | ---------------------------------------------- | ------------------------ | ------------------------------------------------- |
| Pi / SoL-Pi     | Smaller instructions; economics; product depth | Packing; edit-then-run   | Summary cap; all tools declared; exact-only edits |
| Claude Code     | Accounts; metering; import breadth             | Modes; memory; worktrees | Tool search; fork agents; plugins; ACP v2         |
| Codex           | Undo; code intel; no daemon                    | Exec; agents; reviewer   | No OS sandbox; no checkpoint rule                 |
| Muse Code       | ACP agent exists; tier safety                  | Most 1.4.x host surface  | SDK behind; empty-catalogue honesty               |
| OpenCode family | Consent; languages; vault                      | Core harness features    | Artifacts; packages                               |
| T3 Code         | Own harness + node                             | Worktrees                | Phone control missing                             |
| Closed IDE set  | Price honesty; containment                     | Parallel work            | Cloud sessions (deliberate)                       |

---

## 2. The moves that matter most

Fifteen moves, ranked by what a person would actually notice.
Duplicates across reports are merged into one move each (deferred
tools alone appear in five). "Started" means a lane from the
already-started list is running; "new" means nobody has launched
it yet. Effort counts lanes (one lane = one launchable brief).
Where reports disagree, the disagreement and the side taken are
stated inside the move.

**1. A tool cannot change its story after you approved it.**
_Started: RLF-SECMCP._ What: pin every MCP tool's definition by
hash; if a server later offers different text, withhold the tool,
drop its saved approvals, and show the new text for a fresh
decision. A server's own "I am read-only" hint skips the question
only for pinned, unchanged tools. Why: this is how a real attacker
starts today — poison a description the model reads and you never
see, or rug-pull a server months after install (security lane
§3.2–§3.4; the `postmark-mcp` backdoor did exactly this in the
wild). Today descriptions go to the model verbatim (verified at
`src/core/backends/modelapi/mcp/functions.ts:368`) and a changed
list is re-offered silently. Evidence: strong (primary posts,
live incident, our code probed). Effort: 1–2 lanes. Depends on:
nothing. Disagreement: our D42 parity with Muse Code says trust
the hint; the MCP spec says clients MUST treat annotations as
untrusted. This synthesis takes the spec.

**2. Keep working, honestly, through Meta's own failures.**
_Started: RLF-EMPTYCAT, RLF-MUSEUSAGE, RLF-UPSDK, RLF-FIRSTRUN._
What: an empty model list keeps the last good one with a plain
sentence and a retry, never an empty picker; subscription
allowance windows show without burning a model turn; everything
the protocol now says (finished background work, held approvals)
is on screen instead of stripped; first-run dead ends record what
a problem report needs; unattended runs pass
`--disable-request-user-input` so they cannot park on an unseen
question (the one part not yet started: Muse lane Brief C).
Why: our only two open tracker issues are first-run dead ends,
and the empty-catalogue failure has hit signed-in subscribers
three times. Evidence: strong (traced reports; our side read in
code). Effort: 4 started lanes + 1 small new lane. Depends on:
served captures before any new wire shape (rule 14); SDK 1.4.14
only after its 7-day window clears on 2026-11-03.

**3. Stop declaring every tool on every request.**
_Started: RLF-DEFERTOOLS._ What: core file and shell tools stay
declared; goal, todo, rare tools and MCP schemas load on demand
through one small search tool, append-only so the cached prefix
never rewrites. Why: up to about 900 fixed tokens on a plain turn
and every MCP schema on MCP turns (measured in two lanes); on an
8k-window local model our 2,511-token prefix is a quarter of the
window before you type anything. Five reports propose this; they
are one move. Evidence: strong on token counts (measured here),
medium on quality neutrality (Pi and Claude ship it; our paired
eval must confirm). Effort: 1 lane + paired eval. Depends on:
move 9's eval for the default decision. Disagreement: the
performance lane says do not build this (its 95% saving is from a
simulated benchmark, and our typical prefix at about 2.5k tokens
is already lean). Side taken: the performance numbers themselves
— lean typical, 8.8k full, MCP unbounded — argue for deferring
MCP and rare tools above a threshold the person can see and set,
not for deferring the core. Build that, measure, then decide the
default.

**4. Prove packing saves dollars, or flip its default.**
_New._ What: rerun packing on/off/recall arms reporting uncached
tokens, cached tokens and dollars per solved task — not prompt
tokens — and test pure elision against today's recoverable
packing. Why: packing is on for every Model API user (verified
above) on the strength of the one metric October evidence shows
can mislead. If we are taxing every session, this finds out.
Evidence: strong that the metric matters; unknown whether we are
affected (our placeholders are replaced once and then stay
byte-stable, unlike the paper's re-masking arm). Effort: 1 eval
lane (Pi R1 + harness H3, same runs). Depends on: move 9 for task
realism; the default flip, if the numbers demand it, is the
lead's. Disagreement: Fan et al. find recoverable elision rarely
used and worth no accuracy; we ship recovery. Side taken: test
deleting it, do not delete it on a paper alone — our current eval
_instructs_ recall, so it cannot measure natural use (harness
lane, verified in `src/core/eval/tasks.ts`).

**5. Stop failing turns that should work.**
_Started: RLF-COMPACTCAP, RLF-OUTPUTCAP, RLF-EDITFUZZ._ What:
three small breakages removed. The summary budget comes from the
model's own output limit, clamped to fit its window, not our
fixed 8,192. Our 32,768 constant stops being a maximum anywhere
the provider (131,072) or the person allows more — it may stay a
default. An edit that fails exact matching gets one announced,
unique-match retry over normalised quotes, dashes and whitespace,
plus two missing overflow patterns. Why: each one kills or wastes
a turn a person paid for; the output-cap refusal is also a direct
breach of "no limits of ours" (D121). Evidence: strong (Pi fixed
the identical summary bug; our constants verified). Effort: 2–3
small lanes, already started. Depends on: nothing. Disagreement:
the harness lane says count edit failures first, and Aider
deliberately removed fuzzy matching. Side taken: keep the started
lane but with the harness guardrails — exact first, unique match
only, the model told it was normalised, failures counted by kind.
Silent fuzzy application stays banned.

**6. Your rules survive compaction word for word.**
_Started: RLF-PINNED; faithful-truncation half is new._ What: a
host-owned block carries the rules you stated ("never edit X",
"keep this API") plus open todos verbatim past every compaction,
shown as pinned, never sent through the summariser; and a later
compaction never summarises an earlier summary. Why: several 2026
studies find summaries keep the goal and drop the side rules —
reported retention as low as 17% — while outcome scores barely
notice, so the failure hides. Evidence: medium (consistent
preprints, unsettled sizes) with high downside if true. Effort:
1 lane, depends on move 9's side-constraint tasks to prove it.
Disagreement: the Muse lane doubts compaction sophistication
pays at a 1M-token window and the Claude lane wants a bigger
rewrite toward truncate-only compaction. Side taken: keep our
economic admission and packing (both measured here), adopt the
two cheap rules all three lanes can accept — pin verbatim, never
summarise a summary — and pilot model-managed context only for
models whose capability record proves they can. No server-side
compaction as default (providers and Muse lanes agree).

**7. Close the quiet leaks: secret files, memory, hidden text.**
_Started: RLF-SECDEFAULTS, RLF-SECTEXT._ What: reading `.env`,
private keys and credential files asks first (the set is the
person's to empty); a memory write copied from untrusted content
asks and shows the note; rules and skill files warn on hidden
bidirectional/zero-width characters; the Auto reviewer fences
its input with fresh random markers a crafted command cannot
close. Why: one steered turn that plants a file or a memory
becomes every later session. Today `.env` is an ordinary read
in every mode and memory writes in Auto need no card. Evidence:
strong (named incidents; our gaps probed). Effort: 2 small lanes,
started. Depends on: a lead confirm on the read-default (the
setting stays the person's; the default is our judgement). Note:
the security lane's own widened redaction and protected-path
fixes are on its branch, not this base — §6 merges them early;
until then do not claim them.

**8. Structured answers right the first time; Gemini storage off.**
_Started in part: RLF-GEMPRIVACY. New: providers P1._ What: send
the schema on Anthropic (`output_config.format`) and Gemini
(`responseSchema`) where the record already promises it, and
send `store=false` on Gemini with one honest sentence where the
key goes in. Why: every side call (summaries, reviewers, judges)
on those two providers currently pays prompt-and-repair rounds
and can still return prose; meanwhile new Gemini projects store
every request by default and we say nothing. Evidence: strong —
our own code (verified above) plus the provider changelog.
Effort: 1 lane. Depends on: a live capture per provider first
(cheapest model, counts stated).

**9. An eval big enough to steer by, and a published cost.**
_Started: RLF-EVALTASKS. New: alternatives COSTPROOF._ What: grow
the frozen task set from 16 single-file tasks (verified:
`src/core/eval/plan.json`, budgets summing to 147 attempts per
arm) with multi-file, side-constraint and long-horizon tasks,
repeats with pass^k, and run-host records; then publish cost per
solved task with its rerun disagreement, refusing to print a gap
smaller than that disagreement. Why: most effects in these
reports are 2–6 points, inside infrastructure noise; 16 tasks
run once cannot see them, so today we argue where we could
measure. This move is the proof engine for moves 3, 4, 6 and for
the six unrun Judge arms. Evidence: strong (method papers; our
harness read in code and already ahead of common practice).
Effort: 1–2 lanes. Depends on: a named live-run budget (the
$0.50 run stop stays unless the lead raises it for that run).

**10. A kernel under the shell, and commands only a person can pass.**
_New._ What: confine Model API shell commands on Linux first
(bubblewrap view enforcing the person's permission profile,
failing closed with a said refusal, never silently falling back
to unconfined); add a "checkpoint" rule class that always needs
a fresh human click in every mode including Bypass, machine-
scoped only; show what else a saved grant would allow before it
persists. Why: approvals are currently the only boundary on that
backend (verified), and command _composition_ — no injection
needed — is the measured weak point an OS boundary contains.
Evidence: strong for the design (Codex source read; supporting
papers at abstract level, §7). Effort: 3 lanes in sequence
(Codex A, B, C), the first large. Depends on: a new PLAN
decision recording fail-closed confinement; the unbreak-my-build
story (GPU, keychain, old bubblewrap, snap mounts) is part of
the lane, learned from Codex's issue list. Disagreement: the
alternatives lane ranks this last and the security lane leaves
containment to the existing Judge work (whose fast path is off
everywhere: `JUDGE_FAST_B1_READY_PLATFORMS` is empty, verified).
Side taken: one confinement design only — this lane _is_ that
work's Linux half, sequenced after moves 1–9, not a second
competing sandbox.

**11. Steer your own PC's agents from your phone.**
_New; needs an owner decision first (§5)._ What: from a phone
browser, watch every conversation on your home node live, reply,
approve or deny a tool call, answer a paid-use question with its
model and price named, and cancel a run — served by the node
itself over its own pairing, no relay, no account. Why: the
whole field shipped this in October; it turns our node from
infrastructure into the product, and pairs it with a vault and a
consent ledger nobody else has. Evidence: strong (four shipped
competitors). Effort: large, 1 lane to first usable slice.
Depends on: the node server wiring already in open work
(RLF-NODESERVE) and the owner's relay decision.

**12. Fork a helper that already knows the conversation.**
_New._ What: a fork spawn kind inheriting the parent's history
for side work, plus built-in read-only Explore and Plan agents
and a warning (never a refusal) when custom-agent descriptions
grow large. Why: "same context, side quest" is now Claude's
default delegation shape, and every spawn here starts cold.
Evidence: medium (vendor default; our primitives exist).
Effort: 1 lane. Depends on: nothing; skills that run forked ride
on top later. Guardrail from the harness and Codex lanes, taken:
parallelise readers and reviewers, keep one writer per tree —
forks explore, they do not co-write a shared tree.

**13. Bring your setup with you.**
_New._ What: import a whole Claude plugin folder (skills, agents,
hooks, MCP entries) in one previewed step, scanned for the
malicious-skill shapes (anything hit starts unticked), with its
per-session token cost shown; then installable agent packages
from a git URL with source and commit recorded. No store, no
in-process plugin code — reported and skipped, never run. Why:
a Claude or OpenCode setup is an asset people carry between jobs;
switching should cost one preview, not a rewrite. Evidence:
medium-strong (our M83/M91 machinery exists; the USENIX skills
measurement — 157 malicious of 98,380 — is abstract-level here,
§7). Effort: 2 lanes (import first). Depends on: two real plugin
manifests captured before any parser.

**14. Speak the editor protocol's next draft.**
_Started in part: RLF-UPDEPS2._ What: move the ACP pin past the
CRLF framing fix that can stall a Windows-pipeline editor today;
answer archive/status/title and `auth/status` so Zed and
JetBrains can show "signed in" without a trial session; then
draft v2 with a child session per sub-agent. Why: editors will
expect child sessions, and the framing fix is a live stall risk.
Evidence: strong (tarball diffs read; their adapter read in
code). Effort: 2 lanes (pin + housekeeping first, v2 after).
Depends on: the ACP-teams merge (round 11, §6) landing first or
stacking as the lead directs; each SDK version only after its
7-day window (2.4.0 clears 2026-11-09).

**15. Long runs that fall over to your next model, at true prices.**
_Started: RLF-FALLBACK; price honesty is new._ What: an ordered
fallback list per role — on model refusal, overload after
backoff, or a missing deployment, retry on the next model _you_
listed and say which answered and why; retirement dates on model
labels; rerouted Gemini ids priced as the model that serves
them; fast/priority tiers offered per role at their real prices
once the catalogue stops discarding them. Why: a long job should
not die on one provider's refusal, and the bill should match the
model that answered. Evidence: medium (vendor behaviour;
catalogue drift measured here). Effort: 2 lanes. Depends on:
the owner's answer on whose key pays across accounts (§5) —
the Claude lane says no decision is needed, open work records
it as the owner's Q-REFUSAL-FALLBACK; side taken: open work.
Inside one account and one key, the started lane needs no wait.

**First runners-up** (real value, just outside fifteen): agent
artifacts (alternatives ARTIFACTS — publish an openable page
instead of a wall of text); spec mode on plans-as-files
(SPECMODE); best-of-N that stops when one attempt's checks pass
(harness H6); the three lazy-load start-up lanes
(PERF-PROV, PERF-WIRE, PERF-PREFIX — small, measured, no model
calls; §6 schedules them in gaps); Codex interop refresh (Lane
D: 14 hook events, `AGENTS.override.md`, ACP audit); Cerebras and
the owed preset captures (providers P7); Bedrock design refresh
before any build (P8); Anthropic message threads behind an
opt-in (P4, §5). Measuring activation, turn overhead and team
overhead (PERF-ACT/TURN/TEAM) comes before any claim or redesign
based on them — in that order, TEAM last.

---

## 3. What we should deliberately not do

Merged across all nine reports; each line keeps its reason.

- **No in-process extensions, mods or plugin code in the host.**
  Pi's own security doc concedes extensions are unsandboxed host
  code; Claude needed 30 releases of containment fixes after
  mods. That voids approval cards, paid consent and the secret
  boundary. Hooks, skills and MCP stay the narrower answer.
- **No marketplace or central store.** Catalogues need vetting
  we do not staff, at a measured malicious base rate. Import
  folders people already trust, scanned and previewed (move 13).
- **No hosted cloud of ours, no model resale, no credits of
  ours.** Winning "start with no key" means becoming the markup
  the price revolt is fleeing, against "you bring your own
  credentials". The home node plus headless CI are the honest
  versions of "runs while my laptop is shut".
- **No deny-capable default classifier, no detector as a gate.**
  No-verdict-equals-deny turns a safety service's bad minute
  into an outage, and published defences fall to adaptive
  attack at over 90% (abstract-level, §7). Reviewers stay
  allow-or-ask; rules and protected paths stay in code.
- **Never let the agent propose a standing allow-rule.** Directly
  measured against (58% elicitation). Exact-line session rules
  already give the relief without the surface.
- **No server-held history or opaque server compaction by
  default.** No `store: true` chase on Meta; no provider
  compaction whose summary we cannot audit. Ours stays typed
  and local. Opt-in experiments only, judged on uncached
  prefill (§5 for Anthropic threads).
- **No session tree, no autonomous goal loop.** D46 chose linear
  sessions; D38 chose goals without self-looping turns. Nothing
  in October changes either trade. Take only the
  summarise-what-you-leave slice on rewind, if demand appears.
- **No parallel writers in one tree, no self-rewriting harness
  in the product.** No controlled study supports the first; the
  second is preprint-grade and would optimise against our own
  graders. Offline search through frozen eval arms only.
- **No always-on embedding index as primary retrieval.** Grep,
  structure and language services won that argument in every
  vendor that measured. A semantic _tool_ a person enables is a
  feature choice, not a correctness fix.
- **No tuning to SWE-bench Verified, no judge as sole grader.**
  Verified was retired by its sponsor for contamination and
  flawed tests. Execution grades first; judges advise where
  nothing can run, labelled as such.
- **No native rewrite of our CLI, no panel framework swap, no
  "500+ models" catalogue race.** A 214 MB native rival starts
  slower (1,004 ms) than our 410 ms Node CLI (performance lane,
  measured same machine). Measure first; keep the curated
  catalogue small and correct.
- **No silent defaults copied from peers.** Not Claude's
  off-by-default fail-open sandbox that reads `~/.ssh`, not
  settings that apply without approval, not Codex's
  break-the-client config retirement. Every refusal is said.
- **No chasing SoL-Pi's 49%, Pi's platform pieces, or Windows
  MXC yet.** We already own the economics with the summariser
  priced. MXC needs builds most machines lack and currently
  leaks kernel pool; our Windows story rides Muse Code until
  that changes.

---

## 4. Our story: what we can truthfully say

### True today (code on this base; proof limits stated)

Say these, with the limits attached:

- "Before anything spends your money, it asks — naming the model
  and the price — in every mode, Bypass included, and keeps the
  receipt." The alternatives lane found nobody else doing this
  across editor, ACP, headless, schedules and Tab with one
  ledger. Limit: several surfaces are built but not yet proven
  through the packed product; the sentences that need the
  real-life run stay held until it runs.
- "The only limits on your work are your provider's and the ones
  you set." True as a design with one known breach (the 32,768
  exec refusal) that move 5 removes. Do not use the unqualified
  sentence until that lane lands.
- "One agent for many editors, two backends, your own providers."
  True in code. Limit: first real-editor runs for several hosts
  are still lead-side; per-editor proof is uneven (open work).
- "Small and fast where it counts." Measured on one Linux rig:
  about 2.5k prefix tokens on a typical session against a
  published 16–20k for Claude Code, a 4.3 MB package against
  100–427 MB installs, under 200 KB of our own disk after weeks.
  Limit: turn latency, cache hit rates and panel paint times are
  unmeasured — claim none of them.
- "A cloned repository runs nothing before you trust it, and
  chat cannot leak through a rendered picture." True in code
  (hooks, MCP, rules and skills gated; images render as alt
  text). Limit: MCP descriptions and the read-only hint are
  still trusted — moves 1 and 7 close that; until they land the
  broader claim "tools cannot change under you" is false and
  must not be used.

Do **not** say today: better task scores than anyone (unmeasured
head-to-head, and the one controlled study says harnesses differ
mainly in the bill); "sandboxed" for the Model API shell (it is
unconfined); packing "saves money" (unproven in dollars);
anything held for the real-life run (teams, external lead,
`exec --vault`, Desktop look) or for hosted CI.

### True once the top moves land (each needs its receipt first)

- "Tools you approved cannot quietly become different tools."
  (Move 1, with its drift tests green.)
- "When the provider breaks, your session does not — and it
  tells you what happened in plain words." (Move 2.)
- "Your rules survive a long conversation word for word, and
  our defaults are proven in dollars, published with the
  disagreement." (Moves 4, 6, 9.)
- "Commands physically cannot leave the workspace you approved,
  and the commands you named always wait for your click."
  (Move 10, Linux first — say the platform.)
- "Your agents run on your own PC, you steer them from your
  phone, and the keys never leave the house." (Move 11.)

That combined paragraph — consent-priced, uncapped by us,
pinned against drift, honest through the provider's failures,
steerable from your phone, with a published cost per finished
task — is what "better than the alternative" would feel like
from the chair. No surveyed rival offers that combination.
Each clause still needs its lane's receipt before it goes in a
README; a claim that turns out false gets fixed in code first,
never reworded.

---

## 5. Decisions for the owner

Only the questions a lead cannot settle from PLAN.md. Each has a
recommendation and what happens if nobody answers. Everything
else in §2 fits existing decisions; lead-level calls (the
sensitive-read default, the deferral threshold number, MCP
channels, Judge fast-path harm bound) are named in their moves
and do not need you.

**1. Whose money pays when a fallback crosses accounts?**
(Q-REFUSAL-FALLBACK.) A person lists fallback models across keys
or accounts; the retry spends on a different key than the turn
started on. _Recommendation:_ allow it only within the list the
person wrote, never across a paid-consent or account boundary
without that boundary's existing check, and always say which
model answered. _If nobody answers:_ fallback stays inside one
account and one key (the started lane's safe half ships;
cross-account chains refuse in words).

**2. May a provider hold your conversation server-side?**
Anthropic message threads (providers P4) cut re-upload on long
loops but hold content server-side for up to an hour and are not
zero-retention eligible. This is the same privacy question as
Meta's stored responses, which we refuse by design.
_Recommendation:_ yes, but only as a per-provider opt-in, off by
default, with the retention sentence in the setting and a proven
full-replay fallback. _If nobody answers:_ stay stateless
everywhere (today's posture); the lane does not run.

**3. How does a phone reach the home node?** Move 11 assumes your
own tunnel or LAN certificate, never a relay of ours. A hosted
relay is easier to set up and contradicts the no-cloud line in
§3. _Recommendation:_ own tunnel/LAN only; revisit a relay only
as an explicit product with its own threat model. _If nobody
answers:_ build the LAN/pairing version; anything needing a
relay waits.

**4. When both `AGENTS.md` and `CLAUDE.md` exist, which wins?**
Claude Code prefers `CLAUDE.md`; we prefer `AGENTS.md` (D13). An
imported repository therefore behaves differently here than
there. _Recommendation:_ keep D13 and say so at import time
(one sentence naming the file that won) rather than silently
flipping. _If nobody answers:_ D13 stands and the import
sentence is still owed.

**5. Paid captures and run budgets (one money answer).** Four
small spends wait on your go: the Wonder strict-tools capture
(about 3 short turns at $4/$20 per million — the only way to
un-withhold strict schemas on the flagship model); the enlarged
eval's Phase B live window (about 1,600 attempts, about $0.40
expected, against the frozen $0.50 stop); provider preset
captures (cents per provider on your keys); and Q-REALUSE-KEY —
whether the real-use launcher's bounded key handling is covered
before its first dispatch. _Recommendation:_ approve each with
its stated cap; every one reports its real count afterwards.
_If nobody answers:_ Wonder stays unmeasured, evals run Phase A
only, uncaptured presets stay refused, and the real-use
workflow does not dispatch. Nothing spends by default.

**6. Does M123 (git in every editor) ship whole, or may parts
merge before M104's editors?** Your 2026-10-10 ruling says whole
or not at all; open work asks the lead to put any exception to
you. _Recommendation:_ keep whole-or-not-at-all unless a named
part has its own per-editor receipts. _If nobody answers:_ the
ruling stands; runtime parts stay unshipped and honestly
labelled.

**7. A third backend through Anthropic's Agent SDK?** Driving
Claude through their SDK cannot serve Muse or Model API models
and would import their metering and account model wholesale.
_Recommendation:_ no. Driving their ACP adapter as an external
agent already works through our ACP paths with no dependency.
_If nobody answers:_ no third backend; nothing is blocked.

Standing answers not re-asked here (open work §3 lists them):
extra Meta keys, second sign-ins, the Touch ID capture, the
signing-key ceremony, server and DNS access, OAuth
registrations, publishing accounts, device sessions. Each
unblocks the lane named there and nothing else.

---

## 6. The build order

Briefs are named by report and heading so the lead can launch
each one unchanged. Where two reports brief the same work, one
brief is named as the launch text and the others as its required
reading — do not launch duplicates. Rigs: **linuxlt** (Electron,
Chromium, Docker, QEMU; `ps` works), **macmini** (no Electron or
Chrome, `ps` denied in the sandbox), **Windows PC** (lead's PC,
two agent slots). "Round 10" is the running CC-INT10 merge;
"round 11" is open-work RLF-INT11 on top of it.

### First: land what is already written (before anything new)

Two research lanes left tested fixes on their own branches that
are not on this base. Review and merge them first; they are the
cheapest wins in the whole programme:

- Security lane branch (`rec/rsch-security`): widened protected
  paths (`.gitlab-ci.yml`, pre-commit, composite actions,
  `.npmrc`, …), wider secret redaction, wider credential-name
  filtering, with `test/unit/securityHardening.test.ts`. Until
  merged, §1/§4 verdicts stay as written above.
- Performance lane commit `f6a452642`: agent start no longer
  parses the 533 KB backend (`--version` CPU −21%, `--help`
  −16%, same-rig A/B). Re-measure wall time on a quiet rig as
  part of the review; the lane's loaded-rig wall numbers are
  honestly unquoted.

### The sixteen started lanes, placed (do not re-launch)

In finish order — small and blocking first, capture-led next,
measurement last:

| Started lane    | Is (report + brief heading)                                                                                                       | Rig                       | Waits for                                                                                    |
| --------------- | --------------------------------------------------------------------------------------------------------------------------------- | ------------------------- | -------------------------------------------------------------------------------------------- |
| RLF-OUTPUTCAP   | Muse, Brief D "our 32,768 ceiling stops binding the person"                                                                       | any rig                   | nothing                                                                                      |
| RLF-COMPACTCAP  | Pi, R2 "Summary budget from the model, not a fixed cap"                                                                           | any rig                   | nothing                                                                                      |
| RLF-EDITFUZZ    | Pi, R4+R5 "Edit robustness and BYO error sync" (edit half)                                                                        | any rig                   | nothing; keep §2 guardrails                                                                  |
| RLF-GEMPRIVACY  | Providers, P2 "Gemini storage opt-out and lifecycle honesty" (a)                                                                  | linuxlt                   | store-field capture if needed (≤2 calls)                                                     |
| RLF-SECDEFAULTS | Security, D "Defaults for sensitive reads and memory writes"                                                                      | macmini                   | lead confirm on default (in-brief)                                                           |
| RLF-SECTEXT     | Security, E "Warn on hidden characters" + H "Random fences"                                                                       | macmini                   | nothing                                                                                      |
| RLF-FIRSTRUN    | Muse, Brief G "first-run dead-ends leave evidence"                                                                                | macmini                   | nothing                                                                                      |
| RLF-EMPTYCAT    | Muse, Brief F "empty-catalogue survival"                                                                                          | linuxlt                   | nothing to start; live fault may be unreachable (brief says stop and report, never simulate) |
| RLF-MUSEUSAGE   | Muse, Brief B "`muse usage` allowance"                                                                                            | any rig with muse ≥1.4.13 | own capture of `muse usage --json`                                                           |
| RLF-UPSDK       | Muse, Brief A "SDK 1.4.13/1.4.14 and the new MSP payloads"                                                                        | macmini or linuxlt        | 1.4.14 window (2026-11-03); captures first                                                   |
| RLF-UPDEPS2     | Providers, P3 "ACP pin" (pin half) + dependency currency                                                                          | linuxlt                   | per-version 7-day windows                                                                    |
| RLF-SECMCP      | Security, A "Pin MCP tool definitions" + B "read-only hint only from pinned servers"                                              | macmini                   | lead confirm superseding D42 sentence (in-brief)                                             |
| RLF-FALLBACK    | Claude, R7 "Person-set model fallback chain"                                                                                      | linuxlt                   | §5.1 for cross-account half only                                                             |
| RLF-EVALTASKS   | Harness, 4-H1 "Eval task realism + repeats"                                                                                       | linuxlt                   | lead go + budget for live phases                                                             |
| RLF-PINNED      | Harness, 4-H2 "Verbatim constraint pinning across compaction"                                                                     | linuxlt                   | RLF-EVALTASKS tasks (brief's fallback: author 4 tasks first)                                 |
| RLF-DEFERTOOLS  | Pi R3 + Harness 4-H4 as launch pair (Claude R1, Providers P6, Muse E are the same work — required reading, not separate launches) | linuxlt                   | RLF-EVALTASKS for the default call; per-provider capture (P6) for Anthropic wire             |

### Wave 1 — launch now, no merge dependency (on current int)

1. Muse, Brief C "served-run flags: no parked questions,
   presets offered" (linuxlt/macmini). Small; closes move 2.
2. Providers, P1 "Structured outputs on the Anthropic and
   Gemini wires" (linuxlt). Capture first (≤4 calls/provider).
3. Pi R1 + Harness 4-H3 as one eval lane "Prove packing on
   dollars" / "Elision-only packing arm" (linuxlt or kubuntu).
   Contributor model only, counts and cap stated first. Runs
   behind RLF-EVALTASKS Phase A if both want the live window.
4. Performance, PERF-PREFIX "Freeze the per-request prefix",
   PERF-WIRE, PERF-PROV (linuxlt, in that order). No model
   calls; ideal gap-fillers. PERF-SCOPE only after a quiet-rig
   re-profile.
5. Claude, R6 "Hardening pass from Claude's fix list (prove
   first)" (linuxlt). Each item needs its failing reproduction
   before any fix; clears the stale D42 sentence on the way.
6. Codex, Lane D "Codex interop refresh" (macmini): 14 events,
   `AGENTS.override.md`, codex-acp pointers, read-only ACP
   audit. The audit's gaps go to the lead, built nowhere here.
7. Open-work no-dependency set, in its order: RLF-HOST151
   (linuxlt; unblocks the one red-by-design gate), RLF-WONDER
   (macmini), RLF-UNPROVEN (macmini, no live calls),
   RLF-M104REST, RLF-M103WIRE (linuxlt), RLF-M105BIND,
   RLF-M98BIND, RLF-M102BYO, RLF-M112HOSTS, RLF-NODESERVE
   (linuxlt, after the lead accepts the threat model).
8. Harness, 4-H5 "Binding judge arms + effort/tools-lean pairs"
   (linuxlt) once RLF-EVALTASKS freezes; Claude R8+R10 "Cost
   attribution, script statusline, output styles" (linuxlt) as
   capacity allows.

### What waits for round 10, then round 11

**Round 10 (CC-INT10, running)** blocks only round 11. Nothing
in Wave 1 waits for it; do not idle rigs waiting.

**Round 11 (open-work RLF-INT11, macmini, wonder)** merges, in
its stated order: smallfix1/2, cifixa, unicorn79, hosts2,
m115t, m96crec, m104lc, judgep2, m125, m109h (after RVM109H),
acpteam, then the five M111 sub-lanes. Everything below waits
for round 11 because it builds on merged work, not on parallel
truths:

- Claude R4 "ACP draft-v2 + subagent child sessions" (linuxlt)
  — after acpteam lands; Providers P3's housekeeping half rides
  the same lane or immediately before it.
- Open-work on the INT11 head: RLF-M96CERT2, RLF-M115CERT
  (linuxlt), RLF-M109REST (linuxlt, wonder), RLF-M125MAC
  (macmini, wonder), RLF-M111A0, then RLF-M123UQ
  (needs RLF-HOST151 too) and RLF-M124T (macmini, wonder).
- Chains: RLF-M108BIND after RLF-M109REST; RLF-M100SEND beside
  RLF-M103WIRE; RLF-M95REST as captures land, RLF-M95C after
  it; RLF-PLANARCH once the PLAN diffs settle.
- M111 waves last, in the plan's order (A0, A+B, W, I, OS, C,
  X), all linuxlt.

### Wave 2 — the large new work (after Wave 1 reads out)

In launch order, each with its decision gate:

1. Claude R3 "Fork subagents + built-in Explore/Plan agents"
   (linuxlt). Then Claude R9 skills slice gets its brief.
2. Claude R2 "Faithful compaction + idle compaction" (linuxlt)
   — only the truncate-never-rephrase rule plus idle compaction;
   the model-managed pilot stays behind its capability flag.
   Needs the D81.4 amendment first (in-brief).
3. Codex Lane A "Confine the Model API shell on Linux"
   (linuxlt, wonder) after its new PLAN decision; then Lane B
   "human checkpoint" and Lane C "grant blast radius"
   (macmini). Security C "Provenance-tagged tool results"
   follows A–C; F "Per-server consent" after RLF-SECMCP's store;
   G "Entropy pass for scan-secrets" any time (scanner only).
4. Claude R5 "Claude plugin directory import" (linuxlt) after
   its D-entry and manifest captures; Alternatives 4.4
   AGENTPACK after R5 proves the conversion path.
5. Alternatives 4.1 NODEREMOTE (linuxlt) after §5.3 and
   RLF-NODESERVE; 4.3 ARTIFACTS (linuxlt) any time after;
   4.5 SPECMODE (linuxlt) after ARTIFACTS if one slot must
   choose; 4.2 COSTPROOF (linuxlt) once RLF-EVALTASKS Phase A
   receipts exist.
6. Providers P2 remainder (lifecycle honesty, linuxlt), then
   P5 "Fast/priority modes" (needs D-FAST, a lead decision
   under D121/D48 — not held for the owner), P7 "Preset
   completion" (linuxlt, keys via stdin only), P8 "Bedrock
   design refresh" (docs only; build brief follows it, needs
   the owner's AWS account). P4 "Anthropic message threads"
   only after §5.2.
7. Muse Brief H "Windows rename/fork by capability" (**Windows
   PC only** — real Windows required); Brief I "Wonder strict
   tools" only after §5.5; Brief J "MSP parity" halves land
   independently, UI home decided in PLAN first. Pi R6+R7
   (rewind summaries need the one-line D46 addendum; image
   downscale needs its audit) as capacity allows.
8. Measurement lanes in order: PERF-ACT (rig that can drive
   VS Code), PERF-TURN (linuxlt, counted contributor calls),
   PERF-TEAM last. Harness 4-H6 "Best-of-N execution selection"
   after PERF-TURN's harness exists. No teams redesign before
   PERF-TEAM reads out.

### The Muse allowance deadline (read this before scheduling)

Muse's weekly allowance is expected to run out around the
morning of **2026-11-03** and resets **2026-11-08 at 16:00
PST**. After that, only Grok and two Claude agents on the
lead's PC run, plus about $64 of Claude API credit and $60 of
authorised spending. Plan for the rigs going quiet, not slow:

- **Before the morning of 2026-11-03 (must run now):** every
  started rig lane to a committed checkpoint (hooks on, nothing
  left only in a worktree); the wonder-tier judgements only
  Muse can cheaply make here — Codex Lane A's decision draft,
  Security C's threshold proposal, the RLF-SECMCP design review;
  and any contributor-model turns that captures depend on
  (RLF-UPSDK served captures, RLF-EVALTASKS Phase A counts,
  packing-arm counts), each with its expected count stated
  first. SDK 1.4.14 becomes eligible on 2026-11-03 — pin it in
  RLF-UPSDK before the allowance dies if the lane is ready, or
  leave the bump as the lane's first post-reset commit; never
  bypass the 7-day rule to beat the clock.
- **2026-11-03 → 2026-11-08 (the gap):** the two Windows-PC
  Claude slots are the scarcest resource. Spend them on what
  only they can do: CC-WINTEAM/CC-CIFIXW already running there,
  then Muse Brief H's Windows probe and round-11 integration
  judgement. Give Grok only mechanical, well-fenced lanes with
  no live calls: PERF-WIRE/PERF-PREFIX, Codex Lane D's table
  half, catalogue sync drills. Paid captures in the gap come
  out of the $124 and only where they unblock the most:
  Providers P1 captures first, then preset captures; the
  Wonder capture (pennies) any time after §5.5. No eval live
  window in the gap — it needs contributor headroom and a
  witness; queue it for the reset.
- **From 2026-11-08 16:00 PST:** RLF-INT11 first (it unblocks
  the longest list), then Wave 1 remainders in order, then the
  live windows (eval Phase A/B, packing arms, PERF-TURN) with
  counts stated fresh. Everything in Wave 2 can wait for this
  without harm; nothing in Wave 1 should.

Hosted CI on the merged head, the real-life run, and every
lead-only live check in open work §4 remain the release gate
behind all of the above. No sentence in §4 becomes a README
claim until its receipt exists there.

---

## 7. What to check before believing any of this

Each row: the claim, what it rests on today, and the check that
settles it. Run the check before building on the claim.

| Claim                                                                                                                               | Rests on                                                                                           | Check that settles it                                                                                                                               |
| ----------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------- |
| Packing can cost more than it saves under caching (arXiv:2610.34763)                                                                | Abstract + excerpts in two lanes; different policy (re-masking) from ours (replace-once)           | Move 4's dollar arms; read the full text first and confirm the arm definitions match our placeholder policy                                         |
| SoL-Pi saves 49% tokens / 33% cost                                                                                                  | One paper, 51 tasks, no intervals in the read text; ≈6% score loss in its own table                | Do not replicate for its own sake; judge our defaults on move 4/9 receipts instead                                                                  |
| Truncate-only compaction beats summaries (CliffCompaction); models can manage own context (CTXAgent)                                | Single-lab preprints, full text read by one lane, no replication                                   | Move 6's planted-fact tests + paired eval before any default change; CTX pilot only per capability record                                           |
| Elision matches summarisation; recovery unused (JetBrains; Fan et al.)                                                              | Controlled, code released; Fan's models are open/mid-tier, sizes may not transfer                  | Move 4's natural-recall tasks on our models                                                                                                         |
| Summaries drop side constraints (17–33% figures)                                                                                    | Four 2026 preprints, magnitudes unsettled, direction consistent                                    | Move 9's side-constraint tasks measure it here before move 6 claims a fix                                                                           |
| Deferred tools cut ~85% / raise accuracy (Anthropic)                                                                                | One lab's production evals, method summarised                                                      | Move 3's paired run on uncached prefill + dollars; ship only if it wins                                                                             |
| Tool-tax 95% cut (arXiv:2604.21816); teams 2× slower (Anthropic note)                                                               | Simulated benchmark; secondary reports, primary unfetched, enterprise not coding                   | Already discounted in §2; PERF-TEAM measures teams here before any redesign                                                                         |
| Harness decides the bill; output caps cost scores (arXiv:2610.04433, 2608.01347)                                                    | Preprints; no Muse model in the first; one price list                                              | Direction only until COSTPROOF publishes our rerun-calibrated number                                                                                |
| Rules files hurt (−0.5–3%, +20% cost, arXiv:2602.11988)                                                                             | One study, abstract-level in-lane                                                                  | Harness H8's optional pair with/without our own `AGENTS.md`; show the meter regardless                                                              |
| Agent-proposed rules elicited 58%; composition 96.6%; defences bypassed >90%                                                        | Abstracts read; full texts unread in-lane                                                          | Re-read Yang et al. in full in Codex Lane C's certification (its brief already requires this); treat sizes as claims until then                     |
| Malicious skills 157/98,380 (USENIX 2026)                                                                                           | Abstract + secondary reporting                                                                     | Read the technique list at source in Claude R5 before finalising scanner rules                                                                      |
| Security CVE details (2025-59536 and kin); Codex Guardian timeout / free review; Claude "80% prompt cut"                            | Secondary indexes and summaries; two CVEs corroborated, rest not re-verified against NVD/primaries | Verify any CVE cited in a future brief against NVD or the vendor record first; Guardian figures stay "unconfirmed" (Codex lane already marks them)  |
| Closed-product features and prices (Cursor, Kiro, Warp, Copilot)                                                                    | Changelogs and secondary trackers; Warp dollars differ between reads; no hands-on run              | Re-read vendor pages on the day any comparison is published; never quote a price without its read date                                              |
| Windows fork/rename works now; Wonder takes strict tools; Gemini accepts `store=false`; Anthropic threads behave under tool changes | Changelogs and docs only; last Windows probe is 1.4.3-era                                          | Captures first, per rule 14: Brief H probe (win11), Brief I (≤3 paid turns), P2 (≤2 calls), P4 (≤6 calls) — counts stated before, real counts after |
| Bedrock/Vertex shape; LM Studio currency; ACP v2 editor uptake                                                                      | Not re-read first-hand in these lanes                                                              | Providers P8 reads AWS/GCP docs first-hand (design only); P3 advertises capabilities clients may ignore safely                                      |
| Pi `pi-schema` 2,222/2,223; SoL-Pi Visual 37%                                                                                       | Vendor/example claims, not reproduced                                                              | No build depends on either; leave as claimed                                                                                                        |
| "Our compaction / packing / teams are better" (any lane's phrasing)                                                                 | Code-read design arguments; two binding compaction runs only                                       | Moves 4, 6, 9 and PERF-TEAM receipts; until then §4's wording is the ceiling                                                                        |
| Performance absolutes (410 ms start, 2.5k prefix)                                                                                   | One shared Linux rig; ÷4 token estimates; rival RSS caveats in-lane                                | PERF-ACT/TURN on a quiet rig through the packed product; provider-side usage as truth, never harness-side math alone                                |

One last check, on this document itself: line citations were
verified on `72d8d5003` on 2026-11-02 and drift as soon as code
moves. Any lane launched from §6 re-verifies its cited lines
first — every brief already says so.

## Sources

The nine reports (all 2026-11-02, base `rv/int9` `72d8d5003`):
`pi-solpi`, `claude-code`, `codex`, `alternatives`, `muse-code`,
`providers`, `harness-science`, `agent-security`,
`performance`; plus `open-work.md`. Each carries its own source
list with dates and versions; nothing here adds a source they
did not read. Code facts marked "verified" were re-read in this
worktree for this synthesis; everything else is attributed to
its lane at the strength that lane gave it.
