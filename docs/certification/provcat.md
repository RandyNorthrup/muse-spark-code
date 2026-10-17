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
G94 in `docs/orchestration-gotchas.md` (G66 on the branch, renumbered at the
0.17.1 merge because main had taken G66) records the rule to freeze all edits
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

# PROVWIZ7 — Compare-and-set against the edit snapshot (RVPROVWIZ6C)

2026-10-09, **macmini**, `/Users/randy/lanes/PROVWIZ6`, branch
`fix/provider-panel`, base `d32349de1`. Read the rig brief, `codex/common.md`,
`RVPROVWIZ6C.report.md`, AGENTS and the applicable PLAN scope before editing;
recorded this round in PLAN §6 first. The rig brief overrides the generic
merge/full-quality instructions: no merge, rebase, push or aggregate quality.
No subagents, dependency installation, real credential access, external provider
contact or paid/live call. All fixtures hold synthetic credentials in memory.

## Repairs and production regressions

- **P2-1: an untouched credential is never a replacement.** The host retains
  the opening credential separately from a flag set only when the native key
  prompt or account connect returns an entered credential. Edit Save omits an
  untouched credential entirely. A limit-only edit saves 8000 reply tokens while
  retaining a newer key at the same origin, or retaining the key's removal;
  neither case calls the secret writer. Explicit key replacements compare with
  the opening key/origin, and recheck the record after the provider write before
  writing the replacement. The rendered form proves conflicts both before Save
  and when the competing rotation happens during persistence. Keys remain
  outside state, postMessage and logs. Composer refusal does not restore an
  untouched credential over a rotation during that wait.
- **P2-2: apply the patch inside the protected mutation.** `draftEntry` builds
  desired changes against the opening snapshot; `saveWizardDraft` supplies a
  callback to the production store's existing serialized `replaceAll`. The
  callback reads the latest entries inside the mutation, compares edited leaves
  with the snapshot and retains current values for untouched leaves. The
  reviewer's private provider starts pinned m1 at 128000/4000. While the private
  question waits, the real writer removes the pin, adds `toolChoice: omit`, and
  changes context to 256000. Accepting consent saves **256000/8000**, no pin,
  and that compat override. The store regression also proves the callback sees
  a preceding queued writer and an unchanged callback never writes the file.
- **Both-changed conflicts and reload.** The real shared form refuses competing
  reply-limit, default and key edits, preserving the current file/key and typed
  8000 value. The plain localized sentence offers Reload; Reload discards the
  stale host draft and credential, reads the current values and successfully
  saves a subsequent edit. An expected default is checked again inside its
  own store mutation. A competing default after preflight remains intact when
  the write refuses and prior provider changes roll back. Untouched keys and
  defaults are not restored during rollback. Routing comparison is per choice;
  newer order/fallback choices survive a privacy edit, while removal of routing
  or a competing privacy edit conflicts instead of being reconstructed.
- **Retained edit lifecycle.** Existing Edit / Change key / Change key → Edit,
  unchanged routing/default no-op, connection test, duplicate admission,
  failure/retry, private refusal and captured wiring cases all remain. A rejected
  budget remains an honest partial save; clearing that rejected value retries
  against the draft's own successful provider save without a false conflict or
  a second provider write.

The regressions use the rendered shared React Providers section, real panel,
facade, production `createModelsPanelSeam` and atomic `providers.json` writer;
only editor UI/storage/dispatch are fake. Existing transport suites retain the
M95 captures and provenance above, including OpenRouter's model-list and
key-usage frames. New comparisons add no external wire shape. **0 model
attempts**, including every drill.

The strict shared bridge validates optional `reload` and `saveConflict`
booleans and refuses host-only credential/snapshot fields. The host supplies
both the translated conflict sentence and the Reload availability flag; the
browser does not load that sentence just to compare it. This recovered an
initial surface-English budget overflow without a budget or loader change.
All 14 UI tables have a real conflict translation; Reload reuses its existing
translated label. The React change adds a native button using existing styles
and labels, disabled during Save; no new hooks, eager imports or render effects.
README, CHANGELOG and the existing providers catalog entry move with behavior;
reference generation leaves generated content unchanged and current. Shared
editor bridges receive the same form and validated flags. ACP still reads the
unchanged provider-file schema; installed-editor qualification stays lead-owned.

## Failing first and byte-exact guard drills

The six required initial regressions fail against the starting production code:
**6 failed / 20 passed**, then pass after the repair. Extra boundary/retry tests
also pass before their deliberate breaks. The final drill set below runs
complete owning files, at most three files/workers, using
`npx vitest run <files> --maxWorkers=3`, with no name filters, timeout overrides,
skips or weakened assertions. Each break produces assertion failures and exit 1,
restores original bytes in `finally`, and compares SHA-256 before/after.

| Drill                    | Failed / total | Source                             |
| ------------------------ | -------------: | ---------------------------------- |
| `entered-key-only`       |           2/29 | `src/host/models/modelsPanel.ts`   |
| `current-entry`          |           6/39 | `src/host/providers/wizardSave.ts` |
| `changed-field-conflict` |           2/39 | `src/host/providers/wizardSave.ts` |
| `key-snapshot`           |           1/29 | `src/host/providers/wizardSave.ts` |
| `key-recheck`            |           1/29 | `src/host/providers/wizardSave.ts` |
| `default-compare`        |           2/39 | `src/core/providers/panelSeam.ts`  |
| `untouched-key-rollback` |           2/39 | `src/host/providers/wizardSave.ts` |
| `default-rollback`       |           1/29 | `src/host/providers/wizardSave.ts` |
| `reload-snapshot`        |           3/29 | `src/host/models/modelsPanel.ts`   |
| `routing-removed`        |           1/10 | `src/host/providers/wizardSave.ts` |
| `unchanged-file`         |           1/10 | `src/core/providers/panelSeam.ts`  |
| `reload-schema`          |           1/13 | `src/shared/modelsPanel.ts`        |
| `conflict-flag`          |           3/29 | `src/host/models/modelsPanel.ts`   |
| `conflict-flag-schema`   |           1/13 | `src/shared/modelsPanel.ts`        |
| `partial-save-baseline`  |           1/29 | `src/host/models/modelsPanel.ts`   |

