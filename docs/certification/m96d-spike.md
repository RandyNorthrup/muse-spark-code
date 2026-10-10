# M96d design spike — C-M96d-1

2026-10-10, linuxlt, branch `c/m96d-1`, base `82d50d5e4`.
Read the rig brief, `codex/common.md`, the completion program's M96d
section, AGENTS.md, PLAN D75/M96c/M96d and the RVM96C2 report. The rig brief
overrides common.md's stale merge/off-host instructions: no merge, push,
rebase, full quality, subagents or live/paid model calls. No installs or
dependency, production-code, UI, translation or protocol changes.

## Delivery and acceptance boundary

The lane supplies the complete design spike in
[`docs/design/m96d-coordinator.md`](../design/m96d-coordinator.md), four
failing-first adversarial schedules, a test-only executable specification
and a real native endpoint counterexample. The helper is a policy model;
its trusted booleans/handle tokens are proof obligations, never simulated
production storage or native qualification. There is no production
coordinator in this change and machine mode remains unsurfaced.

| Acceptance                                                  | Evidence                                                                                                                                                                                    | State                                                |
| ----------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------- |
| Every release has a three-OS proof or an exclusion/fallback | Design §§1–5: keep all liabilities until exact, synced full-scope retirement; no endpoint/timer/user release; pre-enrolment window-scoped fallback; unsupported enrolled work stays blocked | Design specified; native adapters not certified      |
| RVM96C2 F1–F4 tests written before implementation           | First rejected test-only candidate: **34 failed, 19 passed**, 53 total. All four named findings failed; no production implementation added                                                  | Complete                                             |
| Red drills with byte-exact restoration                      | `m96d-spike/drills.json`: 41 intended failures, every source restored; all 66 final test names observed failing across drills                                                               | Complete                                             |
| Codex review with no P1 open                                | Author's full self-review below; independent acceptance remains lead-owned                                                                                                                  | Self-review complete; independent acceptance pending |
| Lead ruling / Claude host build handoff                     | Concrete conservative proposal below; no ruling has been received or invented                                                                                                               | Pending lead                                         |

## Failing-first tests and native evidence

The test file was written before its helper. The initial helper reconstructed
the four rejected release rules: endpoint error freed resources/elected a
successor; owner death freed pending launches; user confirmation freed the
frozen lander; coarse identity followed by numeric-PID dispatch authorised
the wrong process. The initial run failed 34 assertions across F1–F4.
After removing those rules, all initial 53 tests passed. Additional tests
cover reordered launches, positive retirement on each platform tag,
reference-field binding, invalid reference kinds, persistent terminal
outcomes, sync failure, restart authority and fallback under uncertainty.

The native endpoint test starts a real listener, establishes a connection,
unlinks the Unix socket path, sees a failed new connection and then receives
an echo over the original connection. Thus the same owner still executes
admitted work after its discovery pathname is missing. On Windows its native
branch closes the pipe listener and retains the existing connection. Only
the Linux branch ran here. macOS backlog/allocation refusal and Windows
pipe/handle/Job semantics were source-backed design constraints in that
original Linux receipt. The Windows correction below adds real busy-pipe
and Job/WMI counterexamples, while complete containment stays unqualified.
No FAT/exFAT/NFS device qualification ran here.

The final combined run passed **66 tests in two files**, zero failed or
pending, at repository timeouts. All 41 mutations exited 1 on their intended
named assertions; together they exercised every final test name. The restored
specification SHA-256 is
`4c11516dea3ba2d42320fbdfa6e778ad2d4e01f50855bcb185784e23580d4f97`.
No mutation used a filtered/skipped test run or a raised timeout. Private complete
logs and JSON reports live under this worktree's ignored `temp/m96d/`;
tracked drill hashes allow the lead to compare those receipts. No long
operation uses a raised timeout or named timeout exemption.

## Review record — one pass over every class

This is the author's Codex design/self-review, not an independent second
agent's approval. No subagent was spawned, as ordered. Findings were checked
against adversarial schedules and corrected before handoff; none is left
open in this review.

