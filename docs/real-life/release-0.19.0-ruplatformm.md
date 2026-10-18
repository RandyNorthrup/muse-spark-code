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
