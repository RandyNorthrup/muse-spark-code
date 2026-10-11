# M109 U — Panel and VS Code

Worktree: `/Users/randy/lanes/M109U`, branch `m109/u`, base `8a151dd40`.
Mac mini, 2026-10-06. Live model attempts: **0**. Paid calls: **0**.
No credential stores, credential files or real secret values were read. No new
package or machine setting. Hooks exist and commits use the repository hooks.

## FIXM109U — RVM109U repair (2026-10-07)

All six RVM109U findings (five P2, one P3) are fixed; none is accepted as
residual risk. No guard was widened and no dependency was added.

- **1 (P2, lost update).** `changed` notifications now join the lock/revoke
  generation barrier in `VaultPanelHost` (`src/host/vault/vaultPanelHost.ts`):
  the generation advances, the native entry's signal aborts and the queue
  resets, so an older draft finished after another window's metadata change
  cannot commit. The retired draft is wiped and reports no error.
  Regression: `RVM109U-1 a metadata change retires an older native editor`
  in `test/unit/vault/vaultPanelHost.test.ts`.
- **2 (P2, starved approvals).** `approval` notifications no longer join the
  queue behind a held native editor: the host publishes them through a new
  prompt `refreshNow` outside the queue, keeping its generation, while the
  queued editor keeps its own (`src/host/vault/vaultPanelHost.ts`). Lock and
  revoke remain barriers; ordinary state updates still use the queue.
  Regression: `RVM109U-2 approval cards publish while a native editor waits`.
- **3 (P2, policy default).** The native mode picker now leads with the
  edited item's current policy mode, so accepting every default preserves it;
  new items still lead with Ask every time
  (`src/host/vault/vaultNativeEditor.ts`). Regression:
  `RVM109U-3 accepting every default preserves the existing … policy`
  (never, alwaysAllow, askOncePerSession) in
  `test/unit/vault/vaultNativeEditor.test.ts`.
- **4 (P2, unknown tier).** `tierWarning` returns a new honest
  `vault.unknownTierWarning` when no slot has been observed (`tier: null`,
  e.g. a locked broker), instead of claiming OS-store protection
  (`src/webview/models/sections/vault/VaultSection.tsx`,
  `src/shared/l10n/en.ts` and all 14 `l10n/ui.*.json` tables with real
  translations). Observed tiers map exactly as before. Regression:
  `RVM109U-4 an unobserved tier does not claim OS-store protection` in
  `test/unit/vault/vaultPanel.test.tsx`.
- **5 (P2, remote session consent).** Session consent is hidden and refused
  for remote requesters (`deviceId !== null`): `isSessionAllowed` returns
  false (`src/webview/models/sections/vault/vaultPresentation.tsx`), the
  host rejects forged `allowSession` answers
  (`src/host/vault/vaultPanelHost.ts`), and the card states its real scope
  with the existing translated `remoteWarning`
  (`src/webview/components/VaultApprovalCard.tsx`). The broker still asks on
  the owning device for every remote use (D89.13); no broker bypass is
  claimed. Regressions: `RVM109U-5 session answers are refused for remote
requesters` (host) and `RVM109U-5 remote requests hide session consent and
name their scope` (card).
- **6 (P3, late Lock error).** All three error-report sites use one
  `shouldReport` predicate that also requires a live window, so a Lock
  completing after disposal reports nothing
  (`src/host/vault/vaultPanelHost.ts`). Regression: `RVM109U-6 a late Lock
success after disposal shows no error`.

**Red drills.** Each guard was broken on purpose, the named test(s) observed
failing, and the file restored byte-exact (SHA-256 checked before and after).
Round 1 (host, four guards broken together): exactly the four named host
tests failed (`RVM109U-1`, `RVM109U-2`, `RVM109U-5`, `RVM109U-6`), 19 others
passed. Round 2 (editor reorder removed; presentation `deviceId` check
removed; section null-tier branch removed): the three `RVM109U-3` cases plus
`RVM109U-4` and card `RVM109U-5` failed, 39 others passed. Restored hashes:
`vaultPanelHost.ts 829575b8…f2420`, `vaultNativeEditor.ts d72021a0…f1d8b27`,
`VaultSection.tsx 4ad3c071…270ebe`, `vaultPresentation.tsx cf8c3f6f…faf88d6371`
(`VaultApprovalCard.tsx be5ffcd2…040c8440` was never broken). Full hashes are
in the shell history of this lane; the files' committed state is the verified
post-restore state below.

