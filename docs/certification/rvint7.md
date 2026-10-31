# RVINT7 — independent review of merge round CC-INT7 (2026-10-31)

Grok review lane, worktree `/Users/randy/lanes/RVINT7`, branch `rv/int7`, on
the test rig `macmini`. Started at `cc/int7` `4e6a7140c` (CC-INT7, on
int/recovery `0a5ebd7189`; record `docs/certification/cc-int7.md`). Reviewed
the fifteen `fix(int):` commits and the conflict resolutions in the ten
merge commits (`git log --first-parent 0a5ebd7189..4e6a7140c`). No product
code changed. Model attempts: **0**. Provider calls: **0**. Muse requests:
**0** (the allowance is out until 2026-11-02T00:00:00Z). Nothing was pushed,
rebased, stashed or tagged. No credential was read. Tests used the
repository's own timeout and `--maxWorkers=2`. The vault suites and the OS
credential-store suites were not run.

## Findings

None. No P1, P2 or P3. Nothing in the round silently dropped a behaviour,
contradicted a PLAN.md §2 decision, made a refusal silent, added a limit of
ours, or removed a safety limit. D240–D243 are the renumbered decisions;
`D217` does not appear under `src/` (it remains the judge fast path's `stat`
heading and the numbering notes).

## What was checked

### The fix commits and the conflict resolutions

For each security-bearing file, the merge result was compared with the lane
tip. Differences that are not a D-number comment are these, and each is the
resolution CC-INT7 describes:

- `src/core/git/github.ts:594` keeps both `PATCH` (int) and `DELETE` (the
  gist lane). The only lane line not copied verbatim is the narrower
  `'GET' | 'POST' | 'DELETE'` union.
- `src/core/providers/subscriptions/chatgpt.ts` still checks
  `isSameOriginRequest` (`641`) and `oidcClaimsSchema` (`321`). The merge
  diff is the rename to `CHATGPT_ORIGIN` / `CHATGPT_ISSUER`.
- `src/host/vault/migrateCredentials.ts` keeps int's stronger ChatGPT probe:
  the slot is taken when SecretStorage holds it or the vault journal row
  exists (`403–428`). The undo methods stay (`635–679`).
- `src/host/vault/vaultMigrationBundle.ts:32` leaves `shell` optional, so
  the palette undo (`src/host/vscode/vault/vaultPanelEntry.ts:440`) binds
  no shell and the panel binding (`344`) still passes its own.
