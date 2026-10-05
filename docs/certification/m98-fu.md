# M98 FU — uses and fences (2026-10-05, macmini)

Branch `m98/fu`, base `3e192331` (P0); worktree
`/Users/randy/lanes/M98FU`. Read the rig brief and shared `codex/common.md`,
AGENTS, PLAN D77 and M98 (including ownership, ordering, acceptance and
security), M98 research, P0/planning/J/0 receipts and RVM98/RVM98C/RVM98J
reports. The explicit rig brief authorizes pure fixtures on this incomplete
phase-1 base. It prohibits merges, rebases, pushes and paid/live calls.

## Implemented scope and seams

- `src/core/judge/uses/definitions.ts` defines skill and custom-agent
  suggestions, context relevance, semantic grading, orchestration hints,
  review signals, CI flake triage, lane-diff pre-screen and review-class
  ordering. Each use independently requires a verified source, a B profile
  bound to every P0 identity field, its own paired M75 receipt and borrowed
  golden receipt. Context additionally requires no-loss evidence; missing
  M96 refuses orchestration. Explicit modes cannot bypass these gates.
- These receipts are **validated evidence supplied by B/Z**, not user
  configuration or proof from a nonempty filename. FU does not fit profiles,
  certify model accuracy or manufacture adoption records. All real uses
  stay inactive on this base. Synthetic identities/receipts live only in
  `test/**`. Family/type/effect definitions are internal metadata, never
  model wording or user-facing strings.
- Capability checks read the exact selected source/provider/model/version/
  endpoint record. Stated and SystemOne require their respective captured
  support; logprob requires top-k capacity for every alternative. Top-1,
  dropped/refused/unknown logprobs never supply a full distribution. D/A/I
  techniques remain explicitly unavailable until their eligibility is wired.
- `advice.ts` validates injected outcomes with P0's zod schema, alignment,
  complete calibrated metadata, profile/model/source/technique binding and
  normalized distributions. It recomputes entropy, checks winning choices,
  score legends/expected values and binary consistency. Safe, unsure,
  malformed, failed and partial output is no opinion. Advice has no action,
  verifier, context-filter, retry, merge or permission API.
- `appendJudgeHint` can append one caller-prewritten, redacted line to a
  request tail. It accepts no history, cached prefix or skill index. This
  helper is **not wired into sendTurn/history**: Z must supply an ephemeral
  tail on the owning request builder and extend M91-G's existing raw goldens,
  including redaction-before-prefix-reuse. The string-level fixtures prove
  tail preservation only; no independent HTTP/MSP golden baseline is created.
- `fences.ts` refuses judging immediate/native allows without injected M91
  capture or separately measured deadline evidence plus a paired M75
  receipt. `readJudgeAtDeadline` uses the existing generation-bound entry
  store, pre/post-wait owner/action/policy checks, a hard timer and a wall-clock
  cutoff, cancellation, consuming reads and late discard. Unknown/missing injected signals are
  validated to no opinion rather than becoming a verdict. Its `run` callback
  must use the normally admitted runtime; this is not a second ledger or
  scheduler. No actual pre-execution hook or guessed hook wire is installed.
- `src/host/judge/uses.ts` consumes P0's `JudgeRuntime`, an injected certified
  policy, redactor, model question and a binding object replaced on every
  owner/source/policy/generation change (including change-back). It sends a
  bounded, redacted standalone request. The real runtime still owns current
  consent, confidentiality, model selection, source availability, per-attempt
  durable D78 admission/settlement, price and usage accounting.
- `ConversationDeps.judgeUses` and `ReviewedApprovalsDeps.judgeUses` are
  optional **type-only imports**. The conversation forwards the injection
  only to its extension-held Muse Code reviewer. Starts run beside the
  independent reviewer; the existing fence synchronously reads once. A ready
  caution sends the reviewer's ALLOW to the ordinary card; pending/failed/safe
  output preserves the verdict. Judge data never reaches the ALLOW parser.
  Replacement, resolution, changed subject, release/reset and forget discard
  held latches. Injection failures leave the independent reviewer intact.
  Existing immediate/native allows have no new call site and no new charge.

