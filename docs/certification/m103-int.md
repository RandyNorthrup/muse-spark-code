# M103INT — integration, interfaces and strings

Kubuntu, 2026-10-05. Base `6fb6f0f924`, branch `m103/int`. The requested
`plan/m103-m104` ref is absent on this rig; `m103/sfix:PLAN.md` contains the
complete D83/M103 decisions and lane table used here. No guard branch,
main/release merge, push, rebase, physical hardware, credential read or model
call. Model attempts and paid calls: **0**. Only the existing pinned @types/vscode 1.96.0 fixture was installed, in private
`temp/arduino-types`; shared node_modules was untouched.

## Merge receipts

Each merge used `git merge --no-ff`, with hooks enabled and the Codex trailer.

| Lane | Merge commit | Conflicts and resolution                                                                                                                                                                                                                                                                                           | Owning suites                                                                                                         |
| ---- | ------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------- |
| S    | f4d2949f7    | PLAN and CHANGELOG: preserve both decisions and release history                                                                                                                                                                                                                                                    | installer/skills: 59 pass                                                                                             |
| D    | 8e1b1ad6f    | PLAN and CHANGELOG: keep both correction/qualification records                                                                                                                                                                                                                                                     | detector/presets/Pi: 75; catalogue/I/O/skills: 36 pass                                                                |
| P    | 556c46ff8    | PLAN and CHANGELOG: keep lease corrections and safety records                                                                                                                                                                                                                                                      | lease/ports/session: 50; serial/adapters: 17 pass                                                                     |
| M    | 56caebdaf    | PLAN: preserve both audit/arc safety corrections and residuals                                                                                                                                                                                                                                                     | G-code/machines/registry: 228; CAD: 21 pass                                                                           |
| X    | 9138de1cd    | PLAN, CHANGELOG, README: preserve release badge guidance and add rig instructions                                                                                                                                                                                                                                  | lifecycle: 5 pass; opted-in board matrix: 17 fail because this worktree has no tools/images cache                     |
| A    | 337aee9f7    | PLAN, CHANGELOG, manifest, packaging allowlist, Knip, build/split/size/global scripts, en and all 14 translations, host inventory, integration imports, bundle-size tests: preserve both features; add verifyEditor to the current shared split list; retain hashed browser chunks and use Arduino profile targets | board/build/host: 30; editor/JSON/lazy-loader: 70; settings/language/walkthrough: 30; budgets/package/splits: 57 pass |
| T    | 99585cfe2    | PLAN and CHANGELOG: retain context-only Thonny hand-over design and prior records                                                                                                                                                                                                                                  | existing Python 3.14/pytest 9 environment: 190 pass                                                                   |

The first A host fixture run lacked `dist/test/integration`; building with
`--production --integration-tests` makes all 30 cases pass. The first split
run exposed a missing verifyEditor build fixture; adding the real entry
restores the gate. A packaging run overlapped the T documentation merge and
read conflict markers; after files settled its entire suite passes. No test
filter, timeout increase, skip or gate relaxation was added.

Every vitest run uses at most three files, `--maxWorkers=3` and
`--testTimeout=120000`; logs are in this worktree's ignored `temp/`.

## Build receipts after each merge

Every `npm run build` exited zero, including caps, split, globals and notices.
Sizes are KiB; unchanged caps: activation 600, Model API 475, checkpoint 225,
webview startup 900, ACP 850, verification 25.

| Merge | Activation | Model API | Checkpoint | Webview startup |   ACP | Verification |
| ----- | ---------: | --------: | ---------: | --------------: | ----: | -----------: |
| S     |      438.4 |     446.9 |       76.9 |           792.2 | 818.2 |            — |
| D     |      438.4 |     447.0 |       76.9 |           792.7 | 818.2 |            — |
| P     |      438.4 |     447.0 |       76.9 |           792.7 | 818.2 |            — |
| M     |      438.4 |     447.0 |       76.9 |           792.7 | 818.2 |            — |
| X     |      438.4 |     447.0 |       76.9 |           792.7 | 818.2 |            — |
| A     |      434.0 |     447.0 |       76.9 |           792.9 | 818.2 |         22.2 |
| T     |      434.0 |     447.0 |       76.9 |           792.9 | 818.2 |         22.2 |

