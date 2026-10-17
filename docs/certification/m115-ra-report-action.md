# M115 RA — report action

Kubuntu, `/home/randy/lanes/M115RA`, branch `m115/ra`, base `2cfb9b540`
(lane 0 + X runtime/ACP/CLI/companion/MHP), 2026-10-06. The rig brief
overrides the shared rule's old merge/remote-test instructions: all checks
run directly here, complete owning test files, default Vitest deadlines,
at most three files/workers. Aggregate quality belongs to W/lead. Hooks
exist at `.husky/_/pre-commit`. No new dependency, credential access,
live/model/paid call, OS registration, merge, rebase or push is authorized.

PLAN.md D95/M115 live in planning commit
`8a93e7fbd22e5600366dc902d8daf791f7fcc89f` and are absent on this base;
the `M115 RA` section added to this lane's PLAN.md records the scope.
Lane-0 contracts ([m115-contracts.md](m115-contracts.md)) are the base:
the `prompt | report` action union, destination shapes with
`availability: planned` for cloud/SMS, destination-id grants, and exact
zero cost for reports. No external wire shape is introduced.

## Scope and integration

RA owns only its report regions in the existing X adapter and lane-0
schema. S/G/V and M113 Q are absent on this base; every binding to them
is an injected port with no production fake:

- `ScheduleReportPort` (`src/core/schedules/reportAction.ts`): M113 Q
  binding. Q resolves only configured root/recipient/connection ids,
  validates its `ScheduledReportAction`, then runs its
  `ScheduledReportRunner.run(schedule.id, asOf, action)`. Bind Q's live
  full-destination authority, durable occurrence/root leases, previews
  and scrub before enabling it. The port carries no prompt backend and
  no paid-reservation dependency.
- `ScheduleReportDeliveryPort` (same file): S calls
  `ScheduleReportActionRunner` after the ordinary permanent claim and
  per-target admission. Wired into `RuntimeScheduleHost` via the
  optional `reports` dep; a report schedule with no bound runner settles
  `refused`, never falls back to the prompt backend.
- `ScheduleReportAgentPort` (same file): G's admission side.
  `destinationsAllowed` resolves complete targets under the creator's
  canonical roots and verified recipient/post permissions; `admit`
  routes the bounded draft through G. `schedule_report` cannot
  manufacture destination authority and never supplies the creator,
  consent or rescheduling permission from tool arguments.
- `ScheduleReportCliPort` (`src/runtime/schedules/reportCli.ts`): M113
  X parses report args through its existing parser; Q resolves
  user-selected paths/addresses into approved opaque ids and completes
  preview/verification/consent. Never persists raw addresses or vault
  values. `runScheduleCommand`/`ScheduleRuntime` thread it through
  optionally; `--report` without a bound resolver is an explicit refusal.
- Editor: `ReportActionEditor` + `DeferredReportActionEditor`
  (`src/webview/schedules/`) are supplied for V's lazy chunk. V passes
  the registry kind choices and Q's shared destination picker adapted to
  opaque configured ids. The same field runs in every host's shared
  panel (all-editors rule: logic in shared core, UI in the shared
  webview behind the host bridge; no vscode-only path).

Report semantics: occurrence time is the report's `asOf`; settlement is
exact zero cost (`usd: 0`, `certainty: 'exact'`,
`retainedLiabilityUsd: 0`, enforced at the runtime boundary); the CLI
and the tool force `paidCapUsd: 0` on the draft and its grant; the grant
names exactly the action's destination ids (`destinationIds`), unique
per action (schema refine). Every action edit clears `destinationIds`
so Q/U renew complete-destination consent. S retains all
trigger/claim/collision/catch-up behavior; G retains admission,
intersection, consent, caps, depth and lifetime. Q owns confinement,
preview/consent, scrub, network policy and delivery. Cloud/SMS
(`availability: planned`) refuse without dispatch.

Windows paths: RA compares no file paths. CLI `--to` values pass
through opaquely to Q's resolver (covered with a `save:C:\reports`
value); destination identity is the opaque id, never the raw string.

