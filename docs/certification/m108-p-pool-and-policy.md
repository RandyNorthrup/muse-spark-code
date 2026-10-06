# M108 P — Pool and policy (macmini, 2026-10-06)

Worktree `/Users/randy/lanes/M108P`, branch `m108/p`, base `9cad21cb`.
Read the rig brief, shared codex/common.md, AGENTS, PLAN D88/M108 and Q-M108,
the account-terms research and the prerequisite lane certifications. The rig
brief overrides common.md's old merge/remote-run instructions. No merge,
rebase, push, credentials, network, live/paid calls or installs were used.

## Delivered core

- `pool.ts`: configured order, swap at the next request boundary, sticky
  conversation/worker assignments, headroom spread without moving the main
  conversation, default-on swap/parallel and explicit headless opt-in.
  Admissions serialize until their atomic reservation is installed; network
  lifetimes do not. Duplicate active owner requests are refused.
- Every selection and physical send/retry checks T's account thresholds,
  per-account model access, current policy, confirmation, membership and
  current settings. Shared-group and global vendor blocks add no capacity;
  skipped group keys receive a notice. Known `Retry-After` blocks prevent
  dispatch. No account with room returns an explicit stop with reset and
  usage URL. Events contain opaque IDs and validated trigger data only.
- Swaps record before dispatch; a failed event write refunds the known
  nonsend. Cold-cache cost is integer nano-USD, included in the reservation
  and row. All account changes are conservatively cold pending Q-M108.
  Existing numeric output contracts are used only after exact round-trip
  validation. Shared daily and original parent-conversation budgets remain
  fixed, including child work; a failed sent attempt keeps its uncertainty
  with its original account. Zero-cost sent work and nonsend refunds are
  distinct.
- `confirmations.ts`: an injected private machine store, parsed local
  envelope, machine/provider/product/version/check-date/answer-time binding,
  and a digest of the entire row including its clauses. Concurrent requests
  share one question. Headless reads existing local grants only. Revocation
  invalidates held/pending grants immediately and serializes deletion;
  failed deletion cannot resurrect stale stored bytes. Rows are snapshotted
  before asynchronous reads/questions so in-place edits cannot change what
  the user agreed to.
- `policyGate.ts`: all 24 bundled policy rows, `on`/`confirm`/`notOffered`,
  full confirmation for one-per-person products even at user caps, and no
  vendor pooling from `ownCapsOnly` or `cancel`. Documented ChatGPT/Muse Code
  subscription recoveries precede confirmation. The question port exposes
  original clauses, URLs, page/check dates, the translated prohibition and
  consequence warning, legitimate-account statement and three answers.
- `accountReplay`: provider/account/origin/model identity; foreign or unknown
  native items use the injected captured codec's text-only conversion. No
  same-group exception is offered. This is an additional account fence to
  compose after CAPAUDIT F1, including its credential-ownership fence, not a
  replacement for that policy.
- `AccountPaidUseConsent` in `paidConsent.ts`: separate provider/account/price
  grants, the existing three-choice popup with verified tariff and exact
  shared daily budget, first-charge window consent, workspace Always,
  required questions, revocation and pending/current-account fences. The
  existing single-account `PaidUseConsent` behavior is unchanged.

These are functional core modules with required injected production ports,
not a shipped Models & Agents panel or an installed ModelApiHost integration.
M95's concrete registry, captured multi-provider replay layer and
`dist/providers.js` are absent on this base. No activation, webview,
command, setting, translation, dependency, wire parser or cap was changed.
The lane-0 xAI signed-out browser verification and Q-M108's second-credential
replay/cache/config-home captures remain with their named owners.

## Regressions observed before fixing

Each case first failed in its complete owning suite, then passed after the
fix. No exploratory timeout override or test filter was used.