## Integration split drill

Remove the verification files from the shared deferred manifest, run the
complete `deferredBundles.test.ts`, observe both verification regression
assertions fail (2 failed / 26 passed), then restore byte-exact. SHA-256:
`cfa75e01bbe5d18f2343e7de775f5652d7a33ac4e813ed7eeba6516cee6f4c64`.
This proves the new split-fixture cases exercise the production rule.
The normal build passes with verification 22.2/25 KiB and activation shrinks.

## Pending qualification

The X opt-in run was attempted with all tests enabled: 17 failures name
missing worktree-local emulator tools, ELF/UF2/images and the IDF app. Its
previous lane receipts remain historical; this trunk has no fresh board
qualification. No other lane's private cache was read. G joins later;
U/V/R, W packaging/wiring and E's editor/physical/live evidence remain open.
Full `npm run quality` is explicitly prohibited by this brief and remains
with the lead. The host API inventory was regenerated and reviewed after A:
342 APIs, 33 VS Code importers, 26 Node built-ins, 61 theme variables, zero
problems. Native Arduino installation/qualification and cross-OS receipts
remain the inherited lane A/E obligations.

## Lane I contract and handoff to U/V/R

The implementation entry is `src/core/maker/ports.ts`. `MakerHost<Request =
ApprovalRequest>` has `confirm(request): Promise<unknown>`,
`notify(MakerNotice): void | Promise<void>`,
`stopControls(readonly MakerMachineSummary[]): void | Promise<void>`,
`openPreview(MakerPreview): Promise<void>`, `storage.workspace` and
`storage.machine` (canonical host-owned directory, asynchronous get/update/delete),
`secrets` (asynchronous get/store/delete), `isTrusted()`, `hardwareEnabled()` and
`isInteractive()`, plus optional `serialProvider`. Hardware admission must be
false for Plan, tasks, subagents, schedules, headless and every other unattended
context. Never route approval to a model, remembered rule or Bypass setting.
Stop controls invoke the engine's independent Stop path, including when trust,
hardware or interaction admission is false. SecretStorage/OS credentials are
adapter-owned; no key field exists in the surface protocol.

`ApprovalRequest` is a readonly discriminated union of serial, machine and
command requests. All carry a UUID id, SHA-256 digest, absolute expiry and
complete target snapshot. Serial includes exact text/hex bytes, line settings,
reset warning and captured flash-target classification; machine includes the
exact payload and the existing G-code analysis; command supplies G4's proposed
command payload without implementing its classifier or gate. Machine targets
include the immutable registration UUID, endpoint and observed identity;
serial targets include port, VID/PID, serial number and stable path. A friendly
serial description is display metadata, never identity authority.

`MakerApproval` validates, clones and recursively freezes the engine snapshot.
`answer(unknown)` accepts only `{ id, digest, target, decision }`, where decision
is `allow_once` or `reject_once`. An invalid, denied or replayed answer burns
that request's answer slot. Wall and monotonic expiry and admission are checked
at answer and dispatch. The resulting `ApprovedTargetBinding` is an opaque
local object by identity: a serialized/cloned or another instance's binding
cannot authorize anything. `consume(binding, liveTarget)` or `start(liveTarget)`
consumes it once and verifies the freshly read target. `hasStarted` is true only
for a successful final check. U only sends the answer; V/R retain this object.
The machine core gives a detached display clone to confirm; serial supplies the
frozen request. Neither allows the UI to change the retained authority.

