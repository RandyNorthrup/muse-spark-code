# Headless runs on other CI systems (Unofficial)

Lane CM80CI, PLAN.md M80/D65. The project's CI is GitHub Actions (PLAN A7),
but the headless CLI runs anywhere. `ci-templates/` carries one template per
supported system plus the shared runner they all call:

| System          | Template                               | Secret store                       | Fork / untrusted-run mechanism                         |
| --------------- | -------------------------------------- | ---------------------------------- | ------------------------------------------------------ |
| GitLab CI       | `ci-templates/gitlab-ci.yml`           | Masked + Protected CI/CD variable  | Project-path `rules:` mark fork MRs untrusted          |
| Azure Pipelines | `ci-templates/azure-pipelines.yml`     | Secret pipeline variable (padlock) | `System.PullRequest.IsFork` marks fork PRs untrusted   |
| Jenkins         | `ci-templates/Jenkinsfile`             | Secret text credential + masking   | `CHANGE_FORK` set for fork PRs; PRs need an opt-in     |
| Bitbucket       | `ci-templates/bitbucket-pipelines.yml` | Secured repository variable        | `BITBUCKET_PR_ID` marks PR builds untrusted by default |

Vendor the template and `ci-templates/muse-spark-run.mjs` together; the
template calls the runner twice (install with no secret, then run with the
key). Runners are Linux with Node 22. The runner itself is platform-neutral
Node with no dependencies and normalises paths to forward slashes, so logs
and summaries match on Windows too.

## Claim limits

These templates are integration-tested with fakes on this machine (34 tests:
structural validators plus end-to-end runs of the exact template command
against a fake agent binary, asserting the Action's outputs and exit codes).
There is no live receipt on any of these systems yet: no real key has run
here, and the npm-registry install path is pending the same LR receipt the
GitHub registry path waits for (docs/ci.md). Until then, pin a release
tarball with `MUSE_AGENT_TARBALL` plus `MUSE_AGENT_TARBALL_SHA256`, exactly
like the Action's `agent-package` pair. This page does not claim certified
or supported runs.

## What a template does

Each template is equivalent to the GitHub Action's documented inputs: plan
or fix mode, fix-mode limits, budget cap, model, the key from that system's
secret store, no comment or push unless asked, and the same refusals and
exit codes:

1. **Install** (`--install-only`, no secret): exact pinned registry version
   (`MUSE_AGENT_VERSION`, immutable like the Action's SHA pin) or a tarball
   whose SHA-256 must match, installed with `npm install --global` and no
   audit, fund or notifier traffic.
2. **Run**: the runner validates every input with the Action's grammar
   (budget `^[0-9]+(\.[0-9]{1,6})?$`, more than 0, at most 20; requests
   1–500; timeout 1–360 minutes; known effort; model id shape), refuses
   untrusted sources (exit 0, nothing runs, nothing is spent — the Action's
   gate-skip semantics), deletes the key from the child environment, pipes
   it over private stdin to exactly one trusted child (`exec --key-stdin`),
   and propagates exec's exit code unchanged. Stdout lands in
   `MUSE_OUT_DIR/result.json` with a `run-summary.json` beside it; the
   template uploads the directory as artifacts.

Image generation is refused in review mode, exactly like the Action. The
templates never post a comment and never push: results leave through each
system's artifact upload only.

## Secrets handling, per system

The rule matches the Action's: the key reaches only the run step and is
never echoed; forks and untrusted runs cannot reach it.

- **GitLab.** `MUSE_MODEL_API_KEY` is a Masked and Protected variable, so
  values stay out of logs and unprotected refs never receive the variable.
  Job `rules:` compare `CI_MERGE_REQUEST_SOURCE_PROJECT_PATH` with
  `CI_PROJECT_PATH`: fork MRs run as `MUSE_UNTRUSTED`, and the runner
  refuses before reading any key. Same-project pipelines are trusted for
  the same reason the Action trusts collaborators: only writers can change
  the template.
- **Azure.** `MUSE_MODEL_API_KEY` is a secret variable (padlock) or a secret
  in a linked group; keep "Make secrets available to builds of forks" off,
  so fork builds never receive it. `MUSE_UNTRUSTED` is true exactly when
  `System.PullRequest.IsFork` is True. For PR runs that also need a human
  gate, target an Environment with an approval check.
- **Jenkins.** The key is a Secret text credential (`muse-model-api-key`)
  bound by `withCredentials` around the run stage only, masked in logs.
  `CHANGE_FORK` is set for fork PRs and refuses the run; same-repo change
  requests run only with the `MUSE_TRUST_PRS` opt-in, which belongs on jobs
  whose PR discovery is restricted or gated by `input` approval.
- **Bitbucket.** `MUSE_MODEL_API_KEY` is a Secured variable: masked in logs
  and withheld from fork-PR builds. Every pull-request build
  (`BITBUCKET_PR_ID` set) runs as untrusted unless `MUSE_TRUST_SAME_REPO_PRS`
  is true, which belongs only on repositories whose branch permissions keep
  untrusted writers out. Review same-repo PRs from their branch builds, or
  run the branch's custom pipeline by hand.

A trusted run with a missing or malformed key exits 3 (`auth_required`)
without dispatching, and the key shape is validated before use.

## Inputs and exit codes

Inputs mirror `action/action.yml` (mode, max-budget-usd, image-generation,
max-requests, timeout-minutes, model, effort, allow-contributor-models,
max-diff-bytes, prompt, extra instructions); see each template's header for
its variable names. Exit codes are docs/ci.md's table unchanged
(0 completed, 2 usage, 3 auth, 4 failed, 5 budget, 6 timeout, 7 denied,
8 incomplete, 9 unverified accounting, 130/143 cancelled); a refused
untrusted source exits 0 with a `refused` summary, like a refused Action
gate that starts nothing.
