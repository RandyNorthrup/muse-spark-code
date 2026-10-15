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
- **Unknown usage can be falsely known.** `endRequest` closes a capped,
  sent request at its input-only retained amount but only sets the unknown
  flag for uncapped/media requests (`ModelApiHost.ts:4179`). A failed
  stream's output may be billed and is no longer bounded by that amount.
  It must stay explicitly uncertain, including a zero input reservation;
  this fix is recorded separately from these claim corrections.
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
