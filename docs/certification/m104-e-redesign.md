# REDM104E — JetBrains runtime connection redesign

Worktree `/home/randy/lanes/REDM104E`, branch `m104/eredesign`, base
`c59a483a`; Kubuntu, 2026-10-05. Implements the owner's redesign brief after
RVM104E and RVM104E2. Fake runtimes only: **zero model attempts, zero paid
calls**. No IDE agreement accepted, merge, rebase, push or shared-install change.

## Ownership and lifecycle

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
only after assertions, so a containment red drill cannot leave a running orphan.

## Initial verification

- Headless: **62/62 passed, zero failures/errors/skips**, ktlint, detekt and
  `buildPlugin` exit 0 (`temp/exit-after-fix.log`). The two separate-JVM tests
  failed before the hook with workers still running (`temp/exit-before-fix.log`).
- Xvfb/JCEF before the final aggregate-byte test: **59/59 passed**, ktlint,
  detekt and ZIP build exit 0 (`temp/native-ui-green.log`). Includes the shared
  composer, approvals, Stop, native Tab and actual project lifetime tests.
- Shared production build exits 0 (`temp/build.log`). Native main is
  **913.0/950 KiB**, notes **0.7/25 KiB**; unchanged native gates pass.

Thirteen deliberate regressions have failed and restored source bytes exactly
(`temp/red-drills.json`); final hook/containment drills, restored UI run,
scoped repository checks and fresh three-IDE
Plugin Verifier receipts follow in the verification commit. Existing receipts
in `m104-e3.md` are historical and do not certify this new ZIP.

## Evidence limits

These are IDE-framework and fake-runtime tests. Standalone installed-IDE
qualification still awaits the owner's User Agreement, and controller/companion
assembly remains with integration lanes. Windows job execution and macOS
process-group execution cannot run on this Linux rig; no such runtime receipt
is claimed. Full aggregate quality/coverage are expressly left to the lead by
the rig brief and PLAN §7. No product or parity status is promoted.
