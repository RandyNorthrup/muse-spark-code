# Lane LIMITSA certification — no default cap refuses the person's work (F88, A2–A6)

Worktree: `/home/randy/lanes/LIMITSA`, branch `fix/limits-stops`, rig
`wslpc`, base `58ee70b03` (lane TURNLIMIT). No credentials were read,
copied or stored. No live or paid model call was made; counted model
attempts: **0**. The probe secret below is a dummy string to a closed
port, deleted after the run. All verification runs use the repository's
own test timeout (no `--testTimeout`); at most 3 files per run.

Commits: `e6e75d251` (F88), `4cc2f1b24` (A2/A3), `b93ae2d94` (A5),
`0999e15c4` (A6), A4 commit + docs commit (see `git log`).

## What changed (lead rulings)

1. **F88, the real error.** The `catch` after a configured client's
   `streamResponse` (`src/core/providers/configured.ts`) rethrows every
   product error in its own words; only a wordless non-`Error` throw
   becomes "Models & Agents is not available in this build". A provider
   `error` event or a response carrying `error` throws the provider's
   message with its status and code instead of the panel text. Pure
   classifiers `configuredStreamError` / `configuredProviderStreamError`.
2. **A2/A3 money (D113).** Session and paid-daily-extras caps compare
   real settled spend after each response, plus that one response's
   overshoot. Requests keep their own `max_output_tokens`; only the
   input estimate (plus any hosted-search allowance) is held up front.
   Only a request whose input alone exceeds what is left is refused
   sooner. The stop sentence names spent, cap and how to raise it
   (`museSpark.modelApiSessionBudgetUsd`). Own provider keys never had
   a daily cap (`isModelApi` gate, `src/extension.ts:1124`). The
   budget-lowered reply notice is gone.
3. **A5.** The 4-request cap per sub-task is removed
   (`SUBAGENT_TASK_MAX_REQUESTS`, grant `remainingAttempts`, the
   `requestLimit` refusal and both `subagentRequestLimit` strings are
   gone). Consent still asks first and names per-request rates; the
   price-acceptance version bumped so old grants ask again.
4. **A6.** Identical calls: skip (model told to change approach) at 3
   and 4, turn stops at 5 (`TOOL_REPEAT_STOP_LIMIT`). The person already
   gets `modelApiToolStuck` as a panel notice and through ACP (read the
   `backendNotice` path in both).
5. **A4.** Tab keeps its daily budget; the first refusal of each local
   day raises a warning naming spend, budget and how to raise it, with
   an Open Settings action (`museSpark.tabDailyBudgetUsd`).

## fail() sites a send can reach (ruling 1, listed)

In `src/core/providers/configured.ts`, after this lane:

- `delegate()` (no `meta` client): person has no usable backend at all;
  the panel's unavailable text is the only true statement. Kept.
- `presetFor` / `transportFor` / `verifyEndpoint` failures (bad preset,
  origin, DNS, private network without consent): configuration errors,
  thrown before any send; still the unavailable sentence. A person CAN
  see it but cannot tell config from outage — named as a follow-up
  (APP PROBLEMS 1).
- `credential()` failures (missing/invalid/rotated secret): same shape
  as above; the sign-in UI owns the visible remedy. Named in APP
  PROBLEMS 1.
- `read()` invalid file: throws the file's `RangeError` detail, not
  `fail()`. Visible.
- `chunks()` oversize stream: `fail()`; a genuinely unbounded stream,
  no product words exist. Kept.
- `scan()` catch (model-list scan): `fail()`; the panel shows no
  models, which is the visible signal. Kept.
- `decode()` null body: `fail()`; no provider words exist. Kept.
- `decode()` error event / response error: NOW THROWS the provider's
  message + status + code (was `fail()`). Visible.
- `streamResponse` catch: NOW RETHROWS everything with an `Error`'s own
  message (was `fail()` except four kinds). Visible.
- `boundClient` model mismatch (`body.model !== ref`): stale binding,
  kept as `fail()`.
- `accountId()` credential failures: same as `credential()` above.

## Red drills (each: broke source on purpose, saw the fail, restored)

- F88: `configuredStreamError` forced to mask → 4 of 8 fail
  (`expected Error: Models & Agents … to be ModelApiError: Bad
request…`); restored, 8 pass. Hash before/after identical.
- A2/A3: reservation forced to 1 output token → 13 of 42 fail;
  restored byte-exact (sha256 `e4e2ae76…`); 41 pass after the jscpd
  merge of a self-duplicated assertion.
