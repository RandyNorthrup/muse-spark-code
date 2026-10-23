# RLF-M107 — acceptance 15 (capped) and the platform rows

2026-10-22, Mac mini worktree `/Users/randy/lanes/RLF-M107`, branch
`rec/rlf-m107`, base main at 0.19.0 (`583c1a9f4`). No model call, no paid
call, no credential read. The Kubuntu rig and the Win11 VM are powered
off, so this lane measures on the Mac mini.

## Headline: the sandbox caps this lane at ~3 cores

This agent's process tree cannot use more than about 3 of the Mac mini's
12 cores, even with 12 spinning processes and 40% of the machine idle:

| Load from this lane | Machine total | Lane's share |
| ------------------- | ------------: | -----------: |
| 12 burners × 10 s   |         ~59%¹ |  3.25 cores² |
| 4 burners × 8 s     |             — |   3.0 cores² |
| 1 burner            |             — |     1.0 core |

¹ Baseline 42% plus 12 spinners holds the machine at ~59%; the idle 40%
is never soaked up, so this is a cap on this lane, not contention.
² From `/usr/bin/time -p` user/wall (12: 34.22/10.53 s; 4: 24.39/8.19 s).

Per the sandbox rule the full all-cores run stops here and rides outside
the sandbox: `node scripts/m107-owner-case.mjs` with its defaults (15
checks, CPU threshold 60, 10 burners) on a bare rig, the owner PC, or
hosted CI. What this lane delivers instead is an honest capped run at a
30% CPU threshold: the real governor trips on real load and holds 15
real checks to one per kind, with the event-loop and activation figures
recorded. The cap, the threshold, and the quota evidence above are part
of the figures, not footnotes.

## What ran

`scripts/m107-owner-case.mjs` (committed; knip entry, eslint clean) drives
the production governor bundle (`dist/resourceGovernor.js`, built from
this base) through the production path: `resourceGovernorHost` → `admit`
→ spawn → `register({pid})` → `complete`. Bounded harness leases use the
documented `isTempFree` path: the darwin temp-root helper is not built in
this worktree, and temp roots are not what acceptance 15 measures.

- Each check is one real bundle-verification pass: twelve production node
  entries bundled standalone in memory (26,313,741 bytes, byte-identical
  across all 30 runs in the capped measurement). It exits non-zero when
  the product is broken (drill D3).
- Warm-up is synthetic SHA-256 load in real children, labelled as such;
  it stands in for other agents' work while the governor trips.
- The second window's activation is a fresh process loading the
  production bundle and completing one foreground admission. A real
  second VS Code window needs a GUI session this rig has not got, so the
  GUI activation row stays pending with the full-scale run.
- Real repo checks (vitest 25 s, eslint 23 s, tsc 39 s per run on this
  rig) cannot serialize fifteen within throttle's fixed 60-second dwell,
  which is why the check is a ~2-second bundle pass. No product constant
  was touched.

Capped run command (receipt
[`rlf-m107-owner-case.json`](rlf-m107-owner-case.json),
`sha256:8077ba39…55f8cd`):

```sh
node scripts/m107-owner-case.mjs --cpu-threshold 30 --burners 12 \
  --burn-seconds 260 --receipt temp/rlf-m107/owner-case-capped.json
```

## Acceptance 15 figures (Mac mini, sandbox-capped)

Machine: Intel i7-8700B, 12 threads, 32 GiB, macOS 15.7.4 (24G517),
Darwin 24.6.0 x86_64, node v24.21.0, libuv 1.52.1. Baseline CPU 27.7%.
Idle activation probes: 97, 101, 107 ms. Governor settings echo:
`cpuMaxPercent 30`, every other threshold null, relocate off. No host
errors in either phase.

|                                       |        No governor (A) |           Governor (B) |
| ------------------------------------- | ---------------------: | ---------------------: |
| Checks completed                      |                15 / 15 |                15 / 15 |
| Wall                                  |                 16.3 s |                 30.1 s |
| Max concurrent (one per kind held)    |                     15 |                      1 |
| Per-check wall (min / med / max)      |       14.1/15.4/16.0 s |          1.6/1.9/2.0 s |
| Machine CPU peak (production sampler) |                  95.4% |                      — |
| Throttle engaged after                |                      — |                 31.0 s |
| Drain levels                          |                      — |           all throttle |
| Event-loop p50 / p95 / p99 / max      | 10.7/12.1/12.8/24.7 ms | 11.0/14.5/18.1/20.4 ms |
| Activation probe under load           |               1,841 ms |                 137 ms |

