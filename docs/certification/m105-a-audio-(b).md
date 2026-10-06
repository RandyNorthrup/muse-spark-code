# M105-A Audio (b) certification

Mac mini, `/Users/randy/lanes/M105A`, branch `m105/a`, base `386729cf`,
2026-10-06. Read the rig brief, shared common rules, AGENTS.md, D85 and M105
in full, the coverage research and `m105-captures.md`.

## Result and boundary

The portable D85.5 sound router and batch orchestration are implemented.
The selected record controls native audio and soundtrack handling; no model
name or vendor-wide assumption grants a capability. Meta's U7 projection
never offers native audio. Muse Code refuses with the Model API reason.
1.3's soundtrack choices are transcription, a caller-proven soundtrack model
(1.2 at Meta) for this message, and sending the video without sound. Wav/mp3
can transcribe or wrap as an mp4 only with a converter and a hearing model.
Unknown native support refuses. An unavailable transcription adapter never
silently defaults to changing models.

`prepareAudioAttachment` keeps file bytes and credentials out of its API.
It consumes an opaque confined-read token, parsed media metadata and injected
ports. Batch calls need the voice gate, the existing three-choice consent,
a known duration and evidence-backed billable upper bound, durable admission,
and a final owner/setting/budget check. No retry can reuse a claim. Known
receipts settle their bill; missing receipts and failed sent attempts retain
uncertain liability. Fractional seconds remain in PaidUsage. Extracted files
are disposed in finally; wrapped files have an explicit upload/discard lease.
Empty/oversized transcripts and bad conversion results fail explicitly.

The Model API session has an optional `prepareAudioMessage` port. Prepared
text enters beside the media, its model applies to every round of this
message, and the next message uses the session's original selected model.
The port cannot run for review, goal, hook continuation, scheduled or subagent
turns. Model revision and the supplied owner fence are checked after waits
and at dispatch. Prepared text and text steered during preparation share the
aggregate named-text limit. Ordinary raw request bodies remain identical.

The shared React sound surface works through
`AttachmentChips.renderAudio`, with `AttachmentSound` lazily importing its
buttons. Labels are projected at use time from the existing translated media
region; no new English or manifest keys are needed. The small shared type
module keeps the browser away from Node-only type dependencies.

**This lane is integration-ready code, not a claim of shipped batch support.**
M1/M2/M95's implementations and U18's exact response/billing receipts are
absent on this base. The brief explicitly requires injected ports for these
dependencies. No HTTP schema, capability record or provider receipt was
invented. The surface remains behind its renderer port until W/E1 can bind
it without breaking the optional UI cap.

## Named integration handoffs

| Binding        | Owner and concrete action                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| -------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| A-U18-BATCH    | Lead/capture owner: supply scrubbed batch wav/mp3/mp4/mov request/response frames, workspace, counted attempts and billing/rounding receipts. Implement the adapter behind `BatchTranscriptionPort`, parse its real HTTP boundary, declare only captured formats and a proven billable-duration upper bound. It streams the confined source, retrieves the stored key internally, checks admission after that wait and before every attempted send, and aborts on the supplied signal. Adapter errors must be fixed public reasons, without provider bodies, keys or private helper paths.                                                                                                                                                       |
| A-M1-CONVERT   | M1: bind `AudioConversionPort` for extractWav/wrapMp4 and its availability flags. Wrap audio with a still frame. Verify the absolute executable through the trusted-path port; use argument arrays, no credentials, bounded owner-only output, a stable validated source, sniffed duration/sound and idempotent cleanup. Unknown bounds stay unavailable. No permission or privacy setting was changed here; native permission-gated checks remain with their recorder/converter lanes.                                                                                                                                                                                                                                                          |
| A-M2-MESSAGE   | M2: bind `ModelApiHostDeps.prepareAudioMessage` through the lazy media bundle, resolving accepted attachment choices to the router. Append its transcript as a textFile part beside the uploaded video; standalone transcription omits the audio. Upload wrapped media then dispose its lease. Use the returned per-message model for encoding, capability/replay gates, reservations and billing. Keep Meta input_audio forbidden. Route audio-bearing steers through a fresh admitted message rather than bypassing preparation. Bind the model-specific message pill; this lane emits the per-message notice and selected chip action without changing session model/settings.                                                                |
| A-C-CHOICES    | C/M95: project captured record fields into `AudioRoutingContext`; validate the same-provider/tier fallback and contributor consent after each wait. Run C's contributor question before spending/sending. Project fresh localized labels when the display language changes. Unknown records grant nothing.                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| A-PAID-DAILY   | W/paid owner: use the existing gate (interactive default-on, explicit false respected), a batch instance of PaidUseConsent with voice window-once generation/revocation and the existing workspace grants. Use `batchTranscriptionQuestion(name, museSpark.paidDailyBudgetUsd)` in its existing three-choice popup. Bind `reserve` to D78 and M82's existing durable ledgers; undefined settlement retains the full claim, zero refunds an unsent attempt. No separate store, key lane or paid approval card. ACP/headless defaults stay off.                                                                                                                                                                                                    |
| A-E1-UI-BUDGET | W/E1/C: bind `AttachmentSound` through `AttachmentChips.renderAudio` and validated metadata-only action messages. Default-on choices still ask before any charge. The current browser optional total has insufficient headroom for the direct binding; recover space or use D85's separately budgeted page entry while preserving every existing cap. W owns build/budget/split changes.                                                                                                                                                                                                                                                                                                                                                         |
| A-EDITORS-DOCS | W/E1/E2/E3/M104: bind the same core ports and shared React surface in VS Code family, remote/companion, native embedded panels and ACP clients. No vscode import exists in the new logic. Headless receives named refusals when its paid flags/consent/budget are unavailable; no recording can start here. Host/native editor receipts, four-theme/320px accessibility, README modality matrix, PRIVACY, CHANGELOG/PLAN status and featureCatalog entries (the file is absent on this base) remain with W. Reference entries needed: soundtrack choices, batch transcription at $0.18/hour with daily budget/first charge consent, converter-gated audio-as-video and the per-message model choice. No new command/setting is contributed by A. |

