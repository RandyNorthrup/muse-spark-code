# Headless runs on other CI systems (Unofficial)

PLAN.md M80/D65, lanes CM80CI and CM80CI-R2. The project's own CI is GitHub
Actions (PLAN A7), and [the CI guide](ci.md) describes the GitHub Action.
`ci-templates/` carries one template each for GitLab CI, Azure Pipelines,
Jenkins and Bitbucket Pipelines. They do not have a launcher of their own:
each runs the GitHub Action's launcher, with a small adapter for that
system's event and trust facts.

## Claim limits

Like the Action, these templates are not certified or supported yet. They
are tested with fakes only (template validators that parse each file, the
exact template scripts under `sh -xe` with recording shims, and the launcher
end to end against a real clone, real Git, real npm and a fake agent). No
live run on any of these systems exists, and no real key has been used.
The launcher ships in the `muse-spark-code-acp` package from the first
release after 0.17.0; until that release exists there is no version to pin.

## How a run works

The package carries the Action's own scripts as `ci/lib` (from `action/lib`)
and its prompt templates as `ci/prompts`. Every template runs the same
POSIX shell bootstrap in the one step that has the key:

1. Tracing goes off (`set +x`), the key is copied into a shell variable that
   is not exported, and `MUSE_MODEL_API_KEY` is unset, before any other
   command runs.
2. The pinned version is downloaded (`curl --max-time 120`) into a private
   `mktemp -d` folder outside the checkout, and its SHA-256 is compared with
   `MUSE_INPUT_AGENT_PACKAGE_SHA256` by `sha256sum`. A mismatch stops the step
   before anything of the package is unpacked or run.
3. The tarball is unpacked with `tar` (no package manager, so no lifecycle
   script), and the shell `exec`s `node ci/lib/ci-run.mjs <system>` with the
   key in `MUSE_SPARK_MODEL_API_KEY` only. Being an `exec`, the launcher is
   the step's process: a cancellation signal reaches it directly.

The launcher (`action/lib/ci-run.mjs`) then:

- deletes the key from its environment under every name that carries it
  (the run variable, the system's secret name, and any other variable whose
  value holds the key);
- reads the system's facts (`action/lib/ci-adapters.mjs`) and refuses an
  unsupported event, a fork, a pull request without
  `MUSE_INPUT_TRUST_PULL_REQUESTS`, an unprotected GitLab ref, or image
  generation in review mode, before anything is installed;
- refuses a `MUSE_INPUT_TIMEOUT_MINUTES` the job's own timeout cannot cover
  (setup, download, install, checkout, the run and every later bound);
- installs the same tarball the Action's way (`install.mjs`): SHA-256 checked
  again, `npm install --ignore-scripts` into a private prefix with an empty
  private npm configuration and the registry pinned, then the installed
  package's name, version and bin checked;
- makes its own repository from the system's clone without running anything
  of it: a fresh `git init`, the clone's `HEAD` (and a pull request's target
  branch) fetched over the local file transport through the Action's
  sanitized Git, the head the system names verified and checked out;
- stages the change resource (which change, head, base, any title and
  description the system supplies) as untrusted data, generates the review
  diff (merge base to head) cut to `MUSE_INPUT_MAX_DIFF_BYTES`, renders the
  prompt from `ci/prompts/<mode>.md` and passes it with `--prompt-file`;
- runs `exec --key-stdin` and, in fix mode, `scan-secrets --key-stdin` under
  the Action's launcher owner: signals forwarded and the child killed at its
  bound, both pipes drained under byte bounds, the result accepted only if
  it validates against the result schema with the matching exit code;
- writes `muse-spark-out/` in the checkout (the folder must not exist) with
  `outputs.json` and whatever the run published (`result.json`,
  `events.jsonl`, and in fix mode `fix.patch` and `manifest.json`), prints
  the Action's run summary, and removes its private work folder.

Nothing comments on a change or pushes. Results leave through each system's
artifact upload only.

## Each system's own mechanism

The real boundary is each system's secret scoping: a run that the system
does not trust never has the key. The template's conditions then keep the
credential step from even starting, and the launcher refuses again from the
system's own variables.