| Class                        | Finding/counterexample checked                                                                                                       | Disposition                                                                                                                                               |
| ---------------------------- | ------------------------------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Concurrency/lifecycle, P1 F1 | A missing/refusing socket or closed pipe can leave its owner alive; an anchor can become available while old work survives           | Contact changes reachability only. Qualified anchor controls grant issuance; durable old grants remain held                                               |
| Concurrency/lifecycle, P1 F2 | Unregistered child survives the owner; detached descendants evade a process list                                                     | Intent precedes spawn; held native creation precedes registration/resume. Every crash boundary retains liability; leader-exit-only proof refused          |
| Concurrency/lifecycle, P1 F3 | A freezes before rename, user confirms, B lands, A resumes                                                                           | No manual release. Pending rename retains exclusion even if a retirement assertion claims drained effects; old rename may finish while B remains excluded |
| Validation/security, P1 F4   | Subsecond collision, time-zone rendering or a query/signal PID race targets a different incarnation                                  | Exact native reference and complete secondary identity binding; pidfd/process-handle target only. macOS foreign numeric/group termination refused         |
| Validation/security, P2      | A writable Linux cgroup can permit migration; same-token but wrong process/platform proof; missing store is mistaken for first start | Native qualification must seal migration/launch rights; full reference binding tested. Unknown store blocks, including when no inventory can be read      |
| Concurrency/lifecycle, P2    | A deserialised old handle token could become a new process's handle number after restart                                             | Test-only restart drops reference authority but preserves grants and terminal tombstones. Production reattachment excluded until separately proved        |
| Failure paths/honesty, P2    | Unsupported storage or a missing helper selects window mode while a machine grant still acts                                         | Fallback only before enrolment. Existing/unknown liabilities block fallback and overlapping new work. Explicit repair never resets them                   |
| Failure paths/honesty, P2    | Green platform-tagged model tests are represented as native three-OS qualification                                                   | Tests/docs distinguish policy proof, the single Linux endpoint receipt, mechanism sources and outstanding native/editor runs                              |
| Docs/completeness, P2        | A model-worker-only macOS broker could be advertised as a complete machine worker/heavy-command feature                              | Full-mode qualification or the stated M96c window fallback; no partially coordinated machine-cap claim                                                    |
| Test lifecycle, P2           | On Windows, listener close could race acceptance of the old client used to demonstrate live work                                     | Await both connection and acceptance before making the endpoint unavailable; clean up sockets/listener/private temp directory                             |

Checked and found fine: secrets/paid boundaries unchanged; no outside code
copied; no guessed vendor wire shape; no new setting/command/reference row;
no dependency or lint suppression/cast escape hatch; no runtime feature
claim; all editor/OS omissions attributed to later lanes; roadmap source
and changelog move with the design; tests retain default deadlines.

## Verification

Scoped checks run directly on linuxlt, one compiler/test/build at a time:

| Check                                                     | Result                                                                                                      |
| --------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------- |
| Owned Vitest files, `--maxWorkers=3`, repository timeouts | 66 passed, zero failed/pending                                                                              |
| `npm run typecheck` (all five projects)                   | Exit 0                                                                                                      |
| ESLint on the three new TypeScript files                  | Initial nested-ternary formatting conflict; replaced with a typed reference-kind map, corrected lint exit 0 |
| `npm run deadcode` / `npx jscpd`                          | Exit 0 / exit 0, zero clones                                                                                |
| `npm run check:l10n`                                      | Exit 0, 14 UI and 14 usage tables, zero problems                                                            |
| `npm run check:host-api`                                  | Exit 0, zero problems                                                                                       |
| `npm run build`                                           | Exit 0, token/size/split/host-global/notice gates pass                                                      |
| `npm run check:reference`                                 | Exit 0, generated reference current                                                                         |
| `npm run check:plan`                                      | Exit 0, 207 milestones, zero drift                                                                          |
| Roadmap generation and freshness                          | Exit 0; repeated after final plan update                                                                    |
| Prettier on changed files                                 | Exit 0; repeated after final certification update                                                           |

