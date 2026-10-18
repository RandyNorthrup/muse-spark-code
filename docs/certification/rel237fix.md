# Certification — REL237FIX: the ten PR #237 review threads

Lane `REL237FIX`, rig `linuxlt`, branch `release/0.19.0-4` from COMBINE3's
head `e58e1e0da3` (release/0.19.0 with #203 reverted in `659d179ff1`).
None of the threads touches #203-only code (turn/background notices),
so none is answered by the revert; each is fixed at cause below. (The
brief says ten; the review lists nine `###` sections, all covered here —
thread 8's ACP half is item 9's neighbour and fixed with item 8.)

## Triage — one line per thread

1. `sandbox.ts:204` (P1 security, bwrap PATH): fix — resolve `bwrap`
   through `resolveExecutable` (absolute PATH entries only) and refuse the
   probe as `bwrapFailed` when unresolved.
2. `conversationController.ts:2881` (P2, resumed sessions): fix — call
   `noteShellSandbox()` on the `adopt()` / `resumeAfterRestart()` paths,
   not only on the new-session path.
3. `dictationHost.ts:87` (P2, voice proxy): fix — pass the live
   `http.proxySupport` / `http.webSocketAdditionalSupport` settings into
   the Muse Voice decision and refresh it when those settings change.
4. `schedulePaidConsent.test.ts:47` (P1, invented fixtures): fix — delete
   the unwired-helper describes (no production caller binds them); keep
   only the reachable production-surface refusal test.
5. `museCodeBackendManager.ts:534` (P2, stale readiness cache): fix —
   check posture applicability before returning the cache in
   `readShellSandboxReadiness()`.
6. `lintStagedBatching.test.mjs:13` (P1, test time box): fix — remove the
   checked-in 20 s timeout.
7. `CHANGELOG.md:35` (P1, healthy sandbox path): measure — run the exact
   corrected probe live on this rig plus unit cover of the exit-0 parse;
   record what a blocked rig can and cannot prove.
8. `conversationController.ts:6684` (P2, flag before acceptance): fix —
   set `hasToldModelSandboxCannotStart` only after an accepted submission
   (same ordering in `AcpSession.sandboxModelNote()`).
9. `acp/agent.ts:1734` (P1, ACP notice routing): fix — send the
   `notice` update where the client advertises `session.notices`, keeping
   the `_meta`-marked chunk only as the fallback the schema prescribes.
   (Thread 8's `sandboxModelNote()` ordering is fixed with item 8.)

## Fixes

1. bwrap PATH (`0ecaeaa0c2`): `probeLinuxSandboxShell(workspaceRoot?)`
   resolves `bwrap` with `resolveExecutable` (absolute PATH entries only)
   and refuses unresolved/workspace candidates as `bwrapFailed` without
   spawning; the backend manager passes its workspace root. Regression:
   `sandbox.test.ts` refuses the machine's own bwrap with its own folder
   as the workspace (no fakes). Live: `/usr/bin/bwrap --ro-bind / /
--unshare-user -- /bin/true` on this rig → exit 1 with the namespace
   marker, through the new resolver (the committed probe test ran it).
2. Resumed sessions (`e499e6df2e`): `noteShellSandbox()` now runs on the
   `adopt()` path (History resume, fork, import) and in
   `resumeAfterRestart()`, after the current-opening check; the new-session
   path is unchanged (direct `attach`, never `adopt`), so nothing notifies
   twice.
3. Voice proxy (`e499e6df2e`): `voiceNetworkRefusal()` takes the live
   support settings — a marker-`routed` socket with `proxySupport` off or
   `webSocketAdditionalSupport` off refuses a set proxy. `extension.ts`
   reads all three via `readVoiceNetworkPosture()` and rebuilds on any of
   the three settings changing. Regression: `voiceNetwork.test.ts` (8).
4. Consent fixtures (`0f1898e823`): the two unwired-helper describes and
   their invented fixtures are deleted (188 lines); the file keeps only
   the four reachable production-surface refusal tests through the real
   `ScheduleSurface`.
5. Stale cache (`0ecaeaa0c2`): both `shellSandboxReadiness()` and
   `readShellSandboxReadiness()` check posture applicability before the
   cache, so sandbox-off reads as not checked even when an earlier run
   populated it.
6. Test time box (`0ecaeaa0c2`): the 20 s `BATCHING_TIMEOUT_MS` is gone;
   the repository's own timeout applies.
7. Healthy sandbox path (measured here): the exact corrected probe args
   run live above (exit 1, namespace marker — the blocked path, scenarios
   1–3); the exit-0 success parse is unit-covered (`reads a started user
namespace as a sandbox that can start`). A live success run needs a
   machine where user namespaces work, which this rig is not — that gap
   is recorded, not claimed.
8. Model-note ordering (`e499e6df2e`): the told-flag flips only after an
   accepted submission, in `conversationController` (after `runResuming`
   resolves, beside `checkpoints.accepted`) and in `AcpSession` (on
   `isAccepted`); a failed or cancelled first send retells on the next
   turn.
9. ACP notices (`e499e6df2e`): `noteSandboxCannotStart()` sends
   `sessionUpdate: 'notice'` (warning) where the client advertises
   `session.notices`, keeping the `_meta`-marked chunk as the fallback the
   schema prescribes for clients that do not. Both shapes come from the
   vendored `@agentclientprotocol/sdk` schema (`Notice`,
   `ClientSessionCapabilities::notices`).
