# REDM104E — JetBrains runtime connection redesign

Worktree `/home/randy/lanes/REDM104E`, branch `m104/eredesign`, base
`c59a483a`; Kubuntu, 2026-10-05. Implements the owner's redesign brief after
RVM104E and RVM104E2. Fake runtimes only: **zero model attempts, zero paid
calls**. No IDE agreement accepted, merge, rebase, push or shared-install change.

## Ownership and lifecycle

This section records the pre-R3 redesign; the RVM104E3 follow-ups below add
separate-session tracking, its discovery limit and native mutation fences.

1. `RuntimeConnection` is the generation's single actor and lifecycle owner;
   it supervises its MHP session, process and private stream pumps. The host
   holds only this owner and native disposable state.
2. Callers enqueue messages. Actor and transport admission each enforce the
   frozen 128-message/32-MiB bounds; the frozen frame bound is 16 MiB.
   In-flight writes, callbacks and replies count toward admission. Overflow
   fails the connection. IDE panel delivery uses the bounded request executor.
3. Writes have a two-second threshold checked every second; metadata has its
   existing two-second deadline. Either failure tears down the whole attempt
   and publishes a fixed visible reason.
4. Close marks the epoch unavailable immediately. The actor cancels work,
   requests stream closure on private workers, signals process handles with
   a two-second stop deadline, kills containment, then bounds worker joins.
   Buffered Java stream locks never gate process termination or IDE disposal.
5. POSIX starts a session/process group before exec through system Perl/POSIX.
   Windows attaches a stdin-gated launcher to a kill-on-close job before
   releasing it. A parent-exit callback detects death despite inherited open
   stdout, and containment still reaches reparented workers. A JVM shutdown
   hook force-kills through an eagerly prepared handle without stream I/O;
   normal cleanup removes it.
6. Each owner gets a fresh epoch, included in outbound IDs and captured by
   protocol, editor, widget, surface and native-lifetime callbacks. Cancelled
   requests retain bounded correlation; closed work never targets a replacement.
7. Frozen wire validation remains at ingress. Coordinates are checked before
   narrowing. Unknown/duplicate/malformed traffic is refused. Runtime failures
   become fixed exception words; actor diagnostics use an exact allowlist.

The private I/O workers are necessary for blocking JVM process streams. Only
those supervised pumps and close tasks touch streams; the IDE and request
workers do not. This is one logical connection owner, rather than a claim that
one physical JVM thread can synchronously read and write every pipe at once.

## Findings and named regressions

