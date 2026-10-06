# M108 H — Runtime, ACP, headless, companion

Kubuntu, `/home/randy/lanes/M108H`, branch `m108/h`, base `291fc547a`.
Read the rig brief, shared `codex/common.md`, AGENTS, PLAN D88/M108,
account-terms research and prerequisite account/policy/pool certifications.
The rig brief overrides the older merge, remote-run and timeout directions.
No credential-store read, network, live/paid model call, dependency install,
push, merge, rebase or change outside this worktree.

## Delivered scope

The terminal parser supports `providers accounts list|add|remove|order|thresholds`
and `auth set --provider <id> --account <id>`. The command implementation
uses K's real account store through its injected metadata/vault ports. Secrets
enter only through the hidden standard-input reader; errors use fixed text.
Explicit Meta `default` without a multi-account binding preserves the original
key flow. Adding accounts does not modify that credential. The commands
refuse unsupported authentication and unknown accounts; account removal
continues through K's revoke/delete operation. Metadata, labels, limit groups,
order and threshold JSON contain no credential field.

ACP uses `/accounts` (list by default), `/accounts current`,
`/accounts thresholds [id]` and `/accounts use <id>`. The `account` session
option uses the same service. These local commands produce no model turn.
Selection effects serialize, carry a session-generation fence, and refuse
adoption after release. A newer committed swap cannot be replaced by an
older selection result. Initial notices survive a held initial state read.
Changes during a model turn are refused. Validated swaps publish the account,
reason and exact cold-cache estimate; stop notices name the reset and public
usage page. Provider errors and invalid service URLs never reach output.

Headless `--account` and `--account-pool` reach an injected runtime factory
with the existing bounded transport and the original run ledger. Its
request adapter retains exact nano-USD estimates and parent budget identity,
forces noninteractive policy admission, and never manufactures confirmation.
CI stdin credentials stay on `default`, cannot pool, and are rejected before
key reads at both CLI and programmatic boundaries. Uncaptured Muse Code
multi-account requests remain unavailable. A factory that advertises another
account is refused before a model turn. Account notices use ACP's existing
`_meta` extension point and exec v1's existing extensible `update` event,
with a strict account-event parse before forwarding; the result/schema
contract does not change.

The companion adapter dispatches through the shared panel's injected port.
It validates both directions, rejects credential and machine-authority fields,
and reports fixed error codes. It supplies no separate UI or authentication
route. Five English strings have real translations in all 14 UI tables.
There are no new settings or manifest strings; package.nls files stay intact.

## Named integration handoffs

| Binding       | Owner          | Required composition                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| ------------- | -------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| H-W-PROFILE   | W / M109 / M95 | Supply `RuntimeAccountsServices` to main from the single profile-owned account service. Bind K's providers metadata and vault without inventing a providers-file envelope. The default entrypoint has no such service on this base and refuses additional-account commands before reading a secret. K's cross-process broker fences and captured sign-in revoker remain prerequisites.                                                                                                                                                                                                                                                                                                 |
| H-P-SESSION   | P / W          | Bind `AccountsSessionPort` to the selected provider and backend session. `use` must check `canCommit` immediately before the synchronous owner transaction, update the next request's selected account, invalidate old replay/cache ownership, and retain the original budget owner. Manual selection must override the pool's older sticky assignment through the owner. Read/subscribe and event publication share that authority; events are committed by P's required atomic `commit(event, adopt)` port.                                                                                                                                                                          |
| H-M95-EXEC    | M95 / P / W    | Bind `ExecAccountsPort.create` to the registry's account-specific runtime using the supplied bounded fetch for every physical attempt, retry and paid call. Call `execAccountRequest` and P admission before each send, preserve the run ledger and shared daily/conversation caps, bind paid consent per account, and retain liability with its producer. The existing ledger/egress/catalogue is Meta-specific on this base: M95 must supply its captured provider codecs, model prices and egress admission without bypassing the bounded transport for another vendor. Installed multi-account dispatch stays unavailable until this binding and the profile broker are certified. |
| H-U-COMPANION | U / M104 / W   | Bind `AccountsPanelPort` to U's existing Models & Agents panel dispatcher. M104 still owns authenticated origin/permission/envelope checks and subscription lifecycle; the page receives no credentials or machine confirmation authority. The native bridges share the same panel, not another account implementation.                                                                                                                                                                                                                                                                                                                                                                |
| H-W-DOCS-HELP | W              | Add the CLI/ACP/exec entries below to README, docs/acp.md, docs/ci.md, security/privacy docs and the reference catalogue when it lands. `featureCatalog.ts` and `gen-reference.mjs` are absent on this base. No W-owned documentation or build/record file is edited here.                                                                                                                                                                                                                                                                                                                                                                                                             |

