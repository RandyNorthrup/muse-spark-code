# RLF-CIFIXA — hosted CI run 41214393586, non-Windows failures (2026-11-01/02)

Lane `RLF-CIFIXA`, worktree `/Users/user/lanes/RLF-CIFIXA`, branch `rec/rlf-cifixa`, resumed in place
after the 2026-10-31 pause (the Claude Code run's uncommitted LINUX_DICTATION fix was read, verified and
committed first; its transcript store at `/Users/user/.claude` is _Operation not permitted_ in this
sandbox and was not read — the brief and worktree diff carried everything). Test rig `macbook`
(macOS, Intel x86_64, Node 24.21.0 default; CI reproduction on the downloaded Node **v22.23.4** at
`temp/node22/`, with `TMPDIR` set to the per-user `/var/folders/…/T/` CI spelling and the repo's own 5 s
test timeout). Base `810b320fc`. Provider/model calls: **0**. Nothing pushed, rebased or stashed; git
runs through the Command Line Tools binary because this rig's Xcode shim is broken
(`DEVELOPER_DIR=/Library/Developer/CommandLineTools`).

Sandbox blocks, stopped and named, never worked around: Chrome launch (`spawn EPERM`), `/bin/ps`
(`spawn EPERM`), Docker (`Operation not permitted`), `/usr/bin/xcrun` (broken Xcode). Every suite that
needs one of those is listed open below with what is proven without it.

## Build blockers (all fixed)

1. **LINUX_DICTATION** (`87ec6f1f1`, previous run's work, verified and committed): the Linux helper
   build read the pins from `src/shared/constants.ts`, which the constants split had emptied for this
   block; it now reads `src/shared/linuxDictationConstants.ts` through the new
   `scripts/lib/linuxDictationConfig.mjs`, with `test/unit/linuxDictationConfig.test.mjs` pinning the
   helper's version/SHA against the shared record. The workflow's Linux build step lost the obsolete
   `npm ci` the old parser needed.
2. **check-host-api OOM** (`74f3d3961`): the gate kept every file's parsed syntax tree in its import
   graph while a second full TypeScript program parsed the tree again — both copies at once outgrew
   the ~2 GiB heap of CI's macOS arm64 runners. Each parsed file is now dropped once its facts are
   out (the webview host call is collected in the same walk). Drill below; the record file is
   byte-identical (MD5 `ac3ba2c6…` before and after).
3. **gitleaks** (`45b2f213a`): the ACME example token in `nodeSignin.test.ts` was key-shaped and its
   ignore fingerprint named a line the code had drifted from, so the historical commit still tripped
   the full-history scan. The test now uses a plainly example value and the first commit is
   fingerprinted exactly. Full-history rescan: 8,071 commits, no leaks (1 before).
4. **package / platform artifacts / quality (×3) / dictation helper**: no independent defect. All are
   the `required` façade jobs (or, for `packages`, its first gate step) reporting
   `CHECKS/UNIT/LINUX_HELPER/SECRETS: failure` from blockers 1–3 and the unit failures below; the
   macOS helper itself was `HELPER: success` in its log.

## The 28 failing files — what was wrong, which side, the fix

Product wrong (fixed in product code):

- **teamEnginePorts, teamLandingKilled, teamLandingPause** (`5a76d3790`): three confinement fences
  (`teamWorkspaces.validateTeamFolder`, `teamMerge.confinedRelative`, the landing journal's target
  check, plus one misspelled `expectedCanonicalPath`) demanded a path's spelling equal its resolved
  form, so any storage or tree under macOS `/var` was refused as "outside canonical storage". Each
  now judges canonical containment — no link at or below the root, the real place inside the real
  root — the property each fence meant. 17/17 green on Node 22.
- **connectorRemoteIssuer** (with connectorStorageGuard, `dd829f212`): on a first start (no storage
  root yet) the guard judged the _spelled_ anchor chain, whose `/var` link it then refused as a
  linked ancestor — a fresh connector could never start on macOS. The missing-root branch now
  canonicalizes the anchor like the existing-root branch.
- **runtimeLsp (supervise cases)** (`4ab9d39c4`): supervision refused outright whenever the data
  folder's path outran `sun_path` (103 bytes) — on macOS that is any home past ~29 characters. The
  stop socket now falls back to the temporary folder under the same unguessable name; only a request
  carrying the run's 32-byte token is answered, and the record names the endpoint for `stop` as
  before. The refusal sentence remains for a temporary path that is itself too long.
- **nodeDashboardPage, nodeTerminalPage** (`f4f75a776`): `NodePrivateFiles.prepare` had the same
  spelled-vs-resolved equality demand; it now applies the trusted-path walk's rule (root-owned OS
  aliases above the root pass, a user-owned link refuses).
