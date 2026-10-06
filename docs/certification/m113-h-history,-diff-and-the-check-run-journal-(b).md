# M113-H — History, diff and the check-run journal

2026-10-06, Kubuntu rig, worktree `/home/randy/lanes/M113H`, branch
`m113/h`, lane-0 base `145f97cdd`. Authority: M113H.rig.md, the shared
codex/common.md rules, AGENTS.md, PLAN D93 and M113, and the lane-0
contracts/certification. M93's research and M84's export/scrub were read.
Scope: D93.9 and D93.10 only. No dependency, install, network request,
credential read, live/paid model call, merge, rebase or push.

## Implemented

- `src/core/reporting/history.ts`: owner-only, atomic JSON history under
  `<agentDataFolder>/reports/v1/history/<workspaceKey>/<kind>/`. The 51st
  saved report removes the oldest, separately per kind. Ordering uses the
  timestamp's actual instant descending, with saved id ascending by code
  unit for ties. An identical byte sequence is idempotent. Different `asOf`
  stamps remain distinct even when their content hashes agree. History-off
  prevents codec, authorization and storage work for a new save; it does not
  delete old history. List/get/compare implement the existing MHP payloads,
  authorize their workspace and kind before touching disk, fail foreign or
  absent ids, and retrieve saved bytes across reconnects without generation.
- The required `ReportHistoryCodec` is the explicit R integration port:
  `encode` returns canonical scrubbed/hash-stamped JSON; `decode` verifies
  the saved hash and returns its document. History validates the document
  again and checks the file's SHA-256 id and kind. Only the absent codec is
  faked in tests; the history and filesystem are real. No production fake,
  guessed hash implementation or dependency on another lane's worktree.
- Shared `ReportStorage` confines bucket components and filenames, refuses
  directory redirects and nonregular/linked files, checks native BigInt
  identities, reads bounded bytes through a no-follow/nonblocking handle,
  stages exclusively, syncs, and renames complete files. New directories
  use the existing private directory mode; files and writer locks use 0600.
  Per-bucket exclusive locks protect concurrent history pruning and journal
  rewrites across instances/processes; contention has the existing bounded
  atomic-operation retry count/delay. Read-only transactions cannot mutate.
- `src/core/reporting/diff.ts`: pure comparison by section id and row key,
  including Needs you and the full union of both inputs' ordinary sections.
  Added/removed rows, changed before/after pairs including source references,
  and unchanged counts retain the lane-0 contract. Object property order is
  ignored; array order remains meaningful. A typed diff section shows each
  changed cell/source field with its original display types, respects the
  short/full row bounds, and names omitted rows. `reportDiffNotice` reads the
  existing localized “No change since {asOf}” at render time, outside the
  untranslated report document.
- `src/core/reporting/checkRuns.ts`: JSONL at
  `<agentDataFolder>/reports/v1/checks/<workspaceKey>.jsonl`. The 501st run
  drops the oldest. Only `{check, outcome, durationMs, commit, at}` is written;
  extra command/output/detail fields are excluded before serialization. Names
  are scrubbed on new writes, on legacy reads and when retaining prior rows.
  Durations, outcomes, Git SHA-1/SHA-256 ids and timestamps are validated.
  Reads inspect at most 500 lines, sort deterministically, honor cancellation,
  and supply K's real normalized `checkRuns` source. Missing storage is
  unavailable; corrupt/oversized history is partial with a reason, never
  an empty success pretending evidence existed.
- M68's real run site in `ModelApiHost.ts` has one append call. The optional
  `VerifyHooks.checkRuns` port captures HEAD before an authorized configured
  check runs, then records its outcome, shell duration and completion stamp
  before post-hooks/corrections. Timed-out checks map to the frozen journal
  contract's `failed`; cancelled checks retain `cancelled`. Declined or
  entry-refused checks and arbitrary `then_run` commands are not recorded as
  executed configured checks. Missing commit evidence and storage failures
  preserve the check's result and log fixed words, without exception text.
  Hosts without the port keep their existing execution path.

All logic is shared core code, with no VS Code import, provider restriction,
model call or paid feature. No new text or user entry point is registered in
this lane; existing lane-0 translations are read at use time.

## Named integration handoffs

