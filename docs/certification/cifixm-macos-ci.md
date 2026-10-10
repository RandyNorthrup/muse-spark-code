# CIFIXM — macOS CI repair, 2026-10-09

Scope: hosted run `37897298018`, base `bd2d617c8`, branch `rel017/cifixm`,
macbook rig. No paid/live calls, merges, pushes, gate reductions or raised
Vitest timeouts. Each test batch contains at most three files.

## Reporting process-probe fixtures

`checkRuns.test.ts` (all nine cases), `reportEngine.test.ts` (one of four)
and `reportNetworkBinding.test.ts` (one of two) fail before the repair:
`ReportStorage` cannot obtain its writer PID's birth identity because the
fixtures never install resource admission. Linux reads `/proc` directly;
macOS and Windows invoke a bounded OS probe. Product admission is unchanged.

The existing reporting runtime fixture now provides a launcher factory that
executes real, bounded OS probes directly and delegates other profiles to the
original governed launcher. Each owning file registers it before loading
storage. Disk persistence, confinement, malformed evidence, scrubbing,
serialization, cancellation and history assertions remain unchanged.

A first exploratory `beforeAll` spy did not work: history captures the
launcher at module load. A hoisted fixture mock corrects that boundary.
Final default-timeout run: **3 files, 15 tests passed**. The final post-commit `CI=true` run also
passes all fifteen at repository deadlines.

Red drill: route `contained` instead of `probe` to the fixture runner. All
three files fail again (11 failures). Restore the helper byte-for-byte and
compare SHA-256, then rerun the three files with repository deadlines.
Restored helper hash: `3a0c0e4a92279a17263a52fafb53897ff3fa7494397be1beb50c6d00d872c466`;
rerun: **15/15 passed**. Changed-file ESLint passed.

## Schedule platform fixture

The generic due-workspace case inherited `process.platform`, then always
expected foreground reconciliation. On macOS a wake intentionally closes
its engines without reconciliation: the independent after-exit helper owns
rearm. This is a wrong fixture expectation, not a scheduler product defect.

The case now runs explicitly as Linux, Windows and macOS and verifies the
appropriate rearm owner while retaining lease, control, engine and closure
assertions. Default-timeout result: **17/17 passed**. Red drill removes the
`!isMacWake` reconciliation guard: **3 failed / 14 passed**. Product source
restored byte-for-byte, SHA-256
`3b2ada291024b6cf663632a26f74903aa840398c332313d24b01b228bd350ceb`;
final rerun **17/17 passed**.

Commit `f3ffc6ce2` also captured this fixture edit made while its hook ran.
The mandatory committed-diff reread caught the extra file; history is kept
intact. Its verification and formatting are completed in `cb80df792`; the
post-commit CI-mode rerun also passes all seventeen.
Do not mutate the worktree while a hook-enabled commit is in flight.
`docs/orchestration-gotchas.md` G84 records the observed transaction hazard;
M96c/M116 product enforcement is future work, not certified by this lane.

## Native helper diagnosis

The brief's `113717543639` job is the aggregate **dictation helper (macos)**,
which fails in `require every selected-tier job`; it is not compilation.
Readable GitHub job metadata confirms actual compiler job `113711458248`
passed build, disclaim, permission-free recorder/resource checks and vault
verification. Local `bash native/darwin/build.sh` also passes: universal
Intel/ARM64 dictation/screen helper and vault, signatures and fourteen
localized permission resources. Native source needs no compiler repair.

Both job-log and run-log downloads return HTTP 403, “Must have admin rights
to Repository.” Readable job/annotation metadata contains no detailed static
gate error. Current checks and retained evidence gaps are recorded below.

## Final owning verification

- `npm run typecheck`: all five projects pass (host, webview, unit, e2e,
  integration), on the macbook rig.
- `npm run cycles`: passes, no cycles in 3,123 analyzed files.
- `npm run build`: passes generation, all unchanged size caps, split guards,
  host-global checks and notices. Activation **549.4/600 KiB**, Model API
  **515.8/525 KiB**, governor **106.1/125 KiB**, webview startup
  **742.3/900 KiB**, original deferred JavaScript **31.9/50 KiB**.
