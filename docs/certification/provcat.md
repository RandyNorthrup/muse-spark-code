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

## 2. The panel writes on Save, before the provider, and keeps the draft on failure

`src/host/models/modelsPanel.ts` (`providers/save`) applies the draft's
number before `saveDraft`: a failed write keeps the draft (and its typed
value) with the specific error and never reaches `onWizardSaved`, so no
setup success is reported and nothing is written, which keeps a retry
clean (a re-`add` of a saved provider id rejects as a duplicate).
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
through the same shared function before `saveDraft`: a failed write shows
its specific error and reports no setup success. `ProviderQuickPickOutcome`
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
9. Panel: a failed write keeps the draft and its typed value, shows the
   specific error in `draft.errors`, never calls `onWizardSaved`, and the
   provider store stays empty.
10. Quick pick: the typed budget is written through the shared function;
    the field's title, prefill and scope hint are asserted on the input
    call; the success banner names the saved provider and model.
11. Quick pick: an unchanged number writes nothing.
12. Quick pick: a failed write shows the specific error, shows no
    setup-success banner, returns `undefined`, and saves no provider.
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
