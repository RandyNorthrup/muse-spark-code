# Shared policy help reference

## Orchestrator playbook: commit verification

Shared policy implemented; editor/planner bindings belong to M116 I/U/W.

Hook bypass is detected by outcome; the command guard is an advisory early warning. Before a harness-managed push or completion, every newly reachable commit needs a passing receipt identifying the commit and configured hook digest. Repository pre-commit and commit-msg hooks run against the commit tree and message in an isolated temporary worktree. Pre-push runs once for the exact push range with a clean index. Failed or unavailable hooks add a strike and block push and completion; scrubbed output is shown to the person.

The trusted harness starts beginWork(module, refs) before dispatch, retains its work id, runs verifyWork(workId) before finishWork(workId), and verifyWork(workId, range) immediately before beforePush(workId, range). Managed pushes send the verified object ids from that range and recheck admission immediately before the effect. Every effect must pass ordinary tool admission. Start snapshots include all reachable repository refs. Pushes also check commits introduced since the first recorded workspace work, so later work cannot hide an unverified ancestor. Hook configuration or byte changes invalidate verification. Receipts and violations survive restart in the workspace journal.

Dispatch leases name the lane, module member and generation. Review completion presents the admitted lease token; expired, released or replaced tokens are refused. Edited moves require published lineage and inherit strikes through content similarity or Git rename/history evidence. Merges reconcile maximum strikes and lifetime counts throughout the family.
