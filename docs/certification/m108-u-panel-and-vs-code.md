# M108 U — Panel and VS Code

## FIXM108U2 — RVM108U2 replacement rollback (macmini, 2026-10-06)

The final review reports one P2: an obsolete cancelled Add deletes a
replacement account with the same ID. The two deterministic regressions use
the real AccountStore and two independent store instances. Both fail on the
reviewed source while all 17 existing host tests pass: `preserves a
replacement account and credential when the original addition is pending`
and the `cancelled` variant. The first removes/re-adds while the prompt is
pending. The second cancels A, pauses its rollback, adds B with identical
metadata and only then releases A's late deletion. Red receipt:
`temp/fixm108u2-before.log` (untracked), independently repeated directly in
`temp/fixm108u2-direct-before.log` during the continuation. Repository timeouts and
`--maxWorkers=3`; no filtering or skips.

Continuation base: `beb733fe9` on `m108/u`. Approval source:
`M108U.rig.md`, **"Lead ruling: APPROVED."**

**Lead-authorized cross-lane edit (continuation brief, 2026-10-06):** the
lead accepted K as finished and approved Q-FIXM108U2's minimal AccountStore
change, exactly as proposed in `temp/fixm108u2-proposed.patch`. U's handler
needs an ownership token from add and compare-and-delete inside K's existing
serialized removal. An independent panel check followed by ID-only removal
cannot close this race. The exception covers only that narrow K store change;
K's existing suites must remain green. No merge, push or rebase is authorized.

### Concrete proposal and validation before scope approval

`temp/fixm108u2-proposed.patch` (untracked) is the complete narrow proposal:
successful AccountStore additions return a unique symbol stored with the
account's process-local ownership; removal compares the supplied token inside
the existing mutation queue before metadata lookup or credential deletion,
and clears ownership after successful removal. U's finally passes its own
token. This adds no persisted/public field, dependency, protocol, setting,
text, threshold or gate change. Like K's existing queue/fences, ownership is
process-local; the existing K-M109/W broker integration condition applies.

The proposal was evaluated through scratch-only Vite source transforms with
the repository configuration inherited unchanged. All **19 host tests pass**.
Removing the compare-and-delete guard makes both new interleavings fail while
the 17 existing tests pass; the scratch source is restored byte-exact:
SHA-256 `8e47b21610fafb5505b495c448ce20084ba082b43c63fd64a424c78601b542d9`.
Receipts: `temp/fixm108u2-proposal.log`,
`temp/fixm108u2-proposal-drill.log` and
`temp/fixm108u2-proposal-drill.json`. These are exploratory proposal receipts,
not certification of applied production changes. The applied-source receipts
below supersede those exploratory checks for this repair.

| Check (macmini, direct)                                            | Result before scope approval                                                                                         |
| ------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------- |
| Complete host regressions against reviewed production              | **17 pass, 2 fail**; both confirm replacement deletion                                                               |
| Complete UI/contracts/browser files, three files and three workers | **84 pass**, including all 32 axe scenes; repository timeouts                                                        |
| `npm run typecheck`                                                | All five projects pass                                                                                               |
| Scoped ESLint and Prettier                                         | Pass                                                                                                                 |
| `npm run deadcode` / `npx jscpd`                                   | Pass / 1,202 files, zero clones                                                                                      |
| `node scripts/check-l10n.mjs`                                      | 14 tables, zero problems                                                                                             |
| `npm run build`                                                    | Pass; activation 440.3/600 KiB, Model API 450.1/475, checkpoint 76.9/225, ACP 818.6/850; all existing caps unchanged |
| `npm run check:host-api`                                           | Existing W-owned mismatch only: node:crypto 46 → 48 and Accounts CSS theme-source entry                              |
| `git diff --check`                                                 | Pass                                                                                                                 |

### Authorized applied-source verification

Applied the prepared patch directly to `src/core/providers/accounts.ts` and
`src/host/models/accountsHandler.ts`. Successful adds publish a unique symbol
after metadata storage succeeds; failed adds cannot acquire ownership.
Rollback supplies the original token, and removal checks it inside the shared
mutation queue before metadata reads, revocation or secret deletion. Successful
removal clears ownership. Ordinary removal and cleanup after cancellation or
credential-storage failure still work; duplicate-add failure preserves the
existing account. No persisted/public field, dependency, wire shape, user text,
gate, timeout or paid behavior changes. The shared core serves every editor;
the existing W/H installed-bridge conditions remain.

The additional deterministic queue regression pauses an earlier metadata
mutation, queues removal/re-addition, and only then cancels the original
credential prompt. Rollback joins the queue while the original still owns
the ID. This proves comparison happens after earlier queued mutations settle,
rather than before entering the queue.

Three final direct production-source drills each run the complete 20-test
host file with `--maxWorkers=3` and repository timeouts. Removing the store's
comparison or omitting the handler's token makes **all three replacement
regressions fail** (exit 1, 17 old tests pass). Moving the comparison outside
the queue makes only the queued-replacement regression fail (exit 1, 19 pass).
Each source is restored byte-exact in finally; SHA-256 before and after is
identical:

| Drill                                    | Production source                    | Original = restored SHA-256                                        |
| ---------------------------------------- | ------------------------------------ | ------------------------------------------------------------------ |
| Store ownership comparison removed       | `src/core/providers/accounts.ts`     | `8e47b21610fafb5505b495c448ce20084ba082b43c63fd64a424c78601b542d9` |
| Handler ownership token omitted          | `src/host/models/accountsHandler.ts` | `5e331a057b17edaf78b312de6643f98fa12005179043beac73c53006d9897733` |
| Ownership comparison moved outside queue | `src/core/providers/accounts.ts`     | `8e47b21610fafb5505b495c448ce20084ba082b43c63fd64a424c78601b542d9` |