- A5: consent price forced back to "up to 4" → 1 of 2 fails;
  restored, 2 pass.
- A6: guard forced to stop at 3 → 2 of 6 fail; restored, 6 pass.
- A4: notice helper neutered → 1 of 1 fails; restored, 1 pass.

## Proof on the packed product (owner rule 4; no stand-in server)

- `npm run build` green (bundle-size + bundle-split gates inside it).
- `test/e2e/execStdio.e2e.test.ts`: 46/46 pass (real built engine,
  incl. E8 plan-mode turn on a configured provider).
- Closed-port probe against `dist/configuredProviders.js` (custom
  `custom`-preset entry at `http://127.0.0.1:9`, `privateNetwork:
true`, dummy secret to the dead port, since removed): the send ended
  as `ModelApiError` with the provider's own status words (`HTTP 502`
  — this sandbox's proxy answers the dead port), masks nothing: true.
  First probe iteration failed on my own malformed body (missing
  `reasoning`), not on product code.

## Real-life scenarios for the lead (need a real provider answer)

1. Set `museSpark.modelApiSessionBudgetUsd` to $5, spend ~$2, send a
   long-context request: it runs (no worst-case refusal); after real
   spend passes $5 the next request stops with the spend/cap/raise
   sentence, never "Models & Agents is not available".
2. Set a person cap of $0.10 and chat past it: the request after the
   cap stops with the budget sentence.
3. Send through a provider returning HTTP 400 with an error body: the
   person sees that status and message.
4. Approve a child task and let it work past 4 requests: it continues
   (consent names rates, no count); stop the turn to stop it.
5. Make the model repeat one tool call 5 times: 3rd/4th skipped with
   the change-approach note, 5th ends the turn with the stuck sentence.
6. Use Tab past the $1 daily budget: one warning names spend, budget
   and the setting, with Open Settings.

## Gates (final tree; exit codes)

- `npm run typecheck`: exit 0 (final tree re-run below).
- eslint on changed files: exit 0 (two errors found and fixed before
  the A2/A3 commit: unused `formatNumber`, test helper scoping).
- prettier on changed files: clean.
- `node scripts/check-l10n.mjs`: 0 problems.
- Locale key order vs English: `equal=True`, all 14, 2969 keys each.
- `npm run check:reference`: exit 0 (after `reference:generate` for the
  session-budget setting text; diff is that sentence only).
- `npm run check:host-api`: exit 0 (after `-- --write`; diff only adds
  `tabBundle.ts` to the existing `showWarningMessage` /
  `MessageOptions.detail` rows).
- `npm run deadcode` (knip): exit 0.
- `npm run cycles` (dpdm): exit 0, no circular dependencies.
- `npm run duplication` (jscpd): exit 0 (after merging my own test
  clone in `sessionBudget.test.ts`).
- `npm run build`: exit 0 (tokens, size, split, globals, notices all
  inside it; MODEL_TEXT split gate passes).
- `npm run check:plan`: exit 0 (D113 trimmed to stay under the 85%
  reader bound; next PLAN.md addition trips it — archiving is due).
- `npm run security:audit`: exit 0 (2 advisories, 1 exception file
  entry, gate passes).
- `security:sast` (semgrep): not run — semgrep is not installed on
  this rig; no workaround attempted.
- `test/e2e/execStdio.e2e.test.ts`: 46/46 pass.
- `vitest related` over changed sources: tally below.

## Stand-in suites left for the lead (owner testing rule)

All fail on the deliberate D113 contract removals; each was inspected
and asserts the old worst-case/clamp/cap/stop-at-4 wording. Base
measured 670/670 on `modelApiHost.test.ts`; mine is 633/670.

