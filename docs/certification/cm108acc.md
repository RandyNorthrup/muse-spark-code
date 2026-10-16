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
- Installed `serve` on museCode showed the meta `account` picker in R2;
  the repair below hides it there until C-M108-2 (Model API only).

## Repair — review RVCM108ACC (2026-10-10, same lane, commit 5cc406a1d)

Every finding fixed, no residuals. Siblings swept; each fix has a
regression that fails without it and a red drill below.

- **F1 (P2, picker on subscription).** `serve` attaches the account port
  through `serveAccountsPort` (`src/acp/accounts.ts`): Model API only, and
  a loader failure returns `undefined` instead of refusing `serve`. A
  failing port is also dropped during adoption (`AcpSession.startAccounts`
  disposes and continues), so ordinary sessions never depend on accounts
  (CX1R5). README/PLAN/CHANGELOG corrected to Model API-only.
- **F2 (P2, packaged refusal lost).** `AccountSwitchRefusedError` carries
  `code = 'accountSwitchRefused'`, checked by `isAccountSwitchRefusedError`
  (`src/acp/accountText.ts`); all three `instanceof` sites (agent,
  accounts, accountText) use the guard. Metafiles prove the need:
  `src/acp/accountText.ts` ships in four bundles (`dist/acp.js`,
  `dist/headless.js`, `dist/runtimeAccounts.js`, `dist/runtimeEngine.js`).
  Sweep of every other custom-class `instanceof` in `src/acp`/`src/runtime`
  against the same metafiles: `AccountStoreError`, `DeveloperOptionsError`
  and `ChatGptSignInError` are each single-bundle with same-bundle
  consumers; `StoreUnavailableError`'s refresh-lock path and `ModelApiError`
  in `providersCommands` (same dynamic `modelApiEntry` instance throws and
  checks) hold within one copy; `LocalSourceError`'s three reporting copies
  each check only their own chunk's errors (`engine.ts` checks only the
  same-chunk `ReportScopeNotFound`). No other conversion needed.
- **F3 (P2, first-write overwrite).** `writeAccounts` throws `unavailable`
  on a present-but-malformed row and leaves the file untouched; `read`
  serves the built-in Meta entry only when no file exists (a user file
  without a meta row reads unconfigured). The `runtimeServices` default-key
  test now covers both: vendor-only file refuses, no file authorizes.
- **F4 (P2, stop omits account).** `stopped`/`resetUnknown` templates take
  `{account}` (en + 14 tables); `accountStopText(event, account)` defaults
  to the event id, `AcpAccounts` passes the label, `runExec` keeps the id.
  The old omission assertion is corrected; a known-reset case is added.
- **F5 (P3, pooling reason).** `--account-pool` refuses with the new
  `accounts.poolUnavailable` (en + 14 tables: needs a bound resource
  owner, run again without the flag).

Tests (repository timeouts, never raised): `acpAccounts` 35,
`runtimeServices` 11, `providersFileStore` 12, `runtimeAccountsService` /
`accountsCommand` / `execAccounts` 42, `acpAgent` 142/143 (one
pre-existing ChatGPT failure, identical on clean base `95a2ac1be`,
unrelated to accounts). `check-l10n` 0 problems; `check:reference`,
`check:roadmap`, `check:host-api` current; `deadcode` clean; `duplication`
0 clones; `tsc` host + unit clean; eslint/prettier clean on touched files.
`npm run build` exit 0: extension 550.1/600 KiB, modelApi 515.8/525,
acp 237.5/850, runtimeEngine 630.0/875, runtimeAccounts 49.4/300.

Red drills (break guard, named test fails, restore byte-exact —
`sha256sum -c temp/cm108acc-r2-sha-before.log`, all five files OK):

- **D5** `accounts.ts` selector always loads: `serveAccountsPort`
  modelApi-only test fails (1 failed, 1 passed). Restored.
- **D6** `agent.ts` `startAccounts` rethrows: adoption-without-accounts
  test fails. Restored.
