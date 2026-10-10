# CIFIX017 — 0.17.0 hosted CI repairs

## Round 2, Linux and macOS

Authority: `CIFIX017L2.rig.md`, its original rig brief and shared
`codex/common.md`; resumed on Kubuntu from `a0b3f55c9` on 2026-10-09.
The predecessor's uncommitted shared-package helper copy was reviewed against
`build.mjs`, `build-linux-helper.mjs` and `package-acp.mjs` before retention.
No thresholds, deadlines, gates, baselines or hooks are relaxed. Aggregate
quality belongs to the lead under the bounded rig brief (PLAN §7); this lane
runs scoped checks. No paid/live call, merge, rebase, push or subagent.

Downloaded all five requested failed-job logs with the read-only `gh run view
--repo RandyNorthrup/muse-spark-code --job <id> --log-failed`: unit jobs
113988955097, 113988954932, 113988955057, 113988955244, and installed-agent
macOS job 113990120445. Local logs are in ignored `temp/cifix017l2/`.

### 1. Native created-path fixture

Cause: the global production build generates `native/linux/<arch>/muse-created`,
but the suite copy kept only `dist` from that build. A clean source tree has
no native binary. The exec fixture then wrote only inert foreign-platform
helpers and skipped its missing current Linux architecture. ACP's separate
fixture already compiled the actual created-path protocol.

Fix: preserve generated Linux helpers when copying the shared build; extract
ACP's existing native builder into `test/e2e/createdHelperFixture.ts`, used by
both fixtures. Exec builds a missing current-platform helper from the same
reviewed C source. On macOS this replaces unrelated universal Swift dictation
and screen-recording compilation with the existing C created-path dispatch
used by ACP's fixture. Foreign-platform inert bytes remain test-only.

Linux receipt: complete `execStdio.e2e.test.ts` and `acpStdio.e2e.test.ts`,
`--maxWorkers=3`, repository defaults: **57/57 passed**, 143.02 seconds.
Red receipt: remove the inherited shared-helper copy, run the complete exec
suite: **32 passed, 12 skipped because suite setup failed**, exit 1,
`Required Linux created-path helper is missing: native/linux/x64/muse-created`.
No skipped-test change was made: these are Vitest's setup-failure descendants.
Restore the handoff file byte-exact: SHA-256 before/after
`c43b5066033621ac0e3983ab224e176f73adc0b8bcb683f68d563db7cab0b520`.
Logs: `native-red.log`, `native-green.log`.

### macOS access

The explicitly requested `ssh -o BatchMode=yes -o ConnectTimeout=10 macmini`
route refused with **Host key verification failed**. No SSH trust setting or
known-host file was changed. An approved route or lead-run macOS receipts were
requested while Linux work continued. Local Linux receipts do not certify
macOS; remaining platform receipts will be recorded here explicitly.

### 2. Visual setup and resource-history disposal

Hosted setup causes are explicit in the failed stack frames: stability's
first hook runs `scripts/build.mjs --production --webview-only`; readiness's
first hook creates a persistent Chrome profile and starts the browser. Both
spend their ten-second hook budget on cold process/compile work under hosted
CPU contention. Stability also invokes the exceptional-fixture builder even
for an ordinary scene. The history disposal case obtains admission from a
real machine sampler whose probes have a five-second budget, equal to the
case deadline, and whose machine pressure can queue admission.

Fix: register visual stability and conversation review with the existing
shared production build. Start one real Chrome server in global setup, before
workers, selected only for owning suites; each suite/scene owns a separate
context. Global setup stages stability's complete source/output copy; no
capture mutates the shared build. Ordinary capture scenes compile no unused
exceptional fixtures. Keep every scene, state, origin, raster and pixel
assertion. The disposal test scripts only the machine sampler and retains
real admission, disposal, filesystem journalling and the one-minute assertion.

Rejected setup path: copying a capture root inside a timed hook. The first
incomplete copy lacked the harness's unit helpers; adding those exposed the
copy's own ten-second deadline. Stop that timed-copy path: global setup now
owns staging before workers. The harness's estimator imports its JSON DAG
fixture too, so a capture source copy carries the complete test input tree,
not a guessed list of fixture subfolders. None of these setup failures was
accepted as a passing receipt or addressed by a longer deadline.

Linux receipt: complete readiness, stability and history-review files at
repository defaults, **40/40 passed**, 36.57 seconds (`setup-green.log`).
The unchanged pre-fix visual/conversation batch also passed **93/93** on this
Linux rig in 123.56 seconds; Linux did not reproduce the hosted macOS
cold-start failures.

Disposal red drill: replace only `await state.flush?.()` in
`src/core/resources/admission.ts` with a no-op. The complete history-review
file exits 1: **35 passed, one failed**, precisely the window-disposal
one-minute assertion (received zero lines). Restore byte-exact, confirmed by
`cmp` and SHA-256 before/after:
`3bd7f777d238af0fb2939f9c9dde9b01d4f5d46402b24014757d516ce7124ebe`.
Log: `history-red.log`.

Browser infrastructure drill: close the shared Chrome server immediately
before workers connect. Readiness exits 1 with `browserType.connect:
WebSocket error: connect ECONNREFUSED`; all three descendants are skipped by
failed setup, not by a test edit. Restore byte-exact with `cmp` and SHA-256
`91a496192bb25d1c09880dfa21003010b53dc3b7ce82df0773b7af406ca26365`.
Log: `browser-red.log`.

### 3. Conversation review setup and state measurement

The review now reads the same globally built production webview as the
packaging suites and connects to the pre-started browser. Its direct
component contrast fixture has no fake-host scenario timers, so it waits for
the real component mount and advances 100 ms instead of running 6.5 seconds
of unnecessary animation-frame callbacks. Actual scenario pages retain
6.5 seconds of scenario advancement, pause further timer progression during
measurement, and wait for deferred controls to settle. Before comparing
hover/pressed screenshots, advance paint callbacks: a computed style is not
a compositor-frame receipt.

No CSS, token, outline expectation, screenshot comparison, contrast threshold,
state, theme, viewport or baseline changes. Linux: the complete conversation
review and both lazy-load owners pass **92/92**, 155.32 seconds
(`conversation-green.log`); the previously slow light contrast case takes
1,473 ms. Every six-theme/narrow forced-colour feedback assertion remains.

**Platform limit:** neither the original nor repaired review fails on this
Linux rig. These setup/measurement corrections are verified here, but the
macOS-only 3 px outline and equal-image failures cannot be declared closed
without macOS replay. No speculative product CSS change is made.

Pressed-feedback drill: append a forced-colour active rule with a one-pixel
outline at the hover offset. The complete review exits 1: **66 failed,
23 passed**, including the actual control two-pixel assertions in all six
themes. Restore `styles.css` byte-exact with `cmp` and SHA-256 before/after
`e546b30b35aae47762bc1260746ac2883463f0f5d2e988f257096f248807275e`.
Log: `pressed-red.log`. The restored complete conversation and lazy-owner
batch passes **92/92**, 127.85 seconds (`conversation-final.log`).

