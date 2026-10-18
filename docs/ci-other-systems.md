# Headless runs on other CI systems (Unofficial)

PLAN.md M80/D65, CM80CI-R4. The GitLab, Azure, Jenkins and Bitbucket templates
share the GitHub Action's input grammar, installer, sanitized Git, proposal
engine, result validator and scanner. Nothing comments or pushes.

These templates are **not certified or supported**. What is tested locally
is the launcher's pure logic through its real modules, the templates'
defaults through that grammar, and the shipped bootstrap under the real
shells; no vendor run is simulated. No hosted/live receipt exists, and no
release carrying `ci/` is claimed. Pin only a release that actually
carries it; registry-path support still needs M80's LR receipt. The
behaviours a hosted run must still prove are listed in
`docs/real-life/unproven.md`.

## Credential boundary

The package carries `action/lib` and `action/prompts` as `ci/`. One POSIX
bootstrap, `ci-templates/bootstrap.sh`, is generated into all four templates
with `node scripts/sync-ci-bootstrap.mjs`; tests reject drift.

1. The parent shell never reads a credential value or copies a key file.
   Its subshell unsets the known key names generated from
   `CI_BOOTSTRAP_UNSET` in `action/lib/ci-key.mjs` (re-exported by
   `ci-run.mjs`), and additional binding
   names declared in `MUSE_CI_KEY_ALIASES`, before its first child (`date`).
   Declare additional bindings as space-separated variable **names**, never
   values. Names beginning `muse_ci_internal_`, `MUSE_CI_`, `MUSE_INPUT_`
   or `MUSE_AGENT_` are reserved for parent ownership and bootstrap configuration,
   including the temp/start/package transport bindings assigned for the Node invocation.
   Declaring one refuses before download, and Node refuses it too. Ordinary
   aliases, including old bootstrap
   holder names, retain their original values until Node reads them.
   Do not put undeclared credential copies in the job environment:
   POSIX shell cannot identify an arbitrary copied value without reading it.
2. The sanitized subshell records bootstrap time, creates private scratch
   under `TMPDIR`, downloads the pinned package with `curl --max-time 120`,
   checks SHA-256 with `sha256sum`, and unpacks it with `tar`. It has bounded
   failure cleanup (`timeout -s KILL 5 rm` with a plain-`rm` fallback where
   `timeout` is missing or cannot run, so cleanup failure never changes the
   exit status); no key file is created.
3. The parent receives only a timestamp and directory path, then runs
   `node ci/lib/ci-entry.mjs <system>` with the vendor's original environment
   (plain invocation, not `exec`, so a missing Node keeps its 127 status on
   every shell).
   The entry registers cleanup before loading the proposal module, covering
   module-load, facts, workspace and input failures. No key is in argv/stdin.
4. Node reads the vendor source first: GitLab's File-variable file directly,
   or `MUSE_MODEL_API_KEY` / `MUSE_SPARK_MODEL_API_KEY` / `META_API_KEY` or a
   declared alias on the other vendors. Different named values refuse. The
   names, file path, legacy holders and every environment value containing
   any supplied key are deleted before any child. The key stays in memory
   for private `exec --key-stdin` / `scan-secrets --key-stdin` and redaction.
   Every launcher child receives an explicit allow-listed environment;
   filesystem workers and exit cleanup receive an empty environment.

This controls bootstrap and launcher children. Vendor-managed secret-file
creation, clone, tool setup and upload are separate qualification boundaries.
An initial OS environment can remain inspectable by the same user; deletion
does not erase that record or guarantee memory zeroization.

## Vendor setup and limits

| System    | Secret and trust                                                                                                                                                                                                                    | Elapsed job time                                                                              | Upload                                                                                                                                                   |
| --------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------- |
| GitLab    | Protected, Masked/Hidden **File-type** `MUSE_MODEL_API_KEY_FILE`. Rules exclude fork/untrusted merge requests, unprotected refs and tags; launcher checks again. Automatic source preparation sees the path.                        | `CI_JOB_STARTED_AT`, `CI_JOB_TIMEOUT`; earliest timestamp wins.                               | Built-in artifacts require paths inside `CI_PROJECT_DIR`; no repository fallback is configured. External-temp transport remains unqualified.             |
| Azure     | Secret pipeline/variable-group `MUSE_MODEL_API_KEY`, mapped only into the run step. Keep fork secret access OFF. Job condition excludes forks and untrusted PRs; `True`/`False` are read without case.                              | Measured bootstrap time minus a 10-minute pre-bootstrap setup reserve; 45-minute job.         | Job-temp output, enabled only by the launcher's `MUSE_CI_OUTPUT_READY` marker after successful publication. Early failures select nothing.               |
| Jenkins   | Secret text credential `muse-model-api-key`, bound around the guarded launcher step only. Multibranch fork discovery must use the target Jenkinsfile for untrusted forks.                                                           | `currentBuild.startTimeInMillis`, plus bootstrap time; 35 minutes.                            | Fresh UUID under `pwd(tmp: true)`, manifest checked, five fixed publisher filenames, `followSymlinks: false`. No checkout artifact path.                 |
| Bitbucket | Secured **deployment** `MUSE_MODEL_API_KEY` in deployment environment `muse-spark`, with trusted-ref/user restrictions. Deployment scope is narrower than repository/workspace. Branch `main` and custom only, no fork PR pipeline. | Bootstrap elapsed time, or an explicitly supplied earlier `MUSE_CI_JOB_START_MS`; 35 minutes. | Built-in artifacts are clone-relative; no repository fallback is configured. External-temp transport and automatic process isolation remain unqualified. |

