# M108 U — Panel and VS Code

Completed U's bounded implementation on the **macmini** rig, branch `m108/u`,
from `291fc547a`. Read the rig brief, shared Codex rules, AGENTS.md, D88/M108,
`docs/research/account-terms-2026-10-05.md`, the lane-0 policy certification
and K/T/P's contracts and certification. The base lacks M95's registry and
Models & Agents panel, M102's real journal and M104's authenticated bridge.
U supplies explicit required ports, with no production fake or substitute
activation path. Installed integration remains with the named owners below.

Model attempts: **0**. No live wire capture, external network/model/paid call,
credential file, keychain read, new dependency or tool installation. Quotes
come from lane 0's bundled, certified policy rows. All ports and fixtures
keep credential input off the shared page. No gate, cap, rule, ignore,
coverage threshold or timeout was weakened. No cast escape hatch or lint
suppression was added.

## Implemented behavior

- **Accounts section:** validates the local display boundary; add/edit labels,
  stable ids and limit groups; reorder the complete pool; delete only after
  showing the credential deletion/revocation warning. Real K AccountStore
  performs host mutations. A required host credential port is bound to the
  exact provider/account; cancellation or failure must reject. The page has
  no credential input. Provider changes rebuild the forms, even when both
  providers use the same account id, so typed metadata/caps never carry over.
  Uncaptured Muse Code operations are off on the page and host, with an
  explanation; policy reading/revocation stays available.
- **Thresholds:** every day/week/month spend, input token, output token and
  request cap; only captured, capability-supported plan windows and rate
  headroom fields. Hidden window values survive edits. Shared nano-USD helpers
  reject sub-nano or numerically unrepresentable money before the existing
  numeric contract boundary; counts must be nonnegative safe integers.
  Clearing a field clears its cap.
- **Picker and pill:** account selection carries the opaque provider/account
  to P's required request-boundary admission port. Locally resolved labels
  appear in the picker and actual composer model pill via App's injected
  slots. A one-account picker renders nothing; without injected accounts the
  existing chat is unchanged. A removed or not-yet-selected current account
  says No account selected, rather than claiming its capacity is exhausted.
  App imports no accounts implementation.
- **Transcript notices:** validate committed events; filter foreign-provider
  or malformed rows; show the old/new account, reason and exact cold-cache
  estimate, including one nano-USD. Exhausted pools show the known reset time
  or unknown-reset explanation and verified vendor usage link. Spread/usage
  presentation belongs to J.
- **Policy question:** verbatim clause, original HTTPS source, page/check
  dates, stale-row warning, multiple-account restriction, subscription
  recovery and local confirmation scope. Confirm needs the legitimacy
  checkbox; Only at my own caps and Cancel remain available. A changed row
  resets acknowledgement. The existing Modal provides focus trapping and
  Escape/close cancellation. Single-flight latches cover duplicate edits and
  answers. The host checks provider/product, the pending question and the
  current complete policy row; overlap/disposal cancels. P alone owns
  machine-local persistence and final admission authority.
- **Localization:** five new runtime-read labels (`accounts.none`, `id`, `use`,
  `earlier`, `later`) have real translations in all 14 `l10n/ui.*.json` tables.
  Existing account strings cover the remainder. U added no manifest setting
  or command; W owns those contributions and package.nls translations.

## Validation and bundle evidence

All commands ran directly on macmini, with one vitest/tsc/eslint/build at a
time. Every vitest run used the repository default timeout, no filtering,
no skips, at most three files and `--maxWorkers=3`.

