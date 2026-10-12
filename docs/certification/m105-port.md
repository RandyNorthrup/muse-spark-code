# M105 accepted-media port to 0.17.1

2026-10-11, MacBook rig, branch `m105/port-0171`. Accepted source:
`eda2fdfe6`; release base: `35d7b6f54280e6b6235ae4b90e079b865c3e4ff4`.
One real no-fast-forward merge. No push, rebase, extra merge, live/paid call,
credential access, browser, GUI, screen recording or microphone launch.

## Resolution audit

33 conflicted files; all resolved by meaning. The repository has no standalone
`scripts/` changelog/table merge command: the available pure helpers are
`src/core/team/merge/{changelog,jsonTable}.ts`. A private ignored esbuild runner
invokes those exact helpers. Generated artifacts use the repository generators.

| File                                                                                                                                          | Accepted feature side                                                                    | 0.17.1 side                                                                       | Resolution and regression                                                                                                                                                                    |
| --------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `src/extension.ts`                                                                                                                            | Real session upload ledger cleanup on save/delete/purge                                  | Lazy `modelApiSessions.js` store factory                                          | Pass uploads through the lazy factory's `store` options; keep lazy provider/store wiring. `fileSessionStore`, `fileSessionStoreBundle`, production media suites.                             |
| `src/core/media/convert.ts`                                                                                                                   | WAV extraction, per-child Darwin RSS, final-output bounds and exit races                 | Governed contained process launch, whole-tree Stop and payload PID                | Keep WAV/result and RSS/final-output logic; launch through governor, sample payload PID and stop whole tree. `mediaConvert`, `macRss`, `spawnGovernance`.                                    |
| `src/runtime/tokenFile.ts`                                                                                                                    | Reusable ACL script for verified private conversion roots                                | Reject absent/malformed Windows roots with localized refusal                      | Retain shared runner and apply the release root validation there; no PATH or guessed drive. `tokenFile`, `privateDirectory`, `privateRoot`.                                                  |
| `native/windows/MuseSparkMcpJob.cs`                                                                                                           | Atomic `PROC_THREAD_ATTRIBUTE_JOB_LIST`, membership readback, after-create death harness | Attested completion port, cap/result accounting, RunAttested                      | One RunCore accepts both harness callback and attestation; every overload reaches atomic creation. Windows owning native suites require Windows lead run.                                    |
| `src/core/resources/resourceGovernorEntry.ts`                                                                                                 | Lazy Darwin encoder sampler export                                                       | Resource status/history and process split                                         | Keep both exports and history binding. `macRss`, governor/status/history suites; size/split gates.                                                                                           |
| `scripts/lib/deferredBundles.mjs`                                                                                                             | External production-media/audio/runtime-media entries                                    | External resource-process/vault entries                                           | Union of external boundaries; no cap change. `deferredBundles`, bundle split gate.                                                                                                           |
| `package.json`                                                                                                                                | Media roots in old long cycle command                                                    | Windows-safe `scripts/cycles.mjs`, updated gates/hooks                            | Use release script; ensure media roots remain in its inventory. `cyclesScript`.                                                                                                              |
| `scripts/package-acp.mjs`                                                                                                                     | Media/audio/runtime bundles and Windows launcher/recorder sources                        | Single shared native inventory with governed runner/helper resources              | Keep merged bundle union, use shared native inventory already containing launcher/recorder; remove duplicated local declarations. Package fixtures and `usagePackaging`.                     |
| `test/unit/usagePackaging.test.mjs`                                                                                                           | Handwritten Windows fixture sources                                                      | `layOutAcpNativeSources` shared complete fixture                                  | Use shared inventory; retain media bundle expectations.                                                                                                                                      |
| `test/unit/mediaConvert.test.ts`                                                                                                              | Per-child RSS, stalled final stat, trusted canonical-path verdicts                       | POSIX fake path on Windows, checkout-local fixture mkdir, governed-launch fixture | Combine fixture fixes with typed trusted-path verdicts and every feature guard.                                                                                                              |
| `test/unit/tokenFile.test.ts`                                                                                                                 | Shared fake-Windows setup helper                                                         | Any-drive SystemRoot fixture and security assertions                              | Keep shared helper plus release SystemRoot/security expectations.                                                                                                                            |
| `test/unit/modelApiProductionMedia.test.ts`                                                                                                   | Production upload/replay/pricing/account-change tests                                    | No-binding video/audio reader matrix; exact USD schedule caps                     | Keep full production suite and base refusal matrix; convert numeric schedule fixture caps to exact USD.                                                                                      |
| `README.md`                                                                                                                                   | Implemented accepted video/audio routes and truthful recorder/converter limits           | Title Case labels and newer base feature docs                                     | Keep actual accepted routes, release labels and base provider docs; no recorder or other-vendor enablement.                                                                                  |
| `src/shared/l10n/en.ts`, all 14 `l10n/ui.*.json`                                                                                              | Converter refusal and registry-limit keys; removed obsolete upload refusal               | Title Case labels and rewritten missing-binding refusal                           | Union of keys, real translations; release wording wins shared labels. Retain missing-binding text as fallback vocabulary without re-disabling bound media. Localization suites/gate.         |
| `CHANGELOG.md`                                                                                                                                | New V/VB/redesign entries; removes superseded Unreleased refusal wording                 | 0.17.1 and earlier released history                                               | Helper applies feature bullet additions to Unreleased. Removed ancestor bullet already released stays immutable; no feature entry moved into old releases. `changelogVersion`, roadmap gate. |
| `docs/ide-compatibility/host-api.md`                                                                                                          | Older host importer counts                                                               | New generated inventory                                                           | Regenerate on merged source. Host API gate.                                                                                                                                                  |
| `src/runtime/reference.node.generated.ts`, `src/shared/reference/reference.generated.ts`, `src/shared/reference/referenceSchema.generated.ts` | Accepted media reference expansion                                                       | New release catalog/reference                                                     | Regenerate complete merged catalog; no hand merge. Reference gate and owning round-trip suites.                                                                                              |

## Gate repair audit