- **D7** guard returns `false`: all four refusal tests fail (stay-put
  controller + agent routes, cross-bundle controller + agent routes).
  Restored.
- **D8** `writeAccounts` falls back to built-in: malformed-row and
  first-write-race tests fail. Restored; file bytes unchanged asserted.
- **D9** `accountStopText` drops the account slot: all three stop tests
  fail (unknown-reset, known-reset, usage-page). Restored.
- **D10** pool refusal back to `unavailable`: pool-limitation test fails.
  Restored.

Held for the lead (Muse sandbox cannot run them): the packaged
`dist/acp.js` serve/CLI round-trip on both backends, and any browser or
socket test. No live model calls; no credential-store access beyond the
existing memory-keyring unit tests.

- `git restore .jscpd.json` was used once to recover the tracked jscpd
  config after an accidental delete; verified byte-identical via status.
- Commit trailer uses Muse Code attribution, not the brief's Codex trailer.

## Repair — review RVCM108ACC2 (2026-10-10, same lane)

Every finding fixed, no residuals. Siblings swept by class; each fix has a
regression that fails without it and a red drill below. Session creation
stays independent of accounts (the CX1R5 drop is untouched: `startAccounts`
still drops a failing port and the session continues).

- **F1 (P2, panel stop omits account).**
  `src/webview/models/sections/accounts/AccountNotices.tsx` now fills
  `stopped`/`resetUnknown` with `account: names(event.account)` (label,
  falling back to the id), matching the ACP `accountStopText` copy. Class
  sweep of every other `fill` of an `{account}` template (`swapNotice`,
  `usageStop`, `usageSpread`, `summary`, `paidConsent`, `sharedGroup`,
  `removeConfirm`, `keyPrompt`, `switchUnavailable`, both `accountStopText`
  copies, `acp/accounts.ts` swap): all pass the account; this was the only
  omission. The panel test now expects the stopped account's label in both
  branches and asserts the log never contains the raw `{account}` slot.
- **F2 (P3, malformed providers file reports a connection problem).** A
  present-but-invalid file now throws the new `AccountStoreError` code
  `invalidProvidersFile` (`src/core/providers/accountCredentialRecord.ts`)
  instead of `unavailable`: invalid JSON, a non-object envelope, a bad
  `providers` field, and a malformed provider row, on both `read` and
  `writeAccounts` (`src/runtime/providers/providersFileStore.ts`). The file
  is still left untouched. The terminal renders the new
  `accounts.providersInvalid` sentence (en + 14 tables: the file is
  invalid, its entries were refused, the file was left unchanged) via
  `commandError` (`src/runtime/providers/accountsCommand.ts`); ACP renders
  the same sentence via `accountErrorText` (`src/acp/accountText.ts`),
  brand-checked (`name` + `code`) like the refused-switch guard because
  each bundle carries its own copy of the store-error constructor — no new
  import, no new bundle weight. Class sweep: the genuinely-unreadable read
  (`readFileSync` throws between check and read) keeps `unavailable`, as
  do the unconfigured-row (`AccountStore.provider`), unknown-provider
  (`writeAccounts` with no built-in base), muse-code-product and
  session-read paths — each still names a real unavailability. No guard
  widened: no schema, threshold, cap or rule changed; the error-code union
  gains one member consumed by two mappers.

Tests (repository timeouts, never raised): `providersFileStore` 17,
`accountsCommand` 25, `accountsPanel` 28, `acpAccounts` 36,
`runtimeServices` + `accountStore` + `cliAccount` 70, `execAccounts` 12/12;
`acpAgent` 142/143 — the one ChatGPT failure
(`exposes all three ChatGPT actions…`) is pre-existing: it fails
identically on a pristine `HEAD` worktree (`cedf19029`, `node_modules`
symlinked, no other change) and its module (`src/runtime/chatGptHost.ts`)
imports nothing this repair touches. `check-l10n` 0 problems (14 UI + 14
usage tables); `check:reference`, `check:host-api` current; `deadcode`
clean; `tsc` clean; eslint/prettier clean on touched files.
`npm run build` exit 0: extension 550.1/600 KiB, modelApi 515.8/525 —
unchanged from R2. No new dependency.