| Check                                                                                                                                      | Result                                                                                                     |
| ------------------------------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------- |
| `npx vitest run test/unit/accountsPanelHost.test.ts test/unit/accountsPanel.test.tsx test/unit/accountsPanel.a11y.test.mjs --maxWorkers=3` | 66 passed: 11 host, 21 shared UI, 34 real-browser/bundle checks                                            |
| `npx vitest run test/unit/App.test.tsx test/unit/l10n.test.ts test/unit/hostL10n.test.ts --maxWorkers=3`                                   | 194 passed; existing jsdom canvas notices did not fail assertions                                          |
| `npx vitest run test/unit/l10n.test.ts test/unit/hostL10n.test.ts --maxWorkers=3`                                                          | 42 passed after the final translated label change                                                          |
| `npm run typecheck`                                                                                                                        | All five projects pass                                                                                     |
| Scoped `eslint --max-warnings=0`, `prettier --check` and `stylelint --max-warnings=0`                                                      | Pass on U's changed files                                                                                  |
| `npm run deadcode`                                                                                                                         | Pass; no unused harness/entry/exports                                                                      |
| `npx jscpd`                                                                                                                                | 1202 files, zero clones                                                                                    |
| `node scripts/check-l10n.mjs`                                                                                                              | 14 tables, 164 manifest strings, 617 source files, zero problems                                           |
| `npm run build`                                                                                                                            | Production build, size, split, host-globals and notices pass; caps unchanged                               |
| `npm run check:host-api`                                                                                                                   | Exit 1: W-owned generated record needs the two updates described below; no API or theme-variable additions |
| `git diff --check`                                                                                                                         | Pass                                                                                                       |

The browser suite builds the **real shared lazy accountsEntry** once, uses
one real Chrome instance and scans four scenes (section, thresholds, policy
dialog, swap/stop) at **320 and 690 px in all four captured VS Code themes**:
32 axe scans, zero violations **and zero incomplete findings**, no rule
exclusions, no horizontal overflow. One additional check renders installed
German labels. Non-modal scenes use their full document height at the required
width: a clipped line prevents axe from determining contrast. This retains
all findings instead of excluding them. A real initial dark-theme link
contrast failure was fixed with the existing `--vscode-textLink-foreground`.

The dedicated deferred accounts JS is **20,421 bytes (19.94 KiB) / 25 KiB**.
The graph test traverses static imports and normalizes Windows separators;
all account components remain deferred. Audit of all **37** production
metafiles found no U accounts UI/host/display modules: the installed loader
is W's prerequisite, not a guessed production implementation. Current
production sizes are activation **440.3/600 KiB**, Model API **450.1/475**,
checkpoint **76.9/225**, ACP **818.6/850**, webview startup and static imports
**897.5/900** (base 897.3), existing deferred JS **49.7/50**. Only App's optional
slots and the five English labels enter the existing startup graph. W must
register the new UI under its own 25 KiB budget without raising existing caps.

Representative real-browser dark-theme 320 px fixtures:
[section](m108-u-section.png), [thresholds](m108-u-thresholds.png),
[policy dialog](m108-u-dialog.png), [swap and stop](m108-u-swap.png).
They contain only test metadata and the certified public clause.

## Deliberate red drills

**38 drills:** each mutation ran its complete owned test file, exited 1
with a named assertion failure, and restored the source bytes in `finally`.
The source table records the full original/restored SHA-256. The final green
run follows all restorations. The pending-edit test was strengthened after
a first mutation stayed green because the native disabled fieldset blocked
the second submit: the test now deliberately reenables a stale fieldset,
then proves the independent request latch. The provider-form regression
failed before the fix, passed afterward with metadata/threshold/add drafts
reset, and failed when its key was removed.
The null-selection picker regression failed before the label fix, passed
afterward, and failed again when the wrong capacity label was restored for
a deliberate mutation. Browser budget mutation tightens the fixture's cap to zero only for the drill; no production cap is raised.