Merge `f8db55035` passed normal hooks. Re-read staged and committed source
diffs; the hook changed no source against the pre-hook snapshot. Initial core
regressions: 3 files, 102 passed. Initial bundle suite: 115 passed / 3 failed:
eager attached-registry source, Model API 533,555 > 530,883 B diet, and the
production cap smoke. Initial build overages: audio 78,662/76,800 B, usage
panel 75.2/75 KiB and surface English 27,217/25,600 B.

| Change                                                                            | Reason and evidence                                                                                                                                                                                                                                                                                                                                  |
| --------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `attachedMediaPort.ts`, activation/runtime imports                                | Move the unchanged forwarding shim into a type-only leaf. Registry/hash/schema implementation remains first-use only. Existing emitted source-boundary regression went red before this change.                                                                                                                                                       |
| `resourceProcessEntry.ts`, `productionAudioEntry.ts`, process ownership inventory | Load the Windows encoder job from the existing lazy process chunk. Its memory/output/deadline policy is unchanged; audio no longer carries a second MCP launcher. Emitted ownership assertions cover both bundles.                                                                                                                                   |
| `modelApiBoundariesEntry.ts`, boundary resolver                                   | Share pure usage-journal schemas through the existing Node boundary. Keeps the usage panel under its original cap. Browser validation remains inline.                                                                                                                                                                                                |
| `fileSessionStoreEntry.ts`, boundary resolver                                     | Share pure session parsing through its existing store owner. A first attempt through the wire's boundary caused a cold-load cycle: wire-first stored-media parse failed with `Cannot read properties of undefined (reading '_zod')`. The final owner avoids that cycle; both first-import orders parse a real stored upload in fresh Node processes. |
| `uiTextRegions.mjs`, `webviewBundles.mjs`                                         | Keep media words in first paint. Deferred playbook English gets a separate 25 KiB closure, measured 3.2 KiB; original surface-English cap stays 25 KiB (24.3 KiB now). Complete shape/slots and installed languages remain unchanged, through the existing loader/failure/retry path. No CSS/layout changes.                                         |
| `deferredBundles.test.ts`                                                         | Build the actual session-store owner and production boundary plugins in the fixture; add Windows encoder ownership and cold stored-media cases. No assertion, cap or ignore weakened.                                                                                                                                                                |
| `browserUiText.test.mjs`                                                          | The old all-language loop exceeded the default 5 s during concurrent bundle builds. Retain every assertion; run each language as its own test at the same default deadline. Corrupt-table cases remain.                                                                                                                                              |
| `browserEnglish.test.mjs`, `bundleSize.test.mjs`                                  | Verify distinct deferred playbook English and the new closure's unchanged D6 budget formula.                                                                                                                                                                                                                                                         |

Final layout production build passes every token, size, split, host-global and
third-party-notice check. Bundle/language regression: 3 complete files,
141 passed at repository deadlines, including every installed locale and both
cold parser orders. Prototype failures remain in ignored raw logs; they are
not final gate results. No dependency pin, existing cap, timeout or ignore changed. The Model API
diet ratchet strengthens from 530,883 to 523,629 B, following D6.

The parser move also adds `modelApiSessions.js` to both the production ACP
package and private test-package admission list. The tarball regression requires
that member, preserving the same behavior outside VS Code. No new runtime
command or setting is introduced. Final all-project typecheck exits 0.

## Deliberate failure controls

| Control                                        | Result                                                                                                                                      | Byte-exact restoration                  |
| ---------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------- |
| Payload sampler uses launcher PID              | `mediaConvert`: new payload-PID assertion fails                                                                                             | SHA-256 matched                         |
| Converter kills child instead of governed tree | `mediaConvert`: new whole-tree Stop assertion fails                                                                                         | SHA-256 matched                         |
| Missing malformed-Windows-root check           | `tokenFile`: all four malformed-root cases fail                                                                                             | SHA-256 matched                         |
| Registry import pointed back at old module     | Compiler rejects the removed export; owning suite setup fails. Initial pre-repair bundle test separately proved eager registry reachability | SHA-256 matched                         |
| Session parser moved back to wire dependency   | 13 owning failures, including both cold parser/ownership controls                                                                           | All three source SHA-256 hashes matched |
| Playbook English closure exceeds 25 KiB        | `bundleSize` negative case observes refusal without raising original deferred cap                                                           | Test-owned artifact only                |

All five source mutations exit 1; no test timeout flag is supplied. Final
restored-source verification follows in the complete headless sweep. The
new parser/encoder export and language tests also pass the real emitted
factories; setup/compile rejection is reported distinctly from a guard assertion.

## Full-sweep findings

- `execStdio.e2e`: first attempt's package `beforeAll` hits its existing
  60,000 ms deadline; 29 tests passed including the other two batch files,
  and 32 package cases could not run. The 12 built exec cases passed. No
  timeout raised. Final retry passes all 44 cases at unchanged hook/test deadlines after
  immutable fixture preparation moves out of the packing hook.
- `acpPackageFixtures`: base forbids handwritten native member names in
  packaging fixtures; accepted V's tarball assertion named the Windows
  launcher directly. Use imported `ACP_NATIVE_FILES` to assert every native
  member with Windows separator normalization. Shared layout and the gate
  remain unchanged; this strengthens actual tarball coverage.
- `mediaJobRun` stalled-stat cases correctly ended the encoder inside the
  100 ms sample bound, before a slow Node startup wrote its marker. The fixture
  then waited for a marker that could never appear. Assert the sampled port
  was reached and the actual spawn handle's PID is ended; retain both running
  and clean-exit cases and every deadline.
- `execRun` scanner test combined three cold CLI processes inside one 5 s
  case. Keep all clean/secret/unreadable assertions, split into three cases
  at the unchanged default deadline, and assert key/native-store exclusion
  for every result. The separate 2 s stderr-lifecycle cases get a solo rerun;
  their bound is unchanged.
- Both cold package hooks included immutable fixture build/copy work in the
  packing deadline. Prepare those immutable inputs once during file setup,
  matching the existing exec fixture's production-build treatment. Both
  archive/export operations retain the same 60,000 ms hook/command limit;
  all actual tarball, corruption, native and language assertions remain.
- `usagePackaging` rebuilt all immutable table/native fixtures inside each
  5 s refusal assertion. Create each isolated input fixture in `beforeEach`;
  mutation, command and all refusal/prior-stage assertions remain inside the
  unchanged test deadline. No production gate or fake transport is changed.
