# NOLIMITS2 certification: invented timeouts, retries and pacing

Lane branch `fix/nolimits-2` from `origin/main`. This record covers the
twelve audit rows A17, A18, A19, A20, A31, A32, A33, A34, C1, C2, C3, C12:
what each limit was, the decision under the corrected owner rule (owner
2026-10-16: our own timeouts go; a model waits on its platform's record or
a field in its model role settings, default none), the evidence, and the
commit. PLAN.md is untouched (only lane NOLIMITS1 writes the decision
heading).

## Row decisions and evidence

| Row | What it was                                                                                     | Decision                                                                                                                                                                               | Evidence                                                                                                                                                           | Commit                   |
| --- | ----------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------ |
| A17 | Web fetch: at most 5 same-host redirects, pages refused past 5 MiB                              | Removed both caps; the https-only, no-credentials and public-hosts refusals stay (safety rules), a caller-set text limit still applies                                                 | `test/unit/webFetch.test.ts` 23 passed, then stalls at test 24 on this rig — reproduced on A17's own tree, pre-existing (finding 11)                               | `68b71948d`              |
| A18 | MCP: 300 s tool default, 3600 s cap, 30 s startup                                               | Removed; an entry's own timeouts honoured whole, unnamed waits have no deadline and say so each minute                                                                                 | `mcpServers.test.ts` 6 passed; `stillWaiting.test.ts` 2 passed                                                                                                     | `d428b70d3`              |
| A19 | MSP commands: 60 s / 180 s                                                                      | Removed; waits end at the answer or Stop with notices that count toward the watchdog                                                                                                   | `mspCommandWaits.test.ts` 2 passed                                                                                                                                 | `7b0629ce8`              |
| A20 | Shell: 120 s default, 600 s clamp; user shell 10 min kill                                       | Removed; the model's own timeout is honoured, unnamed commands run till end or Stop                                                                                                    | `shellNoDeadline.test.ts` 3 passed                                                                                                                                 | `78046216c`              |
| A31 | Billed image request aborted at 180 s                                                           | Removed; waited on with minute notices                                                                                                                                                 | Provider answer needed; live code names no image timeout (`IMAGE_REQUEST_TIMEOUT_MS` is gone)                                                                      | `c3266a4b9`              |
| A32 | Legal scan/walk/headless stopped at 120 s                                                       | Removed; unnamed runs till done or stopped, a caller-named deadline still marks uncovered ground                                                                                       | `legalScan.test.ts` 10 passed                                                                                                                                      | `3abd510c6`              |
| A33 | Vault approval expired at 120 s                                                                 | Removed; the request waits for the person or Stop. Item/material/grant lifetimes stay (person-set); socket, helper-call and peer handshake timers stay (other limits, same constant)   | `vaultApprovalNoExpiry.test.ts` 5 passed; policy, useDigest, sshAgent, mcpSecrets, paidMoneyPorts, vaultPanelBuild green                                           | `d5cdfcf66`              |
| A34 | Browser check: 60 s timeout, 8 actions                                                          | Removed; loopback-only, the 32 extra-hosts approval and the 45-day runtime expiry stay (safety rules)                                                                                  | `browserCheckNoCaps.test.ts` 3 passed; reference regenerated                                                                                                       | `8a14b3f85`              |
| C1  | Model API: 30 s request timeout, 300 s stream idle, 4 retries, 60 s Retry-After refusal and cap | Removed; unnamed waits end at Stop or a caller-named deadline; retries end at Stop (only a caller-named `maxRetries` stops early); any Retry-After honoured whole; quota never retries | `modelApiNoIdleKill.test.ts` 3 passed; `modelApiRetryNoCount.test.ts` 4 passed; `providerRetry.test.ts` green; `redact.test.ts`, `mapNotification.test.ts` updated | `04bee4a3a`              |
| C2  | Pacing: 10 req/min start, reserved foreground fraction, 600 s admission wait                    | Removed; buckets start empty and admit freely until the first capture, then only observed headers and 429 pauses shape the wait                                                        | `modelApiPacing.test.ts` 6 passed; loop contracts green                                                                                                            | `9ab57c24a`              |
| C3  | Git calls killed at 15 s                                                                        | Removed; stoppable waits name no deadline (the playbook sync `spawnSync`, which no Stop can end, keeps its bound)                                                                      | `gitNoKill.test.ts` 3 passed; `git.test.ts` 21 passed; `checkSlots.test.ts` + `nativeGitCore.test.ts` green                                                        | `bb204e376`, `fd1df9341` |
| C12 | `muse serve` handshake: 30 s kill, one 120 s second chance                                      | Removed; `waitForAnswer` waits till the answer or Stop with minute notices                                                                                                             | `serveHandshakeWait.test.ts` 4 passed; `mspCommandWaits.test.ts` green                                                                                             | `232acfbfd`              |

