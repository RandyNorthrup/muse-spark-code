# Real use: 0.19.0 trains group (PR #227 + PR #241) — lane RUTRAINSL

- Version: 0.19.0 (package.json), `muse-spark-code-acp 0.19.0`, problem
  report prints `extension: 0.19.0`.
- Git SHA: `85838cb3db` (first fix commit; plus the fixes below — see
  Commits). Group branch `realuse/0190-trains-l` on release/0.19.0 with
  PR #227 (train/rc-2026-10-17) and PR #241 (train/older-fixes) merged.
- Platform: Linux (rig `linuxlt`), x64. Muse Code backend through the
  signed-in CLI (report: `cli: found; signed in: yes`); no Model API key
  (credential store unavailable headless: `auth status` says stored keys
  cannot be checked). Machine journal shared with other lanes.
- Packed product: `npm ci` + `npm run build` green, then the repository's
  packed bundles as built from this tree (`dist/acp.js`, `dist/extension.js`
  production bundles). The universal `.vsix` / ACP tarball cannot be
  assembled on a single-arch rig (both packers require CI-built
  `native/linux/arm64/muse-created` and `native/darwin/muse-dictate`;
  only x64 builds here and artifact download was refused), so per the
  REALUSEREL precedent the full `.vsix` is CI's and `dist/` is the packed
  candidate. VS Code 1.139.0 driven under Xvfb with
  `--extensionDevelopmentPath` at the built tree (isolated user/extension
  dirs); `--no-sandbox` required (rig `chrome-sandbox` lacks setuid).