- Solo `execRun` retained one stderr-lifecycle startup failure: only the
  bootstrap marker ran before the 2 s deadline. The fixture compiled a large
  unminified CLI monolith although production is minified. Match production
  minification; keep the same signals, 4 MiB error, output assertions, native
  store trap and 2 s bound. The complete file gets another final run.
- Follow-up `62be00c9f` hooks rewrote only `/^playbook/.test(key)` to the
  equivalent `key.startsWith('playbook')`; re-read staged/committed source.
  The 104-file sweep and final production build cover the committed form.

## Verification

Initial host/webview typechecks passed. Unit typecheck exposed the inherited
worktree install's SDK 1.4.2, while release package/lock pin SDK 1.4.4
(`spawnFn` absent in old types); do not alter or weaken the SDK regression.
Install the merged lock with `npm ci --ignore-scripts` in private `$TMPDIR`
storage, retaining the original node_modules directory and all its contents.
The other compile finding was the release admission fixture's obsolete string
trusted-path verdict; replace it with the feature's typed canonical-path receipt.
The repository's `npm run prepare` installed its current fail-closed hooks;
core.hooksPath remains `.husky/_`.

All five `npm run typecheck` projects pass with the merged lock (exit 0).
Fresh locked dependencies now occupy the worktree node_modules directory;
the original install remains intact under ignored port scratch.

Final source and fixture checks: all five typecheck projects passed; after
fixture repairs, unit and e2e projects passed again. Scoped ESLint/Prettier,
localization/reference/roadmap/plan/host API, plain knip, cycles and the
production build all exit 0. Extra duplication gate result is documented
separately below. Final commands use repository default test timeout, at most three
Vitest files per batch and `--maxWorkers=3`. Aggregate quality/full test sweep
are prohibited by lane common rules and remain lead-owned. No gate weakened.

## Availability and next slice

Accepted video/audio bindings remain as accepted, including capability/consent
and exact-budget refusal. Direct recording, companion runtime, uncaptured
vendors and uploaded-file management keep their existing holds. Source audit confirms `recordingCommandDeps` still omits `driver`, runtime
media has no native recording factory, uploaded-file deletion is unbound, Muse
Code video/audio refuses, and uncaptured models resolve to unknown. No CSS or
React surface differs from the release base; fresh browser visual verification
still belongs to the Linux lead rig.

Ordered switch-on prerequisites (each hold applies only to its named surface):

1. Qualify this merged native process/storage code on Windows and Linux;
   Windows must exercise both atomic creation and attested completion/cap/
   retirement records, private-root ACLs and exclusive leases. Run Darwin and
   Linux real cross-process lease/copy/RSS cases on their own OS; fake readings
   cannot certify another OS. M109's attested `limits` integration for the media
   conversion failure vocabulary remains a named follow-up; ordinary M50 job
   memory containment stays as accepted.
2. Produce/verify the signed Darwin screen-helper artifact and its packaged
   identity/localized permission resources. Compile/qualify the Windows WGC/
   Media Foundation helper on a working GPU desktop (VM direct capture stays
   unavailable). Qualify the Linux portal/PipeWire and trusted encoder adapters.
3. Lead/owner runs device recording acceptance: explicit OS permission,
   countdown/Stop, sleep/suspend, cancellation/owner death, audio off by default,
   per-recording audio choices, preview Attach/Discard and temporary cleanup.
   No real capture or microphone run occurred in this port.
4. Only after those receipts, bind the native recording drivers in the editor
   and ACP/runtime factories with options, preview, generation cancellation and
   source admission. Keep the existing absent-driver refusal until then.
5. Qualify/bind M104's guarded companion server and MHP/native-editor ports;
   run browser media upload/recording, accessibility, visual and installed-editor
   checks on a Linux desktop rig. Existing injected-port tests are not device
   qualification. The accepted lane's clean reviews are not reopened here.
6. Owner authorizes any further live capture/billing work: Standard tiers and
   other vendors need their own capability/codec/calibration receipts; Muse Code
   video needs U16/MSP evidence and the upstream part contract. Unknown support
   remains refused. Re-read U6c's dashboard when metered usage becomes visible;
   the already-recorded not-billed decision is preserved.
7. Bind uploaded-file management to the durable provider/account ledger and
   ownership bridge, then qualify account switching, removal/read-only state,
   session/fork/rewind cleanup and other-app deletion confirmation before that
   currently unavailable management action is exposed.

Current planning state: M105's public roadmap is partially delivered, with the
milestone still planned/open for qualification and other-provider/editor holds.
Accepted V/VB/redesign code is being ported; this task adds no enablement scope.
Next slice: lead gate the merge, then Windows/Linux native qualification and
owner device receipts before installing recording bindings. Historical W/V/VB
records remain chronology; this record is the port's current evidence.

## Final receipts

- Merge: `f8db55035` (parents `eda2fdfe6`, `35d7b6f54`). Budget/parser
  follow-up: `62be00c9f`. Final fixture/inventory/certification commit follows.
- All five typecheck projects pass; unit and e2e projects repeated after final
  fixture changes pass. Scoped ESLint zero warnings and Prettier pass.
- Localization zero problems; reference current (77 features, 71 commands,
  101 settings, 29 slash, 263 CLI); roadmap current (216 entries); plan zero
  drift. Host inventory: 378 APIs, 49 adapter files, 30 Node built-ins,
  71 theme variables, zero problems. Plain knip and cycles exit 0.
- 104 complete files selected in 35 batches of at most three, every run with
  `--maxWorkers=3` and repository deadlines. After complete-file corrective
  retries: **2,872 passed, 86 existing OS skips, zero failures and zero todo**.
  Initial setup/fixture/timing failures are recorded above, not erased.
- All 44 fake-only packed CLI/end-to-end cases pass; package tests and actual
  tarball assertions pass. All source mutations restore exact SHA-256 bytes.
- Final production build exits 0: tokens, every size cap, split ownership,
  host globals and 92 third-party notices (four optional fonts). No cap rose.

