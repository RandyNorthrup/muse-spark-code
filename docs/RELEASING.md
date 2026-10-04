# Releasing Muse Spark Code (Unofficial)

A `vX.Y.Z` tag must match `package.json` and identify a commit on `main`.
The release workflow first tries to reuse a successful CI build of exactly the
tag's source tree; otherwise it runs the reusable build and its platform gates.
The owner/lead performs publication; implementation
lanes do not push, tag, release, or call paid services.

## Choosing the release build

Tag/manifest and `main` ancestry checks still run first. The lookup considers
only successful, completed runs of this repository's `ci.yml`, triggered by
an own-repository pull request or a push to `main`. Forks and manual runs are
excluded. It searches the latest 300 successful runs; a miss is safe to rebuild.
Branch names and the PR head SHA do not establish source identity: the package
job records its actual checked-out `HEAD^{tree}` (the merge tree for PR CI) in
the `source-tree-<tree SHA>` artifact and `release-build.json`.

The release downloads that run's universal VSIX, ACP tarball, SBOMs and receipt
with a pinned cross-run download action. It requires the recorded tree to equal
the tag's `HEAD^{tree}`, checks all four asset SHA-256 hashes recorded by CI,
and checks the VSIX and ACP manifests against the tag version. Only then are
the verified bytes uploaded into the release run under the existing artifact
names. Publication, attestations, release checksums and channel reporting use
those same bytes. All four artifacts have explicit 30-day retention (previously
the repository default); this also covers the SBOM/receipt dependency.

No eligible run, expired/missing artifacts, API/download failure, a malformed
receipt, or a tree/hash/version mismatch produces a named fallback in the job
summary and runs today's full three-platform build and gates before publication.
To force that path, the owner sets repository Actions variable
`RELEASE_FORCE_REBUILD` to `true` before running/rerunning the tag workflow,
then removes it afterward. Do not rebuild once any channel has published:
follow the recovery instructions below to preserve the original bytes.

## Artifacts and channels

The build produces one universal VSIX, including the macOS helper compiled on
macOS, and `muse-spark-code-acp-X.Y.Z.tgz`. The same VSIX goes to GitHub,
the VS Code Marketplace, and Open VSX. The same ACP tarball goes to GitHub
and npm. A package made locally without the macOS helper is not that universal
release artifact.

