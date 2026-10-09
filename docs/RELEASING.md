# Releasing Muse Spark Code (Unofficial)

A `vX.Y.Z` tag must match `package.json` and identify a commit on `main`.
The release workflow first tries to reuse a successful CI build of exactly the
tag's source tree; otherwise it runs the reusable build and its platform gates.
The owner/lead performs publication; implementation
lanes do not push, tag, release, or call paid services.

## Writing the Highlights block

Users see each release in What's New (PLAN.md D79, M99): after an update the
extension opens a page with every new release's Highlights and full notes,
built from `CHANGELOG.md` at build time. Before the release PR bumps
`package.json`:

1. Rename `## [Unreleased]` to `## [X.Y.Z] - YYYY-MM-DD` (and start a new,
   empty `## [Unreleased]` above it).
2. Give the section a `### Highlights` list first, before `### Added`: 3 to
   5 bullets (at most 5), each one sentence or two a user can act on, in the
   form `- **What it is.** What it does for you.`
3. Where a highlight has something to try, end its bullet with
   `<!-- try: command museSpark.<id> -->` or
   `<!-- try: setting museSpark.<key> -->`. The page shows a **Try it** (or
   **Open the setting**) button; GitHub, the Marketplace and VS Code's
   changelog tab show nothing. The id must be a command or setting
   `package.json` contributes, or `npm run build` fails.
4. A patch release of fixes only may leave Highlights out: users then get a
   quiet notification instead of the page. A minor or major release
   (`X.Y.0`) without Highlights fails `test/unit/changelogVersion.test.ts`,
   as does a release with more than 5.

The notes stay English; the page's own words are translated.

## Keeping the roadmap's release sections right

`ROADMAP.md` is generated (PLAN.md M122). Every version for which PLAN.md
§10 has only preparation records gets its own _In the next release (X.Y.Z)_
section, oldest first, so two overlapping preparations are both listed as
unreleased. When the release PR adds the dated `## [X.Y.Z]` heading, also
add `**X.Y.Z preparation (YYYY-MM-DD, …).**` to §10 and run
`npm run roadmap:generate`; a preparation record without that dated heading
fails `check:roadmap`. After publication, add the
`**X.Y.Z released (YYYY-MM-DD, …).**` record and regenerate, so X.Y.Z moves
under _Shipped_. Without a §10 record a changelog version counts as shipped.
Every §10 record change, released or not, changes the roadmap's source
fingerprint, so `check:roadmap` fails until it is regenerated.

## Choosing the release build

Tag/manifest and `main` ancestry checks still run first. The lookup considers
only successful, completed runs of this repository's `ci.yml`, triggered by
an own-repository pull request, `merge_group`, or a push to `main`. Forks and manual CI runs are
excluded. It searches the latest 300 successful runs; a miss is safe to rebuild.
Branch names and the PR head SHA do not establish source identity: the package
job records its actual checked-out `HEAD^{tree}` (the merge tree for PR/queue CI) in
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

The merge queue's temporary branch and head commit are not matching keys.
Its successful `ci.yml` run qualifies only when `source-tree-<tree SHA>` names
the tag's tree; the downloaded receipt and all four hashes must also match.
The CIFLOW lane owns enabling `merge_group` and moving the full gates there.
This lane admits those successful runs without changing `ci.yml`.

## Artifacts and channels

CI's full tier produces one universal VSIX, including the macOS helper
compiled on macOS, and `muse-spark-code-acp-X.Y.Z.tgz`. The full tier runs in
the merge queue, on manual runs, in the release workflow's own build, and on
every PR until the merge queue is on; a fast PR run builds no packages
(CONTRIBUTING.md, "CI tiers"). The same VSIX goes to GitHub,
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
packages, both inventories and the `docs/schemas/*.json` schemas. Pinned
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
`published`, `skipped-no-secret`, or `failed`. The Marketplace and Open VSX
jobs explicitly report a missing secret; the npm job uses no secret, so it is
`published` or `failed`. A failed, blocked, cancelled, or missing-output job is
a failure. Any failed channel fails the aggregate job. A successful workflow
with skipped secrets is not proof that every channel published.

The M80 `v0` update is reported separately after the four channels. Its failed
step remains visible and appends **admin move required** with a warning; it does
not turn successfully published channels into failures. A failed channel still
fails the aggregate, and a missing-secret skip still holds the tag. An update
uses `force=false`, with ancestry checks before dispatch.

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

