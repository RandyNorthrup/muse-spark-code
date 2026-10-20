# Real use: joined 0.19.0 final, Linux (lane REALUSE0190L, rig `linuxlt`)

Version: **0.19.0**. Git SHA: `bc71fc506bc08057c358cc8c4d00d5cf34ae19e`
(the FINAL join tree: every fix branch merged, release prepared).
Platform: Linux x64. Backend throughout: **Muse Code** (the signed-in CLI,
1.4.10, the person's own install — never the lanes' pinned copy).
Model named on every request the packed product made:
**`muse-spark-1.3-contributor`** (contributor mode on in the person's own
`~/.config/muse/settings.json`; the product starts
`serve --contributor-mode on` from that setting — observed in the process
table). No API key read or stored anywhere in this run.

Model calls through the product: **24 of 40** (`model_completed` events in
Muse Code's own session records), **$0.00 of $2.00** (subscription backend,
every ledger settled `$0.00`). Tier proof: 6 product sessions rooted in my
scratch workspaces hold **48 provider `model` lines naming
`muse-spark-1.3-contributor` and 0 naming plain `muse-spark-1.3`**
(§ Tier proof). No request was ever left to the product default, and no
session shows a non-contributor tier.

Scope rule for this lane: repeat nothing the earlier Linux lanes proved
that the join did not touch (their records stand:
`release-0.19.0-ru{features,limits,trains,truth,platform,startup}l.md`,
`contribmode-2026-10-18.md`); prove everything the join changed or
combined (per-target packages, solid archives + first-use extraction,
legal-data archive, zopfli, the NOLIMITSFINAL2 re-parse, the #203
re-landing, broker idle wording).

## Build and package (step 2)

- `npm ci`: exit 0. `npm run build`: exit 0, all budgets green (the What's
  New bound the trains lane hit is fixed at the join: the 0.19.0 notes fit).
