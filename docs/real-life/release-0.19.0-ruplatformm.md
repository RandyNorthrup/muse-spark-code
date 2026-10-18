# Real use — release 0.19.0 platform group (lane RUPLATFORMM, macOS)

Version: 0.19.0. Git sha: `ba5d53370` (branch `realuse/0190-platform-m`).
Platform: macmini rig, macOS 15.7.4 (24G517), Intel x86_64, Node v24.21.0,
VS Code 1.139.1, Swift 6.2.4, bun 1.3.14. Sandboxed agent shell: `ps`,
`sandbox-exec` profile apply and ScreenCaptureKit video are denied here
(exact errors below); the login Keychain has no search list in this session.
Home is the lane-private sandbox home, so `~/Desktop` does not exist.

Group under test (merges `origin/main..HEAD`): #246 (per-platform .vsix),
#216 + #247 (vault core + parity), #236 (Attach Latest Screen Recording),
#244 (macOS parity: Seatbelt confine, OpenCode/bun, GPU/disk/headroom),
#220 (Windows process birth), #222 (browser-check network-service wait),
#218 (CI shards, no product behaviour).

Setup (all green): `npm ci --ignore-scripts`, `npm run build` (exit 0,
budgets hold), `sh native/darwin/build.sh` (repo script, same flags CI uses;
universal `muse-dictate`, screen app, `muse-vault`, `muse-vault-peer`),
`npm run build:confine` (exit 0). Only the packed product was driven
(the darwin .vsix installs below, plus the production `dist/` bundles the
packages ship; the `.tgz` assembly itself is CI-only — see 2).

Model calls through the product: **0 / 40, $0.00 / $2.00.** No grouped
behaviour needs a model turn; every surface driven starts no backend.

## 1. Per-platform .vsix on darwin (#246)

- `node scripts/package-vsix.mjs --target darwin-x64` → PASS:
  `muse-spark-code-darwin-x64-0.19.0.vsix`, 3,374,770 bytes against the
  unchanged 3,788,800 budget, `TargetPlatform="darwin-x64"` in
  `extension.vsixmanifest`. (Staged before the helper build, so darwin
  binaries were absent — the documented CI-built piece.)
- Rebuilt with the darwin binaries present, both darwin targets stage
  exactly the darwin entries (universal `muse-dictate`, screen app with
  14 locales, `muse-vault`, `muse-vault-peer`, runner helpers) and **zero**
  foreign helpers (`native/(windows|linux)` count 0), manifests
  `darwin-x64` / `darwin-arm64`. PASS on filter and manifest.
- Budget with locally built binaries: 3,814,015–16 bytes, over by ~25 KB,
  and `check-vsix-size` **refused it (exit non-zero) — the gate fires
  correctly.** The overage is the local toolchain, not the product: this
  rig's Swift 6.2.4 emits a 489,632-byte `muse-dictate` where the record
  (`docs/certification/vsix-platform.md`) measures ~80,798 deflated from
  CI's Swift 6.1.2 with identical repo flags (`-Osize`, dead-strip,
  `strip -x`). With production-size binaries the package estimates to
  ~3.57 MB (~224 KB headroom), but that estimate is mine: **the binding
  proof is CI's package job, which packs and budgets all six targets.**
  No code change; nothing to fix here.
- Installed the packed darwin-x64 file into the real VS Code 1.139.1:
  `code --install-extension` → "successfully installed",
  `randynorthrup.muse-spark-code@0.19.0` listed. The installed copy
  registers `museSpark.attachLatestScreenRecording`,
  `museSpark.vault`, `museSpark.lockVault`, `museSpark.showResources`,
  `museSpark.resumeResources`, `museSpark.downloadBrowserCheckRuntime`.
  PASS.

## 2. ACP agent packaging (#246)

`npm run package:acp` stops on macOS at the Linux-helper gate:
`Required Linux created-path helper is missing:
native/linux/x64/muse-created` (exit 1). `build-linux-helper.mjs`
returns early off Linux by design, so no single dev machine can assemble
the `.tgz`; CI composes darwin + Linux helpers. Not a product defect —
recorded so the join keeps the tarball assembly on CI. The shipped code
was still driven: production `dist/acp.js` (the exact bundle the package
carries) for every CLI behaviour below. PASS with that disclosure.

