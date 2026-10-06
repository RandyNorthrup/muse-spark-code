# M105 C Cost (b) certification

Kubuntu, 2026-10-06, branch `m105/c`, base lane 0 with its review fixes.
The rig brief overrides the old common merge and remote-run instructions.
No merge, rebase, push, dependency installation, credential access, live
inference, subscription call, paid call or provider upload occurred.
All Vitest runs use repository defaults, `--maxWorkers=3`, whole files and
at most three files per command. No timeout was raised.

## Delivered in this lane

- `src/core/media/mediaCost.ts`: portable, injected calibration store;
  provider/model/fps/image-detail-specific estimates for video, audio,
  images and PDF pages. Unknown duration, page count or rate stays unknown
  outside a cap and is a named refusal under one. Text uses its own estimator.
  A chip estimate supplies tokens and prices from injected verified tariffs.
- The nearest recorded per-unit rate supplies the estimate. The largest
  recorded rate times units times the injected safety factor supplies the
  upper bound. File size and base64 never supply media tokens. Safety factors
  below one, invalid metadata, unsafe counts and malformed evidence refuse.
- `reserveMediaRequest` reserves text plus media upper bounds and the full
  output allowance in both injected session and daily ledgers. Both fences
  recheck before dispatch. Unknown rates, unknown duration and more than
  50 media refuse before admission. Admission snapshots metadata and tariffs.
- Reported input/output/cached usage settles both claims at actual price.
  Nonsent requests refund; uncertain dispatches retain their liability.
  Partial ledger writes preserve actual cost and retry only the outstanding
  claim. Each verified settlement writes local evidence; mixed media bills
  supply conservative upper observations, without inventing attribution.
  Store writes serialize concurrent observations and recover after failures.
- `client.ts` binds the optional accounting port to the existing attempt
  guard. It marks dispatch adjacent to fetch, settles validated terminal
  usage, and finalizes claims on failure or early iterator closure. Model
  changes and increased output allowances refuse. Explicit 400/429 refusals
  refund; 429 may retry. Network/500 ambiguity does not retry these claims.
- `sessionBudget.ts` accepts detached `BudgetMediaPart` metadata with a
  calibrated allowance. Text keeps existing byte arithmetic. Media reserves
  its upper bound on every round, including replay with a count-route base.
  The reported base is kept whole: no unsafe subtraction of media or text.
- Contributor consent uses an injected modal/permission port with Send / Use
  the Standard model / Remove. Only Send remembers consent for ordinary
  video/audio in that conversation. Concurrent ordinary uses share the
  question. Screen recordings always ask, including Standard; neither a
  previous ordinary grant nor a concurrent recording bypasses that question.
- `AttachmentChips.tsx` loads `AttachmentMediaCost.tsx` only for a media
  summary. Its optional region displays duration, bytes, soundtrack state,
  estimated tokens marked `(est.)`, tier prices and training/screen warnings.
  Existing image/PDF/text summaries and removal behavior stay identical.
  Formatting and labels read the installed language at render time.

No production calibration seed or provider wire shape was invented. The two
U4 summary bills (2,751 and 1,671 tokens for ten seconds) are test projections
only. Other lengths, fps, detail and page samples are explicitly test-only.
Capture evidence and remaining receipts are in `m105-captures.md`; its
workspace/count/spend gaps remain the lead's capture task. This lane adds
no provider wire schema, raw frame fixture, cast escape hatch or lint ignore.

## Named integration handoffs (owned by other lanes)

1. **C→0 calibration evidence.** Supply the scrubbed U4/U17b capture ledger,
   workspace, per-capture attempt counts, price/spend and deletion receipts.
   Records accepted by the estimator contain `provider`, `modelId`,
   `variant` (`video` with nullable default fps; `image` with detail;
   `document`; `audio`), `units`, `inputTokens`, `captureId`, `upperOnly`.
   Input tokens in a singular capture include its complete billed input;
   this conservative convention avoids guessing the text/media split.
   Default fps never matches explicit fps without separate evidence.
2. **C→W lazy factory and storage.** Export this module from the portable
   `dist/media.js` factory, install the caller's language before use, and
   inject the real local calibration store plus
   `MEDIA_ESTIMATE_SAFETY_FACTOR` from constants. That constant is absent
   from lane 0 here; no production value was guessed. Register the lazy
   entry, split readers and measured budget in W's build/packaging regions.
   The browser cost region already has its own dynamic import and stays
   within the existing aggregate deferred budget; no cap is changed.
3. **C→M2/E1 request and chip binding.** From the gated, sniffed retained
   request, construct `MediaCostItem`s and detached text/media budget parts.
   Call `chipEstimate` with the verified chosen-model tariff record and put
   its result in `AttachmentSummary.media.estimate`. Keep encoded parts out
   of text accounting. Pass the selected model's contributor flag to the
   chips. An absent estimate is unknown, never zero tokens or a free price.
   The host-message update/reducer and Composer belong to E1/W and are not
   edited here.
