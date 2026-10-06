# M113 Q — scheduled reports and destinations

2026-10-06, Windows rig `win11`, worktree `C:/lanes/M113Q`, branch
`m113/q`, base `c459e96b9`. Authority: `C:/lanes/_ctx/M113Q.rig.md`,
`C:/lanes/_ctx/codex/common.md`, AGENTS.md, PLAN D93 and M113 (including
lane ownership and ordering), and D95's report action and creator authority.
Read the frozen contracts, lane R certification, M71's capture record,
M84's export/scrub certification, M93's research, and the credential-vault
research. No credential read, network request, paid/model call, installation,
merge, rebase, push, gate weakening or hook bypass.

This implements lane Q against the contracts already present on its base.
M115, M109, M110 and N/V/X/W are separate integration dependencies. Required
injected ports have no production fake or empty-success fallback. This record
does not claim those absent services or the complete M113 product are wired.

## Implementation

- `destinations/types.ts`: strict application schemas for report actions,
  save/browser/email/post destinations, opaque SMTP/Gmail/Outlook vault
  connections, selected GitHub targets and delivery receipts. M115 owns the
  scheduler, trigger, stacking, missed-fire policy and claims. This action
  uses none of the prompt/paid backends.
- `runner.ts`: validates the action, checks the trusted revocable grant,
  sets `asOf` to the scheduled occurrence, intersects source-network permission,
  verifies and renders the document, then persists its frozen payload before
  delivery. A retry uses that document without recollecting changing sources.
  Action identity changes refuse reuse. Each destination is recorded separately.
  Completed, failed and uncertain deliveries are terminal; the browser's deferred
  state can resume. Uncertainty is written before dispatch, so a process crash
  cannot silently send the same email/comment again. Only a parsed, known
  pre-dispatch failure is retried, at most three attempts, with authority checked
  again after each wait. Raw transport errors never enter results or logs.
- `save.ts`: UTC name tokens `{kind}`, `{scope}`, `{date}`, `{time}`, `{hash8}`
  and `{ext}`, with the specified default and retention. It rejects traversal,
  separators, unknown tokens and Windows reserved file names. Canonical roots
  are those captured on consent; links/junctions are resolved before confinement.
  Atomic conditional writes keep the approved canonical path and refuse foreign
  files without reading their contents. Hard-linked manifest/artifact data refuses
  before reading. Per-schedule manifests retain newest occurrences by timestamp,
  with a code-unit filename tie break;
  pruning conditionally removes only listed files with their original bytes,
  leaving manual replacements and other schedules alone. The node binding runs
  the same saver on its own volume under its own root lease.
- `browser.ts`: requires an active session before publication and immediately
  before opening. Inactive delivery waits for **Open when I'm back**. Local
  resources are absolute file URLs; node resources require HTTPS, no URL
  credentials, and the node's authenticated-route check. Public URLs refuse.
- `email.ts`: user-maintained address permission plus six-digit verification,
  salted code digests, a fifteen-minute expiry, five attempts, and one-use codes.
  First-send consent previews the exact outgoing redacted message and is stored
  per recipient. Unattended sends never prompt. SMTP and user-connected Gmail /
  Outlook use opaque vault ids, with mandatory TLS and certificate validation
  both in policy and at dispatch. HTML, text alternative and attachment are
  scrubbed again immediately before sending. JSON attachments are reserialized
  from the verified document to preserve valid JSON and its structural hash;
  the final text scrub can redact the displayed hash in other formats. Rolling
  hourly/daily reservations include verification mail and uncertain/failed sends;
  a persistent transaction shared across windows must hold them. There is no
  agent method to add recipients or an OAuth connection.
- `post.ts`: separate opt-in and full first-post preview for each kind/target,
  automated note, final scrub and occurrence idempotency. The authenticated
  publisher receives the exact operation: PR comment, issue comment or update
  the selected pinned status issue in place. It receives no credential value.
- `scheduleRequest.ts`: the common `/report … --schedule` handoff consumes X's
  parsed report options and opens the same report schedule editor on every host.
- `DestinationPicker.tsx` and its CSS: controlled, labelled selection of one or
  more destinations, format, name template, retention, recipient and opaque
  connection. Folder selection, verification and OAuth connection are user clicks
  delegated to each host. It is an optional import with no activation/main import.
  Five new English strings have real translations in all fourteen tables; no
  manifest text key or setting was added.

