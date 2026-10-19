# Audit: 0.19.0 test/ additions are real (lane B — truth + platform groups)

Scope: every test/ path the truth and platform groups added or changed on
JOINB, i.e. `git diff --name-only c72aef8cd3 HEAD -- test` where
`c72aef8cd3` is the release/0.19.0 tip under both JOINB merges
(`af44fb7903`, `186f08d437`): 111 added, 44 modified, 9 deleted at audit
start. The sibling lane audits src/; this lane audits test/ only.

Method: read every added file in full; reviewed every modified file's
JOINB diff line by line. Looked for what the `no-fakes-in-tests` eslint
rule cannot catch: hand-rolled fake objects passed where a real module or
store belongs, in-memory maps posing as SecretStorage or a file store,
functions returning canned provider answers, monkey-patched globals or
`process` fields, injected clocks or randomness hiding a real behaviour,
tests asserting nothing that could fail, and names claiming more than the
test checks. Calibrated against the repo's own classification in
`docs/certification/standins.md` and PR #223 (`b00da00369`), which deleted
the fake suites: a hand-written object, scripted port or local server
pretending to be our modules, a provider, the CLI, GitHub, an MCP server,
the editor API or a store is a stand-in; data values, recorded captures
with date and command, failure injection at a product-defined seam, plain
recording callbacks and real subprocesses are real.

Result: three rewrites (all fail-on-purpose proven), three dead-helper
deletions, one open exception with a recipe. Everything else drives real
code or real recorded input.

## Rewrites

### 1. `test/unit/usageJournalRetry.test.ts` — the whole UsageFs was hand-rolled

The suite scripted `list` failures and `isHeld` flips through a
hand-written `UsageFs`, a store double the real `NodeUsageFs` already
covers (`src/runtime/usage/nodeUsageFs.ts`). Rewrote it onto the real
`UsageJournalStore` over the real `NodeUsageFs` in real temp dirs, with a
real second `NodeUsageFs` over the same dir as the other process: a
stale-lease takeover with a future clock (the race the code guards) plus a
`GatingFs` that delegates every call to the real filesystem and only
pauses one file's read until the peer has stolen the lock — the same shape
as the lease suite's sanctioned `pausingPort`, which pauses one call where
an interleaving matters. The swapped day file keeps its size and mtime
(whole-millisecond `utimesSync`, asserted equal), so only cold caches read
the new bytes; the held-lock failure plants a real file where the day
directory belongs (`ENOTDIR` through real I/O).

Fail-on-purpose: removing the `isHeld` guard in `journalStore.read`
returns stale `a-*` bytes and fails both race tests
(`expected [ 'a-0', … ] to deeply equal [ 'b-0', … ]`); the held-lock
test stays green. Reverted. Suite repeats 5× green, ~150 ms a run.

A first attempt pinned the reader at a FIFO; it failed honestly:
`readFile` stats before opening, so a non-file errors with
`invalidUsageFile` instead of blocking. The gating design replaced it and
runs on every platform (no FIFO, no `skipIf`).

### 2. `test/unit/scheduleFireFailures.test.ts` — the store and run journal were hand-rolled

`setup()` scripted `store` (`create/list/update/remove/claim/record/fires`)
and `runs` (`admit/advance/pending/abandoned/acknowledge/acknowledged/
maintain`), doubles the real `createScheduleStore` already covers: it
serves both ports, the way the production engine wires them
(`src/runtime/schedules/engine.ts`). Rewrote `setup()` onto the real store
over `createNodeScheduleFs` in a real temp dir, holding a real schedulable
schedule parsed by the real `scheduleV2Schema`. Only the delivery layer
stays scripted — its ledgers and outcomes are the scenario input — and the
recorded-fire array became a real `fires()` read-back. All 8 tests keep
their names, literals and assertions; the schedule changed only where the
double was uncreatable (`revision: 2` → `0`, `fireCount: 2` → `0`,
`parallel: true` → `false` — the real `create()` rejected `revision: 2`
with `scheduleCreationRevisionInvalid`, which the double had accepted).

Fail-on-purpose: dropping the absent-run guard in `scheduler.ts` records a
fire for an unadmitted run and fails exactly that test
(`expected [ { …(12) } ] to deeply equal []`); the other seven stay green.
Reverted.

### 3. Vault fixtures — the admission module-swap is gone, two dead helpers deleted

