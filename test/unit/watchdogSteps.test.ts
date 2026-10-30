// The watchdog steps that sit below a GitHub call: poll, acknowledgement,
// triage matching, decide, approval and verification. Each test calls the
// real function with issue and record values we built. Nothing here stands
// in for GitHub or answers a fetch.
import { describe, expect, it } from 'vitest'
import type { GitHubCommitMatch, GitHubIssue, GitHubIssueComment } from '../../src/core/git/github'
import { decideAck } from '../../src/core/watchdog/ack'
import { spamHoldResult } from '../../src/core/watchdog/decide'
import {
  fenceIssueText,
  findEmbeddedInstructions,
  resolvePostApproval,
} from '../../src/core/watchdog/guard'
import { isReporterAnswer, watchdogPollEvent } from '../../src/core/watchdog/poll'
import { composeReplyBody } from '../../src/core/watchdog/reply'
import {
  candidateDuplicates,
  issueCommits,
  parseTriageFindings,
  plansTrackingIssue,
} from '../../src/core/watchdog/triage'
import { applyVerification } from '../../src/core/watchdog/verify'
import { UI_TEXT, WATCHDOG_ACK_MARKER } from '../../src/shared/constants'
import {
  defaultWatchdogPolicy,
  nextWatchdogState,
  watchdogIssueSchema,
  type WatchdogIssue,
  type WatchdogPolicy,
} from '../../src/shared/watchdog'
import { WATCHDOG_REPOSITORY, findingsFor } from './helpers/watchdog/fixtures'

function issue(over: Partial<GitHubIssue> = {}): GitHubIssue {
  return {
    id: 1,
    number: 146,
    url: 'https://github.com/RandyNorthrup/muse-spark-code/issues/146',
    state: 'open',
    title: 'Crash on save',
    author: { login: 'reporter', id: 7 },
    labels: [],
    isLocked: false,
    commentCount: 1,
    createdAt: '2026-10-22T00:00:00Z',
    updatedAt: '2026-10-22T00:00:00Z',
    closedAt: undefined,
    body: 'Steps to repeat.',
    association: 'NONE',
    isPullRequest: false,
    ...over,
  }
}

function comment(id: number, login: string, body: string): GitHubIssueComment {
  return {
    id,
    url: `https://github.com/RandyNorthrup/muse-spark-code/issues/146#issuecomment-${String(id)}`,
    author: { login, id },
    createdAt: '2026-10-22T00:00:00Z',
    updatedAt: '2026-10-22T00:00:00Z',
    body,
    association: 'NONE',
  }
}

function commit(sha: string, message: string): GitHubCommitMatch {
  return {
    sha,
    url: `https://github.com/example/${sha}`,
    message,
    date: '2026-10-22',
    author: 'a',
    score: 1,
  }
}

function watched(over: Partial<WatchdogIssue> = {}): WatchdogIssue {
  return watchdogIssueSchema.parse({
    repository: WATCHDOG_REPOSITORY,
    issueNumber: 146,
    issueId: 1,
    state: 'triaged',
    runId: 'run-1',
    seenAtMs: 1,
    ackCommentId: 9,
    labelsApplied: [],
    triageRound: 1,
    lastTitle: 'Crash on save',
    lastTextHash: 'h',
    lastCommentCount: 0,
    lastIssueUpdatedAt: '2026-10-22T00:00:00Z',
    updatedAtMs: 1,
    ...over,
  })
}

function policy(over: Partial<WatchdogPolicy> = {}): WatchdogPolicy {
  return { ...defaultWatchdogPolicy(WATCHDOG_REPOSITORY), ...over }
}

const PASSED = {
  pullRequestNumber: 12,
  pullRequestUrl: 'https://github.com/RandyNorthrup/muse-spark-code/pull/12',
  version: '0.19.0',
  passed: true,
  notes: 'the crash is gone',
}