| Source | Path                                                                  | Original/restored SHA-256                                          |
| ------ | --------------------------------------------------------------------- | ------------------------------------------------------------------ |
| S1     | `src/shared/modelsPanel.ts`                                           | `9023cd07638fc28bc95cec4189b34babd70d2245e1dd0cec6ebb6dd7026851b5` |
| S2     | `src/host/models/accountsHandler.ts`                                  | `399c8f97417207046d86ad77db2cc4721926b33248b5415c3d3fac8a9294c913` |
| S3     | `src/host/models/accountPolicyPrompt.ts`                              | `980f636b3b8c8c527ab35e10bbfdb58260bfecf571b2677a4ba9c36a5ada6cc3` |
| S4     | `src/webview/models/sections/accounts/AccountsSection.tsx`            | `121bb5fcf4c925c973db0efcab157e840e6d88da7cbf9f7196cc1b8ae332c9bd` |
| S5     | `src/webview/components/AccountChip.tsx`                              | `ac43ad1fcdd4304f08714adfa49496924a7498366f5b1510621a93f30b83945f` |
| S6     | `src/webview/models/sections/accounts/AccountEditor.tsx`              | `a243be09abd337dd0a14bd8e19f59e88205ebc34c1f7c16d8ee77265eba90d57` |
| S7     | `src/webview/models/sections/accounts/ThresholdEditor.tsx`            | `ccbc57ff8af1ea7af5e68233e2c0cc240a09ce9ce742919848b5c2c41f2826bf` |
| S8     | `src/webview/models/sections/accounts/AccountNotices.tsx`             | `3526290f6bdaa8be03dec8a386e0b1fffeea685e17e8e1b182bba64d7f518ec6` |
| S9     | `src/webview/models/sections/accounts/AccountsConfirmationDialog.tsx` | `b3d8691584fd287e2c2283e9ae828a21ab006c91576caa244de0ba9ed3857879` |
| S10    | `src/webview/App.tsx`                                                 | `6079d82a205e18f45d187e7a1d3e6bb4b32400e26ce10bbd67b02f5fd812ea84` |
| S11    | `test/harness/accounts.mjs`                                           | `3bcc1d83a5ab6b5ed0a06eeb22cdcbc190ea2edc92a6f7c2ae60e75905727951` |
| S12    | `test/unit/accountsPanel.a11y.test.mjs`                               | `97a269838ebcc38be54ee1f688ac3815afbf24ef048795d5755216ded113e65d` |
| S13    | `src/webview/models/sections/accounts/accounts.css`                   | `179fd427eb34ea0452adc477f48c70e9f2c5e12454e241ce19ff00e8e4017cba` |

### Host guards

| Mutation                                                  | Source | Named failing assertion (exit 1)                                                                                                                        |
| --------------------------------------------------------- | ------ | ------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `slice-strict`: allow unknown display fields              | S1     | test/unit/accountsPanelHost.test.ts > M108 panel host > validates every display boundary including URLs and current account                             |
| `slice-member`: accept a selected nonmember               | S1     | test/unit/accountsPanelHost.test.ts > M108 panel host > validates every display boundary including URLs and current account                             |
| `slice-url`: permit insecure/credential-bearing URLs      | S1     | test/unit/accountsPanelHost.test.ts > M108 panel host > validates every display boundary including URLs and current account                             |
| `host-request`: normalize a forged secret-bearing request | S2     | test/unit/accountsPanelHost.test.ts > M108 panel host > rejects secret-bearing or forged bridge requests before any mutation                            |
| `host-membership`: remove selected-member check           | S2     | test/unit/accountsPanelHost.test.ts > M108 panel host > selects only a member through the boundary admission port                                       |
| `host-capture`: remove uncaptured Muse Code guard         | S2     | test/unit/accountsPanelHost.test.ts > M108 panel host > keeps uncaptured Muse Code metadata mutations off as well as credentials                        |
| `host-eligibility`: remove credential/product eligibility | S2     | test/unit/accountsPanelHost.test.ts > M108 panel host > refuses unavailable credential selection for claude-plan                                        |
| `host-issued-question`: accept an unissued answer         | S2     | test/unit/accountsPanelHost.test.ts > M108 panel host > rejects secret-bearing or forged bridge requests before any mutation                            |
| `host-revoke-product`: revoke another product             | S2     | test/unit/accountsPanelHost.test.ts > M108 panel host > rejects secret-bearing or forged bridge requests before any mutation                            |
| `host-error-scrub`: return raw adapter error text         | S2     | test/unit/accountsPanelHost.test.ts > M108 panel host > returns fixed errors without leaking adapter text                                               |
| `prompt-schema`: normalize a secret-bearing answer        | S3     | test/unit/accountsPanelHost.test.ts > M108 host-issued policy dialog > quotes the actual row and only accepts the matching pending provider and product |
| `prompt-provider`: ignore question provider               | S3     | test/unit/accountsPanelHost.test.ts > M108 host-issued policy dialog > quotes the actual row and only accepts the matching pending provider and product |
| `prompt-product`: ignore question product                 | S3     | test/unit/accountsPanelHost.test.ts > M108 host-issued policy dialog > quotes the actual row and only accepts the matching pending provider and product |
| `prompt-current-row`: ignore changed policy               | S3     | test/unit/accountsPanelHost.test.ts > M108 host-issued policy dialog > discards a changed row and cancels on disposal or overlapping questions          |
| `prompt-overlap`: grant overlap                           | S3     | test/unit/accountsPanelHost.test.ts > M108 host-issued policy dialog > discards a changed row and cancels on disposal or overlapping questions          |
| `prompt-close`: grant on disposal                         | S3     | test/unit/accountsPanelHost.test.ts > M108 host-issued policy dialog > discards a changed row and cancels on disposal or overlapping questions          |