Final receipts: `temp/fixm108u2-final-drill-store-owner.log`,
`temp/fixm108u2-final-drill-handler-owner.log`,
`temp/fixm108u2-final-drill-queue-owner.log` and
`temp/fixm108u2-final-drills.json` (untracked). The earlier two 19-test drills
are retained under `temp/fixm108u2-direct-drill-*`; they are superseded by
these final three drills. The initial applied run passed **53 tests** across
host, account-store and runtime-store files.

Final verification ran directly on macmini after restorations, using
`npx vitest run <files> --maxWorkers=3` with the repository's default test
timeout, at most three complete files per run, and no skips or filters:

| Lane | Complete files under `test/unit/`                                                    | Result                                                                     |
| ---- | ------------------------------------------------------------------------------------ | -------------------------------------------------------------------------- |
| U    | `accountsPanelHost.test.ts`, `accountsPanel.test.tsx`, `accountsPanel.a11y.test.mjs` | **80 pass**: 20 host, 26 UI and 34 browser checks, including 32 axe scenes |
| U    | `App.test.tsx`, `accounts.test.ts`                                                   | **176 pass**                                                               |
| K    | `accountStore.test.ts`, `accountSecrets.test.ts`, `runtimeAccountStore.test.ts`      | **83 pass**                                                                |
| K    | `redact.test.ts`, `credentialStore.test.ts`, `authService.test.ts`                   | **264 pass**                                                               |
| K    | `scanSecrets.test.ts`, `exportConversation.test.ts`, `problemReportBuilder.test.ts`  | **87 pass**                                                                |

**690 distinct final tests pass: U 256, K 434.** Receipts:
`temp/fixm108u2-final-tests.json` and the five
`temp/fixm108u2-final-<batch>.log` files. After adding the queued-replacement
test and completing its drills, the whole host file passes **20/20** in
`temp/fixm108u2-queue-final-host.log`; this supersedes the earlier 19-test host
result. Other suite files and production source hashes are unchanged.
Existing Vite config and jsdom canvas
notices do not fail assertions. No raised test timeout or exploratory timeout
override was used during this continuation.

| Final direct check (macmini)                            | Result                                                                                                                                                                                                    |
| ------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `npm run typecheck`                                     | All five projects pass                                                                                                                                                                                    |
| Scoped `eslint --max-warnings=0` and `prettier --check` | Pass                                                                                                                                                                                                      |
| `npm run deadcode`                                      | Pass; existing vendor/axe-core configuration hints only                                                                                                                                                   |
| `npx jscpd`                                             | 1,202 files, zero clones                                                                                                                                                                                  |
| `node scripts/check-l10n.mjs`                           | 14 tables, 164 manifest strings, 617 source files, zero problems                                                                                                                                          |
| `npm run build`                                         | Every size/split/host-global gate and 83-package notices check passes                                                                                                                                     |
| `npm run check:host-api`                                | Exit 1, unchanged W-owned generated-record mismatch only: `node:crypto` 46 → 48 and Accounts CSS in the theme-source list; still 332 APIs, 31 VS Code importers, 25 Node built-ins and 61 theme variables |
| `git diff --check`                                      | Pass                                                                                                                                                                                                      |

Receipts: `temp/fixm108u2-direct-checks.json` and corresponding check logs.
After the queue test was added, final unit typecheck, scoped ESLint/Prettier
and the complete host file also pass:
`temp/fixm108u2-queue-final-checks.json`. The duplication gate caught copied
pending-addition setup; the tests now share that setup in `pendingAddition`,
and final `temp/fixm108u2-queue-final-duplication.log` reports zero clones.
The final three drills were rerun with this shared test fixture. Production
source hashes still match all restored drill bytes.
Production activation **440.3/600 KiB**, Model API **450.1/475**, checkpoint
**76.9/225**, ACP **818.6/850**, webview startup **897.5/900** and existing
deferred JS **49.7/50** all pass, with every cap unchanged. The separator-
normalized audit of **37 production metafiles** still finds no AccountStore,
Accounts handler or Accounts UI input in shipped graphs:
`temp/fixm108u2-direct-graph.json`. No aggregate quality/coverage, installed
editor, hosted CI or live receipt is claimed; PLAN §7 retains the bounded-lane
delegation and exact W record update. CHANGELOG's Unreleased entry records
replacement protection. No command, setting or help entry changed.

**FIXM108U2-PROCESS-OWNERSHIP**, PLAN §9: the scope blocker is closed by
the lead's approval and applied fix. The ownership queue, like K's existing
mutation/removal fences, is process-local. The existing K-M109/W parent-owned
broker still must compose cross-process ownership before installed account
surfaces are enabled; no installed-editor or cross-process claim is added.

## FIXM108U — RVM108U repairs (macmini, 2026-10-06)

Repair base `fde11d93`; all four P2 findings are fixed within U's supplied
ports. The review found no P1/P3 findings. No review finding is left as a
residual. Read the complete rig/shared brief and review. No dependency,
credential, paid/live call, network request, merge, rebase, push, hook bypass,
cast escape hatch, timeout override or gate weakening.