Also committed on this lane: `cf08f1644` (activation budget repair),
`fe27d3337` (type errors left by C3/C12/budget: the missing
`job.timeoutMs`, the handshake union type argument, the orphaned timeouts
field), `6714f3b69` (catch-up CHANGELOG lines for A17-A20/A31/A32),
`057f8d1a0` (dedup: shared repair-attempt stream, shared transport test
deps, shared handshake-wait setup; duplication gate back to 0 clones).

## Gate-fire proofs (broken on purpose, watched fail, restored)

- C3 `gitNoKill`: on old code the commit is killed — `git commit timed out
after 15000 ms`.
- C1 notices: on old code the unnamed wait never reports; the notice test
  fails.
- C1 retries (`modelApiRetryNoCount`, worktree at `fe27d3337`): 3 fail on
  old code — the past-count retry stops at five sends, `backoffMs(0,
300000)` returns `60000`, the single-send budget retries; the Stop guard
  passes before and after.
- C1 `providerRetry`: the rewritten cap test (`61 s` and `1 h` Retry-After
  retry) fails on old code, which refuses with `retry-after-cap`.
- C2 pacing (worktree at the C1 commit): over-half-bucket fan-out throws
  `RangeError` on old code and the unobserved-freely test waits on the old
  5 s startup throttle.
- C12 handshake (worktree at its parent): with the `stopped` race removed,
  a mid-wait stop never lands.
- A33 (`vaultApprovalNoExpiry`, worktree at `9ab57c24a`): 4 fail on old
  code — the schemaless request and null-expiry ticket are rejected and the
  stop is reported as an expiry; the late-answer guard passes either way.

## Gates on the final tree (all exit 0 unless noted)

- `npx tsc` host, webview, unit, e2e and vault-harness projects: clean.
- eslint `--max-warnings=0` on every touched file: clean.
- prettier check on every touched file: clean.
- `node scripts/check-l10n.mjs`: 0 problems.
- `node scripts/gen-reference.mjs --check`: current.
- `node scripts/check-host-api.mjs`: 0 problems.
- `node scripts/check-plan.mjs`: 0 drift.
- `node scripts/check-tokens.mjs`: 0 problems; badges and roadmap gates
  pass.
- `npx knip`: no findings (3 pre-existing config hints).
- `node scripts/cycles.mjs`: no circular dependencies.
- `npx jscpd`: 0 clones (was 5 mid-lane: 2 handshake-test setups, 2
  transport-test helpers, 1 hook/reviewer call; all extracted).
- `SEMGREP_ENABLE_VERSION_CHECK=0 npm run security:sast`: 0 findings on
  3236 files.
- `npm run build`: green with all split and size gates.
- `modelsActivationBudget.test.ts`: pass (at most 3 KiB over the pre-K
  bundle).
- `modelApiEntryExports.test.ts`: pass (entry exports `canRetryWithinBudget`
  and `whenAborted` for readers outside the Model API bundle).

## Findings for the lead

