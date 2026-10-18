# /playback (D203) — certification record

## Scope and binding

2026-10-17, branch `feat/playback` from `main`.
Authority: the lane brief (the owner's binding verbatim is quoted in PLAN.md
D203), common.md, the owner's standing rules in AGENTS.md. Commit trailer:
`Co-Authored-By: Muse Spark (contributor) via Muse Code`.
No paid or live Model API call was made; no credential was printed, copied
or stored. All live turns ran on the Muse Code backend
(model `muse-wonder-1.0`) under the owner's existing subscription, which
bills no per-call amount (exec receipts: `settled $0.000000`).

Delivered: `/playback` on every surface (panel, terminal CLI, ACP editors)
and every backend (Model API incl. all M95 providers through the same host,
Muse Code, prompt text for external agents). The turn answers from working
memory only, with no tools; the reply opens with the fixed marker
`My playback — my own understanding, from memory only:`.

Files: `src/shared/playbackCommand.ts`, `src/core/playback/playbackPrompt.ts`,
`src/core/backends/modelapi/playback.ts`, `PLAYBACK_MODEL_TEXT` +
`SLASH_COMMAND_NAMES.playback` (`src/shared/constants.ts`), palette row +
skill reservation (`palette.ts`, `paletteRegistry.ts`), Help reference
(`slashReference.ts`, `referenceSource.ts`, regenerated
`reference.generated.*`, `reference.node.generated.ts`, `docs/reference.md`),
feature catalog entry (vscode+acp × museCode+modelApi), webview parse/post
(`App.tsx`), host message (`protocol.ts`), controller turn with the send
barrier, checkpoint and tool-use watch (`conversationController.ts`),
Model API no-tools turn (`ModelApiHost.ts`: `playback()`, zero tools,
in-code refusal), ACP command list + intercept + Plan hold/watch/restore
(`acp/agent.ts`), review-bundle `playbackText` (`reviewBundle.ts`,
`reviewEntry.ts`), 7 UI keys + tip in English and all 14 translations,
`referenceAcp` mention, README section + slash list, `docs/acp.md` bullet,
CHANGELOG entry, PLAN.md D203, new tests
(`test/unit/playbackCommand.test.ts`, `test/unit/playbackPrompt.test.ts`,
palette expectations).

## Research sources (brief §1)