## Help reference for W/HELPREF (no featureCatalog on this base)

- CLI: `schedule add --report <kind> --to save:<path>|browser|email:<address> ... [--format md|html|json|text] [-- <report args>]`
- Agent tool: `schedule_report` (report drafts only, G no-escalation, destination intersection)
- Editor: Action selector gains Report (kind/format/args/destinations) beside Prompt; switching clears destination consent and zeroes the paid cap
- Grants name destination ids; reports cost exactly nothing and reserve no money

## UI budget

The editor ships as a `React.lazy` field (`DeferredReportActionEditor`)
for V's lazy chunk; nothing in a shipped bundle imports it yet, so
`npm run build` sizes are unchanged by UI: extension 438.4 KiB (cap
600), modelApi 447.0 KiB (cap 475). No cap raised. `check-host-api`
records the new css source with zero new theme variables.

## Gates (this rig, default timeouts)

- `test/unit/scheduleReportAction.test.ts` + `scheduleReportCli.test.ts`
  - `scheduleReportEditor.test.tsx`: 40 passed (31 + 5 + 4)
- Neighbors `scheduleCommand` + `scheduleV2` + `runtimeScheduleHost`: 39 passed
- `tsc` host, webview, unit: clean. `eslint --max-warnings=0` on all RA
  files: clean (two findings fixed: an unnecessary re-check narrowed
  through the aliased `canSelectReport` condition; a nested ternary
  reworked after prettier/unicorn disagreed, then extracted to a helper
  when `prefer-switch` and `no-break-in-nested-loop` combined).
- `prettier --check` on all RA files: clean.
- `node scripts/check-l10n.mjs`: 0 problems (5 cognates fixed with
  report-qualified translations: de `Berichtsformat`, fr
  `Format du rapport` / `Paramètres du rapport` /
  `Destinations du rapport`, pl `Format raportu`).
- `npx knip`: clean. `node scripts/check-host-api.mjs`: 0 problems
  after `--write` (node built-ins drift is lane-0/X base drift;
  RA's row is the css source with no new variables).
- `npm run build`: exit 0, budgets above.

## Red drills (break → named test fails → byte-exact restore, SHA-256)

1. Removed the unique-destination-id refine (`scheduleV2.ts`) →
   `rejects widened contexts, invalid occurrence times and duplicate
destination identities` failed → restored OK.
2. Removed the `cost.usd !== 0` arm (`host.ts`) →
   `rejects billed report settlements at the runtime boundary` failed →
   restored OK.
3. Removed the receipt-length check (`reportAction.ts` runner): first
   attempt stayed green — no case covered complete-plus-extra receipts.
   Added the extra-key receipt to `rejects incomplete, extra or
malformed receipts and never echoes provider errors`, re-broke, saw
   it fail → restored OK.
4. Removed the `bounded` arm of the tool intersection
   (`reportAction.ts`): first attempt stayed green — no case covered a
   G-narrowed grant. Added the narrowed-grant case to `requires creator
destination authority and routes bounded drafts through G admission`,
   re-broke, saw it fail → restored OK.
5. Allowed `--to` without `--report` (`args.ts`) →
   `rejects missing, misplaced, invalid and credential-like destination
flags without echoing them` failed → restored OK.
6. Removed destination-consent clearing on action edit
   (`ReportActionEditor.tsx`) →
   `edits typed arguments, format and configured destinations and
renews consent on every change` failed → restored OK.

All four drill targets verified `sha256sum -c` OK after restore.

## Open / left for integration

- W owns manifest/registration, docs, CHANGELOG, aggregate quality and
  the `SCHEDULE_MODEL_TEXT` block placement.
- V wires `DeferredReportActionEditor` into its lazy schedule chunk
  with the kind registry and Q's destination picker; Q binds the two
  report ports with full-destination authority, leases, previews, scrub
  and delivery; S calls the runner after claim/admission; G implements
  the agent port behind charter/consent/caps/depth/lifetime.
- No paid/live call was made; no credential was read, printed or stored.