## 3. Vault on macOS (#216, #247)

- `node dist/acp.js vault status` (cold broker, then warm, then wiped
  state): the broker launches through the governed hand-off, POSIX peer
  checks pass with the base-system helper
  (`muse-vault-peer identity <pid>` returns identity JSON, exit 0), and
  status answers the designed sentence, exit 1:
  "The operating system's credential store is not available. On Linux,
  sign in to a desktop session … on macOS, unlock the login Keychain; on
  Windows, sign in interactively. Then try again." PASS.
- Two independent corroborations that the store is truly absent here (not
  a product miss): the product's own keyring binding —
  `getPassword` fails "Platform failure: A default keychain could not be
  found" — and macOS itself — `security list-keychains` fails
  `SecKeychainCopySearchList … not valid`. Unlocking needs the person's
  session/password, which this lane must not handle.
- Store / read-back / lock of a real item therefore cannot run in this
  session: stated plainly, nothing stood in. What does run was run:
  `vault setup` (non-TTY) honestly refuses — "Vault setup and recovery
  need an interactive terminal; headless runs cannot do them." `vault
lock` prints "Locked", exit 0 (idempotent; no vault exists to harm).
- Observation (not a FAIL): the very first cold start answered bare
  "No access" once; three subsequent runs including a wiped
  `vault/` state give the designed sentence. Unreproduced; the CLI masks
  only unnamed failures that way by design (RVAPP-CM1091D5). Left for
  the join to watch, no code touched.

## 4. Resource readings on macOS (#244)

- `resources status --json` (defaults, no caps): `memoryAvailableBytes`
  ~14.3–14.8 GB live (the libuv/headroom fix working),
  `memoryUsedPercent` ~57–58 %, `cpuPercent` null (one-shot, needs a
  delta), `gpuPercent`/`diskBusyPercent` null. The nulls are correct:
  `machineSampler.ts` samples GPU/disk only while the person set a cap
  (none by default, per the limits rule).
- With caps set in the machine file (`museSpark.resourceGpuMaxPercent`
  90, `museSpark.resourceDiskBusyMaxPercent` 90, file restored after):
  `gpuPercent: 0` — live, matching `ioreg`'s `"Device Utilization %"=0`
  on this idle Intel GPU. PASS. `diskBusyPercent` stays null on one-shot
  CLI reads by architecture (the delta baseline dies with the process);
  the in-process live test covers it — see gates.
- OpenCode plugins: bun 1.3.14 present; dispatch is suite-covered (gates);
  no model turn was needed or made (0 calls).
- Fast judge: helper builds (`npm run build:confine`, exit 0); `probe`
  fails closed in this sandbox — `sandbox-exec: sandbox_apply: Operation