- Linux helper built the CI way:
  `buildLinuxHelper()` → `native/linux/x64/muse-created` (gitignored build
  output, same compiler invocation as `build.yml`'s linux-native-build).
- Zopfli: the pinned `.github/vsix-compress/requirements.txt`
  (`zopfli==0.4.3`) installed into a project-local `.venv-zopfli`
  (removed afterwards); the packager refuses to fall back to zlib.
- `node scripts/package-vsix.mjs --target linux-x64`: exit 0,
  **`muse-spark-code-linux-x64-0.19.0.vsix`, 3,587,261 bytes against the
  unchanged 3,788,800-byte budget**. Manifest asserts
  `TargetPlatform="linux-x64"`; member scan holds only
  `native/linux/x64/muse-created`, `native/linux/x64/muse-vault-peer` and
  the cross-platform `native/runner/*` — zero darwin/Windows pieces.
  Ships the join's solid archives: `dist/webview.json.br`,
  `dist/legal-data.json.br`, `vendor/high-quality-projects-skill.json.br`,
  `dist/runtime.bundles.json.br`. PASS (#246).
- `npm run package:acp`: refuses as designed on a single-arch rig —
  `Required native helper is missing for the universal package:
native/darwin/muse-vault-peer-arm64` (macOS CI builds it). The ACP drills
  below drive `dist/acp.js`, the packed agent's own entry — the same bytes
  the tarball ships. The untargeted fallback `.vsix` likewise needs CI's
  arm64 helper; same pre-existing handoff, not a defect.

## Behaviour log

Key: PASS = happened for real as documented. FAIL = defect (none open;
one observation in § Findings). NOT RUN = needs something unreachable.

### Packed product reports 0.19.0; two-turn conversation (answer, then byte-exact file)

- `node dist/acp.js --version` → `0.19.0`. PASS.
- Panel (packed `.vsix` installed into real VS Code 1.139.0 under Xvfb,
  isolated `--user-data-dir`/`--extensions-dir` in `temp/`, scratch
  workspace outside the repo): model pill set to
  `muse-spark-1.3-contributor Max` (picker lists all four `-contributor`
  counterparts with `1M context · Contributor`; selecting one raises the
  native contributor confirm, confirmed with the OS keypress).
  Turn 1 `Reply with exactly this word: PANELFINAL` → answered
  `PANELFINAL` exactly. Turn 2 `Create a file named panel-note.txt
containing exactly this line: BYTE-EXACT-7` → `Write panel-note.txt
Added 1 line`, file on disk `xxd`-verified as exactly
  `BYTE-EXACT-7` (11 bytes, no trailing newline). PASS.
- ACP (`dist/acp.js --allow-contributor-models` over stdio, model set to
  `muse-spark-1.3-contributor` by `session/set_config_option`):
  turn 1 `Reply with exactly this word: ACPFINAL` → `ACPVERIFIED`
  (plus the #203 notice, see below), turn 2 creates `acp-note.txt`,
  `xxd`-verified as exactly `ACPBYTE-9` (9 bytes). PASS.

### No limit of ours (#239 #240 #228 #229, NOLIMITSFINAL2 re-parse at the join)

- `exec --backend modelApi --max-requests 100000 --max-budget-usd 100`:
  parsing passes (exit 3, missing key only),
  `limits: {budgetUsd: 100, maxRequests: 100000, timeoutSeconds: null}`.
  The 1–500 clamp the limits lane proved is gone — the join accepts any
  positive integer, absent means no limit (`maxRequests: null`). PASS.
- `--max-budget-usd 25.50` (and 100): accepted, exit 3 at the missing key,
  `settled $0.000000, uncertain $0.000000` — amounts above 20 are honored,
  a refused run books nothing. PASS.
- Error text names the real cause: `This computer's credential store is
unavailable, so stored keys cannot be checked.` (#235/#161). PASS.

### Account error truth (#235)

In a scratch data home (the accounts file is
`$XDG_DATA_HOME/muse-spark-code/providers.json`, not the config dir —
found by reading the store, after one mis-aimed probe that wrote a test
row into this lane's own providers file and was removed again; the
person's real data was never touched):

- Garbage file + write op → exit 1, `The providers file is invalid, so
its entries were refused and the file was left unchanged.`, file
  byte-identical afterwards. PASS.
- `providers.json` as a directory → exit 1, `Accounts are unavailable
(EISDIR: illegal operation on a directory, read).` PASS.
- `list --provider ghost` (unconfigured) → exit 1, `Accounts are
unavailable until this runtime is connected to the shared account
service.` PASS.

### Manual mode asks before every command, and a denial is honoured (#251)

Panel permission mode is Manual (shown as `Permission Mode: Manual`).
Turn 2's verify loop raised an MCP approval first
(`Muse wants to use mcp__ide__getDiagnostics — Allow once / Allow for
this session / Always allow this MCP tool / Reject`, with
`Judge: Same Model · muse-spark-1.3-contributor · Subscription`) —
allowed once, turn completed with `Diagnostics check returned no
errors`. Turn 3 `Run the shell command touch denied-marker.txt` →
approval card `Muse wants to touch denied-marker.txt — Allow once /
Always allow in this workspace: touch ... / Reject`; Reject opens the
approval question (`Approve running 'touch denied-marker.txt' in this
folder? — Approve (Recommended) / Deny / Other / Submit / Explain
Instead / Cancel`); Deny + Submit → the model answers
`The shell command was not run — approval was denied, so
denied-marker.txt was not created.`, then verifies preserved work
(`panel-note.txt still contains exactly BYTE-EXACT-7, with no
diagnostic errors`); `denied-marker.txt` never exists. PASS both halves.

### Session delete (#250)

- Panel on the Muse Code backend: History offers **no** Delete — by
  design (`canDeleteSessions` is absent on a Muse Code host until the
  D26 reader injection lands; the webview wires `onDelete` only when the
  flag is set). Verified: the history row (`LI.palette-item
history-row`) carries zero buttons. The committed suite
  `test/unit/sessionDelete.test.ts` covers the refusal (24/24 green
  with the retry/account suites, repo timeout, `--maxWorkers=3`).
- ACP `session/delete` on the Muse Code backend → error
  `Internal error: Muse Code 1.4.10 cannot delete conversations.` — the
  plain refusal naming the version and therefore the real cause. PASS
  (the refusal half, live). Deleting where the backend can (Model API
  backend) needs a provider key: NOT RUN, stated plainly.

### The workspace PATH guard (#249) and the shell-sandbox probe (#185, F91)

Scratch workspace with `bin/` first on PATH holding a fake `bwrap`
(exits 0, would touch a marker) and a fake `muse` (same). Two live ACP
sessions started the backend from this poisoned PATH:

- The product spawned the real absolute-path
  `/home/randy/.local/bin/muse serve --contributor-mode on
--trust-workspace` (ACP log line); neither planted program ever ran
  (no marker files after both runs). PASS.
- The sandbox probe refused the planted `bwrap` and probed the real one:
  the fake exits 0, yet the product reports `Shell sandbox check: the
system bwrap probe did not pass here` — the verdict only the real
  (user-namespace-blocked) `bwrap` can produce. The panel carries the
  F91 notice verbatim on every surface: `Muse Code's shell sandbox
cannot start on this machine: its bubblewrap sandbox cannot create a
user namespace here, ... Set museSpark.shellSandbox to off, or allow
unprivileged user namespaces on this machine
(sysctl kernel.unprivileged_userns_clone=1; where AppArmor restricts
them, kernel.apparmor_restrict_unprivileged_userns=0). The sandbox
stays on until you choose.` (also as the ACP first chunk and the
  terminal `[warn]`). PASS.

### Composer placeholder, What's New, walkthrough (F67, #187, #203)

- Composer placeholder: `Ask Muse… (Ctrl+Esc to focus)` — this
  platform's real focus shortcut. The Getting Started text states the
  other platforms' variants beside it. PASS.
- What's New page (packed, `Muse Spark: What's New`): `You're on
version 0.19.0.` with the `[0.19.0]` Highlights and full notes; the
  page fits its bound (the build's whatsnew gate is green). PASS.
- Walkthrough (`Muse Spark: Open Walkthrough`, listed on Welcome as
  `Get Started With Muse Spark`): all five steps expand; the selected
  step's markdown media renders in its own webview with the packed
  picture — `open.webp` loaded `complete=true`, 690 px wide. PASS.
- #203's notice (re-landed at the join, `8c91573c0`): observed verbatim
  in live turns — `The turn finished its visible work; background checks
are still running.` (panel turns 2–3, both ACP turns). PASS.

### Solid archives extract on first use (VSIXWEB)

- `dist/webview.json.br` extracted to the extension's global storage as
  `webview-<sha256>`: the directory name equals the archive's SHA-256
  (`090e5142…`), holds the 18 verified members, and the packed install
  has no loose `dist/webview` — the booted panel necessarily serves the
  extracted bytes. Both chat and Models surfaces boot from it. PASS.
- `dist/legal-data.json.br` + `vendor/*.json.br` ship (member list);
  `legal --format text` runs from the packed build (exit 0 with the
  honest empty-workspace findings). The vendored-skills Install prompt
  appears in the panel (`...They are copied into your Muse config
folder. Install / Not Now`); dismissed with Not Now — installing
  would write outside the scratch workspace, so extraction-on-install
  stays NOT RUN with that reason. The webview path above proves the
  mechanism; the skill archive rides the same resolver.
- Legal-data archive: `check-legal-build-records` green in the build
  (123 bundles, 2298 files, 0 problems; repository scan 149 findings,
  0 blockers). The `legal` scan above is the packed-product run. PASS.

### Governor and limit defaults (D121)

Packed `package.json` (114 settings) plus the generated reference:

- `hooksMaxStopContinuations`, `hooksMaxRunningCommands`,
  `subagentMaxConcurrent`, all four `plugin*` settings and
  `schedulePauseAfterFailures` default to **0** (none set, none enforced);
  `modelApiMaxRetries` defaults to null (providers' documented maxima
  govern unless the person sets it). No other numeric default is a
  consumption cap: the five non-zero numbers are retention windows
  (`archiveInactiveSessions` 14, `cleanupPeriodDays` 30,
  `usageHistoryDays` 365, `mediaUploadExpiryDays` 7) and the vault idle
  lock (`lockAfterIdleMinutes` 240). The panel's Resources chip reads
  `Normal` with the governor holding nothing back. PASS (each number
  accounted for; a set-value refusal needs a live threshold no scratch
  run can reach without manufacturing load — covered by suites).
- First panel open starts Muse Code at once: extension activates on
  `onStartupFinished` with zero exthost errors; `Restart Muse Code`
  spawns a fresh `serve --contributor-mode on` within the same minute
  (observed PID with start time), and the next turn answers (`Thought
for 1s`). Nothing is queued behind paused work (nothing is paused;
  the start is not gated on the governor). PASS.

### Error paths (#235 #238 #242 #161, ChatGPT #180, vault)

- #238 playbook, in a scratch data home: corrupted `.jsonl` journal →
  exit 1, `The playbook is unavailable in this session.`; read-only
  journal dir + `settings offload on` → exit 1, `The playbook command
could not be completed.`; settings restored (`offload on`, status
  green) afterwards. PASS both.
- #242 panel retry (Agent-map pre-flight): needs an ended agent with an
  isolated checkpoint — no subagent run in this lane, same wall as the
  Mac truth lane. NOT RUN live; covered by the committed
  `test/unit/panelRetryTruth.test.ts` (green below).
- #161 money and credentials: refused runs book nothing (all ledgers
  `settled $0.000000, uncertain $0.000000, requests 0`); the Model API
  key path names the unavailable credential store (see § No limit).
  PASS.
- ChatGPT plan route (#180), no account: `providers status chatgpt` →
  exit 1, `This computer's credential store is unavailable. Sign in
from an interactive desktop session with an unlocked credential
store; on Linux, start Secret Service first.` — the real cause, not a
  guess. Full dispatch needs an account: NOT RUN beyond this. PASS as
  far as reachable.
- Vault on Linux without Secret Service (bus pointed at nothing):
  `vault status` → exit 1, `The broker cannot start. First-party keys
still work; agent uses are refused. Repair the broker installation.` —
  word-for-word the platform lane's post-fix sentence on the joined
  tree. PASS (BROKERFIX idle-out changes nothing on this path).

### Tier proof

Muse Code's own records (`~/.local/share/muse/sessions/2026/10/20/`,
matched by `workspace_root` = my scratch workspaces):

- 4 main sessions (2 panel mains incl. the Judge-isolated plan session
  roots `muse-spark-judge-*`, 2 ACP): **48 provider `model` lines name
  `muse-spark-1.3-contributor`, 0 name plain `muse-spark-1.3`**.
- `model_completed` events: 24 total (10 + 1 + 1 + 1 + 8 + 3) — 24 calls
  of 40, $0.00 of $2.00 on the subscription backend. (A fifth, foreign
  session from lane NOLIMITSQ shares the rig clock; excluded by
  workspace root.)
- The product's serve runs the person's install with the person's
  setting honored: `muse-bin-1.4.10-R6427.1 serve --contributor-mode on
--trust-workspace` (process table, two generations: first start and
  post-restart).

## Findings and observations (no open FAIL)

1. **Post-restart session resume refuses with its real cause.**
   Sequence: backend restarted → window reloaded → conversation restored
   from History → new turn sent. The turn did not dispatch; reopening
   the conversation from History then showed the notice:
   `Could not resume the conversation: command 01a15ac6-…
rejected: session MCP configuration conflicts with the loaded
session runtime`. The product names the command and the backend's
   rejection instead of wedging silently, and a fresh conversation
   works at once (turn 4 answered `AFTERRESTART` exactly, `Thought for
1s`). Not a FAIL: the failure is reported with its cause and the
   recovery path works; recorded so the join owns the wording.
2. **First-run dialogs are environmental.** A bare `code` profile shows
   its theme picker and the built-in GitHub extension's auth nag (the
   scratch first lived inside the repo, whose origin is github.com;
   moving scratch outside the repo ended it). Dismissed; nothing from
   the product. The `stopped unexpectedly` crash report was my own
   `pkill` of the first window during setup.
3. **Restart blanks the panel webviews until reload.** After `Restart
Muse Code`, the chat/Models webviews read 0 chars until a window
   reload; after reload the conversation restores from History
   (transcript + denial record intact) but the model pill reverts to the
   shown base model (`muse-spark-1.3 Max`) — matching the documented
   keep rule (the next message goes out on the shown model), so the
   contributor model was re-selected with its native confirm before
   turn 4. Observation only; no silent behavior anywhere.

## Gates and suites

- `npm run build`: exit 0 (budgets, l10n, reference, host-api, bundle
  gates all inside; `check-legal-build-records` 0 problems).
- `node scripts/package-vsix.mjs --target linux-x64`: exit 0,
  3,587,261 / 3,788,800 bytes (zopfli recompress + size check inside).
- `npx vitest run test/unit/sessionDelete.test.ts
test/unit/panelRetryTruth.test.ts test/unit/accountErrorTruth.test.ts
--maxWorkers=3`: **24/24 pass**, repo timeout, this final tree.
- No `src/` changes in this lane (real-use only): format/eslint/
  typecheck gates ride the untouched final tree; the record file passes
  `prettier --check` (run before commit).
- Processes: every process this lane started was stopped (VS Code
  window, Xvfb :99, both product `serve` generations, ACP clients);
  verified none remain. The rig's own lane-driver processes untouched.

## Commits

- (this change) the record above. Trailer per common.md (Muse engine).
- No code changes: nothing to fix, nothing left red.
