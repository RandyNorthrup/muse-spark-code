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
  the Standard model / Remove. Send on Contributor remembers training consent
  for later ordinary video/audio in that conversation, including when the
  first Send is a recording. Standard Send grants no Contributor consent.
  Concurrent ordinary uses share the question. Screen recordings always ask,
  including Standard; neither a previous grant nor a concurrent recording
  bypasses that question.
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
   The browser cost region has its own dynamic import, but currently exceeds
   the aggregate deferred budget; see the build blocker below. W must fit
   it within the unchanged cap or use the planned separately budgeted page
   entry. No cap is changed.
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

Additional final integration guard: media identities have a separate digest
namespace, so they cannot mask new text with an identical string. Its red
drill removed the namespace and `test/unit/sessionBudget.test.ts > calibrated media budget parts > keeps a media identity from hiding a newly added text part with the same text` failed (exit 1).
The source was restored with SHA-256 `622cc242b34e124219f9a1b534d30ce07ea4cacc1579378eeb4a67a96eecd024`. Total: 35 drills.

## Build blocker: W-owned integration required

The first fully lazy chip build was 899.3 KiB startup and 50.8 KiB deferred.
The 50 KiB deferred cap failed. Two bounded attempts to reduce only C-owned
code were tried: sharing caption formatting with the existing eager Intl
helpers produced 900.0 KiB startup / 50.1 KiB deferred (28 bytes and 75 bytes
over); a smaller text renderer and runtime table lookup produced 900.1 KiB
startup / 50.0 KiB deferred, with startup still over its cap.

The common rule says to stop a path after the same check fails following
two different fixes. Those attempts were removed. The final source restores
the complete lazy media chip: duration/cost formatting, warnings and markup
all live in its optional chunk. W owns the bundler, page entries, split
guards and budgets. Resolving that aggregate cap requires W's integration
work; C does not touch another lane's files or raise a cap. The final build
measurement is recorded below. This is an explicit unpassed release gate,
not a claim that M105 or the new UI is ready to ship.

Final lazy-chip re-drill `final-chip-estimate`: `test/unit/AttachmentMediaCost.test.tsx > lazy media chip cost > shows duration, bytes, sound and tokens marked as an estimate beside both prices`
failed (exit 1). Restored SHA-256 `cc87032ce23efb5fecc955f897a2c49be5c8e1d5141f26334beeb236c1be0fbc`.

Final lazy-chip re-drill `final-chip-contributor-warning`: `test/unit/AttachmentMediaCost.test.tsx > lazy media chip cost > shows duration, bytes, sound and tokens marked as an estimate beside both prices`
failed (exit 1). Restored SHA-256 `cc87032ce23efb5fecc955f897a2c49be5c8e1d5141f26334beeb236c1be0fbc`.

Final lazy-chip re-drill `final-chip-recording-warning`: `test/unit/AttachmentMediaCost.test.tsx > lazy media chip cost > warns about screen content every time, including Standard`
failed (exit 1). Restored SHA-256 `cc87032ce23efb5fecc955f897a2c49be5c8e1d5141f26334beeb236c1be0fbc`.

Consent re-drill `recording-grant`: `test/unit/mediaCost.test.ts > contributor question > remembers a Contributor recording Send for later ordinary media, without granting from Standard`
failed (exit 1). Restored SHA-256 `bf5bf41311cdc6941d8670bececb214cda5eaa0332385ababd1754c676b12204`.

Consent re-drill `standard-recording-no-training-grant`: `test/unit/mediaCost.test.ts > contributor question > remembers a Contributor recording Send for later ordinary media, without granting from Standard`
failed (exit 1). Restored SHA-256 `bf5bf41311cdc6941d8670bececb214cda5eaa0332385ababd1754c676b12204`.

Total: 40 recorded mutation runs, all named failures with byte-exact SHA-256
restoration. The recording-consent regression also failed before the actual
fix; its final whole-file run passes.

## Final lane verification

All checks ran directly on Kubuntu, with the repository's default test timeout.
The following whole files passed, 164 unique tests in total:

| Test file                                | Passing tests |
| ---------------------------------------- | ------------: |
| `test/unit/mediaCost.test.ts`            |            17 |
| `test/unit/mediaAccounting.test.ts`      |            10 |
| `test/unit/mediaClient.test.ts`          |            12 |
| `test/unit/AttachmentMediaCost.test.tsx` |             5 |
| `test/unit/sessionBudget.test.ts`        |            16 |
| `test/unit/modelApiClient.test.ts`       |            27 |
| `test/unit/Composer.test.tsx`            |            77 |

Two final three-file commands encountered Vitest/Vite temporary SSR cache
`ENOENT` errors before assertions in mediaCost, sessionBudget and mediaClient.
The unaffected files passed; the three affected files then passed individually
with the same worker limit and default timeout. No configuration was changed.

`npm run typecheck` passed all five projects after the final consent fix.
Changed-file ESLint and Prettier passed. `npm run deadcode` passed (only the
existing configuration hints), `npx jscpd` reported zero clones,
`node scripts/check-l10n.mjs` reported zero problems across 14 tables, and
`npm run check:host-api` passed without changing its generated record.

The final `npm run build` exited 1 at the unchanged deferred JS cap:

