# CC-LINTSPLIT: `lint:js:main` in three processes

The lead's change, 2026-11-04. No limit raised: the job's 25 minutes and ESLint's heap stay.

## Why

`lint:js:main` was cancelled at the job's 25 minutes on hosted macOS (run 41824926474, 24.6 min in
the step, no output). The same gate took 9.5, 13.5 and 15.3 min there on the three runs before. The
same tree's Linux and Windows lint took their usual 5.8 and 7.0 min, so the code did not cause it.

One process over all of it peaks at 5.8 GB, and the hosted macOS runner has 7 GB. That fits a
runner in swap. It is not shown: a cancelled job's log has no memory reading, and a stalled process
looks the same. The next hosted runs are what can tell.

## The change

`lint:js:main` is now `run-s lint:js:core lint:js:surfaces lint:js:rest`, three processes one after
another in the same job. `lint:js:rest` lints everything the other two do not, so a new folder is
never left out. A folder added to `core` or `surfaces` must also be added to `rest`'s ignore list.

## Measured

Real Linux rig (`linuxlt`, 8 cores, 31 GB, no memory pressure), Node 24.21, on `826dc413e0` plus
this change. Not a hosted runner.

| Run                              | Wall  | Peak memory | Exit |
| -------------------------------- | ----- | ----------- | ---- |
| One process, as it was           | 257 s | 5.83 GB     | 0    |
| `lint:js:core`                   | 94 s  | 4.35 GB     | 0    |
| `lint:js:surfaces`               | 124 s | 4.36 GB     | 0    |
| `lint:js:rest`                   | 60 s  | 4.29 GB     | 0    |
| `lint:js:main`, all three, clean | 276 s | 4.49 GB     | 0    |
| `lint:js:unit` (unchanged)       | 138 s | 5.17 GB     | 0    |
| `lint:js:tests` (unchanged)      | 44 s  | 5.41 GB     | 0    |

**Coverage:** each run's `--format json` file list. One process 3,170 files; parts 1,158 + 1,172 +
840 = 3,170, all unique. None in one list and not the other.

## Drills

1. One `var drillBreak = 1` appended to each of `src/core/team/teamBoardFile.ts`,
   `src/host/teamHostBinding.ts`, `src/webview/App.tsx`, `src/acp/acpTeamEntry.ts`,
   `src/shared/constants.ts`, `src/runtime/dataFolder.ts`, `src/extension.ts` and
   `scripts/check-workflow-scripts.mjs`.
   - `lint:js:core` exit 1, naming `teamBoardFile.ts` only.
   - `lint:js:surfaces` exit 1, naming the acp, host, shared and webview files only.
   - `lint:js:rest` exit 1, naming the script, `extension.ts` and `dataFolder.ts` only.
2. The same line in `src/runtime/dataFolder.ts` alone: `lint:js:main` exit 1, so the whole script
   reaches its last part and fails on it.

Restored with `git checkout -- .`, no tracked file changed, then the clean run above, exit 0.

## Not proven

- That memory caused the stall, or that this cures it. The next hosted macOS runs decide. A cancel
  there again means this was not the cause, or not all of it.
- `lint:js:unit` and `lint:js:tests` still peak above 5 GB. They have been steady on macOS (11 to 13
  min for that job), so they are left as they are; split them the same way if one stalls.
