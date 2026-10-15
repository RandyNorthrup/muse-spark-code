# Certification: request-shape and savings invariants (lane INVARIANTS)

Branch `fix/invariant-tests` from `06847350f` (PR 172's head). PR 172 deleted
every guard for the owner-protected SoL-Pi invariants because they used banned
fakes. This lane re-guards them with real modules and real inputs only:
`test/unit/invariants.test.ts` (25 tests, no `vi.mock`, no spies with
replacements, no fake timers, no hand-written stand-ins, no loopback
provider, no new e2e).

Review pass (RVINVARIANTS): the lane's first version followed product
constants in four places (tool names, packing thresholds, the eval arm's
numbers) and never named the eval tasks, so renaming a tool, raising
`OBS_PACK_WHOLE_SENDS` 2 → 5 and renaming an eval task all passed 14/14
(measured). Those assertions now pin literals. Missed paths added: base
tool bytes under optional flags, retried-send counting, resume/reset
stickiness, exact savings, per-claim and staged paid tallies, price-rise
re-ask under a saved grant, revoke, `then_run`'s matcher aliases and
authorize-then-guard ordering, failure reopening on a new user task, and
a golden describe (invariant 7 had no case at all).

## Per-invariant record

| #   | Invariant                                                                                                       | Enforcing code                                                                                                                                                                                                                                           | Test (file: case)                                                                                                                                                                                                                                                                                                                                                                                                                                                                   | Red drill (exit)                                                                                                                                                                                                                                                                                                                       |
| --- | --------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | Earlier request bytes never change; extras at tail; tool list byte-stable; narrowing at admission               | `src/core/backends/modelapi/tools.ts:699` (`toolDefinitions`); `src/core/backends/modelapi/instructions.ts:273` (`instructionsFor`); replay + tail push `src/core/backends/modelapi/ModelApiHost.ts:4466-4479`                                           | `test/unit/invariants.test.ts`: literal wire names in fixed order; optional tools leave every base tool's bytes untouched; stable definition key order; `then_run` only with shell; byte-identical instructions; trailing sections (repo map, then goal) keep earlier bytes as prefix                                                                                                                                                                                               | Swapped `strict` before `parameters` in `define()` → key-order case fails (exit 1). Swapped `search`/`list_files` blocks → fixed-order case fails (exit 1). Renamed `read_file` → `readfile` in constants → fixed-order and both golden cases fail (exit 1, RV). All reverted byte-exact (SHA-256 compared)                            |
| 2   | ObservationPack: packs after rewrite; archive holds what the model saw; sticky swap; `recall_output` returns it | `src/core/backends/modelapi/observationPack.ts:230` (`project`), `:294` (`noteSent`), `:341` (`packedCallIds`), `:361` (`recall`); host packs the post-rewrite output (`ModelApiHost.ts:4487`, `thenRun` keeps results whole for packing `:12311-12318`) | `invariants.test.ts`: thresholds pinned as literals (2 whole sends, 8000 chars, 4000-char pages); whole then placeholder, sticky, exact ledger; a retried send counts once; resume packs from the first request, reset forgets; recall pages and searches the archived original, unknown id errors                                                                                                                                                                                  | `noteSent` never sets `isPacked` → pack case fails (exit 1). `OBS_PACK_WHOLE_SENDS` 2 → 5 → pin and arm-description cases fail (exit 1, RV; the first version followed the constant and passed). Dropping the retried-send guard in `noteSent` → retry case fails (exit 1, RV). All reverted byte-exact                                |
| 3   | Paid calls share one gate (D48 consent + budget + reducer), tallied separately                                  | `src/core/paid/paidAuthority.ts:119` (`step` — the single reducer; key `paidAuthorityKey`: `:101`); admission re-checks consent + budget `src/core/backends/modelapi/autoCompactionAdmission.ts:143-170`                                                 | `invariants.test.ts`: two keys, one shared `step` state; the day mirror is asserted as a mirror only (the cap is refused by the budget journal's claim check, `src/host/backend/sessionBudgetJournal.ts`, covered by `test/unit/sessionBudget.test.ts`'s reserveRequest cases); grant for A never answers B; denied B cannot reserve; per-claim tallies and staged-settle deltas are exact; revoke ends authority; a higher tariff under a saved grant for the same key asks again  | `deny` approves instead of deleting → per-key case fails (exit 1). Dropping the tariff comparison from `isApproved` → price-rise case fails (exit 1, RV). All reverted byte-exact. A first drill (dropping only the approved-check) did not fail: denied quotes are deleted, so reserve still throws — recorded as a weak-drill lesson |
| 4   | `then_run` goes through every shell guard, imported ones included                                               | `thenRunOf` parses `src/core/backends/modelapi/verifyTools.ts:53`; host runs it as the shell via `runVerifyCommand` with the as-edited guard `ModelApiHost.ts:12241-12280`; offered only with the shell `tools.ts:704-705`                               | `invariants.test.ts`: absent/run/invalid parsing; a present non-string is reported, never dropped; empty is absent; the shell is named to imported hooks under the literal aliases `Bash`/`shell` (`toolMatcherNames`); `authorizeThenGuard` refuses before the guard, reports a changed file, and re-authorizes when a rule lapses. Shell gating covered by the inv-1 `then_run` case. The host chain itself (PreToolUse hooks firing, permission cards) stays listed for the lead | Non-string → `absent` → parse case fails (exit 1). Dropping the `Bash` alias → matcher case fails (exit 1, RV). Skipping the guard call in `authorizeThenGuard` → ordering case fails (exit 1, RV). All reverted byte-exact. The full guard chain incl. imported hooks firing is host-level: listed for the lead                       |
| 5   | Overflow compaction skips the economics gate; failure refusal stays scoped; hidden turns fire no hooks          | `AutoCompact.decide(input, isOverflow)` `src/core/backends/modelapi/autoCompact.ts:146`; hard-limit call `maybeAutoCompact(turn, true)` on `ContextOverflowError` `ModelApiHost.ts:13577-13584`; economics bypass inside the active turn `:14754`        | `invariants.test.ts`: same input refused without overflow, `overflow` decision with it; `failed()` blocks until `noteToolWork()` or a new user task reopens; overflow with nothing removable or invalid counts still refuses. Hidden-turn hook silence is NOT covered here — host-level, listed for the lead                                                                                                                                                                        | Dropped `!isOverflow` from the gate → overflow case fails (exit 1). Removing `isRefused = false` from `newUserTask` → reopening case fails (exit 1, RV). All reverted byte-exact. Hidden-turn hook silence has no pure predicate: listed for the lead                                                                                  |
| 6   | The M75 eval stays comparable                                                                                   | Arm `src/core/eval/mechanisms.ts:15` (packing change is one dep override); task set `src/core/eval/tasks.ts:356`; admission requires evaluated `autoCompactionAdmission.ts:143`                                                                          | `invariants.test.ts`: arm name and literal threshold numbers (`8000 characters`, `whole for 2 requests`) in its description; the literal task ids of both splits, disjoint and in order                                                                                                                                                                                                                                                                                             | Renamed arm → description case fails (exit 1). Renamed `accept-off-by-one` → task-set case fails (exit 1, RV; the first version passed). All reverted byte-exact                                                                                                                                                                       |
| 7   | Golden request bytes with new features off                                                                      | Fixtures `test/fixtures/golden-requests/*.json` (+ `strict/`); one surviving reader `test/unit/modelApiLoopContracts.test.ts:62-76`                                                                                                                      | Unit-level against the real modules: every recorded request (17 files incl. `strict/`) keeps the sent key order; the plain 01 turn's tools, instructions and `prompt_cache_key` are reproduced byte-for-byte by `toolDefinitions`, `instructionsFor` and `promptCacheKey`; `strict/01` likewise through `withStrictTools`. Full loopback golden: listed for the lead (see the wire note below)                                                                                      | Tool rename (inv-1 drill) and swapping the cache-key digest order in `promptCacheKey` each fail both golden reproduction cases (exit 1, RV). All reverted byte-exact                                                                                                                                                                   |

## Surviving real coverage already in the tree

- `test/unit/modelApiLoopContracts.test.ts` — output caps, bounds, pacing; reads one golden fixture.
- `test/unit/autoCompact.test.ts` — real `AutoCompact` economics over priced tiers.
- `test/unit/paidMoneyPorts.test.ts` — money-port shape checks over real sources.
- `test/unit/sessionBudget.test.ts` — `reserveRequest` cap refusals over the
  real budget module (the budget half of invariant 3's gate).

## Does the rebuilt body equal the bytes the provider receives? (RV)

On the Meta path, almost: `ModelApiHost.body()` builds the
`CreateResponseBody`, `keyed()` appends `prompt_cache_key` and
`prompt_cache_retention`, and `ModelApiClient.streamResponse` hands the
object unchanged to `RequestTransport.streamRequest`, which sends
`JSON.stringify(body)` (`client.ts:589`, `transport.ts:1003`). Three
things can still change bytes after `body()`:

1. `budgeted()` (`ModelApiHost.ts:3846`): appends `max_tool_calls` at the
   end when hosted search is bounded, and can lower `max_output_tokens`
   to what the cap affords. With features off and no cap, neither fires.
2. The vault scrub (`transport.ts:864`): when a vault is present the
   serialized body passes through `scrubSecrets`, which replaces exact
   secret values. Deliberate, and absent without a vault.
3. Other providers: `CodecClient` re-encodes through the format codec
   (the Responses codec rebuilds the object — replay mapping,
   `cleanWireText`, strict conversion, conditional cache fields;
   `codecs/responses.ts:397`). The goldens are the Meta shape only.

So the unit golden proves every byte the pure modules own (tools,
instructions, cache key, key order, the literal scalars of scenario 01),
and nothing on the Meta path adds bytes after them in the features-off
case. What a recorded real exchange would add is the host assembly
itself across a conversation: scenario inputs and replay progression
(02–09), tool results, the subagent child's different instructions and
tools, compaction's rewritten input, and any field the host adds that
the parts do not own. That needs the packed agent driven against a
loopback replaying a recorded real provider exchange per scenario —
listed for the lead below.

One fixture overclaims its name: in `04-packed-output.json` the
13,407-character output rides whole in all four requests and no
`recall_output` tool is offered — packing never engages in the recorded
scenario. Packing itself is guarded by invariant 2's cases through the
real `ObservationPack`; a re-recorded 04 belongs with the lead's
recorded exchanges.

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

- Run `npx vitest run test/unit/invariants.test.ts --maxWorkers=3`: 25 pass.
- Break any drill row above, rerun: exactly its case fails with exit 1.
- With the packed product: a long tool output packs after repeated sends and
  `recall_output` pages the original back; a denied paid use never spends.

## App problems

- `npx tsx -e` cannot start in this sandbox (pipe listen `EINVAL` under the
  resource-created tree); probing was done through vitest instead. No other
  app misbehavior; the F91 first-command failure did not occur.
