# PROVCAT — the provider picker's category contract

Recorded 2026-10-09 in `mx-provcat`, branch `fix/provider-category`, from
`67099ce1b` (main after 0.16.0). Scope: the Models & Agents panel's preset
cards (`src/shared/modelsPanel.ts`, `src/host/models/modelsPanel.ts`), the
host's chip type (`src/host/providers/providerPorts.ts`) and the panel
catalogue (`src/core/providers/panelSeam.ts`). No credential handling,
endpoint policy, dependency or model call changed. Ships in 0.17.1.

## Failure

Reported by the owner on the installed 0.16.0 and confirmed on `main`:
Models & Agents → Providers → Add showed "That did not work (the Muse Spark
log has the details)" and an empty dropdown. The log held only
`Models panel operation failed` (twice, 11:29:11 and 11:29:38).

## Cause

- The panel catalogue gives Mistral's plan key (`mistral-plan`) the kind
  `subscription` (`panelSeam.ts`), which the host's `PresetKind` allows and
  the wizard's Subscription sign-in chip filters on.
- The shared card schema's `category` enum had only `cloud`, `local`,
  `aggregator` and `custom`. `refresh()` validated each card and threw on
  the first refusal, so the whole preset list was lost and the panel showed
  the generic failure. Anthropic and every other provider disappeared with it.
- Two more drifts of the same contract: ChatGPT and Copilot were catalogued
  as `cloud`, so the Subscription sign-in chip never showed them (M95b puts
  them there); and the Custom server preset, which the wizard, the quick
  pick and the transport all handle, was filtered out of the catalogue with
  the presets that lack a wire capture. The 10-07 repair had added the local
  presets back the same way but not Custom.
- The existing panel tests used a two-preset fixture catalogue, so no test
  ever rendered a real preset card.

## Correction

- `presetCardSchema.category` gains `subscription`; `PresetKind` is now
  `Exclude<PresetCard['category'], 'custom'>`, so a new host kind is a type
  error instead of a runtime refusal.
- ChatGPT and Copilot are catalogued as `subscription`; Custom server is in
  the catalogue beside the local presets (Azure, which lacks a capture,
  stays out under rule 13).
- A card the contract refuses is left out alone. The log line names the
  preset id and the refused field paths only. Preset data is fixed and
  holds no key; exception text is still never logged.

## Tests

`test/unit/modelsPanel.test.ts`, "Models panel over the shipped preset
catalogue", built on the production `createModelsPanelSeam` catalogue:

1. Every catalogue preset reaches the panel state in order, with no warning;
   Anthropic is Cloud, OpenRouter Aggregator, Ollama On this computer,
   Custom custom, and Mistral plan, ChatGPT and Copilot Subscription sign-in.
   Every preset is then selected: key and local presets open the configure
   step, ChatGPT and Copilot run their sign-in and scan.
2. Anthropic and a custom server (address and Chat Completions format) are
   added end to end: key entry, free key test, model tick, save. The stored
   entry matches and the key never appears in any panel message.
3. A preset with a refused field is left out alone; Anthropic still lists,
   no failure notice is set, and the one log line is
   `Provider preset mistral-plan left out of the panel: format`.

Mac mini rig, Node 22: `modelsPanel`, `providerPanelSeam`, `planKeyPresets`,
`configuredProviders`, `modelsApp`, `modelsWebviewEntry`, `modelsQuickPick`:
7 files, 58 tests passed. Host: prettier, changed-file ESLint and
`tsc --noEmit` exit 0.

## Red drills

Each break was applied to the working tree, run on the Mac mini, and the
file restored byte-exact (SHA-256 compared).

| Break                                             | Result                      |
| ------------------------------------------------- | --------------------------- |
| `subscription` removed from the card enum         | 3 of the 3 new tests fail   |
| A refused card throws again (old behaviour)       | test 3 fails                |
| Custom server filtered out of the catalogue again | tests 1 and 2 (custom) fail |

## Installed check

The VSIX built from this branch replaces the installed 0.16.0 (still
version 0.16.0, so Marketplace 0.17.0 updates over it). Recorded in the
lead's ledger with the panel walk-through.

---

# PROVWIZ2 round 2 — closing the four RVPROVCAT findings

Recorded 2026-10-09 in the PROVWIZ2 lane, branch `fix/provider-wizard2`,
same worktree and branch as round 1. The read-only review RVPROVCAT (base
`e7bf0e140`) confirmed four P2 findings; all four are closed below, each
with a regression test that fails before its fix (drills at the end, every
break restored byte-exact by SHA-256). Ten UI strings were added in all 14
language tables with real translations (`npm run check:l10n` 0 problems).

Overclaim corrected: round 1's "adds a custom server end to end" used the
memory store, which does not enforce the production file's contract, so it
never proved a custom save. The CHANGELOG entry above now says so, and the
new custom regression below saves through `createModelsPanelSeam(...).store`
on a temporary real file and asserts the saved file's contents.

## 1. A custom server saves its per-model limits through the production store

`providerEntrySchema` requires `modelLimits` for every chosen model of a
`custom` entry, but the wizard never collected them. Now the draft carries
`modelLimits` (`draftModelLimitsSchema` in `src/shared/modelsPanel.ts`,
partial while the wizard asks; also on `prefillFieldsSchema`), the scan
prefills each listed model's reported context window without overwriting
entered values (`scan` in `src/host/models/modelsPanel.ts`), the models step
(`src/webview/models/Wizard.tsx`) asks per ticked model for "Context window
(tokens)" and "Longest reply (tokens)", and the host keeps Save (and every
Continue) disabled with `customLimitsMissing` until each ticked model has
valid limits (`syncDraftBlockers`, run after every panel message).
`draftEntry()` carries only complete limits, and the quick pick's custom
path (`src/host/models/modelsQuickPick.ts`) asks both counts per chosen
model (re-asking after invalid input, aborting on dismiss) before saving.
Unticking a model drops its limits. The wizard's tick comparisons now use
the bare model id the draft holds (the full ref never matched, so ticked
rows showed unchecked and could not be unticked).

Tests: `modelsPanel.test.ts` "saves a custom server with per-model limits
through the production store" (real seam store on a temp file: scan-prefill
asserted, blocker asserted before/after the limits prefill, saved file
asserted to hold the limits); `modelsQuickPick.test.ts` "asks a custom
server for every chosen model's limits and saves them";
`modelsPanelSections.test.tsx` "asks each ticked custom model for its
limits and gates Continue on them".

## 2. The Test that asked for consent uses it

The `providers/test` handler built the tested entry before the native
private-network question, so the first accepted Test still sent
`privateNetwork: false` and the transport refused it. Now the handler
rebuilds the entry after consent (`testedEntry` carries `privateNetwork:
true`) and uses it for the key test and the follow-up draft scan alike.

Tests: `modelsPanel.test.ts` "tests a private endpoint with the consent
just granted" (real endpoint policy, private DNS answer, accept once: the
key test receives the grant and sends once, the scan receives it too, the
draft shows the result) and "sends nothing when the private-network
question is declined" (neither test nor scan runs).

## 3. One stale card never hides valid saved providers

`refresh()` threw when a saved provider's preset card was refused, losing
every configured row. Now the affected provider stays listed as unavailable
with its plain reason (`unavailable` on `providerStateSchema`;
`providerPresetUnsupported`, naming the provider label and the technical
preset id) and the same value-free log style as the card skip
(`Provider <id> left out of the panel: <preset>`); the row is still
schema-validated and removable. `format` is optional on the row because an
unreadable card cannot supply one and nothing renders it.

Tests: `modelsPanel.test.ts` "keeps valid saved providers when one preset
card is refused" (saved Anthropic + mistral-plan, refused mistral-plan card:
Anthropic's row is published, mistral-plan's row carries the reason, no
failure notice, both log lines asserted);
`modelsPanelSections.test.tsx` "shows a saved provider with a refused card
as unavailable with its reason".

## 4. Sign-in rows follow availability, and selection refuses early

The picker offered ChatGPT and Copilot even where the host reports them
unavailable, and `providers/select` called the connector before failing.
Now the pick step (`signInReason` in `src/webview/models/Wizard.tsx`) hides
Copilot in a confidential workspace (the README's rule) and otherwise shows
an unavailable sign-in disabled with its reason (`signInNotOffered`,
`signInRemoteWindow`; `SearchableSelect` renders disabled rows and never
selects them by click or keyboard). The host (`subscriptionRefusal` in
`src/host/models/modelsPanel.ts`) refuses `providers/select` and
`providers/connectSubscription` with the specific reason before any
connector runs (ChatGPT: no connector, or a remote window per
`chatgptSignIn.ts`; Copilot: confidential workspace per
`planUi.copilotConfidential`, or no connector). The state carries
`remoteWindow` and `confidentialWorkspace` for the picker.

Tests: `modelsPanel.test.ts` "refuses ChatGPT sign-in in a remote window…",
"refuses Copilot sign-in in a confidential workspace…", "refuses a sign-in
with no connector as not offered here" (connectors never called, specific
notices); `modelsPanelSections.test.tsx` "hides Copilot in a confidential
workspace and offers ChatGPT", "disables ChatGPT in a remote window with
its reason and never selects it", "disables a sign-in with no connector as
not offered, and picks an offered one".

