# M98P2C requests

Lane C did not edit files owned by other lanes. The adapter is
implemented and tested behind injected `readKey`, `reserve`, and `post`.
Nothing here enables it.

## FIXM98P2C integration requests (2026-10-06)

All four RVM98P2C findings are repaired in the owned adapter and fake tests.
These assembly requirements accompany the repair:

- Supply `SystemOneSelection.generation` as a nonnegative safe integer.
  Increment it on every source/model, enablement, selection mode,
  confidentiality or consent change, including revocation then restoration.
  Return one coherent decision. Never supply a permanently constant generation.
  The adapter snapshots the selection and generation, checks after admission
  and key lookup, and refuses a replaced allowed binding with `consent-needed`.
- Honor the cancellation/accounting split: Stop and the request deadline
  settle the caller's outcome immediately. Late admission refunds once; known
  dispatched usage settles once; failures retain liability. Do not add a
  second release/settlement callback around this adapter. The existing durable
  ledger remains responsible for completion or recovery of pending accounting.
- Z: record this security repair in PLAN §2c and CHANGELOG `[Unreleased]`,
  even while the adapter remains unwired. Suggested change description:
  "Fix the unshipped SystemOne adapter's structured-field redaction, policy
  generation checks and cancellation-safe accounting."
  This lane's current plan, regressions and 12 negative drills are in
  `docs/certification/m98p2-c.md`.
- Z: resolve or record a justified PLAN §7 deferral for the inherited full
  duplication failure before delivery. Exact original source/test replay and
  the repair both produce the same 30 clone file/range pairs, none in lane C.

No new public command, setting, user-facing text, feature-catalogue entry,
dependency, wire shape or UI surface is introduced by the repair.

## Z — wiring, ledger, docs, package

- Load `src/core/judge/systemone/**` lazily on the first explicit use,
  with its own budget, the way `dist/judge.js` loads. Do not import it
  from activation. This lane's build shows `createSystemOneJudge` absent
  from `dist/extension.js`, `dist/judge.js`, and `dist/judgeP2.js`.
- `dist/providers.js` (130.0 / 150 KiB) already contains the frozen
  preset and capability rows, because the providers entry re-exports
  `presets.ts`. That is constants only. It does not import the adapter.
- Bind `reserve` to the existing D78 ledger. Do not add a second ledger
  and do not edit `admission.ts`. `admitJudgeCall` accepts engine
  `auto|same` only, so this separate route cannot use that enum.
  `reserve(usd)` returns `{reserved: true, claim: {reservedUsd, settle(usd), refund()}}`
  or `{reserved: false, reason: 'over-budget' | 'unpriced' | 'ledger-unavailable'}`.
  Pass `over-budget` and `unpriced` through. Map `ledger-unavailable` to
  `engine-failure`. Reserve
  `(measuredBodyTokens * inputUsdPerMillion) / 1_000_000` with output
  reserved as 0 before `post`. Refund only a known non-send. Do not
  refund a non-200, a thrown send, a parse or settle failure, or usage
  above the reservation.
- PRIVACY: recipients are OpenRouter
  (`https://openrouter.ai/api/v1/systemone`) and TypeSafe
  (`https://api.typesafe.ai/v1/systemone`). The body is redacted `state`
  and `questions`. The key stays in the existing M95 store and is not
  part of the JSON, the result, or the log.
- CHANGELOG when a user can turn the route on. README when a command
  runs it. This lane adds no command.
- knip already passes with the test entries. No `knip.jsonc` change.
- Full `npx jscpd` exits 1 on 30 pre-existing clones
  (`runtime/tokenFile.ts` with `runtime/judge/tokenFile.ts`,
  `runtime/companion/server.ts` with `runtime/judge/serve.ts`, and the
  matching tests). They are not lane C files. Scoped scan of
  `src/core/judge`, the two provider files, and `judgeSystemOne*` tests
  found 0 clones.

## P0 — settings and catalogue

No new setting, command, or catalogue row. If a user-facing switch is
required, add an experimental opt-in that defaults off, with l10n and a
`featureCatalog` row in that same change. The adapter already treats
`enabled: false` as `explicit-off` before confidential, auto, consent,
key, reserve, or send.

## A — cascade

Do not auto-select these routes. A selection other than `explicit` is
`source-untested` and does not reserve. `auto` stays off this source
until a verified separate source exists. `applySystemOneGate` must keep
the deterministic `passed` flag: a SystemOne answer cannot clear a
failing check or be the only reason a passing gate fails.

## E — bring-your-own providers

Consume `SYSTEMONE_SERVICE_PRESETS` and `SYSTEMONE_CAPABILITIES`. Do not
rewrite them.

## FP — panel

When a row exists, show untested, opt-in, and not auto-selected; input
$0.042 per million tokens; output $0; confidential workspaces refuse
before send; direct TypeSafe `wireCapture` is false.

## G — CLI

No CLI flag or command from this lane.

## Clef, and what is still untested

Clef has no preset, no capability row, and no parser. Add one only from
a counted capture. Direct TypeSafe stays `wireCapture: false`; the
fixture replays the docs.typesafe.ai examples read 2026-10-06, and a
TypeSafe-only wire difference needs its own counted call. The OpenRouter
fixture uses the 2026-10-04 served model and 491 input tokens.
`output_tokens` was not in that record, so the fixture uses 0. No `cost`
field is parsed. Rate limits are not pinned. Choice stays A–Z with 2–26
keys. Word keys are refused before send. Score stays at most 10 levels.
