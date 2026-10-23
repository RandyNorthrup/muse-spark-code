# RVINT1 — independent review of the first integration round (2026-10-22, linuxlt)

Review lane with fix rights. Reviewed range: `f3941b8548..397aca3ddb`
(main at 0.19.0 plus the 15 first-parent lane merges into
`int/recovery` and their 20 `fix(int):`/`docs(int):` follow-ups). No
work was merged by this lane; it read every merge adversarially and
fixed what was wrong. Audit scripts live in `temp/rvint1/` (not
committed): `merge_audit.py` (lane-only/int-only file survival),
`both_audit.py` (both-changed files whose result equals one parent),
`union_audit.py` (en.ts keys, PLAN decisions, feature-catalog ids,
[Unreleased] bullets), `line_audit.py` (added-line survival in
both-changed source files).

## Method

For each of the 15 merges: `git show --remerge-diff` on every
conflicted file; lane-tip (second parent) and int-parent blobs
compared against the merge result file by file; generated files
(ROADMAP, host-api, reference, catch baseline, lazy registry) checked
by their own gates on the final tree instead of by eye. Every
`fix(int):` commit read in full diff. The three named judgement calls
inspected in code. Known RLINTFIX-owned failures were not touched.

## Findings fixed

### 1. RLTESTDRIVE's [Unreleased] changelog entries were dropped wholesale (fixed, 374e04452b)

Merge `9743a3dd37` says "CHANGELOG.md (both sides' [Unreleased]
entries kept)", but the merge blob equals the int parent's blob
exactly: all 13 bullets the lane added (agent status, Anthropic count
body, exec ready line, exec subagent-tools statement, providers
refresh, panel key locations, auth agreement, effort default,
hand-off wait, recording cleanup, schedules report, CI lookup paging,
vault findable) were absent at `397aca3ddb`. The code each bullet
describes is present (lane commits are ancestors; markers verified
per bullet, e.g. `modelApiReadyMessage`
[src/host/backend/modelApiBackendManager.ts:303], `providers refresh`
at [src/runtime/cliArgs.ts:868], vault palette commands in
package.json). Restored verbatim into the current sections.

Drill: `union_audit.py` over `9743a3dd37` reported the 13 bullets
missing from the merge result and from HEAD (the red); after the
restore, a whitespace-normalised presence check over the lane tip's
bullets reports 0 missing, and `npm run check:roadmap` exits 0 (the
green). `changelogVersion`, `whatsNewContent`, `whatsNewVersions`
suites pass (below).

### 2. execTeamSweep's governed git could not start on Linux (fixed, 0e322c472e)

Merge `b07d528678` rerouted the suite from RLM96B's plain `execFile`
git (`src/host/team/teamEnginePorts.ts` at `43b02f0478`) to RLM96's
governed contained git (`processTeamGit` in
[src/core/team/workers/workerOps.ts:594]), and `8098e00430`
configured the governor for the suite — but without the
`createdDirectories` fixture wiring the resource suites carry. The
governor's default native root spells `dist/../native`
([src/core/resources/resourceGovernorEntry.ts:211]), which from source
reads `src/core/native`, so on Linux every contained launch failed
`ENOENT .../src/core/native/linux/x64/muse-created` (measured by a
probe call to `execResourceFileBytes('contained', 'git', ...)`),
`deleteOwnedRef` threw, and the dead run landed in `failed[]` instead
of swept. Windows could not show it: the Windows created-path proof
loads through PowerShell, never that path. The suite now builds the
helper into its jobs root and passes `createdPathCommands` plus a
fixture `registryFile`, exactly as `resourceHandoffDeadline` and
`resourceCreatedSweep` do, and teardown settles
`flushResourceHistory()` before removing the registry's root
(disposal flushes asynchronously, [src/core/resources/admission.ts:122]).

Drill: before, `npx vitest run test/unit/execTeamSweep.test.ts` exit 1
(dead folder in `failed`, contained git ENOENT measured); after,
exit 0 (1/1 on linuxlt). The probe suite used for diagnosis was
deleted, not committed.

## Findings that stand (reviewed, no change)

- **Merge survival.** No lane-only or int-only file differs from its
  side's tip at any merge except the five documented reroutings
  (`execTeamEntry.ts`, `execTeamRecovery.ts`, `execTeamSweep.test.ts`,
  `teamTaskState.ts` import switches to `teamGit`/`teamReport`,
  `historyRecap.test.tsx` bookmark props), each verified correct.
  `src/shared/teamReport.ts` at HEAD is byte-identical to RLM96B's
  restored canonical split, and carries the review `findings` field
  RLM96 added ([src/shared/teamReport.ts:27]).
- **RLM96B's wholesale one-sided resolutions** are the documented
  "RLM96's newer line kept" choices, verified per file: per-attempt
  settlement over per-request claim (`transport.ts`, `ModelApiHost.ts`,
  `teamEnginePorts.ts`), typed ACP refusals, the tracked
  `executions` map over `void execute().then(pump)`
  ([src/core/team/teamHost.ts:1187] area), workerFence (RLM96's line
  carries the same O_NOFOLLOW/single-link/role-checked hardening plus
  `writeBytes`/`reserve`), searchWorker (lane's `inlineContent`
  helper is semantically identical to the int side's inline branch,
  same `content` schema). Dropped RLM96B-only deltas in
  `workerToolIo.ts`/`teamConversation.ts` were mangled doc comments.
