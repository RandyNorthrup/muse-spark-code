// M115w WD+WV: the decide step and the resolution step over the real
// client and the real store. Replies post through the repository's gate
// and close by its policy; spam never posts; valid issues plan; the
// fixed-reply goes out only on passing verification. Served bodies are
// the captures, except the marked comments, which are synthetic
// modifications of captured bodies, marked as such.
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { WATCHDOG_REPLY_MARKER, UI_TEXT } from '../../src/shared/constants'
import {
  defaultWatchdogPolicy,
  triageFindingsSchema,
  watchdogIssueSchema,
  type TriageFindings,
  type WatchdogIssue,
} from '../../src/shared/watchdog'
import { GitHubClient } from '../../src/core/git/github'
import {
  decideWatchdogIssue,
  resolveWatchdogIssue,
  type WatchdogDecideDeps,
} from '../../src/core/watchdog/decide'
import { composeReplyBody } from '../../src/core/watchdog/reply'
import { createWatchdogStore } from '../../src/core/watchdog/store'
import { createNodeScheduleFs } from '../../src/runtime/schedules/nodeScheduleFs'
import {
  capturedObjects,
  serveGithub,
  watchdogCaptured,
  watchdogLogger,
} from './helpers/watchdog/servedGithub'

const REPOSITORY = 'RandyNorthrup/muse-spark-code'
const BASE = 'https://api.github.com/repos/RandyNorthrup/muse-spark-code'

const folders: string[] = []
afterEach(async () => {
  while (folders.length > 0) {
    const folder = folders.pop()
    if (folder !== undefined) await rm(folder, { recursive: true, force: true })
  }
})

function findingsFor(verdict: TriageFindings['verdict']): TriageFindings {
  return triageFindingsSchema.parse({
    version: 1,
    verdict,
    summary: 'The window crashes on open.',
    questions: verdict === 'needsInfo' ? ['What did you do?'] : [],
    ...(verdict === 'duplicate' && { duplicateOf: 3 }),
    ...(verdict === 'alreadyFixed' && { fixedIn: '0.19.0' }),
    ...(verdict === 'inHand' && { inHandRef: 'PLAN.md M115' }),
  })
}

function recordFor(
  number: number,
  state: WatchdogIssue['state'],
  verdict: TriageFindings['verdict'],
): WatchdogIssue {
  return watchdogIssueSchema.parse({
    repository: REPOSITORY,
    issueNumber: number,
    issueId: number,
    state,
    runId: 'run-1',
    seenAtMs: 1,
    ackCommentId: 9,
    labelsApplied: ['triage'],
    findings: findingsFor(verdict),
    lastTitle: 't',
    lastCommentCount: 1,
    lastIssueUpdatedAt: '2026-10-22T00:00:00Z',
    updatedAtMs: 1,
  })
}

function decisionRoutes(overrides: Record<string, { status: number; body: unknown }> = {}) {
  const comments = capturedObjects('github-issue-comments')
  const [first] = comments
  if (first === undefined) throw new TypeError('the capture holds comments')
  return {
    [`GET ${BASE}/issues/146`]: { status: 200, body: watchdogCaptured('github-issue') },
    [`GET ${BASE}/issues/146/comments`]: { status: 200, body: comments },
    [`POST ${BASE}/issues/146/comments`]: { status: 201, body: first },
    [`PATCH ${BASE}/issues/146`]: { status: 200, body: watchdogCaptured('github-issue') },
    ...overrides,
  }
}

