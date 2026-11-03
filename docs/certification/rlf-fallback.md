# RLF-FALLBACK — a refused team task moves to the next agent in its role (D261)

Lane RLF-FALLBACK, linuxlt, 2026-11-02. Rework of the first pass (a22c42f00)
after the owner's correction: "falling back to agents in a designated role
was the design even if they are from a different account or provider".

## What changed

- **Removed:** `museSpark.modelApiFallbackModel`, `exec --fallback-model`,
  the ACP `fallbackModel` option (`src/acp/fallbackOption.ts`), the in-turn
  switch in `ModelApiHost.ts` and `refusalFallback.ts`, with their tests and
  table words.
- **The signal:** a Model API turn that ends on the provider's `refusal`
  stop now carries `turnCompleted.refused` (`src/shared/agentEvents.ts`,
  `ModelApiHost.ts`); the worktree host and the engine worker turn it into
  a `refused` report (`engineWorker.ts`); Muse Code and ACP workers already
  mapped their `refusal` stop (`report.ts`). Both worker ports mark the
  outcome `isRefused`, the report keeping its `failed` status.
- **The move:** `planRefusalMove` (`src/core/team/teamPool.ts`) and the
  host's in-place handoff (`chooseAfterRefusal`, `takeOverRefused` in
  `src/core/team/teamHost.ts`), behind `museSpark.teamRefusalFallback`
  (off by default, machine-scoped) and `exec --team --refusal-fallback`.
- **Words:** `teamSwitchReasonRefused`, `teamRefusalPaidDeclined`,
  `teamRefusalUnattended`, `execRefusalFallbackNeedsTeam`, the flag's help
  line and the setting's description, in English plus all 14 tables.

## Decisions taken in the lane

- **Selection.** The installed team host selects by D75's role pool and its
  live checks (`hasHeadroom`); D103's preference-aware selector
  (`selection.ts`) has no installed binding yet (PLAN M120 status). The
  move uses the installed path, so it runs today, and the pure function
  carries D103's conditions (order, one try, review never to an authoring
  model, D48).
- **In-place handoff, not retire-and-retry.** The stall reassign requeues
  only once the worker port proves retirement; the engine port gives no
  proof, so a Model API worker would never move. The refused run has ended
  (its in-flight calls answered, never run), so the task keeps its lease
  and attempt; the entry changes with a dispatch claim on the new entry.
- **History.** The next worker starts its own conversation on its own
  provider from the handoff instruction, the refusal as untrusted data, the
  brief and the captured copy; nothing crosses providers.
- **No ACP option.** ACP sessions run no team role (`src/runtime/backends.ts`
  takes team seams only from `exec`), so an option there would control
  nothing. The lead (2026-11-02): keep it out for now; merge round 11
  brings ACP teams, which then get this toggle.
- **No role.** A plain chat has no list; by D103 and D212 defaults its
  refusal ends the turn with its true sentence whatever the toggle says.

## Tests (real code only)

- `test/unit/teamRefusalMove.test.ts`: the selection guards.
- `test/unit/teamHostRealParts.test.ts`, "a refused task moves down its
  role": the real host, the real window scheduler and real git; the worker
  port's hands are real processes, as in the rest of that suite, and a
  refused run is handed back as the engine port hands one back. Proves the
  move in role order, the handoff brief, the switch row, per-entry claims,
  one try each ending on the last refusal, and toggle off ending as before.
- `test/unit/execTeamFlags.test.ts`: the flag needs `--team`, off when absent.

## Red/green drills (`temp/drill.py`: break, run, restore from source, run)

| Guard                                    | Broken | Restored |
| ---------------------------------------- | ------ | -------- |
| Toggle off: no move (condition removed)  | exit 1 | exit 0   |
| One try per entry (tried skip removed)   | exit 1 | exit 0   |
| Live headroom (check removed)            | exit 1 | exit 0   |
| Review never to the authoring model      | exit 1 | exit 0   |
| D48: unattended run stops, attended asks | exit 1 | exit 0   |
| Each run counted on its own entry        | exit 1 | exit 0   |
| Switch row says the agent refused        | exit 1 | exit 0   |
| `--refusal-fallback` needs `--team`      | exit 1 | exit 0   |

A first toggle drill (`=== true` to `!== false`) stayed green because the
harness answers `false`; it was redone by removing the condition.

## Blocked in the lane, then finished (2026-11-02)

The rework's run had `package.json` and `scripts/` read-only (a launcher
bug, since fixed). The finishing run applied the lead's patch
(`museSpark.teamRefusalFallback` in the manifest,
`museSpark.modelApiFallbackModel` gone, the stale `refusalFallback.ts` line
out of `scripts/check-bundle-split.mjs`) and deleted it. Two more fixes
the gates showed, both from this branch:

- The catalogue lint (`scripts/lib/reference.mjs`) reads a description
  opening with "When" as conditional state, so `gen-reference` stopped on
  the setting and its feature; the English description now opens "A team
  task an agent refuses moves …" (same meaning; the 14 tables keep theirs).
- `npm run build` stopped in the bundle-split gate: `dist/teamHost.js`
  carries `TEAM_HANDOFF_MODEL_TEXT`, which the refused task's handoff brief
  in `src/core/team/teamHost.ts` reads (the base read it only in the window,
  engine and process bundles). The team service bundle is now a declared
  reader of that block; no budget changed.

## Not proven

A live refusal: see `docs/real-life/unproven.md`. The CHANGELOG line waits.

## Gates of the finishing run (2026-11-02, linuxlt, repository timeouts)

| Gate                                        | Exit |
| ------------------------------------------- | ---- |
| `node scripts/gen-reference.mjs`            | 0    |
| `node scripts/check-l10n.mjs`               | 0    |
| `npm run check:reference`                   | 0    |
| `npm run build` (first run: bundle split)   | 1    |
| `npm run build` (after the reader fix)      | 0    |
| `npm run security:sast` (699 rules, 0 hits) | 0    |
| `npm run typecheck`                         | 0    |
