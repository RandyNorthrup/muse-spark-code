# Lane TRUTHACP — ACP errors say their real cause (macmini, 2026-10-18)

First result: what the person sees now → what they will see after this lane.

- Legal scan (`src/acp/agent.ts` `runLegalScan`): now any failure of the scan,
  the registry permission prompt, the update send or the outbox says "The
  legal scanner could not be loaded; …" → only a scanner load failure will
  say that; every other failure will carry its own cause.
- Agent retry (`src/acp/agent.ts` `agentCommand`): now any `retry` failure,
  and an agent with no subagent id, says "Retry is unavailable: this backend
  provides no isolated worktree checkpoint" → only the backend that lacks a
  checkpoint (Muse Code) will say that; anything else will carry its own
  cause.
- Playbook (`src/acp/playbook.ts`, `src/runtime/playbook/command.ts`): now a
  playbook that loaded but whose command failed says "The playbook is
  unavailable in this session." → a loaded playbook whose command fails will
  carry the command's own failure; only a missing bundle/surface will say
  unavailable.
- Refusal predicate (`src/core/backends/modelapi/providerRefusal.ts`): now a
  TEMPORARY marker points at branch `fix/spend-ledger` and stale
  `ModelApiHost.ts` line numbers → the marker will be gone and the predicate
  will stand as the final design with its measured grounding, or the branch
  handover it describes will be done.

## What changed (all measured 2026-10-18 on macmini)

