// The event and trust facts of the CI systems other than GitHub Actions
// (lane CM80CI-R2, PLAN.md M80/D65): GitLab CI, Azure Pipelines, Jenkins and
// Bitbucket Pipelines. Each adapter reads only that system's own predefined
// variables: where it checked the repository out, the commit under test, the
// base its diff starts from, and what the system says about trust (fork,
// pull request, protected ref). The system's own mechanism keeps untrusted
// runs away from the step that binds the key (docs/ci-other-systems.md);
// decideCi repeats the refusal inside the launcher. Pure functions.

import { InputError } from './tools.mjs'

export const CI_SYSTEMS = Object.freeze(['gitlab', 'azure', 'jenkins', 'bitbucket'])
const SHA = /^(?:[0-9a-f]{40}|[0-9a-f]{64})$/
const ZERO_SHA = /^0+$/
const RUN_NUMBER = /^[0-9]{1,20}$/
const ATTEMPT = /^[1-9][0-9]{0,9}$/
const CHANGE = /^[A-Za-z0-9_-]{1,40}$/
const PROJECT_ID = /^[0-9]{1,20}$/
// A branch name as gate.mjs accepts a pull request head ref.
const BRANCH = /^(?!-)(?!.*\.\.)(?!.*\/\/)(?!.*@\{)[A-Za-z0-9._/-]{1,255}(?<![./])$/
const GITLAB_BRANCH_SOURCES = new Set(['push', 'web', 'schedule', 'api'])
// BatchedCI is deliberately absent: a batch folds several new commits into
// one build and Azure names no pre-batch revision, so there is no base that
// covers the whole batch. BatchedCI builds are refused below.
const AZURE_BRANCH_REASONS = new Set(['Manual', 'IndividualCI', 'Schedule'])

/**
Azure's string booleans: Azure turns every boolean into the text True or
False, so the comparison ignores case. Empty is undefined; anything else
is refused by name.
*/
export function azureBoolean(value, name) {
  if (value === undefined || value === '') return
  const lower = value.toLowerCase()
  if (lower === 'true') return true
  if (lower === 'false') return false
  throw new InputError(`${name} must be true or false`)
}

function required(env, name, pattern) {
  const value = env[name] ?? ''
  if (!pattern.test(value)) throw new InputError(`${name} is missing or malformed`)
  return value
}

function optional(env, name) {
  return env[name] ?? ''
}

function branchBase() {
  return { firstParent: true }
}

/** A remote-tracking branch of the system's own clone, by a validated name. */
function trackingRef(env, name) {
  const branch = (env[name] ?? '').replace(/^refs\/heads\//, '')
  if (!BRANCH.test(branch)) throw new InputError(`${name} is missing or malformed`)
  return { ref: `refs/remotes/origin/${branch}` }
}

function gitlab(env) {
  const source = optional(env, 'CI_PIPELINE_SOURCE')
  const headSha = required(env, 'CI_COMMIT_SHA', SHA)
  const common = {
    workspace: optional(env, 'CI_PROJECT_DIR'),
    runId: required(env, 'CI_JOB_ID', RUN_NUMBER),
    attempt: '1',
    headSha,
  }
  if (source === 'merge_request_event') {
    const iid = required(env, 'CI_MERGE_REQUEST_IID', CHANGE)
    return {
      ...common,
      event: 'pull_request',
      label: `merge request !${iid}`,
      number: iid,
      isFork:
        required(env, 'CI_MERGE_REQUEST_SOURCE_PROJECT_ID', PROJECT_ID) !==
        required(env, 'CI_PROJECT_ID', PROJECT_ID),
      isProtected: env.CI_MERGE_REQUEST_SOURCE_BRANCH_PROTECTED === 'true',
      base: { sha: required(env, 'CI_MERGE_REQUEST_DIFF_BASE_SHA', SHA) },
      title: optional(env, 'CI_MERGE_REQUEST_TITLE'),
      body: optional(env, 'CI_MERGE_REQUEST_DESCRIPTION'),
    }
  }
  const before = optional(env, 'CI_COMMIT_BEFORE_SHA')
  const isBranch = GITLAB_BRANCH_SOURCES.has(source) && optional(env, 'CI_COMMIT_TAG') === ''
  return {
    ...common,
    event: isBranch ? 'branch' : 'unsupported',
    label: `branch ${optional(env, 'CI_COMMIT_BRANCH')}`,
    number: null,
    isFork: false,
    isProtected: env.CI_COMMIT_REF_PROTECTED === 'true',
    base: SHA.test(before) && !ZERO_SHA.test(before) ? { sha: before } : branchBase(),
    title: '',
    body: '',
  }
}

function azure(env) {
  const reason = optional(env, 'BUILD_REASON')
  const common = {
    workspace: optional(env, 'BUILD_SOURCESDIRECTORY'),
    runId: required(env, 'BUILD_BUILDID', RUN_NUMBER),
    attempt:
      optional(env, 'SYSTEM_JOBATTEMPT') === '' ? '1' : required(env, 'SYSTEM_JOBATTEMPT', ATTEMPT),
    headSha: required(env, 'BUILD_SOURCEVERSION', SHA),
    isProtected: null,
    title: '',
    body: '',
  }
  if (reason === 'PullRequest') {
    const isFork = azureBoolean(env.SYSTEM_PULLREQUEST_ISFORK, 'System.PullRequest.IsFork')
    if (isFork === undefined) throw new InputError('System.PullRequest.IsFork is missing')
    const number =
      optional(env, 'SYSTEM_PULLREQUEST_PULLREQUESTNUMBER') ||
      required(env, 'SYSTEM_PULLREQUEST_PULLREQUESTID', CHANGE)
    if (!CHANGE.test(number)) throw new InputError('the pull request number is malformed')
    // Azure checks out the pull request's merge commit; its first parent is the target branch.
    return {
      ...common,
      event: 'pull_request',
      label: `pull request ${number}`,
      number,
      isFork,
      base: { mergeParent: true },
    }
  }
  if (reason === 'BatchedCI') {
    // A batch carries every commit since the previous build, but Azure's
    // predefined variables name only the batch head: first-parent would
    // review just the last commit and silently drop the rest. Refuse.
    return {
      ...common,
      event: 'unsupported',
      label: `branch ${optional(env, 'BUILD_SOURCEBRANCHNAME')}`,
      number: null,
      isFork: false,
      base: branchBase(),
    }
  }
  return {
    ...common,
    event: AZURE_BRANCH_REASONS.has(reason) ? 'branch' : 'unsupported',
    label: `branch ${optional(env, 'BUILD_SOURCEBRANCHNAME')}`,
    number: null,
    isFork: false,
    base: branchBase(),
  }
}

function jenkins(env) {
  const change = optional(env, 'CHANGE_ID')
  const common = {
    workspace: optional(env, 'WORKSPACE'),
    runId: required(env, 'BUILD_NUMBER', RUN_NUMBER),
    attempt: '1',
    headSha: required(env, 'GIT_COMMIT', SHA),
    isProtected: null,
    body: '',
  }
  if (change !== '') {
    if (!CHANGE.test(change)) throw new InputError('CHANGE_ID is malformed')
    return {
      ...common,
      event: 'pull_request',
      label: `change request ${change}`,
      number: change,
      isFork: optional(env, 'CHANGE_FORK') !== '',
      base: trackingRef(env, 'CHANGE_TARGET'),
      title: optional(env, 'CHANGE_TITLE'),
    }
  }
  return {
    ...common,
    event:
      optional(env, 'BRANCH_NAME') === '' && optional(env, 'GIT_BRANCH') === ''
        ? 'unsupported'
        : 'branch',
    label: `branch ${optional(env, 'BRANCH_NAME') || optional(env, 'GIT_BRANCH')}`,
    number: null,
    isFork: false,
    base: branchBase(),
    title: '',
  }
}

function bitbucket(env) {
  const pullRequest = optional(env, 'BITBUCKET_PR_ID')
  const common = {
    workspace: optional(env, 'BITBUCKET_CLONE_DIR'),
    runId: required(env, 'BITBUCKET_BUILD_NUMBER', RUN_NUMBER),
    attempt: '1',
    headSha: required(env, 'BITBUCKET_COMMIT', SHA),
    // Bitbucket does not start this repository's pipelines for pull requests from forks.
    isFork: false,
    isProtected: null,
    title: '',
    body: '',
  }
  if (pullRequest !== '') {
    if (!CHANGE.test(pullRequest)) throw new InputError('BITBUCKET_PR_ID is malformed')
    return {
      ...common,
      event: 'pull_request',
      label: `pull request #${pullRequest}`,
      number: pullRequest,
      base: trackingRef(env, 'BITBUCKET_PR_DESTINATION_BRANCH'),
    }
  }
  const branch = optional(env, 'BITBUCKET_BRANCH')
  return {
    ...common,
    event: branch === '' || optional(env, 'BITBUCKET_TAG') !== '' ? 'unsupported' : 'branch',
    label: `branch ${branch}`,
    number: null,
    base: branchBase(),
  }
}

const ADAPTERS = { gitlab, azure, jenkins, bitbucket }

/** One system's facts from its predefined variables; malformed or missing facts are refused by name. */
export function ciFacts(system, env) {
  const adapter = Object.hasOwn(ADAPTERS, system) ? ADAPTERS[system] : undefined
  if (adapter === undefined) throw new InputError('the CI system is not one this launcher knows')
  const facts = adapter(env)
  if (facts.workspace === '') throw new InputError('the checkout directory is missing')
  return { system, ...facts }
}

/**
The launcher's own gate over the facts, after the system's mechanism has
already kept untrusted runs out: an unsupported event, a fork, a pull
request without trust-pull-requests, or an unprotected GitLab ref is
refused with a fixed reason, and image generation needs fix mode.
*/
export function decideCi(facts, inputs) {
  if (facts.event === 'unsupported') return refuse('this pipeline event cannot start a run')
  if (facts.isFork) return refuse('the change comes from a fork')
  if (facts.event === 'pull_request' && !inputs.trustPullRequests) {
    return refuse('pull requests run only with trust-pull-requests set to true')
  }
  if (facts.isProtected === false) return refuse('the source branch is not protected')
  return inputs.imageGeneration && inputs.mode === 'review'
    ? refuse('image-generation needs fix mode')
    : { allowed: true }
}

function refuse(reason) {
  return { allowed: false, reason }
}