| Handoff                 | Owner                          | Exact binding                                                                                                                                                                                                                                                                                                                                                                                                                    |
| ----------------------- | ------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| M113-H-R-codec          | R/W                            | Supply `ReportHistoryCodec.encode/decode` using R's scrub-before-hash canonical JSON and saved-hash verification, excluding exactly the two header paths in lane 0's contract. Render `reportDiffSection`; use `reportDiffNotice` for equal hashes, passing the renderer-selected table’s no-change template for an explicit locale.                                                                                             |
| M113-H-history-surfaces | X/V/M104                       | Construct `ReportHistory` with the authorized agent data root, workspace/kind authorization and the live `keepHistory` setting. Bind its `history/get/compare` methods to `reports/*`, CLI `report history`, ACP `/report history`, the report tab and native/companion surfaces. Call `save` after generating a verified report; use the returned id for saved comparison. TUI/Desktop use the same port once their hosts land. |
| M113-H-check-source     | K/S                            | Place `CheckRunJournal.source()` in the snapshot's `checkRuns` source port. Its data is the frozen `CheckRunRecord[]`; the quality collector stays K-owned.                                                                                                                                                                                                                                                                      |
| M113-H-M68-binding      | W/host/runtime verify adapters | Supply `VerifyHooks.checkRuns.commit` from the bounded read-only Git HEAD reader and `append` as a closure over the workspace key and `CheckRunJournal.append`. Both VS Code and runtime/ACP adapters use the same port; no storage module is added to activation by this lane.                                                                                                                                                  |
| M113-H-M96c             | M96c/W                         | Append the same five-field record from actual check slots once merged. Preserve outcome/commit availability and the existing scrub; no slot implementation exists on this base.                                                                                                                                                                                                                                                  |
| M113-H-docs-reference   | W                              | README/ACP/CI: history listing, saved retrieval and diff; PRIVACY/SECURITY: private JSON/JSONL, retention, exactly five check fields, redaction and link/identity guards; CHANGELOG: bounded report history and field diff, durable check evidence. Add the keepHistory/history/diff catalogue rows and regenerate help. These shared files remain W-owned.                                                                      |
| M113-H-bundle           | W                              | Put these modules in the planned lazy reporting engine and keep the new panel/chunk's own budget. This lane changes only the existing lazy Model API run site; it adds no activation import or bundle entry.                                                                                                                                                                                                                     |

The seven unused manifest localization keys reported by lane 0 remain W's
manifest handoff. This lane adds no manifest or translation key and does not
weaken the gate or edit another lane's registered surfaces/docs.

The host API gate also requests W's generated inventory refresh after these
new shared-core imports: `node:crypto` 46 → 48, `node:fs` 33 → 34,
`node:fs/promises` 47 → 48, `node:path` 84 → 85 and `node:timers/promises`
3 → 4. No VS Code API is added. W runs `npm run check:host-api -- --write`
and reviews the generated document when integrating; this lane does not
write its owned `docs/ide-compatibility/host-api.md`.

## Validation and limits

Owned tests are `reportHistory.test.ts`, `reportDiff.test.ts`,
`checkRuns.test.ts` and the complete existing `verifyLoop.test.ts`.
Runs are direct on Kubuntu, at most three files and `--maxWorkers=3`, with
repository default timeouts and no test-name filter. Initial restored runs:
27 history/diff/journal tests plus 76 verify-loop tests, all passing.
All five typecheck projects passed; final scoped gate receipts follow.

Before the implementation commit: changed-file ESLint passed without warnings;
all ten changed files passed Prettier and `git diff --check`; unit typecheck
passed again after the final test additions. The restored three-file history,
diff and journal suite passed 27 tests; the complete verify-loop suite passed 76. Localization reports exactly the seven pre-existing W-owned unused keys,
with all 14 UI tables valid. Host API reports one generated inventory drift,
with the exact five Node count changes listed above. No gate was weakened to
claim those integration-owned artifacts green.

Final restored receipts (Kubuntu, repository default timeout throughout):