| Finding                         | Fixed behavior                                                                                                                                                                                                                                             | Regression                                                                                                                                                                                                                                                                                           | Drill                                                                       |
| ------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------- |
| P2-1 stale provider completions | One request owns the Accounts view until settlement. Each owner has a provider generation and request id; success and rejection must match the current generation. Cleanup releases only that owner. A settled error belongs to the exact displayed slice. | `accountsPanel.test.tsx`: `discards an obsolete reply after leaving and returning to the same provider`; `discards an obsolete rejection and releases only its owned pending request`; `keeps a settled error on its owning displayed slice`                                                         | U1-result, U1-error, U1-cleanup, U1-error-owner                             |
| P2-2 replacement policy answer  | The host issues a UUID plus generation with each question. Strict question/confirm schemas, the dialog and the handler preserve both; the prompt checks both after asynchronous provider lookup. Identical clauses also require fresh acknowledgement.     | `accountsPanelHost.test.ts`: `rejects an answer belonging to a closed question when its replacement quotes another clause`; `keeps delayed answers correlated across the handler provider lookup`. UI: `resets acknowledgement for a new question with the identical clause and echoes its identity` | U2-id, U2-generation, U2-dialog, U2-question-strict                         |
| P2-3 stranded account addition  | After a successful owned metadata add, a finally block removes that account and any partial credential unless credential acquisition succeeds. Duplicate-add failure cannot remove an existing account.                                                    | `accountsPanelHost.test.ts`: `rolls back a cancelled credential addition so the same draft can be retried`; the credential-storage-failure variant; `does not roll back an existing account when a duplicate add fails`                                                                              | U3-rollback                                                                 |
| P2-4 premature recovery notice  | `accountNoticeFor(event, stoppedError)` carries P's authoritative reset in a strict `{ event, resetAt }` display projection. The UI never substitutes `trigger.resetAt`. Without a stop error it says recovery is unknown.                                 | `accountsPanel.test.tsx`: `shows the pool recovery after all account blockers instead of the first trigger reset`, using the real pool and fake journal/limits, including unknown-recovery display                                                                                                   | U4-display, U4-projection, U4-notice-strict, U4-recovery-date, U4-stop-only |

### Regressions before repair

The two complete host/UI test files failed **five named assertions** against
unchanged production: stale same-provider acceptance, stale rejection,
replacement-clause confirmation, stranded metadata, and the pool recovery
notice. The last expected local midnight but received the first trigger's
one-minute reset. A first fixture run used an absent selected account and
failed display validation; corrected the fixture to select `a`, then reran
both complete files to observe the intended recovery assertion. The red
receipt is `temp/fixm108u-before.log` (untracked).

Scoped lint caught synchronous error clearing in a layout effect. The final
implementation instead tags errors with their displayed slice, retaining the
provider-generation fence; no rule was disabled. The regression also revisits
the exact original slice after an obsolete rejection, so hiding an error only
while another provider is displayed cannot disguise stale completion.

### Deliberate red drills on the repaired bytes

**14 final drills:** each runs its complete owning test file, with repository
test timeouts and `--maxWorkers=3`, sees exit 1 and the named assertion, and
restores bytes in finally. SHA-256 is checked after every restoration and
again for all sources before final validation. No timeout flags, filters,
skips or raised budgets. Logs and JSON receipts are untracked under `temp/`.
The earlier exploratory drill pass preceded the lint fix; the final U1 pass
below certifies the final error ownership implementation. These new receipts
supersede original-lane hashes for changed files; the old records below remain
historical evidence.

| Drill              | Owning file                           | Named failing assertion (exit 1)                                                              |
| ------------------ | ------------------------------------- | --------------------------------------------------------------------------------------------- |
| U1-result          | `test/unit/accountsPanel.test.tsx`    | `discards an obsolete reply after leaving and returning to the same provider`                 |
| U1-error           | `test/unit/accountsPanel.test.tsx`    | `discards an obsolete rejection and releases only its owned pending request`                  |
| U1-cleanup         | `test/unit/accountsPanel.test.tsx`    | `discards an obsolete rejection and releases only its owned pending request`                  |
| U1-error-owner     | `test/unit/accountsPanel.test.tsx`    | `keeps a settled error on its owning displayed slice`                                         |
| U2-id              | `test/unit/accountsPanelHost.test.ts` | `keeps delayed answers correlated across the handler provider lookup`                         |
| U2-generation      | `test/unit/accountsPanelHost.test.ts` | `keeps delayed answers correlated across the handler provider lookup`                         |
| U2-dialog          | `test/unit/accountsPanel.test.tsx`    | `resets acknowledgement for a new question with the identical clause and echoes its identity` |
| U3-rollback        | `test/unit/accountsPanelHost.test.ts` | `rolls back a cancelled credential addition so the same draft can be retried`                 |
| U4-display         | `test/unit/accountsPanel.test.tsx`    | `shows the pool recovery after all account blockers instead of the first trigger reset`       |
| U4-projection      | `test/unit/accountsPanel.test.tsx`    | `shows the pool recovery after all account blockers instead of the first trigger reset`       |
| U2-question-strict | `test/unit/accountsPanelHost.test.ts` | `validates question correlation and recovery projections without secret-bearing fields`       |
| U4-notice-strict   | `test/unit/accountsPanelHost.test.ts` | `validates question correlation and recovery projections without secret-bearing fields`       |
| U4-recovery-date   | `test/unit/accountsPanelHost.test.ts` | `validates question correlation and recovery projections without secret-bearing fields`       |
| U4-stop-only       | `test/unit/accountsPanelHost.test.ts` | `validates question correlation and recovery projections without secret-bearing fields`       |

| Repaired source                                                       | Original/restored SHA-256                                          |
| --------------------------------------------------------------------- | ------------------------------------------------------------------ |
| `src/webview/models/sections/accounts/AccountsSection.tsx`            | `b34cdcf984a2ccab007b0c7b58c894543844c9fbc2d2f468c8a9680e9752d59d` |
| `src/host/models/accountPolicyPrompt.ts`                              | `621755ba4b6c2d6f978ac5eb49b69d5c53247479db510a074b56f5e616c749a9` |
| `src/webview/models/sections/accounts/AccountsConfirmationDialog.tsx` | `745fcfa9aaef21efea741ec41e536dbf7c2e13b29b8162a297ca433aee8dceed` |
| `src/host/models/accountsHandler.ts`                                  | `a1b03df63e37596faa88112245d314bc17da12e10e3d5d41bb691948255bb2f7` |
| `src/webview/models/sections/accounts/AccountNotices.tsx`             | `1005cd5628fd495cf96108de36e04cf8992f6820b66d4174bac089e4d753713f` |
| `src/shared/modelsPanel.ts`                                           | `ebc8814a2df09e02ff230a9ca5033d026f3f43b4299d3a8f0d08387e716ed999` |

