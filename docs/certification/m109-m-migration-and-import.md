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

## RVCM1094B R3 repairs (lane CM1094R3, 2026-10-11, linuxlt)

Branch `c/m109-4`, base `4425e81ef`. This module has now had two review
rounds, so the third round redesigns the part that keeps failing instead of
patching it: `migrationItemName` (`src/core/vault/migrate/material.ts`) is
replaced by a one-to-one contract. Every finding below, P3 included, is
fixed as a class. Zero model attempts, paid calls, network calls or real
credentials. Tests use generated material only.

**No compatibility path.** Nothing shipped with the old names: no
production file imports `providerCredentialMigrationCredential`,
`accountSecretMigrationCredential`, `migrationItemName` or
`accountRecordCanonicalJson` (only the codec modules import each other, and
only `migrationCodecs.test.ts` imports them in tests). The two generic
adapters (`migrateSecretStorage` in
`src/host/vault/migrateSecretStorage.ts`, `migrateKeyStore` in
`src/runtime/vault/migrateKeyStore.ts`) import the `VaultMigration` engine,
never a codec factory, so no migrated item exists anywhere. The one
old-name expectation in the suite (`account-openai-work`) is updated to the
new contract (`account-6-openai-work`); no other test or source named an old
name.

| Finding                                                                         | Fix                                                                                                                                                                                                                                                                                                                                                                         | Regression test                                                                                                                                                                                                                                                                                                                                                      | Red drill (break → named failure → restore)                                                                    |
| ------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------- |
| P2 name join collides, readable and hashed                                      | `migrationItemName(kind, ...ids)` with a closed `MigrationItemKind` union (`material.ts`): one id stays `provider-<id>`; two or more ids write every id but the last as `<length>-<id>` with the last bare; past 48 chars the name is `<kind>-<hex>` over the canonical JSON array `[kind, id1, ...]`; every id validated, invalid refused with `invalid`, never normalised | `gives the review's colliding pairs different names and migrates all four to active` (exact readable names, hashed shape, one `VaultMigration` to `active` ×4); `keeps a closed kind union`; exhaustive 170 ids × kinds/shapes (29,070 names, all distinct, handle pattern, deterministic); seeded 400-tuple run with dash-shift partners; 48/49-char boundary cases | length prefix replaced by a bare join → pairs test fails; restored SHA-256 `ddc779b0…` OK                      |
| P2 defence in depth: constructor takes two credentials sharing a name           | `MigrationCredential.name` (set by `migrationCodec` and the modelApi codec) and a third `conflict` refusal beside the key/id checks (`migrate.ts:29`)                                                                                                                                                                                                                       | `refuses two credentials that share an item name before any journal row or write` (sources byte-identical, journal empty, vault empty)                                                                                                                                                                                                                               | name-set line dropped → constructor test fails; restored SHA-256 `317d467e…` OK                                |
| P3 hand-off list names readers/helpers, leaves out writers/deleters             | Full sweep: 113 call sites checked into `migrationKeyInventory.test.ts`, found by `collectKeyFamilySites` (`migrationKeySites.ts`) scanning `src/`; per-file multisets, so a new call in an already-listed file still fails                                                                                                                                                 | `lists every reader, writer and deleter of the three key families`                                                                                                                                                                                                                                                                                                   | one `EXPECTED_SITES` entry dropped → inventory test fails (113 vs 112); restored SHA-256 `54771247…` OK        |
| P3 join scenario has no acceptance case                                         | Skipped test naming lane W with the assertion written out, in `migrationCodecs.test.ts`                                                                                                                                                                                                                                                                                     | `vault join (lane W): a key set after its slot is active goes through the vault` (`it.skip`)                                                                                                                                                                                                                                                                         | skipped by design; the body typechecks and mirrors the passing `store` path                                    |
| P3 `migrate` on `active` returns as if nothing happened after a back-door write | `migrate` reports a distinct typed state `diverged`: `legacyDiverged` reuses `verifyLegacy` (same compare, same wiping, fixed words only) and reports a boolean — mismatched or undecodable legacy → `diverged`, anything else still throws; `verifyLegacy` unchanged                                                                                                       | `reports a legacy copy changed behind the vault instead of returning active` (valid overwrite → `diverged`, journal stays `active`, undo still `conflict`, garbage → `diverged`, journal/listing carry no `synthetic-` bytes)                                                                                                                                        | `legacyDiverged` call dropped → diverged test fails; restored byte-exact (re-drilled after the clone refactor) |