4. **C→M2/W ledger binding.** Adapt the authoritative M82/D78 claims to
   `MediaCostLedger.reserve`, `MediaCostClaim.check/settle`; bind the account,
   workspace, live cap and key identity in the existing attempt guard.
   Obtain one `MediaRequestAccounting` per actual request and attach it as
   `ResponseAttemptGuard.mediaAccounting`. Use one owner for each full
   request's token charge: do not stack this whole-request reservation over
   another M82 token claim or a paid-helper token claim. Independently
   consented hosted fees remain separate. Rebuild/re-reserve after a model,
   attachment, text or output-allowance change. This base lacks M95's
   capability/tariff registry and M2's media builder; no substitute is made.
5. **C→E1/E2/E3 contributor binding.** One `MediaContributorConsent` per
   host/runtime, with stable conversation IDs. Invoke before upload/send.
   Translate its three choices through the host's modal/ACP permission
   bridge. Send permits that media; Standard selects a capable Standard
   model and re-estimates; Remove removes it. Headless has no interactive
   question and must refuse where a decision is required. The shared core
   works identically for VS Code family, ACP, companion and MHP hosts; each
   editor's binding is its entry-point lane, not a VS Code-only feature.
6. **C→0/F/W storage finding.** U6c remains unknown. Do not enable uploads
   as free and do not invent a storage tariff. `filesStorage` and its paid
   gate/tally are conditional on U6c finding billed storage; no paid-feature
   row is added before that evidence. If billed, the shared three-choice
   ask-once popup must name its captured storage rate, expiry and
   `museSpark.paidDailyBudgetUsd`, with storage-days counted loudly.
7. **C→W docs and help.** README/PRIVACY/CHANGELOG/PLAN and the registry are
   W-owned, so they are not edited. The `[Unreleased]` entry should describe
   calibrated media estimates, retained reservations, actual settlement and
   Contributor/screen consent, once the named bindings are integrated.
   `src/shared/featureCatalog.ts` and `scripts/gen-reference.mjs` do not
   exist on this base. Add reference entries for media estimates, unknown
   cost refusals, Contributor training consent and screen warnings when that
   catalog lands. No command or setting is added by this lane.

All user-facing wording reuses lane 0's `UI_TEXT.media` translations. No
English/translated/manifest table, another lane's code, bundle configuration,
gate threshold or ignore was changed.

## Verification

Initial cost/accounting/budget run: 41/41 passed. Initial
transport/chip/accounting run: 26/26 passed. An initial chip regression
assertion used `/est\./`, which also matched `test.png`; the assertion was
made specific to `(est.)` and passed. This was a test selector correction,
not a timeout or behavior change. All five typecheck projects passed before
the final additional tests; final lane checks are recorded below.

## Red drills

Every listed mutation ran its entire named test file, exited 1 with an
assertion failure, and restored its source bytes in `finally`. SHA-256 was
compared after each restoration. No filtered tests, skipped tests or timeout
options were used. The mutation runner and full logs are local scratch in
`temp/`, not shipped code.