No source, capability registry, key store, paid modal, context builder,
M96 scheduler, M91 hook, bridge message or production fake is added. There
are no new dependencies, casts, suppressions, tunable defaults or UI/model
strings. Consequently P0's English/14 translated UI tables/manifest tables
are untouched. Owner policy remains default-on enhancements for the chosen
setup, first-charge three-choice consent with price/shared daily budget,
free-to-paid re-consent and unchanged single-model behavior.

The M90 capture-backed approval fixtures reuse `stageRaceCapture` and
`mapNotification`; no external response parser or uncaptured field is added.
The hidden-session tool-item residual stays as documented by phase 1: these
fixtures do not prove the CLI ran no tool.

## Guard-fire evidence

Every recorded drill ran the **whole owning file**, directly on macmini:
`npx vitest run <file> --maxWorkers=3 --testTimeout=120000`. Mutations touched
only FU-owned source/regions, never another lane's entry store or wire parser.
The driver saved original bytes, restored them in `finally`, compared the
full SHA-256, and reran that owning file green before the next mutation.
All 94 recorded controls have red exit 1, their named failed assertion,
SHA equality, and green exit 0. No test-name filters or skipped tests.

One initial model-mismatch mutation stayed green: result/model equality
independently rejected the fixture. Added the case where both result and
metadata model names change, then observed the intended identity guard fail.
This initial green control is not counted as a proven drill. Choice/score
three-alternative controls additionally prevent a hardcoded binary capacity.

Pre/post source SHA-256 (unchanged throughout the completed controls):

- `src/core/judge/uses/definitions.ts`: `1dbf747264c90918488f1503599c09c165de9e04e3b4198c1693717f944452cd`.
- `src/core/judge/uses/advice.ts`: `0897e2163b5d493499fb34eb25e99464464ce80f3f2fa73b3f3955683d4b2b8e`.
- `src/core/judge/uses/fences.ts`: `5dad71a8fbfde9162382183522227cf6ea3599532d13b9464dcf1b8e3dddce23`.
- `src/host/judge/uses.ts`: `77fa718ac71acca4658078affd77a00301fc41563db0bfe4328097fd0faa4f08`.
- `src/host/review/reviewedApprovals.ts`: `b335159d841e416bce73de2ee63c8996e8ac658b3a7d945b613c88c053d90a39`.

Owning files: U = `judgeUses.test.ts`; F = `judgeFences.test.ts`; R =
`judgeUsesReview.test.ts`, all under `test/unit/`.

