# M113 C-M113-2 certification — CM1132R2 review repair

2026-10-10, linuxlt, branch `c/m113-2`, base `2c22e56ac`.
This record supersedes the first-pass certification and its primary-backend,
budget and lazy-loading limitations. All 22 RVCM1132 findings are repaired.
No new dependency, paid/live call, credentials, merge, push, gate relaxation
or hook change. Shared core/runtime logic serves the editor, ACP and CLI.
No webview paint changed; existing responsive/accessibility surfaces remain.

## Finding → fix → regression → deliberate failure

Test names below use the exact `R<number>` prefix in the complete owning file.
Every drill ran the entire listed file at repository deadlines, no filtering.

| Finding | Fix                                                                                       | Regression                                     | Red drill                                             |
| ------- | ----------------------------------------------------------------------------------------- | ---------------------------------------------- | ----------------------------------------------------- |
| R1      | Active primary host history, no resume/turn; CLI transient host closes                    | reportInputs R1; reportsEntry R1; e2e R1       | inputs (exit 1, named regression failed)              |
| R2      | One snapshot per engine generation, fresh run identity                                    | reportInputs R2 (both tests)                   | inputs + generation (exit 1, named regression failed) |
| R3      | Await production usageRecording.flush before snapshot                                     | reportInputs R3                                | inputs (exit 1, named regression failed)              |
| R4      | All invalid/torn/newer counters become partial evidence                                   | reportInputs R4                                | inputs (exit 1, named regression failed)              |
| R5      | Nonempty un-attributed sessions disclose missing usage                                    | reportInputs R5                                | inputs (exit 1, named regression failed)              |
| R6      | No-follow open, regular/single-link file, ancestor and held identity checks, bounded read | reportInputs R6                                | inputs (exit 1, named regression failed)              |
| R7      | Stored schema version and requested envelope identity checked                             | reportInputs R7                                | inputs (exit 1, named regression failed)              |
| R8      | Lazy factories install caller table/locale                                                | reportInputs R8; e2e R8                        | inputs (exit 1, named regression failed)              |
| R9      | Account keys include provider and account                                                 | reportUsage R9                                 | usage (exit 1, named regression failed)               |
| R10     | Limit day and as-of filtering                                                             | reportUsage R10                                | usage (exit 1, named regression failed)               |
| R11     | Stable window IDs; used/reset ties independent of input order                             | reportUsage R11                                | usage (exit 1, named regression failed)               |
| R12     | Money certainty takes precedence over token estimates                                     | reportUsage R12                                | usage (exit 1, named regression failed)               |
| R13     | Explicit timezoneOffsetMins input; editor/runtime choose UTC (0)                          | reportUsage R13                                | usage (exit 1, named regression failed)               |
| R14     | Questions reject another requested session                                                | conversationController R14                     | controller (exit 1, named regression failed)          |
| R15     | Actual editor/runtime budgets supplied; unavailable/historical snapshots disclosed        | reportUsage R15                                | usage (exit 1, named regression failed)               |
| R16     | Capture controller once; closed registry and pending lifecycle guards                     | reportingPanel R16; conversationController R16 | panel + controller (exit 1, named regression failed)  |
| R17     | E2e uses production shared admission and its actual bundles                               | e2e R17 plus original nine live cases          | admission (exit 1, named regression failed)           |
| R18     | Project usage uses seven days; milestone/release scope never parsed as usage              | reportInputs R18                               | inputs (exit 1, named regression failed)              |
| R19     | Only session/usage/project consumers touch optional input readers                         | reportInputs R19                               | inputs (exit 1, named regression failed)              |
| R20     | Strict journal calendar schema rejects normalized invalid dates                           | reportUsage R20                                | usage (exit 1, named regression failed)               |
| R21     | Remove unused alternate e2e entry and knip exemption                                      | reportInputs R21; plain knip                   | inputs (exit 1, named regression failed)              |
| R22     | Own-key lookup rejects branded prototype keys                                             | localSource R22                                | inputs (exit 1, named regression failed)              |

