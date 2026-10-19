# M9/M35 companion microphone — CMICCOMP, 2026-10-10

Status: implementation hidden; Linux fake-device/ACP certification passed.
Scoped source gates and the final owning regression runs passed on linuxlt.
Branch `c/m35-mic`, base `82d50d5e4`, rig `linuxlt`. No paid/live model calls,
external network reads, new dependencies or changed quality thresholds.

## Scope and release hold

The existing authenticated loopback server carries a separate, lazily loaded
browser microphone page. Voice owns its authenticated server and handler; Usage retains its existing protocol.
The two pages share only the bounded browser transport implementation.
WAV input is canonical mono PCM16 at 16 kHz, at most 60 seconds and 1,920,044
bytes; duration comes from validated PCM bytes. One short-lived, single-use
ticket owns each recording. Disconnect/cancel, stale runtime, concurrent
operations, malformed fields, foreign origin and missing bearer refuse work.
The browser releases tracks on stop/cancel/error/page exit, clears sample buffers,
and inserts only the matching capture's transcript at the review prompt's caret.
Only explicit Send submits reviewed text. No launch or transcription starts a turn.

Windows uses the existing `dictate.ps1 -InputWav` engine. macOS adds
`SFSpeechURLRecognitionRequest` to the signed helper and skips microphone
permission in file mode; speech-recognition permission still applies.
The host privately stages free-engine WAV bytes with proven owner-only
permissions and deletes them after the child exits, including failure/cancel.
Linux has no free OS recognition route; paid voice works through the browser.
Paid audio is held in memory only. This is reference cleanup, not a claim of
physical memory zeroization or crash-proof deletion of OS temporary files.

Paid batch wire evidence: `docs/research/m105-captures/round3-2026-10-08.jsonl`,
U18 T7/T8/T9, three counted Model API attempts, summarized in
`docs/certification/m105-captures.md`. The endpoint uses multipart `request`
with model `muse-voice-transcribe-1.0`, WAV and PUSH_TO_TALK, plus `audio`;
response sessionId/transcript/audioDurationMs/turns comes from those captures.
No new live attempts in this lane. Bill uses returned audioDurationMs rounded
DOWN to whole seconds at $0.18/hour. Admission reserves the full validated
recording bound in the runtime's cross-window local-day ledger. Sent failures
without a trustworthy receipt retain that reservation and an uncertain tally;
known receipts settle their actual bill even when transcription is refused.
No automatic retries. Consent is once per companion window, price/key-bound;
workspace remembrance is available only for trusted workspaces. ACP uses the
editor permission request; CLI uses the browser dialog. Dropping the voice flag
revokes workspace voice grants on either backend. The free-only CLI route also
revokes grants before an unavailable OS engine is refused. The Model API
key never enters the page, file, child, log, argument or process environment.

`COMPANION_VOICE_RELEASE.isReady` stays false. The CLI parser/options/table,
ACP runtime binding and Help feature row are conditional on this hold; `/dictate`
is announced only when its real runtime factory is bound. No new entry point
is surfaced. The lead must obtain platform and assigned editor receipts, review, run full quality,
and explicitly remove the hold before publishing.

## Editor and platform matrix

| Route                                                                                     | Implemented                                                                                    | Evidence                                          | Remaining                                                                            |
| ----------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------- | ------------------------------------------------- | ------------------------------------------------------------------------------------ |
| VS Code and VS Code forks                                                                 | Existing M9/M35 mic route unchanged                                                            | Existing milestone records                        | This lane adds no new editor-native route                                            |
| ACP editors: Zed, Neovim, Emacs, JupyterLab, JetBrains, Xcode, Qt Creator, Sublime, Devin | Browser review prompt sends through owning ACP session using standard session prompt admission | Fake ACP agent + actual Chrome fake-mic on Linux  | Real editor receipts in C-M63-1 / C-M104-1; Windows/macOS fake-mic receipts          |
| Terminal/headless calling a CLI interactively                                             | One-shot reviewed text to stdout; launch link on stderr; explicit Send only                    | Compiled CLI process cases: Send, abort and close | Installed package and all OS browser runs; unattended CI does not capture a mic      |
| Native MHP panels: JetBrains, Visual Studio, Eclipse, other companion/shim editors        | Shared companion engine can be bound by runtime owner                                          | No native panel claim                             | C-M104-1 binds the runtime owner; no new host capability row is marked complete here |
| Windows free engine                                                                       | Existing WAV helper invocation, private staging/lifecycle                                      | Fake helper on Linux                              | Actual PowerShell speech recognition and browser receipt                             |
| macOS free engine                                                                         | URL-file recognition, no host mic access                                                       | Fake helper on Linux; Swift source review         | macOS compile/signing/TCC and actual recognition/browser receipt                     |
| Linux paid engine                                                                         | Complete browser/host path, captured HTTP parser, real durable budget                          | Chrome fake audio and fake HTTPS provider         | No paid/live call authorized; production receipt stays with lead                     |

