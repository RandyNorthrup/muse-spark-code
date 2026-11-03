# CC-INT11 — merge round 11 on cc/int10 (started 2026-11-03)

Branch `cc/int11` starts at cc/int10 `5ecbaa766` (record: `docs/certification/cc-int10.md`, open items in its §8).
The round runs in four batches, each a fresh session; this record is what the next batch reads to carry on.

Rig `linuxlt`, `umask 022` for every command (the rig's `0002` makes the product's owner-only checks refuse fixture
folders). `npm rebuild node-pty` was run once in this worktree (merge 1: `shell.test.ts`'s real-shell case could not
load `pty.node` before it).

## Batch A — the foundations and every CI fix (budget $14)

Order (brief): rvint9, acpteam-reviewed, cc-m104gw, m109h-reviewed, cc-winfix6, rlf-cifixm, rlf-cifixc, cc-winteam,
rlf-judgep2; then build, typecheck, lint, check:mhp, check:plan, check:reference, check-l10n. The whole unit suite is
not run here: the lead sends the head to hosted CI next.

### Merge 1 — `lanes/rvint9` (72d8d5003)

Reviewed fixes: Desktop/external agent workspace path leaving through a symlink or junction; the stdio team bridge
posting its bearer to any URL (now literal loopback); the protected-path check missing `\` on Windows.

Conflicts:

- `desktop/app/terminals.ts` (header comment only): int has lane BP's node-pty header, rvint9 rewrote WB's to say the
  person's own shell keeps non-`*_API_KEY` credential names and an external agent's child is scrubbed by
  `withoutCredentials`. Merged into one header carrying both, and int's H13 read-only sentence.
- `test/unit/desktop/shell.test.ts` (imports): int's `DESKTOP_LAYOUT_FILE` and `DEFAULT_WORKBENCH_LAYOUT_V2` kept,
  rvint9's `scratchDir` helper added.
- `docs/ide-compatibility/host-api.md`: generated; regenerated with `node scripts/check-host-api.mjs --write` (exit 0,
  0 problems).

- `desktop/app/files.ts` (auto-merged): rvint9's new symlink skip sat beside the ignored-name skip, and int's
  unicorn 79 `prefer-combined-guards` refused it in the pre-commit hook; combined into one guard in the merge commit
  (the hook would not take the merge otherwise).

Interactions:

- rvint9 made `files.ts`'s `confinedPath` async (`confineToRoot` walks each link); int's lane-BP
  `confineTerminalCwd` still called it synchronously, so a terminal's working directory got a Promise and skipped the
  symlink check. `fix(int)` commit after the merge: `confineTerminalCwd` is async, `main.ts` awaits it before
  creating the terminal, `panelSessions.test.ts` awaits it and adds a symlink leaving the workspace as a refused cwd.

`shell.test.ts` 7/7 after `npm rebuild node-pty` (exit 0).

### Red/green drills (batch A)

- Merge 1, terminal cwd through a link: `confineTerminalCwd` made lexical-only for in-root names →
  `panelSessions.test.ts` exit 1 ("promise resolved … instead of rejecting"); reverted → exit 0.
