# CLAUDE.md — project instructions

Follow `AGENTS.md` in full; it is the single source of working rules for this
repository. This file adds only Claude-specific notes.

- Start every task by reading `PLAN.md` (decisions §2, open questions §3,
  the latest milestone in §6, escape-hatch register §8, the release records
  in §10). §2 keeps each decision's rule in force; its full design record,
  closed milestone sections and older gate records live in
  `docs/plan-archive/` (`decisions.md`, `milestones.md`, `gates.md`).
- Before proposing a commit, run the fast local checks (format, lint,
  typecheck, the suites you touched, the packed-product tests) and paste
  their exit codes. A pull request merges only with hosted CI green on its
  first run, every review thread answered, and a real use of what it changes
  through the packed product recorded on the pull request; a release adds the
  real-life run. A failing or skipped check is reported as such, never as
  passing.
- When a gate or test is added, break the code on purpose once, confirm the
  non-zero exit, revert, and record it in `docs/certification/<milestone>.md`.
- Never modify `~/.claude`, global VS Code settings, or any machine-wide
  configuration from this project.
- Tests run real code only, no exceptions: no stand-in for our modules, a
  provider, the CLI, GitHub, an MCP server, the editor API or a store, no
  local server answering as a provider with hand-written answers, no
  screenshot or frame comparison of any kind. A UI change gets one small
  local look (`npm run ui:look -- <scene>`); the packed product's real-life
  run is the product's test. Hosted CI needs no key. Before a release, real
  conversations run through the packed product on the cheapest models (the
  Meta contributor model by its explicit name; never a request whose tier is
  unknown): state the expected number of calls first, run in an empty
  workspace, count the calls afterwards and report them.
- Buying credits, paid plans, legal terms, the owner's passwords and his
  two-factor steps are his. Everything else the lead decides and does
  without asking him (owner, 2026-10-17: "you dont need anything from me").
- Anything that can take more than a few seconds (builds, tests, ssh, landing,
  cleanups, loops) runs in the background; the owner's chat is never blocked.
- Before stating a time, a duration, a count or where something is, check it
  (the clock, the run's own timestamps, the records); otherwise say it was not
  checked.
- "Stop" stops everything started, scheduled rounds included, until the owner
  says go. A question from the owner gets an answer, not actions.