All 15 before/after hash pairs match. Hashes for the restored source files:

| File                               | SHA-256 before and after                                           |
| ---------------------------------- | ------------------------------------------------------------------ |
| `src/host/models/modelsPanel.ts`   | `bd35f2df92620ab9cf327e47e33b635510e3d3a61228f569271385283021d8aa` |
| `src/host/providers/wizardSave.ts` | `999292db964e007d391d6d017d21a4fbc5176c0c5df12b5d025603d8e72b562b` |
| `src/core/providers/panelSeam.ts`  | `dd1242fa58c810391c6ec64b4c8e47e87856c11388e15118e27af573c95e36ec` |
| `src/shared/modelsPanel.ts`        | `d0172835271fe533570de13fb8b9970464a102d531080fc06a5a08e29cabf509` |

Drills remove the entered-key distinction, current-entry merge, changed-field
comparison, initial/final key checks, expected-default comparison, conditional
key/default rollback, snapshot reload, routing-removal conflict, no-op file
admission, strict reload/conflict flag types, conflict availability and the
post-save comparison baseline. Receipt/log paths are the untracked
`temp/provwiz7-drills.json` and `temp/provwiz7-drill-*`.

## Final whole-file qualification

**45 complete provider/models/capability files, 788 passed tests, no skips.**
The final run follows every restoration and the assertion-sharing cleanup;
it uses repository deadlines, at most three files/workers per invocation.

| Batch | Complete files (`test/unit/`)                                                                     | Passed |
| ----- | ------------------------------------------------------------------------------------------------- | -----: |
| 1     | `configuredProviders.test.ts`, `execProvider.test.ts`, `modelApiProviders.test.ts`                |     57 |
| 2     | `modelCapabilitiesBinding.test.ts`, `modelsActivationBudget.test.ts`, `modelsApp.test.tsx`        |     15 |
| 3     | `modelsComponents.test.tsx`, `modelsPanel.test.ts`, `modelsPanelBundle.test.ts`                   |     52 |
| 4     | `modelsPanelEdit.test.tsx`, `modelsPanelEntry.test.ts`, `modelsPanelReducer.test.ts`              |     43 |
| 5     | `modelsPanelSchemas.test.ts`, `modelsPanelSections.test.tsx`, `modelsQuickPick.test.ts`           |     56 |
| 6     | `modelsSections.test.ts`, `modelsWebviewEntry.test.tsx`, `providerAuthService.test.ts`            |      9 |
| 7     | `providerCatalog.test.ts`, `providerCredentialRecords.test.ts`, `providerCredentialStore.test.ts` |     98 |
| 8     | `providerImportExport.test.ts`, `providerKeyPrompt.test.ts`, `providerLocalProbe.test.ts`         |     22 |
| 9     | `providerModelScans.test.ts`, `providerOAuthLoopback.test.ts`, `providerOpenRouter.test.ts`       |     30 |
| 10    | `providerPanelSeam.test.ts`, `providerProvidersHost.test.ts`, `providerRemoval.test.ts`           |     26 |
| 11    | `providerRetry.test.ts`, `providerTransport.test.ts`, `providerWiring.test.ts`                    |     67 |
| 12    | `providerWizardSave.test.ts`, `providerWorkspaceSuggestion.test.ts`, `providersFlow.test.ts`      |     39 |
| 13    | `providersL10n.test.ts`, `providersModel.test.ts`, `providersOverflow.test.ts`                    |     70 |
| 14    | `providersPolicy.test.ts`, `providersPresets.test.ts`, `providersThreats.test.ts`                 |    121 |
| 15    | `providersX.test.ts`, `providersXFix.test.ts`, `wizardSessionBudget.test.ts`                      |     83 |

The owning Edit file now has 29 cases, transaction 10, production seam 10,
bridge 13 and captured wiring 26. Per-batch logs/JSON are
`temp/provwiz7-suite-*` and `temp/provwiz7-suites.json`.

## Individual gates and retained holds

Changed-file ESLint and Prettier checks, host and final unit-project typechecks,
localization (**14 UI tables, 14 usage tables, 0 problems**), reference
(**current**), host API (**0 problems**) and plain Knip pass. Production
`npm run build` passes all size/split/global/notices checks and retains every
existing cap. The shared English surface is again **25597/25600 bytes**, exactly
the prior size; host supplies the new sentence lazily through its table.

| Bundle                         | Bytes / unchanged cap |
| ------------------------------ | --------------------: |
| Activation                     |       521707 / 614400 |
| Model API                      |       500425 / 537600 |
| Providers                      |       137457 / 153600 |
| Models host                    |       116166 / 128000 |
| Shared Node English            |        83747 / 128000 |
| Shared browser surface English |         25597 / 25600 |

Duplication still exits 1 at the unchanged zero-clone threshold: **21 clones /
287 lines / 1970 tokens**, the inherited baseline recorded for PROVWIZ6 and
reviewed at this round's starting SHA. The one repeated assertion sequence this
round initially added is shared without removing an assertion. No new clone
remains, and no ignore or threshold changes. PLAN §7 retains the lead-owned
broader duplication cleanup; aggregate quality is not claimed green.