| Finding                                                                                            | Failing regression                                                                                                                                        | Fix                                                                                                            |
| -------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------- |
| An in-place policy edit during the dialog could become the stored agreed row                       | `refuses a policy mutated in place while its question is open` (final parameterized name: `refuses a policy changed in place while its question is open`) | Snapshot the row before I/O/question and compare the grant with the current policy                             |
| A nonsent user-cap swap could leave sticky B, letting a later vendor-limit retry skip confirmation | `cannot bypass vendor confirmation through a nonsent swap chosen at a user cap`                                                                           | Commit stickiness only at the successful final send fence; reject a newly arising vendor trigger on the source |
| One completed revoke could reopen paid consent while a second revoke was pending                   | `keeps consent off until every concurrent revocation has finished`                                                                                        | Keep a count of outstanding serialized deletions and refuse until all finish                                   |
| A caller could change model, estimate or original budget scope while admission waited              | `binds the model, estimate and original budget owner across asynchronous admission`                                                                       | Copy and freeze the request and its estimate before admission                                                  |

The zero-duplication gate initially reported two repeated test blocks. The
policy-change cases now share a parameterized test, and the pool retains its
stronger nonsent/vendor-consent regression instead of the duplicate scenario.
The gate configuration was untouched.

## Scoped certification

Initial policy checkpoint commit: `96c951ad` (42 passing tests, five typecheck
projects, scoped lint/formatting and normal hook-on staged secret scan).
Final restored verification on macmini:

| Command / scope                                                                                                            | Result                                                                                                                            |
| -------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------- |
| `npx vitest run test/unit/confirmations.test.ts test/unit/policyGate.test.ts test/unit/paidConsent.test.ts --maxWorkers=3` | 65 passed (12 confirmation, 32 policy, 21 legacy consent)                                                                         |
| `npx vitest run test/unit/pool.test.ts test/unit/accountPaidConsent.test.ts test/e2e/accounts.e2e.test.ts --maxWorkers=3`  | 31 passed (19 pool/replay, 10 account paid consent, 2 fake composition)                                                           |
| `npm run typecheck`                                                                                                        | Passed, all five projects                                                                                                         |
| Scoped `npx eslint --max-warnings=0` on all 11 owned TypeScript files                                                      | Passed, no new escape hatches                                                                                                     |
| Scoped `npx prettier --check` on owned files and this record; `git diff --check`                                           | Passed (scoped verification before commit)                                                                                        |
| `npm run deadcode`                                                                                                         | Passed; two existing configuration hints, no findings                                                                             |
| `npx jscpd`                                                                                                                | Passed, zero clones; no ignore or threshold changes                                                                               |
| `node scripts/check-l10n.mjs`                                                                                              | Passed: 14 tables, 164 manifest strings, 606 source files; zero problems                                                          |
| `npm run check:host-api`                                                                                                   | 1 expected generated-record mismatch: `node:crypto` imports 46 → 47; W-owned record left unchanged, exact update handed off below |
| `npm run build`                                                                                                            | Passed: production build, all size/split/host-global checks and notices                                                           |
| Final normal commit hooks (lint-staged ESLint/Prettier and staged gitleaks)                                                | Initial checkpoint passed; final core commit uses the same normal hooks, with its result added below                              |

All final tests use the repository default timeout, at most three complete
files and three workers. The fake-only composition suite connects the real
pool and K's guarded account lookup to fake metadata, credentials and
transport. It checks B-only headers after A's user cap, a turn and fan-out
through per-account 429/Retry-After, and uncertainty on the originating
account. It is not an editor/installed ModelApiHost end-to-end receipt.

| Bundle                                     | Measured KiB | Unchanged cap KiB |
| ------------------------------------------ | -----------: | ----------------: |
| Activation                                 |        440.2 |               600 |
| Model API                                  |        450.1 |               475 |
| Checkpoint store                           |         76.9 |               225 |
| ACP                                        |        818.5 |               850 |
| Webview startup (main plus static imports) |        897.3 |               900 |
| Webview deferred JavaScript                |         49.7 |                50 |

