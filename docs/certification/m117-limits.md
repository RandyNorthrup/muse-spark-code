# M117 limits round 6 (CM1173R6) — RVCM1173E findings certification

Lane `CM1173`, branch `c/m117-3`, reviewed HEAD `6e76778b9`.
Review: `RVCM1173E.report.md` (seven P2 + three P3). Rig `kubuntu`,
worktree `/home/randy/lanes/CM1173`, run 2026-10-11. Every finding is
fixed and shipped in this round; no residuals.

## Drill method

Each fix got a red drill during the lane: the guard was broken in a
`$TMPDIR` backup copy, the named regression test was run and failed,
the file was restored from the backup, and `cmp` proved the restored
file byte-identical to the pre-drill file. The SHA-256 hashes below are
the committed post-restore files, hence equal to the pre-drill state by
that `cmp` proof. Byte counts are `wc -c` of the same files.

## Ruling 1 — producer enumeration: an observation without an owner cannot exist

`UsageRecording.limit` (`src/core/usage/recording.ts`) requires
`{ owner, sequence }` on the one observation type; `scopeLimits` mints
the sequence from a shared per-owner+source counter and returns a
`ScopedUsageRecording`. A corrupt owner or sequence is refused with a
warning. Every producer constructs through this one function:

| Producer                                  | Owner source                                                                                                                                      |
| ----------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------- |
| Production Model API balance observations | Models factory default-account/generation scope; `ProvidersHost.openRouterUsage` now has a production caller on every OpenRouter save (finding 7) |
| Usage limit cards history                 | Ownerless history migrated once with an explicit unknown owner, shown as unknown, never as a current limit (finding 6)                            |
| ACP                                       | Reauthentication retires the generation and replaces the live producers; hosts resolve the current scope live (finding 5)                         |
| Editor, Muse Code side                    | `MuseCodeHost.usageScope` live supplier; per-conversation `estimatorForSurface` + delivery check (findings 3, 4)                                  |
| Editor, Model API side                    | `ModelApiBackendManager.usageScope`, `ModelApiPaidHooks.usageScope`; `Secrets.onDidChange` bumps the generation (finding 4)                       |
| Headless/CLI/ACP ports                    | `limitScope`/recheck rotation and exec scope keep `providerId` + registry label (finding 8)                                                       |

Every consumer takes only owned observations via `ownedLimits()` and
`currentOwnedLimitSnapshots`.

## Finding → fix → test → drill