All drills ran at the repository timeout (no `--testTimeout`) and every
file was restored byte-exact (SHA-256 verified against the pre-drill hash;
the inventory file's later one-word comment fix, 108 → 113, is the only
subsequent edit).

## RVCM1094C R4 repairs (lane CM1094R4, 2026-10-11, linuxlt)

Branch `c/m109-4`, base `c7a420942`. Closes all six RVCM1094C findings
(P3) as a class, with the two the vault join needs first. Zero model
attempts, paid calls, network calls or real credentials. Tests use
generated material only. No new dependency, no guard widened except the
inventory's account-store coverage (finding 2, which the finding demands),
diff inside the lane's files.

| Finding                                                           | Fix                                                                                                                                                                                                                                                                                                                                                                                                                                                           | Regression test                                                                                                                                                                                                           | Red drill (break → named failure → restore)                                                                                                       |
| ----------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------- |
| P3-1 deleted legacy copy reads as `active`, undo resurrects it    | `migrate` reports a deleted copy behind an `active` slot with its own typed state `legacyDeleted` (`migrate.ts`: `legacyAbsent` + active-branch check); `undo` refuses an absent legacy copy with `conflict` and leaves it absent; `verifyLegacy` unchanged so `retire` still completes a crashed delete without writing anything back                                                                                                                        | `reports a legacy copy deleted behind an active slot and never writes it back`: unchanged/overwritten/deleted/another-shape/unreadable crossed with migrate, undo and retire through the real installed writer and reader | both guards dropped → `expected 'active' to be 'legacyDeleted'`; restored byte-exact (SHA-256 verified)                                           |
| P3-2 inventory blind to account-store writers/deleters            | scanner matches the store's own write/delete entry points and their callers by method name, not by key string (`migrationKeySites.ts`: `setCredential(`, `rebindOrigin(`, `useCredential(`, `readForRemoval(`, `accounts.remove(`, `write(binding`, `remove(binding`, `AccountCredentialVault`, `AccountSecrets`); 156 sites checked in (35 + 65 + 13 unchanged, 43 new; R5 correction: 3 of the 43 are hook-index annotations, so 40 true route touchpoints) | `lists every reader, writer and deleter of the three key families`                                                                                                                                                        | reviewer's drill file (`revqDrill.ts` calling `accounts.setCredential`/`accounts.remove`) → 158 vs 156; file removed, tree clean                  |
| P3-3 certification rows mismatch the head                         | account-slot rows corrected (`:180` `remove` entry keyed at `:182`, `:203` `rebindOrigin` write entry keyed at `:222`, writer `setCredential` `:166`/`:175` named); `src/extension.ts:2550` added to the model-key row; `src/runtime/authCommands.ts:144` (`providerSecretAccount` behind `:159`/`:196`) added to the provider row                                                                                                                            | every `file:line` printed against the head before editing                                                                                                                                                                 | read-only fix, no drill                                                                                                                           |
| P3-4 declared name can differ from the name `decode` builds       | the constructor binds a `decode` wrapper (`migrate.ts`) that refuses any other decoded name with `conflict` before any journal row, comparison or write (wiping the refused item); the lifecycle test's own codec now declares the name its `decode` builds                                                                                                                                                                                                   | `refuses a credential whose decode builds a different name before any write` (journal empty, vault empty, legacy byte-identical)                                                                                          | wrapper dropped → lying credential migrates to `active`; restored byte-exact (SHA-256 verified; a later lint-only receiver fix re-verified green) |
| P3-5 skipped join case passes unwired, two assertions cannot fail | join case goes through the real installed writer (`saveProviderCredential`) and asserts the vault carries the rotated value; kind test asserts exact names plus cross-kind distinctness; dash test asserts verbatim id embedding in the readable branch                                                                                                                                                                                                       | join case still `it.skip` (lane W un-skips)                                                                                                                                                                               | un-skip today → SHA mismatch (vault keeps the first key); bare-join break → both name tests fail; restored byte-exact (SHA-256 verified)          |
| P3-6 account factory throws bare zod for an invalid id            | `accountSecretKey` throw translated to `VaultMigrationFault('invalid')` (`accountSecrets.ts`), the same typed fault the provider factory throws                                                                                                                                                                                                                                                                                                               | `refuses an invalid id with the same typed fault from every factory` (both factories, `toBeInstanceOf` plus code)                                                                                                         | translation dropped → named test fails; restored byte-exact (SHA-256 verified)                                                                    |

