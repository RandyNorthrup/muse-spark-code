# Lane TRUTHACCOUNTS — account errors say their real cause

## Site table (one line per site: what the person sees now → what they will see)

- `src/acp/accountText.ts:52-61` (`accountErrorText` fallback): now "Accounts are unavailable until this runtime is connected to the shared account service." for every unrecognised error → will name the cause: `Accounts are unavailable ({reason}).`, unwrapping `{ cause }` chains first.
- `src/acp/accounts.ts:148` (`current()`, no account selected): now the connection sentence → will be "No Account Selected" (`accounts.none`).
- `src/acp/accounts.ts:210` (notice failed to format): now the connection sentence as a notice → will be "The account notice could not be shown ({reason})."
- `src/acp/accounts.ts:250, 254` (notice arrived during `/accounts use`): now the connection sentence → will be "Accounts changed while updating. Try again." (same for the sibling staleness throws at 104, 106, 164, 271, 273, 275).
- `src/acp/accounts.ts:249, 287` (`use`/`command` before the session is adopted): now the connection sentence → will be "Accounts are not ready yet. Try again."
- `src/acp/accounts.ts:76` (`parseState`, reply was not a state): now the connection sentence → will be "The account service answered with an unexpected reply."
- `src/acp/accounts.ts:67` (`companionAccountsPanel.subscribe` threw): now the connection sentence with the cause dropped → will keep the cause so the mapper names it.
- Credential-store and disk errors via `src/runtime/providers/runtimeServices.ts:125` (`read`), `src/acp/accounts.ts:161, 225, 269` (wrapped with `{ cause }`): now the wrapper's connection sentence, cause dropped by the mapper → will unwrap to `Accounts are unavailable ({reason}).`
- Terminal `providers accounts` failures via `src/runtime/providers/accountsCommand.ts:commandError`: now the connection sentence for every non-code error (disk/keyring failures) → will be `Accounts are unavailable ({reason}).`, store codes keep their own sentences.
- `src/runtime/backends.ts:648` (refused providers file): already truthful (`providersInvalid` via the brand); stays, covered by the mapper.
- `src/runtime/providers/runtimeServices.ts:44` (`runtimeRevokeSignIn`): now the connection sentence → will be "Removing this sign-in is not supported in this runtime."
- Kept as the connection sentence on purpose (runtime genuinely has no account service there): headless without account services (`src/runtime/exec/runExec.ts:556, 764`), ACP session with no accounts port (`src/acp/agent.ts:1633, 1924`), missing account-services bundle (`src/runtime/providers/accountsBundle.ts:43`), unconfigured-provider key read (`src/runtime/providers/runtimeServices.ts:285`, an auth error, not an account error). The two `usageUrl` throws (`runtimeServices.ts:115`, `accountText.ts:78`) never reach the person: `notice()` catches them into stop-text without a link.
- `src/acp/accounts.ts:210` fallback and the `own()` supersede throws are defensive (unreachable with schema-validated data / deterministic only under races): changed to the truthful sentence, proven by inspection plus the mapper tests below, not by a dedicated test.

## Proofs

- `npx vitest run test/unit/accountErrorTruth.test.ts test/unit/accountsCommand.test.ts test/unit/accounts.test.ts --maxWorkers=3` — 3 files, 59 tests, all pass on the repo's own timeout (no `--testTimeout`).
- `node scripts/check-l10n.mjs` — 0 problems (6 new keys in `en.ts` + all 14 `l10n/ui.*.json`).
- `npm run build` (incl. size budgets), `typecheck:host`, `typecheck:unit`, eslint zero warnings on changed files, `npm run check:plan` (0 drift), prettier clean.
- Real-use drills through the packed `dist/acp.js` (scratch `$HOME`, exit codes observed):
  - fresh dir, `providers accounts list --provider meta` → `[{"id":"default",...}]`, exit 0 (happy path intact);
  - garbage `providers.json` → `The providers file is invalid, so its entries were refused and the file was left unchanged.`, exit 1;
  - `providers.json` as a directory → `Accounts are unavailable (EISDIR: illegal operation on a directory, read).`, exit 1.
- ACP end-to-end inside the suite with the real `AcpAccounts` over the real runtime account services (real providers file, credential store unreachable by a throwing factory): `/accounts current` with no selection → `No Account Selected`; unknown id → invalid-account sentence; use/command before start → not-ready sentence.
- Remainder (documented, not changed): a store refusal that kept no detail (e.g. unconfigured provider, bare `unavailable` code) stays on the plain connection sentence rather than inventing a cause; the `own()` supersede and notice-format fallbacks are defensive and proven by inspection plus the mapper tests. Deliberately kept on the connection sentence (no service bound there): headless without account services, ACP session with no accounts port, missing account-services bundle.

## PR235W1 fixes (all four threads fixed at their cause, CI clone removed)

Two site-table rows above are corrected by review: at the ACP boundary only
enumerated failures map to text and unexpected causes stay behind it
(PLAN.md FIXM108H — fixed unavailable sentence, raw service text
suppressed). The terminal keeps naming a retained concrete cause.