| #   | Deliberate break                                                                         | Named failed test                                                                                 | Owner | Restore / rerun          |
| --- | ---------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------- | ----- | ------------------------ |
| 1   | explicit off                                                                             | requires nonempty M75, borrowed golden and calibrated profile receipts separately                 | U     | SHA OK; whole file green |
| 2   | require pairedM75Receipt                                                                 | requires nonempty M75, borrowed golden and calibrated profile receipts separately                 | U     | SHA OK; whole file green |
| 3   | require borrowedGoldenReceipt                                                            | requires nonempty M75, borrowed golden and calibrated profile receipts separately                 | U     | SHA OK; whole file green |
| 4   | require profileId                                                                        | requires nonempty M75, borrowed golden and calibrated profile receipts separately                 | U     | SHA OK; whole file green |
| 5   | paired evidence required                                                                 | defines every planned use and keeps all off without paired evidence                               | U     | SHA OK; whole file green |
| 6   | use receipt binding                                                                      | binds each receipt to its use and every profile field                                             | U     | SHA OK; whole file green |
| 7   | every profile identity field                                                             | binds each receipt to its use and every profile field                                             | U     | SHA OK; whole file green |
| 8   | family binding                                                                           | binds each receipt to its use and every profile field                                             | U     | SHA OK; whole file green |
| 9   | threshold !Number.isFinite(evidence.threshold)                                           | binds each receipt to its use and every profile field                                             | U     | SHA OK; whole file green |
| 10  | threshold evidence.threshold <= 0                                                        | binds each receipt to its use and every profile field                                             | U     | SHA OK; whole file green |
| 11  | threshold evidence.threshold > 1                                                         | binds each receipt to its use and every profile field                                             | U     | SHA OK; whole file green |
| 12  | capability binding source                                                                | uses the selected model capability rather than its vendor name                                    | U     | SHA OK; whole file green |
| 13  | capability binding providerId                                                            | uses the selected model capability rather than its vendor name                                    | U     | SHA OK; whole file green |
| 14  | capability binding model                                                                 | uses the selected model capability rather than its vendor name                                    | U     | SHA OK; whole file green |
| 15  | capability binding modelVersion                                                          | uses the selected model capability rather than its vendor name                                    | U     | SHA OK; whole file green |
| 16  | capability binding endpoint                                                              | uses the selected model capability rather than its vendor name                                    | U     | SHA OK; whole file green |
| 17  | verified source                                                                          | requires nonempty M75, borrowed golden and calibrated profile receipts separately                 | U     | SHA OK; whole file green |
| 18  | context no loss                                                                          | requires context no-loss evidence and M96 before orchestration hints                              | U     | SHA OK; whole file green |
| 19  | M96 required                                                                             | requires context no-loss evidence and M96 before orchestration hints                              | U     | SHA OK; whole file green |
| 20  | question kind capability                                                                 | uses the selected model capability rather than its vendor name                                    | U     | SHA OK; whole file green |
| 21  | stated capability                                                                        | uses the selected model capability rather than its vendor name                                    | U     | SHA OK; whole file green |
| 22  | SystemOne capability                                                                     | uses the selected model capability rather than its vendor name                                    | U     | SHA OK; whole file green |
| 23  | top-k capacity and top-1 exclusion                                                       | uses the selected model capability rather than its vendor name                                    | U     | SHA OK; whole file green |
| 24  | unmeasured technique unavailable                                                         | uses the selected model capability rather than its vendor name                                    | U     | SHA OK; whole file green |
| 25  | no granting advice shape                                                                 | grading, relevance and testing signals never replace verifiers or drop context                    | U     | SHA OK; whole file green |
| 26  | use admission before advice                                                              | safe, unsure, failed, empty and malformed answers leave rules unchanged                           | U     | SHA OK; whole file green |
| 27  | validated output                                                                         | safe, unsure, failed, empty and malformed answers leave rules unchanged                           | U     | SHA OK; whole file green |
| 28  | no-answer is no opinion                                                                  | safe, unsure, failed, empty and malformed answers leave rules unchanged                           | U     | SHA OK; whole file green |
| 29  | single request question                                                                  | rejects missing, extra, misaligned or inconsistent answers                                        | U     | SHA OK; whole file green |
| 30  | single result answer                                                                     | refuses empty, multiple and missing request answers even when the output schema is valid          | U     | SHA OK; whole file green |
| 31  | result meta.partial                                                                      | rejects partial, uncalibrated, approximate and stale source/profile metadata                      | U     | SHA OK; whole file green |
| 32  | result meta.label === 'uncalibrated'                                                     | rejects partial, uncalibrated, approximate and stale source/profile metadata                      | U     | SHA OK; whole file green |
| 33  | result meta.label === 'approximate (top-1)'                                              | rejects partial, uncalibrated, approximate and stale source/profile metadata                      | U     | SHA OK; whole file green |
| 34  | result meta.profileId !== evidence.profileId                                             | rejects partial, uncalibrated, approximate and stale source/profile metadata                      | U     | SHA OK; whole file green |
| 35  | result meta.model !== evidence.identity.model                                            | rejects partial, uncalibrated, approximate and stale source/profile metadata                      | U     | SHA OK; whole file green |
| 36  | result result.model !== meta.model                                                       | rejects partial, uncalibrated, approximate and stale source/profile metadata                      | U     | SHA OK; whole file green |
| 37  | result meta.source !== evidence.identity.source                                          | rejects partial, uncalibrated, approximate and stale source/profile metadata                      | U     | SHA OK; whole file green |
| 38  | result meta.technique !== evidence.identity.technique                                    | rejects partial, uncalibrated, approximate and stale source/profile metadata                      | U     | SHA OK; whole file green |
| 39  | aligned answer type                                                                      | rejects missing, extra, misaligned or inconsistent answers                                        | U     | SHA OK; whole file green |
| 40  | result confidence threshold                                                              | rejects partial, uncalibrated, approximate and stale source/profile metadata                      | U     | SHA OK; whole file green |
| 41  | normalized probability mass                                                              | rejects missing, extra, misaligned or inconsistent answers                                        | U     | SHA OK; whole file green |
| 42  | complete alternative count                                                               | recomputes entropy and refuses wrong probability keys, nonwinning choices and inconsistent scores | U     | SHA OK; whole file green |
| 43  | offered alternatives only                                                                | recomputes entropy and refuses wrong probability keys, nonwinning choices and inconsistent scores | U     | SHA OK; whole file green |
| 44  | recomputed entropy                                                                       | recomputes entropy and refuses wrong probability keys, nonwinning choices and inconsistent scores | U     | SHA OK; whole file green |
| 45  | winning offered choice                                                                   | recomputes entropy and refuses wrong probability keys, nonwinning choices and inconsistent scores | U     | SHA OK; whole file green |
| 46  | score legend and expected value                                                          | recomputes entropy and refuses wrong probability keys, nonwinning choices and inconsistent scores | U     | SHA OK; whole file green |
| 47  | binary answer consistency                                                                | rejects missing, extra, misaligned or inconsistent answers                                        | U     | SHA OK; whole file green |
| 48  | safe binary is no opinion                                                                | safe, unsure, failed, empty and malformed answers leave rules unchanged                           | U     | SHA OK; whole file green |
| 49  | hints cannot replace no-hint tail                                                        | adds at most one redacted hint at the tail without touching history or the skill index            | U     | SHA OK; whole file green |
| 50  | hint-only effect                                                                         | grading, relevance and testing signals never replace verifiers or drop context                    | U     | SHA OK; whole file green |
| 51  | hint redaction                                                                           | adds at most one redacted hint at the tail without touching history or the skill index            | U     | SHA OK; whole file green |
| 52  | nonempty hint                                                                            | adds at most one redacted hint at the tail without touching history or the skill index            | U     | SHA OK; whole file green |
| 53  | one-line hint                                                                            | adds at most one redacted hint at the tail without touching history or the skill index            | U     | SHA OK; whole file green |
| 54  | fence proof evidence.receipt.trim() !== ''                                               | requires capture/measurement, paired evidence and a valid bounded deadline                        | F     | SHA OK; whole file green |
| 55  | fence proof evidence.pairedM75Receipt.trim() !== ''                                      | requires capture/measurement, paired evidence and a valid bounded deadline                        | F     | SHA OK; whole file green |
| 56  | fence proof Number.isSafeInteger(evidence.deadlineMs)                                    | requires capture/measurement, paired evidence and a valid bounded deadline                        | F     | SHA OK; whole file green |
| 57  | fence proof evidence.deadlineMs > 0                                                      | requires capture/measurement, paired evidence and a valid bounded deadline                        | F     | SHA OK; whole file green |
| 58  | fence proof evidence.deadlineMs <= JUDGE_REQUEST_TIMEOUT_MS                              | requires capture/measurement, paired evidence and a valid bounded deadline                        | F     | SHA OK; whole file green |
| 59  | immediate/native require proof                                                           | leaves immediate and native allows unjudged and uncharged without certified fences                | F     | SHA OK; whole file green |
| 60  | hard deadline timer                                                                      | enforces the hard deadline when a source never resolves or ignores cancellation                   | F     | SHA OK; whole file green |
| 61  | wall-clock deadline                                                                      | refuses a result at the deadline even before the timer callback runs                              | F     | SHA OK; whole file green |
| 62  | pre-dispatch cancellation                                                                | cancels before dispatch and while held without waiting for the source                             | F     | SHA OK; whole file green |
| 63  | pre-dispatch binding                                                                     | checks action/owner/policy binding before and after the wait                                      | F     | SHA OK; whole file green |
| 64  | post-wait binding                                                                        | checks action/owner/policy binding before and after the wait                                      | F     | SHA OK; whole file green |
| 65  | cancellation listener                                                                    | cancels before dispatch and while held without waiting for the source                             | F     | SHA OK; whole file green |
| 66  | timer cleanup                                                                            | reads a timely caution once and cleans its timer                                                  | F     | SHA OK; whole file green |
| 67  | abort source at fence                                                                    | enforces the hard deadline when a source never resolves or ignores cancellation                   | F     | SHA OK; whole file green |
| 68  | discard pending at fence                                                                 | enforces the hard deadline when a source never resolves or ignores cancellation                   | F     | SHA OK; whole file green |
| 69  | generation-bound latch                                                                   | cannot resurrect a discarded generation when the identical action restarts                        | F     | SHA OK; whole file green |
| 70  | redacted standalone state                                                                | a ready caution returns ALLOW to the normal card without changing the reviewer input              | R     | SHA OK; whole file green |
| 71  | initial abort/use/mode                                                                   | refuses aborted, wrong-use and oversized inputs before a source call                              | R     | SHA OK; whole file green |
| 72  | bounded request before dispatch                                                          | refuses aborted, wrong-use and oversized inputs before a source call                              | R     | SHA OK; whole file green |
| 73  | adoption before source dispatch                                                          | missing adoption evidence or off mode dispatches nothing and leaves ALLOW unchanged               | R     | SHA OK; whole file green |
| 74  | settlement binding                                                                       | rebinding drops ready results as well as results arriving after a source/owner change             | R     | SHA OK; whole file green |
| 75  | ready fence binding                                                                      | rebinding drops ready results as well as results arriving after a source/owner change             | R     | SHA OK; whole file green |
| 76  | held current.evidence?.profileId === admission.evidence.profileId                        | rechecks evidence and mode at the fence after an answer is ready                                  | R     | SHA OK; whole file green |
| 77  | held current.evidence.pairedM75Receipt === admission.evidence.pairedM75Receipt           | rechecks evidence and mode at the fence after an answer is ready                                  | R     | SHA OK; whole file green |
| 78  | held current.evidence.borrowedGoldenReceipt === admission.evidence.borrowedGoldenReceipt | rechecks evidence and mode at the fence after an answer is ready                                  | R     | SHA OK; whole file green |
| 79  | held current.evidence.threshold === admission.evidence.threshold                         | rechecks evidence and mode at the fence after an answer is ready                                  | R     | SHA OK; whole file green |
| 80  | safe source does not caution                                                             | a safe or failed judge leaves the reviewer ALLOW unchanged                                        | R     | SHA OK; whole file green |
| 81  | consuming generation read                                                                | keeps an identical restarted action safe from the previous callback                               | R     | SHA OK; whole file green |
| 82  | failed policy read no opinion                                                            | a failed policy read discards a ready latch as no opinion                                         | R     | SHA OK; whole file green |
| 83  | ready caution cannot allow                                                               | a ready caution returns ALLOW to the normal card without changing the reviewer input              | R     | SHA OK; whole file green |
| 84  | phase-1 fence never awaits                                                               | a fast reviewer never waits for a delayed judge and drops its late answer                         | R     | SHA OK; whole file green |
| 85  | start failure independent reviewer                                                       | a throwing start seam cannot prevent the independent reviewer from answering                      | R     | SHA OK; whole file green |
| 86  | latch failure independent reviewer                                                       | a failed latch read cannot prevent the reviewer from answering                                    | R     | SHA OK; whole file green |
| 87  | replacement latch discard                                                                | replacement holds explicitly discard the prior caution latch                                      | R     | SHA OK; whole file green |
| 88  | subject latch discard                                                                    | every lifecycle exit explicitly discards an injected latch                                        | R     | SHA OK; whole file green |
| 89  | resolution latch discard                                                                 | every lifecycle exit explicitly discards an injected latch                                        | R     | SHA OK; whole file green |
| 90  | release latch discard                                                                    | every lifecycle exit explicitly discards an injected latch                                        | R     | SHA OK; whole file green |
| 91  | forget latch discard                                                                     | every lifecycle exit explicitly discards an injected latch                                        | R     | SHA OK; whole file green |
| 92  | choice alternatives cannot be hardcoded                                                  | counts every offered choice/score alternative for top-k capability admission                      | U     | SHA OK; whole file green |
| 93  | score alternatives cannot be hardcoded                                                   | counts every offered choice/score alternative for top-k capability admission                      | U     | SHA OK; whole file green |
| 94  | invalid injected signals are no opinion                                                  | missing or malformed injected signals never become a verdict                                      | F     | SHA OK; whole file green |