| Review finding                                            | Regression and evidence                                                                                                                                                                                                                                                                                                   |
| --------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| RVM104E R1: cancelled Tab disconnects panels              | `MhpConnectionTest.cancelledTabLateSuccessAndFailureLeaveOtherRequestsAndPanelsAlive`; `RuntimeStressTest.testR1LateCancelledTabReplyKeepsTheNativeSessionAndReplacementAlive`. Valid late success/failure, unaffected calls, bounded retained slots, malformed/duplicate refusal and native registration remain covered. |
| RVM104E R2: metadata monitor deadlocks shutdown           | `MhpConnectionTest.metadataHandoffDoesNotHoldTheMonitorAndShutdownWins`, `metadataHandoffHasADeadlineAndRejectsLateInitialization`; `RuntimeStressTest.testR1MetadataEdtHandoffCannotDeadlockDisposal`. The real EDT handoff is deliberately held while the owner closes.                                                 |
| RVM104E R3: transport leaves native session/process alive | `NativeLifecycleTest.testTransportFailureDisposesNativeSessionUnbindsTabAndKillsTheRuntimeTree`; stress failure checks remove the registered native command and Tab, display a reason and stop the parent/worker.                                                                                                         |
| RVM104E R4: root/exclusion globs                          | Existing `NativeHostServicesTest.testWorkspaceGlobsIncludeRootNestedAndHiddenFilesAndApplyExclusionsAtEveryDepth` and `testWorkspaceGlobLimitsRejectOversizedOrExplosivePatterns` remain and pass. Their production fix is unchanged.                                                                                     |
| RVM104E R5: nonexistent diagnostics evidence              | Existing real daemon `testDiagnosticsGetReportsSettledDaemonErrorsWithExactUriAndUtf16Range` and `testDiagnosticsDidChangePublishesSettledErrorsAndClearsAfterCorrection` remain and pass. The earlier record is unchanged.                                                                                               |
| RVM104E R6: native inline startup uncounted               | Existing native inline build gate and `hosts/jetbrains/test/bundle-size.test.mjs` remain. No budget changed.                                                                                                                                                                                                              |
| RVM104E2 R1: blocked stdin freezes disposal               | `RuntimeStressTest.testR2BlockedStdinCannotFreezeProjectDisposal` and `testR2BlockedStdinFailsWithAWriteDeadlineAndReconnects`: real 1-MiB writes to a Python child that stops reading; IDE host disposal returns within one second, automatic write failure is visible, and workers stop.                                |
| RVM104E2 R2: parent-first orphan                          | `RuntimeStressTest.testR2ParentFirstDeathKillsReparentedWorkerAndReconnects`: Python `os._exit` leaves its worker holding inherited pipes. Parent-exit observation starts cleanup and the stable process group reaches the worker.                                                                                        |
| RVM104E2 R3: old work sends into replacement              | `MhpConnectionTest.closedEpochDropsQueuedInboundReplyInsteadOfSendingIntoReplacement`; each stress replacement has a larger epoch, refuses old-owner requests and completes its own request. Native widget/surface callbacks capture their originating owner.                                                             |
| RVM104E2 R4: integer wrapping edits                       | `DocumentServicesTest.testWireIntegersCannotWrapIntoValidEditCoordinates`; `RuntimeStressTest.testR2OutOfRangeWireEditCannotChangeTheNativeDocumentAndReconnects`: a schema-valid 2^32 range reaches the real trusted clean document and is refused with `MHP_INVALID_RANGE`; `alpha` remains unchanged.                  |
| RVM104E2 R5: raw Tab error logger text                    | `MhpConnectionTest.runtimeFailureTextCannotBecomeAnIdeLoggerException`; `RuntimeStressTest.testR2RawTabFailureExposesOnlyFixedTextAndReconnects`. A schema-valid uppercase canary is absent from the exception and stack exposed to the platform.                                                                         |
| RVM104E2 R6: metadata deadline leaves Connecting          | `RuntimeStressTest.testR2MetadataDeadlineTearsDownTheWholeConnectingAttemptAndReconnects`: blocked native EDT metadata, owner termination without EDT release, then visible failure, native unregistration and successful replacement.                                                                                    |
| Stress: output flood and shutdown hang                    | `RuntimeStressTest.testOutputFloodFailsBoundedAdmissionAndReconnects`, `testShutdownHangCannotFreezeProjectCloseAndReconnects`. Flood admission fails visibly; a child ignoring SIGTERM and stdin cannot gate native disposal.                                                                                            |
| IDE JVM exit                                              | `RuntimeStressTest.testIdeJvmExitKillsAnAttachedRuntimeAndItsWorker` and `testIdeJvmExitKillsAWorkerWhoseRuntimeParentAlreadyExited` start separate JVMs, exit them without project cleanup, and require both PID receipts to be stopped.                                                                                 |
| Aggregate actor admission                                 | `RuntimeStressTest.testAggregateMailboxBytesFailBeforeTheActorCanDrainThem` holds initialization deliberately and fills the mailbox with four half-frame notifications; byte admission fails independently of the downstream writer.                                                                                      |

The stress suite uses `HeavyPlatformTestCase`, creating and closing real IDE
projects. Hosts are registered to the project. After each scenario it opens a
replacement session, then leaves a further fake connection attached until
framework project teardown and checks its termination afterward. Tests treat
Linux zombie state as stopped, distinguishing a reparented process that still
runs from one awaiting its OS reaper. Emergency fake-worker cleanup happens
only after assertions. The first containment drill exposed missing emergency
cleanup in the two metadata cases; that fixture cleanup was corrected. One
fake Python sleep worker left by that first drill was terminated after matching
its exact command and this worktree as its cwd. The final containment drill
uses the corrected cleanup; no other lane process was touched.

## Native verification