- `test/unit/helpers/vault/sessionBrokerBuild.ts`: removed the esbuild
  `generated-admission` plugin, which redirected every `admission`-suffixed
  import to the hand-rolled `sessionAdmission.ts` when bundling fixture
  children. The fixtures never admit (only the installed main calls
  `configureResources`), and the real `src/core/resources/admission` has
  only type-only static imports with a lazily loaded governor, so the real
  module bundles safely. The fake's `admitResource()` also took no
  arguments while the real one takes `(kind, signal, …)` — a
  signature-mismatch timebomb, now gone.
- Deleted `sessionAdmission.ts`: `admitResource`, `admitBootstrap`,
  `stopResourceTree` and `resourceWindowsJob` had no callers anywhere;
  `disposeSession` (used once, by the client child) iterated a lease set
  that stays empty in that process — a proven no-op. The client now just
  closes and disconnects.
- Deleted `brokerProcessChild.ts` and `epochCrashChild.ts`: no references
  anywhere live (only a historical mention in
  `docs/certification/cm109-join-posix.md`).

Verification: the fixture bundle still builds (`brokerWithoutKeyring`
`beforeAll` succeeds; its 1 failure is the pre-existing sandbox timeout,
identical before and after). Runtime parity is sandbox-blocked on this
rig — the broker suites time out here at baseline (blocked child-process
birth/AF_UNIX), so the lead/CI run owns runtime proof.

## Deletions already in JOINB (nothing to do)

PR #223's `chore/no-standins` deleted the fake suites before this audit
(all J — already gone, nothing to do):

| File                                                                    | Why it went                               |
| ----------------------------------------------------------------------- | ----------------------------------------- |
| test/unit/judgeAdmissionLedger.test.ts                                  | stand-in suite                            |
| test/unit/marketplaceHook.test.mjs                                      | KV-double suite                           |
| test/unit/reservationLock.test.ts                                       | stand-in suite                            |
| test/unit/helpers/manualClock.ts                                        | hand-driven clock                         |
| test/unit/helpers/inspectTime.c                                         | folded into the shared inspectCase helper |
| test/unit/helpers/vault/windowsVaultGuardCapture.cs                     | hand-rolled WinRT double                  |
| test/unit/helpers/vault/windowsVaultMemoryDpapi.cs                      | hand-rolled WinRT double                  |
| test/unit/helpers/vault/windowsVaultMemoryHello.cs                      | hand-rolled WinRT double                  |
| test/unit/helpers/vault/windowsVaultMemoryKsp.cs                        | hand-rolled WinRT double                  |
| `test/unit/helpers/vault/windowsVaultMemory*.cs` (4 hand-rolled WinRT   |
| doubles; the recorder checks went real in                               |
| `windowsScreenRecorderChecks.cs`). `docs/real-life/unproven.md` and the |
| `docs/certification/standins.md` record name the withdrawn halves.      |

## Assessed REAL (judgment calls, with reasons)

- `usagePostFailure.test.tsx` (`stubHost`): the `host` prop is a render
  seam, and no real `HostBridge` can exist in jsdom. The double emulates no
  editor behaviour — it is a recording `post` sink plus a fault switch,
  and `messages: window` is the real window. Same category as the
  sanctioned "handler props are plain callbacks" cases. Keep.
- `test/unit/helpers/recordCalls.ts`, `recordLogger.ts`: recording-callback
  factories, the shared form of plain observation probes (used by
  `modelsPanelVaultSection`, `vaultStateTable`, `rulesFileBundle`,
  `vaultEnabledSettings`). They replace no module behaviour. Keep.
- `test/unit/helpers/chatGptGrant.ts` (`testSecretStore`, `testGrantRecord`):
  the product's own `credentialStore.ts` documents the seam as "tests
  replace with a Map", and the grant builder derives every
  product-generated field from product code (`chatGptGrantProvenance`
  proves it against the real schemas). Only provider-issued secrets stay
  synthetic, which the standing rules require. Keep.
- Failure/outcome injection at product-defined seams (all proving the
  mapping, never the outside world): `configuredInjectedSend`
  (`send: () => Promise.reject`), `providerRegistryEffort` (model
  resolvers), `acpEstimate`/`estimateSession`/`estimatePrices` (runner,
  fetch and file ports), `chatGptLocalFailures` (sign-in layers),
  `scheduleJournalHint` (`blockedReplace`), `teamStoreFailures`,
  `rulesFileBundle`, `vaultGrantHints` (`now`/`newId` render props).
  Established repo pattern, also present outside this scope.
