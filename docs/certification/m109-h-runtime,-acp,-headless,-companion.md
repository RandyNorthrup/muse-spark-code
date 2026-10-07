# M109 H runtime, ACP, headless and companion

MacBook Pro rig, `/Users/user/lanes/M109H`, branch `m109/h`, base
`8a151dd40`. Scope: D89.12's non-VS-Code rows; acceptance 10, 13 and 19.
Read D89 and M109, the research and lane-0 handoff, V1–V16 threat model,
shared lane rules and orchestration gotchas. Model attempts and paid calls:
zero. No credentials read. No dependency or machine setting changed.

The rig brief overrides common.md's historical merge/remote-test steps.
Run focused tests directly, at most three files and three workers, with the
repository's default timeout. The lead owns aggregate quality and integration.

## Integration contracts

- B's public protocol has status, lock, grants, audit and use answers, but
  no terminal item-management or pending-watch transport. H supplies a typed
  command port; B/C/M/S bind item entry, import and public-key operations.
- W supplies the installed `dist/vault.js` runtime factory through H's typed
  module contract. Missing or malformed bindings fail closed with a fixed
  localized error. No production fake or guessed private wire frame.
- U and M104 are absent on this base. H routes existing lane-0 value-free
  panel contracts through injected authenticated ports. Companion entry never
  receives values; native add/edit uses its own terminal.
- X/R bind headless engine uses to H's unattended session port. A denial
  ends exec independently of the ordinary `--fail-on-denial` setting.
- `featureCatalog.ts` and its generator are absent. W must register all
  terminal subcommands, `/vault`, and local exec `--vault` at integration.

## Progress

H handlers implemented. The five new focused files pass 103 tests at default
timeouts; changed-file ESLint and localization pass. Red drills and final
repository checks are in progress. Full M109 certification
remains open. Browser/visual editor matrix is a handoff: this rig has no Chrome;
H changes no React component, stylesheet or visual layout.

## Stopped verification path

H58's additional `FakeAgentHost.cancel` spy assertion failed initially and
again after two fixture changes: remove immediate completion, then hold the
fake turn open. Both runs still proved exit `denied` and one vault-session
close. common.md requires stopping a path after two failed fixes; no further
spy/production-cancellation rewrite was attempted. PLAN §7 records the
explicit deferral. H58 retains its denial/cleanup assertions. Actual backend
and feeder-tree stop must be checked with B/X's installed lifetime binding;
the pre-existing exec lifecycle regressions remain part of final verification.
