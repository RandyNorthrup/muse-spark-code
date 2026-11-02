# The alternatives, 2026-11-02 (RSCH-ALTS)

Research lane RSCH-ALTS, read 2026-11-02 on `linuxlt`, base `rv/int9`
`72d8d5003`. It follows
[competitive-landscape-2026-09.md](competitive-landscape-2026-09.md)
(2026-09-27) and covers everything since: T3 Code, OpenCode, Cursor,
Windsurf (now Devin Desktop), Cline, Roo Code, Kilo, Aider, Goose, Zed,
Gemini CLI / Antigravity, Copilot (CLI, agent mode, cloud), Amp, Crush,
Kiro, Warp, and new entrants. Claude Code, Codex, Pi/SoL-Pi, Muse Code
and providers are other lanes' topics; they appear here only where an
alternative wraps or competes with them.

**Method and honesty marks.** Primary sources read this week: shallow
clones of four repositories (HEAD SHAs below), the unauthenticated
GitHub API for repo and top-reacted-issue data, vendor changelogs, and
one arXiv paper read in full abstract plus its reported method. A claim
marked _(code)_ was read in a clone; _(api)_ came from the GitHub API on
2026-11-02; _(vendor)_ is the vendor's own page; _(secondary)_ is a
third-party write-up and was not independently verified. No account, no
sign-in, no paid call was used; closed products were read through their
public changelogs and docs only, so their internals are unverified.
Prices change monthly in this market (Cursor changed its whole lineup
on 2026-10-12); every price below carries its read date.

Clones (under this lane's gitignored `temp/research/clones/`, deleted
after the lane; ideas only, no code copied):

| Repo                       | HEAD (2026-11-02) | Licence _(api)_ | Stars _(api)_ |
| -------------------------- | ----------------- | --------------- | ------------- |
| `anomalyco/opencode`       | `cce323b`         | MIT             | 224,067       |
| `pingdotgg/t3code`         | `9bcf7533`        | MIT             | 41,159        |
| `Cline/cline`              | `2565527`         | Apache-2.0      | 71,219        |
| `Kilo-Org/kilocode`        | `bbb66f6`         | MIT             | 27,833        |
| `aaif-goose/goose`         | not cloned        | Apache-2.0      | 56,143        |
| `Aider-AI/aider`           | not cloned        | Apache-2.0      | 49,908        |
| `charmbracelet/crush`      | not cloned        | NOASSERTION¹    | 28,918        |
| `google-gemini/gemini-cli` | not cloned        | Apache-2.0      | 108,675       |
| `github/copilot-cli`       | not cloned        | NOASSERTION¹    | 11,327        |
| `zed-industries/zed`       | not cloned        | NOASSERTION¹    | 92,564        |
| `RooCodeInc/Roo-Code`      | archived _(api)_  | Apache-2.0      | 24,256        |

¹ NOASSERTION means GitHub could not classify the licence file; check
the repo's own `LICENSE` before any port. Crush is FSL-1.1-MIT
_(secondary)_ — source-available, converts to MIT after two years; a
port today is **not** plain MIT. Zed is GPL/AGPL/Apache by component
_(secondary)_; treat as read-only reference.

## 1. What is new or what we had not read

### 1.1 The September gaps are closed — the landscape moved anyway

The September report ranked 13 gaps for us. On this base they are
built: verify loop (M68, `src/core/verify/checkCommands.ts:36`,
`src/host/vscode/editor/verifyEditor.ts`), code intelligence (M67,
`src/core/codeIntel/codeIntelTools.ts:425`), web fetch (M69,
`src/core/web/webFetch.ts:74`), review (M70,
`src/core/review/reviewMaterial.ts:35`), git/PR (M71 + M123,
`src/core/git/`), turn checkpoints (M72/M86, `src/core/checkpoints/`),
observation packing (M73, off by default after its measured run),
auto-compaction and handoff (M74), custom agents (M76), session board
and best-of-N (M77, `src/core/sessionBoard.ts:13`,
`src/core/bestOfN/bestOfN.ts:15`), safer Auto (M78/M90, now the Judge,
M98/M125, `src/core/judge/`), headless/CI (M80, `src/runtime/exec/`),
browser check (M81, `src/core/browser/browserTool.ts:42`), Tab (M94,
`src/core/tab/tabEngine.ts:25`), session share (M84,
`src/core/sharing/chatShare.ts:16`). PLAN.md statuses at
`PLAN.md:14187`–`14861` agree with the tree; no stale box found in
this set. The field's centre of gravity has since moved to five
things the September report did not rank: **cloud/hosted sessions,
phone control of local agents, publishable artifacts/canvases,
agent marketplaces, and price revolt**. Those are §1.2–§1.6.

### 1.2 Cloud and "work from anywhere" is now table stakes at the top

- **Copilot** shipped a "connected Copilot cloud experience"
  (2026-10-28, Universe): cloud agent sessions persist across VS Code,
  GitHub Mobile, github.com and Copilot CLI; cloud sandbox compute
  bills against the Actions allowance from November 2026; Copilot
  Automations run in the cloud from VS Code 1.144; local sandboxing
  went GA 2026-10-07 _(vendor: github.blog/changelog, read 2026-11-02)_.
- **Cline** 4.1.25–4.1.26 added Cline Cloud sessions: a task runs in a
  hosted sandbox on a chosen GitHub repo/branch, shows in History,
  notifies on finish, keeps running after the editor closes
  _(code: `cline/CHANGELOG.md` [4.1.25], [4.1.26] at `2565527`)_.
- **Cursor** cloud agents gained shareable interactive **canvases**
  and an Environments API beta (2026-10-16), self-hosted machines
  (2026-09-02), and **Projects** GA (2026-10-06): a coordinator agent
  delegates to subagent fleets with shared persistent context
  _(vendor changelog via secondary summaries, read 2026-11-02)_.
- **Kilo** runs a Cloud Agent at `app.kilo.ai/cloud` and hosted PR
  code reviews _(code: `kilocode/README.md` at `bbb66f6`)_.
- **Warp Oz** (2026-02-10) is cloud agent orchestration with
  event triggers (Slack/Linear/GitHub), schedules and audit trails
  _(secondary)_.
- Octoverse 2026 (2026-10-28): over 40% of GitHub PRs now start as a
  coding agent's first draft, up from 17% in March; review is named
  the bottleneck _(vendor, via secondary)_.