| Bundle                  | Final bytes | Unchanged cap bytes |
| ----------------------- | ----------: | ------------------: |
| `extension.js`          |     563,681 |             614,400 |
| `modelApi.js`           |     523,629 |             537,600 |
| `productionMedia.js`    |      68,050 |             102,400 |
| `productionAudio.js`    |      68,436 |              76,800 |
| `runtimeMedia.js`       |      46,952 |              76,800 |
| `resourceGovernor.js`   |     111,223 |             128,000 |
| `resourceProcess.js`    |      27,686 |              51,200 |
| `modelApiSessions.js`   |      39,077 |              51,200 |
| `modelApiBoundaries.js` |      37,491 |              51,200 |
| `usagePanel.js`         |      74,682 |              76,800 |

Model API's stronger diet ratchet is 523,629 B (previously 530,883 B).
Original deferred JS is 31.9/50 KiB; original deferred pin remains 32.1 KiB.
Browser startup is 742.7/900 KiB and passes the stricter 743.7 KiB review pin.
Surface English is 24.3/25 KiB; new deferred playbook English is 3.2/25 KiB.

**Extra duplication gate: FAIL (exit 1).** Unchanged zero threshold:

```text
Found 29 clones.
ERROR: jscpd found too many duplicates (0.0%) over threshold (0.0%)
```

Fresh private `$TMPDIR` source archives with the same checker reproduce
27 clones on accepted `eda2fdfe6` and two on release `35d7b6f54` (both exit 1).
The integrated count is their sum. No ignore/threshold changes; broad fixture
cleanup is explicitly deferred in PLAN §7 to the integration lead. The source
archives were deleted after comparison. This port does not claim full quality
is green or that inherited duplication is repaired.

**Skipped by explicit lane rule, not passed:** aggregate `npm run quality` and
full V8 coverage; installed-editor integration; actual visual/accessibility
browser gates; `test/unit/companionMediaBrowser.test.mjs`; device recording,
microphone and signed/native desktop qualification. Their output tail is
`Not run: PORTM105.rig.md forbids browser/GUI/microphone/capture and common.md
reserves aggregate quality/full tests for the lead.` No forbidden application
was launched. Linux desktop lead runs browser/visual/a11y/companion checks;
Windows lead runs native jobs/ACLs/WGC; owner supplies signed Darwin/device
receipts. The three completely OS-skipped files here are `jobCreateAtomic`,
`resourceWindowsLaunch`, `windowsScreenRecorderNative`; other OS skips are
part of the 86 count. No new skip added.

Planning re-read: `check:plan` and `check:roadmap` are current. M105 remains
partially delivered/open, while this release-base port's assigned merge,
headless tests and static/budget checks are complete. Next slice is lead
integration/duplicate cleanup and native qualification, then owner device
receipts and recording-driver binding, in the ordered inventory above.

## Round 2 — existing-file delivery and merge gates (2026-10-11, macmini)

### Part 1: duplication cleanup

The initial unchanged checker reproduced 29 clones (376 duplicated lines).
Extract shared RIFF chunk headers and test-only scratch directories, empty
session records, Files receipts, streamed sources, batch WAV/body fixtures,
exact-money settlements and repeated production factory/turn/request fixtures.
Every original test case and assertion remains; no wire shape, capability,
threshold, ignore, timeout or production behavior changes. Shared release-side
hunks: `test/unit/modelApiHost.test.ts` and
`test/unit/modelApiLoopGuarantees.test.ts` now share their repeated refusal
fixtures locally. The rejected PORTM105 duplication deferral is deleted from
PLAN section 7. The earlier failure above remains a historical receipt.

Final unchanged `npm run duplication` output (ANSI removed):

```text
Found 0 clones.
time: 1.41s
```

Deliberate failure: restore HEAD's duplicated RIFF header parsing, run the
unchanged checker, observe exit 1 (one clone, seven lines, 64 tokens), then
restore the repaired file byte-exact. SHA-256 before/after restoration:
`14b47873f8ec42eeae7014bd11325fda48598096fd7e78648ba82172ea74d513`.
Local logs: `temp/port-r2-duplication-red.log` and
`temp/port-r2-part1-duplication.log`.

Scoped macmini verification, repository default timeouts and at most three
files per run: 880 tests passed in 12 affected/adjacent files (36 audio/batch/
production, 59 upload/session/media, 731 host/loop/sniff, 54 malformed/fixture/
replay). All five typecheck projects, changed-file ESLint and Prettier, knip,
production build with unchanged budgets/split checks, localization (zero
problems), host API (zero problems), plan (zero drift), roadmap freshness and
`git diff --check` passed. The lane brief reserves aggregate quality for the
lead; this lane did not run it. No case was removed or skipped.

### Part 2: production composition and bindings

`test/unit/mediaAttachmentComposition.test.ts` attaches actual existing
sniffable MP4 and 16 kHz mono PCM WAV files from its private fixture workspace.
No recorder, browser, microphone or live request runs. Production attach,
registry/digest streams, session store, Files ledger, compiled host factory,
provider client, audio preparation, paid permission, exact daily/session
journals, ACP SDK session/prompt and headless run/transport are real. Only
HTTP/model replies, the test credential in memory, native UI answers and
unused editor environment ports are simulated. Provider frames use U6's
Files receipt, U5's `input_video` by `file_id`, U18/T9's batch response shape
and the existing captured Responses stream fixture; no new wire is inferred.