### Integration conditions and scope

**FIXM108U-INSTALLED-BINDINGS** (also PLAN §9): the base still lacks M95's
installed panel and M104's authenticated transport. W must send the full
`AccountsPolicyQuestion` from `AccountPolicyPrompt.show`, echo its question
UUID and provider generation unchanged through the dialog/handler answer,
serialize modal ownership and close on disposal/revocation. Promise-bound
mutations retain one view owner across provider navigation; transport request
correlation remains M104's responsibility. Use `accountNoticeFor` with the
`AccountPoolStoppedError` from that exact failed admission; a persisted stop
event alone cannot supply recovery. The existing raw `accounts/notice` event
contract is preserved for its other consumers; it is not this display
projection. Swap/spread projections have a null recovery field. No pool,
threshold, credential-store or another lane's file is changed.

Safe for now: these modules remain absent from installed production graphs,
and installed multi-account surfaces are disabled on this base. Follow-up:
W certifies the same interleavings/recovery through VS Code, native and
companion bridges before enabling them; H retains ACP/terminal/headless
bindings. Aggregate quality, coverage, generated host API and documentation
remain the previously named integration work. The host API regeneration must
include U's new `node:crypto` importer as well as P's existing importer and
the account CSS token-source entry. No installed-editor or live receipt is
claimed. No new user text, command or setting was introduced.

W owns README/CHANGELOG/help on this lane; `featureCatalog.ts` and its
reference generator are absent. The corrective Unreleased entry to carry at
integration is: “Pending Accounts operations discard stale provider results
and policy answers, cancelled additions roll back, and stop notices show the
pool's recovery time.” Existing Accounts help content remains the named
M108-U-W-HELP-DOCS handoff below.

### Repair checkpoint validation

The complete host/UI/contract run passed **67/67** with default timeouts.
`npm run typecheck` passed all five projects; the final webview/unit
checks also passed after the lint adjustment. The post-drill host/UI/browser
run passed **77/77**, including all 32 real-browser axe scenes and the lazy
budget/German checks. Broader static/build validation follows before the
final receipt. Scoped ESLint
passed after the error ownership fix. All 14 final drill source hashes match
restored production bytes. The rig brief assigns aggregate quality/full unit
runs to the lead; PLAN §7 records that bounded-lane exception.

### Final repair validation and local commit

Implementation checkpoint `a119fc35c` used normal hooks: scoped ESLint and
Prettier passed, and staged gitleaks scanned 34.57 KB with no leaks. All
14 drill source hashes still match after hooks and final validation. The
worktree has no production fake, dependency/gate/config/limit change or
other-lane source edit.

| Final check (macmini)                                                                                                                      | Result                                                                                                                                                                                                                                                                            |
| ------------------------------------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `npx vitest run test/unit/accountsPanelHost.test.ts test/unit/accountsPanel.test.tsx test/unit/accountsPanel.a11y.test.mjs --maxWorkers=3` | **77 passed**: 17 host, 26 UI, 34 browser/bundle checks. All 32 axe scenes have zero violations/incomplete findings. Repository timeouts.                                                                                                                                         |
| `npx vitest run test/unit/App.test.tsx test/unit/accounts.test.ts --maxWorkers=3`                                                          | **176 passed**: 152 App, 24 account contracts. Existing jsdom canvas notices; no failed assertions. Repository timeouts.                                                                                                                                                          |
| `npm run typecheck` plus final `npm run typecheck:webview` and `npm run typecheck:unit` after the error-state adjustment                   | All five projects pass; final changed projects pass.                                                                                                                                                                                                                              |
| Changed-file `eslint --max-warnings=0`, hook ESLint and `prettier --check`                                                                 | Pass. Hooks also reformatted all staged source/docs without changing the certified guard hashes.                                                                                                                                                                                  |
| `npm run deadcode`                                                                                                                         | Pass; plain knip, existing configuration hints only.                                                                                                                                                                                                                              |
| `npx jscpd`                                                                                                                                | 1,202 files, zero clones.                                                                                                                                                                                                                                                         |
| `node scripts/check-l10n.mjs`                                                                                                              | 14 tables, 164 manifest strings, 617 source files, zero problems.                                                                                                                                                                                                                 |
| `npm run build`                                                                                                                            | Production size/split/host-globals/notices gates pass. All budgets unchanged.                                                                                                                                                                                                     |
| `npm run check:host-api`                                                                                                                   | **Exit 1**, named W integration handoff: regenerate the record's `node:crypto` count **46 → 48** (P plus U) and add Accounts CSS to the theme-source list. Still 332 VS Code APIs, 31 VS Code importers, 25 Node builtins and 61 theme variables. No other changes are requested. |
| `git diff --check` and post-hook drill SHA-256 comparison                                                                                  | Pass.                                                                                                                                                                                                                                                                             |

**253 distinct final tests passed**, with no timeout override, filtering or
skips. Complete owning files were used for every red and green run. The
shared Accounts deferred JS is **20,981 bytes (20.49 KiB) / 25 KiB**. Production
activation **440.3/600 KiB**, Model API **450.1/475**, checkpoint **76.9/225**,
ACP **818.6/850**, webview startup **897.5/900**, existing deferred JS
**49.7/50** all pass. Audit of the actual **37** production metafiles in
`dist/meta/` and `dist/meta-acp/`, with separator normalization, finds no U
Accounts host/UI/display/bridge modules; installed bindings remain disabled
on this base.