## Verification

All vitest commands use repository timeouts and `--maxWorkers=3`, at most
three files per invocation. Logs stay under ignored `temp/`.

- `companionVoice.test.ts`, `companionVoicePaid.test.ts`,
  `companionVoiceSystem.test.ts`: 63 tests passed on Linux.
- `companionVoiceBrowser.test.mjs`: Final Chrome suite passed all eleven tests with
  `--use-fake-device-for-media-stream --use-file-for-fake-audio-capture`.
  Actual encoded audio, consent-before-mic, consent once, editor Allow/Deny/closed
  session responses, canceled pending
  permission, track teardown, explicit Send, ACP insertion and server refusals.
  Axe reports no violations in dark/light/hc-dark/hc-light at 320 px, including
  the paid dialog, and no horizontal overflow.
- `companionVoiceCli.test.mjs`: three compiled-CLI process cases passed. Only
  the release switch, browser factory and journal writer are test substitutes;
  actual CLI parsing, stdout admission, abort/close failure, paid recording and
  final flush run. No OS credential is read and no provider is called.
- Typecheck passed across host, webview, unit, e2e and integration projects.
  Final source checks and regression receipts are recorded below.

## Same-day review

Validation/security: independently bounded canonical base64/WAV, private bearer
and launch fragment, exact origin/custom header, strict message schemas and
captured response parser. Private OS audio reuses existing ACL verification.
Failure/honesty: no empty transcript success; generic safe errors, no vendor
bodies/paths; known and uncertain charges retained after dispatch; no retries.
Concurrency/lifecycle: single operation and ticket per authenticated window,
owner checks before and after awaits, cancellation of consent/HTTP/helper,
late getUserMedia tracks stopped and late transcript capture fenced; accepted
ACP turns outlive only the admission request and session close releases pages.
Docs: release hold, platform/editor omissions and billing assumptions are
explicit; generated Help/roadmap stay current. No Preview wording added.

## Red drills and final gates

52 named mutations failed the owned tests at repository timeouts. Source
bytes were restored to the before-drill SHA-256 every time. Full receipts and
failed test names: [m35-companion-drills.json](m35-companion-drills.json).
Coverage includes WAV geometry/size/duration, hidden release entry points,
ticket ownership/expiry/replay/cancel, stale owner, overlap/disconnect, buffer
wiping and Send retry, consent/once/id/grant, captured multipart, daily admission,
key rotation before/after dispatch, fee settlement and uncertain usage journals,
free helper failures/timeouts/file mode/Linux refusal/private staging/deletion,
late getUserMedia cancellation, explicit Send, accessibility, origin/bearer/body
caps, microphone permissions policy, canonical base64, lazy split and runtime
lifetime shutdown, recording/Send exclusion, CLI journal binding and flush,
and all three independent bundle budgets. Deliberately broken lifetime/late-track tests reached the
normal 5 s deadline; no deadline was raised.

The main ACP connection now aborts its dictation lifetime directly on closure,
before backend/resource teardown; each page combines that lifetime with its
session signal. This prevents the loopback server retaining the process after
stdio disconnect on a backend that does not emit an exit event. Factory owner
shutdown is proven in Chrome; packaged CLI/real editor receipts remain held.

### Final linuxlt receipts

664 distinct tests across 20 owned/affected files passed (77 voice tests and
587 owning regressions). The final reference/runtime/CLI process batch passed
164/164 after reference generation; the stale-file setup failure was not
counted as a passing or skipped certification. Earlier reference generation
caught an omitted inherited `playbook` route; inventory now includes all
public generated rows plus held source rows, while Help still omits held routes.

All final exits were 0: changed-file ESLint and Prettier; five type projects;
production build with size/split/model-text/host-global/notices gates;
tokens, reference, roadmap generation/check, localization (14 tables),
duplication (0 clones), dead code, host API and plan. New browser metadata is
registered with the existing independent browser exclusions from Node checks;
its own artifact cap remains enforced and was red-drilled. No existing gate
cap, threshold, ignore or test deadline was relaxed.