**Verification (Mac mini, repo default timeouts, no `--testTimeout`).**
Focused run `vaultPanelHost.test.ts vaultNativeEditor.test.ts
vaultPanel.test.tsx`: **67 passed**. Neighbours
`vaultPanelBuild.test.ts contracts.test.ts`: **26 passed**. `App.test.tsx
AppLazy.test.tsx bundleSize.test.mjs`: **157 passed**. Host, webview and unit
`tsc --noEmit` pass; targeted ESLint (`--max-warnings=0`) and Prettier pass;
`node scripts/check-l10n.mjs` reports **14 tables, 0 problems**; `npm run
build` passes all budgets and split/globals/notices gates. No P2/P3 is left
as a residual; the C/B/P/M/S service binding handoffs named in the review
stand unchanged.

## Delivered interfaces and behavior

- `VaultSurface` is the independent lazy Models & Agents entry. It validates
  the entire value-free host message before mounting the section or cards.
  `VaultSection` lists metadata, opens Add/Edit through a host message only,
  displays every grant scope and audit field, filters audit by item/requester/
  kind/outcome, shows last use and observed tier/fence/platform notices, and
  exposes Lock/Unlock, revoke, import and SSH public-key copying.
- `VaultGrantEditor` creates only a validated, item-bound grant, starting from
  one of the item's validated bindings. All roles, workspaces, target fields,
  count, expiry, local days/hours, unattended, session, task and ceiling are
  visible. There is no open-ended sudo target or Always button on a card.
- `VaultApprovalCard` covers all fourteen use kinds. It shows the exact
  technical use, argv boundaries, requester, digest and expiry, plus process
  disclosure, person-only disclosure, unproven SSH destination, presence,
  taint and separate paid-consent notes. Allow session follows the broker's
  mode/session/taint/disclosure restrictions. A late or repeated click cannot
  answer; no approval is persisted in the conversation store.
- `VaultPanelHost` owns one serialized queue. Lock/revoke/dispose and validated broker lock/revoke notifications invalidate
  older effects synchronously; Lock bypasses a stalled password box or
  snapshot. The physical-commit callback prevents an old edit from committing.
  Native entry gets a cancellation signal; its byte buffers are wiped on
  failed/canceled entry, or by the controller after write/failed write. JS
  strings and internal copies cannot be guaranteed zeroized.
- `editVaultItem` uses the native password box for every sensitive field,
  without prefilling existing values. Metadata-only edits never read a value.
  It supports all public item kinds through the lane-0 material contracts;
  SSH generation/import is injected from S. First-party/internal policy stays
  hidden/Never/attended/undisclosable.
- `registerVaultCommands` is a small activation shim: it registers Vault and
  Lock vault now without loading a schema, reading a vault, starting a broker
  or creating native UI. The lazy factory installs the caller's language and
  owns the unlocked status item. The proposed key chord is
  Ctrl+Alt+Shift+L (Cmd+Alt+Shift+L on macOS).
- EN plus all fourteen real translations have the new text. The old
  model/provider disclosure wording is corrected to the owner's person-only
  ruling. SSH signature labels name the actual operation rather than claiming
  every namespace is a Git commit. The observed Secure Enclave unavailable
  notice no longer claims the accepted capture is still pending. French “Session” and Portuguese “Item” were changed to natural
  longer labels after the existing English-leftover gate flagged the cognates.

## Named integration handoffs (not production fakes)

1. **U-CBPM-SERVICE:** implement `VaultPanelService` with C's single writer,
   B's authenticated management connection/events, P's observed tier facts
   and M's discovered import paths. `authorize` MUST run immediately before
   unlock/physical mutation commit, after awaits. B still validates identity,
   epoch, current item policy, target, counters, digest, replay, expiry and
   presence. An answer's ticket stays on the private waiting route, never in
   the webview. Disclosure completes in the authenticated native host after
   fresh presence; no value or ticket goes into a panel message.
2. **U-S-KEY-ENTRY:** bind `VaultNativeInput.sshKey` to S's actual generation/
   user-selected import and verified public key/fingerprint. The controller
   copies only that SSH public metadata. No placeholder key implementation.
3. **U-M95-M104-SURFACES:** mount `VaultSurface` in Models & Agents; pass its
   `cardsOnly` render into App's `vaultApprovals` slot, and the same render
   into the Agent map's card region. Bind authenticated value-free post ports
   to `VaultPanelHost.handle`; use native terminal entry in other IDEs and
   the companion. The Agent map/Models host and bridge are absent or owned
   by those lanes. All editors receive the same React section/card behavior.
4. **U-W-BUILD:** `test/harness/vault/build.mjs` demonstrates the production
   multi-entry browser graph (`main`, `models`) and lazy `dist/vault.js`
   factory. W registers those entries in its build, split record and package.
   Load the emitted `models.css` with the section and transcript/Agent map
   card mounts: esbuild emits the stylesheet separately.
   New caps: UI 75 KiB including its reachable deferred graph and CSS,
   host 50 KiB. Add `test/harness/vault/main.tsx` and
   `test/harness/vault/run.mjs` as Knip entries (both are actual harness entrypoints). Existing
   caps are unchanged. Tests check the topology and caps. The existing build
   does not acquire unbound production services from this lane.