| Deliberately broken guard | Named failing test (suite and file as listed above)                                                                                                       | Result               |
| ------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------- |
| rate-refusal              | `test/unit/mediaCost.test.ts > media calibration > refuses unknown rate or duration in a capped session and preserves unknown otherwise`                  | exit 1; SHA restored |
| byte-pricing              | `test/unit/mediaCost.test.ts > media calibration > reproduces both available U4 bills and reserves above every bill`                                      | exit 1; SHA restored |
| count-route-reservation   | `test/unit/mediaCost.test.ts > media calibration > reproduces both available U4 bills and reserves above every bill`                                      | exit 1; SHA restored |
| largest-rate              | `test/unit/mediaCost.test.ts > media calibration > reproduces both available U4 bills and reserves above every bill`                                      | exit 1; SHA restored |
| model-isolation           | `test/unit/mediaCost.test.ts > media calibration > reproduces both available U4 bills and reserves above every bill`                                      | exit 1; SHA restored |
| safety-factor             | `test/unit/mediaCost.test.ts > media calibration > validates persisted evidence, variant options and the safety factor`                                   | exit 1; SHA restored |
| capture-validation        | `test/unit/mediaCost.test.ts > media calibration > reproduces both available U4 bills and reserves above every bill`                                      | exit 1; SHA restored |
| local-observation         | `test/unit/mediaCost.test.ts > media calibration > adds settled usage locally and reloads that evidence`                                                  | exit 1; SHA restored |
| mixed-observation         | `test/unit/mediaCost.test.ts > media calibration > uses an indivisible mixed bill only to raise upper bounds`                                             | exit 1; SHA restored |
| contributor-question      | `test/unit/mediaCost.test.ts > contributor question > asks once per conversation after Send, and keeps different conversations independent`               | exit 1; SHA restored |
| recording-question        | `test/unit/mediaCost.test.ts > contributor question > asks every time for a screen recording, even after Send and on Standard`                            | exit 1; SHA restored |
| media-limit               | `test/unit/mediaAccounting.test.ts > media request accounting > refuses unknown duration, rate or more than 50 items before either ledger admits`         | exit 1; SHA restored |
| cache-tariff              | `test/unit/mediaAccounting.test.ts > media request accounting > refuses malformed tariffs or token allowances before admission`                           | exit 1; SHA restored |
| daily-admission           | `test/unit/mediaAccounting.test.ts > media request accounting > reserves the calibrated upper bound plus text and full output in both ledgers`            | exit 1; SHA restored |
| daily-final-fence         | `test/unit/mediaAccounting.test.ts > media request accounting > reserves the calibrated upper bound plus text and full output in both ledgers`            | exit 1; SHA restored |
| uncertain-liability       | `test/unit/mediaAccounting.test.ts > media request accounting > refunds a nonsent request but retains a sent request without a bill as uncertain`         | exit 1; SHA restored |
| reported-settlement       | `test/unit/mediaAccounting.test.ts > media request accounting > settles reported cached/input/output usage and writes a local observation exactly once`   | exit 1; SHA restored |
| reuse-claims              | `test/unit/mediaAccounting.test.ts > media request accounting > checks both final fences, forbids reusing dispatched claims and cannot bill unsent usage` | exit 1; SHA restored |
| invalid-usage             | `test/unit/mediaAccounting.test.ts > media request accounting > retains liability for invalid usage and records no observation`                           | exit 1; SHA restored |
| partial-ledger-settlement | `test/unit/mediaAccounting.test.ts > media request accounting > preserves actual cost after one ledger settles and the other fails to write`              | exit 1; SHA restored |
| media-budget-count-route  | `test/unit/sessionBudget.test.ts > calibrated media budget parts > uses the upper bound independently of encoded size and a 170-token count base`         | exit 1; SHA restored |
| media-budget-validation   | `test/unit/sessionBudget.test.ts > calibrated media budget parts > rejects an unsafe calibrated token allowance`                                          | exit 1; SHA restored |
| transport-final-fence     | `test/unit/mediaClient.test.ts > media accounting at the transport > rechecks ledgers before fetch and refunds if a final fence refuses`                  | exit 1; SHA restored |
| transport-settlement      | `test/unit/mediaClient.test.ts > media accounting at the transport > settles a verified complete terminal bill`                                           | exit 1; SHA restored |
| transport-refund          | `test/unit/mediaClient.test.ts > media accounting at the transport > refunds an explicitly refused HTTP 400 request`                                      | exit 1; SHA restored |
| transport-ambiguous-retry | `test/unit/mediaClient.test.ts > media accounting at the transport > retries an explicitly nonsent 429, but never an ambiguous 500 or network failure`    | exit 1; SHA restored |
| transport-body-fence      | `test/unit/mediaClient.test.ts > media accounting at the transport > refunds missing-key, aborted and changed-model requests before dispatch`             | exit 1; SHA restored |
| chip-estimate             | `test/unit/AttachmentMediaCost.test.tsx > lazy media chip cost > shows duration, bytes, sound and tokens marked as an estimate beside both prices`        | exit 1; SHA restored |
| chip-contributor-warning  | `test/unit/AttachmentMediaCost.test.tsx > lazy media chip cost > shows duration, bytes, sound and tokens marked as an estimate beside both prices`        | exit 1; SHA restored |
| chip-recording-warning    | `test/unit/AttachmentMediaCost.test.tsx > lazy media chip cost > warns about screen content every time, including Standard`                               | exit 1; SHA restored |
| chip-price                | `test/unit/mediaCost.test.ts > media calibration > prices the chip from verified tier tariffs while preserving an unknown estimate`                       | exit 1; SHA restored |
| reservation-snapshot      | `test/unit/mediaAccounting.test.ts > media request accounting > snapshots admitted metadata and tariffs for settlement after a UI change`                 | exit 1; SHA restored |
| provider-isolation        | `test/unit/mediaCost.test.ts > media calibration > keeps provider, model, explicit fps and image detail calibrations separate`                            | exit 1; SHA restored |
| fps-detail-isolation      | `test/unit/mediaCost.test.ts > media calibration > keeps provider, model, explicit fps and image detail calibrations separate`                            | exit 1; SHA restored |

Restored source digests (full SHA-256):

- `src/core/media/mediaCost.ts`: `7c4364cd51b09731a4ed4f4d74e5b32f9796fa82f98e0d04f1f668a5bd9a6950`
- `src/core/media/mediaCost.ts`: `e8180b62a7260350358c397d20c17e9d9732088df8e9f7dfa2b3df707234b1fe`
- `src/core/backends/modelapi/sessionBudget.ts`: `0dca9840967a06fd06f3384aacd17507a3db90170202591d37fc8b4f67aa4c04`
- `src/core/backends/modelapi/client.ts`: `bfca038116f08284f4770c53d0bc08715a1a6c0740f450b70ae516576f445c6c`
- `src/webview/components/AttachmentMediaCost.tsx`: `cd10b1efc72d27b242e37088e8d2f4cc2dbb1b1bd0b1dd118eeb6677c588da5d`

34 red drills completed. A core digest changed between drill batches only
when the chip-price helper was added and formatted; each batch restored its
own original digest.