Measured production bytes: voice host 100.3/125 KiB, independent browser
67.4/100 KiB, CSS 16.5/25 KiB; activation 550.2/600 KiB and Model API
515.9/525 KiB. Full quality/coverage, installed packages, all-OS browser and
actual Windows/macOS free recognition, and the assigned real editor/native
bindings remain with the lead. This lane does not mark those rows complete.

Same-day fixes include ACP editor consent routing, flag-off grant revocation,
a second recording's Send exclusion on both client and host, CLI paid history
binding and final flush, shared browser transport, and runtime-disconnect page
shutdown. Native Swift source remains uncompiled on this Linux rig.

### Stereo encoding review

Post-commit audio review found that rounding each stereo channel into Int16
before adding could wrap a positive full-scale sample to -32768. The portable
encoder now averages float channels before one clipping/rounding operation;
full-scale positive/negative, opposing channels, half-scale and overshoot have
sample assertions. The old algorithm failed the named test, then the file was
restored to its exact SHA-256 (`stereo-pcm-mixing`). Browser layout is unchanged.

### Visual scope

The unsharded legacy visual check was interrupted with exit 130 after 1,440
baseline frames: it must regenerate 9,792 baseline frames and compare 9,792
candidate frames, which exceeds the remaining 180-minute lane time box. This
is not a passing full-matrix receipt. The supported scoped shard 16/64 passed
all 156 frames with zero changed pixels, including 16 Usage scenes affected by
the shared transport. Its baseline was regenerated from the recorded revision
with Chrome 153.0.8010.52 on Linux; the manifest stayed unchanged. The
standalone voice page has its own six reviewed images and Chrome/axe coverage;
its source revision, hashes, dimensions and coverage are recorded in
[m35-companion-visual.json](m35-companion-visual.json). All six images were
inspected under `CMICCOMP-2026-10-10-linuxlt-accessibility-responsive-review`;
the PNG files stay in ignored lane artifacts. This is the lane agent's review;
the owner's release review remains outstanding.
The lead retains full quality, full visual matrix and the other OS/editor rows.

### RVCMICCOMP red drills (2026-10-10, macbook rig, no browser)

Three further drills cover the review findings, each with a browser-free
regression test at the repository's own timeout (no `--testTimeout` raised).
Every drill broke the fixed source, watched exactly the named test fail, and
restored the file to its before-drill SHA-256:

| Finding                        | Mutation                                                                                                               | Failing test                                                                                                                                            |
| ------------------------------ | ---------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 3, capture-generation fence    | Removed `if (owner !== generation) return` from `cancelCapture` in `src/webview/voice/companion.ts`                    | `companionVoicePage.test.ts`: status read `Dictation failed…` instead of `Listening…`, the replacement's tracks ended and a new cancel reached the host |
| 5, Send re-enable on input     | Removed the prompt `input` listener in `src/webview/voice/companion.ts`                                                | `companionVoicePage.test.ts`: `send.disabled` stayed `true` after typing `Corrected phrase`                                                             |
| 4, permission RPC cancellation | Dropped `{ cancellationSignal: signal }` from the paid-consent `session/request_permission` call in `src/acp/agent.ts` | `acpAgent.test.ts`: the editor-side abort never arrived, so the wait for it timed out inside the repository deadline                                    |

The finding 3 and 5 regressions run in jsdom with faked media
(`test/unit/companionVoicePage.test.ts`); the earlier browser versions of
those two cases were removed because no browser starts inside the lane
sandbox. The finding 4 regression is a unit test with a fake editor
(`test/unit/acpAgent.test.ts`). Real-Chrome receipts for all three paths stay
with the lead: the browser suites that cover them are
`test/unit/companionVoiceBrowser.test.mjs`,
`test/unit/companionBrowser.test.ts`, `test/unit/companionMediaBrowser.test.mjs`
and the voice CLI suite `test/unit/companionVoiceCli.test.mjs`.

### RVCMICCOMP2 fixes (2026-10-10, macbook rig, no browser)

Both P3 findings are fixed, each with a regression test and a red drill at
the repository's own timeout (no `--testTimeout` raised). Source bytes were
restored to the before-drill SHA-256 every time.

