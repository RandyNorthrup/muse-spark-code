# Real use of the release's newest pull requests — 2026-10-18 (lane RUNEWPRSM, macOS)

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