| Finding                                                        | Fix (primary guard file, hash, bytes)                                                                                                                                                                                                                                                                                                                | Regression test                                                                                                                                                                 | Drill                                                                                                                                 |
| -------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------- |
| P2 F1: older reply overwrites newer observation                | `src/core/usage/recording.ts` `313f77af…964a12702e`, 15449 B — `observedAt` dominates, `sequence` breaks ties per owner+source                                                                                                                                                                                                                       | `estimatorOwnedRound6`: keeps the newer observation in either arrival order (finding 1)                                                                                         | D1: broke newest-wins, named test failed, `cmp` identical                                                                             |
| P2 F2: binary money mis-admits at the boundary                 | `src/core/estimator/schedule.ts` `c3e29b39…c7596d5`, 46075 B + `src/shared/estimateFacts.ts` `dde0c6ea…487a`, 3080 B — USD as exact-decimal strings end to end, BigInt admission path                                                                                                                                                                | `estimatorOwnedRound6`: admits the exact-decimal boundary binary arithmetic refuses (finding 2); keeps usd facts as exact decimal strings and rejects numeric money (finding 2) | D2: reverted to double comparison, boundary test failed (`0.1*3 vs 0.3`), `cmp` identical                                             |
| P2 F3: estimate not bound to its conversation through delivery | `src/host/conversation/conversationController.ts` `e1d3020b…bea2481c2c9c`, 413008 B — per-`ChatSurface` estimator, provider id at request, delivery check, `setModel` invalidation                                                                                                                                                                   | `conversationController`: clears the displayed estimate when the provider switches; drops a held estimate when the provider switches before delivery                            | D3A: first version vacuous (delivery check masked abort), split into displayed-clear + held-drop, then red correctly, `cmp` identical |
| P2 F4: credential save without `useNow` skips the generation   | `src/host/models/modelsPanel.ts` `0b77168d…04463155d7500`, 30038 B + `modelsPanelEntry.ts` `e91e533a…f382b1011d9`, 15522 B — every save notifies; `Secrets.onDidChange` bump                                                                                                                                                                         | `modelsPanel`: notifies every saved credential and refreshes an OpenRouter balance (findings 4 and 7)                                                                           | D4: restored the `composerSet` gate, named test failed (0 notifications), `cmp` identical                                             |
| P2 F5: ACP recheck leaves producers on the retired generation  | `src/runtime/main.ts` `343ec2ac…c60e0e702ac`, 59563 B + `MuseCodeHost.usageScope` — recheck retires the generation and replaces live producers                                                                                                                                                                                                       | `estimatorOwnedRound6`: publishes under the new generation after reauthentication on the same host (finding 5)                                                                  | D5: kept the captured recorder, named test failed (stamped g1), `cmp` identical                                                       |
| P2 F6: usage cards consume ownerless observations/history      | `src/extension.ts` `ee06903a…1fc65f8d2c40605`, 200001 B + `src/webview/usage/LimitsSection.tsx` `fa5effae…1175bae41ad3`, 11484 B — `currentOwnedLimitSnapshots` feed + explicit unknown marker row                                                                                                                                                   | `estimatorOwnedRound6`: reads only the current owner and marks retired providers unknown (finding 6)                                                                            | D6: passed `recording.limits()` back in, named test failed, `cmp` identical                                                           |
| P2 F7: production OpenRouter balance never published           | Same `modelsPanel` guard as F4 — production `openRouterUsage` refresh on every OpenRouter save                                                                                                                                                                                                                                                       | Same findings-4-and-7 panel test                                                                                                                                                | D7: removed the production caller, named test failed, `cmp` identical                                                                 |
| P3 F8: headless fallback hard-codes Meta                       | `src/host/estimator/fleetBinding.ts` `7cf672d0…2cc965c2d5c`, 24868 B + `src/runtime/estimator/ports.ts` `58672f8e…570399fc47`, 10348 B — fallback keeps `providerId` + registry label                                                                                                                                                                | `estimatorOwnedRound6`: keeps the selected provider and registry label for unknown headless limits (finding 8)                                                                  | D8: restored the Meta hard-code, named test failed, `cmp` identical                                                                   |
| P3 F9: panel +1 B receipt                                      | No panel trim: R6 changed no estimator-panel component (its two webview files live in `src/webview/usage/`, bundled into `usagePanel.js`), so R6 growth on the frozen aggregate is 0 by construction; the reported +1 B belongs to R5. `npm run build` (with `check-bundle-size.mjs`) exits 0; `dist/headless.js` 102253 B under its 100 KiB budget. | Bundle gate, not a unit test                                                                                                                                                    | — (receipt correction, no guard to break)                                                                                             |
| P3 F10: stale host-API record                                  | Regenerated `docs/ide-compatibility/host-api.md`: 376 APIs, 0 problems.                                                                                                                                                                                                                                                                              | `check:host-api` gate                                                                                                                                                           | — (generated file, no guard to break)                                                                                                 |
| Report kinds (K)                                               | New `src/core/estimator/reportFacts.ts` `fba6e0e6…fc86ede5`, 2381 B + `reportFactsFromContext`                                                                                                                                                                                                                                                       | `estimatorOwnedRound6`: exports typed report fields without decoding sentences (report kinds)                                                                                   | DK: decoded an English sentence, named test failed, `cmp` identical                                                                   |
| Ruling 1 enforcement                                           | Same `recording.ts` guard — owner/sequence required, one constructor                                                                                                                                                                                                                                                                                 | `estimatorOwnedRound6`: refuses an observation without a usable owner or sequence (ruling 1)                                                                                    | DR1: allowed the empty owner, named test failed, `cmp` identical                                                                      |

## Ruling 5 — exact typed fields exported for the report-kinds lane

From `src/core/estimator/reportFacts.ts` (`EstimatorReportFacts` via
`reportFactsFromContext`; amounts raw — numbers for counts/percent,
exact-decimal strings for usd; labels as rows, never parsed from text):

- `fact.owner.{kind, id, providerId, generation}` (`kind`: `account | machine`)
- `fact.metric`, `fact.unit` (`requests | tokens | percent | usd | null`)
- `fact.used`, `fact.limit`, `fact.remaining` (independently nullable `number | string`)
- `fact.window.{startsAt, resetsAt, periodSeconds, calendarPeriod}`
- `fact.observedAt`, `fact.observedBy`
- `labels[]: {accountId, providerId, label}`

Diagnostics keep travelling as the existing JSON code/parameter
records rendered at presentation time; no new diagnostic identifiers
are exported here.

## Gate receipts

- Unit suites (repo default timeout, `--maxWorkers=3`): `estimatorOwnedRound6` + `estimatorFleetFactsReview` 25 passed; `conversationController` + `modelsPanel` + `usageText` 700 passed; `estimatorLimitFacts` + `usageRecording` + `usageContracts` 55 passed; `modelApiProviders` + `museUsageDeltas` + `UsageLimitsSection` 30 passed.
- Typechecks: host, unit, webview, e2e, integration — all exit 0.
- `npm run build` exit 0. ESLint changed files `--max-warnings 0` clean. Prettier clean. `check:l10n` 0 problems. `check:reference` current. `check:host-api` 376 APIs, 0 problems. Knip: 2 pre-existing config hints only. Cycles clean.
- `jscpd`: 5 clones remain, all inside `test/unit/estimatorFleetBinding.test.ts` and `test/unit/runtimeEstimatorPorts.test.ts`, neither touched by R6 — pre-existing on the base (threshold 0 fails there too). Zero clones involve R6 files: the round's `bindWorkFleet`, `ownedRecording`, `connectedDraft`, `admitBoundary`, `switchedHarness` and `silentRecording` extractions removed every added clone.
- `usageIntegration` companion 502 failure is pre-existing on the clean base worktree (environmental); unchanged by R6.
