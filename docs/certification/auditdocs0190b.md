# Audit 0190-B: 0.19.0 person-facing words (truth + platform groups)

Scope: what the truth and platform groups merged into release/0.19.0 —
the vault (PR #216, #247), per-platform packaging, Windows process births
(PR #220), the browser check (PR #222), error-truth fixes (PR #233, #235,
#238, #242), macOS parity (PR #244), recording parity (PR #236) and
spending (PR #161, #217). Surfaces: README.md, docs/_.md and docs/\**/_.md
a person reads, package.json contributes, the walkthrough, every CLI
`--help` screen (via `node dist/acp.js`, the built entry; no
`dist/runtime.js` exists on this tree), the ACP slash-command
descriptions, and capability/limit/default strings in
src/shared/l10n/en.ts. Skipped records, not claims: docs/certification/,
docs/real-life/, docs/plan-archive/, docs/research/.

Method: for each claim, the backing code was read. Numbers were checked
against constants and the provider record in the repository
(vendor/models-dev/snapshot.json, capturedCapabilities.ts). Help screens
were driven against a production build (built with a local-only
CHANGELOG trim, restored afterwards — finding F5).

## Findings fixed in this lane

### F1 — README refused OpenCode plugins on macOS; the code runs them (fixed)

- File: README.md, "Where they run".
- Claim: "macOS: OpenCode plugins are refused, because `bun`'s memory
  cannot be bounded there."
- Code: src/core/backends/modelapi/pluginHost.ts `boundedBun` returns
  `{ ok: true, ... }` for `win32` and `darwin` alike since PR #244; the
  comment states macOS runs bun directly as OpenCode itself does, under
  the same per-call timeout, answer frame and process-tree bounds, with
  no memory cap — a plugin that outgrows the machine is ended with its
  tree on timeout or by the OS.
- Fix: the bullet now says exactly that (commit 77081579e).

### F2 — README listed three dormant vault settings as live (fixed)

- File: README.md, "The vault" settings paragraph.
- Claim: `museSpark.vault.protection` (`auto`), `.lockAfterIdleMinutes`
  (240) and `.lockOnScreenLock` (on) read as settings the person controls.
- Code: src/host/settings.ts resolves all three from SETTING_DEFAULTS,
  never from user config; only `vault.enabled` (via `isVaultEnabled`) and
  `vault.agentFence` (via `readSetting`) take effect. package.nls.json
  describes all three as "Stored for compatibility; no runtime effect."
  (deliberate since b32f14c23). The vault always uses the OS credential
  store plus the one-time recovery code; brokerBindings hardcodes
  `lockOnScreenLock: false`.
- Fix: the paragraph now names `enabled` and `agentFence` as the live
  settings and marks the other three stored-for-compatibility with no
  runtime effect, matching the manifest (commit 77081579e).

### F3 — README vault section repeated one paragraph twice (fixed)

- File: README.md, "The vault".
- The "No activation read or broker start is added. The VSIX package
  check … prunes proven-dead registrations." block appeared twice, back
  to back. The second copy is deleted (commit 77081579e).

### F4 — build failed: vaultStore read two symbols the admission bundle did not export (fixed, code)

- Gate output: `dist: vaultStore.js reads exactCurrentProcessOwner from
resourceAdmission.js, which does not export it` (and the same for
  `exactProcessBirth`).
- Code: src/core/vault/store.ts imports both from
  src/core/locks/processOwner.ts; the split plugin externalises every
  processOwner import to dist/resourceAdmission.js, but
  src/core/resources/admissionEntry.ts re-exported only
  `currentProcessOwner`, `isProcessOwnerGone`, `processOwnerSchema`.
  Every other processOwner importer (fileLease, checkout, transaction,
  records) uses only names already exported, verified by search.
- Fix: admissionEntry.ts re-exports both missing readers
  (commit e9132641e). No new unit test: a test asserting a re-export
  exists would be an existence check, which the repo forbids; the
  maintained check is the split gate itself, which failed before the fix
  and passes after (production `npm run build` green with budgets).

## Findings reported, not fixed here

### F5 — 0.19.0 release notes exceed the What's New bound (release blocker)

- Gate output: `CHANGELOG.md 0.19.0: its release notes decode to 90480
bytes, over the What's New bound of 76800 bytes`.
- The production build cannot complete on this tree until the notes are
  trimmed per docs/RELEASING.md. Trimming release notes is a lead
  decision, so this lane built with a local-only stub (never committed;
  CHANGELOG.md restored byte-identical, `git diff` clean) and reports
  the bound as the remaining blocker.

### F6 — Secure Enclave / Touch ID wording (reviewed, no change)

- README says the composed macOS broker wraps the key with the login
  Keychain only and does not use the Secure Enclave, and that Touch ID
  is not offered. The code wires a Secure Enclave presence slot
  (src/runtime/vault/slots/macVaultSlots.ts, called from
  src/core/vault/broker/state.ts), matching the changelog's "wires the
  Secure Enclave slot with a real presence check". In practice no setup
  path creates a presence-tier record, so presence never prompts and key
  wrapping is Keychain-only: both sentences describe what a person gets.
  Left as is; revisit if setup ever offers a hardware tier.

## Checked and true (sample; each read against the code)

- Spending: `paidDailyBudgetUsd` default 0 = none everywhere (README
  table, package.json, package.nls.json, en.ts, docs/acp.md, docs/ci.md,
  docs/reference.md); nothing checked/read/written with no limit
  (dailySpend.ts, acp.md). No remaining `$5`/`$0.50–$500` default text.
- Prices: search $2.50/1k, image $0.01, voice $0.18/hr in constants.ts;
  Opus 5.5 captured effort includes `xhigh`
  (capturedCapabilities.ts); Meta minimum 16 output tokens
  (MODEL_API_MIN_OUTPUT_TOKENS = 16).
- Browser check: pin 154.0.8037.92, all four archive hashes and sizes,
  205–285 MB unpacked, 60 s / 15 s / 8 steps / 20 entries / 15 min
  prepare / 45-day expiry all match code and browserRuntime.json.
- Vault: availability switch on (`VAULT_AVAILABILITY`), POSIX bound,
  Windows refuses via pending C-M109-1c helper (clientPlatform.ts);
  30 s lease / 10 s renewal / 30 s idle exit match constants; Reset
  typing `RESET`, recovery-code-before-write, no-headless-setup all
  match handlers. No shipped "Attach Latest Screen Recording" claim
  (withheld PR236W1; README describes Linux-only inspection honestly).
- Errors: wrong-key/unknown-model/provider-refusal sentences and the
  #235/#238/#242 strings each have an emitter in the named condition
  (accountsCommand.ts, accountText.ts, agentRecovery.ts, agent.ts,
  playbook/command.ts). `exec --web-search` refused at parse
  (execArgs.ts); the agent's bounded hosted search is the separate
  documented path.
- Help: bare `--help` is the compact agent help; every deep `--help`
  stays in its command (vault, exec, providers add, auth set/status,
  prompts, schedule, estimate with deadline + formats, report usage);
  `help reference` and `help --all` both open the catalogue.
- Slash commands are advertised only when their binding exists
  (vault/accounts/schedule/media/estimate/playbook in agent.ts); the
  static reference list names the stable set without claiming
  completeness.
- Governor: 15-minute resume (RESOURCE_OVERRIDE_MS), relocation
  "not available" = no route bound (nls + README agree), chip Unknown
  states honest.

## Out of scope notes

- CHANGELOG 0.19.0 mid-release entries retain superseded states
  (e.g. "Availability remains off", "Windows still waits") beside the
  later entries that supersede them; the changelog is history, and the
  current-state words (README, manifest, help) are the ones audited.
- `docs/acp.md` "a sent attempt with no outcome keeps its entire
  reservation permanently" describes the run ledger
  (runLedger.ts `settled + uncertain + amount > cap`); the changelog's
  "admits later capped runs" describes the daily ledger's bounded
  uncertain liability. Different ledgers, both true.