## Round 2 red drills

Each break was applied to the working tree, run on the Mac mini, and the
file restored byte-exact (SHA-256 compared).

| Break                                              | Result                                                     |
| -------------------------------------------------- | ---------------------------------------------------------- |
| `draftEntry` skips custom limits (`custom-broken`) | custom production-save test fails                          |
| Test uses the pre-consent entry                    | private-consent test fails (grant missing)                 |
| `refresh` throws on a refused card again           | stale-card test fails                                      |
| `providers/select` ignores the refusal             | remote-window test fails (connector runs, generic failure) |
| Picker ignores the remote window                   | remote-disabled webview test fails                         |
| Quick pick skips the custom limits                 | quick-pick custom test fails                               |
| Continue ignores blockers                          | limits-gating webview test fails                           |

---

# PROVWIZ2 — the provider wizard's scan, plan key and sign-in text

Recorded 2026-10-09 in the PROVWIZ2 lane, branch `fix/provider-wizard2`,
from `fix/provider-category e7bf0e140`. A user-journey review (RVUXFLOW,
journey 2) found three problems in the same wizard; all three are fixed in
plain words, in all 14 languages (`npm run check:l10n` 0 problems). Ships
in 0.17.1.

## 1. Scan this computer offers every answer

`providers/scanLocal` (`src/host/models/modelsPanel.ts`) kept only the
first local server that answered, wrote an `address` straight into a draft,
and the next screen asked for **Local port** without using it (`newDraft`
never set `loopbackPort`). Two running servers: the second was never
offered. Nothing running: the button returned to the list with no sentence.

Now the host probes every local preset through its catalogue `localProbes`
(the existing loopback-only probe and endpoint policy; nothing else is
contacted) and records `state.localScan` (`src/shared/modelsPanel.ts`):
`found` holds each server that answered, `checked` each local app with its
usual port, both with the preset's own label and port, never hard-coded.
The pick step (`src/webview/models/Wizard.tsx`) shows each answer as a
choice ("Ollama on port 11434"); choosing one posts `providers/select`
then `providers/prefill` with that port, opening the preset's wizard with
`loopbackPort` filled. An empty run says "Nothing is running on this
computer yet." and lists each local app with its usual port. `newDraft`
starts a local preset on its usual port (probe data), and the prefill
address derivation reads the loopback host from the same data.

## 2. The plan key has its own label and sentence

`mistral-plan` (`PLAN_KEY_PRESETS` in `src/core/providers/presets.ts`)
reused Mistral's label and description, so a plan key looked like a
pay-as-you-go key. It now reads "Mistral plan" (`providerText.labels.
mistralPlan`) with one sentence saying it uses the Mistral subscription's
credits, not pay-as-you-go billing (`providerText.descriptions.
mistralPlan`). Key shape, origin, key hint, key test, quirks and capture
still reference Mistral's entries unchanged.

## 3. Each sign-in button has its own sentence

The ChatGPT notice (`acpChatGpt.notice`) was printed under the Copilot
button too (`src/webview/models/ProvidersSection.tsx`). Copilot now gets
its own sentence (`planUi.copilotNotice`): the Copilot models granted to
VS Code, billed to the Copilot plan or AI credits — checked against
`src/host/providers/copilotClient.ts` (the `vscode.lm` grant, host
consent) and the README's Subscriptions section (Copilot plan or AI
credits under GitHub's terms). ChatGPT keeps its notice. The catalogue
description (`src/core/providers/panelSeam.ts`) and the subscription row
use the same sentence.

## Tests

`test/unit/modelsPanel.test.ts`, "shipped preset catalogue" suite (real
catalogue), plus two webview tests in
`test/unit/modelsPanelSections.test.tsx`:

1. `offers every answering local server and fills the chosen port` — two
   answering (11434, 1234) are both offered in catalogue order from preset
   data; no wizard and no failure notice; choosing one fills the port;
   a fresh local wizard starts on its usual port.
2. `says nothing is running when no local server answers` — `found` is
   empty, `checked` names all four local apps with their usual ports, no
   wizard, no notice, no warnings.
3. `gives the Mistral plan key its own label and sentence` — label and
   description differ from Mistral's; the description names the
   subscription.
4. `gives Copilot its own sentence, not ChatGPT's` — description differs
   from ChatGPT's and names the Copilot plan.
5. Webview `offers each answering server and fills its port on choice` —
   the "Ollama on port 11434" button posts `providers/select` then the
   `loopbackPort` prefill (port ungrouped: "11434", never "11,434").
6. Webview `says nothing is running and names each usual port` — the
   sentence plus each usual port, with no message posted.

Mac mini rig, Node 22: `modelsPanel` (17 tests) and
`modelsPanelSections` (21 tests) pass. Host: prettier, changed-file
ESLint and `tsc --noEmit` exit 0; `check:l10n` and `check:reference`
pass.

## Red drills

Each break was applied to the working tree, run on the Mac mini, and the
file restored byte-exact (SHA-256 compared against the pre-drill record).

| Break                                                                | Result       |
| -------------------------------------------------------------------- | ------------ |
| `scanLocal` keeps only the first answer (`break` after `found.push`) | test 1 fails |
| `newDraft` drops `loopbackPort`                                      | test 1 fails |
| Empty scan drops the `checked` usual-port list                       | test 2 fails |
| `mistral-plan` reuses Mistral's label and description                | test 3 fails |
| Copilot description back to the AI-content note                      | test 4 fails |
| Pick step hides the found choices (`found.length > 99`)              | test 5 fails |
| Empty sentence replaced with the scan button label                   | test 6 fails |

# PROVWIZ2 round 3 — the wizard's spending limit is the real one (RVSETTINGSIA F1, P1)

Recorded 2026-10-09 in the PROVWIZ2 lane, branch `fix/provider-wizard2`,
same worktree and branch as rounds 1 and 2. The read-only review
RVSETTINGSIA reported F1: the provider wizard and its quick-pick fallback
accept a "Session budget" and report setup success, but the value never
reaches the cap spending enforcement reads
(`museSpark.modelApiSessionBudgetUsd`): a user who typed USD 2 stayed
unlimited. No hidden per-wizard cap, no silent overwrite — the fix below
wires both save paths through one shared function to the setting itself.
Seven UI strings were added in all 14 language tables with real
translations (`npm run check:l10n` 0 problems).

BUDGET NOTE (lead): the two bundle budgets this round touches now read
`dist/modelsPanel.js` 100.8 KiB of 125 and `dist/webview surface English`
25,597 bytes of 25,600 — three bytes of headroom. The panel bundle first
blew past 125 KiB (147.2) because the shared function read through the
full settings reader; it now parses only its own key with the setting's
own schema (the canonical reader stays in `host/settings.ts`, and the
round-3 tests still assert admission through the real `readSettings`).
The surface-English closure then read 25,645 bytes: the template and
scope words moved host-side (`state.sessionBudget.nowLine`, worded like
any error) and the field's inline error became a disabled Continue, so
the lazy webview bundle carries only the field label. The remaining
`wizardSessionBudgetInvalid` key stays in every table for the quick
pick's host-side error. The next lane that adds any lazy-surface string
will trip the 25 KiB cap; re-measuring it is the owner's call per D6,
not this lane's.

## 1. One shared function applies the wizard's number to the setting

`src/host/models/sessionBudget.ts` (new, VS Code-free): `createSessionBudgetConfig`
adapts a narrow get/inspect/update surface (VS Code's configuration in
production, memory in tests), and `applyWizardSessionBudget` is the single
function both save paths call. `undefined` (untouched) and a number equal
to the effective value write nothing; anything else is validated with the
setting's own schema (`legacyUsdSchema`: non-negative exact-decimal USD)
and written at the scope the value is effective from today — an existing
workspace value is written at workspace scope, a global one at global
scope, never moved. A rejected write, or a write after which the setting
still reads the old value (a more specific scope still wins), returns the
specific reason. Enforcement is not duplicated: the admission path keeps
reading `sessionBudgetUsd()` per request, which is
`currentSettings().modelApiSessionBudgetUsd`.

## 2. The panel writes on Save, after the provider, and keeps the draft on failure

Corrected to the round-4 order: `src/host/models/modelsPanel.ts`
(`providers/save`) completes `saveDraft` before applying the draft's number.
A provider-transaction failure leaves the spending limit unchanged. A later
limit-write failure keeps the saved provider and the draft's typed value,
reports "Provider saved; the spending limit was not changed" with its specific
reason, and never reaches `onWizardSaved`, so no full setup success is reported.
A retry edits the already saved provider instead of adding a duplicate.
`refresh()` publishes `state.sessionBudget` (effective value plus scope),
backed by the new `ModelsPanelDeps.sessionBudget`; the new required field
in `modelsPanelStateSchema` carries it to the webview.

## 3. The suggestions step is the setting's field, committed on Continue

