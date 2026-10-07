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

## Tests and red drills

Initial default-timeout run: `migrate.test.ts` and
`migrationAdapters.test.ts`, 13/13 passed on this MacBook. Commands use
`npx vitest run <files> --maxWorkers=3`; no timeout override or browser suite.
All 19 credential mutations fired in their named default-timeout tests and
restored source bytes exactly; receipts are in
[m109-m-credential-drills.json](m109-m-credential-drills.json). Core ESLint
passed with zero warnings. Final import and joined verification results follow
with the completed import slice. Full joined-tree quality and browser/editor checks
remain lead-owned by the rig brief.

Owner-codec tests cover API keys, OAuth, device pairs and internal records with
test-only opaque serialization. They do not claim an unmerged owner module's
installed format. Scoped-source tests prove equal canonical values can be
shared, different values preserve both originals, and foreign journal records
are refused.

Threat mappings: V1/V4 (hidden first-party policy and private management), V7
(owned buffers/finally), V9 (value-free journal/public results and sanitized
errors), V11/V16 (generation checks and verified, delayed retirement).

Planning status: M's credential core is implemented against the contracted
ports; ambient discovery/import and CSV are next. M109 remains planned until
the joined store/platform/broker/UI/runtime wiring and acceptance gates pass.
