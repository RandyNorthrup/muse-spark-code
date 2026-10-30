# Undo for a retired vault item; reset deletes retired items too (lane RLF-VAULTUNDO, 2026-10-24/30)

Base: int/recovery at `f53ef168f` (main at 0.19.0 plus 40 merged lanes).
Machine: linuxlt (Linux), inside the lane sandbox. The POSIX broker
suites skip here: no session bus (`DBUS_SESSION_BUS_ADDRESS` is empty)
and the over-long `XDG_RUNTIME_DIR` cannot fit the broker socket, so
`shouldSkipPosixBrokerSuite()` is true; probing for or standing up a
Secret Service provider is denied by the sandbox policy (the exact
denial is below), so the broker drives are written for hosted CI. The
Windows suites skip on Linux by platform.

Decision: PLAN.md D217. It settles the two RLM109 product questions
(`engine.undo` had no trigger; a broker-side vault reset would destroy
retired slots, their only copies). The owner delegated to the lead
(2026-10-23: "your call on the undo"); the lead's call is built here.

## What was built

1. **Undo on each retired item.** The vault panel lists every retired
   migration slot under Retired entries with its own Undo
   (`src/webview/models/sections/vault/VaultSection.tsx`), posting
   `vaultUndoRetired` with exactly that entry's key
   (`src/shared/hostApi/vaultMessages.ts`, strict schema, non-empty
   key). The host allows only a key the fresh snapshot lists as
   retired (`src/host/vault/vaultPanelHost.ts`); anything else is the
   said `useChanged` refusal. The same undo is the palette command
   `museSpark.vaultUndoRetired` (`src/host/vault/vaultPanelEntry.ts`,
   `src/extension.ts` sources), picking from the retired entries.
   - The engine (`VaultMigration.undoRetired`,
     `src/core/vault/migrate/migrate.ts`) verifies the vault copy
     against the journal digest, refuses a legacy copy that changed
     since (`conflict`, never overwritten), writes the vault bytes
     back to the legacy store byte-exact, and returns the slot to
     `active` with the retain window restarted at the current
     release — otherwise the next unlock would retire it again at
     once. Only `retired` rows undo; every other phase refuses with
     `window`. It reuses the existing `verifyLegacy`/`mirror`
     helpers (single vault read each, every buffer wiped).
   - The controller (`CredentialMigrationController.listRetired` /
     `undoRetired`, `src/host/vault/migrateCredentials.ts`) lists
     retired slots oldest migration key first and maps every
     outcome to its own sentence, in English plus all 14 tables:
     unknown key, still current, already gone, changed since
     (current value kept), damaged. A locked vault refuses with the
     locked sentence instead of listing nothing. The membership
     pre-check is load-bearing: `journalPhase` throws `invalid`
     for a key with no credential, so without it an unknown key
     would surface as an unnamed failure.
   - The panel service (`src/host/vault/vaultPanelService.ts`)
     lists retired slots only while unlocked and undoes through
     the same controller path.
2. **Reset deletes retired items too.** Reset is broker-side and
   cannot write the legacy store, so no host-side restore runs
   first: the journal rows and vault copies go with everything
   else. The confirmation says so plainly before the person types
   RESET: `resetWarning` gained "Retired entries are deleted too:
   the vault holds their only copies." One shared string, shown
   by the panel dialog (`src/host/vault/vaultActionDialogs.ts`)
   and the terminal (`src/runtime/vault/vaultCommand.ts`, printed
   before the Continue choice and the typed word).

The terminal `vault undo` is NOT built (open, lead): a retired
slot's legacy store is the editor's SecretStorage, which the
terminal cannot write, and the terminal's own key store (D61) has
no migration bound yet — `src/runtime/vault/migrateKeyStore.ts`
exists but has no callers — so it has no retired slot to undo.
It follows the T5 runtime-migration binding in the M109 record.

## Proof run here

- `test/unit/vault/vaultRetiredUndo.test.tsx` (real render): each
  retired entry gets its own Undo posting exactly its key in the
  host schema's shape; nothing retired means no heading and no
  Undo; the host schema refuses an empty key and extra fields.
  3 passed, exit 0, repo timeouts.
- Drills (each: break on purpose, red, revert, green):
  - R1: `VaultSection` posted `entry.label` instead of `entry.key`
    → 1 failed, exit 1 (`expected [ [ { …(2) } ] ] to deeply
equal [ [ { …(2) } ] ]` at `vaultRetiredUndo.test.tsx:39`);
    reverted (worktree diff empty afterwards).
  - R2: the `vaultUndoRetired` key schema weakened to
    `minLength(0)` → 1 failed, exit 1; reverted.
  - Green after both reverts: 3 passed, exit 0.
- `npm run ui:look -- models-vault-retired` (exit 0; light and
  dark pictures under `temp/ui-look/`): the Vault section with
  one retired entry and its Undo.
- `node scripts/a11y.mjs models-vault-retired` (exit 0): 4 pages
  (1 scenario × 4 themes), 0 rules violated on 0 elements.