### UI guards

| Mutation                                                             | Source | Named failing assertion (exit 1)                                                                                                                                             |
| -------------------------------------------------------------------- | ------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `ui-edit-provider`: retain typed fields across a provider change     | S4     | test/unit/accountsPanel.test.tsx > M108 Accounts section > resets edit fields when two providers use the same account id                                                     |
| `ui-null-selection`: describe absent selection as exhausted headroom | S5     | test/unit/accountsPanel.test.tsx > M108 picker, transcript and policy question > leaves the single-account pill unchanged and names both accounts in the picker              |
| `ui-pending-mutation`: remove edit latch                             | S4     | test/unit/accountsPanel.test.tsx > M108 Accounts section > allows one pending mutation despite stale enabled form controls                                                   |
| `ui-muse-capture`: enable uncaptured Muse Code                       | S4     | test/unit/accountsPanel.test.tsx > M108 Accounts section > refuses credential selection and addition without a captured or offered product                                   |
| `ui-current-provider`: adopt stale-provider reply                    | S4     | test/unit/accountsPanel.test.tsx > M108 Accounts section > does not adopt an old reply after the selected provider changes                                                   |
| `ui-reply-provider`: accept cross-provider reply                     | S4     | test/unit/accountsPanel.test.tsx > M108 Accounts section > rejects invalid input before sending and refuses malformed or cross-provider replies                              |
| `ui-remove-confirm`: delete before warning                           | S4     | test/unit/accountsPanel.test.tsx > M108 Accounts section > edits labels, changes pool order and confirms destructive removal                                                 |
| `ui-id-validation`: silently normalize invalid id                    | S6     | test/unit/accountsPanel.test.tsx > M108 Accounts section > rejects invalid input before sending and refuses malformed or cross-provider replies                              |
| `ui-exact-usd`: remove exact USD check                               | S7     | test/unit/accountsPanel.test.tsx > M108 threshold editor > refuses inexact or invalid USD 0.0000000001 without sending                                                       |
| `ui-hidden-window`: drop unsupported stored windows                  | S7     | test/unit/accountsPanel.test.tsx > M108 threshold editor > edits every period and supported window, preserves hidden capability values and exact money                       |
| `ui-single-account`: show single-account picker                      | S5     | test/unit/accountsPanel.test.tsx > M108 picker, transcript and policy question > leaves the single-account pill unchanged and names both accounts in the picker              |
| `ui-held-credential`: enable editor-owned credentials                | S5     | test/unit/accountsPanel.test.tsx > M108 picker, transcript and policy question > disables account switching for products whose credentials are not held                      |
| `ui-notice-provider`: show foreign-provider event                    | S8     | test/unit/accountsPanel.test.tsx > M108 picker, transcript and policy question > shows the swap reason, exact cold-cache estimate and stop reset/link without foreign events |
| `ui-silent-swap`: remove swap explanation                            | S8     | test/unit/accountsPanel.test.tsx > M108 picker, transcript and policy question > shows the swap reason, exact cold-cache estimate and stop reset/link without foreign events |
| `ui-cold-cache`: erase cold-cache cost                               | S8     | test/unit/accountsPanel.test.tsx > M108 picker, transcript and policy question > shows the swap reason, exact cold-cache estimate and stop reset/link without foreign events |
| `ui-current-question`: retain acknowledgement after clause change    | S9     | test/unit/accountsPanel.test.tsx > M108 picker, transcript and policy question > asks again when the quoted row changes and supports Only at my own caps                     |
| `ui-acknowledgement`: enable unacknowledged Confirm                  | S9     | test/unit/accountsPanel.test.tsx > M108 picker, transcript and policy question > asks again when the quoted row changes and supports Only at my own caps                     |
| `ui-pending-answer`: remove answer latch                             | S9     | test/unit/accountsPanel.test.tsx > M108 picker, transcript and policy question > keeps an in-flight confirmation from accepting a second answer                              |
| `ui-model-pill`: omit account from model pill                        | S10    | test/unit/accountsPanel.test.tsx > M108 picker, transcript and policy question > injects account pill and transcript nodes into the shared chat                              |