## Capability cases certified with fakes

| Selected evidence projection            | Soundtrack                                                    | Standalone audio                                  |
| --------------------------------------- | ------------------------------------------------------------- | ------------------------------------------------- |
| Muse Spark 1.3, U4/U7 summary           | Choices above; transcription requires a real captured adapter | Native off; transcription or converter-gated wrap |
| Muse Spark 1.2, U4/U7 summary           | Heard: no needless sound actions                              | Native off                                        |
| Any vendor's captured yes/format record | On exactly for supported formats                              | Native on exactly for a heard format              |
| No/unknown video/audio/soundtrack       | Named refusal/unknown warning; no native send                 | Named refusal; no native send                     |
| Muse Code                               | Media refusal belongs to E3                                   | Off: needs Model API backend                      |

These are test projections, not fabricated complete live model records.
Actual provider and editor release matrices still require the named bindings
and captures above. The host test drives the real ModelApiHost/client against
the existing fake Model API; all batch/converter results are test-only ports.

## Budget finding and stopped approach

A read-only in-memory esbuild probe, replacing only the chip source with its
HEAD version, measured the base optional total at **50,846 bytes (49.654 KiB)**.
The initial direct lazy sound binding reached **51,859 bytes (50.644 KiB)**.
Moving labels into the host projection and reducing the button renderer still
reached **51,322 bytes (50.119 KiB)**. Switching that renderer to createElement
still failed at about **50.2 KiB**. Per common.md's two-failed-fixes rule, that
binding approach stopped. No other surface was refactored and no cap rose.
The final tree keeps a renderer interface and an independently tested lazy
surface; its production entry binding is explicitly owed to W/E1.

## Verification

All verification ran directly on the Mac mini. Final test runs used the
repository timeout and at most three files/workers, with no filtering.

| Direct command                                               | Result                                                                                                  |
| ------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------- |
| `npm run typecheck`                                          | exit 0, all five projects                                                                               |
| `npx eslint --max-warnings=0` on all 12 changed TS/TSX files | exit 0                                                                                                  |
| `npx prettier --check` on all 13 changed files               | exit 0                                                                                                  |
| `npm run deadcode`                                           | exit 0; two pre-existing configuration hints, no unused code                                            |
| `npx jscpd`                                                  | exit 0, zero clones; it first caught repeated new test assertions, which now share one assertion helper |
| `node scripts/check-l10n.mjs`                                | exit 0; 14 tables, 164 manifest strings, 596 source files, zero problems                                |
| `npm run check:host-api`                                     | exit 0; 332 VS Code APIs, 31 importing files, 25 Node built-ins, 61 theme variables, zero problems      |
| `npm run build`                                              | exit 0; production size, split, host-global and notice checks pass; every cap unchanged                 |
| `git diff --check`                                           | exit 0                                                                                                  |