Red drills (break guard, named test fails, restore byte-exact —
`sha256sum -c` on all four files OK after each restore):

- **D11** P2 guard removed (`resetUnknown` fill back to provider-only):
  `shows the pool recovery…` fails (1 failed, 27 skipped). Restored.
- **D12** store `read` malformed-row throw back to `unavailable`:
  `reports refused file content…: a malformed provider row` fails (1
  failed, 16 passed); the other four refusal cases still pass. Restored.
- **D13** `commandError` mapping back to `unavailable`: both
  `names a refused providers file…` cases fail (2 failed, 23 passed).
  Restored.
- **D14** ACP brand check back to `unavailable`:
  `names a refused providers file by its brand…` fails (1 failed, 35
  skipped). Restored.

Held for the lead (Muse sandbox cannot run them): the packaged serve/CLI
account round-trip on both backends, and any browser or socket test. No
live model calls; installed nothing.

## Repair — review RVCM108ACC3 (2026-10-10, same lane)

Every finding fixed, no residuals. Siblings swept by class; each fix has a
regression that fails without it and a red drill below. Correction to the
R2 record above: its "ACP renders the same sentence" claim held only for
the `accountErrorText` helper — the runtime session port and the ACP
controller catches replaced the brand with the connection sentence on the
real operation path. That path is fixed below; the helper claim stands.

- **F1 (P2, runtime-service suite expects the old copy).**
  `test/unit/runtimeAccountsService.test.ts:175` now expects
  `accounts.providersInvalid` for the corrupt-file refusal, matching the R3
  `commandError` mapping. No source change: the committed copy was already
  correct.
- **F2 (P3, branded refusal lost on the ACP/panel operation paths).** The
  store brand (`AccountStoreError` name + `invalidProvidersFile` code) now
  travels the whole path instead of becoming the connection sentence. New
  shared guard `isInvalidProvidersFileError` (`src/acp/accountText.ts`,
  reused by `accountErrorText` with identical behaviour); the runtime
  session `read` rethrows the branded error (`src/runtime/providers/
runtimeServices.ts`); the ACP controller rethrows it from `refresh`,
  the selection `use` catch and `start` (`src/acp/accounts.ts`); the agent
  maps it to the honest sentence with no change (`accountRequestError`
  via `accountErrorText`); the panel handler answers the new
  `accounts/error` code `providersInvalid` (`src/shared/hostApi/accounts.ts`
  enum, `src/host/models/accountsHandler.ts`, companion bridge) and the
  section renders its sentence (`src/webview/models/sections/accounts/
AccountsSection.tsx`). Retained: the initial-adoption drop
  (`startAccounts` still drops a failing port and the session continues),
  the no-adoption selection refusal (`currentAccount === null` stays
  `unavailable`), generation fences, and every genuinely-unavailable case.
  Class sweep of every other `accounts.unavailable` throw on these paths
  (`runtime/main.ts` usage errors, `runExec.ts` unbound-port guards,
  `agent.ts` missing-port guards, schedule `consentRequired`/`unavailable`
  copies): each names a real absence, none masks a store refusal.
- **F3 (P3, duplicate pool ids and key-mismatched identities get connection
  copy).** `storedProviderOf` (`src/runtime/providers/
providersFileStore.ts`) validates the whole entry before metadata
  returns it: the entry id must equal its map key and a present `accounts`
  field must pass `accountPoolSchema` (uniqueness + length), else the
  branded `invalidProvidersFile` refusal on both `read` and `writeAccounts`
  with the file untouched. The CLI then renders the providers-file
  sentence (exit 1) instead of the connection one.