## Integration handoffs (required bindings, not implementation placeholders)

| Handoff              | Owner               | Binding                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| -------------------- | ------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| M113-Q-schedule      | M115 RA             | Add the strict report action to the store/editor; supply `ReportScheduleAuthorityPort` from the trusted unattended run context. The grant names the complete destinations and intersects creator roots, targets and network permission. Keep time/event triggers, ordering, claims, missed fires and failure pause policy in M115. Serialize each occurrence and each destination/root lease across processes.                                                                                                                                                                                          |
| M113-Q-occurrence    | M115 RA             | Persist `ReportOccurrenceRecord` owner-only before dispatch, with a durable transactional `exclusive`/read/write binding. Preserve frozen documents and terminal uncertainty across restart. Surface deferred browser delivery as Open when I'm back. A lease/claim must never expire while its admitted destination mutation can still run.                                                                                                                                                                                                                                                            |
| M113-Q-generation    | K / S / W           | Bind `ReportGenerationPort` to the existing snapshot/collector pipeline and renderer locale port. It must contain no model/paid call; honor the intersected network option and exact occurrence time.                                                                                                                                                                                                                                                                                                                                                                                                   |
| M113-Q-vault-mail    | M109 / integration  | Bind `ReportMailPort` to the vault's brokered SMTP and user-connected Gmail/Outlook operations, with live schedule-scoped vault grants, TLS/certificate enforcement at dispatch, captured wire schemas, and idempotency receipts. Connect click/consent and tokens belong to the user/vault. A raw provider response is never passed as a guessed schema here.                                                                                                                                                                                                                                          |
| M113-Q-mail-state    | M109 / M115         | Bind the strict `reportMailStateSchema` to an owner-only persistent cross-window transaction. Own-addresses and the other-address allow-list are user controlled, revocable and rechecked on every send; agents cannot edit them. Codes/digests and consent never enter logs. Only a Verify user click calls `requestVerification`.                                                                                                                                                                                                                                                                     |
| M113-Q-node          | M110                | Supply the node saver on its volume and an authenticated report-route verifier/opener. Neither public URLs nor bearer tokens in a URL are acceptable bindings. Local publication uses a confined, atomic HTML save to runtime-owned storage.                                                                                                                                                                                                                                                                                                                                                            |
| M113-Q-post          | N / M71             | Bind per-kind/target opt-in, preview confirmation, existing GitHub identity and recorded-wire publisher. Persist returned comment ids for idempotency and edit the selected pinned status issue in place. The scheduler grant names the target.                                                                                                                                                                                                                                                                                                                                                         |
| M113-Q-editor        | V / X / M115 / M104 | Lazily import the shared picker in Action: Report. Supply only configured/capable choices and user-connected provider ids. Bind native folder/OAuth/verification clicks on VS Code, companion/native MHP hosts, ACP/runtime, desktop and TUI. Host bridge messages must validate through the action/destination schemas before save. Route parsed `--schedule` options to `openReportSchedule`.                                                                                                                                                                                                         |
| M113-Q-cli           | X / M115            | Bind `schedule add --report <kind> [args] --to save:<path> \| browser \| email:<address>` (repeatable) to the same action and grant. `schedule_report` invokes that same creation authority; no unverified mail or root outside creator permissions. No competing CLI/slash parser is introduced in Q.                                                                                                                                                                                                                                                                                                  |
| M113-Q-bundle        | W                   | Register an optional destination bundle importing runner/email/post and the shared picker chunk; share the existing English fallback and caller locale. Apply its measured budget, keep all existing caps and forbid reporting-to-backend runtime imports. The production entry/build/split/knip registration belongs to W.                                                                                                                                                                                                                                                                             |
| M113-Q-validation    | R / W               | Before registering the lazy report/destination bundle, export the runtime members used by R's report schemas (`globalRegistry`, `toJSONSchema`, `ZodMiniArray`) from the shared validation entry and guard them in the split check. They are absent on this base. Q uses the already-exported `pipe`/`optional`/`transform` for defaults. A successful measurement with an external validation module is not proof of a working installed lazy bundle.                                                                                                                                                  |
| M113-Q-host-record   | W                   | Regenerate the generated host API record for Q's additional Node builtin imports and picker stylesheet. No VS Code API or theme variable is added; the stale generated record is outside Q's ownership.                                                                                                                                                                                                                                                                                                                                                                                                 |
| M113-Q-doc-reference | W                   | Add feature catalogue/help rows for scheduled report destinations and `/report … --schedule`, plus the CLI schedule-report flags when X/M115 bind them; regenerate the reference. README: occurrence-time reports, default naming/retention, four destinations, verification/consent/caps/TLS and deferred browser opening. CHANGELOG Unreleased: deterministic scheduled report delivery through the shared ports and picker. Privacy/security: frozen redacted artifacts, recipient state, uncertain-send liability, no model/key exposure. These are W-owned files and were not edited in this lane. |

