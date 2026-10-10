# C-M107-2 — macOS memory headroom on older runtimes

Scope: D87.4 amendment, lane CM1072 on `macmini`, based on `82d50d5e4`.
No model attempts, paid calls, dependencies, new settings or public commands.

## Implementation and review

The existing universal ad-hoc-signed `muse-dictate` helper has a
`--memory-headroom` mode dispatched before responsibility relay, speech,
microphone or screen setup. Its C implementation reads
`host_statistics64(HOST_VM_INFO64)` and multiplies free + inactive + purgeable
pages by the host page size. It holds one host port, checks the returned
structure covers the counters used, promotes counters before addition and
rejects unsafe byte counts. One `sample` line requests one JSON response;
EOF exits, and foreign requests fail.

Only macOS runtimes with a valid libuv version below 1.52 create this reader.
Construction starts nothing. The sampler shares concurrent reads and reuses
one idle child across samples. The child runs a fixed packaged absolute path,
with no shell, inherited credentials or workspace input. UTF-8, strict schema,
safe nonnegative integers, response length and request deadline are checked.
Missing, exited, stalled or malformed helpers return unknown, without caching
old readings or substituting free pages. A real zero remains zero. A failed
child must close before a replacement starts. Governor disposal settles the
in-flight request, clears its timer and kills only this sampler-owned helper.
Newer runtimes retain Node's API; an absent API or malformed version stays
unknown. Windows and Linux keep their existing readings.

Codex reviewed all four classes in this lane (same-agent review; the brief
prohibits sub-agents). Validation/security covers the fixed invocation,
credential-free environment, strict bounded boundary and native counter math.
Failure paths/honesty covers unknown versus zero, absent APIs, native failures
and deadlines. Concurrency/lifecycle covers lazy construction, shared requests,
one child, close-before-retry, EOF and the governor-to-sampler disposal chain.
Docs cover localized Help, feature catalog, README, roadmap and editor rows.
The first native parity run caught the SDK/kernel structure-size mismatch:
this kernel returns 38 integers while the SDK declares 40. Requiring fields
through `purgeable_count` fixes compatibility without accepting a short frame.
That initial review missed the runtime's settings wrapper: it forwarded only
`sample()`, so the new governor disposal could not reach the underlying sampler.
RVCM1072 identified that defect; CM1072R2 below corrects it and the lifecycle claim.

## Native Mac mini receipt

Production command: `bash native/darwin/build.sh` passed. The C sources compile
with `-Wall -Wextra -Werror` for x86_64 and arm64, minimum macOS 12.0. The
production helper's strict code-signature verification passed; `lipo -info`
reports both architectures. The executable keeps version 0.17.0. Existing
vault-source deprecation warnings in that broader build are unrelated.

The [machine receipt](m107-darwin-memory-receipt.json) records the production
artifact/source hashes, Node 24.21.0/libuv 1.52.1, Darwin version, RAM and CPU
count, and 25 bracketed API/native samples over 120 seconds. Legacy libuv
selection was simulated as 1.51.0 in that process; the oracle is the real
Node 24.21 native API and the child is the real signed production artifact.
This is not an installed Node 22 or editor receipt. Every native reading was
within its adjacent API sample range plus 64 MiB of bounded machine churn.
The largest observed deviation outside the bracketing API values was 20,480 bytes.
One helper was started. The measurement includes machine CPU sampling,
request transport, parsing, helper startup and two API oracle reads per sample.
Parent CPU was 65.716 ms; helper CPU was 10 ms. Including an additional full
10 ms `ps` resolution quantum, the upper cost was **0.071407% of one core**,
below D87's 0.5% limit. x86_64 executed here; arm64 was compiled and signed.

## Tests, drills and gates

Final verification and deliberately broken guard receipts are recorded below.
All test runs use the repository timeout; none passes `--testTimeout`.
No invocation contains more than three files, and `--maxWorkers=3` is used.

The [red-drill receipt](m107-darwin-memory-drills.json) records every mutation,
named failing test, nonzero exit and original/restored SHA-256. All 15 fired:

| Drill                     | Guard deliberately broken                               | Failing coverage                                                             |
| ------------------------- | ------------------------------------------------------- | ---------------------------------------------------------------------------- |
| Legacy selection          | Do not construct the older-runtime reader               | libuv 1.51.0/1.51.999 and helper disposal                                    |
| Legacy API absence        | Disable the reader when the host has no Node memory API | Node 20/Arduino-style host with libuv 1.46.0                                 |
| Zero counter              | Reject zero as invalid                                  | Genuine zero counter                                                         |
| Shared request            | Return a different promise for a concurrent read        | Concurrent reads/one child                                                   |
| Retry after close         | Keep the failed child reference after close             | Replacement after child retirement                                           |
| Sampler disposal          | Omit the sampler's port disposal                        | Older-Darwin helper disposal                                                 |
| Strict shape              | Accept unknown JSON fields                              | Extra field response                                                         |
| Output bound              | Remove the byte cap                                     | Oversized valid JSON with whitespace                                         |
| Absolute path             | Allow a relative executable                             | Missing/relative helper test                                                 |
| Empty environment         | Pass a nonempty test environment                        | Fixed invocation/empty environment                                           |
| Missing is unknown        | Settle failures with zero                               | Missing helper, malformed frames, timeout and in-flight disposal             |
| Request deadline          | Multiply the production request deadline by 100         | Unterminated response and stalled helper at the unchanged repository timeout |
| Governor disposal         | Omit sampler disposal                                   | Governor disposal chain                                                      |
| Reclaimable pages         | Count only free pages                                   | Native parity with Node 24.21                                                |
| Native request validation | Accept a foreign stdin request                          | EOF/foreign request/directory protocol test                                  |