Tests (repository timeouts, never raised): `providersFileStore` 19,
`runtimeAccountsService` 10, `acpAccounts` 38, `accountsPanelHost` 21,
`accountsPanel` 29, `accountsCommand` 25; `accountStore` + `execAccounts` +
`cliAccount` 71; `runtimeAccountStore` + `accounts` + `accountSecrets` 77.
New regressions: corrupt-file assertion fix (F1); file-store each-table
siblings + CLI-level refusal cases (F3); production store + runtime port +
ACP controller post-corruption test (F2); controller refresh/selection/
start brand tests + agent honest-sentence tests for `/accounts` and picker
routes + companion code test (F2); panel handler code + section render
tests (F2).

Red drills (break guard, named test fails, restore byte-exact —
`sha256sum -c` on all five files OK after each restore):

- **D15** `commandError` mapping back to `unavailable`:
  `reports a corrupt file instead of clobbering it` fails (1 failed, 9
  skipped). Restored.
- **D16** runtime session `read` catch back to a bare `unavailable`:
  `keeps the branded refusal through session reads and ACP operations…`
  fails (1 failed, 9 skipped). Restored.
- **D17** ACP selection catch brand check removed:
  `keeps a branded providers-file refusal…` and `answers a branded
providers-file refusal…` fail (2 failed, 36 skipped). Restored.
- **D18** panel handler brand check removed:
  `reports a refused providers file with its own code…` fails (1 failed,
  20 skipped). Restored.
- **D19** file-store `read` back to row-only `providerOf`:
  `reports refused file content…: duplicate account ids` and `: a provider
id that does not match its key` fail (2 failed, 5 passed, 12 skipped).
  Restored.

## Repair — review RVCM108ACC4 (2026-10-11, same lane)

Every finding fixed, no residuals. One class: a refused providers file (and
its sibling typed failures) reaches the person as its own refusal from one
mapping point. Each fix has a regression that fails without it and a red
drill below (D20–D24, `sha256sum -c` OK on all four source files after each
restore).

- **F1 (P2, `exec --account` reports a keyring outage for a refused
  providers file).** New `withProvidersFileRefusal`
  (`src/runtime/providers/runtimeServices.ts`): the single metadata port
  every runtime caller reads through maps the `invalidProvidersFile` brand
  to the `accounts.providersInvalid` sentence at the read, keeping the
  brand (`AccountStoreError` name + code) so typed checks still match;
  sibling typed failures pass through untouched. `modelApiReadiness`
  (`src/runtime/backends.ts`) routes the brand to `accountErrorText`
  instead of the `acpStoreUnavailable` keyring sentence.
- **F2 (P3, developer multiple-accounts open lets the same refusal escape as
  a raw stack).** `DeveloperOptions.open` (`src/core/developer/
developerOptions.ts`) still turns multiple accounts off first, but a
  failing disable no longer replaces the refusal that stopped the start —
  the primary error is rethrown. Same masking fixed in `setMultiple(true)`'s
  catch (a failing stop no longer replaces the start refusal). The process
  crash line (`src/runtime/main.ts` via new `crashTextForLog` in
  `src/runtime/exec/execOutput.ts`) prints the refusal sentence for the
  brand instead of a raw stack; every other crash keeps its stack.
- Siblings swept: all three refused shapes (unparsable JSON, duplicate
  account ids, provider id not matching its key) through exec readiness;
  the ACP session port message; the shared metadata port message plus the
  CLI `list` sentence with the file untouched; developer open and enable;
  the crash line for the shipped and a foreign-bundle brand. `FileAccountsMetadata`
  itself still throws the raw brand (its suite asserts the code); the CLI
  `accounts list` sentence, the ACP `providersInvalid` code, the
  switch-refusal, no-adoption and pool-unavailable behaviours are unchanged.

Tests (repository timeouts, never raised): `runtimeServices` 17,
`runtimeAccountsService` 11, `execOutput` 45. New regressions: exec
readiness each-table refusal cases (P2 caller); ACP session-port sentence +
brand (ACP caller); developer open sentence + brand + file untouched, and
enable-keeps-start-refusal (developer caller); shared-metadata-port
sentence + brand + CLI list sentence (CLI caller); crash-line sentence for
both brands plus stack passthrough.

