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
amount rejects the report. Amounts under one cent keep six fraction digits.

The technique is shown only when the capability record of that same
provider and model can honour it. The provider name does not choose a
technique. No record means no invented technique, price, or one-dollar
budget. Top-1 is labelled approximate. Sampling needs cache and no forced
reasoning. Cascade needs effective source `both`. Embedding needs the
embedding flag. An experimental `auto` route and an unverified local
`auto` route show no source. Confidential work refuses an unverified
endpoint and a System One source that is not the same model, and does
not ask. Engine `off` clears the technique and does not ask.

A Model API first charge asks once: opening or refreshing the panel
never calls `requestFirstCharge`. A forged `judge/askConsent` calls it
only when the fresh snapshot says a charge is due. After the port's
read reports the grant, a second message does not call again. Muse Code
with no paid source shows `judgeSubscriptionNotice` and does not ask.
Selecting a paid source on Muse Code does ask. A free local source does
not. A paid identity that no longer matches the stored grant asks again.
An unpriced paid source is labelled unpriced and is not sent.

Account & usage renders the same rows from `judgeUsage`. Clearing the
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
