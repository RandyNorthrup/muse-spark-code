# M108 U — Panel and VS Code

Bounded lane on macmini, branch `m108/u`, from `291fc547a`. Read the rig
brief, shared Codex rules, AGENTS.md, D88/M108, the terms research and the
lane-0 policy certification. No wire shapes, credential files, network calls,
paid/model calls or new dependencies are involved.

## Host and local display contract checkpoint

`modelsPanel.ts` supplies the strict account projection. It includes only
account metadata, supported window identifiers, policy evidence and local
confirmation status. URLs require HTTPS without embedded credentials; the
current account must belong to the pool.

`AccountsPanelHandler` runs add/update/order/threshold/remove through K's
real AccountStore. Credential entry is a required host-only password/OAuth
port, bound to provider and account; cancellation/failure must reject. Account
selection is a required P request-boundary admission port, with membership,
not-offered/editor-owned and uncaptured Muse Code guards. Revocation goes
through P's shared machine-local confirmation owner. Unknown errors become
fixed codes, with no adapter text crossing the bridge.

`AccountPolicyPrompt` displays the bundled clause, source/page/check dates
and resolves only a matching, host-issued question. It validates replies,
snapshots the row, checks its current content, denies overlap and resolves
disposal as Cancel. It never writes a confirmation on a page's authority;
P's AccountConfirmations owns persistence, generations and final grants.

The host suite passes **10 tests**. Its sixteen deliberate guard mutations
all ran that complete suite at the repository default timeout, exited 1 with
named assertions, and restored source bytes in finally with matching SHA-256.

| Guard                | Named failure                                                                                                                                           | Source                                   | Original/restored SHA-256                                          |
| -------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------- | ------------------------------------------------------------------ |
| slice-strict         | test/unit/accountsPanelHost.test.ts > M108 panel host > validates every display boundary including URLs and current account                             | `src/shared/modelsPanel.ts`              | `a0a3a6306ebf427671f5d676b1b5e7f99cc43f79b6e49c16a017924323dff262` |
| slice-member         | test/unit/accountsPanelHost.test.ts > M108 panel host > validates every display boundary including URLs and current account                             | `src/shared/modelsPanel.ts`              | `a0a3a6306ebf427671f5d676b1b5e7f99cc43f79b6e49c16a017924323dff262` |
| slice-url            | test/unit/accountsPanelHost.test.ts > M108 panel host > validates every display boundary including URLs and current account                             | `src/shared/modelsPanel.ts`              | `a0a3a6306ebf427671f5d676b1b5e7f99cc43f79b6e49c16a017924323dff262` |
| host-request         | test/unit/accountsPanelHost.test.ts > M108 panel host > rejects secret-bearing or forged bridge requests before any mutation                            | `src/host/models/accountsHandler.ts`     | `20505eefe0fa3c95402efa7e934a7dcc4ab6b8984ad58fa90ec2eb7722bd9ad9` |
| host-membership      | test/unit/accountsPanelHost.test.ts > M108 panel host > selects only a member through the boundary admission port                                       | `src/host/models/accountsHandler.ts`     | `20505eefe0fa3c95402efa7e934a7dcc4ab6b8984ad58fa90ec2eb7722bd9ad9` |
| host-capture         | test/unit/accountsPanelHost.test.ts > M108 panel host > refuses unavailable credential selection for muse-code                                          | `src/host/models/accountsHandler.ts`     | `20505eefe0fa3c95402efa7e934a7dcc4ab6b8984ad58fa90ec2eb7722bd9ad9` |
| host-eligibility     | test/unit/accountsPanelHost.test.ts > M108 panel host > refuses unavailable credential selection for claude-plan                                        | `src/host/models/accountsHandler.ts`     | `20505eefe0fa3c95402efa7e934a7dcc4ab6b8984ad58fa90ec2eb7722bd9ad9` |
| host-issued-question | test/unit/accountsPanelHost.test.ts > M108 panel host > rejects secret-bearing or forged bridge requests before any mutation                            | `src/host/models/accountsHandler.ts`     | `20505eefe0fa3c95402efa7e934a7dcc4ab6b8984ad58fa90ec2eb7722bd9ad9` |
| host-revoke-product  | test/unit/accountsPanelHost.test.ts > M108 panel host > rejects secret-bearing or forged bridge requests before any mutation                            | `src/host/models/accountsHandler.ts`     | `20505eefe0fa3c95402efa7e934a7dcc4ab6b8984ad58fa90ec2eb7722bd9ad9` |
| host-error-scrub     | test/unit/accountsPanelHost.test.ts > M108 panel host > selects only a member through the boundary admission port                                       | `src/host/models/accountsHandler.ts`     | `20505eefe0fa3c95402efa7e934a7dcc4ab6b8984ad58fa90ec2eb7722bd9ad9` |
| prompt-schema        | test/unit/accountsPanelHost.test.ts > M108 host-issued policy dialog > quotes the actual row and only accepts the matching pending provider and product | `src/host/models/accountPolicyPrompt.ts` | `2df0fd166316ed13eee13acf329d7d2ffae8349da1e5b7ea8254fd0370f11ab5` |
| prompt-provider      | test/unit/accountsPanelHost.test.ts > M108 host-issued policy dialog > quotes the actual row and only accepts the matching pending provider and product | `src/host/models/accountPolicyPrompt.ts` | `2df0fd166316ed13eee13acf329d7d2ffae8349da1e5b7ea8254fd0370f11ab5` |
| prompt-product       | test/unit/accountsPanelHost.test.ts > M108 host-issued policy dialog > quotes the actual row and only accepts the matching pending provider and product | `src/host/models/accountPolicyPrompt.ts` | `2df0fd166316ed13eee13acf329d7d2ffae8349da1e5b7ea8254fd0370f11ab5` |
| prompt-current-row   | test/unit/accountsPanelHost.test.ts > M108 host-issued policy dialog > discards a changed row and cancels on disposal or overlapping questions          | `src/host/models/accountPolicyPrompt.ts` | `2df0fd166316ed13eee13acf329d7d2ffae8349da1e5b7ea8254fd0370f11ab5` |
| prompt-overlap       | test/unit/accountsPanelHost.test.ts > M108 host-issued policy dialog > discards a changed row and cancels on disposal or overlapping questions          | `src/host/models/accountPolicyPrompt.ts` | `2df0fd166316ed13eee13acf329d7d2ffae8349da1e5b7ea8254fd0370f11ab5` |
| prompt-close         | test/unit/accountsPanelHost.test.ts > M108 host-issued policy dialog > discards a changed row and cancels on disposal or overlapping questions          | `src/host/models/accountPolicyPrompt.ts` | `2df0fd166316ed13eee13acf329d7d2ffae8349da1e5b7ea8254fd0370f11ab5` |

