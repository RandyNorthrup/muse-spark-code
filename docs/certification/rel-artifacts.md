# REL — Release artifact lane verification

2026-10-02. Branch `ci/release-artifacts`, base `2add84c6` on `origin/main`.
This records implementation-lane evidence, not a published release or aggregate
quality certification. The lane brief forbids pushing, tagging, publishing,
paid model calls and full `npm run quality`; the lead owns those gates.
No runtime/UI source, dependency pin or existing bundle budget changed.

Latest-main join: `789877d7` merges `5f765896` (PR #83's dated development-only
braces audit exception and its documentation). Both docs merged without
conflicts. Typecheck, scoped ESLint/Prettier, Knip, duplication, localization,
host API, production build/VSIX package, ACP package, SBOM generation and size
gate were rerun after the join and exited 0. This upstream exception is not
a REL suppression. The Marketplace URL correction uses the exact gallery
`/vspackage` endpoint named in the brief: its expectation failed first (one
of 60 tests), then passed after the change, with scoped lint repeated.
The first measurement, 1,631,349 bytes, and the post-join measurement,
1,633,017 bytes, both give 1,850 KiB after adding 15% and rounding to 25 KiB.
Implementation commit `17715e34` ran configured lint-staged ESLint/Prettier
and gitleaks hooks successfully; no bypass.

Final main join: `42f94d14` incorporates `3ffc9665` (approved editor
quick-start documentation and artwork). README/CHANGELOG merged cleanly.
Release scripts, workflows, owning tests and discovery configuration match
the tested snapshot byte-for-byte; their receipts and 20 exact restoration
bindings remain valid. Production build/package and size gates reran after
this join: 62 entries, 1,633,017 bytes, the same 1,850 KiB cap and unchanged
bundle sizes. The original baseline and final measurement both round to that
cap. The size script retains its original measurement comment. Final protocol
receipts use the newly packaged VSIX.

## Scope and findings

| Brief item                  | Result and canonical implementation                                                                                                                                                                                                                                                                                                                                                                                                                                |
| --------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 1, integrity                | `release.yml` generates standard `SHA256SUMS` for both packages and both SBOMs. Pinned `actions/attest-build-provenance` covers VSIX/tarball. Only the release job has `attestations: write`; release/npm have OIDC permission.                                                                                                                                                                                                                                    |
| 2, partial release/recovery | `publish-registry.mjs` bounds publish attempts at three, with 20/60-second network backoff. Existing versions require downloaded SHA-256 (gallery gzip decoded, Open VSX file URL) or npm SHA-512 SRI. `github-release.mjs` checks existing assets before uploading missing ones, never clobbers. `release-summary.mjs` reports all four channels, fails incomplete jobs and distinguishes missing secrets. `docs/RELEASING.md` covers every half-published state. |
| 3, npm provenance           | Publish uses `--provenance --ignore-scripts --access public`, retains the `./` tarball prefix and `NODE_AUTH_TOKEN`. The npm job has `id-token: write`.                                                                                                                                                                                                                                                                                                            |
| 4, release ledger           | Already fixed in base PR #79: PLAN §10 records 0.10.1, including npm EOTP and downloaded byte identity. README's stale release section is now updated for all channels, integrity, inventories and recovery. No publication claim added to the ledger.                                                                                                                                                                                                             |
| 5, SBOM                     | `release-sbom.mjs` selects real esbuild output contributions from npm's full locked CycloneDX inventory. Bundled devDependencies stay; build tools leave. ACP additionally contains the locked keyring/native dependency closure. CI uploads both inventories and the release checksums them.                                                                                                                                                                      |
| 6, 11, signing              | PLAN §8 records Marketplace signing, no self-signed VSIX, unsigned version tags and the intentionally mutable/unsigned future `v0` alias. No signing credentials created.                                                                                                                                                                                                                                                                                          |
| 7, launcher                 | `src/acp/agent.ts` forwards MCP to Muse Code and runs none on Model API; `src/runtime/backends.ts` composes only `shellJobAssembly`. `package-acp.mjs` comments explain why MCP launcher source is excluded. The two shell job sources stay shipped and gated.                                                                                                                                                                                                     |
| 8, npm auth                 | Release guide documents granular token Bypass 2FA or trusted publishing once the package exists, with current npm policy links. Credentials/publisher configuration are owner work.                                                                                                                                                                                                                                                                                |
| 9, VSIX size                | `check-vsix-size.mjs` and the CI package job enforce 1,850 KiB: measured 1,633,017 compressed bytes with the real universal helper, plus 15%, rounded up to 25 KiB. PLAN D6 mirrors it.                                                                                                                                                                                                                                                                            |
| 10, ACP locales             | The package gate checks every source `l10n/ui.*.json` table (14), rather than one German sample.                                                                                                                                                                                                                                                                                                                                                                   |
| 12, namespace               | Base 0.10.1 record already proves Open VSX publication/download. No namespace ownership claim made or credential changed; administrative verification needs the owner.                                                                                                                                                                                                                                                                                             |
| M80 hooks                   | Schema assets upload only if present; `v0` moves only if `action/` exists and all four channels published. A skipped/failed channel holds it; ancestry prevents an older rerun moving it backwards. Both directories are absent, so hooks remain inert. Guide names `RandyNorthrup/muse-spark-code/action@v0` and no Actions Marketplace listing.                                                                                                                  |

