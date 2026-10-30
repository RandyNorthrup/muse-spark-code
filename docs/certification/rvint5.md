# RVINT5 — independent review of CC-INT1 and CC-INT2 (2026-10-30)

Grok review lane, worktree `/home/randy/lanes/RVINT5`, branch `rv/int5`, on the
test rig `linuxlt`. Started at int/recovery `b781451b94`. Model attempts: **0**.
Provider calls: **0**. Muse requests: **0**. Nothing was pushed, rebased,
stashed or tagged. Tests ran with the repository's own timeout and
`--maxWorkers=2`. No browser was started (no screen changed). The vault and
OS credential-store suites were not run.

## Findings

### P1 — a pack index could verify under the wrong signer or the wrong bytes

`src/runtime/node/packs/verify.ts` (before `b4f8821b70`). The rewrite off the
`sigstore` umbrella (`ecda3c843`, `docs/certification/cc-sigstore.md`) still
calls `@sigstore/tuf`, `@sigstore/verify` and `@sigstore/bundle` at the same
pins (`@sigstore/bundle` 5.0.0, `@sigstore/tuf` 5.0.0, `@sigstore/verify` 4.1.2).
Two policies the umbrella's own call shape depended on were not applied.

1. **Identity** (`packVerificationPolicy`, now lines 58–65). `@sigstore/verify`
   matches `subjectAlternativeName` with `String.prototype.match`. The raw
   workflow URI also matched a longer ref (`refs/heads/maintenance`,
   `refs/heads/main2`) and a dot matched any character. Failure: an index
   signed by a workflow on a branch whose name merely begins with `main`, or
   by a lookalike host, was accepted.
2. **Artifact bytes** (`readPackBundle`, now lines 76–95). `toSignedEntity`
   verifies a DSSE envelope over its own payload and never compares the
   artifact bytes. Pack CI signs with `cosign sign-blob` (a message
   signature). Failure: a signed statement that does not cover the index
   bytes was eligible to verify.

The fix anchors and escapes the identity, refuses anything that is not a
message signature as `unsupported-bundle` before the trust-root fetch, and
maps a parser `ValidationError` to `malformed-bundle` (also before TUF).
`verifyIndexBundle` (lines 104–128) still requires one transparency-log
entry, one certificate-transparency entry and one timestamp, and still
returns verified only after `verifier.verify` returns. A `VerificationError`
or `PolicyError` is `verified: false` with the library's code. Anything else
is rethrown. A `TypeError` from the fetch is `verified: false` / `network`
(the same mapping the rewrite already had; it is not a success).

Checked against the unpacked `sigstore@5.0.0` the old lock pinned
(`git show f3941b8548:package-lock.json`) and the library README's
`certificateIdentityURI` note. Not regressions: TUF mirror, cache, retry
`{retries: 2}` and timeout 5000 match the umbrella; the issuer compare is
exact; a tampered message signature fails inside the library; an expired
cached initial root stays valid during a TUF rotation, as the library
documents; public-key bundles have no SAN and fail the identity check.

Fix: `b4f8821b705117324b44549fa513bdd12fe740fc`.

Drill (`test/unit/nodePacksVerify.test.ts`, repository timeout,
`--maxWorkers=2`): the unanchored identity restored → exit **1** (a longer
ref was accepted); the DSSE branch returned `{ verified: true }` → exit **1**;
both restored → exit **0**.

### P2 — a spam hold was triaged again, and the command said the issue was closed

The watchdog code CC-INT2 kept (`cedb0bd20`, `docs/certification/cc-int2.md`
§2.5). `decideWatchdogIssue` set the local record to `closed` and returned
`closed: true` with `UI_TEXT.watchdog.refusal.spamHeld`, and did not call
`closeIssue`. `decideText` (`src/runtime/watchdog/command.ts:518`) prints
`Closed.` whenever `decision.closed`. The next poll's event was `reopened`
for every closed record whose GitHub issue was still open
(`nextWatchdogState('closed', 'reopened')` is `acknowledged`, and the poll
then clears findings). Failure: every poll paid for another triage of the
same spam, and `watchdog decide` told the person the issue was closed when
it was still open and nothing was posted.

`spamHoldResult` (`src/core/watchdog/decide.ts:96`) now returns `closed: false`
with the held sentence, and the record state stays `closed`.
`watchdogPollEvent` (`src/core/watchdog/poll.ts:113`) returns `polled` when
the outcome is `spam` and the issue is still open, so the findings stay. A
record closed because GitHub closed, then found open, is still `reopened`.
When GitHub later closes a held issue, the event stays `polled`.

