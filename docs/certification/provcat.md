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