Gate logs are `temp/provwiz7-{eslint-final,format,typecheck-unit-final,l10n,
reference,host-api,deadcode,duplication-final,build-final}.log` (and the earlier
host tsc log). No finding in this review is deferred. Aggregate quality,
coverage, hosted multi-OS, browser/installed-editor and live qualification remain
with the lead as prescribed by the rig brief. No gate, deadline, dependency,
paid policy, provider serializer or prompt prefix changes.

# PROVWIZ8 — Save recovery and refresh honesty (RVPROVWIZ7C)

2026-10-09, **macmini**, `/Users/randy/lanes/PROVWIZ6`, branch
`fix/provider-panel`, base `5f09bc0e2`. Read the rig brief, shared common rules,
RVPROVWIZ7C, AGENTS and applicable PLAN decisions/scope. PLAN §6 records this
round before code. The rig brief overrides the generic merge/full-quality
instructions: no subagents, merge, rebase, push, aggregate quality or live/paid
calls. Existing hooks stay installed at `.husky/_`; fixtures use synthetic
credentials in memory. No dependency or gate changes.

## Lead-accepted cross-window residual for 0.17.1

RVPROVWIZ7C P2-1/P2-2 require the shared LOCKLIB lease absent from this base.
Today's store-instance queue and changed-field/key comparisons remain; no
second lock implementation is added. **Two editor windows saving the same
provider at the same moment: last writer wins for fields both changed; no
secret is exposed; follow-up PROVSTORE-LOCKLIB moves the provider store and
key rotation onto the shared lease after M123 lands on main.** This decision
is also recorded at M95's provider panel scope and PLAN §8.

## P2-4 — Saved provider, failed refresh

The post-save snapshot refresh catches provider/credential read failures and
retains the completed save outcome. The saved form is retired so its obsolete
comparison baseline cannot be retried. A submitted spending limit is still
processed; its own failure is reported alongside the refresh notice. A failure
of the final panel-state refresh has the same honest notice. The host supplies
“Provider saved; the panel could not refresh — reopen it” with translations in
all 14 UI tables; the shared browser English closure gains no new key. Logs
contain only fixed words. Secrets never enter published state or messages.
Shared editor bridges receive the same React surface; the persisted schema
and ACP readers are unchanged. Installed-editor qualification remains lead-owned.

Four complete-form regressions fail before the production change:
**4 failed / 29 passed**. They reject only the post-save provider read, stored
credential read or final panel-state read, plus a refresh/limit-failure case.
After repair, complete `modelsPanelEdit`, `modelsPanel` and
`wizardSessionBudget` files pass **93 tests**, with the repository timeout and
`--maxWorkers=3`. No skips, name filters or timeout overrides. Read failures
never leak their synthetic key. Receipts are untracked
`temp/provwiz8-refresh-{before,after}.log`. Remaining rollback qualification
and final owning-suite receipts are appended below as this round completes.

The `refresh-notice` red drill replaces both honest refresh notices with the
plain generic failure: **4 failed / 33 total**, exit 1. The source is restored
in `finally`; SHA-256 before and after is
`c00bfd9b662b46cee720e044b008737aa0232ec03672d4c15a3e786ca69c28b9`.
The restored complete three-file run passes **93 tests**. Changed-file ESLint,
Prettier and localization pass; generated reference remains current. Hook
output and untracked drill/hash receipts are `temp/provwiz8-*`.

## P2-3 — Per-field inverse against the current provider

The forward provider mutation captures only the target entry's actual before
and written values. Recovery uses the existing serialized store callback to
read the latest entries and reverse only leaves changed by this save that
still equal its written value. Arrays remain one field; routing choices and
per-model token limits reverse individually. Unchanged saves perform no provider
rollback write. Other providers keep their current values, additions, removals
and order. A concurrently removed target is never recreated. A new provider is
removed only while its entry still equals this save's addition; a later edit
keeps it. Native model ids are own data properties, including `__proto__` and
`constructor`, never inherited object members.

The rendered shared form uses the real host/facade, production store and
atomic providers file. After the reply limit saves 8000, a synthetic credential
writer adds a pin and compatibility override, changes context to 256000, edits
another provider, removes another and adds a third, then rejects the key write.
Rollback restores only the reply limit to 4000; every concurrent change survives.
The form keeps the typed 8000 for retry and the prior synthetic stored key.
Transaction regressions also cover unchanged/edited/added saves under composer
refusal, a later edit to the same context-limit leaf, untouched routing order
and fallback changes, an added private-network flag, removal of the target,
and an unrelated addition during new-provider rollback. No external wire shape
or request serializer changes; all frames retain the M95 capture provenance.
**0 model attempts** throughout.

## Final red/restored drills

All qualifying drills run complete owning files, default deadlines and at most
three workers. Each deliberate source mutation fails assertions with exit 1,
then restores original bytes in `finally` and compares SHA-256. Earlier property
probes did not exercise the recursive path; adding a concurrent token-limit
change makes both property guards fail when broken. No assertion or gate is
weakened. The corrected original-source drill proves all ten new rollback cases
fail against the starting production file.

| Qualifying drill                                                    | Failed / total | Source                             |
| ------------------------------------------------------------------- | -------------: | ---------------------------------- |
| `refresh-notice`                                                    |         4 / 33 | `src/host/models/modelsPanel.ts`   |
| `rollback-original` (starting file restored temporarily)            |        10 / 53 | `src/host/providers/wizardSave.ts` |
| `rollback-collection` (whole-collection restore, initial six cases) |         6 / 49 | `src/host/providers/wizardSave.ts` |
| `rollback-concurrent-field`                                         |         1 / 51 | `src/host/providers/wizardSave.ts` |
| `rollback-added-edit`                                               |         1 / 51 | `src/host/providers/wizardSave.ts` |
| `rollback-own-fields` (final)                                       |         2 / 19 | `src/host/providers/wizardSave.ts` |
| `rollback-data-property` (final)                                    |         1 / 19 | `src/host/providers/wizardSave.ts` |

