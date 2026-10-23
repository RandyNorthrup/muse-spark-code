# M98 phase 2 lane FP — Judge panel (2026-10-06, macbook)

Lane `m98/p2-fp`, base `m98/p2base` `f105c2a4`. Implementation commit
`1422110baf9ec8849eb64ea2e932d2d4fb5ef7e5`. Tests ran in this worktree
with `npx vitest run` (at most three files, `--maxWorkers=3`, repository
timeout). No merge, no push, no paid or live model call.

## What the panel does

M95's Models & Agents panel has a Judge section. The host reads an
injected `JudgePanelPort` and posts a validated snapshot. The section
shows the effective source and model, the technique, calibration, a
partial distribution, and the price. A paid source shows reserved,
settled and uncertain amounts and the shared daily budget. An absent
paid amount says "Not known". A negative amount is omitted. A non-finite
amount rejects the report. Amounts print at the paid exact scale (three
decimals out to twenty significant digits, as provider prices), so a
positive price or liability never rounds to zero: $0.042 shows as $0.042.

The technique is shown only when the capability record of that same
provider and model can honour it. The provider name does not choose a
technique. No record means no invented technique, price, or one-dollar
budget. Top-1 is labelled approximate. Sampling needs cache and no forced
reasoning. Cascade needs effective source `both`. Embedding needs the
embedding flag. An experimental `auto` route and an unverified local
`auto` route show no source. Confidential work refuses an unverified
endpoint and a System One source that is neither the same model nor
verified local inference, and does
not ask. Engine `off` clears the technique and does not ask.

A Model API first charge asks once: opening or refreshing the panel
never calls `requestFirstCharge`. A forged `judge/askConsent` calls it
only when the fresh snapshot says a charge is due. After the port's
read reports the grant, a second message does not call again. Muse Code
with no paid source shows `judgeSubscriptionNotice` and does not ask.
Selecting a paid source on Muse Code does ask. A free local source does
not. A paid identity that no longer matches the stored grant asks again.
An unpriced paid source is labelled unpriced and is not sent. A paid
source selected on Muse Code reads Paid with its price after consent;
subscription-only still reads Subscription.

Account & usage renders the same rows from `judgeUsage`, as direct
`dt`/`dd` children of the facts list so the narrow grid holds, with the
experimental warning beside any other status. Clearing the
conversation does not clear that window snapshot. The chat host does
not post `judgeUsage` yet; that call site is requested from Z.

The projector and the section do not import `src/core` or `vscode`.
Enums stay aligned with `src/core/judge/schema.ts`, and the panel adds
source `none`. New `judgePanel` strings are in English and all 14
tables (`node scripts/check-l10n.mjs`: 0 problems). P0 owns further
edits to those files.

## Checks

| Check                                  | Result                                       |
| -------------------------------------- | -------------------------------------------- |
| `test/unit/judgePanel.test.ts`         | 19 passed                                    |
| `test/unit/judgePanelHost.test.ts`     | 5 passed                                     |
| `test/unit/judgePanelView.test.tsx`    | 6 passed                                     |
| `test/unit/modelsSections.test.ts`     | 3 passed                                     |
| `test/unit/modelsPanel.test.ts`        | 9 passed                                     |
| `test/unit/modelsApp.test.tsx`         | 2 passed                                     |
| `test/unit/modelsPanelSchemas.test.ts` | 12 passed                                    |
| `npm run typecheck`                    | host, webview, unit, e2e, integration passed |
| `npm run build`                        | passed, no cap raised, no new deferred chunk |
| `node scripts/check-l10n.mjs`          | 0 problems                                   |

Bundle sizes that this lane touches: models webview body 67.1 / 75 KiB,
`dist/webview/models.js` with static imports 326.4 / 500 KiB,
`dist/modelsPanel.js` 96.9 / 125 KiB, UsageDialogContent 10.2 / 25 KiB,
paid usage chunk 4.1 / 25 KiB, `dist/uiText.js` 76.8 / 125 KiB.

The view receipt covers the four captured themes (`dark`, `light`,
`hc-dark`, `hc-light`), a 320px nav (`flex-wrap: wrap`), a pseudo-locale
installed with `setUiText` before render, keyboard focus and click on
the review button, and axe-core with `color-contrast` disabled. jsdom
does not compute colours; the host document shell supplies `<title>` and
`<html lang>`. There is no running VS Code window in this lane, so the
panel was not clicked inside the editor.

## Red drill

Named drill: show a paid question on subscription-only activation.

`src/shared/judgePanel.ts` SHA-256 before the edit:
`d1e084bd64109f1a5ac28f624d9018a7d85a23d5ebbfa06eb74e0d812854a921`.

`const isSubscriptionOnly = input.billing === 'subscription' && !input.paidSourceSelected`
was replaced with `const isSubscriptionOnly = false`. The same three
test files then failed (7 failed, 23 passed). A priced subscription
with consent still needed reported `askFirstCharge: true`. The section
showed "Review the price" and "Waiting for first-charge consent" instead
of the subscription note. The host published that snapshot on reveal.

