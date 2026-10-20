# Catches gate audit — JOIN0190 release preparation (2026-10-19, macmini rig)

`npm run check:catches` was red after the 179–184 joins: 70 catch sites
with identities the old baseline never saw. Each was audited below —
fixed at cause, documented, or kept with its reason — and then the
baseline was regenerated with
`node scripts/catch-inventory.mjs --write-baseline`. The gate passes;
no gate code was touched.

## Fixed at cause (2 code changes)

- `src/core/backends/modelapi/ModelApiHost.ts` (SessionEnd hooks):
  the warn carried the raw error message (`describe(error)`); it now
  carries only the error name through `wireWordForLog`, per the
  redaction rule. REPORTED.
- Probe negatives documented with their reason (SWALLOW to CLEANUP):
  `src/host/backend/jobBuild.ts:185` (failed self-test offers no
  binary), `src/host/conversation/conversationController.ts:8490`
  (a throwing preview factory leaves previews unavailable),
  `src/runtime/vault/slots/slotEntries.ts:87` (unreadable slot facts
  open no slot), `src/core/media/record/windows.ts:289` (a throwing
  countdown listener ends the recording with its failure).

## Accepted CLEANUP (best-effort teardown, reason comment already present)

`src/core/execGuard.ts:589` (unresolvable PATH entry stays as
written), `src/core/locks/processOwner.ts:571` (unreadable evidence is
unknown, never death), `src/core/media/record/linux.ts:360`,
`src/core/media/record/macos.ts:381,470` (failed attempt cancels the
writer; disposal still settles), `src/host/team/processLifetime.ts:515`
(no delegated cgroup scope falls back to the process-group path),
`src/host/team/orphanRecovery.ts:157` (no match outside the probe),
`src/core/vault/migrate/importFile.ts:249` (receipt stays for the next
attempt), `src/core/vault/broker/client.ts:165` (invalid bytes close
the connection and fail the pending call),
`src/core/vault/broker/files.ts:174,272` (teardown keeps no cause; a
consumed rename needs no unlink).

## Kept GENERIC/SWALLOW, justified (the failure is reported elsewhere)

The returned failure or refusal is the report channel — the caller
surfaces it, so a second log would double-report:
`src/core/backends/modelapi/imageGeneration.ts:191` (reason sentence),
`src/core/backends/modelapi/tools.ts:1374` (file error row),
`:2198` (refusal by mode), `src/acp/estimate.ts:56` (failure
sentence; paths and accounts never reach the agent),
`src/webview/media/CompanionMedia.tsx:199`,
`src/webview/media/recorder/browserRecorder.ts:220`,
`src/webview/usage/UsageApp.tsx:75` (failed finding),
`src/core/backends/modelapi/pluginHost.ts:373,411` (probe refusal
with its reason), `src/core/providers/subscriptions/registry.ts:782`
(fixed retry sentence), `src/host/skills/bundledSkillsInstall.ts:561`
(result failure plus rollback), `src/runtime/sharing/sharingEntry.ts:309`
(CLI stderr plus exit code), `src/runtime/exec/runExec.ts:1409`
(result record: error, status, usage flag),
`src/core/backends/modelapi/ModelApiHost.ts:15615` (turn outcome),
`src/core/resources/queue.ts:222` (downstream entry rejection),
`src/core/vault/broker/state.ts:1802` (waiting operation settlement),
`src/runtime/exec/providerExec.ts:413` (downstream rejection),
`src/runtime/companion/voiceHandler.ts:175` (companion error event),
`src/core/media/record/windows.ts:336` (result reason).

Probe findings and fail-closed negatives — a negative is the answer,
not a failure: `src/core/reporting/history.ts:148,371,381`,
`src/runtime/vault/epochContender.ts:219` (unprovable stays `wait`),
`src/runtime/vault/fileAnchor.ts:49` (no anchor is no history),
`src/runtime/vault/hostRegistry.ts:163`,
`src/runtime/vault/slots/slotEntries.ts:130`,
`src/host/team/processLifetime.ts:492` (false findings),
`src/core/vault/remote.ts:365` (peer denial or stale quiet),
`src/core/vault/broker/firstParty.ts:23` (fallback supersedes),
`src/runtime/vault/posixClientPlatform.ts:67` and
`src/runtime/vault/windowsClientPlatform.ts:116` (only proven death
permits launch), `src/core/vault/slots/windowsVaultTransport.ts:84`
(fixed-text probe refusal).

Turn, cancellation and settlement control flow — abort ends silently
by design (Stop is not a failure), named conditions rethrow:
`src/acp/agent.ts:2766` (cancelled peek),
`src/core/backends/modelapi/ModelApiHost.ts:7861,13877`
(aborted probe load, aborted tool wait),
`src/host/schedules/deliveryBinding.ts:337` (withdrawal facts),
`src/core/judge/fast/inspectExec.ts:218` (cancelled/confinement
refusal), `src/shared/estimateDiagnostic.ts:127` and
`src/webview/estimator/EstimatorPanel.tsx:204` (abort silence plus
run-boundary report), `src/core/web/webFetch.ts:942` (abort rethrow
plus failed result).

Credential-safe fixed sentences — the error must not travel:
`src/core/backends/modelapi/extensionHooks.ts:1162` (spawn failures
may echo a command line),
`src/core/backends/musecode/approvalModesEntry.ts:178,244`
(quarantine plus typed cause-carrying throws),
`src/core/backends/modelapi/ModelApiHost.ts:3943`
(`helpersFailure` warns in fixed vocabulary),
`src/runtime/exec/providerExec.ts:604` (cause rides the refusal
constructor's third parameter, which the inventory does not model),
`src/runtime/vault/slots/linuxTpm2Slot.ts:54` (secret zeroized, then
the fixed-text `VaultStoreUnavailableError`, whose contract carries
no cause by design), `src/host/conversation/conversationController.ts:6633`
(`cleanupFailed` records the best-effort archive failure),
`src/core/reporting/sources/github.ts:473` (deferred schema
validation throws `ReportNetworkFailure` on the stashed failure),
`src/core/vault/broker/files.ts:268` (best-effort close and unlink,
then the original error rethrows),
`src/core/backends/modelapi/structuredOutput.ts:140,150`
(retry and fallback notices; abort and terminal errors rethrow),
`src/host/runners/sshRunner.ts:414` (placement admitted, too-long
commands rethrown, status return is the report),
`src/core/media/record/windows.ts:366` (stop-path teardown plus the
fixed refusal return).

Re-identified without behavior change: the D-number renumber
(D119 to D207, D121 to D208) shifted nearby comment text inside a
few sites' identity windows
(`ModelApiHost` spend lines, `estimateDiagnostic`, `EstimatorPanel`,
`acp/estimate`); the `pluginHost` port kept the join's hardening.
Proven by the suites named in the 181–184 merge commits.
