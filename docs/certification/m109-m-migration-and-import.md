# M109 M — migration and import

Branch `m109/m`, base `8a151dd40`, MacBook Pro Intel rig, 2026-10-06.
Read the rig brief, common rules, AGENTS, PLAN D89/M109, the vault research,
lane-0 handoff/recheck and V1–V16 threat model. Zero model attempts, paid calls,
network calls, real credentials, clipboard operations or dependency changes.
No merge, push or gate changes. Tests use generated material only.

## Credential management

`VaultMigration` is private management code, structurally implementing B's
`VaultCredentialBindingPort`. Each codec owns the installed store's exact
format, key, item id and origin. The existing Meta key is the only merged
format on this base. Its item is `meta-model-api`, bound to
`https://api.meta.ai`, hidden and first-party with agent policy Never.

Copy writes an encrypted-journal intent, writes the item, decrypts it back,
SHA-256-compares every material and security metadata field, then activates the binding.
The old value remains untouched. Rotation copies caller bytes before queuing,
verifies the new vault item, mirrors through the old store and rereads it to
verify equal SHA-256 before success. Interrupted copy/mirror/delete phases
remain unusable and can resume. Every acquired byte buffer is wiped in finally,
including stale returned reads; SecretStorage/native APIs still require
immutable strings, whose erasure cannot be promised (V7's stated residual).

Undo restores the current vault value and switches the record to the legacy
route, available until the retention window ends. Retirement waits two trusted
minor-release-history ordinals (patches do not increment), rechecks the vault
digest and refuses a legacy credential changed by downgrade code. It removes
the old entry and emits one notice containing only its original key name.
Born-in-vault records create no legacy copy. Logout deletes both stores.
Display labels and last-use dates do not invalidate a value digest. Rotation
preserves creation/last-use dates, the reviewed label and presence choice.
Redo after Undo starts a fresh retention window.

The existing previous-release `CredentialStore` is exercised against the same
SecretStorage map after migration and rotation: it still reads its key.
OS-store tests verify D61's original service/account, with no spawned helper.
No other application's store or token is enumerated. Equal Meta values from
different scoped journals can share the canonical item. Different values are
refused without overwriting either source; the host must ask the user to resolve
the conflict through native credential entry, never by sending values to a UI bridge.

## Required integration bindings

These are explicit injected ports, not production fake implementations:

| Owner     | Binding                                                                                                                                                                                                                                                       |
| --------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| C         | `MigrationVaultPort` and `MigrationJournalPort`; encrypted journal scoped by stable sourceId to the legacy installation/profile or native service/account; single-writer owner shared across editors; invoke `authorize` at the physical atomic commit        |
| B/P       | `MigrationLease.assertCurrent` bound to writer generation and lock epoch; hold ownership until cleanup finishes                                                                                                                                               |
| W         | Lazy `dist/vault.js` factory; migrate/resume before publishing first-party bindings; coordinate every retained source adapter on each first-party vault write before success; switch back to the installed legacy store when Undo makes `resolve` return null |
| W         | Trusted monotonic minor-release ordinal from release history, unchanged by patches/downgrades; translated retirement notice using lane-0's existing surface                                                                                                   |
| M85       | TypeSafe key codec and original key, exact `https://api.typesafe.ai` binding                                                                                                                                                                                  |
| M95 K/b/c | Provider/profile, plan OAuth and custom-header codecs; preserve origin, issuer/resource and exact installed formats; new stores are born in vault                                                                                                             |
| M108 K    | Account credential codec and account binding                                                                                                                                                                                                                  |
| M100 P    | Pair codec as hidden first-party `devicePair`                                                                                                                                                                                                                 |
| M103      | Maker key codec and exact registered machine-origin binding; actuation approvals unchanged                                                                                                                                                                    |

The native SecretStorage APIs have no cancellable compare-and-swap. Their
already-dispatched writes/deletes may settle after a lock; the serialized owner
must keep the lease until settlement. A different version/application can also
change a legacy entry after the final comparison. This is same-user legacy-store
authority, not an atomicity claim about those APIs. No new value is released by
an invalidated migration binding.

## Ambient files and login CSV

Discovery performs only directory/name/stat operations for `.ssh/id_*` (not
`.pub`), `.git-credentials`, `.netrc`, `.npmrc`, `.aws/credentials` and
`.docker/config.json`. Links and linked credential folders are excluded.
Windows separators are normalized for matching, and Windows home paths use
`path.win32`; no credential file is opened at activation or discovery.

Import requires U/H's authenticated user action, reads a bounded regular file
through a held descriptor, checks exact native identity/size/mtime, validates
all items and collisions, commits C's atomic batch and decrypts/hash-verifies
every copy. The preparation callback transfers item ownership; failures before
transfer remain the callback's cleanup responsibility. All transferred material,
source bytes and verification reads are wiped in finally, including late
results after Lock or Dispose. Public results contain metadata and an opaque
receipt, never material. The action assertion must bind action/path/view epoch,
not merely test a boolean supplied in a bridge message.

Keep destroys the receipt. Delete is a separate user action: it rereads and
hashes the original, checks its identity and the still-present vault copies,
then checks size/mtime/identity and unlinks synchronously in one JavaScript
tick. Keep/Dispose invalidate pending Delete; Dispose also blocks pending
Import. No receipt is issued after failed verification. A different same-user
process can still race a filesystem name between comparison and unlink; this
is not an OS compare-and-unlink claim (D64/V6). The original always remains on
import failure. CSV exports get the same Keep/Delete path and U's existing
translated export-deletion warning.

Fixed plaintext decoders return private drafts for user-reviewed names, labels,
bindings and policy: HTTPS git URLs; target-specific netrc login/password;
literal npm auth entries; AWS static access/secret/session fields; Docker
literal auth/identity-token entries. They refuse unsupported/ambiguous forms,
empty results and unresolved environment substitutions. netrc default/macdef/
account forms are refused; npm base64 auth representations are retained
exactly for scoped environment use. Docker credential helpers are never
invoked. S supplies SSH parsing, with its own capture/format validation.

Login CSV requires an explicit reviewed column mapping, strict quoted-field
parsing (including commas, escaped quotes and CRLF), exact row widths and
unique headers. It requires HTTPS without URL userinfo, normalizes IDNA origins
and rejects malformed UTF-8, NUL and empty exports. Passkey/CXF files are not
imported. L supplies the TOTP export decoder; encoded seed text is never used
as a binary seed. Returned seed bytes are copied and wiped. L then builds
origin-bound webLogin items; U/H supplies reviewed metadata and the default
Ask every time policy. No password-manager store or browser is opened.

All logic is shared core. VS Code-family and runtime adapters differ only in
legacy storage access. U/H/native bridges/companion reuse these same private
management ports; values never cross a UI bridge. No visual/UI code changed;
browser/editor checks are handoffs on a Chrome-capable rig per the brief.
No feature catalog/reference generator exists on this base. W must register
Import/Keep/Delete, Undo, retirement notices and H's `vault import` in the
feature catalog/reference when wiring their user-facing surfaces. No new
command/setting/script is claimed as shipped by this lane.

## Final rig verification

All checks below run directly on this MacBook, without a test timeout override.
Final default-timeout Vitest verification covers the five owned test files: `migrate.test.ts`,
`migrationLifecycle.test.ts`, `migrationAdapters.test.ts`, `importFile.test.ts`
and `loginCsv.test.ts`: **52/52 passed** on the final restored source, in
two invocations of three files (26 tests) and two files (26 tests).

| Check                                 | Result                                                                        |
| ------------------------------------- | ----------------------------------------------------------------------------- |
| Full five-project `npm run typecheck` | Exit 0 on final restored-source rerun                                         |
| Changed-file ESLint, max warnings 0   | Exit 0 on final restored-source rerun                                         |
| Changed-file Prettier check           | Passed; final docs formatting checked in hooks                                |
| `node scripts/check-l10n.mjs`         | 14 UI tables, 164 manifest strings, 0 problems                                |
| Plain `npm run deadcode` (Knip)       | Exit 0; two pre-existing configuration hints, no dead code                    |
| `npx jscpd`                           | Exit 0; 1,219 files, zero clones; threshold unchanged                         |
| `npm run build`                       | Exit 0; size/split/host-global/notices checks pass; no cap changes            |
| `npm run check:host-api`              | Exit 1 on generated built-in import-count drift; W-owned regeneration handoff |

Build measurements: extension 436.9 KiB (600 cap), Model API 446.8 KiB (475
cap), checkpoint store 77.1 KiB (225 cap). These are the base's existing
shipped chunks: M's private factories enter W's planned lazy vault chunk on
integration, so the build is not a claim that migration is already activated.
No activation, webview or existing manifest/source-owner code was changed.

The host API result keeps 332 VS Code APIs, 31 importing files, 25 Node
built-ins and 61 theme variables. Its stale built-in rows are child_process
13→14, crypto 46→56, fs 33→37, fs/promises 47→51, net 7→10 and path 84→90.
This includes lane-0/B's existing drift and M's new imports. W regenerates
`docs/ide-compatibility/host-api.md` with the normal write/check command on the
joined tree; the generated W-owned file and gate remain untouched here.
Full aggregate quality, browser/a11y/editor matrix and platform captures stay
lead/W-owned under the brief. No Chrome is installed or used on this rig.

## Tests and red drills

Initial default-timeout run: `migrate.test.ts` and
`migrationAdapters.test.ts`, 13/13 passed on this MacBook. Commands use
`npx vitest run <files> --maxWorkers=3`; no timeout override or browser suite.
All 21 credential mutations and 23 import/decoder mutations fired in their named default-timeout tests and
restored source bytes exactly; receipts are in
[m109-m-credential-drills.json](m109-m-credential-drills.json) and
[m109-m-import-drills.json](m109-m-import-drills.json). Changed-file ESLint passed with zero warnings. Native retirement/logout now
reread the legacy entry to confirm deletion; a native false/no-op cannot
publish success. The duplication gate initially found four blocks; shared
record/persist helpers and test setup removed them without dropping assertions.
The restored gate reports zero clones, and credential drills were rerun against
the final refactored source. Full joined-tree quality and browser/editor checks
remain lead-owned by the rig brief.

Owner-codec tests cover API keys, OAuth, device pairs and internal records with
test-only opaque serialization. They do not claim an unmerged owner module's
installed format. Scoped-source tests prove equal canonical values can be
shared, different values preserve both originals, and foreign journal records
are refused.

| M control                                                                                   | Threat row | Named tests / drill receipt ids                                                               |
| ------------------------------------------------------------------------------------------- | ---------- | --------------------------------------------------------------------------------------------- |
| Hidden first-party policy; bound Meta origin; private user actions                          | V1, V4     | codec visibility/origin tests; M09/M12/M17, I01                                               |
| Known-name discovery; links/regular-file/bounds checks; no other app store reads            | V5, V6     | discovery/linked-folder/bounded-source tests; I08/I12/I13/I14                                 |
| Owned plaintext cleanup, Lock and Dispose; no values in results or forwarded errors         | V7, V9     | stale read/queued copy/Dispose/Keep tests; M07/M08/M19, I02/I03/I09/I10                       |
| Copy/decrypt/hash verify; mirror, undo, retention, scoped journals and confirmed deletion   | V11, V16   | migration lifecycle/native delete/corrupted mirror tests; M01-M06/M10/M11/M13-M16/M18/M20/M21 |
| Verified import receipt; source/copy/identity/final metadata rechecks                       | V11, V16   | changed/replaced/missing-copy/Delete race tests; I04-I07/I11                                  |
| Strict CSV mapping/grammar, HTTPS/IDNA, binary TOTP decoder; literal credential drafts only | V9, V14    | CSV/ambient decoder tests; D01-D09                                                            |

V2/V3/V8/V10/V12/V13/V15 retain the runtime owners in the lane-0 threat model;
M adds no command execution, clipboard, device, unattended or model-facing
secret route. V14's live frame/certificate/fill checks remain L's, beyond M's
local import-origin check. C/P/B still certify encryption, slot/peer isolation,
rollback, audit and presence; these management-port tests do not substitute
for their platform captures.

Planning status: M's credential core is implemented against the contracted
ports, with ambient discovery/import and CSV complete. Next slice is W binding
C/P/B, U/H user actions and later owner codecs. M109 remains planned until
the joined store/platform/broker/UI/runtime wiring and acceptance gates pass.

## RVCM1094 R2 repairs (lane CM1094R2, 2026-10-11, linuxlt)

Branch `c/m109-4`, base `803e3dfa7`. Closes all four RVCM1094 findings
(3 P2, 1 P3) as a class: every record shape that can be installed is now
either migrated exactly or refused without touching the source, with its own
reason; nothing is silently dropped or defaulted. No residual, no new
dependency, no guard widened, diff inside the lane's files
(`src/core/vault/migrate/*`, its test, the changelog entry, this record).
Zero model attempts, paid calls, network calls or real credentials. Tests use
generated material only.

**Ownership rule (one slot, one owner).** A non-meta default account shares
the bare provider slot `museSpark.provider.<id>` with the M95 record, so
`accountSecretMigrationCredential` returns the provider codec's credential
for that slot (`accountSecrets.ts:73`): both factories name the same key,
item id and item, and the wiring registers each key once (the same pattern
the review accepts for Meta's shared Model API entry). The provider codec
migrates every shape its slot can hold (`providerCredentials.ts:37-88`):
bare 4-key records to `apiKey` items pinning `auth: 'apiKey'` (lead answer)
or to opaque `secret` items, and overlaid full 6-key account records to
`secret` items holding the canonical record verbatim in the installed
writer's key order (shared `accountRecordCanonicalJson`, `material.ts:85`,
so the mirror keeps the installed bytes and both previous readers still
parse it). Documents with unknown fields are refused rather than migrated
with fields dropped. The `chatgpt` slot is refused eagerly with `invalid`
(`providerCredentials.ts:94`): the ChatGPT subscription record's codec
belongs to its owner lane (lead answer), and this lane keeps refusing that
shape wherever its bytes land. Vault item names always fit the handle:
`migrationItemName` (`material.ts:102`) keeps short names readable and
hashes over-long installed names deterministically (finding 1's 49-char
account now migrates). The account codec keeps segmented slots only; short
documents there are refused exactly as the installed reader rejects them.

| Finding                                             | Fix                                                                                                                            | Regression test                                                                                                                                                                                               | Red drill (break → named failure → restore)                                                                                      |
| --------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------- |
| P2-1 long account names refused                     | `migrationItemName` hashes names past 48 chars, deterministic (`material.ts:102`); both factories use it                       | `migrates a longest account name inside the vault handle` (32-char ids, handle regex, determinism, equal SHA-256)                                                                                             | unconditional readable name → longest-name test fails; restored SHA-256 `43fdab37…` OK                                           |
| P2-2 legacy default encode/undo rewrites the source | default accounts migrate through the provider slot codec, so the short record round-trips byte-exact (`accountSecrets.ts:73`)  | `migrates the legacy default shape with equal SHA-256 and byte-exact undo` (name, SHA-256, undo bytes, both previous readers)                                                                                 | no delegation → legacy-default, factory-equality and ChatGPT-delegation tests fail; restored SHA-256 `61ce4d65…` OK              |
| P2-3 shared key/item id, divergent items            | single interpretation per key (delegation), 6-key overlay migrated verbatim, unknown fields refused, `chatgpt` refused eagerly | `names one item for a shared provider slot`, `overlaid full account record … verbatim`, `refuses records with unknown fields`, `refuses the ChatGPT subscription shape` (real `chatGptRecordSchema` literals) | no delegation / no overlay branch / no extras check / no chatgpt guard → the named test(s) fail; restored SHA-256 `e5fe73f2…` OK |
| P3 changelog nesting                                | migration bullet moved below the RVCM1091A2 repairs (`CHANGELOG.md`)                                                           | `keeps the migration note after the RVCM1091A2 repairs` (order assertion)                                                                                                                                     | bullet back in the middle → changelog test fails; restored SHA-256 `b1f0af20…` OK                                                |

All drills ran at the repository timeout (no `--testTimeout`) and every file
was restored byte-exact (SHA-256 verified against the pre-drill hash).

**Owed by the vault join (copied from RVCM1094 §Wiring call sites).** These
codecs are still unwired: no production file imports either factory. On the
vault join, call `resume` then `migrate` for each owned key once the vault is
unlocked, then `retire`, on every unlock (not only first setup), through both
adapters (`migrateSecretStorage` in `src/host/vault/migrateSecretStorage.ts`
and `migrateKeyStore` in `src/runtime/vault/migrateKeyStore.ts`); register
each key once and never register `providerCredentialMigrationCredential`
for `chatgpt` (M95b owner lane). `now` must be a nonnegative integer.
Startup: the unlock finishing setup is `VaultManagement.confirmSetup` after
`broker.unlock` (`src/core/vault/broker/management.ts:616`), forwarded by
`src/host/vault/vaultPanelHost.ts:273`, `src/host/vault/vaultPanelService.ts:88`,
`src/runtime/vault/vaultCommand.ts:341`, `src/runtime/vault/vaultRuntimeEntry.ts:114`.
Meta key reads, one `modelApi` codec only: `CredentialStore.getApiKey`
(`src/host/auth/credentialStore.ts:43`), `src/extension.ts:1244`, `:1259`,
`:2012`, `:2550`, `:2857`, `:3497`, `:4556`,
`src/host/backend/modelApiBackendManager.ts:362` and `:617`,
`src/host/auth/authService.ts:842`, `src/host/prompts/promptEntry.ts:440`,
`src/runtime/backends.ts:341`. Provider record reads and writes:
`readProviderCredential` / `saveProviderCredential` /
`deleteProviderCredential` (`src/host/providers/credentialRecords.ts:72`,
`:59`, `:94`), scan and test `credentialFor`
(`src/host/providers/providersHost.ts:147`), raw presence
(`providersHost.ts:248`), wizard save and restore
(`src/host/providers/wizardSave.ts:101`, `:116`, `:118`), removal
(`src/host/providers/providerRemoval.ts:78`), import clear
(`src/host/providers/importExport.ts:176`), the send path
(`src/core/providers/configured.ts:171`), presence
(`src/host/auth/credentialStore.ts:94`); writes go through `store`, deletes
through `delete`, or the mirror drifts. Account reads and writes:
`secretStorageAccountVault` (`src/host/providers/accountSecrets.ts:28`
read, `:66` write, `:81` remove), composed at
`src/runtime/providers/runtimeServices.ts:223` and
`src/runtime/providers/accountStore.ts:19`; dispatch is
`AccountStore.useCredential` (`src/core/providers/accounts.ts:247`) and
write (`accounts.ts:224`); runtime startup reaches this through
`src/runtime/main.ts:963`. The join must also teach vault-side readers that
a migrated default slot can be a `secret` item (overlaid full records keep
their bytes verbatim there) as well as an `apiKey` item. `writeBatch` stays
out: rotation and resume need `VaultMigration`'s single-item `write` plus
the journal.