| Command / scope                                                                                                                       | Result                                                                                                                       |
| ------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------- |
| `npx --no-install vitest run test/unit/reportHistory.test.ts test/unit/reportDiff.test.ts test/unit/checkRuns.test.ts --maxWorkers=3` | Exit 0; 15 history + 7 diff + 8 journal = 30 tests, 1.66 s total                                                             |
| `npx --no-install vitest run test/unit/verifyLoop.test.ts --maxWorkers=3`                                                             | Exit 0; all 76 tests, 4.92 s total                                                                                           |
| `npm run typecheck`                                                                                                                   | Exit 0; host, webview, unit, e2e and integration projects                                                                    |
| Changed-file ESLint, `--max-warnings=0`                                                                                               | Exit 0; all nine changed TypeScript files                                                                                    |
| Changed-file Prettier and `git diff --check`                                                                                          | Exit 0; all ten changed files                                                                                                |
| `npm run deadcode` (plain knip)                                                                                                       | Exit 0; only the two existing configuration hints for vendor/axe-core                                                        |
| `npx --no-install jscpd`                                                                                                              | Exit 0; 1,198 files, zero clones                                                                                             |
| `npm run check:reference`                                                                                                             | Exit 0; current: 53 features, 44 commands, 59 settings, 26 slash and 116 CLI entries                                         |
| `npm run check:l10n`                                                                                                                  | Exit 1; exactly the seven lane-0 unused manifest keys below, 14 valid UI tables, no new translation issue                    |
| `npm run check:host-api`                                                                                                              | Exit 1; one generated inventory freshness issue, exactly the five Node import-count deltas above; 332 VS Code APIs unchanged |
| `npm run build`                                                                                                                       | Exit 0; size, split, host-global and third-party-notice gates all pass                                                       |

The seven existing manifest issues are `command.showReport.title`,
`config.reports.network.description`,
`config.reports.network.enumDescriptions.whenSignedIn`,
`config.reports.network.enumDescriptions.always`,
`config.reports.network.enumDescriptions.off`,
`config.reports.keepHistory.description`, and
`config.reports.agentSources.description`. Their registrations and the host
inventory are named W handoffs, not ignored failures.

Production sizes: extension 439.5/600 KiB, Model API 447.4/475 KiB,
ACP 821.5/850 KiB, checkpoint store 76.9/225 KiB, webview startup
797.7/900 KiB, deferred webview JavaScript 50.0/50 KiB. Every budget is
unchanged. No reporting engine/panel entry is registered on this lane-0
base; W owns the planned lazy reporting bundle and its separate budget.

The first implementation commit is `04e13dc1acad974482bc84d85e21e2ef55dffe62`;
normal pre-commit ESLint/Prettier and gitleaks hooks passed with zero leaks.
Ignored local `temp/m113h-drills/final-*.log` files contain the scoped gate
outputs; the durable named mutation receipts follow below.

The shared reader/writer limits one artifact to
`REPORT_MAX_TEXT_CHARS * REPORT_MAX_SOURCES` (6.25 MiB), derived from existing
report bounds. Oversized files fail explicitly before allocation/write;
history retention is independently 50 and check retention 500. A crash can
leave an exclusive writer lock: it is refused after bounded retries rather
than guessed stale or deleted while another owner may be active. Path and
inode checks precede operations; Node's path-based rename/unlink cannot be
made kernel-conditional on a directory handle. Host-owned private storage is
the trust root. Unix modes are asserted on Kubuntu; Windows ACL inheritance
and live editor surfaces remain integration-rig receipts, not claims here.

The full quality run is reserved to the lead by the explicit shared rig
rules. No gate, ignore, timeout, hook, package pin or budget was changed.

## Deliberate breaks

Each mutation ran its complete owning unit file, with the default timeout,
and reached the named semantic failure with exit 1. A finally block restored
the original source bytes and compared SHA-256 before the next mutation.
Receipts/logs are in ignored `temp/m113h-drills/`; the table below is the
durable record. No leaked test canary is a real credential.