## Checks and integration handoff

The final lane checks and hook receipts are appended below. Full
`npm run quality`, coverage, installed-host/package, a11y and hosted CI
remain Z/lead's integrated gates under the rig/common brief and PLAN's
cross-surface delegation. No gate, cap, ignore, timeout or rule was weakened.

Shared files are left with their named owners: P0 supplies any later wording
and all translations; Z supplies the real runtime/policy/receipt validation,
D78 adapter and first-charge consent, assembly, borrowed raw-body/MSP goldens,
README/CHANGELOG/PLAN/privacy and delivery records. Suggested Unreleased note:
“Prepared independently evidence-gated advisory judge uses and bounded fence
interfaces; no additional use or pre-execution hook is enabled.” FU adds no
command/setting/script and makes no product support claim.

M91 capture semantics and measured deadline/readiness, M96's real interface,
B's activated profiles, each use's independently paired M75 adoption receipt
and borrowed goldens remain explicit delivery prerequisites. The Model API
reviewer/card phase-1 wiring belongs to its existing owners; this lane's
host integration is the Muse Code extension-held reviewer region only.
No paid/source/CI/local behavior is claimed from fake fixtures.

This lane performs **0 live, 0 paid and 0 local model calls**. No credential
read, install, network call, push, merge or rebase.

