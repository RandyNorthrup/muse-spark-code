# C-X-1 certification — Truth pass for 0.18.0 (2026-10-10, linuxlt)

No release text claims what the code refuses. Worktree `/home/randy/lanes/CX1`,
branch `c/x-1`, base `82d50d5e4` (0.17.0 release merge, PR #145).

## Evidence per wording change (code path cited, all read on this base)

- **M96 teams cannot be created.** `PaidFeatureGate.isOn('teamWorkers')`
  requires `isTeamAvailable?.() === true`
  (`src/core/paid/paidFeatures.ts:141-145`); no production caller supplies
  `isTeamAvailable` (only `test/unit/teamWorkersPaid.test.ts:33` does), and
  `src/extension.ts` registers no team command. Roles configuration shipped
  in 0.15.0 (`CHANGELOG.md` 0.15.0: "Configure role pools, task limits").
  → entries.json M96 summary rewritten, labelled `not available yet`;
  PLAN M96 status `planned` → `building` (first parts in 0.15.0).
- **M109 vault refuses closed.** Activation passes `service: undefined`
  (`src/extension.ts:2089-2093`); `loadVaultControls` throws
  `UI_TEXT.vault.brokerBlocked` while the C/B/P/M adapter is an open handoff
  (`src/host/vault/vaultPanelBundle.ts:103-123`). First-party keys keep
  working; agent uses are refused (same message text, `en.ts:6203-6206`).
  → PLAN M109 status `released` → `building` (false-release correction);
  entries.json M109 summary rewritten, labelled `not available yet`.
- **M115 closed-editor fires refused.** Store, engine, panel/CLI/ACP surfaces
  and live-session delivery are wired (`src/extension.ts:3560-3566`,
  `src/acp/agent.ts:1781-1794`, `src/runtime/schedules/command.ts:163-164`);
  unattended firing while all editors are closed needs vault unattended
  grants (vault closed, `src/runtime/vault/execVault.ts:87`) and the native
  OS entry, whose certification "remains an integration prerequisite"
  (`docs/ide-compatibility/hosts.md:135-137`).
  → entries.json M115 summary rewritten, labelled `not available yet`;
  PLAN M115 status `planned` → `building`; hosts.md VS Code row qualified
  to live sessions.
- **M117 estimator still says so.** Production ports refuse the snapshot with
  `M117-W-M113-plan-reader` (`src/host/estimator/localFleet.ts:106-136`)
  even though the reader is on main (`src/core/reporting/plan/reader.ts`).
  → `CHANGELOG.md` 0.17.0 capacity-estimates bullet reworded (reader on main
  but unbound); PLAN M117 status `planned` → `building`.
- **M106 previews unwired.** No tool declares `previewFields`
  (only the plumbing in `tools.ts:693-727` and the reader in
  `ModelApiHost.ts:5578-5583` reference it), so `ArgumentPreview` snapshots
  always carry empty text (`argumentPreview.ts:92-103`). Strict contracts,
  side-answer validation and concurrent reads are wired.
  → entries.json M106 summary rewritten (no preview claim); PLAN M106 status
  `planned` → `building`.
- **M101/M105/M107/M113/M114/M108/M95 statuses** `planned` → `building`
  with first-parts-shipped parentheticals; each matches its entries.json
  release (0.15.0/0.16.0/0.17.0) and remaining section lanes. M95b/M95c stay
  `planned` (nothing shipped). M96c/M103 `built` → `building` (section
  checklists still open). M109 `released` → `building` (above).
- **§10 `0.17.0 released` record** added (merge `82d50d5e4`, PR #145, dated
  CHANGELOG section); roadmap `pending` is now empty, so the stale
  "In the next release (0.17.0)" section is gone after regeneration.
- **README auto reviewer.** `package.json:1202` default `true`, AGENTS.md
  rule 12 (on, machine-scoped, available by default, consent before spend),
  `package.nls.json:128` ("Available by default") and README:4360 (`true`)
  all disagree with README:954/2623 ("off-by-default"). → 954/2623 fixed.
- **featureCatalog budget row** editors `['vscode']` → `['vscode','acp']`
  (runtime ledger reads the same setting for headless/ACP runs,
  `src/runtime/runtimeAccountingEntry.ts:38-61`, wired at
  `src/runtime/backends.ts:245`); `REFERENCE_CAPABILITIES` budget entry
  updated with reason. Reference regenerated (`docs/reference.md`,
  `reference.generated.*`).

## Deferred with reason (lead decision needed)

- **Schedules reference surfaces stay `vscode:modelApi`.** ACP `/schedule`
  is wired (`src/acp/schedules.ts`, serve flags at
  `src/runtime/main.ts:796-800`), but `scripts/lib/reference.mjs:1119-1126`
  admits a paid feature on `acp:modelApi` only when its id is in
  `ACP_PAID_FEATURES` (`src/shared/constants.ts:4015-4017`), and
  `scheduledPrompts` is not a member (per-use ACP consent covers only
  `webSearch`/`imageGeneration`; schedules authorize via serve flags plus
  per-schedule consent and caps). Adding the surface trips
  `ACP paid capability mismatch: schedules`; changing the check would be a
  gate change, which this lane will not make unilaterally. Options for the
  lead: (a) keep vscode-only until schedules join the ACP paid flow;
  (b) rule flag-authorized paid surfaces in-scope and adjust the check with
  a PLAN §8 row. The roadmap M115 summary already says fires run in live ACP
  sessions, matching `docs/ide-compatibility/hosts.md:142`.

## Gates (all run directly in this worktree, repo defaults)

- `npm run check:plan` → `plan-format-v1; 207 milestones; 0 drift`
- `npm run check:roadmap` → `Roadmap: 207 entries; ROADMAP.md is current`
  (no problems, no notes; previously 7 "planned but parts are in X" notes)
- `npm run check:reference` → `77 features, 71 commands, 100 settings, 29
slash, 257 CLI; current` (plus sharing-reference match)
- `npm run check:l10n` → `0 problems`
- `npm run typecheck:host` → clean; `npx eslint --max-warnings=0` on both
  changed `.ts` files → clean; `npx prettier --check` on all changed
  non-ignored files → clean (README/hosts tables re-padded by prettier)
- Unit tests for the touched catalog/reference area (repo timeouts, max 3
  files per run, no `--testTimeout`):
  `test/unit/featureCatalogDetails.test.ts` → 4 pass;
  `test/unit/chatReference.test.ts` → 3 pass;
  `test/unit/referenceGenerator.test.mjs` → 116 pass, after one
  contract update below.
- **Test-contract change (lead to ratify):** R05
  (`test/unit/referenceGenerator.test.mjs:372`) asserted
  `feature('budget').surfaces == ['vscode:modelApi']`. That expectation is
  the drift this lane was ordered to fix: the shipped UI text already says
  "ACP and headless Model API requests reserve against the runtime daily
  budget" (`src/shared/l10n/en.ts` `referencePaidContexts`), and the runtime
  ledger reads the same setting (`runtimeAccountingEntry.ts:38-61`). Updated
  to `['vscode:modelApi', 'acp:modelApi']`. One-line revert restores the old
  assertion if the lead disagrees (but then `check:reference` fails on the
  corrected catalog, since `REFERENCE_CAPABILITIES` and the catalog must
  agree).

## Red drill (guard fires, then byte-exact restore)

Guard: `scripts/lib/roadmap.mjs` one-sentence-summary rule. Drill: appended
a second sentence to the M96 entry summary, ran `npm run check:roadmap`,
saw the named failure
`roadmap: M96: "summary" must be one sentence ending with a period`
(exit 1, ROADMAP.md not written), then restored `docs/roadmap/entries.json`
byte-exact (SHA-256 match below) and re-ran green.

- `docs/roadmap/entries.json` SHA-256 before drill:
  `a1b689e5e1f604de5e7e3e18b6b080372b40f2b7531240a9f877fc400af6`
- restore check: `sha256sum` after restore prints the identical hash;
  `npm run check:roadmap` green afterwards
  (`Roadmap: 207 entries; ROADMAP.md is current`).

## Hooks

Commits made with the repo hooks as installed (`.husky/_`, no
`--no-verify`, explicit paths). No push, merge or rebase (lead integrates).