All 37 shipped esbuild metafiles were inspected with Windows separators
normalized. None includes the new pool/policy/confirmation modules, consistent
with the absent M95 providers bundle. No lazy/activation binding is claimed by
this lane. Existing caps and split guard passed. `npm run cycles` also passed
(562 files, no cycles in the shipped graphs).

Full quality, aggregate tests/coverage, editor/bridge/ACP/headless integration,
accessibility, live captures and release certification remain with W/the lead,
as required by the bounded lane brief. No gate is weakened. Scratch logs and
drill runners under `temp/m108-p` are removed after their results are recorded.

## Executed guard drills

**72 distinct guards** deliberately broken. Each mutation ran the complete
owning test files (default timeout, at most three workers/files), exited 1
with a named assertion failure, then restored the original source bytes in
`finally` and compared SHA-256. Policy drills and the newly consolidated pool
scenario were rerun after test deduplication. The final clean 96-test runs
followed restoration. Source hashes below were rechecked against every drill
receipt before writing this record.

| Source                               | Original and restored SHA-256                                      |
| ------------------------------------ | ------------------------------------------------------------------ |
| `src/core/accounts/policyGate.ts`    | `a4962113de9cabfa919de747e04e31245ed4a8744f6037b4cf2632aa806f1a90` |
| `src/core/accounts/confirmations.ts` | `c2ff2b021d7e1c5b5b2f678f7843cb34c363c7f2900a5927e536e0fc1a30bdfe` |
| `src/core/accounts/pool.ts`          | `486b793349c54989582564f72eb8a2882c0d1a22208a244bce80a221092afbe9` |
| `src/core/paid/paidConsent.ts`       | `2bb06460ed3746f13cb8436708ce80b89a832cbc6618346d44da36c4b8d6dec0` |

### Policy and confirmation

| Broken guard            | First named failing test                                                                                                                                                                                         |
| ----------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| policy-confirm          | test/unit/policyGate.test.ts > M108 vendor account policy gate > meta/model-api enforces its policy for vendor limits and user caps                                                                              |
| one-person              | test/unit/policyGate.test.ts > M108 vendor account policy gate > mistral/consumer-plan enforces its policy for vendor limits and user caps                                                                       |
| not-offered             | test/unit/policyGate.test.ts > M108 vendor account policy gate > anthropic/claude-plan enforces its policy for vendor limits and user caps                                                                       |
| vendor-recovery         | test/unit/policyGate.test.ts > M108 vendor account policy gate > offers each documented subscription recovery before the confirmation                                                                            |
| own-caps-only           | test/unit/policyGate.test.ts > M108 vendor account policy gate > blocks vendor pooling after Only at my own caps and Cancel; keeps ordinary user caps                                                            |
| cancel                  | test/unit/policyGate.test.ts > M108 vendor account policy gate > blocks vendor pooling after Only at my own caps and Cancel; keeps ordinary user caps                                                            |
| policy-current          | test/unit/policyGate.test.ts > M108 vendor account policy gate > refuses a policy changed replacement while its question is open                                                                                 |
| machine                 | test/unit/confirmations.test.ts > M108 machine-local account confirmations > never carries a grant to another machine, provider or product                                                                       |
| provider                | test/unit/confirmations.test.ts > M108 machine-local account confirmations > rejects a tampered machine, provider, product, version, check date or answer time                                                   |
| product                 | test/unit/confirmations.test.ts > M108 machine-local account confirmations > rejects a tampered machine, provider, product, version, check date or answer time                                                   |
| version                 | test/unit/confirmations.test.ts > M108 machine-local account confirmations > rejects a tampered machine, provider, product, version, check date or answer time                                                   |
| checked-date            | test/unit/confirmations.test.ts > M108 machine-local account confirmations > rejects a tampered machine, provider, product, version, check date or answer time                                                   |
| future-answer           | test/unit/confirmations.test.ts > M108 machine-local account confirmations > rejects a tampered machine, provider, product, version, check date or answer time                                                   |
| valid-clock             | test/unit/confirmations.test.ts > M108 machine-local account confirmations > rejects malformed stored records, future answers and invalid popup choices                                                          |
| clause-digest           | test/unit/confirmations.test.ts > M108 machine-local account confirmations > asks again when the policy row changes: {"sources":[{"quote":"changed clause","url":"https://example.test/terms","pageDate":null}]} |
| headless-read-only      | test/unit/confirmations.test.ts > M108 machine-local account confirmations > shares one concurrent question and headless never opens one                                                                         |
| question-deduplication  | test/unit/confirmations.test.ts > M108 machine-local account confirmations > shares one concurrent question and headless never opens one                                                                         |
| grant-revocation        | test/unit/confirmations.test.ts > M108 machine-local account confirmations > revokes immediately and refuses an answer from a revoked pending dialog                                                             |
| pending-revocation      | test/unit/confirmations.test.ts > M108 machine-local account confirmations > revokes immediately and refuses an answer from a revoked pending dialog                                                             |
| revoked-store-tombstone | test/unit/confirmations.test.ts > M108 machine-local account confirmations > never rereads a revoked grant while deletion is pending or after deletion fails                                                     |
| write-order             | test/unit/confirmations.test.ts > M108 machine-local account confirmations > serializes revocation after an in-flight write and recovers after I/O failure                                                       |
| policy-snapshot         | test/unit/policyGate.test.ts > M108 vendor account policy gate > refuses a policy changed in place while its question is open                                                                                    |