## Red-drill receipts

The lane helper saved original bytes, mutated the guards, ran at most three
complete files with `--maxWorkers=3`, required the named failures, restored in
`finally`, and compared SHA-256. All expected finding prefixes failed. The
journal/language/storage/kind guards were tested together; accounting guards
together; engine generation, controller lifetime, panel lifetime and e2e
admission each had their own run. No red mutation is retained.

### inputs

Exit 1; named failures: R1, R2, R3, R4, R5, R6, R7, R8, R18, R19, R21, R22. Restored hashes:

- `src/runtime/reporting/reportInputs.ts`: `4568903657358ba3c673d88afa2506e84ab85bca7da0abec7f84e7b5b75cfe97`
- `src/runtime/reporting/reportInputsEntry.ts`: `52b5154ef48df769444955add6051f7ca2ca32fffedde08d116b47abf3774622`
- `src/core/reporting/sources/index.ts`: `a7478e7058e9115894793b0105908db530f9a8c74dfb99b2ccad62fbdb883c8e`
- `src/core/reporting/sources/local.ts`: `51007ba74c67b0b54dc2f8e23df6c3f35fb66ec8ccc6157c2870c9d706c8bd4a`
- `test/e2e/reportsLiveEntry.ts`: `absent`
- `knip.jsonc`: `6593b3da379b900b330a7c1e3fc44dcd6fad9883b66dfde5bc212670a57c67a6`

### usage

Exit 1; named failures: R9, R10, R11, R12, R13, R15, R20. Restored hashes:

- `src/core/usage/reportUsage.ts`: `3fc60e0725d4a820df4055052ce0f06072e0dd286ea3139f5157edb2fd10b80f`

### generation

Exit 1; named failures: R2 every engine. Restored hashes:

- `src/runtime/reporting/engine.ts`: `ff108a2526b845319a39215f3986bab1c8621335563c6b0d20b89d441a493a90`

### controller

Exit 1; named failures: R14, R16. Restored hashes:

- `src/host/conversation/conversationController.ts`: `2e1bbc37f3b767ccf997a725fcd430f1630be923bf603a5a44efac323a5fea22`

### panel

Exit 1; named failures: R16. Restored hashes:

- `src/extension.ts`: `a2afdae339e5e9523fdf567ea54ab8eb25202215d8f57fdf426248ed8554057f`

## Verification

Pending final clean suite and scoped gate receipts. Aggregate quality belongs
to the lead under the rig/common brief; no commit is proposed as fully gated
until the lead runs it. No platform/native-editor certification is claimed.

The primary-backend tests use existing validated AgentHost ports and a fake
runtime at the e2e bundle boundary. They never start a model turn or require
credentials. Stored reads and journal tests use isolated real temporary
folders under the lane's disk-backed TMPDIR.

The initial full controller run passed 713 tests but four existing native
review setup groups stopped before admission. The collector's empty-filter
inventory expects Node `code`, while the production Git runner now exposes
`exitCode`. The native ownership fixture declares an inactive filter driver
so its complete real-Git admission cases exercise their intended ownership
contract without changing production guards. Final results follow below.

Two attempts at a VM-only runtimeReports test stopped under the common
rule: report-history storage was misbound, then the journal directory was
unbound. That approach was abandoned. The retained public ACP integration
and actual-main CLI e2e replace it. An accidentally overlapping exploratory
Vitest run was immediately terminated (exit 130); it is not counted as proof.

Honest unavailable data remains a supported result: approvals are not retained,
per-tool journal usage is not recorded, rollups lack session attribution, and
historical budget snapshots are not retained. These are explicit rows, not
assigned review findings left open. Current budgets appear where their observed
UTC day intersects the chosen period; no historical budget is invented.
