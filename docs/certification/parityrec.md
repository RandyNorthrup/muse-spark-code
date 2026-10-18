# Lane PARITYREC — Attach Latest Screen Recording on Windows and macOS

## First result: what the person sees now, what they will see

- Linux (`~/Videos/Screencasts`, `~/Videos`): now attaches the newest recent
  recording; will keep doing exactly that (unchanged).
- Windows (`%USERPROFILE%\Videos\Screen Recordings`, Snipping Tool `.mp4`):
  now always says "No recent screen recording was found."; will attach the
  newest recording from the last 10 minutes instead.
- macOS (Screenshot app default `~/Desktop`, `.mov`): now always says "No
  recent screen recording was found."; will attach the newest recording from
  the last 10 minutes instead.

## Research (2026-10-18)

- Windows location is authoritative in-repo: the native helper resolves
  `FOLDERID_Videos` (`18989b1d-99b5-455b-841c-ab7c74e4ddfc`) and appends
  `Screen Recordings`, newest `.mp4` by write time
  (`native/windows/MuseSparkScreenRecord.cs`, `Latest`/`CopyLatest`).
- macOS location from current documentation: the Screenshot app
  (Cmd+Shift+5) saves screen recordings to the Desktop by default as
  `Screen Recording <date> at <time>.mov` (changeable in Options > Save to);
  QuickTime Player asks for a location on every stop, so Desktop is the one
  system location the OS uses unattended.
- Design: one filesystem discovery path for all three platforms (same
  nonrecursive scan, recency bound, symlink/special-file rejection, private
  owner-only preview copy, byte sniff — never the filename). The Windows
  native helper's `--latest` cannot run on this Linux rig and macOS has no
  helper latest path at all, so wiring the helpers would leave two platforms
  unprovable here; the shared discovery enforces the same guards as the
  shipped Linux path.

## Changes

- `src/core/media/record/linux.ts`: the latest-file filter accepts
  Windows drive-letter roots too (was POSIX-absolute only, which rejected
  every `C:\…` root and made Windows find nothing).
- `src/host/media/recordingLatest.ts`: new Windows and macOS latest-port
  factories plus a per-platform dispatcher; Linux factory unchanged.
- `src/extension.ts`: `latestScreenRecording` no longer returns early off
  Linux; it uses the dispatcher port for the running platform.
- `test/unit/recordingLatest.test.ts`: Windows and macOS proofs against real
  recording files in temp home layouts; the old win32 early-return is gone.

## Gates (final tree, linuxlt 2026-10-18)

- `test/unit/recordingLatest.test.ts`: 21/21 pass at the repo default
  timeout (13 of them failed before the fix — red observed, then green).
- `test/unit/lazyBundleFiles.test.ts`: 13/13 pass.
- `npx tsc` (all projects via `npm run typecheck`): exit 0.
- eslint on all changed files: zero warnings.
- prettier check on all changed files: clean.
- `node scripts/check-l10n.mjs`: 0 problems (no new strings).
- `node scripts/gen-reference.mjs --check`: current.
- `node scripts/check-host-api.mjs`: 0 problems.
- `node scripts/check-plan.mjs`: 0 drift.
- `npm run build`: exit 0 (includes bundle-size, bundle-split and
  lazy-registry checks; the registry gained the one `createLatestPort` row
  from the refactor, regenerated with `npm run lazy-registry:generate`).
- `npm run deadcode` (knip): exit 0. `npm run cycles`: no cycles.
  `npm run duplication` (jscpd): 0 clones.
- `npm run security:sast`: exit 0, 0 findings on 3265 files.
- `npm run security:audit`: exit 0 (2 advisories, 1 documented exception;
  no dependency changed here).
