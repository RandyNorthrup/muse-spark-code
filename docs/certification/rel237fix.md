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

(To be filled as each lands, with tests and gate receipts.)
