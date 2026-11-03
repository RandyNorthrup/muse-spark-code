# RLF-GEMPRIVACY certification record (2026-11-02)

Lane PROV-HONEST, P2: Gemini storage opt-out and lifecycle honesty. Base
`72d8d5003` (int after RVINT9), rig linuxlt. The lane ran in Muse Spark Code
until Muse's weekly allowance was kept for merging; it was finished in
Claude Code on the same branch. First-hand provider reads, quoted with
their URLs and read date: [`rlf-gemprivacy/sources-2026-11-02.md`](rlf-gemprivacy/sources-2026-11-02.md).

No paid provider call and no Muse model request was made for this proof.

## What is now true

- **(a) Gemini storage opt-out.** `encodeGeminiRequest` sends the canonical
  body's `store` (typed as the literal `false`) on every Gemini request, so
  a project that stores GenerateContent by default (new paid projects since
  2026-10-26) does not keep the prompts and responses. The Gemini key step
  says so in one sentence (`providerText.privacyNotes.geminiStore`, English
  plus 14 tables).
- **(b) OpenAI `shutdown_date`.** `nativeCapabilityEvidence` reads the
  models list's `shutdown_date` for every non-Anthropic preset (Azure and
  xAI share the list shape): a set day becomes `retiresAt` plus a
  `deprecated` lifecycle, as Anthropic's dates already did. The picker
  shows "Retires" and the day.
- **(c) Catalogue status.** `scripts/sync-provider-catalog.mjs` keeps
  models.dev's `status` where it is `deprecated` or `beta` (any other word
  on a kept row fails the sync for review; `alpha` outside the sync table
  does not fail the download parse). The record carries it; the Models
  table and the picker badge Deprecated and Beta. Snapshot re-sealed
  2026-11-02: 81 of 710 kept rows carry a status, 314,208 bytes under the
  524,288-byte cap.
- **(d) Gemini reroutes.** `src/core/providers/geminiReroutes.json` is a
  dated, cited table (changelog anchor + read date per row):
  `gemini-3.5-flash` → `gemini-3.6-flash` and `gemini-3.7-flash` →
  `gemini-3.8-flash` now; `gemini-2.5-pro` → `gemini-3.8-flash` and
  `gemini-2.5-flash` → `gemini-3.5-flash-lite` from 2026-12-01. An active
  reroute prices and labels the row as the serving model and the picker
  says "Serves <id> requests"; a future one keeps today's price and says
  "Routes to <model> on <date>". `filterCatalog` re-checks every row on
  each sync (both ids listed, the serving model priced) and fails naming
  the stale row and its page. A reroute turns active by the catalogue's
  own `fetchedAt`, not the clock: the 2026-12-01 rows start pricing as
  their serving model with the first sync dated on or after that day.
- **Never blocked.** Lifecycle and reroute only add marks; no code path
  filters or refuses a deprecated or retired model (D121).
- The providers reference gains one paragraph naming all of the above
  (`referenceProviderLifecycle`, 14 tables; `docs/reference.md`
  regenerated). CHANGELOG `[Unreleased]` has three entries.

## Commits

| Commit      | Part                                                                                    |
| ----------- | --------------------------------------------------------------------------------------- |
| `aa8362f42` | strings in English plus all 14 tables                                                   |
| `25ea4f99d` | store opt-out, shutdown dates, status keep + badges, reroute table and pricing; re-seal |
| `907bc126b` | real-code tests over recorded captures and the sealed snapshot                          |
| `56a1abbbf` | one-brace repair of the base harness so `ui:look` scenes parse                          |
| `6cf6a798f` | `models-table` scene; the credential scene scrolls its step into view                   |
| `80b0251f0` | host-composed picker marks keep the Palette inside its 25 KiB budget                    |
| `4a3508834` | providers reference paragraph (14 tables), CHANGELOG                                    |
| `b97b5b518` | the sync's real filter keeps `status` over recorded rows                                |

## Red/green drills

Each: break on purpose, run the suite with the repository's timeouts,
restore from git (`git status` clean), run again.