| Surface/case                                                | M105 acceptance lines exercised                                                                             | Observable result                                                                                                                                                                                              |
| ----------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| VS Code existing MP4 + WAV                                  | 2 upload/expiry; 3 wire/no base64; 5 exact reserve/settle and byte counts; 6 paid sound; 7 host-owned bytes | One expiring streamed MP4 upload, `input_video` by id, WAV transcription text, native paid popup with $0.18/hour and $1 daily budget before ASR; both journals durable before dispatch and settled afterwards. |
| VS Code `sendAudio`, before attach and changed after attach | 4 captured capability refusal; 6 action choice; 7 attach refusal                                            | Meta's translated unsupported-audio refusal; no ASR, upload or model request.                                                                                                                                  |
| ACP linked MP4 + embedded WAV; embedded MP4 + linked WAV    | 2, 3, 5, 6; 8 MIME dispatch and confined link                                                               | Real `session/new`, selected model and `session/prompt`; paid `session/request_permission` before ASR; same upload/wire and exact durable claims as above. Embedded contract WAV needs no conversion path.     |
| exec existing MP4                                           | 2, 3, 5; 9 repeated-argument parser/events and successful exit                                              | Real CLI parsing, runtime, ACP client, Files egress and run ledger; video by id, reserve before response, usage settlement, exit 0, metadata-only events.                                                      |
| exec MP4 + WAV                                              | 4, 6; 9 explicit refusal and exit                                                                           | Exit 2 with translated audio refusal before any HTTP. PLAN M105 acceptance 9 and D85.5/current exec contract: no Muse Voice flag/spend admission.                                                              |
| Shared sound router on synthetic heard-audio capability     | 4, 6 explicit choice                                                                                        | `sendAudio` leaves audio for the provider; `transcribe` produces text and charges only the batch path. This is a capability-unit proof, not a new vendor capture or enabled provider.                          |

Both extension setting fields are required by their typed production ports:
omitting either is a compiler failure, rather than a silent default.
The host's machine setting was unbound in both `windowMediaAttachDeps` and
production preparation. It now travels from `currentSettings()` through
`ModelApiBackendManager`, host deps and `productionAudioFor` to the shared
router. Unsupported explicit `sendAudio` never falls back to transcription,
including MP3 without a converter. Runtime keeps its existing flag/default
policy; no new CLI setting or paid default is introduced.

Composition exposed a capped first-turn defect: batch transcription asked
its journal to reserve before the initial owned session record existed.
`ModelApiSession` now runs its existing budget initialization before attached
media preparation under a cap. The production Files route was also missing
from headless egress. `execFetch` now admits only U6's root upload/list and
file-id metadata/delete routes, the captured single `after` cursor, streamed
multipart upload under 200 MiB + 4 KiB overhead, and the existing exact HTTPS
origin, redirect-error and cancellation fences. Inference still owns its
exact per-attempt ledger. Files validation loads from the existing
`dist/runtimeMedia.js`; the headless cap remains unchanged. U6c's not-billed storage decision is conditional on
no new storage tariff; it is not a measured zero. Docs state that condition.

### Lead switch inventory (holds unchanged)

This baseline has **no media unavailable-settings list**. All five settings
are declared and read; `MACHINE_ONLY_SETTINGS` is a scope/security list, not
an availability switch. Do not remove these names from it.

| Location / exact state                                                                                                                     | Gates or describes                                                            | Evidence/action still needed; owner                                                                                                                                                                                                                                                                                                                                               |
| ------------------------------------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `docs/roadmap/entries.json`, M105 `labels: ["not available yet"]`, summary says video/audio sending unavailable                            | Broad attaching/recording release claim                                       | Existing-file composition is now proved on captured Meta contributor models. Lead/W may refine attach availability at integration after aggregate gates; keep recorder/native qualifiers.                                                                                                                                                                                         |
| Five machine settings: `mediaMaxUploadMiB`, `mediaUploadExpiryDays`, `screenRecordingMaxSeconds`, `mediaAudioAction`, `mediaConverterPath` | Attach size, cleanup retention, recorder cap, audio route, trusted conversion | Size/action/converter are bound. Upload expiry remains the Files API's fixed seven-day default; `mediaUploadExpiryDays` is read but no production consumer applies it, and cleanup UI is unbound. F/W must bind retention semantics without deleting referenced files. Recorder receipts remain R1/R2/R3/W.                                                                       |
| Help `referenceAttachments`, feature `attachments`, generated facts in `scripts/lib/reference.mjs`                                         | Attaching                                                                     | Description/facts still enumerate images/PDF/text and omit existing video/audio detail. Lead/W updates all translated reference text and facts with captured model/format qualifications after integration. This lane adds the existing translated audio-setting detail only.                                                                                                     |
| Help `referenceScreenRecording`, condition `nativeRecorder=absent`; `attachScreenRecording.canRun=false`                                   | Direct recording                                                              | R1 signed/helper/private-root/lifetime bindings + Mac capture/permissions/sleep/display-sleep and macOS 12.0–12.2; R2 successful H.264 smoke and physical Windows GPU/WGC/audio/denial/Stop/orphan receipts; R3 real portal/PipeWire/GStreamer/FD/lifetime/private-preview bindings and Kubuntu permission/audio/sleep receipts. W binds a driver only after those lanes certify. |
| Help `referenceLatestRecording`; `attachLatestScreenRecording.canRun=false`                                                                | Existing recording discovery/attach                                           | Linux latest-file adapter exists. Windows latest import still needs its trusted/private source and preview/disposal ownership receipts (R2/W); lead validates actual conversation command, existing-file gate and supported format. A successful ordinary file attach does not certify latest discovery.                                                                          |
| Help `referenceUploadedFiles`; `deleteUploadedFiles.canRun=false`; absent `ConversationDeps.uploadedFiles` in extension                    | Uploaded-file cleanup UI                                                      | Durable Files/session ownership is bound; F/W still binds Account listing/delete UI, active references, per-account key removal/read-only expiry and retention behavior.                                                                                                                                                                                                          |
| `package.json` command palette for the three commands: active chat panel/view context                                                      | Command visibility/context                                                    | They are already context-visible; there is no false/hidden manifest enablement to flip. Their host guards remain. `canRun=false` is Help's safe-action button policy, also used for many stateful commands, not a global availability switch.                                                                                                                                     |
| `src/extension.ts` recording deps has no `driver`; runtime `/record` has no recorder; exec refuses recording                               | Recording                                                                     | Same R1/R2/R3/W native receipts/bindings; untouched here.                                                                                                                                                                                                                                                                                                                         |
| Unknown video/audio/Files capability and uncaptured codecs for non-Meta providers; Muse Code explicit refusal                              | Existing-file provider selection                                              | Vendor/model/format captures listed below, then V/M95 codec + provider-owned ledger + calibrated cost binding. U16's 1.4.2 negative capture already exists; only a newer positive MSP wire can remove that hold.                                                                                                                                                                  |
| M104 `attachments/*`, companion upload and native bridge/package receipts                                                                  | Native hosts/companion                                                        | E3/M104 B/C/D must bind real installed host ports and run JetBrains JCEF, Visual Studio WebView2, Eclipse SWT and remaining editor upload/permission/cleanup receipts. Fake bridge contracts do not certify an installed native host. Browser recorder remains R3/E3 and is outside this lane.                                                                                    |