The final wizard source's before/after SHA-256 is
`ff013dc1ee6951e083a87b0f4167d3373417afc59a474384ba71fd573cd0d65b`;
refresh source hash is recorded above. The early collection drill's source hash
is `cf205e0c88133a3d054d78b02ffa5f4d05ed24459405c582d4ebb0db2f919f2f`
before and after. Full logs and every hash receipt, including exploratory
non-firing property probes, are untracked `temp/provwiz8-drill-*` and
`temp/provwiz8-drills.json`. The same two-file source-guard drills at 51 total
precede the final two added property cases; the final complete suites follow
all source restorations. The first shared-form rollback fixture needed its
connection test before listing unrelated provider rows to disambiguate Test;
its mapped fixture now has an explicit `ProviderEntry` annotation. Only the
corrected whole-file default-deadline runs qualify.

## Complete owning-suite qualification

**45 complete provider/models/capability files, 802 passed, no skips.**
Runs are sequential in batches of at most three files, with
`npx vitest run <files> --maxWorkers=3`, no test-name filters or timeout
changes. The three Meta request-golden files additionally pass **152 tests**.
The final focused Edit / transaction / production-seam run passes **63 tests**
after sharing the repeated Test/wait interaction; every assertion remains.

| Batch | Complete files (`test/unit/`)                                                                     | Passed |
| ----- | ------------------------------------------------------------------------------------------------- | -----: |
| 1     | `configuredProviders.test.ts`, `execProvider.test.ts`, `modelApiProviders.test.ts`                |     57 |
| 2     | `modelCapabilitiesBinding.test.ts`, `modelsActivationBudget.test.ts`, `modelsApp.test.tsx`        |     15 |
| 3     | `modelsComponents.test.tsx`, `modelsPanel.test.ts`, `modelsPanelBundle.test.ts`                   |     52 |
| 4     | `modelsPanelEdit.test.tsx`, `modelsPanelEntry.test.ts`, `modelsPanelReducer.test.ts`              |     48 |
| 5     | `modelsPanelSchemas.test.ts`, `modelsPanelSections.test.tsx`, `modelsQuickPick.test.ts`           |     56 |
| 6     | `modelsSections.test.ts`, `modelsWebviewEntry.test.tsx`, `providerAuthService.test.ts`            |      9 |
| 7     | `providerCatalog.test.ts`, `providerCredentialRecords.test.ts`, `providerCredentialStore.test.ts` |     98 |
| 8     | `providerImportExport.test.ts`, `providerKeyPrompt.test.ts`, `providerLocalProbe.test.ts`         |     22 |
| 9     | `providerModelScans.test.ts`, `providerOAuthLoopback.test.ts`, `providerOpenRouter.test.ts`       |     30 |
| 10    | `providerPanelSeam.test.ts`, `providerProvidersHost.test.ts`, `providerRemoval.test.ts`           |     26 |
| 11    | `providerRetry.test.ts`, `providerTransport.test.ts`, `providerWiring.test.ts`                    |     67 |
| 12    | `providerWizardSave.test.ts`, `providerWorkspaceSuggestion.test.ts`, `providersFlow.test.ts`      |     48 |
| 13    | `providersL10n.test.ts`, `providersModel.test.ts`, `providersOverflow.test.ts`                    |     70 |
| 14    | `providersPolicy.test.ts`, `providersPresets.test.ts`, `providersThreats.test.ts`                 |    121 |
| 15    | `providersX.test.ts`, `providersXFix.test.ts`, `wizardSessionBudget.test.ts`                      |     83 |

Whole-file logs/receipts are `temp/provwiz8-suite-*`,
`temp/provwiz8-suites.json`, `temp/provwiz8-meta-goldens.log` and
`temp/provwiz8-rollback-restored-final.log`. They use the repository deadline.
No installed-editor, hosted multi-OS, coverage, package or live qualification
is implied. Final gate receipts and local-commit checks follow below.

## Final individual gates and retained holds

Changed-file ESLint passes. The unit-project tsc includes all host/core/shared
and React sources plus every unit fixture; it passes without suppressions or
casts. Localization reports **14 UI tables, 14 usage tables, 0 problems**.
Reference regeneration/check reports **current** (72 features); host API reports
**0 problems**. Plain Knip exits 0 with only its two inherited configuration
hints. Production `npm run build` exits 0, including all unchanged size, split,
host-globals and notices gates. No hook, gate, dependency, setting/default,
paid-consent policy, wire schema, serializer or prompt-prefix changes.

| Artifact             | Bytes / unchanged cap |
| -------------------- | --------------------: |
| Activation           |       521707 / 614400 |
| Model API            |       500425 / 537600 |
| Providers            |       137457 / 153600 |
| Configured providers |         27721 / 51200 |
| Models host          |       117113 / 128000 |
| Shared Node English  |        83823 / 128000 |

Models browser startup remains **326.5 / 500 KiB** and shared browser surface
English **25.0 / 25 KiB**, passing the hard caps. All other bundle budgets pass.
Static/build logs are `temp/provwiz8-{eslint-final,typecheck-final,l10n-final,
reference,host-api,deadcode,build}.log` and the final formatting log.