| Bundle                          | Final size |     Cap | Result   |
| ------------------------------- | ---------: | ------: | -------- |
| Extension                       |  436.7 KiB | 600 KiB | pass     |
| Model API                       |  447.5 KiB | 475 KiB | pass     |
| ACP                             |  816.8 KiB | 850 KiB | pass     |
| Shared English fallback         |   49.2 KiB | 125 KiB | pass     |
| Chat startup and static imports |  899.3 KiB | 900 KiB | pass     |
| Aggregate deferred webview JS   |   50.9 KiB |  50 KiB | **fail** |

On those compiled artifacts, the separate bundle-split check also exited 1:
`Unlisted deferred webview surface src/webview/components/AttachmentMediaCost.tsx`.
Its registry is W-owned. Host-globals passed with zero navigator references;
third-party notices passed for 83 bundled packages. The portable media factory,
real stores, captured calibration, selected-model/host bindings and W-owned
documentation remain the named handoffs above. U6c's conditional storage work
remains unconfirmed, so no unsupported paid-storage feature was enabled.

The full quality/coverage/accessibility gates remain the lead's run under the
shared lane rules. These local commits are reviewable lane work; neither the
build nor M105 release certification is claimed green. Hooks remain enabled;
both local commits run the repository's lint-staged and secret scan.

## FIXM105C — RVM105C money and display repair (2026-10-06)

The rig fix brief requires all four P2 findings and P3 fixed. This record
supersedes the numeric money portions of the original delivery above.

- **RVM105C-P2-exact-money:** media reservation, settlement and chip price
  arithmetic uses `Usd`. The session/daily ports and serialized chip prices
  now carry canonical branded decimal strings. Historical numeric chip
  inputs normalize once through `legacyUsdSchema`; no result is converted
  back to binary floating-point. Tariffs are parsed once per reservation.
- **RVM105C-P2-zero-price:** shared `formatUsd` ceilings exact amounts and
  preserves at least two significant digits below one cent. U4's 2,751
  tokens render `$0.0035 Standard / $0.00028 Contributor`. Locale patterns,
  grouping and non-Latin digits still come from Intl.
- **Identical-API handoff C→M106H/M108T:** `src/shared/usd.ts` and
  `usdConstants.ts` are byte-identical copies from `m106/h` at
  `5ab7d0c9c914fbca1e1a26abc75811655a684e89`. The helper SHA-256 is
  `10fea8369cef7407d603a8ba534fac0327263b56729f45a466059125ce89e9a1`.
  `formatUsd` uses that branch's shared ceiling implementation. The branch
  advanced during reading; the initial test incorrectly called the removed
  `toNumber` API. That test was corrected to the copied API. An Arabic test
  now requests `ar-u-nu-arab` explicitly because ICU's default `ar` digits
  depend on its version; no runtime locale behavior was changed for it.
- Generated property cases check integer nano-USD reservation/bill oracles,
  add/subtract/multiply/divide identities, canonical serialization and
  ceiling displays. The exact-cap regression admits `$0.0005872` with no
  epsilon, rounding allowance or weakened cap.

Money/display mutation drills are recorded after execution below. All run
whole test files, at default timeouts, with `--maxWorkers=3`; no network or
model request is involved. Existing W-owned bundle fitting and registration,
real store/tariff bindings, captured calibration and editor wiring remain the
named integration handoffs. W must adapt real journal ports to exact money
rather than arithmetic on converted numbers; this lane adds no production
binding or hosted-fee admission.

### Money/display red drills

| Guard broken                                             | Named failing test                                                                                        | Result / restored SHA-256                                                  |
| -------------------------------------------------------- | --------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------- |
| Reservation replaced with binary multiplication/addition | `mediaAccounting > admits the exact reservation at an equal cap without a floating-point overage`         | exit 1; `388c3575ec9f04d514cb6007016ca8a7fd82216ec3c93049e61cd84308fab6e5` |
| Settlement replaced with binary multiplication/addition  | `mediaAccounting > matches integer nano-USD tariffs across generated reservations and cached settlements` | exit 1; same mediaCost digest                                              |
| Chip tariff multiplied as a binary number                | `mediaCost > keeps generated chip prices exact against integer nano-USD tariffs`                          | exit 1; same mediaCost digest                                              |
| Sub-cent display precision forced back to two decimals   | `AttachmentMediaCost > shows both positive U4 prices with two significant digits and ceilings the charge` | exit 1; `dd16df17ebd2ffb31375ea6c7ca4e6ff9cfaffb74c91d945080fc93d2c31e440` |

The first chip-price mutation passed the single U4 price fixture: its
particular product happens to round to the same decimal. Added generated
prices/durations against an independent integer nano-USD oracle, then reran
the drill and saw that named test fail. All source restorations compared
SHA-256 byte-exact in `finally`; scratch logs stay under `temp/`.

Initial green verification: all five TypeScript projects; 21 tests in
mediaAccounting/USD/chips and 46 in mediaCost/contracts/client (67 total,
before the additional generated chip-price test). These initial counts do not include the additional chip property test or
the later lifecycle regressions.

C→W CHANGELOG handoff: under `[Unreleased]`, include exact media admission
and settlement, nonzero ceiling estimates, a single request-token claim,
cache-write warnings that preserve successful replies, and concurrent
settlement/finalization coalescing. No command, setting or catalog entry is
added by this repair. CHANGELOG and feature-help files remain W-owned under
the lane's file-scope rule.

Money/display verification after restoration: 68 tests passed across all
six affected whole files (21 + 47); all five typecheck projects passed.
Changed-file ESLint passed after fixing two test-only style violations.
