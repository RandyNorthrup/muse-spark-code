# RLF-FALLBACK — a refused team task or solo chat turn moves to the next agent in its role (D261)

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
- **No role.** Superseded by the second pass below: a solo chat now
  falls back to its agent's main role; with no main role, or no other
  candidate in it, its refusal ends the turn with its true sentence.

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

`npx vitest related` on the branch's changed files (against `git merge-base HEAD 72d8d5003`, `--maxWorkers=3`, repository timeout) did not finish inside the lane's budget: after about 90 minutes it had about 31,200 passing tests and a few `x` marks in the dot output whose tests the lane could not name, with one worker still in `test/unit/judgeP2Delivery.test.ts` (it reruns `check-bundle-split.mjs`). The run was stopped; the related suites need a full run before merge.

## Second pass: solo chats too (2026-11-02, linuxlt)

The owner was asked whether a plain chat falls back and said "you
choose"; the lead chose that it does, because Claude Code's fallback flag
works in a solo session and ours must not do less.

### What changed

- **Who answers next.** `chatRefusalRole` (`src/core/team/teamPool.ts`)
  finds the role the chat's agent holds as its main role (D212): the
  editor's stored assignment when one names it, else the role whose list
  holds the agent, an entry naming the agent outright before Default
  (which runs whatever the chat runs). Every entry in that role that is
  the chat's own agent (same model, same account) counts as tried. The
  team host's `takeOverRefused` (`src/core/team/teamHost.ts`, behind the
  `TeamToolRunner` seam) runs the same `planRefusalMove` over the same
  live checks (`hasHeadroom`). No new setting, no second list.
- **No role.** No role holds the agent, or the role has no other
  candidate: `{ kind: 'stands' }`, and the turn ends with its true
  refusal sentence as before.
- **Money.** The next agent runs as a task of that role through the
  delegation's own path (`delegateWith`, the old `delegate` body with a
  seed for the record): D48's popup names the model and price for a paid
  entry, Deny gives `teamRefusalPaidDeclined`; an unattended run
  (`isUnattended`) stops before asking with `teamRefusalUnattended`.
  Admission, caps, the team budget and the run's hard budget apply as for
  any task; its usage is claimed on its own entry, the refused turn's on
  the chat's model.
- **The switch.** The refused turn has ended (its in-flight calls
  answered, never run, as before). The task's brief is the handoff
  instruction, then the refusal and the turn's tool calls inside the
  handoff data fence, then the person's request: no history crosses
  providers. The record is seeded with the chat's tried entries, so a
  further refusal moves the task on (the team path), never back.