`MakerSerialProvider` exposes read-only existing text through `context(signal)`;
`open(settings, maxBytes, signal, start)` must await `start()` after all setup,
then invoke its returned synchronous guard immediately before spawn/open, with
no intervening await. `release()` resolves after the port and runtime lease
close. `startSerialProcess` implements that final guard; `runSerialAction`
refuses an adapter that omitted it. D's `MakerDetectHost` and M's `MachineHost`
are `Pick<MakerHost<…>, …>` projections; P's confirm/open types come from this
same port. Existing machine drivers preserve their final write callback and
ungated Stop. This interface does not certify a third-party serial adapter.

`src/shared/makerProtocol.ts` exports the production parsers
`makerHostMessageSchema` / `MakerHostMessage` and
`makerSurfaceMessageSchema` / `MakerSurfaceMessage`, envelope `v: 1`, plus
request, answer, target, notice, preview, summary and preset schemas/types.
It imports only shared code and zod/mini: an actual browser bundle test
proves there are no core imports or Node shims. Detection's compatibility
export and G-code limits use these shared schemas, avoiding parallel shapes.
The contract is our own engine/surface wire, not a guessed external device
frame. New external services still require D83's captured-wire evidence.

| Direction   | Messages                                                                                                                                                                       |
| ----------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Engine → U  | makerApproval, makerApprovalClosed, makerNotice, makerPresets, makerPreview, makerStatus, makerState, makerDeviceLog, makerResult                                              |
| U → adapter | makerReady, makerAnswer, makerStop, makerHardware, makerStatus, makerSend, makerSerial, makerOpenLog, makerAddMachine, makerRemoveMachine, makerChoosePreset, makerOpenPreview |

U builds shared React UI and speaks only these messages through HostBridge.
The existing bridge accepts the chat protocol; U/W must compose this maker
union at that boundary and parse each direction before dispatch. There is no
bridge cast or UI implementation in this lane. Action requests do not grant
permission: V/R classify independently, read authoritative state, create the
approval and accept the corresponding host-UI answer. A makerStop with no id
means stop all held targets; process it ahead of admission and ordinary queues.
Machine registration is secretless and omits the engine-owned generation UUID;
V/R collect any key via
a host-owned input into the credential store. Open-preview uses an opaque
artifact UUID, never a surface-supplied path. Logs are explicitly requested,
scrubbed and local; result `sentOutcomeUnknown` must be visible before retry.

V owns `src/host/maker/`, host storage/secrets, native confirm and independent
Stop controls; R owns `src/runtime/maker/`, equivalent ACP/editor/companion
permissions and OS storage. Both consume this port and protocol and keep all
hardware under the engine. Thonny's v2 context/acquire/release proposal remains
unfrozen pending R/P agreement: it is a context and explicit user handover,
not a provider that executes device bytes. G4 joins later with its classifier,
hardware latch, per-shell prompts and token-bound final spawn check. W owns
commands/settings, activation/tools, packaging and bridge wiring. E owns
cross-editor, cross-OS, physical and live qualification. Nothing in I or 0
claims those lanes are implemented or certified.

The deterministic snapshots are `docs/schemas/maker-host-v1.schema.json` and
`maker-surface-v1.schema.json`, generated by `node scripts/maker-schema.mjs`;
`--check` is covered by the complete protocol suite. JSON Schema cannot express
runtime identity, permission, expiry or every zod refinement; its
`x-runtime-invariants` names those production checks. Snapshot drift was seen
to fail when the host status schema changed, then regenerated and passed.

## Lane I guard-fire receipts

All 28 deliberate mutations failed the complete owning test file, then
restored the source byte-exact (SHA-256 checked after every mutation). No
filtered or skipped case was used. Receipts name each guard:

