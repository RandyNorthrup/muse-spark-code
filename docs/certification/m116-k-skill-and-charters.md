# M116 K — skill and reviewer charter

2026-10-06, Kubuntu, branch `m116/k`, supplied base
`f908a788d8bfd5d95407cf423b332ef25b1a81a6` (lane 0 and accepted lane P).
Read the rig brief, shared rules and gotcha register, AGENTS.md, PLAN D96 and
M116 in full, the frozen contracts and the relevant M70/M68/M89/M92 and
REDM116P certification evidence. Validated the finished skill with
`muse skills validate first-party-skills/orchestrator_playbook --json`:
`valid: True`, zero diagnostics, `compatible` under
`agent-skills-common-subset`. (The `create-skill` authoring skill governs
`.agents/skills/` project skills, a different system; this lane's artifact is
a first-party extension skill under D68's path, so the validator output is
recorded here as evidence, not as that skill's workflow.)

## Delivered scope

- `first-party-skills/orchestrator_playbook/SKILL.md`: nine rules, the design
  decision fields and self-contained M70e/REDM116P examples. It preserves
  trusted module/agent/session identities, lower-only patch limits, the
  impossible-only closure, dispositions, existing permissions and immutable
  rule nine. It teaches structured inputs (G3), base-age/merged verification
  (G4), serialized lease coordination (G8), read-only shared Git configuration
  (G17), complete review/outcome receipts (G18/G19), no classifier reroute
  (G20), and named residuals before release (G24).
- The Model API discovers the real skill through the existing bounded,
  setting-controlled first-party root. Its body is read through the existing
  skill path; project/personal copies retain precedence.
- Muse Code's existing explicit installer now copies first-party skills and
  their references into its marked package and links their ids beside the
  vendored workflows. User-owned ids remain untouched. First-party content
  has a full SHA-256 release digest, so first-party-only changes offer Update;
  removed ids use the existing owned-link removal. Missing sources, invalid
  ids, non-file SKILL.md and links refuse instead of reporting partial success.
  Vendor-list separators normalize to `/` for Windows.
- `PLAYBOOK_MODEL_TEXT.playbookReviewInstructions` has one declared reader,
  `dist/bundledSkills.js`. The existing lazy bundle exposes
  `bundledSkillsLoader(...)().playbookReviewerCharter()`. The charter asks for
  the eight classes, truthful coverage, finding dispositions, independent
  reviewer evidence and exact prior-id redesign resolutions. Its example
  parses with the real schema and closes a scripted real-policy redesign.
- No ordinary conversation or M70 review builder changed. A SHA-256 golden
  pins six fixed ordinary instruction/review outputs; loading the charter
  changes none. No new UI chunk, model call, paid feature, dependency,
  setting, command or UI/manifest localization key. Existing caps stand.
- The feature catalogue and generated reference explain actual availability
  and the remaining integration bindings. Host API regeneration adds one
  `node:crypto` importer; no VS Code API changes.

## Named integration handoffs

- **M116-K-I-review-charter:** I injects the existing lazy bundle's charter
  accessor only into orchestrated playbook review requests, provides the
  trusted identities and all actual prior ids as structured untrusted review
  material, and passes the complete parsed block to P. Ordinary M70 requests
  stay unchanged. K supplies the concrete callable interface, not a fake
  planner or a speculative dependency implementation.
- **M116-K-W-editor-packaging:** W and the runtime/editor owners package and
  bind this skill/charter for ACP and other editors. This base's ACP package
  has no bundled-skill source. The extension's two backend paths and the
  editor-neutral policy format are proved here; native editor/ACP shipping
  is not claimed. No VS Code-specific policy was introduced.
- **M116-K-W-docs-quality:** W owns README, CONTRIBUTING, CHANGELOG, AGENTS
  rule 14, ACP guide and integrated milestone certification. Describe the
  actual skill, first-party install/update lifecycle and playbook-only charter
  there with I/U once joined. The lane brief forbids full `npm run quality`
  and unlisted merges/push/rebase; the lead runs full joined-tree quality.
  This is the bounded-certification exception to the general pre-commit
  full-quality rule, with no gate weakened.

No review finding is deferred as a residual. The bindings above are planned
lane boundaries; this certification does not mark M116 complete.

## Checks and red drills

Initial focused run: the pre-existing installer suite passed 31 tests.
The first joined run exposed two test-fixture method mistakes (`refresh`
instead of `load`/`refreshSkills`), corrected to the real API, and established
the fixed pre-K request digest. Both owning suites then passed 41 tests with
the repository's default timeout. No timeout override, live/paid attempt,
network call, install, push, merge, rebase, credential read or gate change.

Final checks (Kubuntu rig, direct runs, repository default timeout, no
`--testTimeout`): `test/unit/playbookSkill.test.ts` (5 passed) and
`test/unit/bundledSkillsInstall.test.ts` (37 passed) together 42 passed;
`npm run typecheck` exit 0; eslint `--max-warnings=0` on all changed files
exit 0; prettier `--check` on all touched files exit 0; `check:l10n`
0 problems; `gen-reference --check` exit 0; `check:host-api` 0 problems;
`npm run build` exit 0 (extension 442.5 KiB of 600, modelApi 446.9 KiB of
475, bundledSkills 19.2 KiB of 50); knip exit 0; jscpd 0 clones.
No timeout override, live/paid attempt, network call, install, push, merge,
rebase, credential read or gate change. No new dependency, setting, command,
UI/manifest string, or `as`/`any`/eslint-disable needing a PLAN §8 row.
Hook availability was checked at `.husky/_/pre-commit` before
the first local commit; hooks are not rewritten or bypassed.

## Red drills (each: break, named failure, byte-exact restore by SHA-256)

Baseline hashes recorded before the first drill; after every restore
`sha256sum -c` reported OK for all four drilled files
(`first-party-skills/orchestrator_playbook/SKILL.md`
`94415d55…ba32`, `src/shared/constants.ts` `e2914d24…d59`,
`src/host/skills/bundledSkills.ts` `f19888d1…9d865`,
`src/host/skills/bundledSkillsInstall.ts` `4afb847c…2abdb`).

1. SKILL.md `## Design decision at the third strike` renamed: only
   `discovers the real skill through Model API context and loads its body
only as a skill` failed (1 of 5). Restored OK.
2. Charter's ` ```muse-review ` fence renamed to ` ```json ` in
   `PLAYBOOK_MODEL_TEXT`: only `produces a schema-valid redesign example
with complete coverage and exact prior-id resolution` failed (1 of 5).
   Restored OK.
3. `'playbookReviewerCharter'` dropped from `BUNDLE_FUNCTIONS`: only
   `refuses a legacy bundle missing the charter instead of silently skipping
the review contract` failed — the legacy-shaped module passed the shape
   check and threw a `TypeError` instead of the worded refusal (1 of 5).
   Restored OK.
4. Release tag reduced to the vendor tag alone (no `+first-party.<digest>`):
   only `offers an update for first-party changes alone, including reference
changes and removed skills` failed (1 of 37). Restored OK.
5. Vendor-list `replaceAll('\\', '/')` normalization removed: only
   `recognizes Windows separators in the installer list` failed (1 of 37).
   Restored OK.
6. `hashTree`'s `fs.lstat` weakened to link-following `fs.stat`: only
   `refuses linked first-party roots, skills and references without reading
or copying their targets` failed (1 of 37). (Removing only the explicit
   `|| stats.isSymbolicLink()` did not fail: `lstat` never reports a link
   as a directory, so that disjunct is defense in depth; the load-bearing
   guard is `lstat` itself. Both edits were restored; final hash OK.)
7. First-party overlay loop removed from `installBundledSkills`: exactly
   `installs the shipped playbook and its references byte-exact, then
removes only its links` and `leaves a personal playbook untouched and
prefers first-party bytes on a vendor id collision` failed (2 of 37).
   Restored OK.

A post-restore run of both suites passed 42 of 42.