The new scripts each have a separate CLI responsibility. They reuse the
existing build, package artifacts, manifest, locked tools and esbuild metafiles.
Vitest/Knip entry patterns now discover the owning `.mjs` tests; no threshold,
ignore or rule level changed. No lint/scanner suppression, unchecked cast or
dependency added.

## Executed checks

| Machine                                 | Check                                                                    | Observed result                                                                                                                                                                                       |
| --------------------------------------- | ------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Windows host, Node 24.20.0/npm 11.19.0  | `npm ci`                                                                 | Exit 0; existing lockfile unchanged.                                                                                                                                                                  |
| Windows host                            | `npm run typecheck`                                                      | All five projects exit 0.                                                                                                                                                                             |
| Windows host                            | ESLint, `--max-warnings=0`, every changed JS/TS file                     | Exit 0.                                                                                                                                                                                               |
| Windows host                            | `npm run deadcode`                                                       | Exit 0 with plain Knip. Static resolution of OVSX's declared CLI entry proves actual dependency use.                                                                                                  |
| Windows host                            | `npx jscpd`                                                              | Exit 0; 653 files, zero clones.                                                                                                                                                                       |
| Windows host                            | `npm run check:l10n`                                                     | Exit 0; 14 tables, 105 manifest strings, 339 source files, zero problems.                                                                                                                             |
| Windows host                            | `npm run check:host-api`                                                 | Exit 0; 266 APIs, 17 importing files, 23 built-ins, 57 theme variables, zero problems.                                                                                                                |
| Windows host                            | `npm run package` (runs literal `npm run build` via prepublish)          | Exit 0; all existing size/split/host-global/notices gates pass; 62 VSIX entries, actual universal helper included.                                                                                    |
| Windows host                            | `node scripts/package-acp.mjs`                                           | Exit 0; 25 entries, both job sources and all 14 locale tables.                                                                                                                                        |
| Windows host                            | `node scripts/release-sbom.mjs`                                          | Exit 0; extension 81 dependency versions, ACP 20; zero dangling refs and zero eslint/vitest/typescript/esbuild components in output.                                                                  |
| Windows host                            | `node scripts/check-vsix-size.mjs <measured VSIX>`                       | Exit 0, 1,633,017 / 1,894,400 bytes.                                                                                                                                                                  |
| Windows host                            | Node invocation of resolved OVSX CLI `--version`                         | Exit 0, 1.2.0.                                                                                                                                                                                        |
| Kubuntu, Node 24.18.0, `~/gates/rt-rel` | Both owning Vitest files, final script/test tree                         | 60/60 pass; no filtered/skipped tests. Private snapshot `5ac69f47`.                                                                                                                                   |
| Kubuntu                                 | actionlint 1.7.12 with ShellCheck 0.11.0 on both workflows               | Exit 0; ShellCheck invoked by actionlint.                                                                                                                                                             |
| Kubuntu                                 | Before/red/restored-green mutation batch                                 | 20 deliberate removals/changes produce intended failures; byte-exact restoration; final 60/60 pass.                                                                                                   |
| Kubuntu                                 | Actual ACP package/checksum workflow steps against local build artifacts | Good tarball passes; missing French table fails; removing locale loop accepts corrupted tarball; restored workflow/tarball pass. Four checksum entries independently verified; missing tarball fails. |
| Mac mini                                | Initial owning test tree                                                 | 45/45 passed before later size/boundary cases were added; not claimed as final 60-test evidence.                                                                                                      |
| Mac mini                                | `bash native/darwin/build.sh`                                            | Exit 0; universal x86_64/arm64 helper, 396,800 bytes, embeds 0.10.1. Copied into this lane's universal package.                                                                                       |