- **The merge-flow catch (`8098e00430`).** RLM96B's NARROW rethrow
  (`isToleratedMergeFailure`) was removed, restoring RLM96's
  record-and-refuse catch ([src/core/team/teamMergeFlow.ts:237]).
  The rethrow was itself broken as integrated: `beginMerge` in both
  lanes returns `await runMergeFlow(...)` with no catch, and `stop()`
  awaits `task.mergeCompletion` bare, so a rethrown non-git failure
  (cancellation, refused consent) would strand the task in its merge
  phase and reject awaiters. The kept catch records `task.failure`,
  shows the completed card and returns a refusal for every failure —
  reported in substance, though the inventory classes the site
  GENERIC from RLM96's baseline. It stands.
- **All other `fix(int):` commits** are right and minimal:
  `19ec96a431` strengthens the splice (native-ID recheck by path,
  missing reads as changed); `1bf380ca95` retimes a test deadline
  from measured admission, assertions unchanged; `397aca3ddb`'s
  PowerShell `@(foreach)` keeps single-path scans an array and
  `prepareAudit` only moves creation earlier; `9337c14eca` makes
  every new start stricter (guarded launches; the shared
  `processStartTime` returns Unix epoch ms on Windows —
  `ToUnixTimeMilliseconds()` in the birth reader — matching
  `startedAt = Date.now() - uptime` and the 60 s skew);
  `14ffe05ab8` routes the paid Try through `usableReply` (a capped
  turn's text is cleared, never shown as the plan); `88c26cf374` /
  `878aa63780` strengthen strict-schema expectations and move the
  M101 pin with a recorded revision row; `50804c0c02` removes only
  exports knip proved unread; `5200de1cb4`'s reader removal is
  proved by the split gate over the built bundles (exit 0);
  `3231dc538b`, `d4f6e991db` (a real shipped ReferenceError fixed),
  `73df44519f` (specificity-safe: `.sequences-start` renders outside
  any `.sequences fieldset`), `18fe69a030`, `9f3e7fde7c`,
  `702148bee0`, `c1969ee9f5`, `5c75695ad6` (the two catch-baseline
  identities in no parent baseline are the teamTry site after its
  usableReply edit and the execTeamRecovery catch after its guarded
  rewrite — same sites, audited handlers).
- **Budgets and bounds.** No `fix(int):` raises a bundle budget
  (`8098e00430` lowers teamHost 153 → 130 KiB with its measurement)
  or a product bound; teamRunners 100 KiB is RLM107's lane change
  kept at `ce2807af42` with its D6 measurement comment.
- **Generated files really regenerated** at the final tree:
  `check:roadmap`, `check:host-api`, `check:reference`,
  `check:catches`, lazy-registry `--check`, bundle-split and
  third-party notices all exit 0; the deferred-bundles external-entry
  filter at HEAD holds exactly the union of all 15 lane tips' tokens
  (59, none missing, none extra).
- **No duplicated blocks** found: `duplication` reports 0 clones and
  `extension.ts` holds one team host block (`isTeamSwitchOn` "off
  unless explicitly true" kept).

## Report-only (owned elsewhere)

- **`test/unit/teamHostService.test.ts` runs on fakes** (1923 lines;
  line 3: "Every port is a fake that records its calls"). It stands
  as RLM96 adapted it. RLINTFIX is rewriting it; not touched here.
  Note the "4 teamHostService cases" that motivated the merge-flow
  catch revert rest on these fakes — the revert also stands on the
  code reading above, independent of them.
- **`promptSequence` usable-reply allow-list** (`14ffe05ab8`):
  verified sound. `sequenceTurnSettled`
  ([src/core/prompts/promptSequence.ts:70]) reads only the terminal
  word to decide progression and never reads reply text; a cancelled
  or non-completed turn ends the run. The `showTeamCard` entry reads
  a card item's own status, not a turn. `check:usable-reply` exit 0.
- **README/docs still publish dormant `--team` usage** (RLINTFIX owns
  README truth): [README.md:5467] documents the full
  `exec --team ...` invocation (qualified "behind the agent-teams
  availability switch, off until certified"), as do
  [docs/reference.md:457], [docs/ci.md:62] and the M96b [Unreleased]
  bullets, while `3231dc538b` keeps the flag off the help screen for
  the same dormancy (CX1R3). The qualification is uniform; whether
  qualified usage may stay published is RLINTFIX's call.
- **Minor**: a capped Try turn with no `event.reason` shows the raw
  wire word `max_turn_requests` as its failure line
  ([src/core/team/teamTry.ts:156]); the pre-existing fallbacks
  (`event.terminal`) are raw words the same way. Dormant path; noted,
  not fixed. `lazyBundleFiles`' reshaped assertion (`18fe69a030`)
  keeps value exactness but no longer rejects extra keys on the row.
- **Pre-existing, not from this round**: PLAN.md's D3 pin table lists
  `@muse-code/sdk` 1.4.4 ([PLAN.md:714]) while `package.json` was
  already 1.4.10 on `f3941b8548` and is 1.4.11 now (RLFINISH bump
  `4a786a16c6`, itself without a D3 note). Main's drift, continued;
  recorded here so it is not lost.

## Sandbox-blocked on linuxlt (not run green here)

`connectorStorageGuard` (3 cases) and `connectorServe` (5 cases)
fail because this sandbox's filesystem root chain cannot pass the
connector guard's anchor rule by construction: `/` and `/var` are
owned by uid 65534 (neither the user's 1000 nor root's 0) and the
lane ancestors are group-writable (0775), so `posixVerify`
([src/runtime/connector/storageGuard.ts:367]) refuses before any
link or serve behaviour is reached, and `serve` exits 1 at
[src/runtime/connector/entry.ts:84]. Measured with `lstat` over the
full ancestor chain; no temp root on this rig avoids uid-65534
ancestors. Per the rig rules no workaround was attempted; the lead
runs these two suites outside the sandbox. The guard code itself is
unchanged in its POSIX logic by this round (`9337c14eca` touched
launches; `397aca3ddb` the Windows script and audit preparation).

## Gates on the final tree (374e04452b + 0e322c472e)

Run 2026-10-22 on linuxlt, in this worktree, one heavy command at a
time; exit codes are each command's own.

| Gate                                                   | Exit                                                                                                                                                                                                                                                        |
| ------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `npm run typecheck` (all projects)                     | 0                                                                                                                                                                                                                                                           |
| `npx eslint --max-warnings 0` on touched files         | 0                                                                                                                                                                                                                                                           |
| `npx prettier --check` on touched files                | 0                                                                                                                                                                                                                                                           |
| `node scripts/check-l10n.mjs`                          | 0 (0 problems)                                                                                                                                                                                                                                              |
| `npm run check:reference`                              | 0                                                                                                                                                                                                                                                           |
| `npm run check:host-api`                               | 0                                                                                                                                                                                                                                                           |
| `npm run check:roadmap`                                | 0                                                                                                                                                                                                                                                           |
| `npm run check:catches`                                | 0 (counts and sites match baseline)                                                                                                                                                                                                                         |
| `npm run check:usable-reply`                           | 0                                                                                                                                                                                                                                                           |
| `npm run duplication`                                  | 0 (0 clones)                                                                                                                                                                                                                                                |
| `npm run cycles`                                       | 0                                                                                                                                                                                                                                                           |
| `npm run deadcode`                                     | 0                                                                                                                                                                                                                                                           |
| `npm run check:plan`                                   | 1 — known RLINTFIX item (PLAN.md 3,668,951 bytes over the 3,565,158 archive budget)                                                                                                                                                                         |
| `npm run build`                                        | 1 — known RLINTFIX items only: `dist/resourceAdmission.js` 25.0/25 KiB, `dist/modelApi.js` 527.7/525 KiB, `dist/vaultActions.js` 25.0/25 KiB; tokens, bundle-split, lazy-registry, host-globals and notices each exit 0 when run directly on the built tree |
| `SEMGREP_ENABLE_VERSION_CHECK=0 npm run security:sast` | 0 (533 rules, 4144 files, 0 findings)                                                                                                                                                                                                                       |
| `npm run security:audit`                               | 0 (4 advisories, 2 standing exceptions)                                                                                                                                                                                                                     |

Suites (`npx vitest run <files> --maxWorkers=3`, repository
timeouts): fileRange + resourceHandoffDeadline + responsesCodec
71 passed; modelapiChatCodec + m101Certification 104 passed (batch
also carried the then-red execTeamSweep); execTeamSweep 1 passed
after the fix; connectorStorageGuard + pathGuardSpawns +
lazyBundleFiles 27 passed, 3 sandbox-blocked above; modelsSections

- teamWorkerToolIo + browserKeybindings 36 passed; historyRecap +
  promptSequence + changelogVersion 10 passed; invariants (golden
  08-team-on) + whatsNewContent + whatsNewVersions 106 passed;
  execTeamLedger + execTeamFlags + teamWorkerCreate 120 passed, 28
  platform skips; teamPanel + modelsPanelVaultSection +
  teamConstants 78 passed; cliHelp + cliHelpConsistency +
  commandHelp 121 passed; cx1r2Truth + cx1r4Truth +
  resourceNoLimits 48 passed; connectorRuntime + sequences 11
  passed with connectorServe's 5 sandbox-blocked. Known RLINTFIX
  suites (runnerHelperNative, acpServeHandshake, evalFreezeLayout,
  symlink-EPERM) were not run and not touched.

No real-use or model call was made: this lane is review-only and
its brief names none. Review-only judgement calls are listed above
for the lead; nothing else remains open on RVINT1.
