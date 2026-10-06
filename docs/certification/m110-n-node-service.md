# M110-N node service

Kubuntu rig; worktree `/home/randy/lanes/M110N`, branch `m110/n`.
Scope: PLAN D90.1, .3, .18, .23 and the N row of M110a0. Counted model
attempts: **0**. No credentials, live/paid requests, pushes, merges or rebases.

## Durable state (first piece)

`state.ts` commits the canonical L0 state and a capped audit journal in one
owner-only atomic transaction: data fsync, rename, directory fsync. Audit
entries bind their content, node, sequence, predecessor and retained head.
Rotation keeps a verified anchor and enforces the chosen byte and age caps.
Unknown fields, newer versions, stale generations and non-private/symlink
files fail closed. No sessions, bearers or unsealed keys are persisted.

`migrations.ts` supplies the forward-step/backup interface. Version 1 has no
legacy format to migrate; unknown older formats and newer state are refused.
No migration or M109 slot shape has been invented. Native Windows needs a
qualified private-DACL adapter; Windows home nodes run this service in WSL2
or Linux containers. Path comparisons normalize Windows separators.

`nodeStateStore.test.ts`: nine tests pass with the repository default timeout.
The deliberately broken guards and SHA-256 restoration receipts are in
[m110-n-node-service-drills.json](m110-n-node-service-drills.json). Drill
groups remove overlapping audit or read-size checks together, so one guard
does not mask the test of another. Each accepted drill must exit 1 with a
named failed test, then restore the source byte-exact. An initial isolated
sequence mutation was caught by the remaining content hash and stayed green;
the combined integrity drill is the receipt that proves those guards fire.

## Integration constraints

The base has no M104 companion server/envelope or M109 passphrase-slot
reader. Their bindings must be explicit injected interfaces, with unavailable
errors until installed, never production fakes. The threat-model record still
says lead acceptance is pending before listener implementation; clarification
was requested while independent service work continued.

J owns README, CHANGELOG and the shared plan updates. Handoff text: add the
node service's durable-state, restart-sealed, audit and lifecycle behavior to
the home-node release notes and guide after its integration ports are bound.
No feature catalog or reference generator exists on this base; executable
node commands need reference entries at integration.

## Verification

Focused checks run directly on Kubuntu. Full `quality` is reserved for the
lead by the supplied rig/common rules. Final results will be recorded here
after all N pieces and drills are complete.