- Recorded captures with date and command, per the standing rule:
  `chatgptResponsesCodec` (run id + date), `chatGptLocalFailures`,
  `chatgptPlanCatalogue`/`chatgptPlanErrors`/`chatGptHostId`,
  `providerRefusals` (per-provider refusal bodies), `resourceProbesDarwin`
  (ioreg commands; plus a live darwin-only section on real Macs),
  `keystoreOwner` (real OS store in real children).
- Designed clock/seam params, no hidden behaviour: `fileLease`
  (`FileLeaseEnv.monotonic` is a required product seam; interleavings ride
  the real `pausingPort` over real fs), `runtimeAccountingEntry`,
  `runtimeDailyBudget`, `paidGrants`, `fileSessionSpend` (real timers where
  timing is claimed), `scheduleFireFailures` host `now`/`monotonicNow`,
  `migrationCodecRoundTrip` (`now` param).
- Typed fixture data through real parsers/renderers (data where data
  belongs, never a module double): `vault/fixtures.ts` consumers
  (`modelsPanelVaultSection`, `vaultStatusCard`, `vaultStateTable`,
  `vaultGrantHints`, `vaultViewMachine`), `panelRetryTruth`,
  `providerUnpriced`, `sessionBudgetFit`, `tokenCount`,
  `estimateComposer`, `vaultAuditCap`, `modelsThresholdEditor`,
  `vaultHarnessScenarios` (scenario-list sync guard: fails on drift).
- JOINB's modified files are removals or product-driven updates, verified
  in the diff: `schedulesStdio` (fake-bundle case deleted),
  `moduleExports` (Proxy/`Module._load` interception and fake branches
  deleted), `evalTasks` (`vi.stubEnv` → real `process.env` + restore),
  `prompts`/`teamPreview`/`teamResources`/`modelApiLegalScan` (stand-in
  stores, fake prices, scripted dispatch and the manual clock replaced
  with real code), `chatgptResponsesCodec` (hand-rolled decode sink
  removed), `verify.mjs` (`fakeVscode` removed),
  `windowsScreenRecorderChecks.cs` (hand-rolled WinRT doubles → real
  `InMemoryRandomAccessStream`/`Buffer`), `fileLease` (+570 real
  Windows process-birth lines), `playbookSurface` (+3 real-journal tests
  with break-it proof noted inline).
- `namedLockRace.test.ts`: real 6-process × 8-round race driver; added the
  one-line reason the rig rules require on the genuinely-long 180 s
  per-test timeout.

## Open exception (not rewritten — recipe and blocker)

`test/unit/helpers/vault/sessionBrokerChild.ts` passes
`memoryKeyring().openEntry` (an in-memory map) as the broker fixture's
keyring override. By the letter that is a store double, but it backs none
of the tests' claims (broker lifecycle, launch lock, cleanup — the keyring
is never exercised), and every real alternative is worse or unverifiable
here: dropping the override resolves the real OS store, which writes test
entries under the production keyring service on secret-service machines
and behaves differently per machine; `unavailableKeyring()`/
`missingOsKeyring()` are module-private, so using them means changing src
for tests. The real keyring path is proven by the host receipt
(`test/hosts/run-vault-posix.sh` runs the broker against an isolated
Secret Service with recorded receipts) and the degraded path by
`brokerWithoutKeyring`. Recipe for a follow-up with a runnable rig: point
the fixture at the real `missingOsKeyring` fallback (export it) or run the
brokerSession suite against the isolated Secret Service harness and drop
the override. Runtime verification of any vault-fixture change is blocked
in this sandbox (broker suites time out at baseline).

## Per-file verdicts

`R` = drives real code/input, no action. `W` = rewritten this lane.
`D` = deleted this lane (dead). `J` = already removed by JOINB's PR #223.

Added files (108 live + 3 deleted here):

