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

Frozen digest (`evalHarnessDigest`, SHA-256 over each arm's name,
mechanism and change source with every task id, split, title, prompt,
file, verifier, long flag and resolved window, in run order, beside the
verifier prelude, the window rule's source, the held-deps list, the
frozen window and approval-mode defaults, and the arms' source closure:
every harness-owned file the arms reach, by bytes, plus every outside
binding they draw, by canonical value — `src/core/eval/armSources.ts`
walks the static import graph instead of a hand-kept list, and fails
closed on anything it cannot cover):

`80d6fd0028a04bdad33af83a042bfa2f365500dd348de584260d85909ea95959`

`test/unit/eval/evalFrozen.test.ts` pins the arm list, the task list and
the digest. Any arm or task change breaks it on purpose; re-freeze by
recording the new digest here and in that test, never by weakening it.
Lane E's counted run recomputes the digest and compares it to this value.
(2026-10-10 R3 re-freeze: review RVCM1012B findings 1–2; the previous
digest `dc3f6372…dd15f` hashed each change callback's source but not the
helpers it references or the values it draws, and the R2 record below
wrongly claimed no casts were needed. The R2 digest `dc3f6372…dd15f`
likewise covered names, descriptions and change sources only over the
original `7f6241a6…45b26`. Details in `docs/certification/m101.md`.)

## Why the compaction tasks carry their log in the prompt

Measured on this rig: with the evaluation window of 26,000 tokens (harness
condition, shared by both arms since the R2 repair — never part of an
arm's mechanism, because a window override would also move `read_file`
truncation), `read_file` is capped at half a window in characters
(13,000), while near-window needs nine tenths in tokens — a single file
read can never trip compaction.
The task prompt therefore carries a generated 2,200-line log (~90 KB), so
the first request lands at ~102 KB, between 90% of the window and the
preflight limit, and the arm compacts at its first settled tool boundary.
Live long turns compact the same way through accumulated history; lane E
measures that difference with real calls.

## Evidence (fake pairs, all green at repository timeouts)

- `evalCompaction.test.ts` (11 tests): both long-context tasks compact at
  the first boundary — the second request carries the compaction prompt,
  every later one the hidden follow-up replaying the full byte-exact host
  todo list — and the judged fix lands byte-exact. The baseline sends no
  compaction under the same window. Both arms of a long-output task see
  byte-identical evidence, record included. A real memory store proves the
  automatic flush both ways: allowed, the labelled snapshot lands and the
  host's `add_memory` call rides the turn; refused (`denyUnmatched`), the
  store stays empty while the turn compacts and completes. Stop during a
  stream dispatches nothing; cancelling an in-flight summary dispatches no
  continuation (terminal `cancelled`).
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

### R2 repairs (2026-10-10, kubuntu; review RVCM1012 findings 1–3)

Each drill broke the guard, watched the named test fail, and restored the
file byte-exact (SHA-256 verified against the pre-drill value). Full record
in `docs/certification/m101.md`.

| Drill | Deliberate break                           | Assertion that fires                                               | Restored                             |
| ----- | ------------------------------------------ | ------------------------------------------------------------------ | ------------------------------------ |
| D1    | Arm regains a 26,000-token window override | arm-config diff and frozen digest fail                             | mechanisms.ts `27988688…f808b8d`     |
| D2    | Arm latch `false`, text unchanged          | frozen digest fails; arm-list comparison stays green (as reviewed) | mechanisms.ts `27988688…f808b8d`     |
| D3    | `flushCompactionMemory` call removed       | both memory tests fail (snapshot; parsed flush call)               | ModelApiHost.ts `eee1b2eb…346fe762a` |
| D4    | Window 20,000                              | frozen digest fails (resolved per-task windows)                    | constants.ts `44f85608…4bb3fe0acf8`  |

### R3 repairs (2026-10-10, kubuntu; review RVCM1012B findings 1–2)

Each drill broke the guard, watched the named test fail, and restored the
file byte-exact (SHA-256 verified against the pre-drill value). Full record
in `docs/certification/m101.md`.

| Drill | Deliberate break                                                    | Assertion that fires                                              | Restored                          |
| ----- | ------------------------------------------------------------------- | ----------------------------------------------------------------- | --------------------------------- |
| R3-D1 | `noop` body throws (the review's probe, which the old pin survived) | frozen digest fails (`80d6fd00…`)                                 | mechanisms.ts `2525ecc5…869d4d`   |
| R3-D2 | New owned helper imported by the auto-compaction arm                | frozen digest moves; the new-helper test proves the walk found it | helper removed, import reverted   |
| R3-D3 | Function-valued outside binding hashed as `{}` (refusal neutered)   | `fails closed on a function-valued outside binding`               | armSources.ts `24a98227…541830`   |
| R3-D4 | A PLAN §8 row deleted                                               | `records the dependency-key assertion`                            | PLAN.md (SHA verified on restore) |

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
- Two `as` assertions in `test/unit/eval/evalFrozen.test.ts` (the
  dependency-key narrowing and the held-deps widening) carry inline
  reasons and one PLAN §8 row per site (2026-10-10 R3 repair of review
  RVCM1012B finding 2, which this line wrongly claimed were unneeded). No
  `eslint-disable` entries or new dependencies.