- `test/unit/modelApiRetryNoCount.test.ts` expects the unnamed backoff at
  attempt 10 to be `8000` (D228's 8 s ceiling). That replaces the lane's
  unbounded `1000 * 2**10` assertion. The safety limit stays.
- `src/runtime/providersCommands.ts:1133–1135` still calls
  `noteKeyRejectedStatus` on a failed probe. `src/runtime/keyStore.ts:99–104`
  forgets the entry only for HTTP 401 and 403.
- `test/e2e/team.live.e2e.test.ts` no longer forces
  `OPTIONAL_RUNTIME_AVAILABILITY.team`. That latch left with D227. The
  contributor guard in `test/e2e/liveCli.ts:37–57` is still what a live
  drill calls.
- `test/unit/runtimeLsp.test.ts` builds its environment with
  `isolatedRuntimeEnvironment`, which spreads `withoutCredentials`
  (`test/unit/helpers/isolatedRuntimeEnvironment.ts:7–9`).

`src/host/auth/cliAccount.ts` is identical to the maccred lane tip. The
no-follow read is `readCredentialFile` (`65–84`): lstat first, a symlink or
non-file is `unrecognized`, `O_NOFOLLOW` where the flag exists, then the
descriptor's identity must be that same file.

### Connector revoke (`2c5e19e4b`) and the pinned issuer

`ConnectorOAuth.reconcile` (`src/runtime/connector/oauth/server.ts:196–201`)
refreshes the authority from disk, then `rebind`s to the live generation.
`liveGrant` (`115–117`) treats a missing or `revoked` grant as no grant.
`verifyAccessToken` (`560–574`) does that refresh and returns undefined
before `AccessToken.find` when there is no live grant, so a stored token
is not enough. `handle` (`500`) reconciles before every OAuth route,
including the token endpoint. `getResourceServerInfo` (`264–268`) throws
`AccessDenied` when there is no live grant, so a refresh does not mint
another access token. `rebind` (`src/runtime/connector/oauth/records.ts:319–328`)
deletes non-client records when the generation changed, or when it is
undefined and a sign-in is still stored. Clients stay.

MCP requests go through `verifyAccessToken` before dispatch
(`src/runtime/connector/http.ts:174–177`). The registry refreshes again
before admission (`src/core/connector/registry.ts:375`), before a read
starts (`457`), before a result is delivered (`1032`), and as the last
wait before an approved write (`791`). `admit` refuses a revoked grant
(`src/core/connector/policy.ts:47`). A write that has already passed that
gate is the same window the connector had before this round: revocation
before the gate leaves no write.

`pinIssuer` (`server.ts:451–468`) still sets `Host` to the configured
issuer and drops or rewrites `x-forwarded-host`, `x-forwarded-proto`,
`x-forwarded-port` and `forwarded`. That is RVNET `a02ebf146`, and the
lane's additions to `oauth/server.ts` are all in the merge.

A request that starts after `mcp revoke` has been written is refused.
This lane re-ran `connectorRemote` (13, including "ends every sign-in when
the connection grant is revoked") and `connectorRemoteIssuer` (3) with
`TMPDIR` inside the worktree: **16 passed, exit 0**.

Not reproduced, and not filed: two `authority.refresh` calls
(`src/runtime/connector/store.ts:228–236`) can be in flight together, and
the one that started later wins even if its read observed older bytes.
A single refresh that starts after the revoke file is in place reads the
revoked grant. The suite's revoke case is that case.

### Vault and credential merges

`finishUndo` (`src/core/vault/migrate/migrate.ts:549–592`) journals
`pending` before the legacy write and `written` only after that write is
read back. A different legacy copy is `conflict` and is not overwritten.
`written` with the copy gone is not written again.

The feeder still checks `response.ticketId !== approval.ticket.id`
(`src/runtime/vault/vaultExecEntry.ts:191`) and the host still delegates
each ticket to that feeder's pid, start time and envelope digest before
the envelope is sent (`src/runtime/vault/vaultExecHost.ts:103–119`).
`connectVerified` (`src/core/vault/broker/client.ts:69–112`) still verifies
the socket or the Windows pipe, matches the lock's process on POSIX, and
lets the caller choose whether to send `hello`. Those files differ from
the M109 lane tip only by D243 comments. M109's own design was not
re-reviewed.

`cliCredentialFile` (6) passed. The vault suites were not run.

### Approvals, the contributor guard, the fork guard, the private root

`persistenceOutcome` (`src/core/backends/musecode/MuseCodeHost.ts:2022–2055`)
returns the fault as applied only when `stageAdvanced` is true (local stage
move, closed, or `approval/listPending` no longer names the stage). It
waits for stage news (`2076`, `2092`) and, if the stage still waits,
unmarks it and returns `DecisionNotAppliedError`. An unknown pending check
stays decided and returns the error. `museCodeApprovalPersistence` (2)
passed. The suite passes its settle window after the wires argument
(`eb12f3a56`). `MuseCodeHost.ts` is identical to the approvals lane tip.

The fork bounds are `RESOURCE_TREE_PROCESS_CAP = 512`,
`RESOURCE_TREE_SPAWN_CAP = 16_384` and
`RESOURCE_TREE_SPAWN_WINDOW_MS = 15_000`
(`src/shared/constants.ts:11211–11213`). `forkWordsFor`
(`src/runtime/supervise/supervisor.ts:135–153`) cites those constants in
`forkStoppedProcesses` and `forkStoppedSpawns`
(`src/shared/l10n/en.ts:8838–8841`). POSIX `forkWords` passes
`capRefusals` 0 (`supervisor.ts:254`) because the sampler stops the tree
rather than counting refused children; that zero is the govfork lane's,
not a merge drop. Windows sets `forkStop` only when `ending === 'spawnRate'`
(`src/core/resources/process.ts:129`) and counts active-process refusals
separately. The 521-process flood was not re-run here.

`runSupervise` and `runStop` both say `recordsFolderNotPrivate` on
`PrivateRootRefused` and `endpointPathTooLong` on `SuperviseEndpointError`
(`src/runtime/supervise/superviseEntry.ts:66–72` and `97–104`; sentences at
`en.ts:8848–8851`). `superviseRefusal` (2) passed. `superviseEntry.ts` is
identical to the lspbus lane tip.

## Tests this lane ran

Repository timeout, `--maxWorkers=2`. Connector data folders used
`TMPDIR` set to this worktree's `temp/` (macOS's default temporary folder
is not a private connector root; the guard is doing its job).

| Suites                                                   | Exit | Result    |
| -------------------------------------------------------- | ---- | --------- |
| `connectorRemote`, `connectorRemoteIssuer`               | 0    | 16 passed |
| `gistShare`, `githubGist`, `museCodeApprovalPersistence` | 0    | 29 passed |
| `superviseRefusal`, `cliCredentialFile`                  | 0    | 8 passed  |

Not run, on purpose: `test/unit/vault/**`, `keyringParts`, `keystoreOwner`,
`credentialLease`, `providerHeadersStore`, the whole suite, the 521-process
flood, and any live or paid drill.

## Drill

No red/green drill. No product code changed, so nothing was broken on
purpose.

## Gates

On `1921c62db` plus this record. No source file changed, so
`npx vitest related` had no target. ESLint was pointed at the two markdown
files and exited 1 because both are ignored (2 warnings, 0 errors); no JS
or TS file was touched.

| Command                                                                                | Exit | Result                                                                                                                                                                                                                                                               |
| -------------------------------------------------------------------------------------- | ---- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `prettier --check` on `PLAN.md` and this record                                        | 0    | formatted                                                                                                                                                                                                                                                            |
| `eslint --max-warnings 0` on those two files                                           | 1    | ignored-file warnings only; 0 errors                                                                                                                                                                                                                                 |
| `npm run typecheck`                                                                    | 0    | all six projects                                                                                                                                                                                                                                                     |
| `node scripts/check-l10n.mjs`                                                          | 0    | 0 problems                                                                                                                                                                                                                                                           |
| `npm run check:reference`                                                              | 0    | current                                                                                                                                                                                                                                                              |
| `npm run check:host-api`                                                               | 0    | 0 problems                                                                                                                                                                                                                                                           |
| `npm run check:plan`                                                                   | 0    | 247 milestones; 0 drift                                                                                                                                                                                                                                              |
| `npm run check:roadmap`                                                                | 0    | 247 entries; current                                                                                                                                                                                                                                                 |
| `npm run check:catches`                                                                | 0    | matches the baseline                                                                                                                                                                                                                                                 |
| `npm run duplication`                                                                  | 0    | 0 clones                                                                                                                                                                                                                                                             |
| `npm run cycles`                                                                       | 0    | none                                                                                                                                                                                                                                                                 |
| `npm run deadcode`                                                                     | 0    | knip clean (5 configuration hints, 6 `@unwired` tag hints, the same set CC-INT7 named)                                                                                                                                                                               |
| `npm run build`                                                                        | 1    | the base's four rows over, budgets not raised: `dist/teamRunners.js` 78.4/75, `dist/teamHost.js` 140.2/130, `dist/teamScheduler.js` 76.5/75, `dist/uiText.js` 126.2/125. Same rows CC-INT7 measured. This lane changed no bundle.                                    |
| `npm run security:audit`                                                               | 1    | 9 advisories, 0 exceptions; high `follow-redirects` GHSA-mrwp-f3q8-3g9p. CC-INT7 recorded the same high on the untouched base.                                                                                                                                       |
| `SSL_CERT_FILE=/etc/ssl/cert.pem SEMGREP_ENABLE_VERSION_CHECK=0 npm run security:sast` | 1    | 688 rules, 5302 files, 6 blocking findings: `os/build.py`, `os/pi/compose.py` (two), `scripts/build-packs.mjs`, `src/core/backends/modelapi/mcp/headers.ts`, `src/runtime/node/keyStore.ts`. The same six CC-INT7 named. None is a file this round's merges changed. |
