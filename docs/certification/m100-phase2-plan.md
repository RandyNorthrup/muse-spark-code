# M100 phase 2 — planning record (docs only, 2026-10-07)

Lane M100P2PLAN, worktree `/Users/user/lanes/M100P2PLAN`, branch
`plan/m100-phase2` from main `8c6351d73`. This lane wrote documentation
only: the "M100 phase 2" section in `PLAN.md` (after the phase-1 M100
section, before M41) and this record. No code, no tests, no model calls.

## Sources read

- `PLAN.md` D80 (ten decisions) and the M100 phase-1 section in full
  (phase 1 integrated as `m100/int`, accepted).
- `docs/orchestration-gotchas.md` (register ends at G27) and `PLAN.md`
  D100 item 3 (amendments naming M100: G1, G2, G5, G6, G12, G14, G15, G27).
- Lane inputs: `OLP-requirements.md` (ten must-haves from the 2026-10-06
  fleet run), `ssh-limits-research.md` (MaxStartups/MaxSessions/
  PerSourcePenalties soft limits; Windows desktop-heap hard limit; proposed
  as G29–G31, now the register's G50–G52), `playbook-placement.md` (leg
  profiles, capability records, never-duplicate rule).
- Lead's phase-2 note: owner binding, QR/mDNS discovery, Windows store
  protection, concrete per-action controls, installed-host plus
  four-device qualification with the simulators rule.

## What was written

The `PLAN.md` section defines goal, scope (with explicit out-of-scope
carried from Q-M100), dependencies (phase 1, M96c, M107, M109, D101 when
it lands — D101 is not in `PLAN.md` yet, so no lane waits on it), and ten
lanes with exclusive file ownership, rig placement, and per-lane
acceptance plus red drills. Order: lane 0 (contracts/threat model, lead)
first, D/C/R/V after 0, H/A/K on their dependencies, U against fakes,
W last. D100 amendments are marked on their lanes; the SSH-limit rules are
flagged for the register before lane C enforces them, and now live in its
G50–G52 rows.

## Checks

- `npx prettier --check PLAN.md docs/certification/m100-phase2-plan.md`
  (this lane's only gate; no code changed).