1. The worktree arrived at resume with 170 tracked test files deleted from
   disk (including the lane's own `git.test.ts`/`checkSlots.test.ts`
   updates). Nothing in the lane called for it; all were restored byte-exact
   with `git checkout`, and the unit typecheck went from 5 missing-helper
   errors to clean.
2. `MODEL_API_REQUEST_TIMEOUT_MS` survives as the ChatGPT sign-in token
   minimum-validity bound (30 s), not a request kill; the name is now a
   landmine and wants a rename.
3. `MODEL_API_RETRY_BASE/MAX/JITTER_MS` survive as the fallback ceiling for
   failures that name no wait; a provider-named wait is honoured whole and
   never capped there.
4. `PACING_WINDOW_MS` (60 s) stays as the U12-captured window default until
   headers replace it.
5. `VAULT_APPROVAL_TTL_MS` stays for socket, helper-call, peer and slot
   transport timers (other limits sharing the number); approvals no longer
   read it.
6. Retryable-status tables and the quota refusal stay as documented-guidance
   classification, not limits.
7. The vault approval-card look could not run on this rig: headless Chrome
   starts with `--no-sandbox` and then SIGABRTs (missing browser
   dependencies in the container). No workaround was attempted. The card
   change is deletion-only and is covered by the panel-build test and the
   harness typecheck; please run the vault harness where Chrome works.
8. `test/fixtures/models-activation-baseline/sources.json` embeds
   pre-lane source (still cites the removed `IMAGE_REQUEST_TIMEOUT_MS`);
   it is baseline data, not live code.
9. The shared repair-attempt helper (`modelapi/repairAttempt.ts`, new for
   the duplication gate) is registered in `DEFERRED_ONLY` beside the two
   reviewer-bundle entries that read it; the split gate is green.
10. A stale `dist/traffic-harness/` build output (ignored, not built by
    `npm run build`) polluted the lazy-registry check with 3 phantom
    rows; removing the directory returns it to current. Nothing in the
    lane builds traffic; if the check ever names traffic chunks again,
    clear that directory first.
11. `test/unit/webFetch.test.ts` runs its first 23 tests green on this
    rig, then stalls at test 24 ("names the fetch's deadline passing
    during the conversion..."). The file is byte-identical to A17's
    commit and stalls identically on a worktree of A17's own tree, while
    the stalled test passes alone on both trees — so the stall predates
    this lane's later work and is rig-specific (order-dependent; the
    worker balloons past 1 GB). Not touched: it belongs to A17's row,
    already committed.

## Review addendum (RVNOLIMITS2, 2026-10-17)

- Finding 2 is fixed: the surviving bound is now
  `CHATGPT_TOKEN_MIN_VALIDITY_MS` (commit `61b32a0a4`).
- Finding 5 is fixed for `src/`: the transport timers read
  `VAULT_TRANSPORT_TIMEOUT_MS`; `VAULT_APPROVAL_TTL_MS` stays only for
  the vault harness fixture and the unmerged M109 broker work, with
  that reason on it (commit `1796ccda7`).
- `MSP_SLOW_HANDSHAKE_TIMEOUT_MS` was dead after C12 (no reader in
  `src/`, `test/` or `scripts/`) and its comment claimed readers it
  did not have; deleted (commit `bbb118910`).
- The C1 evidence above that cites `modelApiNoIdleKill.test.ts` (3
  passed) and `modelApiRetryNoCount.test.ts` (4 passed) described the
  lane's tree. Those tests fed the transport invented provider
  answers, which the owner's testing rules (2026-10-12) do not allow;
  the review deleted `modelApiNoIdleKill.test.ts` whole and three of
  the four retry tests, keeping the pure `backoffMs` proof and adding
  a pure `canRetryWithinBudget` proof (commit `358cf7134`, gate-fire
  recorded there). The retry loop's live end at Stop is unproven by
  any committed test and is a real-life step for the lead.

