# M98 GH — hook CLI boundary (2026-10-05, Kubuntu)

Rig brief: `/home/randy/lanes/_ctx/M98GH.rig.md`; shared rules:
`/home/randy/lanes/_ctx/codex/common.md`. Base `813fdebd` (`m98/g2`).
Read AGENTS, PLAN D77/M98, M98 research, planning/P0/G receipts, and
M91's native/foreign contracts and capture manifests. No real inference,
paid call, credential read, dependency install, push or rebase is authorized.

## Required M91 merge

Merged `preview/m91` at `2bcfb044d94caa7a6be5c91e6c3ce9265e9dfde0`
with `--no-ff`. This explicitly authorized dependency merge imports M91's
real hook contracts and its existing integrated prerequisites. Conflict
resolution preserves both judge and hook features, both translated key
sets, M98's engine modes, the D78 defaults/daily budget and the judge's
legacy startup exclusion. No independent feature work changes shared files.
The two USD formatters have different signatures; the merged paid popup
uses the localized formatter with its explicit two-decimal argument.

Baseline checks before GH implementation:

- `npm run typecheck`: all five projects passed after resolving the USD
  formatter signature conflict.
- `node scripts/check-l10n.mjs`: 14 tables, 144 manifest strings, 516 source
  files, **0 problems**.
- Whole-file Vitest batch (`--maxWorkers=3 --testTimeout=120000`):
  `hookFormatsContracts` and `paidHost` passed; `judgeActivation` has six
  inherited failures. Its fixture supplies the old startup gate without
  M91's default-on/availability dependencies, so the now-default-on paid
  settings produce seven legacy confirmation calls. An initial callback
  extraction failure was resolved by keeping the merged dependencies before
  `isSettingOn`; the six policy-fixture assertions remain for P0/Z. After
  two attempts this path was stopped under the shared rules. No test,
  setting default or paid gate was weakened to hide it.

## Integration constraints

G alone owns parser/dispatcher registration; P0 owns model/UI text, and Z
owns wiring, README/CHANGELOG, package scripts, snapshot updates and full
quality. GH will provide the hook adapter and its injected contract, not
edit their files. New guards receive named red mutations, SHA-256 restores
and whole-file green reruns below. Aggregate quality/coverage and live or
installed-host delivery are not claimed by a bounded fake-only lane.

PLAN's CLI exit 4 for no answer conflicts with M91's Gemini/Copilot
pre-tool contracts, which interpret that exit as a veto. This needs an
explicit hook-abstention policy before registering those events; no grant,
veto or guessed neutral field is an acceptable workaround. Some events
(Windsurf stdout, Cursor permission rows without a neutral response, Kiro
tool stdout) also lack an advisory-only output. These limits must remain
visible and must never cause a paid dispatch with nowhere to use its result.
