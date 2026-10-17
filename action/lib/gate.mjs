// The Action's gate (M80, SPEC §6.6): a pure decision over the captured event
// and the API's view of the pull request. Nothing is installed, checked out
// or given the key unless this allows the run. Refusals name a fixed reason.

const EVENTS = new Set([
  'pull_request',
  'issue_comment',
  'pull_request_review_comment',
  'workflow_dispatch',
])
const PR_ACTIONS = new Set(['opened', 'synchronize', 'reopened', 'ready_for_review'])
const ASSOCIATIONS = new Set(['OWNER', 'MEMBER', 'COLLABORATOR'])
const SHA = /^(?:[0-9a-f]{40}|[0-9a-f]{64})$/
const REF = /^(?!-)(?!.*\.\.)(?!.*\/\/)(?!.*@\{)[A-Za-z0-9._/-]{1,255}(?<![./])$/
const REPOSITORY = /^[A-Za-z0-9_.-]{1,100}\/[A-Za-z0-9_.-]{1,100}$/
export const GATE_TASK_MAX_CHARS = 4000

function record(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value) ? value : undefined
}

function text(value) {
  return typeof value === 'string' ? value : undefined
}

function refuse(reason) {
  return { allowed: false, reason }
}

/** The PR number the event names, before any API call; null when it names none. */
export function eventPrNumber(eventName, event, dispatchPrNumber) {
  if (eventName === 'workflow_dispatch') return dispatchPrNumber
  const payload = record(event)
  const issue = record(payload?.issue)
  const onPull = record(issue?.pull_request) === undefined ? undefined : issue?.number
  const number = eventName === 'issue_comment' ? onPull : record(payload?.pull_request)?.number
  return Number.isSafeInteger(number) && number > 0 ? number : null
}

/** The API's pull request, refused unless open, same-repository and fully named. */
function checkPull(pr, repository) {
  const pull = record(pr)
  const head = record(pull?.head)
  const base = record(pull?.base)
  if (pull === undefined || head === undefined || base === undefined) {
    return refuse('the pull request head is not available')
  }
  if (text(record(head.repo)?.full_name) !== repository) {
    return refuse('the pull request comes from another repository')
  }
  if (pull.state !== 'open') return refuse('the pull request is not open')
  const headSha = text(head.sha) ?? ''
  const baseSha = text(base.sha) ?? ''
  const headRef = text(head.ref) ?? ''
  if (!SHA.test(headSha) || !SHA.test(baseSha) || !REF.test(headRef)) {
    return refuse('the pull request head or base is malformed')
  }
  const number = pull.number
  if (!Number.isSafeInteger(number) || number < 1) return refuse('the pull request is malformed')
  return {
    allowed: true,
    prNumber: number,
    headSha,
    baseSha,
    headRef,
    title: text(pull.title) ?? '',
    body: text(pull.body) ?? '',
  }
}

/** The collaborator's task from a comment: the text after the trigger phrase. */
function commentTask(comment, triggerPhrase) {
  const body = text(comment?.body) ?? ''
  if (!body.startsWith(triggerPhrase)) return refuse('the comment does not start with the trigger')
  const task = body.slice(triggerPhrase.length).trim()
  return task.length > GATE_TASK_MAX_CHARS
    ? refuse('the task is longer than 4,000 characters')
    : { allowed: true, task }
}

function checkPullRequestEvent(payload, repository) {
  const pull = record(payload.pull_request)
  if (!PR_ACTIONS.has(text(payload.action) ?? '')) {
    return refuse('the pull request action does not start a run')
  }
  if (text(record(record(pull?.head)?.repo)?.full_name) !== repository) {
    return refuse('the pull request comes from another repository')
  }
  return ASSOCIATIONS.has(text(pull?.author_association) ?? '')
    ? { allowed: true, task: '', eventHeadSha: text(record(pull?.head)?.sha) ?? '' }
    : refuse('the pull request author is not an owner, member or collaborator')
}

function checkCommentEvent(eventName, payload, triggerPhrase) {
  if (payload.action !== 'created') return refuse('only a newly created comment starts a run')
  if (eventName === 'issue_comment' && record(record(payload.issue)?.pull_request) === undefined) {
    return refuse('the comment is not on a pull request')
  }
  const comment = record(payload.comment)
  return ASSOCIATIONS.has(text(comment?.author_association) ?? '')
    ? commentTask(comment, triggerPhrase)
    : refuse('the commenter is not an owner, member or collaborator')
}

function checkEvent(input, payload) {
  switch (input.eventName) {
    case 'pull_request': {
      return checkPullRequestEvent(payload, input.repository)
    }
    case 'issue_comment':
    case 'pull_request_review_comment': {
      return checkCommentEvent(input.eventName, payload, input.triggerPhrase)
    }
    default: {
      const number = input.dispatchPrNumber
      return Number.isSafeInteger(number) && number > 0
        ? { allowed: true, task: '' }
        : refuse('workflow_dispatch needs a positive integer pr-number')
    }
  }
}

/**
 * The gate (SPEC §6.6): event, runner, sender, PR or comment or dispatch,
 * image and API checks, in that order. Only an allowed decision carries the
 * validated PR identity, task and metadata.
 */
export function decide(input) {
  if (input.eventName === 'pull_request_target') return refuse('pull_request_target is refused')
  if (!EVENTS.has(input.eventName)) return refuse('this event cannot start a run')
  if (!REPOSITORY.test(input.repository)) return refuse('the repository name is malformed')
  const isHosted = input.runnerEnvironment === 'github-hosted'
  if (!isHosted && input.isPublic) return refuse('a public repository needs a GitHub-hosted runner')
  const payload = record(input.event)
  if (payload === undefined) return refuse('the event is missing')
  const sender = record(payload.sender)
  if (sender?.type === 'Bot' || (text(sender?.login) ?? '').endsWith('[bot]')) {
    return refuse('a bot cannot start a run')
  }
  if (input.imageGeneration && input.mode === 'review') {
    return refuse('image-generation needs fix mode')
  }
  const event = checkEvent(input, payload)
  if (!event.allowed) return event
  const pull = checkPull(input.pr, input.repository)
  if (!pull.allowed) return pull
  if (event.eventHeadSha !== undefined && event.eventHeadSha !== pull.headSha) {
    return refuse('the event head differs from the pull request head')
  }
  const expected = eventPrNumber(input.eventName, payload, input.dispatchPrNumber)
  if (expected !== pull.prNumber) return refuse('the pull request number does not match')
  return {
    allowed: true,
    prNumber: pull.prNumber,
    headSha: pull.headSha,
    baseSha: pull.baseSha,
    headRef: pull.headRef,
    task: event.task,
    title: pull.title,
    body: pull.body,
    warning: isHosted
      ? null
      : 'a private repository on a self-hosted runner: other processes of the same user can inspect this run',
  }
}
