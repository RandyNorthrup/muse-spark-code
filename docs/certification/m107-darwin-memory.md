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
No reviewed finding remains open within this scope.

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

All 157 tests passed at repository timeouts. The native directory operations,
runtime lifecycle and existing signed-helper packaging routes remain covered.
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

This headroom scope is complete in the portable sampler used by both the
extension window and ACP/headless runtime. It adds no editor-specific UI.
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