## Integration bindings (required, owned by the named lanes)

This base lacks M95's registry and Models & Agents panel, M102's real
journal and M104's authenticated editor bridge. No production fake or
activation import substitutes for them.

- **M108-U-M95-MODELS:** mount AccountsSection with an authenticated
  AccountsSectionPort, refresh the provider slice after mutations and
  selection/events, and import accountsEntry only on first panel or
  multi-account use. Resolve labels locally; expose only captured window
  capabilities and the vendor's verified usage URL.
- **M108-U-P-BOUNDARY:** bind handler.use to P's request-boundary admission
  and atomic account/event transaction; never merely assign a UI field.
  Feed committed swap/stop events to AccountNotices and the active account
  to AccountChip. Keep the existing shared budgets, cold-cache reservation
  and per-account first-charge paid consent in P.
- **M108-U-M104-PROMPT:** supply authenticated, permission-checked request
  envelopes and reply/question correlation. Bind P's ask to
  AccountPolicyPrompt and serialize all surface modals; close it on
  disposal/revocation. A confirmation question belongs to its host-issued
  request, never an unsolicited page choice. Use the same shared React
  components on VS Code, native bridges and companion surfaces.
- **M108-U-W-BUNDLE:** W owns build entries, dedicated size/split records
  and the installed loader. Existing caps must remain unchanged.
- **M108-U-W-HELP-DOCS:** featureCatalog.ts is absent on this base. Add help
  entries for Accounts, add/edit/remove/order/groups, threshold editing,
  the account picker/pill, swap/stop notices, policy confirmation/revocation
  and default-on accountSwap/accountParallel settings. W owns manifest
  contributions and all package.nls translations, README, CHANGELOG,
  privacy/security/editor docs and the joined-tree full quality gate.

The brief and shared rules explicitly prohibit the full quality/unit run,
merging, pushing and rebasing. Scoped checks run directly on this rig with
hooks enabled; the lead owns full joined-tree certification. No gate is
weakened. Live Q-M108 captures and lane M's CLI homes remain with their owners.
