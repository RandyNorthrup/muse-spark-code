# Certification: request-shape and savings invariants (lane INVARIANTS)

Branch `fix/invariant-tests` from `06847350f` (PR 172's head). PR 172 deleted
every guard for the owner-protected SoL-Pi invariants because they used banned
fakes. This lane re-guards them with real modules and real inputs only:
`test/unit/invariants.test.ts` (14 tests, no `vi.mock`, no spies with
replacements, no fake timers, no hand-written stand-ins, no loopback
provider, no new e2e).

## Per-invariant record

| #   | Invariant                                                                                                       | Enforcing code                                                                                                                                                                                                                                           | Test (file: case)                                                                                                                                                                                                                    | Red drill (exit)                                                                                                                                                                                                                 |
| --- | --------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | Earlier request bytes never change; extras at tail; tool list byte-stable; narrowing at admission               | `src/core/backends/modelapi/tools.ts:699` (`toolDefinitions`); `src/core/backends/modelapi/instructions.ts:273` (`instructionsFor`); replay + tail push `src/core/backends/modelapi/ModelApiHost.ts:4466-4479`                                           | `test/unit/invariants.test.ts`: fixed tool order; optional tools leave the base list untouched; stable definition key order; `then_run` only with shell; byte-identical instructions; trailing sections keep earlier bytes as prefix | Swapped `strict` before `parameters` in `define()` → key-order case fails (exit 1). Swapped `search`/`list_files` blocks → fixed-order case fails (exit 1). Both reverted; `git status` clean                                    |
| 2   | ObservationPack: packs after rewrite; archive holds what the model saw; sticky swap; `recall_output` returns it | `src/core/backends/modelapi/observationPack.ts:230` (`project`), `:294` (`noteSent`), `:341` (`packedCallIds`), `:361` (`recall`); host packs the post-rewrite output (`ModelApiHost.ts:4487`, `thenRun` keeps results whole for packing `:12311-12318`) | `invariants.test.ts`: whole for `OBS_PACK_WHOLE_SENDS` sends, then placeholder, sticky, ledger grows; recall pages the archived original, unknown id errors                                                                          | `noteSent` never sets `isPacked` → pack case fails (exit 1). Reverted. Note: changing `OBS_PACK_WHOLE_SENDS` alone does NOT fail — the test follows the product constant; a deliberate constant change ships with its own reason |
| 3   | Paid calls share one gate (D48 consent + budget + reducer), tallied separately                                  | `src/core/paid/paidAuthority.ts:119` (`step` — the single reducer; key `paidAuthorityKey`: `:101`); admission re-checks consent + budget `src/core/backends/modelapi/autoCompactionAdmission.ts:143-170`                                                 | `invariants.test.ts`: two keys, one shared `step` state and day ledger; grant for A never answers B; denied B cannot reserve; each claim settles its own growing tally                                                               | `deny` approves instead of deleting → per-key case fails (exit 1). Reverted. A first drill (dropping only the approved-check) did not fail: denied quotes are deleted, so reserve still throws — recorded as a weak-drill lesson |
| 4   | `then_run` goes through every shell guard, imported ones included                                               | `thenRunOf` parses `src/core/backends/modelapi/verifyTools.ts:53`; host runs it as the shell via `runVerifyCommand` with the as-edited guard `ModelApiHost.ts:12241-12280`; offered only with the shell `tools.ts:704-705`                               | `invariants.test.ts`: absent/run/invalid parsing; a present non-string is reported, never dropped; empty is absent. Shell gating covered by the inv-1 `then_run` case                                                                | Non-string → `absent` → parse case fails (exit 1). Reverted. The full guard chain incl. imported hooks is host-level: listed for the lead                                                                                        |
| 5   | Overflow compaction skips the economics gate; failure refusal stays scoped; hidden turns fire no hooks          | `AutoCompact.decide(input, isOverflow)` `src/core/backends/modelapi/autoCompact.ts:146`; hard-limit call `maybeAutoCompact(turn, true)` on `ContextOverflowError` `ModelApiHost.ts:13577-13584`; economics bypass inside the active turn `:14754`        | `invariants.test.ts`: same input refused without overflow, `overflow` decision with it; `failed()` blocks until `noteToolWork()` reopens                                                                                             | Dropped `!isOverflow` from the gate → overflow case fails (exit 1). Reverted. Hidden-turn hook silence has no pure predicate: listed for the lead                                                                                |
| 6   | The M75 eval stays comparable                                                                                   | Arm `src/core/eval/mechanisms.ts:15` (packing change is one dep override); task set `src/core/eval/tasks.ts:356`; admission requires evaluated `autoCompactionAdmission.ts:143`                                                                          | `invariants.test.ts`: arm name and live threshold numbers in its description; fixed disjoint per-split task sets                                                                                                                     | Renamed arm → description case fails (exit 1). Reverted                                                                                                                                                                          |
| 7   | Golden request bytes with new features off                                                                      | Fixtures `test/fixtures/golden-requests/*.json` (+ `strict/`); one surviving reader `test/unit/modelApiLoopContracts.test.ts:62-76`                                                                                                                      | Unit-level: inv-1 tool-name order, definition key order and byte determinism (same options → same bytes). Full loopback golden: listed for the lead                                                                                  | Tool-order swap (inv-1 drill) fails the fixed-order case (exit 1): any declared-list change moves request bytes                                                                                                                  |

## Surviving real coverage already in the tree

- `test/unit/modelApiLoopContracts.test.ts` — output caps, bounds, pacing; reads one golden fixture.
- `test/unit/autoCompact.test.ts` — real `AutoCompact` economics over priced tiers.
- `test/unit/paidMoneyPorts.test.ts` — money-port shape checks over real sources.

## Listed for the lead (not faked)

1. Full golden loopback: drive the packed agent against a loopback server
   replaying a RECORDED real exchange per `golden-requests` scenario and
   byte-compare. No scenario→recorded-reply mapping was established on this
   lane (candidate reply pools: `test/fixtures/responses-codec/`,
   `modelapi-chat/`, `m106/`, `m95-int/`); the lead captures the real
   exchanges.
2. `then_run` full guard chain with imported (foreign) hooks firing, and
   hidden-turn (todo restate, memory flush) hook silence: host-level, needs a
   real session — prove in the real-life run, not with fakes.
3. Pack-after-rewrite ordering at host level (cited structurally above).
4. D48 paid-consent popup + budget wiring host-level (reducer covered here).

## Real-life scenarios for the lead's run

- Run `npx vitest run test/unit/invariants.test.ts --maxWorkers=3`: 14 pass.
- Break any drill row above, rerun: exactly its case fails with exit 1.
- With the packed product: a long tool output packs after repeated sends and
  `recall_output` pages the original back; a denied paid use never spends.

## App problems

- `npx tsx -e` cannot start in this sandbox (pipe listen `EINVAL` under the
  resource-created tree); probing was done through vitest instead. No other
  app misbehavior; the F91 first-command failure did not occur.
