# Performance research — 2026-11-02 (RSCH-PERF)

How fast we start, how much memory and disk we use, how many tokens our
harness costs on every request, and how that compares with the
alternatives — all measured on this machine, plus what three recent
papers say we should and should not do. One cheap win is fixed in this
lane (commit `f6a452642`); the rest are ranked below with lane briefs.

## 0. Method, machine, versions

Machine: `linuxlt`, x86-64, Node v24.21.0, npm 11.19.0. Our tree: base
`72d8d5003` (rv/int9) plus this lane's fix. Production bundles built
with `node scripts/build.mjs --production` (+ `build-desktop.mjs` for
the size gate). Dates read: 2026-11-02 unless noted.

Cold start: each command run 7 times back to back after one untimed
warm run (warm page cache), wall milliseconds, median reported. The rig
was shared and load varied (1–14), so within-benchmark ordering is
fair (commands ran back to back) but absolutes move with load; the
before/after fix comparison instead uses CPU time (user+sys from
`/usr/bin/time -v`, 5 runs, median), which does not.

Token counts: byte/char counts are exact. Token estimates are
chars ÷ 4 (the standard English/code approximation), stated as
estimates, except where a paper gives measured tokenizer counts.

No account, no sign-in, no paid call anywhere in this lane. Hands-on
checks of `opencode` ran under a throwaway HOME
(`temp/fakehome`, `XDG_CACHE_HOME=temp/xdg`).

| Thing                                | Version / SHA                                                                   | Source                          |
| ------------------------------------ | ------------------------------------------------------------------------------- | ------------------------------- |
| Ours (extension + ACP agent)         | 0.19.0, base `72d8d5003` + `f6a452642`                                          | this worktree                   |
| Pi (`@mariozechner/pi-coding-agent`) | 0.73.1 (npm, 2026-10-?)                                                         | npm pack + `dist/` builders run |
| Gemini CLI                           | 0.63.0, tag `v0.63.0` = `5738466`                                               | installed + shallow clone       |
| Codex CLI                            | 0.160.0 installed; source HEAD `ba0dfd3` (2026-11-02, no version tags upstream) | installed + shallow clone       |
| OpenCode                             | 1.19.4, tag `v1.19.4` = `148842e`                                               | npm pack + shallow clone        |
| Claude Code                          | 2.1.310 (native binary)                                                         | installed; closed source        |
| Muse Code                            | 1.4.14-R7309.1                                                                  | installed; closed source        |
| Copilot CLI                          | shim only, CLI not installed                                                    | —                               |

Licences: Pi MIT, OpenCode MIT, gemini-cli Apache-2.0, Codex
Apache-2.0 (all would allow a port; none was copied — only numbers
were taken). Claude Code, Muse Code, Copilot CLI are closed source.

## 1. What is new or what we had not read

### 1.1 Three papers that change what we build (or confirm it)

**P1. Weinberger & Hozez, "Prompt-Induced Waste in Coding Agents",
arXiv:2608.01347v2 [cs.CL], 5 Aug 2026 (v2).** Preregistered
benchmark: 6 open reasoning models + claude-sonnet-5, two real
harnesses (PI.DEV and Claude Code), 24 deterministic tasks, 4,644
valid runs. Read as PDF (text-extracted), §§1–3 and the calibration
section in full. Findings that matter to us:

- Fixed prefix per request: PI.DEV 1,147–1,642 tokens (system + 4
  tool schemas); Claude Code 15,983–20,330 tokens (≈6.7 KB system +
  24 tools) — 12–15× larger, on every tokenizer. The user's own
  prompt is under 5% (PI.DEV) / under 1% (Claude Code) of logical
  input: the harness, not the user, sets the bill.
- Harness choice dwarfs every prompt effect: 5–30× cost per success.
- Cache savings must never be reported as efficiency (their §3:
  identical conditions alternate full/partial/no hits; one
  provider-side cache anomaly persisted three days).
