# Certification: request-shape and savings invariants (lane INVARIANTS)

Branch `fix/invariant-tests` from `06847350f` (PR 172's head). PR 172 deleted
every guard for the owner-protected SoL-Pi invariants because they used banned
fakes. This lane re-guards them with real modules and real inputs only:
`test/unit/invariants.test.ts` (42 tests, no `vi.mock`, no spies with
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

Review findings (PR184FIX, Codex review of PR #184 in merge train #209):
four P1s, each fixed at its cause in `cb0a8bfbd` (42 tests green):

1. Fabricated inputs (`:294`): paid quotes now name real priced models
   (`muse-spark-1.3`, `muse-spark-1.2`) at the listed web-search tariff
   read through the real `webSearchPriceUsd`, with a literal `0.0025`
   anchor (a provider price change fails and is re-verified); quote ids
   stay the test's own distinct request ids and `capturedAt` is the real
   clock, as production sets them. Packing drives the recorded scenario-04
   `read_file` output (13,407 chars). The verify guard and lapse check
   read real temp files. Instruction facts reproduce the recorded harness
   environment (harness date 1970-01-01). Catalogue rates stay literals
   with their verification provenance (`MODEL_API_PRICES_VERIFIED_ON`
   2026-09-26).
2. Golden vs real request path (`:699`): every scenario's tools and
   instructions reproduce through the real builders (all ten plain files,
   seven strict files via the real strict conversion, including the 06
   child prefix and the host-appended `web_search` tool), every request's
   cache key is recomputed by the real `promptCacheKey`, and the 01
   plain/strict turns compare byte-for-byte. Residual: the host's scalar
   assembly (a brand-new body field would still pass) — listed for the
   lead's loopback run below.
3. Undocumented cast (`:194`): the `as string` is a throwing `typeof`
   guard (the union is real: `string | readonly FunctionOutputPart[]`).
4. Task-id-only freeze (`:609`): a SHA-256 digest over the complete task
   definitions plus the verifier prelude, with each definition parsed
   under the real `evalTaskSchema` (`e613f70a…051a48`).

Review of the fixes (RVPR184FIX): three hand-copy residues of the same
two P1 classes remained, each proven by a mutation that passed before
and fails now (42 tests green; mutations reverted byte-exact):

1. The 07 rules section was hand-assembled in the test and the 06
   hosted-search tool was a hand-written literal: renaming
   `renderRules`' heading and `MODEL_API_WEB_SEARCH_TOOL` both passed
   (exit 0, measured). Both now go through the real producers
   (`renderRules`, the host's own constant); the same drills fail
   3 cases (exit 1) in `a10cafa6c`.
2. Invariant 2 sent the recorded 04 output inside an invented wrapper
   (call id `call_big_output`, tool `search`, arguments `{}`), though
   recall reports the call's tool as the source. The recorded
   `read_file` call (`c1` on big.txt) is now parsed from the fixture
   under `functionCallItemSchema` and sent whole; paid quote ids are
   minted with `randomUUID` as `paidConsent` mints them, replacing the
   `q-a`/`q-b` literals the first P1 named (`3acdd4af7`).

The residual is unchanged and still unproven: the host's scalar
assembly (a brand-new body field would still pass) stays listed for the
lead's loopback run below; nothing in this file claims it.

## Per-invariant record

| #   | Invariant                                                                                                       | Enforcing code                                                                                                                                                                                                                                           | Test (file: case)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    | Red drill (exit)                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| --- | --------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | Earlier request bytes never change; extras at tail; tool list byte-stable; narrowing at admission               | `src/core/backends/modelapi/tools.ts:699` (`toolDefinitions`); `src/core/backends/modelapi/instructions.ts:273` (`instructionsFor`); replay + tail push `src/core/backends/modelapi/ModelApiHost.ts:4466-4479`                                           | `test/unit/invariants.test.ts`: literal wire names in fixed order; optional tools leave every base tool's bytes untouched; stable definition key order; `then_run` only with shell; byte-identical instructions over the recorded harness facts (/ws, linux, 1970-01-01); trailing sections (repo map, then goal) keep earlier bytes as prefix                                                                                                                                                                                                                                                                                                                       | Swapped `strict` before `parameters` in `define()` → key-order case fails (exit 1). Swapped `search`/`list_files` blocks → fixed-order case fails (exit 1). Renamed `read_file` → `readfile` in constants → fixed-order and both golden cases fail (exit 1, RV). All reverted byte-exact (SHA-256 compared)                                                                                                                                                                                  |
| 2   | ObservationPack: packs after rewrite; archive holds what the model saw; sticky swap; `recall_output` returns it | `src/core/backends/modelapi/observationPack.ts:230` (`project`), `:294` (`noteSent`), `:341` (`packedCallIds`), `:361` (`recall`); host packs the post-rewrite output (`ModelApiHost.ts:4487`, `thenRun` keeps results whole for packing `:12311-12318`) | `invariants.test.ts`: thresholds pinned as literals (2 whole sends, 8000 chars, 4000-char pages); the oversized output is the recorded scenario-04 `read_file` result (13,407 chars); whole then placeholder, sticky, exact ledger; a retried send counts once; resume packs from the first request, reset forgets; recall pages and searches the archived original, unknown id errors; the output helper narrows with a throwing `typeof` guard (no cast)                                                                                                                                                                                                           | `noteSent` never sets `isPacked` → pack case fails (exit 1). `OBS_PACK_WHOLE_SENDS` 2 → 5 → pin and arm-description cases fail (exit 1, RV; the first version followed the constant and passed). Dropping the retried-send guard in `noteSent` → retry case fails (exit 1, RV). All reverted byte-exact                                                                                                                                                                                      |
| 3   | Paid calls share one gate (D48 consent + budget + reducer), tallied separately                                  | `src/core/paid/paidAuthority.ts:119` (`step` — the single reducer; key `paidAuthorityKey`: `:101`); admission re-checks consent + budget `src/core/backends/modelapi/autoCompactionAdmission.ts:143-170`                                                 | `invariants.test.ts`: two real priced models as keys (`muse-spark-1.3`, `muse-spark-1.2`) at the listed tariff via the real `webSearchPriceUsd` (literal `0.0025` anchor), one shared `step` state; the day mirror is asserted as a mirror only (the cap is refused by the budget journal's claim check, `src/host/backend/sessionBudgetJournal.ts`, covered by `test/unit/sessionBudget.test.ts`'s reserveRequest cases); grant for A never answers B; denied B cannot reserve; per-claim tallies and staged-settle deltas are exact multiples of the listed tariff; revoke ends authority; twice the listed tariff under a saved grant for the same key asks again | `deny` approves instead of deleting → per-key case fails (exit 1). Dropping the tariff comparison from `isApproved` → price-rise case fails (exit 1, RV). All reverted byte-exact. A first drill (dropping only the approved-check) did not fail: denied quotes are deleted, so reserve still throws — recorded as a weak-drill lesson. PR184FIX: tariff 2.5 → 2.6 fails the `0.0025` anchor (exit 1); the rise case still passes (it is relative to the listed tariff). Reverted byte-exact |
| 4   | `then_run` goes through every shell guard, imported ones included                                               | `thenRunOf` parses `src/core/backends/modelapi/verifyTools.ts:53`; host runs it as the shell via `runVerifyCommand` with the as-edited guard `ModelApiHost.ts:12241-12280`; offered only with the shell `tools.ts:704-705`                               | `invariants.test.ts`: absent/run/invalid parsing; a present non-string is reported, never dropped; empty is absent; the shell is named to imported hooks under the literal aliases `Bash`/`shell` (`toolMatcherNames`); `authorizeThenGuard` refuses before the guard, reports a changed file, and re-authorizes when a rule lapses — the guard and lapse check read real temp files (a real edit lands mid-wait), the authorize answers are the two real user answers. Shell gating covered by the inv-1 `then_run` case. The host chain itself (PreToolUse hooks firing, permission cards) stays listed for the lead                                               | Non-string → `absent` → parse case fails (exit 1). Dropping the `Bash` alias → matcher case fails (exit 1, RV). Skipping the guard call in `authorizeThenGuard` → ordering case fails (exit 1, RV). All reverted byte-exact. The full guard chain incl. imported hooks firing is host-level: listed for the lead                                                                                                                                                                             |
| 5   | Overflow compaction skips the economics gate; failure refusal stays scoped; hidden turns fire no hooks          | `AutoCompact.decide(input, isOverflow)` `src/core/backends/modelapi/autoCompact.ts:146`; hard-limit call `maybeAutoCompact(turn, true)` on `ContextOverflowError` `ModelApiHost.ts:13577-13584`; economics bypass inside the active turn `:14754`        | `invariants.test.ts`: same input refused without overflow, `overflow` decision with it; `failed()` blocks until `noteToolWork()` or a new user task reopens; overflow with nothing removable or invalid counts still refuses. Hidden-turn hook silence is NOT covered here — host-level, listed for the lead                                                                                                                                                                                                                                                                                                                                                         | Dropped `!isOverflow` from the gate → overflow case fails (exit 1). Removing `isRefused = false` from `newUserTask` → reopening case fails (exit 1, RV). All reverted byte-exact. Hidden-turn hook silence has no pure predicate: listed for the lead                                                                                                                                                                                                                                        |
| 6   | The M75 eval stays comparable                                                                                   | Arm `src/core/eval/mechanisms.ts:15` (packing change is one dep override); task set `src/core/eval/tasks.ts:103`; admission requires evaluated `autoCompactionAdmission.ts:143`                                                                          | `invariants.test.ts`: arm name and literal threshold numbers (`8000 characters`, `whole for 2 requests`) in its description; a SHA-256 digest over the complete task definitions plus the verifier prelude (`e613f70a…051a48`), each definition parsed under the real `evalTaskSchema`, splits disjoint                                                                                                                                                                                                                                                                                                                                                              | Renamed arm → description case fails (exit 1). Renamed `accept-off-by-one` → task-set case fails (exit 1, RV; the first version passed). PR184FIX: a one-word prompt change fails the digest (exit 1; the old id-only freeze would have passed). All reverted byte-exact                                                                                                                                                                                                                     |
| 7   | Golden request bytes with new features off                                                                      | Fixtures `test/fixtures/golden-requests/*.json` (+ `strict/`); one surviving reader `test/unit/modelApiLoopContracts.test.ts:62-76`                                                                                                                      | Against the real builders: every scenario's tools and instructions reproduce (all ten plain files, seven strict files via the real strict conversion, incl. the 06 child prefix and the host-appended `web_search` tool), every request's cache key is recomputed by the real `promptCacheKey`, and the 01 plain/strict turns compare byte-for-byte; every recorded request (17 files incl. `strict/`) keeps the sent key order. Host scalar assembly and the full loopback golden: listed for the lead (see the wire note below)                                                                                                                                    | Tool rename (inv-1 drill) and swapping the cache-key digest order in `promptCacheKey` each fail both golden reproduction cases (exit 1, RV). PR184FIX: dropping tools from the key prefix fails 19 reproduction/key cases (exit 1). All reverted byte-exact                                                                                                                                                                                                                                  |

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

So the unit golden now proves every byte the pure modules own on all
seventeen files (every scenario's tools, instructions and cache keys,
the complete 01 plain/strict bodies, the key order, the literal scalars),
and nothing on the Meta path adds bytes after them in the features-off
case. What still needs the host assembly itself: the scalars the host
fills in (`model`, `tool_choice`, `reasoning`, `stream`, `store`,
`include`, `max_output_tokens`, retention) and any field the host adds
that the parts do not own — a brand-new body field would still pass here
(the key-order literal only fires when the fixtures are regenerated with
it, at review). The scenario inputs and replay progression (02–09) stay
recorded bytes for the same reason. All of that needs the packed agent
driven against a loopback replaying a recorded real provider exchange
per scenario — listed for the lead below. One dated capture of the
required shape already exists (`test/fixtures/m106/u9-raw-strict-stream.json`,
provenance timestamp 2026-10-10, source SHA-256, projection record) as
the format example; per-golden-scenario replies do not exist yet.

One fixture overclaims its name: in `04-packed-output.json` the
13,407-character output rides whole in all four requests and no
`recall_output` tool is offered — packing never engages in the recorded
scenario. Packing itself is guarded by invariant 2's cases through the
real `ObservationPack`; a re-recorded 04 belongs with the lead's
recorded exchanges.

## Listed for the lead (not faked)

1. Full golden loopback: drive the packed agent against a loopback server
   replaying a RECORDED real exchange per `golden-requests` scenario and
   byte-compare — this is what proves the host's scalar assembly and would
   catch a brand-new body field. No scenario→recorded-reply mapping exists
   yet (candidate reply pools: `test/fixtures/responses-codec/`,
   `modelapi-chat/`, `m106/`, `m95-int/`; the dated u9 capture above shows
   the required provenance shape); the lead captures the real exchanges.
2. `then_run` full guard chain with imported (foreign) hooks firing, and
   hidden-turn (todo restate, memory flush) hook silence: host-level, needs a
   real session — prove in the real-life run, not with fakes.
3. Pack-after-rewrite ordering at host level (cited structurally above).
4. D48 paid-consent popup + budget wiring host-level (reducer covered here).

## Real-life scenarios for the lead's run

- Run `npx vitest run test/unit/invariants.test.ts --maxWorkers=3`: 42 pass.
- Break any drill row above, rerun: exactly its cases fail with exit 1.
- With the packed product: a long tool output packs after repeated sends and
  `recall_output` pages the original back; a denied paid use never spends.

## App problems

- `npx tsx -e` cannot start in this sandbox (pipe listen `EINVAL` under the
  resource-created tree); probing was done through vitest instead. No other
  app misbehavior; the F91 first-command failure did not occur.

PR184FIX adds: the `tsx` pipe failure recurred unchanged on this rig
(same `EINVAL`); `npx vite-node <script>` in `$TMPDIR` works for the same
probing (digest computation, tool-bytes diffing) and is the lane's
workaround of record. Scratch probe scripts were removed after use.
