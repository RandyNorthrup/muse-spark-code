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

### Red drills (byte-exact restoration)

Every drill runs a whole owning test file at repository deadlines, records
exit 1, restores the original bytes in `finally`, and compares SHA-256.

| Finding | Deliberate break                            | Red result                                                    | Restored SHA-256                                                   |
| ------- | ------------------------------------------- | ------------------------------------------------------------- | ------------------------------------------------------------------ |
| F2      | Remove the preset fallback in scan dispatch | 3 tests fail: Gemini/Ollama refusal, Anthropic header missing | `158d0578ca5bfc5de0bb2205a81f3b23b81940dca4227fd5782c39a517860d11` |