npm history: 0.10.0's npm step failed on a path bug, and 0.10.1's and
0.11.0's failed with `EOTP` (the stored token could not bypass the account's
2FA). On 2026-10-04 the owner minted a 7-day bypass-2FA token, 0.11.0's npm
job was re-run with it and reached npm, and npm trusted publishing was set up
for the package (see [npm trusted publishing](#npm-trusted-publishing)). From
0.12.0 the npm job uses no token.

GitHub also carries `SHA256SUMS` (the standard `sha256sum` format) and two
CycloneDX inventories: `muse-spark-code.cdx.json` and
`muse-spark-code-acp.cdx.json`. `SHA256SUMS` lists every asset: both
packages, both inventories and, once M80 lands, its schemas. Pinned
`actions/attest-build-provenance` attests every file `SHA256SUMS` lists. The release
job alone receives `attestations: write`; it and the npm job receive
`id-token: write`. npm publishes by trusted publishing: the job installs npm
11.21.0 (trusted publishing needs 11.5.1 or newer; Node 22 bundles npm 10)
and runs `npm publish --provenance` with no token, npm exchanging the job's
OIDC identity for a one-time publish credential.

The SBOM generator runs `npm sbom --sbom-format cyclonedx --package-lock-only
--include=dev --include=optional`, then selects the dependency versions whose
inputs contributed bytes to the shipped esbuild outputs. Using `--omit=dev`
on the root project would omit bundled React, zod and SDK packages. The ACP
inventory additionally includes the unbundled keyring and its locked native
optional dependencies for all platforms. These are package ingredient lists,
not lists of every file or every dependency's complete source: tree shaking
can ship only part of a package. Build-only tools and omitted dependency
references are removed. See [npm's SBOM documentation](https://docs.npmjs.com/cli/commands/npm-sbom/).

The universal VSIX size gate is measured in compressed bytes; its budget is in
`PLAN.md` D6 and `scripts/check-vsix-size.mjs`. ACP package checks cover every
`l10n/ui.*.json` table. The ACP process compiles the shell job sources on
Windows, but forwards MCP servers to Muse Code; it does not run the extension's
`MuseSparkMcpLauncher.cs`.

## Outcomes and bounded retries

The final summary lists GitHub Release, Marketplace, Open VSX and npm as
`published`, `skipped-no-secret`, or `failed`. Each registry job explicitly
reports missing secrets; a failed, blocked, cancelled, or missing-output job is
a failure. Any failed channel fails the aggregate job. A successful workflow
with skipped secrets is not proof that every channel published.

Registry publication retries network failures such as `ECONNRESET`,
`ETIMEDOUT`, and HTTP 502/503/504: at most three publish attempts, waiting
20 seconds and then 60 seconds. Auth, OTP, validation, version-conflict and
integrity failures are not retried as network failures. Registry tools run
without install scripts alongside secrets; tokens are never passed as
arguments, and their captured diagnostics are not printed.

An already-published version is successful only when it matches this run:

- Marketplace: download its version-specific gallery VSIX package, decode
  gzip when present, compare SHA-256 to the build artifact.
- Open VSX: validate the version metadata, download `files.download` over
  HTTPS, compare SHA-256.
- npm: compare `npm view muse-spark-code-acp@X.Y.Z dist.integrity` to the
  tarball's locally computed SHA-512 SRI.

Unavailable metadata or mismatched bytes fail closed. Do not remove a version
or overwrite an asset to make that check pass.

## Recovering a half-published release

This recovery logic applies to tags that contain the REL workflow changes.
Rerunning an older tag uses its original workflow definition, not today's
`main`. In particular, 0.10.1's npm `EOTP` failure still needs owner recovery
with that run's original ACP tarball and an interactive OTP or corrected
token, or a new release version. Do not publish this lane's rebuilt 0.10.1
package over the older release's version.

Keep the version tag, release commit, original Actions run and its downloaded
artifacts. Check its summary and retain the VSIX/tarball hashes. Use the run's
**Re-run failed jobs** after fixing the named cause; this keeps the successful
build's artifacts. Avoid **Re-run all jobs** once anything has published:
rebuilt ZIP timestamps or changed build tools can produce different hashes.
If artifacts have expired or hashes differ, stop for owner review and prepare
a new version rather than replacing a published version.

A failed registry step prints one fixed reason and never the tool's own
output, which can carry a token. The reasons are: network attempts
exhausted; npm asks for a one-time password (EOTP); the token was refused
(401); the token lacks permission (403); not found (404); the published
artifact does not match the release; and publication refused, for anything
else.

| State                                                                       | Recovery                                                                                                                                                                                                                                                                                          |
| --------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| GitHub job failed before creating the Release                               | Fix permissions, attestation, or network cause; rerun failed jobs. Creation requires a definite not-found response.                                                                                                                                                                               |
| GitHub Release exists but its job failed after creation                     | Rerun failed jobs with the same artifacts. Existing assets are downloaded and verified before any missing assets are uploaded; no `--clobber`. This also handles a partial asset upload.                                                                                                          |
| GitHub published; Marketplace failed; other registries published or skipped | Fix Marketplace PAT/transport; rerun failed jobs. An ambiguous prior publish is accepted only after the gallery download matches.                                                                                                                                                                 |
| GitHub published; Open VSX failed; other registries published or skipped    | Fix `OVSX_PAT`/namespace permissions/transport; rerun failed jobs. Namespace lookup/create and publishing have bounded network retries; an existing version requires the file hash match.                                                                                                         |
| GitHub published; npm failed; other registries published or skipped         | Check the package's trusted publisher (below) and the job's `id-token: write`; rerun failed jobs. A prior successful upload requires matching `dist.integrity`.                                                                                                                                   |
| Several registries failed                                                   | Fix each cause and rerun failed jobs together; successful channels remain published and the final summary covers all four.                                                                                                                                                                        |
| A registry says `skipped-no-secret`                                         | Add its token in the tag-only `marketplace` environment, then rerun that specific registry job via its job ID in the Actions API (or owner tooling that supports rerunning a job); rerun the summary after the job completes. Rerunning only failed jobs will not rerun a successful skipped job. |
| Hash/integrity mismatch, or original artifacts expired                      | Stop. Identify which bytes were published. Issue a new version after owner review; never move the version tag or overwrite registry bytes.                                                                                                                                                        |

For example, the owner can rerun one successful-but-skipped registry job using
GitHub's `POST /repos/{owner}/{repo}/actions/jobs/{job_id}/rerun` endpoint.
Use the job from the original run, not another release. Verify the new run
attempt's channel summary; the API reruns the job and its dependents. See
[GitHub's rerun-job API](https://docs.github.com/en/rest/actions/workflow-runs#re-run-a-job).

## npm trusted publishing

Set up on 2026-10-04 in the package's npm settings (`muse-spark-code-acp` →
Settings → Trusted Publisher): GitHub Actions, `RandyNorthrup/muse-spark-code`,
workflow `release.yml`, environment `marketplace`, allowed actions `npm
publish` (and `npm stage publish`, always allowed). A run of any other
workflow, branch environment or repository cannot publish. The release job
needs no npm secret, so there is no token to expire, leak or hit `EOTP`.

If the npm job fails: confirm the trusted publisher still lists exactly those
values (changing any of them needs a new connection, which needs the owner's
2FA), that the job still has `id-token: write` and runs in the `marketplace`
environment, and that the job's npm is 11.5.1 or newer. A bypass-2FA token is
no fallback: npm removes their direct publishing around January 2027.

No token, OTP policy, trusted publisher or namespace ownership was changed by
the REL implementation lane. The existing 0.10.1 release record already proves
Open VSX publication with a downloaded, matching VSIX. Administrative namespace
ownership still requires the owner's account; publication permission alone
does not prove ownership.

## Signing and the prepared M80 hooks

Rely on the VS Code Marketplace's signing of published extensions; do not
self-sign the VSIX or create new signing credentials. GitHub/Open VSX assets
are the original package bytes; use their checksums and attestations. Version
tags remain unsigned: the workflow verifies version and `main` ancestry and
records package provenance, but these checks are not signed-tag verification.
Decisions are recorded in `PLAN.md` §8.

M80 is not implemented here. If `docs/schemas/*.json` exists at the release
commit, its schemas are uploaded as additional GitHub Release assets with the
same verify-before-upload behavior, listed in `SHA256SUMS` and attested like the
packages. If `action/action.yml` exists, the final summary job
moves the unsigned `v0` major tag only after all four channels published. It
does not move after a missing-secret skip or a failure, and an older rerun
cannot move it backwards to an ancestor. Divergent history requires review.

The Action will be consumed as
`RandyNorthrup/muse-spark-code/action@v0`. There is no Actions Marketplace
listing: the Action lives in a subfolder. Until M80 lands, both hooks are inert.

## First hosted release observation

The certification record distinguishes the dry script exercises from live
publication. On the first release after this change, the lead must watch the
attestations of every `SHA256SUMS` entry, npm provenance, actual registry duplicate-error
wording, gallery gzip/byte identity, and the final channel summary. Verify
downloaded `SHA256SUMS` and both SBOM assets against the original run. After
M80 lands, verify its schema upload and major-tag update on a fully published
release, then hold it on a skipped/failed channel. No live release was run by
this lane.