| Mutation                         | Named failing assertion                                            | Exit | Restored SHA-256                                                   |
| -------------------------------- | ------------------------------------------------------------------ | ---: | ------------------------------------------------------------------ |
| `history-retention`              | drops the oldest on the 51st report                                |    1 | `dbca2a3c4e64faeb64be3a17147d11f1e17d40757d694dc664ec18d0e73d754d` |
| `history-off`                    | does no storage or codec work when history is off                  |    1 | `dbca2a3c4e64faeb64be3a17147d11f1e17d40757d694dc664ec18d0e73d754d` |
| `history-auth`                   | authorizes before storage                                          |    1 | `dbca2a3c4e64faeb64be3a17147d11f1e17d40757d694dc664ec18d0e73d754d` |
| `history-date-order`             | orders equal stamps                                                |    1 | `dbca2a3c4e64faeb64be3a17147d11f1e17d40757d694dc664ec18d0e73d754d` |
| `history-filename`               | refuses a renamed saved id                                         |    1 | `dbca2a3c4e64faeb64be3a17147d11f1e17d40757d694dc664ec18d0e73d754d` |
| `history-kind`                   | refuses a valid document of another kind                           |    1 | `dbca2a3c4e64faeb64be3a17147d11f1e17d40757d694dc664ec18d0e73d754d` |
| `history-verified-decode`        | fails corrupt or hash-tampered history                             |    1 | `dbca2a3c4e64faeb64be3a17147d11f1e17d40757d694dc664ec18d0e73d754d` |
| `storage-name`                   | rejects POSIX and Windows path traversal                           |    1 | `dbca2a3c4e64faeb64be3a17147d11f1e17d40757d694dc664ec18d0e73d754d` |
| `storage-read-cap`               | refuses oversized files                                            |    1 | `dbca2a3c4e64faeb64be3a17147d11f1e17d40757d694dc664ec18d0e73d754d` |
| `storage-write-cap`              | refuses oversized files                                            |    1 | `dbca2a3c4e64faeb64be3a17147d11f1e17d40757d694dc664ec18d0e73d754d` |
| `storage-read-only`              | refuses oversized files                                            |    1 | `dbca2a3c4e64faeb64be3a17147d11f1e17d40757d694dc664ec18d0e73d754d` |
| `storage-directory-link`         | rejects directory redirects                                        |    1 | `dbca2a3c4e64faeb64be3a17147d11f1e17d40757d694dc664ec18d0e73d754d` |
| `storage-hard-link`              | rejects directory redirects                                        |    1 | `dbca2a3c4e64faeb64be3a17147d11f1e17d40757d694dc664ec18d0e73d754d` |
| `storage-directory-mode`         | keeps identical bytes idempotently                                 |    1 | `dbca2a3c4e64faeb64be3a17147d11f1e17d40757d694dc664ec18d0e73d754d` |
| `storage-file-mode`              | keeps identical bytes idempotently                                 |    1 | `dbca2a3c4e64faeb64be3a17147d11f1e17d40757d694dc664ec18d0e73d754d` |
| `diff-scope`                     | rejects mismatched kind, scope                                     |    1 | `3c5acfe3bde97ffa4cb65b252f479fa5518defd15f72f020d110a93ca6d821be` |
| `diff-section-union`             | compares all 65 sections                                           |    1 | `3c5acfe3bde97ffa4cb65b252f479fa5518defd15f72f020d110a93ca6d821be` |
| `diff-removed`                   | lists exactly added, removed, changed                              |    1 | `3c5acfe3bde97ffa4cb65b252f479fa5518defd15f72f020d110a93ca6d821be` |
| `diff-changed`                   | lists exactly added, removed, changed                              |    1 | `3c5acfe3bde97ffa4cb65b252f479fa5518defd15f72f020d110a93ca6d821be` |
| `diff-source-fields`             | lists exactly added, removed, changed                              |    1 | `3c5acfe3bde97ffa4cb65b252f479fa5518defd15f72f020d110a93ca6d821be` |
| `diff-order`                     | ignores object insertion order                                     |    1 | `3c5acfe3bde97ffa4cb65b252f479fa5518defd15f72f020d110a93ca6d821be` |
| `diff-row-cap`                   | compares all 65 sections                                           |    1 | `3c5acfe3bde97ffa4cb65b252f479fa5518defd15f72f020d110a93ca6d821be` |
| `diff-no-change`                 | says No change since                                               |    1 | `3c5acfe3bde97ffa4cb65b252f479fa5518defd15f72f020d110a93ca6d821be` |
| `journal-output-canary`          | persists only five approved fields                                 |    1 | `2322c1e0318dba81d8c141f82e63d52852b83204b7d4b2e186d5b508a9c6bc8f` |
| `journal-new-name-scrub`         | persists only five approved fields                                 |    1 | `2322c1e0318dba81d8c141f82e63d52852b83204b7d4b2e186d5b508a9c6bc8f` |
| `journal-prior-name-scrub`       | scrubs valid legacy names                                          |    1 | `2322c1e0318dba81d8c141f82e63d52852b83204b7d4b2e186d5b508a9c6bc8f` |
| `journal-retention`              | drops the oldest on the 501st check                                |    1 | `2322c1e0318dba81d8c141f82e63d52852b83204b7d4b2e186d5b508a9c6bc8f` |
| `journal-read-bound`             | bounds malformed-line inspection                                   |    1 | `2322c1e0318dba81d8c141f82e63d52852b83204b7d4b2e186d5b508a9c6bc8f` |
| `journal-strict`                 | feeds a normalized source                                          |    1 | `2322c1e0318dba81d8c141f82e63d52852b83204b7d4b2e186d5b508a9c6bc8f` |
| `journal-duration`               | rejects invalid counts                                             |    1 | `2322c1e0318dba81d8c141f82e63d52852b83204b7d4b2e186d5b508a9c6bc8f` |
| `journal-commit`                 | rejects invalid counts                                             |    1 | `2322c1e0318dba81d8c141f82e63d52852b83204b7d4b2e186d5b508a9c6bc8f` |
| `journal-timestamp`              | rejects invalid counts                                             |    1 | `2322c1e0318dba81d8c141f82e63d52852b83204b7d4b2e186d5b508a9c6bc8f` |
| `journal-cancel`                 | records all contract outcomes                                      |    1 | `2322c1e0318dba81d8c141f82e63d52852b83204b7d4b2e186d5b508a9c6bc8f` |
| `journal-missing`                | feeds a normalized source                                          |    1 | `2322c1e0318dba81d8c141f82e63d52852b83204b7d4b2e186d5b508a9c6bc8f` |
| `verify-append`                  | journals each executed check                                       |    1 | `2d12753ecdf0fa5ce7e2cf6d7dfbfe97b37286ff31701efc4ca8ecbd3c772e69` |
| `verify-timeout`                 | maps timeout to failed evidence                                    |    1 | `2d12753ecdf0fa5ce7e2cf6d7dfbfe97b37286ff31701efc4ca8ecbd3c772e69` |
| `verify-output-canary`           | journals each executed check                                       |    1 | `2d12753ecdf0fa5ce7e2cf6d7dfbfe97b37286ff31701efc4ca8ecbd3c772e69` |
| `verify-log-canary`              | keeps check results intact when journal persistence fails          |    1 | `2d12753ecdf0fa5ce7e2cf6d7dfbfe97b37286ff31701efc4ca8ecbd3c772e69` |
| `storage-native-identity`        | refuses a file whose held native identity differs                  |    1 | `dbca2a3c4e64faeb64be3a17147d11f1e17d40757d694dc664ec18d0e73d754d` |
| `storage-writer-lock`            | serializes simultaneous writers                                    |    1 | `dbca2a3c4e64faeb64be3a17147d11f1e17d40757d694dc664ec18d0e73d754d` |
| `diff-final-row-cap`             | compares all 65 sections                                           |    1 | `f44f6fddd7df72fb8076d540216ce1ef9246b1096f70d9b05e9bc6941c93abbe` |
| `diff-short-full-order`          | compares all 65 sections                                           |    1 | `f44f6fddd7df72fb8076d540216ce1ef9246b1096f70d9b05e9bc6941c93abbe` |
| `diff-explicit-locale`           | says No change since                                               |    1 | `4dca4e8c8da5367edbb26885093c94123edfe4c29a945e28e394e937f92e58fb` |
| `diff-field-presence`            | retains presence changes when a field value is Not applicable      |    1 | `9fa4a9fed37c12a399d40a7a936f3e71b2d32501ea202fa48fab0711c3fe3490` |
| `diff-own-field-value`           | compares columns named constructor without inherited object values |    1 | `9fa4a9fed37c12a399d40a7a936f3e71b2d32501ea202fa48fab0711c3fe3490` |
| `history-corrupt-save-preflight` | refuses to grow a corrupt history bucket on a failed save          |    1 | `4c8fcf3c6498d3d0f71e42db446a1af4dbd5daf8c877d7844d1317e528eb6866` |
| `history-retained-save-result`   | drops the oldest on the 51st report                                |    1 | `4c8fcf3c6498d3d0f71e42db446a1af4dbd5daf8c877d7844d1317e528eb6866` |
| `history-idempotent-retention`   | drops the oldest on the 51st report                                |    1 | `4c8fcf3c6498d3d0f71e42db446a1af4dbd5daf8c877d7844d1317e528eb6866` |