### Pool, replay and paid consent

| Broken guard            | First named failing test                                                                                                                                                |
| ----------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| pool-order              | test/e2e/accounts.e2e.test.ts > M108 fake-only accounts composition > uses only B credentials and headers after A reaches its user cap                                  |
| worker-sticky           | test/e2e/accounts.e2e.test.ts > M108 fake-only accounts composition > handles a turn and fan-out through per-account 429 and Retry-After without retry dispatch         |
| headroom-spread         | test/e2e/accounts.e2e.test.ts > M108 fake-only accounts composition > handles a turn and fan-out through per-account 429 and Retry-After without retry dispatch         |
| admission-order         | test/unit/pool.test.ts > M108 account pool request boundaries > reserves before another parallel admission and skips accounts whose pending cap is full                 |
| shared-caps             | test/unit/pool.test.ts > M108 account pool request boundaries > never resets the original shared budget at a swap, and refunds a known nonsend                          |
| final-threshold         | test/unit/pool.test.ts > M108 account pool request boundaries > honors per-account Retry-After at each send and keeps sent uncertainty on its account                   |
| group-peer              | test/unit/pool.test.ts > M108 account pool request boundaries > skips a shared limit group with a notice and propagates a peer/global block                             |
| global-limit            | test/unit/pool.test.ts > M108 account pool request boundaries > skips a shared limit group with a notice and propagates a peer/global block                             |
| group-notice            | test/unit/pool.test.ts > M108 account pool request boundaries > skips a shared limit group with a notice and propagates a peer/global block                             |
| held-confirmation       | test/unit/pool.test.ts > M108 account pool request boundaries > requires policy confirmation for vendor pooling, and revocation stops the sticky assignment             |
| final-confirmation      | test/unit/pool.test.ts > M108 account pool request boundaries > rechecks removal, policy and settings after a reservation or popup                                      |
| headless-pool-flag      | test/unit/pool.test.ts > M108 account pool request boundaries > preserves single-account behavior, defaults on, explicit off and headless opt-in                        |
| parallel-off            | test/unit/pool.test.ts > M108 account pool request boundaries > preserves single-account behavior, defaults on, explicit off and headless opt-in                        |
| single-account          | test/unit/pool.test.ts > M108 account pool request boundaries > preserves single-account behavior, defaults on, explicit off and headless opt-in                        |
| model-capability        | test/unit/pool.test.ts > M108 account pool request boundaries > skips accounts without the selected model and rechecks model access before sending                      |
| visible-swap            | test/e2e/accounts.e2e.test.ts > M108 fake-only accounts composition > uses only B credentials and headers after A reaches its user cap                                  |
| native-account          | test/unit/pool.test.ts > M108 account-bound replay > drops foreign or unknown native reasoning while retaining text and exact producer identity                         |
| native-provider         | test/unit/pool.test.ts > M108 account-bound replay > drops foreign or unknown native reasoning while retaining text and exact producer identity                         |
| native-origin           | test/unit/pool.test.ts > M108 account-bound replay > drops foreign or unknown native reasoning while retaining text and exact producer identity                         |
| native-model            | test/unit/pool.test.ts > M108 account-bound replay > drops foreign or unknown native reasoning while retaining text and exact producer identity                         |
| unknown-native          | test/unit/pool.test.ts > M108 account-bound replay > drops foreign or unknown native reasoning while retaining text and exact producer identity                         |
| sent-liability          | test/e2e/accounts.e2e.test.ts > M108 fake-only accounts composition > handles a turn and fan-out through per-account 429 and Retry-After without retry dispatch         |
| usd-boundary            | test/unit/pool.test.ts > M108 account pool request boundaries > refuses money precision loss and negative settlements instead of releasing liability                    |
| cold-cache-liability    | test/unit/pool.test.ts > M108 account pool request boundaries > includes the exact cold-cache estimate in both the swap row and the reservation                         |
| negative-cold           | test/unit/pool.test.ts > M108 account pool request boundaries > refuses a negative cold-cache estimate or a dispatch that skipped its final guard                       |
| negative-settlement     | test/unit/pool.test.ts > M108 account pool request boundaries > refuses money precision loss and negative settlements instead of releasing liability                    |
| required-send-guard     | test/unit/pool.test.ts > M108 account pool request boundaries > refuses a negative cold-cache estimate or a dispatch that skipped its final guard                       |
| active-owner            | test/unit/pool.test.ts > M108 account pool request boundaries > rejects duplicate active owners, empty pools, invalid headroom and forbidden products                   |
| account-header          | test/e2e/accounts.e2e.test.ts > M108 fake-only accounts composition > uses only B credentials and headers after A reaches its user cap                                  |
| budget-owner            | test/unit/pool.test.ts > M108 account pool request boundaries > never resets the original shared budget at a swap, and refunds a known nonsend                          |
| bound-request           | test/unit/pool.test.ts > M108 account pool request boundaries > binds the model, estimate and original budget owner across asynchronous admission                       |
| paid-provider           | test/unit/accountPaidConsent.test.ts > M108 account-bound paid use consent > binds Always to workspace, provider, account and price; never reuses legacy feature grants |
| paid-account            | test/unit/accountPaidConsent.test.ts > M108 account-bound paid use consent > binds Always to workspace, provider, account and price; never reuses legacy feature grants |
| paid-price              | test/unit/accountPaidConsent.test.ts > M108 account-bound paid use consent > binds Always to workspace, provider, account and price; never reuses legacy feature grants |
| paid-on                 | test/unit/accountPaidConsent.test.ts > M108 account-bound paid use consent > refuses off, removed accounts or changed tariffs before and after the question             |
| paid-current            | test/unit/accountPaidConsent.test.ts > M108 account-bound paid use consent > refuses a tariff or account that changes during a remembered grant write                   |
| paid-epochs             | test/unit/accountPaidConsent.test.ts > M108 account-bound paid use consent > clears a remembered write before revocation finishes and keeps failed deletion revoked     |
| paid-pending-revokes    | test/unit/accountPaidConsent.test.ts > M108 account-bound paid use consent > keeps consent off until every concurrent revocation has finished                           |
| paid-write-order        | test/unit/accountPaidConsent.test.ts > M108 account-bound paid use consent > clears a remembered write before revocation finishes and keeps failed deletion revoked     |
| paid-revoked-store      | test/unit/accountPaidConsent.test.ts > M108 account-bound paid use consent > clears a remembered write before revocation finishes and keeps failed deletion revoked     |
| paid-first-once         | test/unit/accountPaidConsent.test.ts > M108 account-bound paid use consent > asks once before the first charge per account, with the account, tariff and shared budget  |
| paid-asking             | test/unit/accountPaidConsent.test.ts > M108 account-bound paid use consent > asks again for requiresAsking, Deny or a new window after Allow once                       |
| paid-provider-id        | test/unit/accountPaidConsent.test.ts > M108 account-bound paid use consent > rejects invalid binding data and uses ceiling display for a fractional budget              |
| paid-account-id         | test/unit/accountPaidConsent.test.ts > M108 account-bound paid use consent > rejects invalid binding data and uses ceiling display for a fractional budget              |
| paid-price-required     | test/unit/accountPaidConsent.test.ts > M108 account-bound paid use consent > rejects invalid binding data and uses ceiling display for a fractional budget              |
| paid-budget-nonnegative | test/unit/accountPaidConsent.test.ts > M108 account-bound paid use consent > rejects invalid binding data and uses ceiling display for a fractional budget              |
| paid-budget-displayed   | test/unit/accountPaidConsent.test.ts > M108 account-bound paid use consent > asks once before the first charge per account, with the account, tariff and shared budget  |
| swap-off                | test/unit/pool.test.ts > M108 account pool request boundaries > rechecks removal, policy and settings after a reservation or popup                                      |
| negative-headroom       | test/unit/pool.test.ts > M108 account pool request boundaries > rejects duplicate active owners, empty pools, invalid headroom and forbidden products                   |
| new-vendor-trigger      | test/unit/pool.test.ts > M108 account pool request boundaries > cannot bypass vendor confirmation through a nonsent swap chosen at a user cap                           |

