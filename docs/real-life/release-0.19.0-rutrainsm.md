# Real use: 0.19.0 trains group (PR #227 + PR #241) — 2026-10-18

Lane RUTRAINSM, rig `macmini` (macOS arm64), worktree `/Users/randy/lanes/RUTRAINSM`,
branch `realuse/0190-trains-m`, HEAD `9483a6b8d` at start
(version `0.19.0`, `muse` CLI 1.4.10, node v24.21.0).

Group under test: PR #227 (train/rc-2026-10-17 = #188 #191 #192 #193 #197 #198
#199 #200 #201 #204 #211 #212 #213, plus main-now #210 #176 #184) and PR #241
(train/older-fixes = #167 #177 #178 #179 #186 #187).

Model calls (product's own records): 2 live Muse Code turns
(`trains-ok`, `ultra-ok`), each `requests 0; settled $0.000000`. Against the
40-call / $2.00 cap: 2 calls, $0.00 spent. No API key exists or was read; the
OS credential store is unavailable in this sandbox, so store-backed steps
answer with the designed store sentence (never a key — none was touched).

## F0 — production build (FAIL, defect 1, release-prep owned)

Did: `npm ci --ignore-scripts` (ok), `npx --no-install husky` (ok),
`npm run build` on the clean tree.
Product said: `Error: CHANGELOG.md 0.19.0: its release notes decode to 91779
bytes, over the What's New bound of 76800 bytes; trim the notes
(docs/RELEASING.md)`, exit non-zero, before any bundle was written.
FAIL. Cause: the combined [0.19.0] notes of every group merged into
release/0.19.0 exceed the What's New artifact bound by ~15 KiB; the final join
only grows them. No one group can fix this by trimming only its own entries,
and raising the bound would weaken a gate — so this lane changed neither.
Recommendation for the lead: trim at release prep (many entries, e.g. the
seven M101 frozen-digest notes, say "No user-facing change" yet ship in full).

Driving workaround (local only, reverted, final tree untouched): saved
`CHANGELOG.md` to gitignored `temp/`, trimmed the working copy's 0.19.0 body
to Highlights + one placeholder line, built, restored the pristine file.
`git status` after restore shows only intended files. The driven `dist/`
bundles are production esbuild output of the real tree; only
`dist/whatsNew.json` reflects trimmed notes (the /whatsnew result below is
marked accordingly). With the trim, `npm run build` exits 0, including
bundle budgets, `THIRD_PARTY_NOTICES`, and the legal build-records + repository
scans (`93 bundles, 1989 files, 0 problems`; repository scan `0 incomplete,
0 blockers`). The macOS `muse-dictate` helper was built the documented way
(`sh native/darwin/build.sh`, gitignored binary). `npm run package` /
`package:acp` were not attempted past the build wall (prior lanes record the
Linux-helper wall on macOS); everything below drives `dist/` directly.

## Live turns on the Muse Code backend (PASS)

- `acp.js exec --backend museCode --permission-mode acceptEdits "Reply with
exactly: trains-ok"` → `trains-ok`, `Completed; requests 0; settled
$0.000000`, exit 0. PASS.
- Same with `--model muse-spark-1.3 --effort ultra "Reply with exactly:
ultra-ok"` → `ultra-ok`, exit 0. PASS (ultra forwarded, no 400).
- `--model muse-spark-1.2 --effort ultra` → `[error] This effort is not
available for this model.`, exit 2, nothing dispatched. PASS.
- `--effort bogus` → usage refusal naming `--effort` with the accepted list,
  exit 2. PASS.

## B1 — `--effort none` (FAIL, defect 2, fixed and re-driven to PASS)

Did: `exec --backend museCode --effort none "hello"` and the Model API
variant. Product said (before fix): `Invalid value for --effort; ...
(accepts minimal|low|medium|high|xhigh|max|ultra)`, exit 2, on both backends —
but the [0.19.0] notes promise "`exec --effort` accepts `none`" (lane
REASONSHAPESR2, this group). FAIL. Cause: the terminal's enum gate
(`enumRefusal` in `src/runtime/cliArgs.ts`) validates against the help table,
whose effort enum listed only the seven tiers, so `none` died before
`parseExec` (which takes it). Fix: the effort help fact now carries
`[...EFFORT_LEVELS, THINKING_OFF_EFFORT]` (`src/runtime/cliHelp.ts`); nothing
else changed. Re-drive after rebuild: museCode `--effort none` →
`[error] This effort is not available for this model.`, exit 2, nothing sent
(the per-model record refusing an untaken value, as designed); Model API
`--effort none --max-budget-usd 0.01` passes parse to the credential-store
readiness sentence; `exec --help` names `none` in the accepts list. PASS.
Cover: `test/unit/cliHelp.test.ts` takes-none-past-the-gate test.

## B2 — tool-output cap surfaces (PASS, plus guard-test fallout fixed)

- `exec --max-tool-output-bytes 10` → `below the readable floor of 1,024
bytes`, exit 2. PASS (floor first, before key/store).
- `--max-tool-output-bytes 1024 --backend modelApi ... --max-budget-usd 0.01`
  → parse accepted; ends at the credential-store sentence, exit 3. PASS.
- `help --all` documents `museSpark.modelApiMaxToolOutputBytes` (64,000
  default, guard/spill/removal/30-day, `exec --max-tool-output-bytes`). PASS.
- `exec --help` (one screen) omits the flag. The help/parse guard test
  (`shows or maps every parsed option`) failed on the merged tree because the
  flag was parsed but neither shown nor mapped — fallout of authoring the
  per-command table (PR #213) apart from the flag (PR #177). Fix: the flag is
  mapped in `CLI_NON_TOPIC_OPTIONS.exec` like the other off-screen exec
  options (`src/runtime/cliHelp.ts`); the full reference still documents it.
  Guard suite green after. PASS (fix + CHANGELOG line).
- Spill files, overflow recovery (≤3 sends), hook-output bound, 30-day prune,
  above-window refusal sentence: NOT RUN — each needs a live Model API turn
  with a real key (lead-run, as lanes REALUSE177/178 recorded).

## B3 — request-cap surfaces (PASS; live limit NOT RUN)

- `exec --help` reads `Set the maximum request allowance. The last model call
produces a final summary without tools.` PASS (PR #178 wording on the
  merged tree).
- `exec --max-requests 60 --backend museCode` → `These options require the
Model API backend.`, exit 2, nothing dispatched. PASS.
- The 200-call wrap-up, `request_cap`/exit 5, German sentence, held-input
  re-queue, goal-wake-once, `usableReply` gating, xAI `/compact`: NOT RUN —
  each needs a Model API turn burning to the cap (lead-run).

## B4 — MCP connector (PASS at the surface; flows NOT RUN)

- `mcp --help` prints usage, exit 0. PASS.
- `mcp --connection ../x`, `mcp status --connection ../x`,
  `mcp grant --connection ../x --workspace .` → usage text, exit 2, nothing
  written (a malformed name is never echoed — it could be a pasted
  credential). PASS (refused as the notes promise).
- Grant/approve/audit/limits live flows: NOT RUN — they need the loopback
  approval page and a second agent (lead-run).

## B5 — legal scan (PASS)

- `legal --help` prints its own screen (format/out/registry, exits
  0/1/2). PASS.
- Bare scratch workspace (README only): honest `Incomplete: distribution set
unknown`, exit 2. PASS (no invented completeness).
- MIT LICENSE + `package.json` (`license: MIT`), no deps: `completed with no
findings`, still exit 2 with the same named incomplete (a bare folder is
  not distribution evidence). PASS.
- This repository's own scan during the build: `0 incomplete, 0 blockers`
  (the fully-evidenced exit-0 path). PASS.

## B6 — `/whatsnew` over ACP (mechanism PASS; content provisional)

Did: stdio ACP `initialize` (agent `muse-spark-code-acp 0.19.0`), `session/new`
(models offered bare as in PR #179; effort tiers incl. `Ultra`, default
`high`), `session/prompt` with `/whatsnew`.
Product answered locally (`stopReason: end_turn`, no model turn) with
`# What's New in Muse Spark Code / You're on version 0.19.0 / Released
2026-10-17` plus the Highlights. PASS for the mechanism. Content note: the
notes body is the local-driving trim (see F0); the shipped text is whatever
release prep selects after the trim.

## B7 — usage surfaces (PASS; Unknowns are honest here)

- `usage summary|daily|models`, `usage --help` (incl. `--range/--by/--json/
--csv`): exit 0. Real durations and percentiles render; the models
  breakdown names the sent model (`museCode / muse-spark-1.3`). PASS.
- `Cached Input / Reasoning Tokens / Cache Hit Rate / Total Cost / Plan` read
  `Unknown` in this environment. Checked the journal: the shared machine
  store holds only v1 records (which carry no such fields — this release
  still reads v1/v2 by design), and my two `exec` turns journaled no usage
  records at all (the lane journal holds only the harness session's v2 turn
  records, which carry input/output tokens, plan-equivalent USD and duration
  but no cached/reasoning splits and no plan name). So `Unknown` is the
  honest rendering of the underlying records here, not a merge defect this
  lane can prove. Observation for the lead: headless museCode `exec` turns
  leave no usage records — if that is intended, the USAGETRUE wording
  overpromises for them; if not, the writer is absent. NOT PROVEN either way
  without a Model API turn.
- `usage daily` prints one row per day (no doubled days). PASS.

## B8 — accounts terminal surface (PASS, plus exit-code fallout fixed)

- `providers accounts list --provider meta` (no providers file anywhere) →
  `[{"id":"default","label":"Default Account",...}]`, exit 0: the built-in
  Meta entry works with no pre-existing file. PASS.
- `providers list` → `No providers are configured.`, exit 0. PASS.
- `providers models meta` (nothing configured) →
  `Unknown provider entry 'meta'; configured entries are: —.`, exit 1. Honest;
  PASS with note (no store, no file, nothing to list).
- `providers accounts` (bare) and `providers accounts list` (no `--provider`)
  printed the accounts usage but exited 1, while every sibling misuse exits 2
  (the documented contract). Blame dates the missing `exitCode: 2` to the
  2026-10-06 accounts surface — pre-existing, not merge fallout — but it sits
  on a trains-touched surface, so fixed here (`src/runtime/cliArgs.ts`) with
  a CHANGELOG line. Re-drive: both exit 2. PASS.
  Cover: `test/unit/accountsCommand.test.ts` misuse-exits-2 test.
- `exec --account nope hello` → refused before dispatch, exit 2 (accounts
  unavailable until sign-in capture; this rig reports `signed in: no` yet live
  turns complete through the CLI's own auth — the refusal is loud and safe).
  PASS with note.

## B9 — credential-store sentences (PASS)

- `auth status`, `auth github status`, Model API `exec` readiness: each says
  `This computer's credential store is unavailable, so stored keys cannot be
checked.` (the RVCLIFLOWS wording — never a false "no key is stored"), with
  the fitting exit. PASS. The GitHub device flow itself needs a browser and
  was NOT RUN.

## B10 — remaining terminal surfaces (PASS)

- `share/prompts/report/legal/providers/usage/auth/developer/fonts/playbook/
setup/resources --help`: each prints its own one screen, exit 0. `share
--help` names exit 7 for cancelled/refused shares; `scan-secrets --help`
  names exits 0/10/2. PASS.
- `scan-secrets clean.txt` → `0`, exit 0; file with the documented example
  AWS key → `1`, exit 10 (count only, no content echoed). PASS.
- `exec --backend bogus` → `Invalid value for --backend; ... (accepts
museCode|modelApi)`, exit 2, rejected value not echoed. PASS.
- `exec --auto-compaction` on the museCode backend → `These options require
the Model API backend.`, exit 2. PASS (auto-compaction is a Model API
  paid opt-in; headless needs `--max-budget-usd`).
- `prompts use --help` → exit 2 `Unknown option '--help'` with the
  positional-after-`--` guidance. Observation: per-command help lives at
  `prompts --help` (exit 0, documents `use --var/--confirm`); whether `use`
  should also answer `--help` is a product call, not a defect proven here.

## NOT RUN on this rig (no VS Code panel, no provider key, wrong platform)

Panel wording (#187) and Getting Started rows; keyboard-focus behaviour; Tab
consent/hook-policy/paid-price flows; Muse Voice proxy branches; the Linux
sandbox notice; the GitHub card/device flow; side-chat refusal (#201); the
review flows (#198); sign-in-across-restart sentences and `authRequired`
(#211 — needs a restart with a lost sign-in); MCP elicitation hooks (#191 —
needs a Model API turn into an MCP server); the `..foo` trust paths (#200 —
Windows-only); provider-refusal sentences, session-budget stop, `providers
add/test` network codes (#176/PROVERR — need a configured provider);
reasoning wire shapes for DeepSeek/Groq/Together/Z.ai/llama.cpp/Mistral/
Ollama/OpenRouter/Anthropic/OpenAI/xAI/Gemini/Copilot (#179 R2 — need the
27-request capture plan with real keys); auto-compaction admission and M101
evaluation internals (no user-visible surface by design); NOLIMITS4's removed
ceilings (absence of limits — nothing to trip headless); `prompts use`
scripted vars, `share`/`prompts` JSON flows, grant-backed dispatch
(CLIFLOWSFIX — need store/keys). None was stood in for.

## Incidental observations (not defects proven here)

- `mcp --connection ../x` refuses with usage + exit 2 but no reason sentence
  (malformed values are never echoed — they could be pasted credentials).
  Matches the "refuses" wording; noted only.
- `MSP schema fingerprint mismatch` warning (CLI 1.4.10 vs pinned SDK
  schema): the run proceeds under additive-optional evolution, as in prior
  lanes. Environmental.
- `exec --help` (one screen) omits `--max-tool-output-bytes` by the mapped
  hidden-option design; `help --all` documents it and the parser takes it.
- Refused runs leave no residue: scratch workspace holds only the probe
  files; no `.muse-spark/` created by refusals.

## Gates (final tree)

- `npx vitest run test/unit/cliHelp.test.ts test/unit/accountsCommand.test.ts
test/unit/execArgs.test.ts --maxWorkers=3` (repo default timeout): 3 files,
  131 tests, all pass, exit 0.
- `npm run check:reference`: exit 0 (77 features, 65 commands, 91 settings,
  31 slash, 278 CLI).
- `npx prettier --check` on the 5 changed files: exit 0.
- `npx eslint` on the 4 source/test files: exit 0, zero warnings.
- `npm run typecheck` (all five projects): exit 0.
- `npm run build`: exit non-zero ONLY at the What's New bound (defect 1
  above, `91779 > 76800`); with the documented local-only trim it exits 0
  with budgets, notices and legal scans green. Raising a timeout/bound was
  never used.
