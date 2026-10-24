// M115w WU: the watchdog's CLI and ACP surface over the real store
// and the real client. The grammar parses every verb and refuses bad
// shapes as usage; list, status, pause and resume work the store; poll,
// evidence, apply, decide and resolve drive the served captures end to
// end; refusals (unsigned, unknown, unready, GitHub's own) are said,
// and only a store that cannot be bound fails the command.
import { writeFile } from 'node:fs/promises'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { acpWatchdog } from '../../src/acp/watchdog'
import { GitHubClient } from '../../src/core/git/github'
import { createWatchdogStore } from '../../src/core/watchdog/store'
import {
  parseWatchdogCommand,
  runWatchdogCli,
  runWatchdogCommand,
  type WatchdogSurfacePort,
} from '../../src/runtime/watchdog/command'
import { createNodeScheduleFs } from '../../src/runtime/schedules/nodeScheduleFs'
import { WATCHDOG_ACK_MARKER } from '../../src/shared/constants'
import { UI_TEXT } from '../../src/shared/l10n/text'
import {
  defaultWatchdogPolicy,
  watchdogIssueSchema,
  type TriageFindings,
  type WatchdogIssue,
} from '../../src/shared/watchdog'
import { collectingLogger } from './helpers/collectingLogger'
import { fileRoots } from './helpers/tempDirs'
import {
  WATCHDOG_BASE,
  WATCHDOG_NOW,
  WATCHDOG_REPOSITORY,
  entryBundle,
  findingsFor,
  releaseRoutes,
} from './helpers/watchdog/fixtures'
import {
  capturedObjects,
  capturedSearchIssues,
  serveGithub,
  watchdogCaptured,
  watchdogCapturedRoute,
} from './helpers/watchdog/servedGithub'

const roots = fileRoots()
type Routes = Record<string, { status: number; body: unknown }>

async function surface(
  routes: Routes,
  seed?: (store: ReturnType<typeof createWatchdogStore>) => Promise<void>,
  isSigned = true,
  isReportOnly = false,
) {
  const served = serveGithub(routes)
  const folder = await roots.fresh('watchdog-surface-')
  const store = createWatchdogStore(createNodeScheduleFs(folder))
  if (seed !== undefined) await seed(store)
  let runs = 0
  const port: WatchdogSurfacePort = {
    store,
    client: isSigned
      ? new GitHubClient({
          fetch: served.fetch,
          userAgent: 'muse-spark-code/test',
          log: collectingLogger([]),
        })
      : undefined,
    token: isSigned ? 'token' : undefined,
    now: () => WATCHDOG_NOW,
    newRunId: () => {
      runs += 1
      return `run-${String(runs)}`
    },
    isReportOnly,
  }
  return { port, calls: served.calls, folder }
}

function recordFor(
  number: number,
  state: WatchdogIssue['state'],
  verdict?: TriageFindings['verdict'],
  outcome?: WatchdogIssue['outcome'],
): WatchdogIssue {
  return watchdogIssueSchema.parse({
    repository: WATCHDOG_REPOSITORY,
    issueNumber: number,
    issueId: number,
    state,
    runId: 'run-1',
    seenAtMs: 1,
    labelsApplied: [],
    triageRound: 0,
    ...(verdict !== undefined && { findings: findingsFor(verdict, 'Same title as #3.') }),
    ...(outcome !== undefined && { outcome }),
    lastTitle: 't',
    lastTextHash: 'h',
    lastCommentCount: 0,
    lastIssueUpdatedAt: '2026-10-22T00:00:00Z',
    updatedAtMs: 1,
  })
}

async function seedIssues(store: ReturnType<typeof createWatchdogStore>, issues: WatchdogIssue[]) {
  await store.exclusive(WATCHDOG_REPOSITORY, (data) => ({
    data: { policy: data.policy, issues },
    result: undefined,
  }))
}

async function seedPlanned(store: ReturnType<typeof createWatchdogStore>): Promise<void> {
  await store.exclusive(WATCHDOG_REPOSITORY, (_data) => ({
    data: {
      policy: { ...defaultWatchdogPolicy(WATCHDOG_REPOSITORY), closePolicy: 'onReply' },
      issues: [recordFor(146, 'planned', 'valid', 'planEntry')],
    },
    result: undefined,
  }))
}