- Related suites, repo timeouts, exit 0 except as noted:
  - engine + controller: `credentialMigration.test.ts` 6 passed
    (1 pre-existing skip); both broker suites skip here.
  - panel entry/host/service: 1 passed, 18 skipped (broker
    suites skip here).
  - messages + panel protocol + section: 155 passed, 18 skipped.
  - bundle wiring + refusals: 659 passed, 30 skipped, 3 failed
    in `commandHelp.test.ts` (1) and `judgeCliArgs.test.ts` (2),
    all in the judge CLI area this lane does not touch. Measured
    on the untouched base `f53ef168f` in a clean worktree: the
    same 3 fail the same way (exit 1). Pre-existing; not this
    lane's.
- Gates (true exit codes, no pipes): prettier on touched files
  0; eslint `--max-warnings 0` on touched files 0; `typecheck`
  0; `check:l10n` 0 (0 problems); `check:reference` 0;
  `check:host-api` 0 (0 problems); `check:plan` 1 — PLAN.md is
  3,773,224 bytes against the 3,565,158-byte (85%) archive bound,
  and the untouched base is already 3,769,703 bytes over it, so
  this lane's +3,521 bytes did not tip it; archiving is the lead's
  call. `check:roadmap` 0;
  `check:catches` 1 — measured identical on the untouched base
  (exit 1, same per-area counts; 88 flagged sites there, all in
  files this lane does not touch; this lane adds two REPORTED
  catches and zero counted sites; the one extra flagged line on
  this tree is the pre-existing `vaultPanelEntry.ts` bind catch
  shifted by this lane's insertions, byte-identical code). The
  baseline is the lead's integration call; this lane does not
  regenerate it. `duplication` 1 — 7 clones, all between files
  this lane does not touch, none involving a lane file.
  `cycles` 0. `deadcode` 1 — findings only in non-lane files
  (judge fixtures, redact, paid host, judge lint, knip config,
  tags). `build` 1 — the base is already red on 10 bundles
  (measured exit 1 on `f53ef168f` in a clean worktree); this
  lane newly reds one: `dist/vaultMigration.js` 44.0 → 45.2 KiB
  against a 45 KiB budget (+937 bytes controller undo/list,
  +386 bytes engine undo, from the metafile diff). Alternatives
  considered and rejected: dropping `{cause}` (has repo
  precedent), reusing `store()` (it rotates; undo must not),
  moving the label join to the webview (zero-sum across
  chunks), an optimistic engine-first check (equal size, more
  convoluted), a lazy undo sub-chunk (needs 7 engine privates
  exposed for a net −200 bytes: still red, plus a new dist
  file and loader). Reported for the lead; the budget is not
  raised. Also grown while red-on-base: `modelsPanel.js`
  155.0 → 155.3 (+311 bytes required protocol: the undo
  message schema and retired state), `resourceGovernor.js`
  126.9 → 127.0 (shared string drift). `vaultActions.js`
  25.1/25 is red on base, unchanged by this lane.

## Written for hosted CI (cannot run in this sandbox)

- `test/unit/helpers/vault/retiredUndoFlow.ts` (new, shared by
  both broker suites): `driveUndoRetiredCase` undoes a retired
  slot byte-exact through the panel service path, restarts and
  re-retires the window, refuses current/unknown/locked/changed/
  emptied in their own sentences, and proves a changed legacy
  copy is kept; `driveResetCase` loses a real vault (locked,
  `slots.v1` damaged on disk so `isVaultOpenable` returns
  false), resets through the typed word, and proves the fresh
  vault holds neither the retired row nor its value and nothing
  was restored to the legacy store.
- `chatgptSubscriptionMigration.test.ts` (POSIX) and
  `credentialMigrationStore.test.ts` (Windows) each gain the
  two cases (`FLOW_TIMEOUT_MS`, the suites' existing named
  long-operation deadline).
- Every step was verified against the source it drives
  (journal/lease/digest/conflict paths, `resetBegin` lost-vault
  preconditions, both fixtures' `dataDir`/`hostId`/`connect`),
  and the whole tree typechecks; but no broker run happened
  here, so CI is their first execution.
- Sandbox denial on record: `ls
/usr/bin/gnome-keyring-daemon` → "tool denied: approval
  aborted". No workaround attempted, per the lane rules.

## Records

- PLAN.md D217 (next free number; D215/D216 taken on
  int/recovery) and the M109 status line; no §3 question
  matched (the two questions lived in the M109 status line and
  `docs/certification/rlm109.md` — D217 says so).
- CHANGELOG `[Unreleased]` entries in the person's words; README
  command paragraph; `museSpark.vaultUndoRetired` in
  `package.json`, `package.nls*.json`, `featureCatalog.ts`
  (`check:reference` green) and the host-API record
  (`check:host-api` green).
- Open: the terminal `vault undo` (follows T5); the
  `vaultMigration.js` 0.2 KiB budget overage; the pre-existing
  red gates on int/recovery (plan archive bound, catches,
  duplication, deadcode, build, 3 judge-CLI tests). M109 stays open.