### Missing captures: run requests, not guesses about support

All bodies below are **capture probes**, never new parsers/capability rows.
Use an owner-authorized synthetic fixture workspace, one selected model per
attempt, a small explicit output cap, no retry, protected in-memory credential
transport and scrubbed response/usage/error/deletion receipts. Count attempts
and spend. The lead decides the model/paid authorization. Provider success
must show actual perception of an on-screen/spoken nonce, not just HTTP 200.

| Provider/model                                                                                                                              | Endpoint and probe shape                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   | Missing response/behavior; unlocks                                                                                                                                                                                                                                                                             |
| ------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Meta Standard `muse-spark-1.3`, `muse-spark-1.2`, legacy 1.1 if exposed                                                                     | `GET /v1/models`; `POST /v1/files` multipart `purpose=user_data`, `expires_after[anchor]=created_at`, `expires_after[seconds]=604800`, `file=<synthetic MP4/MOV>`; `POST /v1/responses` with `model`, `stream:true`, `store:false`, `max_output_tokens:64`, `reasoning:{effort:"minimal"}`, `input:[{role:"user",content:[{type:"input_text",text:"Read the on-screen nonce and spoken nonce."},{type:"input_video",file_id:"<own upload>"}]}]`                                                                                                                                                                            | Exact video/MOV acceptance, sound perception, error and terminal usage on each model. Capture 10/30/120/600 s with default/explicit fps variants before that model's capped-video calibration is on. Contributor captures cannot authorize Standard.                                                           |
| Meta contributor calibration gaps                                                                                                           | Same Files/Responses shape on 1.2 with `fps:2`; both contributor models with requested fps above 2; image `input_image` by own id, each detail, dimensions above 3000×2000; PDF `input_file` by own id, several known page counts and one text-only baseline                                                                                                                                                                                                                                                                                                                                                               | `usage.input_tokens`, cache/output split, resolution/fps/page behavior; PDF page bills are absent. Unseeded capped variants remain refused. Existing 23 seeds and 50/51-media captures are already present and need no repeat for this lane.                                                                   |
| Meta standalone audio                                                                                                                       | `POST /v1/responses` on an explicitly selected newer/candidate model, `input:[{role:"user",content:[{type:"input_text",text:"Repeat the spoken nonce."},{type:"input_audio",input_audio:{data:"<synthetic mono PCM WAV base64>",format:"wav"}}]}]`, otherwise same explicit cap/stream/store fields                                                                                                                                                                                                                                                                                                                        | U7's ignored standalone audio is already a negative receipt. Need a positive perceived nonce plus accepted field, error and terminal billing before native `sendAudio` support; a 200 response alone is insufficient. No current Meta model is enabled by this probe.                                          |
| Gemini chosen video/audio-capable model                                                                                                     | Existing captured `/v1beta/models/<native model>:streamGenerateContent?alt=sse`; JSON `contents:[{role:"user",parts:[{text:"Read the visual/spoken nonce."},{inlineData:{mimeType:"video/mp4",data:"<fixture base64>"}}]}]`, `generationConfig:{maxOutputTokens:64}`; separate WAV probe uses `mimeType:"audio/wav"`. Large-file probe follows the provider's documented resumable Files upload, then `fileData:{mimeType:"video/mp4",fileUri:"<own returned URI>"}`                                                                                                                                                       | Exact native acceptance/perception, `usageMetadata`, terminal/error stream, file URI/state/deletion and limits. Existing Gemini text/image capture and codec are not a media capture; V/M95 must implement the captured adapter and provider-owned upload lifecycle. No guessed `file_id` reuse.               |
| OpenAI or xAI selected Responses model                                                                                                      | Existing captured `/v1/responses`; separate synthetic video probe using candidate `input_video` and provider-owned file upload, and standalone audio probe using candidate `input_audio`; explicit `max_output_tokens:64` and streamed input message as above                                                                                                                                                                                                                                                                                                                                                              | Whether either candidate type/field is accepted at all, perception and terminal usage/errors. Meta's canonical types cannot establish another Responses vendor's support. Capture an explicit rejection where unsupported; do not enable from marketing modality labels.                                       |
| OpenRouter selected routed model; Groq/Mistral/Together/Fireworks/DeepSeek/Hugging Face/Z.ai; LM Studio/vLLM/llama.cpp/custom Chat endpoint | Existing preset path (respectively `/api/v1/chat/completions`, `/openai/v1/chat/completions`, `/v1/chat/completions`, `/inference/v1/chat/completions`, `/chat/completions`, `/v1/chat/completions`, `/api/paas/v4/chat/completions`, or configured research-backed local path). Probe `model`, `stream:true`, small output cap using its captured cap field, `messages:[{role:"user",content:[{type:"text",text:"Read the visual/spoken nonce."},{type:"video_url",video_url:{url:"data:video/mp4;base64,<fixture>"}}]}]`; separate audio candidate `{type:"input_audio",input_audio:{data:"<WAV base64>",format:"wav"}}` | Each exact provider + routed/local model's support/refusal, native field, perceptual result, usage and streaming/terminal/error behavior, upload lifecycle if offered. OpenAI-compatible naming is no evidence of compatible media. Existing Chat codec currently omits video; V/M95 binds only after capture. |
| Anthropic selected model                                                                                                                    | Existing captured `/v1/messages`, small `max_tokens`, stream; first read selected model's documented accepted content types, then send its documented synthetic media candidate or capture the rejection for an unknown `video`/`audio` block                                                                                                                                                                                                                                                                                                                                                                              | An accepted native video/audio content shape with perception, usage/errors and any Files lifecycle, or an explicit unsupported receipt. No implemented codec or capability can be derived from Meta shapes.                                                                                                    |
| Ollama selected installed model/custom native endpoint                                                                                      | Existing `/api/chat`, selected `model`, `stream:true`, `messages:[{role:"user",content:"Read the nonce",images:["<fixture>"]}]` is the existing image path only. Probe only a documented video/audio field for that exact installed model, or its explicit rejection                                                                                                                                                                                                                                                                                                                                                       | A real native media field/perception/billing-context limit or unsupported receipt; image support does not imply video/audio. V/M95/local server owner supplies the actual version/model receipt.                                                                                                               |
| Muse Code newer CLI/MSP                                                                                                                     | Current 1.4.2 U16 `@clip.mp4` is already negative (one subscription turn, six model attempts). On an updated CLI/schema, capture `session/*` turn input + `userMessage.attachments` and any tool-row media payload with synthetic `@clip.mp4`/audio                                                                                                                                                                                                                                                                                                                                                                        | An actual video/audio MSP part and perceived media. Text mention/search result is not attachment. E3/M106 upstream/lead owns the new version capture and parser; preserve explicit Model API refusal until then.                                                                                               |
| Meta storage policy                                                                                                                         | Re-read project Usage/Billing/Files meter after a synthetic upload, fixed-expiry metadata, delete and subsequent GET 404                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   | U6c already selected not-billed on absence of a storage meter, not measured zero. A new meter/tariff requires F/C/lead policy and price admission before upload; this recheck is not a missing codec capture.                                                                                                  |