- `test/unit/modelApiHost.test.ts`: 37 fail. Budget group (A2/A3):
  output-fit clamp, sub-16 refusal, whole-reservation counts x2,
  Meta-refused counts, output-limited notice, compaction/model-switch
  estimates, in-flight reservation, two-host overspend, later-host
  blocking, same-claim retry x2, invalid-usage charges x5, base x2,
  negative compaction base, compaction retry reservation count (its
  `reservations()` helper scrapes the old log line "reserved for N
  input and M output tokens"). Child group (A5): revive x2, queued
  note x2, web-search-denied child, declined follow-up, Manual spawn,
  fifth-attempt stop, Bypass re-ask, four-attempt grant on retries,
  Explore agent, agent-model popup (verified: diff is exactly the
  removed `attemptLimit: 4`), SubagentStop in four-request grant.
  Repeat group (A6): suppress-third/stop-fourth, batch serial. One
  mechanical type-compat literal (`attemptLimit: 4`) was removed so
  typecheck stays green; nothing else repaired per owner rule.
- `test/unit/configuredProviders.test.ts`: 4 masking assertions now
  surface the real error (scrubs canonical error x2, refuses redirect
  → `HTTP 307`, refuses echoed error). 3 loopback timing tests fail on
  the untouched base too (measured same conditions).
- `test/unit/paidDailyBudget.test.ts`: 1 fail ('reserves token extras
  at exact decimal prices' expects the worst case incl. output).
- `test/unit/paidHost.test.ts`: 1 fail (consent detail expects '4
  requests per task, including retries').
- `test/unit/modelPolicy.test.ts`: 2 fail (boundary quote and cold
  cache assertions expect worst-case reservation).
- `test/unit/usageIntegration.test.ts`: 1 fail ('settles two vendor
  host turns…' totals shaped by worst-case reservations).
- Pre-existing, base-verified (fail identically on `58ee70b03`):
  `referenceGenerator.test.mjs` B12 (`serve: --max-turn-requests`
  parser gap from lane TURNLIMIT) and the 3 loopback timing tests
  above.
- Passing dependents: `tabBundle` 30/30, `tabSpendGate` 4/4,
  `tabLedger` 21/21, `autoCompactionAdmission` 28/28,
  `acpAgent` (whole file), `runtimeAccounting`,
  `wizardSessionBudget`, `providersModel`, `modelApiAutoCompact`
  (whole files), `sessionBudget` 41/41, `repeatGuard` 6/6,
  `configuredStreamError` 8/8, `configuredSendFailure`,
  `subagentUncapped` 2/2, `tabBudgetNotice` 1/1.

## APP PROBLEMS

1. Config/credential `fail()`s in `configured.ts` still say "Models &
   Agents is not available in this build" for bad presets, origins,
   DNS, private networks and missing secrets. The person cannot tell
   a broken config from an outage. Follow-up: distinct
   configuration-error words at those sites.
2. `sessionBudgetRetryUnavailable` still says "Its full reservation
   was kept"; reservations are now input-only. The sentence is not
   false but overstates what is held. Follow-up: reword to the
   input-liability model.
3. Unused-but-synced `sessionBudgetOutputLimited` key remains in all
   tables (the emission is gone; removing the key is locale churn for
   no reader). Deliberate; say the word if it should go.
4. The A4 notice formats through the lazy tab bundle's installed
   table; if a budget refusal ever precedes provider creation, the
   fallback is English. No such path exists today (provider creation
   installs the table before any reserve).

## RVLIMITS review correction — Tab warning visibility (2026-10-14)

The original A4 callback passed its spend/cap/remedy sentence as
`MessageOptions.detail` without `modal: true`. The installed VS Code type
contract says detail is only shown for modal messages, so the pure notice
string test did not prove the person could read that sentence. The callback
now passes the translated sentence as the notification's visible message,
keeping the non-modal warning and Open Settings action. Proof: original
`src/host/tab/tabBundle.ts:1165` call plus the installed `MessageOptions`
contract. No provider call or editor stand-in was used. A lead must still
look at the built warning once; no UI inspection is claimed here.

## RVLIMITS review correction — remaining F88 paths (2026-10-14)

The original fail-site list above is historical, not evidence of F88
completion. Every `fail` in `configured.ts` now requires a fixed diagnostic
code, read through the existing translated `webFetchNetwork` template.
Config, credential, endpoint/pinning, missing model metadata, null body,
stream-size, stale binding and model scan failures no longer say the panel
is unavailable. Unknown non-Error throws use `unknown_provider_failure`.
HTTP errors retain their status in the visible message (previously
`ModelApiHost.describe` kept only `error.message`, losing the status).
The structural `isModelApiError` guard covers errors from another bundle.
No raw credential, header, provider URL or thrown free text is added to a
diagnostic code. Existing transport redaction remains in place.

Pure regressions in `configuredStreamError.test.ts` cover the visible HTTP
status and a separately bundled error shape; they still need an observed
run/red drill. The original positive wire-error examples are data, not a
provider emulator. Real provider HTTP behavior is not certified here.
The host's fallback registry/model-list refusals in `modelApiEntry.ts`
also use fixed request diagnostics instead of the panel's unavailable
sentence; the panel bundle's actual load failure keeps its panel wording.

## RVLIMITS evidence correction — reflex-only notice test (2026-10-14)

Removed `tabBudgetNotice.test.ts` (one case) and its exported
`tabBudgetReachedDetail` helper: the production notification never called
that helper. A test of a second formatter cannot prove the warning is
visible; it passed with the original hidden-detail defect. The real
notification now formats its visible text directly. Combined with the
TURNLIMIT removals, review removed **10 cases** (3 fake-provider/product
cases, 6 fake-settings/logger cases, 1 disconnected notice case). Existing
unrelated stand-in suites are left for TESTCUT, not extended here.

## RVLIMITS correction — Stop owns uncapped child tasks (2026-10-14)

Original `ModelApiSession.cancel()` only aborted its own active turn and
compaction; it never called a child's cancel or revoked the child's grant.
With the 4-request ceiling gone, a child could keep making paid requests
indefinitely after the person's Stop. `childGrantRefusal` did not depend on
the parent's active/aborted state. Stop now synchronously invalidates each
running/queued child's revision, pending/follow-up work and consent grant,
marks it interrupted, aborts resource admission and cancels its session.
Every child is invalidated before an awaited completion can start more
queued work. Completed results are retained. No fake-provider test was
added; this is proven by the old cancellation code and the reachable spawn
path. The lead must run a real paid child, press Stop, and check that both
an in-flight task and one waiting for capacity cease without new sends.
An already-interrupted child with an active turn or queued follow-up is
also included, so a follow-up cannot restart after the parent's Stop.

## RVLIMITS evidence correction — substituted pricing (2026-10-14)

Removed three `sessionBudget.test.ts` price-card cases whose hand-written
`ModelPricePolicy` duplicated token arithmetic and returned no settlement.
They did not exercise the real registry's worst-case cache-write pricing,
which still reserves more than real spend. Review has now removed **13
cases total**, not 10. Their replacement needs real registry/pricing code,
not a second implementation of that code; no replacement proof is claimed.

## RVLIMITS open blockers — claims corrected, behavior not complete

- **Real-spend-only caps are not implemented.** `reserveRequest` still
  compares a conservative input/search estimate with remaining cap. A
  $0.001 cap at $0 spent refuses 1,000 input tokens estimated at $0.00125,
  even though a cached response can cost less. `reserveProviderRequest`
  calls the real registry's worst-case cache-write price.
  `hookModelEntry:316`, `reviewerEntry:279`, hosted search in
  `client.ts:536` and Tab in `tabSpendGate.ts:56` still reserve whole
  response allowances. Parallel/child responses invalidate the claimed
  at-most-one-response overshoot. This needs one agreed admission and
  uncertain-liability contract across those consumers; no partial money
  patch was attempted in review.
- **Unknown usage was falsely known (fixed in review).** `endRequest`
  closed capped, sent requests at the input-only retained amount but only
  set unknown for uncapped/media requests (`ModelApiHost.ts:4179`). The
  unknown flag now follows ambiguous or sent-not-refused state regardless
  of cap, media or a zero amount. `recordBudgetCost` preserves zero unknown
  entries and journal admission refuses unverified history, rather than
  pretending the output was free. Source scenario proves the defect and
  the branch correction; a provider-driven failure run is still required.
- **A6 is not a general loop guard.** Production supplies no
  `repeatResultWitness`; the built-in witness only covers `read_file`
  without hooks (`ModelApiHost.ts:12703`). Repeating shell, search, list,
  MCP, goal or failed calls can run indefinitely with the default turn cap
  removed. The pure RepeatGuard cases prove only its state machine.
- **Summary failure is not a clean limit stop.** `stopAtTurnLimit` awaits
  its summary before returning the limit marker. A budget, connection,
  hook or provider refusal throws into the ordinary FAILED path; ACP
  rejects it as Internal error. The success-path notice cannot claim a
  summary when no summary arrived. A clean fallback needs translated
  wording and lifecycle proof, not swallowing the error.
- **The optional control is incomplete.** CLI/ACP reject 3 (fixed
  presets only), the panel has no new control, and `sessionMaxTurnRequests`
  is neither serialized nor inherited by children. Reopening ACP resets
  it to the serve default. The documented limit-3/continuation scenario
  cannot currently be completed as briefed.
- **Tab wording can still be false.** Its hard ledger refuses a pending
  worst-case request below the settled cap, but the warning says today's
  spend reached it. The visible-text repair does not change accounting.

These are open, not accepted deferrals. CHANGELOG/README no longer claim
completion. D113 collides with LIMITSC: proposal to the integrator is keep
LIMITSA at D113 and renumber LIMITSC to D114 (D114 is absent in this tree),
updating its references together. No unreviewed LIMITSC bytes were changed.

## RVLIMITS observed final checks (Windows, Node 24.20.0)

- `git merge --no-ff origin/main`: exit 0, Already up to date; local
  origin/main is `898a26c5e304426f2fb374910ec700b51b5260d1`. No fetch or push.
- All five typecheck projects run separately/serially: exit 0 each. ESLint
  on 38 changed code/test files and Prettier on 80 existing changed files:
  exit 0. Localization, reference, host API, plan, roadmap, deadcode, cycles
  and duplication: exit 0. Dependency audit: exit 0 (2 advisories, 1
  configured exception). These are static checks, not live-model proof.
- `npm run security:sast`: exit 2, `RPC subprocess failed: semgrep-core
exited with code 1`, `Failed to obtain target files from semgrep-core`.
  Cause UNMEASURED; no untouched-base comparison was run.
- `npm run build`: exit 1 at bundle-split (8 problems: pageWorker's parse5,
  entities, html-encoding-sniffer and @exodus/bytes; agentImport's
  smol-toml; imageResizeWorker's jpeg-js/pngjs; validation's mini-parser).
  Production compilation and size checks completed. No cap was changed;
  cause UNMEASURED, not called pre-existing or environmental.
- `node scripts/package-acp.mjs`: exit 1, `Required Darwin created-path
helper is missing: native\\darwin\\muse-dictate`. No packed product is
  certified. Built CLI Help ran, exit 0; built exec limit 3 refused, exit 2;
  built serve/Muse Code limit flag refused, exit 1. None read credentials
  or dispatched a model.
- Real built `dist/configuredProviders.js` registry with a temporary
  providers file naming an unsupported preset: exit 0, `The request
failed: provider_preset_unsupported`. Deliberately changed `fail` to panel
  masking, rebuilt production (exit 0), ran the same probe: exit 1,
  `Models & Agents is not available in this build.` Restored source
  byte-exact SHA-256
  `0399F821D7C7FE3573FB54CE9E34400651415CC898C10D4DB6B73F9C0CC60D7F`,
  rebuilt (exit 0), probe restored-green (exit 0). No server, provider,
  credentials or substitute for our product modules; the scratch probe's
  credential-access trap was never reached.

No Vitest run is claimed: copied rig scripts push snapshots outside this
worktree, forbidden here, and permission for local Vitest was unanswered.
No provider calls, GUI/browser run, screenshots or fake-provider e2e.
The F88 pure regressions still need their own observed suite/red drill;
the built config probe does not establish HTTP, money or turn behavior.
The complete review report and exact fail-site inventory are in the
requested lane report; remaining P1/P2 findings prevent merge approval.

## LIMITSFIX F4 — one repeat policy for every tool class (2026-10-14)

- **Cause.** `RepeatGuard.before` reset the count whenever no trusted
  witness existed, and only `read_file` without hooks had one
  (`ModelApiHost.ts` `canWitnessRead`). Every other tool's repeats were
  forgotten at once, so with the fixed round cap gone a shell, search, list,
  MCP, goal or failed call could repeat without bound.
- **Fix.** One choke point, `settlePreparedCall`: after every finished call
  `RepeatGuard.observe` fingerprints the call's arguments and its real
  result and returns `ok`, `warn` or `stuck`. The 3rd and 4th identical
  call and result queue `MODEL_API_MODEL_TEXT.toolRepeatWarned` for the
  model, written after the whole tool batch (a user message between a call
  and its output is invalid replay); the 5th stops the turn with the same
  translated sentence `modelApiToolStuck`. A witness stays an optimisation
  that lets a text read be skipped instead of run again; a missing witness
  no longer resets the count. A result that changes is never a repeat. A
  wait that timed out (`unfinished`: `subagent_wait`) and a command moved to
  the background reset the count instead of adding to it.
- **Red drill.** `observe` changed to count consecutive same-argument calls
  whatever their result: `test/unit/repeatGuard.test.ts` 2 failed
  ("resets for a changed argument, result…" and "never calls a poll with a
  changing result a repeat"), source restored byte-exact, SHA-256
  `483B7DE91792300D5D70BC7CBABFB8612B960581BEF8CAC39F3B168CA21C4B77`
  before and after.
- **Proof.** `npx vitest run test/unit/repeatGuard.test.ts --maxWorkers=2`:
  9 passed (this PC). `typecheck:host` 0; eslint `--max-warnings=0` on the
  five touched files 0. Pure logic through the real module only; the host
  wiring is proven by a real turn (real-life step 8), not by a stand-in.

## LIMITSFIX F3 â€” one admission and settlement contract on real spend (2026-10-15)

- **Cause.** Each consumer of a cap reserved its own estimate or worst case:
  the conversation held an input estimate (`sessionBudget.ts`), providers held
  `price.reserve` (worst-case cache writes), the hook and review helpers held
  whole response allowances, hosted search held an estimated token cost, Tab
  held input bytes plus its output cap, the daily extras held an input
  estimate, and a sub-agent bypassed the owner's cap altogether. A $0.001 cap
  at $0 spent refused 1,000 input tokens; $2.03 of a $5 cap refused a request
  whose worst case was $3.03.
- **The contract** (`src/shared/spendCap.ts`, one function `isBelowCap`):
  1. _Admission:_ a request is sent while the **settled real spend** is below
     the cap the person set. At or over it the next request stops, in words
     naming the spend, the cap and how to raise it (`sessionBudgetStopped`,
     `tabBudgetReachedDetail`, the daily extras' raise dialog). No input
     estimate and no output worst case is ever compared with a cap.
  2. _Settlement:_ each response's real cost lands in the shared ledger when
     its usage arrives (unchanged).
  3. _Unknown:_ a response lost before its usage is recorded as unknown, never
     as a guessed amount (journal `hasUnknownCost`; Tab's `unreportedRequests`),
     and the next capped request says so (`sessionBudgetLegacyFeesUnknown`).
- **Consumers moved onto it.** Conversation (`reserveRequest` in
  `sessionBudget.ts`, `budgeted` in `ModelApiHost.ts`); the journal's own final
  check (`sessionBudgetJournal.ts` `check`: it no longer compares its own hold,
  only everything else's settled spend); image generation (`ModelApiHost.ts`);
  hook helper (`hookModelEntry.ts`), reviewer (`reviewerEntry.ts`); hosted
  search (`client.ts`: holds only the exact fee ceiling, its own bound at the
  approved tariff); the shared daily extras (`paidDailyBudget.ts`); Tab
  (`tabLedger.ts`, `tabSpendGate.ts`, `tabProvider.ts`: no worst case, a
  zero-dollar in-flight mark); **children**: a sub-agent now shares its owner's
  cap and ledger (`admissionCap`, `budgeted`), where it used to bypass it.
- **Overshoot bound (honest).** The spend can pass the cap by at most the
  responses in flight when their requests were admitted: **one** for the
  conversation itself, plus **up to `SUBAGENT_CAPACITY` = 8** running
  sub-agents (they share the owner's ledger), plus one per helper request
  (hook, review) in flight, and Tab at most `TAB_MAX_IN_FLIGHT` = 2 (its own
  budget). It is not "one response" when children run. What a cap can never do
  is refuse work while the real spend is below it.
- **Kept.** The terminal's `--max-budget-usd` (`runtimeAccountingEntry.ts`,
  `reserveAdmitted`) and paid consent (`PaidUseConsent`) are untouched: paid
  extras still ask first; the daily extras still own their raise/stop dialog.
  The scheduled-run ledger (D95) and media request accounting (M105) keep
  their own finite, exact reservation (they have no person-set cap to follow).
- **Budget comparison with sources** (read this session):
  | Harness                                                                  | What it does                                                                                                                                                                                                                                                                                                                  | Source                                                                    |
  | ------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------- |
  | Claude Agent SDK / Claude Code                                           | `maxBudgetUsd` / `max_budget_usd` compares the call's accumulated cost, which is a _client-side estimate from a price table_; the `error_max_budget_usd` result's `total_cost_usd` **includes the response that crossed the budget**, so it can pass the cap by that response. Subagent cost is included in `total_cost_usd`. | https://code.claude.com/docs/en/agent-sdk/cost-tracking (read 2026-10-15) |
  | OpenCode                                                                 | Its Config reference documents no spend cap or budget option at all (provider timeouts, compaction, subagent depth only).                                                                                                                                                                                                     | https://opencode.ai/docs/config/ (read 2026-10-15)                        |
  | Codex CLI                                                                | **UNVERIFIED** â€” not read this session.                                                                                                                                                                                                                                                                                     | â€”                                                                       |
  | Gemini CLI, Cline                                                        | From `.lane/limits-audit.md` (sources it names, not re-read): Gemini has quota windows and no dollar cap; Cline has per-task `allowedMaxCost` auto-approval caps. **UNVERIFIED** here.                                                                                                                                        | audit, 2026-10-15                                                         |
  | Our contract matches the one documented behavior: real settled cost, the |
  | crossing response is counted, no pre-send hold.                          |
- **Red drills (broke source on purpose, saw the fail, restored byte-exact).**
  (1) `isBelowCap` made to add a $3.03 worst case: `sessionBudget.test.ts` 6
  failed; SHA-256 `7F315F8F842DD34F0D34500440996EB4FEBF1D77A727DFDC2F1FD1B6671AE778`
  before and after. (2) the journal's `check` made to compare its own hold:
  2 failed; `A5C8F9E8D5187FB32292856CB0FB5A1D3455104EA42896A7C870A32F8FBF9538`
  before and after. (3) Tab admission made to add a $0.05 worst case:
  `tabLedger.test.ts` 1 failed; `45CDABE3343C25278B30A8B23ADB342B84566B9A4FB661734FE73E2694EE20BC`
  before and after.
- **Tests (real code only).** `sessionBudget.test.ts` (rewritten: the old
  cases asserted the estimate comparison; new ones use a real journal over a
  real temporary folder), `tabLedger.test.ts` (new, real ledger files),
  `judgeAdmissionLedger.test.ts` (the two-window race now admits both and says
  so), `manifest.test.ts` (the setting's claims), `confirmedDispatchInventory.test.ts`
  (an allowlist entry moved with F88's rethrow, plus a behaviour check).
  One suite fails on this branch for a reason I measured as **not mine**:
  `modelsActivationBudget.test.ts` ("adds at most 3 KiB"): 3860 B growth, the
  the same 3860 B on `e8a7ec524` (the step-0 merge, before any edit of this
  continuation) and on `a16b46081` (F4), run in clean extracted copies of
  those commits. Its cause is UNMEASURED; I did not touch the cap.
- **Not claimed.** Real-life: a long cached context under a small cap runs;
  after reported spend passes the cap the next request stops naming
  spent/cap/raise (real-life step 4 below); concurrent children's overshoot.

## LIMITSFIX F5 — a person-set limit whose summary fails still ends cleanly (2026-10-15)

- **Cause.** `stopAtTurnLimit` awaited the summary request before returning
  the limit marker. A budget reached, a lost connection, a hook or a provider
  refusing that one request threw into the ordinary FAILED path
  (`ModelApiHost.ts`, the turn's catch), so ACP rejected the prompt with
  `RequestError.internalError` (`acp/agent.ts` `settle`), and the summary
  instruction stayed in the replay.
- **Fix.** The catch in `stopAtTurnLimit` ends the turn as the limit anyway,
  with a new translated notice `modelApiTurnLimitNoSummary` that says the
  summary could not be written and gives the failure's own reason. The
  summary instruction is removed from the stored replay and any call the
  half-finished reply left without an output is answered
  (`turnLimitStop.ts` `repairAfterFailedSummary`), so the next message
  replays valid input. A spend cap reached in the summary request is marked a
  budget stop. Steered input and a goal wake are still promoted. The person's
  own Stop (abort) is not turned into a clean limit.
- **Red drill.** `repairAfterFailedSummary` made to keep the instruction:
  `turnLimitStop.test.ts` 2 failed; SHA-256
  `6890BB2C14C59415B4F9232A796D7291C1500679BCE323B93CE29443FBA16A56` before
  and after the byte-exact restore.
- **Proof.** `turnLimitStop.test.ts` 4 passed (pure logic over data, real
  module); `check:l10n` 0 problems with the new key in all 14 tables;
  `typecheck:host` 0; eslint `--max-warnings=0` 0. **Not proven here:** the
  clean stop over the real editor protocol with a real failing summary (no
  provider call allowed): real-life step 3 below.
