# RLF-CIFIXM — hosted CI's macOS items the MacBook sandbox blocked (2026-11-02)

Lane `RLF-CIFIXM`, worktree `/Users/randy/lanes/RLF-CIFIXM`, branch `rec/rlf-cifixm`.
Base `rec/rlf-cifixa` at `97beeba6e` (RFL-CIFIXA's record read in full first).
Test rig `macmini` (macOS 15.7.4 Intel x86_64; Swift 6.2.4 and `/usr/bin/cc` work;
`/bin/ps` and Chrome allowed, unlike the MacBook). CI reproduction on the
downloaded Node **v22.23.4** at `temp/node22/` (_Row: `curl nodejs.org/dist`,
exit 0_), with the repo's own 5 s test timeout throughout — no `--testTimeout`
anywhere. Provider/model calls: **0**. Nothing pushed, rebased or stashed.
`temp/node22/` stays in the gitignored `temp/` for the lead's reproduction.

Sandbox blocks, stopped and named, never worked around:

- macOS Keychain: this headless session has no default keychain
  (`@napi-rs/keyring`: `Platform failure: A default keychain could not be
found`), and provisioning the CI-mirroring job keychain fails:
  `security create-keychain` → `SecKeychainCreate: One or more parameters
passed to a function were not valid` (exit 206), identically for a name, a
  path under the lane home, and a path under the user temp. `security
list-keychains` fails the same way, and a `security find-generic-password`
  probe was denied without running. So vault suites that need the real OS
  store cannot run in this sandbox; item 1 was diagnosed and fixed from the
  failing mechanism instead (below), and hosted CI is the green that decides.
- `log show` cannot run sandboxed (`log: Cannot run while sandboxed`), so the
  securityd-side reason for the keychain failure is unobserved from inside.

## Item 1: vaultStoreScope (macOS, 2 cases) — both causes found and fixed

CI: "scoped anchor exists: expected null not to be null" plus one adoption
failure. Here the file collects 1 passed / 4 skipped either way (lane TMPDIR
is 152 chars, so the broker case skips on socket fit; the adoption cases skip
on the locked/absent store probe).

**Cause A (the null anchor): the fixture broker could never reach the OS
store.** `startPosixPanelFixture` stages the broker bundle to a scratch root
outside the checkout with `@napi-rs/keyring` external and stages no
`node_modules`, so the broker's dynamic import throws `MODULE_NOT_FOUND` and
`resolveBrokerKeyring` silently falls back to the file anchor. Whether the
binding resolves at all depends on TEMP spelling: a system TEMP (CI) falls
back, an in-checkout TEMP (a lane) walks up into the checkout's `node_modules`
— the suite ran different anchors per rig. The production ACP install ships
the binding as a dependency, so the fixture now copies the checkout's own
installed `@napi-rs` tree beside the staged broker and fails fast where it
still does not resolve (the mirror of `brokerWithoutKeyring`'s fail-fast,
which needs it absent — that suite is untouched and still green).

**Cause B (the adoption failure): the slots case paired a legacy record with
a freshly built slot.** `unwrap` checks `createdAt` among the identity fields,
and the case built `legacyRecord` from one `Date.now()` and `legacySlot` from
another seconds later — a pairing production can never make, since every
production slot opens from its record (`slotEntryFromRecord`, used by
`macVaultSlots`, `linuxVaultSlots`, and the exec test child). The product
rightly refused with `VaultError('invalid')`, deterministically, on the first
store-backed run anywhere (Linux unit shards skip for no bus; Windows skips
the case). The case now opens the slot from the record with production's own
`openOsStoreSlot`.

Neither panel sibling (`posixVaultPanelFlow`, `chatgptSubscriptionMigration`)
asserts store placement, and the fixture already removed scoped store records
on disposal, so the store-backed broker changes nothing they pin; hosted CI
says their green. The Windows fixture deliberately stages the binding-less
VSIX layout and is untouched (the Windows leg is the Windows lane's).

## Item 2: re-earned on Node 22

Every suite below ran on `temp/node22` with repo timeouts. Three needed fixes;
the rest went green as left by RLF-CIFIXA.

- `makerLease` + `makerLeaseCrashes` + `makerLeaseIdentity`: 45 passed,
  2 skipped, exit 0. RLF-CIFIXA's `isSameHolder` fix holds on a rig with `ps`.
- `makerSerialSession`: 24 passed, exit 0 (in the batch with stop/transport).
- `runtimeMakerTransport`: 50 passed, exit 0. `runtimeMakerCommands`: 21
  passed, exit 0.
- `runtimeMakerStop`: 12 passed + 1 failed (`RVM103W6`), then **fixed in the
  test**: the case dates from the mocked-HTTP fixture era and still drove the
  CLI entry, whose production LAN policy refuses the loopback simulator, so
  the registered printer could never stop through it and every run failed
  with the printer alongside devices. Every sibling drives the same
  `stopRuntimeMachines` the entry calls; this one does now too, keeping its
  substance (the unconfirmable renamed owner fails devices, the acquired stop
  never runs). 13 passed, exit 0.
- `feedbackBrowser`: 8 passed, exit 0. `devicesPhase2Harness`: 10 passed
  (with nodeBrowserWorkspace), exit 0.
- `nodeBrowserWorkspace`: 4 passed + 1 failed (the 320 px case measured
  `scrollWidth` 328), then **fixed in the test setup**: `node.html` links
  `dist/webview/main.css` (the bridge mounts inside the main webview, which
  owns the body reset), but no step built it — a fresh checkout measured an
  8 px overflow production never has. The suite joins the global-setup
  production-build set and refuses a missing/stale shared build like the
  other dist-serving suites. 5 passed, exit 0.
- `teamModelsFirstPaint`: 9 passed, exit 0 (then the 60 s hook went away —
  item 3 — and it stayed 9 passed at repo timeouts).
- `test/e2e/judgeLocalDarwinPid.e2e.test.ts`: 1 passed in 34 s, exit 0. This
  rig has a working compiler (`xcrun clang`).
- `runtimeLsp`: 10 passed, exit 0 with the CI-spelling TMPDIR — the two hook
  cases (`honours its refusal`, `RequestCancelled while its hook still runs`)
  and the three supervise cases. With this lane's 152-char TMPDIR the three
  supervise cases fail on the product's honest long-path refusal (the stop
  socket cannot fit `sun_path` even from the fallback folder) — environmental,
  by design, same refusal sentence RLF-CIFIXA kept.
- `nodeServeBinding` + `nodeCertificate` + `osImageBuild`: 171 passed,
  1 skipped, exit 0.

## Item 3: the timeouts RLF-CIFIXA added

Four vitest timeouts in `git diff 810b320fc 97beeba6e -- test`
(the `timeout`/`timeoutMs` lines beside them are child-process and probe
limits, not test timeouts, and are untouched):

- `judgeLocalDarwinPid` 120 s — **stays**. The case exists to wait out kernel
  PID cycling (measured 34 s here, bounded by the child's own 110 s). Now the
  named `PID_REUSE_TIMEOUT_MS` with its reason.
- `judgeLocalDarwinDeadline` 45 s — **stays**. The case exists to wait out the
  helper's real 30 s product deadline (measured 30.0 s). Now the named
  `NATIVE_DEADLINE_TIMEOUT_MS` with its reason.
- `resourceStatusCpu` 15 s — **stays**. The case exists to wait out one full
  5 s product sample interval (measured 5.0 s). Now the named
  `CPU_SAMPLE_TIMEOUT_MS` with its reason.
- `teamModelsFirstPaint` 60 s setup hook — **removed**. Cold bundle build
  plus Chrome launch is setup cost, not a deadline. The bundle now builds
  once in `test/unit/globalSetup.mjs` (gated on the suite, like the
  production package), outside every hook's deadline — same options, same
  bytes (the standalone build measures 1.6 s warm; plus a cold Chrome launch
  it overran the hook on hosted runners). The hook only reads the files into
  memory now. Suite: 9 passed at the repository's timeouts, exit 0.

## Drills (red/green proofs)

- Fixture keyring staging: before, a scratch probe driving the real fixture
  showed the staged bundle throwing `MODULE_NOT_FOUND` for
  `@napi-rs/keyring`, setup+write+read succeeding with no keychain on the
  machine at all, and the file anchor on disk (the silent wrong-anchor
  fallback CI hit). After, the bundle resolves the binding from its own
  staged `node_modules`, setup/snapshot refuse loudly with the localized
  store-unavailable sentence, and no file anchor is written. Probe removed.
- Slots pairing: before, the test-style pairing (`createdAt` seconds apart)
  threw `VaultError('invalid')` before any store IO; after, the
  production-style pairing (`openOsStoreSlot`) reaches the store op
  (`VaultStoreUnavailableError` on this store-less rig).
- `runtimeMakerStop` RVM103W6: before, exit 1 with `expected
["…Devices and machines."]` but `["…Bench printer, Devices and
machines."]` (twice); after, 13 passed, exit 0.
- `nodeBrowserWorkspace` 320 px: before, `scrollWidth` 328 vs `innerWidth`
  320 in three runs (body margin 8 px, `#root` at x=8 — the missing-build
  artifact, stable across 2.5 s, not timing); after the shared-build
  registration, 5 passed, exit 0.
- `teamModelsFirstPaint`: red is CI run 41214393586's cold-hook overrun (the
  reason the 60 s existed); after the global-setup move, 9 passed at repo
  timeouts, exit 0 (twice, before and after the lint fix).
- `brokerWithoutKeyring` still passes (1 passed, exit 0): the shared
  builder's stageless layout — and the fallback it proves — is intact.

## Commands and results (Node v22.23.4 unless named)

Final batches (≤3 files, `--maxWorkers=3`, repo timeouts): makerLease ×3
45✓/2 skipped; makerSerialSession + runtimeMakerStop + runtimeMakerTransport
87✓ (after the stop fix); runtimeMakerCommands 21✓; feedbackBrowser 8✓;
devicesPhase2Harness + nodeBrowserWorkspace 15✓ (after the build fix);
teamModelsFirstPaint 9✓ (before and after the 60 s removal);
nodeServeBinding + nodeCertificate + osImageBuild 171✓/1 skipped; runtimeLsp
10✓ (CI TMPDIR); judgeLocalDarwinPid e2e 1✓ (34 s); resourceStatusCpu +
judgeLocalDarwinDeadline 2✓ (5.0 s / 30.0 s); vaultStoreScope +
posixVaultPanelFlow + chatgptSubscriptionMigration 1✓/13 skipped (lane
TMPDIR socket/store gates); brokerWithoutKeyring 1✓ (system TMPDIR).

Gates: prettier 0, eslint 0 (all touched files); typecheck 0; check:l10n 0
(0 problems); check:reference 0; check:host-api 0 (0 problems);
check:plan 0 (249 milestones, 0 drift); check:roadmap 0; check:catches 0
(baseline match; the two new `test/` catches are outside the inventoried
areas); cycles 0; deadcode 0; build 0 (all budgets hold); SAST 0
(694 rules, 0 findings); audit 0 (2 advisories noted, 0 exceptions).
`duplication` FAILS (exit 1): one clone between
`resourceRelocationDevices.test.ts` [32–54] and
`resourceRelocationJoin.test.ts` [18–40] — RLF-CIFIXA's `PROBE_LIMITS`
blocks in two files this lane never touched; pre-existing on the base,
out of this brief, reported not fixed.

## Classification and land order

Commits on `rec/rlf-cifixm` (base `97beeba6e`): `b71051fc5` (vault fixture
keyring staging + slots pairing), `3cc2796b8` (stop case via
stopRuntimeMachines), `9904d32c7` (workspace suite on the shared build),
`2566d3049` (Models bundle in global setup, 60 s removed), `717c74e00`
(three waits keep named timeouts). Plus this record. No source file changed
— every fix is test setup or the case's own wiring; no product behavior
moved. Recommended land order: as committed. Hosted CI on the new head is
the gate that decides: the vault file's five cases, the two panel siblings
under the store-backed broker, and every suite above will say their
first green/red there.