For Gemini's large-file capture, use the documented resumable sequence:
`POST /upload/v1beta/files` with `X-Goog-Upload-Protocol: resumable`,
`X-Goog-Upload-Command: start`, `X-Goog-Upload-Header-Content-Length: <bytes>`,
`X-Goog-Upload-Header-Content-Type: video/mp4`, JSON
`{"file":{"display_name":"m105-synthetic-clip"}}`. Capture the returned
`X-Goog-Upload-URL`, then POST the bytes to that URL with
`X-Goog-Upload-Offset: 0` and `X-Goog-Upload-Command: upload, finalize`.
Capture `file.name`, `file.uri`, MIME and state from the response and
`GET /v1beta/<file.name>` until the provider's documented ready state; send
that URI in `fileData`, then DELETE `/v1beta/<file.name>` and confirm gone.
This is a probe recipe, not an implemented file-state parser. A provider's
returned upload origin still requires verification before credentials go to it.

The Chat paths are per preset, not interchangeable: OpenRouter
`/api/v1/chat/completions`; Groq `/openai/v1/chat/completions`;
Mistral/Together/Hugging Face `/v1/chat/completions`; Fireworks
`/inference/v1/chat/completions`; DeepSeek `/chat/completions`;
Z.ai `/api/paas/v4/chat/completions`. Local/custom uses only its configured,
research-backed path. Use the exact routed/installed model id and its existing
captured output-cap field. For Anthropic, an explicit unsupported probe is
`messages:[{role:"user",content:[{type:"text",text:"Read the nonce."},
{type:"video",source:{type:"base64",media_type:"video/mp4",data:"<fixture>"}}]}]`
with `model`, `max_tokens:64`, `stream:true`; the separate audio candidate
uses `type:"audio"`, `media_type:"audio/wav"`. These candidate blocks may be
rejected; capture that response and consult the selected model's documented
native shape before any support claim. Ollama's established `images` request
is only an image test; no video/audio field is known here. The local server
owner must provide that documented field/version before a positive probe;
there is no useful universal native-video request to invent.

Recorder device receipts are separate from these vendor captures. None was
attempted here, and no visibility switch or native recorder implementation
was edited.

The remaining Responses candidate bodies are explicit too: on OpenAI and xAI,
first capture `POST /v1/files` multipart `purpose=user_data`, `file=<synthetic
MP4>` (record any unsupported response), then `POST /v1/responses` with
`model:<exact selected id>`, `stream:true`, `max_output_tokens:64`,
`input:[{role:"user",content:[{type:"input_text",text:"Read the nonce."},
{type:"input_video",file_id:"<own returned id>"}]}]`. The separate audio
candidate replaces that video part with
`{type:"input_audio",input_audio:{data:"<synthetic WAV base64>",format:"wav"}}`.
Capture accepted fields, refusal, perception and terminal usage; delete any own
upload using the provider's documented Files delete endpoint. These are
unsupported-field probes where necessary, not adopted Meta wire contracts.

Acceptance 10's confined, approved `read_file` media path is covered by the
complete existing `toolIoMedia` and `modelApiMediaTools` suites in the scoped
sweep. The new composition cases exercise the precise subsets of lines 2–9
named above; they do not close all of acceptance 2's unbound management UI or
recorder/native-host acceptance.

### Round 2 continuation (macmini, same engine as the drills above)

The uncommitted Part 2 slice failed `typecheck:e2e`: `test/e2e/modelApi.live.e2e.test.ts`
builds a `ModelApiBackendManagerDeps` without the new `mediaAudioAction` key.
The manager field is now optional, matching the host's optional
`ModelApiHostDeps.mediaAudioAction` and the adjacent optional converter-path
pattern; the required-by-construction guarantee stays on `MediaHostSettings`
(the settings object every production call site builds). All five typecheck
projects pass. The new composition file's six ESLint errors (two numeric
separators, three `await` on the synchronous `editorFixture`, one `async`
without `await`) are fixed without behaviour change; the async mock now
returns `Promise.resolve` explicitly.

Deliberate failure controls for the three new bindings (each restored
byte-exact, SHA-256 verified after restoration):

| Binding broken on purpose                                                        | Failing composition case                                                                                  | Observed failure                                                                                       |
| -------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------ |
| Manager drops the `mediaAudioAction` passthrough                                 | `a sendAudio setting change after attach refuses at the production session instead of transcribing (4,6)` | Turn completes via transcription instead of the expected `failed` + audio refusal; 1 failed / 7 passed |
| Host skips the first-turn `refreshBudgetSpend` seed before `prepareAudioMessage` | `VS Code attaches video plus audio… (2,3,5,6,7)` and `capped first-turn audio preparation… (5,6)`         | 2 failed / 6 passed (journal seeded after spend, delayed-save guard trips)                             |
| `execFetch` stops routing `EXEC_ENDPOINTS.files` to `forwardExecFile`            | `exec delivers an existing video through the runtime and settles its exact run claim (2,3,5,9)`           | Upload refused (`request_shape`); 1 failed / 7 passed                                                  |