- First browser reproduction: `m114Panel.test.mjs` and
  `m114ConversationReview.test.mjs` both pass, **159 tests combined**, including
  Dracula's forced-colors `.steps-toggle` and menu/secret-dialog isolation.
  No product/UI/style change is justified by that result. The complete repeat
  also passes **159/159** (89 conversation, 70 panel cases), slowest case
  **3.064 s**, with the same deadlines and assertions. A third full run with
  `CI=true`, alongside scheduleRuntime, passes **176/176**; browser maximum
  **2.894 s** and schedule maximum **15.94 ms**. The final reporting batch
  adds **15/15**, totaling **191 unique owning tests**, all passed.

Hosted static job metadata shows a failed combined gate step after about
nineteen minutes, not a compiler failure or job timeout. The hosted head is
`f5e0760c3`; the lane base also includes `12e3ef638` (shared command-hook
fixture removes duplication) and `bd2d617c8` (four admission/launcher import
cycles removed). `docs/certification/rel017int.md` records those already-owned
root fixes. A private temporary archive of that exact CI head reproduces:

- `npm run cycles`: **exit 1**, all four admission/launcher/helper cycles.
- `npx --no-install jscpd`: **exit 1**, the 10-line/51-token clone inside
  `modelApiLoopGuarantees.test.ts`.

The private snapshot was removed immediately after both checks. Both root
fixes are already in the lane base; no integration-owned source was edited.
The current static results follow. The inaccessible hosted log prevents
claiming which error its combined step printed first. The exact
static/panel/conversation error text was requested asynchronously; none was
available before handoff.
Local Node is **26.0.0**; hosted jobs use Node **22**. Browser is installed
Chrome **154.0.8037.98**; Vitest uses repository default deadlines.

## Current static and native checks

| Check                     | Exit | Result                                                                                   |
| ------------------------- | ---- | ---------------------------------------------------------------------------------------- |
| Whole-tree format         | 0    | Original pass; final changed docs get their own formatting check                         |
| Split ESLint, CSS lint    | 0    | All source, unit and other test partitions; 349.72 s total                               |
| PowerShell lint           | 0    | Repository's normal macOS skip; real check belongs to Windows                            |
| Tokens                    | 0    | 0 problems                                                                               |
| Localization              | 0    | Fourteen UI and usage tables; 0 problems                                                 |
| Reference                 | 0    | Current                                                                                  |
| Host API                  | 0    | Current inventory                                                                        |
| Plan                      | 0    | No drift                                                                                 |
| Roadmap                   | 0    | 207 entries; generated file current                                                      |
| Dead code                 | 0    | No finding; existing knip configuration hints only                                       |
| Duplication               | 0    | 0 clones                                                                                 |
| Badges                    | 1    | Remote JSON parse sees gzip magic bytes (`Unexpected token`), no gate changed            |
| Synthetic screen recorder | 0    | No privacy permission requested; bounds, finalization, sleep and conversion cleanup pass |
| Screen resources          | 0    | Signatures, tamper refusals and all fourteen localized permission descriptions pass      |
| Screen disclaim           | 0    | `--screen-only` probe confirms relay responsibility without requesting access            |

Badge transport needs verification in the lead's network-permitted environment;
its failure does not authorize a transport shim or weakened parser. Full quality
and complete coverage/integration suites remain delegated by the explicit shared
brief. There is no green release claim.

## Planning and next slice

`PLAN.md` §7 records this repair scope; 0.17.0 remains preparation, unpublished.
M114 retains its existing planned status and integrated-pixel certification
requirements. No feature, setting, command or release label changes.
The reporting/schedule slice and final CI-mode owning runs are certified.
Next integration slice: fetch these local commits, replay hosted macOS at
Node 22, resolve the badge transport and obtain
the exact browser failure traces if they recur. Existing Linux/Windows owners
and CIFIXV retain their assigned repairs and baselines. The lead owns combined
quality and release certification; no gate is waived.