function commandRunner(port: WatchdogSurfacePort, what: string) {
  return async (argv: string[]) => {
    const parsed = parseWatchdogCommand(argv)
    if (parsed === undefined) throw new TypeError(what)
    return await runWatchdogCommand(parsed, port)
  }
}

function commentRoutes(extra?: Routes): Routes {
  const comments = capturedObjects('github-issue-comments')
  const [first] = comments
  if (first === undefined) throw new TypeError('the capture holds comments')
  return {
    [`GET ${WATCHDOG_BASE}/issues/146/comments`]: { status: 200, body: [] },
    [`POST ${WATCHDOG_BASE}/issues/146/comments`]: { status: 201, body: first },
    ...extra,
  }
}

function searchList(): unknown {
  return capturedSearchIssues()
}

describe('watchdog command grammar', () => {
  it('parses the ten verbs', () => {
    expect(parseWatchdogCommand(['list'])).toEqual({ verb: 'list' })
    expect(parseWatchdogCommand(['status'])).toEqual({ verb: 'status' })
    expect(parseWatchdogCommand(['status', WATCHDOG_REPOSITORY])).toEqual({
      verb: 'status',
      repository: WATCHDOG_REPOSITORY,
    })
    expect(parseWatchdogCommand(['status', WATCHDOG_REPOSITORY, '146'])).toEqual({
      verb: 'status',
      repository: WATCHDOG_REPOSITORY,
      number: '146',
    })
    expect(parseWatchdogCommand(['pause', WATCHDOG_REPOSITORY])).toEqual({
      verb: 'pause',
      repository: WATCHDOG_REPOSITORY,
    })
    expect(parseWatchdogCommand(['poll', WATCHDOG_REPOSITORY])).toEqual({
      verb: 'poll',
      repository: WATCHDOG_REPOSITORY,
    })
    expect(parseWatchdogCommand(['policy', WATCHDOG_REPOSITORY])).toEqual({
      verb: 'policy',
      repository: WATCHDOG_REPOSITORY,
    })
    expect(
      parseWatchdogCommand(['policy', WATCHDOG_REPOSITORY, 'template', 'We', 'see', 'it.']),
    ).toEqual({
      verb: 'policy',
      repository: WATCHDOG_REPOSITORY,
      key: 'template',
      value: 'We see it.',
    })
    expect(parseWatchdogCommand(['evidence', WATCHDOG_REPOSITORY, '146'])).toEqual({
      verb: 'evidence',
      repository: WATCHDOG_REPOSITORY,
      number: '146',
    })
    expect(parseWatchdogCommand(['apply', WATCHDOG_REPOSITORY, '146', '{"a":', '1}'])).toEqual({
      verb: 'apply',
      repository: WATCHDOG_REPOSITORY,
      number: '146',
      json: '{"a": 1}',
    })
    expect(parseWatchdogCommand(['decide', WATCHDOG_REPOSITORY, '146'])).toEqual({
      verb: 'decide',
      repository: WATCHDOG_REPOSITORY,
      number: '146',
      isApproved: false,
    })
    expect(parseWatchdogCommand(['decide', WATCHDOG_REPOSITORY, '146', '--approve'])).toEqual({
      verb: 'decide',
      repository: WATCHDOG_REPOSITORY,
      number: '146',
      isApproved: true,
    })
    expect(
      parseWatchdogCommand(['resolve', WATCHDOG_REPOSITORY, '146', '{"a":', '1}', '--approve']),
    ).toEqual({
      verb: 'resolve',
      repository: WATCHDOG_REPOSITORY,
      number: '146',
      evidence: '{"a": 1}',
      isApproved: true,
    })
  })

  it('refuses bad shapes as usage', () => {
    expect(parseWatchdogCommand([])).toBeUndefined()
    expect(parseWatchdogCommand(['watch'])).toBeUndefined()
    expect(parseWatchdogCommand(['list', WATCHDOG_REPOSITORY])).toBeUndefined()
    expect(parseWatchdogCommand(['status', WATCHDOG_REPOSITORY, '146', 'extra'])).toBeUndefined()
    expect(parseWatchdogCommand(['pause'])).toBeUndefined()
    expect(parseWatchdogCommand(['policy'])).toBeUndefined()
    expect(parseWatchdogCommand(['policy', WATCHDOG_REPOSITORY, 'posts'])).toBeUndefined()
    expect(parseWatchdogCommand(['evidence', WATCHDOG_REPOSITORY])).toBeUndefined()
    expect(parseWatchdogCommand(['apply', WATCHDOG_REPOSITORY, '146'])).toBeUndefined()
    expect(
      parseWatchdogCommand(['decide', WATCHDOG_REPOSITORY, '146', '--approve', 'extra']),
    ).toBeUndefined()
    expect(parseWatchdogCommand(['resolve', WATCHDOG_REPOSITORY, '146'])).toBeUndefined()
  })
})