`src/webview/models/Wizard.tsx`: the budget suggestion card and its
separate Change press are gone. The field is labelled "Spending limit per
conversation (USD, 0 = no limit)", prefilled with the effective value,
with the host-worded line "This is your setting for every conversation;
it is $X now (scope)" (`state.sessionBudget.nowLine`, formatted host-side
like any error so the lazy webview bundle carries no template for it).
The typed number is committed with `suggestions/change` on Continue (then
`next`) and therefore counts on Save too; an unparseable number disables
Continue — nothing is saved until the field holds a non-negative dollar
amount, and the wording of the failure stays host-side with the write.
The host's `suggestions/change` handler commits an explicit `usd`
directly instead of requiring a suggestion entry to exist (none is built
for the budget).

## 4. The quick pick prefills the same value and no longer drops it

`src/host/models/modelsQuickPick.ts` asks one budget input prefilled with
the effective value (scope named in its hint), re-asks after an invalid
answer instead of saving advisory garbage, and applies the typed number
through the same shared function after `saveDraft` (the round-4 order).
A later limit-write failure leaves the provider saved, reports that partial
success with its specific reason, and reports no full setup success.
`ProviderQuickPickOutcome`
carries the answered `sessionBudgetUsd`, and `modelsPanelEntry.ts`
forwards it to `onWizardSaved` instead of the previous explicit
`undefined`. The entry builds the one VS Code-backed configuration both
paths share.

## Tests

`test/unit/wizardSessionBudget.test.ts` (13 tests: the shared function,
the panel path end to end, the quick-pick path with a scripted UI):

1. Untouched writes nothing.
2. A number equal to the effective value writes nothing.
3. A changed number writes at the global scope it is effective from.
4. An existing workspace value is written at the workspace scope.
5. A negative amount is refused with the setting-schema error, unwritten.
6. A failed write returns the specific error.
7. Panel: the changed budget is written, `onWizardSaved` carries it, the
   published state shows the new effective value, and the next admission
   sees the new cap — the cap is re-read through the real `readSettings`
   reader, unlimited (`!isPositiveUsd`) before the write and a
   `SessionBudgetExceededError` from the real `reserveRequest` admission
   arithmetic on a request that no longer fits after it.
8. Panel: unchanged writes nothing, setup still succeeds.
9. Panel: in the corrected round-4 order, a failed limit write keeps the
   draft and its typed value, shows partial success and the specific error in
   `draft.errors`, never calls `onWizardSaved`, and leaves the provider saved.
10. Quick pick: the typed budget is written through the shared function;
    the field's title, prefill and scope hint are asserted on the input
    call; the success banner names the saved provider and model.
11. Quick pick: an unchanged number writes nothing.
12. Quick pick: in the corrected round-4 order, a failed limit write reports
    partial success and the specific error, shows no setup-success banner,
    returns `undefined`, and leaves the provider saved.
13. Quick pick: an invalid answer is refused with the specific error and
    asked again, never saved silently.

`test/unit/modelsPanelSections.test.tsx`: the suggestions step shows the
label, the prefill and the host-worded $X/scope line; Continue posts
`suggestions/change` then `next`; an unparseable number disables
Continue and posts nothing. The round-2 budget-card test now covers the
field instead.
`test/unit/modelsPanelEntry.test.ts`: the VS Code quick pick answers 2
and the value reaches the stubbed configuration (this also found a real
mock gap — the `vscode` mock had no `ConfigurationTarget`, so the
production scope routing threw there; `test/unit/mocks/vscode.ts` now
mirrors the real enum values).

Mac mini rig, Node 22, repository-default timeouts throughout:
`wizardSessionBudget` (13) + `modelsPanelSections` (29) +
`modelsQuickPick` (8) = 50 pass; `modelsPanel` (24) +
`modelsPanelEntry` (6) + `modelsPanelBundle` (5) = 35 pass;
`modelsPanelReducer` + `modelsPanelSchemas` + `providerWizardSave` = 27
pass; `manifest` + `providersL10n` + `planKeyPresets` = 56 pass. Host,
unit and webview `tsc --noEmit` exit 0; prettier, changed-file ESLint,
`npm run deadcode` (only three pre-existing untouched findings),
`check:l10n` (0 problems) and `check:reference` pass; `npm run build`
fits every bundle budget.

## PROVWIZ2 round 3 red drills

Each break was applied to the working tree, run on the Mac mini, and the
file restored byte-exact (SHA-256 compared against the pre-drill record
for all four implementation files after every drill). The first pass ran
before the bundle-budget rework below; all five were re-run against the
final code with the same failures and byte-exact restores.

| Break                                                                       | Result                                                             |
| --------------------------------------------------------------------------- | ------------------------------------------------------------------ |
| Shared function: `=== 0` inverted to `!== 0` (changed counts as unchanged)  | 11 failures in `wizardSessionBudget`                               |
| Panel save passes `undefined` instead of the draft's number                 | 2 panel-path failures                                              |
| Quick pick passes `undefined` instead of the typed number                   | 4 failures (`wizardSessionBudget` quick-pick ×3, entry quick pick) |
| Webview Continue posts `next` without the `suggestions/change` commit       | 2 failures in `modelsPanelSections`                                |
| Host `suggestions/change` requires a suggestion entry that no longer exists | 3 panel-path failures                                              |

---

# PROVWIZ2 round 4 — RVPROVWIZ2 (2026-10-09, macmini)

The lane follows the owner's five decisions in the rig brief. Full aggregate
quality is reserved for the lead; all lane checks use repository deadlines,
with at most three test files per invocation and no paid/live calls.

## P3: the native numeric setting boundary

`createSessionBudgetConfig.write` converts the exact USD value to the
contributed non-negative number and validates its round-trip before updating
VS Code. Decimal rounding and overflow are refused. The production adapter
regression now expects numeric `2`, while admission keeps exact decimal USD.
Four added regressions failed before the repair (string write, precision loss,
unsafe integer rounding, overflow). The repaired `wizardSessionBudget` and
`modelsPanelEntry` suites pass all 23 tests at repository deadlines.

Deliberate source breaks, each restored byte-exact with SHA-256:

| Break                                        | Failures | Original and restored SHA-256                                      |
| -------------------------------------------- | -------- | ------------------------------------------------------------------ |
| Write the exact string instead of the number | 2/23     | `01b2f5021dffca25a74ad67d89d1aba9f37608fc1a7cbe95dcea91da32a51c76` |
| Remove the numeric round-trip guard          | 2/17     | `01b2f5021dffca25a74ad67d89d1aba9f37608fc1a7cbe95dcea91da32a51c76` |

No native Settings UI is claimed; these tests observe the real production
writer/adapter update and exact-decimal admission reader with fake VS Code.

## P2-3 and P2-4: saved custom limits and reversible navigation

The Edit and Change key paths seed `modelLimits` and the saved wire format.
Edit renders the same `ModelLimitsFields` controls as Models; fields post the
existing validated prefill message. Two regressions seed a saved custom
provider via the real save transaction on a temporary production file, edit
its endpoint and limits, re-test, save, and re-read the production store.
The rendered edit regression checks both prefills and the targeted update.

Custom-limit blockers apply on Models and subsequent steps, and always on
saved-provider edits and final Save. Earlier wizard steps allow returning to
Models; no limit is erased on Back. The navigation regression drives the
actual host, retains an incomplete limit through Test and back to Models,
and verifies final Save never calls provider persistence while incomplete.
The old memory-store custom fixture now supplies valid limits too: final
validation deliberately caught its previously incomplete success fixture.

Before the repair the two saved-draft tests, the edit-fields test and the
navigation test failed their expected behavior assertions. The completed
`modelsPanel` and `modelsPanelSections` suites pass 57 tests after restoring
all drills, at repository deadlines. Changed-file ESLint passes.

| Deliberate break                                   | Failures | Original and restored SHA-256                                      |
| -------------------------------------------------- | -------- | ------------------------------------------------------------------ |
| Drop stored limits when Edit seeds its draft       | 1/27     | `bca84884456ba623ef2ce7dcf49d5b45451349650b6c2a8b53379ed20ee90c31` |
| Drop stored limits when Change key seeds its draft | 1/27     | `bca84884456ba623ef2ce7dcf49d5b45451349650b6c2a8b53379ed20ee90c31` |
| Hide the custom limit fields in Edit               | 1/30     | `6c5fefb041af57d2eaf1b8c0d06b174ca73b62229aade352fcd5465bc7fe804b` |
| Apply custom-limit blockers on earlier steps again | 1/27     | `bca84884456ba623ef2ce7dcf49d5b45451349650b6c2a8b53379ed20ee90c31` |
| Remove final Save's blocker guard                  | 1/27     | `bca84884456ba623ef2ce7dcf49d5b45451349650b6c2a8b53379ed20ee90c31` |

The shared webview changes remain behind the existing host bridge; persisted
custom limits are read by ACP through the same production provider schema.
Native-editor rendering and installation are not claimed by these tests.

## P2-1 and P2-2: edited-only compare-and-set, provider-first saves

Suggestions tracks an edit separately from its displayed prefill. Untouched
inputs follow refreshed state and Continue posts only `next`; an edit sends
its original prefill with its exact amount. The host retains both through
confirmation. Both save paths complete the production provider transaction
before the shared budget writer re-reads the effective setting. A mismatch
shows the new current limit and the retained requested limit. The panel
requires another Save; the quick pick asks a second native confirmation and
rechecks after it. Accepting a quick-pick prefill unchanged carries no edit.

