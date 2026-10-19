# Real use — release 0.19.0's newest pull requests in the real editor (linuxlt, 2026-10-18, TONIGHT)

Product: Muse Spark Code (Unofficial) 0.19.0, packed from this branch at
`5d19b71f5b` (after the F67 fix; the pre-fix round ran at `0e72511a98`).
VSIX `muse-spark-code-0.19.0.vsix`, 3302337 bytes (budget 3788800).
VS Code 1.139.0 under Xvfb (own Xvfb on :97; flags `--no-sandbox
--disable-gpu --disable-dev-shm-usage` for the container), isolated
`--user-data-dir` and `--extensions-dir` in the worktree's `temp/runewprs/`,
driven over CDP from scripts in `temp/runewprs/` reading the panel webview's
DOM (no screenshots). Scratch workspace: a fresh folder outside the worktree
(`$TMPDIR/rws`), because the lane worktree's `.git` is a worktree pointer
file and Muse Code's Linux sandbox helper fails on it (exit 125;
environmental, not a product defect — see #251 notes). Backend: Muse Code
(`muse` 1.4.10, real `muse-bin serve`, connected in ~1.3 s). Model: the panel
offers `muse-wonder-1.0`, `muse-wonder-full-1.0`, `muse-spark-1.3`,
`muse-spark-1.2` — no `muse-spark-1.3-contributor` is offered, so the
`-contributor` name is refused by omission (recorded; CONTRIBMODE owns the
product side). Every turn below ran on `muse-spark-1.3` on the contributor
account: 14 panel turns, each answered; the approval batches also run the
Muse Judge on the same model ("Judge: Same Model · muse-spark-1.3 ·
Subscription" under every card). No `--model` flag was passable in the panel;
the session model pill read `muse-spark-1.3 High` throughout.

## Merges (one commit each, conflicts kept both intents)

- Step 1 `5af3b89853`: `cand/RUNEWPRS/1` (PR #250). CHANGELOG conflict
  (release section vs `### Added`): kept both. Typecheck 0,
  `sessionDelete` 3/3.
- Step 2 `711f77c23b`: `cand/RUNEWPRS/2` (PR #251). CHANGELOG conflict
  (both `### Fixed` additions) and PLAN.md D140 vs D123: kept both.
  Typecheck 0, `permissionModes` + `sessionDelete` 14/14.
- Step 3 `8c91573c04`: `cand/RUNEWPRS/3` (PR #203, `dc30faaadc`) is already
  in history via merge `7374e26283`, undone by the 0.19.0 release hold
  `659d179ff1` ("held for the next release", unproven in real use). A fresh
  `git merge` is a no-op, so the step reverted the hold instead, restoring
  exactly the ten #203 files, no conflicts. Typecheck 0, `turnNotice` 7/7.
- Step 4 `ba28b300bc`: `cand/RUNEWPRS/4` (PR #249). CHANGELOG (`### Added`
  vs `### Security`), `src/extension.ts` (proxy-rebuild `helperProbe` vs
  `workspaceRoot` spread) and `src/host/voice/dictationHost.ts` (proxy
  refusal vs `realpath`): kept both — refusal branching plus the realpath
  line. Typecheck 0. The merge surfaced one red suite: the new PATHGUARD
  spawn inventory did not know the release's Linux sandbox probe
  (`sandbox.ts` `execFile`). The probe resolves `bwrap` off absolute PATH
  entries and refuses workspace-inside binaries before spawning, so fix
  `0e72511a98` records it as guarded (test-only record + CHANGELOG line,
  no behaviour change). Afterwards `pathGuard`/`pathGuardRound4`/`pathGuardSpawns`
  39/39, `executables` included, `helperLocation` + `voiceNetwork` 22/22.

## #251 Manual really asks — PASS

Mode pill read `Permission Mode: Manual` throughout (the default in the fresh
profile). Three command turns, an approval card before every one
(`Muse wants to echo … — Allow once / Always allow in this workspace: echo
... / Reject`, "Waiting for your approval, in the card above the message
box"):

- `echo MANUAL-PROBE-1` → Reject → turn ended with
  "The command echo MANUAL-PROBE-1 did not run — approval was aborted."
  Nothing ran. PASS.
- `echo MANUAL-PROBE-2` → Reject on the unsandboxed-retry card →
  "Couldn't run echo MANUAL-PROBE-2. … The approved retry was rejected, so
  it didn't run." PASS (second honoured rejection).
- `echo MANUAL-PROBE-3` → Allow once → "Ran a command and used a tool —
  Done. Output: MANUAL-PROBE-3". The approved command ran and printed.
  PASS.

Notes, not defects: the model narrates the sandbox block honestly ("retrying
with approval to run unsandboxed"); unapproved attempts fail here because
bubblewrap cannot create a user namespace in this container (the product says
so in words, once, with both remedies). One judge batch was seen failing
with "no completed reply in time" in the Output log; the turn still completed
through the human card.

## Two-turn conversation — PASS

1. "Reply with exactly: READY-FOR-REALUSE" → answered `READY-FOR-REALUSE`.
2. "Create probe-two.txt with exactly these 3 lines" → created in the
   workspace root; `cmp` against the expected bytes matches: 50 bytes,
   `ALPHA-ONE\nBETA-TWO\nGAMMA-THREE\n`. The Write ran without an approval
   card (workspace edit, as Manual promises); the follow-up diagnostics MCP
   check asked and was allowed. PASS.

## #250 session delete — PASS on the Muse Code backend; Model API side unreachable here

- History dialog on the Muse Code backend lists the conversation (title,
  `Current`, `now · 3 turns`) with Save Prompt, search, Show Archived and an
  Archive icon per row — and no Delete control anywhere (dialog, row,
  Session Board, which shows only `Best of N…`). The CLI serves no
  `session/delete` (1.4.10), so nothing is offered, exactly as the PR
  records. Conversations persist across a window reload. PASS (the "cannot"
  side: plain absence, no fake delete).
- The "can" side needs the Model API backend: switching to it shows
  "Sign In to Muse Spark — Use a Model API Key … Not signed in". This
  sandbox holds no Model API key and lanes never handle credentials, so no
  deletion could be performed there. Recorded, not claimed.

## #203 background-turn notice — PASS

Setting `museSpark.notifyOnBackgroundTurn` on (default), VS Code unfocused
(second X window focused; `vscode.window.state.focused` false):

- A turn that waits on a Manual approval card → exactly one toast:
  "Muse is waiting for your approval." with a Show Conversation button.
- A turn that finishes while unfocused → exactly one toast:
  "Muse finished responding." with a Show Conversation button
  (one per event; no duplicates across a 3-minute watch).
- Clicking Show Conversation → the Muse Spark activity item is `checked`
  (the conversation in view). PASS.
- Focused Q&A turn → zero toasts across the whole turn. PASS.
- Setting off + unfocused approval-wait (card pending 3+ minutes) → zero
  turn toasts. PASS (a resource-governor toast "Machine busy: CPU Use is 95%
  (limit 85%)" appeared during this window — a different, dynamic-cap
  notification, out of this lane's scope).

## #249 PATH guard — PASS

Fakes named `muse git bash bwrap node ssh` (plus a caller-logging `git`)
placed in `$TMPDIR/rws/bin`, first on PATH for the launched VS Code:

- The backend runs the real `/home/randy/.local/bin/muse-bin-1.4.10
serve` (started after launch; the panel resumes and answers). A planted
  `muse` would have exited 99 and left the panel dead. PASS.
- An approved `echo GUARD-PROBE-OK` from the panel ran and printed
  `GUARD-PROBE-OK`. PASS.
- Marker log after start + command: exactly one line,
  `git --version` from a VS Code utility NodeService process. Control run
  with our extension disabled fires the identical line → VS Code's own
  built-in git probe, not our extension (whose git goes through the
  bound-root-refusing absolute locator). No `muse/bash/bwrap/node/ssh`
  invocation anywhere. PASS.
- (`sh` was deliberately not faked: the `code` launcher itself needs it;
  the product guards `sh` through the same route as `bash`.)

## Composer placeholder (F67) — FAIL, then fixed and re-proven

Pre-fix panel: `ctrl esc (cmd esc on macOS, ctrl alt esc on Windows) to
focus or unfocus Muse` — the old three-platform tip. FAIL as the brief
requires. Fix `5d19b71f5b` (smallest slice of the panel-text change,
restructured into the vscode-free pure module the later revision chose):
`composerPlaceholder: 'Ask Muse…'` plus
`composerPlaceholderWithShortcut: 'Ask Muse… ({shortcut} to focus)'`,
host fills per platform, all 14 tables translated, `check:l10n` 0 problems,
new `test/unit/composerPlaceholder.test.ts` 2/2, typecheck 0, eslint 0,
prettier clean. Rebuilt (`npm run build` exit 0, budgets held), repackaged,
reinstalled, re-verified live: the composer reads
`Ask Muse… (Ctrl+Esc to focus)` — one line, message first, this machine's
key only — and a smoke turn answered `FIXED-BUILD-OK` in 10 s. PASS.

## Environment notes (not product defects)

- The first VS Code instance died once mid-turn with no crash dump
  ("Muse Spark Code stopped unexpectedly last time" on next start; rig under
  CPU pressure at the time — the governor showed CPU 95% vs its 85% limit).
  State survived; the run continued. Reported, cause UNMEASURED.
- The packed `.vsix` on this x64 rig needs a local-only, never-committed
  packaging trim (the single `.vsix` requires the arm64 helper, which needs
  a cross toolchain this rig lacks; CI assembles the release artifact).
  Reverted after each packaging; the tree carries no trace.
- `npm run build` fails while a stale `dist/vsix-package/` stage dir from a
  previous `npm run package` sits in `dist/` (the lazy-registry inventory
  walks it: 258 phantom problems). Removing the regenerable stage dir
  returns the gate to green. Worth a lead look: package should clean its
  stage, or the gate should ignore it.
- `museSpark-1.3-contributor` is not offered anywhere (panel, picker);
  used `muse-spark-1.3` on the contributor account instead, pill
  `muse-spark-1.3 High` on all 14 turns.

## Verdicts

#251 PASS · two-turn PASS · #250 PASS (Muse Code side; Model API side not
reachable without a key) · #203 PASS · #249 PASS · placeholder FAIL→fixed→PASS.

## macOS part — the same behaviours over ACP and the CLI (lane RUNEWPRSM, macOS)

PRs: #250 (session delete), #251 (Manual really asks), #203 (ms/msm82),
#249 (muse-serve path guard). Panel items belong to the Linux job RUNEWPRS
(real editor); this lane drives the same behaviours over ACP and the CLI
on the owner's MacBook: no browser, no GUI app, no VS Code, login
keychain never touched.

- Product: production bundles from `npm run build` in this worktree (exit
  0, no What's New trim needed), driven as `node dist/acp.js` (the same
  bytes the ACP tarball ships). The macOS `native/darwin/muse-dictate`
  helper built here (`DEVELOPER_DIR=/Library/Developer/CommandLineTools
bash native/darwin/build.sh`, Apple's `/usr/bin/git` shim is broken on
  this laptop for lack of Xcode; the CLT git did everything). Full
  `npm run package:acp` does NOT complete on macOS: it requires the Linux
  `native/linux/*/muse-created` helpers, buildable only on Linux (CI
  builds them there). Not a code defect; the lead packs on Linux.
- Version: **0.19.0**, git sha
  **f480fb459e1f256556d717a2a47f7b5b09815f2b** (merges 1–4 plus two
  merge-completion fixes; §7).
- Merges: `96d62a442` (#250), `89992aca9` (#251), `453887796` (#203, a
  revert-of-revert: #203's head `dc30faaadc` was already an ancestor
  through its release-branch revert `659d179ff`, so a direct merge is
  "already up to date"; the re-apply restores its content for proof),
  `ccc09625e` (#249). Conflicts kept both intents (CHANGELOG sections,
  PLAN D123 beside D140, `:ask-me` profile inside the M56 proxy-refresh
  voice setup, `realpath` inside the refusal wrapper, host-api count 78).
- Rig: MacBook (owner's laptop). Every run in a fresh folder,
  `temp/ws-acp/`, under this lane's sandboxed HOME: the owner's real
  sign-in was never moved and no key was ever read, printed or stored.
  HOME holds no Muse Code sign-in and no Model API key (`report`: "cli:
  found; signed in: no", "stored model api key: no"), so all model turns
  below ran on the unsigned host's offered model `muse-wonder-1.0`.
- Models: 5 turns on `muse-wonder-1.0`, ledger `settled $0.000000`
  every time (no billing identity exists here). The brief's
  `--model muse-spark-1.3-contributor` is refused exactly (§6): the
  unsigned host offers only wonder/spark non-contributor models, even
  with `--allow-contributor-models`. No contributor-tier account is
  reachable from this sandbox, so the offered model carried every turn.
- Driver: `temp/acp-drive.mjs` (scratch, gitignored) speaking ACP stdio
  to the packed agent; transcripts `temp/drill1*.jsonl`. Permission
  answers: deny unless stated.

## Behaviours exercised for real

1. **#251: Manual asks before every command over ACP; denial honoured
   (PASS).** Session starts in `manual` (`currentModeId`, approval mode
   `promptUnmatched` on the wire). Trusted workspace (shell enabled):
   asked to run `touch temp/ws-acp/manual-proof.txt`, the model raised
   `session/request_permission` (`Bash: touch …/manual-proof.txt`,
   options Allow once / Always in workspace / Reject) before running
   anything. Driver answered Reject. Product: tool call `failed` with
   `approval aborted`; the turn's words: "The command did not run:
   approval was aborted, so it printed nothing." (`end_turn`).
   `manual-proof.txt` does not exist. **PASS.**
2. **#250: session delete over ACP — the plain refusal (PASS).**
   `sessionCapabilities` on the Muse Code backend advertises
   list/resume/close and no `delete` (delete is advertised on the Model
   API backend only). `session/delete` answers
   `-32603 "Internal error: Muse Code 1.4.10 cannot delete
conversations."` — the CLI version and the real cause, matching
   `docs/certification/sessiondelete.md` (no `session/delete` from
   1.4.4 on, verified here on 1.4.10). The row stays in `session/list`.
   **PASS.** The Model API success path is unreachable here: without a
   key the backend refuses `session/new` with `store-unavailable`
   (credential store unusable in this sandbox), so there is no Model API
   store to delete from. Not run, reason recorded.
3. **#249: planted helpers, git and bash first on PATH are never run on
   macOS (PASS).** `temp/ws-acp/bin/` holds logging `muse`, `git`,
   `bash`, `sh`, `bwrap` (exit 127, append to `plant.log`), first on
   PATH for every agent process below. Across six agent runs —
   session/new, list, delete, prompts, model turns, serve with
   `--disable-shell`, `--disable-sandbox --disable-shell` and
   `--trust-workspace` — the agent logged
   `Spawning /Users/user/.local/bin/muse serve …` (the real CLI,
   workspace entries stripped) and `plant.log` stayed empty. The agent's
   own `muse`/`git` lookups resolve absolute PATH entries only, so the
   plants never resolve. **PASS.**
4. **Two-turn conversation over ACP (PASS).** Turn 1: "Reply with
   exactly this line and nothing else: HELLO-LANE" → `HELLO-LANE`,
   `end_turn`. Turn 2: create `hello.txt` with exactly
   `HELLO-LANE-TWICE-0123` → the model first tried Bash (denied again,
   `approval aborted`), then the Write tool; `od -c` reads exactly the
   20 bytes, no trailing newline. **PASS.**
5. **CLI exec on the offered model (PASS).** `exec "Reply with exactly:
HELLO-EXEC"` → exit 0, stdout `HELLO-EXEC`, ledger `settled
$0.000000`. **PASS.**
6. **#203 (M82 notice) over ACP: not reachable, reason recorded.**
   The unfocused-turn notice and Show Conversation action live in the
   VS Code window (`showInformationMessage`); `src/acp/agent.ts` and
   `src/runtime/` carry no background-notice path, so there is nothing
   to drive without an editor. Unit proof on this tree:
   `test/unit/turnNotice.test.ts` 7/7 on the repo's own timeout; the
   integration suite needs the real Extension Development Host (the
   Linux job runs it). The editor drill stays with RUNEWPRS.

## Defects found live, fixed on this branch

7. **Refused `session/delete` dropped the open session (FAIL → fixed,
   PASS).** Drill: new → delete (refused as in §2) → prompt answered
   `-32002 "Resource not found"`. Cause: `AgentState.deleteSession`
   (`src/acp/agent.ts`) released the held copy before checking
   `canDeleteSessions`. Fix (`f480fb459`): the capability is checked
   first; a refusal leaves the held session and remembered choice
   untouched (the release-then-delete order stands for backends that
   can delete). Re-drilled on the rebuilt bundles: delete refused,
   prompt answers. No stand-in test can cover this (a stub host is
   forbidden); the live transcripts are the proof. **PASS after fix.**
8. **Merge 4's spawn inventory vs the branch's Linux sandbox probe
   (FAIL → fixed, PASS).** `test/unit/pathGuardSpawns.test.ts` (new
   from #249) flagged `src/core/backends/musecode/sandbox.ts:
execFile` — the release branch's `bwrap` probe, newer than the
   candidate's record. The probe resolves through absolute PATH
   entries only, refuses workspace-inside binaries, and spawns the
   absolute path with no shell: reviewed into the record
   (`ce51182a6`), not weakened — the suite still fails on any other
   new spawn (observed red before the entry, green after). **PASS.**

## Gates and suites on the final tree

- `tsc --noEmit -p tsconfig.json`: 0. Touched suites (repo's own
  timeout, working CLT git first on PATH — this laptop's
  `/usr/bin/git` shim is broken without Xcode): `sessionDelete` 3/3,
  `permissionModes` 11/11, `turnNotice` 7/7, `pathGuard*` +
  `executables` green. `pathGuard.test.ts`'s planted-git case fails
  identically on the untouched candidate (same 1 failed / 16 passed):
  it resolves the rig's broken `/usr/bin/git`; environmental, measured,
  not a regression.
- `npm run build`: exit 0, budgets held. `package:acp` stops at the
  Linux-only helpers (above); recorded as not-a-defect.
- Final gates, true exit codes: `typecheck` (all five projects) 0;
  eslint zero warnings on all 46 changed sources; prettier clean on all
  75 changed files plus this record; `deadcode` 0; `cycles` 0;
  `duplication` 0 clones; `check:l10n` 0 problems; `check:reference`
  current; `check:host-api` 0 problems (regenerated 78 → 79: merges
  1–3 added a host-reachable `node:fs` user); `check:plan` 0 drift;
  `check:roadmap` current; `security:audit` 0 (2 advisories, 1
  exceptioned); named suites 70/70 (`sessionDelete`,
  `permissionModes`, `turnNotice`, `pathGuard`, `pathGuardRound4`,
  `pathGuardSpawns`, `executables`) on the repo's own timeout.
  `security:sast` NOT RUN: semgrep is not installed and cannot be
  installed here — no prebuilt wheel for this Python/macOS pair and the
  source build needs a Rust toolchain (`rustup could not choose a
version of cargo`); system pip is PEP 668 externally-managed (left
  alone). The lead runs SAST outside the sandbox. Whole-repo lint and
  the full unit battery are hosted CI's gate (not run locally per the
  lane rules).