describe('watchdog list, status, pause and resume', () => {
  it('lists watched repositories and their issues', async () => {
    const { port } = await surface({}, (store) =>
      seedIssues(store, [recordFor(146, 'acknowledged')]),
    )
    const parsed = parseWatchdogCommand(['list'])
    if (parsed === undefined) throw new TypeError('list parses')
    const listed = await runWatchdogCommand(parsed, port)
    expect(listed.ok).toBe(true)
    expect(listed.text).toContain(WATCHDOG_REPOSITORY)
    expect(listed.text).toContain('1 issue')
    const bare = await surface({})
    const bareParsed = parseWatchdogCommand(['list'])
    if (bareParsed === undefined) throw new TypeError('list parses')
    const empty = await runWatchdogCommand(bareParsed, bare.port)
    expect(empty.text).toBe(UI_TEXT.watchdog.cli.empty)
  })

  it('shows one repository and one issue, or says they are not watched', async () => {
    const { port } = await surface({}, (store) =>
      seedIssues(store, [recordFor(146, 'triaged', 'needsInfo')]),
    )
    const run = commandRunner(port, 'status parses')
    const repo = await run(['status', WATCHDOG_REPOSITORY])
    expect(repo.ok).toBe(true)
    expect(repo.text).toContain('#146')
    expect(repo.text).toContain(UI_TEXT.watchdog.states.triaged)
    const issue = await run(['status', WATCHDOG_REPOSITORY, '146'])
    expect(issue.ok).toBe(true)
    expect(issue.text).toContain(`${WATCHDOG_REPOSITORY}#146`)
    expect(issue.text).toContain(UI_TEXT.watchdog.verdicts.needsInfo)
    expect(issue.text).toContain('What did you do?')
    const foreign = await run(['status', 'someone/else'])
    expect(foreign.text).toBe(UI_TEXT.watchdog.cli.notWatched)
    const missing = await run(['status', WATCHDOG_REPOSITORY, '999'])
    expect(missing).toEqual({ ok: false, text: UI_TEXT.watchdog.cli.unknownIssue })
    const malformed = await run(['status', WATCHDOG_REPOSITORY, 'nope'])
    expect(malformed).toEqual({ ok: false, text: UI_TEXT.watchdog.cli.invalidIssue })
  })

  it('pauses and resumes a watched repository', async () => {
    const { port } = await surface({}, (store) => seedIssues(store, []))
    const run = async (argv: string[]) => {
      const parsed = parseWatchdogCommand(argv)
      if (parsed === undefined) throw new TypeError('pause parses')
      return await runWatchdogCommand(parsed, port)
    }
    const foreign = await run(['pause', 'someone/else'])
    expect(foreign.text).toBe(UI_TEXT.watchdog.cli.notWatched)
    const paused = await run(['pause', WATCHDOG_REPOSITORY])
    expect(paused.text).toContain(WATCHDOG_REPOSITORY)
    const again = await run(['pause', WATCHDOG_REPOSITORY])
    expect(again.text).toContain(WATCHDOG_REPOSITORY)
    const resumedBack = await run(['resume', WATCHDOG_REPOSITORY])
    expect(resumedBack.text).toContain(WATCHDOG_REPOSITORY)
    const resumed = await run(['resume', WATCHDOG_REPOSITORY])
    expect(resumed.ok).toBe(false)
    expect(resumed.text).toContain(WATCHDOG_REPOSITORY)
    const listed = await runWatchdogCommand({ verb: 'list' }, port)
    expect(listed.text).toContain('0 issues')
  })
})

async function runWords(port: WatchdogSurfacePort, argv: string[]) {
  const parsed = parseWatchdogCommand(argv)
  if (parsed === undefined) throw new TypeError('the command parses')
  return await runWatchdogCommand(parsed, port)
}