The `workflow_dispatch` input `artifacts_run_id` remains available on a version
tag. It selects an earlier own-repository `release.yml` run on that same tag
whose three quality jobs, native helper, package, secret scan and SAST succeeded.
The earlier run may have failed during publication. Its source tree may precede
a recovery-only workflow/changelog fix; recovery preserves its original bytes.
The shared reuse job validates that source run and nonexpired artifacts, downloads
them once, verifies inventory and package identities/versions, then stages those
bytes in the current run for every publisher. If the source includes a tree/hash
receipt, recovery verifies it against the earlier source commit's tree.

Pre-receipt Release builds, including the source of the 0.12.0 recovery, remain
eligible. Their pinned artifact download provides archive integrity checking;
the same asset inventory and manifest checks still run, but no historical
per-asset CI hash receipt is claimed. Existing channel byte/integrity comparisons
still refuse a conflicting published version. Invalid source, missing/expired
artifact, failed download or verification stops recovery: it never rebuilds.
`RELEASE_FORCE_REBUILD` applies only to automatic tag-push reuse. All release
job conditions respect cancellation, including when the build was skipped.

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
| Marketplace or Open VSX says `skipped-no-secret`                            | Add its token in the tag-only `marketplace` environment, then rerun that specific registry job via its job ID in the Actions API (or owner tooling that supports rerunning a job); rerun the summary after the job completes. Rerunning only failed jobs will not rerun a successful skipped job. |
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
workflow, branch environment or repository cannot publish. The npm job reads
no npm secret, so it has no token to expire, leak or hit `EOTP`. The
`marketplace` environment still holds the unused `NPM_TOKEN` from the 0.11.0
recovery; deleting it leaves no npm token stored.

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

M80 is implemented, and both hooks are live: 0.12.0 uploaded the schemas and
created `v0`. If `docs/schemas/*.json` exists at the release
commit, its schemas are uploaded as additional GitHub Release assets with the
same verify-before-upload behavior, listed in `SHA256SUMS` and attested like the
packages. If `action/action.yml` exists, the final summary job
moves the unsigned `v0` major tag only after all four channels published. It
does not move after a missing-secret skip or a failure, and an older rerun
cannot move it backwards: a tag already at the release commit or a newer
descendant is left alone. Divergent history stops for owner review; the move
is fast-forward only, never forced.

Tag rules (current 2026-10-08): the `release tags` ruleset (`23893754`)
excludes `refs/tags/v0`. A separate ruleset (`24701357`, "action major tag
v0") blocks only deletion and non-fast-forward updates of `v0` (only the
Admin role may bypass), so the release job's fast-forward update of `v0`
with `GITHUB_TOKEN` is allowed. History: `v0` sat stuck at 0.12.1 from
0.14.4 through 0.16.0 because the old ruleset refused the workflow's update
(the owner's 0.12.1 observation, Release run `37225339230`, found HTTP 422);
it has since been fast-forwarded to the 0.16.0 commit `4da4ef666`, and the
normal path is the workflow moving it on each fully published release.

A failed `v0` move is loud, never silent: the summary job keeps its channel
results, adds a `**admin move required**` row naming the failed update, and
emits a warning pointing here. The release itself stays published; no
rebuild or republish is needed solely to repair this major tag. To make the
admin move after a failed update, confirm all four channels published,
inspect the current target and confirm it is an ancestor of the release
commit (or already at that commit/a newer descendant). If a move is needed,
run this with the administrator's GitHub CLI account:

```console
gh api --method PATCH repos/RandyNorthrup/muse-spark-code/git/refs/tags/v0 -f sha=<release commit> -F force=false
```

Replace `<release commit>` with the full commit SHA. Verify the resulting
`v0` target independently afterward. If history is divergent, stop for owner
review; do not force the move or change the ruleset.

The Action will be consumed as
`RandyNorthrup/muse-spark-code/action@v0`. There is no Actions Marketplace
listing: the Action lives in a subfolder. Hooks run only when their source files
exist at the release commit.

## First hosted release observation

The certification record distinguishes the dry script exercises from live
publication. On the first release after this change, the lead must watch the
attestations of every `SHA256SUMS` entry, npm provenance, actual registry duplicate-error
wording, gallery gzip/byte identity, and the final channel summary. Verify
downloaded `SHA256SUMS` and both SBOM assets against the original run.
Verify the schema upload and major-tag update on a fully published release,
then hold it on a skipped/failed channel. 0.11.0 and 0.12.0 have run this
workflow live; 0.12.0 was published by a manual run on its tag.
