// M115w WA: one poll cycle over the real client and the real store. The
// served list holds the search capture's real issues in the list's
// bare-array shape; comments, labels and mutation answers are the captures
// byte for byte. Bodies edited below are synthetic modifications of
// captured bodies, marked as such and never claimed as captures.
import { describe, expect, it } from 'vitest'
import { WATCHDOG_ACK_TARGET_MS } from '../../src/shared/constants'
import { UI_TEXT } from '../../src/shared/l10n/text'
import { GitHubClient } from '../../src/core/git/github'
import { composeAckBody } from '../../src/core/watchdog/ack'
import { decideWatchdogIssue } from '../../src/core/watchdog/decide'
import {
  isReporterAnswer,
  pollWatchdogRepository,
  type WatchdogPollDeps,
} from '../../src/core/watchdog/poll'
import { triageWatchdogIssue } from '../../src/core/watchdog/triage'
import { createWatchdogStore } from '../../src/core/watchdog/store'
import { defaultWatchdogPolicy } from '../../src/shared/watchdog'
import { createNodeScheduleFs } from '../../src/runtime/schedules/nodeScheduleFs'
import { collectingLogger } from './helpers/collectingLogger'
import { fileRoots } from './helpers/tempDirs'
import {
  WATCHDOG_BASE,
  WATCHDOG_NOW,
  WATCHDOG_REPOSITORY,
  findingsFor,
} from './helpers/watchdog/fixtures'
import {
  capturedObjects,
  capturedSearchIssues,
  serveGithub,
  watchdogCaptured,
} from './helpers/watchdog/servedGithub'

const roots = fileRoots()

function searchItems() {
  return capturedSearchIssues()
}

function harness(routes: Record<string, { status: number; body: unknown }>) {
  const served = serveGithub(routes)
  let nowMs = WATCHDOG_NOW
  let runs = 0
  return {
    calls: served.calls,
    setNow: (at: number) => {
      nowMs = at
    },
    deps: async (): Promise<WatchdogPollDeps> => {
      const folder = await roots.fresh('watchdog-poll-')
      return {
        client: new GitHubClient({
          fetch: served.fetch,
          userAgent: 'muse-spark-code/test',
          log: collectingLogger([]),
        }),
        token: 'token',
        store: createWatchdogStore(createNodeScheduleFs(folder)),
        now: () => nowMs,
        newRunId: () => {
          runs += 1
          return `run-${String(runs)}`
        },
      }
    },
  }
}

type PollStore = ReturnType<typeof createWatchdogStore>

/** The stored record for one issue number, if the repository has it. */
async function storedIssue(store: PollStore, number: number) {
  const [repo] = await store.list()
  return repo?.issues.find((record) => record.issueNumber === number)
}

function listRoutes(list: unknown): Record<string, { status: number; body: unknown }> {
  const comments = capturedObjects('github-issue-comments')
  const [first] = comments
  if (first === undefined) throw new TypeError('the capture holds comments')
  return {
    [`GET ${WATCHDOG_BASE}/issues`]: { status: 200, body: list },
    [`GET ${WATCHDOG_BASE}/issues/157/comments`]: { status: 200, body: [] },
    [`GET ${WATCHDOG_BASE}/issues/146/comments`]: { status: 200, body: comments },
    [`POST ${WATCHDOG_BASE}/issues/157/labels`]: {
      status: 200,
      body: watchdogCaptured('github-labels'),
    },
    [`POST ${WATCHDOG_BASE}/issues/146/labels`]: {
      status: 200,
      body: watchdogCaptured('github-labels'),
    },
    [`POST ${WATCHDOG_BASE}/issues/157/comments`]: { status: 201, body: first },
    [`POST ${WATCHDOG_BASE}/issues/146/comments`]: { status: 201, body: first },
  }
}