Vitest runs, each `npx vitest run <listed files> --maxWorkers=3`:

| Files                                                                                 | Result                                                                                               |
| ------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------- |
| `transcribeBatch.test.ts`, `modelApiAudio.test.ts`, `AudioAttachmentActions.test.tsx` | 44 passed                                                                                            |
| `audioBundle.test.ts`, `modelApiGoldenRequests.test.ts`, `paidFeatures.test.ts`       | 49 passed                                                                                            |
| `modelApiAudio.test.ts`, `modelApiHost.test.ts`, `Composer.test.tsx`                  | 700 passed after the shared assertion change                                                         |
| `transcribeBatch.test.ts`, `paidFeatures.test.ts`                                     | 61 passed after changing the tally refusal to an existing localized message and re-proving its guard |

There are **45 new tests and 785 distinct passing tests across eight files**.
The raw-body comparison includes an ordinary port-free request and a port
returning undefined, plus the existing raw golden request suite. Vite printed
its existing config-loader migration warning; no timeout was raised.

Final reported production sizes (KiB):

| Bundle                           |  Size | Existing cap |
| -------------------------------- | ----: | -----------: |
| extension                        | 436.8 |          600 |
| Model API                        | 447.5 |          475 |
| ACP                              | 816.8 |          850 |
| browser main plus static imports | 898.9 |          900 |
| browser deferred JavaScript      |  49.7 |           50 |

The new batch core and sound surface are unbound integration modules; the
build sizes do not claim that their final production binding fits yet.

`npm run quality`, the full test suite and merges were not run: the shared
lane rules forbid them and the rig brief forbids merge/push/rebase. Hooks
resolve through `.husky/_`; the pre-commit hook exists and gitleaks is installed.
No dependencies/tools were installed. No live, paid, subscription, capture,
external network or upstream filing calls ran: **0 attempts, 0 spend, 0 uploads**.
No credentials were read, printed, copied or stored.

## Red drills

Each row ran its entire listed Vitest file with maxWorkers=3 and the repository
default timeout (no test filtering or --testTimeout). The named test failed
with exit 1; the exact original file bytes were restored and SHA-256 compared.
The initial dispatch test stopped on its third fence call before key lookup,
so removing the final dispatch check did not fail it. That test was corrected
to change the owner during actual key retrieval, then proved the final guard.
The failed exploratory drill was not counted as proof. The final audit added
eight isolated drills for the remaining early gates, accepted formats, absent
adapter and blank output: **37 distinct guard drills, all proved**.

