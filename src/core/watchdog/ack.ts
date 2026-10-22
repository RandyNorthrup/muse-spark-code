// M115w WA: the acknowledgement. One template post plus the policy's
// label, once per issue, as the person's own GitHub sign-in. The label
// goes first: a crash between the two retries the label (GitHub dedupes
// it) instead of posting twice. Anything already carrying the marker —
// posted by this watchdog on any machine — is adopted, never repeated.
import { WATCHDOG_ACK_MARKER, WATCHDOG_REPLY_MARKER } from '../../shared/constants'
import { UI_TEXT } from '../../shared/l10n/text'
import type { GitHubClient, GitHubIssue, GitHubIssueComment } from '../git/github'
import type { GitHubRepository } from '../git/githubRemote'
import type { WatchdogIssue, WatchdogPolicy } from '../../shared/watchdog'

/** The shared post footer: the kind's marker plus the automated note. */
export function signWatchdogPost(body: string, marker: string): string {
  return `${body}\n\n${marker}\n\n_${UI_TEXT.watchdog.ack.automatedNote}_`
}

export function composeAckBody(policy: WatchdogPolicy): string {
  const template = policy.ackTemplate ?? UI_TEXT.watchdog.ack.body
  return signWatchdogPost(template, WATCHDOG_ACK_MARKER)
}

export function isWatchdogPost(body: string): boolean {
  return body.includes(WATCHDOG_ACK_MARKER) || body.includes(WATCHDOG_REPLY_MARKER)
}

export function isWatchdogReply(body: string): boolean {
  return body.includes(WATCHDOG_REPLY_MARKER)
}

export type AckSkipNote =
  'skippedPullRequest' | 'skippedLocked' | 'skippedAuthor' | 'skippedLabels' | 'alreadyAcked'

export type AckDecision =
  | { readonly action: 'post' }
  | { readonly action: 'adopt'; readonly comment: GitHubIssueComment }
  | { readonly action: 'skip'; readonly note: AckSkipNote }

function skipNoteFor(issue: GitHubIssue, policy: WatchdogPolicy): AckSkipNote | undefined {
  if (issue.isPullRequest) return 'skippedPullRequest'
  if (issue.isLocked) return 'skippedLocked'
  if (policy.ignoreAuthors.includes(issue.author.login)) return 'skippedAuthor'
  return policy.watchLabels.length > 0 &&
    policy.watchLabels.every((label) => !issue.labels.includes(label))
    ? 'skippedLabels'
    : undefined
}

/** Whether the open issue still needs its acknowledgement, and why not.
Closed issues never reach this: the poll records them silently. */
export function decideAck(
  record: WatchdogIssue | undefined,
  issue: GitHubIssue,
  comments: readonly GitHubIssueComment[],
  policy: WatchdogPolicy,
): AckDecision {
  const skipped = skipNoteFor(issue, policy)
  if (skipped !== undefined) return { action: 'skip', note: skipped }
  if (record?.ackCommentId !== undefined) return { action: 'skip', note: 'alreadyAcked' }
  const own = comments.find((comment) => isWatchdogPost(comment.body))
  return own === undefined ? { action: 'post' } : { action: 'adopt', comment: own }
}

export interface PostedAck {
  readonly commentId: number
  readonly labels: readonly string[]
}

/** Posts the acknowledgement: the label first, then the comment. */
export async function postAck(
  client: GitHubClient,
  token: string,
  repository: GitHubRepository,
  issue: GitHubIssue,
  policy: WatchdogPolicy,
): Promise<PostedAck> {
  const labels = await client.addIssueLabels(token, repository, issue.number, [policy.ackLabel])
  const comment = await client.postIssueComment(
    token,
    repository,
    issue.number,
    composeAckBody(policy),
  )
  return { commentId: comment.id, labels }
}
