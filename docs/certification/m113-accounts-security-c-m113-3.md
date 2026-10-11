# M113 C-M113-3 certification — accounts and security report kinds

2026-10-11, kubuntu rig, branch `c/m113-3`.
Base `a0b69a03b` (C-M113-2 session and usage kinds) plus the listed first
merge `990a48cf7` (merge of vault core round 4 `d37823d5f`, whose audit
records the security kind reads; no vault file edited by this lane).
No new dependency, paid/live call, credential, push, rebase or gate
relaxation. Hooks on for every commit. Shared core/runtime logic serves
VS Code (`reportPanelEntry`), ACP and CLI (`servicesFor` in `main.ts`);
no webview paint changed.

## Scope (completion program C-M113-3)

M108 registry; M109 audit and developer audit, without values.
Acceptance: goldens; canary absent. Certification: drills; Codex review
(review itself is a lead step and is pending).

## What is complete

- `security` kind: sections `security/vault` (state, tier, item count),
  `security/breakdown` (items by kind), `security/grants` (by
  roles/workspaces shape), `security/usage` (allows by kind and authority),
  `security/denials` (deny decisions and denied outcomes),
  `security/locks` (locked outcomes), `security/developerAudit` (actions by
  source). Counts, kinds, decisions and authorities only.
- `accounts` kind: sections `accounts/accounts` (per provider with order
  and limit group), `accounts/limits` (spend/count/percent thresholds),
  `accounts/usage`, `accounts/swaps`, `accounts/refusals` (stops),
  `accounts/confirmations`. Labels resolved locally.
- Sources validate every fact with strict zod schemas, sort by code unit,
  and stay kind-scoped (`disabled` outside their kind, `unbound` without a
  reader, `missing`/`invalid`/`failed` with the shared reasons).
- Runtime binds the on-disk registry (`providers.json`, metadata only) and
  the developer audit (both rotations) in both engine constructions.
  Unbound facets stay empty and are named in the partial, never invented.
- Goldens: `test/fixtures/reports/collect/{accounts,security}.{md,html,
text,json}.golden`, compared byte for byte.
- Canary: `reportSecurityCanary` plants item names, labels, handles,
  targets, requester/grant ids, digests, hashes, macs, a role name and a
  grant origin through the real reader, source, collector and all four
  renderers, and asserts none appears in any output.
- Live CLI: two e2e cases run `report accounts` and `report security`
  through production's engine construction against fixture data.

## What is not, and why

- Accounts use, swaps/stops and confirmations have no production adapter:
  no `AccountUsageSource`, event or confirmations read port exists at
  runtime. The reader interface carries them; both construction sites pass
  none until the owning lane binds `reportAccountsUsage` and
  `reportAccountsEvents` (`ReportingWindowDeps` in
  `src/host/reporting/reportPanelEntry.ts`) and the same fields in
  `servicesFor` (`src/runtime/main.ts`). Those facets stay empty and named.
- The vault view has no production caller: the vault service lives in the
  lazy `dist/vault.js` bundle and commands refuse while closed, so no
  unlock-capable session is reachable from the report bundles. The vault
  lane must pass `reportVaultSnapshot` into the same two call sites. Until
  then the vault facets stay empty and named while the developer audit
  reports.
- Nothing removed or hidden by the 0.17.1 truth pass needed restoring:
  the README row this lane replaced ("future source bindings unavailable")
  was current text, and no command, setting or Help row for these kinds
  was removed.

## Red-drill receipts

Full runs at repository deadlines (`npx vitest run <files>
--maxWorkers=3`, at most three files per run). Restored byte-exact by
SHA-256; no red mutation is retained.

- Drill 1 (canary guard fires): leaked the audit target into the projected
  `kind` in `src/runtime/reporting/reportInputs.ts`. All four
  `reportSecurityCanary` cases failed. Restored to
  `1c83fe2991eca1d52316c38c9ba2f79a299c58784efdee905711b14567da40c0`.
  (An earlier variant leaking into the projected `outcome` stayed green
  by design: the collector never renders fact outcomes, only authorities.)
- Drill 2 (golden guard fires): renamed the vault state row in
  `src/core/reporting/collect/security.ts`. The security golden case
  failed. Restored to
  `f6ba0826634f51d90c089a85dcc34e1f3b6893d04f49c0b9678276a904a425f7`.

## Gates and results (kubuntu, this lane)

- Host, unit and e2e typechecks: exit 0.
- ESLint over every changed file: exit 0. Prettier: clean.
- `node scripts/check-l10n.mjs`: 0 problems (3 new reason strings in all
  15 tables).
- `gen-reference --check`: current. `gen-roadmap`: no diff.
  `check-host-api`: 0 problems.
- knip: no findings beyond the two pre-existing configuration hints.
  jscpd: 0 clones (one collector helper plus two shared test helpers
  extracted to remove the four this lane introduced). dpdm cycles: none.
- `npm run build`: every reporting budget holds (`reportInputs.js`
  87.4 KiB of 100 KiB). One failure is pre-existing and untouched by this
  lane: `dist/usagePanel.js` 75.1 KiB over its 75 KiB budget. Proven on
  the untouched base: a clean worktree at `a0b69a03b` with linked
  `node_modules` builds the identical 75.1 KiB (no lane file feeds that
  bundle; the new strings are not embedded in it). Left for the lead;
  no budget was changed.
- Unit suites at repository deadlines: collect.accounts (4),
  collect.security (4), accounts/security sources (8), inputs incl. the
  migrated sibling file (32 across the three files), canary (4), goldens
  (2), collect contract/determinism/facets (63), session source (11),
  engine/redaction/contracts/invariants/fixtures/schedule-action — all
  green.
- `test/e2e/reports.e2e.test.ts`: 24 of 24 green, including the two new
  live accounts/security cases.