- Headless: **62/62 passed, zero failures/errors/skips**, ktlint, detekt and
  `buildPlugin` exit 0 (`temp/exit-after-fix.log`). The two separate-JVM tests
  failed before the hook with workers still running (`temp/exit-before-fix.log`).
- Final restored Xvfb/JCEF: **62/62 passed, zero failures/errors/skips**,
  ktlint, detekt and ZIP build exit 0 (`temp/native-ui-final.log`). Includes
  the shared composer, approvals, Stop, native Tab, actual project lifetime
  and separate-JVM exit tests. No restored stream/thread leak was reported.
  Fresh [panel](m104-e-redesign-panel-ui.png) and
  [approval](m104-e-redesign-panel-approval.png) screenshots contain fake traffic only.
- Shared production build exits 0 (`temp/scoped-build.log`). Native main is
  **913.0/950 KiB**, notes **0.7/25 KiB**; the actual generated entries were
  checked again (`temp/native-inline-final.log`); unchanged native gates pass.

## Deliberate failures and restoration

All **15** drills ran the entire owned native JVM suite without test filters
(60 tests initially, 62 after the separate-JVM regressions). Every run exited
1 and fired its named expected regression. Each mutation was restored in a
`finally` block; the before/after SHA-256 values matched. Full observed failure
names and hashes are preserved in [the drill receipts](m104-e-redesign-drills.json).
The final containment drill also exposed expected stream/thread leaks while
containment was deliberately disabled; the restored UI run reported none.

| Mutation                                     | Expected failing regression                                                                                                |
| -------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------- |
| `cancel-correlation` in `MhpConnection.kt`   | `cancelledTabLateSuccessAndFailureLeaveOtherRequestsAndPanelsAlive`                                                        |
| `metadata-monitor` in `MhpConnection.kt`     | `metadataHandoffDoesNotHoldTheMonitorAndShutdownWins`                                                                      |
| `metadata-deadline` in `MhpConnection.kt`    | `metadataHandoffHasADeadlineAndRejectsLateInitialization`                                                                  |
| `metadata-owner` in `MhpConnection.kt`       | `testR2MetadataDeadlineTearsDownTheWholeConnectingAttemptAndReconnects`                                                    |
| `closed-epoch` in `MhpConnection.kt`         | `closedEpochDropsQueuedInboundReplyInsteadOfSendingIntoReplacement`                                                        |
| `raw-tab-error` in `MhpConnection.kt`        | `runtimeFailureTextCannotBecomeAnIdeLoggerException`, `testR2RawTabFailureExposesOnlyFixedTextAndReconnects`               |
| `coordinate-wrap` in `DocumentServices.kt`   | `testWireIntegersCannotWrapIntoValidEditCoordinates`, `testR2OutOfRangeWireEditCannotChangeTheNativeDocumentAndReconnects` |
| `write-deadline` in `MhpPipe.kt`             | `testR2BlockedStdinFailsWithAWriteDeadlineAndReconnects`                                                                   |
| `queue-failure` in `MhpPipe.kt`              | `countsInFlightFramesAndReleasesAllReservationsWhenClosed`, `boundsWriterQueueAndDropsOnlyTheClosingSurface`               |
| `process-group` in `RuntimeProcess.kt`       | `testR2ParentFirstDeathKillsReparentedWorkerAndReconnects`                                                                 |
| `parent-exit` in `RuntimeConnection.kt`      | `testR2ParentFirstDeathKillsReparentedWorkerAndReconnects`                                                                 |
| `mailbox-bytes` in `RuntimeConnection.kt`    | `testAggregateMailboxBytesFailBeforeTheActorCanDrainThem`                                                                  |
| `blocking-close` in `MhpPipe.kt`             | `testR2BlockedStdinCannotFreezeProjectDisposal`, `testR2BlockedStdinFailsWithAWriteDeadlineAndReconnects`                  |
| `jvm-shutdown-hook` in `RuntimeProcess.kt`   | `testIdeJvmExitKillsAnAttachedRuntimeAndItsWorker`, `testIdeJvmExitKillsAWorkerWhoseRuntimeParentAlreadyExited`            |
| `final-process-group` in `RuntimeProcess.kt` | `testR2ParentFirstDeathKillsReparentedWorkerAndReconnects`, `testIdeJvmExitKillsAWorkerWhoseRuntimeParentAlreadyExited`    |