All drills ran at the repository timeout (no `--testTimeout`) and every file
was restored byte-exact (SHA-256 verified against the pre-drill hash).

## RVCM1094D R5 repairs (lane CM1094R5, 2026-10-11, linuxlt)

Branch `c/m109-4`, base `e99b58bc8`. Closes all five RVCM1094D findings
(P3) as a class. Finding 1 gets a design, not a patch: the engine writes
its intent before it deletes, so its own interrupted retire and a deletion
behind the vault are told apart by evidence. Zero model attempts, paid
calls, network calls or real credentials. Tests use generated material
only. No new dependency; the only guard change is the inventory coverage
finding 2 demands; diff inside the lane's files.

| Finding                                                                                         | Fix                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    | Regression test                                                                                                                                                                                                                 | Red drill (break → named failure → restore)                                                                                                                                                              |
| ----------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| P3-1 interrupted retire reads as `legacyDeleted`; late `retire` completes a user deletion       | `retire` writes a durable `retireIntent` journal row before the legacy delete (`migrate.ts` › `retire`); a missing copy with the intent is finished to `retired` with the ordinary notice by `migrate`, `resume` and `retire` (`finishInterruptedRetire`), one without it stays `legacyDeleted`; `retire` without the intent returns false with no notice and keeps the report; `delete` of a last copy needs `{ destroyLastCopyConfirmed: true }` (literal `true`, so a variable cannot satisfy it by accident) and otherwise refuses with `conflict` | `a kill at every retire await is never reported as a user deletion` (3 codecs × 4 kills × migrate/resume/retire/undo/delete) plus the rewritten deleted-copy block (unflagged delete refuses, flagged delete records `deleted`) | intent write dropped → crash-table test fails; flag guard dropped → deleted-copy test fails; retire intent check dropped → deleted-copy test fails; `migrate.ts` restored SHA-256 `e6dacb9e…` after each |
| P3-2 inventory blind to an `AccountStore` removal under another receiver name                   | removals found by resolved type (`migrationKeySites.ts` › `collectAccountStoreRemovals`: every `.remove(` call whose method belongs to `AccountStore` or a subclass), replacing the `accounts.remove(` spelling; store's own `remove` definition, the generic `useCredential<` entry and the two vault-port reads held; the three hook-index annotations dropped                                                                                                                                                                                       | `lists every reader, writer and deleter of the three key families` (158 sites; named 120 s timeout — full-tree type resolution takes ~15 s on a loaded rig)                                                                     | drill file calling `store.remove` and `services.store.remove` on the store → 160 vs 158, both new sites named; file removed, tree clean                                                                  |
| P3-3 join-case text names writers that never land there; unreadable block skips its retire cell | comment says where each writer really lands (wizard only through `saveProviderCredential`; `activateApiKey` through `credentials.setApiKey`, `auth set`/`providers add` through `deps.secrets.store`); unreadable block runs `retire` inside the window (`false`) and after it (`invalid`, nothing written)                                                                                                                                                                                                                                            | the updated table block and the still-skipped join case                                                                                                                                                                         | text-only fix; the retire cell runs in the suite                                                                                                                                                         |
| P3-4 hand-off rows stale or missing                                                             | every hand-off cite below names its symbol, never a line number; rows added for the wrapper write/delete/removal reads, the `rebindOrigin` removal read, the `accountClientLookup` reads and all eight R5-touched inventory entries; R4's "43 new" corrected (3 were hook-index annotations; true count 40, now 45)                                                                                                                                                                                                                                    | a script printed every cited symbol against the head before editing                                                                                                                                                             | read-only fix, no drill                                                                                                                                                                                  |
| P3-5 changelog still describes the R3 tree                                                      | entry names `legacyDeleted`, the retire-intent design, the confirmed last-copy delete and 158 inventoried sites                                                                                                                                                                                                                                                                                                                                                                                                                                        | `keeps the migration note after the RVCM1091A2 repairs` still passes                                                                                                                                                            | read-only fix, no drill                                                                                                                                                                                  |

