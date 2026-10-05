# M95b — lane U: shared plan UI

Rig: Windows 11, `C:/lanes/M95BU`, branch `m95b/u`, based on lane S's
reviewed `92ffb883`. This record covers the UI acceptance in D74/M95b,
not the sign-in, codec, dispatch or release acceptance of other lanes.

## Result and interfaces

- The selected ChatGPT model has **Using ChatGPT plan** and **Manage usage**
  beside the model pill. Copilot shows its plan and **Reduced**; a plan-key
  model uses its provider label and injected HTTPS limits URL. A bare Muse
  model gains no control. No model selection or paid call follows a link.
- ChatGPT's first-use notice explains the shared Plus/Pro allowance and the
  credit caveat. Browser acknowledgement persists in local storage;
  `App.planNoticePort` is an explicit injected interface for a host that
  needs acknowledgement once across its profile/windows. A read failure
  shows the notice. A write failure is reported through the existing bridge
  and remembered only for the current mounted surface.
- The plan-limit modal offers Manage usage, choose another model and close.
  It never switches billing automatically, invents a reset time, or infers
  a plan limit from an ordinary failure. It uses the latest completed turn
  and the selected ChatGPT provider; dismissal covers that failure only.
  Existing modal work takes precedence, and the composer stays inert while
  the deferred plan surface first loads.
- Account & usage renders requests, provider-reported tokens, estimated
  tokens, and requests with unknown token usage separately. Plan rows show
  no dollar price, quota or reset inferred from tokens. An old dollar cost
  in a provider row cannot override its plan pricing. The explanatory text
  states that plan allowance/credits are outside the app's dollar cap.
- Copilot's shared note names AI inaccuracy, its added rules and AI credits,
  and identifies unreported tokens as estimated. Report content opens the
  prescribed `mailto:copilot-partners@github.com` link through HostBridge.
- Twenty new UI strings are read at render time from `UI_TEXT.planUi` and
  translated in all 14 installed-language tables. Existing manifest text
  is unchanged; there is no new command, setting or dependency.

`usageReport.plans` is optional, validated by the shared protocol, and has
lane S's non-secret `planUsageSchema` shape. Validation is local to the UI
boundary so the activation bundle does not import provider implementation
code; the tests exercise the same positive/negative samples against both
schemas. Counts are nonnegative integers, provider IDs are valid and unique,
and reported/estimated request counts cannot exceed the total. V/X/W must
send these local tallies through this field. The UI does not fetch usage.

`modelOption.planLimitsUrl` is optional and accepts only an HTTPS URL. The
provider/preset wiring must pass the relevant public limits page together
with `pricing: 'plan'`, its provider ID and label. Built-in ChatGPT and
Copilot management URLs are constants. No credential or account identity
is added to either message shape.

Typed `turnCompleted.errorKind` survives the reducer and validated saved
transcript. The capture fallback also works while a host still emits the
generic `modelapi_error` kind. No service wire schema was invented here.

## Capture basis

The owner findings at `C:/lanes/_ctx/codex/M95B-FINDINGS.md` name the empty
workspace captures: run `acdc0f60…`, zero model attempts, and run
`577bc807…`, one counted attempt. The latter returned an HTTP 200 SSE error
whose message contains **Subscription Sharing usage limit**. Tests and the
fake harness use its exact full reason. The scrubber obscured the error
code, so the UI uses that distinctive captured phrase as well as the
planned typed `subscription_sharing_usage_limit_exceeded` kind. The owner
revoked the issued tokens. This lane made no live or paid call.

## Editor parity and ownership

All surfaces are shared React components behind the existing HostBridge,
with no VS Code import. Companion pages render the same App. JetBrains,
Visual Studio, Eclipse, Zed, Xcode, Neovim, Emacs and Sublime adapters can
pass the same model metadata, failures and usage report; they do not need
native widgets. The ACP/runtime tally and error producers remain X's
work. Copilot's native client remains available only where the editor
supplies it, as D74 specifies. Actual editor host smokes are the lead's
aggregate acceptance; this record claims shared rendering and fake-host
tests only.

W owns README, PRIVACY, CHANGELOG, PLAN, manifest wiring and the aggregate
certification. Handoff: document the plan allowance/credit caveat, the
limits recovery choices, estimated/unknown tokens, reduced Copilot and
report link; integrate the optional tally/limits metadata and the host's
profile acknowledgement port. The paid defaults, budget admission and
paid-use consent implementation are outside this UI lane and unchanged.

## Validation and failure drills