5. **U-W-MANIFEST-HELP-DOCS:** register `museSpark.vault`,
   `museSpark.lockVault` and `VAULT_LOCK_KEYBINDING` through the lazy shim.
   Copy `m109-manifest-strings.json` into all `package.nls*.json` together
   with the two commands and five machine-scoped settings in PLAN M109.
   `featureCatalog.ts` and its generator are absent: list these two commands,
   five settings, Vault section and cards in the integrated help reference.
   README/CHANGELOG/host API record are W-owned; document these prepared
   surfaces and the unchanged separate paid question when wiring them.

No other lane's implementation or build/gate/manifest file was edited.
No merge, push, rebase, stash or aggregate quality run. The brief assigns the
joined-tree quality, editor bridge matrix and final platform/store wiring to
other lanes/the lead; this record does not claim those are complete.

## Validation and drills

All commands below ran directly on the Mac mini, with one vitest/tsc/eslint/
build at a time. No test timeout was raised and no aggregate quality run was
performed. The focused three-file panel/native/controller run passed **58 tests**; the contracts/bundle two-file run passed **26 tests**. All five
`npm run typecheck` projects passed, and the harness project passed its own
`npx tsc -p test/harness/vault/tsconfig.json --noEmit`. `node scripts/check-l10n.mjs` reported
**0 problems**. `npx jscpd` reported **0 clones** after the external-lock test
also asserted that the native entry's signal is aborted immediately.

The broad bundle-budget prototype initially counted unrelated existing lazy
dialogs. It was replaced with the transitive graph rooted at `models`,
excluding shared eager inputs and counting its CSS. The source input test
then caught a real side effect: inline `import { type VaultPanelPost }` kept
`VaultSection` eager. A fully erased `import type` fixes it; changing back is
a named red drill. The 75 KiB and 50 KiB budgets were each forced to zero and
observed failing. Existing bundle caps and gate configurations are unchanged.

**Integration gate receipts:** plain `npm run deadcode` exits 1 for exactly
the two new standalone harness entrypoints above. `npm run check:host-api`
exits 1 solely for the stale generated record (336 APIs, 33 adapters, 25 Node
built-ins and 61 theme variables). W owns both registrations/records. These
are concrete integration work, not ignores or gate reductions.

**46 red drills** are recorded, each with its named assertion, failure exit,
and equal SHA-256 before/after restoration. Every mutation ran on generated
fake material only. Accessibility's unnamed-button and horizontal-overflow
mutations were run with `node test/harness/vault/run.mjs --drill`: that mode
scans the same panel and rules at 320 px without overwriting the full receipt
or screenshots. Normal mode scans all twenty scenes in all four themes
at 690 and 320 px (**160 scans, zero failures**).
The platform-notices scene exercises NOPASSWD, fence-off and Secure Enclave
unavailability together; the safe-session scene covers the session button. Machine-readable named mutations with before/after SHA-256 are in
`m109-u-drills.json`. `m109-u-axe.json` covers all twenty scenes in four
VS Code themes at 690 and 320 px (160 scans); screenshots are in
`m109-u-shots/`. The harness uses generated ids and public metadata only.

The separate App/AppLazy/bundle regression run passed **155 tests**; the
final touched native/panel/bundle run passed **41 tests**. Across the seven
owned/dependent files this verifies **237 distinct tests** at default
repository timeouts. Changed-file ESLint, Prettier and hook CSS lint pass.
`npm run build` passes the original budgets and split/globals/notices gates:
extension **436.9/600 KiB**, Model API **446.8/475 KiB**. The independently
built U graph is **31.3/75 KiB** (including emitted CSS), host **31.9/50 KiB**;
exact byte sizes and the final source hashes are in `m109-u-bundles.json`.
The full screenshots were refreshed and the 320 px high-contrast card and
690 px grant form inspected. The harness closes its owned browser/server and
removes its profile in nested finally blocks; build tests remove their own
unique scratch directories. No temporary directory is retained at delivery.

The brief's named `docs/orchestration-gotchas.md` is absent in this base and
in the local `main` Git tree (read-only lookup). No other worktree was read.

## Threat-to-control map

These are U's controls; broker authentication, presence execution, process
isolation, encryption and cross-host revocation remain their named owners.

