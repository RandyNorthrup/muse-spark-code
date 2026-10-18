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
