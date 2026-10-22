// M115w WA: one poll cycle over the real client and the real store. The
// served list holds the search capture's real issues in the list's
// bare-array shape; comments, labels and mutation answers are the captures
// byte for byte. Bodies edited below are synthetic modifications of
// captured bodies, marked as such and never claimed as captures.
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { WATCHDOG_ACK_TARGET_MS } from '../../src/shared/constants'
import { UI_TEXT } from '../../src/shared/l10n/text'
import { GitHubClient } from '../../src/core/git/github'
import { composeAckBody } from '../../src/core/watchdog/ack'
import { pollWatchdogRepository, type WatchdogPollDeps } from '../../src/core/watchdog/poll'
import { createWatchdogStore } from '../../src/core/watchdog/store'
import { defaultWatchdogPolicy } from '../../src/shared/watchdog'
import { createNodeScheduleFs } from '../../src/runtime/schedules/nodeScheduleFs'
import { serveGithub, watchdogCaptured, watchdogLogger } from './helpers/watchdog/servedGithub'

const REPOSITORY = 'RandyNorthrup/muse-spark-code'
const BASE = 'https://api.github.com/repos/RandyNorthrup/muse-spark-code'
const NOW = 1_700_000_000_000

const folders: string[] = []
afterEach(async () => {
  while (folders.length > 0) {
    const folder = folders.pop()
    if (folder !== undefined) await rm(folder, { recursive: true, force: true })
  }
})

interface CapturedObject {
  readonly number?: unknown
  readonly [key: string]: unknown
}

function objectsOf(value: unknown): CapturedObject[] {
  if (!Array.isArray(value)) throw new TypeError('the capture holds a list')
  const list: unknown[] = value
  return list.map((item) => {
    if (typeof item !== 'object' || item === null) throw new TypeError('the capture holds objects')
    return Object.fromEntries(
      Object.entries(item).map(([key, entry]): [string, unknown] => [key, entry]),
    )
  })
}

function searchItems(): CapturedObject[] {
  const search = watchdogCaptured('github-search-issues')
  if (typeof search !== 'object' || search === null || !('items' in search))
    throw new TypeError('the capture holds a search')
  return objectsOf(search.items)
}

