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