All editors use these shared core/runtime/panel ports: VS Code family,
JetBrains, Visual Studio, Eclipse and the companion through U/M104; Zed,
Xcode, Neovim, Emacs and Sublime through ACP; terminals and CI through the
runtime. This receipt certifies fake compositions and shared logic, not
installed bridges, the missing registry/journal/broker, live captures or
hosted CI support. Q-M108 remains capture-gated. Nothing raises a budget.

W's README/help examples (run through fake compositions, never the owner's
credential store):

```text
muse-spark-code-acp providers accounts list --provider meta
muse-spark-code-acp providers accounts add --provider meta --account work --label Work --limit-group org
muse-spark-code-acp providers accounts order --provider meta work default
muse-spark-code-acp providers accounts thresholds --provider meta --account work --thresholds '{"spendUsd":{"day":0.3}}'
muse-spark-code-acp auth set --provider meta --account work
muse-spark-code-acp providers accounts remove --provider meta --account work
/accounts list
/accounts current
/accounts thresholds work
/accounts use work
muse-spark-code-acp exec --backend modelApi --account work --account-pool --max-budget-usd 1 task
```

`auth set` reads stdin only. `--key-stdin` cannot select another account or
use `--account-pool`. Terminal order is positional account IDs; thresholds
replace that account's entire threshold object. Provider IDs identify the
configured provider instance, not another provider's credentials.

W's changelog item: terminal account management and stdin-only per-account
credentials; ACP account selection, local commands and swap/stop notices;
headless account flags with CI single-account enforcement; the companion
uses the shared panel. Runtime dispatch needs the named profile/registry
bindings above before it is offered as installed support.

## Verification and guard drills

Every test invocation runs directly here, at most three complete files,
`--maxWorkers=3`, with the repository's default timeout. No test-name filter,
raised timeout, skipped new test, rule suppression, cast escape, weakened
threshold or mock production implementation is used. The full quality,
coverage, installed-editor/a11y and live gates stay with W/the lead under
the explicit bounded-rig rules. The required host API record regeneration,
if reported below, also stays with W.

All 58 final mutations produced exit 1 and the named assertion failures below.
Each source was restored byte-for-byte in `finally`; SHA-256 was checked
after each drill and again against the final sources. Two preliminary green
mutations exposed weak tests: invalid Meta keys still reached K's validator,
and an immediate queue assertion missed the second selection's microtask.
The tests now assert no storage call and wait one microtask respectively;
the repeated mutations fired. No green mutation counts as a receipt.

| Source                                     | Restored SHA-256                                                   |
| ------------------------------------------ | ------------------------------------------------------------------ |
| `src/acp/accounts.ts`                      | `a5508142c984dd5777092775f7041db13b3834aebc127de7e2c6a1964ae54b4d` |
| `src/acp/agent.ts`                         | `a1378c8f421389640cd28185592e9bc35eee9afdbfa18f9ae8d6df032c3079da` |
| `src/runtime/cliArgs.ts`                   | `e5cc5932d82aeea79cbb9a6eb65a9aa545cd553b87e89817162c99a75a00f448` |
| `src/runtime/exec/execAccounts.ts`         | `2870eb72dcd87030a10473fe51e9a91e5cde717c46070636a1da6b671c49ac62` |
| `src/runtime/exec/execArgs.ts`             | `4f9cae3ff27de05ebbf63e6aa84aaf0188597dbfc36bc6075beb6d32195f3ffd` |
| `src/runtime/exec/execClient.ts`           | `9331afe22626d247ecd0c3d1ecc870a5dae3c08913bad8eb5447b6380deea2fa` |
| `src/runtime/exec/runExec.ts`              | `9f450da2f2efe709b615ad26fd5a4b2d7b3bf324a5357d45bfbe4d09569fdbda` |
| `src/runtime/main.ts`                      | `747d055191adf0916b28d1ad1ec1ba770d2fa3ac0f93d683523a47b2b8f284c2` |
| `src/runtime/providers/accountsCommand.ts` | `46c3eac64a270e9744247dab8c0bb42d988cd9fcc4443fc41da9e2ea5ba6aabc` |

