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
pipe/handle/Job semantics are source-backed design constraints, not claimed
native receipts. No FAT/exFAT/NFS device qualification ran here.

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
The executable specification and all 41 restored source hashes are unchanged.
`verification.json` records the final receipt hashes; initial failed ESLint
and failing-first logs remain in `temp/m96d/` for inspection.

Full quality and native three-OS integration remain lead-owned under the rig
rules; neither is represented as passed here. The installed hook path is
`.husky/_`, with the repository's fail-closed stub; the local commit uses
explicit paths and its complete output is retained in a file. Re-read both
the staged and committed diff after the hook; never substitute the hook.

## Lead decision and next build

Recommended ruling: accept conservative retention, the absence of a manual
release/automatic orphan reclaim path, and the explicit macOS fallback when
complete no-escape execution cannot be proved. Authorise the Claude host to
implement C-M96d-2 behind an off/unsurfaced boundary until native anchor,
durability, containment and the every-editor receipts pass. Qualify the
permanent-anchor/store strategy before issuing any machine grant.

The lead must supply independent acceptance and an actual ruling; this
author cannot issue them. C-M96d-2 builds the broker, not this lane. All editor
rows remain: VS Code family, JetBrains, Visual Studio, Eclipse, companion
hosts (Zed, Xcode, Neovim, Emacs, Sublime), and ACP/headless; bindings depend
on C-M96b-1/C-M96c-1 and their host lanes. Native macOS/Windows and full
filesystem qualification are unavailable on this Linux-only lane. These
are recorded scope/qualification limits, not fabricated receipts or an
assertion that the complete M96d milestone shipped.