| Guard                  | Failing cases | Restored source SHA-256 |
| ---------------------- | ------------- | ----------------------- |
| answer-replay          | 8 failed      | 26 passed (34)          | `1baaf07642d2078b9c2b756636b7286cffafad302efec069f74b28f7bb3ef22b` |
| answer-id              | 2 failed      | 32 passed (34)          | `1baaf07642d2078b9c2b756636b7286cffafad302efec069f74b28f7bb3ef22b` |
| answer-digest          | 1 failed      | 33 passed (34)          | `1baaf07642d2078b9c2b756636b7286cffafad302efec069f74b28f7bb3ef22b` |
| answer-target          | 1 failed      | 33 passed (34)          | `1baaf07642d2078b9c2b756636b7286cffafad302efec069f74b28f7bb3ef22b` |
| answer-decision        | 1 failed      | 33 passed (34)          | `1baaf07642d2078b9c2b756636b7286cffafad302efec069f74b28f7bb3ef22b` |
| wall-expiry            | 2 failed      | 32 passed (34)          | `1baaf07642d2078b9c2b756636b7286cffafad302efec069f74b28f7bb3ef22b` |
| monotonic-expiry       | 1 failed      | 33 passed (34)          | `1baaf07642d2078b9c2b756636b7286cffafad302efec069f74b28f7bb3ef22b` |
| initial-admission      | 1 failed      | 33 passed (34)          | `1baaf07642d2078b9c2b756636b7286cffafad302efec069f74b28f7bb3ef22b` |
| current-admission      | 2 failed      | 32 passed (34)          | `1baaf07642d2078b9c2b756636b7286cffafad302efec069f74b28f7bb3ef22b` |
| binding-object         | 2 failed      | 32 passed (34)          | `1baaf07642d2078b9c2b756636b7286cffafad302efec069f74b28f7bb3ef22b` |
| dispatch-replay        | 2 failed      | 32 passed (34)          | `1baaf07642d2078b9c2b756636b7286cffafad302efec069f74b28f7bb3ef22b` |
| live-target            | 10 failed     | 24 passed (34)          | `1baaf07642d2078b9c2b756636b7286cffafad302efec069f74b28f7bb3ef22b` |
| frozen-request         | 1 failed      | 33 passed (34)          | `1baaf07642d2078b9c2b756636b7286cffafad302efec069f74b28f7bb3ef22b` |
| detached-request       | 1 failed      | 33 passed (34)          | `1baaf07642d2078b9c2b756636b7286cffafad302efec069f74b28f7bb3ef22b` |
| target-port            | 2 failed      | 32 passed (34)          | `1baaf07642d2078b9c2b756636b7286cffafad302efec069f74b28f7bb3ef22b` |
| target-vid             | 1 failed      | 33 passed (34)          | `1baaf07642d2078b9c2b756636b7286cffafad302efec069f74b28f7bb3ef22b` |
| target-pid             | 1 failed      | 33 passed (34)          | `1baaf07642d2078b9c2b756636b7286cffafad302efec069f74b28f7bb3ef22b` |
| target-serialNumber    | 1 failed      | 33 passed (34)          | `1baaf07642d2078b9c2b756636b7286cffafad302efec069f74b28f7bb3ef22b` |
| target-stablePath      | 1 failed      | 33 passed (34)          | `1baaf07642d2078b9c2b756636b7286cffafad302efec069f74b28f7bb3ef22b` |
| target-registrationId  | 1 failed      | 33 passed (34)          | `1baaf07642d2078b9c2b756636b7286cffafad302efec069f74b28f7bb3ef22b` |
| target-id              | 1 failed      | 33 passed (34)          | `1baaf07642d2078b9c2b756636b7286cffafad302efec069f74b28f7bb3ef22b` |
| target-name            | 1 failed      | 33 passed (34)          | `1baaf07642d2078b9c2b756636b7286cffafad302efec069f74b28f7bb3ef22b` |
| target-endpoint        | 1 failed      | 33 passed (34)          | `1baaf07642d2078b9c2b756636b7286cffafad302efec069f74b28f7bb3ef22b` |
| target-identity        | 1 failed      | 33 passed (34)          | `1baaf07642d2078b9c2b756636b7286cffafad302efec069f74b28f7bb3ef22b` |
| strict-messages        | 6 failed      | 27 passed (33)          | `6c4b433f59307c42d8eacd2c0fdd0638f22e5910e4d345857347c7370fd4c96a` |
| protocol-version       | 2 failed      | 31 passed (33)          | `6c4b433f59307c42d8eacd2c0fdd0638f22e5910e4d345857347c7370fd4c96a` |
| final-spawn-guard      | 1 failed      | 13 passed (14)          | `810ebbdfbcda165b1fbdef7d5540285db2e4f2430c2bb05ebce1e329fb27b404` |
| adapter-guard-required | 1 failed      | 23 passed (24)          | `1e2ce128844eeda252b1d30f80727eb6cb887b639cb9fa8bfcac8e0de7bea239` |