function harness(routes: Record<string, { status: number; body: unknown }>) {
  const served = serveGithub(routes)
  let nowMs = NOW
  let runs = 0
  return {
    calls: served.calls,
    setNow: (at: number) => {
      nowMs = at
    },
    deps: async (): Promise<WatchdogPollDeps> => {
      const folder = await mkdtemp(path.join(tmpdir(), 'watchdog-poll-'))
      folders.push(folder)
      return {
        client: new GitHubClient({
          fetch: served.fetch,
          userAgent: 'muse-spark-code/test',
          log: watchdogLogger([]),
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

function listRoutes(list: unknown): Record<string, { status: number; body: unknown }> {
  const comments = objectsOf(watchdogCaptured('github-issue-comments'))
  const [first] = comments
  if (first === undefined) throw new TypeError('the capture holds comments')
  return {
    [`GET ${BASE}/issues`]: { status: 200, body: list },
    [`GET ${BASE}/issues/157/comments`]: { status: 200, body: [] },
    [`GET ${BASE}/issues/146/comments`]: { status: 200, body: comments },
    [`POST ${BASE}/issues/157/labels`]: { status: 200, body: watchdogCaptured('github-labels') },
    [`POST ${BASE}/issues/146/labels`]: { status: 200, body: watchdogCaptured('github-labels') },
    [`POST ${BASE}/issues/157/comments`]: { status: 201, body: first },
    [`POST ${BASE}/issues/146/comments`]: { status: 201, body: first },
  }
}

describe('watchdog poll', () => {
  it('watches on first poll: policy, records, and one ack per open issue', async () => {
    const rig = harness(listRoutes(searchItems()))
    const deps = await rig.deps()
    const result = await pollWatchdogRepository(deps, REPOSITORY)
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
      `${BASE}/issues/157/labels`,
      `${BASE}/issues/157/comments`,
      `${BASE}/issues/146/labels`,
      `${BASE}/issues/146/comments`,
    ])
    const stored = await deps.store.list()
    expect(stored).toHaveLength(1)
    expect(stored[0]?.policy).toEqual(defaultWatchdogPolicy(REPOSITORY))
    expect(stored[0]?.issues).toHaveLength(5)
  })

  it('repeats nothing on the next poll', async () => {
    const rig = harness(listRoutes(searchItems()))
    const deps = await rig.deps()
    await pollWatchdogRepository(deps, REPOSITORY)
    const posted = rig.calls.filter((call) => call.method === 'POST').length
    const result = await pollWatchdogRepository(deps, REPOSITORY)
    expect(result.created).toBe(false)
    expect(rig.calls.filter((call) => call.method === 'POST')).toHaveLength(posted)
    const rows = new Map(result.issues.map((row) => [row.number, row]))
    expect(rows.get(157)?.note).toBe('alreadyAcked')
    expect(rows.get(157)?.posted).toBe(false)
  })

  it('adopts a marker the record lost instead of posting twice', async () => {
    const rig = harness(listRoutes(searchItems()))
    const deps = await rig.deps()
    await pollWatchdogRepository(deps, REPOSITORY)
    // The crash: the post went out, the record lost its comment id.
    await deps.store.exclusive(REPOSITORY, (data) => ({
      data: {
        policy: data.policy,
        issues: data.issues.map((record) =>
          record.issueNumber === 157 ? { ...record, ackCommentId: undefined } : record,
        ),
      },
      result: undefined,
    }))
    // Synthetic: the captured comment carrying our marker.
    const marked = objectsOf(watchdogCaptured('github-issue-comments')).map((comment) => ({
      ...comment,
      body: composeAckBody(defaultWatchdogPolicy(REPOSITORY)),
    }))
    const rig2 = harness({
      ...listRoutes(searchItems()),
      [`GET ${BASE}/issues/157/comments`]: { status: 200, body: marked },
    })
    const deps2 = { ...(await rig2.deps()), store: deps.store }
    const result = await pollWatchdogRepository(deps2, REPOSITORY)
    expect(rig2.calls.some((call) => call.method === 'POST')).toBe(false)
    expect(result.issues.find((row) => row.number === 157)?.note).toBe('alreadyAcked')
  })

  it('closes, reopens, re-titles and hears back', async () => {
    const items = searchItems()
    const rig = harness(listRoutes(items))
    const deps = await rig.deps()
    await pollWatchdogRepository(deps, REPOSITORY)
    // Synthetic: #157 closed on GitHub.
    const closed = items.map((item) => (item.number === 157 ? { ...item, state: 'closed' } : item))
    const rig2 = harness(listRoutes(closed))
    const result = await pollWatchdogRepository(
      { ...(await rig2.deps()), store: deps.store },
      REPOSITORY,
    )
    expect(result.issues.find((row) => row.number === 157)?.state).toBe('closed')
    // Synthetic: reopened with a new title, and it was acked: no second ack.
    const reopened = items.map((item) =>
      item.number === 157 ? { ...item, state: 'open', title: 'new title' } : item,
    )
    const rig3 = harness(listRoutes(reopened))
    const result3 = await pollWatchdogRepository(
      { ...(await rig3.deps()), store: deps.store },
      REPOSITORY,
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
      REPOSITORY,
    )
    expect(result4.issues.find((item) => item.number === 157)?.state).toBe('acknowledged')
    const restored = await deps.store.list()
    const record = restored[0]?.issues.find((item) => item.issueNumber === 157)
    expect(record?.findings).toBeUndefined()
    expect(record?.outcome).toBeUndefined()
  })

  it('stays out while paused and refuses a malformed repository', async () => {
    const rig = harness(listRoutes(searchItems()))
    const deps = await rig.deps()
    await deps.store.exclusive(REPOSITORY, (data) => ({
      data: { policy: { ...data.policy, paused: true }, issues: data.issues },
      result: undefined,
    }))
    const result = await pollWatchdogRepository(deps, REPOSITORY)
    expect(result.paused).toBe(true)
    expect(rig.calls).toHaveLength(0)
    await expect(pollWatchdogRepository(deps, 'not-a-repo')).rejects.toThrow(
      UI_TEXT.watchdog.cli.invalidRepository,
    )
  })

  it('stops on GitHub refusals out loud and keeps polling past one bad post', async () => {
    const rig = harness({
      [`GET ${BASE}/issues`]: { status: 429, body: { message: 'API rate limit exceeded' } },
    })
    const result = await pollWatchdogRepository(await rig.deps(), REPOSITORY)
    expect(result.stopped).toContain('API rate limit exceeded')
    const rig2 = harness({
      ...listRoutes(searchItems()),
      [`POST ${BASE}/issues/157/comments`]: { status: 403, body: { message: 'Locked' } },
    })
    const deps2 = await rig2.deps()
    const result2 = await pollWatchdogRepository(deps2, REPOSITORY)
    expect(result2.errors).toHaveLength(1)
    expect(result2.errors[0]).toMatchObject({ number: 157, message: 'Locked' })
    expect(result2.issues.find((row) => row.number === 146)?.posted).toBe(true)
  })

  it('names an overdue acknowledgement without ever hurrying one', async () => {
    const rig = harness({
      ...listRoutes(searchItems()),
      [`POST ${BASE}/issues/157/comments`]: { status: 403, body: { message: 'Locked' } },
      [`POST ${BASE}/issues/146/comments`]: { status: 403, body: { message: 'Locked' } },
    })
    const deps = await rig.deps()
    const first = await pollWatchdogRepository(deps, REPOSITORY)
    expect(first.issues.find((row) => row.number === 157)?.overdue).toBe(false)
    rig.setNow(NOW + WATCHDOG_ACK_TARGET_MS + 1)
    const second = await pollWatchdogRepository(deps, REPOSITORY)
    const row = second.issues.find((item) => item.number === 157)
    expect(row?.state).toBe('seen')
    expect(row?.overdue).toBe(true)
  })
})