function seedTriagedDuplicate(store: ReturnType<typeof createWatchdogStore>): Promise<void> {
  return seedIssues(store, [recordFor(146, 'triaged', 'duplicate')])
}

describe('watchdog policy', () => {
  it('shows the defaults, sets each key by word and refuses the rest', async () => {
    const { port } = await surface({})
    const shown = await runWords(port, ['policy', WATCHDOG_REPOSITORY])
    expect(shown.ok).toBe(true)
    expect(shown.text.split('\n')).toEqual([
      `Policy for ${WATCHDOG_REPOSITORY}:`,
      'label: triage',
      'template: default',
      'watch-labels: none',
      'ignore-authors: none',
      'posts: ask',
      'close: never',
    ])
    // Showing a repository that is not yet watched writes nothing.
    expect(await port.store.list()).toEqual([])

    for (const argv of [
      ['label', 'needs', 'triage'],
      ['template', 'We', 'see', 'it.'],
      ['watch-labels', 'bug,', 'ui'],
      ['ignore-authors', 'dependabot[bot]'],
      ['posts', 'always'],
      ['close', 'onReply'],
    ]) {
      const set = await runWords(port, ['policy', WATCHDOG_REPOSITORY, ...argv])
      expect(set).toEqual({
        ok: true,
        text: `Set ${argv[0] ?? ''} for ${WATCHDOG_REPOSITORY}.`,
      })
    }
    const [stored] = await port.store.list()
    expect(stored?.policy).toMatchObject({
      ackLabel: 'needs triage',
      ackTemplate: 'We see it.',
      watchLabels: ['bug', 'ui'],
      ignoreAuthors: ['dependabot[bot]'],
      postsBeyondAck: 'always',
      closePolicy: 'onReply',
    })

    // The template and the lists go back to their defaults by word.
    await runWords(port, ['policy', WATCHDOG_REPOSITORY, 'template', 'default'])
    await runWords(port, ['policy', WATCHDOG_REPOSITORY, 'watch-labels', 'none'])
    const [reset] = await port.store.list()
    expect(reset?.policy.ackTemplate).toBeUndefined()
    expect(reset?.policy.watchLabels).toEqual([])

    const badValue = await runWords(port, ['policy', WATCHDOG_REPOSITORY, 'posts', 'sometimes'])
    expect(badValue).toEqual({
      ok: false,
      text: 'That value is not allowed for posts. Use ask, always, never.',
    })
    const badKey = await runWords(port, ['policy', WATCHDOG_REPOSITORY, 'colour', 'red'])
    expect(badKey).toEqual({ ok: false, text: UI_TEXT.watchdog.cli.policyUnknownKey })
    const [kept] = await port.store.list()
    expect(kept?.policy.postsBeyondAck).toBe('always')
  })

  it('is what the gate follows: Always posts unasked, Never refuses even an approval', async () => {
    const comments = capturedObjects('github-issue-comments')
    const [first] = comments
    if (first === undefined) throw new TypeError('the capture holds comments')
    const routes = {
      [`GET ${WATCHDOG_BASE}/issues/146/comments`]: { status: 200, body: [] },
      [`POST ${WATCHDOG_BASE}/issues/146/comments`]: { status: 201, body: first },
    }
    const always = await surface(routes, seedTriagedDuplicate)
    await runWords(always.port, ['policy', WATCHDOG_REPOSITORY, 'posts', 'always'])
    const posted = await runWords(always.port, ['decide', WATCHDOG_REPOSITORY, '146'])
    expect(posted.text).toContain(UI_TEXT.watchdog.cli.posted)
    expect(always.calls.some((call) => call.method === 'POST')).toBe(true)

    const never = await surface(routes, seedTriagedDuplicate)
    await runWords(never.port, ['policy', WATCHDOG_REPOSITORY, 'posts', 'never'])
    const held = await runWords(never.port, ['decide', WATCHDOG_REPOSITORY, '146', '--approve'])
    expect(held.text).toContain(UI_TEXT.watchdog.refusal.approvalRequired)
    expect(never.calls.some((call) => call.method === 'POST')).toBe(false)
  })
})

