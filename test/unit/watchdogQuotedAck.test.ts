// RLF-SAFEFIX item 3: a reporter who quotes the acknowledgement marker is
// still answering; only the watchdog's own unquoted marker is its post.
// Recorded bodies (test/fixtures/m115w/github-issues/, issue 3 and its one
// comment, captured 2026-10-24 against the public
// RandyNorthrup/muse-spark-code repository): every author, id and reply
// text below is recorded. Only the quoted line is the watchdog's own
// output, built by its real composer, inside GitHub's quote-reply shape
// (each quoted line starts with `> `). No GitHub stand-in: the real
// matcher reads the recorded bodies.
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  composeAckBody,
  decideAck,
  isWatchdogPost,
  signWatchdogPost,
  watchdogReplyMarker,
} from '../../src/core/watchdog/ack'
import { isReporterAnswer } from '../../src/core/watchdog/poll'
import type { GitHubIssue, GitHubIssueComment } from '../../src/core/git/github'
import { defaultWatchdogPolicy } from '../../src/shared/watchdog'
import { WATCHDOG_REPOSITORY } from './helpers/watchdog/fixtures'

const CAPTURES = path.join(__dirname, '..', 'fixtures', 'm115w', 'github-issues')

interface RecordedUser {
  readonly login: string
  readonly id: number
}

interface RecordedIssue {
  readonly id: number
  readonly number: number
  readonly html_url: string
  readonly state: string
  readonly title: string
  readonly user: RecordedUser
  readonly labels: readonly { readonly name: string }[]
  readonly locked: boolean
  readonly comments: number
  readonly created_at: string
  readonly updated_at: string
  readonly closed_at: string | null
  readonly body: string | null
  readonly author_association: string
}

interface RecordedComment {
  readonly id: number
  readonly html_url: string
  readonly user: RecordedUser
  readonly created_at: string
  readonly updated_at: string
  readonly body: string | null
  readonly author_association: string
}

function recordedIssue(): RecordedIssue {
  return JSON.parse(
    readFileSync(path.join(CAPTURES, 'github-issue-3', 'response.body.json'), 'utf8'),
  ) as RecordedIssue
}

function recordedComments(): readonly RecordedComment[] {
  return JSON.parse(
    readFileSync(path.join(CAPTURES, 'github-issue-3-comments', 'response.body.json'), 'utf8'),
  ) as readonly RecordedComment[]
}

function issueOf(raw: RecordedIssue): GitHubIssue {
  return {
    id: raw.id,
    number: raw.number,
    url: raw.html_url,
    state: 'open',
    title: raw.title,
    author: { login: raw.user.login, id: raw.user.id },
    labels: raw.labels.map((label) => label.name),
    isLocked: raw.locked,
    commentCount: raw.comments,
    createdAt: raw.created_at,
    updatedAt: raw.updated_at,
    closedAt: undefined,
    body: raw.body ?? '',
    association: raw.author_association,
    isPullRequest: false,
  }
}

function commentOf(raw: RecordedComment, body: string): GitHubIssueComment {
  return {
    id: raw.id,
    url: raw.html_url,
    author: { login: raw.user.login, id: raw.user.id },
    createdAt: raw.created_at,
    updatedAt: raw.updated_at,
    body,
    association: raw.author_association,
  }
}

const policy = defaultWatchdogPolicy(WATCHDOG_REPOSITORY)

describe('watchdog quoted acknowledgement', () => {
  it('counts a reporter reply quoting the marker as an answer, never the bot post itself', () => {
    const raw = recordedIssue()
    const [recorded] = recordedComments()
    if (recorded === undefined) throw new Error('expected the recorded issue-3 comment')
    const issue = issueOf(raw)
    const replyId = recorded.id - 1
    const needsInfo = signWatchdogPost(
      'What did you do?',
      watchdogReplyMarker({ runId: 'quoted-ack-run', triageRound: 0 }, 'needsInfo'),
    )
    const botReply: GitHubIssueComment = {
      id: replyId,
      url: recorded.html_url,
      author: { login: 'muse-spark-code-watchdog', id: 0 },
      createdAt: recorded.created_at,
      updatedAt: recorded.updated_at,
      body: needsInfo,
      association: 'NONE',
    }
    // GitHub's quote-reply shape: the quoted marker line starts with `> `,
    // then the reporter's own recorded words.
    const quoted = commentOf(
      recorded,
      `> ${
        composeAckBody(policy)
          .split('\n')
          .find((line) => line.includes('watchdog:ack')) ?? ''
      }\n\n${recorded.body ?? ''}`,
    )
    expect(quoted.author.login).toBe(issue.author.login)
    expect(isReporterAnswer({ replyCommentId: replyId }, issue, [botReply, quoted])).toBe(true)
  })

  it('never counts the bot post itself as an answer, even under the reporter login', () => {
    const raw = recordedIssue()
    const [recorded] = recordedComments()
    if (recorded === undefined) throw new Error('expected the recorded issue-3 comment')
    const issue = issueOf(raw)
    const replyId = recorded.id - 1
    // The person running the watchdog files in their own repository: the
    // bot's acknowledgement carries the reporter's own login, unquoted.
    const own = commentOf(recorded, composeAckBody(policy))
    expect(own.author.login).toBe(issue.author.login)
    expect(isReporterAnswer({ replyCommentId: replyId }, issue, [own])).toBe(false)
  })

  it('matches only the unquoted marker, for answers and for adoption', () => {
    const raw = recordedIssue()
    const [recorded] = recordedComments()
    if (recorded === undefined) throw new Error('expected the recorded issue-3 comment')
    const issue = issueOf(raw)
    const own = composeAckBody(policy)
    // GitHub's quote-reply prefixes every quoted line, not just the first.
    const quotedOwn = own
      .split('\n')
      .map((line) => `> ${line}`)
      .join('\n')
    expect(isWatchdogPost(own)).toBe(true)
    expect(isWatchdogPost(`${quotedOwn}\n\n${recorded.body ?? ''}`)).toBe(false)
    // A quoted marker is not an acknowledgement out there: the ack is owed.
    expect(
      decideAck(
        undefined,
        issue,
        [commentOf(recorded, `${quotedOwn}\n\n${recorded.body ?? ''}`)],
        policy,
      ).action,
    ).toBe('post')
    expect(decideAck(undefined, issue, [commentOf(recorded, own)], policy)).toMatchObject({
      action: 'adopt',
    })
  })
})