| Finding                                    | Fix                                                                                                                                                                                                                                                       | Regression test                                                                                                          | Red drill                                                                                                                                                                                                                                                                                                 |
| ------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1, finding-4 drill digest was 69 hex chars | `m35-companion-drills.json:548` now records the real SHA-256 of `src/acp/agent.ts` at `fb5668e10` (`5f6c1a50…97fbd`, verified with `sha256sum`)                                                                                                           | New `test/unit/companionDrills.test.ts`: every digest in the drills file matches `/^[0-9a-f]{64}$/`                      | Truncated the first entry's digest to 63 chars: the named test failed (`wav-geometry: expected '218e0682…' to match`), file restored byte-exact (`0752e876…b2a80bc4d` before and after)                                                                                                                   |
| 2, dictate.ps1 tarball assertion never ran | `test/unit/usagePackaging.test.mjs` fixture now stubs `dist/voiceCompanion.js` (the `BUNDLES` entry added with the companion) and `dist/webview/voiceCompanion.js`/`.css` (the `pageAssets` copies), so the happy-path test reaches the tarball assertion | The existing `expect(files).toContain('package/native/windows/dictate.ps1')` now executes and passes (12/12 in the file) | Dropped `...VOICE_WINDOWS_HELPERS` from the packager copy loop: the tarball test failed exactly at the assertion (`expected […(97)] to include 'package/native/windows/dictate.ps1'`, `usagePackaging.test.mjs:212`); `scripts/package-acp.mjs` restored byte-exact (`284e9c0e…91cb563` before and after) |

Sibling sweeps. All 52 digests in the drills file are 64 lowercase hex
(one bad, now fixed). The packager's `BUNDLES` list was diffed against the
fixture's stub list: `voiceCompanion` was the only missing stub
(`providerCatalog` is staged separately); the other two packaging fixtures
(`runtimeChatGptPackage`, execStdio e2e) copy production builds, so they
already carry the companion files.

Rig note: this macbook's shared `~/.npm/_cacache` holds root-owned files,
so the fixture's `npm pack` fails with EPERM unless `npm_config_cache`
points at a writable directory (used `temp/npm-cache`, gitignored). No repo
file was changed for this; hosted CI with a healthy npm cache is unaffected.
No browser was started: the browser suites covering these paths stay with
the lead.

### RVCMICCOMP3 fix (2026-10-10, macbook rig, no browser)

The single P3 is fixed, with a regression test and a red drill at the
repository's own timeout (no `--testTimeout` raised). Source bytes were
restored to the before-drill SHA-256.

| Finding                                                                                          | Fix                                                                                                                                                    | Regression test                                                                      | Red drill                                                                                                                                                                                                                                                                                      |
| ------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Receipt test accepted any well-formed digest (finding-4 row with 64 `a` characters stayed green) | `test/unit/companionDrills.test.ts` now also requires the three lane-recorded `rvcmiccomp-*` receipts to equal the live SHA-256 of the file each names | New `records the current restoration receipts as the live SHA-256 of the named file` | Replaced the finding-4 digest with 64 `a`s: the old shape test passed (the reported gap) while the new test failed naming the row (`rvcmiccomp-4-permission-cancellation-signal: expected 'aaaa…' to be '5f6c…'`); the drills file restored byte-exact (`0752e876…b2a80bc4d` before and after) |

Scope note: checking every recorded digest against HEAD was rejected as the
repair. Older rows are point-in-time history, and several recorded digests
never matched committed history: `voiceSystem.ts` is `ba33…` at every commit
but recorded as `87c8…`, `main.ts` is `d7f1…` but recorded as `f3f2…`, the
stereo fix superseded the `wav-*` rows' digest, and the `dist` bundles rebuild.
The live check therefore covers exactly the three current receipts. Sibling
sweep: the lane's other 64-hex shape assertions (`judgeEntries`,
`ideMcpServer` Bearer, `developerOptionsMachineId`, `m105CaptureScrub`,
`machineId.ts`) assert formats of function outputs, not restoration records,
so they are unchanged. No browser was started: the browser suites covering
these paths stay with the lead.

### Local commit and handoff

`674c83bb2` contains the guarded implementation and certification hold;
`ee472698d` fixes stereo sample mixing and records final test/drill counts.
Both commits ran the repository's installed lint-staged and gitleaks hooks.
The pre-hook staged diffs and committed diffs were re-read and matched exactly;
all staged source hashes also matched after each hook. No hook rewrites,
pushes, merges or rebases. Source revision `ee472698d` owns the reviewed images.

Next: lead integrates the lane, runs full quality/coverage and the complete
visual matrix, obtains the Windows/macOS recognition/browser and assigned
C-M63-1/C-M104-1 installed editor/package receipts, then reviews the hidden
entry points before explicitly removing `COMPANION_VOICE_RELEASE`'s hold.
This Linux lane cannot certify native speech/TCC on another OS or uninstalled
editors, and its brief forbids live paid calls. No dependency was installed.