not permitted` → `{"refused":"selfTest"}`. The confined run itself
  needs the lead's unsandboxed Mac (unchanged; paritymac items 1b–1f
  list the exact rerun). No widening attempted, none needed.

## 5. Attach Latest Screen Recording (#236)

- Command `museSpark.attachLatestScreenRecording` registered in the
  installed packed product (see 1). PASS.
- A real recording cannot be produced here: `screencapture -v -V 3`
  fails "capture error: The operation could not be completed" (exit 1)
  while stills succeed (real 2.4 MB PNG verified, then removed). No
  `~/Desktop`, no Screenshot recording anywhere reachable — the honest
  product answer on this machine is "no recent recording".
- The discovery half runs only inside the extension host (packed
  `dist/screenRecord.js` requires `vscode`); it was not stubbed — no
  fakes. End-to-end attach stays with a GUI host, exactly as the
  withheld CHANGELOG entry (T4) already requires. Windows halves (known
  folder, icacls) are out of reach on macOS by nature.

## 6. Browser-check wait (#222) and Windows birth (#220)

- #222 changes shared `src/core/browser/browserRun.ts` (wait for the
  network service before the contract read) to fix a Windows-only race;
  the macOS path and requirements are unchanged. Not drivable headless
  (browser + GUI); the Windows proof stands in `bcstart.md`. No macOS
  behaviour to show, none claimed.
- #220 changes shared `src/core/locks/processOwner.ts` but its diff
  touches no darwin/ps/sysctl line (verified); the Windows C# reader
  cannot run here. The darwin birth path works through base-system
  tools where the sandbox allows.
- #218 touches workflows/docs only. No user-visible behaviour on any
  platform.

## Gates and suites (repo default timeout, `--maxWorkers=3`)

- `npm run build`: exit 0 (budgets hold).
- `resourceProbesDarwin` 8/8 + `resourceDiskDelta` 2/2 (10/10) — incl.
  the live "reads GPU, disk and headroom from this Mac" on this
  two-driver Mac (PR244W1's fix holding in the merge).
- `pluginDispatch` + `recordingLatest` + `resolveLatestRecording`:
  78 passed, 2 skipped (installed-bun drills are Linux-only by design).
- `inspectNative`: 5 passed (pre-confinement + Linux-policy parity),
  5 skipped (live Seatbelt drills need an unsandboxed Mac; visibly
  skipped, same as the lane records).
- `fileLease`: 27 passed, 3 skipped, 4 failed — the 4 are the birth
  reads through `/bin/ps`, which this sandbox denies (`/bin/ps:
Operation not permitted`, measured directly). Measured against the
  untouched base: pre-#220 worktree `9754c1c7f` fails the same tests
  here (2/2 with the birth filter). Environmental and pre-existing, not
  a group regression; no fix warranted, none made.
- `npm run package` per-target gates: x64 green under budget without
  CI binaries; with darwin binaries the size gate correctly refuses the
  toolchain-fattened local pack (see 1); CI's package job is binding.
- No product code changed on this lane: no format/lint/typecheck
  deltas to report; tree `git status` clean (all artifacts ignored).

## Still open for the join

1. CI's package job must show all six targets (esp. darwin with
   production binaries) inside 3,788,800 bytes.
2. Vault store/read-back/lock needs a session with an unlocked login
   Keychain (person's Mac); plus the one unreproduced cold-start
   "No access" to watch.
3. Seatbelt live drills (`inspectNative` 5 skips) need the lead's
   unsandboxed Mac rerun (paritymac 1b–1f checklist unchanged).
4. Attach end-to-end needs a GUI Mac with a real Screenshot recording
   (withheld entry T4 stands); browser-check wait needs Windows.

---

# Round 2 (lane RUPLATFORMM2, branch `realuse/0190-platform-m2`)

Version: 0.19.0. Base: round-1 record above plus commit `c77e5bd7c`.
Platform: same macmini rig, macOS 15.7.4 Intel x86_64, Node v24.21.0,
VS Code 1.139.1, Swift 6.2.4, Muse Code CLI 1.4.10 (product pins
`@muse-code/sdk` 1.4.4). A VS Code instance with the person's own
profile was already running on the rig; it was left untouched (all
round-2 driving used isolated `--user-data-dir`/`--extensions-dir` in
`temp/` and a directly launched second instance).

Model calls through the product: **3 / 40** (1 CLI exec probe + 2 ACP
turns), all on `muse-spark-1.3-contributor`, every provider line `meta`.
Spend from the product's records: 3 tiny turns, well inside $2.00 (no
USD figure is exposed in the local records; nothing else was sent).

## R2.1. ACP packaging packs on macOS at last (fix, commit `c77e5bd7c`)

- FAIL reproduced: `node scripts/package-acp.mjs` stopped with
  `Required Linux created-path helper is missing:
native/linux/x64/muse-created` (exit non-zero), because
  `build-linux-helper.mjs` returns early off Linux by design.
- Fix (per the brief's rule 3, mirroring D123): `acpHelperPlan` in
  `scripts/lib/acpNativeSources.mjs` requires only the helpers the
  running platform builds (darwin helper on macOS, current-arch Linux
  helpers on Linux, none on Windows where C# compiles on first use)
  and skips absent foreign helpers with a loud warning; CI composes
  every platform's helpers and its content check still requires them
  all, so the release tarball is unchanged. CHANGELOG `[0.19.0]`
  Fixed carries the line.
- Proof: `test/unit/acpNativeSources.test.mjs` (4/4, repo timeout),
  a red drill (helper moved aside → `Required darwin helper is
missing`, restored byte-identical), and the real pack:
  `dist/muse-spark-code-acp-0.19.0.tgz` (3,046,050 bytes) stages the
  darwin helpers, the Windows sources, the runner helpers and all
  bundles, skipping the 4 Linux helpers with warnings. `npm install`
  of the tarball into `temp/` works and the installed
  `muse-spark-code-acp` serves ACP (used for every session below).

## R2.2. Two-turn conversation on the named contributor model (a)

- Driver: `temp/acp-two-turn.mjs` (scratch, gitignored) — a real ACP
  client on the repo's own `@agentclientprotocol/sdk` 1.7.0 against
  the installed packed agent (`--backend museCode
--allow-contributor-models --trust-workspace`), workspace a fresh
  empty `temp/ws`. Permission handler grants `allow_once` only and
  logs each grant (none were asked: Manual mode edits files unasked).
- Without contributor models listed, the driver refuses to continue
  (verified twice) and the product itself refuses:
  `session/set_config_option` → `Invalid params:
muse-spark-1.3-contributor`; packed
  `exec --model muse-spark-1.3-contributor` → `This model is not
available for this run.` Both fire before dispatch: 0 calls.
- Why unlisted: `muse serve` (CLI 1.4.10) answers `model/list` with
  exactly 4 non-contributor models (`muse-wonder-1.0`,
  `muse-wonder-full-1.0`, `muse-spark-1.3`, `muse-spark-1.2`) although
  the persisted CLI setting has `contributor_mode_enabled: true` and
  the CLI resolves/runs the contributor model itself (`muse exec
--model muse-spark-1.3-contributor` answered `exec-probe-ok`: call
  1/40). The agent also logs an MSP schema fingerprint mismatch
  (pins SDK 1.4.4, serves 1.4.10). Listing is not group-changed
  behaviour and contributor gating carries billing/consent weight, so
  no product change was made here: recorded for the join (see open
  item 5).
- With serve started naming the model (diagnostic-only
  `--muse-binary` wrapper in `temp/`, never committed, adding the
  CLI's own `--contributor-mode on --model
muse-spark-1.3-contributor` startup flags), serve lists 5 models
  including the contributor tier, and the packed agent held the real
  two-turn session `01a15079-d708-7640-abe3-d2aaa4c0a407`:
  turn 1 answered `rig-turn-one-ok` (`end_turn`); turn 2 created
  `temp/ws/hello-rig.txt` with exactly the 30 dictated bytes and no
  trailing newline (`cmp` BYTE-EXACT, `end_turn`). Calls 2–3/40.
- Provider-line audit in the CLI's own session records
  (`data/muse/sessions/2026/10/18/01a15079-…` and the exec probe's
  `01a15071-…`): every `"model"` line says
  `muse-spark-1.3-contributor` (6 + 2) or `same-as-main` (13 + 6),
  every `"provider"` line says `meta` (6 + 2). No other model on any
  request. The failed pre-prompt sessions hold no provider lines.

## R2.3. Vault for real (b): the product can only use the login Keychain

- Read the slot code end to end: `native/darwin/VaultKey.swift`
  hard-codes `NSHomeDirectory()/Library/Keychains/login.keychain-db`
  (`loginKeychain()`, `keychainQuery()`), and its own comment says
  production takes no path from argv, stdin, environment or settings;
  no `MUSE_SPARK_VAULT*`/keychain-path setting or variable exists in
  `src/` (checked). There is nothing to point at an isolated
  keychain, so none was created and the login Keychain was never
  touched; no keychain was added to any search list.
- What the person sees, re-verified on this build
  (`node dist/acp.js vault …`): `status` answers the designed
  sentence (`The operating system's credential store is not