| Broken behavior        | Named failing test (in its full test file)                                         | Result                   |
| ---------------------- | ---------------------------------------------------------------------------------- | ------------------------ |
| meta-native-audio      | `test/unit/transcribeBatch.test.ts`: enables other vendors only                    | exit 1; SHA-256 restored |
| unknown-video          | `test/unit/transcribeBatch.test.ts`: refuses unknown video                         | exit 1; SHA-256 restored |
| muse-code              | `test/unit/transcribeBatch.test.ts`: refuses unknown video                         | exit 1; SHA-256 restored |
| soundtrack-capability  | `test/unit/transcribeBatch.test.ts`: offers transcription and converter-gated wrap | exit 1; SHA-256 restored |
| converter-availability | `test/unit/transcribeBatch.test.ts`: offers transcription and converter-gated wrap | exit 1; SHA-256 restored |
| capture-availability   | `test/unit/transcribeBatch.test.ts`: keeps U18 unavailable                         | exit 1; SHA-256 restored |
| action-validation      | `test/unit/transcribeBatch.test.ts`: enables other vendors only                    | exit 1; SHA-256 restored |
| cancel                 | `test/unit/transcribeBatch.test.ts`: does not dispatch when aborted                | exit 1; SHA-256 restored |
| current-owner          | `test/unit/transcribeBatch.test.ts`: rebinds after the question                    | exit 1; SHA-256 restored |
| known-duration         | `test/unit/transcribeBatch.test.ts`: does not dispatch when unknown duration       | exit 1; SHA-256 restored |
| billing-bound          | `test/unit/transcribeBatch.test.ts`: refuses an invalid billable upper bound       | exit 1; SHA-256 restored |
| paid-consent           | `test/unit/transcribeBatch.test.ts`: does not dispatch when denied                 | exit 1; SHA-256 restored |
| final-paid-gate        | `test/unit/transcribeBatch.test.ts`: rechecks the gate and budget                  | exit 1; SHA-256 restored |
| retry                  | `test/unit/transcribeBatch.test.ts`: rechecks the gate and budget                  | exit 1; SHA-256 restored |
| admitted-result        | `test/unit/transcribeBatch.test.ts`: adapter that bypasses final admission         | exit 1; SHA-256 restored |
| utf8-limit             | `test/unit/transcribeBatch.test.ts`: refuses empty or oversized UTF-8 transcripts  | exit 1; SHA-256 restored |
| uncertain-liability    | `test/unit/transcribeBatch.test.ts`: retains uncertain liability                   | exit 1; SHA-256 restored |
| receipt-bound          | `test/unit/transcribeBatch.test.ts`: settles an over-bound receipt honestly        | exit 1; SHA-256 restored |
| extraction-duration    | `test/unit/transcribeBatch.test.ts`: checks extraction duration                    | exit 1; SHA-256 restored |
| private-cleanup        | `test/unit/transcribeBatch.test.ts`: extracts only when required                   | exit 1; SHA-256 restored |
| message-model          | `test/unit/modelApiAudio.test.ts`: uses 1.2 for the entire message                 | exit 1; SHA-256 restored |
| transcript-part        | `test/unit/modelApiAudio.test.ts`: appends the batch transcript                    | exit 1; SHA-256 restored |
| model-revision         | `test/unit/modelApiAudio.test.ts`: refuses a held choice                           | exit 1; SHA-256 restored |
| dispatch-fence         | `test/unit/modelApiAudio.test.ts`: rechecks the prepared fence immediately         | exit 1; SHA-256 restored |
| steered-budget         | `test/unit/modelApiAudio.test.ts`: counts text steered during batch                | exit 1; SHA-256 restored |
| lazy-ui                | `test/unit/audioBundle.test.ts`: ships sound controls through a dynamic chunk      | exit 1; SHA-256 restored |
| batch-tally            | `test/unit/transcribeBatch.test.ts`: keeps fractional batch tally                  | exit 1; SHA-256 restored |
| wrap-shape             | `test/unit/transcribeBatch.test.ts`: rejects invalid conversion results            | exit 1; SHA-256 restored |
| final-budget           | `test/unit/transcribeBatch.test.ts`: rechecks the gate and budget                  | exit 1; SHA-256 restored |
| daily-budget-question  | `test/unit/transcribeBatch.test.ts`: names the exact hourly price                  | exit 1; SHA-256 restored |
| already-heard          | `test/unit/transcribeBatch.test.ts`: offers 1.3 soundtrack choices                 | exit 1; SHA-256 restored |
| native-format          | `test/unit/transcribeBatch.test.ts`: enables other vendors only                    | exit 1; SHA-256 restored |
| video-format           | `test/unit/transcribeBatch.test.ts`: refuses unknown video                         | exit 1; SHA-256 restored |
| routing-paid-gate      | `test/unit/transcribeBatch.test.ts`: keeps U18 unavailable                         | exit 1; SHA-256 restored |
| initial-paid-gate      | `test/unit/transcribeBatch.test.ts`: does not dispatch when disabled               | exit 1; SHA-256 restored |
| batch-adapter-presence | `test/unit/transcribeBatch.test.ts`: refuses an absent captured batch adapter      | exit 1; SHA-256 restored |
| blank-transcript       | `test/unit/transcribeBatch.test.ts`: refuses empty or oversized UTF-8 transcripts  | exit 1; SHA-256 restored |

### Byte restoration evidence

| File                                         | Before and restored SHA-256 (each recorded pair equal)             |
| -------------------------------------------- | ------------------------------------------------------------------ |
| `src/core/backends/modelapi/ModelApiHost.ts` | `54838df3672a3c7b802746a23dae23435fd5bddb403e703e950307bd4a08d986` |
| `src/core/paid/paidFeatures.ts`              | `ef6bd5b41c39f25ebc2a41c975d3ffb9821227bca8e9ebafb1ed16d3c1706c7b` |
| `src/core/voice/transcribeBatch.ts`          | `7919b8dc3c45ba4c469c9f54de82b6deb58ea6971d3efb799e02ddb0c989223f` |
| `src/core/voice/transcribeBatch.ts`          | `9c3ff3c25d1a4a6ea9d8fd757d66be2b7c04c84ec727d65804757f45c0a91d3a` |
| `src/webview/components/AttachmentSound.tsx` | `a3a1ba980e65ad238641cfa2445b1b10ec72c92f473680eddb98f793d82bb17e` |