Red drills (break guard, named test fails, restore byte-exact —
`sha256sum -c` on all four files OK after each restore):

- **D20** wrapper mapping back to a bare rethrow:
  `reads a refused providers file as its own sentence through the shared
metadata port` fails (1 failed, 10 skipped). Restored.
- **D21** readiness brand route removed:
  `reports a refused providers file as its own refusal from exec
readiness…` fails (3 failed, 14 skipped). Restored.
- **D22** open catch back to an unguarded disable:
  `opens developer multiple-accounts with the providers-file sentence
instead of a raw failure` fails (1 failed, 16 skipped). Restored.
- **D23** `setMultiple(true)` catch back to an unguarded stop:
  `keeps the start refusal when enabling multiple accounts over a refused
file` fails (1 failed, 16 skipped). Restored.
- **D24** `crashTextForLog` back to stack-only:
  `reports a refused providers file as its own sentence instead of a raw
stack` fails (1 failed, 44 skipped). Restored.

## Publication after 0.17.1's truth pass (release train merge, 2026-10-11)

This lane forks from 0.17.0. The 0.17.1 truth pass (`c/x-1`) had since taken
accounts out of every published surface because the code refused. The merge
into the release train puts back what this lane's code serves, and only that.

Published again:

- Help: the feature row "Several Accounts per Provider" on the surface
  `acp:modelApi`, the `providers accounts` command row, and the `--account`
  rows of `auth set` and `exec` (`REFERENCE_IN_PROGRESS_FEATURES`,
  `REFERENCE_SURFACES`, the capability pair in `referenceSource.ts`,
  `hiddenRoutes` and the flag pattern in `scripts/lib/reference.mjs`, the
  command line of `/help` in `cliCommands.ts`). `referenceAccounts` has its
  sentence again in English and the 14 tables.
- Compact help: the `Accounts:` line (`accounts.cliUsage`).
- README: the section "Several accounts per provider", for the terminal, a
  pinned headless run and ACP on the Model API backend, with its contents
  link; the progress-list anchor is gone.
- `docs/acp.md`: the `/accounts` command bullet and the M108 section;
  `docs/ci.md`: the `--account <id>` row; `docs/PRIVACY.md`: what
  `providers.json` holds.
- CHANGELOG: a new Added entry under the next release. The 0.17.0 entries
  stay as they are, archived.

Still held, each with its owner:

- Pooling: the `exec` pool flag's Help row, the `docs/ci.md` row and the
  compact help line `accounts.execHelp`, whose text offers it (C-M108-2).
- Changing the account inside a session: refused with the stay-put text
  (C-M108-2).
- The settings `accountSwap`, `accountParallel` and
  `accounts.severalOnThisDevice`: compatibility-only, not in Help
  (C-M108-2, C-M108-7).
- The editor's Accounts and usage pages, the roadmap entry's wording and the
  packaged README's bullet (C-M108-3, C-M108-9); the account picker on the
  Muse Code backend (C-M108-5).

Two things changed in this lane's own code during the merge:

- `serve` keeps the release's binding (`sessionsIfPresent('meta')`: Model API
  only, and a refused providers file or a loader failure is logged and
  leaves the session without accounts). With the built-in Meta entry it
  binds on an absent data path. This lane's `serveAccountsPort` did the same
  two things and is gone, with its two unit cases;
  `test/unit/cx1r5Session.test.ts` covers the binding with the real store
  (absent path, valid file, refused file).
- A failed account start is logged (`ACP accounts startup failed`), as on
  the release branch, instead of being dropped silently.

The truth tests pin the published state and the held items:
`cx1r4Truth.test.ts` (compact help, Help rows, capability, README),
`cx1r2Truth.test.ts`, `cx1r5Truth.test.ts` (the `accounts` claim and the
`usage` pattern keep only what is still held) and
`featureCatalogDetails.test.ts`.
