# Screen recording: no limits of ours, and Windows' own recorders found (lane MEDIA0190, 2026-10-20)

Run on `thispc` (Windows 11 Pro 10.0.26200, Node 24.20.0, Windows PowerShell
5.1) in the `fix/0190-media` worktree, based on the final 0.19.0 tree
`11733df2be`. Found by the lead's Windows real use of the packed 0.19.0
product.

## What was wrong and what changed

| #   | Found in real use                                                                                                                                                                                                 | Change                                                                                                                                                                                                                                                                                                                                                                     |
| --- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | `museSpark.screenRecordingMaxSeconds` kept a set value within 10–600 (constants, the settings schema, the recorder options schema, the command's clamp, the manifest's `maximum`, the Windows and macOS helpers). | D121: any whole number of seconds ≥ 0 is used as set; 0 records until stopped. The floor and the ceiling are gone everywhere the value travels, including `MuseSparkScreenRecord.cs --record` (now a 64-bit length) and `ScreenRecord.swift --max-seconds`.                                                                                                                |
| 2   | Attach Latest Screen Recording ignored anything older than ten minutes (`SCREEN_RECORDING_RECENT_MAX_AGE_MS`; the helper's `--latest` age argument).                                                              | No age cutoff: the newest recording in the recorder folders wins at any age. A file dated in the future is still refused, and the video-extension filter stays (`.mp4`/`.mov`/`.webm` in the editor's discovery, `.mp4` in the helper).                                                                                                                                    |
| 3   | On Windows only Snipping Tool's `Videos\Screen Recordings` was searched.                                                                                                                                          | Xbox Game Bar's Captures folder is searched too, newest across both wins. It is resolved as its own known folder (`{EDC0FE71-98D8-4F4A-B920-C8DC133CB165}`, registered by `windows.storage.dll`, default `Videos\Captures`), so a moved Captures folder is followed as well as a redirected Videos folder. Game Bar screenshots (`.png`) stay out by the extension filter. |
| 4   | Nothing found said only "No recent screen recording was found."                                                                                                                                                   | `recordingNotFound` names the folders searched in the person's words ("No screen recording was found in Videos\Screen Recordings or Videos\Captures."), joined as alternatives in the display language; English and all 14 tables. The VS Code command now shows discovery's own reason (a failed copy no longer reads as "nothing found").                                |

## Tests on real code

The Windows helper is compiled by the product's own build path
(`screenRecordExecutable`, the inbox C# compiler) with the test entry point
beside it, as the existing native suite does.

- `windowsScreenRecorderNative`: a set length of 5, 3600 and 0 reaches the
  helper's `--record` parsing as set; -1 is refused; a two-hour-old recording
  is copied; the newest mp4 across Screen Recordings and Captures wins and a
  newer `.png` never does; a missing folder or a junction in place of one
  hides nothing in the others; the helper's own known-folder resolution names
  the same two folders as the editor's discovery.
- `recordingLatest`: Windows picks a two-hour-old recording, the newest across
  both folders, ignores a newer `.png`, follows a redirected Videos and a
  moved Captures folder, and names both folders when none holds a recording;
  the Videos and Captures resolution is compared with the registry.
- `windowsRecording`: 5 and 3600 reach the helper's launch arguments as set;
  `--latest` carries no age; the helper's `notFound` frame reads as the
  sentence naming both folders.
- `noDefaultLimits`, `mediaContracts`: settings and the recorder options take
  5 and 3600 as set.
- `linuxRecording`, `resolveLatestRecording`, `macosRecording` (and the macOS
  `ScreenRecordTests.swift`, run in hosted macOS CI) updated to the new rules.

## Break once

| Drill | Break                                                              | Red                                                                                                                                                        | Restored                                         |
| ----- | ------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------ |
| A     | `findLatestRecording` regains `now - file.modifiedAt <= 600_000`   | `npx vitest run test/unit/recordingLatest.test.ts test/unit/linuxRecording.test.ts`: exit 1, 5 failed / 52 passed (the two-hour-old and both-folder cases) | exit 0, 57 passed                                |
| B     | `MuseSparkScreenRecord.cs` regains `maxSeconds > 600` as a refusal | `npx vitest run test/unit/windowsScreenRecorderNative.test.ts -t "recording length"`: exit 1, `expected 'error:ArgumentException' to be '3600'`            | exit 0, 4 passed                                 |
| C     | `RecordingFolders()` in the helper returns only Screen Recordings  | `npx vitest run test/unit/windowsScreenRecorderNative.test.ts -t "Captures folders"`: exit 1, `expected [ Array(1) ] to deeply equal [ …(2) ]`             | restored; the full native suite passes, 40 tests |

## Notes for this machine

- Tests ran with `TEMP`/`TMP` at `C:\Users\Randy\mx-vtmp` (this PC's own
  `%TEMP%` carries foreign grants). Run from PowerShell 7, the existing
  "owner-only directory, locked down by icacls" case fails because PowerShell
  7's `PSModulePath` leaks into the Windows PowerShell 5.1 child; from Git
  Bash (and on hosted runners) it passes. Not a product fault.
- `npm run check:catches` exits 1 on the unmodified base tree too
  (`src/core/resources/admission.ts`, `launchHost.ts`,
  `src/host/support/reportJournal.ts`: core and host GENERIC rose). This lane
  changed no count upward: the latest-folders query's catch became NARROW on
  a typed `SystemCommandFailure` (host SWALLOW 20 → 19), and two unchanged
  handlers whose `try` text changed were re-accepted by identity. Only those
  three sites were edited in `scripts/catch-baseline.json`; the check's output
  is identical to the base tree's.