Bitbucket's single user script does not establish what automatic clone/setup
or upload processes receive. The review's additional P1 is confirmed as a
qualification/documentation gap; an actual vendor-process leak is neither
confirmed nor refuted without a hosted or runner receipt. Deployment scoping
reduces exposure but does not close that gap. Bootstrap-only timing on a
vendor with no earlier timestamp cannot prove coverage of its automatic
preparation: qualification requires an earlier timestamp or a verified
vendor timeout boundary.

Azure uses no vendor date expression, so organization timezone cannot change
admission. Its bootstrap measures epoch milliseconds before download; admission
subtracts a fixed **10-minute worst-case setup allowance** for job initialization,
full-history checkout and UseNode before that measurement, plus every measured
millisecond since bootstrap. The 45-minute default job covers the 20-minute
turn, all launcher tails, the 120-second bootstrap download bound and this
10-minute reserve. Ten minutes is an explicit runner qualification requirement,
not an Azure guarantee or a measured hosted receipt: the runner owner must prove
that all pre-bootstrap setup fits it. A runner that cannot meet it must not use
this template. Increasing job timeout does not prove that setup requirement.
This allowance replaces the timezone-sensitive pipeline timestamp entirely;
GitLab/Jenkins retain their measured vendor starts. Hosted Azure timing and
upload qualification remain open.

The templates require Linux, Node 22, curl, sha256sum, tar, mktemp and GNU
`timeout`; no package-manager lifecycle scripts run during bootstrap. Full
clone history is required. Same-repository PRs are trusted only with
`MUSE_INPUT_TRUST_PULL_REQUESTS=true`, since branch writers can edit CI code.

## Run and lifecycle

The launcher refuses unsupported events, forks, untrusted PRs, unprotected
GitLab refs and images in review mode before installation/spending. Admission
uses job duration minus measured elapsed time from the earliest supplied
vendor or bootstrap start, reserving install, checkout, exec and every tail.
Azure also subtracts its required 10-minute pre-bootstrap setup reserve.

The pinned tarball is checked again and installed with lifecycle scripts off,
private npm config and a package identity/bin check. A fresh private repository
fetches the vendor clone's verified head and base using sanitized Git. The
change metadata and bounded base/head diff are untrusted files; the trusted
prompt travels through `--prompt-file`. The Action owner bounds the turn,
forwards signals, terminates children and drains both pipes. Completed/0 and
the trusted scanner are required before a text patch can be published.

The output directory is created by the launcher under job temp, outside the
clone and outside scratch that final cleanup removes. Only `outputs.json`,
`result.json`, `events.jsonl`, `fix.patch` and `manifest.json` can be copied.
`outputs.json` is written last. A repository-planted directory or symlink is
never an upload candidate, even if pin/download/digest/unpack/validation fails.
An existing job-temp destination is removed within a bound and refused before
spending; a removal failure never claims successful removal.

Publication, stale-output removal and final cleanup run in a credential-free
Node filesystem subprocess. Their AbortSignals kill and reap that subprocess
at the bound: no late completed manifest can appear after timeout. Partial
publication is removed under a separate cleanup bound. The entry's bounded
exit fallback covers failures before the run owner. Cleanup failures are
reported; retained output belongs to the vendor's job-temp retention policy.

## Inputs and outputs

Inputs use the Action's `MUSE_INPUT_*` names and grammar: mode, max-budget-usd,
max-requests, timeout-minutes, model, effort, allow-contributor-models,
image-generation, max-diff-bytes, extra-instructions, https-proxy, no-proxy,
extra-ca-certs, plus trust-pull-requests (default false). Pin
`MUSE_AGENT_VERSION` and `MUSE_INPUT_AGENT_PACKAGE_SHA256`; bootstrap sets
agent-package. The task is fixed to review/fix; extra-instructions adds trusted
pipeline-author instructions. GitHub-only inputs are refused. Explicitly
empty budget values refuse. Images require fix mode, their explicit flag and
the existing hard dollar budget; subscription billing is unavailable.

`MUSE_CI_KEY_ALIASES` declares extra key bindings by name. The optional
`MUSE_CI_OUTPUT_ROOT` is an absolute job-temp directory outside the clone;
Azure/Jenkins set it for their upload steps. Other templates generate a fresh
random root and print the published path in the summary. Its parent must
already exist; the launcher creates the root privately. An earlier measured
`MUSE_CI_JOB_START_MS` can be supplied when a vendor exposes one. Never put
these roots inside the checkout or fall back there on a failed run.

`outputs.json` holds the Action's status, exit-code, paths, patch-withheld,
requests, costs, image/uncertain tallies and diff-truncated outputs. Signal
exits retain 130/143; exec nonzero remains nonzero; wrapper failure is 1;
validated success is 0. Facts/inputs/key refusals exit 1 before spending.

## Pending qualification

Full integrated quality/build/host matrices and M80's L/LA/LR receipts remain
lead-owned. GitLab/Bitbucket need external-temp artifact transport, and
Bitbucket needs automatic-process secret-isolation and timeout-boundary
receipts. No local fake test is presented as a hosted vendor receipt.
