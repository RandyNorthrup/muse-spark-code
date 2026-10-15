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
  their exit codes. Hosted CI is the gate for merges and releases. A failing
  or skipped check is reported as such, never as passing.
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
  unknown): state the expected number of calls and a dollar cap first, run
  in an empty workspace, count the calls afterwards and report them.
  Buying credits, paid plans and legal terms are the owner's. Never mint
  credentials or install without asking.
