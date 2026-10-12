# exec-usage-clock: the terminal agent records no usage history

Defect (released): every `exec` turn stamps its usage record with a
fractional clock, the journal schema refuses the record, and the write is
swallowed with one warning. `usage` afterwards shows none of the terminal
agent's requests. First released version with the defect: 0.12.0 (2026-10-04;
the M80 headless merge of 2026-10-03 carries
`const now = () => performance.timeOrigin + performance.now()` in
`src/runtime/main.ts`, commit 77e8ccd03 of 2026-10-02).

## Red (2026-10-12, this lane, on 0.18.1 + record)

Smallest real `exec` path without a provider: none reaches the recorder. A
packed `exec --backend modelApi` against a provider entry pointing at the
closed port 127.0.0.1:11434 (real `ECONNREFUSED`, isolated `HOME`) fails in
model resolution with "Backend Unavailable; requests 0" before any request
is sent, so `recordedCall` is never set and nothing is recorded. What needs
a real provider answer is the lead's real-life run.

Red at the real module boundary instead: the real `createUsageRecording`,
the real `UsageJournalStore`, the real `NodeUsageFs`, a real temporary
folder, and the headless path's exact clock expression. No mocks, no fake
timers, no stand-in store.

`npx vitest run test/unit/execUsageClock.test.ts` on the unpatched tree:

- `records a headless turn stamped with the headless clock` FAILS:
  `expected [ Array(1) ] to deeply equal []` — the warnings array holds
  `"Usage history could not be recorded"` and `today()` returns 0 records.
- `records a turn stamped with whole milliseconds` passes (1 record).

## Green

(To be filled: the same command after the fix, plus the packed
`exec` + `usage` proof.)