The 13 implementation/checkpoint files are PLAN, this certification,
`src/shared/modelsPanel.ts`, `src/shared/hostApi/accounts.ts`,
`src/host/models/accountPolicyPrompt.ts`, `src/host/models/accountsHandler.ts`,
`src/webview/models/sections/accounts/AccountsSection.tsx`,
`AccountsConfirmationDialog.tsx`, `AccountNotices.tsx`,
`test/harness/accounts.mjs`, `test/unit/accountsPanelHost.test.ts`,
`test/unit/accountsPanel.test.tsx` and `test/unit/helpers/accounts/panel.ts`.
The final documentation-only commit adds these validation receipts. W keeps
the generated host API record, public/help docs and integrated full-quality
run; these are integration conditions, not unresolved RVM108U findings.

## Original lane certification

Completed U's bounded implementation on the **macmini** rig, branch `m108/u`,
from `291fc547a`. Read the rig brief, shared Codex rules, AGENTS.md, D88/M108,
`docs/research/account-terms-2026-10-05.md`, the lane-0 policy certification
and K/T/P's contracts and certification. The base lacks M95's registry and
Models & Agents panel, M102's real journal and M104's authenticated bridge.
U supplies explicit required ports, with no production fake or substitute
activation path. Installed integration remains with the named owners below.

Model attempts: **0**. No live wire capture, external network/model/paid call,
credential file, keychain read, new dependency or tool installation. Quotes
come from lane 0's bundled, certified policy rows. All ports and fixtures
keep credential input off the shared page. No gate, cap, rule, ignore,
coverage threshold or timeout was weakened. No cast escape hatch or lint
suppression was added.

## Implemented behavior

- **Accounts section:** validates the local display boundary; add/edit labels,
  stable ids and limit groups; reorder the complete pool; delete only after
  showing the credential deletion/revocation warning. Real K AccountStore
  performs host mutations. A required host credential port is bound to the
  exact provider/account; cancellation or failure must reject. The page has
  no credential input. Provider changes rebuild the forms, even when both
  providers use the same account id, so typed metadata/caps never carry over.
  Uncaptured Muse Code operations are off on the page and host, with an
  explanation; policy reading/revocation stays available.
- **Thresholds:** every day/week/month spend, input token, output token and
  request cap; only captured, capability-supported plan windows and rate
  headroom fields. Hidden window values survive edits. Shared nano-USD helpers
  reject sub-nano or numerically unrepresentable money before the existing
  numeric contract boundary; counts must be nonnegative safe integers.
  Clearing a field clears its cap.
- **Picker and pill:** account selection carries the opaque provider/account
  to P's required request-boundary admission port. Locally resolved labels
  appear in the picker and actual composer model pill via App's injected
  slots. A one-account picker renders nothing; without injected accounts the
  existing chat is unchanged. A removed or not-yet-selected current account
  says No account selected, rather than claiming its capacity is exhausted.
  App imports no accounts implementation.
- **Transcript notices:** validate committed events; filter foreign-provider
  or malformed rows; show the old/new account, reason and exact cold-cache
  estimate, including one nano-USD. Exhausted pools show the known reset time
  or unknown-reset explanation and verified vendor usage link. Spread/usage
  presentation belongs to J.
- **Policy question:** verbatim clause, original HTTPS source, page/check
  dates, stale-row warning, multiple-account restriction, subscription
  recovery and local confirmation scope. Confirm needs the legitimacy
  checkbox; Only at my own caps and Cancel remain available. A changed row
  resets acknowledgement. The existing Modal provides focus trapping and
  Escape/close cancellation. Single-flight latches cover duplicate edits and
  answers. The host checks provider/product, the pending question and the
  current complete policy row; overlap/disposal cancels. P alone owns
  machine-local persistence and final admission authority.
- **Localization:** five new runtime-read labels (`accounts.none`, `id`, `use`,
  `earlier`, `later`) have real translations in all 14 `l10n/ui.*.json` tables.
  Existing account strings cover the remainder. U added no manifest setting
  or command; W owns those contributions and package.nls translations.

## Validation and bundle evidence

All commands ran directly on macmini, with one vitest/tsc/eslint/build at a
time. Every vitest run used the repository default timeout, no filtering,
no skips, at most three files and `--maxWorkers=3`.

| Check                                                                                                                                      | Result                                                                                                     |
| ------------------------------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------- |
| `npx vitest run test/unit/accountsPanelHost.test.ts test/unit/accountsPanel.test.tsx test/unit/accountsPanel.a11y.test.mjs --maxWorkers=3` | 66 passed: 11 host, 21 shared UI, 34 real-browser/bundle checks                                            |
| `npx vitest run test/unit/App.test.tsx test/unit/l10n.test.ts test/unit/hostL10n.test.ts --maxWorkers=3`                                   | 194 passed; existing jsdom canvas notices did not fail assertions                                          |
| `npx vitest run test/unit/l10n.test.ts test/unit/hostL10n.test.ts --maxWorkers=3`                                                          | 42 passed after the final translated label change                                                          |
| `npm run typecheck`                                                                                                                        | All five projects pass                                                                                     |
| Scoped `eslint --max-warnings=0`, `prettier --check` and `stylelint --max-warnings=0`                                                      | Pass on U's changed files                                                                                  |
| `npm run deadcode`                                                                                                                         | Pass; no unused harness/entry/exports                                                                      |
| `npx jscpd`                                                                                                                                | 1202 files, zero clones                                                                                    |
| `node scripts/check-l10n.mjs`                                                                                                              | 14 tables, 164 manifest strings, 617 source files, zero problems                                           |
| `npm run build`                                                                                                                            | Production build, size, split, host-globals and notices pass; caps unchanged                               |
| `npm run check:host-api`                                                                                                                   | Exit 1: W-owned generated record needs the two updates described below; no API or theme-variable additions |
| `git diff --check`                                                                                                                         | Pass                                                                                                       |