A provider failure never reaches the budget write. A later budget failure
says `Provider saved; the spending limit was not changed: <reason>` and
reports no full setup success. The panel retains its draft and treats its
next save as an edit of the already saved entry, preventing duplicate-add
failure. The two new messages have real translations in all 14 UI tables.
The provider feature reference now includes the spending-limit setting.

Regressions in `wizardSessionBudget` use the actual host/save transaction,
credential adapter, production provider file/schema and production settings
writer. VS Code, credentials and service answers are synthetic; no paid/live
request is made. Provider, credential, default and composer failures are
injected at their actual persistence/selection boundaries in both paths.
Additional cases cover untouched concurrent changes, a setting change during
the provider transaction, panel confirmation and retry, quick-pick accept and
deny, a quick-pick limit-write failure, and a missing prefill. The existing
`modelsPanelEntry` test now combines the real production provider file with
the real VS Code settings adapter (captured numeric update).

Before repair the twelve newly added host/save assertions failed for the
reported behavior. The two webview refresh/edit assertions also failed on
round 3. After repair and all restored drills, `wizardSessionBudget` (33),
`modelsPanelSections` (32), and `modelsQuickPick` (8) pass 73 tests at the
repository's default deadlines.

| Deliberate break                                 | Failures | Original and restored SHA-256                                      |
| ------------------------------------------------ | -------- | ------------------------------------------------------------------ |
| Remove compare-and-set before the write          | 3/33     | `350ad5a7da4b0ebc7407a83b464c105ab1835232127ab3c03bbc456de846bbcb` |
| Remove the missing-prefill guard                 | 1/33     | `350ad5a7da4b0ebc7407a83b464c105ab1835232127ab3c03bbc456de846bbcb` |
| Continue proposes an untouched field             | 1/32     | `87d37949cd26bf7f4332deec24190b377865c2b28e8316988038e0266e2f8cbe` |
| Quick pick proposes its unchanged prefill        | 2/33     | `31fe723d5a29c589d40661ef846ae8c7d379fde442a1590bb036edf2710cd625` |
| Panel writes the limit before provider save      | 6/33     | `45b3b32240259b43efe0097257bca01f0beb436466928b200ebadc13cd497112` |
| Quick pick writes the limit before provider save | 7/33     | `31fe723d5a29c589d40661ef846ae8c7d379fde442a1590bb036edf2710cd625` |
| Panel retries a partial save as a duplicate add  | 2/33     | `45b3b32240259b43efe0097257bca01f0beb436466928b200ebadc13cd497112` |
| Quick pick silently confirms a concurrent edit   | 2/33     | `31fe723d5a29c589d40661ef846ae8c7d379fde442a1590bb036edf2710cd625` |

Commit review caught an orchestration error: editing translations while the
second commit hook was running added those otherwise unstaged files to that
commit. The committed diff was compared with the saved staged diff and every
added translation reviewed; implementation changes matched the staged diff.
G66 in `docs/orchestration-gotchas.md` records the rule to freeze all edits
until the hook finishes. Hooks and history were not changed. Final static,
localization and build checks include those committed translations.

## Final complete-suite verification (macmini)

All runs use the repository timeout, `--maxWorkers=3`, complete files and no
per-run timeout override. Nine batches passed 27 distinct files, 504 tests:

| Files (`test/unit/`)                                               | Tests | Exit |
| ------------------------------------------------------------------ | ----: | ---: |
| modelsPanel, wizardSessionBudget, modelsPanelSections              |    92 |    0 |
| modelsQuickPick, modelsPanelEntry, modelsPanelBundle               |    19 |    0 |
| modelsPanelSchemas, modelsPanelReducer, providerWizardSave         |    27 |    0 |
| modelsApp, modelsWebviewEntry, modelsComponents                    |    23 |    0 |
| modelsSections, modelsActivationBudget, providersL10n              |    22 |    0 |
| planKeyPresets, providerPanelSeam, providerProvidersHost           |    20 |    0 |
| providerModelScans, subscriptionIntegration, configuredProviders   |    40 |    0 |
| modelApiGoldenRequests, metaRequestGoldens, modelApiShellDirectory |   176 |    0 |
| paidConsent, teamSingleModel, manifest                             |    85 |    0 |

Duplication check: a read-only snapshot of the starting `bfbdf3c35` fails
with 25 clones (321 duplicated lines, 2,275 tokens). The first round-4 run
found 34. Removing the new repetitions uses the existing draft factory,
shared draft assertions, a two-case refresh regression and fixture-owned
cleanup; the resulting 24 clones (312 lines, 2,206 tokens) all correspond
to the prior-round set. The unchanged zero-clone gate still exits 1. This
inherited hold is recorded in PLAN §7 for the lead; no new ignore, threshold,
assertion or timeout is used. The temporary baseline snapshot was removed.
The cleanup's first navigation run caught a misapplied test-helper call;
correcting the arguments restored every original assertion, and the complete
batch passed at repository deadlines.

Plain knip initially found three inherited unused exported type aliases in
`modelsPanel.ts`; all three declarations were removed, with no schema change.
Knip then exits 0 (two existing configuration hints remain). The host API
record was stale for round 3's native settings adapter: it was regenerated
and reviewed, adding its configuration target/read/inspect/update entries;
the host API gate now reports 0 problems.

The final implementation repeats fourteen distinct guard breaks after the
scoped cleanup. Both saved-entry seed paths now share the existing draft
factory, so dropping that seed fails both entry tests in one drill. The Edit
fields' ids are scoped separately from an open wizard; its hide-fields drill
was repeated after that change. Every break restored the implementation file
byte-exact; the final original/restored hashes are:

| File                                    | SHA-256                                                            |
| --------------------------------------- | ------------------------------------------------------------------ |
| src/host/models/sessionBudget.ts        | `350ad5a7da4b0ebc7407a83b464c105ab1835232127ab3c03bbc456de846bbcb` |
| src/host/models/modelsPanel.ts          | `229bf0e078174d457d3ce04da869d058e6d4fa5958758cccab1ac2eda394a199` |
| src/host/models/modelsQuickPick.ts      | `31fe723d5a29c589d40661ef846ae8c7d379fde442a1590bb036edf2710cd625` |
| src/webview/models/Wizard.tsx           | `87d37949cd26bf7f4332deec24190b377865c2b28e8316988038e0266e2f8cbe` |
| src/webview/models/ProvidersSection.tsx | `c55734c2fec96854c551bc04ff0a7e24afb5a3f8746a10074f6ff41e7a329d07` |

| Final break                                                | Failures |
| ---------------------------------------------------------- | -------: |
| Write string instead of native number                      |     5/39 |
| Remove numeric round-trip guard                            |     2/33 |
| Drop persisted custom limits from the shared draft factory |     2/27 |
| Hide saved custom limits in Edit                           |     1/32 |
| Reapply custom-limit blockers on earlier steps             |     1/27 |
| Remove final Save's blocker guard                          |     1/27 |
| Remove compare-and-set                                     |     3/33 |
| Remove missing-prefill guard                               |     1/33 |
| Commit an untouched webview field                          |     1/32 |
| Treat unchanged quick-pick prefill as edited               |     2/33 |
| Write panel limit before provider save                     |     6/33 |
| Write quick-pick limit before provider save                |     7/33 |
| Retry a partial panel save as a duplicate add              |     2/33 |
| Automatically confirm a concurrent quick-pick edit         |     2/33 |

The complete 27-file batch passed after the restored implementation; the
32-test fields suite also passed after its final hide/restore drill. Final
five-project `npm run typecheck`, changed-file ESLint, localization (14 UI and
14 usage tables, 0 problems), generated reference, plain knip and host API
checks exit 0. The production build, split checks, host globals and notices
exit 0. Exact primary bytes / unchanged cap: extension 521707/614400;
providers 134609/153600; Models host 104453/128000; shared Node English
83695/128000. Models startup with static imports is 326.5 KiB/500 KiB,
lazy body 61.9 KiB/75 KiB, and shared surface English remains inside its
25 KiB cap. No budget or gate changed.

No aggregate quality pass, coverage pass, package/installed-editor check,
real-browser accessibility or live sign-in is claimed. The explicit brief
reserves full quality for the lead, and the inherited duplication hold above
remains. No credentials were inspected, no dependency installed, no model
call made, and no push, merge or rebase performed.

---

# PROVWIZ2 round 5 — RVPROVWIZ4G (2026-10-09, macmini)

## P2: Save the actual Edit form's limits

`modelsPanel.ts` recognizes a saved connection while its address, format and
key are unchanged. Editing token limits therefore needs no new credential
check. Changing any connection field invalidates that exemption; a fresh
failed test cannot reuse it. Final Save still validates all custom limits.
The production save transaction replaces the saved entry and retains its
limits in the shared provider file, which ACP reads through the same schema.

`ProvidersSection.tsx` renders Edit while its host-owned draft exists. Save
closes the form only when the host clears that draft after success. A failure
keeps the fields and typed values visible for retry. Save publishes a success
notice or the specific failure in the draft, with retained credentials and
known credential shapes redacted and only fixed words logged. The production
store's refused write names its fixed `invalid` or `io-error` reason without
publishing raw file contents. Existing localized messages are reused; no UI
key, wire shape, paid policy, request serializer or dependency changed.