Four additional drills cover constructor request validation, browser core/Node
imports and serial nested payload immutability after sharing the check schema:

| Guard               | Failing cases | Restored source SHA-256 |
| ------------------- | ------------- | ----------------------- |
| request-validation  | 4 failed      | 34 passed (38)          | `1baaf07642d2078b9c2b756636b7286cffafad302efec069f74b28f7bb3ef22b` |
| browser-core-import | 1 failed      | 32 passed (33)          | `bc79bce39acf32595bf905caa7c8ae27b713706cdfdd6b2250efc649090f24c7` |
| browser-node-import | 1 failed      | 32 passed (33)          | `bc79bce39acf32595bf905caa7c8ae27b713706cdfdd6b2250efc649090f24c7` |
| serial-deep-freeze  | 1 failed      | 23 passed (24)          | `1baaf07642d2078b9c2b756636b7286cffafad302efec069f74b28f7bb3ef22b` |

Owning restored runs: approval/protocol/serial 81 pass; contract/session 91
pass; shared check commands/presets/protocol 83 pass with two existing
Windows-only skips; G-code/registry/CAD 148 pass. Earlier affected serial and
machine suites pass 160 cases. Five TypeScript projects pass. The shared
check-command field extraction removes the sole newly reported clone while
preserving settings parsing and strict maker presets. Host API regeneration
adds only the new portable approval clock importer (`node:perf_hooks` count
1 → 2); VS Code APIs/importers, built-ins and theme totals stay unchanged.

Hardware-enable reason and nonblank-reason drills each fail the complete
protocol suite (1 failed / 34 passed) and restore SHA-256
`432c881c2d822f3a700f443215098af5b2a4eef0fc286901ca8b440dc48699b8`. Disabling requires no reason. The final
restored approval/protocol/session run passes **97 cases**. The outgoing
message type accepts frozen engine requests without casts.

Lane I final static receipts: changed-file ESLint and Prettier exit 0; plain
Knip exit 0; jscpd reports **0 clones**; normal entry cycles and the explicit
unwired maker graph (22 files) exit 0; production build, split, globals,
notices and every unchanged cap exit 0. Final typed protocol passes the unit
TypeScript project; the five-project pass precedes the last reason refinement,
and all five are rerun with lane 0. Build sizes remain 434.0 KiB activation,
447.0 Model API, 76.9 checkpoint, 792.9 webview startup, 818.2 ACP and
22.2 verification. No ignore, threshold, cap or rule level was changed.

## Lane 0 strings and localization

The contiguous English maker region has **46 keys**: the nine existing
detection keys plus 37 entries for human approval, hardware admission,
physical-stop/reset warnings, target/payload analysis, registration/LAN
privacy, limits, uncertain outcomes, logs, previews and counts. All fourteen
UI tables have real translations and their locale-specific plural categories.
Existing detection translations and every non-maker value are unchanged.
`UI_TEXT` is read at use time; use `fill`, `plural` and the Intl helpers.
Commands/settings belong to W and are not registered here, so no new
`package.nls*.json` keys are required. No English exemption was added.