describe('watchdog while report only', () => {
  it('shows the reply it would post, posts nothing, and still acknowledges', async () => {
    const comments = capturedObjects('github-issue-comments')
    const [first] = comments
    if (first === undefined) throw new TypeError('the capture holds comments')
    const routes = {
      [`GET ${WATCHDOG_BASE}/issues`]: { status: 200, body: searchList() },
      [`GET ${WATCHDOG_BASE}/issues/146/comments`]: { status: 200, body: [] },
      [`GET ${WATCHDOG_BASE}/issues/157/comments`]: { status: 200, body: [] },
      [`POST ${WATCHDOG_BASE}/issues/146/labels`]: {
        status: 200,
        body: watchdogCaptured('github-labels'),
      },
      [`POST ${WATCHDOG_BASE}/issues/157/labels`]: {
        status: 200,
        body: watchdogCaptured('github-labels'),
      },
      [`POST ${WATCHDOG_BASE}/issues/146/comments`]: { status: 201, body: first },
      [`POST ${WATCHDOG_BASE}/issues/157/comments`]: { status: 201, body: first },
    }
    const { port, calls } = await surface(routes, undefined, true, true)
    // The acknowledgement is the one post report only allows.
    const polled = await runWords(port, ['poll', WATCHDOG_REPOSITORY])
    expect(polled.ok).toBe(true)
    expect(
      calls.filter((call) => call.method === 'POST' && call.url.endsWith('/comments')),
    ).toHaveLength(2)
    await seedTriagedDuplicate(port.store)
    const before = calls.length
    const held = await runWords(port, ['decide', WATCHDOG_REPOSITORY, '146', '--approve'])
    expect(held.text).toContain(UI_TEXT.watchdog.refusal.reportOnly)
    expect(held.text).toContain(UI_TEXT.watchdog.cli.proposedReply)
    expect(held.text).toContain('#3')
    expect(calls.slice(before).every((call) => call.method === 'GET')).toBe(true)
  })
})

describe('watchdog poll and evidence', () => {
  it('polls the served captures and posts the signed acknowledgement', async () => {
    const comments = capturedObjects('github-issue-comments')
    const [first] = comments
    if (first === undefined) throw new TypeError('the capture holds comments')
    const { port, calls } = await surface({
      [`GET ${WATCHDOG_BASE}/issues`]: { status: 200, body: searchList() },
      [`GET ${WATCHDOG_BASE}/issues/146/comments`]: { status: 200, body: [] },
      [`GET ${WATCHDOG_BASE}/issues/157/comments`]: { status: 200, body: [] },
      [`POST ${WATCHDOG_BASE}/issues/146/comments`]: { status: 201, body: first },
      [`POST ${WATCHDOG_BASE}/issues/157/comments`]: { status: 201, body: first },
      [`POST ${WATCHDOG_BASE}/issues/146/labels`]: {
        status: 200,
        body: watchdogCaptured('github-labels'),
      },
      [`POST ${WATCHDOG_BASE}/issues/157/labels`]: {
        status: 200,
        body: watchdogCaptured('github-labels'),
      },
    })
    const parsed = parseWatchdogCommand(['poll', WATCHDOG_REPOSITORY])
    if (parsed === undefined) throw new TypeError('poll parses')
    const result = await runWatchdogCommand(parsed, port)
    expect(result.ok).toBe(true)
    expect(result.text).toContain(WATCHDOG_REPOSITORY)
    expect(result.text).toContain(UI_TEXT.watchdog.poll.ackPosted)
    const posts = calls.filter((call) => call.method === 'POST' && call.url.endsWith('/comments'))
    expect(posts).toHaveLength(2)
    expect(posts.every((call) => call.authorized)).toBe(true)
    for (const post of posts) {
      const body = (post.body as { body?: unknown }).body
      if (typeof body !== 'string') throw new TypeError('the comment post carries its body')
      expect(body).toContain(WATCHDOG_ACK_MARKER)
    }
  })

  it('says GitHub’s own refusal and the missing sign-in', async () => {
    const refused = await surface({
      [`GET ${WATCHDOG_BASE}/issues`]: watchdogCapturedRoute('github-issues-missing-repository'),
    })
    const parsed = parseWatchdogCommand(['poll', WATCHDOG_REPOSITORY])
    if (parsed === undefined) throw new TypeError('poll parses')
    const stopped = await runWatchdogCommand(parsed, refused.port)
    expect(stopped.ok).toBe(false)
    expect(stopped.text).toContain('Not Found')
    const unsigned = await surface({}, undefined, false)
    expect(await runWatchdogCommand(parsed, unsigned.port)).toEqual({
      ok: false,
      text: UI_TEXT.watchdog.cli.notSignedIn,
    })
  })

  it('prints the charter and the evidence pack for a tracked issue', async () => {
    const { port } = await surface(
      {
        [`GET ${WATCHDOG_BASE}/issues/146`]: {
          status: 200,
          body: watchdogCaptured('github-issue'),
        },
        [`GET ${WATCHDOG_BASE}/issues`]: { status: 200, body: searchList() },
        [`GET ${WATCHDOG_BASE}`]: { status: 200, body: watchdogCaptured('github-repository') },
        ...releaseRoutes(),
      },
      (store) => seedIssues(store, [recordFor(146, 'acknowledged')]),
    )
    const parsed = parseWatchdogCommand(['evidence', WATCHDOG_REPOSITORY, '146'])
    if (parsed === undefined) throw new TypeError('evidence parses')
    const result = await runWatchdogCommand(parsed, port)
    expect(result.ok).toBe(true)
    expect(result.text).toContain('You are the triage agent of the Muse Spark issue watchdog.')
    expect(result.text).toContain('Issue #146')
    expect(result.text).toContain('main')
    expect(result.text).toContain('- v0.19.0 (2026-10-22T04:05:46Z)')
    const untracked = parseWatchdogCommand(['evidence', WATCHDOG_REPOSITORY, '999'])
    if (untracked === undefined) throw new TypeError('evidence parses')
    expect(await runWatchdogCommand(untracked, port)).toEqual({
      ok: false,
      text: UI_TEXT.watchdog.cli.unknownIssue,
    })
  })
})