| File                                                              | Verdict                                                   |
| ----------------------------------------------------------------- | --------------------------------------------------------- |
| test/e2e/schedulesStdio.e2e.test.ts                               | R (modified; fake-bundle case deleted)                    |
| test/fixtures/chatgpt-catalogue/gpt-6.1-sol.json                  | R (recorded catalogue entry)                              |
| test/fixtures/chatgpt-catalogue/plan-400-missing-description.json | R (recorded 400)                                          |
| test/fixtures/resources/ioreg-blockstorage-later.txt              | R (recorded ioreg, date+command)                          |
| test/fixtures/resources/ioreg-blockstorage-twodevices-later.txt   | R (recorded ioreg, date+command)                          |
| test/fixtures/resources/ioreg-blockstorage-twodevices.txt         | R (recorded ioreg, date+command)                          |
| test/fixtures/resources/ioreg-blockstorage.txt                    | R (recorded ioreg, date+command)                          |
| test/fixtures/resources/ioreg-ioaccelerator.txt                   | R (recorded ioreg, date+command)                          |
| test/fixtures/responses-codec/chatgpt-first-turn.json             | R (modified; capture refresh)                             |
| test/harness/index.html                                           | R (modified; ui:look scenario data)                       |
| test/harness/reporting/verify.mjs                                 | R (modified; fakeVscode removed)                          |
| test/harness/vault/build.d.mts                                    | R (ui:look harness tooling)                               |
| test/harness/vault/build.mjs                                      | R (ui:look harness tooling)                               |
| test/harness/vault/mounted.html                                   | R (ui:look harness tooling)                               |
| test/harness/vault/mounted.tsx                                    | R (ui:look harness tooling)                               |
| test/harness/vault/run-mounted.mjs                                | R (ui:look harness tooling)                               |
| test/harness/vault/scenarios.ts                                   | R (pinned by harness-scenarios test)                      |
| test/packaging/moduleExports.test.mjs                             | R (modified; interception removed)                        |
| test/hosts/keystore-worker.mjs                                    | R (real worker)                                           |
| test/hosts/named-lock-race.mjs                                    | R (real race driver)                                      |
| test/hosts/named-lock-worker.mjs                                  | R (real worker)                                           |
| test/hosts/runtime-chatgpt-lock-worker.mjs                        | R (real worker)                                           |
| test/hosts/runtime-chatgpt-stale-socket.mjs                       | R (real socket run)                                       |
| test/hosts/vault-os-store.mjs                                     | R (real OS store)                                         |
| test/hosts/vault-posix-broker.mjs                                 | R (real broker + isolated Secret Service)                 |
| test/unit/acpEstimate.test.ts                                     | R (seam-injected runner)                                  |
| test/unit/acpVaultAttach.test.ts                                  | R (real attach routing)                                   |
| test/unit/accountErrorTruth.test.ts                               | R (real dirs, throwing guard store)                       |
| test/unit/accountUsd.test.ts                                      | R (pure money math)                                       |
| test/unit/browserEnglish.test.mjs                                 | R (modified; vault l10n deferral)                         |
| test/unit/browserUiText.test.mjs                                  | R (modified; vault l10n deferral)                         |
| test/unit/catchInventory.test.mjs                                 | R (real classifier + real TS parser)                      |
| test/unit/chatGptAddNewAccount.test.ts                            | R (real auth + Map seam)                                  |
| test/unit/chatGptGrantProvenance.test.ts                          | R (helper provenance vs real schemas)                     |
| test/unit/chatGptHostId.test.ts                                   | R (real loopback OAuth peer)                              |
| test/unit/chatGptLocalFailures.test.ts                            | R (recorded + seam failures)                              |
| test/unit/chatgptPlanCatalogue.test.ts                            | R (recorded catalogue, real Response)                     |
| test/unit/chatgptPlanEffort.test.ts                               | R (real policy mapping)                                   |
| test/unit/chatgptPlanErrors.test.ts                               | R (recorded 400s)                                         |
| test/unit/chatgptPlanFacts.test.ts                                | R (real catalogue fixture)                                |
| test/unit/chatgptResponsesCodec.test.ts                           | R (recorded turns + goldens)                              |
| test/unit/commandHelp.test.ts                                     | R (real parser routing)                                   |
| test/unit/configuredInjectedSend.test.ts                          | R (seam failure injection)                                |
| test/unit/dailySpend.test.ts                                      | R (real forked reader)                                    |
| test/unit/damageNotice.test.ts                                    | R (real temp files)                                       |
| test/unit/estimateComposer.test.ts                                | R (real estimator failures)                               |
| test/unit/estimateHistoryJournal.test.ts                          | R (real journal)                                          |
| test/unit/estimatePrices.test.ts                                  | R (real fs + file port)                                   |
| test/unit/estimateRefusal.test.ts                                 | R (real refusals)                                         |
| test/unit/estimateSession.test.ts                                 | R (real runner + listeners)                               |
| test/unit/estimatorPanel.test.tsx                                 | R (real panel + modules)                                  |
| test/unit/execArgs.test.ts                                        | R (modified; real parser boundaries)                      |
| test/unit/execExactCount.test.ts                                  | R (real modules)                                          |
| test/unit/execUnpricedSurfaces.test.ts                            | R (real l10n slots)                                       |
| test/unit/featureCatalogDetails.test.ts                           | R (real merge behaviour)                                  |
| test/unit/fileLease.test.ts                                       | R (modified; designed clock seam + real Windows coverage) |
| test/unit/fileSessionSpend.test.ts                                | R (real files + store)                                    |
| test/unit/goals.test.ts                                           | R (see modified)                                          |
| test/unit/helpers/chatGptGrant.ts                                 | R (sanctioned Map seam)                                   |
| test/unit/helpers/estimateFailures.ts                             | R (real-module probes)                                    |
| test/unit/helpers/inspectCase.ts                                  | R (real helper binaries)                                  |
| test/unit/helpers/inspectMacPaths.c                               | R (real helper)                                           |
| test/unit/helpers/keyring.ts                                      | R (fixture seam; see open exception)                      |
| test/unit/helpers/recordCalls.ts                                  | R (recording callbacks)                                   |
| test/unit/helpers/recordLogger.ts                                 | R (recording logger)                                      |
| test/unit/helpers/temporaryFolders.ts                             | R (real fs helpers)                                       |
| test/unit/helpers/vault/brokerProcessChild.ts                     | D (unreferenced)                                          |
| test/unit/helpers/vault/epochCrashChild.ts                        | D (unreferenced)                                          |
| test/unit/helpers/vault/fixtures.ts                               | R (typed fixture data)                                    |
| test/unit/helpers/vault/pipeRelayPeer.mjs                         | R (real peer)                                             |
| test/unit/helpers/vault/receiptWarnings.mjs                       | R (real V8 stacks)                                        |
| test/unit/helpers/vault/sessionAdmission.ts                       | D (fake module swap; see rewrite 3)                       |
| test/unit/helpers/vault/sessionBrokerBuild.ts                     | R (alias removed; real bundle)                            |
| test/unit/helpers/vault/sessionBrokerChild.ts                     | R (open exception: memoryKeyring)                         |
| test/unit/helpers/vault/sessionBrokerHarness.ts                   | R (real sockets)                                          |
| test/unit/helpers/vault/sessionBrokerNoKeyringChild.ts            | R (real resolution)                                       |
| test/unit/helpers/vault/sessionClientChild.ts                     | R (no-op dispose removed)                                 |
| test/unit/helpers/vault/writerCrashChild.ts                       | R (real crashed writer)                                   |
| test/unit/inspectNative.test.ts                                   | R (modified; helper refactor, no doubles)                 |
| test/unit/installTable.test.ts                                    | R (modified; real DOM install path)                       |
| test/unit/invariants.test.ts                                      | R (modified; terminal PATH updates)                       |
| test/unit/keyringParts.test.ts                                    | R (real native store, win32)                              |
| test/unit/keystoreOwner.test.ts                                   | R (real OS store, real child)                             |
| test/unit/legalArgs.test.ts                                       | R (pure parsers)                                          |
| test/unit/links.test.ts                                           | R (real link table)                                       |
| test/unit/mcpOAuthDenied.test.ts                                  | R (real denial + l10n)                                    |
| test/unit/modelApiLegalScan.test.ts                               | R (modified; production scan entry)                       |
| test/unit/modelsNavGap.test.mjs                                   | R (real CSS parse)                                        |
| test/unit/modelsPanelSchemas.test.ts                              | R (modified; real wire-shape parsers)                     |
| test/unit/modelsPanelVaultSection.test.tsx                        | R (real component + sinks)                                |
| test/unit/modelsSections.test.ts                                  | R (modified; real gatedvault section)                     |
| test/unit/paidMoneyStructure.test.ts                              | R (modified; product-driven)                              |
| test/unit/playbookSurface.test.ts                                 | R (modified; +3 real-journal tests)                       |
| test/unit/pluginDispatch.test.ts                                  | R (modified; portable fixtures)                           |
| test/unit/prompts.test.ts                                         | R (modified; stand-in store removed)                      |
| test/unit/providerRefusals.test.ts                                | R (modified; +recorded refusals)                          |
| test/unit/providersPresets.test.ts                                | R (modified; product-driven)                              |
| test/unit/modelsThresholdEditor.test.tsx                          | R (real component)                                        |
| test/unit/namedLockRace.test.ts                                   | R (real race; timeout reason added)                       |
| test/unit/paidGrants.test.ts                                      | R (real files + ledger)                                   |
| test/unit/panelRetryTruth.test.ts                                 | R (pure pre-flight)                                       |
| test/unit/providerRegistryEffort.test.ts                          | R (seam listing input)                                    |
| test/unit/providerUnpriced.test.ts                                | R (pure mapping)                                          |
| test/unit/providersFileAtomic.test.ts                             | R (real rename + seam)                                    |
| test/unit/reasoningResolverBaseWire.json                          | R (modified; hash refresh)                                |
| test/unit/recordingLatest.test.ts                                 | R (modified; real previews)                               |
| test/unit/resourceDiskDelta.test.ts                               | R (pure delta math)                                       |
| test/unit/resourceProbesDarwin.test.ts                            | R (recorded ioreg + live section)                         |
| test/unit/resolveLatestRecording.test.ts                          | R (real previews)                                         |
| test/unit/rulesFileBundle.test.ts                                 | R (real fs + callbacks)                                   |
| test/unit/runtimeAccountingEntry.test.ts                          | R (designed clock seam)                                   |
| test/unit/runtimeChatGptLock.test.ts                              | R (real lock module)                                      |
| test/unit/runtimeDailyBudget.test.ts                              | R (real settings + clock)                                 |
| test/unit/scheduleConsent.test.ts                                 | R (real files + sleeps)                                   |
| test/unit/scheduleFireFailures.test.ts                            | W (rewrite 2)                                             |
| test/unit/scheduleJournalHint.test.ts                             | R (real journal + one seam)                               |
| test/unit/scheduleStorePredicates.test.ts                         | R (real loader + guards)                                  |
| test/unit/runLedger.test.ts                                       | R (modified; product-driven)                              |
| test/unit/sessionBudgetFit.test.ts                                | R (real pricing)                                          |
| test/unit/storeErrors.test.ts                                     | R (pure readers)                                          |
| test/unit/teamPreview.test.ts                                     | R (modified; published price table)                       |
| test/unit/teamResources.test.ts                                   | R (modified; production systemClock)                      |
| test/unit/teamStoreFailures.test.ts                               | R (real ledger + ENOTDIR)                                 |
| test/unit/toolPresentation.test.ts                                | R (modified; product-driven)                              |
| test/unit/tokenCount.test.ts                                      | R (real presets + parsers)                                |
| test/unit/usageFs.test.ts                                         | R (real temp files)                                       |
| test/unit/usageJournalRetry.test.ts                               | W (rewrite 1)                                             |
| test/unit/usageLiability.test.ts                                  | R (real usage text)                                       |
| test/unit/usagePostFailure.test.tsx                               | R (render seam; see note)                                 |
| test/unit/vault/brokerSession.test.ts                             | R (real processes; fixtures fixed)                        |
| test/unit/vault/brokerSocketDirectory.test.ts                     | R (real binds)                                            |
| test/unit/vault/brokerWithoutKeyring.test.ts                      | R (real fallback)                                         |
| test/unit/vault/credentialAdapter.test.ts                         | R (real zeroing adapter)                                  |
| test/unit/vault/fileAnchor.test.ts                                | R (real anchor files)                                     |
| test/unit/vault/foreignPeer.c                                     | R (modified; real C peer)                                 |
| test/unit/vault/migrationCodecRoundTrip.test.ts                   | R (real codec)                                            |
| test/unit/vault/nativeReceipt.test.mjs                            | R (real V8 stacks)                                        |
| test/unit/vault/slotProviders.test.ts                             | R (real slots + probe)                                    |
| test/unit/vault/vaultGrantHints.test.tsx                          | R (real component + l10n)                                 |
| test/unit/vault/vaultHarnessScenarios.test.ts                     | R (scenario sync guard)                                   |
| test/unit/vault/vaultPanelBuild.test.ts                           | R (modified; separator normalisation)                     |
| test/unit/vault/vaultStateTable.test.tsx                          | R (real component)                                        |
| test/unit/vault/vaultStatusCard.test.tsx                          | R (real component)                                        |
| test/unit/vault/vaultViewMachine.test.ts                          | R (pure machine + types)                                  |
| test/unit/vault/windowsPipeRelay.test.ts                          | R (real peer)                                             |
| test/unit/vault/writerCrashPosix.test.ts                          | R (real crashed writers)                                  |
| test/unit/vaultAuditCap.test.ts                                   | R (real schema records)                                   |
| test/unit/vaultButtonChrome.test.mjs                              | R (real CSS/themes)                                       |
| test/unit/vaultEnabledSettings.test.ts                            | R (designed settings seam)                                |
| test/unit/vsixTargets.test.mjs                                    | R (real packaging lib)                                    |
| test/unit/windowsScreenRecorderNative.test.ts                     | R (real WinRT streams)                                    |
| test/unit/workflowDetails.test.ts                                 | R (modified; product-driven)                              |
| test/unit/helpers/windowsScreenRecorderChecks.cs                  | R (modified; WinRT doubles → real streams)                |
| test/unit/eval/evalTasks.test.ts                                  | R (modified; real verifier processes, env fix)            |