Each full localization-gate drill reports exactly one problem and exits 1,
then restores the file byte-exact. No source or translation stays planted:

| Drill            | Path                                  | Restored SHA-256                                                   |
| ---------------- | ------------------------------------- | ------------------------------------------------------------------ |
| missing-key      | l10n/ui.cs.json                       | `204144400f00ef2de5b3026631efa3ded03b2ce33fec8465861987f26c1c8bda` |
| placeholder      | l10n/ui.fr.json                       | `9961b07edecbd9fc6f28351e6892d624b187f15ec25ba5f97ea70273e9c3b8de` |
| untranslated     | l10n/ui.ja.json                       | `c08c6cbe1070c704f4556d8ebe58adab60e859c833337d85b3364c02feba6f9b` |
| plural-category  | l10n/ui.pl.json                       | `23d7e2ed6bb22b39f2c6f85b7d05f9f380417e492dba75c4ec52ba9ea8353bf3` |
| duplicate-key    | l10n/ui.de.json                       | `91a8bf06c9c81c8b06464da3e5e0c5395986ff4c0b9ae79ab3bc7fc807dc550f` |
| module-load-read | src/core/maker/detect/checkPresets.ts | `8ce77f4eabab867fcb551d302e1af5c1934ed471863838e5a94fcfa7cd5597d8` |

The normal check reports **14 tables, 165 manifest strings, 635 source files,
0 problems**, including duplicate-key checks. The release base has no
`src/shared/featureCatalog.ts`, `scripts/gen-reference.mjs` or reference-check
script; joining that independent facility remains with the lead/W as in the
merged T receipt. This lane documents the schema generator and handoff without
inventing that separate system.

Lane 0 owning checks: localization/English-region/check-presets suites pass
**72 cases**; changed-file ESLint and Prettier pass; the production build
passes all caps, split, globals and notices. Final selected sizes:

```text
ok   dist/extension.js: 434.0 KiB (budget 600 KiB)
ok   dist/tab.js: 49.6 KiB (budget 75 KiB)
ok   dist/verifyEditor.js: 22.3 KiB (budget 25 KiB)
ok   dist/modelApi.js: 447.0 KiB (budget 475 KiB)
ok   dist/checkpointStore.js: 76.9 KiB (budget 225 KiB)
ok   dist/webview/main.js + static imports: 794.5 KiB (budget 900 KiB)
ok   dist/acp.js: 818.2 KiB (budget 850 KiB)
ok   dist/extension.js: 6 of the backend's 65 files (14.7 KiB), all on the allowed list
ok   dist/acp.js: 4 of the backend's files, all on the allowed list
ok   dist/modelApi.js: carries the 37 files that load only with the backend, and no English table
ok   dist/checkpointStore.js: carries the checkpoint implementation; activation keeps the port and synchronous loader
ok   dist/verifyEditor.js: loads only on the first diagnostics or formatting request, never at activation
ok   dist/tab.js: loads only on the first Tab request or menu, never at activation
ok   dist/extension.js: 0 reference(s) to navigator
ok   dist/tab.js: 0 reference(s) to navigator
ok   dist/verifyEditor.js: 0 reference(s) to navigator
ok   dist/modelApi.js: 0 reference(s) to navigator
ok   dist/checkpointStore.js: 0 reference(s) to navigator
```

The maker engine and surfaces remain unwired, so their lazy bundles and
D83’s final startup-growth requirement remain W/E’s qualification. The inline
browser English fallback grows with the authorized text region; no budget
was raised and no new engine or adapter loads at activation.

## Final handoff review corrections

`makerAddMachine.machine` is the secretless summary shape **without**
`registrationId`. The engine generates it; host lists, target echoes and
`makerRemoveMachine` retain it. The new regression accepts a generation-free
add, rejects a supplied generation, and still requires one on host summaries.
Protocol/approval/registry suites pass 94 cases. The two complete-file drills
fail by making generation required again (3 failed / 33 passed) and by
accepting a supplied generation (2 failed / 34 passed). Both restore SHA-256
`d14e3bd9c8b56f2ae952ccca954abf08e2970338fc930abdf36102a476c16b9e`.