Final test batches passed on the Mac mini:

- `npx vitest run test/unit/darwinMemory.test.ts test/unit/darwinMemoryNative.test.ts test/unit/samplerSystem.test.ts --maxWorkers=3`: 40 tests.
- `npx vitest run test/unit/governor.test.ts test/unit/sampler.test.ts test/unit/resourceCreatedNative.test.ts --maxWorkers=3`: 86 tests.
- `npx vitest run test/unit/runtimeResources.test.ts test/unit/resourceAcpPackaging.test.mjs --maxWorkers=3`: 31 tests.

All 157 tests passed at repository timeouts. The native directory operations
and existing signed-helper packaging routes remain covered. The original runtime suite used a sampler without disposal;
it did not prove retirement of the real entry's helper. CM1072R2 adds that proof.
The dead-code gate initially caught the new test fixture referenced only as a
cwd-relative string; a static module URL makes the actual dependency visible
and portable without adding an ignore. The unchanged dead-code gate then passed.

Repository checks pass: all five project typechecks, changed-file ESLint
with zero warnings, plain `knip`, `jscpd` (zero clones), dependency cycles
(none), localization (14 tables, zero problems) and the production build,
including tokens, bundle sizes/splits, host globals and third-party notices.
Changed-file Prettier and generated Help/reference, roadmap and plan checks
also pass (77 features, 207 roadmap/plan entries, zero drift).
The host API inventory initially failed as expected for this new sampler's
Node imports; regeneration changes only the child-process, OS and path reader
counts by one each (no new VS Code API), and the regenerated inventory passes.
Generated Help adds one localized resource-memory detail.

Production sizes: extension 550.2 KiB / 600 KiB; resource governor 108.4 KiB /
125 KiB; Model API 515.8 KiB / 525 KiB; ACP 235.4 KiB / 850 KiB; shared text
92.9 KiB / 125 KiB. No cap changed. The shared lane rules still name an older
475 KiB Model API cap; current PLAN's lead-approved budget and the unchanged
repository gate use 525 KiB. This lane follows that live PLAN/gate record.

## Integration responsibilities

The portable headroom implementation serves the extension window and
ACP/headless runtime. CM1072R2 repairs the runtime disposal wrapper missed by
the original receipt. Native delivery qualification remains unconfirmed:
ad-hoc signing and this rig's x86_64 execution do not establish installed-VSIX,
clean macOS 15/26, prompt-free launch, arm64 execution or actual older-editor
behavior. Those hardware/editor receipts are an external blocker for the lead;
this repair does not certify them. It adds no editor-specific UI.
Installed editor and cross-OS receipts remain with C-M104-1/C-M107-8 and
C-M107-9: VS Code family/Arduino IDE, JetBrains, Visual Studio, Eclipse,
companion, Zed, Xcode, Neovim, Emacs, Sublime and JupyterLab. Windows/Linux
behavior is covered by the existing adapter rows; those machines were not
executed in this Mac-only lane. Native chip/status bindings and relocation
remain other completion-program lanes, not partial implementations added here.

The rig brief forbids full `npm run quality`, full unit coverage, merges and
pushes in this shared lane. The lead retains joined quality, hosted three-OS
checks and independent review before integration. No gate is weakened and no
new feature is exposed with a placeholder or preview state.

## CM1072R2 — RVCM1072 repair (2026-10-10)

**P2, runtime disposal drops the sampler.** `createRuntimeResourceHost` now
forwards `dispose()` through the same wrapper that synchronizes settings before
sampling. It preserves the sampler's receiver. The production change is three
lines; no dependency, guard, cap, setting, command or wire shape changes.

Ownership sweep: `DarwinMemoryReader` owns its child, pipes and request timer;
`MachineResourceSampler` owns that reader; the governor owns its sampler.
The window passes that sampler directly and its registered extension-context
callback runs `configureResources`' disposal. The runtime entry goes through
the repaired wrapper; its history adapter forwards host disposal. The lazy
facade disposes both a loaded host and one returned after disposal, including
factory/subscription errors. CLI `resources` uses `finally`; ACP closes its
resources in nested `finally` even when other cleanup fails; headless `finish`
disposes them before backend cleanup and result output. Default process signals
and uncaught process failures close stdin; the native helper exits on EOF.
No sibling wrapper dropping disposal was found. No installed extension
activation/deactivation receipt is implied by the callback test.