## Named integration bindings

These bindings are required because the dependent implementations are absent
on this base or owned by another lane. Required ports never return an empty
production success.

- **P-M95-PER-REQUEST:** compose `AccountPool.run` at the physical request
  boundary and use K's account-specific guarded lookup/client and credential
  lifetime. Preserve origin, auth/product eligibility and removal/credential
  generations after asynchronous lookups. `canUseModel` must read the selected
  account's scan/capability record for the immutable request's `modelId`.
  Call `beforeSend` synchronously after credential lookup immediately before
  every physical send/retry; a refused fence sends nothing. `check` is the
  preflight hook and does not mark a send. Do not cache a provider-wide
  fallback credential/client or reuse A's headers on B. Existing single-key
  paths keep today's behavior.
- **P-T-M102-JOURNAL:** bind the authoritative exact per-account journal and
  T's evaluator. A claim reader excludes only its owned pending projection;
  already-sent attempts, previous retries, settled and uncertain liabilities
  and request/token counts remain visible. M102 aggregate is absent here.
  Validate numeric compatibility inputs without losing exact liability.
- **P-M106-PACING:** bind account/model-specific headroom and rate snapshots,
  outstanding reservations and captured Retry-After/quota/window information.
  A group/global vendor block contributes no capacity. Do not invent vendor
  frame fields. Keep model capability/tariff validation upstream of estimates;
  unpriced or unbounded work is refused rather than estimated as zero.