- Codebase: `AgentSession.review` + `ModelApiHost` `isReview` gate and the
  `decideAndRun` reviewer refusal; `planModeHold` take/drop/restore; the M90
  fail-closed cancel (`museCodeReviewer.ts`: "any item other than
  message/reasoning cancels the review"); ACP prompt interception
  (`isCompact`, `isUsage`, `parseSkillInvocation`); `exec` driving the ACP
  agent in-process (`execClient.ts`); MSP approval modes (`denyUnmatched`
  allows reads — hence Plan hold + watch, never wording alone);
  `check-bundle-split.mjs` TEXT_BLOCKS guard; the M97 `/legal` commit
  `be81b6871` as the slash-command template.
- Comparable agents: Claude Code has no built-in restate command — bundled
  skills and custom slash commands are prompt-based with tools still
  available (`/doctor`, `/code-review`;
  `https://code.claude.com/docs/en/slash-commands.md`, fetched 2026-10-17).
  `/playback` is the opposite trade: the prompt asks only for a memory
  report, and the harness makes tool use impossible (Model API) or stopped
  (Muse Code).

## Gate-fire record (every gate that caught something fired)

- New test failed before the implementation: `playbackCommand.test.ts`
  failed on the missing module, then passed (3/3).
- `paletteRegistry.test.ts` failed twice on the new row (slash-name lists),
  updated as the contract requires, now 52/52 with the parser file.
- `check:l10n`: 14 problems (`playbackItem` left in English) → added to
  `l10n/untranslated.json` beside the other command names; 0 problems.
- `gen-reference` refused to generate until covered: `startPlayback` host
  action → feature map, `playback` capabilities (all four surfaces), README
  `#playback` anchor. `check:reference` green.
- `check-bundle-split`: 5 problems (new `playback.ts` not on the source
  list; agent code ships in `dist/runtimeEngine.js`, not `dist/acp.js`) →
  listed the source, corrected the readers. Green.
- Build budget: `dist/conversation.js` 250.2 KiB over the 250 KiB cap (caps
  never move). The turn's text moved behind the lazy review bundle with the
  Plan-mode hold (`deps.review.playbackText()`), as a review's does;
  conversation.js back to 249.0 KiB. A `/playback` that cannot load the
  bundle is refused with the reason (worded for the review bundle it
  shares; reinstall case only).
- `duplication` (0% threshold): 2 clones against review's admission prelude
  and hold-submit → extracted `workspaceForRestrictedTurn` and
  `sendHeldTurn`, shared by review and playback. Side effect, intended and
  safer: a review starting while a playback or scan starts is now refused
  busy too (either will hold Plan mode); previously only the reverse was
  covered.
- `eslint`: 4 errors in new code (ternaries, member order, promise
  chaining), fixed, zero warnings. Follow-ups from the full runs: 2
  `prefer-unicode-code-point-escapes` in the new model text (fixed), and
  the new test's environment shape missing required `git` (fixed).
- Full `test:unit`: the only failures are 18 `inspectNative` sandbox
  tests that fail identically on untouched `main` (verified in a clean
  worktree, since removed) — this rig's sandbox refuses the native
  helpers. Pre-existing and unrelated; every touched suite is green.
- `reviewUnavailable` wording gap (above) and the review-admission
  hardening are recorded here, not hidden.

## Real use through the packed product (brief §3)

Built with `npm run build` (exit 0); proof ran `node dist/acp.js` (the exact
bits the tarball ships — `npm run package:acp` cannot complete on this rig:
it requires the macOS-built `native/darwin/muse-dictate`, a pre-existing
environmental limitation, error recorded verbatim) from an empty folder.

1. CLI one-shot, `exec "/playback"` (exit 0): the reply opens with the
   exact marker line, then goal/instructions/done-doing/next/unsure/
   anything-else, all correctly reporting an empty conversation ("You have
   not yet given me a substantive task"). Receipt (`--output json`):
   `completed`, `exitCode 0`, `end_turn`, backend `museCode`, mode `plan`,
   `filesChanged []`, `inputs []`, `denials []`, paid `$0`.
2. ACP multi-turn session (raw ACP over stdio, acceptEdits): turn 1 "Read
   the file probe-file.txt…" ran 2 tool updates and answered "juniper
   berries"; turn 2 `/playback` ran **0 tool updates**, opened with the
   exact marker, and reported the juniper line from memory; `/playback
with extra words` answered the usage text with 0 tool updates; turn 4
   created `wrote-after-playback.txt` on disk with 0 permission requests,
   proving the Plan hold was put back (mode restore awaited before the
   prompt settles).
3. ACP advertises `playback` (`available_commands_update`) with the
   reference description; `/playback` typed or chosen runs the same turn.
4. A second CLI run's reply paraphrased the section headings but kept the
   marker line verbatim first — marking holds, content stays free.

What "no tool ran" rests on: exec receipts (`inputs []`,
`filesChanged []`, paid zero) and ACP turn updates (zero `tool_call*`
updates on every playback turn, vs 2 on the ordinary turn before it).

## Left undone (for the lead)

- Panel live run: no browser and no display on this rig (`ui:look`:
  "No Chrome install found"; no chromium/firefox binary at all), and no
  turn-driving integration harness exists. The panel path is typechecked,
  built, unit-covered at its seams (parse, palette row, protocol), and
  shares the proven submit/watch machinery — but no real `/playback` has
  gone through the panel yet.
- Model API live run (zero-tools offer + in-code refusal): unreachable
  here — no usable credential store (`auth status`: `store-unavailable`),
  and the brief forbids paid calls. The branch mirrors the proven
  reviewer gate line for line and is unit-covered (refusal names any tool,
  instructions keep goal+rules); it needs one stored-key run by the lead.
- Contributor-tier model run: same blocker (needs a stored Model API key
  with explicit opt-in; minimum $0.108135). Not run.
- SAST: `security:sast` exit 0, 0 findings (533 rules, 3241 files), plus a
  targeted re-scan of the two files whose rules timed out under the default
  deadline (`ModelApiHost.ts`, `App.tsx`, `--timeout 600`): 0 findings.
  semgrep itself is not installed on the rig; it ran from a lane-local
  venv (repo-pinned `requirements.txt`), removed afterwards.
- `npm run package` (VSIX) not run: unrelated to this change; `build`
  (which it starts with) is green.

## Review fix (RVPLAYBACK, 2026-10-17)

- A first-turn `/playback` on the Model API backend ran the git describe
  and the repo-map scan in `runTurn`, though neither result is in the
  playback prompt (`PlaybackFacts.environment` was never read). Both are
  now skipped for playback turns and the dead field is gone
  (`7ace2be80`). The standing context load (the rules the turn reports)
  and user hooks still run, as on a review turn.

## Review threads on PR #221 (2026-10-17, branch `ms/playback-threads`)

Seven unresolved threads (chatgpt-codex-connector), each fixed at its cause:

1. `src/acp/agent.ts` (P2, ACP active turn): fix. A `/playback` is refused
   busy while the session has a running turn (`activeTurnId`, e.g. one a
   resumed session carries), as the panel refuses it, so no Plan hold can
   land on another turn.
2. `src/host/conversation/conversationController.ts` (P2, watcher before
   submit): fix. The tool watch is armed before the playback is submitted;
   tool items that arrive before the acknowledgement names the turn are kept
   by turn and stop it the moment the turn is known. Same fix on ACP, which
   had the same gap.
3. `src/acp/agent.ts` (P1, restore vs `session/set_mode`): fix. Every
   backend mode command of an ACP session (the Plan hold, its restore and
   the client's `setMode`) runs in one chain, and the restore reads the mode
   when it runs, so the client's latest selection is the one left in force.
4. `src/acp/agent.ts` (P2, failed restore swallowed): fix. A restore that
   fails tells the editor the mode actually in force (Plan) with
   `current_mode_update` and says so in the conversation, instead of only
   logging.
5. `src/host/review/reviewBundle.ts` (P2, wrong failure text): fix. A
   playback that cannot load `dist/review.js` is refused with its own
   `playbackUnavailable` text; the retry on next use is unchanged.
6. `src/acp/agent.ts` (P1, extra ACP content): fix. `/playback` is
   recognised from the command text first; any further block or part makes
   it the usage reply, never an ordinary turn with tools.
7. `src/core/backends/modelapi/ModelApiHost.ts` (P1, role instructions):
   fix. The playback prompt keeps the active agent role's charter and the
   team's mode and roster instructions, still with no tools.

## PR #221 thread fixes verified (2026-10-17, branch `ms/playback-fix`)

The snapshot commit `d33813738` was undone (`git reset --soft HEAD~1`)
and recommitted as five reviewable commits (`a1838e77e` the shared
`PlaybackWatch`, `374fdca8d` the ACP fixes, `f1b1b79c3` the panel watch,
`6a4c64d2d` the playback failure text with its 3 locale keys in all 15
tables, `38e7c4578` the Model API instructions); the final tree is
byte-identical to the snapshot. `main-now` was already an ancestor, so no
merge was needed. Gate-fire proven: `PlaybackWatch.bind` forced to
`false` fails `playbackWatch.test.ts` (1 failed, reverted byte-exact),
and `playbackInstructionsFor` with the roster dropped fails
`playbackPrompt.test.ts` (1 failed, reverted byte-exact).

- `npm run typecheck` (all five projects): clean.
- `npx eslint src/ test/ --max-warnings=0`: zero warnings.
- `npx prettier --check` on every changed file: clean.
- `node scripts/check-l10n.mjs`: 0 problems.
- `node scripts/gen-reference.mjs --check`: current.
- `node scripts/check-plan.mjs`: 0 drift.
- `npm run build` (production + size budgets): green.
- `npm run deadcode`, `npm run cycles`, `npm run duplication`: green
  (0 clones, no circular dependencies).
- `npx vitest run test/unit/playbackWatch.test.ts
test/unit/playbackPrompt.test.ts --maxWorkers=3`: 4 passed, repo
  default timeout, no `--testTimeout`.
- Neighbouring suites `playbackCommand`, `paletteRegistry`,
  `instructions`, `lazyBundleFiles`: all passed.
- No stand-ins: the new and changed tests drive the real
  `PlaybackWatch` and the real `playbackInstructionsFor` with realistic
  input; no mock, fake timer, invented wire data, or text-exists check.

## Codex threads, second round (2026-10-17, branch `ms/playback-fix2`)

Verdict per thread (fixes follow as separate commits):

1. `conversationController.ts:7680` (P2, Muse Code tools before playback starts): fix by refusal. MSP is select-never-create with four host modes; the strictest (Plan/`denyUnmatched`) still runs reads and file-tool edits (`src/shared/permissionModes.ts`, SECURITY.md "Muse Code's file writes"), so no backend-enforced zero-tool turn exists on Muse Code. Playback is refused where the session has no backend no-tools turn; the Plan-held path goes.
2. `src/acp/agent.ts:2094` (P1, playback+attachments resolved before rejection): fix in code. The command is detected from the raw text block before `promptParts()`/`AcpMedia.block()` runs, and extra blocks are answered as usage without touching attachments.
3. `README.md:2339` (P1, panel and Model API claims unproven): answered with a narrowed claim. No panel harness exists and no stored Model API key may be used here, so the README will claim only the proven surfaces until the lead runs the two real playbacks.
4. `ModelApiHost.ts:4416` (P2, playback with `--output-schema`): fix in code. A playback with a configured headless output schema is refused before dispatch: a schema-compliant JSON reply cannot open with the documented verbatim marker line, so the combination is rejected rather than given precedence either way.
5. `conversationController.ts:7563` (P1, playback starts across shared panels): fix in code. Playback admission is claimed per shared session (not per controller) for the starting window; with fix 1 no Plan hold exists for a playback, so the restore-vs-queued-start race it describes is gone and the host queue orders what remains.