async function decideHarness(
  routes: Record<string, { status: number; body: unknown }>,
  isApproved: boolean,
  closePolicy: 'never' | 'onReply' | 'onFixRelease' = 'onReply',
) {
  const served = serveGithub(routes)
  const folder = await mkdtemp(path.join(tmpdir(), 'watchdog-decide-'))
  folders.push(folder)
  const store = createWatchdogStore(createNodeScheduleFs(folder))
  const deps: WatchdogDecideDeps = {
    client: new GitHubClient({
      fetch: served.fetch,
      userAgent: 'muse-spark-code/test',
      log: watchdogLogger([]),
    }),
    token: 'token',
    store,
    isPostApproved: () => Promise.resolve(isApproved),
    now: () => 1_700_000_000_000,
  }
  await store.exclusive(REPOSITORY, (data) => ({
    data: {
      policy: { ...defaultWatchdogPolicy(REPOSITORY), closePolicy },
      issues: data.issues,
    },
    result: undefined,
  }))
  return { deps, store, calls: served.calls }
}

async function seedTriaged(
  store: ReturnType<typeof createWatchdogStore>,
  verdict: TriageFindings['verdict'],
  state: WatchdogIssue['state'] = 'triaged',
) {
  await store.exclusive(REPOSITORY, (data) => ({
    data: { policy: data.policy, issues: [recordFor(146, state, verdict)] },
    result: undefined,
  }))
}

describe('watchdog decide', () => {
  it('asks its questions, waits, and never closes the wait', async () => {
    const { deps, calls } = await decideHarness(decisionRoutes(), true)
    await seedTriaged(deps.store, 'needsInfo')
    const decision = await decideWatchdogIssue(deps, REPOSITORY, 146)
    expect(decision).toMatchObject({
      outcome: 'needsInfo',
      state: 'awaitingInfo',
      posted: true,
      closed: false,
    })
    const post = calls.find((call) => call.method === 'POST')
    const posted = post?.body
    if (typeof posted !== 'object' || posted === null || !('body' in posted))
      throw new TypeError('the reply posts its body')
    expect(String(posted.body)).toContain('- What did you do?')
    expect(String(posted.body)).toContain(WATCHDOG_REPLY_MARKER)
    expect(calls.some((call) => call.method === 'PATCH')).toBe(false)
  })

  it('replies and closes by policy, or holds its post on a denied gate', async () => {
    const { deps, calls } = await decideHarness(decisionRoutes(), true)
    await seedTriaged(deps.store, 'duplicate')
    const decision = await decideWatchdogIssue(deps, REPOSITORY, 146)
    expect(decision).toMatchObject({
      outcome: 'duplicate',
      state: 'replied',
      posted: true,
      closed: true,
    })
    expect(calls.some((call) => call.method === 'PATCH')).toBe(true)

    const held = await decideHarness(decisionRoutes(), false)
    await seedTriaged(held.deps.store, 'duplicate')
    const refused = await decideWatchdogIssue(held.deps, REPOSITORY, 146)
    expect(refused.posted).toBe(false)
    expect(refused.reason).toBe(UI_TEXT.watchdog.refusal.approvalRequired)
    expect(held.calls.some((call) => call.method === 'POST')).toBe(false)
    const stored = await held.deps.store.list()
    expect(stored[0]?.issues[0]?.state).toBe('triaged')
  })

  it('holds spam without a post even past the gate', async () => {
    const { deps, calls } = await decideHarness(decisionRoutes(), true)
    await seedTriaged(deps.store, 'spam')
    const decision = await decideWatchdogIssue(deps, REPOSITORY, 146)
    expect(decision).toMatchObject({
      outcome: 'spam',
      state: 'closed',
      posted: false,
      closed: true,
    })
    expect(decision.reason).toBe(UI_TEXT.watchdog.refusal.spamHeld)
    expect(calls).toHaveLength(0)
  })

  it('plans valid issues with a draft, posting nothing', async () => {
    const { deps, calls } = await decideHarness(decisionRoutes(), true)
    await seedTriaged(deps.store, 'valid')
    const decision = await decideWatchdogIssue(deps, REPOSITORY, 146)
    expect(decision).toMatchObject({ outcome: 'planEntry', state: 'planned', posted: false })
    expect(decision.planDraft).toContain('## Findings')
    expect(decision.planDraft).toContain('The window crashes on open.')
    expect(calls.some((call) => call.method === 'POST')).toBe(false)
  })

  it('adopts a reply already out there and retries its close', async () => {
    const marked = capturedObjects('github-issue-comments').map((comment) => ({
      ...comment,
      body: `taken\n\n${WATCHDOG_REPLY_MARKER}`,
    }))
    const { deps, calls } = await decideHarness(
      decisionRoutes({ [`GET ${BASE}/issues/146/comments`]: { status: 200, body: marked } }),
      false,
    )
    await seedTriaged(deps.store, 'alreadyFixed')
    const decision = await decideWatchdogIssue(deps, REPOSITORY, 146)
    expect(decision).toMatchObject({
      outcome: 'alreadyFixed',
      state: 'replied',
      posted: false,
      closed: true,
    })
    expect(calls.some((call) => call.method === 'POST')).toBe(false)
    expect(calls.some((call) => call.method === 'PATCH')).toBe(true)
  })

  it('fills every reply template and refuses spam and evidence-free fixes', () => {
    expect(composeReplyBody('needsInfo', findingsFor('needsInfo'))).toContain('- What did you do?')
    expect(composeReplyBody('duplicate', findingsFor('duplicate'))).toContain('#3')
    expect(composeReplyBody('alreadyFixed', findingsFor('alreadyFixed'))).toContain('0.19.0')
    expect(composeReplyBody('invalid', findingsFor('invalid'))).toContain(
      'The window crashes on open.',
    )
    expect(
      composeReplyBody('planEntry', findingsFor('valid'), {
        pullRequestNumber: 12,
        pullRequestUrl: 'https://github.com/o/n/pull/12',
        version: '0.19.1',
      }),
    ).toContain('[#12](https://github.com/o/n/pull/12)')
    expect(() => composeReplyBody('spam', findingsFor('spam'))).toThrow()
    expect(() => composeReplyBody('planEntry', findingsFor('valid'))).toThrow()
  })
})