- Model calls: 7 against 40, $0.00 settled against $2.00 (all on the
  owner's subscription via the signed-in CLI): 4 headless exec turns, 2
  panel turns, 1 aborted `/whatsnew`-as-prompt probe (mispredicted: exec
  sends prompts to the model; cleaned its orphaned serve process). ACP
  `/whatsnew` and the effort-config query answered locally (no model turn).

## FAILs found and fixed on this branch

1. **Build red: 0.19.0 notes over the What's New bound.** `npm run build`
   failed: newest release decodes to 91779 bytes, bound 76800. Cause
   measured: the trains merges grew `[0.19.0]` from 20589 to 74625 raw
   bytes, including 23 entries byte-identical (whitespace-normalized) to
   entries already shipped under 0.18.x–0.17.x. Fix: deleted the newer
   copies only (every removed claim verified still present in a dated
   section; re-scan: zero full dups remain), condensed the M101
   eval-harness block, added the no-repeat rule to `docs/RELEASING.md`.
   Build green; encoded artifact 24555/40960 bytes, leaving join headroom.
2. **Panel notice clipped its `sysctl` tail.** The F91 sandbox notice
   rendered `kernel.apparmor_restrict_unprivileged_use` with `rns=0).`
   cut at the notice edge (`.notice` had no wrapping; an ancestor clips
   overflow). Fix: `overflow-wrap: anywhere` on `.notice`
   (`src/webview/styles.css`, the file's existing convention). Verified
   in the reloaded real panel: the full `userns=0). The sandbox stays on
until you choose.` wraps and reads.
3. **`exec --effort none` died at the option gate.** The [0.19.0] notes
   (REASONSHAPESR2, PR #179) say it accepts `none`, but the CLI refused:
   `Invalid value for --effort ... (accepts minimal|...|ultra)`. Root
   cause: `factFor('effort')` in `src/runtime/cliHelp.ts` listed only
   `EFFORT_LEVELS`, so `enumRefusal` rejected `none` before `execArgs`
   (which handles it) ever ran. Fix: list `THINKING_OFF_EFFORT` beside
   the tiers in the help fact and in `scripts/lib/reference.mjs`, added
   a CLI-layer test, regenerated the reference. Same real use now parses
   and the model's record decides: on this backend the CLI session's own
   effort config offers only the seven tiers (queried live over ACP), so
   the run is refused before dispatch with `This effort is not available
for this model.` — the certified fail-closed shape, verified correct
   against the session's config, not assumed.
4. **`exec --max-tool-output-bytes` missing from `exec --help`.** The
   committed `cliHelp` mapping test failed on this tree
   (`exec --max-tool-output-bytes: expected false to be true`):
   PR #177 added the parser flag and the l10n text but never the help
   topic entry. Fix: one topic line (`<bytes>` shape). Suite green.

## Driven live, PASS

- **Headless conversation (3 exec turns).** `exec 'Reply with exactly:
HELLO-RIG'` → `HELLO-RIG`; create `rig-note.txt` with exact line →
  `DONE`, file byte-exact; read it back → `RIG-NOTE-OK`. Exit 0 each,
  `$0.00` settled. A bare `--effort minimal --max-requests 3` run is
  correctly refused with `These options require the Model API backend.`
- **Panel conversation (2 turns).** After trusting the scratch folder, the
  first message started the backend (`Starting Muse Code…` → model pill)
  and the model answered `PANEL-HELLO` exactly; a `/` turn answered
  `Ready — what would you like me to do?`. Transcript, model pill and
  composer survive a window reload, and the next turn goes out on the
  shown model (`muse-spark-1.3`, also ✓ in the picker) — the #211 keep.
- **F91 sandbox notice on every surface.** Panel warning with the exact
  table text naming both ways out (after fix 2); first chunk over ACP;
  terminal `[warn]`; the model heard it once (its turn carried the
  sandbox note). The lane sandbox genuinely blocks bubblewrap user
  namespaces, so this fired for real; nothing switched itself off.
- **ACP `/whatsnew` (M99).** Minimal stdio client: initialize →
  `session/new` → `session/prompt /whatsnew` → `end_turn`, 2 chunks,
  52842 chars, `You're on version 0.19.0` + Highlights + full notes, no
  model turn.
- **Terminal commands (#213).** Every `--help` tried (exec, scan-secrets,
  report, share, prompts, developer, providers, usage, mcp) prints its
  own one screen; `exec --bogus-flag` exits 2 naming the option and the
  accepted values; `scan-secrets` prints only the count (0 exit 0, 1 exit 10) and its help names exits 0/10/2; `prompts list` reads `Prompt
Library`, `--json` gives `{"kind":"listed",...}`; `providers test
selftest` → `Unknown provider: selftest.`; keyless
  `providers add --preset openai` → `No key was entered, so nothing was
stored.`; `--max-tool-output-bytes 10` refused naming the 1024-byte
  floor; `mcp --help` exits 0; `mcp --connection ../x status` exits 2
  with usage; piped `mcp grant` refuses (`needs you to type`).
- **Legal scan (#193, NOLIMITS4).** Empty workspace: findings + exit 0.
  This repository: exit 0 over 1989 files — no file-count stop, no
  finding-count truncation (the one `incomplete` is my own running
  editor's socket under `temp/`, cleaned afterwards).
- **Usage (#167).** Durations, p50/p95, API-equivalent cost and the
  `museCode / muse-spark-1.3` breakdown render from the journal (v3
  records with per-turn `durationMs`). Cached input / reasoning / hit
  rate / plan read `Unknown` for these turns — honest: the journaled
  records carry only input/output tokens (CLI 1.4.10 reports no
  cached/reasoning counters on trivial subscription turns, and no meter
  reading arrived, so no tier names a plan). Counts agree across reads
  (117/117); one earlier 101-vs-102 split inside a single output was a
  concurrent lane write landing mid-read, not double-journaling.
- **Panel wording (#187, as far as reachable).** Composer placeholder
  `Ask Muse… (Ctrl+Esc to focus)`; Getting Started rows never overlap;
  `/` palette lists each command once (Attach, Mention, Clear, Resume,
  Continue ×2, Share ×2, Prompt Library, Use Saved Prompt, Plans,
  New Worktree); permission Modes read `Muse asks before running each
command, unless a permission rule allows it`; model picker opens with
  context limits stated (`1M context`) and the serving model checked;
  Providers panel states the empty case (`No model providers yet`) with
  ChatGPT/Copilot plan routes named.
- **Problem report.** Prints 0.19.0, signed-in CLI, no stored key, no
  paths, settings names-only.

## Not reached live (stated plainly, never stood in for)

No Model API key and no other provider/account on this rig: paid consent
popup, auto-compaction live runs, provider-refusal sentences against
real error envelopes, reasoning wire shapes, ChatGPT/Copilot plan
dispatch, session-budget stop, `providers add/test` against a live
endpoint, tool-rounds limit paths. No GitHub interaction: device-flow
login, `/github-login` card. Editor has the Git extension: native-git
route. No proxy / pinned VS Code versions: Voice proxy behaviours.
Windows-only: `..foo` paths. Keyboard-only driving could not open the
model pill's contributor marks (no contributor-tier models listed),
press the skills Install/Not now buttons (per-PR record + suites
stand), trigger a background permission question (focus badge path), or
raise a side-chat approval (M53 read-only refusal). Elicitation hooks
(#191) need an MCP server plus a model turn. The two teardown warnings
on every headless run (`task/stopAll ... failed: Error`,
`session/statusChanged for unknown session`) predate the group (M46,
M2) and change nothing (exit 0, answer delivered) — observation only.

## Commits

- `85838cb3db` — 0.19.0 notes trim (23 shipped-entry duplicates out,
  M101 block condensed, RELEASING.md rule); build green.
- `81054ed9fa` — notice wrap fix (`src/webview/styles.css`), `--effort
none` help fact + reference + CLI-layer test
  (`test/unit/cliHelp.test.ts`), `--max-tool-output-bytes` help topic
  entry, three CHANGELOG lines, this record. Each with trailer
  `Co-Authored-By: Muse Spark (contributor) via Muse Code`.