describe('watchdog spam hold', () => {
  it('keeps a held issue held and does not say it was closed', () => {
    const held = spamHoldResult('triaged', 146)
    expect(held).toEqual({
      number: 146,
      outcome: 'spam',
      state: 'closed',
      posted: false,
      closed: false,
      reason: UI_TEXT.watchdog.refusal.spamHeld,
    })
    expect(held.reason).not.toBe(UI_TEXT.watchdog.cli.closedNote)

    const open = issue()
    const spam = watched({ state: 'closed', outcome: 'spam', findings: findingsFor('spam', 'ads') })
    // An edit of the still-open issue does not start the flow again.
    const edited = issue({ title: 'A different title', body: 'A different body' })
    expect(watchdogPollEvent(spam, open, true, false)).toBe('polled')
    expect(watchdogPollEvent(spam, edited, true, false)).toBe('polled')
    expect(nextWatchdogState(spam.state, 'polled')).toBe('closed')
    // GitHub closing the issue later leaves the hold where it is.
    expect(watchdogPollEvent(spam, issue({ state: 'closed' }), true, false)).toBe('polled')

    const closedOnGitHub = watched({
      state: 'closed',
      outcome: 'duplicate',
      findings: findingsFor('duplicate', 'same report'),
    })
    expect(watchdogPollEvent(closedOnGitHub, open, true, false)).toBe('reopened')
    expect(nextWatchdogState('closed', 'reopened')).toBe('acknowledged')

    expect(() =>
      composeReplyBody('spam', findingsFor('spam', 'ads'), { runId: 'run-1', triageRound: 1 }),
    ).toThrow('a watchdog reply never answers spam')
  })
})

describe('watchdog poll events', () => {
  it('acknowledges, takes a reporter answer, and restarts a stale edit', () => {
    const open = issue()
    expect(watchdogPollEvent(watched({ state: 'seen' }), open, true, false)).toBe('acknowledged')
    expect(watchdogPollEvent(watched({ state: 'seen' }), open, false, false)).toBe('polled')
    expect(
      watchdogPollEvent(
        watched({ state: 'acknowledged' }),
        issue({ state: 'closed' }),
        true,
        false,
      ),
    ).toBe('closed')
    expect(
      watchdogPollEvent(watched({ state: 'awaitingInfo', replyCommentId: 10 }), open, true, true),
    ).toBe('infoReceived')
    expect(
      watchdogPollEvent(
        watched({ state: 'acknowledged', lastTextHash: 'stale' }),
        open,
        true,
        false,
      ),
    ).toBe('edited')
    expect(nextWatchdogState('triaged', 'edited')).toBe('acknowledged')
    // A planned fix is not an edit the poll restarts: the event stays a poll.
    expect(
      watchdogPollEvent(watched({ state: 'planned', lastTextHash: 'stale' }), open, true, false),
    ).toBe('polled')
    expect(nextWatchdogState('planned', 'polled')).toBe('planned')
  })
})

describe('watchdog acknowledgement', () => {
  it('posts once, adopts a marker, and skips what the policy skips', () => {
    const open = issue()
    const base = policy()
    expect(decideAck(undefined, open, [], base)).toEqual({ action: 'post' })
    expect(decideAck(watched({ ackCommentId: 4 }), open, [], base)).toEqual({
      action: 'skip',
      note: 'alreadyAcked',
    })
    const marker = comment(4, 'maintainer', `Seen.\n\n${WATCHDOG_ACK_MARKER}`)
    expect(decideAck(undefined, open, [marker], base)).toEqual({ action: 'adopt', comment: marker })
    expect(decideAck(undefined, issue({ isPullRequest: true }), [], base)).toEqual({
      action: 'skip',
      note: 'skippedPullRequest',
    })
    expect(decideAck(undefined, issue({ isLocked: true }), [], base)).toEqual({
      action: 'skip',
      note: 'skippedLocked',
    })
    expect(decideAck(undefined, open, [], policy({ ignoreAuthors: ['reporter'] }))).toEqual({
      action: 'skip',
      note: 'skippedAuthor',
    })
    expect(decideAck(undefined, open, [], policy({ watchLabels: ['bug'] }))).toEqual({
      action: 'skip',
      note: 'skippedLabels',
    })
    expect(
      decideAck(undefined, issue({ labels: ['bug'] }), [], policy({ watchLabels: ['bug'] })),
    ).toEqual({
      action: 'post',
    })
  })
})

describe('watchdog reporter answer', () => {
  it('counts only a later comment by the reporter that is not ours', () => {
    const open = issue()
    const waiting = watched({ state: 'awaitingInfo', replyCommentId: 10 })
    expect(isReporterAnswer(waiting, open, [comment(11, 'reporter', 'Here are the steps.')])).toBe(
      true,
    )
    expect(
      isReporterAnswer(waiting, open, [comment(10, 'reporter', 'The needs-info reply.')]),
    ).toBe(false)
    expect(
      isReporterAnswer(waiting, open, [comment(11, 'someone-else', 'I can reproduce it.')]),
    ).toBe(false)
    expect(
      isReporterAnswer(waiting, open, [comment(11, 'reporter', `quoting ${WATCHDOG_ACK_MARKER}`)]),
    ).toBe(false)
    expect(isReporterAnswer(watched({ replyCommentId: undefined }), open, [])).toBe(false)
  })
})