All 48 distinct mutations fired and restored exactly. The two final diff drills also prove that the short section is precisely the first ten rows of the full section after sorting; truncation never changes their order.

The explicit-locale drill proves R can render the same-hash sentence in a supplied language while the installed UI table remains English. File-path comparisons normalize Windows separators. The duplication gate initially found a nine-line repeated verify-test setup; `checkWithJournal` now drives those two cases through one actual fake-API turn, with no gate change.

Final review added two regression tests before fixing the display section:
adding/removing a cell whose value is `notApplicable` had been mistaken for
no field change, and a column named `constructor` had read the inherited
prototype value for an absent cell. Both tests failed in the original full
diff-file run (`field-regressions-before.log`: two failed, five passed).
Own-property presence now chooses added/removed outcomes, and own-property
lookup supplies the missing-value label in both directions. The two named
mutations above independently prove those fixes fire.

History also refuses a corrupt bucket before writing a new artifact, so a
failed save cannot grow the bucket. A backdated report that falls outside
the retained fifty is pruned and fails explicitly rather than acknowledging
an id that `get` cannot retrieve. Both protections have named, byte-restored
red drills above.

The final save path reuses the preflight's validated documents when inserting
and sorting the new saved id; it does not scan the bucket twice. The existing
ordering rule is shared by listing and save. Replacement removes an existing
identical id before ranking, so replaying the oldest retained report cannot
count it twice and prune it. The saturated-retention test and final
`history-idempotent-retention` drill prove that bound and idempotence together.
The intermediate void-discard attempt failed the lint rule and was replaced;
no lint override or gate setting was changed.