Regression coverage uses the real runtime entry, sampler, governor, lazy facade
and helper transport with real pipe children. Bundled CLI/ACP tests run the real
runtime main; ACP speaks the SDK protocol against the existing fake Muse CLI.
The sampler selection is forced to old Darwin, total RAM is fixed at 16 GiB
to keep admission independent of rig size, and its fixed executable is substituted with the existing strict pipe fixture. Every retirement check
observes an actual helper PID and requires `ESRCH`; headless tests retain all
original event, relocation, subscription and late-notice assertions. Tests cover
normal runtime disposal, an in-flight sample, a late lazy factory, the extension
subscription callback, CLI normal/output-error/SIGINT/SIGTERM, ACP EOF/uncaught
transport-error/SIGINT/SIGTERM, and headless completion/turn-error/SIGINT/SIGTERM.
No real credentials are read: the CLI sign-in fixture contains placeholders.
No model/paid/network calls or installs are performed.

Fixture investigation: an explicitly disabled window does not sample on Show,
so its retirement scene keeps governance enabled. The first bundled ACP scene
lacked the native created-path and question-registry artefacts; it now ships the
same fixture sources as the existing stdio suite. The resource-only fixture
omits the optional schedules bundle (its startup warning is expected); including
that bundle alone tried to invoke an unbound native scheduler at shutdown.
Using the SDK connection handle avoids `connectWith` racing an intentional
EOF/signal against the callback still awaiting process closure. Headless helper
substitution is restricted to `--memory-headroom`, preserving esbuild's own
child; the reader's real startup installs its pipe handlers. No production
scheduler, protocol, timer or admission rule was changed to resolve fixtures.

The [R2 drill receipt](m107-darwin-memory-r2-drills.json) records four
sequential production mutations. Each ran both complete suites, at repository
deadlines, exited 1 and restored the original SHA-256 byte-for-byte. Cleanup
ran even after the deliberately failed assertions, so drills left no helper
behind. No timeout override, skipped test or gate exemption was introduced.

| Guard removed                       | Named failing retirement coverage                                                                     | Failures |
| ----------------------------------- | ----------------------------------------------------------------------------------------------------- | -------- |
| Runtime wrapper `dispose()`         | real runtime entry, in-flight sample, late facade, CLI normal/error, ACP EOF, all four headless exits | 10       |
| Governor sampler disposal           | extension subscription callback plus the complete runtime chain                                       | 11       |
| Lazy factory's `created?.dispose()` | sampled host returned after facade disposal                                                           | 1        |
| Headless `resources?.dispose()`     | completed, turn error, SIGINT, SIGTERM                                                                | 4        |

All five project typechecks pass. Scoped ESLint passes with zero warnings.
Final unmodified batches on `macmini`, all at repository deadlines and at most
three files per invocation (`npx vitest run <files> --maxWorkers=3`):

- `darwinMemoryLifecycle.test.ts`, `execResources.test.ts`, `runtimeResources.test.ts`: **41 passed**.
- `darwinMemory.test.ts`, `darwinMemoryNative.test.ts`, `samplerSystem.test.ts`: **40 passed**.
- `governor.test.ts`, `sampler.test.ts`, `acpResources.test.ts`: **83 passed**.
- `resourceCreatedNative.test.ts`, `resourceAcpPackaging.test.mjs`, `resourceWindow.test.ts`: **49 passed**.

All **213 distinct tests pass**. Each of the four red mutations above failed
first; the final unmodified suites pass after restoration. `jscpd` reports zero
clones. Final scoped gates pass: all five TypeScript projects (with a final unit-project
recheck after fixture typing), changed-file ESLint with zero warnings and
Prettier, plain `knip`, zero-clone `jscpd`, no dependency cycles, localization
(14 UI and 14 usage tables, zero problems), host API, Help/reference (77
features), plan and roadmap (207 entries, zero drift), and `npm run build`.
The build includes tokens, bundle caps/splits, host globals and 92 third-party
notices. Production sizes remain extension **550.2 / 600 KiB**, resource governor
**108.4 / 125 KiB**, Model API **515.8 / 525 KiB**, ACP **235.4 / 850 KiB** and
shared text **92.9 / 125 KiB**; no cap changes.

The installed hooks remain `.husky/_`; commits use explicit paths and keep
lint-staged and gitleaks enabled. Committed source is reread after the hook.
Aggregate quality/coverage and hosted cross-OS gates remain lead-owned under
the explicit rig/common brief. The only open qualification is the external
clean-machine/macOS 26/arm64/older-editor matrix stated above; no P1/P2/P3 code
finding remains open from RVCM1072.