The browser suite builds the **real shared lazy accountsEntry** once, uses
one real Chrome instance and scans four scenes (section, thresholds, policy
dialog, swap/stop) at **320 and 690 px in all four captured VS Code themes**:
32 axe scans, zero violations **and zero incomplete findings**, no rule
exclusions, no horizontal overflow. One additional check renders installed
German labels. Non-modal scenes use their full document height at the required
width: a clipped line prevents axe from determining contrast. This retains
all findings instead of excluding them. A real initial dark-theme link
contrast failure was fixed with the existing `--vscode-textLink-foreground`.

The dedicated deferred accounts JS is **20,421 bytes (19.94 KiB) / 25 KiB**.
The graph test traverses static imports and normalizes Windows separators;
all account components remain deferred. Audit of all **37** production
metafiles found no U accounts UI/host/display modules: the installed loader
is W's prerequisite, not a guessed production implementation. Current
production sizes are activation **440.3/600 KiB**, Model API **450.1/475**,
checkpoint **76.9/225**, ACP **818.6/850**, webview startup and static imports
**897.5/900** (base 897.3), existing deferred JS **49.7/50**. Only App's optional
slots and the five English labels enter the existing startup graph. W must
register the new UI under its own 25 KiB budget without raising existing caps.

Representative real-browser dark-theme 320 px fixtures:
[section](m108-u-section.png), [thresholds](m108-u-thresholds.png),
[policy dialog](m108-u-dialog.png), [swap and stop](m108-u-swap.png).
They contain only test metadata and the certified public clause.

## Deliberate red drills

**38 drills:** each mutation ran its complete owned test file, exited 1
with a named assertion failure, and restored the source bytes in `finally`.
The source table records the full original/restored SHA-256. The final green
run follows all restorations. The pending-edit test was strengthened after
a first mutation stayed green because the native disabled fieldset blocked
the second submit: the test now deliberately reenables a stale fieldset,
then proves the independent request latch. The provider-form regression
failed before the fix, passed afterward with metadata/threshold/add drafts
reset, and failed when its key was removed.
The null-selection picker regression failed before the label fix, passed
afterward, and failed again when the wrong capacity label was restored for
a deliberate mutation. Browser budget mutation tightens the fixture's cap to zero only for the drill; no production cap is raised.

| Source | Path                                                                  | Original/restored SHA-256                                          |
| ------ | --------------------------------------------------------------------- | ------------------------------------------------------------------ |
| S1     | `src/shared/modelsPanel.ts`                                           | `9023cd07638fc28bc95cec4189b34babd70d2245e1dd0cec6ebb6dd7026851b5` |
| S2     | `src/host/models/accountsHandler.ts`                                  | `399c8f97417207046d86ad77db2cc4721926b33248b5415c3d3fac8a9294c913` |
| S3     | `src/host/models/accountPolicyPrompt.ts`                              | `980f636b3b8c8c527ab35e10bbfdb58260bfecf571b2677a4ba9c36a5ada6cc3` |
| S4     | `src/webview/models/sections/accounts/AccountsSection.tsx`            | `121bb5fcf4c925c973db0efcab157e840e6d88da7cbf9f7196cc1b8ae332c9bd` |
| S5     | `src/webview/components/AccountChip.tsx`                              | `ac43ad1fcdd4304f08714adfa49496924a7498366f5b1510621a93f30b83945f` |
| S6     | `src/webview/models/sections/accounts/AccountEditor.tsx`              | `a243be09abd337dd0a14bd8e19f59e88205ebc34c1f7c16d8ee77265eba90d57` |
| S7     | `src/webview/models/sections/accounts/ThresholdEditor.tsx`            | `ccbc57ff8af1ea7af5e68233e2c0cc240a09ce9ce742919848b5c2c41f2826bf` |
| S8     | `src/webview/models/sections/accounts/AccountNotices.tsx`             | `3526290f6bdaa8be03dec8a386e0b1fffeea685e17e8e1b182bba64d7f518ec6` |
| S9     | `src/webview/models/sections/accounts/AccountsConfirmationDialog.tsx` | `b3d8691584fd287e2c2283e9ae828a21ab006c91576caa244de0ba9ed3857879` |
| S10    | `src/webview/App.tsx`                                                 | `6079d82a205e18f45d187e7a1d3e6bb4b32400e26ce10bbd67b02f5fd812ea84` |
| S11    | `test/harness/accounts.mjs`                                           | `3bcc1d83a5ab6b5ed0a06eeb22cdcbc190ea2edc92a6f7c2ae60e75905727951` |
| S12    | `test/unit/accountsPanel.a11y.test.mjs`                               | `97a269838ebcc38be54ee1f688ac3815afbf24ef048795d5755216ded113e65d` |
| S13    | `src/webview/models/sections/accounts/accounts.css`                   | `179fd427eb34ea0452adc477f48c70e9f2c5e12454e241ce19ff00e8e4017cba` |

### Host guards