The `constructor` regression fixture also exposed TypeScript's special
built-in member typing. It now creates that valid dynamic column with
`Reflect.set` and a typed `ReportValue`, preserving the own-property test
without a cast or rule exemption.

## RVM113H corrections — first piece (2026-10-06)

The fix brief supersedes the earlier wall-clock journal ordering and lock
limitations above. All six P2s are in scope; no redesign or dependency is
needed. Shared-core changes serve the same host/runtime ports and all
providers. No new command, setting, surface or catalogue row is introduced.
The existing W-owned integration handoffs remain.

Findings 1, 5 and 6 are fixed: journal HEAD is captured inside the authorized
pre-guard step, so confinement and session state are checked afterward;
diff identities hash an explicit cell/metadata namespace; check retention
and source output preserve the physical append sequence, including equal
stamps and backwards clock corrections. Exactly five persisted fields remain.

Complete owning suites passed on Kubuntu with default timeouts:
`reportDiff.test.ts`, `checkRuns.test.ts`, `verifyLoop.test.ts`: 94 tests.
Pre-fix runs reproduced the confinement dispatch, journal loss and schema-valid
diff key collision. The first diff fixture omitted required cells and was
corrected before its semantic pre-fix receipt (`m113h-diff-before-valid.log`);
no production guard was changed to accommodate invalid fixture data.

Each deliberate break ran the complete named suite, exited 1 at its regression,
and restored the source bytes with SHA-256 equality:

| Finding | Drill                      | Named failing test                                                                | Restored SHA-256                                                   |
| ------- | -------------------------- | --------------------------------------------------------------------------------- | ------------------------------------------------------------------ |
| 1       | `head-before-final-guard`  | refuses a folder swapped to an outside link during journal HEAD capture           | `098f4afcf6f95c95f8b3b61fd527eece1e5bcf4a371b08934df9611cb724ee78` |
| 5       | `diff-identity-namespace`  | namespaces metadata identities apart from sourceIds and unchangedRows cells       | `2f8e583dc140c49079fd1b485e2b1d51e99b3d9778534c80d2ec568c103f82b1` |
| 6       | `journal-append-retention` | retains the incoming check and append sequence after a backwards clock correction | `7b25f1fc387302234b4b85f862f783a46e305ec9009de759a5ee2b4fd6c78683` |

## RVM113H corrections — storage and final certification (2026-10-06)

All six P2 findings are fixed, with no review residual; PLAN §9 records that
outcome. No P1 or P3 was reported. The following replaces the earlier lock
and journal-order limitations, without claiming the pending W integrations
or other rigs' native receipts.

- **Finding 2:** each exclusive writer lock records a validated PID and OS
  process start time before work. Linux reads the kernel start ticks; Windows
  reads the process's FILETIME through bounded, profile-free PowerShell;
  macOS uses the process's start stamp with fixed locale/timezone. The own
  process identity is cached, so ordinary writes do not launch a probe each
  time. Probe children receive `withoutCredentials(process.env)`. Dead or
  mismatched owners are recovered, with confinement and native-identity
  checks before removal. An interrupted/unfinished record gets a monotonic
  250 ms initialization grace, tied to its inode; a creator that resumes
  after recovery must verify that its lock still exists before work. The
  child-process regression kills the actual bundled storage writer after
  lock creation and its owner record, then writes through a fresh instance.
- **Finding 3:** contention has its own two-second monotonic total and
  exponential 25–100 ms backoff. External owner probes use the smaller of
  their two-second bound and remaining wait time. A live owner is preserved;
  exhaustion throws an explicit save failure, with no callback or silent
  success. Disappearing locks cannot skip the deadline. A failed or changing
  owner-record read supplies no ownership or deletion authority and retries
  within that same bound; the general confined reader's guards are unchanged.