describe('watchdog resolve', () => {
  const evidence = {
    pullRequestNumber: 12,
    pullRequestUrl: 'https://github.com/o/n/pull/12',
    version: '0.19.1',
    passed: true,
    notes: 'repro passes',
  }

  it('posts the fixed-reply and closes on passing verification', async () => {
    const { deps, calls } = await decideHarness(decisionRoutes(), true, 'onFixRelease')
    await seedTriaged(deps.store, 'valid', 'planned')
    await deps.store.exclusive(REPOSITORY, (data) => ({
      data: {
        policy: data.policy,
        issues: data.issues.map((record) => ({ ...record, outcome: 'planEntry' as const })),
      },
      result: undefined,
    }))
    const resolution = await resolveWatchdogIssue(deps, REPOSITORY, 146, evidence)
    expect(resolution).toMatchObject({ state: 'replied', posted: true, closed: true })
    const post = calls.find((call) => call.method === 'POST')
    const posted = post?.body
    if (typeof posted !== 'object' || posted === null || !('body' in posted))
      throw new TypeError('the reply posts its body')
    expect(String(posted.body)).toContain('0.19.1')
  })

  it('posts nothing on a failed verification', async () => {
    const { deps, calls } = await decideHarness(decisionRoutes(), true, 'onFixRelease')
    await seedTriaged(deps.store, 'valid', 'planned')
    await deps.store.exclusive(REPOSITORY, (data) => ({
      data: {
        policy: data.policy,
        issues: data.issues.map((record) => ({ ...record, outcome: 'planEntry' as const })),
      },
      result: undefined,
    }))
    const resolution = await resolveWatchdogIssue(deps, REPOSITORY, 146, {
      ...evidence,
      passed: false,
      notes: 'still crashes',
    })
    expect(resolution.posted).toBe(false)
    expect(resolution.notes).toBe('still crashes')
    expect(calls.some((call) => call.method === 'POST')).toBe(false)
  })
})