| #   | Broken                                                    | Suite                          | Red                                                                        | Green  |
| --- | --------------------------------------------------------- | ------------------------------ | -------------------------------------------------------------------------- | ------ |
| 1   | `gemini.ts` no longer sends `store`                       | `capabilityRecord.test.ts`     | exit 1 (`opts every Gemini request out of provider storage`)               | exit 0 |
| 2   | `modelMetadata.ts` ignores `shutdown_date`                | `capabilityRecord.test.ts`     | exit 1 (`reads an announced OpenAI shutdown day as deprecated…`)           | exit 0 |
| 3   | `filterModel` drops `status`                              | `syncProviderCatalog.test.mjs` | exit 1 (`keeps the status word when the sync filters a recorded download`) | exit 0 |
| 4   | `assertReroutesCurrent` skips its rows                    | `syncProviderCatalog.test.mjs` | exit 1 (`refuses a snapshot that drops a serving model, naming the page`)  | exit 0 |
| 5   | `badgesFor` never awards Deprecated                       | `providersFlow.test.ts`        | exit 1 (`awards badges by their rules`)                                    | exit 0 |
| 6   | `pickerMarks` shows the word instead of the announced day | `modelOptionLifecycle.test.ts` | exit 1 (`composes lifecycle, retirement, beta and reroute…`)               | exit 0 |
| 7   | `applyGeminiReroute` never answers the serving row        | `geminiReroutes.test.ts`       | exit 1 (3 failed: serving row, active price, registry list)                | exit 0 |
| 8   | the Gemini key step drops the sentence                    | `wizardPrivacyNote.test.tsx`   | exit 1 (`shows the preset note beside the key entry`)                      | exit 0 |

Drills 1, 2, 4 and 5 ran in the Muse Spark Code part of the lane; 3, 6, 7
and 8 in the Claude Code finish. An earlier attempt at drill 3 broke only the
schema and stayed green (the old test read the sealed file, not the
filter); that gap is why `b97b5b518` drives `filterCatalog` itself.

## Catalogue sync drill

- `--sync --date 2026-11-02 --sha256 dbfacaf2…7e2d76a` over the live
  download: exit 0, 314,208 snapshot bytes.
- `node scripts/sync-provider-catalog.mjs --check`: exit 0 ("2 files
  sealed, snapshot 314208 bytes"), re-run on the final tree.
- `syncProviderCatalog.test.mjs` round-trips the sealed rows through the
  real filter byte for byte (status kept, cap held) and refuses a snapshot
  missing a serving model.

## Golden request

`capabilityRecord.test.ts` › `opts every Gemini request out of provider
storage`: the encoded `gemini-2.5-flash` body is exactly
`contents`, `store: false`, `generationConfig`.

## Looks (`npm run ui:look`, light and dark, local only)

`models-byo` (the composer picker: "Serves gemini-3.5-flash requests",
"Routes to Gemini 3.8 Flash on Dec 1, 2026", "Retires Jan 14, 2027"),
`models-table` (Deprecated and Beta badges) and `models-credential-gemini`
(the store=false sentence at the key step), shot after `80b0251f0`.

## Gates (final tree)

| Gate                                                   | Exit    |
| ------------------------------------------------------ | ------- |
| `prettier --check` (60 lane-touched files)             | 0       |
| `eslint --max-warnings 0` (lane-touched code)          | 0       |
| `npm run typecheck`                                    | 0       |
| `node scripts/check-l10n.mjs`                          | 0       |
| `npm run check:reference`                              | 0       |
| `npm run check:host-api`                               | 0       |
| `npm run check:plan`                                   | 0       |
| `npm run check:roadmap`                                | 0       |
| `npm run check:catches`                                | 0       |
| `npm run duplication` (0 clones)                       | 0       |
| `npm run cycles`                                       | 0       |
| `npm run deadcode`                                     | 0       |
| `npm run build` (every budget; Palette 24.8 of 25 KiB) | 0       |
| `node scripts/sync-provider-catalog.mjs --check`       | 0       |
| `npx vitest related <29 changed sources> --run`        | running |

## Not run here

- **Gemini acceptance capture.** The API reference documents `store` as a
  request-body field that overrides the project setting, so no capture was
  needed to build; a live call confirming Google accepts it on
  `generateContent` is a paid call and was not made. For the lead: at most
  2 calls on the cheapest Gemini model, stated first.
- **Real use through the packed product** (`muse-spark-1.3-contributor`,
  empty workspace): not run, Muse's week is kept for merging.