Before implementation commit: owning files total **48 passing tests**; all
94 red/SHA/whole-file-green controls pass. Changed-file ESLint and Prettier
passed before the final explicit signal-validation change; its hook check
and final serial gates follow. Duplication initially found four test fixture
clones; fixture setup was consolidated without ignores and `jscpd` reran
green (zero clones). No production source was refactored for that gate.

### Final serial lane receipt

Implementation commit: `3fd00ae627313e1589c1d7ab218212cef07db048`.
Its enabled `.husky/_` pre-commit hook passed ESLint/Prettier on all ten
TypeScript files, Markdown formatting and staged gitleaks (no leaks).
All 94 source hashes still match after those hooks and the production build.

All final commands below ran **serially and directly on macmini**, after the
implementation commit. During development one all-project typecheck overlapped
an owning test invocation; that overlap is excluded from this final receipt.
The final serial rerun is the certification evidence.

| Check                                                 | Final result                                                                                |
| ----------------------------------------------------- | ------------------------------------------------------------------------------------------- |
| `npm run typecheck`                                   | All five projects pass                                                                      |
| Changed-file `npx eslint --max-warnings=0`            | Pass, no suppressions                                                                       |
| Changed-file `npx prettier --check`                   | Pass                                                                                        |
| Three owning Vitest files, whole files with rig flags | **48/48 pass**                                                                              |
| `npm run deadcode` (plain knip)                       | Pass; existing `vendor/**` configuration hint only                                          |
| `npm run cycles` (dpdm)                               | Pass, 403 files, no cycle                                                                   |
| `npx jscpd`                                           | Pass, 859 files, zero clones                                                                |
| `node scripts/check-l10n.mjs`                         | **0 problems**: 14 tables, 127 manifest strings, 433 source files                           |
| `npm run build`                                       | Pass: production, all 18 unchanged budgets, split/model-text readers, host globals, notices |
| `npm run check:host-api`                              | **Exit 1**, the three inherited snapshot differences below                                  |
| `git diff --check`                                    | Pass                                                                                        |

