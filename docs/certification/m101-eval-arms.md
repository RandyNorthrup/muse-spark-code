# M101 evaluation arms and frozen long-context tasks (kubuntu, 2026-10-10)

Lane C-M101-2. The M75 harness gains its frozen arms and long-context tasks
before any counted model call. All service responses below come from the
existing canonical fake Model API; there were zero live or paid model
attempts. No wire shape, credential source, dependency, gate threshold or
ignore changes. Production stays inactive: `IS_AUTO_COMPACTION_EVALUATED`
remains `false` and the arm's evaluation admission is a test double, which
cannot certify the D78 integration (lane E binds the real guard and ledger).

## Frozen set

`EVAL_ARMS` (`src/core/eval/mechanisms.ts`): baseline, packing (M73),
auto-compaction (M74), strict-tools (M101 item 24), in run order.
Sixteen tasks (`src/core/eval/tasks.ts`): nine accept, seven held-out —
the twelve previous tasks unchanged, plus per split one long-context
compaction task (`isLongContext`) and one two-defect multi-edit task.

Frozen digest (`evalHarnessDigest`, SHA-256 over arm names and mechanisms
with every task id, split, title, prompt, file, verifier and long flag, in
run order):

`7f6241a64823916d1e9b6c2abf9ff5f7181688a0eaea3f33b679580e70645b26`

`test/unit/eval/evalFrozen.test.ts` pins the arm list, the task list and
the digest. Any arm or task change breaks it on purpose; re-freeze by
recording the new digest here and in that test, never by weakening it.
Lane E's counted run recomputes the digest and compares it to this value.

## Why the compaction tasks carry their log in the prompt

Measured on this rig: with the arm's 26,000-token window, `read_file` is
capped at half a window in characters (13,000), while near-window needs
nine tenths in tokens — a single file read can never trip compaction.
The task prompt therefore carries a generated 2,200-line log (~90 KB), so
the first request lands at ~102 KB, between 90% of the window and the
preflight limit, and the arm compacts at its first settled tool boundary.
Live long turns compact the same way through accumulated history; lane E
measures that difference with real calls.

## Evidence (fake pairs, all green at repository timeouts)

- `evalCompaction.test.ts` (9 tests): both long-context tasks compact at
  the first boundary — the second request carries the compaction prompt,
  every later one the hidden follow-up replaying the full byte-exact host
  todo list — and the judged fix lands byte-exact. The baseline sends no
  compaction. A refused `add_memory` write neither blocks the turn nor the
  compaction. Stop during a stream dispatches nothing; cancelling an
  in-flight summary dispatches no continuation (terminal `cancelled`).
  A classified 400 overflow recovers through compaction on a small task
  (all bodies stay below near-window, so only the overflow path could
  have compacted) and the turn still passes.
- `evalRunner.test.ts` (15 tests): the M75 strict-tools fake pair
  (now on the frozen `STRICT_TOOLS_ARM`, 9 accept / 7 held-out, 96 fake
  bodies, strict bytes on exactly the strict arm's requests) and the new
  M101 auto-compaction fake pair (16 tasks × 2 arms, 102 fake bodies,
  exactly the arm's two long-context runs compacted, both 0.75 floors
  held, verdict `pass`).
- `evalMultiEdit.test.ts` (3 tests): one `edits[]` call and two single
  edits both fix each multi-edit task (comparability) with identical
  bytes; the single call sends one fewer request. Multi-edit has no host
  seam — `edits[]` is always declared — so its pair is task-level by
  design; no vacuous arm was added. A host seam would be a production
  `tools.ts` change for another lane.
- `evalTasks.test.ts`: all sixteen verifiers fail the planted defect and
  pass two fix spellings. Packing, driver, report, wire, live-support and
  workspace-privacy suites pass unchanged (packing engagement still
  covers only the two `isLongOutput` tasks).

## Gate-fire drills (each restored byte-exact, SHA-256 verified)

| Drill | Deliberate break          | Assertion that fires                         | Restored                            |
| ----- | ------------------------- | -------------------------------------------- | ----------------------------------- |
| R1    | Verifier expects 781925   | frozen digest differs                        | tasks.ts `71d3df3d…90618`           |
| R2    | Arm latch `false`         | 5 compaction engagement tests fail           | mechanisms.ts `1365718e…d140ac`     |
| R3    | Window 20,000             | 5 tests fail (preflight refuses first send)  | constants.ts `44f85608…4bb3fe0acf8` |
| R4    | Strict capability `false` | strict-tools pair fails (no `"strict":true`) | mechanisms.ts `1365718e…d140ac`     |
| R5    | Arm renamed               | arm list and digest tests fail               | all four files `sha256sum -c` OK    |

## Gates

All five typecheck projects; ESLint `--max-warnings=0` and Prettier on
every changed file; `check:l10n` (0 problems; no new UI strings);
`check:reference` current; plain knip; production `npm run build`
(extension 550.1 KiB of 600 — `src/core/eval` is imported by no shipped
bundle, so the ~180 KB of task prompts never ship).

## Handoffs and lead decisions

- Lane E's estimate in `scripts/m101-e.mjs` now counts 16 tasks
  (160–320 calls); re-estimate live cost from the counted run.
- The live `eval.live.e2e.test.ts` still pairs baseline with packing
  only; adding the frozen auto-compaction and strict-tools arms to the
  counted run is lane E's change.
- The evaluation window (26,000 tokens) is the fake harness's value;
  the owner decision on the counted run's window size belongs to lane E.
- No `as` casts, `eslint-disable` entries, new dependencies, or PLAN §8
  rows were needed.