`modelsPanelEdit.test.tsx` connects the rendered shared Providers section to
`createModelsPanel`, the actual save transaction and the production provider
store on a private temporary file. It seeds m1 at 128000/4000, opens Edit,
changes the reply to 8000, presses Save without Test, reads 8000 from the
production store and file, and reopens Edit to see 128000/8000. A rejected
store write containing a synthetic bare key shows the specific redacted
failure, keeps 8000 visible and 4000 stored, then saves on retry without
retyping. Other cases require Test after address, key or format changes and
prove the actual production schema's refused write leaves the file unchanged.
These seven regressions use fake VS Code and services; no request reaches a
provider. The original five behavior cases failed on the pre-fix implementation.

The existing cancellation test now waits for the host's draft retirement.
Four spending-limit rollback cases now require the specific transaction
failure instead of the generic notice, retaining every rollback, prior-limit,
no-write and no-setup-success assertion.

## P3: Correct the earlier certification contract

Round 3's sections 2 and 4 and their failure-case descriptions now explicitly
state the round-4 order: provider save finishes before the spending-limit
write. A later limit failure leaves the provider saved and reports partial
success with its reason. README and the existing changelog contract already
match that behavior; the correction is also recorded under Unreleased.

## Default-timeout regressions

All commands ran directly on macmini with complete files, at most three files
per invocation and `--maxWorkers=3`; no `--testTimeout` override. Ten batches
passed 28 distinct files and 511 tests:

| Files (`test/unit/`, `.test.ts` / `.test.tsx`)                     | Tests | Exit |
| ------------------------------------------------------------------ | ----: | ---: |
| modelsPanelEdit, modelsPanel, modelsPanelSections                  |    66 |    0 |
| wizardSessionBudget, modelsQuickPick, modelsPanelEntry             |    47 |    0 |
| modelsPanelBundle, modelsPanelSchemas, modelsPanelReducer          |    25 |    0 |
| providerWizardSave, modelsApp, modelsWebviewEntry                  |    10 |    0 |
| modelsComponents, modelsSections, modelsActivationBudget           |    24 |    0 |
| providersL10n, planKeyPresets, providerPanelSeam                   |    29 |    0 |
| providerProvidersHost, providerModelScans, subscriptionIntegration |    25 |    0 |
| configuredProviders, modelApiGoldenRequests, metaRequestGoldens    |   169 |    0 |
| modelApiShellDirectory, paidConsent, teamSingleModel               |    81 |    0 |
| manifest                                                           |    35 |    0 |

After the transaction-error drill, the restored Edit and spending-limit suites
passed all 39 tests again at repository deadlines. The additional failed-retest
case passed, failed when its guard was deliberately removed, and passed after
restoration in the final 66-test Edit/host/fields batch. The synthetic tests also
cover request goldens, paid consent and single-model behavior.

## Deliberate failures and exact restoration

The first eight mutations ran the entire six-test Edit file and exited 1.
The transaction-error drill ran Edit plus all 33 spending-limit tests; the
failed-retest drill ran the completed seven-test Edit file. Every
mutation restored the original file bytes in `finally`; SHA-256 matched after
each restore. The original and restored hashes are:

| File                                    | SHA-256                                                            |
| --------------------------------------- | ------------------------------------------------------------------ |
| src/host/models/modelsPanel.ts          | `bb28773dfa4af58d215980a19cd85f436a70c1b97617523a80945a51112bae22` |
| src/webview/models/ProvidersSection.tsx | `49e048b379caf90e935d65e4f9dd64aec6bf9d46ea7eaad11815aa412f741b0f` |
| src/core/providers/panelSeam.ts         | `3a39be64bda8156c5c9b937609f0c3c787883266f05eda29543f6ea31fe4d9e0` |

| Deliberate break                                                  | Failures |
| ----------------------------------------------------------------- | -------: |
| Require a fresh credential test for an unchanged saved connection |      2/6 |
| Reuse the saved connection after address, key or format changes   |      3/6 |
| Replace the specific save failure with the generic notice         |      1/6 |
| Omit literal credential redaction                                 |      1/6 |
| Restore the form's premature local close on Save                  |      4/6 |
| Replace the production writer's reason with the generic notice    |      1/6 |
| Discard the edited reply limit while building the entry           |      2/6 |
| Omit the successful save notice                                   |      1/6 |
| Hide transaction failures, including all four rollback boundaries |     5/39 |
| Reuse a saved connection after its fresh test fails               |      1/7 |

## Individual gates and limits of qualification

Changed-file ESLint and Prettier, all five projects in `npm run typecheck`,
plain `npm run deadcode`, localization (14 UI tables, 14 usage tables,
0 problems), generated reference and host API gates exit 0. The production
build, split checks, host globals and notices exit 0; every budget remains
unchanged. The final added regression is also checked by the unit-project
compiler and changed-file lint/format.

The unchanged duplication gate exits 1 with the inherited 24 clones,
312 duplicated lines and 2206 tokens, exactly the prior-round totals; the
new Edit file has no reported clone. PLAN §7 retains that lead-owned hold.
The additional failed-retest case initially repeated a seven-line assertion
block; moving it into the existing connection-case table removed that new
clone while keeping its assertions and the production-store check.
No threshold, ignore, hook, retry, test deadline or assertion is weakened.

| Built artifact      |  Bytes | Unchanged cap (bytes) |
| ------------------- | -----: | --------------------: |
| dist/extension.js   | 521707 |                614400 |
| dist/providers.js   | 134642 |                153600 |
| dist/modelsPanel.js | 111284 |                128000 |
| dist/uiText.js      |  83695 |                128000 |

Models startup with static imports is 326.5 KiB/500 KiB; the shared surface
English stays within its 25 KiB cap. No aggregate quality, coverage,
package/installed-editor, native Settings, real-browser or live sign-in result
is claimed. Those broader qualifications remain with the lead under the rig
brief. No dependency was installed, credential inspected, model call made,
or push, merge or rebase performed. Reference regeneration produced no data
change; the provider feature's source record documents direct Edit persistence.

## PROVWIRE

2026-10-09, macmini, branch `fix/provider-wiring`, base `e7bf0e140`.
Scope: RVWIRING F2–F7 for 0.17.1. No provider contact, paid/model attempt,
credential-file read, dependency, merge or push. F1 is in the base; F10's
`fail()` logging is left to its owner. Aggregate quality and installed-editor
qualification remain lead-owned under the lane brief/common rules.

### F2 — Preset format at scan/test dispatch

Cause: setup correctly omits optional `format` for ordinary presets, but the
scanner dispatched only on that optional entry field. Resolve it as
`entry.format ?? preset.format` for headers and parser selection. Keep the
persisted schema: presets already define the canonical format, older entries
must work, and custom servers can keep their explicit format override.

`providerWiring.test.ts` drives the production `createModelsPanelSeam`
catalogue and file store, real `createProvidersHost`, configured service and
panel bridge with fake DNS/pinned send and in-memory host credentials. Replays:
`gemini/01-models-list.json` (3 samples), `ollama/02-tags.json` (7 models),
`anthropic/01-models-list-x-api-key.json` (3 samples), all under
`docs/certification/m95-captures/`. Capture workspace: direct capture scripts
(cloud lists, no workspace) and the owner's Ollama instance; this replay makes
**0 model attempts**. Summary envelopes rehydrate only captured samples, so
sample counts are not claims about complete live catalogues.

Failing first: Gemini/Ollama key tests reject instead of returning their model
count; Anthropic requests omit `anthropic-version: 2023-06-01` (3 failed).
After fix: `providerWiring`, `configuredProviders`, `providerPanelSeam`:
**35 tests passed**, repository deadlines, macmini.

### F3 — Scanned prices and free rows

Cause: `scanRows` projected capabilities but discarded all pricing metadata.
The projection now validates captured price shapes, keeps input/output/cache
rates, detects zero-cost cloud models, and fingerprints the complete price
card (including cache writes and long-context rates). HF fingerprints also
retain the captured upstream records. Plan and local rows keep their own
price kind. Invalid rates remain unpriced, never free. Per-million display
uses the shared decimal USD arithmetic, avoiding binary multiplication noise.

The real-facade tests replay `openrouter/01-models-list.json`,
`groq/01-models-list.json`, `together/01-models-list.json`,
`xai/01-models-list.json` and `huggingface/01-models-list.json`. Decimal strings
are USD/token, Together/HF numeric rates are USD/million, xAI rates are ticks
of 1e-10 USD/token, as recorded in M95. HF shows the highest captured rate
among live priced upstreams for each column, since routing may select any of
them; no price is inferred for an upstream that supplies none. No live rate
is claimed. These direct cloud captures have no workspace; replay makes
**0 model attempts**. The sensitivity case changes only a captured
`input_cache_write_1h` field to prove repricing, not a current-provider price.

