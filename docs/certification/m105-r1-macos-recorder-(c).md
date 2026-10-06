# M105 R1 macOS recorder (c)

Mac mini, 2026-10-06; branch `m105/r1`, base `386729cf`.
Read the rig brief, common rules, AGENTS.md, PLAN D85 and M105 in full,
media research §2/§6, and lane 0's capture/certification records.
No network, live, paid or subscription calls; no credentials accessed;
no privacy settings changed; no dependency added. No merge, rebase or push.

## Portable driver delivered

`src/core/media/record/macos.ts` implements lane 0's recorder contract.
It validates explicit sound choices and duration, refuses remote/non-macOS
hosts and missing/relative helpers, strips credential variables and the
inherited disclaim marker, writes into a 0700 temporary directory, and
returns a 0600 mp4 preview only after a validated finished frame and clean
stdio exit. It bounds startup, recording and shutdown; handles Stop,
Cancel, duplicate/out-of-order/oversized frames and partial UTF-8; verifies
sniffed metadata and file size; and deletes partial/discarded output.
Cancellation during inspection also discards the file. Native stderr and
exit descriptions never enter the user result or a log.

Both permission refusals offer the caller a typed recovery callback;
`openMacosRecordingPermissions` opens exactly the Screen Recording or
Microphone pane through the editor's injected opener, only when the user
chooses the recovery action. Existing lane-0 translated media messages
are read at use time. No language table or manifest change is needed.

The driver never uploads or registers a tool. Interactive authorization,
model capability checks and the preview's Attach/Discard surface remain
with E1/E2/E3/W, exactly as the lane table assigns them.

## Integration handoffs (owned by other lanes)

- **M1 inspect:** bind `inspect(path)` to its bounded file sniffer. No fake
  production sniffer is provided.
- **E1/E2/E3 spawn:** adapt direct process spawning to `HelperChild`, passing
  the supplied argument array and sanitized environment unchanged. `onExit`
  must run after stdout EOF; `kill` must terminate the entire owned process
  tree even when it is stuck. Supply the installed absolute helper path,
  a local temporary root, platform and remote-window facts. The result's
  private path stays out of the webview; the host issues its preview token.
- **W tunables/lazy bundle:** bind the injected startup/finish timeouts and
  protocol cap to named `SCREEN_RECORDING_*` constants in
  `src/shared/constants.ts`. Tested values: 30,000 ms, 30,000 ms and 4,096
  characters. Add the driver to lazy `dist/screenRecord.js`; keep startup
  and deferred budgets unchanged. This lane does not edit lane 0/W files.
- **W generated host record:** `check:host-api` reports exactly the four
  Node import-count changes: node:buffer 39→40, node:fs/promises 47→48,
  node:path 84→85, node:string_decoder 1→2. Refresh the W-owned generated
  record during integration. VS Code API counts stay 332 in 31 files.
- **W docs/reference:** the base has no featureCatalog.ts or reference
  generator. List Attach screen recording, explicit sound choices,
  bounded duration, private preview/disposal and permission recovery in
  the integrated registry/reference and README. CHANGELOG should say:
  “Added a portable macOS screen-recorder driver with bounded lifecycle,
  private previews and permission recovery.” Do not advertise the command
  before the entry-point/preview lanes are bound. The editor port is
  shared by VS Code-family hosts, native MHP hosts and interactive ACP;
  remote hosts use the planned companion/file path; headless/tools refuse.

## Portable validation

- Owned Vitest file: **37/37 passed**, directly on macmini with
  `npx vitest run test/unit/macosScreenRecording.test.ts --maxWorkers=3`.
  Repository default timeout throughout; no --testTimeout or filtered tests.
- All five `npm run typecheck` projects passed; unit typecheck passed again
  after additional edge cases. Changed TypeScript ESLint and Prettier pass.
- `node scripts/check-l10n.mjs`: 14 tables, 164 manifest strings,
  593 source files, **0 problems**.
- Host API has the single generated-record deferral described above.
- Full quality/coverage is reserved for the integrating lead by the common
  rig rules. No gate, rule, ignore, threshold, timeout or hook was weakened.

## Portable red drills

Each row runs the entire owned file and exits 1 with the named failure.
Source is restored in finally and SHA-256 compared before the next run.
The first isolated video-kind mutation stayed green because the strict
schema and mime/sound checks also enforce that type; the grouped metadata
mutation below fails wrongKind, wrongMime and unexpected/unknownSound.
That non-failing exploratory mutation is not counted as a red drill.

