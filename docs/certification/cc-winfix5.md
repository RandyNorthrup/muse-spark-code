# CC-WINFIX5 — hosted CI run 41570764328, the last Windows red (2026-11-02)

Claude Code lane `CC-WINFIX5`, worktree `C:/Users/Randy/Coding/mx-cc-winfix3`, branch `cc/winfix5` from `cc/winfix4` at `249ad0f96c`,
on the owner's Windows 11 PC. Provider calls: **0**. Model attempts: **0**. Muse requests: **0**. Nothing was pushed, rebased, stashed,
reset or tagged. "Hosted shape" is as in `cc-winfix3.md`.

**Nothing of the vault ran here.** No vault or credential-store suite, no broker, no keyring. The new suite below tests a pure helper:
the bundler's graph of its 177 modules holds no keyring, and of the vault only `vaultStoreScope.ts` and `core/vault/exec/fence.ts`. The
`vaultStoreScope` change was worked out from the logs and the code, so **hosted CI is its first proof**.

## 1. The red

| Red                                         | Shard | Cause                                                                                                     | Shown or inferred                                                                     | Side |
| ------------------------------------------- | ----- | --------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------- | ---- |
| `vaultStoreScope`, `checkScopedRecords`:238 | 16    | A Windows OS-store slot is DPAPI: its reference is its own id, which can never begin `vault.<root hash>.` | The code leaves no other value. The log shows the line and `false`, **not the value** | test |

The product is right and the case was wrong. The case was written in a container that could not run it (`rlvaultanchor.md`), and that record's own
inventory already says so: "Windows and Secure Enclave slots seal into files and write no store record".

## 2. Not a spelling fault

The first guess was that the reference is hashed from one spelling of the root and the test hashes another. The run rules that out:

- **Both sides agreed on the hash, in this run.** Before line 238 the case passed `scoped anchor exists` and `scoped checkpoint exists`. Each reads an account
  the test computed through `vaultRootHash(brokerDataDir)` and finds what the broker wrote under its own `dataDir`. Line 238 calls the same helper on the same string.
- **A Windows slot takes no root.** `defaultBrokerSlots` gives `WindowsVaultSlots` only the helper; macOS and Linux get `dataDir`.
- **The value cannot be another root's reference.** `OsStoreVaultSlot`, which builds `vault.<root>...`, refuses anything but Linux and macOS when it is
  constructed. `WindowsVaultSlot.wrap` writes `keyReference: this.context.id`, and `unwrap` refuses a record that says anything else.

## 3. Can the product spell one vault root two ways?

Tested on real paths, since the helper loads no keyring. **The function can tell two spellings apart; the product does not hand it two.**

- **What is one name:** separators, letter case, a trailing separator and dot segments.
- **What is two names:** a short name and its long name, and a junction and its target. In the hosted shape `MX37CC~1` and `mx-cc-winfix3` are two names, and the suite
  sees that real alias (drill V1). The old comment said "Windows spellings compare equal". That overstated it, and it now says which do.
- **Who hands it a path:** every client takes `agentDataFolder`: the VS Code panel, the runtime (and through it `vault exec`), and the broker gets that string in its launch
  payload. Nothing in the product writes `LOCALAPPDATA` or resolves the folder. The fallback when `LOCALAPPDATA` is unset names the same folder for a profile in its usual place (`os.homedir()`'s
  `AppData\Local`), and the suite pins that. So one environment gives one spelling.
- **What is left:** something outside the product setting `LOCALAPPDATA` to an alias for one launch. Read from the code, not run: that launch finds no anchor under the other
  name, `load()` refuses with `rollback`, setup refuses over existing files, and the reset refuses a vault with no anchored id and no stuck writer. The next ordinary launch reads
  the vault again. I found no launcher that does this, and cannot rule one out from here.

**So no product change, by decision.** Resolving links or short names in the hash would rename the anchor and audit records of every existing vault whose folder is reached through a
link or a moved profile, and those vaults would then refuse to open. That trades a real harm for a hypothetical one. It would need a migration with the old name as a fallback, which nothing on
this PC could prove. A bare `realpath` also throws on a root that does not exist yet (`ENOENT`, drill V1), which is every first setup.
If two spellings should ever be one root, that is a lane of its own with that migration. `vaultStoreScopeAccountNames.test.ts` pins today's behaviour, and the comment on `canonicalVaultRoot`
says why.

**No CHANGELOG line:** no person can see any of this. The product change is two comments.

## 4. What the case does now

