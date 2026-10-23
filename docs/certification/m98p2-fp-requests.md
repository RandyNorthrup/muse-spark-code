# M98 phase 2 lane FP — requests

FP added the strings the Judge section needs and left every other shared
surface to its owner. No parallel ledger, provider registry, golden
baseline, setting, command, or deferred chunk was added.

## P0 — text

`judgePanel` was added to `src/shared/l10n/en.ts` and all 14
`l10n/ui.*.json` (source, model, technique, calibration, partial,
price parts, reserved, settled, uncertain, shared daily budget, spent
today, not known, unpriced, the one-time review button, free local,
technique names, and calibration labels). The section cannot say those
things with the existing keys. `node scripts/check-l10n.mjs` reported
0 problems. P0 owns further edits to those files, `package.json`, and
the manifest. FP did not change settings or package metadata.

## Z — wiring and docs

- Post `{ type: 'judgeUsage', usage }` from the conversation host that
  already posts `judgeState` (`src/host/conversation/conversationController.ts`
  is FU/Z, not FP). Until that lands, Account & usage shows judge rows
  only when some host sends the message. The Models panel does not wait
  for it: it reads the injected `JudgePanelPort`.
- CHANGELOG, README, PLAN, and `docs/judge.md` should mention the Models
  panel Judge section, the subscription note, and the one-time paid ask.
  FP did not edit those files.
- No bundle-cap or split-check change. The production build fit:
  models webview body 67.1 / 75 KiB, models.js with static imports
  326.4 / 500 KiB, `dist/modelsPanel.js` 96.9 / 125 KiB,
  UsageDialogContent 10.2 / 25 KiB, paid usage 4.1 / 25 KiB.

## Source status

Effective source, locality, experimental, confidential, billing, consent,
and money are injected. FP displays them and does not compute a source,
a technique, or a price when the record is missing.