- **P-M82-BUDGETS:** `reserve(account, estimate, request)` receives the exact
  augmented cold-cache estimate and immutable original `budgetOwner`, which
  remains the parent conversation for children/candidates/schedules. Bind T's
  budget admission to `check`, retaining the original shared daily and parent
  scope on every account. Install the claim atomically before returning; if
  reservation throws, refund any partial owned claim itself. Retain ambiguous
  sent liability on the account that dispatched it. A swap never resets
  budget ownership or substitutes its account id for the parent.
- **P-M95-REPLAY:** compose `accountReplay` after the captured CAPAUDIT F1
  producer and credential-ownership policy. Stamp provider/account/origin/model
  on native producers; an unknown or changed identity uses the captured
  text-only codec, preserving visible text. Do not infer native/cache sharing
  from group labels. Q-M108 can authorize a same-group exception only after
  a named capture; until then every account change estimates a full cold
  re-read at its verified tariff.
- **P-PAID-ACCOUNT:** create an account/tariff consent instance for the current
  window and workspace. The binding key is core-generated; `readGrants` must
  filter lapsed price/credential grants. Capture credential and price-acceptance
  generations in `isCurrent`, including a current shared-budget check. Recreate
  the quoted binding when `museSpark.paidDailyBudgetUsd` changes so first-charge
  consent names the actual shared budget. Use `paidAccountQuestion` in the
  existing three-choice popup, respect the default-on/explicit-off feature
  gate and tally each charge loudly by account. Headless retains its explicit
  paid flags, hard budget and per-use admission; no popup grants carry into it.
