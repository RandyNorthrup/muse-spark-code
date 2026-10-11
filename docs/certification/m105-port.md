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

Remaining gates in progress. Final commands use repository default test timeout, at most three
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