Fix: `f7cd1c25d9d3211961d44030ad97e20db545009c`.

Drill (`test/unit/watchdogSteps.test.ts`, repository timeout,
`--maxWorkers=2`): `closed: true` restored → exit **1** (`closed` true against
false); only the poll line restored to `return 'reopened'` → exit **1**
(`reopened` against `polled`); both restored → exit **0** (7 tests).

## Reviewed and not a finding

- **Umbrella policies that still hold** on `verifyIndexBundle`: pinned issuer
  `https://token.actions.githubusercontent.com`, TUF defaults, thresholds of
  1, tampered message-signature refusal inside the library, unknown errors
  rethrown, no error path returning `verified: true`. No captured bundle for
  the pinned identity was verified against the live TUF mirror; the tests
  refuse before that fetch.
- **Trace-log caps removed by RLUSAGE** (`d77fd6143`, `src/runtime/usage/traceLogs.ts`).
  The old 8 MiB / 200-file skip hid the person's usage. The snapshot reads
  every byte and a failed read is a page notice (`unreadable` or `behind`),
  not an empty history. That matches D121. `REPORT_FACT_TIMEOUT_MS` (2 s) and
  `REPORT_SNAPSHOT_TIMEOUT_MS` (10 s) bound a hung diagnostic read and say
  unknown; they are not a cap on the person's work.
- **`usageFailureForLog`** (`c0e5e3f10`) joins two consecutive `instanceof Error`
  checks. The field-level rejection sentence stays.
- **Read and write usage warnings** (`src/core/usage/recording.ts:167` and
  `:175`) each have their own once-per-run flag and sentence (`usageNotRecorded`,
  `usageNotRead`). A failed read throws `Usage history unavailable` after the
  read sentence and does not spend the write warning.
- **Schedules binding tail** (`src/runtime/schedules/binding.ts:73`). Order is
  delivery, runtime delivery, migration, engine, pause-after-failures, signal,
  trust. The VS Code bridge (`src/host/schedules/schedulesBridge.ts:110`)
  passes `undefined` then the trust callback (`301c466bc`). The CLI
  (`src/runtime/main.ts:2478`) passes `stopController.signal` and omits trust.
  The lane's CLI call never passed trust; int's stop was kept. The ACP and
  MCP calls match both parents.
- **Move to…** (`src/core/team/teamHost.ts:1910`) still throws the running,
  settled, unknown-role and unstaffed sentences. The tree still lists queued,
  unmerged and interrupted workers (`src/webview/components/TeamTree.tsx:524`).
  Dropping the row `aria-label` is the lane's own choice: the row's name is
  its content, and the tree keeps `aria-label`.
- **Report kinds** (`test/unit/cx1r4Truth.test.ts`). `issues` joined the
  working set (fourteen, one dormant). The test still requires the live list
  to equal that set and to omit the dormant kind.
- **`compareVersions`** deleted by `a9c45d558`. Nothing in production called
  it. Not restored.
- **`AGENT_SCHEDULES_MAX_ACTIVE` (10) and `AGENT_SCHEDULE_MAX_DEPTH` (1)** are
  on both parents of the rlsched merge. Not added or removed here.
- **Close policy.** `decideWatchdogIssue` closes GitHub only for a non-needs-info
  reply when the policy is `onReply`. `applyVerification` sets `close` when
  the policy is not `never`, so `onFixRelease` closes only after the fix
  verifies. A failed or malformed verification is not verified.
- **RLUSAGE source 05** (`be8a0a4c5`), rechecked with `diff.renameLimit=8000`.
  Nothing under `src/` differs from int. The four `vi.mock` suites were
  already gone on int.
- **A11y contrast** (`src/webview/styles.css` at the selected-row rule). The
  merge adds `.icon-button` to the inherit-color selectors. No rule from int
  was removed.
- **CC-INT1, the named items.** The shell trailer
  (`src/core/backends/modelapi/tools.ts:1984`) and the playbook check trailer
  (`src/runtime/playbook/spawnCheck.ts:34`) still read `$?` before
  `$LASTEXITCODE`. `MAX_VSIX_BYTES` is `4800 * 1024` (4,915,200), the owner's
  measured-plus-15% figure (`scripts/check-vsix-size.mjs:11`). The governed-start
  routing was not re-run; `docs/certification/cc-int1.md` records the host-api
  recount, and this review found no later edit that puts the trailer back.

## Open

### P3 — a reporter who quotes the acknowledgement marker is not an answer