- Thread 1 (P1, `src/acp/accountText.ts`): `accountErrorText` no longer
  copies raw messages into `unavailableReason`. Enumerated failures map
  (refused switch verbatim, `providersInvalid`, `invalidAccount`,
  `notOffered`, `revokeUnsupported`, the `none`/`changed`/`notReady`/
  `invalidReply` sentences); a store refusal with any other code and any
  raw error — directly or as a `cause`-chain tail — returns the fixed
  `accounts.unavailable` sentence. The site-table row 1 and the
  credential-store/disk row above hold for the terminal only.
- Thread 2 (P1, `test/unit/accountErrorTruth.test.ts:62`): the invented
  `EISDIR` string is gone. A real directory-as-`providers.json` failure
  (store refusal with a real disk `cause`) asserts the fixed sentence both
  directly and through the refresh wrapper, and asserts the raw OS message
  is absent. The terminal test keeps its real-I/O cause naming.
- Thread 3 (P2, `src/runtime/providers/runtimeServices.ts:44`):
  `runtimeRevokeSignIn` rejects with the branded `RevokeUnsupportedError`
  (own sentence, cross-bundle brand like the refused switch), and
  `AccountSecrets.remove` rethrows that brand instead of converting it to
  `AccountStoreError('unavailable')`. `commandError` and `accountErrorText`
  repeat its sentence. The remove boundary itself is proven by inspection:
  no unit test can drive revocation through the real OS credential store
  without a stand-in, which the rules forbid.
- Thread 4 (P2, `src/runtime/providers/accountsCommand.ts:36`):
  `commandError` returns the plain `accounts.unavailable` sentence when an
  `AccountStoreError` kept no concrete `Error` cause, instead of printing
  the code (`Accounts are unavailable (unavailable).`). A retained cause
  still names itself at the terminal.
- CI static gates: the 1 reported clone is removed at its cause — the two
  `new AcpAccounts` constructions and the two service constructions in
  `accountErrorTruth.test.ts` now share `silentAccounts`/`offlineServices`
  helpers, and the three directory-read blocks share
  `unreadableProvidersFailure`. `npx jscpd` exit 0, 0 clones. All other
  listed CI failures were marked downstream of this gate.

Proofs: `npx vitest run test/unit/accountErrorTruth.test.ts
test/unit/accountsCommand.test.ts test/unit/accounts.test.ts --maxWorkers=3`
— 3 files, 59 tests, all pass on the repo's own timeout (no
`--testTimeout`); the three new expectations were watched failing before
the source fix. `npx jscpd` exit 0. eslint zero warnings on changed files,
`node scripts/check-l10n.mjs` 0 problems, typecheck clean. Real-use
terminal drills through the packed `dist/acp.js` (isolated
`HOME`+`XDG_DATA_HOME`, exit codes observed):

- fresh dir, `providers accounts list --provider meta` →
  `[{"id":"default",...}]`, exit 0 (happy path intact);
- `providers.json` as a directory, `list --provider meta` →
  `Accounts are unavailable (EISDIR: illegal operation on a directory, read).`,
  exit 1 (the terminal still names the retained real cause; the ACP mapper
  reports the fixed sentence for the same failure, covered in-suite);
- `list --provider ghost` (unconfigured) →
  `Accounts are unavailable until this runtime is connected to the shared account service.`,
  exit 1 (no `(unavailable)` code word);
- `remove --provider oauthtest --account work` with a hand-written oauth
  envelope and no Secret Service on the rig → the fixed unavailable
  sentence, exit 1 (the keychain outage path; the revoke refusal itself is
  unreachable here without a stored oauth credential, proven in-suite with
  the real refusal object plus the real guard and both real mappers).

## PR235W1 status (lane open, one line per thread and per CI failure)

- Thread 1 (`src/acp/accountText.ts:100`, P1): CONFIRMED — the raw-message branch copies unenumerated service text into the ACP `RequestError`; fixing at the cause (enumerated failures map, everything else stays on the fixed unavailable sentence per PLAN.md FIXM108H).
- Thread 2 (`test/unit/accountErrorTruth.test.ts:62`, P1): CONFIRMED — the EISDIR string is invented input; replacing with a real-I/O-driven assertion.
- Thread 3 (`src/runtime/providers/runtimeServices.ts:44`, P2): CONFIRMED — the plain `Error` is discarded by `AccountSecrets.remove`'s catch; preserving the branded refusal across that boundary.
- Thread 4 (`src/runtime/providers/accountsCommand.ts:36`, P2): CONFIRMED — the bare-code fallback prints `Accounts are unavailable (unavailable).`; returning the plain unavailable sentence when no concrete cause was retained.
- CI static gates (all OSes): REPRODUCED locally — `npx jscpd` finds 1 clone (12 lines, 54 tokens) inside `test/unit/accountErrorTruth.test.ts:120-131` vs `:151-162`, failing the 0 threshold; every other listed CI failure is marked downstream of it. Removing the clone at its cause in the test rework.