The file was restored byte-exact. SHA-256 after restore matched. The
committed blob of `src/shared/judgePanel.ts` is that same hash.

## Other editors

The snapshot is host-neutral JSON on the existing postMessage bridge.
Any editor that renders the shared models webview gets the section.
ACP and the headless runtime have no Models panel; a host can post the
same `judgeUsage` message. The projector does not call VS Code.

## F/P review fixes (2026-10-07, macbook, lane FIXM98P2FP)

The independent `RVM98P2FP` review found five P2s against `92ca65235`.
Each fix below carries a regression test that was run on the base first
and failed there (5 failed, 25 passed across the two owning files), then
passed after the fix. That base run is the gate-fire record: no drill
broke anything on purpose beyond it, and every touched file was restored
by the fix itself, not by revert.

1. Exact dollars (`src/shared/judgePanel.ts`, `judgePanelMoney`). Money
   now prints at the paid view's exact provider-price scale
   (`MODEL_API_PRICE_DECIMALS`, `PROVIDER_PRICE_MAX_DECIMALS`): $0.042
   shows as $0.042, $0.015 exact, $0.0000001 never rounds to zero. The
   formatter is not imported from the paid module because that module
   reads `src/core`, which this file must not. Test: "shows an exact small
   price without rounding to two digits".
2. Verified local source in confidential mode (`projectJudgePanel`). The
   System One refusal now also requires `locality !== 'verified'`, so a
   verified local separate source (`ollama/tev1:4b`) is kept while remote
   and unverified endpoints stay refused; same-model behaviour is
   unchanged. Locality decides. Test: "keeps a verified local System One
   source in a confidential workspace".
3. Billing label (`judgePanelStatusText`). A paid source selected on a
   subscription backend now reads Paid, with its price rows, after
   consent; subscription-only still reads Subscription. Test: "labels a
   paid source on a subscription backend as paid after consent".
4. Experimental warning (`JudgeUsageRows`). Renders `judgeSourceUntested`
   whenever `untested` holds and the status line does not already say it
   (the same condition as the Models `JudgeSection`), so the warning
   survives `consent-needed` and `engine-failure`. Test: "keeps the
   experimental warning in Account & usage beside another status".
5. Usage facts grid (`JudgeUsageRows`). Rows render as direct `dt`/`dd`
   children of the `dl` (keyed fragments, as `PaidRow` already does)
   instead of `div` wrappers, restoring the `max-content 1fr` grid the
   CSS selects on. Test: "renders usage facts as direct definition terms
   at 320px".

Fix checks (default timeouts, `--maxWorkers=3`): `judgePanel.test.ts`
22 passed, `judgePanelView.test.tsx` 9 passed, `judgePanelHost` /
`judgeSharedBudget` / `judgeTransport` 19 passed, `judgeUsage` /
`modelsSections` / `judgeConsent` 16 passed. `npm run typecheck`: all
five projects passed. Full `npm run lint` and Prettier on the touched
files: passed. Plain `npx knip`: exit 0. `npm run duplication` still
reports 0.10% over the 0.0% threshold, and fails identically on the
unmodified base commit, so the failure is pre-existing; none of the
reported clones is in the touched files. `npm run build`: exit 0, caps
unchanged (models body 67.2/75 KiB, models 326.4/500, modelsPanel
97.0/125, uiText 76.8/125). `webviewBundle.test.mjs` fails its chat
startup baseline (761611 vs 751411.2 bytes) identically on a clean
`92ca65235` build (761543 there; the delta from this lane is 68 bytes),
so that overage is pre-existing and not a lane regression.
`node scripts/check-l10n.mjs`: 14 UI tables,
14 usage tables, 190 manifest strings, 962 source files, 0 problems.

Browser receipt: the scripted harness (`harness-shots.mjs`, `usage-*.mjs`)
needs a loopback listener and a Chrome child process, and this rig's
sandbox denies both. Concrete evidence, re-probed 2026-10-07: `bind(2)`
fails with EPERM on 127.0.0.1, 0.0.0.0 and ::1 (node `net` probe); every
headless Chrome launch aborts with SIGABRT in `_RegisterApplication` /
`TransformProcessType` (no WindowServer/GUI session; crash log
`Google Chrome-2026-10-06-233808.ips`, EXC_CRASH), including a bare
`data:` URL with `--no-sandbox`; no Playwright browsers are installed,
and the Docker daemon is down. So no scripted `paid-usage` / `judge-usage`
shot or live geometry run was possible here. In its place, all with fakes
only: the real `JudgeUsageRows` output was server-rendered from the
unchanged components (esbuild SSR) and embedded in a static 320px page per
captured theme for inspection; a new jsdom test renders the full
`UsageDialogContent` with an experimental consent-needed `judgeUsage` in
all four captured themes inside a 320px wrapper ("shows the judge usage
dialog in four themes at 320px": warning, status, direct `dt`/`dd`, and a
per-theme axe run with `color-contrast` disabled all pass); and the
structural regression test asserts the direct `dt`/`dd` children the grid
CSS selects on. No live or paid call was made.