`RuntimeProcess.kt` first used hash
`4a718691c938c6c991464155731cca10167e76a21d5862aa5effc9561a93ec1b`;
its final JVM-hook revision used
`9625d0df9cc86cf5ccdfd622fea3481cadf5d3b36b4db7482f1bd7fb5a1673ac`.
The original first-round glob/diagnostic/inline-size drills in `m104-e3.md`
remain historical receipts of unchanged implementations, not new executions.

## Scoped repository checks and artifact

Source commits: `eee668af3` (owner/epochs) and `8b4b70b30` (JVM exit).
All checks ran directly on Kubuntu, sequentially. No test filter, severity,
timeout, cap or configuration was relaxed.

- `npm run typecheck`: all five projects pass.
- Scoped ESLint: the four owned native resource/bridge/size `.mjs` files pass
  with zero warnings. Kotlin uses ktlint/detekt, both pass.
- Prettier on changed Markdown/JSON, plain `npm run deadcode` (`knip`),
  `npx --no-install jscpd`, `npm run check:l10n`, `npm run check:host-api`
  and `git diff --check`: exit 0. Localization checks 14 tables, 131 manifest
  strings and 481 source files with zero problems.
- `npx --no-install vitest run test/unit/mhpContract.test.ts test/unit/mhpPanelContract.test.ts --maxWorkers=3 --testTimeout=120000 --no-cache --configLoader runner`:
  **55/55 passed** (`temp/scoped-mhp-contract.log`).
- `node --test hosts/jetbrains/test/embedded.test.mjs hosts/jetbrains/test/bundle-size.test.mjs`: **8/8 passed, zero skips**
  (`temp/scoped-native-node.log`).
- `npm run build`: size, split, host-global and bundled-notice gates pass.
  Activation **582.3/600 KiB**, Model API **429.5/475**, checkpoint store
  **89.2/225**, ACP **804.4/850**, shared startup **877.5/900**, deferred
  **38.6/50**. No dependency or shared source was changed.
- Source-commit `gitleaks git --redact --no-banner --log-opts=c59a483a..HEAD .`: two commits scanned, zero leaks
  (`temp/gitleaks-source-commits.log`); every commit also runs staged gitleaks.

Final development ZIP: `hosts/jetbrains/build/distributions/muse-spark-code-jetbrains-0.1.0.zip`, **3,330,772 bytes**, SHA-256
`9734641bb86ad5b0fa681a269a96ad3f04a9c103d81c52064bb8671877b63b19`.
This exact hash matched before and after Plugin Verifier.

## Fresh Plugin Verifier

`verifyPlugin --offline --no-daemon` used pinned verifier **1.410**,
unchanged **FailureLevel.ALL** and the three declared installed IDEA releases
via `verificationIdePaths`; build SDK `privateIdePath=temp/idea-sdk`.
**Exit 0**, no dependency downloads (0 bytes), no suppressions. IDE layout
warnings about optional modules appeared in the tool log; all plugin verdicts
were Compatible and no failure level was removed. This certifies API
compatibility, not running the installed IDE after accepting its agreement.

| Declared release | Build            | Fresh verdict receipt                                       |
| ---------------- | ---------------- | ----------------------------------------------------------- |
| IDEA 2025.3.3    | IU-253.31033.145 | [Compatible](m104-e-redesign-verifier/IU-253.31033.145.txt) |
| IDEA 2026.1.5    | IU-261.27258.48  | [Compatible](m104-e-redesign-verifier/IU-261.27258.48.txt)  |
| IDEA 2026.2.3    | IU-262.10968.63  | [Compatible](m104-e-redesign-verifier/IU-262.10968.63.txt)  |

The cached 2025.3.3 SDK was copied to `temp/idea-sdk` before tests so bootstrap
resources could not modify the shared installation. No package/tool was added,
no agreement accepted and no user/machine setting changed. Earlier verifier
receipts in `m104-e3.md` remain historical.

## Frozen boundaries

The four MHP schema/lock files have no diff and retain these SHA-256 values:

| File under `src/shared/hostApi/` | SHA-256                                                            |
| -------------------------------- | ------------------------------------------------------------------ |
| `mhp-v1.schema.json`             | `84f1436f57fa920d11e37fadb2f71dc7516998b1615bd0f6898329b6896614ec` |
| `mhp-v1.1.schema.json`           | `857992408e9f92ac6af7c65897672a7d3a2e0a09140c19f851b931439f9c2a70` |
| `mhp-v1.lock.json`               | `c8105960ebff9517703022fe0cbbdce4fede4ec61018d0b9021abf83b9a2e3b8` |
| `mhp-v1.1.lock.json`             | `e95e6a6f9dc144e9312c520dd8584ebae488ce0c6dbf0a7acf82753bfcd23068` |

All stress frames use the existing frozen contract/proposal. No model wire
shape, request prefix, provider decision, paid default, shared implementation,
other host or golden fixture changed.

## Local hook incident

Both source commits ran hooks. During `eee668af3`, lint-staged nevertheless
created and automatically removed its backup stash (`70e17e5e`), contrary to
the lane's no-stash rule. The first preload matched its canonical CLI filename
but missed the `.bin/lint-staged` entry. No manual stash or history rewrite
was run. The corrected worktree-local preload covers both filenames and
adds `--no-stash --no-hide-partially-staged`; its probe and the `8b4b70b30`
hook log explicitly show backup and hiding skipped. No hook or Git config was
changed, and both staged gitleaks scans reported no leaks.

## Evidence limits

These are IDE-framework and fake-runtime tests. Standalone installed-IDE
qualification still awaits the owner's User Agreement, and controller/companion
assembly remains with integration lanes. Windows job execution and macOS
process-group execution cannot run on this Linux rig; no such runtime receipt
is claimed. Full aggregate quality/coverage are expressly left to the lead by
the rig brief and PLAN §7. No product or parity status is promoted.

## RVM104E3 follow-up: runtime descendants

FIXM104E3, Kubuntu, 2026-10-05, base `fef327e47`. RVM104E3 finding 1
is fixed for observed separate-session descendants. Previously, `kill(-pid)`
only addressed the runtime's process group: ToolIo and MCP children use their
own POSIX sessions, and an exited parent's `descendants()` is empty. The
adapter now retains handles and start instants while the parent is alive,
snapshots before signalling, lets the supervisor stop its own children first,
then forces containment and remaining identities only if the OS start instant
still matches. The JVM hook uses the same retained identities without stream I/O.

The new separate-session crash regression failed against the original code:
`testR3ParentFirstDeathKillsSeparateSessionWorkerAndReconnects` was the sole
failure in **63 tests** (`temp/r3-before-process.log`, exit 1). The restored
process fix passed **65 tests**, ktlint and detekt (`temp/r3-process-green.log`).
The subsequent identity regression brings the inventory to 66; final and drill
receipts are recorded below before handoff.

Named residual **R3-tree-discovery-window**: a detached descendant outside
observed ancestry may never enter the snapshot, for example one created and
reparented entirely between the 10-ms observations. ProcessHandle cannot
reconstruct an exited parent's lost ancestry.
The runtime's cooperative supervision and same-group/job containment remain;
this is safe only within the adapter's existing development qualification,
with no supported whole-tree guarantee. Follow-up: integration must qualify
supervisor shutdown and consider OS containment covering independently detached
children before support is claimed. This requires a broader containment design;
it is not silently claimed structurally impossible. Windows/macOS and installed
IDE qualification remain pending as already recorded.

Runtime cleanup drill receipts: [R3 drill records](m104-e-r3-drills.json).
All four attempts ran the complete owned suite of **66 tests**, without filters,
and restored `RuntimeProcess.kt` byte-exact to SHA-256
`73da4ad3de615d3f3e2848d277ddf924f4ea02a0af333b69692c08ba2c881ce5`.