describe('watchdog poll', () => {
  it('watches on first poll: policy, records, and one ack per open issue', async () => {
    const rig = harness(listRoutes(searchItems()))
    const deps = await rig.deps()
    const result = await pollWatchdogRepository(deps, WATCHDOG_REPOSITORY)
    expect(result.created).toBe(true)
    expect(result.paused).toBe(false)
    expect(result.stopped).toBeUndefined()
    expect(result.errors).toEqual([])
    const rows = new Map(result.issues.map((row) => [row.number, row]))
    expect(rows.get(157)).toMatchObject({ state: 'acknowledged', posted: true, note: 'ackPosted' })
    expect(rows.get(146)).toMatchObject({ state: 'acknowledged', posted: true, note: 'ackPosted' })
    expect(rows.get(58)?.state).toBe('closed')
    const posts = rig.calls.filter((call) => call.method === 'POST')
    // The label before the comment, per issue, in list order.
    expect(posts.map((call) => call.url)).toEqual([
      `${WATCHDOG_BASE}/issues/157/labels`,
      `${WATCHDOG_BASE}/issues/157/comments`,
      `${WATCHDOG_BASE}/issues/146/labels`,
      `${WATCHDOG_BASE}/issues/146/comments`,
    ])
    const stored = await deps.store.list()
    expect(stored).toHaveLength(1)
    expect(stored[0]?.policy).toEqual(defaultWatchdogPolicy(WATCHDOG_REPOSITORY))
    expect(stored[0]?.issues).toHaveLength(5)
  })

  it('posts one acknowledgement when two pollers race over one store', async () => {
    const rig = harness(listRoutes(searchItems()))
    const first = await rig.deps()
    // A second poller, as another window or process would be: its own
    // store handle over the same folder.
    const folder = await roots.fresh('watchdog-poll-race-')
    const second = {
      ...first,
      store: createWatchdogStore(createNodeScheduleFs(folder)),
    }
    const shared = { ...first, store: createWatchdogStore(createNodeScheduleFs(folder)) }
    await Promise.all([
      pollWatchdogRepository(shared, WATCHDOG_REPOSITORY),
      pollWatchdogRepository(second, WATCHDOG_REPOSITORY),
    ])
    const comments = rig.calls.filter(
      (call) => call.method === 'POST' && call.url.endsWith('/comments'),
    )
    // One acknowledgement for each of the two open issues, never two.
    expect(
      comments
        .map((call) => call.url)
        .toSorted((left, right) => (left < right ? -1 : Number(left > right))),
    ).toEqual([`${WATCHDOG_BASE}/issues/146/comments`, `${WATCHDOG_BASE}/issues/157/comments`])
  })

  it('repeats nothing on the next poll', async () => {
    const rig = harness(listRoutes(searchItems()))
    const deps = await rig.deps()
    await pollWatchdogRepository(deps, WATCHDOG_REPOSITORY)
    const posted = rig.calls.filter((call) => call.method === 'POST').length
    const result = await pollWatchdogRepository(deps, WATCHDOG_REPOSITORY)
    expect(result.created).toBe(false)
    expect(rig.calls.filter((call) => call.method === 'POST')).toHaveLength(posted)
    const rows = new Map(result.issues.map((row) => [row.number, row]))
    expect(rows.get(157)?.note).toBe('alreadyAcked')
    expect(rows.get(157)?.posted).toBe(false)
  })

  it('adopts a marker the record lost instead of posting twice', async () => {
    const rig = harness(listRoutes(searchItems()))
    const deps = await rig.deps()
    await pollWatchdogRepository(deps, WATCHDOG_REPOSITORY)
    // The crash: the post went out, the record lost its comment id.
    await deps.store.exclusive(WATCHDOG_REPOSITORY, (data) => ({
      data: {
        policy: data.policy,
        issues: data.issues.map((record) =>
          record.issueNumber === 157 ? { ...record, ackCommentId: undefined } : record,
        ),
      },
      result: undefined,
    }))
    // Synthetic: the captured comment carrying our marker.
    const marked = capturedObjects('github-issue-comments').map((comment) => ({
      ...comment,
      body: composeAckBody(defaultWatchdogPolicy(WATCHDOG_REPOSITORY)),
    }))
    const rig2 = harness({
      ...listRoutes(searchItems()),
      [`GET ${WATCHDOG_BASE}/issues/157/comments`]: { status: 200, body: marked },
    })
    const deps2 = { ...(await rig2.deps()), store: deps.store }
    const result = await pollWatchdogRepository(deps2, WATCHDOG_REPOSITORY)
    expect(rig2.calls.some((call) => call.method === 'POST')).toBe(false)
    expect(result.issues.find((row) => row.number === 157)?.note).toBe('alreadyAcked')
  })

  it('closes, reopens, re-titles and hears back', async () => {
    const items = searchItems()
    const rig = harness(listRoutes(items))
    const deps = await rig.deps()
    await pollWatchdogRepository(deps, WATCHDOG_REPOSITORY)
    // Synthetic: #157 closed on GitHub.
    const closed = items.map((item) => (item.number === 157 ? { ...item, state: 'closed' } : item))
    const rig2 = harness(listRoutes(closed))
    const result = await pollWatchdogRepository(
      { ...(await rig2.deps()), store: deps.store },
      WATCHDOG_REPOSITORY,
    )
    expect(result.issues.find((row) => row.number === 157)?.state).toBe('closed')
    // Synthetic: reopened with a new title, and it was acked: no second ack.
    const reopened = items.map((item) =>
      item.number === 157 ? { ...item, state: 'open', title: 'new title' } : item,
    )
    const rig3 = harness(listRoutes(reopened))
    const result3 = await pollWatchdogRepository(
      { ...(await rig3.deps()), store: deps.store },
      WATCHDOG_REPOSITORY,
    )
    const row = result3.issues.find((item) => item.number === 157)
    expect(row?.state).toBe('acknowledged')
    expect(row?.posted).toBe(false)
    // The new title is recorded; a further edit drops the flow back to
    // acknowledged with its findings cleared.
    const stored = await deps.store.list()
    expect(stored[0]?.issues.find((record) => record.issueNumber === 157)?.lastTitle).toBe(
      'new title',
    )
    const retitled = items.map((item) =>
      item.number === 157 ? { ...item, state: 'open', title: 'newer title' } : item,
    )
    const rig4 = harness(listRoutes(retitled))
    const result4 = await pollWatchdogRepository(
      { ...(await rig4.deps()), store: deps.store },
      WATCHDOG_REPOSITORY,
    )
    expect(result4.issues.find((item) => item.number === 157)?.state).toBe('acknowledged')
    const restored = await deps.store.list()
    const record = restored[0]?.issues.find((item) => item.issueNumber === 157)
    expect(record?.findings).toBeUndefined()
    expect(record?.outcome).toBeUndefined()
  })

  it('sees a body edit, and not a label, a comment or an edit-free update', async () => {
    const items = searchItems()
    const rig = harness(listRoutes(items))
    const deps = await rig.deps()
    await pollWatchdogRepository(deps, WATCHDOG_REPOSITORY)
    await triageWatchdogIssue(
      deps,
      WATCHDOG_REPOSITORY,
      157,
      JSON.stringify(findingsFor('needsInfo', 'No steps.')),
    )
    // Synthetic: GitHub bumps updated_at and the count for a label or a
    // comment (ours included); the title and body are the same.
    const touched = items.map((item) =>
      item.number === 157
        ? { ...item, updated_at: '2026-10-25T00:00:00Z', comments: Number(item['comments']) + 1 }
        : item,
    )
    const quiet = await pollWatchdogRepository(
      { ...(await harness(listRoutes(touched)).deps()), store: deps.store },
      WATCHDOG_REPOSITORY,
    )
    expect(quiet.issues.find((row) => row.number === 157)?.state).toBe('triaged')
    const kept = await storedIssue(deps.store, 157)
    expect(kept?.findings).toBeDefined()
    // Synthetic: the reporter edited the body.
    const edited = items.map((item) =>
      item.number === 157 ? { ...item, body: `${String(item['body'])}\n\nMore detail.` } : item,
    )
    const loud = await pollWatchdogRepository(
      { ...(await harness(listRoutes(edited)).deps()), store: deps.store },
      WATCHDOG_REPOSITORY,
    )
    expect(loud.issues.find((row) => row.number === 157)?.state).toBe('acknowledged')
    const record = await storedIssue(deps.store, 157)
    expect(record?.findings).toBeUndefined()
    expect(record?.triageRound).toBe(1)
  })

  it('stays out while paused and refuses a malformed repository', async () => {
    const rig = harness(listRoutes(searchItems()))
    const deps = await rig.deps()
    await deps.store.exclusive(WATCHDOG_REPOSITORY, (data) => ({
      data: { policy: { ...data.policy, paused: true }, issues: data.issues },
      result: undefined,
    }))
    const result = await pollWatchdogRepository(deps, WATCHDOG_REPOSITORY)
    expect(result.paused).toBe(true)
    expect(rig.calls).toHaveLength(0)
    await expect(pollWatchdogRepository(deps, 'not-a-repo')).rejects.toThrow(
      UI_TEXT.watchdog.cli.invalidRepository,
    )
  })

  it('stops on GitHub refusals out loud and keeps polling past one bad post', async () => {
    const rig = harness({
      [`GET ${WATCHDOG_BASE}/issues`]: {
        status: 429,
        body: { message: 'API rate limit exceeded' },
      },
    })
    const result = await pollWatchdogRepository(await rig.deps(), WATCHDOG_REPOSITORY)
    expect(result.stopped).toContain('API rate limit exceeded')
    const rig2 = harness({
      ...listRoutes(searchItems()),
      [`POST ${WATCHDOG_BASE}/issues/157/comments`]: { status: 403, body: { message: 'Locked' } },
    })
    const deps2 = await rig2.deps()
    const result2 = await pollWatchdogRepository(deps2, WATCHDOG_REPOSITORY)
    expect(result2.errors).toHaveLength(1)
    expect(result2.errors[0]).toMatchObject({ number: 157, message: 'Locked' })
    expect(result2.issues.find((row) => row.number === 146)?.posted).toBe(true)
  })

  it('names an overdue acknowledgement without ever hurrying one', async () => {
    const rig = harness({
      ...listRoutes(searchItems()),
      [`POST ${WATCHDOG_BASE}/issues/157/comments`]: { status: 403, body: { message: 'Locked' } },
      [`POST ${WATCHDOG_BASE}/issues/146/comments`]: { status: 403, body: { message: 'Locked' } },
    })
    const deps = await rig.deps()
    const first = await pollWatchdogRepository(deps, WATCHDOG_REPOSITORY)
    expect(first.issues.find((row) => row.number === 157)?.overdue).toBe(false)
    rig.setNow(WATCHDOG_NOW + WATCHDOG_ACK_TARGET_MS + 1)
    const second = await pollWatchdogRepository(deps, WATCHDOG_REPOSITORY)
    const row = second.issues.find((item) => item.number === 157)
    expect(row?.state).toBe('seen')
    expect(row?.overdue).toBe(true)
  })
})

