# M105 E1 — VS Code entry points and recording preview

Worktree `/home/randy/lanes/M105E1`, branch `m105/e1`, linuxlt, 2026-10-06.
Base `c1d6cf6ed`. The rig brief, shared common rules, orchestration register,
AGENTS.md, D85 and M105, the coverage audit, capture evidence and M1/M2
certification records were read. Zero live, paid, subscription or provider
calls; no credentials read, install, merge, rebase or push.

## Implementation and ownership

- `mediaAttach.ts` supplies one-use host tokens and bounded M1 sniffing.
  The source opener must recheck confinement/approval/identity. The selected
  model's M2 gate and size/format limits run before the required private turn
  binder. No bytes, path, upload id or key enters a chip. Handles close on
  success/refusal/failed reads; conversation invalidation refuses late work.
- The controller passes a media/text filter to the native picker, admits
  video/audio through the lazy port, handles `attachMedia`, and routes
  confined media URI drops/pastes through the same path. Other workspace
  files retain mentions. Failed URI reads produce a banner; a cleared
  conversation suppresses late failures. Missing media bindings use a read
  failure rather than inventing a model-capability claim. MOV/WebM/audio and unavailable backends have named
  refusal banners. Existing image/PDF/text handlers remain in place.
- Composer forwards URI-backed files without browser reads or duplicate
  attachments. An unrelated anonymous pasted screenshot retains its existing
  image path. A browser-only video/audio File with no host URI is refused
  before any header/base64 read: VS Code's sandbox exposes no approved host
  path for that object. Native picker or URI transfer supplies that path.
- Chips display duration, byte size, soundtrack and explicit unknown values.
  Cost/Contributor warnings and sound actions remain C/A regions.
- Native recording commands use an injected `RecordingCommandDeps` port,
  load only `dist/screenRecord.js`, keep sound off until selected, offer
  countdown/Stop, and preview before Attach. Remote windows explain their
  companion/file alternatives. Latest-recording discovery belongs to R2/R3.
- Preview is a nonce-secured, responsive editor tab, restricted to the
  recorder's private directory. Native video controls, keyboard buttons,
  focus styling and a screen-content warning are present. Strict zod action
  parsing rejects extra fields/chat messages. Attach serializes ownership;
  Discard/tab close disposes once. Closing during Attach waits for its result:
  accepted ownership transfers to the upload lifecycle, failed ownership is
  disposed. A failed open attachment can be retried.
- Only E1-owned source regions/new host media modules and owning tests were
  edited. PLAN is updated as required. W-owned manifests, translations,
  reference/docs, build configuration and generated host records are untouched.
  All user text reuses lane 0's translated runtime keys.

## Named integration handoffs

| Name                          | Owner               | Required binding                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| ----------------------------- | ------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| E1-media-host-binding         | W, M1/M2/F, M95     | Bind `ConversationDeps.mediaAttachments` to `createMediaAttachments`: confined/approved bounded source opener, selected capability projection, configured limits and M2 private turn/source/digest binding. It must preserve C/A authorization before upload/dispatch and F source/upload lifecycle. Missing binding refuses; no fake production media part is supplied.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| E1-picker-filter-binding      | W                   | Forward `FileAccess.showOpenDialog(filters)` into VS Code's `showOpenDialog({ filters })`. Existing adapter lies outside E1's loader-only extension region and currently ignores that optional argument.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| E1-recording-host-binding     | W, R1/R2/R3, F, C/A | Bind `ConversationDeps.recordingCommandDeps`, including actual `ScreenRecordingDriver`, latest-file discovery, max setting, caller locale/log, and an Attach callback receiving literal `isScreenRecording: true` and persisting that classification, which transfers source cleanup only after composer admission and deletes after upload/remove/discard. Bind a real admission receipt: the base controller handler returns void and base AttachmentStore does not persist a recording flag; W/F must connect the accepted receipt and durable flag to their integrated store/source binding. Cancel recording when its window closes. Recording dependency factories are generation/disposal guarded through the portable loader contract; the controller never imports the VS Code adapter, even by type. Driver interfaces are consumed; absent bindings refuse explicitly. |
| E1-lazy-build-binding         | W                   | Build `mediaAttach.ts` with the portable media entry; export `runScreenRecordingCommand` from the native/preview screenRecord entry. Guard lazy source ownership, shared installed language and both measured budgets. Preview HTML/script/styles live only in that lazy chunk. Add dead-code/cycle entries as needed, without ignores or cap changes.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| E1-manifest-reference-docs    | W                   | Contribute `museSpark.attachScreenRecording` and `museSpark.attachLatestScreenRecording`, their lane-0 labels and settings. Update Attach menu/feature registry and help reference. `featureCatalog.ts` is absent on this base. README must describe native picker, URI drop/paste, sandbox bytes-only refusal, model-dependent media and recording preview; CHANGELOG must name these implemented ports and remaining bindings.                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| E1-cross-editor-certification | W, E2/E3, M104b–d   | Portable M1/M2 contracts and recorder interfaces are shared; native IDE/runtime/companion entry points belong to their lanes. Run integrated picker/drop, native helpers, four-theme/320px accessibility and complete editor matrix before release.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |

These are dependency/ownership handoffs explicitly permitted by the brief,
not claims that an unbound feature already ships. Upload billing U6c and
remaining captures stay with the lead. Existing bundle/gate failures stay
visible. README/CHANGELOG/feature-reference text above is the concrete W
handoff, not an edit to another lane's files.

## Final verification — linuxlt, 2026-10-06

No timeout overrides, name filters, skipped tests or changed thresholds.
Each Vitest command ran whole owning files with at most three workers.

| Command                                                                                                                      | Result                                                                                                                               |
| ---------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------ |
| `npx vitest run test/unit/Composer.test.tsx test/unit/recordingPreview.test.ts test/unit/mediaAttach.test.ts --maxWorkers=3` | 104/104 passed (88 + 11 + 5), repository default timeout                                                                             |
| `npx vitest run test/unit/conversationController.test.ts --maxWorkers=3`                                                     | 586/586 passed, repository default timeout                                                                                           |
| `npm run typecheck`                                                                                                          | All five projects passed; final UI/unit projects repeated after lint syntax fixes and passed                                         |
| `npx eslint --max-warnings=0` on all eleven changed source/test files                                                        | Passed                                                                                                                               |
| `npm run deadcode`                                                                                                           | Passed, two inherited configuration hints                                                                                            |
| `npx jscpd`                                                                                                                  | Zero clones                                                                                                                          |
| `npm run cycles`                                                                                                             | No cycles, 566 modules                                                                                                               |
| `npm run check:l10n`                                                                                                         | 14 tables, 164 manifest strings, 606 source files; zero problems                                                                     |
| Chrome/axe on actual preview HTML and AttachmentChips                                                                        | All 16 four-theme/320px-and-960px pages passed; zero violations, runtime errors or viewport overflow                                 |
| `npm run build`                                                                                                              | Production compilation passed; enforced size gate exits 1 for startup 900.1/900 KiB and inherited deferred JS 51.1/50 KiB            |
| `node scripts/check-bundle-split.mjs`                                                                                        | Exit 1: inherited `files.ts` and type-only `codecs/responses.ts` require W's backend classifications                                 |
| `node scripts/check-host-globals.mjs`                                                                                        | Passed; zero Node-bundle navigator references                                                                                        |
| `node scripts/third-party-notices.mjs`                                                                                       | Passed, 83 bundled packages                                                                                                          |
| `npm run check:host-api`                                                                                                     | Exit 1: W's generated inventory refresh only; portable import graph passes after moving recording types into `screenRecordBundle.ts` |

**690 final positive tests; 59 unique red guard drills.** Initial Composer
regressions exposed ordinary text misread as a URI and an unrelated screenshot
swallowed by URI priority; URI validation and name-based deduplication fixed
both. The final review also covers failed confinement reads, stale failure
suppression, truthful unbound-host refusal, in-flight loader sharing, and
recording factory disposal/generation boundaries. Known sound/no-sound and
unknown metadata each render their distinct labels.

No full quality or integration/native/cross-editor/live certification is
claimed. The rig brief forbids full quality/full-unit runs and reserves
integrated certification for the lead. Missing bindings refuse explicitly.

### Accessibility receipts

The actual preview function was bundled and run against a minimal VS Code
panel adapter; the actual React AttachmentChips were rendered inside their
real composer frame with the existing stylesheet. Chrome served synthetic
local video only; no remote/provider request was sent. All four captured
VS Code themes were checked at 320 and 960 pixels with every WCAG 2.0/2.1/2.2
A/AA axe tag enabled, without exclusions. Keyboard Enter on Attach sends one
strict action and disables both buttons. The root viewport never overflows.
An initial isolated chip capture omitted the real composer frame and showed
320px overflow; the corrected capture uses the actual margin/padding/frame.
No production CSS workaround or gate exemption was added.

Axe marks `video-caption` incomplete on the native video control. The generated
fixture is silent (`ffprobe -select_streams a` reports no streams), so no speech
caption is omitted; native media controls and buttons are labelled. This is a
manual disposition for this silent fixture, not a claim of caption support for
arbitrary recordings. Real native editor/helper checks remain with W/R1–R3.

