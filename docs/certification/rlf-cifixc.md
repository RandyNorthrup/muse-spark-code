# RLF-CIFIXC — hosted CI run 41516831678: everything left on macOS and Ubuntu

Base: `lanes/cc-winfix2` (`rec/rlf-cifixc` at `87d424f57`), then
`git merge --no-ff rec/rlf-cifixm` first, as briefed. Run 41516831678
on the base without CIFIXM: 40 passed, 19 failed, 6 cancelled
(`~/lanes/_ctx/ci-41516831678/`). Everything below ran on the Mac
mini rig with CI's Node (`temp/node22`, v22.23.4 portable; the
machine default is v24). Tests: `npx vitest run <files>
--maxWorkers=3`, repository timeouts (no `--testTimeout`),
`TMPDIR=$PWD/temp/t` for the short socket paths.

## The merge

`rec/rlf-cifixm` (6 commits over merge-base `97beeba6e`) merged as
`9ea2cfbbe`. One overlap: `test/unit/runtimeMakerStop.test.ts`.
Ort took CIFIXM's route around the CLI entry (drive
`stopRuntimeMachines`); CC-WINFIX2's product fix (the entry takes
the LAN policy its deps carry) makes the entry route work, so the
resolution `1e36c7fd8` restored driving `stop-machine --all`
through `runRuntimeMaker` with its full assertions. Green here:
14 passed. One staging slip to know about: the PID helper commit
rode into the firmware commit `0a5ed35ae` (it was still staged
from a hook-refused attempt); contents are the two files named in
their sections below, history left as written.

## Item 1 — the jobs that are not test shards

### quality (all three OSes), package (.vsix), dictation helper (macos)

No step of their own exits 1. Each log ends at the required-names
aggregator (`scripts/rule2-gate.mjs` door 1): `CHECKS=success`,
`INTEGRATION=success`, `HELPER=success`, `PACKAGES=success`,
`UNIT=failure`, `ACCESSIBILITY=failure`, and the door refuses.
These five jobs go green when the unit shards and the
accessibility job do; there is nothing else inside them to fix.
Verified by reading all five job logs end to end.

### accessibility (WCAG 2.2 AA)

44 pages without a result (11 scenes × 4 themes), 2 rules
violated on 61 elements, 1 undecided. Four distinct causes, all
reproduced here in real Chrome (`ui:look` + a CDP probe):

1. **Maker approvals self-rejected — harness wrong.** The dialog
   binds consent to the payload's SHA-256 and rejects on sight
   when its own digest of the rendered bytes differs
   (`store.previewRendered`). The fixture sent `'a'.repeat(64)`.
   Probe evidence: `makerAnswer … "decision":"reject_once"` in
   the harness outbox within a frame of the approval landing.
   Fixture now carries the real digests (`6dc6da…` for
   `M104 S190`, `06eb7d…` for the `00ff` bytes), matching the
   browser suite's own `createHash` practice. `maker-approval`
   renders (screenshot read: dialog shows the same SHA-256).
2. **Devices/log scenes clicked Stop — harness wrong.** The
   toolbar's first buttons are the Stop slot's; the fixed pair
   (Devices, Log) comes last. The scenes now click from the end.
   All seven maker scenes render in `ui:look`.
   (`modes-hardware` was the same family plus a mis-cased label:
   `'Permission mode: Manual'` vs the product's
   `'Permission Mode: Manual'`; fixed to wait by real label —
   commit `ff2311166`.)
3. **Help never rendered — product wrong.** Console:
   `Error: English surface is not loaded: makerTitle`. The Help
   page reads catalog keys dynamically through the generated
   reference model, invisible to the build's `UI_TEXT.<key>`
   scan, so deferred keys no deferred load installs (the maker
   group) stayed throwing getters on the fallback table.
   `scripts/lib/uiTextRegions.mjs` now puts reference-named
   deferred keys that no other deferred load installs into the
   Help closure. Naming _every_ reference key there put the help
   reference bundle at 52.3 KiB against its 50 KiB budget; the
   uncovered-only set fits (build green, budgets unchanged).
   `help` and `readme-help` render (screenshot read).