All tests ran directly on this Windows rig with at most three files and
`--maxWorkers=3 --testTimeout=120000`. The app/setup/plan batch passed
**159/159**. After the last account-label and layout correction, the full
plan/usage/composer batch passed **123/123**. The 16 new cases include bare
Muse behaviour, deferred loading, persistent and injected acknowledgement,
captured and typed failures, false-positive/stale-error refusal, dismissal,
Copilot links, custom plan keys, runtime localization, tally provenance,
unknown counts, dollar-label refusal, protocol validation and modal order.

`node scripts/check-l10n.mjs` passed: 14 tables, 127 manifest strings,
494 source files, zero problems. The first scoped accessibility run passed
40 pages (10 scenarios × four themes), zero violated/undecided rules,
zero exemptions, zero missing results. Final layout captures and checks
follow in the closing verification entry.

`node scripts/check-host-api.mjs` has exactly lane S's inherited failure:
the generated `node:crypto` count is 35 instead of 36. API membership is
unchanged. W/lead owns `docs/ide-compatibility/host-api.md` and must regenerate
and review it; this lane does not alter that record or weaken the check.

Full `quality`, coverage, live acceptance and release checks are reserved
for the lead under the rig brief. No aggregate-green claim is made.

## Deliberate regression proofs

Each of these 24 mutations ran the complete `m95PlanUi.test.tsx` file, exited
1, and failed the named regression. Each production file was restored from
its original bytes in `finally`; matching SHA-256 was required before the
next mutation. Tests were never filtered or skipped.

| Mutation               | Named regression that failed                                                             |
| ---------------------- | ---------------------------------------------------------------------------------------- |
| notice-ack             | acknowledges the notice once across remounts and explains credits and eligibility        |
| browser-persistence    | persists browser acknowledgement and fails closed when storage cannot be read            |
| captured-limit         | handles the captured SSE limit message even with a generic error kind                    |
| limit-soundness        | does not infer plan limits from ordinary failures, other providers or old turns          |
| provider-guard         | keeps a single bare Muse model unchanged                                                 |
| latest-turn            | does not infer plan limits from ordinary failures, other providers or old turns          |
| dismissal              | handles the captured SSE limit message even with a generic error kind                    |
| typed-error            | retains a typed plan failure through the reducer and a validated snapshot                |
| plan-cost              | shows plan rows in Account & usage and never displays an invented dollar cost            |
| plan-boundary          | validates plan tallies at the host boundary and retains the data in UI state             |
| limits-url             | validates plan tallies at the host boundary and retains the data in UI state             |
| unknown-tokens         | renders requests, reported and estimated tokens separately and marks unknown requests    |
| no-zero-invention      | leaves tokens unknown when a dispatched request has no usage instead of showing zero     |
| copilot-note           | shows Copilot reduced capabilities, AI content, credit caveat and the report destination |
| modal-order            | waits behind an existing modal and opens once that modal closes                          |
| loading-inert          | marks the ChatGPT pill and opens usage without a model or paid call                      |
| count-validation       | validates plan tallies at the host boundary and retains the data in UI state             |
| coverage-validation    | validates plan tallies at the host boundary and retains the data in UI state             |
| duplicate-validation   | validates plan tallies at the host boundary and retains the data in UI state             |
| provider-id-validation | validates plan tallies at the host boundary and retains the data in UI state             |
| provider-id-shape      | validates plan tallies at the host boundary and retains the data in UI state             |
| typed-snapshot         | retains a typed plan failure through the reducer and a validated snapshot                |
| plan-backend-label     | shows plan rows in Account & usage and never displays an invented dollar cost            |
| plan-signin-label      | shows plan rows in Account & usage and never displays an invented dollar cost            |

Restoration fingerprints (one row per source version exercised):

- src/webview/components/PlanUi.tsx:
  `97d0b814b82a890e3f1358365aa84a97066a0b445f5d90eb2b5b5f5e30b109c6`
- src/webview/App.tsx:
  `4aa712005eca76ccb2f2b1a99e9d83ac854b4b2b565efeb40276478431db4482`
- src/webview/state/uiState.ts:
  `7603505b8029b3d050c523abb4e758777e3c83c0ecc5ea6cbe7916e5afe1b443`
- src/webview/components/UsageDialog.tsx:
  `5ef0a32c9e2ef1056c496bc1479cdbb558da69c17084084591f21cdfca584450`
- src/shared/protocol.ts:
  `cca9e42f5a050a46ea274f106bd74b36a599947a30d3c9d7e6df95b1db1376f0`
- src/shared/usage.ts:
  `c28d71014636fb72a3047853090029113b07bf75ecbce5275b1377057eb3ccec`
- src/webview/state/transcriptEntries.ts:
  `e6628cb57ce13400845e93fa2b3edf02b42e39da6493202775fc63ef493bfead`
- src/webview/components/UsageDialog.tsx:
  `75d2d713e15dda58db5b00c9d065e0cf23c6705fe120d763dc0e36936d7a4ddb`