The [machine receipt](m105-e1-vs-code/a11y.json) retains all 16 results. The
320px screenshots are [light preview](m105-e1-vs-code/preview-light-320.png),
[dark preview](m105-e1-vs-code/preview-dark-320.png),
[high-contrast dark preview](m105-e1-vs-code/preview-hc-dark-320.png),
[high-contrast light preview](m105-e1-vs-code/preview-hc-light-320.png),
[light chips](m105-e1-vs-code/chips-light-320.png),
[dark chips](m105-e1-vs-code/chips-dark-320.png),
[high-contrast dark chips](m105-e1-vs-code/chips-hc-dark-320.png), and
[high-contrast light chips](m105-e1-vs-code/chips-hc-light-320.png).

### Bundle measurements and remaining failures

Production sizes: extension **444.5/600 KiB**, conversation **204.6/250 KiB**,
Model API **453.9/475 KiB**, checkpoint store **77.0/225 KiB**, ACP
**823.8/850 KiB**. Browser startup is **921659/921600 bytes**: **59 bytes over**,
and above M105's 0.5-KiB startup-growth target. The inherited deferred browser
JS remains **51.1/50 KiB**. E1's first local URI/detection reduction left
39 bytes over; the second metadata reduction left 53 bytes over. After two
failed reductions, the common-rule stop applied. Required lint syntax fixes
produce the final 59-byte excess. W must move/integrate media browser work into
lazy entries and remove the inherited excess within the caps. No cap, rule,
ignore or hook was changed.

Independent minified Node builds using the repository's shared English,
validation and wire plugins measure **13217 bytes / 12.9 KiB** for preview and
recording commands, and **20048 bytes / 19.6 KiB** for the host media adapter.
Both fit the plan's new 25-KiB caps independently. These exclude the future
native drivers, source bindings and W entry wrappers; they are measurements,
not registered/shipped bundle claims. Neither mediaAttach nor previewPanel
occurs in extension/conversation startup metafile inputs. W still owns lazy
entry registration, language-state binding, split guards and measured budgets.

Host API inventory reports 332 VS Code APIs, 32 adapter files, 25 Node built-ins
and 61 theme variables. The only remaining host gate problem is its generated
record. W must refresh it for inherited F/M1/M2 counts and this preview adapter.
The illegal portable-to-VS-Code type chain was fixed in E1 source, without
changing the gate. Split failures remain the two inherited backend files.

### Red drills — final restored source

Each mutation ran the entire owning test file at the default timeout, exited
1, and printed the named test on an actual `FAIL` line. SHA-256 before/after
restoration matched byte-exact, and all final receipts match the current
source. [Machine receipts](m105-e1-vs-code/guard-drills.json) retain the final
source hash and local log name for every guard. Multiple pre-final runs were
re-certified after source fixes; this table counts unique final guards.