Plain jscpd still exits 1 at its unchanged zero-clone threshold: **21 clones /
287 lines / 1970 tokens**, identical to the reviewed base's recorded hold.
The initially added six-line Test/wait clone is shared across its four uses,
retaining all waits and assertions. No new clone remains and no ignore,
threshold or rule changes. PLAN §7 retains the lead-owned broader cleanup;
aggregate quality is not claimed green. Duplication logs are
`temp/provwiz8-duplication{,-final}.log`.

Both repairs are complete in this window's store mutation. P2-1/P2-2 remain
only under the lead's explicit 0.17.1 decision above; they are not called fixed.
Aggregate quality, coverage, packages, browser/installed-editor, hosted multi-OS
and live qualification remain with the lead per the brief. No sandbox block or
install occurs. No real credential access, model/provider contact, paid/live
call, merge, rebase, push or publication occurs. Local commits use the original
installed hooks, with output in `temp/provwiz8-{refresh,rollback}-commit.log`;
their staged/committed diffs are reread and compared byte-for-byte.

# PROVWIZ9 — Ordered save and honest partial outcomes (RVPROVWIZ8C)

Rig: macbook; base `28578a4ad`; branch `fix/provider-panel`. No subagents,
merge, rebase, push, paid/live call, credentials, install, hook or gate changes.
This section supersedes PROVWIZ8's rollback contract. Rollback and inverse
machinery are deleted, including compensating credential/default writes.

Validation checks address policy/native consent, provider schema and token
limits, qualified default selection, credential/default snapshots, and an
edited limit's exact numeric setting representation and comparison baseline.
Changed provider fields are compared inside the production atomic mutation.
The order is provider, entered origin-bound key, explicit default, edited limit,
then requested composer model. Failure stops subsequent steps. Completed steps
remain stored and their localized messages survive refresh failure. All 14 UI
tables contain real translations; messages are read at runtime on the host.
Shared editor bridges use the same React form and host contract; ACP's persisted
provider schema is unchanged. No installed-editor equivalence is newly certified.

| Failure                       | Stored outcome                                          | Panel outcome                                                                                                        |
| ----------------------------- | ------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------- |
| Validation / entry write      | No save writes; old entry/key/default/limit survive     | Original error; refresh warning appends if needed; draft retained                                                    |
| Entered key write             | Provider stays; old key/default/limit survive           | Provider saved; key not saved with reason and re-entry instruction; requested later steps named unchanged            |
| Explicit default write        | Provider and entered key stay; default/limit survive    | Completed steps named; default not changed with reason; requested later steps named unchanged                        |
| Edited limit write / conflict | Provider/key/default stay; prior/current limit survives | Completed steps named; limit not changed with reason; requested conversation model unchanged                         |
| Composer refusal              | Provider/key/default/limit stay                         | Completed steps named; conversation model not changed with reason                                                    |
| Post-save refresh             | All completed writes stay                               | Full success becomes saved-provider/reopen warning; partial text keeps its exact content and appends refresh warning |

A key-write failure at a changed address leaves the old record bound to its old
origin. The provider row shows a missing key, and production stored-key lookup
refuses it. The invalid inverse (60000 context / 40000 output) and absent-routing
interleavings have no inverse to apply: intended provider edits and newer valid
mutations remain, with the original failure named. Budget-only partial drafts
can retry after refreshing their own successful writes; other partial or stale
drafts retire and reopen from storage. The original review's budget-failure plus
later panel-refresh failure preserves both saved-provider and partial-limit text.

Initial regressions: complete `providerOrderedSave.test.ts` against the base
failed 8/9, including retained writes, both review interleavings, changed-origin
key refusal and limit-before-composer ordering (`temp/provwiz9-before.log`).
A first implementation run exposed a split `return` before the edited entry;
fixed directly. Older rollback expectations were updated to assert retained
state and explicit partial outcomes. Test-only wrappers now forward the real
budget port. An unsupported edit-suggestion bridge probe was discarded; the
qualifying edit-limit regression uses admitted `providers/prefill`, the real
opening budget snapshot and a synthetic settings-write refusal.

Focused production/shared-form run: 57 passed across ordered save, Edit and
provider-host files (`temp/provwiz9-ui-final.log`). The key-state regression
first failed against the existing presence-only row; the row now also checks
origin binding. Further verification, byte-exact drills and visuals follow. Aggregate quality, coverage, package, hosted multi-OS and live
qualification remain lead-owned. Retain the inherited duplication hold and the
accepted cross-window residual: Two editor windows saving the same provider at
the same moment: last writer wins for fields both changed; no secret is exposed;
follow-up PROVSTORE-LOCKLIB moves the provider store and key rotation onto the
shared lease after M123 lands on main.

## Complete owning suites and guard-fire receipts

All 46 complete provider/models/capability files pass **816 tests** in sequential
batches of at most three with `--maxWorkers=3` and repository deadlines. The
PROVWIZ8 45-file inventory remains intact, plus `providerOrderedSave.test.ts`;
Edit adds five production/shared-form cases. Logs: `temp/provwiz9-suite-*.log`,
`temp/provwiz9-suites.json`. One old blocker assertion expected the outer generic
notice; it now checks the retained draft's specific write/conflict sentence and
still proves the saver was not called. Initial compiler checks found a duplicate
test property and an explicitly undefined optional test snapshot; both were
fixed without casts or suppressions.

Seven deliberate source mutations each failed a complete test file and restored
SHA-256 bytes exactly in `finally` (`temp/provwiz9-drills.json`):