- A harness-side cost report using its own price table measured
  3.5× the true provider-side cost. (We already show the
  provider's own figures beside our estimate — PROVSPEND.)
- Gateway lesson: only an executed multi-step tool loop validates
  a gateway; a text reply proves nothing.

**P2. Liu & Han, "What Does a Harness Buy? Tokens, Mostly",
arXiv:2610.04433 [cs.AI], 3 Oct 2026.** Five models × three
production harnesses (Claude Code, mini-SWE-agent, OpenCode) on
SWE-bench Verified, 447 tasks + reruns for calibration. Read the
abstract and the Decoder/secondary summaries; the PDF was not
re-read end to end (the abstract carries the claims used here):

- Heavy vs light harness: equivalent within 5 points; swapping the
  harness flips as many tasks as rerunning the same harness (13%).
- Cost per task differs by up to 3× across harnesses with model,
  tasks and price list fixed. The gap is set at the first call by
  the preamble (system prompt + tool schemas) and scaled by step
  count. Cached-input pricing scales the bill, never reorders it.
- The one effect clearing the noise is a loss: OpenCode trails by
  up to 9 points, half of one model's gap sitting in runs its
  output cap cut short. **Output caps cost scores** — direct
  support for D121 (no caps of ours on the person's work).

**P3. Sadani & Kumar, "Tool Attention Is All You Need",
arXiv:2604.21816 [cs.AI], 23 Apr 2026.** The "MCP/Tools tax":
10k–60k tokens of eager schema injection in multi-server MCP
deployments; reasoning degrades near ~70% context utilisation;
lazy schema loading (summary pool + top-k full schemas) cut
per-turn tool tokens 95% (47.3k → 2.4k). **Caveat, from their own
abstract: the evaluation is a simulated 120-tool benchmark, and
the end-to-end success/latency/cost figures are projections, not
measured on live agents.** Promising direction, not proof — it
does not justify rebuilding our tool surface now.

**P4 (industry, secondary). Anthropic, "Building agents: When to
fold subagents into your main agent loop" (Applied AI team, Diane
Sarkis), 22 Oct 2026.** Via five agreeing secondary reports
(o-mega.ai, the-decoder.com, dev.to, enjoy.dev, i10x.ai; the
claude.com primary was not fetched): across several enterprise
deployments a single agent with progressively loaded skills
frequently beat router/planner/subagent designs on quality, often
at lower cost and latency; one customer saw roughly 2× faster
runtime. Companion repo `single-agent-loop-kit` (Apache-2.0).
Relevance: enterprise assistants, not coding agents, and one
customer's 2× — a signal to measure our teams, not to remove them.

### 1.2 Rival versions since our last research

- Gemini CLI 0.63.0: model-family tool sets (legacy vs Gemini 3),
  dynamic declarations for shell/plan/skill/topic tools
  (`coreTools.ts`).
- Codex CLI 0.160.0: native Rust core behind a Node launcher;
  terse tool descriptions (`exec_command` 538 chars,
  `apply_patch` 108 chars).
- OpenCode 1.19.4: per-model-family system prompts (8.5–15.4 KB;
  the Gemini one is the longest at 15,372 chars), ~15 core tools.
- Pi 0.73.1: 7 tools, 1,465-char default system prompt; ships
  unbundled (711 files + ~190 MB `node_modules`).
- Claude Code 2.1.310: native 278 MB binary; `cacheControl`
  breakpoints with org/global scopes seen in the binary.

### 1.3 Our own numbers, measured for the first time

Cold start, peak RSS, install size, idle ACP memory, exact system
prompt and tool-definition bytes, bundle sizes, and session-store
disk use — §§2–3. The ACP startup drag (§5.1) is fixed here.

## 2. Our measurements

### 2.1 Cold start (warm page cache, 7 runs, median)

| Command                            | Median | Peak RSS | Notes                         |
| ---------------------------------- | ------ | -------- | ----------------------------- |
| `node -e 1` (baseline)             | 52 ms  | 43.7 MB  |                               |
| `dist/acp.js --version` before fix | 662 ms | —        | CPU 0.80 s                    |
| `dist/acp.js --version` after fix  | —      | —        | CPU 0.63 s (−21%)             |
| `dist/acp.js --help` before fix    | 410 ms | 113.6 MB | CPU 0.80 s                    |
| `dist/acp.js --help` after fix     | —      | 107.3 MB | CPU 0.67 s (−16%)             |
| `dist/headless.js --help` (exec)   | 210 ms | —        | CPU 0.38 s; was already clean |

Before/after used CPU time (user+sys, median of 5) on the same
loaded rig minutes apart, so the −21%/−16% is contention-free;
wall medians after the fix are not quoted because rig load (11–14)
made them meaningless. Method and raw runs: `temp/bench-*.sh`,
`temp/prof/`.

Why it was slow: three value imports in the ACP entry graph —
`abortableSleep` and `isModelApiError` from
`src/core/backends/modelapi/transport.ts`, `scrubRefusalLeak`
from `providerRefusal.ts` — hit the build rule that externalises
those modules to `./modelApi.js`
(`scripts/lib/deferredBundles.mjs`), so every start parsed and
ran the 533 KB backend plus its seams (`modelApiSessions`,
`modelApiShell`, `modelApiAcp`, …). A CPU profile of `--version`
showed exactly those module scopes running. The fix moves the six
leaf symbols (the two error classes, both guards, the sleep, the
scrub) to `modelApiError.ts`, `src/core/timeouts.ts` and
`src/core/redact.ts`; `dist/acp.js` now has zero
`require("./modelApi.js")`. `dist/headless.js` never had one,
which is why `exec --help` was always faster (210 ms).

### 2.2 Idle and working memory

- ACP serve idle (`--backend modelApi`, stdio open, no session):
  158 MB RSS at 8 s settling to 108 MB at 13 s; no child
  processes. (Method: `temp/idle-serve2.sh`.)
- Extension host idle/working memory: **not measured** — needs
  VS Code, which this rig cannot drive (see §5 brief PERF-ACT).
- Panel first paint: not measured for the same reason. Shipped
  bytes: `dist/webview/main.js` 132 KB + `main.css` 97 KB
  (React 19 app, `src/webview/`), with Models/usage/developer
  surfaces lazy (`dist/webview/models.js` etc.).

### 2.3 Bundles and package (this production build, bytes)

| Bundle                              | Bytes            | Budget          | Headroom       |
| ----------------------------------- | ---------------- | --------------- | -------------- |
| `dist/extension.js` (activation)    | 551,114          | 600 KiB         | 10%            |
| `dist/modelApi.js` (backend)        | 533,754          | 525 KiB         | **1% — tight** |
| `dist/acp.js` (agent)               | 434,349          | 850 KiB         | 50%            |
| `dist/runtimeEngine.js`             | 764,271          | 875 KiB         | 15%            |
| `dist/headless.js` (exec)           | 121,814          | 125 KiB         | **3% — tight** |
| `dist/conversation.js`              | 284,058          | 300 KiB         | 8%             |
| `dist/webview/main.js` + `main.css` | 132,287 + 97,464 | (startup group) | —              |
| `dist/` total (all entries + meta)  | 29.5 MB          | —               | —              |

Size and split gates pass (`SIZE_EXIT:0`, `SPLIT_EXIT:0`). VSIX:
4,273,804 bytes for win32-x64 measured 2026-10-24 against the
4,800 KiB owner-set budget (`MAX_VSIX_BYTES`,
`scripts/check-vsix-size.mjs`, D6); not re-packaged in this lane
(the packager hung on a `--help` probe and was terminated; no
strays left). No budget was raised.

### 2.4 Token overhead per request (exact bytes, estimated tokens)

Built by bundling the real `instructionsFor` +
`toolDefinitions` and running them (`temp/perf-probe.*`):

| Prefix                                                                                       | Chars/bytes  | ≈ tokens (÷4) |
| -------------------------------------------------------------------------------------------- | ------------ | ------------- |
| System, minimal (fresh workspace)                                                            | 2,031 chars  | ≈ 510         |
| System, full (memory+codeintel+webfetch, 200-entry repo map, rules, 2 skills, 1 agent, goal) | 7,803 chars  | ≈ 1,950       |
| Tools, default (11, no shell)                                                                | 6,802 bytes  | ≈ 1,700       |
| Tools, shell session (12)                                                                    | 7,942 bytes  | ≈ 1,990       |
| Tools, full (38, every feature)                                                              | 27,113 bytes | ≈ 6,780       |
| Tools, subagent (7)                                                                          | 5,358 bytes  | ≈ 1,340       |

A typical shell session sends ≈ 10 KB ≈ **2.5k tokens** of
prefix on every request; a full-feature session ≈ 35 KB ≈
8.8k; a subagent ≈ 7.4 KB ≈ 1.9k. For scale, P1's preregistered
measurement puts PI.DEV at 1.1–1.6k and Claude Code at 16–20k
prefix tokens: our typical session sits near the lean end, our
fullest below Claude Code's middle.

Mechanisms that keep it there: instructions carry only what the
workspace has (`src/core/backends/modelapi/instructions.ts`);
tools are offered per capability (`toolDefinitions`,
`src/core/backends/modelapi/tools.ts:779`); subagents get 7
tools; custom agents narrow tools/model/effort (M76); hook-model
calls get read-only tools
(`ModelApiHost.ts:hookModelTools:10889`); observation packing
bounds tool output (`observationPacking.ts`, M73) with
`recall_output` paging; auto-compaction folds long sessions
(`autoCompact.ts`, M48); prompt-cache routing keys the stable
prefix (`promptCache.ts`, M56/D43) and cached tokens are
accounted per turn (`ModelApiHost.ts:1804`); Tab anchors
prefix windows to 32-line multiples so consecutive requests
share a cached prefix (`TAB_PREFIX_ANCHOR_LINES`,
`src/shared/constants.ts`) with a typing-through LRU cache
(`src/core/tab/tabCache.ts`, Continue's design) and per-trigger
context caps (`TAB_CONTEXT_FILES`, `TAB_CONTEXT_SNIPPET_LINES`).

Not measured (needs live calls, forbidden in this lane): cache
hit rate over a long session, turn latency we add over the raw
model, Tab acceptance/latency in the wild. Briefed in §5.

### 2.5 Disk use over weeks

- Our whole footprint on this shared rig:
  `~/.local/share/muse-spark-code` = **196 KB** (`machine-id`,
  `resource-created` with 9 registry files + 2 live trees,
  `usage` journal). Temp trees are reclaimed across starts
  (RLF-TEMPLEAK; `registryFile` in `src/extension.ts`).
- Model API sessions clean up after `museSpark.cleanupPeriodDays`
  (Claude Code parity, `src/host/backend/fileSessionStore.ts:18`).
- Context, not ours: `~/.local/share/muse/sessions` (Muse
  Code's own store, which our MuseCodeBackend inherits) holds
  **15.6 GB in 96,276 files** (median 1 KB, max 479 MB — five
  100–265 MB `session.jsonl` files from 2026-10-21), plus
  241 MB `local-tracing` and a 29 MB `session-index.db`. We
  cannot trim another program's store; we can only keep ours
  small, which it is.

## 3. Rival measurements (same machine, same method)

### 3.1 Cold start medians (7 runs, warm cache)

| CLI                         | `--version`                   | `--help` | Launcher                                  | Install size           |
| --------------------------- | ----------------------------- | -------- | ----------------------------------------- | ---------------------- |
| Ours (`acp.js`, before fix) | 662 ms                        | 410 ms   | Node, esbuild bundle 434 KB               | VSIX 4.3 MB (recorded) |
| `codex` 0.160.0             | 69 ms                         | 59 ms    | Node 9 KB launcher → native Rust          | 427 MB                 |
| `claude` 2.1.310            | 14 ms                         | 150 ms   | native 278 MB binary                      | 279 MB                 |
| `muse` 1.4.14               | 46 ms                         | 47 ms    | bash launcher → 415 MB static binary      | 415 MB+                |
| `gemini` 0.63.0             | 2,341 ms                      | 2,586 ms | Node, 16 MB ESM bundle                    | 101 MB                 |
| `opencode` 1.19.4           | 1,139 ms                      | 1,004 ms | native 214 MB (Bun-compiled) binary       | 205 MB                 |
| `pi` 0.73.1                 | 1,572 ms                      | 1,637 ms | Node, unbundled (711 files + 190 MB deps) | 203 MB                 |
| `copilot`                   | — (shim: "CLI was not found") | —        | native shim 724 KB                        | not installed          |

Peak RSS (single `--help`/`--version` run): node baseline
43.7 MB; ours 113.6 → 107.3 MB; codex 51 MB (launcher only —
the native child's RSS is not included, caveat); gemini 215 MB;
claude 118 MB; opencode 147 MB; pi 152 MB.

Two results matter more than the ranking. First, **native does
not mean fast**: opencode's 214 MB native binary starts slower
(1.0 s) than our Node CLI (0.4 s) — runtime init and framework
load dominate. Second, **bundling wins**: the two unbundled /
giant-bundle Node CLIs (pi 1.6 s, gemini 2.6 s) are the slowest
of all; our esbuild bundles and lazy entries are the reason we
beat them by 4–6× while shipping a 4.3 MB package against
their 100–427 MB installs.

### 3.2 Prefix tokens (system + tools, same ÷4 estimate)

| Harness                     | System prompt                                                                       | Tools                                                                                                                                          | Prefix ≈               |
| --------------------------- | ----------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------- |
| Ours, typical shell session | 2,031 chars (run)                                                                   | 12 tools, 7,942 bytes (run)                                                                                                                    | ≈ 2.5k                 |
| Ours, full                  | 7,803 chars (run)                                                                   | 38 tools, 27,113 bytes (run)                                                                                                                   | ≈ 8.8k                 |
| Ours, subagent              | 2,031 chars                                                                         | 7 tools, 5,358 bytes (run)                                                                                                                     | ≈ 1.9k                 |
| Pi 0.73.1                   | 1,465 chars (builder run)                                                           | 7 tools, 6,047 bytes (builder run)                                                                                                             | ≈ 1.9k                 |
| Gemini 0.63.0               | ≈ 19 KB base (own test snapshots)                                                   | 19 tools, ≈ 34–36 KB snapshot bytes (escaping included, slight overcount)                                                                      | ≈ 13k                  |
| Codex (src HEAD `ba0dfd3`)  | 6.6–7.6 KB (`gpt_5_codex_prompt.md`, `gpt-5.2-codex_prompt.md`)                     | ~6–8 native (`exec_command`, `apply_patch`, `view_image`, `update_plan`, …), terse (108–538-char descriptions); full schema bytes not measured | ≈ 2–3k (partial)       |
| OpenCode 1.19.4             | per-model 8.5–15.4 KB (`default.txt` 8,528, `meta.txt` 9,159, `gemini.txt` 15,372)  | ~15 tools, 15 KB description `.txt` (JSON bytes not measured)                                                                                  | ≈ 6–8k (partial)       |
| Claude Code 2.1.310         | identity line only ("You are Claude Code, …"); full prompt not extractable (closed) | 24 schemas per P1; names seen in binary (`AskUserQuestion`, …)                                                                                 | 16–20k (P1 measured)   |
| PI.DEV (P1's harness)       | —                                                                                   | 4 schemas (P1)                                                                                                                                 | 1.1–1.6k (P1 measured) |
| Muse / Copilot CLI          | closed / not installed                                                              | —                                                                                                                                              | not measured           |

## 4. Comparison table

Verdicts: **ours is better**, **equal**, **worse**, **partial**,
**missing**, **deliberately not** (with the decision).

| Feature                    | Ours                                                                                                            | Best alternative measured                                                    | Verdict                                                                                                          |
| -------------------------- | --------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------- |
| CLI cold start             | 410 ms `--help`, 662 ms `--version` (CPU −21%/−16% fixed here; wall after unmeasured under load)                | codex 59 ms, claude 150 ms (native)                                          | **worse** vs native, **better** vs gemini/pi/opencode by 2.5–6×                                                  |
| Install size               | 4.3 MB VSIX (recorded 0.19.0)                                                                                   | pi 203 MB … codex 427 MB                                                     | **ours is better** by 25–100×                                                                                    |
| CLI memory (`--help` peak) | 107 MB                                                                                                          | codex launcher 51 MB; gemini 215 MB                                          | **partial** (mid-pack; native wins)                                                                              |
| Idle agent memory          | 108–158 MB RSS, no children                                                                                     | not measurable (all need sign-in for sessions)                               | **partial** (no comparison possible)                                                                             |
| Typical prefix tokens      | ≈ 2.5k (10 KB run)                                                                                              | pi ≈ 1.9k; PI.DEV 1.1–1.6k (P1)                                              | **partial** (near the lean end, pi leaner)                                                                       |
| Full-feature prefix        | ≈ 8.8k (35 KB run)                                                                                              | gemini ≈ 13k, Claude Code 16–20k (P1)                                        | **ours is better**                                                                                               |
| Subagent prefix            | ≈ 1.9k (7 tools)                                                                                                | — (not measured per rival)                                                   | **partial**                                                                                                      |
| Tool count, full           | 38 offered max                                                                                                  | gemini 19, codex ~6–8, pi 7                                                  | **worse** in count, **better** in bytes than gemini/Claude Code (P2: preamble sets the bill, count is secondary) |
| Per-model prompts          | one prompt + identity line (`instructions.ts:101`)                                                              | opencode per-family 8.5–15.4 KB, gemini family tool sets                     | **partial** (no published A/B shows it helps; §6 NOT)                                                            |
| Prompt-cache routing       | stable-prefix digest key (`promptCache.ts:24`), cached-token accounting (`ModelApiHost.ts:1804`)                | Claude `cacheControl` org/global scopes (binary); Tab 32-line anchors (ours) | **equal** in mechanism, **partial** in proof (hit rate unmeasured)                                               |
| Compaction                 | auto-compaction (`autoCompact.ts`), observation packing + `recall_output` (M73)                                 | gemini compression prompt; codex `new_context_window`                        | **equal** (all three compact; ours pages outputs back)                                                           |
| Tab completions            | typing-through LRU (`tabCache.ts`), 32-line anchors, per-trigger caps, ledger + consent (D73)                   | not measured (needs live use)                                                | **partial**                                                                                                      |
| Activation cost            | 551 KB/600 budget; activates `onStartupFinished` (`package.json:61`); logs its own ms (M39, `extension.ts:883`) | — (editor extensions, not comparable to CLIs)                                | **partial** (bytes capped; time unmeasured)                                                                      |
| First paint                | 132 KB JS + 97 KB CSS; deferred surfaces                                                                        | —                                                                            | **partial** (time unmeasured)                                                                                    |
| Session disk               | 196 KB total; `cleanupPeriodDays`; cross-start temp reclamation (RLF-TEMPLEAK)                                  | Muse's own 15.6 GB inherited store (not ours to trim)                        | **ours is better** (for our own bytes)                                                                           |
| Background CPU             | governed spawns; Windows job objects; CC-WINHOOK counted 10 starts/warm hook launch                             | —                                                                            | **partial** (Windows work is ahead of Linux measurement)                                                         |
| Output caps                | none of ours (D121)                                                                                             | OpenCode's cap cost it up to 9 pts (P2)                                      | **ours is better** (evidence-backed)                                                                             |
| Cost reporting             | provider's own figures beside our estimate (PROVSPEND)                                                          | harness-table reports err 3.5× (P1)                                          | **ours is better**                                                                                               |
| Subagent overhead          | teams (M96) + subagents (M48/M76), lean 1.9k child prefix                                                       | Anthropic 2026: single loop often wins, one 2×                               | **partial** (ours unmeasured; P4 is enterprise, not code)                                                        |
| MCP schema tax             | MCP lazy (`mcpPool.js`), hook tools read-only narrowed                                                          | Tool Attention 95% cut in simulation only (P3)                               | **partial** (their proof is simulated)                                                                           |
| Stale PLAN box             | —                                                                                                               | —                                                                            | none found in the perf boxes checked (D6 budgets current; D121/D208 in force)                                    |

## 5. Ranked list: what to do

Ordered by value to a person × strength of evidence ÷ effort.
Every item keeps every budget and gate; none raises anything.

1. **Lazy-load `providers.js` (201 KB) off the ACP startup path**
   (done here for `modelApi.js`; same shape, bigger win
   available). Value: every agent start, every platform.
   Evidence: strong (measured requires + profile). Effort:
   medium (per-command loading in `src/runtime/main.ts`).
   → brief PERF-PROV.
2. **Move `BACKEND_KINDS` + `reportWebviewErrorSchema` out of
   `wire.js` (76 KB)** so `acp.js` stops requiring it — the
   same two-symbol pattern as this lane's fix. Value: every
   start. Evidence: strong (measured: 2 symbols used).
   Effort: small. → brief PERF-WIRE.
3. **Find what `vaultBoundaries.js` (46 KB) does at module
   scope** — it showed the largest single-chunk self time in the
   after-fix profile (noisy under load; re-measure first).
   Value: every Node start incl. activation. Evidence: medium
   (needs a quiet-rig re-profile). Effort: small–medium. →
   brief PERF-SCOPE.
4. **Freeze the prefix with a byte-budget test.** Assert the
   exact system+tool bytes for the minimal, shell, full and
   subagent sessions (the probe in `temp/perf-probe.ts`,
   rebuilt as a real-code test). Value: P1/P2 prove the
   preamble sets the bill; this stops silent growth.
   Evidence: strong. Effort: small. → brief PERF-PREFIX.
5. **Measure activation time + first paint through the packed
   product** (M39 already logs activation ms; the real-life
   run can read it) and set time budgets beside the byte
   budgets. Value: every window start. Evidence: medium
   (mechanism exists; numbers don't). Effort: medium. →
   brief PERF-ACT.
6. **Measure turn-latency overhead + cache hit rate over long
   sessions** on the cheapest contributor model with a stated
   call count: diagnostics/verify/hooks cost per turn, prefix
   cache hits, Tab latency/acceptance. Value: proves or kills
   items 7–8. Evidence: none yet (forbidden in this lane).
   Effort: medium + real money (owner's). → brief PERF-TURN.
7. **Measure team/subagent overhead** (P4's 2× claim) on coding
   tasks before touching teams: same tasks, single vs team,
   time + tokens + success. Value: decides M96's future.
   Evidence: weak for code (P4 is enterprise assistants).
   Effort: medium + real money. → brief PERF-TEAM (last).
8. **Tight budgets to watch, not raise:** `modelApi.js` at 99%
   (533,754/537,600), `headless.js` at 95%. Next growth must
   split a lazy seam (the split gate + `deferredBundles.mjs`
   show how), never raise a cap (D6/D209).

### What NOT to do, and why

- **No native compile of our CLI.** OpenCode's 214 MB native
  binary starts at 1,004 ms — slower than our 410 ms Node CLI.
  Native buys install size (≈50× worse) and nothing in speed.
- **No lazy tool-schema loading (P3's design).** Its 95% cut is
  simulation-only; our typical prefix (≈2.5k) is already near
  PI.DEV's measured 1.1–1.6k. Revisit only if PERF-TURN shows
  the full 38-tool prefix hurting.
- **No per-model prompts.** OpenCode and Gemini carry them, but
  no published A/B shows a gain, and P2 shows harness wording
  moves scores within noise. Our identity line
  (`instructions.ts:115`) is the cheap version; keep it.
- **No output/result caps for speed.** P2: OpenCode's cap cost
  up to 9 points. D121 already forbids caps of ours; this is
  the evidence to keep citing.
- **No harness-side cost math as the headline.** P1 measured
  3.5× error. Keep PROVSPEND's provider-beside-estimate.
- **No unbundling.** Pi's unbundled 711-file install is the
  slowest Node start measured (1.6 s). esbuild bundles stay.
- **No framework swap for the panel.** First-paint time is
  unmeasured; swapping React 19 on a hunch is the half-cocked
  plan AGENTS.md forbids. Measure first (PERF-ACT).

## 6. Lane briefs

Each block launches unchanged. Base for all: `main` after this
lane lands (this lane's base was rv/int9 `72d8d5003`).
Machine: `linuxlt` unless the brief says otherwise. No
Muse request beyond the lane's own session; no paid call
unless the brief states the model, count and cap; D121 holds
everywhere (no limits of ours; industry-standard safety
limits stay, cited). Follow AGENTS.md and the rig note
(CPU-time A/B like RSCH-PERF's when the rig is loaded).

### PERF-PROV — lazy-load providers.js off the ACP startup path

```text
Goal: `dist/acp.js` starts without parsing `dist/providers.js`
(201 KB) unless the command needs it (`providers`, `auth`
flows that read presets). Today acp.js requires it at the
top for 7 bindings while `--version`/`--help`/`serve` on the
Muse Code backend never touch providers.

Base: main after RSCH-PERF lands. Machine: linuxlt.

Steps: (1) measure first: CPU user+sys medians of 5 for
`--version`/`--help`/idle-serve before; profile which
providers.js module scopes run at start; (2) move the
providers reads in `src/runtime/main.ts` behind the existing
per-command loaders (same pattern as `runtimeAccountsLoader`);
keep every HOTFIX0181 name exported from
`src/host/backend/modelApiEntry.ts`; (3) rebuild, re-measure,
confirm `require("./providers.js")` is gone from acp.js's
eager path and every providers/auth command still works.

Proves it (real code only): before/after CPU medians;
`providers list/add/test/remove` + `auth set/status/clear`
round-trip in a throwaway HOME; split + size gates green
(budgets never raised); touched suites green.

Safety: no new limits; loader failures keep today's refusal
words. Decision needed: none (D6 split mechanics already
cover it).
```

### PERF-WIRE — move BACKEND_KINDS + reportWebviewErrorSchema out of wire.js

```text
Goal: `dist/acp.js` stops requiring `dist/wire.js` (76 KB)
for its only two used symbols (`BACKEND_KINDS`,
`reportWebviewErrorSchema`), the same two-symbol pattern as
RSCH-PERF's modelApi.js fix (f6a452642).

Base: main after RSCH-PERF lands. Machine: linuxlt.

Steps: (1) measure before (CPU medians of 5,
`--version`/`--help`); (2) relocate the two symbols to the
shared module their readers already carry (or a leaf like
`modelApiError.ts` with a split-gate ACTIVATION_ALLOWED row
and reason); update all importers; (3) rebuild, confirm zero
`require("./wire.js")` in acp.js, re-measure.

Proves it (real code only): before/after CPU medians; a
red/green drill each way (restore the import → require
returns; remove → gone); split + size gates green; touched
suites green.

Safety: no behaviour change, no new limits. Decision needed:
none.
```

### PERF-SCOPE — find and fix vaultBoundaries.js module-scope cost

```text
Goal: explain and remove the module-scope CPU in
`dist/vaultBoundaries.js` (46 KB), the largest single-chunk
self time in RSCH-PERF's after-fix `--version` profile
(noisy under load 11+; re-measure first on a quiet rig —
suspects: zod schema construction, regex tables).

Base: main after RSCH-PERF lands. Machine: linuxlt.

Steps: (1) re-profile `--version`/`--help` on a quiet rig
(load < 2) plus CPU medians of 5; attribute vaultBoundaries
scope time to functions; (2) defer the work to first use
(lazy getters, same words and schemas) or shrink it;
(3) re-measure; confirm every vault/auth/report path still
works (throwaway HOME; never the real OS store on a personal
machine — see the rig note's vault-suite rule).

Proves it (real code only): before/after CPU medians and
profiles; red/green drill on the deferred path; split + size
gates green; touched suites green.

Safety: no new limits; schema strictness unchanged.
Decision needed: none, unless deferral changes an error's
timing — then name it and ask.
```

### PERF-PREFIX — freeze the per-request prefix with a byte-budget test

```text
Goal: a real-code unit test asserting the exact system +
tool bytes for four sessions (minimal, shell, full,
subagent), so the preamble P1/P2 prove sets the bill can
never grow silently. RSCH-PERF's throwaway probe
(temp/perf-probe.ts) shows the shape: bundle the real
`instructionsFor` + `toolDefinitions`, run them, assert
bytes.

Base: main after RSCH-PERF lands. Machine: linuxlt.

Steps: (1) port the probe into `test/unit/` over real code
only (no mocks, no invented data); pin the four byte counts
measured on the base; (2) document the update rule in the
test header: a count may move only with a one-line reason
naming what the person gains (same convention as
exact-size assertions); (3) break it on purpose once
(add a tool description word) to prove it fires, restore.

Proves it (real code only): the test itself + its red/green
drill; typecheck, eslint, related suites green.

Safety: none (test-only). Decision needed: none.
```

### PERF-ACT — measure activation time + first paint, set time budgets

```text
Goal: measured activation ms (M39 already logs it) and
panel first-paint ms through the packed product, plus time
budgets beside the byte budgets. Activation runs
`onStartupFinished` in every window; its bytes are capped
(551/600 KiB) but its time never measured.

Base: main after RSCH-PERF lands. Machine: the rig that can
drive VS Code (not linuxlt's sandbox if Electron is
blocked — say where it ran).

Steps: (1) extend the real-life run (or a documented packed-
product procedure) to open a window, read activation ms from
the log channel, and time first paint of the chat panel;
(2) repeat 5× on a quiet machine, report medians; attribute
the top costs from the log; (3) propose time budgets in D6
style (measured + headroom, never raised afterwards) — the
lane measures and proposes; the owner sets the numbers.

Proves it (real code only): the packed product, used as a
person uses it; log excerpts with the ms; no mocks.

Safety: no product change unless a cheap win appears (then
it gets its own before/after). No paid calls. Decision
needed: the owner sets the budget numbers (D6).
```

### PERF-TURN — measure turn overhead + cache hits over long sessions

```text
Goal: how much latency WE add over the raw model per turn
(diagnostics, verify loop, hooks, observation packing),
and the prefix cache hit rate over a 50+ turn session —
the two numbers RSCH-PERF could not measure without live
calls.

Base: main after RSCH-PERF lands. Machine: linuxlt, empty
workspace. Model: `muse-spark-1.3-contributor` ONLY (never
any other id). Expected calls: 2 sessions × ~55 requests
(50 work turns + compaction) ≈ 110 requests; count the real
number from session records afterwards and report it. Cap:
the lane states the dollar cap from the contributor tariff
before the first call; buying credits is the owner's.

Steps: (1) drive scripted coding turns through the packed
product on the Model API backend; (2) log per-turn
model-time vs harness-time (timestamps around the send and
around each post-edit stage) and cached vs uncached input
tokens per turn from the usage already accounted
(`ModelApiHost.ts` cached_tokens); (3) publish time series
+ medians; say which stage dominates and whether the full
38-tool prefix measurably hurts.

Proves it (real code only): the packed product against the
real API; provider-side usage as the source of truth (P1:
never trust harness-side math alone); no mocks.

Safety: D121 — no caps of ours anywhere on this path; the
dollar cap is the person's, stated up front. Decision
needed: none, unless a stage's cost argues for a product
change — then brief it, don't build it.
```

### PERF-TEAM — measure team/subagent overhead before touching teams

```text
Goal: test P4's claim (single loop up to ~2× faster) on
CODING tasks: same tasks solo vs team/subagents, scored on
time, tokens and success. Runs AFTER PERF-TURN (reuses its
harness) and last of all.

Base: main after RSCH-PERF lands. Machine: linuxlt, empty
workspace. Model: `muse-spark-1.3-contributor` ONLY.
Expected calls: 6 tasks × 2 shapes × ~15 requests ≈ 180
requests; real count reported from session records. Dollar
cap stated up front from the contributor tariff.

Steps: (1) pick 6 small deterministic coding tasks with
hidden checks; (2) run each solo and as a team, recording
wall time, input/output/cached tokens and pass/fail;
(3) report paired medians; conclude: keep, narrow, or
re-brief teams — with numbers, not P4's enterprise anecdote.

Proves it (real code only): packed product, real API,
hidden checks. Safety: D121; the person's dollar cap only.
Decision needed: none in-lane; the outcome may ask the
owner for a teams decision (new D-number).
```

## 7. What a person would notice

The terminal agent now starts about a fifth faster, and the
rest of this report is the reason to believe the smallness is
deliberate: a typical session sends about 2.5k tokens of
harness overhead on every request where the best-measured
rival sends 16–20k, the install is a 4 MB package against
rivals' 100–427 MB, and our whole footprint on disk after
weeks of use is under 200 KB. What the evidence does not yet
support is claimed nowhere above: turn latency, cache hit
rates and panel paint times are briefed to be measured, not
asserted.

## 8. Sources

| #   | Source                                                                                                                                                | Read       | Version / SHA                                       |
| --- | ----------------------------------------------------------------------------------------------------------------------------------------------------- | ---------- | --------------------------------------------------- |
| P1  | Weinberger & Hozez, Prompt-Induced Waste in Coding Agents, `https://arxiv.org/pdf/2608.01347v2`                                                       | 2026-11-02 | v2, 5 Aug 2026 (PDF extracted)                      |
| P2  | Liu & Han, What Does a Harness Buy? Tokens, Mostly, `https://arxiv.org/abs/2610.04433`                                                                | 2026-11-02 | v1, 3 Oct 2026 (abstract + secondaries)             |
| P3  | Sadani & Kumar, Tool Attention Is All You Need, `https://arxiv.org/abs/2604.21816`                                                                    | 2026-11-02 | v1, 23 Apr 2026 (abstract; simulation caveat noted) |
| P4  | Anthropic, Building agents: When to fold subagents into your main agent loop, 22 Oct 2026, via o-mega.ai, the-decoder.com, dev.to, enjoy.dev, i10x.ai | 2026-11-02 | secondary reports agree; primary not fetched        |
| R1  | Pi 0.73.1 npm tarball, `dist/` builders run                                                                                                           | 2026-11-02 | 0.73.1, MIT                                         |
| R2  | gemini-cli tag `v0.63.0` (`5738466`) + installed 0.63.0                                                                                               | 2026-11-02 | shallow sparse clone, Apache-2.0                    |
| R3  | codex HEAD `ba0dfd3` (no version tags) + installed 0.160.0                                                                                            | 2026-11-02 | shallow sparse clone, Apache-2.0                    |
| R4  | opencode tag `v1.19.4` (`148842e`) + npm binary                                                                                                       | 2026-11-02 | shallow clone, MIT                                  |
| R5  | Claude Code 2.1.310 native binary (`strings` probe)                                                                                                   | 2026-11-02 | closed source; partial                              |
| R6  | Muse Code 1.4.14-R7309.1 launcher + binary                                                                                                            | 2026-11-02 | closed source; timing only                          |
| O1  | This worktree at `72d8d5003` + `f6a452642`, production builds, `temp/bench-*.sh`, `temp/perf-probe.*`, `temp/prof/`                                   | 2026-11-02 | —                                                   |
| O2  | `docs/certification/activation-diet.md`, `cc-winhook.md`, `cc-govfork.md`, `rlf-templeak.md` (prior records, read not re-measured)                    | 2026-11-02 | —                                                   |

Ideas are free; no rival code was copied into our tree. Hands-on
checks ran with no sign-in and no credentials.