Restored hashes: `modelApiBackendManager.ts`
`a5dd81f42313a5ff9da3d506fa5d49846411c4be5b245a1106499ca8d450a30e`,
`ModelApiHost.ts`
`22541f44e3c315970c99494cdb8b38289a234ca336024d9dd502d898a7c62fb9`,
`execFetch.ts`
`676b568526cac2e8b14a500125e690325b7f87c1b260fa76bccfd80558b06019`.
No test timeout flag was supplied in any run.

Post-fix bundle rows (exact bytes, no cap changed):

| Bundle                  |   Bytes | Cap bytes |
| ----------------------- | ------: | --------: |
| `extension.js`          | 563,861 |   614,400 |
| `modelApi.js`           | 523,606 |   537,600 |
| `productionMedia.js`    |  68,064 |   102,400 |
| `productionAudio.js`    |  68,687 |    76,800 |
| `runtimeMedia.js`       |  48,012 |    76,800 |
| `resourceGovernor.js`   | 111,237 |   128,000 |
| `resourceProcess.js`    |  27,699 |    51,200 |
| `modelApiSessions.js`   |  39,091 |    51,200 |
| `modelApiBoundaries.js` |  37,505 |    51,200 |
| `usagePanel.js`         |  74,696 |    76,800 |

Cap bytes are the unchanged budgets from the Round 1 table; `npm run build`
exits 0 with the new `filesTransport.ts` inside `dist/runtimeMedia.js`
ownership.

## Round 3 — RVPORTM105 complete-class repairs (2026-10-11, MacBook)

Continuation starts at `091fedec2`, with prior fix commits `0e7d8dff1`
(provider cleanup and durable intent), `d59d51c53` (audio action currency),
`1b0f0c1e8` (Files-capable exec fixture), and `091fedec2` (privacy sinks).
The pending ledger literal cleanup is retained: parsing validates version 1,
so no const assertion is needed. These commits did not yet contain this round's
certification; current verification and deliberate failure receipts follow.

NOT RUN HERE: companionUpload.test.ts, companionMediaBrowser.test.mjs,
configuredProviders.test.ts, and browser/GUI/device suites selected by the
related graph. The rig brief forbids browsers on this MacBook and assigns
loopback qualification to the lead. No UI or visual styling changes are made.

Planning status: M105 remains open and partially delivered. Next slice remains
lead aggregate/blocked-suite qualification, Windows/Linux native qualification,
and owner device receipts before recorder-driver binding. Existing-file
composition and zero-clone extraction remain intact; no visibility hold lifted.

### Post-receipt await audit

VS Code and ACP use the same `FilesApi.upload` and account-scoped
`UploadLedger.ensure`; headless uses them behind `execFetch`/`forwardExecFile`.
The transport's lazy import and multipart forwarding finish before an id is
available. DELETE bypasses that lazy import at final dispatch, bound to Meta's
HTTPS origin, valid file-id path, no query/body/redirect, one attempt and its
own 30-second deadline. Cancellation closes every other route.

| Await after provider creation / before ledger publication | Interruption oracle                                                                                                                                                                                                                                                           |
| --------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `FilesApi.upload`: receipt JSON                           | Cancel both caller and exec inside the parsed receipt callback; the real Files client sends DELETE through cancelled exec. Shared ledger receipt-cancellation tests also cover VS Code/ACP's transport.                                                                       |
| Receipt callback's atomic intent write                    | Abort inside the completed write; provider deletion or durable intent survives. Intent is written immediately after id parsing, before abort/validation cleanup starts. Failed initial write attempts cleanup; failed DELETE carries the known id into a durable retry write. |
| Guarded iterator close, and final iterator close          | Observe durable intent inside iterator close; inject a close rejection and require provider deletion. Secondary close failure cannot mask the cleanup-pending error.                                                                                                          |
| `UploadLedger.ensure`: final ownership write              | Abort after the atomic write; DELETE succeeds, or the cancelled ownership is replaced with a durable deletion intent.                                                                                                                                                         |
| Failed publication's DELETE / intent write                | Fail publication and DELETE together; the earlier intent survives on disk and a fresh ledger sweep deletes it.                                                                                                                                                                |

No id-dependent await exists in a separate editor/ACP wrapper before these
shared publications. Lock release and later replay/session persistence happen
after ledger ownership is durable. Tests use the captured U6 Files shape and
in-memory provider transport; no service call or wire guess is introduced.

### Privacy audit

Media replay, attachment registry, Files and converter paths contain no
filename/content logger. Calibration and preview failures already use fixed
words. The production host's ordinary/unexpected turn and save catches now
use fixed reason codes. Session-store read, validation, expiry, leftover and
upload recovery sinks no longer interpolate filenames, JSON fragments or
arbitrary error names. ACP media disposal and exec cancellation/close sinks
use fixed cleanup codes. Exec writes a detailed usage refusal as a user
diagnostic, separately from its fixed-code log line; credential redaction
still applies. Canary tests cover changed bytes, missing source, upload,
transcript, ownership, corrupt stored content, ACP disposal and exec refusal.

Review continuation also removes seven test-fixture clones introduced by the
review repairs, using the existing attachment helper, shared fake-log lines,
shared turn/session preparation, a refusal fixture and parameterized publication
failures. The unchanged duplication gate returns **Found 0 clones**. No prior
round-2 extraction or production-composition assertion is removed.

Static preparation exposed the ledger adapter's missing receipt-callback type
and the original audio-action closure's possibly undefined default. The adapter
now shares the Files API's awaited ownership callback signature; unsupported/absent current actions
refuse through the same translated warning. No assertion, ignore, cast, timeout,
coverage threshold, dependency or bundle cap is changed.

Final privacy sweep found two additional inherited retry sinks in the shared
HTTP transport: provider refusal prose and network-cause details. Transcribed
audio becomes an ordinary text request and can use these retries. Two canary
regressions fail on the old warnings (22 pass / 2 fail), then the complete
24-case mediaClient suite passes with fixed transport code / numeric HTTP
status warnings; the user still receives the detailed error. The related graph
is refreshed over all nine changed non-hub sources (162 selected files).
The interrupted first batch from the earlier graph is excluded from receipts.
No browser or socket workaround is used.
