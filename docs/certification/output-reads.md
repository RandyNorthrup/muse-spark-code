# READS — defer edit-row output reads (D26, M15/M16)

Recorded 2026-10-03 in `mx-reads`, branch `fix/defer-output-reads`, from
`175d945d9ca840a12a94abf0b27f2107541b571a` (also the local `origin/main`).
The lane's READS.md supplies the Muse Code 1.4.2 investigation: automatic
reads queued past 60 s during long turns and delayed approvals. This lane
adds no wire shape and makes no live or paid model call.

`Transcript.isRunning` reaches `ToolRow.usePatchPages`. Finished edit rows
keep their visible diff or written content while automatic reads wait.
Reopening a row permits paging during that turn. Turn end clears the
missing page's request marker once; a failed read therefore retries once.
A loaded patch is retained; collapsed rows wait for reopening. A later turn
resets the permission to read on demand. The host gives `item/readOutput`
the existing 180 s long-command deadline, retaining its limiter slot past
60 s and accepting replies in that interval. The deadline remains bounded.
The notice behavior and four-read limit are unchanged.

## Test evidence — Kubuntu, slot `reads`

- Before production changes, snapshot `7a673c36`: the two owned files ran
  134 tests, 6 failed and 128 passed. Failures showed automatic reads during
  a turn and the old 60 s deadline. The deadline assertion's promise was
  also handled too late in that baseline; the test now attaches its handler
  immediately with `Promise.all`.
- Green snapshot `c7a818aa`: `Transcript.test.tsx` 46/46 and
  `MuseCodeHost.test.ts` 89/89, total 135/135. Eight new tests cover the
  requested behaviors, manual paging/new-turn reset, collapsed rows, late
  reply consumption and the bounded 180 s deadline.
- Raw drill logs and SHA-256 receipts are under ignored `temp/reads/`.
  After lint fixes and shared-fixture cleanup, every drill was repeated;
  the final-source receipts below are in `temp/reads/final-drills/`.

## Deliberate failures and byte-exact restoration

Each mutation ran the entire owning test file on Kubuntu, exited 1 with
the intended assertion failures, then restored the original bytes and ran
that file again with exit 0. No test filtering or gate weakening.

| Guard broken                                | Failed tests | Restored pass | Red snapshot | Restored snapshot |
| ------------------------------------------- | -----------: | ------------: | ------------ | ----------------- |
| Remove running-turn read guard              |            5 |         46/46 | `836d01dc`   | `9a7e3a7a`        |
| Remove turn-end request-marker reset        |            1 |         46/46 | `8faa44f6`   | `23ded07c`        |
| Refuse user-opened reads during a turn      |            4 |         46/46 | `6d1a7fa7`   | `06db5b3d`        |
| Keep manual-open permission in a new turn   |            1 |         46/46 | `3c5de206`   | `f1053387`        |
| Remove `item/readOutput` from long commands |            2 |         89/89 | `ba0ee72f`   | `0b1b48b1`        |

Before/after SHA-256 matched for every restoration:

- `ToolRow.tsx`: `162CF8977344CB322D3127CC9CAFC489F17446E51808C129E455169AC7D24496`.
- `constants.ts`: `422F5DB59F77C792013E02D1A5A198ABAF980EBC796A9724AA0AD00FD0D33544`.

## Scope of proof

Windows, Node 24.20.0: all five type projects passed; webview and unit
types passed again after the final cleanup. Changed-file ESLint passed
with zero warnings, host API reported zero problems, localization checked
14 tables with zero problems, knip passed, and duplication found zero
clones. The initial lint and duplication findings were fixed without
changing assertions or gates.

The initial production build passed every size budget but failed the split
gate because dependency metafiles named the seeded dependency junction's
external paths. The junction was moved into ignored `temp/reads/`, leaving
its target untouched, for a local pinned `npm ci --ignore-scripts` install.
The complete build passed with local dependencies: extension 573.1 KiB, Model API 370.5 KiB, checkpoint store 137.5 KiB, webview 804.9 KiB; every cap, split, host-global and notice check passed. npm ci reported 11 dependency vulnerabilities (2 low, 9 high); no dependency or audit fix is part of READS. Lead audit triage remains open.

These are targeted lane results. Full quality and the complete machine
matrix belong to the lead under common.md; they are not run in this lane.
No installed VS Code or live long-turn verification is claimed. README,
CHANGELOG and D26 now describe the shipped behavior and longer deadline.
