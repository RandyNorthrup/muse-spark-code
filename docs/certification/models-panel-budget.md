# Models panel budget (lane PANELBUDGET)

Worktree `/home/randy/lanes/PANELBUDGET`, branch `fix/models-panel-budget`,
base `898a26c5e` (release 0.18.2). No behaviour change: the subscriptions
half of the panel's host side moves to its own first-use bundle; every call
site keeps its signature and its fail-closed refusal. No existing cap moves.

Production `npm run build` on this rig before: `dist/modelsPanel.js` is
**126,355 B** (123.4 KiB, cap 128,000 B — 1,645 B of headroom) against the
same two branches the brief names (`fix/catch-money` 128,289 B, over by 289;
`fix/provider-key-text` 131,767 B, over by 3,767) plus a Contributor mode
switch, a Fast mode switch and sliders still to land in the same panel.

## 1. What is in `dist/modelsPanel.js` (esbuild metafile, `bytesInOutput`)

"First paint" for this host bundle means `openPanel`: the factory, the
providers host, the session-budget config and the webview creation plus the
message schemas. The quick pick (`museSpark.addModelProvider`) and the
subscription actions (ChatGPT/Copilot connect, subscription add/remove) are
separate actions that never open the panel.

| Bytes  | Input                                        | Needed for first paint?                                          |
| ------ | -------------------------------------------- | ---------------------------------------------------------------- |
| 20,606 | `src/host/models/modelsPanel.ts`             | Yes: webview creation + message handlers                         |
| 13,012 | `src/shared/modelsPanel.ts`                  | Yes: panel message schemas (incl. team traffic + account slices) |
| 11,775 | `src/shared/team.ts`                         | Yes, via the traffic region above (not split: shared protocol)   |
| 8,489  | `src/shared/constants.ts`                    | Yes: shared (model text, limits)                                 |
| 7,835  | `src/shared/redact.ts`                       | Yes: read by `modelsPanel.ts`                                    |
| 7,099  | `src/host/providers/copilotClient.ts`        | **No**: only `subscriptionFeatures.ts` calls it                  |
| 5,851  | `src/host/models/modelsPanelEntry.ts`        | Yes: the bundle's entry                                          |
| 5,109  | `src/host/providers/wizardSave.ts`           | Wizard confirm click (stays: panel wizard path)                  |
| 5,004  | `src/host/models/modelsQuickPick.ts`         | Quick-pick command only (stays: same first action as the panel)  |
| 4,528  | `src/host/providers/chatgptSignIn.ts`        | **No**: only `subscriptionFeatures.ts` calls it                  |
| 3,944  | `src/host/providers/subscriptionFeatures.ts` | **No**: activation's subscriptions UI only                       |
| 3,513  | `src/host/providers/providersHost.ts`        | Yes: factory constructs it                                       |
| 2,953  | `src/shared/teamView.ts`                     | Yes, via `team.ts` above                                         |
| 2,320  | `src/host/providers/importExport.ts`         | Export/import clicks (stays: panel path)                         |
| 1,875  | `src/shared/usd.ts`                          | Stays: `modelsPanel.ts` + quick pick read it                     |
| 1,869  | `src/host/providers/oauthLoopback.ts`        | Stays: `providersHost` starts it                                 |
| 1,614  | `src/host/models/sessionBudget.ts`           | Yes: factory constructs it                                       |
| 1,591  | `src/host/providers/modelScans.ts`           | Stays: panel wizard scans                                        |
| 1,360  | `src/host/providers/providerRemoval.ts`      | Stays: panel removals + startup completion                       |
| 1,281  | `src/host/providers/openRouter.ts`           | Stays: `providersHost` reads key usage                           |
| 1,260  | `src/shared/usage.ts`                        | **No**: only `subscriptionFeatures.ts` reads it here             |

## 2. The move

New first-use chunk **`dist/modelsSubscriptions.js`** from
`src/host/models/modelsSubscriptionsEntry.ts`, following the
`dist/museCodeReviewer.js` pattern: the entry re-exports
`createSubscriptionFeatures`, activation requires it on the first
subscription action through `modelsSubscriptionsLoader`
(`src/host/models/modelsSubscriptionsBundle.ts`), and a missing or
misshapen bundle refuses with `UI_TEXT.modelsPanelUnavailable` (no new
strings, so no locale work). `src/host/models/modelsPanelEntry.ts` no longer
re-exports the factory; `ModelsPanelBundle` drops the member. The moved
modules require the sibling `providers.js`, `subscriptions.js`,
`modelApi.js`, `validation.js` and `uiText.js` (no copies: the
`deferredCohort`/`sharedValidation`/`sharedUiText` plugins, verified in the
built text). Its own budget line follows D6's rule.

Sizes after (`npm run build`, production):

- `dist/modelsPanel.js` **109,327 B** (106.8 KiB; cap 128,000 B) — 17,028 B
  freed, **18,673 B of headroom** (14.6%).
- `dist/modelsSubscriptions.js` **22,917 B** (22.4 KiB; new 50 KiB budget:
  22,917 × 1.15 = 26,354.55 B, rounded up to the next 25 KiB multiple).