- **makerLease (+ runtimeMakerStop's second failure)** (`178734df3`): the identity port's contract is
  "any doubt throws; undefined alone proves absence", but `isSameHolder` only treated fs-shaped,
  `lease-`-prefixed or Zod errors as doubt, so a plain query failure escaped and the device read as
  free (and an unrelated machine's stop failed with it). Every Error from the port now holds the
  lease. Not run green here (sandbox denies `ps`); CI stacks prove the path, typecheck and
  `check:catches` pass.
- **providerSpend** (`066144527`): the models.dev snapshot was re-synced to 2026-10-30
  (`vendor/models-dev/VENDOR.json` `fetchedAt`) without its pinned constant following;
  `MODELS_DEV_CATALOGUE_DATE` now says 2026-10-30.

Test wrong (fixed in the test's real-code setup; assertions unchanged):

- **acpServeHandshake**: both cases were host-state lotteries — one assumed a Muse installed,
  the other scrubbed PATH by substring and missed real installs. The CLI-missing case now runs with
  an empty folder as its whole PATH; the unsigned case is `skipIf` no real CLI is installed.
- **resourceStatusCpu**: the one-shot status waits one full 5 s sample interval by design, so the
  case can never fit the 5 s default; it carries a named 15 s timeout with the reason.
- **resourceRelocationDevices, resourceRelocationJoin** (`e32078859`): live samplers need memory
  headroom; on Node 22 (libuv 1.51) macOS reads it from the packaged helper, which a source-layout
  suite must compile and pass explicitly (the API's own contract). `resourceHarness` now compiles
  the real `MuseSparkCreated.c` once and hands each sampler its own reader; on libuv ≥ 1.52 it is
  undefined, as in production.
- **connectorStorageGuard (legacy cases)**: on POSIX the unbound store's mode-flag writes already
  leave the tree mode-private, so the "legacy" plant was not untrusted storage and the guard rightly
  accepted it. The plant now also loosens the grant file to 0644 on POSIX — storage no guard
  secured — and the refusal is asserted as before. The Windows leg of the same cases still needs
  the Windows lane's eyes (its plant is ACL-based; unchanged).
- **judgeLocalDarwinDeadline, judgeLocalDarwinPid (e2e)** (`0bea0f328`): both deliberately wait out
  real 30 s / 110 s operations with no per-test timeout. Named timeouts (45 s / 120 s) with reasons.
  Deadline green here; the PID e2e cannot compile its helper on this rig (broken Xcode), CI has one.
- **makerSerial (socat), makerEmulatorRig, nodeImageArchive (gitleaks)** (`417724df2`, `f18b59c84`,
  `e4a7f137c`): tool-shaped cases now skip by name where the tool is absent (the files' own
  `runIf`/`skipIf` precedent), and CI installs socat (apt/brew in the unit job) so the serial and
  supervisor data paths still run there. The emulator lease expectation also said record version 2;
  the record is and always was version 1 (schema, writer and frame parser agree).
- **deviceWorkerHostNative** (`f18b59c84`): gated only on `XDG_RUNTIME_DIR` being set, but the real
  units need a qualified desktop host (user manager + logind inhibition — what the product itself
  requires to offer lanes). The gate now probes both real calls and skips by name without them.
- **vaultPanelBuild** (`b28520dca`): the shipped migration chunk is 41.33 KiB, under its 45 KiB
  cap; the guard build measured 45.35 KiB because it lacked the folded-constants plugin every
  production bundle compiles with (`scripts/lib/foldedConstants.mjs` via `withFoldedConstants` in
  `scripts/build.mjs`). The harness build now folds like production, so caps measure shipped bytes.
  No cap moved. (Build-only suite; no vault or OS store was touched.)
- **feedbackBrowser, devicesPhase2Harness** (`c4b30dea8`): `test/harness/index.html` had merge
  damage — the maker-preview scene lost its closing `},`, the whole 6,225-line classic script
  stopped parsing, and every harness global (`themed`, `whenReady`) vanished. Brace restored;
  `harnessInit` now compile-checks every inline script with `node:vm` so this class fails without a
  browser. **nodeBrowserWorkspace** is a node.html suite whose longest first case paid cold-Chrome
  costs past 5 s; it runs the same warm-up `feedbackBrowser` learned in CIFIX017.
  **teamModelsFirstPaint**'s setup (cold bundle build + Chrome launch) gets a named 60 s hook
  timeout. None of the four could be re-run here (sandbox denies Chrome); the parse proof is the
  drill below.

## Still open (named for the lead; nothing hidden)

- **resourceForkProtection** (ubuntu, 1 case): sampling and the rate trip work; `registry.kill` on a
  process-group scope returns not-`done`, so the launch host reports "the stopped job was not
  observed done". Narrowed statically to `LinuxTreeSource.signalNow`/`signalVerifiedPosix` member
  results on group scope; needs a Linux rig to observe which status comes back. No blind edit made.
- **vaultStoreScope** (macos, 2 cases): per the brief, not run or code-guessed here (the shared test
  anchor). CI: "scoped anchor exists: expected null not to be null" and one adoption failure.
- **Sandbox-blocked verification**: makerLease, makerLeaseCrashes/Identity, makerSerialSession,
  runtimeMakerStop/Transport/Commands (`ps` denied), feedbackBrowser, devicesPhase2Harness,
  nodeBrowserWorkspace, teamModelsFirstPaint (Chrome denied), judgeLocalDarwinPid e2e (Xcode broken),
  runtimeLsp's two hook cases (green in CI, "the hook never ran" only in this sandbox; also red on
  the untouched base here), nodeServeBinding/nodeCertificate/osImageBuild in the related run (also
  red on base here). The product fixes behind them are proven by CI stack + typecheck + neighboring
  suites as noted per file.

## Drills (gate-fire proofs)

- check-host-api: Node 22 `--max-old-space-size=2048` — before: `FATAL ERROR: Reached heap limit`,
  exit 134; after: `0 problem(s)`, exit 0, record MD5 unchanged (`ac3ba2c6…`), peak RSS
  2.69 GiB → 2.07 GiB. At 1536 MiB it still OOMs (the one type-checked program is the floor).
- gitleaks (full history, `--log-opts=HEAD`): before 1 leak / exit 1; after: no leaks / exit 0.
- Harness parse: `node --check` on extracted scripts — before: `SyntaxError: Unexpected token ':'`
  in the 6,225-line script; after: all 6 parse. The new `harnessInit` case encodes exactly this.
- Team fences: same three suites red before each site's fix with the CI messages, green after each
  (storage → merge `linkEscape` → journal checkpoint → bound-path, peeled in that order).
- execTeamSweep (related run) fails locally **also on the untouched base** (verified by restoring
  base copies of the three team files): rig environment, not this diff; it passed in CI run
  41214393586 on all three OS legs.
- nodeImageArchive scanner case run both ways: with gitleaks on PATH 55 passed; without, 54 passed
  - named skip.

## Commands and results (Node v22.23.4 unless named)

- Final confirmation batches (≤3 files, `--maxWorkers=3`, repo-default timeouts): linuxDictationConfig
  - providerSpend + acpServeHandshake 31✓; resourceStatusCpu + nodeSignin + harnessInit 13✓;
    teamEnginePorts + teamLandingKilled + teamLandingPause 17✓; connectorStorageGuard +
    connectorRemoteIssuer + nodeDashboardPage 16✓; nodeTerminalPage + nodeImageArchive +
    resourceRelocationDevices 73✓/2 skipped; resourceRelocationJoin + judgeLocalDarwinDeadline +
    makerSerial 17✓/2 skipped; vaultPanelBuild + superviseRefusal + superviseGoverned 7✓.
    runtimeLsp: supervise cases green after the endpoint fallback (full-file run: only the two sandbox
    hook cases red, as on base). makerEmulatorRig + deviceWorkerHostNative collect as named skips on
    this rig (Linux-only / unqualified host).
- `npm run typecheck` 0; `npm run build` 0 (bundle budgets and split checks inside);
  `node scripts/check-l10n.mjs` 0; `npm run check:catches` 0; `check-host-api` 0 on Node 22;
  prettier/eslint over every touched file 0 (`.gitleaksignore` has no parser, as before).
- `vitest related` for the changed team sources: 12 passed files, 1 failure (execTeamSweep, base-red
  here, above). For supervisor/storageGuard/privateFiles/lease: 23 passed files; failures are the
  sandbox/base class itemized in Still open.

## Classification and land order

Commits (base `810b320fc` → `b28520dca`, plus this record): 87ec6f1f1, 74f3d3961, 45b2f213a,
066144527, 5a76d3790, dd829f212, 4ab9d39c4, e32078859, 178734df3, 417724df2, f4f75a776, e4a7f137c,
c4b30dea8, 0bea0f328, f18b59c84, b28520dca. Recommended land order: as committed (blockers first,
then product fences, then test-truth fixes). Hosted CI on the new head is the gate that decides, per
rule 2 — the browser, maker and qualified-host suites will say their first green/red there, and
resourceForkProtection + vaultStoreScope are the two to watch.