| Guard broken                 | Named failing test                                                                                             | Outcome         |
| ---------------------------- | -------------------------------------------------------------------------------------------------------------- | --------------- |
| remote refusal               | refuses remote, non-macOS, missing and relative helpers before spawning                                        | 1; SHA restored |
| macOS platform               | refuses remote, non-macOS, missing and relative helpers before spawning                                        | 1; SHA restored |
| absolute helper              | refuses remote, non-macOS, missing and relative helpers before spawning                                        | 1; SHA restored |
| missing helper               | refuses remote, non-macOS, missing and relative helpers before spawning                                        | 1; SHA restored |
| recording options boundary   | validates explicit audio selections and duration before creating files                                         | 1; SHA restored |
| provider key environment     | passes only absolute command and argument arrays, drops credentials and the inherited disclaim marker          | 1; SHA restored |
| named credential environment | passes only absolute command and argument arrays, drops credentials and the inherited disclaim marker          | 1; SHA restored |
| disclaim marker environment  | passes only absolute command and argument arrays, drops credentials and the inherited disclaim marker          | 1; SHA restored |
| private folder mode          | passes only absolute command and argument arrays, drops credentials and the inherited disclaim marker          | 1; SHA restored |
| private file mode            | stops early and returns a private preview only after finished and a clean exit                                 | 1; SHA restored |
| no unfinished success        | refuses noFinished output and deletes the whole private folder                                                 | 1; SHA restored |
| clean exit                   | refuses crash output and deletes the whole private folder                                                      | 1; SHA restored |
| regular file                 | refuses directory output and deletes the whole private folder                                                  | 1; SHA restored |
| nonempty file                | refuses empty output and deletes the whole private folder                                                      | 1; SHA restored |
| file size cap                | refuses oversize output and deletes the whole private folder                                                   | 1; SHA restored |
| sniffer boundary             | refuses malformedMetadata from the sniffer                                                                     | 1; SHA restored |
| video metadata group         | refuses wrongKind output and deletes the whole private folder                                                  | 1; SHA restored |
| mp4 mime                     | refuses wrongMime output and deletes the whole private folder                                                  | 1; SHA restored |
| file size matches metadata   | refuses wrongSize output and deletes the whole private folder                                                  | 1; SHA restored |
| known duration               | refuses unknownDuration from the sniffer                                                                       | 1; SHA restored |
| maximum duration             | refuses longDuration from the sniffer                                                                          | 1; SHA restored |
| explicit soundtrack          | refuses unexpectedSound from the sniffer                                                                       | 1; SHA restored |
| cancel during inspection     | cancels while inspection is pending and deletes the completed recording                                        | 1; SHA restored |
| stop idempotent              | stops early and returns a private preview only after finished and a clean exit                                 | 1; SHA restored |
| startup deadline             | bounds startup and a helper that ignores Stop, even if the adapter never reports exit                          | 1; SHA restored |
| finish deadline              | bounds startup and a helper that ignores Stop, even if the adapter never reports exit                          | 1; SHA restored |
| helper line cap              | refuses malformed, unsolicited, byte-bearing or oversized helper frames (oversized frame)                      | 1; SHA restored |
| helper boundary              | refuses malformed, unsolicited, byte-bearing or oversized helper frames ({"type":"recording","bytes":"canary"} | 1; SHA restored |
| finished ordering            | refuses malformed, unsolicited, byte-bearing or oversized helper frames ({"type":"finished"}                   | 1; SHA restored |
| recording ordering           | decodes split lines and refuses duplicate recording notifications                                              | 1; SHA restored |
| partial EOF                  | refuses partialLine output and deletes the whole private folder                                                | 1; SHA restored |
| partial UTF8 EOF             | refuses partialUtf8 output and deletes the whole private folder                                                | 1; SHA restored |
| screen recovery mapping      | offers the correct recovery for screenPermissionDenied without storing native stderr or paths                  | 1; SHA restored |
| microphone recovery mapping  | offers the correct recovery for microphonePermissionDenied without storing native stderr or paths              | 1; SHA restored |
| maximum Stop                 | counts down from recording readiness and sends Stop exactly at the maximum                                     | 1; SHA restored |

Driver SHA-256 before/after the 35 successful drills:
`bf3a09ed67ffbc15f1d93d90ec0067b59ab434536af69cc96bc7e378806dadde`.
The later lint-only permission-mapping rewrite was re-drilled for both
panes; those two runs also exit 1 with their respective recovery test and
restore the final source SHA, recorded with the native completion below.

## Native completion

Native implementation and its synthetic tests are still being certified
in the next local commit. Real Screen Recording/Microphone consent checks
remain permission-gated; this record will list those checks precisely.