- **What the person sees.** The task's switch row, in the team path's
  own words ("engineering: model-a → model-b, the earlier agent refused
  the task"), posted on the chat's surface because the refusing entry is
  seeded as the role's last selection; then the next agent's report as a
  reply in the refused turn (`handOverRefusedTurn` in
  `ModelApiHost.ts`). It enters the transcript only, never the model's
  replay. The chat's model never changes, so the next message goes to the
  person's chosen agent.
- **Where.** Model API backend: a refused top-level chat turn moves; a
  subagent's refusal stays its parent's; a team worker has no team runner,
  so its refusal is the team path's. Muse Code and ACP workers already
  report their `refusal` stop, so their team tasks move. A Muse Code chat
  runs its turn in the CLI's own loop and is not wired to the move; an ACP
  session runs no team until merge round 11. Their refused chat turns end
  as before.
- **Never around a safety refusal on another account (team and chat).**
  `planRefusalMove` now takes the refusing agent's account and each
  entry's, and skips every entry on the same provider under a different
  account with skip reason `otherAccount`; it returns every skipped entry
  with its reason on every plan. `refusalAccountOf` reads the record from
  the model reference (`<record>/<model>`; a bare model is the built-in
  provider's) and the provider from the record's preset (a capability of
  the record, no vendor named in code); a custom server and an unknown
  record are their own provider. The window reads presets from the
  providers file (`providerPresetOf` in `src/extension.ts`, through the
  engine ports' `providerService`). When the list runs out with such
  skips, `refusalOtherAccountSkipped` names the models. Another provider,
  or another model on the same account, may still take the turn.
- **Rename.** `museSpark.teamRefusalFallback` became
  `museSpark.refusalFallback` before it shipped, in the manifest, all 15
  manifest tables, the settings reader, defaults, machine scope, the
  feature catalogue and the generated reference. The CLI flag stays
  `exec --team --refusal-fallback`: without a team there are no roles.
- **Words.** The setting's description and the flag's help line now say
  "task or chat turn"; `refusalOtherAccountSkipped` is new; English plus
  all 14 tables, and the desktop tables regenerated.

### Decisions taken in the lane

- **The takeover is a team task, not an in-session model switch.** A
  switch inside the chat's own session would carry the conversation to
  another provider; the task path starts the next agent's own
  conversation, and reuses D48, the caps, the budget, per-entry usage, the
  switch row and the hooks without a second copy of any of them.
- **A chat holds no team consent.** Every paid next agent is asked; the
  question is the delegation's own (one popup), not a second one first.
- **The answer is a transcript reply, not replay.** The person's agent
  does not see the takeover's answer as its own history on the next
  message; the brief's "no history crosses providers" holds both ways.
- **`exec --team` has no preset lookup yet.** Its engine ports get no
  `providerService`, so each record counts as its own provider and the
  account guard there only sees the same record. Open item below.

### Tests (real code only)

- `test/unit/teamRefusalMove.test.ts`: skip reasons on every plan; the
  account guard (another account skipped, another model on the same
  account and another provider allowed); `refusalAccountOf`;
  `chatRefusalRole` (assignment first, explicit entry before Default,
  every copy tried, no role).
- `test/unit/teamHostRealParts.test.ts`, "a refused solo chat turn moves
  down the main role of its agent": the real host, real scheduler, real
  git and a real worker process. Off and no role stand with no run; on,
  r1 (the chat's agent) never runs, r2 answers from the handoff brief
  (refusal and tool call inside the fence, then the request), the switch
  row reads r1 → r2 refused, and the answer is the task's report. A
  second case: r2 on another account of the same provider is passed over
  for r3; with only other-account entries left the sentence names them
  and nothing runs.
- Not tested automatically: the session's hand-over in `ModelApiHost.ts`
  (no recorded refusal to drive a real session); see
  `docs/real-life/unproven.md`.

### Red/green drills (`$TMPDIR/drill.py`: break, run, `git checkout` the file, run)

| Guard                                               | Broken | Restored |
| --------------------------------------------------- | ------ | -------- |
| Another account of the refusing provider is skipped | exit 1 | exit 0   |
| Chat takeover off: the refusal stands               | exit 1 | exit 0   |
| Every copy of the chat's agent counts as tried      | exit 1 | exit 0   |
| The assignment's main role wins                     | exit 1 | exit 0   |
| An entry naming the agent before Default            | exit 1 | exit 0   |
| Switch row names the chat's refusing agent          | exit 1 | exit 0   |

### Open items

- `exec --team`: wire `providerService` from the providers file so the
  account guard sees presets in headless runs.
- A live refusal through the packed product (`docs/real-life/unproven.md`);
  the CHANGELOG line waits for it.
- `vitest related` was not run (nearly the whole suite on this branch);
  the merge round proves it.

### Gates of the second pass (2026-11-02, linuxlt, repository timeouts)

| Gate                                                                 | Exit |
| -------------------------------------------------------------------- | ---- |
| `npx tsc --noEmit -p .`                                              | 0    |
| `npx eslint` (changed files)                                         | 0    |
| `npx prettier --write` (changed files)                               | 0    |
| `node scripts/check-l10n.mjs` (first run: desktop tables stale)      | 1    |
| `node scripts/check-l10n.mjs` (after `npm run desktop:l10n`)         | 0    |
| `node scripts/gen-reference.mjs`                                     | 0    |
| `npm run check:reference`                                            | 0    |
| `npm run build`                                                      | 0    |
| `npm run security:sast`                                              | 0    |
| vitest: teamRefusalMove, teamHostRealParts, execTeamFlags (23 tests) | 0    |

Not run in the lane (budget): manifest, featureCatalogDetails and
runtimeSettingsStore suites, which read the renamed setting; the merge
round runs them with the rest.
