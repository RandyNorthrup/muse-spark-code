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
