# Real use — joined 0.19.0 release, macOS (lane REALUSE0190M, macmini)

Version 0.19.0. Git sha `bc71fc506b` (branch `realuse/0190-final-M`),
the FINAL 0.19.0 tree named in the run notes. Platform: macmini,
macOS 15.7.4, Intel x86_64, Node v24.21.0, VS Code 1.139.1,
Swift 6.2.4, bun 1.3.14, Muse Code CLI 1.4.11 (product pins
`@muse-code/sdk` 1.4.4; every run logs the schema fingerprint mismatch
and proceeds, as in prior lanes). Sandboxed lane shell: `ps` denied,
ScreenCaptureKit video denied, login Keychain has no search list here.
HOME and all sign-in variables untouched; scratch workspaces in gitignored
`temp/` only.

Model calls through the packed product: **7 / 40, $0.00 / $2.00.**
Every request the product made named `--model
muse-spark-1.3-contributor` (ACP `session/set_config_option` or exec
`--model`; never the default). Spend per the product's own records:
`settled $0.000000` on every run (Muse Code backend turns are not
metered in the run ledger). Tier proof from Muse Code's own session
records (`~/.local/share/muse/sessions/2026/10/20/<id>/session.jsonl`,
sessions found by the scratch workspace path): across all 14 session
dirs this lane opened, every `"model"` request line says
`muse-spark-1.3-contributor` (18 lines) or `same-as-main` (57); every
`run_model` record says `muse-spark-1.3-contributor`; `model_id:
muse-wonder-1.0` appears only on session-start/metadata records (the
CLI session opens on its default before the product's
`model_reconfigure` switches it — verified: previous wonder-1.0,
effective contributor, source `model_reconfigure`). **Zero lines name
plain `muse-spark-1.3`** — no breach, requests never stopped.

Prior M records re-used without repeating:
`release-0.19.0-ruplatformm.md` (rounds 1+2), `-rutrainsm.md`,
`-rulimitsm2.md`, `-rutruthm.md`, `-rufeaturesm.md`,
`release-0.19.0-newprs.md` (§RUNEWPRSM). Anything below marked
"prior proof stands" was proved there on this platform and is
join-untouched (checked by `git log` on its files).

## 0. Setup (all green)

- `npm ci --ignore-scripts` exit 0. `npx --no-install husky` (hook
  dir present). `npm run build` exit 0 first try — the What's New
  bound that blocked RUTRAINSM/RUFEATURESM now passes on the join
  tree (2 releases into `dist/whatsNew.json`).
- `sh native/darwin/build.sh` exit 0 (documented flags): thin
  `muse-vault-x64`, `muse-vault-peer-x64`,
  `muse-dictate-screen-x64.app` (14 locales), `dist/native/darwin`
  `muse-vault-x64/arm64`.

## 1. Per-platform packaging on darwin (join change — PASS)

- `node scripts/package-vsix.mjs --target darwin-x64` →
  `muse-spark-code-darwin-x64-0.19.0.vsix`, **3,709,883 bytes
  against the unchanged 3,788,800 budget** (~79 KB headroom).
  RUPLATFORMM round 1 measured ~3.81 MB (over) with locally built
  universal binaries; the join's per-arch thin slices bring this
  rig's local pack under budget. Two staging-only detours, both
  mine, neither product: (a) a `| head -40` SIGPIPE-killed build
  left `dist/webview/chunks/` deleted (build.mjs removes it at
  start) with a stale metafile — re-running the full build
  restored 173 chunks; (b) zopfli compression needs the pinned
  `zopfli==0.4.3` (`.github/vsix-compress/requirements.txt`):
  created a project `.venv`, installed the pin, packed, then
  removed `.venv` again (its symlinks tripped the legal
  repository scan: 4 incomplete; after removal 0 incomplete).