Production sizes: activation **563,348 B (550.1/600 KiB)**, Model API
**528,186 B (515.8/525 KiB)**, checkpoint store **89,366 B (87.3/225 KiB)**.
No cap changed. `common.md` still says Model API 475 KiB; the current
`scripts/check-bundle-size.mjs` and PLAN D6's recorded lead decisions
(REL0160B/INT0170/CAPS017) use 525 KiB. This discrepancy is reported to the
lead rather than changing either gate or unrelated historical plan rows.

Prettier removed ESLint's nested-ternary parentheses. The structural repair
uses a compiler-narrowed `as const` map, not an escape hatch, and the unit
project and owned suites are rechecked after that test-only fixture change.
At the original Linux delivery, the specification and all 41 restored source
hashes were unchanged. Those historical receipts predate the Windows
correction; the current helper and restoration hashes are recorded below.
`verification.json` records the final receipt hashes; initial failed ESLint
and failing-first logs remain in `temp/m96d/` for inspection.

Full quality and native three-OS integration remain lead-owned under the rig
rules; neither is represented as passed here. The installed hook path is
`.husky/_`, with the repository's fail-closed stub; the local commit uses
explicit paths and its complete output is retained in a file. Re-read both
the staged and committed diff after the hook; never substitute the hook.

## Lead decision and next build

Recommended ruling: accept conservative retention, the absence of a manual
release/automatic orphan reclaim path, and the explicit macOS/Windows fallback when
complete no-escape execution cannot be proved. Authorise the Claude host to
implement C-M96d-2 behind an off/unsurfaced boundary until native anchor,
durability, containment and the every-editor receipts pass. Qualify the
permanent-anchor/store strategy before issuing any machine grant.

The lead must supply independent acceptance and an actual ruling; this
author cannot issue them. C-M96d-2 builds the broker, not this lane. All editor
rows remain: VS Code family, JetBrains, Visual Studio, Eclipse, companion
hosts (Zed, Xcode, Neovim, Emacs, Sublime), and ACP/headless; bindings depend
on C-M96b-1/C-M96c-1 and their host lanes. Native macOS and full
filesystem qualification remain unavailable; the correction below adds
Windows counterexample receipts without full native qualification. These
are recorded scope/qualification limits, not fabricated receipts or an
assertion that the complete M96d milestone shipped.

## RVCM96D1 correction — Win11, 2026-10-10

Lane `CM96D1W`, branch `c/m96d-1w`, base `dbbad4d8e`. Read the entire
RVCM96D1 report and the rig/shared rules. Its one P2 finding is corrected
through the explicitly permitted unknown/fallback boundary. There is no
remaining review finding, new dependency, production binding, paid/live
model call or machine-policy/account change. The existing design-spike
handoff and lead acceptance remain outside this correction's authority.

### Native experiments and selected boundary

The reproducible command is:

```powershell
npx.cmd vitest run test/unit/m96dCoordinatorSpike.test.ts test/unit/m96dCoordinatorEndpoint.test.ts --maxWorkers=3
```

The endpoint file embeds the complete native experiment: `powershell.exe
-NoProfile -NonInteractive -Command <windowsProbe>` compiles the C# P/Invokes
with `Add-Type`, starts a suspended root, assigns it to an unnamed Job with
only `JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE`, retains its handles, resumes and
waits for root exit. The root uses `Win32_Process.Create` for a writer held
at a file gate. The probe samples Job accounting, writer membership/token
and process-start tracing **before** opening the writer gate; it then
requires the late write and writer exit. This evaluates OS containment,
identity and tracing without model calls or unbounded background work.