| System    | Secret                                                                  | What keeps untrusted runs away from it                                                                                                                                                                                                                                                                                                                                                                                                                                        | Timeout                                                        | Clone                                                                            |
| --------- | ----------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------- | -------------------------------------------------------------------------------- |
| GitLab    | `MUSE_MODEL_API_KEY`: Protected, Masked (and Hidden) CI/CD variable     | GitLab gives a Protected variable only to pipelines of protected branches and tags. The job's `rules:` never run it for a fork merge request, a merge request unless `MUSE_INPUT_TRUST_PULL_REQUESTS` is true, a merge request from an unprotected source branch, an unprotected ref, or a tag. The launcher checks `CI_MERGE_REQUEST_SOURCE_PROJECT_ID`, `CI_MERGE_REQUEST_SOURCE_BRANCH_PROTECTED` and `CI_COMMIT_REF_PROTECTED` again.                                     | `timeout: 35m`; the launcher reads `CI_JOB_TIMEOUT`            | `GIT_DEPTH: '0'`                                                                 |
| Azure     | `MUSE_MODEL_API_KEY`: secret pipeline variable or variable-group secret | Azure maps a secret into no step unless the step names it: only the run step's `env:` does. Keep "Make secrets available to builds of forks" off (its default), so fork pull request builds have no secret. The job `condition:` skips fork pull requests and every pull request unless `MUSE_INPUT_TRUST_PULL_REQUESTS` is true. Azure writes booleans as `True`/`False`; its `eq()` and the launcher both compare them without case (`System.PullRequest.IsFork` included). | `timeoutInMinutes: 35` and `MUSE_CI_JOB_TIMEOUT_MINUTES: '35'` | `fetchDepth: 0`, `persistCredentials: false`; a pull request is its merge commit |
| Jenkins   | Secret text credential `muse-model-api-key`                             | `withCredentials` binds it only inside the one stage whose `when` (with `beforeAgent true`) excludes `CHANGE_FORK` and every change request unless `MUSE_INPUT_TRUST_PULL_REQUESTS` is checked. In a multibranch job keep fork discovery at a trust level that builds untrusted forks with the target branch's Jenkinsfile, so a fork cannot edit this file. The shell starts with `set +x` because Jenkins runs `sh -xe`.                                                    | `timeout(time: 35)` and `MUSE_CI_JOB_TIMEOUT_MINUTES = '35'`   | Full clone; a change request needs its target branch fetched                     |
| Bitbucket | `MUSE_MODEL_API_KEY`: Secured repository variable                       | Bitbucket does not start this repository's pipelines for pull requests from forks. The step is listed only under `branches: main` and `custom:` (run by hand by someone with write access), never under `pull-requests:`; add it there only with `MUSE_INPUT_TRUST_PULL_REQUESTS` true, or the launcher refuses the pull request build.                                                                                                                                       | `max-time: 35` and `MUSE_CI_JOB_TIMEOUT_MINUTES=35`            | `clone: depth: full`                                                             |

Same-repository pull requests are trusted only when you say so, because
whoever can push a branch can edit the template on that branch, the same
trust GitHub places in collaborators (see the CI guide's isolation section).

What each run reviews:

- **GitLab merge request:** `CI_MERGE_REQUEST_DIFF_BASE_SHA` to
  `CI_COMMIT_SHA`. **Push, web, schedule or API pipeline:** `CI_COMMIT_BEFORE_SHA`
  to `CI_COMMIT_SHA`, or the head's first parent when GitLab gives no
  earlier commit.
- **Azure pull request:** the merge commit Azure checks out
  (`Build.SourceVersion`) against its first parent, the target branch; a
  checkout that is not a merge commit is refused. **Manual, CI or schedule:**
  the head's first parent.
- **Jenkins change request:** `origin/<CHANGE_TARGET>` to `GIT_COMMIT`.
  **Branch:** the head's first parent.
- **Bitbucket pull request:** `origin/<BITBUCKET_PR_DESTINATION_BRANCH>` to
  `BITBUCKET_COMMIT`. **Branch or custom:** the head's first parent.

## Inputs

The inputs are the Action's, under the names its own steps use
(`MUSE_INPUT_*`), validated by the same code (`tools.mjs`):
`MUSE_INPUT_MODE`, `MUSE_INPUT_MAX_BUDGET_USD`, `MUSE_INPUT_MAX_REQUESTS`,
`MUSE_INPUT_TIMEOUT_MINUTES`, `MUSE_INPUT_MODEL`, `MUSE_INPUT_EFFORT`,
`MUSE_INPUT_ALLOW_CONTRIBUTOR_MODELS`, `MUSE_INPUT_IMAGE_GENERATION`,
`MUSE_INPUT_MAX_DIFF_BYTES`, `MUSE_INPUT_EXTRA_INSTRUCTIONS`,
`MUSE_INPUT_HTTPS_PROXY`, `MUSE_INPUT_NO_PROXY` and
`MUSE_INPUT_EXTRA_CA_CERTS`, plus `MUSE_INPUT_TRUST_PULL_REQUESTS` (default
false). The template sets `MUSE_INPUT_AGENT_PACKAGE` to the verified
tarball; you pin `MUSE_AGENT_VERSION` and `MUSE_INPUT_AGENT_PACKAGE_SHA256`.
The GitHub-only inputs (trigger phrase, pull request number, path, comment,
artifact upload) are refused when set. An empty value takes the Action's
default; an explicitly empty budget is refused, as the Action refuses it.
The task is fixed (`Review this change.` or `Make the change these commits
need.`); add yours with `MUSE_INPUT_EXTRA_INSTRUCTIONS`.

## Outputs and exit codes

`muse-spark-out/outputs.json` holds the Action's outputs (status, exit-code,
out-dir, result-path, events-path, patch-path, patch-withheld, requests,
cost-usd, cost-is-upper-bound, images, image-attempts, images-uncertain,
paid-uncertain-usd, diff-truncated), with paths inside `muse-spark-out/`.
The step exits as the Action's run step does: a signal's own code (130 or
143, status cancelled), else exec's nonzero code, else 1 for any wrapper
failure (status unknown, nothing published), else 0. A refusal, a malformed
system fact, a bad input or an invalid key exits 1 with a fixed message
before anything is installed or spent.

## Residual limits

- No live receipt on any of the four systems, and the npm registry path
  waits for M80's LR receipt as the Action's does.
- The local fetch runs Git's upload-pack in the system's own clone, which
  reads that clone's configuration; the system wrote it before any script.
  Git refuses a clone owned by another user (no `safe.directory` is read).
- Bitbucket gives no fork variable; the template relies on Bitbucket not
  starting fork pull request pipelines and never lists the step under
  `pull-requests:`.
- As with the Action, the launcher's initial environment can stay readable
  by the same user, and readable checkout contents can reach Meta.