The host API snapshot mismatch is exactly P0/FIXM98J's existing deferral in
PLAN §7: `paidHost.ts` 11 → 12 calls; add that file to
`WorkspaceConfiguration.get`; `node:crypto` 32 → 33. FU adds **no snapshot
difference**. The generated document is Z-owned; Z/lead must run
`npm run check:host-api -- --write`, review those rows and rerun the gate.
It is not claimed green here.

| Production bundle       | Size / unchanged cap               |
| ----------------------- | ---------------------------------- |
| Extension               | **553.3 / 600 KiB**, 566,613 bytes |
| Model API               | 426.4 / 475 KiB                    |
| Muse Code reviewer      | 17.4 / 75 KiB                      |
| Webview JS              | 861.2 / 900 KiB                    |
| ACP                     | 786.7 / 850 KiB                    |
| Shared English fallback | 105.9 / 125 KiB                    |
| Checkpoint store        | 109.1 / 225 KiB                    |

The actual production activation metafile contains **no `src/core/judge/`
or `src/host/judge/` input**. No source/schema/implementation bundle loads
through the optional type-only dependency. No bundle, cap, language table,
model-text reader or dependency changed.

The real source adapters retain per-connection locality/provenance checks;
`sourceVerified` is validated use-eligibility evidence, never a cached proof
that authorizes a content-bearing socket. The runtime still applies all
paid admission/first-charge/confidential rules. No live/paid/local attempt
was added by any gate or drill.

