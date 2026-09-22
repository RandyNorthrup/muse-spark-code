# CLAUDE.md — project instructions

Follow `AGENTS.md` in full; it is the single source of working rules for this
repository. This file adds only Claude-specific notes.

- Start every task by reading `PLAN.md` (decisions §2, open questions §3,
  current milestone §6, escape-hatch register §8).
- Before proposing a commit, run `npm run quality` and paste the tail of its
  output. A failing or skipped gate is reported as such, never as passing.
- When a gate or test is added, break the code on purpose once, confirm the
  non-zero exit, revert, and record it in `docs/certification/<milestone>.md`.
- Never modify `~/.claude`, global VS Code settings, or any machine-wide
  configuration from this project.
- The Muse Code CLI (`muse`) and a Meta Model API key may be absent on the
  machine. Do not install the CLI or mint credentials without asking; write
  fake-transport tests instead and mark live certification as pending.