describe('watchdog apply, decide and resolve', () => {
  it('applies proven findings and refuses the rest', async () => {
    const { port } = await surface({}, (store) =>
      seedIssues(store, [recordFor(146, 'acknowledged'), recordFor(157, 'seen')]),
    )
    const run = async (argv: string[]) => {
      const parsed = parseWatchdogCommand(argv)
      if (parsed === undefined) throw new TypeError('apply parses')
      return await runWatchdogCommand(parsed, port)
    }
    const findings = JSON.stringify({
      version: 1,
      verdict: 'needsInfo',
      summary: 'No steps.',
      questions: ['What did you do?'],
    })
    const applied = await run(['apply', WATCHDOG_REPOSITORY, '146', findings])
    expect(applied.ok).toBe(true)
    expect(applied.text).toContain(UI_TEXT.watchdog.verdicts.needsInfo)
    expect(await run(['apply', WATCHDOG_REPOSITORY, '146', 'not findings'])).toEqual({
      ok: false,
      text: UI_TEXT.watchdog.triage.unreadable,
    })
    expect(await run(['apply', WATCHDOG_REPOSITORY, '157', findings])).toEqual({
      ok: false,
      text: UI_TEXT.watchdog.cli.applyNeedsAck,
    })
  })

  it('decides through the approval flag and holds spam without a post', async () => {
    const routes = commentRoutes()
    const { port, calls } = await surface(routes, (store) =>
      seedIssues(store, [recordFor(146, 'triaged', 'needsInfo')]),
    )
    const run = commandRunner(port, 'decide parses')
    const held = await run(['decide', WATCHDOG_REPOSITORY, '146'])
    expect(held.ok).toBe(true)
    expect(held.text).toContain(UI_TEXT.watchdog.refusal.approvalRequired)
    expect(calls.filter((call) => call.method === 'POST')).toHaveLength(0)
    const allowed = await run(['decide', WATCHDOG_REPOSITORY, '146', '--approve'])
    expect(allowed.ok).toBe(true)
    expect(allowed.text).toContain(UI_TEXT.watchdog.cli.posted)
    expect(allowed.text).toContain(UI_TEXT.watchdog.verdicts.needsInfo)
    const spam = await surface(routes, (store) =>
      seedIssues(store, [recordFor(146, 'triaged', 'spam')]),
    )
    const spamParsed = parseWatchdogCommand(['decide', WATCHDOG_REPOSITORY, '146', '--approve'])
    if (spamParsed === undefined) throw new TypeError('decide parses')
    const held2 = await runWatchdogCommand(spamParsed, spam.port)
    expect(held2.text).toContain(UI_TEXT.watchdog.refusal.spamHeld)
    expect(held2.text).toContain(UI_TEXT.watchdog.cli.closedNote)
    expect(spam.calls).toHaveLength(0)
  })

  it('resolves on passing verification and refuses the rest', async () => {
    const routes = commentRoutes({
      [`PATCH ${WATCHDOG_BASE}/issues/146`]: {
        status: 200,
        body: watchdogCaptured('github-issue'),
      },
    })
    const { port, calls } = await surface(routes, seedPlanned)
    const run = commandRunner(port, 'resolve parses')
    const evidence = JSON.stringify({
      pullRequestNumber: 1,
      pullRequestUrl: `${WATCHDOG_BASE.replace('api.github.com/repos', 'github.com')}/pull/1`,
      version: 'v0.19.0',
      passed: true,
      notes: 'The reproduction passes on the fix.',
    })
    const resolved = await run(['resolve', WATCHDOG_REPOSITORY, '146', evidence, '--approve'])
    expect(resolved.ok).toBe(true)
    expect(resolved.text).toContain(UI_TEXT.watchdog.cli.posted)
    expect(resolved.text).toContain(UI_TEXT.watchdog.cli.closedNote)
    expect(calls.filter((call) => call.method === 'POST')).toHaveLength(1)
    expect(calls.filter((call) => call.method === 'PATCH')).toHaveLength(1)
    const failing = JSON.stringify({
      pullRequestNumber: 1,
      pullRequestUrl: 'https://github.com/x/y/pull/1',
      version: 'v0.19.0',
      passed: false,
      notes: 'Still crashes.',
    })
    // A fresh record: the resolved one already moved on.
    const { port: port2 } = await surface(routes, seedPlanned)
    const run2 = commandRunner(port2, 'resolve parses')
    const unverified = await run2(['resolve', WATCHDOG_REPOSITORY, '146', failing, '--approve'])
    expect(unverified.text).toContain('Still crashes.')
    expect(await run2(['resolve', WATCHDOG_REPOSITORY, '146', 'oops', '--approve'])).toEqual({
      ok: false,
      text: UI_TEXT.watchdog.cli.invalidEvidence,
    })
  })
})