P/X’s masked lease ABI drift is fixed: X’s original consumer expected version
1 and lacked P’s generation field. The new always-running lease-worker
case, added to the existing lifecycle suite, failed against that parser
(1 failed / 5 passed) before the fix. It uses an ordinary temporary file,
real Node child, native file lock and private owner endpoint; **no serial
open, emulator firmware, physical device or model call**. Its actual producer
frame is committed as `m103-int/lease-v2.capture.json`, captured on Kubuntu
in `/home/randy/lanes/M103INT`, with counted model attempts **0**. The
consumer’s version 2 and generation UUID come from that capture. Both the
board matrix and the always-running regression use `readMakerLeaseFrame`
in `test/e2e/helpers/makerEmulatorLease.ts`; one shared worker builder avoids
a copied fixture. The restored approval/protocol/lifecycle run passes 80
cases. This closes the P/X parser join but does not qualify the missing
board images/tools.

The lease-v2 drill fails the complete lifecycle suite (1 failed / 5
passed), then restores SHA-256 `1e5d6971eb30e6d7f135d92fd622737646351d8db1bd41d2b62e264c154efa61`.

The lease-generation drill fails the complete lifecycle suite (1 failed / 5
passed), then restores SHA-256 `1e5d6971eb30e6d7f135d92fd622737646351d8db1bd41d2b62e264c154efa61`.

## Final gates and remaining owners

The final corrected tree passes all five TypeScript projects; ESLint over
105 merged code paths and Prettier over 210 supported-format paths;
localization (14 tables, 165 manifest strings, 635 sources, zero problems);
host API --write and byte check; plain Knip; jscpd (zero clones); both the
normal and explicit 22-file maker dependency graphs; maker schema drift; and
both Arduino API 1.96 projects. Regenerated host inventory still has 342 APIs,
33 VS Code importers, 26 Node built-ins and 61 theme variables; only lane I’s
previously reviewed perf_hooks importer count changes. Shared node_modules,
all gates and all caps remain unchanged.

The Arduino profile production build with integration bundles passes size,
split, globals and notices; the normal production build does too. The final
normal build is restored, with its integration bundle present for the
30 passing Arduino board/build/host fixture cases. The Arduino type-floor
install is the existing pinned @types/vscode 1.96.0 only, private scratch.
This is compilation and fake-host evidence, not an installed Arduino receipt.

All 45 deliberate mutation drills (one split, 34 I guards, six localization,
two registration-generation and two lease-frame) fail their full owning suite
or gate and restore byte-exact. The original P/X parser also fails the new
always-running case before correction. Final review tests pass 66 cases
(lifecycle, protocol, serial session); the complementary approval/registry
checks pass as recorded above. Thonny’s existing Python 3.14/pytest 9 run
passes 190 cases. No new skips or filters; existing platform skips are named.

G4 joins only after review. U builds the shared React surface/HostBridge
composition; V supplies VS Code adapters and authoritative admission,
storage/secrets and independent Stop; R supplies equivalent runtime/ACP/
companion permissions and freezes Thonny R/P handover. W wires tools,
commands/settings, lazy maker/preview bundles, packaging and help/reference
integration. E/lead supply fresh board assets/emulator matrix, installed
Arduino/other editors, cross-OS/physical/live evidence, startup requirements
and full quality/coverage/accessibility. The failed opt-in X run is preserved
as missing qualification. This branch claims no support beyond its receipts.

Final package/budget/deferred-manifest fixture run: **57 pass** after the
corrected tree’s production/integration build. Hooks are enabled on every
merge and implementation commit; lint-staged and gitleaks report no leak.
The work is completed within the 150-minute box, with no push or guard join.