### Browser gates

| Mutation                                              | Source | Named failing assertion (exit 1)                                                                                                              |
| ----------------------------------------------------- | ------ | --------------------------------------------------------------------------------------------------------------------------------------------- |
| `browser-lazy`: statically import the account section | S11    | test/unit/accountsPanel.a11y.test.mjs > M108 accounts accessibility and lazy budget > loads all account UI in a dedicated chunk within 25 KiB |
| `browser-budget`: tighten deferred budget to zero     | S12    | test/unit/accountsPanel.a11y.test.mjs > M108 accounts accessibility and lazy budget > loads all account UI in a dedicated chunk within 25 KiB |
| `browser-contrast`: restore inaccessible blue links   | S13    | test/unit/accountsPanel.a11y.test.mjs > M108 accounts accessibility and lazy budget > dark section at 320px passes axe and fits the panel     |

## Required integration bindings

- **M108-U-M95-MODELS:** mount AccountsSection with the authenticated
  AccountsSectionPort; refresh the provider slice after mutations, committed
  selection/events and a completed policy decision. Load accountsEntry on
  first Models & Agents or multi-account use. Resolve labels locally; expose
  only captured selected-model/provider capabilities and verified usage URLs.
  Supply App's picker/transcript nodes and a `provider · account` label only
  for multi-account chat. Leave the single-model setup's current behavior.
- **M108-U-P-BOUNDARY:** bind handler.use to P's admission and atomic
  account/event transaction, not a UI assignment. Feed committed swap/stop
  events to AccountNotices and the active account to AccountChip. Keep the
  shared budgets, cold-cache reservation, uncertain liability and per-account
  first-charge D48 consent in P. Bind one profile AccountConfirmations owner.
- **M108-U-M104-PROMPT:** authenticate and permission-check correlated
  request/reply/question envelopes; bind P's ask to AccountPolicyPrompt and
  the shared dialog. Serialize surface modals, make the background inert,
  close on disposal/revocation, and refresh after P persists its decision.
  An answer belongs to a host-issued question, never page authority. Reuse
  this React entry and injected handlers through VS Code, JetBrains, Visual
  Studio, Eclipse and companion bridges. H owns ACP/terminal/headless surfaces;
  their policy authority remains the same P owner, with no UI-only grants.
- **M108-U-M-CAPTURE:** enable Muse Code account operations only after M's
  real CLI home/sign-in/serve capture and adapter are certified. Both U guards
  currently refuse those operations; U invents no credential file or wire.
- **M108-U-W-BUNDLE:** register the real installed lazy loader, dedicated
  25 KiB accounts UI size/split checks and ordinary harness/a11y entry. Existing
  startup/deferred caps stay unchanged. The local browser suite independently
  proves the shared entry's lazy graph and size before that binding exists.
- **M108-U-W-HOST-API:** regenerate `docs/ide-compatibility/host-api.md`:
  existing P `node:crypto` import count **46 → 47**, and append
  `src/webview/models/sections/accounts/accounts.css` to theme-token source
  files. The check still counts 332 APIs, 31 VS Code importers, 25 Node builtins
  and 61 theme variables; these totals are unchanged. U did not edit W's file.
- **M108-U-W-HELP-DOCS:** featureCatalog.ts is absent on this base. Add help
  entries for Accounts, add/edit/remove/order/groups, thresholds, account
  picker/pill, swap/stop notices, policy confirmation/revocation and the
  default-on accountSwap/accountParallel settings. W owns manifest and all
  package.nls translations, README, CHANGELOG, privacy/security/editor docs,
  PLAN status and joined-tree full quality certification. No undocumented
  installed command was introduced by U.

The rig brief overrides shared older merge/remote instructions: no merge,
push, rebase or stash. It explicitly prohibits the full quality/full unit
run; the lead owns joined-tree certification. Local commits use explicit
paths and normal hooks. `.husky/_/pre-commit` existed before the checkpoint
commit `6db887168ffa03da4a1fb6182af10c4d9d73ece8`; lint-staged's ESLint/Prettier
and staged gitleaks ran successfully. All remaining live Q-M108 receipts,
installed editor adapters and cross-lane bindings stay with their named owners.