Failing first: Sonnet's 2/10/0.2 USD per million was absent and unpriced.
After fix: **53 tests pass** in `providerWiring`, `providersModel`,
`configuredProviders`. The test's first projection run exposed binary numeric
noise, resolved with existing decimal arithmetic; the next run exposed a test
message missing the bridge's required sort field, corrected in the fixture.
No further production rewrite was needed. Two overlapping drill launches were
discarded: the production file was restored to the known-good SHA-256 and the
drills repeated sequentially. Only the independent receipts below count.

Final review added one failing-first HF stability case: latency and upstream
order changes altered the raw upstream fingerprint even with identical
prices. The fingerprint now keeps sorted provider identities and validated
input/output pricing only. A captured upstream rate changing below the table's
highest rate still changes the fingerprint. The latency/order case fails with
the old raw fingerprint and passes with the projection. This synthetic metadata
and price mutation is a sensitivity test, never a claim of new live prices.

### F4 — A credential check rather than a public-list check

Cause: the configured service always scanned models while the CLI honoured
`preset.keyTest`. Both now call `presets.runProviderKeyTest`, which runs a
provider-key check before a same-origin list and refuses paid-token probes.
Configured checks use the same pinned transport as scans, captured version
and attribution headers, and bounded JSON validation. A preset's separate
identity origin is permitted only for that captured key-test path, with fresh
DNS and public-network checks; the configured provider's own fixed origin is
still validated. HTTP refusal returns failed, with no public-list fallback.
No captured paid-token operation is installed or dispatched.

The real panel/facade tests replay OpenRouter's `01-models-list.json` and
`02-key-usage.json`: success requests `/api/v1/key`, then `/api/v1/models`;
fake HTTP 401 at `/key` produces failed and never requests `/models`.
The CLI's real `probeProvider` replays the same pair in the same order.
HF's `02-whoami-key-test.json` is a redacted structural summary: only status
and bounded JSON are consumed, no account information reconstructed or shown.
Its configured key check requests `https://huggingface.co/api/whoami-v2`
and does not probe the router's public list. These direct captures have no
workspace; this replay makes **0 model attempts**.

Failing first: the key endpoint is absent, and fake key refusal still publishes
ok (2 tests failed). Final `providerWiring`, `providersX`, `providersXFix`:
**63 tests pass** at repository deadlines. Scoped ESLint passes.

### F5 — ZDR in the panel wizard

Cause: `newDraft` chose no-training despite the shared wizard and D74's ZDR
default. Its default now is `zdr`. The production-catalogue test starts a
fresh wizard, enters a synthetic key through the native password box, tests
against the captured OpenRouter key/list receipts, ticks a model and saves.
The draft and the actual providers file both retain `privacy: zdr`; the key
never crosses postMessage. Failing first: the draft publishes no-training.
After fix: `providerWiring`, `modelsPanel`, `providersFlow` pass at repository
deadlines. Help's provider detail names the existing localized no-retention
policy under an explicit OpenRouter/ZDR condition; generated reference updated.

### F6 — Replacement key belongs to the edit draft

Cause: opening Edit always recreated the draft and reloaded the stored key,
overwriting Change key's in-memory replacement. Opening an existing edit
draft now reuses it. The change is one guard in the panel handler; no bridge,
credential record or provider schema changes.

Two production-facade tests drive Change key -> native password box -> Edit
-> Test over the captured OpenRouter key/list receipts. Every pinned request
uses the replacement. It is not stored before Save; Save persists it and
drops the draft, while Cancel drops the draft and leaves the original stored
credential. Neither synthetic credential appears in any panel message.
Failing first: both tests send the original credential (2 failed).
`providerWiring`, `modelsPanel`, `providerCredentialRecords` then pass at the
repository deadlines. Replay makes **0 model attempts**.

### F7 — Failed scans settle and can be retried

Cause: the panel published scanning before awaiting the real scanner, then
let rejection reach generic `fail()` without settling that row. The scan
handler now publishes failed with the existing localized “The model list
could not be read.” before rethrowing. Exception text never joins that state.
F10's logging remains unchanged. Models includes failed scans in its existing
ScanStatus surface, as Providers already does, with Refresh and no Cancel.

The real-facade regression first scans the captured OpenRouter list, then
returns invalid JSON metadata through fake pinned send. It observes failed
and the plain reason, keeps four cached rows, and replays the capture again
to prove retry returns done and clears the failure. An actual in-flight scan
is cancelled through the bridge's immediate cancellation path: the previous
cache is kept, status is done and no failure is logged. The webview regression
checks the failed reason, absent Scanning/Cancel, and the Refresh message in
Models and Providers. Failing first: host status remains scanning and Models
has no failed reason/retry (2 tests failed). A follow-up fixture assertion on
a nonexistent provider `scan` field was removed; both views read the shared
`state.scans` contract. `providerWiring`, `modelsPanelSections`,
`providerModelScans`: **48 tests pass** at repository deadlines. These replay
tests make **0 model attempts**.

### Final qualification

All final commands run directly on **macmini**, at repository deadlines,
with no `--testTimeout`, no test-name filter and at most three files/workers
per Vitest invocation. The complete provider/models regression set is
**44 files, 739 tests, all passed** (15 sequential batches). `providerWiring`
has 19 capture-backed cases; the two parameterized webview failure/retry cases
cover both sections. `npm run typecheck` passes all five projects.
Changed-file ESLint and prettier pass, `check:l10n` reports **0 problems**,
`check:reference` is current, `check:host-api` reports **0 problems**,
plain `npm run deadcode` exits 0, and `npx jscpd` reports **0 clones**.

`npm run build` exits 0, including existing size/split/global/notices gates:
extension **509.5/600 KiB**, Model API **488.7/525 KiB**, providers
**134.0/150 KiB**, configured providers **27.1/50 KiB**, Models panel
**92.2/125 KiB**. Every other existing budget also passes; no cap changed.
All local commits use `.husky/_`, lint-staged and gitleaks as installed;
the staged and committed code was reread after each hook. The hook's one
test-callback rewrite adds braces without changing the rejection behavior.

Changed files: `src/core/providers/{configured,presets,priceCard}.ts`,
`src/runtime/providersCommands.ts`, `src/host/models/modelsPanel.ts`,
`src/webview/models/ModelsSection.tsx`, `src/shared/featureCatalog.ts`,
`src/shared/reference/reference.generated.{json,ts}`, `docs/reference.md`,
`test/unit/{providerWiring,modelsPanel}.test.ts`,
`test/unit/modelsPanelSections.test.tsx`, `PLAN.md`, `CHANGELOG.md`, and this
record. Panel production changes stay in three small separate F5/F6/F7
commits to minimize conflicts with PROVWIZ2; `fail()` logging is untouched.

The strict duplication gate first reported five cloned test blocks: three new
blocks and two pre-existing wizard test sequences from PROVCAT. Sharing the
scan/save setup and parameterizing the two scan surfaces preserves every
assertion and brings the unchanged gate to **0 clones**. The F7 surface cases
also fail when the shared failed-status renderer is deliberately removed.

Aggregate `npm run quality`, hosted CI and installed-editor/live qualification
belong to the lead under the lane brief/common rules; no gate, timeout or
ignore was weakened. No merge, rebase, push, dependency installation, live
provider request or model attempt was made. Credentials in all tests are
synthetic in-memory fixtures, entered through the native-password-box port.

### Red drills (byte-exact restoration)

Every drill runs a whole owning test file at repository deadlines, records
exit 1, restores the original bytes in `finally`, and compares SHA-256.

| Finding | Deliberate break                                                | Red result                                                    | Restored SHA-256                                                   |
| ------- | --------------------------------------------------------------- | ------------------------------------------------------------- | ------------------------------------------------------------------ |
| F2      | Remove the preset fallback in scan dispatch                     | 3 tests fail: Gemini/Ollama refusal, Anthropic header missing | `158d0578ca5bfc5de0bb2205a81f3b23b81940dca4227fd5782c39a517860d11` |
| F3      | Drop the captured price card                                    | 6 rate/filter/stability tests fail                            | `c447df2e615e9e8f25b74f3f9c9f52be44bf220e66e2a1babc5797f667408cd9` |
| F3      | Force free flags off                                            | Free/filter test fails                                        | `6cd4ff8be66dac1f7d04838637f1bbe4f5e4845a777f471b46366b4235d3815d` |
| F3      | Replace the price fingerprint with unpriced                     | Cache-write repricing test fails                              | `6cd4ff8be66dac1f7d04838637f1bbe4f5e4845a777f471b46366b4235d3815d` |
| F3      | Accept negative optional decimal rates                          | Invalid rate becomes free; test fails                         | `b819faafadb2ebc95468920c0b4eb3ba9c8cc653333560a669c1c6542c0b4c2b` |
| F4      | Skip the shared provider-key check                              | 4 panel/CLI/HF tests fail                                     | `4cdc0eff6a5de9ba9239be94481cb6163e6240be05ae96dcec3c535d45b5fd25` |
| F4      | Also list after a separate identity origin                      | HF key-test count/path test fails                             | `4cdc0eff6a5de9ba9239be94481cb6163e6240be05ae96dcec3c535d45b5fd25` |
| F4      | Refuse the captured identity path instead of other paths        | HF key test fails                                             | `3fd26e9d63f0bf6e1ee6d588213fda8df41df2bc107effd616bfb74c285058a5` |
| F5      | Restore no-training as the panel default                        | Fresh wizard default test fails                               | `dd2bcf0a0b5d3331ac08d3f92b1c6bbb5f50f3163dac9e18e3a72daeddf3bc3c` |
| F6      | Recreate an existing edit draft                                 | Both replacement-key save/cancel tests fail                   | `579c1d1ff2ea7669953872bb76166998e85fab89cf0a9536ef548cae7a7de7da` |
| F7      | Publish scanning again on rejection                             | Failed-settlement and retry test fails                        | `360f72ccf896fdce574091c648681c7212794eb6e3ee6566cafc72851ea3eb14` |
| F7      | Hide failed scans in Models                                     | Failure/retry surface test fails                              | `716a7a279c823a5f5ae1fb0868fb56e639df030d57414a380b0144a7ebfab77e` |
| F3      | Restore raw unsorted upstream metadata in the price fingerprint | HF latency/order stability test fails                         | `c447df2e615e9e8f25b74f3f9c9f52be44bf220e66e2a1babc5797f667408cd9` |
| F7      | Remove the shared failed-status renderer                        | Both Models and Providers failure/retry tests fail            | `1b53d4964d4838ac2eae529478d3ae25abe34cde38442fbc9c7cb360013117ec` |