| Threat                          | U control and observed red drills                                                                                                                                                                                                                                                                                        | Enforcement beyond U                                    |
| ------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------- |
| V1 prompt injection             | taint/presence notes, no Always, no session answer for taint/disclosure; `ui-session-scope`, `session-taint`, `session-disclosure`, `ui-presence-note`                                                                                                                                                                   | T provenance and B forced ask                           |
| V2 granted-command exfiltration | exact argv/cwd/use display and process disclosure warning; `ui-process-warning`                                                                                                                                                                                                                                          | X feeder and scrub; approved programs can exfiltrate    |
| V3 malicious MCP                | exact server, command, names, origin and OAuth resource visible in the fourteen-kind tests; `ui-process-warning`                                                                                                                                                                                                         | O audience and T provenance                             |
| V4 compromised host             | native sensitive boxes, first-party policy, value-free UI; `native-password-box`, `native-first-party-policy`, `ui-value-free-boundary`                                                                                                                                                                                  | B/P authenticates UI and draws fresh presence           |
| V5 other user                   | explicit authenticated service/bridge handoff; no U authentication claim                                                                                                                                                                                                                                                 | B/P socket/DACL and peer checks                         |
| V6 same-user malware            | observed tier and fallback warnings, distinct passphrase-unlock warning; `tier-banner`                                                                                                                                                                                                                                   | P captures; silent slots remain same-user accessible    |
| V7 memory reads                 | owned unpooled buffers, wipe on success/failure/cancel; `wipe-on-write`, `native-wipe`, `native-cancel-check`                                                                                                                                                                                                            | C/P/B/X; JS copies and swap remain                      |
| V8 clipboard                    | SSH public metadata only; `clipboard-public-key`, `inbound-value-rejection`                                                                                                                                                                                                                                              | S verifies public metadata; user can copy independently |
| V9 logs/exports                 | strict whole-message/snapshot and event parsing, fixed errors; `snapshot-validation`, `inbound-value-rejection`, `notification-validation`, `ui-value-free-boundary`                                                                                                                                                     | T scrub and B audit chain                               |
| V10 devices                     | no value or ticket in the shared panel/answer; strict boundary drills above                                                                                                                                                                                                                                              | R per-use device permission and channel                 |
| V11 replay                      | id/digest/epoch/deadline/replay checks, exact click deadline and single answer; `answer-digest`, `answer-expiry`, `answer-epoch`, `answer-replay`, `ui-exact-deadline`, `ui-single-answer`, `rollback-epoch`                                                                                                             | B actual-use validation and C rollback                  |
| V12 unattended                  | complete validated scopes and presence conflict; `grant-validation`, `standing-grant-authority`, `native-first-party-policy`, session-scope drills                                                                                                                                                                       | B/R/H admission and role ceilings                       |
| V13 impersonation               | selected edit id, standing-grant authority, no ticket relay; `selected-edit-id`, `standing-grant-authority`, inbound/snapshot drills                                                                                                                                                                                     | B connection identity and M104 authenticated UI bridge  |
| V14 fill spoofing               | exact origins/frame/certificate/field visible in fill-kind test, no secret form or browser read                                                                                                                                                                                                                          | L current CDP checks                                    |
| V15 sudo swap                   | exact sudo path/argv/cwd visible, grant target schema admits only bound digests; `grant-validation`, `ui-process-warning`                                                                                                                                                                                                | X executable/fence and sudo captures                    |
| V16 concentrated vault          | immediate Lock/revoke/dispose, cancellation, physical-commit callback, fail-closed Lock and epoch rollback; `generation-barrier`, `physical-commit-authorization`, `external-lock-revoke-barrier`, `external-native-cancellation`, `notification-epoch`, `lock-failure-barrier`, `native-cancellation`, `rollback-epoch` | C/P/B global lock/key/epoch cleanup                     |

`remove-confirmation` and `import-path` additionally prove management acts
only on the confirmed item or exact discovered path. `command-lazy-load`,
`ui-lazy-split`, `panel-budget`, `host-budget`, `axe-overflow` and
`axe-button-name` prove the lane's performance/activation/accessibility gates.

## Prepared release/help text for W

“Vault adds a shared items, grants and audit section and exact-use approval
cards. Sensitive values are entered in native UI. Vault and Lock vault now
commands, an unlocked status item and the lock keybinding provide direct
access; Lock cancels older pending native entry. Secret approval and paid-use
consent remain separate.”

Help entries: the two command ids in `VAULT_COMMANDS`; all five machine-scoped
settings listed in M109 (`museSpark.vault`, `.protection`, `.agentFence`,
`.lockAfterIdleMinutes`, `.lockOnScreenLock`); section, native Add/Edit,
scoped grants, audit filters, public SSH copy, tier warning and approval cards.
The lane-0 `m109-manifest-strings.json` already supplies EN plus fourteen real
NLS tables for these commands/settings. The prepared command ids and proposed
binding are tested; actual manifest contributions/activation must be joined
with the real service before product documentation says they are available.