All drills ran at the repository timeout (no `--testTimeout`) and every file
was restored byte-exact (SHA-256 verified against the pre-drill hash).

## RVCM1094E repairs (lane CM1094R6, 2026-10-12, linuxlt)

Branch `c/m109-4`, base `f673a51a0`. Closes all three RVCM1094E findings
(P3) as a class, including the remainder of the round 5 design the review
left open. Zero model attempts, paid calls, network calls or real
credentials. Tests use generated material only. No new dependency; no guard
widened; diff inside the lane's files.

| Finding                                                                                                                                         | Fix                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               | Regression test                                                                                                                                                                                                                                                                                                                           | Red drill (break → named failure → restore)                                                                                                           |
| ----------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------- |
| P3-1 a crash between the retire intent and the delete reads a later real deletion as the engine's own retire; `resume` threw for a changed copy | the window is closed instead of told apart: the engine exposes one call, `src/core/vault/migrate/migrate.ts` › `VaultMigration` › `finishPendingRetires`, for the vault at every open before any other migration call — a present copy is deleted and recorded `retired`, an absent one is recorded `retired` with a journal note saying the engine did not see the delete, a changed one reports `diverged` with its stale intent cleared and the call goes on; `resume` shares the same helper (`finishOneIntent`) so it clears a stale intent and reports `diverged` instead of throwing `conflict`/`invalid`; `delete` gains the separately named `legacyDeletionConfirmed` for the `legacyDeleted` answer after asking the person, while `destroyLastCopyConfirmed` stays the ordinary delete (a plain sign-out may pass it) | `finishes a pending retire intent at open instead of leaving it lying`, `notes a pending retire intent resumed with the legacy copy already absent`, `reports a changed legacy copy at open and still finishes the other rows`, `resume reports a changed legacy copy instead of throwing`, `keeps the two last-copy confirmations apart` | `resume` back to `finishInterruptedRetire` → `resume reports a changed legacy copy` fails; `migrate.ts` restored SHA-256 `537c1665…`                  |
| P3-2 inventory misses five of the nine removal forms (destructured, bound, element access, deep subclass, structural port)                      | a removal is found by the declaration it resolves to: direct and element accesses, destructured or bound references followed to their binding, overrides in subclasses at any depth (heritage walked with the checker), and structural ports the store is assignable to (`isTypeAssignableTo` — the first version called the non-existent `isAssignableTo`, swallowed by its own `try/catch`, so the port form never counted)                                                                                                                                                                                                                                                                                                                                                                                                     | `finds an AccountStore removal by its declaration in every call form` (the reviewer's nine forms, each generated against the real `AccountStore`); the 158-site count holds unchanged                                                                                                                                                     | port check back to `isAssignableTo` → 8 vs 9, the port form unnamed; `migrationKeySites.ts` restored SHA-256 `2f3e139c…`                              |
| P3-3 hand-off cites carry line numbers (ChatGPT row, wiring list, join comment)                                                                 | every cite is a `file › symbol` anchor: the ChatGPT row, the adapters, the startup chain, the Meta/provider/account reads and writes, and the join comment (which now also separates `authSetProvider` from `auth set` — the old comment put `:128` under the wrong command); the same inventory test that checks the key-family rows checks the marked hand-off region carries no line number and every anchor resolves at the head                                                                                                                                                                                                                                                                                                                                                                                              | `hand-off symbol anchors resolve at the head and carry no line numbers`                                                                                                                                                                                                                                                                   | anchor renamed → names the stale pair; planted `file:9999` → names the cite; doc restored byte-exact (SHA-256 verified before this section was added) |

All drills ran at the repository timeout (no `--testTimeout`) and every file
was restored byte-exact (SHA-256 verified against the pre-drill hash).

<!-- hand-off anchors start: every `file › symbol` pair below is checked
against the head by `test/unit/vault/migrationKeyInventory.test.ts`, and no
line number may appear here. Name the symbol, never the line. -->

**Join hand-off: answering a migration report.** `migrate` reports the slot
state; the join answers with exactly one call. At every open, before any
other migration call, the vault finishes every pending retire intent at once
(`src/core/vault/migrate/migrate.ts` › `VaultMigration` › `finishPendingRetires`),
so no intent survives an open. Only a confirmed `delete` destroys the last
copy, and the two confirmations cannot be confused in code: an `active` slot
that still retains its legacy copy but finds it absent answers `legacyDeleted`
only after asking the person, with `legacyDeletionConfirmed`; every other
last copy — a `retired` slot, a credential born in the vault — is an ordinary
delete, confirmed with `destroyLastCopyConfirmed` (a plain sign-out may pass
it). Both flags are typed as the literal `true`, so the join passes each only
in the branch where its own confirmation happened. `resume` on an `active` row
whose legacy copy changed after the intent clears the stale intent and reports
`diverged` instead of throwing, so the join's per-key `resume`, `migrate`,
`retire` sequence goes on to the other rows.

| `migrate` reports                                       | Allowed answers                                                                                                                                                                                                           | Last copy                                                                                                 |
| ------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------- |
| `active`, legacy present                                | `retire` (false inside the window, completes after it), `undo` (inside the window), `store` (re-seed), `delete` (removes both copies; no flag — the legacy copy is still there)                                           | `delete` removes both copies: the ordinary user delete                                                    |
| `legacyDeleted` (active, legacy absent, no intent)      | `store` (re-mirrors and clears the report), `delete` with `legacyDeletionConfirmed` (the join asked the person first), or leave it; `retire` returns false with no notice and keeps the report; `undo` refuses            | only that `delete`; `delete` with `destroyLastCopyConfirmed` refuses with `conflict` and destroys nothing |
| interrupted retire (active with intent, legacy absent)  | `migrate`, `resume` or `retire`: all finish it to `retired` with the ordinary retire notice; `finishPendingRetires` at open already finished it when the join follows the order; `delete` with `destroyLastCopyConfirmed` | only that `delete`; unflagged refuses with `conflict`                                                     |
| interrupted retire (active with intent, legacy present) | `migrate` reports `active` (or `diverged` after a behind-vault change); `resume` or `retire` finish it; `store` re-seeds and clears the intent; `delete` (both copies present, no flag)                                   | `delete` removes both copies                                                                              |
| `retired`                                               | `store` (rewrite), `delete` with `destroyLastCopyConfirmed`; `retire` refires a pending notice once                                                                                                                       | only that `delete`; unflagged refuses with `conflict`                                                     |
| `diverged`                                              | `store`, and only after the user resolves the conflict (it overwrites both copies); `undo` and `retire` refuse                                                                                                            | overwrites, never silent: the user's resolution picks the value                                           |

**Owed by the vault join (replaces the R2 list as a class).** On every open,
before any other migration call, the vault calls `src/core/vault/migrate/migrate.ts`
› `VaultMigration` › `finishPendingRetires`, so no retire intent survives an
open and a later deletion behind the vault can never read as the engine's own
retire. The sweep covers `src/` host and runtime (CLI, ACP and exec): 158 sites — 35 for
`museSpark.modelApiKey`, 65 for `museSpark.provider.<id>` (55 key-fragment
sites plus 10 `secrets.*(account)` calls), 13 for
`museSpark.provider.<id>.account.<id>`, plus 45 account-store write/delete
entry points, vault-port calls and route types (`setCredential`,
`rebindOrigin`, `useCredential`, `useCredential<`, `readForRemoval`, the
store's own `remove` definition, the vault-port reads
`credentials.read(binding)` and `vault.read(binding)`, `write(binding`,
`remove(binding`, `AccountCredentialVault`, `AccountSecrets`) with their
callers, which serve every family through the store's default/meta routing
— checked into `test/unit/vault/migrationKeyInventory.test.ts` and scanned
by `test/unit/vault/migrationKeySites.ts` (import statements and `//`/`/*`
comments excluded; multi-line imports tracked; an `AccountStore` removal is
found by the declaration it resolves to — a direct call, an element access, a
destructured or bound reference, an override in a subclass at any depth, or a
structural port the store satisfies — so any of those spellings breaks the
test while another store's `remove` does not; hook-index
annotations `AccountSecretsDeps[` are not key accesses). R5 changes against
R4's 156: the three `accounts.remove(` spellings became four typed
`AccountStore.remove` entries (the `super.remove(` override included), the
store's own `remove` definition, the generic `useCredential<` entry and the
two vault-port reads gained rows, and the three hook-index annotations left.
After a slot is `active`, a write or delete must go through the vault
(`store`/`delete`), reads through `resolve`, and the legacy copy must never
be written on its own.

Model API key (35): builders and choke points
the `SECRET_KEYS.modelApiKey` definition in `src/shared/constants.ts`,
`CredentialStore` › `getApiKey` (read), › `setApiKey` (write), ›
`clearApiKey` (delete), › `hasProviderCredential` (provider presence), ›
`hasModelApiCredential` (internal read) in `src/host/auth/credentialStore.ts`;
`AuthService` › `activateApiKey` (read before rotate, write) and ›
`performSignOut` (delete) in `src/host/auth/authService.ts`; the adapter
closures and presence reads in `src/extension.ts` › `activateWindow`; the
request reads in `src/host/backend/modelApiBackendManager.ts` › `createHost`
and › `accountId`; the read in `src/host/prompts/promptEntry.ts` ›
`nativeDeps`; the presence reads in `src/host/providers/subscriptionFeatures.ts`
› `createSubscriptionFeatures`; the presence reads in
`src/runtime/chatGptProviderCommands.ts` › `runtimeSubscriptionClient`; `authSet`
(write), `authStatus` (read), `authClear` (delete) in `src/runtime/authCommands.ts`;
the reads in `src/runtime/backends.ts` › `save` and › `createRuntimeBackend`
and the adapter closure in › `modelApiManager`; the startup reads in
`src/runtime/main.ts` › `sharingPorts` and › `main`;
`modelApiMigrationCredential` in `src/core/vault/migrate/modelApi.ts` (the codec);
`accountSecretKey` in `src/core/providers/accountCredentialRecord.ts`
(meta/default routing); the non-key routing guard `secretsFor` in
`src/runtime/providers/runtimeServices.ts` › `createRuntimeAccountServices`;
`memorySecretStore` in `src/runtime/exec/keyInput.ts` (run-scoped seeded
memory store); the exec-env guard `get` in `src/runtime/exec/runExec.ts` ›
`runExec`. The join owes: route the `activateApiKey` write, the `authSet`
write, the `setApiKey` write, `promptForMetaAccountKey` in
`src/host/auth/metaAccountKey.ts` (second Meta key through the account
store) and any future writer through `store` (the reviewer's scenario), the
`performSignOut`, `authClear` and `clearApiKey` deletes through `delete`,
and the readers through `resolve`; the exec memory stores never write back.

Provider slot (65): `providerSecretKey` (def, build),
`saveProviderCredential` (def, write), `readProviderCredential` (def, read),
`deleteProviderCredential` (def, delete) and the `ProviderCredentialStore`
wrappers › `getProviderCredential`, › `setProviderCredential`, ›
`clearProviderCredential`, all in `src/host/providers/credentialRecords.ts`;
callers `credentialFor` in `src/host/providers/providersHost.ts` (scan read)
and › `createProvidersHost` (raw presence, test read); `saveWizardDraft` in
`src/host/providers/wizardSave.ts` (previous-secret read, save write,
rollback delete, rollback write); `deleteRemovedSecret` in
`src/host/providers/providerRemoval.ts` › `createProviderRemoval` (delete);
`importProviders` in `src/host/providers/importExport.ts` (clear on import);
`hasProviderCredential` in `src/host/auth/credentialStore.ts` (presence read);
the send-path reads in `src/core/providers/configured.ts` ›
`createConfiguredProviderServices`;
`providerCredentialMigrationCredential` in
`src/core/vault/migrate/providerCredentials.ts` (the codec);
`providerSecretAccount` (def, build), `parseStoredProviderSecret` and
`formatStoredProviderSecret` (record serde defs) in `src/runtime/keyStore.ts`;
`authSetProvider` (write), `authStatusProvider` (read), `authClearProvider`
(delete), the record serde and `providerAccount` (the slot behind the read
and the delete) in `src/runtime/authCommands.ts`;
`commitProviderChange` in `src/runtime/providersCommands.ts` (resolve, read,
compensating delete/write, delete, write), the `providersAdd` serde and the
`providersTest` serde and test read; `readProviderKey` in
`src/runtime/exec/providerExec.ts` (resolve, read, parse) and ›
`assembleProviderRun` (resolve, run-scoped memory mirrors). The join owes:
every writer through `store` (`providers add` lands at the
`commitProviderChange` write via the `providersAdd` serde), every deleter
through `delete`, every reader through `resolve`; the `providers add`
compensation in `commitProviderChange` must not restore the legacy copy on
its own after the slot is active.

Account slot (13, plus the store route): `accountSecretKey` (def, build,
segmented build) and the `AccountCredentialVault` interface (vault-port
read/remove/write surface) in `src/core/providers/accountCredentialRecord.ts`;
`secretStorageAccountVault` (def), its `readStored` (read), `write` and
`remove`, and the `AccountSecrets` wrapper every store write and delete
passes through — › `write` (port write), › `remove` (revocation, then port
remove), › `readForRemoval` (removal read) and the vault read inside ›
`read` — all in `src/host/providers/accountSecrets.ts`; `AccountStore` ›
`setCredential` (write entry, port write), › `remove` (delete entry, port
remove), › `rebindOrigin` (write entry with its `readForRemoval` removal
read, port write), › `useCredential` (generic read entry, port read),
`accountClientLookup` › `client` and › `scan` (reads), and › `add`'s
in-memory staging map only (no bytes), all in `src/core/providers/accounts.ts`;
callers `promptForMetaAccountKey` in `src/host/auth/metaAccountKey.ts`
(write), `runAccountAuthSet` in `src/runtime/providers/accountsCommand.ts`
(write) and › `runAccountsCommand` (typed `AccountStore.remove` delete), the
two typed `AccountStore.remove` deletes in `src/host/models/accountsHandler.ts`
› `handle`; the `PublishingAccountStore` › `setCredential` override and ›
`remove` override (typed `AccountStore.remove`), the `useCredential` read in
`secretsFor`, all in `src/runtime/providers/runtimeServices.ts` ›
`createRuntimeAccountServices`; the vault compositions `runtimeAccountStore`
in `src/runtime/providers/accountStore.ts` and in
`createRuntimeAccountServices`;
`accountSecretMigrationCredential` in
`src/core/vault/migrate/accountSecrets.ts` (the codec). The join owes the
same routing through the composed vault: every store writer through `store`,
every store deleter through `delete`, every reader through `resolve`.

ChatGPT slot (M95b-owned, refused by this codec as `invalid`):
`src/extension.ts` › `activateWindow` › `getPlanAccount`,
`src/extension.ts` › `activateWindow` › `createProviderClient`;
`src/host/providers/subscriptionFeatures.ts` › `createSubscriptionFeatures` › `accountId`,
`src/host/providers/subscriptionFeatures.ts` › `createSubscriptionFeatures` › `planAccount`,
`src/host/providers/subscriptionFeatures.ts` › `createSubscriptionFeatures` › `connectChatGpt`;
`src/host/providers/chatgptSignIn.ts` › `createChatGptSignIn`;
`src/runtime/chatGptHost.ts` › `RECORD_ACCOUNT`;
`src/runtime/chatGptProviderCommands.ts` › `runtimeSubscriptionClient` › `accountId`;
`src/runtime/backends.ts` › `modelApiManager` › `createProviderClient`,
`src/runtime/backends.ts` › `createRuntimeBackend` › `modelApiReadiness`.
The join must not register this lane's factory there; the owner lane's codec applies.

**Owed by the vault join (copied from RVCM1094 §Wiring call sites).** These
codecs are still unwired: no production file imports either factory. On the
vault join, call `resume` then `migrate` for each owned key once the vault is
unlocked, then `retire`, on every unlock (not only first setup), through both
adapters (`src/host/vault/migrateSecretStorage.ts` › `migrateSecretStorage`
and `src/runtime/vault/migrateKeyStore.ts` › `migrateKeyStore`); register
each key once and never register `src/core/vault/migrate/providerCredentials.ts`
› `providerCredentialMigrationCredential` for `chatgpt` (M95b owner lane).
`now` must be a nonnegative integer.
Startup: the unlock finishing setup is `src/core/vault/broker/management.ts` ›
`VaultManagement` › `confirmSetup` after `broker.unlock`, forwarded by
`src/host/vault/vaultPanelHost.ts` › `VaultPanelHost` › `handle`,
`src/host/vault/vaultPanelService.ts` › `vaultPanelService` › `confirmSetup`,
`src/runtime/vault/vaultCommand.ts` › `setUpVault`,
`src/runtime/vault/vaultRuntimeEntry.ts` › `vaultCommandPort` › `confirmSetup`.
Meta key reads, one `modelApi` codec only:
`src/host/auth/credentialStore.ts` › `CredentialStore` › `getApiKey`,
`src/extension.ts` › `activateWindow` › `museVoiceSetup`,
`src/extension.ts` › `activateWindow` › `refreshKeyPresence`,
`src/extension.ts` › `activateWindow` › `keyClient`,
`src/extension.ts` › `activateWindow` › `modelApi`,
`src/extension.ts` › `activateWindow` › `reportSource` › `readFacts`,
`src/extension.ts` › `activateWindow` › `controllerFor` › `accountFacts`,
`src/extension.ts` › `activateWindow`,
`src/host/backend/modelApiBackendManager.ts` › `ModelApiBackendManager` › `createHost` › `getAccountId`,
`src/host/backend/modelApiBackendManager.ts` › `ModelApiBackendManager` › `accountId`,
`src/host/auth/authService.ts` › `AuthService` › `activateApiKey`,
`src/host/prompts/promptEntry.ts` › `nativeDeps` › `registeredSecrets`,
`src/runtime/backends.ts` › `modelApiManager`. Provider record reads and writes:
`src/host/providers/credentialRecords.ts` › `readProviderCredential` (def, read),
`src/host/providers/credentialRecords.ts` › `saveProviderCredential` (def, write),
`src/host/providers/credentialRecords.ts` › `deleteProviderCredential` (def, delete);
scan and test `src/host/providers/providersHost.ts` › `credentialFor`;
raw presence `src/host/providers/providersHost.ts` › `createProvidersHost` › `providerStates`;
wizard save and restore `src/host/providers/wizardSave.ts` › `saveWizardDraft`
(save write, rollback delete, rollback write);
removal `src/host/providers/providerRemoval.ts` › `createProviderRemoval` › `deleteRemovedSecret`;
import clear `src/host/providers/importExport.ts` › `importProviders`;
the send path `src/core/providers/configured.ts` › `createConfiguredProviderServices` › `credential`;
presence `src/host/auth/credentialStore.ts` › `CredentialStore` › `hasProviderCredential`;
writes go through `store`, deletes through `delete`, or the mirror drifts. Account reads and writes:
`src/host/providers/accountSecrets.ts` › `secretStorageAccountVault` › `readStored` (read),
`src/host/providers/accountSecrets.ts` › `secretStorageAccountVault` › `write` (write),
`src/host/providers/accountSecrets.ts` › `secretStorageAccountVault` › `remove` (remove),
composed at `src/runtime/providers/runtimeServices.ts` › `createRuntimeAccountServices` and
`src/runtime/providers/accountStore.ts` › `runtimeAccountStore`; dispatch is
`src/core/providers/accounts.ts` › `AccountStore` › `useCredential` (generic read entry, port read) and
`src/core/providers/accounts.ts` › `AccountStore` › `rebindOrigin` (write entry with its
`readForRemoval` removal read, port write); runtime startup reaches this through
`src/runtime/main.ts` › `main` › `loadAccounts`. The join must also teach vault-side readers that
a migrated default slot can be a `secret` item (overlaid full records keep
their bytes verbatim there) as well as an `apiKey` item. `writeBatch` stays
out: rotation and resume need `VaultMigration`'s single-item `write` plus
the journal.
<!-- hand-off anchors end -->