### Round 2 — Preserve saved OpenRouter routing (RVPROVWIREG finding 1, P2)

2026-10-09, macmini, branch `fix/provider-wiring`, round-2 base `73a396b27`.
Edit and Change key previously copied only address/models into a wizard-default
draft. Save then replaced the saved routing with ZDR, no order and disabled
fallbacks. `newDraft` now accepts the saved entry and copies its privacy,
provider order and fallback choice alongside address/models. Both saved-entry
creation paths use it; Change key followed by Edit still reuses the same draft
and replacement credential. Save projects routing from that seeded draft.
The order is copied into a new array. New providers retain the ZDR default.
No new command, setting, feature, translation, wire shape or dependency.

The production-facade `providerWiring.test.ts` regression covers Edit,
Change key, and Change key → Edit → Test → Save with privacy `any`, ordered
providers and enabled fallbacks; each flow also covers `no-training` and
disabled fallbacks. It asserts the draft, the persisted file routing, the
credential used on every pinned test/scan request and the stored replacement
key. All three flows retain Cancel coverage: neither the saved routing nor
the original key changes. Synthetic credentials never appear in panel messages.
The existing fresh-provider test still asserts ZDR on creation and Save.
Captured responses: `openrouter/01-models-list.json` and `02-key-usage.json`
under the M95 captures above; no live provider contact, **0 model attempts**.
This repairs the existing shared panel flow; CLI/ACP routing remains unchanged.

Failing first: all six initial save regressions failed against the round-2
base with wizard defaults in the draft. Combining them with the existing
key-change/Cancel cases removes one duplicated test block without dropping
an assertion; the complete focused file then passes **26 tests** at repository
deadlines.

Each drill runs the complete `providerWiring.test.ts` file with
`npx vitest run test/unit/providerWiring.test.ts --maxWorkers=3`, no name filter
or timeout override, observes exit 1, restores the original bytes in `finally`
and compares SHA-256. All four before/after hashes are identical:
`556e28524b7d125fc96432c3ddd76d080fde21d82d5ac3d1eb4d1bc72f256ffa`.
Local logs/receipts: `temp/provwire-r2-{privacy,order,fallbacks,save}-drill.*`.

| Deliberate break                                 | Red result                     | Restoration        |
| ------------------------------------------------ | ------------------------------ | ------------------ |
| Seed privacy from ZDR instead of the saved entry | 9 routing cases fail           | Byte-exact SHA-256 |
| Seed an empty order instead of the saved order   | 9 routing cases fail           | Byte-exact SHA-256 |
| Seed false instead of the saved fallback choice  | 6 fallback-enabled cases fail  | Byte-exact SHA-256 |
| Project ZDR instead of draft privacy on Save     | 6 persisted-routing cases fail | Byte-exact SHA-256 |

Round-2 qualification runs directly on macmini: **44 complete provider/models
files, 746 passed tests**, 15 sequential batches at repository deadlines and
at most three files/workers per run. The owning file is rerun after the lint
cleanup: **26 passed**. All five `npm run typecheck` projects, changed-file
ESLint/prettier, localization (**14 UI tables, 0 problems**), reference
(current), host API (**0 problems**), plain Knip and duplication (**0 clones**)
pass. No lint rule, timeout, threshold, ignore or budget changes.

The production build passes the existing size/split/global/notices gates:
extension **509.5/600 KiB**, Model API **488.7/525 KiB**, providers
**134.0/150 KiB**, configured providers **27.1/50 KiB**, Models panel
**92.3/125 KiB**; every other existing budget also passes. Test/check logs and
the batch result JSON are under `temp/provwire-r2-*` (untracked).

Aggregate quality, hosted CI and installed-editor/live qualification remain
lead-owned under the brief/common rules. No review finding is deferred; no
merge, rebase, push, installation, live provider contact or paid/model call.

# PROVWIZ6 — One edit draft, integrated provider lanes and RVPROVWIZ5G

Recorded 2026-10-09 on **macmini**, worktree `PROVWIZ6`, branch
`fix/provider-panel`, starting at `40fdfe2fe` (wizard `27ef127ae` joined with
wiring `3924929f4`). The rig brief and `codex/common.md` govern this lane:
local installed hooks, no subagents, merge, rebase or push, no live/paid calls,
at most three complete test files/workers per invocation, repository deadlines.
The prescribed scope is added to PLAN §6 before implementation.

## Findings and production proof

- **P2-1 / one edit draft.** `createEditDraft` is the single factory for Edit,
  Change key and Change key → Edit. It deep-copies the complete stored entry on
  the host, prefills its editable fields and stored file default, and retains
  the entry's pinned models, compat, prices, optional routing and private
  consent. Existing drafts retain their replacement key. Edit always opens
  that draft rather than cancelling a Change key draft. Save compares against
  its initial fields and overlays only changes on the current stored entry,
  including each routing choice and each edited token limit. Untouched optional
  fields remain absent. The reviewer's OpenRouter ZDR / `['anthropic']` /
  fallback-enabled Edit → Save leaves the production file **byte-identical**,
  with no provider/default/secret write and no credential test. The same
  byte-exact assertions cover minimal routing and absent routing.
- **P2-2 / default model.** A limit-only Save keeps `custom/m2` when m1 is the
  first of two listed models, an `another/m2` default, and an absent default.
  The default writer is never called. An explicit choice changes it to
  `custom/m1`; new setups still choose and validate their selected model.
  Regression entries retain pinned m2, custom compat, prices, other limits and
  limits for an unselected model. All three edit flows also preserve concurrent
  changes to favourites, prices, selected models, a different default, and
  m1's context limit while saving only m1's typed reply limit.
- **P2-3 / Save lifecycle.** Admission sets the validated bridge's `saving`
  flag synchronously before the queue awaits earlier work. Duplicate messages
  for that draft are ignored, as are stale Saves for a retired draft. The
  edit Save button and both wizard Save buttons are disabled while saving.
  The held production Save runs once and keeps its success notice after a
  second delivery and a later stale delivery. A held failed wizard Save also
  runs once, retains its model/key/typed data, reports the specific redacted
  failure, resets `saving`, and successfully retries through the real store.
- **P3 / private-network refusal.** The facade returns the existing
  `providerPrivateConfirm` sentence on declined consent. Save shows
  “Confirm access to this private network first.”, retains the form and typed
  limit, and writes nothing. A second Save asks again and persists the limit
  after consent. Policy refusals still use the address-invalid template.
- **Merged F6/F7 qualification.** The older wiring fixture did not inject the
  wizard lane's now-required `SessionBudgetConfig`; `refresh` failed before
  publishing refreshed rows and reported generic failures. The initial merged
  run has **21 failed / 39 passed** across three files. Supplying the same
  memory-backed setting port the other panel fixtures use restores **all 26
  wiring cases** with every existing assertion unchanged. Its production
  catalogue → facade → configured transport → panel still replays only the
  checked-in M95 captures. Failure/retry retains four cached rows and clears
  the failed reason; actual in-flight cancellation settles done with its prior
  cache and no failure log. No scanner, parser or capture was weakened.

The new host regressions use the rendered shared Providers form, the real
host/facade, production `createModelsPanelSeam` and atomic `providers.json`
writer, with fake VS Code/credential backing/dispatch only. The wiring suite
uses `docs/certification/m95-captures`, especially OpenRouter's captured
`01-models-list.json` and `02-key-usage.json`; original capture provenance is
unchanged. Every replay and drill makes **0 model attempts**. Existing editor
bridges share these webview/host changes; ACP reads the same unchanged stored
provider schema and limits. No new provider wire shape, command or setting.

The React review checks native disabled semantics, existing labels, event
handlers and typed props; there are no new hooks, render-time side effects,
network calls or eager imports. The full entry stays host-only. The new
optional `saving` boolean is validated on the shared bridge. README,
CHANGELOG and the providers feature-catalog record describe the saved behavior;
reference regeneration leaves the generated files current without content drift.

## Failing first and byte-exact guard drills