4. **Contrast + label-in-name — product wrong.** `.models-panel
:where(button,…)` and the same reset in `judgeSetup.css` tie
   `.models-button-primary` at class specificity and win by
   bundle order, painting primary buttons inherited body colour
   (#3b3b3b on #005fb8 = 1.77:1) — measured through CDP matched
   styles, computed white after the fix. Both resets are now
   zero-specificity (`:where(.panel)`), as a reset should be.
   The pool order button's accessible name now carries its
   visible `position · label` whole (WCAG 2.5.3).

Local gate, same command CI runs (`npm run test:a11y`, Node 22),
three full runs: violations 61 → 10 (the judgeSetup reset, then
fixed) → **0 rules violated on 0 elements**. What still makes
the local exit 1: 10–14 pages without a result per run, a
different scattered set each time (rig load averaged 50–70 from
sibling lanes against the 10 s ready budget; the same scenes
render singly in `ui:look`), and one undecided rule (next
paragraph). CI's dedicated runner decides the no-result pages.

Left open by name: the undecided rule is node-terminal's xterm
contrast (28 elements, pre-existing in run 415 at 22). Axe reads
a 1:1 ratio on the terminal rows: the terminal theme chain
(`--vscode-terminal-background` → `--ms-code-surface` → Canvas)
lands on Canvas in the harness, so this looks like the node
surfaces' theme-bridge gap rather than a colour choice. It is
outside this lane's brief (the maker scenes) and the gate
deliberately fails undecided results; it needs its own lane with
the node-surface theme wiring in hand. Do not sort it into
`a11yIncomplete`'s unseen set to silence it.

## Item 2 — the failing files on macOS and Ubuntu

### judgeLocalDarwinPid (e2e, macOS shard 10) — test helper wrong

Reproduced: 135 s, `native PID cycle did not produce evidence`.
Reuse needs the kernel PID counter to wrap ~100k and land back on
the watched PID; one fork/kill loop makes ~1k attempts/s under
load (measured: PID 77631 → wrap → 4305 in 25 s), past the
child's 110 s bound. Four burner children now advance the same
counter in parallel and stand down within 4000 of the target.
After: green in 40 s (25,928 parent attempts). Bounds unchanged.
(Rode in commit `0a5ed35ae`, see the merge note.)

### deviceWorkerHostNative (Ubuntu shard 2, 15 cases) — test wrong

Every launch died at the inhibitor 'ready' wait
(`deviceWorkerLinux.ts:357`), and the probe case read the
product's own `selfTest()` as false. The suite gate probed
`systemd-inhibit --list`, which answers without logind granting
anything; the launch takes a block `sleep:idle` inhibitor, which
the runner's sessionless host never grants — exactly the hosts
the product itself refuses (`native.selfTest` path). The probe
now takes that inhibitor over `/bin/true`, so the suite runs
exactly where the product can. Product right. Linux-only: not
runnable here; proof is the product's own refusal recorded in the
CI log plus hosted CI.

### makerLease (macOS shard 13) — test wrong

Passes here before and after (753 ms → 865 ms). In CI the case
hit the 5 s test deadline at 5052 ms with a stray
`lease-helper-timeout`. Its internal waits already sum past the
default (deps' 5 s ready bound + node parent + waiter + 5 s death
wait), and a holder that never became ready pended invisibly on
the entered signal until the deadline hid the cause. The entered
wait now races the holder, and the case carries a named 20 s
bound for its three real process starts. Assertions unchanged.

### makerReviewBrowser (macOS shard 4; Windows shard 5 other case)

16/16 here, including the CR-scroll case the Windows run failed
(that half stays CC-WINFIX3's). The macOS failure was the
worst-case-search tick-gap: 158 ms against the 100 ms bound on a
3-vCPU runner. The metric is a 5 ms `setInterval` gap, which
measures OS scheduling as well as main-thread blocking; search
runs in a worker and Stop answered every time. Three repeat runs
of the 20,000-row case here under multi-lane load pass. No code
change: the bound is a product responsiveness budget and raising
it is not this lane's to do; if hosted CI reproduces it on its
3 vCPUs, the metric (not the budget) is what a later lane should
make scheduler-proof.

### makerSerial (macOS shard 8) — test wrong (relay lifetime)

Both socat cases failed while Ubuntu passed: posix-raw
unavailable in 954 ms, stty read 0 bytes. The peer side was held
open the whole case and survived; the device side was opened and
closed once by the stty setup before the session started, and on
macOS that last slave close ends socat's relay pairing — proven
pieces here: the raw helper alone prints `serial-ready` against
a real PTY on this machine; the suite green here with the socat
cases skipped by name. **Sandbox block:** `brew install socat`
(the install CI itself runs) is refused on this rig
(`Operation not permitted` on Homebrew's lock), so the relay form
cannot run here; per the rig note that part stops and the lead
or hosted CI runs it. The case now holds the device side open
until it ends, as real hardware stays present (holder never
reads; session still owns input).

### nodeOsAddons (Ubuntu shard 2) — product (check script) wrong

The live case ran 100,131 ms and exited 2: one fetch to
snapshot.debian.org with no deadline, held by a tarpitting
service. `checkFirmware.mjs` now bounds each attempt at 10 s,
three attempts with backoff (HTTP answers never retried).
Measured after: live and transcript modes both `all 7 packages
resolve`, exit 0.

### pathGuardSpawns (macOS 3, Ubuntu 2) — record wrong, product right

Two drifts in the reviewed-spawn record: `projectIoWindows` lost
its `WINDOWS_PSMODULEPATH_SEGMENTS` anchor when CC-WINFIX2 moved
the reader onto `windowsPowerShell` (anchor + reason now name
that launch); `hardwareContext.ts`'s SERIALCOMM registry read
(absolute SystemRoot `reg.exe`, SystemRoot-only env, no shell)
was never entered and is now reviewed in with the program as
anchor. Suite green here (7 passed).

### portalRecord (Ubuntu shard 1) — test wrong

The case sliced the accumulated dbus-monitor text at
`member=CreateSession`, got −1, and asserted on a newline. Its
wait only needed a `ServiceUnknown` _anywhere_ in that text,
which the earlier probe case had already put there, so nothing
waited for this call to be printed. It now snapshots the offset
and waits for its own call and answer. The helper was right
throughout (its exact `unavailable` line was asserted and passed
in CI). Linux-only; hosted CI decides.

### resourceForkProtection (Ubuntu shard 5) — product wrong

CIFIXA's open item, cause found in
`src/core/resources/trees/linux.ts` as briefed. Both cases
stopped their floods yet `bound.errors` held `the stopped job
was not observed done`: `registry.kill` aggregates member
results with `refused` outranking `done`, and
`LinuxTreeSource.signalNow` read any failure of its second
containment read as refused — so a member that exited between
the two reads (a flooding process's ordinary end) refused the
whole stop. It now classifies from a fresh read, as the macOS
source already does, refusing only while the same process is
alive. The same vanish left an empty `/proc/<pid>/stat` read,
which `stat()` threw as invalid and the registry mapped to
refused; an empty read is `gone`. Proof here is bounded by the
rig: no `/proc` (a Docker run was declined at approval; brew was
sandbox-refused), so the red is runs 41214393586 + 41516831678,
the local green is the macOS fork suite + `resourceTreeFailures`
unaffected, and the Linux green is hosted CI's to give.

### teamModelsFirstPaint (macOS shard 2) — fixed by CIFIXM, verified

CIFIXM moved the Models bundle build into global setup. Green
here after the merge (10 tests across its run with the vault
file; the file itself passed).

### vaultStoreScope (macOS shard 16) — CIFIXM fixes verified as far as the rig lets

Pre-CIFIXM CI died in `beforeAll` (keyring binding unstaged:
`unsupported-binding`). Post-merge here the fixture passes that
whole stage (setup + snapshot) and fails later, at client start:
`probeVaultIdentity → No access`. The sibling
`posixVaultPanelFlow` — green in run 415 — fails identically on
this rig with a short TMPDIR, while the `muse-vault-peer`
binary answers correctly from a shell. That is this lane
sandbox's governed-exec boundary, not the suite: with the lane's
152-char TMPDIR both suites skip by name (socket fit), which is
how CIFIXM saw them. Hosted CI decides the POSIX broker case;
the Windows 180 s case in CC-WINFIX2's record is the same
fixture family as the cancelled shards below.

Also seen and left: connectorServe and devicesPhase2Harness
(Windows shard 5) are Windows-only by construction — CC-WINFIX3.

## Item 3 — the cancelled shards

Method: vitest shards by `sha1('/' + path)` order and runs
largest-first within a shard (fresh-cache sequencer); file
parallelism is off on hosted macOS/Windows. Replicating the
assignment locally matched every completed file in every
cancelled log (8/8, 12/12, 172/172 spot checks), so each shard's
hung suite is the next file after its last completion:

(How each ended: macOS 14 last completion 20:27:15, cancelled
20:38:40 — 11 silent minutes. Windows 3 similar. Ubuntu 7
finished 183 of 184 files.)

| Shard      | Hung suite                                 | Cause                                           |
| ---------- | ------------------------------------------ | ----------------------------------------------- |
| macOS 14   | judgeP2Delivery (next after nodeLifecycle) | ~280 full split-gate runs at collection (below) |
| Windows 14 | judgeP2Delivery (same position)            | same                                            |
| Ubuntu 7   | judgeP2Delivery (only unfinished file)     | same                                            |
| Windows 3  | vault/credentialMigrationStore             | Windows broker fixture warm retry               |
| Windows 6  | vault/windowsVaultPanelFlow                | same fixture                                    |
| Windows 9  | vault/windowsBrokerClient                  | same fixture                                    |

**judgeP2Delivery — test wrong, fixed.** Collection spawned
~280 full `check-bundle-split` runs (measured 11.8 s each idle
here; the gate TS-parses all 195 bundles — profile: typescript
scan/visit + reads, no single hotspot to fix). No test ever ran;
the shard sat silent to the job limit. The gate lists every
problem per run, so each mutation family now plants all of its
mutations, runs once, and asserts every line: 6 split runs, same
assertions, per-target/per-parent lines now named in full. A
gate still running at 3× its loaded measure (180 s; `vsce ls`
300 s from its 117 s loaded measure) is killed and the control
fails instead of holding the shard. Green here (31 passed);
wall time on this saturated rig is dominated by other lanes —
on CI's dedicated runners the six runs are ~12 s each by the
idle measure. Red/green: the previous form also passed once
here in 1101 s — that duration _is_ the defect.

**Windows vault shards — named for CC-WINFIX3, left untouched.**
`startWindowsBrokerFixture` warms the broker with an unbounded
`for (;;)` connect-retry (its comment cites "the hook has no
time limit of ours, owner 2026-10-16", which the recovery rules
since supersede: failure retries keep a bounded, named limit and
then stop and say why). Suite hooks do carry
`WINDOWS_HOOK_TIMEOUT_MS = 30_000`, yet the shards still went
silent for ~15 minutes after the last completion, so the loop
plus broker teardown/worker exit is where it wedges — Windows
hardware decides the exact seam. A test must fail, not hang:
bound the warm loop (named attempts inside the product's launch
budget) and make dispose settle even when no connection ever
succeeded. This is precisely the red nobody held in CC-WINFIX2
§9 (there: vaultStoreScope's Windows case, 180 s).

## Gates (Node 22.23.4, this rig)

Exit codes, run on the final tree (last source edit built and
committed before each was read):

- `npx prettier --check` on touched files + this record: 0
  after formatting this record. `npx eslint --max-warnings 0`
  on touched code: 0. (Two hook refusals along the way were
  fixed at cause: an unnecessary parameter, an eslint env name,
  an iterator-preference + regex-spaces pair.)
- `npm run typecheck`: 0.
- `node scripts/check-l10n.mjs`: 0 problems.
- `npm run check:reference`: 0. `check:host-api`: 0.
  `check:plan`: 0. `check:roadmap`: 0 after the changelog entry.
  `npm run check:tokens`: 0 problems.
- `npm run check:catches`: 0 (baseline unchanged; the firmware
  retry catch classifies REPORTED as before).
- `npm run duplication`: 0 clones. `npm run cycles`: 0.
  `npm run deadcode`: 0.
- `npm run build`: 0, every budget holds (after the help-keys
  narrowing above; the first form was 2.3 KiB over and was
  narrowed, never the budget raised).
- `npm run test:a11y`: exit 1 locally with 0 rules violated —
  the undecided node-terminal rule and load-scattered no-result
  pages above, both named. Hosted CI is this gate's judge.
- Failing set together at the end (≤3 files per run, Node 22):
  judgeP2Delivery 31 passed; runtimeMakerStop, pathGuardSpawns
  and harnessInit 23 passed; makerLease + makerSerial +
  resourceTreeFailures 50 passed / 2 skipped (socat absent);
  resourceForkProtection + teamModelsFirstPaint +
  makerReviewBrowser green on re-run (first concurrent attempt
  under load 50+ failed 7 across the three heaviest files, then
  passed whole); judgeLocalDarwinPid (e2e) + nodeOsAddons 14
  passed; vaultStoreScope 1 failed (sandbox identity probe,
  above) / 1 passed / 3 skipped.
- `npx vitest related` for the changed sources
  (`trees/linux.ts`, `PoolEditor.tsx`, `judgeSetup/steps.tsx`):
  the graph is effectively the whole suite (1472 files, 30,967
  passed). Its 38 red files classify as: this rig's sandbox
  (vault suites, `providerHeadersStore` keychain), this lane's
  `temp/t` sitting inside the worktree so "outside a repository"
  cases found the parent repo (`gitMetadata`, `worktreeCommands`,
  `judgeB2Baseline`, estimator — all green re-run with outside
  temp), live-machine probes disagreeing under load
  (`resourceProbesDarwin` GPU cross-check, governor level cases),
  `vsixCompression` (pinned zopfli not installed here), load
  timeouts, and two real regressions of mine that are fixed
  above (`browserUiText` vault key, `teamRolesSection` button
  name; both green after, 105 tests together).

## Drills (red → green, observed)

- judgeP2Delivery: CI cancelled ×3 → local 1101 s pass (defect
  shown) → 6-run form green; first sized bound (120 s) killed a
  real 117 s `vsce ls` and failed loudly at collection — the
  bound was re-sized from that measure, not the gate weakened.
- judgeLocalDarwinPid: 135 s red here (CI's exact error) → 40 s
  green with burners.
- Accessibility: maker-approval never ready in `ui:look` →
  renders after fixture digests (screenshot read); help threw
  `makerTitle`, then `makerEnableHardware` → renders after the
  Help-closure fix (screenshot read); primary button computed
  rgb(59,59,59) → rgb(255,255,255) on the same blue.
- pathGuardSpawns: CI red on both anchors → green after record.
- check-firmware: CI 100 s exit 2 → live exit 0 after deadline +
  retries (transcripts 0 before and after).

## Not done here, by name

- Windows cancelled shards 3/6/9, connectorServe,
  devicesPhase2Harness, makerReviewBrowser's Windows CR case,
  vaultStoreScope's Windows case → CC-WINFIX3 (lead's PC).
- Linux-only proofs (deviceWorkerHostNative, portalRecord,
  resourceForkProtection, makerSerial socat cases,
  vaultStoreScope POSIX broker case) → hosted CI on this branch;
  local blocks were: Docker declined at approval, Homebrew
  refused by the lane sandbox, governed-exec identity probe
  refused by the lane sandbox. Docker Desktop was started on the
  Mac mini while attempting a Linux reproduction and could not
  be quit from the sandbox (AppleScript privilege violation);
  it is still running for the lead to close.
- makerReviewBrowser's 100 ms tick-gap metric: green here ×4;
  if it recurs on 3-vCPU runners, make the metric scheduler-
  proof (do not raise the bound).
