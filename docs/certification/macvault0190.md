# The macOS vault through the panel on the 0.19.0 tree (lane MACVAULTFLOW, 2026-10-20)

Base: final 0.19.0 tree 03e60fba80 (hosted CI fully green), worktree
`/Users/randy/lanes/MACVAULTFLOW`, product files untouched. Machine: macmini
(Mac mini Intel, macOS 15.7.4, Node v24.21.0). The lane runs inside the
agent sandbox: the lane's `TMPDIR` is too long for the broker socket, and
`/bin/ps` is blocked (`Operation not permitted`; `sysctl kern.proc.all` is
unavailable, while `sysctl kern.boottime` answers). No product defect was
found; the flow is not proven on this Mac. Nothing was written to the
person's vault folder, keychain, home or VS Code.

## New suites (deliverable 1)

- `test/unit/vault/posixVaultPanelFlow.test.ts`: the Windows panel flow
  ported to POSIX — set up, unlock, add through the native editor's own
  code, write and read back a 9.6 KB first-party row, lock, unlock, read
  again, settling on the published state with no failure toast — plus the
  same flow with the working folder at `/`. Skips where the rig cannot run
  it (Windows; socket-fit; no process listing on darwin).
- `test/unit/helpers/vault/posixPanelFixture.ts`: the real client platform
  over a staged package layout (installed broker entries, macOS slot
  helper, peer and created helpers), wired as the editor host wires it.
- `test/unit/helpers/vault/panelFlowDriver.ts`: the shared flow, now also
  used by `test/unit/vault/windowsVaultPanelFlow.test.ts` (refactored to
  call it; a verbatim move — see the equivalence check below).
- `scripts/lib/deferredBundles.d.mts`: declares the existing
  `sharedVaultStore` plugin the fixture imports (types only, no runtime
  change).

## Fixture defects found (test-side, fixed) — each was red, then green

1. **Created-helper root from source.** Configuring admission in-process
   from `src/` resolves the created helper under `src/core/native`
   (`spawn .../src/core/native/darwin/... ENOENT`): the governor's native
   root is `dist/../native`, which only holds from a bundle. The fixture
   now configures admission the editor-host way with the created helper
   rooted explicitly at the staged install layout. Red: connect refused
   (`vault-broker-refused` never; the launch itself failed). Green: broker
   up, socket discovered.
2. **One admission state per bundle is not one state.** The fixture's
   plain esbuild bundles gave `vaultRuntime.js` its own admission copy, so
   the broker configured one copy and the bindings' host check probed
   through the other (`Resource admission unavailable` inside `isHost`,
   hello closed silently). The product shares one state via
   `sharedResourceAdmission` (and one store via `sharedVaultStore`); the
   fixture now builds with the product's own plugins and stages
   `resourceAdmission.js` + `vaultStore.js`, per-bundle exactly as the
   product's build does. Red: hello closed, `VaultChannelError: closed`.
   Green: channel opens, `status` answers.
3. **Sibling self-require.** Applying both plugins to every bundle made
   `vaultStore.js` require itself and `resourceAdmission.js` recurse
   (`Maximum call stack size exceeded`, `vault-broker-refused`). The
   product's build skips each sibling's own entry; the fixture mirrors
   that per bundle. Red: broker exits 1 at startup. Green:
   `vault-broker-ready`.

The packed `darwin-x64` layout (unpacked and listed, not executed) matches
what the fixture stages, sibling for sibling.

## The sandbox wall (environmental, no product change)

With a short owner-only `TMPDIR` the first snapshot answers
`{"state":"unavailable","reason":"vaultLost"}` instead of `uncreated`.
Cause, measured end to end: `/bin/ps` is blocked here, so
`darwinStartTime` fails, `exactCurrentProcessOwner()` is unknown, and
`writerRecovery` fail-closes a fresh vault as lost; the writer lease would
likewise refuse without exact identity. The product behaves as designed —
refusing without identity proof — and the suite carries a collection-time
skip for rigs without process listing, mirroring the socket-fit skip. Not
proven: setup, unlock, add, the first-party round trip, lock/unlock, the
`/` variant, the osStore tier behaviour, keychain prompts. `brokerSession`
4/4 and `brokerWithoutKeyring` 1/1 pass in this sandbox (no identity
needed); `writerCrashPosix` 17/17 refuses with the same wall's signature
(writer lease `busy` without exact identity) on a tree with zero product
diffs, so environmental, not a regression.

## Equivalence check (Windows suite refactor)

`panelFlowDriver.drivePanelFlow` was diffed line-normalised against the
committed Windows flow: the only differences are the intended
parametrisations (home/connect/working-folder/label, `mkdir` recursive,
the label on the settled toast assertion). The Windows suite keeps its
fixture, single test and 300 s timeout. It cannot run on this Mac
(win32-only); hosted CI is its proof.

## Suite fire record

The new suite fired red for real causes, twice, before any green
infrastructure existed here: the broker-launch refusal (finding 1), then
the silent hello close (finding 2), then the broker startup refusal
(finding 3), then `vaultLost` at the snapshot (the wall). No
break-on-purpose was needed beyond what actually broke. In this sandbox
both tests skip with reason (ps probe, after the socket probe); green must
come from hosted CI or a run outside the sandbox.

## Gates (final tree)

- `npx vitest run test/unit/vault/posixVaultPanelFlow.test.ts`: 2 skipped
  (default `TMPDIR`: socket-fit; short owner-only `TMPDIR`: ps probe).
- `brokerSession`: 4 passed; `brokerWithoutKeyring`: 1 passed;
  `writerCrashPosix`: 17 failed, environmental (above).
- prettier: clean; eslint (4 touched files): 0 warnings; `typecheck` (host)
  0; `typecheck:unit` 0; `check:catches`: counts match baseline;
  `duplication` (jscpd): 0 clones; `cycles`: none; `deadcode` (knip):
  exit 0; `check:l10n`: 0 problems; `check:reference`: current;
  `check:host-api`: 0 problems; `check:plan`: 0 drift;
  `check:roadmap`: current.
- `npm run build`: exit 0, budgets hold. `package-vsix --target
darwin-x64`: the `.vsix` is produced (3,737,551 bytes zlib) but the
  pinned-zopfli recompress step fails — `zopfli==0.4.3` is not installed in
  this lane and the script refuses the fallback. Missing build tool,
  environmental.
- `security:sast` (sandboxed): exit 0. `security:audit`: exit 0 (4
  advisories, 2 exceptions, as committed).