Modified files (44): all verified in the JOINB diff — removals of
stand-ins or product-driven updates, no new doubles. Notable:
`pluginDispatch` (platform's portable-fixture strategy kept; node-as-Bun
alias on non-darwin blessed in standins.md); `schedulesStdio`
(fake-bundle case deleted), `moduleExports`, `evalTasks`, `prompts`,
`teamPreview`, `teamResources`, `modelApiLegalScan`,
`chatgptResponsesCodec`, `verify.mjs`, `windowsScreenRecorderChecks.cs`,
`inspectNative`, `installTable`, `invariants`, `providerRefusals`,
`playbookSurface` (+ real-journal tests), `recordingLatest`,
`runLedger`, `rulesFileBundle`, `fileLease` (+ real Windows coverage),
`vaultPanelBuild` (separator normalisation), `foreignPeer.c`,
`reasoningResolverBaseWire.json`, `chatgpt-first-turn.json` (capture
refresh), harness files, `execArgs`, `featureCatalogDetails`,
`modelsPanelSchemas`, `modelsSections`, `paidMoneyStructure`,
`providersPresets`, `workflowDetails`, `toolPresentation`,
`accountUsd`, `browserEnglish`, `browserUiText`, `legalArgs`, `links`,
`goals`, `temporaryFolders`, `fixtures.ts`. The nine JOINB deletions are
tabled above (all J).