Formatting verification and configured commit hooks are recorded in the final
lane handoff. Aggregate quality, hosted CI, installed extension/agent gates and
actual publication remain lead-owned, not substituted by these scoped checks.

Production bundle sizes in KiB: extension **551.6/600**, Model API
**353.5/400**, plan reader **139.0/150**, checkpoint store **128.3/225**,
English fallback **77.7/100**, search worker **15.2/50**, page worker
**203.2/300**, webview **792.4/900**, ACP **724.4/850**. Existing caps unchanged.

## Negative controls and exact bindings

[Drill receipts](rel-artifacts-drills.json) store each final source SHA-256,
mutant SHA-256, intended failed-test count and exact restoration. Cases cover
retry ceiling/class/backoff, existing-version verification, npm integrity,
VSIX hash, gzip, schema/HTTPS/HTTP boundaries, namespace auth, aggregate failure,
missing outputs, all-channel major-tag consent, GitHub existing asset identity
and not-found-only creation, SBOM inclusion/completeness and the size cap.
The local source bytes match the rig's restored hashes.

[Protocol receipts](rel-artifacts-protocol.json) store the actual workflow
hash, 14-table gate exercise, standard checksum entries and absent M80 folders.
These refer to local, unpublished 0.10.1 build artifacts, not the already
published 0.10.1 bytes. The measured VSIX SHA-256 is
`4ac6a5b70d9c46bd835730f7f320a509e49bc7accbfaaef94b6b242312af5fb6`.

Initial findings retained: first lint run rejected shebang/export combination,
implicit JS globals and fixture assignments; these were fixed without
suppressions. The deliberately insecure URL is built by changing a URL's
protocol, preserving the negative fixture without disabling HTTPS lint.
The first drill harness stopped on a non-unique text anchor before changing
that guard; corrected anchor, repeated complete batch, exact restoration.
Installed Marketplace client's `typed-rest-client` emits `Failed request:
(503)`: new test observed one attempt instead of three before the regex fix
(57 tests: one failed), then passed. Open VSX debug retains JSON error status
only in private captured pipes. Initial dead-code failure identified OVSX's
hidden dispatch; resolving its declared bin fixed actual dependency visibility.

## External outcomes still open

No origin push, version tag, major-tag update, release, registry publish,
credential change or paid model attempt performed. The owner must resolve npm
auth and any namespace administration. The lead must run aggregate/four-rig
quality, hosted CI and a new version's release. Older tags keep their original
workflow; do not rebuild/re-publish 0.10.1 as recovery. First hosted release
must prove attestations, npm provenance, actual registry error wording and
downloaded identity, SBOM/checksum assets and channel summary; after M80 lands,
observe its schema/major-tag hooks. See [the guide](../RELEASING.md).

Pinned attestation reference was checked against the official
[v4.2.2 commit](https://github.com/actions/attest-build-provenance/commit/4d101475d8b20a2381f78447822ac1eab6504dd8).

## Lead review (2026-10-02)

- **Registry identity.** 0.10.1's VSIX as downloaded from the Marketplace
  gallery `vspackage` URL and from Open VSX's `files.download` hashes to the
  GitHub Release asset (`dbc969bb35f9db41…`), so the rerun's byte comparison
  matches a real published package.
- **Failure reasons.** A failed registry step now prints one fixed reason:
  network, npm one-time password (EOTP), 401, 403, 404, artifact mismatch, or
  publication refused. It never prints the tool's output. Before this change,
  0.10.1's EOTP would have shown only "publication or integrity check
  refused". New tests cover each reason, and one plants a token in the CLI
  text and asserts no label carries it.
  - Drill: the EOTP pattern was broken on the rig copy (`python3
rel-drill.py`). The EOTP case failed (1 failed, 7 passed). The file was
    restored byte-exact (SHA-256 `44c22707cf93` before and after), and the
    case went green again.
- Kubuntu: `releasePublish` and `releaseIntegrity`, 68 passed; ESLint clean;
  actionlint 1.7.12 with shellcheck clean on release.yml and build.yml.
- **Muse review (0 P1, 1 P2, 2 P3), all fixed.**
  - P2: M80 schemas would have shipped outside `SHA256SUMS` and the
    attestation. They are now staged beside the packages, listed in
    `SHA256SUMS`, attested through `subject-checksums` (every listed asset),
    and uploaded in the same verify-before-upload call. Simulated with no
    schemas and with one; both give the expected list.
  - P3: the `v0` hook keys on `action/action.yml`, not on any file under
    `action/`.
  - P3: run outside Actions, a successful publish no longer reports failure
    for want of `GITHUB_OUTPUT`.