| #   | Guard deliberately broken                | Named failing test                                         |
| --- | ---------------------------------------- | ---------------------------------------------------------- |
| 1   | token boundary validation                | rejects malformed/colliding tokens                         |
| 2   | duplicate token refusal                  | rejects malformed/colliding tokens                         |
| 3   | unknown token refusal                    | refuses guessed, reused and cleared tokens                 |
| 4   | one-use token consumption                | sniffs bounded host reads                                  |
| 5   | backend refusal before source open       | refuses guessed, reused and cleared tokens                 |
| 6   | clear invalidates pending tokens         | refuses guessed, reused and cleared tokens                 |
| 7   | clear invalidates held source work       | closes failed reads and refuses invalidated work           |
| 8   | source handle cleanup                    | sniffs bounded host reads                                  |
| 9   | unavailable source refusal               | rejects malformed/colliding tokens                         |
| 10  | byte-sniff refusal                       | checks actual bytes, size                                  |
| 11  | size/format admission                    | checks actual bytes, size                                  |
| 12  | capability model identity                | rejects malformed/colliding tokens                         |
| 13  | selected modality admission              | checks actual bytes, size                                  |
| 14  | store source identity                    | sniffs bounded host reads                                  |
| 15  | turn binding source identity             | sniffs bounded host reads                                  |
| 16  | preview strict message validation        | rejects malformed, extra-field and chat actions            |
| 17  | preview Attach serialization             | serializes Attach                                          |
| 18  | preview remembers tab close              | keeps refused attachments previewable                      |
| 19  | preview retained ownership cleanup       | serializes Attach                                          |
| 20  | preview discard idempotence              | discards on Discard or tab close                           |
| 21  | recording classification handoff         | serializes Attach                                          |
| 22  | remote recording refusal                 | refuses remote, absent and unavailable native drivers      |
| 23  | native driver required                   | refuses remote, absent and unavailable native drivers      |
| 24  | native availability gate                 | refuses remote, absent and unavailable native drivers      |
| 25  | recording option cancellation            | honors selected sound, cancellation, invalid bounds        |
| 26  | recording duration bound                 | honors selected sound, cancellation, invalid bounds        |
| 27  | audio defaults off                       | keeps audio off by default                                 |
| 28  | system audio defaults off                | keeps audio off by default                                 |
| 29  | Stop registration cleanup                | Stop settles the owned run                                 |
| 30  | countdown disposal                       | keeps audio off by default                                 |
| 31  | recording bundle export validation       | loads nothing before use                                   |
| 32  | browser media byte-read refusal          | names a bytes-only clip.mp4 refusal                        |
| 33  | URI-backed duplicate exclusion           | forwards paste URI tokens                                  |
| 34  | ordinary clipboard text preservation     | leaves an ordinary text-file paste                         |
| 35  | controller stale success refusal         | rejects a stale epoch before loading                       |
| 36  | controller clears source tokens          | rejects outside/protected media URIs                       |
| 37  | controller backend gate before loading   | names mov, WebM, audio and Muse Code refusals              |
| 38  | controller media epoch refusal           | rejects a stale epoch before loading                       |
| 39  | controller protected URI refusal         | rejects outside/protected media URIs                       |
| 40  | controller single in-flight load         | shares one in-flight media loader                          |
| 41  | preview locale installation              | escapes localized markup                                   |
| 42  | preview HTML escaping                    | escapes localized markup                                   |
| 43  | media chip metadata kind                 | shows video/audio metadata and unknowns                    |
| 44  | media chip unknown duration              | shows video/audio metadata and unknowns                    |
| 45  | media chip unknown soundtrack            | shows video/audio metadata and unknowns                    |
| 46  | streamed media base64 budget exclusion   | keeps streamed host media out of the browser base64 budget |
| 47  | unbound media refusal reason             | refuses an unbound media host                              |
| 48  | URI read failure banner                  | banners failed URI confinement reads                       |
| 49  | URI read failure generation              | banners failed URI confinement reads                       |
| 50  | preview restrictive CSP                  | opens a responsive nonce-secured preview                   |
| 51  | preview local resource confinement       | opens a responsive nonce-secured preview                   |
| 52  | preview automatic attachment prohibition | opens a responsive nonce-secured preview                   |
| 53  | preview responsive viewport              | opens a responsive nonce-secured preview                   |
| 54  | preview native video controls            | opens a responsive nonce-secured preview                   |
| 55  | media kind host routing                  | adds a picked movie using host metadata                    |
| 56  | preview command URI prohibition          | opens a responsive nonce-secured preview                   |
| 57  | recording command disposed gate          | keeps recording command dependencies                       |
| 58  | recording command generation gate        | keeps recording command dependencies                       |
| 59  | media chip known soundtrack label        | shows video/audio metadata and unknowns                    |

Restored SHA-256 (identical before/after every final mutation):

- `src/host/conversation/conversationController.ts`: `b2e34cb97ae03c69dd0404fb5d83a7226dcb0aee8f59b3287d853d3ae71670a6`
- `src/host/media/mediaAttach.ts`: `ab4818d47e2cddb8d73c933e04b537e058bbe9ed1548631265920d5d07991bea`
- `src/host/media/previewPanel.ts`: `9907173325d6c32445853ec06cc5e42548b18ecb0431c9b79a5762c3a123c9c3`
- `src/host/media/screenRecordBundle.ts`: `bc36b2809d0b823b3f38ce9d3a64d818158335d4e1afe610c2db21392484abca`
- `src/webview/components/AttachmentChips.tsx`: `5ccb564530406a2dd36b09a3859ac3209b3a02b69d6a623d70c50774f0f48f86`
- `src/webview/components/Composer.tsx`: `beed901a074197862d5b9ea0683b7ed21ac2c0409f0ea61e25a6f40fbafce7c7`

No dependency/tool installation, live/paid/provider call, credential read,
merge, rebase, push or owner decision default occurred. Existing interactive
paid consent/defaults remain C/A/F integration responsibilities. The only
new trusted signature guard is recorded in PLAN §8; no cast, any or lint
suppression was introduced. Finish W's named bindings and remaining enforced
gates, then run native helpers, picker/drop and the full editor/quality matrix
before enabling or advertising the feature.