| Drill                                              | Failed tests | Restored source    |
| -------------------------------------------------- | -----------: | ------------------ |
| Restore base rollback saver                        |          8/9 | `wizardSave.ts`    |
| Remove provider-schema preflight                   |          1/9 | `wizardSave.ts`    |
| Remove qualified-default preflight                 |          1/9 | `wizardSave.ts`    |
| Remove budget preflight                            |          1/9 | `wizardSave.ts`    |
| Treat any stored key as usable at the row's origin |         1/39 | `providersHost.ts` |
| Replace partial information on refresh failure     |         3/39 | `modelsPanel.ts`   |
| Leave budget failure metadata unredacted           |          1/9 | `wizardSave.ts`    |

Source digests after each restoration:

- `wizardSave.ts`: `bd4b7e465fd770fd6c33a1d5904d1912ed3206a82bb6c6dc17e0136aada5658d`
- `providersHost.ts`: `bc53606e4a19d8ae7f030127b6209d94738695de003d0afa93318a597a60bcda`
- `modelsPanel.ts`: `97d4944e0d94d8be9dfbc084ed9c64105f0803c3a0b96051ca65380d905b6bd3`

The final quick-pick conflict test also mutates routing/pins during confirmation;
retry reads the saved entry and carries no entered credential or default write,
so its limit/composer attempt cannot overwrite those newer provider fields.

Final restored focused run: **81 passed** across ordered save, Edit and session
budget files (`temp/provwiz9-restored-final.log`). Three complete Meta request
golden files (`metaGolden`, `metaRequestGoldens`, `modelApiGoldenRequests`)
pass **152 tests**, unchanged request expectations (`temp/provwiz9-goldens.log`).
No timeout overrides, test-name filters or skipped cases were used.

Final unit-project compiler passes (`npm run typecheck:unit`,
`temp/provwiz9-tsc-final.log`), covering host/core/shared/React and unit fixtures.

The full split check caught direct canonical-schema imports in the Models host
bundle. Preflight now calls `ProvidersStore.validate`, implemented by the
existing lazy provider seam with its canonical entry/default parsers. The test
store implements that same port. No schema or prompt shape is duplicated in
production. The focused ordered-save / original saver / production seam run
passes 38 tests after the move; the invalid-default fixture now isolates the
reference failure from unrelated missing custom limits.

The first full production build reaches the unchanged size gate and fails only
surface English: **25651 / 25600 bytes**. A complete source archive of unchanged
base `28578a4ad`, built with the same Node/toolchain on this macbook, produces
exactly **25651 / 25600 bytes** and the same failure. Both surface tables contain
778 keys / 63371 JSON characters, SHA-256
`b7d1a3d0d57c9af47ae82d92b543198c29fa4d403d8183d71b997c589953f689`.
The owned baseline archive lived under `TMPDIR` and was removed in `finally`;
no dependency install or shared-node_modules write occurred. This lane adds no
surface-English bytes. Keep the cap; record the inherited build hold for the
lead's cross-rig qualification. Receipts: `temp/provwiz9-base-build.{json,log}`.

The initial visual harness state predates the required session-budget field,
so the production panel rejects it and stays Connecting. Qualifying screenshot
runs inject the existing canonical `modelsPanelFixtures.makeState().sessionBudget`
into that fake host state before rendering. No harness/source or sandbox bypass
was added; all transport remains loopback and data synthetic.

Visual inspection passes on production browser assets, using synthetic host
outcomes and the canonical budget fixture. The new-origin key-failure notice
and missing-key row are clear at 690 px in dark theme. The limit-failure plus
refresh warning wraps at 320 px in dark theme; German key failure wraps at
320 px in light theme. Both narrow pages have document scroll width exactly
320 px; the wide page is exactly 690 px. No clipping or document overflow.
Screenshots: `provwiz9/key-failure.png`, `provwiz9/limit-refresh.png`,
`provwiz9/key-failure-de.png`; `temp/provwiz9-visual.log` records measured widths.
These are shared React rendering checks, not installed-editor qualification.

## Final lazy-port guard qualification

After the schema move, all 46 complete owning files again pass **816 tests**.
All seven final drills fail and restore exact source bytes; final counts remain
8/9, 1/9, 1/9, 1/9, 1/39, 3/39 and 1/9 in the table order above. Entry and
qualified-default guards now fire in `src/core/providers/panelSeam.ts`, so
canonical schemas stay in the provider bundle. Logs and hashes:
`temp/provwiz9-final-drill-*.log`, `temp/provwiz9-final-drills.json`.

- `src/host/providers/wizardSave.ts`: `5e16cfd8df09aa14f42e9e3110b5c67c7f4f45b388444728b4413a722b91fae0`
- `src/core/providers/panelSeam.ts`: `3601f2d2dedb8728f3f3d82c4b9f02f0f46f17f473bcf7f38ff8bfd5354f019a`
- `src/host/providers/providersHost.ts`: `bc53606e4a19d8ae7f030127b6209d94738695de003d0afa93318a597a60bcda`
- `src/host/models/modelsPanel.ts`: `f27dc9a608087b72390d79242af3ff0f1beae7a9161ba12c322cfb42a9ef0452`

The restored focused run passes **81 tests**, and the complete request goldens
again pass **152 tests** after the move (`temp/provwiz9-port-restored-final.log`,
`temp/provwiz9-port-goldens-final.log`). No test skips or deadline overrides.

## Final gates, build hold and planning status

Final unit-project compiler passes (`temp/provwiz9-port-tsc-final.log`) with the
lazy preflight port, every host/core/shared/React source and unit fixture. Changed
file ESLint and Prettier pass. Reference regeneration/check is current (72
features); localization reports 14 UI / 14 usage tables, 0 problems; host API is
0 problems. Plain Knip passes with its two inherited configuration hints. The
final bundle split, host-global and third-party-notice checks each pass (88
bundled packages). `temp/provwiz9-gates.json` records each real exit code.

