# RLF-AUTORETRY certification — automatic retry of a transiently failed request (D217)

Lane RLF-AUTORETRY, recovery release. Worktree
`/Users/randy/lanes/RLF-AUTORETRY`, branch `rec/rlf-autoretry`, from
int/recovery at `f53ef168fe` (main 0.19.0 plus the recovery lanes to
RLM110C, 2026-10-23). Rig `macmini`. Built 2026-10-23, resumed and
finished 2026-10-30 after the quota interruption.

Expected call count, stated first: 0 live model calls. Spent: 0. Every
proof below runs real code over recorded real exchanges (the pinned
echo-turn capture with zero model calls, the recorded m91 failure with
the CLI's own `retryable: true`, real refused loopback sends): no
provider answers anything. The brief's forwarding-proxy proof against
the real service stays with the lead's real-life run: it needs a Model
API key, which a lane cannot hold (open item 1).

## What landed

| Change                                                           | Commit      | Shape                                                                                                                                                                                                                                                                   |
| ---------------------------------------------------------------- | ----------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| RLF-ACPTURNS Retry action merged in                              | `31318c8f`  | `retryable` on `turnCompleted`, the panel's Retry resubmit, ACP's `data.retryable` (the source branch `src/RLF-AUTORETRY/01-rec-rlf-acpturns`). No automatic resubmit in it.                                                                                            |
| Industry-standard retry policy with SDK-default fallback (D217)  | `13cb6937`  | Only transient failures retry (connection errors, timeouts, 408, 409, 429, 5xx, overload); exponential backoff with jitter honoring `retry-after` / `retry-after-ms` whole; documented provider maxima govern, else the SDK default (2 retries, 0.5 s doubling to 8 s). |
| One Retrying-in-Ns row with Stop, in the panel and ACP           | `3fe9bbb4`  | Each wait shows as one replaceable `turnRetry` row with attempt against ceiling and Stop; ACP clients hear the same sentence as a notice (own message where notices are unsupported).                                                                                   |
| Muse Code backend resends a retryable failed turn by itself      | `fc2af540`  | The panel controller holds a retryable Muse Code failure, names the wait, and resubmits the turn's own message in the same session; `museSpark.museCodeMaxRetries` (unset: two resends, `0`: manual Retry only), wired live in `src/extension.ts`.                      |
| Gate-driven follow-ups (clone removal, translations, stale pins) | `c2a58c8c`  | Retry and resend share `resubmitRememberedTurn`; posted-message collectors shared; the new setting string translated in all 14 manifest tables (stale retry-limit tails refreshed); the OpenAI overload pin and the ACP notice-id pin updated to the shipped behavior.  |
| Certification record, PLAN §6/D217/§7, roadmap entry             | this commit | This record; the milestone status; D217's shipped-scope note and the size-deferral addition; the RLFAUTORETRY roadmap entry.                                                                                                                                            |

`docs/acp.md` needs no change (the `turnRetry` notice reuses the
sanctioned notice path); CHANGELOG carries the resend addition.

## Retry semantics, as shipped

- The producer judges. The CLI backend reads the turn error's own
  `retryable` (RLF-ACPTURNS, `authRequired` false); the Model API
  backend judges durable state (overflow, plan limit, ledger, session
  budget, auth, credit) not retryable and per-attempt transient
  failures retryable. Absent judgment never reads as retryable.
- One retry loop per request path. The Model API backend retries the
  failed model request inside the turn, keeping the conversation and
  every tool result. The Muse Code backend, where the CLI owns the
  loop, resends the turn's own message in the same session from the
  panel controller — never re-running tools that already ran. A dead
  host's retryable turn resends on the replacement host, which
  restarts on send (D25).
- Backoff is exponential with jitter and honors provider-named waits
  whole. Industry default where nothing is documented: 2 retries,
  0.5 s doubling to 8 s.
- The person sees "Retrying in Ns (attempt K of N)" with Stop, in the
  panel and through ACP (Model API waits; the ACP agent itself leaves
  Muse Code resends to the client via `data.retryable` — open item 2).
  Stop, a non-transient error, a lowered-to-0 limit, or the last
  attempt shows the error with the Retry action.
- The maximum is person-settable per backend
  (`museSpark.modelApiMaxRetries`, `museSpark.museCodeMaxRetries`;
  `0` disables); unset, documented maxima govern on the Model API
  side and two resends on the Muse Code side. A panel control and a
  headless flag stay open (open items 3, 4).

## Industry citations (brief requirement; re-verified live 2026-10-30)

- Anthropic, platform.claude.com/docs/en/api/errors: "The official SDK
  automatically retries transient failures (such as connection errors,
  rate limits, and 5xx server errors) with exponential backoff, twice
  by default, honoring the `retry-after` header when present."
- OpenAI, developers.openai.com/api/docs/guides/error-codes: "use
  exponential backoff with jitter and limit the number of retries",
  with backoff when `Retry-After` isn't present.
- openai-python and anthropic-sdk-python constants
  (`DEFAULT_MAX_RETRIES`, `INITIAL_RETRY_DELAY`, `MAX_RETRY_DELAY`),
  read 2026-10-23: 2 retries, 0.5 s doubling to 8 s.

## Captures this lane rests on

- `test/fixtures/m106/msp-1.4.7-echo-turn.json`: pinned CLI
  1.4.7-R6101.1, `serve --provider echo`, captured 2026-10-23 via
  `node capture-echo-turn.mjs`, zero model calls. Serves the open,
  model list, session start, turn acks, `turn/started`, items and a
  completed `turn/completed`.
- `docs/certification/m91-captures/05-linux-msp-failure/turn-completed.jsonl`
  (2026-10-04): the CLI's own failed `turn/completed` with
  `retryable: true` and its cancelled end. Only connection-local
  identities (sessionId, turnId, cursor, stream id) are re-addressed
  to the live replay; terminal, reason, kind and the retryable
  judgment stay byte for byte.

## Drills (red/green, real code only)

Drill 1 — a dropped connection is retried and the turn completes with
its tool results intact (Muse Code backend):

- Suite: `test/unit/museCodeAutoResend.test.ts` →
  `retries a retryable failed turn and completes with its rows intact`
  (recorded `retryable: true` failure → named wait → resend →
  recorded completion; the failed turn's item row survives) and
  `a dead host resends on its replacement and completes` (SIGKILL
  crash → wait → re-established session → completion).
- Red: `holdForResend` broken to never hold (`retryable !== true`
  inverted) → exit 1, `only 0 resend waits named, wanted 1`, the
  failure showing at once. Green after revert: exit 0, 8/8.

Drill 2 — a refusal is not retried:

- Suites: `museCodeAutoResend.test.ts` → `shows a cancelled turn
once, without resending` and `does not resend a refused submit`;
  `test/unit/providerRefusals.test.ts` → `is credit and never
retried` (Model API backend, recorded exchange).
- Red: the hold gate broken to admit cancelled turns (retryable
  requirement dropped) → exit 1, the cancelled turn waits instead of
  showing once. Green after revert: exit 0, 8/8.

Drill 3 — Retry-After is honored:

- Suite: `test/unit/modelApiRetryNoCount.test.ts` → `honours a
provider-named wait whole instead of capping it at the fallback
ceiling` (plus `providerRetryLimits.test.ts` backoff bounds).
- Red: `retryDelayMs` broken to drop the provider-named wait
  (returns jitter only) → exit 1, `expected +0 to be 300000`.
  Green after revert: exit 0, 23/23 across both suites.

Drill 4 — Stop ends the retries:

- Suites: `museCodeAutoResend.test.ts` → `stops the wait on Stop and
shows the failure with Retry` (Muse Code backend);
  `providerRetryLimits.test.ts` → `a stop cancels the wait itself`
  (Model API backend).
- Red: `abortResend` broken to a no-op → exit 1, Stop leaves the
  wait pending and the held failure never shows. Green after
  revert: exit 0, 8/8.

Drill 5 — the default limit stops at its count and so does a
person-set one:

- Suites: `museCodeAutoResend.test.ts` → `stops at the default limit:
two resends, then the error`, `stops at the person-set limit, and 0
disables resending`, `a limit lowered to 0 mid-wait refuses the
resend`; `providerRetryLimits.test.ts` → `the person's setting
decides` incl. `a count above the documented maximum still stops at
it on a real refused send` (real ECONNREFUSED through the real
  transport to a closed loopback port).
- Red: the ceiling check broken to never stop (`maxResends < 0`
  conjoined) → exit 1, `expected [1000, 1500, 2500] to deeply equal
[1000, 1500]`, a third wait firing past the limit. Green after
  revert: exit 0, 8/8.

## Gates

Every exit code pasted, not described. A red gate names its measured
base-vs-tree attribution; this lane leaves zero marginal findings in
every red gate (details below).

- prettier --check on touched files: 0.
- eslint --max-warnings 0 on touched files: 0.
- `npm run typecheck` (all projects): 0.
- `node scripts/check-l10n.mjs`: 0 (after adding
  `config.museCodeMaxRetries.description` with real translations to
  all 14 manifest tables, and refreshing those tables'
  `config.modelApiMaxRetries.description` tails to the D217
  semantics the English table already carried).
- `npm run check:reference`: 0.
- `npm run check:host-api`: 0.
- `npm run check:plan`: 1, pre-existing size overage (PLAN.md
  3,772,501 bytes on the base commit vs 3,774,016 on this tree,
  both over the 3,565,158 tripwire; measured both ways). The archive
  stays with the lead at integration (RLM95 §7 deferral, plus this
  lane's addition recording its 1,515 bytes). No threshold changed.
- `npm run check:roadmap`: 0 (RLFAUTORETRY entry; milestone ids take
  no hyphen, so the entry id drops it).
- `npm run check:catches`: 1. Base tree: 88 new-site problems;
  this tree: 90. The 2 marginal sites are identity churn on
  baselined-GENERIC handlers this lane's D217 token edits touched
  (`providerClient.ts:379`, `transport.ts:1532`); core counts are
  unchanged (GENERIC 280 → 280) and every catch this lane added is
  NARROW or REPORTED (verified by inventory). The other 88 are base
  drift from previously merged lanes. Reshaping the two hot-path
  retry handlers to please the classifier was judged risk without
  payoff with the gate red either way; baseline reconciliation
  stays with the lead.
- `npm run duplication`: 1. 21 clones → 9 after this lane removed
  all 12 of its own (the resend/Retry resubmit core now shared as
  `resubmitRememberedTurn`, replay readers folded, posted-message
  collectors shared in `helpers/conversationPanel.ts`, Transcript's
  row props shared by indexed access, repeated test
  sequences extracted). The 9 remaining are all in files this lane
  never touched (verified by intersection with the lane diff).
- `npm run cycles`: 0.
- `npm run deadcode`: 1. Every finding pre-exists in files this
  lane never touched (judge fixtures, `redact.ts`,
  `paidHost.ts`, four unused tags, knip ignore cleanups).
- `npm run build`: 1. The same 10 bundles over budget on the base
  tree and this tree (reportingPanel 50.6→50.7/50,
  resourceGovernor 126.9/125, resourceAdmission 25.5/25, modelApi
  544.3→544.2/525, modelsPanel 155.0/150, usageService 100.8/100,
  teamScheduler 75.3/75, vaultActions 25.1/25, estimateContracts
  25.1/25, wire 76.2→76.3/75 KiB): ±0.1 KiB noise, every budget
  held or already over before this lane. No budget raised.
- `npx vitest related` over all 28 lane-changed sources: exit 1 —
  990 files, 25370 passed, 83 failed in 38 files. 2 failures were
  this lane's stale pins (OpenAI's documented overload kind,
  RLF-ACPTURNS F1's notice message id), fixed in this lane and
  green since (28/28, 4/4). Each of the other 36 files was re-run
  on the untouched base tree and fails identically there
  (schedule, vault, resource, judge, team/exec-sweep, connector,
  macOS `ps`, plan-reader, estimator, roadmap-truth, packaging
  and help suites: base drift from previously merged lanes, the
  missing zopfli install, `ps` denial on this rig, and 5 s
  timeouts under shared-rig load).
- SAST: 1, pre-existing (5 blocking `replaceAll`-sanitization
  findings, all in `src/host/backend/deviceWorkerDarwin.ts`, a file
  this lane never touched).
- `npm run security:audit`: 1, pre-existing (FAIL highs in
  `@azure/msal-node`, undici ×4 and zod, plus a stale braces
  exception entry and a markdown-it exception expired 2026-10-24).
  This lane adds no dependency (its `package.json` delta is the
  one setting block).

## Open items for the lead

1. Forwarding-proxy proof against the real service (brief's "Proof"
   paragraph): needs a Model API key; run in the real-life pass with
   `muse-spark-1.3-contributor`, expected calls stated first.
2. ACP-agent-internal auto-resend on the Muse Code backend: D217
   names the ACP agent as a send site, but RLF-ACPTURNS's shipped
   design is client-resends via `data.retryable`, and an internal
   resend loop (pending-prompt lifetime, cancel, notices, limit
   source) is a second send site with its own risk. Recommendation:
   keep client-side retry unless editors ask for agent-side.
3. Panel control for the maximum: no setting in the product is set
   from the panel today (RETRYLIMITS precedent is setting-only);
   needs a protocol message, host handler, webview control and l10n.
4. Headless flag for the maximum: `exec` does not retry today, so a
   `--max-retries` flag alone would be dead code; needs an exec
   retry loop first.
