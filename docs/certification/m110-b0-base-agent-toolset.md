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

## First-boot and Linux ARM64 runtime preparation

`createBaseAgentToolset` is exported by the existing lazy bundled-skills
entry. It supplies the portable `bundled` source and first-party root and
performs only explicitly requested preparation. Both enhancements default on;
explicit false is read afresh each time. N/OS3 inject M81's actual
`prepareRuntime`, `RuntimePrepareRequest`, lifetime/admission and consent
surface. No second downloader, browser launch, CLI install or sign-in is added.

The Chrome for Testing 154.0.8037.92 Linux ARM64 archive was downloaded on
this rig from its exact storage.googleapis.com URL. Its 121,182,296 bytes
hash to `0ed0e47d9e9f639197f508d62ada09e5c6b4c4c60edab3160a9312a733091df6`;
287 entries expand to 279,456,406 bytes. The executable is 190,385,552 bytes,
SHA-256 `8ef1e673b0083695a65e383dedf07fca9ecc1cffebf02b92c0059eb3879d8a9e`.
The existing M81 store validates the pin, download, entries and executable.
Legacy manifests without this optional platform refuse before consent or
download. Native Linux ARM64 browser execution remains an integration
receipt, not a claim based on this amd64 rig. No model attempts.

Capture command (archive retained under gitignored temp):

```sh
curl --fail --location --output temp/m110-b0/chrome-headless-shell-linux-arm64.zip https://storage.googleapis.com/chrome-for-testing-public/154.0.8037.92/linux-arm64/chrome-headless-shell-linux-arm64.zip
sha256sum temp/m110-b0/chrome-headless-shell-linux-arm64.zip
```

| Control                                      | Threat rows | Red drill / failed test                                                                        |
| -------------------------------------------- | ----------- | ---------------------------------------------------------------------------------------------- |
| ARM64 platform uses its own pin              | H17         | B0-ARM-PLATFORM; platform mapping and ARM64 store preparation                                  |
| Missing ARM64 pin refuses before work        | H09/H17     | B0-ARM-MISSING-PIN; older pin refusal                                                          |
| Default-on skills/browser and explicit false | H12/H18     | B0-SKILLS-DEFAULT/OFF and B0-BROWSER-DEFAULT/OFF; default and explicit-false preparation tests |
| Chosen platform determines package roots     | H10         | B0-PORTABLE-ROOT; exact Windows package paths                                                  |

All seven mutations exited 1, with named assertion failures and byte-exact
restoration; see `m110-b0-browser-boot-drills.json`. The initial Windows
assertion normalized separators and could not detect use of the wrong path
implementation; it was strengthened to require native Windows paths before
the successful red run. Final scoped run: runtimeManifest, runtimeStore and
baseAgentToolset, **31 tests passed** at default timeout. Localization gate:
14 language tables, zero problems; only an existing platform-description
key changes, so no manifest key is added.

**B0-N-OS3-BOOT:** bind this factory after settings/consent are available,
with packageRoot `/usr/local/share/muse-toolset` in the toolset layer and
per-tools-user storage. Load `dist/bundledSkills.js` and
`dist/browserRuntime.js` through the installed package's lazy factories.
Include those bundles and both skill asset trees in the node/native package;
the current standalone ACP packager does not include them. Respect H17/H18
before passing Muse Code install paths. No backend-specific model support
is required; this filesystem/runtime preparation is shared by all editors.