| Experiment                                                                   | Real VM observation                                                                                                                                | Consequence                                                                                                |
| ---------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------- |
| No-breakaway Job + WMI writer                                                | Root exited; active Job count **0**; `IsProcessInJob(writer, Job)` **false**; writer remained alive, then wrote `late-write` after its gate opened | Job emptiness does not prove complete scope retirement                                                     |
| `CreateRestrictedToken(DISABLE_MAX_PRIVILEGE)` + `CreateProcessAsUser` + WMI | Same escape; root and writer kept the same user SID and logon LUID, with **1 privilege** each instead of the ordinary token's **24**               | Reduction is inherited in this measured case, but provides neither containment nor a unique scope identity |
| `Win32_ProcessStartTrace` subscribed before both launches                    | Both writer events observed; parent PID matched the live `WmiPrvSE` process and differed from the admitted root                                    | Events discover this work, but parent-tree attribution alone cannot associate it with its scope            |
| Closed pipe listener, original connected peer alive                          | Direct native file-open probe returns **EBUSY**; original connection still echoes; no successor election or overlapping grant                      | Endpoint failure remains discovery evidence only                                                           |

Both root/writer SID and logon equality are asserted from native token
queries. The restricted-token option satisfies the brief's identity
experiment without creating a dedicated local user or reading credentials.
No dedicated SID or fresh logon-session qualification is claimed. Those
would require a creation/effects gate as well as an inventory: a zero scan
cannot eliminate a queued provider request, service-owned identity or remote
effect. WMI returned the PID for controlled correlation here; arbitrary
tools need not expose it. WMI tracing was run natively; ETW's documented
lost-event/buffer accounting was evaluated as a limitation, not run as an
alternative containment mechanism.

The selected design explicitly leaves arbitrary Windows tools unqualified,
uses the complete M96c window-scoped fallback before enrolment, and preserves
`unknown` after enrolment. Registration records complete scope coverage
separately from the native root reference. Unknown coverage cannot be
overridden by an empty Job or an asserted effects drain; it survives restart
and cannot return finished or admit an overlapping B grant. Qualification
requires full scope coverage independently of functional Job/handle APIs.
The design's launch recipe, F2 proof, OS matrix, recovery/handoff language,
PLAN question/status, changelog and roadmap all state this boundary. The
sibling Linux cgroup row also explicitly requires service-mediated effects
closure rather than equating direct descendant sealing with complete scope.

Exploratory exclusions: direct `-File` execution encountered the VM's script
execution policy; the reproducible fixture uses ordinary inline `-Command`
execution without changing policy. A LUA-token variant could not produce
its result file and was not used as evidence; the successful documented
DISABLE_MAX_PRIVILEGE case is the selected experiment. The initial token
privilege buffer was too small and was corrected to 4096 bytes. `IsTokenRestricted`
reports restricting-SID state, not the privilege-count reduction, so the
final oracle queries `TokenPrivileges` directly. No failed experiment is
represented as a successful isolation proof.

The first owning-suite Win11 replay exposed the inherited endpoint fixture:
Node's pipe connect retries while the occupied pipe remains alive and hit
the unchanged repository **15 s Windows deadline**. A direct file-open
probe reached the kernel refusal; its first run returned EBUSY, correcting
the inherited Unix-only expectation. Final Windows assertions require that
specific busy-pipe error; Unix expectations remain unchanged. No timeout or
error guard was broadened. The rig brief mentions a generic five-second
deadline; the repository's existing Windows defaults are 15 s for tests and
30 s for hooks. Every run used those defaults, without `--testTimeout`.

### Red drills and exact restoration

Each drill ran **both complete owning suites** with the command above,
JSON reporting to `temp/m96d/red-<name>.json`, and no test-name filter, skip
or deadline override. Removing the coverage guard makes the native WMI
counterexample fail, proving the captured escape is detected by the revised
specification. The original/restored helper SHA-256 for every drill is:

`258791a8021b6d5ff3e528d41c44f324af9fb2b245d60d2e7b1253c601f436e7`