Before production changes, the first review regressions fail **7/17** (no-op
writes, missing defaults/consent, key → Edit cancelling, duplicate admission).
The expanded per-model/unselected/concurrent-limit regressions then fail
**6/19** before their selective limit patch. Restored production code passes
all cases below. Each deliberately broken guard runs whole files at default
repository deadlines, exits 1 with assertion failures, then restores the
original bytes in `finally`. SHA-256 before/after matches in every receipt.
No timeout override, test-name filter, assertion removal, suppression or gate
threshold change is used.

| Drill                           | Broken guard                                               | Failed / total | Source hash key |
| ------------------------------- | ---------------------------------------------------------- | -------------: | --------------- |
| `routing-copy`                  | Replace saved privacy with a blank-draft default           |           7/26 | 1               |
| `stored-default-copy`           | Do not copy the stored file default                        |           2/20 | 1               |
| `keep-existing-draft-key`       | Recreate an existing draft and replace its draft key       |           4/46 | 1               |
| `changed-fields-only`           | Bypass the stored-entry overlay                            |           9/20 | 1               |
| `preserve-current-entry`        | Save against the old snapshot instead of the current entry |           3/20 | 1               |
| `preserve-untouched-limits`     | Replace every limit with the draft model set               |           6/20 | 1               |
| `private-consent-copy`          | Do not copy stored private-network consent                 |           1/20 | 1               |
| `default-change-only`           | Set the default without an explicit change                 |           4/20 | 2               |
| `explicit-default-choice`       | Ignore an explicit default choice                          |           1/20 | 1               |
| `duplicate-save-admission`      | Admit a second Save while the first runs                   |           3/20 | 1               |
| `retired-save-honesty`          | Report a false failure for a retired draft                 |           1/20 | 1               |
| `save-retry-unlocks`            | Keep the failed draft marked saving                        |           3/20 | 1               |
| `edit-save-disabled`            | Enable edit Save while saving                              |           1/20 | 3               |
| `wizard-save-disabled`          | Enable both wizard Saves while saving                      |           1/35 | 4               |
| `declined-private-message`      | Call declined private access an invalid address            |           1/20 | 5               |
| `skip-unchanged-provider-write` | Rewrite an identical provider entry                        |           4/28 | 2               |
| `skip-unchanged-secret-write`   | Rewrite an identical stored credential                     |           5/28 | 2               |
| `skip-unchanged-default-write`  | Rewrite an identical default                               |            1/8 | 2               |

| Hash key | Restored source                           | SHA-256 before = after                                             |
| -------- | ----------------------------------------- | ------------------------------------------------------------------ |
| 1        | `src/host/models/modelsPanel.ts`          | `566f05818c82a983e1d73d17fbee41e12ed92630797833a5d003f2a1b0ab0a2c` |
| 2        | `src/host/providers/wizardSave.ts`        | `d1b604a8379f0abd3bdcc8e24956462432c48e5bc766b9dc45c97b4164c78cad` |
| 3        | `src/webview/models/ProvidersSection.tsx` | `36cbab99e7156d563b7e78f1e6ff0f9998f5e1d4deb619fb5eb4e57f93e1983f` |
| 4        | `src/webview/models/Wizard.tsx`           | `282070861c9b097ac3dd569bde0aaf5ead6e75b96247fae5f09881fd23b910eb` |
| 5        | `src/host/providers/providersHost.ts`     | `1486aad4e51fc6f15dffbc3d74528bb10a7bbbbcf67cc1b72e83551c265bed65` |

The shared bridge schema's final SHA-256 is
`c97a51c620982d80316f4c961f240aec2a87764e49b1c01d341206d5e53d6cda`.
Raw assertion logs and machine-readable hash receipts are in the lane's
untracked `temp/provwiz6-drill-*` files and `temp/provwiz6-drills.json`.

## Final whole-file regression table

All **45 complete files / 774 tests pass**, no skips, in 15 sequential batches:
`npx vitest run <files> --maxWorkers=3`, **without `--testTimeout`**. These are
all 44 provider/models files qualified by the joined lanes plus the selected
model capability-binding file. The final run follows all production restorations.

| Batch | Complete files (`test/unit/`)                                                                     | Passed |
| ----- | ------------------------------------------------------------------------------------------------- | -----: |
| 1     | `configuredProviders.test.ts`, `execProvider.test.ts`, `modelApiProviders.test.ts`                |     57 |
| 2     | `modelCapabilitiesBinding.test.ts`, `modelsActivationBudget.test.ts`, `modelsApp.test.tsx`        |     15 |
| 3     | `modelsComponents.test.tsx`, `modelsPanel.test.ts`, `modelsPanelBundle.test.ts`                   |     52 |
| 4     | `modelsPanelEdit.test.tsx`, `modelsPanelEntry.test.ts`, `modelsPanelReducer.test.ts`              |     34 |
| 5     | `modelsPanelSchemas.test.ts`, `modelsPanelSections.test.tsx`, `modelsQuickPick.test.ts`           |     55 |
| 6     | `modelsSections.test.ts`, `modelsWebviewEntry.test.tsx`, `providerAuthService.test.ts`            |      9 |
| 7     | `providerCatalog.test.ts`, `providerCredentialRecords.test.ts`, `providerCredentialStore.test.ts` |     98 |
| 8     | `providerImportExport.test.ts`, `providerKeyPrompt.test.ts`, `providerLocalProbe.test.ts`         |     22 |
| 9     | `providerModelScans.test.ts`, `providerOAuthLoopback.test.ts`, `providerOpenRouter.test.ts`       |     30 |
| 10    | `providerPanelSeam.test.ts`, `providerProvidersHost.test.ts`, `providerRemoval.test.ts`           |     24 |
| 11    | `providerRetry.test.ts`, `providerTransport.test.ts`, `providerWiring.test.ts`                    |     67 |
| 12    | `providerWizardSave.test.ts`, `providerWorkspaceSuggestion.test.ts`, `providersFlow.test.ts`      |     37 |
| 13    | `providersL10n.test.ts`, `providersModel.test.ts`, `providersOverflow.test.ts`                    |     70 |
| 14    | `providersPolicy.test.ts`, `providersPresets.test.ts`, `providersThreats.test.ts`                 |    121 |
| 15    | `providersX.test.ts`, `providersXFix.test.ts`, `wizardSessionBudget.test.ts`                      |     83 |

The new host Edit file has 20 cases, the shared section file 35, the existing
capture-backed wiring file 26, and the save transaction file 8. Final batch
logs and JSON receipts are `temp/provwiz6-suite-*` and
`temp/provwiz6-suites.json`. Fixture/validation/compiler issues found during
preparation were fixed; only the final default-deadline run is qualification.

The owning Edit suite is rerun after sharing its repeated Save/wait block:
**20 passed**. All assertions remain; no new duplicate is left.

## Individual gates, sizes and qualification boundary

`npm run typecheck` passes all five projects. Changed-file ESLint and Prettier,
`check:l10n` (14 UI tables, 14 usage tables, **0 problems**), `check:reference`
(current; 72 features), `check:host-api` (**0 problems**) and plain
`npm run deadcode` exit 0. `npm run build` exits 0, including unchanged
size/split/global/notices gates. The reference is regenerated successfully.
The unit-project compiler and changed-file lint/format also include the final
test-helper cleanup. Hook-installed lint-staged and staged gitleaks run on the
local commit; its staged/committed source is reread and compared byte-for-byte.
No dependency, hook, machine setting or gate configuration is changed.

Duplication remains the documented inherited wizard-lane hold, now measured
against the exact combined base: a temporary `git archive 40fdfe2fe` of the
tracked sources under the OS temp directory and the final worktree both fail
plain jscpd with **21 clones / 287 duplicated lines / 1970 tokens**. The first
lane check additionally catches one new six-line test clone; sharing the
Save/wait helper removes it while retaining every assertion. No ignore,
threshold or rule changes. The 21 remaining clones are the same prior wizard
setup/interaction and footer duplication already deferred in PLAN §7 to the
lead's broader quality cleanup. Logs are `temp/provwiz6-duplication-base.log`
and `temp/provwiz6-duplication-final.log`; the owned temporary base is removed.

| Built artifact                |  Bytes | Existing cap (bytes) |
| ----------------------------- | -----: | -------------------: |
| `dist/extension.js`           | 521707 |               614400 |
| `dist/modelApi.js`            | 500425 |               537600 |
| `dist/providers.js`           | 137273 |               153600 |
| `dist/configuredProviders.js` |  27721 |                51200 |
| `dist/modelsPanel.js`         | 113484 |               128000 |
| `dist/uiText.js`              |  83695 |               128000 |

Models startup with static imports is **326.5 / 500 KiB**; shared deferred
surface English is **25.0 / 25 KiB** and passes its byte cap. All other existing
bundle budgets pass. Full build output is `temp/provwiz6-build.log`.

All four RVPROVWIZ5G findings and the requested lane integration cases are
closed in this scope. Aggregate `npm run quality`, full coverage, packages,
installed-editor/real-browser and hosted multi-OS qualification remain with
the lead under the explicit brief; the inherited duplication gate is not
reported green. No live sign-in, credential inspection, network provider
contact, paid call, merge, rebase, push or publication is made.