Plain jscpd exits 1 with the same inherited **21 clones / 287 lines / 1970 tokens**;
no new clone. Full `npm run build` exits 1 only at the inherited surface-English
size gate (**25651 / 25600 bytes**, exactly the unchanged base on this rig).
All other bundle size/deferred budgets pass. No cap, threshold, ignore, hook or
timeout was changed. Split runs separately after that size stop and is green;
this does not turn the full build or aggregate quality green.

| Artifact                      | Final bytes |          Unchanged cap |
| ----------------------------- | ----------: | ---------------------: |
| `dist/extension.js`           |      521707 |                 614400 |
| `dist/modelApi.js`            |      500425 |                 537600 |
| `dist/providers.js`           |      137641 |                 153600 |
| `dist/configuredProviders.js` |       27721 |                  51200 |
| `dist/modelsPanel.js`         |      118489 |                 128000 |
| `dist/uiText.js`              |       83983 |                 128000 |
| Chat browser startup          |      750282 |                 921600 |
| Models browser body           |       63633 |                  76800 |
| Surface English               |       25651 | 25600 (inherited hold) |

`temp/provwiz9-sizes.json` records all deferred groups. Aggregate quality,
coverage, packages, installed/editor, hosted multi-OS and live qualification were
not run under the explicit rig/common brief. No real credentials or paid model
calls were used; no dependency install, push, rebase or merge occurred.

Planning check: this repository's current planning document is `PLAN.md`.
PROVWIZ9's implementation, complete scoped regressions, final byte-exact drills
and shared production rendering checks are complete. Next slice is lead review
and cross-rig release gates, with the inherited size and duplication holds kept
visible. PROVSTORE-LOCKLIB follows after M123 lands on main; the accepted
cross-window last-writer-wins residual is retained at M95 and section 8.

First local commit: `b17170fb9`, with installed hooks at `.husky/_`, output in
`temp/provwiz9-save-commit.log`. Its staged and committed source/test diffs were
re-read; drilled source hashes matched after the hook. The following local
commit carries the lazy-port correction, final qualification record and visual
receipts. Final commit output, committed-diff and hash checks are retained under
`temp/provwiz9-final-*`; no hook path or hook behavior was substituted.

# PROVWIZ10 — Re-entry recovery and retained retry receipts (RVPROVWIZ9C)

Rig: macbook; base `00df4f872`; branch `fix/provider-panel`. Both P2 findings
are repaired with the production provider store and credential facade. No
rollback, provider schema, request shape, paid policy or origin guard changes.
Credentials remain host-only and never join published state or logs.

Edit now snapshots the complete credential record even when its origin is
refused. Save compares that same record before the first write. The shared
React regression changes the address, fails the replacement key write, proves
the old key cannot serve the new origin, reopens Edit, enters/tests another
key and saves successfully. Two genuine-concurrency controls rotate the key
at either the new or old origin; both conflict without changing provider,
default or limit. No key appears in published state or fixed warning logs.

Quick-pick carries completed receipt strings through confirmed budget retries.
The production-store/facade/settings regression saves provider/key/default,
observes a concurrent $5 → $2 limit, confirms replacement, then rejects the
numeric settings write. All completed receipts and the failed limit/skipped
conversation model remain in the final notice. The same regression runs in
English and all 14 shipped translations through the production table loader.

Before fixes: 2 qualifying cases failed / 73 passed in the two complete files
(`temp/provwiz10-before.log`). Initial post-fix runs exposed a test-only
`present` versus canonical `stored` state assertion and old snapshot-read
spies; both were corrected. The saver success assertion now includes its
completed receipts. Focused verification: **108 passed** across complete Edit,
session-budget and wizard-save files (`temp/provwiz10-ready.log`), repository
deadlines, no name filters, skips or timeout overrides.

Both deliberate reversion drills failed their complete file and restored source
SHA-256 bytes exactly in `finally` (`temp/provwiz10-drills.json`):

| Reverted fix                                                                            | Failed tests | Restored SHA-256                                                   |
| --------------------------------------------------------------------------------------- | -----------: | ------------------------------------------------------------------ |
| Compare origin-refused records against the saved entry's origin again (`wizardSave.ts`) |       1 / 41 | `c5ebd71ea92f14a3b1b92bf1e74d34e946406526ce4aa1d429c203552606d3ed` |
| Drop prior receipts from the quick-pick retry (`modelsQuickPick.ts`)                    |      15 / 48 | `bbca44df1dfcee34239b8e790e5eb1745625128f48ffa62ec16c6c39046d313e` |

Unit-project tsc passes (`temp/provwiz10-tsc.log`). Final complete-suite, static
and cap receipts follow below.
Aggregate quality, release/editor/hosted/live gates remain lead-owned under
the rig brief. Next slice after these repairs: lead review and cross-rig
release gates, then PROVSTORE-LOCKLIB after M123 for the accepted cross-window
last-writer-wins residual.

Initial changed-file ESLint/Prettier pass, and localization reports 14 UI
and 14 usage tables / 0 problems. Reference regeneration succeeds (72 features).
No command, setting or dependency is added. Aggregate quality is delegated by
the rig brief and is not claimed green; PLAN §7 records scoped qualification
and remaining release gates.

## Final scoped verification and cap repair

All checks run directly on macbook, sequentially with at most three complete
Vitest files / `--maxWorkers=3`. Repository test deadlines remain unchanged.