### 4. Lazy import rejection: caught, not unhandled

The downloaded logs identify `resourceChatLoad.test.tsx` and
`AppPaletteLazy.test.tsx`. Both pass in the hosted jobs. React explicitly
reports that `SurfaceBoundary` caught the error and will recreate the tree.
The jobs have no Vitest unhandled-error summary for these messages. A throwing
Vitest import factory adds its generic mocking advice to the rejected import;
React's development `defaultOnCaughtError` prints that caught error.

The same complete owners pass locally, displaying the scoped failure and
invoking the product's saved-state retry. No test catch, console suppression,
product error swallowing or blanket rejection listener is introduced.

Red proof: make `SurfaceBoundary.getDerivedStateFromError` retain `failed:
false`. Both failure-path tests fail (**two failed, one passed**) and Vitest
reports **one actual unhandled error**. This is observably different from the
original handled-error logs. Restore `DeferredSurface.tsx` byte-exact with
`cmp`; SHA-256 before/after
`5e437aea8c23d69b3d1c56315ed7fdca3b31223a020eb833d4fc928e3bd6a306`.
Log: `lazy-red.log`. The boundary was already the product's correct rejection
owner; no product fix is warranted by the downloaded evidence.

### 5. M118 ACP timeout: request-stage diagnosis

Both hosted macOS logs identify only the test's thirty-second deadline, not
the pending request. The complete ACP suite passes on Linux before changes.
Installed SDK inspection rules out an awaited disconnect: `connectWith`
uses `runUntil`, whose `finally` calls synchronous `close()` after the
operation resolves. Prompt storage's exclusive write lock refuses rather
than waits; the schedule watcher uses a timer rather than a filesystem
watch. None of these inspections proves the macOS hang's cause.

Add failure-only fixed stage words around initialize, each session/new,
save/list/use/help and connection completion. Retain the SDK stream, every
request, assertion and deadline. No frames, stderr payloads, paths or
credentials are printed. This diagnostic runs in both source-built and
installed-package cases; it is not represented as a timeout repair.

Red drill: throw immediately after selecting `session/new (second workspace)`.
The complete ACP suite exits 1 (**12 passed, one failed**) and prints exactly
`M118 ACP last awaited stage: session/new (second workspace)`. Restore
`acpStdio.e2e.test.ts` byte-exact with `cmp` and SHA-256 before/after
`361162afe8b1d48d155ffd605fbbe1aefa0d967ea5167ce12a941196e00c9d9c`.
Log: `acp-stage-red.log`. A macOS replay remains required to identify the
actual pending operation; no speculative backend or governor change is made.

Restored Linux receipt: complete ACP stdio file, **13/13 passed**, 22.34
seconds (`acp-stage-green.log`), with the unchanged thirty-second case deadline.

### Final Linux qualification

Executable revision: `cf9f4967599f0bdf80c8e106b1a185843cba3f07`.
All runs below use `npx vitest run <complete files> --maxWorkers=3` directly
on Kubuntu, without a timeout override or test-name filter. The concluding
commit changes this certification record only.

| Complete files                                           | Passed | Duration | Local receipt            |
| -------------------------------------------------------- | -----: | -------: | ------------------------ |
| visualReadiness, visualStability, resourceHistoryReview  |     40 |  33.80 s | `setup-final.log`        |
| m114ConversationReview, resourceChatLoad, AppPaletteLazy |     92 | 127.85 s | `conversation-final.log` |
| acpStdio.e2e                                             |     13 |  22.34 s | `acp-stage-green.log`    |
| runtimeChatGptPackage, webviewBundle, execStdio.e2e      |    103 | 134.20 s | `package-consumers.log`  |
| visualCapture (existing persistent-browser capture path) |     11 |  56.73 s | `capture-default.log`    |

**259 distinct tests in eleven complete files passed.** This includes every
changed test file and the consumers of the shared package/capture helper.
The earlier combined native fixture run also passed 57/57 (143.02 s).

All twelve scoped gate commands exit 0 (`gate-results.tsv`): five-project
`npm run typecheck`; changed-file `eslint --max-warnings=0` and Prettier;
`npm run deadcode` (plain knip); `npx jscpd` (zero clones);
`npm run check:l10n` (14 UI tables, zero problems); host API (zero problems);
reference, tokens, plan, roadmap and `npm run build`. The build includes the
unchanged bundle-size, split, host-global and notice gates. Roadmap remains
current; no milestone heading, status, limit or release record changed.

Measured build: extension **550.1/600 KiB**, Model API **515.8/525 KiB**,
checkpoint store **87.3/225 KiB**; browser startup plus static imports
**742.2/900 KiB**, original deferred JS **31.9/50 KiB**. These are the existing
checked-in size gate's caps, not cap changes. Product source, CSS/tokens,
dependencies, baselines and CHANGELOG have no diff from the starting revision.
No product behavior change needs a changelog entry.

| Deliberate break                               | Observed failure                                 | Restoration                 |
| ---------------------------------------------- | ------------------------------------------------ | --------------------------- |
| Remove inherited shared native helper copy     | Exec suite setup rejects missing Linux helper    | SHA-256 identical           |
| Omit admission disposal flush                  | One-minute journal assertion fails               | `cmp` and SHA-256 identical |
| Close shared browser before worker connections | Readiness setup reports ECONNREFUSED             | `cmp` and SHA-256 identical |
| Make forced-colour active outline match hover  | 66 pressed-feedback assertions fail              | `cmp` and SHA-256 identical |
| Disable DeferredSurface's failed state         | Two retry tests fail; one actual unhandled error | `cmp` and SHA-256 identical |
| Throw at the second ACP session/new stage      | M118 fails and names exactly that stage          | `cmp` and SHA-256 identical |

Every completed piece was committed with the installed `.husky/_` hook;
ESLint/Prettier and gitleaks passed. Staged and committed diffs were re-read
after each commit. Owned failed-run fixture directories were removed; ignored
worktree temp output is about 2.3 MiB. No package was published or branch pushed.

### Required macOS completion

There is **no macOS receipt** in this round: the named route fails SSH host-key
verification and the named Windows-host rig wrapper is unavailable here.
The route/lead-run request remains unanswered. Before closing the macOS
findings, run these complete batches on an approved macOS checkout:

```sh
npx vitest run test/e2e/execStdio.e2e.test.ts test/e2e/acpStdio.e2e.test.ts --maxWorkers=3
npx vitest run test/unit/visualReadiness.test.mjs test/unit/visualStability.test.mjs test/unit/resourceHistoryReview.test.ts --maxWorkers=3
npx vitest run test/unit/m114ConversationReview.test.mjs test/unit/resourceChatLoad.test.tsx test/unit/AppPaletteLazy.test.tsx --maxWorkers=3
npx vitest run test/unit/runtimeChatGptPackage.test.ts test/unit/webviewBundle.test.mjs test/unit/visualCapture.test.mjs --maxWorkers=3
```

Also run the complete ACP stdio suite with `MUSE_ACP_PACKAGE_DIR` set to the
approved installed candidate, as `hosts.yml` does. If M118 still times out,
the new fixed-stage line identifies the pending request for the next drill.
The macOS-only 3 px/equal-image failures and M118 pending operation remain
open, rather than being inferred closed from Linux timings. Aggregate
quality and the hosted cross-platform replay remain lead-owned under the
explicit rig brief and PLAN §7's qualification record.

## Round 3 (CIFIX017R3)

Lane CIFIX017R3, 2026-10-09: branch `rel017/cifix3` from `6597210bb` (PR #145),
on the lead's Windows 11 host with vitest on kubuntu, the Mac mini and the
win11 VM. Digest: CI run 37992331755 and Hosts run 37992331263 (agent
package jobs). No timeout, cap, tolerance, budget or pixel policy changed;
no test skipped or filtered in a committed file; hooks `.husky/_` with the
fail-closed stubs (`npm run prepare`); commit output went to files. One
download: Node 22.23.3 for darwin-x64 (nodejs.org, SHA-256 checked against
SHASUMS256.txt) into `~/gates/tmp-cifix3-node22` on the Mac mini, to measure
the runtime CI uses; nothing installed globally.

### 1. Visual regression: What's New scenes

All six theme shards stop at their first over-allowance frame, each
`whats-new/whats-new/default/<theme>/320` (16,233-20,173 changed pixels),
after regenerating the `53fb033b4` baseline in Chrome 154.0.8037.97. Between
the manifest revision and this branch, the capture inputs changed only in
`CHANGELOG.md` (the 0.17.0 Highlights of `a343f2538`; the other added
bullets are under Unreleased, which no What's New page renders), harness
timing/caching code and non-webview `src` files. The six-theme job was not
cancelled: it failed by design at `test "$SHARDS" = success`.

Reviewed visual update: on kubuntu (Linux, Google Chrome 150.0.7871.186)
from committed source `6636c84be` (capture inputs clean),
`npm run check:visual -- --update --review=CIFIX017R3-0.17.0-highlights-2026-10-09
--archive=/var/tmp/cifix3-visual/candidate` captured all 9,792 frames
(446,949,451 bytes outside Git) and wrote the manifest. In the same browser
the `53fb033b4` baseline was captured from a source snapshot, as check:visual
regenerates it, and every frame compared under the unchanged pixel policy:
1,251 byte-different frames; **72 over the allowance, all `whats-new`** (six
themes, both widths, all six states), with exactly CI's counts at 320 px
(light 16,530, dark 16,609, hc-dark 20,173, hc-light 18,913, one-dark-pro
16,233, dracula 19,559); the other 1,179 frames in 89 scenes have at most one
counted pixel (17 in total), within the policy; no applied-state, target or
renderer coverage changed. Inspected pairs (light 690, dracula 320) differ
only in the two corrected Highlights (Capacity estimates (preview);
Orchestrator playbook in the ACP agent and the CLI) and the reflow below
them; `whats-new-highlights` shows the first Highlight only and is within
the policy. Receipt: `cifix017r3-visual-review.json`. The manifest's
revision is `6636c84be`; later commits change no capture input that renders
(an Unreleased changelog entry, tests, docs). visualGate, m114Audit and
readmeShots pass 36/36 on kubuntu with the new manifest.

### 2. `usagePackaging` lacked the launcher's C#

Cause: three suites run `scripts/package-acp.mjs` over a test-owned source
tree, each with its own hand list of native files; CIFIX017W2 updated two
of them. Fix: the packager's native inputs move to
`scripts/lib/acpNativeSources.mjs`; `test/unit/helpers/acpPackageSources.ts`
lays out every listed file, the runner helpers and the list module itself;
all three fixtures use it. `acpPackageFixtures.test.ts` finds every test
that runs the packager over a temporary tree and fails one that does not
use the helper or names a job source itself. Commit `ec2a1353c`. On the
win11 VM the guard first timed out (24.7 s against 15 s): it opened all
1,570 test files, each scanned on first open in a fresh checkout. It now
lists candidates with `git grep --cached` and reads only those; the hand-list
drill still fails it (Mac mini). Commit `5f7cd085a`.

### 3. `visualStability`

Hook timeout (macOS): every `captureMatrix` call measured a rasterization
fingerprint inside its hook, a cold font-fallback page the suite never
reads. Mac mini under `taskpolicy -b`: the first hook spent 3.6-5.5 s there
and timed out at 10 s. Global setup now measures it once on the shared
browser and the suite passes it in; same policy and load: slowest hook
6.6 s, pass. Commit `24c93a1dd`.

Sub-pixel (Windows): Chrome carries MouseEvent client coordinates in whole
pixels (170.5, 170.7 and 170.2 all arrive as 170; kubuntu Chrome probe).
With Windows font metrics the passage centre is a half pixel, so the menu,
anchored at the event, sits 0.5 px from it. Not device scale (1) and not
product rounding. The assertion compares with the centre as the event
carries it, at the same precision. Commit `d240c75eb`.

### 4. `m114ConversationReview` forced colours

All failures are 5 s timeouts; no distinctness assertion failed, and the
owner's rule (pressed visibly distinct) holds. CIFIX017L2's paint flushes
are not the cost: the 14 `runFor(100)` calls of a case take 25-34 ms
(kubuntu). Each case drove seven controls (about 30 protocol calls and two
screenshots each): 2.0-2.5 s per case on Ubuntu in round 2, 2.8-3.6 s in
round 3, 4.3-4.7 s on macOS when passing; this run's runners were 19-45%
slower on the static gates as well. Each theme and control is now its own
case (every assertion kept): slowest of 42 cases 933-977 ms in a 4-CPU
loaded emulation (taskset, coverage, three workers) over four runs. Commit
`d7dc7a53d`.

The shared browser's Playwright server ran in vitest's main process; in the
same emulation one of six runs stalled the file's first three cases to 5 s
with it there, none of six with the server in its own process
(`reviewBrowserServer.mjs`). Commit `bacd08b93`. Supporting, not
conclusive, evidence; see "Not root-caused".

### 5. macOS shard 3

`visualCapture`: each of 24 scene hooks launched its own persistent Chrome
and fingerprint; launch 0.72-2.1 s and fingerprint 0.19-0.26 s of each
1.6-2.9 s hook on the Mac mini, and under `taskpolicy -b` its build hook
alone exceeded 10 s. It now uses global setup's staged build, shared browser
and fingerprint; its CSP case writes under that root (the fixture cache is
keyed by root). Mac mini 11/11 in 37.2 s (59.4 s before). Commit
`6636c84be`.

`m114Panel` "loads the real lazy menu independently of the secret modal
focus owner": the file's first case, 5.0 s on hosted macOS (the second case
4.3 s, the rest 0.8-2.4 s). Not reproduced: 1.3-1.4 s on the Mac mini, also
under `taskpolicy -b`. No change made.

### 6. `reportHistory` pending tombstone (macOS)

Cause: the releasing writer listed and read the candidate's retired lease
tombstone while the candidate was unlinking it; lstat (or fstat through the
open handle) returned the name with no links left, `regular()` refused it as
unsafe, the release threw and the live lease stayed until the candidate's
2 s deadline. Reproduced on kubuntu with 0-3 ms jitter on the suite's fs
calls (1 of 40 and 1 of 150 runs, about 2,050 ms, as on CI); instrumentation
showed `lease-<uuid>` with nlink 0. Fix: fewer links than a stored file has
means absent (ENOENT), for both reads; hard links are still refused. Commit
`ac9a3460e`.

### 7. `planReader` ten thousand milestones

Not a regression: HEAD parses as fast as `8bbe763dd^` and faster than at the
case's introduction (`883f7e843`), kubuntu, interleaved cold runs. The case
is one cold sample under V8 block coverage in a three-worker shard. Removed
redundant work: two full splits and fence matches per line, three heading
matches per line, a whole-plan UTF-8 encode, a character walk with no
registered literal, and empty-field matches. In vitest with coverage on
kubuntu the case takes 110-112 ms (153-161 before); this repository's
PLAN.md cold parse 195-211 -> 171-173 ms plain, 357-362 -> 253-254 ms under
coverage. Output unchanged. Commit `296fe337b`.

### 8. ACP M118 (macOS)

Stage: "session/new (second workspace)" in both macOS logs; "loads the real
question bundles" took 21.5 s there. Cause: Node 22.23.3 (libuv 1.51.0)
answers `process.availableMemory()` on Darwin with exactly `os.freemem()`
(Mac mini: 6,216,175,616 bytes both, 9.99 GB inactive beside them), unlike
Node 24.21.0 (16,297,594,880). On a busy 7 GB runner those free pages fall
under half the memory floor, the governor pauses at its first sample, and
every later governed spawn waits the 20 s foreground deadline. The sampler
now takes the figure only when it exceeds the free pages read around it;
otherwise unknown. Reproduced on the Mac mini under Node 22.23.3 with a
test-owned preload giving the agent 400 MiB of free pages: M118 fails at
30 s naming that stage and the bundle case takes 22.0 s; with the fix 13/13.
Commit `e4603d489`. The lead has since moved further M118 work to a
separate lane.

### 9. macOS static gates cancelled

The job hit its 25-minute limit at 25:18, 27 s into `check:host-api`: no
hang. Round 2 took 21.8 min; this run's macOS gates were all slower
(format 92 -> 135 s, `lint:js:main` 360 -> 421, `lint:js:unit` 535 -> 613,
unit typecheck 87 -> 143). Type-aware ESLint is 17.7 min of it (6.5 on
Ubuntu); ESLint threads are no option on a 7 GB runner (kubuntu, one
test/unit lint: 5.1 GB RSS single, 9.1 GB with two threads, 12.0 GB with
three). The job now runs three parts per OS with the same 25-minute limit;
`manifest.test` requires every leaf gate of `quality:gates` in exactly one
part. Commit `aa850de86`, standalone so it can be dropped.

### Red drills (each restored byte-exact, SHA-256 compared)

| #   | Break                                                | Rig     | Result                                                               | Restored SHA-256 (prefix) |
| --- | ---------------------------------------------------- | ------- | -------------------------------------------------------------------- | ------------------------- |
| R1  | `usagePackaging` back to its hand list               | kubuntu | guard fails (no helper) and packaging fails (no list module)         | `8e740b37612d3aea`        |
| R1b | add an entry to the shared native list (control)     | kubuntu | all three fixtures lay it out: 17/17                                 | `2d77fcff3e815c1b`        |
| R2  | each milestone parses the rest of the plan           | kubuntu | 10k case fails at 59,521 ms                                          | `bc23fbd90fdf9b96`        |
| R3  | original `history.ts`                                | kubuntu | both new mid-unlink cases fail, "could not be generated"             | `491c1f695accc0bd`        |
| R4  | original `machineSampler.ts`                         | kubuntu | the new free-pages case fails                                        | `d2066c3a1810b876`        |
| R4b | original sampler, Node 22.23.3, 400 MiB free pages   | macmini | M118 fails at 30 s, "session/new (second workspace)"; bundles 22.0 s | `d2066c3a1810b876`        |
| R5  | original capture and fingerprint, `taskpolicy -b`    | macmini | first hook: fingerprint 3.6 s, timeout at 10 s                       | `857e27f523b715b5`        |
| R6  | fractional passage centre (the old assertion)        | win11   | "expected 170 to be close to 170.5", as on CI                        | `ed7153f39f48ddd4`        |
| R6b | open the quote menu 3 px below the centre            | kubuntu | assertion fails, 169 vs 166                                          | `857e27f523b715b5`        |
| R7  | forced-colour `:active` with a 1 px outline at hover | kubuntu | all 42 split cases fail on the 2 px pressed outline                  | `e546b30b35aae477`        |
| R8  | drop `cycles` from the build part                    | kubuntu | `manifest.test` fails naming `cycles`                                | `b581996832b1a918`        |

### Receipts

kubuntu: acpPackageFixtures, usagePackaging, runtimeChatGptPackage 17/17;
execStdio 44/44; planReader, qualityLedgerPlan, genRoadmap, redact, feedback
and both scrub suites 283/283; checkPlan, reportContracts, reportFixtures,
resourceAcpPackaging, acpNpmReadme, execSchema, legalScanBundle 114/114;
reportHistory 37/37 with the 150-run jitter replica; sampler, samplerSystem
and the resource history, relocation and runtime suites 87/87;
visualStability, visualReadiness, visualCapture 15/15; manifest and
visualGate 52/52.

Mac mini: acpPackageFixtures, usagePackaging, runtimeChatGptPackage,
planReader, sampler, manifest, reportHistory, execStdio 205/205;
reportHistory with the jitter replica 187/187; acpStdio 13/13 (Node 24) and
13/13 under Node 22.23.3 with low free pages; m114ConversationReview,
visualStability, visualReadiness 129/129; visualCapture and visualStability
12/12; cyclesRoots, whatsNewContent, checkBadges 63/63.

win11 (files one at a time, as on Windows CI): acpPackageFixtures,
usagePackaging, runtimeChatGptPackage 17/17; reportHistory, planReader,
sampler 104/104; visualCapture, visualStability, m114ConversationReview
137/137 (the review browser server as a child process on Windows);
manifest 40/40; visualStability 1/1 (the original assertion fails there as
on CI).

Static (host): changed-file ESLint and Prettier; host, unit and e2e
typechecks (unit reports only the known `museCodeSdk142.test.ts` mismatch
of the shared `node_modules`); actionlint; `check:roadmap`; `deadcode`
(plain knip, the two existing configuration hints); `jscpd` (zero clones);
`check:host-api` and `check:l10n` (zero problems).

### Not root-caused

- `m114ConversationReview` first-case slowness on hosted macOS (light axe
  case 5.03 s, dark 3.77 s): the browser-server move is supported by one
  stalled emulation run in six, not proven on a hosted runner.
- `m114Panel`'s first case (5.0 s on hosted macOS): not reproduced.
- In the 4-CPU emulation `playbookOutcomes.test.ts` failed eight cases in
  every run, outside this brief; it passed on hosted Ubuntu (43.9 s).

## Round 3, ACP M118

Authority: `/Users/randy/lanes/_ctx/ACPM118.rig.md` and shared
`codex/common.md`; macmini, branch `rel017/acpm118`, starting revision
`6597210bb`. No deadline, assertion, threshold, gate, hook or bundle cap is
changed. Aggregate quality and the hosted replay remain lead-owned under the
explicit rig brief. Zero model attempts, paid calls or credential-store writes.

### Hosted evidence and local reproduction

Read-only job metadata confirms that job `114030770563` failed at the
installed-package stdio suite and job `114029428611` is the failed macOS
shard 3 of run `37992331755`. The installed-package check annotation names
M118's thirty-second timeout. Both requested `gh run view --log-failed`
commands and the direct job-log endpoint return HTTP 403, "Must have admin
rights to Repository". The hosted last-stage line was requested but has not
been supplied; the matching local reproduction establishes the cause below,
while attribution to those hosted jobs still needs their replay/logs.

The Node 24.21.0/libuv 1.52.1 baseline passes 13/13 in 22.11 seconds. ACP plus
its runtime/ACP sharing owners passes 47/47 in 22.17 seconds. CPU-only
pressure with eight workers passes 13/13 in 37.96 seconds; twelve workers
passes in 56.35 seconds. Twenty-four workers pass in 93.41 seconds, but that
pressure ends before M118 completes, so this is not the decisive reproduction.
All pressure workers are owned, bounded and terminated in their launcher's
`finally`; no background work survives a launcher.

Installed Node 22.23.3 as a private test tool under ignored `temp/node22/`,
without changing repository dependencies or the machine's selected Node.
The arm64 binary install correctly refused on this Intel rig; the x64
binary is used. Node 22 alone passes 13/13 in 50.34 seconds, with a first
question test taking 22.32 seconds. Runtime version, rather than merely CPU
load, exposes the platform-memory difference.

With Node 22, a held 1,342,177,280-byte buffer (1.25 GiB) and four CPU-pressure
workers, the unchanged M118 requests reproduce the exact failure: **12
passed, one failed**, 101.10 seconds. Fixed-word temporary timing diagnostics
show initialize finishing at 569 ms, the first session finishing at 21,108
ms, and the second session starting at 21,281 ms. The case fails at 30,037
ms, printing `M118 ACP last awaited stage: session/new (second workspace)`;
its pending operation eventually completes at 41,535 ms.

During that run, the same machine reports:

| Runtime      | libuv  |  Free bytes | Available bytes |
| ------------ | ------ | ----------: | --------------: |
| Node 22.23.3 | 1.51.0 | 618,786,816 |     618,786,816 |
| Node 24.21.0 | 1.52.1 | 618,430,464 |  13,192,970,240 |

Cause: [Node 22's bundled Darwin implementation](https://github.com/nodejs/node/blob/v22.23.3/deps/uv/src/unix/darwin.c)
returns `uv_get_free_memory()` for available memory, counting free pages
alone. [libuv 1.52's corrected implementation](https://github.com/libuv/libuv/blob/v1.52.0/src/unix/darwin.c)
adds inactive and purgeable pages. The older API name masked an unusable
headroom measurement. D87 interpreted 619 MB as critical memory on this
32 GiB machine and delayed each foreground host admission for its existing
twenty seconds. Two cold hosts exceed M118's unchanged thirty-second test
deadline despite over 13 GB of reclaimable headroom.

### Repair and regression proof

At the shared OS sampler boundary, Darwin accepts available-memory readings
only with libuv 1.52 or newer; an older/unparseable version or an absent API
reports unknown headroom and memory-use percentage. No child probe or memory
estimate is added. Other platforms retain their current readings; usable
newer-Darwin readings retain their exact value. Admission, containment,
critical thresholds and real low-headroom handling are unchanged. This
portable sampler is shared by the extension, ACP and headless/runtime users.

D87, README and the ACP guide record the runtime limit. The feature catalog
marks memory thresholds as conditional on available headroom; the reference
is regenerated. M107's public entry records the limit and ROADMAP is
regenerated. The Unreleased changelog names the false pause repair.

The new OS-adapter matrix covers libuv 1.51, its last minor-boundary patch,
1.52.0, 1.52.1, a future major, an unparseable version, Linux and Windows;
another test covers an absent API. The fixture isolates Linux cgroup discovery
from the selected platform test; the complete existing sampler owner still
covers its real cgroup boundary. Before the fix, exactly the three older or
unparseable Darwin cases fail (three failed, ten passed).

Deliberately invert the new version guard: **six failed, eight passed**.
Restore `system.ts` byte-exact with `cmp` and SHA-256 before/after
`54a1438f06d5fdf26ea8b19e038d67b0319149fd2f33e3b87a6ff65eed2cac30`.
The complete sampler-system, sampler and runtime-resource owners then pass
**51/51**, 7.15 seconds. The temporary ACP timing instrumentation is also
restored byte-exact with `cmp` and SHA-256 before/after
`361162afe8b1d48d155ffd605fbbe1aefa0d967ea5167ce12a941196e00c9d9c`.
The ACP test has no committed diff.

The repaired Node 22 complete stdio suite under the same bounded buffer/CPU
workload passes **13/13**, 23.38 seconds; M118 takes **1,330 ms**. Free pages
were higher at this replay's admission (3.35 GB initially rather than 1.76
GB), so this is a workload replay, not an identical physical-memory state.
The deterministic guard regression supplies the controlled boundary proof.

Local receipts are in ignored `temp/`: `acp-baseline.log`, `acp-loaded.log`,
`acp-pressure-before.log`, `acp-pressure12-before.log`,
`acp-pressure24-diagnostic.log`, `acp-node22-before.log`,
`acp-node22-memory-before.log`, `acp-node22-memory-after.log`, the matching
pressure metadata and runtime-memory JSON captures, `sampler-before-red.log`,
`sampler-guard-drill-red.log` and `sampler-final.log`.

### Scoped gate receipts

All five projects in `npm run typecheck` exit 0. Changed-file ESLint and
Prettier exit 0; ESLint's preferred ordering of the pure guard operands is
applied after the byte-exact drill. One initial lint invocation unintentionally
overlapped the ending typecheck projects; subsequent test/build/gate commands
run sequentially. No gate, hook or environment override was used to obtain a
passing result.

Every command in `temp/gate-results.tsv` exits 0: plain knip, jscpd (zero
clones), localization (14 UI tables), host API (zero problems), reference,
tokens, plan, roadmap, dependency cycles and production build. The build's
size, split, host-global and notices gates pass. Existing budgets remain:
extension **550.1/600 KiB**, Model API **515.8/525 KiB**, checkpoint store
**87.3/225 KiB**, original deferred webview JavaScript **31.9/50 KiB**.
Complete reference-generator, reference-entry and sampler-system owners pass
**145/145**, 14.27 seconds (`reference-tests.log`).

G93 records the runtime-semantic qualification in the orchestration gotchas;
the original M107 platform capture links this follow-up. Node 22's private
tool install was moved from ignored worktree temp to an owned OS temporary
folder before the production-layout replay, following G30. Its path is
recorded in ignored `temp/node22-tool-path.txt`; no shared install is edited.
The standard `bash native/darwin/build.sh` exits 0 and builds the real universal
Darwin helpers for that replay (`native-build.log`); only existing Swift
Keychain deprecation warnings are printed. No helper permission mode is run.

### Production-bundle stdio replay

With `MUSE_ACP_PACKAGE_DIR` set to this worktree, the suite loads the standard
production `dist` bundles and real standard-build universal Darwin helper,
skipping its source-fixture bundling. On Node 22.23.3, with four CPU-pressure
workers and a held **4 GiB** buffer, all **13/13** cases pass in **24.87 s**;
M118 takes **1,500 ms**. The launcher caps its allocation at 4 GiB and records
3.51 GB of free pages after allocation; it does not claim the host reached
its requested lower-free-page target. Receipts:
`acp-production-node22-loaded.log`, `acp-production-node22-meta.log`.
This verifies production-bundle consumption, not an npm-installed tarball or
hosted Actions result; universal package/release qualification remains with
the lead.

Final repository-default receipts (no test-name filter or timeout override):

| Runtime / complete files                                      | Passed | Duration | Receipt                            |
| ------------------------------------------------------------- | -----: | -------: | ---------------------------------- |
| Node 24: ACP stdio, runtime sharing, ACP sharing              |     47 |  18.07 s | `acp-final.log`                    |
| Node 22: sampler system, sampler, runtime resources           |     51 |   8.00 s | `sampler-node22-final.log`         |
| Node 24: reference generator, reference entry, sampler system |    145 |  14.27 s | `reference-tests.log`              |
| Node 22 production bundles / native helper, loaded: ACP stdio |     13 |  24.87 s | `acp-production-node22-loaded.log` |

All 17 changed tracked files are staged explicitly for an installed-hooks
commit; the original ACP stdio test remains byte-exact. Full hosted Actions,
aggregate quality and an actual installed universal tarball remain lead-owned.

## Round 4, Windows

Authority: `C:/lanes/_ctx/CIR4WIN.rig.md` and `codex/common.md`;
lane `rel017/cir4win`, Windows 11, base/head before repair
`249218f4ee85b6d43dc5c61dcf283ea6d297527b`, 2026-10-09.
No test, assertion, deadline, threshold, tolerance, hook or dependency changes.
No paid/live calls, subagents, merge, rebase or push. Aggregate quality and
hosted replay remain lead-owned under the rig/common brief.

### Hosted evidence and loaded reproduction

Run [38018090551](https://github.com/RandyNorthrup/muse-spark-code/actions/runs/38018090551),
job [114112783549](https://github.com/RandyNorthrup/muse-spark-code/actions/runs/38018090551/job/114112783549),
Windows shard 5, Node 22.23.3. `gh api .../jobs/114112783549/logs` could
not run because `gh` is absent on this rig; the installed GitHub connector's
read-only job-log endpoint retrieved the same decoded log, saved to ignored
`temp/cir4win/hosted-job.log`. No credential was read or installed.
The first wide/light estimator case times out at `page.goto(ORIGIN)`, waiting
for `load` at the unchanged 2,000 ms limit. The other seven browser cases
pass (875–1,797 ms each); the full suite has 10 passes and one failure.

The harness already builds once in `beforeAll`, launches Chrome once, and
serves every page/script/style directly from its in-memory Playwright route.
There is no HTTP server start or network resource to wait for. It bundles
the raw English table, unlike independent production browser pages.
The shared chunk is **332,804 bytes**, including **295,657 bytes** from
`src/shared/l10n/en.ts`. Cold parsing/evaluation and the localization module's
initial `Intl` constructors run before the load event.

On this rig (Node 24.21.0/libuv 1.52.1, Chrome 153.0.8010.53,
ten logical CPUs, 32 GiB RAM), the unmodified
complete suite passes 11/11 in 28.63 s. An initial eight-worker memory/CPU
stress run also passes 11/11 in 305.31 s; its excessive setup contention was
reduced by limiting only the pressure process to four CPUs. This run did
not reproduce the navigation failure and is not a repaired-source receipt.

The controlled reproduction holds **4 GiB** in four real CPU workers and
uses Chrome's CDP **16× CPU throttling only for the first cold navigation**.
The throttling ends after that navigation; sustained worker/memory pressure
continues through every assertion. The complete file then reproduces the
exact hosted failure: **one failed, ten passed**, 25.16 s. Its route trace
delivers all static assets by 392 ms, but no `DOMContentLoaded` or `load`
arrives before the navigation times out at 2,006 ms. A CPU-profile replay
also fails at the same bound (24.90 s); it attributes about 788 ms to the
shared chunk's top-level work and 528 ms to its function constructing the
initial `Intl` formatters. Its assets arrive by 468 ms, with the load event
only at 2,146 ms after navigation begins. No timeout override is used.
The earlier 8× exploratory run passes; its load event arrives in 1,178 ms.

### Repair and byte-exact drill

`test/e2e/estimator.e2e.test.ts` now applies the existing
`compactBrowserEnglish` build plugin and targets Chrome 128, matching the
standalone production fallback. `scripts/lib/uiTextRegions.d.mts` declares
that existing plugin for the typed fixture. The complete canonical English
table remains inline; native DEFLATE/JSON decoding precedes dependent module
evaluation. That asynchronous initialization avoids blocking navigation on
the raw table and cold localization setup. The separate estimator-ready
wait still has its original **2,000 ms** bound, as do all browser actions.
The shared chunk falls to **148,995 bytes** (183,809 fewer; 55% smaller).
The panel remains lazy; all four themes, both widths, axe, keyboard flow,
overflow, drift, disabled provisioning and page-error assertions remain.

Under the same four workers, 4 GiB and first-navigation 16× throttling,
the repaired complete file passes **11/11**, 26.20 s. Its first navigation
finishes in **504 ms**, and readiness follows before its separate deadline.
Receipt: `loaded-throttled16-fixed.log` and
`timeline-throttled16-fixed.log`; original receipts:
`loaded-throttled16-original.log`, `timeline-throttled16-original.log`,
`profile-original.log`, `profile-original.json`.

Deliberately replace only `plugins: [compactBrowserEnglish]` with
`plugins: []`, then repeat the complete loaded reproduction. It fires the
original `page.goto: Timeout 2000ms exceeded`: **one failed, ten passed**,
25.35 s. Restore the repaired suite from its exact original bytes in
`finally`, and compare SHA-256 before/after:
`e6596c6a9934181e657a4a630254e8a02c519bdd57b840d3743d5d876c86c814`.
The hashes match and the buffers compare equal. Receipt: `drill.log` and
`drill-red.log`. Diagnostic instrumentation and pressure helpers stay in
ignored `temp/cir4win/`; none is shipped or committed.

The final **uninstrumented** repaired file passes **11/11**, 24.73 s, under
four continuously busy CPU workers and 4 GiB held memory, with about 12.1 GB
free at launch. Pressure is active before Vitest starts and remains until
it exits; the watchdog does not fire and all workers retire in `finally`.
This final run uses the repository's test/hook defaults and the unchanged
Playwright bounds, with no test-name filter, CDP throttling or override.
Receipt: `final-loaded.log` (`--maxWorkers=3`, one complete owning file).

### Scoped qualification

All checks ran directly in this Windows lane, one heavy command at a time:

| Check                                                                  | Result              | Receipt in `temp/cir4win/`                  |
| ---------------------------------------------------------------------- | ------------------- | ------------------------------------------- |
| `npm.cmd run typecheck` (five projects)                                | exit 0              | `typecheck.log`                             |
| Changed-file ESLint, `--max-warnings=0`                                | exit 0              | `lint.log`                                  |
| Changed-file Prettier check                                            | exit 0              | `prettier.log`                              |
| `npm.cmd run deadcode` (plain knip)                                    | exit 0              | `deadcode.log`                              |
| `npx.cmd jscpd`                                                        | exit 0, zero clones | `duplication.log`                           |
| Localization, host API, reference                                      | all exit 0          | `l10n.log`, `host-api.log`, `reference.log` |
| Plan, regenerated roadmap, cycles                                      | all exit 0          | `plan.log`, `roadmap.log`, `cycles.log`     |
| Direct complete estimator suite, repository defaults, `--maxWorkers=3` | 11/11, 23.94 s      | `final-direct.log`                          |
| Production build (tokens, size, split, host globals, notices)          | exit 0              | `build.log`                                 |

The final test command has no filter or timeout flag; the repository's Windows
defaults are 15 s per test and 30 s per hook. The Playwright navigation,
readiness and action bounds remain two seconds. `roadmap:generate` ran and
produced no tracked byte changes; milestone statuses and catalog features
are unchanged. No dependency or tool was installed.

Production sizes at the existing caps: activation **550.1/600 KiB**, Model
API **515.8/525 KiB**, checkpoint **87.3/225 KiB**, webview startup
**742.2/900 KiB**, deferred JS **31.9/50 KiB**, surface English
**24.3/25 KiB**, estimator engine **67.0/75 KiB**, estimator panel
**24.9/25 KiB**. No cap was changed by this lane.

Before the first commit, the worktree had Husky's original stubs without
the required fail-closed marker. The repository's unchanged
`npm.cmd run prepare` installer succeeded and installed its exact prescribed
stubs; `core.hooksPath` remains `.husky/_`. Receipt: `hooks-install.log`.
Explicit staging and the normal hooks apply to this five-file repair; commit
output is retained in `commit.log`, and the staged/committed diffs are reread
after the hook. These local Windows receipts do not claim a hosted Actions
replay or aggregate-quality result; both remain with the lead.

## Round 4, macOS (CIR4MAC)

Authority: `/Users/randy/lanes/_ctx/CIR4MAC.rig.md` and shared
`codex/common.md`; macmini, branch `rel017/cir4mac`, starting head
`249218f4ee85b6d43dc5c61dcf283ea6d297527b`. No deadline, tolerance,
assertion, theme, target, gate, hook or budget is weakened. The final changes
are test synchronization and case isolation; production source and visuals
are unchanged. Aggregate quality and hosted replay remain lead-owned under
the explicit rig brief. No subagent, merge, push, rebase, credential access
or paid/live model call; no tool or dependency installation.

Both requested read-only job-log endpoints for run `38018090551`, jobs
`114112783499` and `114112783564`, return HTTP 403, "Must have admin rights
to Repository". The alternate run-log read also returns 403. Hosted failure
names come from the brief; local evidence below does not claim a green
hosted release. Ignored logs, complete Vitest JSON and pressure samples are
under `temp/cir4mac/`.

### Target-size case cost and reproduction

The six theme cases each created three independent browser contexts/pages,
navigated and mounted the real production React harness, played the scenario,
waited for deferred rows, then measured every visible target. They run no axe
scan. Under twelve CPU workers and 1,342,177,280 held memory bytes, profiling
all eighteen pages gives these mean costs: new context/page **430 ms**,
initial React render **542 ms**, navigation **85 ms**, media/route/clock
**30 ms**, theme **26 ms**, scenario render **158 ms**, deferred paint
**64 ms**. Context creation and first render dominate; the three setups share
one five-second deadline. Temporary instrumentation was restored byte-exact
before repair (`cmp` and SHA-256
`6163fe6ad68dbee3a1f022dba01299a5aecd6672f55135f18110318fe3bad365`).

The unchanged source passes 126/126 with eight CPU workers in 236.67 seconds;
its target cases take 3.61–4.03 seconds. With twenty CPU workers and the same
held memory, **six target cases fail at 5,000–5,004 ms**, exactly the timeout
class in the brief; the other **120 tests pass**, 340.57 seconds overall.
Every complete file runs at repository deadlines with `--maxWorkers=3`;
no `--testTimeout`, filtering or skipped-test change. Pressure workers belong
to one foreground supervisor and terminate in its `finally` after Vitest.
The rig uses Node 24.21.0 and Chrome 155.0.8059.39; hosted Node 22 execution
still requires the lead's replay.

Repair: each theme/scene pair owns a case (eighteen instead of six). The
three scenes, all five selector kinds, visible-target waits, nonzero counts,
every target's bounding box and both 24 px assertions remain verbatim.
The existing forced-colour and contrast tests are unchanged.

### Palette lazy rejection ordering

App starts the registry request independently of the lazy Palette view.
Rejecting the registry and awaiting one microtask does not finish the view's
cold module loading or React's error-boundary render. The previous test then
spent Testing Library's one-second lookup window waiting for `role="alert"`.
The original case passed locally even with twenty CPU workers (1.47 seconds
for the whole test); its exact unmodified hosted failure is not reproduced.

A controlled view-import barrier establishes the ordering: keep the view
pending, reject the already requested registry, then perform the old alert
lookup. It fails with the matching missing-alert error under twelve-worker
pressure (**one failed, 125 passed**, 277.01 seconds with the review file).
This reproduces the transient state without a sleep or widened timeout.

Repair: retain that controlled barrier, explicitly release it after the
registry rejection, and await the actual Palette import's rejection inside
`act`. React can commit its existing error boundary before the alert lookup.
All first-use, loading, dismissal, reopen, failure wording and saved-state
retry assertions remain. This changes the test's synchronization, not App's
failure handling. The repaired palette passes under twenty-worker pressure
(1.52 seconds for the whole test).

### Loaded replay and byte-exact drills

The repaired complete files pass **138/138** under the same twenty CPU
workers and 1,342,177,280 held memory bytes, **340.97 seconds** overall.
All eighteen size cases take **1,505–2,054 ms**, leaving their existing
five-second deadline intact. Before/after free-page minima are
413,589,504 / 413,241,344 bytes; available-memory minima are
13,067,345,920 / 13,078,949,888 bytes. These are matched workload settings
and measured system readings, not a claim of identical scheduler state.

Both deliberate mutations run together over the complete files under the
same load: **seven failed, 131 passed**. No test is filtered.

| Drill | Break                                                                | Observed failure                                           | Byte-exact restored SHA-256                                                                    |
| ----- | -------------------------------------------------------------------- | ---------------------------------------------------------- | ---------------------------------------------------------------------------------------------- |
| R4M1  | Attachment minimum width/height token changed from 24 px to 16 px    | All six theme/`chips` cases: expected 16 to be at least 24 | `e546b30b35aae47762bc1260746ac2883463f0f5d2e988f257096f248807275e` (`styles.css`)              |
| R4M2  | Remove view-barrier release and the awaited Palette import rejection | Palette test cannot find `role="alert"`                    | `12fde1de6a1a15796d9143b88a642a8766b6d38935ddc26781cb0f88fb6f3838` (`AppPaletteLazy.test.tsx`) |

`cmp` also confirms the review test is unchanged by the drills:
`2c27085d9bcb2eae03feb54bdabf560ff254bdc2ee062720e1502ee7c0337318`.
The temporary CSS mutation leaves no production-source diff.

### Final verification and qualification scope

After the byte-exact restoration, the final complete-file replay under the
same twenty-worker/held-memory load passes **138/138**, **338.90 seconds**;
slowest size case **2,093 ms**. Both loaded green runs use the repository's
five-second test deadline. The related complete `AppPaletteLazy`,
`AppPaletteEnglish` and `DeferredSurface` files pass **20/20**, **8.71 seconds**.
Tracked summary: `docs/certification/cifix017r4-macos.json`; full logs,
per-test JSON and pressure samples remain in ignored `temp/cir4mac/`.

All five typecheck projects pass. Changed-file ESLint (zero warnings) and
Prettier pass; both test files retain their tested hashes after formatting.
Plain knip passes with its two existing configuration hints; duplication
finds zero clones. Localization reports zero problems across all fourteen
tables; host API, reference, plan and roadmap are current; cycle detection
finds none. Production build, token validation, all bundle caps/splits,
host globals and third-party notices pass. Measured extension **550.1 KiB /
600 KiB**, Model API **515.8 KiB / 525 KiB**, chat startup JavaScript
**742.2 KiB / 900 KiB**, original deferred JavaScript **31.9 KiB / 50 KiB**;
no cap changes. The planned installed-hook local commit uses explicit paths,
with full commit output captured to `temp/cir4mac/commit.log`; re-read the
staged and committed diffs afterward.

The scoped lane is qualified locally. Aggregate `npm run quality`, complete
coverage and hosted Node 22/three-platform qualification remain with the
lead under the explicit brief. Both requested hosted logs remain inaccessible
(HTTP 403), and the unmodified palette failure was not observed locally;
its controlled rejection-order reproduction and red/restored drill are
recorded separately above. No stronger release qualification is claimed.

## Round 5, lead (run 38022741513)

Run 38022741513 on `639dbecf3` left four single-test failures in the test
shards; the package, quality and dictation-helper failures were only their
"require every selected-tier job" aggregates.

| Job                     | Case                                                 | Owner   |
| ----------------------- | ---------------------------------------------------- | ------- |
| ubuntu-latest, shard 4  | M108 two accounts: `observeUsage` not yet called     | lead    |
| windows-latest, shard 5 | estimator light 690 px: readiness `waitFor` 2000 ms  | lead    |
| windows-latest, shard 4 | sshRunner exit-75: exit 124 at the 10 s job budget   | CIR5WIN |
| macos-latest, shard 3   | native lifecycle: recorded setsid grandchild missing | CIR5MAC |

**M108 two accounts.** The fake CLI sends `turn/completed` and then
`usage/changed`; the test asserted `observeUsage` on `turnCompleted`, so a
read boundary between the two frames failed it. The host calls
`observeUsage` synchronously before its usage listeners, so the test now
also awaits `onUsageChanged`. Drill on kubuntu: with the fake's
`usage/changed` delayed 200 ms, the fixed case passes (1 passed) and the
unfixed case fails with the hosted error, `expected "vi.fn()" to be called
at least once`; both files restored and verified with `sha256sum -c`
(test `f29b5de8…3a024`, fake unchanged). Full file on kubuntu: 28/28.

**Estimator first navigation.** Only the first matrix case (light, 690 px)
has ever missed its bound on hosted Windows: at `page.goto` in round 3 and,
after CIR4WIN's packed-English repair, at the readiness wait in round 4. The
cost is the browser's one-time first-navigation work, not the flows the case
checks. `beforeAll` now opens the same scene once and waits for readiness
under the hook's limit; every matrix case keeps `setDefaultTimeout(2000)`
and all assertions, and the page setup is shared through `openScene`. On
win11 under two concurrent Codex lanes: 11/11, first case 2402 ms total with
every action inside its bound. The hosted failure has not reproduced on the
rig, so no local red drill is claimed; the hosted run is the evidence.

Host checks: Prettier, ESLint on both files, `typecheck:e2e`,
`typecheck:unit` exit 0.