- **P-M96-FANOUT:** bind workers, subagents, best-of-N candidates and schedules
  through the same core with `kind: 'worker'`, a stable opaque worker `owner`
  and the original parent's `budgetOwner`. Admission/reservations feed
  headroom; worker stickiness never moves the main conversation. The team
  pool is absent. ModelApiHost and existing fan-out regions were left untouched
  because their account registry/replay/journal composition is not on this
  base, rather than creating a parallel fake registry or reducing current
  single-model functionality.
- **P-W-POLICY-STORE:** compose one machine-owned private confirmation service
  with the owner/broker lifecycle. Decisions, digests and machine identity
  never enter device offers or bridge inputs. Other windows/processes must
  receive revocation before their final fence. Per-instance write queues
  provide no cross-process lock; use the authoritative broker/store lifecycle.
  Apply the same ownership/epoch propagation to paid grants and settings.
- **P-U-H-POLICY-UI:** panel/native bridges/companion, ACP and terminal supply
  the existing clause dialog via the injected ask port, with original sources,
  dates, the consequence warning, legitimate-account statement and all three
  choices. Render stop/reset/usage-link, shared-group notice, swap/spread and
  cold-cache rows and resolve labels locally. Wire revoke to `revoke` and
  preserve the recovery-first result: ChatGPT pause/Usage/credits/API and
  Muse Code upgrade/wait/PAYG, with a separate D48 PAYG question. Every editor
  uses these core ports; headless only reads local policy grants and enables
  pooling with its explicit flag. CI stdin-key retains its single account.
- **P-W-DOCS-HELP-BUNDLES:** W owns README, CHANGELOG, PLAN, privacy/security,
  ACP/CI/editor docs, settings/commands, the help catalogue/reference (absent
  on this base), lazy providers/models bundle wiring and release gates.
  Publish the default-on actions, fixed budgets, explicit headless policy,
  revocable local confirmations, restrictive terms, recovery-first choices,
  cold-cache estimate, per-account paid billing and current check dates.
  Add help entries for these user-facing behaviors and the U/H commands when
  the catalogue lands. Keep P modules in `dist/providers.js` and add split
  coverage; do not import them into activation/chat startup. W owns the full
  quality/a11y/editor receipts and lane-0 policy-age/quote recheck. Q-M108's
  remaining live facts and D's device relocation are not claimed here.

- **P-W-HOST-API-RECORD:** the host API gate was executed and exited 1 with
  exactly one generated-document difference in
  `docs/ide-compatibility/host-api.md`: the `node:crypto` import count changes
  from **46 to 47**, for the confirmation SHA-256 digest. All enumerated APIs
  otherwise match (332 VS Code APIs, 31 files importing vscode, 25 Node
  built-ins, 61 theme variables). W owns this file; P did not edit it. W must
  run `npm run check:host-api -- --write`, review that count row, then rerun
  the gate during integration. No generated record or gate was weakened.