| Verification                                                 | Result / receipt                                                                                                                          |
| ------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------- |
| All 46 owning provider/models/capability files               | 833 passed; `temp/provwiz10-suites.json`, `temp/provwiz10-suite-*.log`                                                                    |
| `metaGolden`, `metaRequestGoldens`, `modelApiGoldenRequests` | 152 passed; `temp/provwiz10-goldens.log`                                                                                                  |
| `ReferencePage`, `referenceGenerator`, `browserUiText`       | 141 passed; `temp/provwiz10-reference-tests-final.log`                                                                                    |
| Both final reversion drills                                  | 1 Edit / 15 translated retry regressions fail; SHA-256 restoration exact; `temp/provwiz10-drills-final.log`, `temp/provwiz10-drills.json` |
| Final restored Edit / session budget / wizard save           | 108 passed; `temp/provwiz10-restored-final.log`                                                                                           |
| Unit-project tsc                                             | Exit 0; one run, `temp/provwiz10-tsc.log`                                                                                                 |
| Changed-file ESLint / Prettier                               | Exit 0; `temp/provwiz10-{eslint,prettier}-final.log`, final budget-file lint after sharing its expectation                                |
| Localization                                                 | 14 UI / 14 usage tables, 211 manifest strings, 1051 source files; 0 problems                                                              |
| Reference / host API                                         | Current (72 features) / 0 problems                                                                                                        |
| Plain Knip                                                   | Exit 0; only the two inherited configuration hints                                                                                        |
| Production build including size / split / globals / notices  | Exit 0; `temp/provwiz10-build-final.log`                                                                                                  |

An initial Help test caught replacement of the established “Muse receives”
phrase. The final shorter summary retains that phrase and explicitly names
seconds; no test was weakened. The duplication check initially found one new
11-line expectation clone in the retry regression. Sharing that expected
partial notice between its production retry/control cases keeps all assertions.
The changed complete session-budget file passes 48 tests. Plain jscpd returns
to the exact inherited **21 clones / 287 lines / 1970 tokens**, exit 1 at its
unchanged zero threshold (`temp/provwiz10-duplication-restored.log`). Broader
cleanup and aggregate quality remain open; no new clone or ignore remains.

The reviewed inherited surface table was **25651 / 25600 bytes**. Existing
`referenceQuestionsDeferral` was verbose: 872 English bytes, now 708. Its
pinned-card/Answer/focus behavior, submitted answers, deadline and zero behavior,
late-message/no-approval rule, navigation, scheduled/headless handling and ACP
commands remain. The same key is shortened with real translations in all 14
tables, and `docs/reference.md` is regenerated. No new key, codec, reader split
or budget change. Final full production closure: **25595 / 25600 bytes**,
56 bytes smaller and 5 bytes below the cap (`temp/provwiz10-sizes.json`).

Compressed contributions are coupled, rather than additive by string. The
reviewed table's largest existing value groups remain `referenceCliOptions`
(4075 raw JSON bytes), `acpUsage` (1829), `planUi` (1764) and
`referencePermissionLimits` (1563); none changes here. Shortening only
`referenceQuestionsDeferral` closes the overage. Exploratory shorter CLI wording
compressed worse and was discarded without changing any table. Cap probe
estimates are not final build measurements; the production gate above is the
qualification receipt.

| Final production artifact / closure | Bytes / unchanged cap |
| ----------------------------------- | --------------------: |
| Activation                          |       521707 / 614400 |
| Model API                           |       500425 / 537600 |
| Providers                           |       137641 / 153600 |
| Configured providers                |         27721 / 51200 |
| Models host                         |       118739 / 128000 |
| Node English                        |        83855 / 128000 |
| Models browser startup              |       334425 / 512000 |
| Models body                         |         63633 / 76800 |
| Chat browser startup                |       750282 / 921600 |
| Original deferred JS                |         32823 / 51200 |
| Surface English                     |         25595 / 25600 |

## Visuals, commit verification and next slice

Inspected five fresh PNGs from the production browser bundles behind synthetic
host data: [repaired key](provwiz10/repaired-key.png) at 690 px, retry receipts
at 320 px in [English](provwiz10/retry-receipts.png) and
[German](provwiz10/retry-receipts-de.png), and the shortened Help paragraph at
320 px in [English](provwiz10/help-deferral.png) and
[German](provwiz10/help-deferral-de.png). Dark/light themes respectively; all
notice text and the repaired origin-bound key row are readable, without clipped
text or document overflow. Every page reports 0 errors and document width equal
to its viewport. These prove rendering, while the production-store/shared-form
regressions prove saving; no installed-editor qualification is claimed.

The initial Help capture detected the fake chat host's fixed 690px html/body
width. The qualifying narrow capture sets only those harness container widths
to 100%, matching a real editor viewport. Models captures inject the canonical
budget fixture required by the protocol, as in PROVWIZ9. No product/harness
source or sandbox bypass changes. Receipts: `temp/provwiz10-visual{,-help}.log`.

First local commit: `0b0100e85`, with original installed `.husky/_` hooks and
output in `temp/provwiz10-fixes-commit.log`; staged/committed diffs were reread
and compared byte-for-byte. The closing commit carries the existing-string
cap repair, shared test expectation, final docs and five visual receipts.
Commit output and staged/committed diff checks remain in `temp/provwiz10-final-*`.
No hook path or behavior changes, install, sandbox block, real credential access,
provider/model contact, paid/live call, merge, rebase, push or publication.

Planning status checked: **PROVWIZ10 implementation and scoped qualification
complete; both RVPROVWIZ9C P2 findings and the inherited surface-English hold
closed.** Next slice: lead review and cross-rig release gates, including the
inherited duplication hold, aggregate quality/coverage/packages and hosted/
editor/live certification. Shared editor bridges retain the same React form
and credential-free protocol; ACP's persisted schema is unchanged. The accepted
cross-window last-writer-wins follow-up remains PROVSTORE-LOCKLIB after M123
lands on main. No owner decision or additional authorization is needed here.