## Verification (this rig, repo's own timeouts throughout)

- `usageJournalRetry`: 3/3 green, repeated 5×; fail-on-purpose (isHeld
  guard removed → stale `a-*` bytes, both race tests fail) then reverted.
- `scheduleFireFailures`: 8/8 green; fail-on-purpose (absent-run guard
  dropped → a fire is recorded for an unadmitted run, exactly that test
  fails) then reverted.
- `namedLockRace`: 5/5 green (comment-only change).
- Neighbours `usageFs`, `scheduleJournalHint`, `journalRecord`: 19/19.
- `brokerWithoutKeyring` beforeAll builds the fixture bundle without the
  admission alias; its 1 failure is the pre-existing sandbox timeout,
  identical before and after (blocked child-process birth/AF_UNIX, as the
  JOINB message records).
- `npx prettier --check` on all touched files: clean. `npx eslint` on all
  touched files: zero warnings. `npm run typecheck` (all five projects):
  clean.
- Not run to green here (sandbox-blocked child-process birth/AF_UNIX):
  `brokerSession` times out 4/4 and `brokerWithoutKeyring` 1/1, observed
  on this rig both before and after the fixture change. The JOINB message
  records the same sandbox-blocked failures on the untouched tip for
  `writerCrashPosix` (17), `slotProviders` (6), `brokerSocketDirectory`
  (3) and `fileLease` (4); those suites are untouched by this lane and
  were not re-run. The lead/CI run owns runtime proof for the
  vault-fixture change.

## Correction during the audit

A first draft of rewrite 2 was built against a misremembered original
(team-alpha/nightly/Scenario — my own redesign notes, not the file). The
worktree file, git HEAD and the persisted tool output disagreed, so I
threw the draft away, re-audited the true 8-test original from git, and
rebuilt the rewrite against it (same tests, same literals; only the store
seam is real). Lesson: trust the file on disk and `git show`, never the
summary in my head. The committed rewrite, its green run and its
fail-on-purpose proof all postdate the correction.