| Drill                          | Named failing test (complete file run)                                                                                                                                                                                                                   |
| ------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| cli-provider-id                | test/unit/accountsCommand.test.ts > M108 terminal account commands > rejects malformed CLI metadata without reflecting arguments: {"args":["list"]}                                                                                                      |
| cli-action-options             | test/unit/accountsCommand.test.ts > M108 terminal account commands > rejects malformed CLI metadata without reflecting arguments: {"args":["list","--provider","meta","--account","work"]}                                                               |
| cli-order-ids                  | test/unit/accountsCommand.test.ts > M108 terminal account commands > rejects malformed CLI metadata without reflecting arguments: {"args":["order","--provider","meta","default","../bad"]}                                                              |
| cli-extra-positionals          | test/unit/accountsCommand.test.ts > M108 terminal account commands > rejects malformed CLI metadata without reflecting arguments: {"args":["list","extra","--provider","meta"]}                                                                          |
| cli-threshold-schema           | test/unit/accountsCommand.test.ts > M108 terminal account commands > rejects malformed CLI metadata without reflecting arguments: {"args":["thresholds","--provider","meta","--account","work","--thresholds","{\"secret\":\"account-secret-canary\"}"]} |
| cli-account-schema             | test/unit/accountsCommand.test.ts > M108 terminal account commands > rejects malformed CLI metadata without reflecting arguments: {"args":["add","--provider","meta","--account","work"]}                                                                |
| cli-add-order                  | test/unit/accountsCommand.test.ts > M108 terminal account commands > parses and executes list, add, remove, order and thresholds with no credential output                                                                                               |
| cli-fixed-failures             | test/unit/accountsCommand.test.ts > M108 terminal account commands > reports storage failures with fixed text and never reflects a secret in an exception                                                                                                |
| stdin-auth-kind                | test/unit/accountsCommand.test.ts > M108 terminal account commands > supports API-key providers and refuses subscription auth, unknown accounts and invalid Meta keys                                                                                    |
| stdin-membership               | test/unit/accountsCommand.test.ts > M108 terminal account commands > supports API-key providers and refuses subscription auth, unknown accounts and invalid Meta keys                                                                                    |
| stdin-trim                     | test/unit/accountsCommand.test.ts > M108 terminal account commands > reads a second Meta key only from hidden stdin and preserves the existing default                                                                                                   |
| stdin-meta-key-shape           | test/unit/accountsCommand.test.ts > M108 terminal account commands > supports API-key providers and refuses subscription auth, unknown accounts and invalid Meta keys                                                                                    |
| auth-argument-redaction        | test/unit/accountsCommand.test.ts > M108 terminal account commands > refuses argument, file and environment secret routes: {"args":["auth","set","--account-secret-canary"]}                                                                             |
| auth-unknown-positionals       | test/unit/accountsCommand.test.ts > M108 terminal account commands > refuses argument, file and environment secret routes: {"args":["auth","set","account-secret-canary"]}                                                                               |
| auth-target-scope              | test/unit/accountsCommand.test.ts > M108 terminal account commands > refuses argument, file and environment secret routes: {"args":["auth","status","--provider","meta","--account","work"]}                                                             |
| acp-state-schema               | test/unit/acpAccounts.test.ts > M108 ACP accounts > rejects credential fields at the session boundary and ignores foreign or malformed notices                                                                                                           |
| acp-session-fence              | test/unit/acpAccounts.test.ts > M108 ACP accounts > discards a held read and held selection after disposal, including its adoption fence                                                                                                                 |
| acp-serialization              | test/unit/acpAccounts.test.ts > M108 ACP accounts > serializes overlapping selections and recovers after a service failure                                                                                                                               |
| acp-notice-schema              | test/unit/acpAccounts.test.ts > M108 ACP accounts > rejects credential fields at the session boundary and ignores foreign or malformed notices                                                                                                           |
| acp-notice-provider            | test/unit/acpAccounts.test.ts > M108 ACP accounts > rejects credential fields at the session boundary and ignores foreign or malformed notices                                                                                                           |
| acp-notice-account             | test/unit/acpAccounts.test.ts > M108 ACP accounts > rejects credential fields at the session boundary and ignores foreign or malformed notices                                                                                                           |
| acp-notice-previous            | test/unit/acpAccounts.test.ts > M108 ACP accounts > rejects credential fields at the session boundary and ignores foreign or malformed notices                                                                                                           |
| acp-initial-notices            | test/unit/acpAccounts.test.ts > M108 ACP accounts > keeps notices received during the initial read and discards a selection result older than a committed swap                                                                                           |
| acp-stale-selection            | test/unit/acpAccounts.test.ts > M108 ACP accounts > keeps notices received during the initial read and discards a selection result older than a committed swap                                                                                           |
| acp-result-identity            | test/unit/acpAccounts.test.ts > M108 ACP accounts > rejects uninitialized, disposed and null selections and service results for another provider or account                                                                                              |
| acp-command-state              | test/unit/acpAccounts.test.ts > M108 ACP accounts > rejects uninitialized, disposed and null selections and service results for another provider or account                                                                                              |
| acp-usage-url                  | test/unit/acpAccounts.test.ts > M108 ACP accounts > uses fixed errors for service read/subscription failures and rejects credentials in public usage URLs                                                                                                |
| acp-fixed-service-failures     | test/unit/acpAccounts.test.ts > M108 ACP accounts > uses fixed errors for service read/subscription failures and rejects credentials in public usage URLs                                                                                                |
| companion-request-schema       | test/unit/acpAccounts.test.ts > M108 companion through the shared panel > uses the panel dispatcher for metadata and local confirmation, with no secret route                                                                                            |
| companion-reply-schema         | test/unit/acpAccounts.test.ts > M108 companion through the shared panel > uses the panel dispatcher for metadata and local confirmation, with no secret route                                                                                            |
| companion-subscription-schema  | test/unit/acpAccounts.test.ts > M108 companion through the shared panel > uses the panel dispatcher for metadata and local confirmation, with no secret route                                                                                            |
| companion-fixed-failure        | test/unit/acpAccounts.test.ts > M108 companion through the shared panel > uses the panel dispatcher for metadata and local confirmation, with no secret route                                                                                            |
| acp-busy-selection             | test/unit/acpAccounts.test.ts > M108 ACP accounts > refuses account changes during a running turn and invalidates a held selection on close                                                                                                              |
| acp-mixed-command              | test/unit/acpAccounts.test.ts > M108 ACP accounts > rejects malformed selections and mixed-content commands before any model dispatch                                                                                                                    |
| acp-local-command              | test/unit/acpAccounts.test.ts > M108 ACP accounts > serves /accounts and its session option through the real ACP router without a model turn                                                                                                             |
| exec-program-account-id        | test/unit/execAccounts.test.ts > M108 headless account admission > rejects invalid account identifiers in interactive-free CLI and programmatic requests                                                                                                 |
| exec-cli-account-id            | test/unit/execAccounts.test.ts > M108 headless account admission > rejects invalid account identifiers in interactive-free CLI and programmatic requests                                                                                                 |
| exec-muse-cli                  | test/unit/execAccounts.test.ts > M108 headless account admission > rejects stdin pooling at parser and programmatic boundaries, before any provider request                                                                                              |
| exec-muse-runtime              | test/unit/execRun.test.ts > M108 account runtime composition > refuses uncaptured Muse Code account factories at the programmatic boundary                                                                                                               |
| exec-stdin-isolation           | test/unit/execAccounts.test.ts > M108 headless account admission > rejects stdin pooling at parser and programmatic boundaries, before any provider request                                                                                              |
| exec-pool-flag                 | test/unit/execAccounts.test.ts > M108 headless account admission > parses --account and --account-pool without changing default single-account options                                                                                                   |
| exec-never-interactive         | test/unit/execAccounts.test.ts > M108 headless account admission > requires the pool flag to swap at a user cap and keeps the selected account sticky                                                                                                    |
| exec-original-budget-owner     | test/unit/execAccounts.test.ts > M108 headless account admission > retains exact estimates, shared parent budgets and uncertain liability across swaps                                                                                                   |
| exec-cli-stdin                 | test/unit/execAccounts.test.ts > M108 headless account admission > CI stdin credentials cannot select or pool account "work"                                                                                                                             |
| exec-runtime-binding           | test/unit/execRun.test.ts > M108 account runtime composition > refuses an unbound account before reading keys or dispatching any request                                                                                                                 |
| exec-chosen-account            | test/unit/execRun.test.ts > M108 account runtime composition > refuses a runtime that advertises another account before starting a turn                                                                                                                  |
| exec-notice-schema             | test/unit/execRun.test.ts > M80 real runtime → ACP → manager → client → tools > A17/A20 client preserves future non-tool updates and suppresses every tool/chunk before sink                                                                             |
| acp-selection-membership       | test/unit/acpAccounts.test.ts > M108 ACP accounts > rejects malformed selections and mixed-content commands before any model dispatch                                                                                                                    |
| acp-adoption-fence             | test/unit/acpAccounts.test.ts > M108 ACP accounts > refuses account changes during a running turn and invalidates a held selection on close                                                                                                              |
| acp-disposed-option            | test/unit/acpAccounts.test.ts > M108 ACP accounts > serializes overlapping selections and recovers after a service failure                                                                                                                               |
| acp-current-required           | test/unit/acpAccounts.test.ts > M108 ACP accounts > rejects uninitialized, disposed and null selections and service results for another provider or account                                                                                              |
| acp-extra-command-args         | test/unit/acpAccounts.test.ts > M108 ACP accounts > rejects malformed selections and mixed-content commands before any model dispatch                                                                                                                    |
| acp-threshold-membership       | test/unit/acpAccounts.test.ts > M108 ACP accounts > rejects malformed selections and mixed-content commands before any model dispatch                                                                                                                    |
| acp-swap-silence               | test/unit/acpAccounts.test.ts > M108 ACP accounts > announces a validated swap with account labels, reason and exact cold-cache cost                                                                                                                     |
| companion-subscription-failure | test/unit/acpAccounts.test.ts > M108 companion through the shared panel > uses the panel dispatcher for metadata and local confirmation, with no secret route                                                                                            |
| exec-exact-estimate            | test/unit/execAccounts.test.ts > M108 headless account admission > retains exact estimates, shared parent budgets and uncertain liability across swaps                                                                                                   |
| stdin-provider-prompt          | test/unit/accountsCommand.test.ts > M108 terminal account commands > supports API-key providers and refuses subscription auth, unknown accounts and invalid Meta keys                                                                                    |
| cli-installed-language         | test/unit/execRun.test.ts > M108 account runtime composition > renders new CLI usage errors in the installed language before any credential access                                                                                                       |

Initial completed verification on Kubuntu (default Vitest timeout):

- `npx vitest run test/unit/accountsCommand.test.ts test/unit/acpAccounts.test.ts test/unit/execAccounts.test.ts --maxWorkers=3`: 48/48 passed.
- `npx vitest run test/unit/execRun.test.ts --maxWorkers=3`: 60/60 passed, including the built German CLI and bounded runtime composition.
- `npm run typecheck`: all five projects passed.
- Changed-file Prettier check: passed.

The final local gate and regression receipts follow in the completion commit.
