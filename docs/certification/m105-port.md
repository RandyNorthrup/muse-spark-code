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