Full quality/coverage/installed-host/package/hosted certification and the
shared snapshot/docs/assembly updates remain Z/lead's explicitly delegated
integration work. FU's pure implementation, injected reviewer region,
owning acceptance tests and red controls are complete. Working tree was
clean after the implementation commit and final lane gates; this receipt
update is the only subsequent change.

## FIXM98FU — RVM98FU P2 repair (2026-10-05, macmini)

Branch `m98/fufix`, base `bb5299f3`; worktree
`/Users/randy/lanes/FIXM98FU`. Read the entire rig/common brief and
`RVM98FU.report.md`. The review has one P2 and no P1/P3. **P2 fixed;
no review finding remains residual.** All original activation/adoption,
isolation and integrated-gate prerequisites above still apply.

`src/host/judge/uses.ts` now keeps the exact-action shared entry as the
single owner of its runtime call, result and cancellation controller,
reusing core `entryKey` without changing lane J's consuming store. Each
approval acquires a separately consuming latch. Idempotent release removes
only that holder; a ready caution remains available to every other holder.
The last holder leaving deletes the entry and aborts its call. Invalid
owner/source/policy bindings discard the stale generation before a new
approval joins; identity-checked deletion and captured entry objects keep
old holders/callbacks away from its replacement. Fences still read once
synchronously and never await; no gate or admission boundary is widened.

Both review probes are permanent in `test/unit/judgeUsesReview.test.ts`:
“identical actions share one dispatch with independent abort and latch
lifetimes” and “resolving one of two identical reviewable approvals preserves
the other caution card”. The latter first proves both approvals pass
`isReviewableApproval` and reuses M90's captured approval envelope with
synthetic internal network subjects and distinct approval identities;
no new external wire shape is invented. Two further tests
cover an early pending reviewer fence and last-holder/rebound lifetimes.
The whole file failed against unchanged base production code: **4 new
tests failed, 19 existing tests passed**. With the repair: **23/23 pass**.