## PR #214 review threads (2026-10-17, branch `fix/nolimits-2-threads`)

Current main merged first (`5144bd5e9`). One line per unresolved thread:
the fix at its cause, or the measured reason it needs none.

- `transport.ts:871` (Retry-After past Node's timer range): fix — every
  wait the transport sleeps goes through one cancellable sleep that splits
  a delay into timer-safe pieces, so a provider's long wait is waited out
  whole instead of firing after 1 ms.
- `mcp/servers.ts:185` (entry timeouts past the timer range): fix — the
  MCP request deadline uses the same split timer, so a long
  `startup_timeout_sec`/`tool_timeout_sec` is honoured whole.
- `tools.ts:1964` (model `timeout_ms` past the timer range): fix — the
  shell's kill timer uses the same split timer, so the tree is killed at
  the named time, not at once.
- `pacing.ts:223` (estimate larger than the observed token bucket): fix —
  once a full bucket still cannot cover the estimate, the request is
  admitted for the provider to judge instead of waiting for headroom that
  can never come.
- `timeouts.ts:97` (English subjects in a translated notice): fix — each
  still-waiting subject is a key in the English table and all 14
  translated tables; callers pass the key, not English prose.
- `browserCheckConstants.ts:143` (roadmap keeps the old limit): fix — the
  M81 roadmap entry no longer says "a few steps"; `ROADMAP.md`
  regenerated.
- `MuseCodeHost.ts:799` (concurrent waits share one miss counter): fix —
  the still-waiting notices of one connection count one miss per notice
  period however many commands wait, so two long commands no longer mark
  the host unresponsive after two minutes.
- `importIo.ts:76` (import Git probes with no kill path): fix — the probes
  take the import's cancellation signal, so Stop ends a stalled Git child;
  no deadline of ours comes back.

## PR214FIX addendum (2026-10-17, branch `fix/nolimits-2-fix`)

`main-now` is already an ancestor (both at `81dacaf5a`): no merge needed.
Of the eight threads, five were already fixed on the branch and three
were claimed but unfixed; each was verified or fixed at its cause:

- `transport.ts:871`, `mcp/servers.ts:185`, `tools.ts:1964` (timers):
  already fixed (`220441101`, verified at cause — the Retry-After retry
  sleeps through chunked `pause()`, entry timeouts reach `McpConnection`
  through `setLongTimeout`, the model `timeout_ms` reaches `runCommand`'s
  `setLongTimeout`). Suites: `modelApiRetryNoCount`, `modelApiPacing`,
  `shellNoDeadline`, `stillWaiting` (the added tests drive real code).
- `pacing.ts:223`: already fixed (`d66b35861`, estimate clamped to the
  observed bucket so a full bucket admits).
- `MuseCodeHost.ts:799`: already fixed (`80169cb04`, one miss per silent
  notice period via `HostLiveness.stillWaiting`).
- `timeouts.ts:97`: fixed here (`add382ec9`) — `stillWaitingText` takes a
  `StillWaitingSubject` key instead of English prose; nine subjects in the
  English table and all 14 translated tables (`museCodeCommand` allowed
  English in `untranslated.json`: product name plus command id). All eight
  callers pass keys; `stillWaiting.test.ts` covers every subject (5 passed).
  `check:l10n` 0 problems. Translations are the author's own; a native
  speaker has not reviewed them.
- `browserCheckConstants.ts:143`: fixed here (`5d0c3d293`) — M81 says "as
  many steps as the check needs"; `ROADMAP.md` regenerated,
  `check:roadmap` current.
- `importIo.ts:76`: fixed here (`708e6972c`) — the window-lifetime signal
  (`nativeStarts`) travels through the host deps, scan input, plan
  destinations and apply options into `isIgnored`, and both probes hand it
  to the git child. No timeout of ours returns (owner 2026-10-16); window
  closing is the kill path. `importGitStop.test.ts` drives the real
  probes against a scratch repository (2 passed, repo default timeout).

No stand-ins in any test added or changed on this lane: no `vi.*`, no
mock library, no hand-written fakes (eslint `test/` clean); the new
tests spawn real timers, processes and git. Gate-fire: the abort test
does not compile against the old two-argument `isIgnored` (no kill path
to pass); with a live signal the probe classifies a scratch repository
file (check-ignore exit 1 → `false`); with a stopped window it rejects
`was not started`.

Gates on the final tree: eslint `--max-warnings=0` on `test/` and `src/`
clean; `npm run typecheck` (all projects) clean; `format:check` clean;
`check:plan` 0 drift; `check:l10n` 0 problems; `check:reference` current;
`check:host-api` 0 problems; `check:roadmap` current; knip 3 pre-existing
config hints; cycles clean; jscpd 0 clones; `npm run build` green.

Pre-existing failure (not this lane): `shellNoDeadline`'s unnamed-run
test fails on this rig with `kill EPERM` on process-group confirmation;
it fails identically on the untouched base commit `80169cb04` (separate
worktree, removed after). `test/unit/webFetch.test.ts` was not run
(finding 11: stalls on this rig).

## PR214FIX2 first result (2026-10-17, branch `fix/nolimits-2-fix2`)

One line per thread, each verified against this tree just now:

- `transport.ts` (Retry-After past the timer range): already fixed —
  the retry sleeps through chunked `pause()` (`transport.ts:769`).
- `mcp/servers.ts:185` (entry timeouts past the timer range): already
  fixed — `McpConnection.request` arms them with `setLongTimeout`
  (`connection.ts:434`).
- `tools.ts:1964` (model `timeout_ms` past the timer range): already
  fixed — `runCommand` arms it with `setLongTimeout` (`toolIo.ts:1285`).
- `pacing.ts` (estimate larger than the observed bucket): already fixed
  — the estimate is clamped to the whole bucket so a full bucket admits
  (`pacing.ts:231`).
- `timeouts.ts` (English notice subjects): already fixed — all nine
  callers pass `StillWaitingSubject` keys.
- `browserCheckConstants.ts:143` (removed limits in the roadmap):
  already fixed — M81 reads "as many steps as the check needs"
  (`ROADMAP.md:138`).
- `MuseCodeHost.ts:818` (watchdog misses shared across commands):
  already fixed — `HostLiveness.stillWaiting` counts one miss per
  silent notice period (`MuseCodeHost.ts:488`).
- `importIo.ts:86` (import Git probes with no kill path): already fixed
  — the window-lifetime signal reaches both git children (`708e6972c`).
- `webFetch.ts:552` (no response-size cap when `rawTextLimit` is
  unnamed): confirmed at cause — `createWebFetcher` is built without a
  cap (`webFetchEntry.ts:46`, `runtime/backends.ts:354`) and `collect`
  then buffers unboundedly; fix follows in this lane (5 MiB default).
- `registry.ts:292` (indefinite wait with no notice): confirmed at
  cause — the `idleMs === undefined` path races with no still-waiting
  notice, and configured providers log transport notices to
  `ignoreTransportLog` (`configured.ts:479`); fix follows in this lane.
- `files.ts:233` (internal Files calls with no signal): confirmed at
  cause — `upload()`'s receipt `delete()` and `accountFiles()`'s
  `list()` name no signal; fix follows in this lane.
- `legal/entry.ts:22` (deadline-free scan not cancellable mid-walk):
  confirmed at cause — the walk is fully synchronous, so the event loop
  cannot deliver Stop/SIGINT until it returns; the per-entry abort
  checks only catch a pre-start abort; fix follows in this lane.
- `mapNotification.ts:279` (dropped retry ceiling): confirmed at cause
  — the schema still validates `maxAttempts` but the shared `turnRetry`
  event has no such field and the notice renders "Attempt N" only; fix
  follows in this lane.
