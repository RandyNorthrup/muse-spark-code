# CM108ACC — Accounts in the installed runtime (CLI, ACP, headless)

MacBook rig, `/Users/user/lanes/CM108ACC`, branch `c/m108-acc`, base `82d50d5e4`
(v0.17.0). No sub-agents. The DOGFOOD1 receipts branch was not fetchable from
this rig (no origin remote), so the failing scenarios below are the brief's
scenario list: every CLI/ACP account command answered "Accounts are
unavailable until this runtime is connected to the shared account service."
(ACP prefixed with "Internal error: "). Per-request account
selection/billing (C-M108-2) stays out of scope, as briefed.

## Root cause

The runtime's `FileAccountsMetadata` reads `<agentDataFolder>/providers.json`,
a file nothing ever populated: the M95 registry writes a different file with
a different envelope, and no owner seeds account rows. `AccountStore.provider`
therefore threw `unavailable` for every provider, so CLI `providers accounts`
and `auth set --account`, ACP session reads, and headless credential reads
all reported "not connected". On the Muse Code backend ACP had no accounts
port at all (`serve` attached `sessions('meta')` for modelApi only).

## Delivered

- **R1 — the runtime serves the built-in meta provider**
  (`src/runtime/providers/providersFileStore.ts`). `read('meta')` returns the
  stored row or the built-in entry (id/policyProvider `meta`, product
  `model-api`, auth `apiKey`, origin from `MODEL_API_BASE_URL`; the policy
  row and key names already pin the rest). `writeAccounts` persists the row
  on the first write. Any other provider still needs its stored row; a
  corrupt file still throws instead of being clobbered. This connects CLI
  list/add/remove/order/thresholds, `auth set --account`, headless
  `--account` credential reads, and ACP reads — one shared store, one file,
  the OS credential store. The dead legacy-key fallback branch in
  `secretsFor` is removed: the vault serves the pre-existing default key
  through the same OS-store name, and a missing account is `invalidAccount`,
  never a silent default key.
- **R2 — ACP on both backends with an honest switch refusal.** `serve`
  attaches `sessions('meta')` on modelApi and museCode alike (list, current,
  thresholds, picker). Switching has no adoption transaction in this runtime
  (needs C-M108-2's pooled owner), so it is refused with the new
  `accounts.switchUnavailable` text naming the kept account
  (`AccountSwitchRefusedError` in `src/acp/accountText.ts`, rethrown through
  `AcpAccounts.use`, surfaced as ACP `invalidRequest` instead of
  `internalError`; any other port failure stays scrubbed to `unavailable`).
- **R3 — vendor-limit stops render without a usage link**
  (`src/acp/accounts.ts`). No vendor usage page is bundled (guessing one
  would violate the wire-shape rule), so a stop whose URL is missing or
  invalid now shows the stop text (blocked account + reset) instead of
  replacing the whole notice with "unavailable". Per-account isolation holds
  structurally: one credential per request (core-tested), per-account pacing
  buckets, no cross-account state.

Out of scope, still refused honestly: `--account-pool`, in-session
credential moves, non-meta providers without a stored row, Muse Code
multi-account (capture-gated), placement/developer profiles (C-M108-6/7),
vault move (C-M108-8).

## Tests (repository timeouts, never raised)

- New `test/unit/runtimeAccountsService.test.ts` (7): production
  `createRuntimeAccountServices` over a temp dir + memory keyring — list with
  no file, add/thresholds/order/remove, stdin-only credential + headless
  secret + legacy default key, ACP read/current/pinning, unconfigured
  provider, corrupt file. Red-first: 4 failed before R1 with the exact
  dogfood symptom, 7 pass after.
- `test/unit/providersFileStore.test.ts` (+2/updated): built-in meta entry,
  first-write persistence, unknown-provider guard retained.
- `test/unit/runtimeServices.test.ts` (updated +1 behavior): stay-put
  refusal text, vault-routed legacy key, missing account is invalidAccount.
- `test/unit/acpAccounts.test.ts` (+2/updated): refusal identity through the
  controller, `invalidRequest` + stay-put text on both ACP routes, stop
  without link renders the stop text (canary assertion retained).
- Live receipts on the packaged binary (`dist/acp.js`, temp HOME):
  list/add/thresholds/order/list/remove/list all exit 0 with the expected
  JSON; remove of a missing account answers `invalidAccount`. Credential
  reads/writes were NOT exercised against the real keychain (a fake HOME
  hides the login keychain: `getPassword` throws "A default keychain could
  not be found", which the fixed text reports as unavailable); with the
  keychain symlinked in, add/remove/list round-trip exit 0 and leave no
  residue. Auth-set against the live keychain is covered by unit tests with
  the memory keyring only.
- Full runs: the four files above plus the neighboring command/exec suites, 91 passed across 6 files. `node scripts/check-l10n.mjs`
  0 problems; `npm run check:reference` current; `npm run build` exit 0
  (extension 550.1/600 KiB, modelApi 515.8/525 KiB); `npm run deadcode`
  clean; `npm run duplication` 0 clones; `tsc` host + unit clean; eslint and
  prettier clean on every touched file.

## Red drills (byte-exact, SHA-256 verified after restore)

Baseline SHAs in `temp/cm108acc-sha-before.log` (gitignored scratch).

- **D1** `providersFileStore.ts` `id !== 'meta'` → `'metax'`:
  `runtimeAccountsService.test.ts` 5 failed. Restored; SHA matches.
- **D2** `runtimeServices.ts` refusal back to `unavailable`:
  `runtimeAccountsService.test.ts` 1 failed. Restored; SHA matches.
- **D3** `accounts.ts` notice back to URL-only: `acpAccounts.test.ts` 1
  failed (invalid-URL stop case). Restored; SHA matches.
- **D4** `l10n/ui.de.json` `switchUnavailable` deleted: `check-l10n.mjs`
  reports `accounts.switchUnavailable: missing`, 1 problem. Restored; SHA
  matches, 0 problems.

## Strings, reference, docs

- One new key `accounts.switchUnavailable` (`{provider}`, `{account}`) in
  `en.ts` and all 14 `l10n/ui.*.json` with translations.
- `src/shared/featureCatalog.ts` unchanged: the accounts feature row already
  covers vscode+acp, there is no CLI surface in the catalog vocabulary, and
  this lane adds no command, setting or feature.
- README "Several accounts per provider", CHANGELOG `[Unreleased]` Fixed,
  PLAN.md M108 CM108ACC note, this file. No new dependency. No `as`,
  `eslint-disable` or `any` added (one `as` in a deleted probe only).

## For the lead

- The dogfood receipts branch never arrived here; scenarios come from the
  brief text. If the receipts name cells beyond list/current/thresholds,
  per-account stop, and switch refusal, they are not covered.
- Installed `serve` on museCode now shows the meta `account` picker; the
  model still runs on the subscription. Fine by panel parity, but flag if
  the picker should hide there until C-M108-2.
- `git restore .jscpd.json` was used once to recover the tracked jscpd
  config after an accidental delete; verified byte-identical via status.
- Commit trailer uses Muse Code attribution, not the brief's Codex trailer.