| Mutation                                                  | Source | Named failing assertion (exit 1)                                                                                                                        |
| --------------------------------------------------------- | ------ | ------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `slice-strict`: allow unknown display fields              | S1     | test/unit/accountsPanelHost.test.ts > M108 panel host > validates every display boundary including URLs and current account                             |
| `slice-member`: accept a selected nonmember               | S1     | test/unit/accountsPanelHost.test.ts > M108 panel host > validates every display boundary including URLs and current account                             |
| `slice-url`: permit insecure/credential-bearing URLs      | S1     | test/unit/accountsPanelHost.test.ts > M108 panel host > validates every display boundary including URLs and current account                             |
| `host-request`: normalize a forged secret-bearing request | S2     | test/unit/accountsPanelHost.test.ts > M108 panel host > rejects secret-bearing or forged bridge requests before any mutation                            |
| `host-membership`: remove selected-member check           | S2     | test/unit/accountsPanelHost.test.ts > M108 panel host > selects only a member through the boundary admission port                                       |
| `host-capture`: remove uncaptured Muse Code guard         | S2     | test/unit/accountsPanelHost.test.ts > M108 panel host > keeps uncaptured Muse Code metadata mutations off as well as credentials                        |
| `host-eligibility`: remove credential/product eligibility | S2     | test/unit/accountsPanelHost.test.ts > M108 panel host > refuses unavailable credential selection for claude-plan                                        |
| `host-issued-question`: accept an unissued answer         | S2     | test/unit/accountsPanelHost.test.ts > M108 panel host > rejects secret-bearing or forged bridge requests before any mutation                            |
| `host-revoke-product`: revoke another product             | S2     | test/unit/accountsPanelHost.test.ts > M108 panel host > rejects secret-bearing or forged bridge requests before any mutation                            |
| `host-error-scrub`: return raw adapter error text         | S2     | test/unit/accountsPanelHost.test.ts > M108 panel host > returns fixed errors without leaking adapter text                                               |
| `prompt-schema`: normalize a secret-bearing answer        | S3     | test/unit/accountsPanelHost.test.ts > M108 host-issued policy dialog > quotes the actual row and only accepts the matching pending provider and product |
| `prompt-provider`: ignore question provider               | S3     | test/unit/accountsPanelHost.test.ts > M108 host-issued policy dialog > quotes the actual row and only accepts the matching pending provider and product |
| `prompt-product`: ignore question product                 | S3     | test/unit/accountsPanelHost.test.ts > M108 host-issued policy dialog > quotes the actual row and only accepts the matching pending provider and product |
| `prompt-current-row`: ignore changed policy               | S3     | test/unit/accountsPanelHost.test.ts > M108 host-issued policy dialog > discards a changed row and cancels on disposal or overlapping questions          |
| `prompt-overlap`: grant overlap                           | S3     | test/unit/accountsPanelHost.test.ts > M108 host-issued policy dialog > discards a changed row and cancels on disposal or overlapping questions          |
| `prompt-close`: grant on disposal                         | S3     | test/unit/accountsPanelHost.test.ts > M108 host-issued policy dialog > discards a changed row and cancels on disposal or overlapping questions          |

### UI guards

| Mutation                                                             | Source | Named failing assertion (exit 1)                                                                                                                                             |
| -------------------------------------------------------------------- | ------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `ui-edit-provider`: retain typed fields across a provider change     | S4     | test/unit/accountsPanel.test.tsx > M108 Accounts section > resets edit fields when two providers use the same account id                                                     |
| `ui-null-selection`: describe absent selection as exhausted headroom | S5     | test/unit/accountsPanel.test.tsx > M108 picker, transcript and policy question > leaves the single-account pill unchanged and names both accounts in the picker              |
| `ui-pending-mutation`: remove edit latch                             | S4     | test/unit/accountsPanel.test.tsx > M108 Accounts section > allows one pending mutation despite stale enabled form controls                                                   |
| `ui-muse-capture`: enable uncaptured Muse Code                       | S4     | test/unit/accountsPanel.test.tsx > M108 Accounts section > refuses credential selection and addition without a captured or offered product                                   |
| `ui-current-provider`: adopt stale-provider reply                    | S4     | test/unit/accountsPanel.test.tsx > M108 Accounts section > does not adopt an old reply after the selected provider changes                                                   |
| `ui-reply-provider`: accept cross-provider reply                     | S4     | test/unit/accountsPanel.test.tsx > M108 Accounts section > rejects invalid input before sending and refuses malformed or cross-provider replies                              |
| `ui-remove-confirm`: delete before warning                           | S4     | test/unit/accountsPanel.test.tsx > M108 Accounts section > edits labels, changes pool order and confirms destructive removal                                                 |
| `ui-id-validation`: silently normalize invalid id                    | S6     | test/unit/accountsPanel.test.tsx > M108 Accounts section > rejects invalid input before sending and refuses malformed or cross-provider replies                              |
| `ui-exact-usd`: remove exact USD check                               | S7     | test/unit/accountsPanel.test.tsx > M108 threshold editor > refuses inexact or invalid USD 0.0000000001 without sending                                                       |
| `ui-hidden-window`: drop unsupported stored windows                  | S7     | test/unit/accountsPanel.test.tsx > M108 threshold editor > edits every period and supported window, preserves hidden capability values and exact money                       |
| `ui-single-account`: show single-account picker                      | S5     | test/unit/accountsPanel.test.tsx > M108 picker, transcript and policy question > leaves the single-account pill unchanged and names both accounts in the picker              |
| `ui-held-credential`: enable editor-owned credentials                | S5     | test/unit/accountsPanel.test.tsx > M108 picker, transcript and policy question > disables account switching for products whose credentials are not held                      |
| `ui-notice-provider`: show foreign-provider event                    | S8     | test/unit/accountsPanel.test.tsx > M108 picker, transcript and policy question > shows the swap reason, exact cold-cache estimate and stop reset/link without foreign events |
| `ui-silent-swap`: remove swap explanation                            | S8     | test/unit/accountsPanel.test.tsx > M108 picker, transcript and policy question > shows the swap reason, exact cold-cache estimate and stop reset/link without foreign events |
| `ui-cold-cache`: erase cold-cache cost                               | S8     | test/unit/accountsPanel.test.tsx > M108 picker, transcript and policy question > shows the swap reason, exact cold-cache estimate and stop reset/link without foreign events |
| `ui-current-question`: retain acknowledgement after clause change    | S9     | test/unit/accountsPanel.test.tsx > M108 picker, transcript and policy question > asks again when the quoted row changes and supports Only at my own caps                     |
| `ui-acknowledgement`: enable unacknowledged Confirm                  | S9     | test/unit/accountsPanel.test.tsx > M108 picker, transcript and policy question > asks again when the quoted row changes and supports Only at my own caps                     |
| `ui-pending-answer`: remove answer latch                             | S9     | test/unit/accountsPanel.test.tsx > M108 picker, transcript and policy question > keeps an in-flight confirmation from accepting a second answer                              |
| `ui-model-pill`: omit account from model pill                        | S10    | test/unit/accountsPanel.test.tsx > M108 picker, transcript and policy question > injects account pill and transcript nodes into the shared chat                              |