`checkOsStoreSlot` says what each kind of slot leaves. The Keychain and Secret Service branch is the old check, unchanged, so the green macOS leg is not disturbed.
A `windowsDpapi` slot now has to show what the design claims:

- its reference is its own id;
- `wrappedKey` parses with the product's `windowsVaultContainerSchema`, and its identity is this slot, this vault, `osStore`;
- the store holds nothing under the bare id, the scoped reference or the pre-scoping reference.

It returns no reference, so disposal has none to check.

The new suite is `test/unit/vaultStoreScopeAccountNames.test.ts`. By vitest's own hash it lands in shard 3 and no other file changes shard (computed from this tree). It takes milliseconds, and
shard 3's 4 minutes to spare stand.

## 5. What this run proved of the last two lanes

- **`prepare()` and the shared flow, on macOS.** macOS shard 16 passed, and its log says `vaultStoreScope.test.ts (5 tests | 1 skipped)`; the one skipped is the Windows case. So the POSIX
  case ran whole on the real keychain: the refused use, the checkpoint, the migration through `prepare()` and the removal. CC-WINFIX4's product fix has its first proof there. That job's log
  is not in the lead's folder, so I read it from the hosted run (`gh run view`, read only). The log cannot say whether that vault had an OS-store slot, so the Keychain branch may not have run.
- **On Windows,** the case passed the anchor, the checkpoint and `no pre-scoping checkpoint`.
- **The fixture's disposal, on Windows, with the staged keyring.** The failure path disposed it, and the report is the assertion's own: a teardown that threw would have replaced it. So the junction's removal and
  `removeVaultStoreRecords` ran on hosted Windows.

Read for the next stop, so a run is not spent on it: reading a missing account with `getSecret` already runs in every Windows fixture's disposal, on the slot's bare id, and those suites passed.
`deletePassword` on a missing account already ran in this case's first audited use.

## 6. Drills

Each line broken on purpose, in the hosted shape, restored byte-exact (the tool compared hashes), run again. Every red exited 1 and every green 0. All on the pure suite; **the
`vaultStoreScope` change has no drill here**, by the rule above.

| Drill                                                              | File              | Red                                                                                      | Green        |
| ------------------------------------------------------------------ | ----------------- | ---------------------------------------------------------------------------------------- | ------------ |
| V1: the name resolves links and short names (`realpath.native`)    | `vaultStoreScope` | 4 failed: `ENOENT` on a root not there yet, and the junction and short-name cases' words | 4 passed (4) |
| V2: the name stops folding letter case                             | `vaultStoreScope` | 2 failed, 2 passed: the spelling and route cases                                         | 4 passed (4) |
| V3: the home-folder route finds another folder than `LOCALAPPDATA` | `dataFolder`      | 1 failed, 3 passed: the route case                                                       | 4 passed (4) |

The commit hook then made one line of the suite's literal (`'/'` for `path.posix.sep`, a lint rule); section 7's run is after that.

## 7. Gates

Node 22.23.4, on `68eded6551` (this record's commit adds only this document):

| Gate                                                                                                   | Exit   |
| ------------------------------------------------------------------------------------------------------ | ------ |
| `npm run format:check`                                                                                 | 0      |
| `npm run lint`                                                                                         | 0      |
| `npm run typecheck`                                                                                    | 0      |
| `npm run check:catches`, `check:plan`, `check:l10n`, `check:reference`, `check:mhp`, `check:roadmap`   | 0 each |
| `npm run deadcode`, `cycles`, `duplication`                                                            | 0 each |
| `npm run check:host-api`                                                                               | 0      |
| `npm run build`                                                                                        | 0      |
| **The one suite this lane touched that this PC may run** (`vaultStoreScopeAccountNames`, hosted shape) | **0**  |

That suite: **1 file, 4 passed.**

Not run: the whole unit suite, the vault and credential-store suites (so the changed `vaultStoreScope.test.ts` has been typechecked and linted and has not run on any machine), the packed
product's real-life run (it spends money, and the brief makes no provider request) and hosted CI.

## 8. Only hosted CI can decide

- **The `windowsDpapi` branch on a real record.** That `wrappedKey` parses with the product's schema and names this vault, and that the store holds nothing under the three names.
- **The rest of the case on Windows, from `shared anchor untouched` on.** The relocation to the pre-scoping account, `prepare()` through Credential Manager, `session.audit()` and the removal check. macOS has passed the same logic, not the
  Windows store under it.
- **The new suite under `RUNNER~1`.** It has seen a real short name here only through the hosted shape's `MX37CC~1`.

**Not settled:** whether any launcher hands `LOCALAPPDATA` through an alias, and whether macOS's vault had an OS-store slot.