- Member audit of the packed vsix (182 members):
  `TargetPlatform="darwin-x64"`, version 0.19.0; **zero** foreign
  helpers and zero arm64 entries; darwin entries are the x64
  `.app` (14 locales), `muse-vault-peer-x64`,
  `dist/native/darwin/muse-vault-x64`; `dist/webview.json.br`
  with **no loose `dist/webview/` files**; the vendored skill as
  `vendor/high-quality-projects-skill.json.br` with loose
  `LICENSE`/`VENDOR.json`; legal data as
  `dist/legal-data.json.br` with loose `NOTICE.md`/`provenance.json`.
- Installed into real VS Code 1.139.1 with an isolated
  `--user-data-dir`/`--extensions-dir` in `temp/`:
  "successfully installed",
  `randynorthrup.muse-spark-code@0.19.0` listed. All of
  `museSpark.attachLatestScreenRecording`, `museSpark.vault`,
  `museSpark.lockVault`, `museSpark.showResources` registered
  (71 commands total in the packed manifest).

## 2. ACP agent packaging on macOS (join change — PASS)

- `npm run package:acp -- --target darwin-x64` exit 0:
  `dist/muse-spark-code-acp-0.19.0-darwin-x64.tgz`
  (3,255,960 bytes; 88 packaging checks green). The Linux-helper
  wall that stopped every prior M lane is gone: the targeted
  package stages only darwin-x64 natives.
- Everything below drives the EXTRACTED tarball
  (`temp/packed-acp/package`, `node dist/acp.js`), never the
  worktree — except §8's fix re-proof, which re-drove worktree
  `dist/` after rebuild and matched. `--version` prints `0.19.0`.

## 3. Solid archives carry the exact servable bytes (join change — PASS)

`temp/verify-archives.mjs` (scratch) reads the PACKED vsix with the
repository's own `solidTextArchive` reader:

- webview: 190/190 members SHA-256-verified, 190/190
  byte-identical to the built `dist/webview/` tree, and all 177
  emitted scripts named by `dist/meta/*.json` present.
- skill: 45/45 members verified.
- legal: 23/23 members byte-identical to `dist/legal-data/`
  (bare-string format by design in `legalArchive.mjs`; my first
  draft wrongly applied the webview reader — the format
  difference is intentional, reader and writer agree, and the
  legal scan in §4 proves it end to end).
- The panel itself could not be opened here: VS Code launches
  (CDP endpoint answers, `Chrome/150.0.7871.250`), but every
  Chromium child dies at sandbox init (`renderer process gone,
reason: crashed, code: 6`; `--no-sandbox` still yields zero
  targets) and no window ever forms. Same wall as RUPLATFORMM
  round 2's bootstrap-only panel. Extraction-on-first-open stays
  lead-run on a GUI Mac; everything up to it is proven above.

## 4. Two-turn conversation on the named model (PASS)

Driver `temp/lane-driver.mjs` (scratch) on the repo's own
`scripts/real-life/lib/product.mjs` harness, session on
`muse-spark-1.3-contributor` (offered among 8 models with
`--allow-contributor-models`; RUPLATFORMM round 2's open item 5 —
serve listing only 4 — is fixed in the join by RUFEATURESM's
opt-in: offered, settable and served on CLI 1.4.11, no wrapper).
Default mode `manual`, default model `muse-wonder-1.0`.

- Turn 1 (connection check): `end_turn`, quotes `RL-JOINM-1`.
- Turn 2: created `second-turn.txt` with exactly the 14 bytes
  `SECOND-TURN-OK` (byte-compared), `end_turn`, no permission
  asked (file tools edit unasked on Muse Code by design).
- `exec --backend museCode --model muse-spark-1.3-contributor
--allow-contributor-models` `"Reply with exactly this word:
quince"` → `quince`, `completed`/`end_turn`, exit 0,
  `settled $0`.
