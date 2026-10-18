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