- **Finding 4:** saves validate the bucket and retained incoming id, prune
  every displaced prior artifact, then publish the new atomic file. Failed
  deletion therefore adds no artifact. An already over-cap bucket is honest
  on list/get (failed, rather than hiding excess), and the next save retries
  its prune. Read paths share `retainedEntries`; save still scans all prior
  evidence for repair. Failed writes after a successful prune may leave fewer
  retained reports, but never acknowledge a new id or exceed the cap; there
  is no separate index to become inconsistent.

The tests seed prior reports directly as fixture files instead of fsyncing
fifty fake prior saves. Only the real save being tested runs the production
fsync path. The writer fixture is built once in `beforeAll`; the held-owner
setup is shared by the timeout and race tests. These changes preserve the
repository's five-second per-test timeout on a busy disk. Initial retention
mutation attempts that only timed out were not accepted as semantic drill
receipts; the final runs below all reached their named assertions.

The duplication gate caught two repeated blocks (the read cap and held-writer
setup). They now share the same checks/setup, and no gate setting changed.
An initial typecheck/drill start and a later lint/test start overlapped by
mistake. The first was interrupted with source restoration; the final gate
runner runs every heavy command sequentially and uses at most three Vitest
files and three workers. No timeout override, hook change or environment
wrapper alters a repository check.

The small Unreleased changelog correction documents these fixes under
AGENTS rule 10; the full report user docs, reference and surface bindings
remain the existing W handoffs. No new user entry point, translation,
feature catalogue row, package pin, dependency, install, credential read,
network/model/paid call, merge, rebase or push was introduced.

Final storage red drills each ran the complete `reportHistory.test.ts`, exited
1 at a semantic assertion (no timeout), and restored the original bytes with
SHA-256 equality. Together with the first piece's three drills, there are
15 named correction drills:

| Finding | Drill                            | Named failing test                                                                | Restored SHA-256                                                   |
| ------- | -------------------------------- | --------------------------------------------------------------------------------- | ------------------------------------------------------------------ |
| 2       | `lock-dead-owner`                | recovers the writer lock after killing its owner process                          | `7a549ea47116c0a14da2555fbd28713cbd8f4321cd6fe749a56c9cc0ec7e0dfc` |
| 2       | `lock-pid-reuse`                 | recovers a reused PID with a mismatched process start time and an unfinished lock | `7a549ea47116c0a14da2555fbd28713cbd8f4321cd6fe749a56c9cc0ec7e0dfc` |
| 2       | `lock-unfinished-recovery`       | recovers a reused PID with a mismatched process start time and an unfinished lock | `7a549ea47116c0a14da2555fbd28713cbd8f4321cd6fe749a56c9cc0ec7e0dfc` |
| 2       | `lock-creator-identity`          | refuses work by a creator paused before its recovered lock was initialized        | `7a549ea47116c0a14da2555fbd28713cbd8f4321cd6fe749a56c9cc0ec7e0dfc` |
| 3       | `lock-contention-wait`           | waits for a live writer held longer than the old 100 ms contention budget         | `794ae28b2b5793a339a800de9533fbca485e23bbb5cee45dad561fe6fcb94095` |
| 3       | `lock-contention-timeout`        | fails a live-owner timeout honestly without running or deleting its lock          | `7a549ea47116c0a14da2555fbd28713cbd8f4321cd6fe749a56c9cc0ec7e0dfc` |
| 3       | `lock-read-race-deadline`        | keeps lock-read races inside the total contention deadline                        | `7a549ea47116c0a14da2555fbd28713cbd8f4321cd6fe749a56c9cc0ec7e0dfc` |
| 3       | `lock-initialization-read-retry` | retries a lock record that changes while its creator is initializing it           | `7a549ea47116c0a14da2555fbd28713cbd8f4321cd6fe749a56c9cc0ec7e0dfc` |
| 4       | `history-prune-before-publish`   | reports failed pruning without growing 50/51 artifacts and retries next write     | `7a549ea47116c0a14da2555fbd28713cbd8f4321cd6fe749a56c9cc0ec7e0dfc` |
| 4       | `history-list-cap`               | reports failed pruning without growing 51 artifacts and retries next write        | `7a549ea47116c0a14da2555fbd28713cbd8f4321cd6fe749a56c9cc0ec7e0dfc` |
| 4       | `history-get-cap`                | reports failed pruning without growing 51 artifacts and retries next write        | `7a549ea47116c0a14da2555fbd28713cbd8f4321cd6fe749a56c9cc0ec7e0dfc` |
| 4       | `history-shared-read-cap`        | reports failed pruning without growing 51 artifacts and retries next write        | `7a549ea47116c0a14da2555fbd28713cbd8f4321cd6fe749a56c9cc0ec7e0dfc` |