| Deliberate mutation                                        | Expected regression                                                                                                                   | Observed                                                                 |
| ---------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------ |
| Disable the live descendant tracker                        | `testR3ParentFirstDeathKillsSeparateSessionWorkerAndReconnects`, `testR3IdeJvmExitKillsSeparateSessionWorkerWhoseRuntimeParentExited` | Both failed; exit 1                                                      |
| Ignore the captured process start instant                  | `reusedPidWithDifferentStartInstantCannotBeSignalled`                                                                                 | Sole failure; exit 1                                                     |
| Signal children before the supervisor, initial fixture     | `runtimeStopsItsSeparateSessionWorkerBeforeForceCleanup`                                                                              | Did not fail; signal delivery raced. Retained as an unsuccessful attempt |
| Signal children before the supervisor, acknowledged worker | `runtimeStopsItsSeparateSessionWorkerBeforeForceCleanup`                                                                              | Sole failure; exit 1                                                     |

The cleanup-order fixture now installs a child signal handler, waits for its
readiness and records whether it was signalled before the supervisor started
cleanup. This closes the scheduling ambiguity in the initial attempted drill.
The PID-reuse regression tests the current JVM handle with a deliberately
mismatched start instant; it never signals that handle.

Final restored runtime cleanup: **66/66 passed, zero failures/errors/skips**,
ktlint and detekt exit 0 (`temp/r3-process-restored.log`). Hooks were present
through `.husky/_/pre-commit`; no preload, environment override or hook change
was used. The earlier hook incident remains historical and is not repeated.

## RVM104E3 follow-up: native mutation epochs

Finding 2 is fixed by capturing the native lifetime and originating
`RuntimeConnection` in the request adapter. The EDT checks both identities and
the owner's atomic open flag synchronously. Native document, surface, Tab,
command, widget, workspace and UI mutation paths use that fence; document
writes repeat it inside the write command and before each edit. Token
cancellation can still arrive later without authorizing any retired mutation.
No guard, wire schema, paid decision, provider path or dependency was widened.

The initial regression used the IDE's in-memory `temp://` filesystem and failed
before reaching the intended mutation (`temp/r3-before-epoch.log`). It was
corrected to the existing disk-backed fixture pattern. Against the unchanged
production path, `testRetiredQueuedEditorRequestsCannotMutateReplacementNativeStateBeforeCancellation`
then failed: replacement commands and the real `alpha` document were changed
(`temp/r3-before-epoch-real-document.log`, **67 tests**, sole failure). A fresh
replacement peer now stays idle in this regression so its own Tab registration
cannot obscure an old Tab mutation.

The regression holds the old protocol monitor, the exact actor barrier before
inbound token cancellation. Three validated frozen-contract requests are queued
on the actual request executor. While still holding the monitor, the test
attaches a replacement to the same host, then pumps all three old EDT callbacks.
It checks the replacement Tab registration, absence of an old command and
unchanged real document. Reflection is restricted to these private production
objects in the fixture; type narrowing uses `require`, with no unchecked cast.

`testRetiredEpochCannotEditAfterWriteCommandStarts` retires the epoch in a real
IDE command listener. `testEpochIsRecheckedBeforeEachEditWhenADocumentListenerRetiresIt`
retires it in a real document listener after the first edit; the next edit is
refused. The first edit took place while the epoch was valid. The tests use the
production document mutation path and preserve its trust/version/dirty/range
checks. No residual is retained for finding 2.

Native gate preparation also caught an overlong fixture and a complex callback;
helpers only split the fixture, and simple checks keep the production callback
within the unchanged limits. The new failure assertions explicitly use JUnit's
returning helper rather than the IDE test superclass's void helper.

The three native mutation drills each ran all **69 owned tests**, without
filters, exited 1 and fired only the intended named tests. Restoration hashes
match byte-for-byte in [the combined R3 receipts](m104-e-r3-drills.json):
`MuseToolWindowFactory.kt` SHA-256
`d1124d86332c4053d850653372626216739c68e9789e265887b2fd4a4d1e028f`;
`DocumentServices.kt`
`1cf47a529a1faf5de76cb57310e47d11539fb216425c7cc9f058e9a84fb9106c`.

| Deliberate mutation                                  | Expected failing regression                                                                                             |
| ---------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------- |
| Remove the captured native lifetime/owner/open fence | `testRetiredQueuedEditorRequestsCannotMutateReplacementNativeStateBeforeCancellation`; all three states changed         |
| Remove the write-command and per-edit fences         | `testRetiredEpochCannotEditAfterWriteCommandStarts`, `testEpochIsRecheckedBeforeEachEditWhenADocumentListenerRetiresIt` |
| Remove only the per-edit fence                       | `testEpochIsRecheckedBeforeEachEditWhenADocumentListenerRetiresIt`                                                      |