describe('watchdog CLI exits and ACP answers', () => {
  it('exits 0, 1 and 2 with the words on the right stream', async () => {
    const { port } = await surface({}, (store) => seedIssues(store, []))
    const run = async (argv: string[]) => {
      const stdout: string[] = []
      const stderr: string[] = []
      const logged: string[] = []
      const code = await runWatchdogCli(argv, {
        port,
        writeStdout: (text) => {
          stdout.push(text)
        },
        printError: (text) => {
          stderr.push(text)
        },
        log: collectingLogger(logged),
      })
      return { code, stdout, stderr, logged }
    }
    const ok = await run(['list'])
    expect(ok.code).toBe(0)
    expect(ok.stdout).toHaveLength(1)
    expect(ok.stderr).toHaveLength(0)
    const refusal = await run(['status', 'someone/else'])
    expect(refusal.code).toBe(1)
    expect(refusal.stdout).toHaveLength(0)
    expect(refusal.stderr).toEqual([UI_TEXT.watchdog.cli.notWatched])
    const usage = await run(['frobnicate'])
    expect(usage.code).toBe(2)
    expect(usage.stderr).toEqual([UI_TEXT.watchdog.cli.usage])
    const stdout: string[] = []
    const stderr: string[] = []
    const missing = await runWatchdogCli(['list'], {
      port: undefined,
      writeStdout: (text) => {
        stdout.push(text)
      },
      printError: (text) => {
        stderr.push(text)
      },
      log: collectingLogger([]),
    })
    expect(missing).toBe(1)
    expect(stdout).toHaveLength(0)
    expect(stderr).toEqual([UI_TEXT.watchdog.cli.unavailable])
  })

  it('fails a bound store out loud, with the kind on the record', async () => {
    const folder = await roots.fresh('watchdog-broken-')
    const file = path.join(folder, 'file.json')
    await writeFile(file, '{}')
    const store = createWatchdogStore(createNodeScheduleFs(file))
    const stdout: string[] = []
    const stderr: string[] = []
    const logged: string[] = []
    const code = await runWatchdogCli(['list'], {
      port: {
        store,
        client: undefined,
        token: undefined,
        now: () => WATCHDOG_NOW,
        newRunId: () => 'run-1',
        isReportOnly: false,
      },
      writeStdout: (text) => {
        stdout.push(text)
      },
      printError: (text) => {
        stderr.push(text)
      },
      log: collectingLogger(logged),
    })
    expect(code).toBe(1)
    expect(stdout).toHaveLength(0)
    expect(stderr).toEqual([UI_TEXT.watchdog.cli.commandFailed])
    expect(logged.some((line) => line.includes('The watchdog command failed:'))).toBe(true)
  })

  it('answers /watchdog locally and ignores other text', async () => {
    const { port } = await surface({}, (store) =>
      seedIssues(store, [recordFor(146, 'acknowledged')]),
    )
    const quiet = collectingLogger([])
    expect(
      await acpWatchdog(
        [{ type: 'text' as const, text: 'hello there' }],
        () => Promise.resolve(port),
        () => entryBundle(),
        quiet,
      ),
    ).toBeUndefined()
    expect(
      await acpWatchdog(
        [
          { type: 'text' as const, text: '/watchdog list' },
          { type: 'text' as const, text: 'extra' },
        ],
        () => Promise.resolve(port),
        () => entryBundle(),
        quiet,
      ),
    ).toEqual({ ok: false, text: UI_TEXT.watchdog.cli.usage })
    const listed = await acpWatchdog(
      [{ type: 'text' as const, text: '/watchdog list' }],
      () => Promise.resolve(port),
      () => entryBundle(),
      quiet,
    )
    expect(listed?.ok).toBe(true)
    expect(listed?.text).toContain(WATCHDOG_REPOSITORY)
    const missing = await acpWatchdog(
      [{ type: 'text' as const, text: '/watchdog list' }],
      () => Promise.resolve(undefined),
      () => entryBundle(),
      quiet,
    )
    expect(missing).toEqual({ ok: false, text: UI_TEXT.watchdog.cli.unavailable })
  })

  it('reads the GitHub sign-in only for the commands that call GitHub', async () => {
    const { port } = await surface({}, (store) =>
      seedIssues(store, [recordFor(146, 'acknowledged')]),
    )
    const asked: boolean[] = []
    for (const text of [
      '/watchdog list',
      '/watchdog status',
      '/watchdog pause RandyNorthrup/muse-spark-code',
      '/watchdog policy RandyNorthrup/muse-spark-code',
      '/watchdog apply RandyNorthrup/muse-spark-code 146 {}',
      '/watchdog poll RandyNorthrup/muse-spark-code',
      '/watchdog evidence RandyNorthrup/muse-spark-code 146',
      '/watchdog decide RandyNorthrup/muse-spark-code 146',
      '/watchdog resolve RandyNorthrup/muse-spark-code 146 {}',
    ]) {
      await acpWatchdog(
        [{ type: 'text' as const, text }],
        (isGitHubCalled) => {
          asked.push(isGitHubCalled)
          return Promise.resolve(port)
        },
        () => entryBundle(),
        collectingLogger([]),
      )
    }
    expect(asked).toEqual([false, false, false, false, false, true, true, true, true])
  })

  it('fails a bound store out loud at the ACP layer too', async () => {
    const folder = await roots.fresh('watchdog-acp-broken-')
    const file = path.join(folder, 'file.json')
    await writeFile(file, '{}')
    const store = createWatchdogStore(createNodeScheduleFs(file))
    const logged: string[] = []
    const answer = await acpWatchdog(
      [{ type: 'text' as const, text: '/watchdog list' }],
      () =>
        Promise.resolve({
          store,
          client: undefined,
          token: undefined,
          now: () => WATCHDOG_NOW,
          newRunId: () => 'run-1',
          isReportOnly: false,
        }),
      () => entryBundle(),
      collectingLogger(logged),
    )
    expect(answer).toEqual({ ok: false, text: UI_TEXT.watchdog.cli.commandFailed })
    expect(logged.some((line) => line.includes('The watchdog command failed:'))).toBe(true)
  })
})
