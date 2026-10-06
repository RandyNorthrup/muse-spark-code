# M110-B0 base agent toolset

Kubuntu rig, worktree `/home/randy/lanes/M110B0`, branch `m110/b0`,
base `989077534`; 2026-10-06. Model attempts: **0**. No credentials read,
no live/paid call, no sign-in, no system settings changed. The rig brief
adds D90.27 to this older plan. Only B0 code and required shared records
are changed; container deployment, OS boot wiring and help surfaces remain
with their named owners.

## Portable bundled skills

The copy/link installer moved from `src/host/skills/` to
`src/core/context/bundledSkillsInstall.ts`. The existing lazy bundle and
VS Code offer/commands still use it. Node/native/editor adapters can bind
the same filesystem implementation without importing VS Code. The Model
API continues to read the vendored package as source `bundled`; project
and personal skills keep their existing precedence.

Before a staged copy is published, every file must match VENDOR.json's
SHA-256 and exact file set. Unsafe, traversal and case-aliased paths fail
before writes; unlisted, missing or changed files cannot replace a working
copy. Existing user-owned skills and unmarked copies are preserved.

| Control                               | Threat rows | Red drill / failed test                                                                             |
| ------------------------------------- | ----------- | --------------------------------------------------------------------------------------------------- |
| Staged file integrity/exact inventory | H17         | B0-SKILLS-INTEGRITY: remove verification; changed/extra/missing release-byte tests fail             |
| Missing-file refusal                  | H17         | B0-SKILLS-MISSING: disable remaining-file check; missing release-byte test fails                    |
| Case-aliased duplicate refusal        | H10/H17     | B0-SKILLS-PATH: disable duplicate check; README.md/readme.md test fails                             |
| Traversal/trailing-dot refusal        | H10/H17     | B0-SKILLS-TRAVERSAL: disable segment check; ../outside, skills/../outside and README.md. tests fail |

All four runs exited 1 and restored the original source byte-exact:
`fad4677b7b7793587c8545cb5751c5525eefb40da25e09a7516500a0ad43a3fc`.
Full test names and hashes: `m110-b0-skills-drills.json`.

Verification: `npx vitest run test/unit/bundledSkillsInstall.test.ts
test/unit/bundledSkillsVendor.test.ts test/unit/skills.test.ts --maxWorkers=3`
passed **167 tests**, using repository-default timeouts. Host typecheck
passed. No new dependency, user-visible string, command or setting in this
piece. The split guard now names the portable installer's real path.

## Named integration handoffs

- **B0-C-TOOLSET:** C composes the verified toolset layer with its service
  runtime and two-user ownership/permissions; it owns final image signing,
  SBOM, provenance, notices, vulnerability/layer scans and image publication.
- **B0-W-OS1-TOOLSET:** W and OS1 reuse the same toolset for the default
  sandbox. Compilers never enter the OS host. This layer grants no egress,
  mounts, service identity, credentials or approvals.
- **B0-N-SKILLS:** boot binds the portable installer's filesystem paths to
  the tools user's chosen config home and immutable vendored package. It
  must not use or inspect a CLI sign-in home to infer consent (H18).
- **B0-U2-HELP:** no `src/shared/featureCatalog.ts`, reference generator or
  check:reference script exists on this base. Integrate the base toolset,
  bundled workflow skills, existing Install/Remove Bundled Skills commands,
  and first-boot automation-runtime preparation into `/help` when the help
  registry arrives. Do not add a second slash-command implementation here.

Full image/OS/editor support still requires the lead's integrated quality
run and the accepted table's platform receipts. The common brief delegates
`npm run quality` to the lead; this lane runs scoped checks directly here.