- Legal scan: `runLegalScan` (`src/acp/agent.ts`) kept one `try` around the
  scan, the registry permission prompt, the update send and the outbox, and
  mapped every failure to `legalScanUnavailable`. Now only an error whose
  message is exactly `legalScanUnavailable` — the bundle loader's documented
  contract for a missing or corrupt scanner (`src/host/lazyBundle.ts`: "A
  missing or corrupt bundle throws `unavailable`"; the same message the
  runtime's legal wiring throws for missing render/enrich entries) — says
  that. A failing scan or permission prompt rethrows its own cause, and the
  send plus `await this.outbox` moved out of the `try` (send never throws;
  `deliver` already absorbs notify failures, so an outbox rejection is a
  transport failure, not a scanner failure). No new string.
- Retry: `agentCommand` mapped every `retry` failure and an undefined
  `subagentId` to the backend-has-no-checkpoint message. Now an entry with
  no subagent behind it (background tool call, workflow child) answers new
  `agentRetryNoSubagent`; a `controlSubagent` retry refusal on the Muse Code
  backend keeps `agentRetryUnavailable` (that backend provides none); on the
  Model API backend the refusal's own message is returned. The only retry
  refusal the Model API backend raises is `recoveryRefusal`
  (`src/shared/agentRecovery.ts`), which now answers new
  `agentRetryNoCheckpoint` (this agent has no isolated checkpoint) instead of
  blaming the backend. `BackendKind` has exactly two members, so the
  `museCode` check is exact. `continue` paths are unchanged. Not in scope
  but found: the panel (`conversationController.ts:9311`) maps a missing
  agent plus retry to the same checkpoint message; named sites only, so left
  for the owner.
- Playbook: `runPlaybookCommand` (`src/runtime/playbook/command.ts`) mapped
  a loaded playbook's command failure to `playbookUnavailable`; now it
  answers new `playbookCommandFailed` (validated-data-only contract kept: no
  exception text). Missing surface still answers unavailable.
  `acpPlaybook` (`src/acp/playbook.ts`) narrowed its `try` to `loadBundle`
  only; parse results and the command's own `{ok, text}` pass through.
- Predicate: the TEMPORARY marker is gone. It pointed at `fix/spend-ledger`
  (HEAD 2026-10-12, stale) and line numbers `:6833/:6953/:8088` (actual
  `:6837/:6957/:8092`). `git grep isDefiniteRefusal fix/spend-ledger` is
  still empty, and PLAN.md D117 already records the eight statuses as the
  rule in force with the ledger owning "everything past the
  definite-refusal decision" — so the marker's promised handover
  contradicts the plan. The replacement comment grounds the set in the
  fetched provider documents and red drill C
  (`docs/certification/provider-refusals.md`) and states the conservative
  direction (narrower keeps uncertain liability visible). No behavior
  change.

## Tests (real code only, no stand-ins)

- `test/unit/playbookSurface.test.ts`: real journal surface on a real temp
  dir — a refused settings change on a loaded playbook answers
  `playbookCommandFailed` (proven to fire: reverting the fix fails it);
  missing surface answers unavailable; the ACP layer carries the loaded
  playbook's answer through; a genuinely missing bundle file through the
  real Node loader answers unavailable.
- `test/unit/providerRefusals.test.ts`: the eight D117 statuses are
  definite; 0/408/409/418/425/499/500/529 stay uncertain (proven to fire:
  adding 499 fails it).
- Sites 1–2 (`runLegalScan`, `agentCommand`) have no committed test: no
  test builds the ACP agent, and scaffolding one would be stand-ins. Verified
  by typecheck, eslint, and reading; drills below.

## Real-use drills (packed `dist/acp.js`, scratch HOME, removed after)

- `playbook status` on a fresh journal: full settings table, exit 0.
- `playbook settings offload off "Truth drill reason."`: persisted and
  re-rendered with owner stamp, exit 0.
- Journal `.jsonl` corrupted (trailing garbage): `playbook status` fails
  while the surface binds — "The playbook is unavailable in this session.",
  exit 1. That is the surface failing to load, not a loaded playbook's
  command failing, so unavailable is the truthful answer there (out of the
  named scope; journal restored from backup afterwards).
- Journal directory read-only, `playbook settings offload on`: the loaded
  playbook's write fails — "The playbook command could not be completed.",
  exit 1. Before this lane the same failure said the playbook was
  unavailable (proven by the unit drill: reverting `command.ts` fails the
  new test with the unavailable text).
- Sites 1–2 through a live ACP session (`/legal`, `/agents retry`) need an
  editor-side client and a backend session, not runnable headless here:
  person steps for the lead — open the packed product on the Model API
  backend, run `/legal` with the scanner bundle removed (expect the
  could-not-be-loaded message with the cause in the log), then with the
  bundle present but the registry prompt denied (expect the denial's own
  cause); list `/agents`, `retry` an entry with no subagent (expect the
  no-subagent message) and one refused by the backend (expect the agent's
  own missing-checkpoint message, never the backend one).

## Live ACP pass (packed `dist/acp.js`, NDJSON driver, scratch HOME/workspace)

One continuous pass per phase through the public ACP interface
(`initialize` → `session/new` → `session/prompt`; server permission
requests answered cancelled). Session setup needed the repo's own
`native/darwin/build.sh` (git-ignored helper, warnings only).

- `/legal` with `dist/legalScan.js` set aside: `ERROR -32603 "Internal
error: The legal scanner could not be loaded; reinstall the extension
and reload the window. The log has the details."` (bundle restored
  after; server stderr names the missing module). Only the load failure
  says it.
- `/legal` on a chmod-000 workspace: `ERROR -32603 "Internal error"`
  with data `EACCES: permission denied, opendir` — the scan's own cause,
  no scanner message. `/legal --offline` readable again: full scan
  report, `end_turn`.
- `/agents` on empty history: "No subagents in this conversation.",
  `end_turn`.
- `/agents retry no-such-agent` and `/agents continue no-such-agent`:
  `ERROR -32602 "Invalid params: Continue is unavailable for this agent
or its current state."` — the unknown-agent pre-check, unchanged by
  this lane (pre-existing wording, not one of the named lines).
- The three new retry messages need history entries (a listed entry with
  no subagent; a backend `controlSubagent` refusal), and history entries
  need a backend model turn, which this lane may not run (no live model
  calls). Not reachable headless here; covered by code, typecheck,
  eslint, and the unit truth-table instead. Exact person steps for the
  lead are listed under "Real-use drills" above.

## Gate exit codes (final tree, macmini)

- `npm run typecheck` (all five projects): 0.
- eslint on all changed files: 0 errors, 0 warnings (one
  `unicorn/prefer-ternary` found and fixed in `agentCommand`).
- prettier check on changed files + cert + changelog: clean.
- `node scripts/check-l10n.mjs`: 0 problems (3 new keys × 14 languages).
- `npm run check:plan`: 0 drift. `npm run check:reference`: matches.
- `npm run build` (production + size/split budgets): 0.
- `npm run deadcode`: 0 (only pre-existing hints elsewhere).
- `npm run cycles`: no circular dependency. `npm run duplication`: 0 clones.
- `npm run check:host-api`: 0 problems.
- `npm run security:audit`: 0 blocking (2 advisories, 1 in exceptions file).
- `npx vitest related --run` on the five changed src files: 14 files
  passed, 2 skipped files, 359 tests passed.
- `security:sast`: NOT RUN — semgrep crashes in this sandbox
  (`Fatal error: exception Failure: ca-certs: empty trust anchors`,
  exit 2) before reading any source. Environmental; lead to run outside.
