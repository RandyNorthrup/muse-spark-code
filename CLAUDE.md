# CLAUDE.md — project instructions

Follow `AGENTS.md` in full; it is the single source of working rules for this
repository. This file adds only Claude-specific notes.

- Start every task by reading `PLAN.md` (decisions §2, open questions §3,
  the latest milestone in §6, escape-hatch register §8, the release records
  in §10).
- Before proposing a commit, run `npm run quality` and paste the tail of its
  output. A failing or skipped gate is reported as such, never as passing.
- When a gate or test is added, break the code on purpose once, confirm the
  non-zero exit, revert, and record it in `docs/certification/<milestone>.md`.
- Never modify `~/.claude`, global VS Code settings, or any machine-wide
  configuration from this project.
- The tests run against fakes (`test/unit`, `test/e2e`); nothing in the
  gate needs the Muse Code CLI or a Meta Model API key. A live check bills
  the owner's Muse subscription: state the expected number of model calls
  first, run it only in an empty workspace, count the attempts from the
  CLI's trace log afterwards, and ask before anything beyond one short turn.
  Never mint credentials or install anything without asking.