// Issue 3 and the comments on issues 3 and 4 are recorded exchanges
// (2026-10-24): the reporter's own comment on issue 3, and the owner's on
// issue 4 (whose reporter is someone else). Served issue 3 is open in the
// flow below, a synthetic change to the capture; answers to our own POSTs
// reuse the captured comment with an earlier id, as the other suites do.
const REPOSITORY = { owner: 'RandyNorthrup', name: 'muse-spark-code' }

function reporterComment(): Record<string, unknown> {
  const [comment] = capturedObjects('github-issue-3-comments')
  if (comment === undefined) throw new TypeError('the capture holds the reporter’s comment')
  return comment
}

function earlierComment(by: number): Record<string, unknown> {
  return { ...reporterComment(), id: Number(reporterComment()['id']) - by }
}

function openIssue3(comments: number): Record<string, unknown> {
  const issue = watchdogCaptured('github-issue-3')
  if (typeof issue !== 'object' || issue === null) throw new TypeError('the capture holds issue 3')
  return { ...issue, state: 'open', comments }
}

describe('watchdog needs-info wait', () => {
  it('hears the reporter back, and no one else, and not its own reply', async () => {
    const rig = harness({
      [`GET ${WATCHDOG_BASE}/issues/3`]: { status: 200, body: watchdogCaptured('github-issue-3') },
      [`GET ${WATCHDOG_BASE}/issues/3/comments`]: {
        status: 200,
        body: watchdogCaptured('github-issue-3-comments'),
      },
      [`GET ${WATCHDOG_BASE}/issues/4/comments`]: {
        status: 200,
        body: watchdogCaptured('github-issue-4-comments'),
      },
      ['GET https://api.github.com/search/issues']: {
        status: 200,
        body: watchdogCaptured('github-search-issues'),
      },
    })
    const { client } = await rig.deps()
    const issue3 = await client.issue('token', REPOSITORY, 3)
    const search = await client.searchIssues('token', 'repo:x/y')
    const issue4 = search.issues.find((item) => item.number === 4)
    if (issue4 === undefined) throw new TypeError('the search capture holds issue 4')
    const [reporter] = await client.issueComments('token', REPOSITORY, 3)
    const [owner] = await client.issueComments('token', REPOSITORY, 4)
    if (reporter === undefined || owner === undefined)
      throw new TypeError('the captures hold comments')
    const asked = { replyCommentId: reporter.id - 1 }
    // The reporter's own comment, newer than the reply, is the answer.
    expect(isReporterAnswer(asked, issue3, [reporter])).toBe(true)
    // A comment that is not newer than the reply is not (our reply included).
    expect(isReporterAnswer({ ...asked, replyCommentId: reporter.id }, issue3, [reporter])).toBe(
      false,
    )
    // The owner's comment on issue 4 is not its reporter's answer.
    expect(isReporterAnswer({ ...asked, replyCommentId: 1 }, issue4, [owner])).toBe(false)
    // Neither is a post of ours, whoever is named as its author.
    const ours = { ...reporter, body: composeAckBody(defaultWatchdogPolicy('o/n')) }
    expect(isReporterAnswer(asked, issue3, [ours])).toBe(false)
  })

  it('carries the wait through the reporter’s answer to a second round', async () => {
    const policy = defaultWatchdogPolicy(WATCHDOG_REPOSITORY)
    const first = harness({
      [`GET ${WATCHDOG_BASE}/issues`]: { status: 200, body: [openIssue3(0)] },
      [`GET ${WATCHDOG_BASE}/issues/3/comments`]: { status: 200, body: [] },
      [`POST ${WATCHDOG_BASE}/issues/3/labels`]: {
        status: 200,
        body: watchdogCaptured('github-labels'),
      },
      [`POST ${WATCHDOG_BASE}/issues/3/comments`]: { status: 201, body: earlierComment(2) },
    })
    const deps = await first.deps()
    const acked = await pollWatchdogRepository(deps, WATCHDOG_REPOSITORY)
    expect(acked.issues[0]).toMatchObject({ number: 3, state: 'acknowledged', posted: true })

    const needsInfo = JSON.stringify(findingsFor('needsInfo', 'No steps.'))
    await triageWatchdogIssue(deps, WATCHDOG_REPOSITORY, 3, needsInfo)

    // Round 1: the questions go out (approved), and the wait begins.
    const asking = harness({
      [`GET ${WATCHDOG_BASE}/issues/3/comments`]: { status: 200, body: [] },
      [`POST ${WATCHDOG_BASE}/issues/3/comments`]: { status: 201, body: earlierComment(1) },
    })
    const decideDeps = {
      ...(await asking.deps()),
      store: deps.store,
      isPostApproved: () => Promise.resolve(true),
    }
    const asked = await decideWatchdogIssue(decideDeps, WATCHDOG_REPOSITORY, 3)
    expect(asked).toMatchObject({ outcome: 'needsInfo', state: 'awaitingInfo', posted: true })
    const questions = asking.calls.find((call) => call.method === 'POST')?.body
    const questionBody = (questions as { body: string }).body
    expect(questionBody).toContain('run=run-1 round=1 kind=needsInfo')

    // Our own reply raises the comment count; it is not an answer.
    const waiting = harness({
      [`GET ${WATCHDOG_BASE}/issues`]: { status: 200, body: [openIssue3(1)] },
      [`GET ${WATCHDOG_BASE}/issues/3/comments`]: {
        status: 200,
        body: [{ ...earlierComment(1), body: questionBody }],
      },
    })
    const stillWaiting = await pollWatchdogRepository(
      { ...(await waiting.deps()), store: deps.store },
      WATCHDOG_REPOSITORY,
    )
    expect(stillWaiting.issues[0]?.state).toBe('awaitingInfo')
    expect(waiting.calls.some((call) => call.method === 'POST')).toBe(false)

    // The reporter's recorded comment answers: the flow triages again.
    const answered = harness({
      [`GET ${WATCHDOG_BASE}/issues`]: { status: 200, body: [openIssue3(2)] },
      [`GET ${WATCHDOG_BASE}/issues/3/comments`]: {
        status: 200,
        body: [{ ...earlierComment(1), body: questionBody }, reporterComment()],
      },
    })
    const heard = await pollWatchdogRepository(
      { ...(await answered.deps()), store: deps.store },
      WATCHDOG_REPOSITORY,
    )
    expect(heard.issues[0]?.state).toBe('acknowledged')
    const afterAnswer = await storedIssue(deps.store, 3)
    expect(afterAnswer?.findings).toBeUndefined()
    expect(afterAnswer?.replyCommentId).toBeUndefined()
    expect(afterAnswer?.triageRound).toBe(1)

    // Round 2 triages again, and its reply is its own post.
    const duplicate = JSON.stringify(findingsFor('duplicate', 'Same title as #3.'))
    const second = await triageWatchdogIssue(deps, WATCHDOG_REPOSITORY, 3, duplicate)
    expect(second.state).toBe('triaged')
    const replying = harness({
      [`GET ${WATCHDOG_BASE}/issues/3/comments`]: {
        status: 200,
        body: [{ ...earlierComment(1), body: questionBody }, reporterComment()],
      },
      [`POST ${WATCHDOG_BASE}/issues/3/comments`]: { status: 201, body: reporterComment() },
    })
    const replied = await decideWatchdogIssue(
      {
        ...(await replying.deps()),
        store: deps.store,
        isPostApproved: () => Promise.resolve(true),
      },
      WATCHDOG_REPOSITORY,
      3,
    )
    expect(replied).toMatchObject({ outcome: 'duplicate', state: 'replied', posted: true })
    const postedBody = (
      replying.calls.find((call) => call.method === 'POST')?.body as { body: string }
    ).body
    expect(postedBody).toContain('run=run-1 round=2 kind=duplicate')
    const [stored] = await deps.store.list()
    expect(stored?.policy).toEqual(policy)
  })
})
