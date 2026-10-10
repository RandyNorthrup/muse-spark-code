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