| Drill              | Deliberate break                                             | Named failing test(s)                                                                                      | Exit / failures | Damaged SHA-256                                                    |
| ------------------ | ------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------- | --------------- | ------------------------------------------------------------------ |
| scope-coverage     | Remove `record.scopeCoverage !== 'complete'` from settlement | `RVCM96D1 native: an empty Job leaves a WMI writer outside the scope` and all four weak-evidence schedules | 1 / 5           | `cc934e1cfccfe254eaa43ea014b77ad61867daafc5fae5f7078110724c0ca4f8` |
| scope-fallback     | Remove `prerequisites.scopeQualified` from mode selection    | `RVCM96D1: unproved scope coverage selects fallback only before enrolment`                                 | 1 / 1           | `d29e91d7e50a0d1d5c27c5e47df74efa9d0af35fea2bb32faa468930b39c0dd2` |
| unknown-outcome    | Return active for every nonterminal grant                    | Native WMI case, all four weak-evidence schedules and restart authority case                               | 1 / 6           | `194100ff37750939f7ae14c43e7c49c64235d74d85522e7c7119fef270d519f6` |
| restart-coverage   | Retain old complete-coverage authority across restart        | `restart invalidates old retirement authority while preserving unresolved grants`                          | 1 / 1           | `cb5135762c2e56ca7fad83312e5dbb953c2e1f1567a36e33e615b0b67821b436` |
| endpoint-authority | Permit election from unreachable alone                       | Native live-owner busy-pipe case and all 12 portable endpoint cases                                        | 1 / 13          | `5ffcde8e9de4d45bff54c029012d102bb3b415eb0e023d5b21db95b1c97e2fa1` |

Restoration writes the saved original bytes in finally and verifies SHA-256
before proceeding. Full drill names, runner outputs and JSON receipts remain
in this lane's ignored `temp/m96d/`; the table records every damaged hash.

### Win11 scoped verification and handoff

| Check                                                                     | Result                                                                                                          |
| ------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------- |
| Both complete owning Vitest files, repository deadlines, `--maxWorkers=3` | 72 passed (70 portable policy cases, busy-pipe receipt and native WMI/token/trace case), zero failed or pending |
| `npm.cmd run typecheck`                                                   | All five projects exit 0; unit project rechecked after final native-fixture cleanup                             |
| Changed TypeScript ESLint, `--max-warnings=0`                             | Exit 0                                                                                                          |
| `npm.cmd run deadcode` / `npx.cmd jscpd`                                  | Exit 0 / exit 0; zero clones across 2908 files                                                                  |
| `npm.cmd run check:l10n`                                                  | Exit 0; 14 UI and 14 usage tables, zero problems                                                                |
| `npm.cmd run check:host-api`                                              | Exit 0; zero problems                                                                                           |
| `npm.cmd run check:reference` / `npm.cmd run check:plan`                  | Exit 0 / exit 0                                                                                                 |
| `npm.cmd run build`                                                       | Exit 0; token, size, split, host-global and notice gates pass                                                   |
| Prettier on all nine changed files / `git diff --check`                   | Exit 0 / exit 0                                                                                                 |
| `npm.cmd run roadmap:generate` / `npm.cmd run check:roadmap`              | Exit 0 / exit 0; 207 entries, generated file current                                                            |

Measured shipped bundles are unchanged: activation **563,348 / 614,400 B**,
Model API **528,186 / 537,600 B**, checkpoint **89,366 / 230,400 B**. No budget
or gate changed. No visual surface changed, so there is no visual-baseline
update. No command, setting or runtime feature changed, so no new reference
row or translation key is required. Full quality remains the lead's gate
under the explicit rig/shared scope; it was not run or claimed here.

Initial lint feedback was fixed with awaited native open, safe replacement
callbacks and ordinary PowerShell block spacing; no suppression, cast or
rule change was added. Roadmap generation initially rejected the overlong
summary at its existing 260-character limit; the summary was shortened and
regenerated without changing that limit. The repository's normal
`npm.cmd run prepare` installed its prescribed fail-closed stubs in this
fresh rig worktree before commit; hook definitions and checks are unchanged.
Commit uses explicit paths with `.husky/_`, never a bypass or alternate hook.
