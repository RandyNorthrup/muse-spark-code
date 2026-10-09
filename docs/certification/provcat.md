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