## Verification and drills

All commands run directly on `win11`. Every Vitest invocation uses the repo
default timeout, full owning files, at most three files, and `--maxWorkers=3`.
No timeout override, test filter or skip. The shared rules explicitly reserve
`npm run quality` and the full test suite for the lead; they are not run here.
Hooks exist at `.husky/_/pre-commit` and local commits use them unchanged.

Final owning verification covers six files. Cross-process
determinism builds once in `beforeAll`; child environments explicitly set
`TZ` and `LANG` and never print or receive a stored credential. Test-only
fakes cover the vault mail transport, OAuth providers, browser and GitHub
publisher. Actual SMTP/OAuth wire captures and service integration remain
the named binding above, not a claimed live test.

Deliberate-break receipts are in [m113-q-drills.json](m113-q-drills.json).
Every mutation runs its complete named test file, requires exit 1 and the
intended named failure, restores the original source in `finally`, and
compares SHA-256 byte-for-byte. Final restored tests and gates follow below.

Final restored owning tests (repository default timeout, no override):

```text
npx.cmd vitest run test/unit/reportDestinationSave.test.ts test/unit/reportDestinationEmail.test.ts test/unit/reportDestinationBrowserPost.test.ts --maxWorkers=3
3 files, 48 tests passed; 2026-10-06 16:17 PDT, 6.48 s
npx.cmd vitest run test/unit/scheduledReports.test.ts test/unit/scheduledReportsDeterminism.test.ts test/unit/reportDestinationPicker.test.tsx --maxWorkers=3
3 files, 16 tests passed; 2026-10-06 16:17 PDT, 9.09 s
```

Cross-process fixtures are statically referenced so knip checks their reachability;
the expensive child build happens once in `beforeAll`. All test-only process
fixtures terminate and their temporary directory is removed. The final save
review tightened foreign-file handling to avoid reading unowned bytes and
reject hard-linked manifest data before reading it; both have observed red drills.
After that narrowing, lint found an unnecessary optional chain; removing it
preserves behavior, and the full save test file passed in the final group above.

Real Chrome/axe: eight full WCAG 2 A/AA + 2.1 AA runs (light/dark/high-contrast
dark/high-contrast light, 690 px and 320 px), zero violations, no horizontal
overflow, zero network requests. Contrast is enabled in these runs. The jsdom
test only checks structure because it has no layout/canvas; it does not replace
the real-browser contrast checks. Results are in
[m113-q-a11y.json](m113-q-a11y.json); the narrow light screenshot is
[picker-320-light.png](m113-q/picker-320-light.png).

There are 41 observed red drills, all with the intended named failure and an
equal restored SHA-256: filename/grant/ownership/retention and foreign/hard-link
reads; verification expiry/tries/replay/digest/address case, consent, TLS,
hourly/daily caps and final scrub/JSON attachment; browser activity/recheck,
authenticated HTTPS and publisher shape; post opt-in/consent/scrub/note;
occurrence time, frozen data/schema, deduplication, pre-dispatch uncertainty,
revocation, schedule routing and duplicate destination ids; secret-safe action,
verification and connection-policy errors; picker labels and real-browser
contrast. The first root mutation left an independent confinement check intact;
the recorded drill removes both checks and fails the named confinement test.
The final source retains both checks.

## Final scoped gates and budgets