Final sequential receipts on Kubuntu (repository default test timeout;
`--maxWorkers=3`, at most three files per run):

| Command / scope                                                                                                                                      | Result                                                                                                             |
| ---------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------ |
| `npx --no-install vitest run test/unit/reportHistory.test.ts test/unit/reportDiff.test.ts test/unit/checkRuns.test.ts --maxWorkers=3`                | Exit 0: 24 history + 8 diff + 9 journal = 41 tests                                                                 |
| `npx --no-install vitest run test/unit/verifyLoop.test.ts test/unit/modelApiGoldenRequests.test.ts test/unit/modelApiPacking.test.ts --maxWorkers=3` | Exit 0: 113 tests, including the complete 77-test verify loop; feature-off bytes/cache-prefix invariants preserved |
| `npm run typecheck`                                                                                                                                  | Exit 0: all five projects                                                                                          |
| Scoped `npx --no-install eslint --max-warnings=0`                                                                                                    | Exit 0: all nine changed TypeScript files                                                                          |
| `npm run deadcode`                                                                                                                                   | Exit 0: only the two pre-existing configuration hints                                                              |
| `npx --no-install jscpd`                                                                                                                             | Exit 0: 1,198 files, zero clones                                                                                   |
| `npm run check:reference`                                                                                                                            | Exit 0: 53 features, 44 commands, 59 settings, 26 slash and 116 CLI entries, current                               |
| `npm run build`                                                                                                                                      | Exit 0: size, split, host globals and notices (83 bundled packages)                                                |
| `npm run check:l10n`                                                                                                                                 | Exit 1: the same seven pre-existing W-owned unused manifest keys; 14 UI tables valid                               |
| `npm run check:host-api`                                                                                                                             | Exit 1: W-owned generated inventory refresh; 332 VS Code APIs unchanged                                            |

Exactly 154 final tests passed. No filtered test names, skipped test or raised
timeout was used. The full `npm run quality` / fleet gate remains the lead's
explicit responsibility under the shared brief; it was not run on this lane.
The final runner and outputs are ignored local receipts under `temp/`.

Final production sizes remain extension 439.5/600 KiB, Model API 447.4/475
KiB, ACP 821.5/850 KiB, checkpoint store 76.9/225 KiB; all other build caps
passed unchanged too. This does not certify the future reporting engine's
bundle: its registration, measurement and consumer wiring remain W-owned.

The final host inventory deltas against the generated document are
`node:child_process` 13 → 14, `node:crypto` 46 → 48, `node:fs` 33 → 34,
`node:fs/promises` 47 → 48, `node:path` 84 → 85, `node:timers/promises`
3 → 4, and `node:util` 5 → 6. H's recovery adds the child-process and
promisify imports; W regenerates the inventory during integration. The
seven manifest keys are exactly the earlier recorded list. Neither failure
is suppressed or misreported as green. No review finding remains deferred.

The first correction commit is `ab80211f3`, with the configured hooks and
zero gitleaks findings. The initial commit attempt was rejected by the normal
lint hook (array reversal style, await/member style and an untyped JSON test
return); those were corrected before the successful commit. Hooks remain
unchanged and enabled for the storage correction too. Final changed-file
Prettier (all twelve files) and `git diff --check` passed before that commit.

## RVM113H2 — recoverable process probing (2026-10-06)

Finding 2 is fixed. Own-process probing retries twice within the existing
probe budget, caches only a successful identity and clears a failed shared
promise only if it is still the current probe. Exhaustion is an explicit save
error; a subsequent transaction can probe again without restarting the host.
No process-probe credential policy or external-owner guard changed.

Kubuntu, repository default test timeout, complete `reportHistory.test.ts`:
26 passed. Both red drills ran that complete suite and exited 1 at the named
regression, then restored SHA-256
`958966b25a1bd293f86717832519adc6beac1c835ad3225f5dc61a51d45937a8`:

| Finding | Drill         | Named failing regression                                                |
| ------- | ------------- | ----------------------------------------------------------------------- |
| 2       | `probe-retry` | retries a transient own-process identity failure within the probe bound |
| 2       | `probe-cache` | allows later writes after exhausted own-process probes                  |

Finding 1 remains in active correction; the preceding certification's claim
of no remaining lock residual is superseded by RVM113H2.