Our answer is deliberately different: the **home node** (M110a0,
`src/runtime/node/args.ts:11`; README.md:842 "Muse Node is Muse Spark
Code on your own machine") puts the always-on computer in the
person's house, not a vendor cloud. That is a real differentiator
(no per-minute sandbox bill, code never leaves), but it is **partial**
against this row: there is no hosted option for a person with no
spare machine, and no phone app (see §1.3). Verdict: **partial,
deliberately** — the gap to close is reach (phone/web onto the node),
not a vendor cloud of our own.

### 1.3 Phone control of _local_ agents is the new remote story

- **T3 Code** repositioned as an "agent harness control surface":
  iOS/Android apps, web app and Electron desktop controlling Claude
  Code, Codex, Cursor, Grok Build, OpenCode, Antigravity and `fx`
  already installed on your machine; `t3 service install` keeps the
  server running _(code: `t3code/README.md` at `9bcf7533`)_.
- **Cursor** added remote control of _local_ agents from its iOS app
  (2026-10-06): see and reply while code stays on your computer
  _(vendor via secondary)_.
- **Conductor** (macOS-only orchestrator) added cloud workspaces,
  an API/MCP server, scheduled Routines and an iOS app (2026-10-02)
  _(secondary)_. **Superset** and **Paradev** are the same shape:
  no models of their own, they run other vendors' agents in parallel
  worktrees _(secondary, read 2026-11-02)_. None ships Windows;
  Conductor is macOS + iOS only as of 0.90.0 _(secondary)_.
- **Amp** threads started in the CLI can be watched, messaged and
  cancelled from ampcode.com (Neo CLI, staged from 2026-05-06)
  _(secondary)_.

We have the node and an MCP connector for other agents (M124) but no
phone surface and no "control the agents already on this machine"
pitch. T3's top-reacted open issue (37 reactions _(api)_) asks to
_also_ manage vendors' **cloud** sessions from inside T3 — users want
one pane for local and cloud. Verdict for us: **missing** (phone/web
control of the node), and it is the single most repeated new feature
across the field since September.

### 1.4 Artifacts/canvases: agents publish, not just patch

- **OpenCode** v2.2.4 (2026-10-30) added opt-in **artifacts**:
  `artifact_create/read/update/delete` tools, a built-in local
  static-file provider, plugin-provided storage, SDK surface
  _(code: `opencode/CHANGELOG.md` v2.2.4 at `cce323b`)_.
- **Cursor** cloud agents build interactive canvases shareable by
  link (2026-10-16) _(vendor via secondary)_.

We can share a transcript (`src/core/sharing/`, HTML + secret gist)
and render reports (`src/runtime/reporting/`), but the agent has no
tool to publish a living HTML artifact the person can open, refresh
and share. Verdict: **partial → missing** for the agent-facing tool.

### 1.5 Marketplaces and agent-as-folder packaging

- **OpenCode** v2.2.0 (2026-10-27): create, install and share
  **desktop GUI plugins** (experimental); plugins can attach keyed
  session-instruction entries that survive compaction without busting
  the prompt cache; experimental image and **decision-model APIs**
  (TypeSafe/System One class models as a provider type) _(code)_.
  Its users' 5th most-reacted open request is a plugin/agent/skills
  marketplace (45 _(api)_), and the 1st is an official VS Code
  extension (177 _(api)_) — a surface we already are.
- **Cursor Agent SDK** GA (2026-10-20): an agent is a project folder
  — `instructions.md`, `tools/`, `skills/`, `mcp-connections/`,
  `channels/` — tested with evals, deployed with one command, woken
  by PR/CI/Slack/webhook/cron events _(vendor via secondary)_. SDK
  1.0.31 added live steering (`run.steer()`) and background subagent
  results returning to the parent run _(secondary)_.
- **Cline** shipped Plugins + a Customize marketplace (custom tools,
  workflows, skills, MCP) _(code: `cline/CHANGELOG.md`)_; **Kilo**
  ships a Marketplace for agents, skills, MCP servers and plugins
  _(code: `kilocode/README.md`)_. **Goose** recipes remain the
  open-source reference: YAML workflows with parameters, retry and
  cron, runnable headless _(secondary; Apache-2.0)_.

We have skills, custom agents, bundled skills (M89) and import from
other agents (M83/M91), but no installable-package story and no
marketplace; a person cannot publish "my reviewer agent" for another
Muse Spark Code user to install in one click. Verdict: **missing**.
Note D101/M116 already made orchestration rules code, not documents —
a package format must not smuggle a playbook back in (AGENTS.md,
owner rules).

### 1.6 The price revolt is the market's loudest signal

- **Cursor** moved new plans into "The X Subscription" (2026-10-12):
  Plus $8 runs **only Cursor's own (Grok) models**; third-party
  models (Claude/GPT/Gemini) bill at API rates from prepaid credit on
  Premium $30 / Super $100 / Ultra $200; the old $20 Pro is closed to
  new buyers; users publicly warn that unifying subscriptions loses
  Cursor credits _(vendor pricing page via multiple secondary reads,
  2026-11-02)_. Cost is the most-cited Cursor complaint in comparative
  reviews _(secondary)_.
- The winners of the revolt are the zero-markup crowd: **OpenCode**
  (free app, BYOK, optional Go $10/mo _(secondary)_), **Kilo** ("500+
  models … pay the model provider's rate with zero markup. No API
  keys required to start" _(code: README)_), **Amp** (pay-as-you-go
  at provider price, no markup for individuals/teams; Enterprise
  +50% _(secondary)_; its ad-supported free tier is paused
  _(secondary)_).
- **Windsurf** retired credits for daily/weekly quotas (2026-03-19)
  and raised Pro $15→$20 _(secondary)_; it is now **Devin Desktop**
  (Cognition, rebranded 2026-06-02; Cascade retired for "Devin
  Local" with subagents and an Agent Command Center; Wave 13 added
  parallel multi-agent sessions, worktrees, side-by-side panes;
  SWE-1.5 free for 3 months) _(vendor: docs.devin.ai, read 2026-11-02)_.
- **Kiro** (AWS): GA 2025-11-17, IDE 1.0 mid-2026; credit pricing —
  Free 50 credits, Pro $20/1,000, Pro+ $40, Pro Max $100, Power $200,
  $0.04 overage _(secondary, consistent across four reads)_.
- **Zed**: editor free; Pro $10/mo with $5 hosted credit then API
  list +10%; BYOK/ACP unlimited on free _(vendor via secondary)_.
- **Warp**: terminal free; Build $18–20/mo (1,500 credits), Max
  $180–200, Business $45/user _(secondary; two reads differ on
  monthly vs annual price — unverified to the dollar)_.

Our story — free product, "You bring your own credentials"
(README.md:33), provider limits only, consent before every paid use
(D48, `src/core/paid/paidConsent.ts`) — is exactly what the revolt
asks for, and **better** than every row above on the consent point:
nobody else asks, by price and model, before each paid call, in
every mode including Bypass, and keeps a cross-window daily ledger
for Tab (M94). What we lack is saying so where switchers look, and a
no-key first run (Kilo's "no API keys required to start" is a hosted
gateway — we cannot match it without becoming a reseller; see §3,
NOT-to-do).

### 1.7 Consolidation, deaths and forks since September

- `sst/opencode` now redirects to **`anomalyco/opencode`** _(api)_.
  OpenCode is on **v2** (v2.2.5, 2026-10-30 _(code)_): server +
  TUI + desktop + web, persistent session PTYs shared across windows,
  scheduled prompts coordinated across server processes, Claude Code
  usable as a provider ("Claude Agent", v2.2.3).
- **Kilo's CLI is now built on OpenCode's codebase** — its repo
  carries the same `packages/` shape (`codemode`, `core`,
  `effect-drizzle-sqlite`…) _(code: `kilocode/packages/` listing at
  `bbb66f6`)_. Inference: the Roo fork lineage converged on OpenCode
  as the open harness substrate. _(inference from tree layout)_
- **Roo Code**: repository archived _(api: `archived: true`, last
  push 2026-05-15)_. Dead; its users are Kilo's funnel.
- **Aider**: not archived, but stalled — last commit 2026-05-22
  _(api)_, last release 0.86.2 (2026-02) _(secondary)_. Its repo map
  idea lives on everywhere (we have `src/core/codeIntel/repoMap.ts`);
  the product no longer sets the pace.
- **Goose**: Block donated it to the Linux Foundation's Agentic AI
  Foundation (Dec 2025, alongside MCP and AGENTS.md); repo is now
  `aaif-goose/goose`, still Apache-2.0, pushing daily _(api +
  secondary)_. Desktop + CLI + API, 15+ providers, 70+ MCP
  extensions, recipes, ACP.
- **Gemini CLI**: Google stopped serving consumer accounts
  2026-06-18; the replacement is **Antigravity CLI** (`agy`, a Go
  rewrite sharing the Antigravity desktop harness; parallel
  subagents; skills/hooks/subagents carried over, extensions become
  plugins) inside the Antigravity 2.0 family (desktop manager, CLI,
  IDE fork, SDK, managed agents) _(secondary, multiple consistent
  reads)_. The `google-gemini/gemini-cli` repo still pushes _(api)_
  — enterprise/API-key use continues; do not treat it as dead, treat
  the _consumer_ route as moved. For us this matters to M83/M91
  import and to which external agents M124 should drive.
- **Crush** (Charm): steady; its differentiator remains on-demand
  LSP context in a terminal agent and mid-session model switching
  _(secondary)_. We match both (M67; model roles, M96).
- New entrants worth one line each: **JetBrains Air** (multi-agent
  desktop _(secondary)_), **Grok Build** (xAI CLI; a T3-supported
  harness _(code: t3 README)_), **fx** (fx.sh, T3-supported
  _(code)_), **DeepSeek `dsh-superagent-prototype`** (2026-10-31,
  MIT research code: one resident Router dispatching isolated
  Workers, proactive from GitHub events _(secondary)_ — a design
  paper with code, not a product), **Ruflo** (meta-harness over
  Claude Code/Codex _(secondary, vendor press release — weakest
  evidence in this report)_).

### 1.8 What users ask for most (issue trackers, _(api)_ 2026-11-02)

Top-reacted **open** issues, the closest thing to a vote:

- **OpenCode**: official VS Code extension (177); sandbox the agent
  (89); search in TUI session buffer (79); MCP Apps in desktop (61);
  "Auto mode" LLM classifier for permission auto-approval (48);
  marketplace (45). → We are a VS Code extension; we have the Judge
  (M98/M125) where they ask for a classifier; our sandboxing is
  OS-level on the Muse Code backend (D12) and Judge-gated Auto on
  Model API. Their #2 and #6 are our strengths — worth saying.
- **Cline**: weaker-model prompt complexity pain (60); terminal
  integration reliability across shells (29); context-window and
  large-file truncation limits (10+10). → Mirrors our M73/M106 work;
  the lesson is that truncation limits users can see and raise beat
  silent caps (our D121 stance already).
- **T3 Code**: manage vendors' cloud sessions too (37); a telemetry
  trust complaint — "promise no opt-out telemetry while telemetry
  has been on" (21); permission patterns ignored in Auto (20). →
  Trust is a feature: our no-telemetry, machine-scoped-settings and
  consent posture (D48, D4) is a demonstrable edge here.

### 1.9 The research result that should change our roadmap talk

Liu & Han, **"What Does a Harness Buy? Tokens, Mostly"**
(arXiv:2610.04433, 2026-10-03; read 2026-11-02; 22 pp., code and
data public). Five models × three production harnesses (Claude Code,
mini-SWE-agent, OpenCode) on SWE-bench Verified, with same-config
reruns to calibrate noise. Findings: (a) heaviest vs lightest
harness are equivalent within 5 points on 447 tasks; harness swaps
flip as many tasks as reruns do (13% both); (b) the one effect that
clears noise is a _loss_ — OpenCode trails up to 9 points, half of
it on one model from runs its **output cap cut short**; (c) what the
harness decides is the **bill**: up to 3× cost per task at fixed
model and price list, set at the first call by the preamble (system
prompt + tool schemas) and scaled by step count; (d) 45-task
comparisons catch a 13-point gap only half the time — most claimed
harness gains are under-powered. Limits: preprint, SWE-bench only,
five models (no Muse model), one price list. It agrees with our own
M73 measurement (packing sent 39% fewer input tokens at about the
same cost because the removed tokens were cache reads) and with
SoL-Pi's held-out results (September report). Consequences for us:
compete on **cost per solved task and on not truncating** (D121 is
literally the anti-OpenCode-gap policy), keep the preamble lean,
and never claim a harness win from a small task set — M75's paired
design with capability floors is the right shape; a bigger task set
is worth more than another mechanism. Adjacent October work points
the same way: harness self-revision from execution logs (RHO /
HarnessPro line, reported 2026-11-02 _(secondary; paper not read)_)
buys cost, not magic — and self-modifying harness code is exactly
what our no-playbook rule forbids shipping unreviewed.

## 2. The matrix

### 2.1 Each product in one breath

Best = what it does best; Unique = what only it has; Asks = its users'
loudest request (§1.8 or vendor forums, marked); Price read 2026-11-02.

| Product                                 | Best at / Unique                                                                                                                                      | Multi-agent & desktop                                                                        | Model & price story                                                                                 |
| --------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------- |
| **Muse Spark Code (us)**                | Consent before every paid use; two backends never mixed; 15 languages; WCAG gate. Unique: home node on your own PC; Judge (own calibrated classifier) | Teams/roles/playbook in code (M96/M116); best-of-N (M77); ACP to other editors; no phone app | Free product; BYO Muse Code sub or Model API key + BYO providers (M95); provider limits only (D121) |
| **OpenCode** (MIT)                      | Open harness substrate; 75+ providers; server behind TUI/desktop/web. Unique: artifacts API, decision-model providers, cache-safe instruction entries | Build/Plan + subagents; schedules multi-process-safe; desktop plugins                        | Free + BYOK; Go $10/mo optional _(sec.)_                                                            |
| **T3 Code** (MIT)                       | Controlling agents you already have, from phone. Unique: harness-agnostic remote control surface                                                      | Parallel threads/worktrees over 7 harnesses; mobile + web + desktop                          | Free; rides your existing subscriptions                                                             |
| **Cursor** (closed)                     | Cloud agents at scale; canvases; Agent SDK (agent-as-folder + evals). Unique: computer use on your desktop (2026-10-23 _(sec.)_)                      | Projects: coordinator + fleets; iOS remote for local agents                                  | X Subscription: Plus $8 own-models-only; Premium $30+ with API-rate third-party usage               |
| **Devin Desktop** (ex-Windsurf, closed) | Autonomous local agent (Devin Local) + Agent Command Center; own SWE-1.5 model                                                                        | Parallel sessions, worktrees (Wave 13)                                                       | Free tier; Pro ~$20 _(sec.)_; quotas not credits                                                    |
| **Cline** (Apache-2.0)                  | VS Code/JetBrains/CLI/SDK from one core; huge provider catalog. Unique: ClinePass + cloud sandboxes in an OSS client                                  | Subagents/teammates (SDK); cloud tasks survive editor close                                  | Free + BYOK; ClinePass hosted models                                                                |
| **Kilo** (MIT)                          | Zero-markup 500+ models, start with no key. Unique: hosted gateway pricing transparency                                                               | Built on OpenCode; cloud agent + hosted PR reviews; VS+JetBrains+CLI                         | Provider rate, zero markup (_code_)                                                                 |
| **Goose** (Apache-2.0, LF AAIF)         | MCP-native everything; recipes. Unique: foundation governance with MCP/AGENTS.md                                                                      | Subagents; desktop+CLI+API; schedules                                                        | Free + BYOK/local                                                                                   |
| **Crush** (FSL-1.1-MIT)                 | Terminal polish; on-demand LSP context; runs on BSDs/Android term                                                                                     | Sessions per project; mid-session model switch                                               | Free + BYOK                                                                                         |
| **Aider** (Apache-2.0)                  | Git-native pair programming; repo map (now table stakes)                                                                                              | Architect/editor split only                                                                  | Free + BYOK; **stalled** (§1.7)                                                                     |
| **Roo Code**                            | Was: modes for everything                                                                                                                             | —                                                                                            | **Archived 2026** _(api)_                                                                           |
| **Zed** (GPL-family)                    | Speed (Rust/GPU); edit prediction (Zeta); ACP host. Unique: multiplayer editor                                                                        | Parallel agent threads; hosts external ACP agents                                            | Editor free; Pro $10 + hosted at list+10%                                                           |
| **Antigravity 2** (closed)              | One Google harness across desktop/CLI/IDE/SDK; managed agents                                                                                         | Parallel subagents; agent manager desktop                                                    | Google AI plans / API key; consumer Gemini CLI route ended 2026-06-18                               |
| **Gemini CLI** (Apache-2.0)             | Policy engine, many sandboxes, A2A                                                                                                                    | Extensions → Antigravity plugins                                                             | API-key/enterprise route continues                                                                  |
| **Copilot** (closed)                    | GitHub gravity: cloud sessions everywhere, code review, Automations. Unique: sandbox GA + enterprise policy that can't be weakened locally            | Cloud/local/Agents window; CLI; mobile                                                       | Per-seat plans; cloud sandbox bills vs Actions allowance (Nov 2026)                                 |
| **Amp** (closed)                        | Model routing by mode (Smart/Deep/Oracle); Librarian/Oracle subagents; thread sharing                                                                 | Parallel subagents; web control of CLI threads                                               | PAYG at provider price, $5 min; free tier paused _(sec.)_                                           |
| **Kiro** (closed, AWS)                  | Spec-driven: requirements→design→tasks before code; property-based checks _(sec.)_; steering files                                                    | IDE+CLI+web agents (Kiro Crew _(sec.)_)                                                      | Credits: Free 50; Pro $20/1k … Power $200/10k                                                       |
| **Warp** (closed)                       | The terminal itself is the ADE; Oz cloud orchestration; full terminal use for agents (REPL/vim)                                                       | Oz: parallel cloud agents, triggers, audit trails                                            | Terminal free; Build ~$18–20; Max ~$180–200                                                         |
| **Conductor / Superset** (closed)       | Parallel-worktree orchestration of others' CLIs; Conductor cloud + iOS                                                                                | Their whole product; **no Windows**                                                          | Subscription _(sec.)_; rides your agent subs                                                        |

### 2.2 Feature by feature, with our side at file:line

Verdicts: **better / equal / worse / partial / missing / deliberately
not** (decision named). "Who" lists only products verified above.

| Feature                                                     | Who has it (best example)                                             | Us (file:line)                                                                                                     | Verdict                                             |
| ----------------------------------------------------------- | --------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------ | --------------------------------------------------- |
| Diagnostics/lint/tests fed back after every edit            | OpenCode, Crush, Zed                                                  | M68 verify loop: `src/core/verify/checkCommands.ts:36`, `src/host/vscode/editor/verifyEditor.ts`                   | equal                                               |
| Code intelligence (defs/refs/symbols/rename)                | OpenCode (LSP), Crush (LSP), Zed                                      | M67: `src/core/codeIntel/codeIntelTools.ts:425`, `rename.ts`, `repoMap.ts`                                         | equal                                               |
| Web fetch (SSRF-safe)                                       | Most                                                                  | M69: `src/core/web/webFetch.ts:74` (public-address pinned)                                                         | better (pinning + converter worker)                 |
| Browser check of a web change                               | Cursor, Cline                                                         | M81: `src/core/browser/browserTool.ts:42` (pinned runtime, own proxy)                                              | better (no system browser)                          |
| Computer use (drive GUI apps)                               | Cursor (2026-10-23), Copilot app                                      | Muse Code backend state only: `src/core/agent/agentBackend.ts:475`                                                 | partial (via Muse Code; none of our own)            |
| Per-hunk review, line comments to agent                     | Zed, T3, Codex-class                                                  | M70 review + M123 native git: `src/core/review/reviewMaterial.ts:35`                                               | equal                                               |
| Commit/push/PR from the agent surface                       | T3, OpenCode, Copilot                                                 | M71/M123: `src/core/git/commit.ts`, push plan + `src/runtime/panel/git/`                                           | equal                                               |
| Turn checkpoints incl. untracked; redo                      | T3 (files+conversation), Cline                                        | M72/M86: `src/core/checkpoints/restoreChain.ts` (shadow repo, tools' own writes, D63)                              | equal                                               |
| Cloud/hosted sessions that outlive the editor               | Copilot, Cline Cloud, Cursor, Kilo, Warp Oz                           | Home node instead: `src/runtime/node/args.ts:11` (M110a0)                                                          | partial, deliberately (own-PC, D65 headless for CI) |
| Phone/web control of running agents                         | T3, Cursor iOS, Conductor iOS, Amp web                                | Node + MCP connector (M124); no phone/web client                                                                   | **missing**                                         |
| Best-of-N parallel attempts in worktrees                    | Cursor, T3, Conductor                                                 | M77: `src/core/bestOfN/bestOfN.ts:15`, board `src/core/sessionBoard.ts:13`                                         | equal                                               |
| Coordinator + worker fleets, shared context                 | Cursor Projects, Antigravity, Warp Oz                                 | M96 teams/roles + M116 playbook enforced in code: `src/core/team/`, `src/core/orchestration/playbook/policy.ts:97` | equal (ours is local-first)                         |
| Custom agents / roles with own model+tools                  | OpenCode, Kilo, Cline, Kiro agents                                    | M76 + M96 roles: `src/core/team/builtInRoles.ts`, `codingRoles.ts`                                                 | equal                                               |
| Spec-first flow (requirements/design/tasks artifacts)       | Kiro (defines it), Factory-class                                      | M79 plans as files + plan mode; no requirements/design/tasks trio                                                  | partial                                             |
| Agent publishes an artifact/canvas                          | OpenCode artifacts, Cursor canvases                                   | Transcript share + reports only: `src/core/sharing/chatShare.ts:16`                                                | **missing** (agent tool)                            |
| Installable agent/skill packages + marketplace              | Kilo, Cline, OpenCode plugins, Cursor SDK folders                     | Skills + bundled skills + import (M83/M89/M91); no package/marketplace                                             | **missing**                                         |
| Scheduled/recurring agent runs                              | OpenCode, Goose recipes+cron, Copilot Automations, Conductor Routines | M115 schedules with per-schedule paid consent (AGENTS rule 12)                                                     | better (consent carries price)                      |
| Headless exec + CI action with budget ledger                | OpenCode, Cline CLI, Copilot CLI                                      | M80/D65: `src/runtime/exec/execEntry.ts`, composite Action `action/`                                               | equal (live receipts pending, AGENTS M80 note)      |
| Permission classifier for Auto mode                         | Asked for at OpenCode (48♥); Copilot sandbox policies                 | Judge M98/M125: `src/core/judge/engine.ts` + local fast path (PLAN M125)                                           | better (calibrated, own)                            |
| OS sandbox for agent commands                               | Copilot (GA), Codex-class, Gemini                                     | Muse Code backend: D12 Windows sandbox setup `PLAN.md:2097`; Model API: Judge + rules                              | partial (no own OS sandbox on Model API route)      |
| Paid-use consent naming model+price before spend            | Nobody else found                                                     | D48: `src/core/paid/paidConsent.ts`; Tab ledger M94                                                                | **better — only us**                                |
| No-markup BYOK, switch provider mid-task                    | Kilo, OpenCode, Amp, Crush                                            | M95 BYO providers + roles (M96); README.md:33                                                                      | equal                                               |
| Start with no API key (hosted gateway)                      | Kilo, ClinePass, OpenCode Go                                          | Needs a Muse Code sign-in or a key                                                                                 | worse (see §3: not fixable without reselling)       |
| Inline completion / edit prediction                         | Cursor Tab, Zed Zeta, Copilot                                         | M94 Tab: `src/core/tab/tabEngine.ts:25` (own-key only, daily ledger)                                               | equal; Zed's local Zeta is cheaper per keystroke    |
| Voice in/out                                                | Warp (voice input), few others                                        | Dictation + Muse Voice (`src/core/voice/`)                                                                         | better                                              |
| Image/video/screen-recording input                          | Cursor, Cline (images)                                                | M105 media + screen recording (`dist/media.js`, `dist/screenRecord.js`)                                            | better                                              |
| Session share by link                                       | OpenCode `/share`, Amp threads                                        | M84 share incl. secret gist: `src/core/sharing/`                                                                   | equal                                               |
| Import settings/agents/hooks from rivals                    | Codex-class `/import`                                                 | M83 + M91 foreign hooks: `dist/foreignHooks.js`                                                                    | better (hooks too)                                  |
| Editor reach beyond one IDE                                 | Zed (ACP host), Cline (VS+JetBrains), Kilo                            | ACP agent (D62) + M104 bridges + native git (M123)                                                                 | equal→better when M104 lands                        |
| Localisation / accessibility gates                          | None found at our level                                               | 15 tables, `scripts/check-l10n.mjs`; WCAG 2.2 AA gate (D32)                                                        | **better — only us**                                |
| Cost-per-task transparency (cache savings, per-reply usage) | T3 cost dashboard, OpenCode provider-reported costs (v2.2.0)          | PaidUsage + M73 ledger (`packedTokensAvoided`); Account & usage                                                    | equal                                               |
| Maker/hardware (serial, printers, CNC)                      | Nobody in this set                                                    | `src/core/maker/` + guards                                                                                         | **better — only us** (niche)                        |
| Credential vault for the person's own keys                  | Nobody in this set as a product feature                               | M109 vault (`src/core/vault/`)                                                                                     | **better — only us**                                |

### 2.3 Features several have that we lack; features none has that we could own

Several-have, we-lack (ranked in §3): **(a)** phone/web control of
running local agents (T3, Cursor, Conductor, Amp); **(b)** agent-
published artifacts (OpenCode, Cursor; Kilo/Cline adjacent via cloud
previews); **(c)** installable agent packages + discovery (Kilo,
Cline, OpenCode, Cursor SDK); **(d)** a vendor-cloud run option
(Copilot, Cline, Cursor, Kilo, Warp) — deliberately not, §3;
**(e)** spec-trio flow as a first-class mode (Kiro; echoed by
Factory-class tools); **(f)** no-key first run via hosted gateway
(Kilo, ClinePass, OpenCode Go) — deliberately not as resale, §3.

None-has, we-could-own: **(1)** _Consent-priced autonomy_ — every
rival asks "allow this command?"; only we can ask "allow this
**spend**, at this model's price, against this budget you set?"
across editor, ACP, headless, schedules and Tab with one ledger —
and prove the total afterwards. The October price revolt (§1.6) is
demand for exactly this. **(2)** _The home node as the anti-cloud_:
always-on agents on the person's own PC, reachable from their
phone, with the vault holding keys that never leave the house —
T3 proves the control-surface demand; nobody pairs it with a
credential vault and a paid-consent ledger. **(3)** _A harness that
publishes its own cost-per-solved-task_: arXiv:2610.04433 says the
harness decides the bill; we already keep the ledgers (M73, M75,
PaidUsage) to state ours per release on a public task set. Nobody
in the set publishes an equivalent, rerun-calibrated number.

## 3. Ranked: what to do, and what not to do

Effort: S ≤ 1 lane-week, M = 2–4, L ≥ 5. Evidence: strong = primary
code/changelog + user votes; medium = vendor + consistent secondary;
weak = single secondary.

| #   | Do                                                                                                                                                                                 | Value to a person                                                                               | Effort | Evidence                                       |
| --- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------- | ------ | ---------------------------------------------- |
| 1   | **Phone/web control of the home node** (watch, reply, approve, cancel; paid-consent questions included)                                                                            | The feature the whole field shipped in Oct; turns our node from infrastructure into the product | L      | strong (§1.3: T3 code, Cursor, Conductor, Amp) |
| 2   | **Publish our cost-per-solved-task** on a public, rerun-calibrated task set (grow M75), and show per-task cost in Account & usage                                                  | Direct answer to the price revolt; proof, not adjectives                                        | M      | strong (arXiv:2610.04433 + M73/M75 in tree)    |
| 3   | **Agent artifacts**: `artifact_publish/update` tools serving static HTML from the node/host with secret-scan + share link                                                          | Agents hand over something openable, not a wall of text                                         | M      | strong (OpenCode v2.2.4 code; Cursor canvases) |
| 4   | **Agent packages**: one installable folder (agent + skills + MCP + hooks) with signature/provenance, install from git URL; no central marketplace v1                               | Share a reviewer/teammate in one click; rides M83/M91 import                                    | M      | strong (Kilo/Cline/OpenCode/Cursor SDK)        |
| 5   | **Spec mode on top of M79**: requirements/design/tasks trio as plan files, each approvable, tasks drive a fresh-context run                                                        | Kiro's one idea, without the credit meter; helps long tasks                                     | M      | medium (Kiro secondary; our M79 base exists)   |
| 6   | **"Coming from Cursor/OpenCode?" switcher path**: import their rules/agents/hooks (M83/M91 exist) + a cost-and-consent comparison page in Help, claims only where §2.2 proves them | Catches the revolt at the door                                                                  | S      | strong (§1.6, §1.8)                            |
| 7   | **OS sandbox on the Model API route** (per-OS: job objects / sandbox-exec / landlock-class), Judge remains the policy brain                                                        | OpenCode users' #2 ask (89♥); closes §2.2 partial                                               | L      | strong (_(api)_ + Copilot GA)                  |

**What NOT to do, and why.**

- **No hosted cloud of our own, no model resale/gateway.** Kilo and
  ClinePass win "start with no key" by reselling inference; matching
  it means becoming a billing intermediary holding other people's
  usage — against "You bring your own credentials" (README.md:33),
  against D48's direct-payer clarity, and it would make us the
  markup the revolt is fleeing. The home node + D65 headless cover
  the honest versions of "runs while my laptop is shut".
- **No credit/allowance pricing of ours, ever.** Cursor's October
  move is the cautionary tale (§1.6); D121 already forbids our own
  caps. Keep provider limits + person-set budgets only.
- **No self-rewriting harness** (RHO/HarnessPro pattern). It buys
  cost at best (arXiv:2610.04433 bounds harness gains), and shipping
  code no human reviewed breaks the no-playbook rule and every gate
  we run. Log-mining _suggestions_ reviewed like any change: fine.
- **No marketplace with a central store in v1.** Discovery is where
  the security and moderation cost lives (unsigned third-party tools
  are the prompt-injection highway). Git-URL install with provenance
  (§3 #4) gets the sharing without becoming a store operator.
- **No chasing computer use as our own driver yet.** Cursor/Copilot
  shipped it, but our evidence is one secondary video summary and a
  changelog line; on the Muse Code backend we already surface its
  state (`agentBackend.ts:475`). Revisit when a user asks with a
  task, not before — GUI-driving is the highest-blast-radius tool a
  harness can hold.
- **No "500+ models" catalog race.** Cline's changelog is mostly
  catalog churn and its users still file "newer models not listed"
  (10♥). M95's capability-record route (any OpenAI-compatible
  endpoint, limits from the record) scales without a weekly catalog
  commit; keep the curated set small and correct.

## 4. Lane briefs for what is worth building

Each brief is launchable unchanged. Base is the lead's current
integration branch at launch time; `rv/int9 72d8d5003` is the base
this research verified. All briefs inherit the rig note, AGENTS.md
(no fakes, real-code tests, hooks on, D121: safety limits at
industry-standard values, person-settable where sensible, never a
cap of ours on the person's work), and the recovery-release records
(PLAN status, certification drills, CHANGELOG, all gates).

### 4.1 Node remote control (rank 1) — needs a decision first

Decision needed: **D-next — the node's remote surface**: phone/web
client speaks to the home node over the person's own tunnel/LAN
certificate (M110a0 installer owns the address), never through a
relay of ours; approvals and D48 paid questions are answerable
remotely and are bound to the node's device pairing. If the owner
wants a hosted relay instead, that contradicts §3's no-cloud line
and must be decided explicitly.

```text
LANE: NODEREMOTE — watch and steer the home node's agents from a phone or browser
Base: lead's integration branch at launch (research verified rv/int9 72d8d5003).
Machine: linuxlt. Docs first: PLAN.md M110a0 + D-next (lead records the
decision before code), AGENTS.md rules 8/12, docs/node/.
Goal: from a phone browser (no app-store app in v1), the paired person
sees every conversation/agent on their home node live, can send a
message, approve/deny a tool call, answer a D48 paid-use question with
its model and price named, and cancel a run. Same panel session code
as the editor surface (MHP messages), rendered by a lazy web bundle
served by the node itself over its existing certificate; pairing is
the node's existing device flow — an unpaired device gets the pairing
page and nothing else. No relay, no account, no telemetry.
Proves it (real code only): (1) a real node (temp HOME on the rig)
serves the page; a headless Chromium session (TMPDIR=<worktree>/temp)
pairs, watches a real contributor-model turn stream, sends a reply,
answers one approval and one paid question, cancels a second run —
each step asserted on the node's own session records, call count
stated first (expected ≤6 contributor calls) and reported after;
(2) unpaired and wrong-certificate requests refuse with the pairing
page only (test asserts no session data in the response body);
(3) drill: break the pairing check → suite red → restore → green.
Safety limits: pairing-code attempts stop after 5 failures for
15 minutes (OWASP ASVS credential-stuffing guidance), person-settable
on the node; WebSocket reconnect uses capped exponential backoff
(1s→30s, jitter). No limit of ours on messages, sessions or spend:
provider limits and the person's own budgets only (D121).
Records/gates: PLAN §6 status, docs/certification/noderemote.md with
the drills, CHANGELOG [Unreleased], featureCatalog + reference +
roadmap updates, every gate in the recovery brief pasted with exit
codes. Commit per finished piece, hooks on, never push. LANE DONE.
```

### 4.2 Published cost per solved task (rank 2)

```text
LANE: COSTPROOF — publish what a solved task costs in this harness, rerun-calibrated
Base: lead's integration branch at launch (research verified rv/int9 72d8d5003).
Machine: linuxlt. Read first: docs/research/alternatives-2026-11-02.md
§1.9 (arXiv:2610.04433), PLAN.md M75/M73, src/core/eval/.
Goal: (a) grow the M75 paired task set from 12 to at least 45 tasks
(the paper's floor for resolving a 13-point gap half the time; state
plainly that 45 cannot resolve 5 points) with same-config reruns so
every published number carries its rerun discordance; (b) Account &
usage gains a per-conversation "cost of this task" line built from
provider-reported usage already in the tree (no new estimation);
(c) a docs page generated from the run record states model, price
list date, tasks, rerun discordance and cost per solved task — no
claim the data does not carry.
Proves it: the evaluation itself is the proof — one real run on
muse-spark-1.3-contributor in an empty workspace, expected call count
and dollar cap stated before, real count from session records after;
the generator refuses to emit a page when discordance exceeds the
gap it would print (unit test on recorded real run output). Drill:
feed the generator a run whose arms differ inside discordance → it
prints "no detectable difference" → restore.
Safety limits: the eval refuses every paid use beyond its stated cap
(D48) and stops at the cap saying why; HTTP retries follow the
client's existing table. No product cap is added (D121).
Records/gates: as the recovery brief; the run record lands under
docs/certification/. Commit per piece, hooks on, never push. LANE DONE.
```

### 4.3 Agent artifacts (rank 3)

```text
LANE: ARTIFACTS — the agent publishes an openable page, not a wall of text
Base: lead's integration branch at launch (research verified rv/int9 72d8d5003).
Machine: linuxlt. Read first: alternatives-2026-11-02.md §1.4,
src/core/sharing/, src/core/browser/ (pinned runtime + proxy rules),
AGENTS.md rule 7 (zod at boundaries) and rule 12 (artifacts are local:
no paid call, no consent prompt needed; say so in the tool text).
Goal: two tools on both backends (Model API native; Muse Code via
the ide MCP server): artifact_publish(name, html) and
artifact_update(id, html). The host stores the page under the
workspace's artifact area, serves it in an editor preview panel (and
from the node when NODEREMOTE exists), secret-scans the HTML with the
existing scanner before it is served or shared, and refuses — saying
why — on a hit. Sharing reuses M84's destinations; an artifact is
never uploaded anywhere by default. Scripts inside an artifact run
only in the sandboxed preview (no network, per browser-check policy).
Proves it (real code): a real contributor-model session publishes a
small report page; the test opens the served page and asserts its
heading; a page containing a planted fake credential string is
refused with the scanner's reason (drill both ways); an update
replaces content and the old bytes are gone. Expected ≤4 contributor
calls, stated first, counted after.
Safety limits: none on count or size from us beyond the filesystem;
the scanner refusal is the guard. Serve retries: none (local file).
Records/gates: as the recovery brief; UI change gets its local look
(npm run ui:look) both themes into the certification record.
Commit per piece, hooks on, never push. LANE DONE.
```

### 4.4 Agent packages (rank 4) — needs a decision first

Decision needed: **D-next — package provenance**: a package is a git
repo (or folder) with a manifest (agent, skills, MCP servers, hooks);
install shows every file and every command it would run _before_
anything executes, records source URL + commit, and never auto-runs
install scripts. Confirm no central registry in v1.

```text
LANE: AGENTPACK — install a whole agent (prompt+skills+MCP+hooks) from a git URL
Base: lead's integration branch at launch (research verified rv/int9 72d8d5003).
Machine: linuxlt. Read first: alternatives-2026-11-02.md §1.5, M83/M91
import code (src/core/import/, dist/foreignHooks.js owners), M89
bundled skills, AGENTS.md owner rule: orchestration rules are code —
a package may carry prompts/skills/tools, never harness policy.
Goal: `muse-spark-code-acp package install <git-url>` and the same
from the editor: clone to a staging area, validate the manifest with
zod, list every file/command/permission the package declares, ask
once, install into the person's agents area with its source URL and
commit recorded, and make its agent selectable like a built-in role.
Update = re-install showing the diff of declarations. Remove =
delete the recorded files, nothing else. A package whose manifest
declares a command not present in its files refuses.
Proves it (real code): a fixture package built *in the test* from
real files (a reviewer agent + one skill + one MCP server that is a
real local node script) installs, appears in the role list, runs one
real contributor-model review turn, then removes cleanly (tree
asserted byte-identical). Drill: tamper the manifest after listing
(extra command) → install refuses. Expected ≤3 contributor calls.
Safety limits: clone retries 3 with backoff then stops saying why
(industry default, cf. git's own http retry guidance); no cap of
ours on package count/size (D121).
Records/gates: as the recovery brief. Commit per piece, hooks on,
never push. LANE DONE.
```

### 4.5 Spec mode on M79 (rank 5)

```text
LANE: SPECMODE — requirements, design, tasks: three files a person approves in order
Base: lead's integration branch at launch (research verified rv/int9 72d8d5003).
Machine: linuxlt. Read first: PLAN.md M79 (plans as files, built),
alternatives-2026-11-02.md §2.1 Kiro row. Kiro is closed; build from
the idea, not its text (no licence issue: ideas are free).
Goal: a composer mode beside Plan: the agent drafts requirements.md
(user stories + acceptance criteria), then design.md, then tasks.md
(ordered, each task independently runnable), the person edits and
approves each in the editor, and "Run tasks" executes them in a
fresh context per M79, ticking tasks.md as evidence lands (verify
loop output linked per task). Works on both backends; files live in
the repo where the person points (default .muse/specs/<name>/).
Proves it (real code): on a fixture repo, one real contributor-model
run drafts the trio for a small feature; the test approves
programmatically through the real host port, runs tasks, and asserts
the feature's own test passes and tasks.md carries the evidence
links. Drill: edit tasks.md to add an impossible task → the run
reports it unmet instead of ticking it. Expected ≤8 contributor
calls, stated first, counted after.
Safety limits: none on tasks or files (D121); a task whose checks
fail is retried only as the verify loop already does.
Records/gates: as the recovery brief; ui:look both themes.
Commit per piece, hooks on, never push. LANE DONE.
```

Ranks 6 (switcher path, S) and 7 (OS sandbox, L) get briefs when 1–5
are scheduled; 6 is mostly Help/README claims discipline plus
exercising M83/M91 against a real Cursor/OpenCode config export, and
7 belongs with the SECURITY lane's findings to avoid two sandbox
designs.

## 5. What a person would notice

Every rival in this report now wants to run your agents somewhere
else — their cloud, their credits, their allowance that changed
price in October. Muse Spark Code is the one that runs them in your
editor and on your own PC, asks before it spends a cent of your
money in any mode, keeps the receipt, and — with rank 1 and 2 above
— lets you steer it from your phone and proves in public what a
finished task actually cost. That paragraph is supported today for
the consent, ledger, own-PC and no-markup claims (§2.2, file:line);
the phone and the published number are the two builds that make it
complete.

## Sources (all read 2026-11-02 unless dated)

- Clones: `anomalyco/opencode@cce323b` (CHANGELOG v2.0.26–v2.2.5),
  `pingdotgg/t3code@9bcf7533` (README), `Cline/cline@2565527`
  (CHANGELOG 4.1.23–4.1.26), `Kilo-Org/kilocode@bbb66f6` (README,
  `packages/`). GitHub API (unauthenticated): repo metadata for the
  11 repos in the head table; issue search `sort=reactions` for
  opencode, cline, t3code.
- Liu, Y. & Han, Z. "What Does a Harness Buy? Tokens, Mostly",
  arXiv:2610.04433 (2026-10-03), abstract + reported method read;
  code/data at github.com/YangzeLiu/what-does-a-harness-buy.
- Vendor: github.blog/changelog (Copilot cloud experience and
  Automations, 2026-10-28; local sandboxing GA, 2026-10-07);
  docs.devin.ai/desktop/changelog (Wave 13); Cursor changelog
  entries 2026-09-02…10-20 as summarised by secondary trackers
  (releases.sh, agent-config.com week 43) — Cursor's own pages were
  read through those summaries, marked _(secondary)_ in text.
- Secondary (each used only where marked): Octoverse coverage
  (automater.ai, 2026-10-28); X Subscription pricing reads
  (context.dev 2026-10-18, nocode.mba, techcityauthority
  2026-11); Antigravity transition (jwatte.com, scriptbyai.com);
  Kiro pricing (four consistent reads, §1.6); Conductor/Superset
  (kogan/superset compare page, appmorphy 2026-10); DeepSeek
  dsh-superagent (aiweekly, dataconomy 2026-11-02); Aider cadence
  (toolbit.ai, GitHub API `pushed_at`).
- Not verified: closed products' internals (Cursor, Devin Desktop,
  Kiro, Warp, Copilot, Amp, Antigravity) beyond their public
  changelogs/docs; Warp's exact current dollar prices; Ruflo
  (vendor press release only); any benchmark number a vendor
  reports about itself. No hands-on run of any rival was done:
  each needs an account or a model key, so per the brief their
  source and changelogs stand in, and are marked as such.