- Every other bundle within its budget (`check-bundle-size.mjs` exit 0;
  full line list in §5).

Projected headroom for the two branches once the lead merges this under
them (their additions, measured on this base, minus the 17,028 B freed
here): `fix/catch-money` ≈ 111,261 B (108.7 KiB, ~16.7 KiB of margin);
`fix/provider-key-text` ≈ 114,739 B (112.1 KiB, ~13.3 KiB of margin).

## 3. Gate-fire drills (real command output, byte-exact restores)

Size gate red (budget planted at 10 KiB, `scripts/check-bundle-size.mjs`
SHA-256 `6d35f4b39e584afc35b6bf4f2cbc3e45b36be6aa19c7a53b621d6d14fafb2379`
before and after):

```text
OVER dist/modelsSubscriptions.js: 22.4 KiB (budget 10 KiB)
```

exit 1. Restored with `git checkout --` and re-applied the same lines
(SHA-256 matches; the gate is green again, §5).

Split-gate red (a file the panel genuinely carries planted in the new
chunk's `files` list, `scripts/lib/deferredBundles.mjs` SHA-256
`eac86eaaeaa70e50d8bc7387f21ecc80f6c96754c286db63851616a987cc203a`
before and after):

```text
bundle split: 2 problem(s); see PLAN.md D6 and M57
  dist/modelsPanel.js carries src/host/models/modelsPanelEntry.ts, which loads only on the first subscription action
```

exit 1. Restored from a `$TMPDIR` backup copy (SHA-256 matches).

## 4. Tests (repository default timeouts throughout)

Panel and sections, through the real modules, all green:

- `modelsSubscriptionsBundle.test.ts` (new, 3), `modelsPanelBundle.test.ts`
  (5), `providerCredentialStore.test.ts` (9), `modelsPanelEntry.test.ts`
  (6), `modelsQuickPick.test.ts` (8), `providerProvidersHost.test.ts` (10),
  `modelsPanel.test.ts` + `providerWizardSave.test.ts` +
  `providerImportExport.test.ts` (63), `providerModelScans.test.ts` (10) +
  `providerRemoval.test.ts` (7) + `sessionBudget.test.ts` (42),
  `wizardSessionBudget.test.ts` + `modelsPanelSchemas.test.ts` +
  `modelsPanelReducer.test.ts` (69).
- `deferredBundles.test.ts`: 125/126. The one failure,
  `installs the caller language in the compiled subscription command
factory`, pins the old location (`loadSupportBundle('modelsPanel')`
  exporting `createSubscriptionFeatures`) and stands the editor API in with
  hand-written fakes: named and left untouched per the 2026-10-12 testing
  rules (TESTCUT owns that file). The same behaviour at the new location is
  proven by the built-bundle check below.
- `gitActivationWiring` (7), `judgeActivation` (6),
  `teamActivationGraph` (1), `modelsActivationBudget` (1; growth 2,986 B ≤
  3,072 B limit — 86 B of headroom left for activation).
- `lazyBundleFiles.test.ts` (13), `packagedBundles.test.mjs` (8: the new
  bundle ships in the VSIX).
- `subscriptionIntegration.test.ts` + `configuredProviders.test.ts`: the
  same 5 loopback tests time out at 5 s here AND on the untouched base
  `898a26c5e` in a clean worktree (identical names, same conditions) — the
  sandbox blocks loopback here; not this change.
- Built-bundle check (real product bytes): `dist/modelsSubscriptions.js`
  exports `createSubscriptionFeatures` and requires its five siblings;
  `dist/modelsPanel.js` contains none of `connectCopilotFromClick`,
  `createChatGptSignIn`, `copilotClient`, `chatgptSignIn`,
  `subscriptionFeatures.ts`.

Not run: no browser look (no UI change — no webview, text or theme touched;
per the 2026-10-12 rules the lead takes the small local look only for UI
changes); `test/e2e/execStdio.e2e.test.ts` is the packed ACP agent, which
this change does not touch (VS Code host side only) — per rule 6 the
packaging suite above stands in, and the real-life steps below are the
product proof.

## 5. Gates (final tree)

Full `npm run build` exit 0, including `check-bundle-size.mjs`,
`check-bundle-split.mjs` (`ok dist/modelsSubscriptions.js: loads only on
the first subscription action, never at activation`),
`gen-lazy-registry.mjs --check` and `check-host-globals.mjs`. Remaining
gates and their exit codes are in the lane report.

## Real-life steps (for the lead's run)

1. Open the Models & Agents panel (`Muse Spark: Manage Model Providers`):
   the panel opens with providers, models and sections as before; first
   paint loads `dist/modelsPanel.js` only (no `modelsSubscriptions.js` in
   the trace).
2. `Muse Spark: Add Model Provider…`: the quick pick runs end to end
   without the panel.
3. Connect ChatGPT / Connect Copilot from the panel or the account menu:
   the sign-in flows run; this is the first load of
   `dist/modelsSubscriptions.js`.
4. Break it: rename `dist/modelsSubscriptions.js` away and run a
   subscription action: the panel-unavailable refusal names the Models
   panel, and the log (not the notice) has the path and cause.