Initial restored epoch code passed **69/69 tests**, zero failures/errors/skips,
ktlint and detekt (`temp/r3-epoch-green-tested.log`). Final restored and shared
check/verifier receipts follow below. No new unchecked cast, suppression,
dependency, shared protocol file or model/paid call was introduced.

Final restored native source: **69/69 passed, zero failures/errors/skips**,
ktlint and detekt exit 0 (`temp/r3-native-final-restored.log`).

## RVM104E3 final gates and artifact

Source commits: `f4e1dbeb5` (descendants) and `b21b796cf` (native mutation
fences). Both ran the unchanged hooks: lint-staged and staged gitleaks, with
no leaks, preload or bypass. All work and checks ran directly on Kubuntu,
sequentially. No merge, rebase, push, install, agreement, model attempt or paid
call occurred. Full aggregate quality/coverage remain with the lead under the
explicit rig/common prohibition, recorded in PLAN §7.

All scoped checks exit 0 (`temp/r3-scoped-results.json`): all five TypeScript
projects, scoped native `.mjs` ESLint, changed Markdown/JSON Prettier, plain
`knip`, `jscpd`, localization (**14 tables, 131 manifest strings, 481 source
files, zero problems**), host API and whitespace. Shared contract Vitest:
**55/55 passed** with three workers, 120-second limit, no cache and runner config
loader; native Node suites: **8/8 passed, zero skips**. Restored native JVM:
**69/69 passed, zero failures/errors/skips**; ktlint and detekt pass. Six red
drills fired their named regressions; one initial cleanup-order attempt did
not, is recorded, and was replaced by the acknowledged-worker drill. Every
mutation was restored byte-exact. No gate threshold, rule level or filter changed.

Production build, size/split, host globals and bundled notices pass
(`temp/r3-scoped-build.log`). Activation **582.3/600 KiB**, Model API
**429.5/475**, checkpoints **89.2/225**, ACP **804.4/850**, shared startup
**877.5/900**, deferred **38.6/50**. Actual native folded main **913.0/950**,
notes **0.7/25** (`temp/r3-native-inline.log`). No cap was raised.

Final development ZIP: `hosts/jetbrains/build/distributions/muse-spark-code-jetbrains-0.1.0.zip`,
**3,335,807 bytes**, SHA-256
`1d2ea09290ee2d831e0a4ed4c92fe1d9a8ff23d4a842321f638658519852cb06`.
The exact bytes matched before and after the fresh verifier.

`buildPlugin` and `verifyPlugin --offline --no-daemon` exit 0
(`temp/r3-package.log`, `temp/r3-verifier.log`). Verifier **1.410** and
**FailureLevel.ALL** remain unchanged; build SDK `privateIdePath=temp/idea-sdk`
and three installed releases via `verificationIdePaths`. **0 bytes** downloaded,
no suppression. SDK optional-module layout warnings in the tool log do not
change the three Compatible plugin verdicts. This is API verification; no
standalone IDE agreement was accepted or standalone IDE qualification claimed.

| Release       | Build            | Fresh verdict                                         |
| ------------- | ---------------- | ----------------------------------------------------- |
| IDEA 2025.3.3 | IU-253.31033.145 | [Compatible](m104-e-r3-verifier/IU-253.31033.145.txt) |
| IDEA 2026.1.5 | IU-261.27258.48  | [Compatible](m104-e-r3-verifier/IU-261.27258.48.txt)  |
| IDEA 2026.2.3 | IU-262.10968.63  | [Compatible](m104-e-r3-verifier/IU-262.10968.63.txt)  |

The four frozen MHP schema/lock hashes listed above still match byte-for-byte.
No shared/provider/paid/golden-file source or other-host path changed. Windows
and macOS execution, standalone IDE agreement and controller/companion assembly
remain the existing qualification limits. R3-tree-discovery-window is the sole
named new residual; native mutation finding 2 has none.

Source-commit gitleaks scanned both new commits and 33,952 bytes with zero leaks
(`temp/r3-source-gitleaks.log`); certification commits also run staged gitleaks.