The event-loop figures include the 10 ms sampling quantum both phases
share; both phases stayed near it (no collapse either way). The
activation contrast is the result: at the ungoverned peak a second host
took 1.8 s to activate against 97–107 ms idle, while under the governor
it took 137 ms. Ungoverned concurrency also cost throughput per item:
each check took ~8× longer sharing the capped slice than alone.

Phase B's p95 (14.5 ms) reads slightly above phase A's (12.1 ms); the
run took place on a shared rig with other lanes active, and the 2.4 ms
gap sits inside that noise. It is reported as measured, not explained
away.

All eight assertions passed: `A-checks-pass`, `A-concurrent`,
`B-throttle-engaged`, `B-submit-at-throttle`, `B-checks-pass`,
`B-one-per-kind`, `B-held-throttle`, `B-drained-at-throttle`.

## Drills (all red shown, all restored byte-exact)

- **D1 — no admission.** The drain's `await host.admit(...)` replaced with
  a stub lease (one line). `--phase b` with the capped settings: exit 1,
  exactly `B-one-per-kind` fails with `maxWhileNonNormal 15`, the other
  five pass. Receipt
  [`rlf-m107-drill-d1.json`](rlf-m107-drill-d1.json)
  (`sha256:39225218…c5af83`). Restored to `0f519376…9629b4` (commit
  `ded8a5b26`), verified by SHA-256, tree clean.
- **D2 — unreachable threshold.** `--phase b --cpu-threshold 100
--engage-timeout-ms 45000`: exit 1, `B-throttle-engaged` fails with
  `throttle never engaged`, level `normal` throughout. Receipt
  [`rlf-m107-drill-d2.json`](rlf-m107-drill-d2.json)
  (`sha256:036b7361…85a28`). No file change.
- **D3 — the check is real.** Appended
  `import './nonexistent-m107-drill-target'` to
  `src/runtime/sharing/sharingEntry.ts`: `--check` exits 1 with esbuild's
  `Could not resolve` error. Restored byte-exact
  (`sha256:d470a2c9…ff70b6`, `git status` clean for `src/`); `--check`
  green again (26,313,741 bytes).

Two findings came out of the drills, both fixed in the harness with the
rerun green:

1. **`terminate()` hung on exited children.** Phase B terminates burners
   twice; the second pass attached a late `exit` listener that never
   fires, draining the loop into exit 13 instead of the assertion
   failure. Fixed (`316d97f33`): resolve at once when `exitCode` or
   `signalCode` is already set, checked after the listener attaches.
2. **Sequential graceful kills cost 60 s.** A starved sync loop never
   runs SIGTERM's handler, so 12 burners × 5 s grace held the load past
   the 60-second escalation window and the governor — correctly —
   refused every admission with `Resources: Paused`. The governor did
   its job; the harness was too slow. Fixed (`ded8a5b26`): burners die
   together by SIGKILL (a pure hash loop holds nothing worth flushing),
   and `B-drained-at-throttle` pins the drain's levels so a paused
   drain can no longer pass vacuously.

## Platform facts (this Mac; Kubuntu and Win11 pending)

Fresh capture, 2026-10-22 (this lane). The 2026-10-05 memory and
taskpolicy receipts in `m107-platform.md` stand; this table confirms the
machine and the current runtime, it does not replace them.