- PATH guard (#249): a delegating fake `muse` first on PATH in
  the workspace never ran (hit file absent) across all six
  agent runs, while real serve started every session. PASS.
  (PR249FIX8's execGuard layer is in the join and holds.)

## 5. No limit of ours (PASS throughout)

- Packed `exec --help`: `--max-requests` "without it, there is
  no request limit"; `--timeout` "without it the run has no
  deadline of its own"; `--max-output-tokens` "absent is the
  model's policy cap".
- `--max-requests 100000 --max-budget-usd 2500.75` parse and
  reach the backend (exit 3, store sentence only): no clamp, no
  $20 ceiling. Absent limits read
  `{"budgetUsd":"100","maxRequests":null,"timeoutSeconds":null}`.
- Refused Model API run books nothing: `requests 0`,
  `settled $0.000000`, `uncertain $0.000000`.
- Packed `package.json` defaults audit: `hooksMaxStopContinuations`,
  `hooksMaxRunningCommands`, `subagentMaxConcurrent`,
  `tabDailyBudgetUsd`, `modelApiMaxToolOutputBytes`,
  `schedulePauseAfterFailures`, `pluginHookTimeoutSeconds`,
  `pluginChildMaxMemoryMiB`, `pluginAnswerMaxBytes`,
  `pluginMaxFailures`, `reports.planMaxBytes` all `0`;
  `resourceGpuMaxPercent`, `resourceDiskBusyMaxPercent`,
  `modelApiMaxRetries` all `null`. D121 holds in the artifact.
- Governor live: `resources status --json` → all caps null,
  `memoryAvailableBytes` ~15.8 GB live, `memoryUsedPercent`
  ~54%; GPU/disk null on a one-shot read by design (sampled
  only under a set cap). Holds nothing back with nothing set.

## 6. Session delete, mode refusal, local commands (PASS)

- `session/delete` on the Muse Code backend → `-32603
"Internal error: Muse Code 1.4.11 cannot delete
conversations."` — the CLI version and the real cause. (#250)
- `session/set_mode` bogus id → `Invalid params: bogus-mode`;
  `session/load` still shows `manual`. A refused change keeps
  the running mode. (Zero model calls.)
- `/whatsnew` over ACP: local `end_turn`, `# What's New… /
You're on version 0.19.0 / Released 2026-10-18` + Highlights.
  The `\.`/`\-` escapes are deliberate (whatsNewText.ts: Markdown
  source for rendering ACP clients, Codex on PR #212), not a
  defect. Content is the final notes, within the enforced bound.
- `/playbook` with no journal: `end_turn`, "No playbook
  decisions recorded yet" + settings. Honest empty state; the
  loaded-playbook failure-carries-cause case needs a real
  journal (not invented here) and stays suite-covered
  (`playbookSurface`), as RUTRUTHM recorded.
- `/agents retry|continue no-such-agent`: the prompt request
  rejects `Invalid params: Continue is unavailable for this
agent or its current state.` Recorded as an observation: the
  #238 "row left → gone" sentence (`agentGone`) lives on the
  panel pre-flight (`panelRecoveryRefusal`, suite `panelRetryTruth`
  green); over ACP an unknown id refuses in fixed vocabulary
  without echoing the id. It never blames a checkpoint — the
  #238 core. For the lead to judge whether ACP should say gone.

## 7. Manual approval (#251 — NOT RUN here, cause measured)

Two turns asked for shell work; both answered "No shell tool is
available in this session" and ran nothing. Measured from Muse
Code's own records: the nested serve session's `toolset` is
`source: default, mode: all` with exactly the 24 `muse.*`
harness tools (workflow, read/write/edit_file, search, …) and
**no shell tool at all** — the lane sandbox shapes the nested
tool surface, and the model reports it truthfully. File tools
worked (turn 2). There is no command tool for Manual to ask
about, so ask-before-command cannot fire in this environment.
The #251 path itself is join-touched (JOINAREAPR/5,
PR251FIX6) but needs a host that offers shell (RUNEWPRSM
proved it live on the MacBook; R2.4's panel cards on this
rig). Re-prove on a shell-capable host; nothing here
contradicts it.

## 8. Credential recovery (FAIL → fixed in code, PASS)

`auth status` on a store-down machine printed a minified stack
(`Error: credential recovery failed at g
(credentialLease.js:1:8637)…`, exit 1, empty stdout) — a join
regression from the FIXOPEN merge (Oct 19): its catch reports
through `isStoreUnavailable`, but `recoverCredentialJournal`
threw a plain `Error` that the classifier does not recognise,
so a genuine store failure propagated raw. RUTRAINSM B9 proved
the sentence on the pre-join tree.

- Fix (`src/core/credentialLease.ts`): the two store reads let
  the store's own failure ride through instead of replacing it
  with an internal sentence (two `GENERIC` catches removed;
  `scripts/catch-baseline.json` regenerated 269 → 267).
- Cover (`test/unit/providerJournalRecovery.test.ts`): drives
  the real `recoverOpenRouterJournalReport` over the real
  `keyringSecretStore` with a dead entry — failed before
  (`credential recovery failed` propagated), 4/4 after, and
  the rendered sentence is `acpStoreUnavailable` with reason
  `store-unavailable`.
- Re-driven live on the rebuilt product: exit 1, one sentence,
  no stack: "This computer's credential store cannot be used
  (store-unavailable). On Linux the agent needs a running,
  unlocked Secret Service, such as GNOME Keyring or KWallet."
  CHANGELOG `[Unreleased]` carries the Fixed line.
- Same run's neighbours still honest: `auth status` Model API
  path ends at "…credential store is unavailable, so stored
  keys cannot be checked." (exit 3, `requests 0`);
  `providers accounts list --provider nope` → "Accounts are
  unavailable until this runtime is connected to the shared
  account service." (exit 1); `exec --account nope` →
  "Muse Code accounts are unavailable until sign-in…" (exit 2,
  refused before dispatch); `providers status chatgpt` →
  store-unavailable sentence (exit 1; #180 needs a signed-in
  route — lead-run).

## 9. Vault broker (NOT RUN — blocked, cause measured)

`vault status` (packed and worktree, normal and short TMPDIR)
→ "The broker cannot start. First-party keys still work;
agent uses are refused. Repair the broker installation."
(exit 1); `vault lock` the same. Measured, each eliminated:

- Peer helper works (`muse-vault-peer-x64 identity <pid>` →
  identity JSON, exit 0); slot helper present
  (`dist/native/darwin/muse-vault-x64`, Mach-O x86_64).
- Not socket length: short-TMPDIR run identical (the lane's
  154-char TMPDIR overflows darwin's 103-byte socket bound,
  but the fallback path was never reached either).
- Unix-socket bind works here (probe: BIND-OK).
- No stale state (no `broker.lock` anywhere).
- The broker child (`node dist/vaultBroker.js <payload>`)
  prints `vault-broker-refused` + `vault-resource-refused`,
  exit 1, even with a neutral data dir: its resource-governor
  setup errors before readiness.
  RUPLATFORMM (pre-join, same rig) launched the broker and
  reached the Keychain sentence, so the delta is join-side
  (VAULTKILL lock evidence, PR249FIX8 execGuard, VSIXDARWIN
  helper layout) meeting this sandbox — but the exact refusing
  call is below what this sandbox lets me observe (no `ps`, no
  tracing). Store/read-back/lock of a real item additionally
  needs the login Keychain, absent here. Nothing stood in;
  re-prove on the lead's unsandboxed Mac, where the broker is
  expected to start.

## 10. Platform surfaces (M)

- Resource readings (#244): §5 governor proof; bun 1.3.14
  present; OpenCode plugin dispatch stays suite-covered
  (`pluginDispatch` green in RUPLATFORMM; no model turn can
  carry one here). Fast-judge `probe` has no CLI surface
  (internal readiness; `npm run build:confine` not re-run —
  helper layout unchanged since RUPLATFORMM's green).
- Screen recording (#236): command registered (§1); a real
  recording is unproducible — `screencapture -v -V 2` fails
  "capture error: The operation could not be completed".
  R2.4 read the live product sentence over CDP ("No recent
  screen recording was found."); end-to-end attach stays
  GUI-Mac lead-run.
- Dictation host (#224): packed `dist/extension.js` holds
  **zero** `dictat` references; `dist/dictation.js` is a
  414-byte packed-runtime loader. Off the activation path in
  the artifact.
- Composer placeholder (#187): join-untouched
  (`composerPlaceholder.ts` last touched pre-join);
  `composerPlaceholder.test.ts` 2/2; packed bytes carry the
  `composerPlaceholderWithShortcut` template with the darwin
  `Cmd+Esc` fill. Live render needs the panel (see §3).
- #203 toasts: join-untouched (`vscodeBackgroundNotices.ts`
  last touched pre-join); needs an unfocused VS Code window.
  Prior proof (RUNEWPRS/N 203 PASS) stands.
- Legal scan from the packed product: MIT fixture →
  "completed with no findings" + named Incompletes, exit 2;
  the exit-0 path is the build's own scan (0 incomplete,
  0 blockers). The scan read the packed legal-data archive.
- `scan-secrets` / remaining terminal help screens: prior
  proof stands (RUTRAINSM B10; join-untouched surfaces).

## 11. Supply-chain gate (FAIL → fixed, PASS)

`security:audit` exit 1 on the final tree: two HIGH
`follow-redirects` advisories (GHSA-q3jh-wrc6-jgq8,
GHSA-8r9p-f939-6h3c), unexcepted, unrelated to this lane's
edits (no dependency touched). Fix per the repo's own
prescription and rule 9: `overrides` pin
`follow-redirects: 1.16.1` (no peers, Node >= 4.0,
published Oct 1, integrity recorded in PLAN.md beside the
M96INT3C entry); lock diff is 3 lines
(1.16.0 → 1.16.1, dev-only via `ovsx`). `npm ci` exit 0,
`security:audit` exit 0 (standing braces exception + one low
note remain).

- SAST (`security:sast`) exit 2, sandbox-blocked, no scan
  ran: `Fatal error: exception Failure: ca-certs: empty trust
anchors` — byte-identical to RUPLATFORMM2's record. For
  the lead/CI outside the sandbox.

## Gates (final tree, true exit codes, repo default timeout)

- `npm run build`: 0 (budgets hold; legal scans green).
- typecheck (all projects): 0. eslint on changed files: 0,
  zero warnings. prettier on changed files: 0.
  `check:catches`: green after baseline regen (GENERIC
  269 → 267, the two removed catches).
- `npx vitest related --run src/core/credentialLease.ts`:
  8 files, 46 passed, 2 skipped (pre-existing skips), 0.
- `composerPlaceholder.test.ts`: 2/2, 0.
- `deadcode`: 0. `cycles`: 0 (no circular deps).
  `duplication`: 0 clones. `check:l10n`: 0 problems.
  `check:reference`: current. `check:host-api`: 0.
  `check:plan`: 0 drift. `security:audit`: 0 (after §11).
  SAST: 2, sandbox-blocked (above).
- No product code changed for packaging/record/PLAN/lock
  edits beyond §8's fix; `git status` holds only the
  intended files (all scratch under gitignored `temp/`).

## Commits (this lane)

1. Credential-recovery fix + cover + catch baseline +
   CHANGELOG Fixed line (§8).
2. `follow-redirects` 1.16.1 override pin + lock + PLAN.md
   audit record (§11).
3. This record.
   Follow-ups for the lead: vault broker on an unsandboxed Mac
   (§9); panel extraction-on-first-open on a GUI Mac (§3);
   Manual ask where shell exists (§7); #180/#217 live routes;
   SAST outside the sandbox.