| Command                                                                                  | Result                                                                                                                                                                      |
| ---------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `npm.cmd run typecheck`                                                                  | Exit 0; all five projects (host, webview, unit, e2e, integration).                                                                                                          |
| `npx.cmd eslint --max-warnings=0 <changed TS/TSX files>`                                 | Exit 0.                                                                                                                                                                     |
| `npx.cmd stylelint src/webview/reporting/destinations/destinations.css --max-warnings=0` | Exit 0.                                                                                                                                                                     |
| `npm.cmd run deadcode`                                                                   | Exit 0, plain knip; two existing configuration hints, no unused code.                                                                                                       |
| `npx.cmd jscpd`                                                                          | Exit 0; 1,224 files, zero clones.                                                                                                                                           |
| `npm.cmd run check:reference`                                                            | Exit 0; existing registered reference current (53 features, 44 commands, 59 settings, 26 slash commands, 116 CLI rows). Q's new rows still require W's integration binding. |
| `npm.cmd run build`                                                                      | Exit 0, including size, split, host-global and third-party-notice checks; all existing caps unchanged.                                                                      |
| `node scripts/check-l10n.mjs`                                                            | Exit 1: seven existing manifest keys have no `package.json` use; no Q translation/source-text problem remains. See exact keys below.                                        |
| `node scripts/check-host-api.mjs`                                                        | Exit 1: generated host API record must include Q's imports and CSS; W-owned output is not edited.                                                                           |

`npx.cmd prettier --check <all changed text files>` is run before staging;
the unchanged commit hook also runs ESLint/Stylelint and Prettier, followed
by a staged gitleaks scan. No hook flag or hook environment override is used.

The first commit attempt passed the lint/format hook, then gitleaks refused
four literal synthetic GitHub-token canaries in three test files. Those tests
now construct a repeated-character dummy token at runtime; no credential or
scan exclusion was added. Their existing scrub/error assertions are unchanged.
The complete three affected files were rerun at 16:24 PDT with the default
timeout: 40 tests passed in 6.73 s. Combined with the unchanged save/determinism/
picker files, all 64 owning tests remain verified. The normal commit hook is
retried after explicitly restaging those fixes.

Production sizes: extension 439.6 / 600 KiB, Model API 446.9 / 475 KiB,
ACP 821.5 / 850 KiB, checkpoint store 77.0 / 225 KiB, webview main plus
static imports 797.8 / 900 KiB. Q is not yet registered in shipped entrypoints,
so this build proves existing budgets remain green, not completed Q integration.

The separately minified Q closure exports runner/email/post/schedule helpers,
using the repository's shared Node text/validation/wire plugins: **53,305 bytes**
(52.1 KiB), proposed new cap **75 KiB** by D6's +15%, round-up-to-25 rule.
The picker measurement shares React and the caller's English/locale state:
**7,879 bytes JS + 881 bytes CSS**, proposed new closure cap **25 KiB** by
the same rule. These are new optional-bundle proposals, not changes to any
existing cap. Neither measured closure imports a backend/paid runtime.
[m113-q-budgets.json](m113-q-budgets.json) records bytes and Node externals.
The browser measurement's external text/React modules assume reuse of the
existing caller; W must bind it into the real browser split and measure that
production import closure. The missing shared validation exports above must
also be bound before the installed Node lazy bundle can run.

The localization blocker is entirely in the unchanged existing manifest:

```text
command.showReport.title
config.reports.network.description
config.reports.network.enumDescriptions.whenSignedIn
config.reports.network.enumDescriptions.always
config.reports.network.enumDescriptions.off
config.reports.keepHistory.description
config.reports.agentSources.description
```

W must bind those planned report command/settings in `package.json`; deleting
the keys or weakening coverage is not a fix. `package.json`, `package.nls.json`,
the catalogue, README, CHANGELOG and build registrations are unchanged from the
base, verified with `git diff --exit-code -- <paths>`. The host API record retains
332 VS Code APIs, 31 files importing VS Code, 25 Node builtins and 61 theme
variables; only import counts change (`crypto` 46→50, `fs/promises` 47→48,
`path` 84→86, `timers/promises` 3→4, `url` 4→5) and the new CSS source is listed.
W regenerates that record with the documented command. The lead owns aggregate
quality after integration; this lane does not claim a zero-problem full gate.

## Practical limits

No filesystem provides conditional rename/removal. The existing
`fsAtomic.ts` checks path, bytes and identity immediately before mutation;
a same-user change in the final OS race can still be replaced, as its existing
contract documents. M115 must hold the destination/root lease. If an artifact
write succeeds but its manifest fails to commit, delivery is honestly failed
and the orphan is never claimed/deleted as an owned file. A crash or lost reply
after an external dispatch stays uncertain and is not automatically retried;
the user must reconcile it. The shared scrub's unknown-token-format residual
also applies here; known canaries are tested in each delivered representation.