| Fact                 | Value                                                                                                    |
| -------------------- | -------------------------------------------------------------------------------------------------------- |
| CPU                  | Intel i7-8700B, 12 logical / 6 physical                                                                  |
| RAM                  | 34,359,738,368 bytes (32 GiB)                                                                            |
| OS                   | macOS 15.7.4 (24G517), Darwin 24.6.0 x86_64                                                              |
| Node                 | v24.21.0, libuv 1.52.1 (new headroom path; no helper child)                                              |
| `totalmem()`         | 34,359,738,368                                                                                           |
| `freemem()`          | 3,624,517,632 (≈ free + speculative pages, as in lane 0)                                                 |
| `availableMemory()`  | 15,918,588,704 (≈ free + inactive + speculative: 15,902,670,848 from the adjacent `vm_stat`, 0.1% apart) |
| `memorystatus_level` | 82 (not a byte fraction; lane 0's warning stands)                                                        |
| `taskpolicy`         | `/usr/sbin/taskpolicy` present, `-b`/`-B -p <pid>` supported                                             |

Kubuntu (cgroup v2 delegation) and Win11 (job CPU rate) rows stay
pending exactly as `m107-platform.md` names them: both machines are
powered off, and this sandbox cannot run a Linux or Windows probe.
Hosted CI or the owner PC owns them, plus the full-scale owner case.

## Editor matrix rows (verified 2026-10-22 against this base)

`docs/ide-compatibility/resources.md` stands; each row below was
re-checked on this base today:

| Host                                                            | Route                                                                  | State on this base                                                                                                                                                                                            |
| --------------------------------------------------------------- | ---------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| VS Code family, remote/WSL                                      | Status item, chip/popover, Resume now/Settings/Show resources, history | Bound: `museSpark.showResources`, `museSpark.resumeResources`, all eight settings in `package.json`; W chip and W-history records hold the harness evidence. Installed-GUI receipts still need a GUI session. |
| JetBrains, Visual Studio, Eclipse                               | MHP native widget + embedded chip                                      | Pending M104b–d: no MHP resource widget exists under `src/` today.                                                                                                                                            |
| Companion page                                                  | Shared React chip/controls/history                                     | Pending M104 B (same).                                                                                                                                                                                        |
| ACP clients (Zed, Xcode, Neovim, Emacs, Sublime, JupyterLab, …) | `/resources`, notices, resume, usage                                   | Bound (H–C1): `/resources` in `src/acp/resources.ts`, wired in `src/acp/agent.ts`. Per-editor client receipts open.                                                                                           |
| Terminal / TUI                                                  | `resources status/resume/history`, `usage resources`, `--json`         | Proven on the built product: `node dist/acp.js resources status` prints level, CPU, memory and the honest relocation sentence (exit 0).                                                                       |
| Headless / CI                                                   | Exec flags, v2 resource events, ledger                                 | Bound (H–C1): `--resource-governor on\|off` in `exec --help`; `createResourceExecSink` in the exec path; relocation refused. M80 live limits unchanged.                                                       |
| Traffic / tasks / paired devices                                | Deferred rows, Move to/Keep here, headroom                             | Waiting on M96/M96c/M100 ports (C2 rides RLF-TEAMCORE, R rides RLF-DEVICES).                                                                                                                                  |

## Lane ticks from existing evidence

The `docs/certification/m107-*.md` records (28 files) stand; each lane
below was confirmed present on this base (record + code + owning
suites). Nothing was re-implemented.

| Lane                | Record                                                      | Code on this base                                     |
| ------------------- | ----------------------------------------------------------- | ----------------------------------------------------- |
| S sampler           | `m107-s.md`                                                 | `src/core/resources/sampler/`                         |
| T trees             | `m107-t.md`, `m107-t2.md`, `m107-t3.md`                     | `src/core/resources/trees/`                           |
| G governor          | `m107-g.md`                                                 | `governor.ts`, `queue.ts`                             |
| A actuators         | `m107-a.md`                                                 | `src/core/resources/actuators/`                       |
| C1 wiring           | `m107-c1.md`                                                | `launchHost.ts`, `admission.ts`                       |
| U surfaces          | `m107-u.md`                                                 | `src/host/resources/resourceStatus.ts`                |
| H runtime/ACP/CLI   | `m107-h.md`                                                 | `src/runtime/resources/`, `src/acp/resources.ts`      |
| J journal           | `m107-j-journal-and-the-usage-page.md`, `m107-w-history.md` | `resourceHistoryRecorder`, `ResourcesSection` (bound) |
| C2 team slots       | `m107-c2-the-team-and-runners.md`                           | Waiting: rides RLF-TEAMCORE                           |
| R relocation        | `m107-r-relocation.md`, `cm1073.md`                         | Waiting: rides RLF-DEVICES                            |
| 0 contracts/strings | `m107-0.md`, `m107-strings.md`, `m107-platform.md`          | `src/shared/resources.ts`; `check:l10n` 0 problems    |

Strings: `check:l10n` reports 0 problems (14 tables). Budgets: measured,
not green — `npm run build` on the untouched base overshoots eight
budgets (see Residuals). The full gate is therefore not green, and this
lane claims nothing beyond its own evidence.

## Real use (this lane's own commands, all run)

- `node scripts/m107-owner-case.mjs --check` → 26,313,741 bytes, exit 0.
- `node scripts/m107-owner-case.mjs --probe` → `{"elapsedMs":119,…}` idle.
- `node scripts/m107-owner-case.mjs --phase b --cpu-threshold 100
--engage-timeout-ms 45000` → exit 1, engagement refused (D2).
- `node dist/acp.js resources status` → level, CPU, memory, relocation
  sentence, exit 0.
- `node dist/acp.js resources --help`, `node dist/acp.js exec --help` →
  resource rows shown, exit 0.
- The capped owner case (command above) → `OWNER CASE PASS`, exit 0.

## Gates

True exit codes (no pipe masking), final tree, repository's own timeouts:

| Gate                                           | Exit | Note                                                                                                            |
| ---------------------------------------------- | ---: | --------------------------------------------------------------------------------------------------------------- |
| prettier --check (touched files)               |    0 |                                                                                                                 |
| eslint --max-warnings 0 (harness)              |    0 |                                                                                                                 |
| npm run typecheck (all projects)               |    0 |                                                                                                                 |
| node scripts/check-l10n.mjs                    |    0 | 0 problems, 14 + 14 tables                                                                                      |
| npm run check:reference                        |    0 | current                                                                                                         |
| npm run check:host-api                         |    0 | 0 problems                                                                                                      |
| npm run check:roadmap                          |    0 | current                                                                                                         |
| npm run cycles                                 |    0 | no circular dependency                                                                                          |
| npm run security:audit                         |    0 | 4 advisories, 2 exceptions                                                                                      |
| npx vitest related scripts/m107-owner-case.mjs |    0 | no related test files                                                                                           |
| runtimeSharedGovernor suite (smoke)            |    0 | 13 passed                                                                                                       |
| node scripts/check-plan.mjs                    |    1 | **Base failure:** 3,724,712 bytes vs 3,565,158 budget; this lane adds only its status paragraph                 |
| npm run check:catches                          |    1 | **Base failure:** rises in `src/` files this lane never touches (scanner reads `src/` only; lane diff has none) |
| npm run duplication                            |    1 | **Base failure:** 5 clones in untouched files (jscpd scans `src/`+`test/` only)                                 |
| npm run deadcode                               |    1 | **Base failure:** unused file/exports/tags elsewhere; the harness is not flagged                                |
| npm run build                                  |    1 | **Base failure:** 8 bundles over budget, measured on the untouched tree (see Residuals)                         |
| security:sast                                  |    2 | **Environmental:** semgrep binary crashes at startup (`ca-certs: empty trust anchors`), before any scan         |

Not run here: vault suites (untouched by this lane), browser/GUI suites
(no session), the full unit battery (hosted CI owns it).

## Residuals (with the lead)

1. The full all-cores owner case at CPU threshold 60: blocked in this
   sandbox by the ~3-core cap (evidence above). One command outside it:
   `node scripts/m107-owner-case.mjs` with defaults.
2. The GUI second-window activation row: needs a GUI session.
3. Kubuntu cgroup and Win11 job rows: both machines powered off; hosted
   CI or the owner PC.
4. `npm run build` is red on the untouched base: eight bundles over
   budget (`dist/resourceGovernor.js` 126.8/125 KiB,
   `dist/resourceAdmission.js` 25.1/25 KiB, `dist/modelApi.js`
   533.3/525 KiB, `dist/reportInputs.js` 101.0/101 KiB,
   `dist/reportingPanel.js` 50.2/50 KiB, `dist/vaultActions.js`
   25.0/25 KiB, `dist/estimateContracts.js` 25.0/25 KiB, `dist/wire.js`
   75.9/75 KiB). Not this lane's scope; reported, never raised.
5. `node scripts/check-plan.mjs` fails on base: PLAN.md is 3,723,812
   bytes against the 3,565,158 archive budget (pre-existing; this lane
   adds only its status paragraph per the RLM107 precedent).
6. Per-editor installed receipts (VS Code GUI, Zed, Xcode, Neovim,
   Emacs, Sublime, JupyterLab, JetBrains, VS, Eclipse, companion):
   with their host owners / the lead's matrix.
7. C2 rides RLF-TEAMCORE; R rides RLF-DEVICES.

## Commits

- `66aa7a30d` — owner-case measurement harness.
- `316d97f33` — `terminate()` resolves for already-exited children (D1
  found it).
- `a685133bb` — warm-up trace, `--burn-seconds`, idle-probe wording.
- `ded8a5b26` — parallel instant burner kills, non-vacuous drain
  assertion (the pause-escalation incident).
- (docs commit below) — this record, the `m107.md` figures, the
  platform confirmation, the PLAN status paragraph, the three
  receipt JSONs.