Six additional guard drills ran the whole owning file, serially and directly
on macmini with `--maxWorkers=3 --testTimeout=120000`. Each had red exit 1,
the named assertion below, byte-exact restoration in `finally` verified by
SHA-256, then a whole-file green exit 0 (23/23). No test-name filters/skips.
An initial scratch-driver needle did not match after formatting; it stopped
before mutation, restored the original bytes, and the remaining controls
ran with the corrected needle. This is not counted as a red control.

| Guard deliberately broken                      | Named failing regression (abbreviated)                                             |
| ---------------------------------------------- | ---------------------------------------------------------------------------------- |
| Join guard: dispatch for every holder          | identical actions share one dispatch…                                              |
| Last-holder count: cancel with one holder left | identical actions share one dispatch…; resolving one of two…; pending shared call… |
| Idempotent release guard                       | identical actions share one dispatch…; resolving one of two…                       |
| Per-holder read-once guard                     | identical actions share one dispatch…                                              |
| Generation identity check on deletion          | only the last shared holder cancels…                                               |
| Stale-binding check before joining             | only the last shared holder cancels…                                               |

Restored production SHA-256 for all six controls:
`src/host/judge/uses.ts` =
`eeed42145cfca77f9da2b8cbd1db93aa2ac36d9b72c87ee066da1229c5b027f5`.
Scratch driver/logs/JSON remain under ignored `temp/fixm98fu/` only.

No dependencies, keys, source activation, strings, wire parser or other
lane's production regions change. Z retains shared README/CHANGELOG
delivery; suggested Unreleased repair note: “Identical held judge actions
share one dispatch, and resolving one approval preserves the other held
approvals' cautions.” This repair performs **0 live/paid/local model calls**,
credential reads, installs, network requests, merges, rebases or pushes.

### FIXM98FU final checks

Implementation commit `2d8b8c7f47cd47ec30384cda952dc98c99cebdba` used the
worktree's enabled pre-commit hook: ESLint/Prettier and staged gitleaks pass.
The production hash above still matches after hooks and build. All checks
below ran directly on macmini; no aggregate quality/full-suite run.

| Check                                      | Result                                                                                |
| ------------------------------------------ | ------------------------------------------------------------------------------------- |
| `npm run typecheck`                        | All five projects pass; final fixture changes also pass `npm run typecheck:unit`      |
| Scoped ESLint / Prettier / diff whitespace | Pass, no suppressions                                                                 |
| Three whole owning Vitest files, rig flags | **52/52 pass**                                                                        |
| Original-source control + six guard drills | Red exit 1, byte-exact restore, whole reviewer file green after each                  |
| `npm run deadcode`                         | Pass; inherited vendor configuration hint only                                        |
| `npm run cycles`                           | Pass, 403 files, no cycles                                                            |
| `npx jscpd`                                | Pass, 859 files, zero clones                                                          |
| `node scripts/check-l10n.mjs`              | Pass, 14 tables, 127 manifest strings, 433 source files; 0 problems                   |
| `npm run build`                            | Pass, all 18 size caps, bundle split/model-text readers, host globals, notices        |
| `npm run check:host-api`                   | Exit 1: exactly the three inherited P0/FIXM98J snapshot differences; no FU difference |

Unchanged bundle sizes: extension **566,613 bytes / 600 KiB**, Model API
**436,630 bytes / 475 KiB**, checkpoint store **109.1 / 225 KiB**.
The production activation metafile has **zero core/host judge inputs**.
The host-API differences remain `paidHost.ts` 11 → 12 calls, that file added
to `WorkspaceConfiguration.get`, and `node:crypto` 32 → 33, as PLAN §7
already delegates. Z/lead refreshes/reviews that snapshot and runs integrated
quality/coverage/host certification; the review's sole P2 is fully repaired.