available. … on macOS, unlock the login Keychain … Then try
again.`); `lock` prints `Locked`. Store / read-back / lock /
  unlock of a real item needs the person's unlocked login Keychain
  (open item 2 stands). No code change.

## R2.4. The real panel over CDP (c)

- Packed `muse-spark-code-darwin-x64-0.19.0.vsix`: filter and manifest
  PASS (all darwin entries incl. universal `muse-dictate`, screen
  app, `muse-vault`, `muse-vault-peer`; zero foreign helpers;
  `TargetPlatform="darwin-x64"`). `check-vsix-size` refuses the local
  pack (3,814,201 vs 3,788,800 bytes) — the gate firing correctly on
  this rig's Swift 6.2.4 output, as in round 1; binding proof stays
  CI's package job. No code change.
- Installed into VS Code 1.139.1 (`randynorthrup.muse-spark-code`
  listed) and driven over CDP from `temp/cdp-drive.mjs` (text reads
  only, no screenshots): extension activates in 295 ms, `Sign-in
state: signedIn on the museCode backend`; the palette lists the
  packed commands; `Muse Spark: Open in Sidebar` creates the
  extension's webview (`purpose=webviewView`,
  `extensionId=RandyNorthrup.muse-spark-code`).
- Exact words read from the live panel: `Muse Spark: Lock Vault Now`
  → `The vault operation failed. Try again.` (extension log: `Vault
lock command failed`, 9× across runs); `Muse Spark: Attach Latest
Screen Recording` → `No recent screen recording was found.`
  (`Muse Spark: Vault` runs with no toast: it targets the vault
  section.) No model turn was sent from the panel: the panel lists
  the same 4 serve models, and the default was never let through.
- Open limitation: the chat webview document stays bootstrap-only
  here (no `#root`, no resource loads, `innerText` empty in every
  frame), so the panel body text could not be read in this headless
  run although its target, commands and notifications all drive for
  real. Renderer/network logs show no load error. For the lead to
  compare on a GUI Mac.

## Round-2 gates (final tree, true exit codes, repo timeout throughout)

- `npm run build`: 0 (budgets hold). Note: an intermediate rebuild
  failed the lazy-registry check (505 problems) because this lane's
  own `dist/acp-package` + `dist/vsix-package` stages were still on
  disk; removing those gitignored stages and rebuilding gives 0. The
  problems named only stage copies, never repo sources.
- `test/unit/acpNativeSources.test.mjs` + `test/unit/vsixTargets.test.mjs`
  (2 files, the lane's 3-file limit): 12/12 pass, exit 0.
- prettier check on changed files: 0. eslint on changed files: 0,
  zero warnings (one `unicorn/no-declarations-before-early-exit`
  found and fixed in the lane).
- typecheck (all 5 projects): 0. `deadcode` (knip): 0. `cycles`: 0.
  duplication: 0 clones, exit 0. `check:l10n`: 0 problems, exit 0.
  `check:reference`: 0. `check:host-api`: 0 problems, exit 0.
  `check:plan`: 0 drift, exit 0. `security:audit`: 0.
- SAST (`security:sast`): exit 2, sandbox-blocked, no scan ran:
  `Fatal error: exception Failure: ca-certs: empty trust anchors`
  (osemgrep crashes configuring TLS before any rule runs). For the
  lead/CI outside the sandbox.
- `check:catches` on group files: left to the join per the brief.

## Still open for the join (adds to round 1)

5. Contributor listing: `muse serve` 1.4.10 lists 4 models while the
   persisted `contributor_mode_enabled` is true and the CLI itself
   runs the contributor model; the product (agent, panel, exec)
   therefore cannot select it and refuses by design. Needs the
   bleeding-edge follow-up (pinned SDK 1.4.4 vs CLI 1.4.10,
   fingerprint mismatch on record), not a lane-side gate bypass.
6. Panel body text needs a GUI Mac comparison run (R2.4).