`isReporterAnswer` (`src/core/watchdog/poll.ts:129`) ignores any comment whose
body contains our marker. That is how our own posts are skipped. A reporter
who quotes the marker is skipped too. Stays open: tightening the match is a
parse change, and no live GitHub run has shown the quote. The hold fix does
not depend on it.

### P3 — a failed deferred schedule event is retried with no bound and no sentence

`src/runtime/schedules/engine.ts:524`. The `catch` pushes the event back and
does not report the error. The same catch is on both parents of `cedb0bd20`,
so the merge did not remove a limit. Stays open. Options: (a) leave it, the
next scan retries and a stop aborts the scan; (b) after an industry-standard
retry count, drop or park the event and say why. Recommendation: (a) until a
schedule lane owns it. This review did not add a cap.

### The GitHub network steps still have no unit proof

`test/unit/watchdogSteps.test.ts` calls the real poll event, acknowledgement
decision, citation matchers, findings parser, approval gate, spam hold and
verification with values we built. It does not stand in for GitHub. Listing,
posting, closing and the lock around those calls still need a live repository.
`docs/acp.md` still describes those steps. Options, as CC-INT2 §8: (a) a real
run the owner chooses; (b) restore the six stand-in suites. Recommendation:
(a). Do not trim the security text; trim `docs/acp.md` only if the release
ships before (a). This lane did not rewrite it.

## Proof

Every exit is the command's own, on this tree, after both fix commits.
`--maxWorkers=2`. No test timeout was raised.

| Command                                                                       | Exit | Result                                                                                                                                                                                                                                                               |
| ----------------------------------------------------------------------------- | ---- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `prettier --check` on the touched sources, tests and `CHANGELOG.md`           | 0    |                                                                                                                                                                                                                                                                      |
| `eslint --max-warnings 0` on the touched TypeScript                           | 0    |                                                                                                                                                                                                                                                                      |
| `npm run typecheck`                                                           | 0    | host, webview, unit, e2e, integration, faults                                                                                                                                                                                                                        |
| `node scripts/check-l10n.mjs`                                                 | 0    | 14 UI tables, 14 usage tables, 283 manifest strings, 2457 source files; 0 problems                                                                                                                                                                                   |
| `npm run check:reference`                                                     | 0    | 92 features, 68 commands, 110 settings, 33 slash, 359 CLI                                                                                                                                                                                                            |
| `npm run check:host-api`                                                      | 0    | 392 VS Code APIs, 57 files importing vscode, 30 Node built-ins; 0 problems                                                                                                                                                                                           |
| `npm run check:plan`                                                          | 0    | 241 milestones; 0 drift                                                                                                                                                                                                                                              |
| `npm run check:roadmap`                                                       | 0    | 241 entries; current                                                                                                                                                                                                                                                 |
| `npm run check:catches`                                                       | 0    | counts match the baseline; nothing rose                                                                                                                                                                                                                              |
| `npm run duplication`                                                         | 0    | 0 clones                                                                                                                                                                                                                                                             |
| `npm run cycles`                                                              | 0    | no circular dependency                                                                                                                                                                                                                                               |
| `npm run deadcode`                                                            | 0    | knip clean (configuration hints only)                                                                                                                                                                                                                                |
| `npm run build`                                                               | 0    | every budget holds. Tight: `dist/uiText.js` 124.9 of 125 KiB, `dist/wire.js` 74.8 of 75, `dist/validation.js` 49.8 of 50, `dist/modelApi.js` 522.4 of 525, `dist/acpWatchdog.js` 69.6 of 75, webview surface English 23.4 of 25. No budget was raised                |
| `npm run security:audit`                                                      | 0    | 7 advisories, 0 exceptions. CC-INT2 recorded 6; the lockfile is unchanged by this lane, and the script still exits 0                                                                                                                                                 |
| `SEMGREP_ENABLE_VERSION_CHECK=0 npm run security:sast`                        | 1    | 688 rules, 5209 files, 6 blocking findings: `os/build.py`, `os/pi/compose.py` (two), `scripts/build-packs.mjs`, `src/core/backends/modelapi/mcp/headers.ts`, `src/runtime/node/keyStore.ts`. The same six CC-INT1 recorded. None of those files changed in this lane |
| `npx vitest related --run` on `verify.ts`, `decide.ts`, `guard.ts`, `poll.ts` | 0    | `nodePacksVerify` (3), `watchdogSteps` (7), `watchdogSurface` (3)                                                                                                                                                                                                    |

The two fix drills are in the findings above. Both suites were green on the final tree inside the related run.