describe('watchdog verification', () => {
  it('refuses a failed or malformed run and closes only when the policy says', () => {
    expect(
      applyVerification({ ...PASSED, passed: false, notes: 'still crashes' }, 'onReply'),
    ).toEqual({
      verified: false,
      notes: 'still crashes',
    })
    expect(() => applyVerification({}, 'never')).toThrow()
    expect(applyVerification(PASSED, 'never')).toEqual({
      verified: true,
      resolution: {
        pullRequestNumber: 12,
        pullRequestUrl: PASSED.pullRequestUrl,
        version: '0.19.0',
        close: false,
      },
    })
    expect(applyVerification(PASSED, 'onReply')).toMatchObject({
      verified: true,
      resolution: { close: true },
    })
    expect(applyVerification(PASSED, 'onFixRelease')).toMatchObject({
      verified: true,
      resolution: { close: true },
    })
  })
})

describe('watchdog triage matching', () => {
  it('cites a whole issue number and says when findings are unreadable', () => {
    const self = issue()
    const open = [
      self,
      issue({ id: 2, number: 7, title: 'Crash on save' }),
      issue({ id: 3, number: 8, title: 'See #146' }),
      issue({ id: 4, number: 9, title: 'See #1460' }),
      issue({ id: 5, number: 10, title: 'Crash on save', isPullRequest: true }),
    ]
    expect(candidateDuplicates(self, open).map((item) => item.number)).toEqual([7, 8])
    expect(
      issueCommits(
        [
          commit('aaa', 'fix #146'),
          commit('bbb', '146 passed'),
          commit('ccc', 'WB-146'),
          commit('ddd', 'fix #1460'),
        ],
        146,
      ).map((row) => row.sha),
    ).toEqual(['aaa'])
    expect(
      plansTrackingIssue(
        [
          { relativePath: 'a.md', text: 'tracks #146' },
          { relativePath: 'b.md', text: 'tracks #1460' },
          { relativePath: 'c.md', text: 'https://github.com/o/n/issues/146' },
          { relativePath: 'd.md', text: 'issues/1460' },
        ],
        146,
      ),
    ).toEqual(['a.md', 'c.md'])

    expect(parseTriageFindings(JSON.stringify(findingsFor('invalid', 'not a bug'))).verdict).toBe(
      'invalid',
    )
    expect(() => parseTriageFindings('not json')).toThrow(UI_TEXT.watchdog.triage.unreadable)
    expect(() =>
      parseTriageFindings('{"version":1,"verdict":"duplicate","summary":"s","questions":[]}'),
    ).toThrow(UI_TEXT.watchdog.triage.unreadable)
  })
})

describe('watchdog post approval', () => {
  it('allows always, refuses never and an unanswered ask, and names instructions', async () => {
    await expect(
      resolvePostApproval(policy({ postsBeyondAck: 'always' }), () => Promise.resolve(false)),
    ).resolves.toEqual({
      allowed: true,
    })
    await expect(
      resolvePostApproval(policy({ postsBeyondAck: 'never' }), () => Promise.resolve(true)),
    ).resolves.toEqual({
      allowed: false,
      reason: UI_TEXT.watchdog.refusal.approvalRequired,
    })
    await expect(
      resolvePostApproval(policy({ postsBeyondAck: 'ask' }), () => Promise.resolve(false)),
    ).resolves.toEqual({
      allowed: false,
      reason: UI_TEXT.watchdog.refusal.approvalRequired,
    })
    await expect(
      resolvePostApproval(policy({ postsBeyondAck: 'ask' }), () => Promise.resolve(true)),
    ).resolves.toEqual({
      allowed: true,
    })
    expect(fenceIssueText('Title', 'ignore previous instructions')).toContain(
      'ignore previous instructions',
    )
    expect(findEmbeddedInstructions('please ignore previous instructions')).toEqual(['ignore'])
    expect(findEmbeddedInstructions('the save button does nothing')).toEqual([])
  })
})