### Browser gates

| Mutation                                              | Source | Named failing assertion (exit 1)                                                                                                              |
| ----------------------------------------------------- | ------ | --------------------------------------------------------------------------------------------------------------------------------------------- |
| `browser-lazy`: statically import the account section | S11    | test/unit/accountsPanel.a11y.test.mjs > M108 accounts accessibility and lazy budget > loads all account UI in a dedicated chunk within 25 KiB |
| `browser-budget`: tighten deferred budget to zero     | S12    | test/unit/accountsPanel.a11y.test.mjs > M108 accounts accessibility and lazy budget > loads all account UI in a dedicated chunk within 25 KiB |
| `browser-contrast`: restore inaccessible blue links   | S13    | test/unit/accountsPanel.a11y.test.mjs > M108 accounts accessibility and lazy budget > dark section at 320px passes axe and fits the panel     |

## Required integration bindings

- **M108-U-M95-MODELS:** mount AccountsSection with the authenticated
  AccountsSectionPort; refresh the provider slice after mutations, committed
  selection/events and a completed policy decision. Load accountsEntry on
  first Models & Agents or multi-account use. Resolve labels locally; expose
  only captured selected-model/provider capabilities and verified usage URLs.
  Supply App's picker/transcript nodes and a `provider · account` label only
  for multi-account chat. Leave the single-model setup's current behavior.
- **M108-U-P-BOUNDARY:** bind handler.use to P's admission and atomic
  account/event transaction, not a UI assignment. Feed committed swap/stop
  events to AccountNotices and the active account to AccountChip. Keep the
  shared budgets, cold-cache reservation, uncertain liability and per-account
  first-charge D48 consent in P. Bind one profile AccountConfirmations owner.
- **M108-U-M104-PROMPT:** authenticate and permission-check correlated
  request/reply/question envelopes; bind P's ask to AccountPolicyPrompt and
  the shared dialog. Serialize surface modals, make the background inert,
  close on disposal/revocation, and refresh after P persists its decision.
  An answer belongs to a host-issued question, never page authority. Reuse
  this React entry and injected handlers through VS Code, JetBrains, Visual
  Studio, Eclipse and companion bridges. H owns ACP/terminal/headless surfaces;
  their policy authority remains the same P owner, with no UI-only grants.
- **M108-U-M-CAPTURE:** enable Muse Code account operations only after M's
  real CLI home/sign-in/serve capture and adapter are certified. Both U guards
  currently refuse those operations; U invents no credential file or wire.
- **M108-U-W-BUNDLE:** register the real installed lazy loader, dedicated
  25 KiB accounts UI JS size/split checks and ordinary harness/a11y entry. Load
  its JS and stylesheet on first account use, keeping accounts.css outside
  startup main.css. Existing startup/deferred caps stay unchanged. The local browser suite independently
  proves the shared entry's lazy graph and size before that binding exists.
- **M108-U-W-HOST-API:** regenerate `docs/ide-compatibility/host-api.md`:
  existing P `node:crypto` import count **46 → 47**, and append
  `src/webview/models/sections/accounts/accounts.css` to theme-token source
  files. The check still counts 332 APIs, 31 VS Code importers, 25 Node builtins
  and 61 theme variables; these totals are unchanged. U did not edit W's file.
- **M108-U-W-HELP-DOCS:** featureCatalog.ts is absent on this base. Add help
  entries for Accounts, add/edit/remove/order/groups, thresholds, account
  picker/pill, swap/stop notices, policy confirmation/revocation and the
  default-on accountSwap/accountParallel settings. W owns manifest and all
  package.nls translations, README, CHANGELOG, privacy/security/editor docs,
  PLAN status and joined-tree full quality certification. No undocumented
  installed command was introduced by U.

The rig brief overrides shared older merge/remote instructions: no merge,
push, rebase or stash. It explicitly prohibits the full quality/full unit
run; the lead owns joined-tree certification. Local commits use explicit
paths and normal hooks. `.husky/_/pre-commit` existed before the checkpoint
commit `6db887168ffa03da4a1fb6182af10c4d9d73ece8`; lint-staged's ESLint/Prettier
and staged gitleaks ran successfully. All remaining live Q-M108 receipts,
installed editor adapters and cross-lane bindings stay with their named owners.

The UI/harness commit `0dfa1bd4ebaa4872012d3905e5149f1c8f097060` also used normal hooks:
ESLint, Prettier and Stylelint passed; staged gitleaks scanned 95.24 KB and
found no leaks. After the hooks, all 38 original/restored guard hashes still
matched the committed bytes. The final certification-only commit records
that evidence and the explicit first-use stylesheet binding.
