// M115w WU: the watchdog's CLI and ACP surface over the real store
// and the real client. The grammar parses every verb and refuses bad
// shapes as usage; list, status, pause and resume work the store; poll,
// evidence, apply, decide and resolve drive the served captures end to
// end; refusals (unsigned, unknown, unready, GitHub's own) are said,
// and only a store that cannot be bound fails the command.
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
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
  triageFindingsSchema,
  watchdogIssueSchema,
  type TriageFindings,
  type WatchdogIssue,
} from '../../src/shared/watchdog'
import {
  capturedObjects,
  capturedSearchIssues,
  serveGithub,
  watchdogCaptured,
  watchdogLogger,
} from './helpers/watchdog/servedGithub'

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

type Routes = Record<string, { status: number; body: unknown }>

async function surface(
  routes: Routes,
  seed?: (store: ReturnType<typeof createWatchdogStore>) => Promise<void>,
  isSigned = true,
) {
  const served = serveGithub(routes)
  const folder = await mkdtemp(path.join(tmpdir(), 'watchdog-surface-'))
  folders.push(folder)
  const store = createWatchdogStore(createNodeScheduleFs(folder))
  if (seed !== undefined) await seed(store)
  let runs = 0
  const port: WatchdogSurfacePort = {
    store,
    client: isSigned
      ? new GitHubClient({
          fetch: served.fetch,
          userAgent: 'muse-spark-code/test',
          log: watchdogLogger([]),
        })
      : undefined,
    token: isSigned ? 'token' : undefined,
    now: () => NOW,
    newRunId: () => {
      runs += 1
      return `run-${String(runs)}`
    },
  }
  return { port, calls: served.calls, folder }
}

function findingsFor(verdict: TriageFindings['verdict']): TriageFindings {
  return triageFindingsSchema.parse({
    version: 1,
    verdict,
    summary: 'Same title as #3.',
    questions: verdict === 'needsInfo' ? ['What did you do?'] : [],
    ...(verdict === 'duplicate' && { duplicateOf: 3 }),
    ...(verdict === 'alreadyFixed' && { fixedIn: '0.19.0' }),
    ...(verdict === 'inHand' && { inHandRef: 'PLAN.md M115' }),
  })
}

function recordFor(
  number: number,
  state: WatchdogIssue['state'],
  verdict?: TriageFindings['verdict'],
  outcome?: WatchdogIssue['outcome'],
): WatchdogIssue {
  return watchdogIssueSchema.parse({
    repository: REPOSITORY,
    issueNumber: number,
    issueId: number,
    state,
    runId: 'run-1',
    seenAtMs: 1,
    labelsApplied: [],
    ...(verdict !== undefined && { findings: findingsFor(verdict) }),
    ...(outcome !== undefined && { outcome }),
    lastTitle: 't',
    lastCommentCount: 0,
    lastIssueUpdatedAt: '2026-10-22T00:00:00Z',
    updatedAtMs: 1,
  })
}

async function seedIssues(store: ReturnType<typeof createWatchdogStore>, issues: WatchdogIssue[]) {
  await store.exclusive(REPOSITORY, (data) => ({
    data: { policy: data.policy, issues },
    result: undefined,
  }))
}

function searchList(): unknown {
  return capturedSearchIssues()
}

describe('watchdog command grammar', () => {
  it('parses the nine verbs', () => {
    expect(parseWatchdogCommand(['list'])).toEqual({ verb: 'list' })
    expect(parseWatchdogCommand(['status'])).toEqual({ verb: 'status' })
    expect(parseWatchdogCommand(['status', REPOSITORY])).toEqual({
      verb: 'status',
      repository: REPOSITORY,
    })
    expect(parseWatchdogCommand(['status', REPOSITORY, '146'])).toEqual({
      verb: 'status',
      repository: REPOSITORY,
      number: '146',
    })
    expect(parseWatchdogCommand(['pause', REPOSITORY])).toEqual({
      verb: 'pause',
      repository: REPOSITORY,
    })
    expect(parseWatchdogCommand(['poll', REPOSITORY])).toEqual({
      verb: 'poll',
      repository: REPOSITORY,
    })
    expect(parseWatchdogCommand(['evidence', REPOSITORY, '146'])).toEqual({
      verb: 'evidence',
      repository: REPOSITORY,
      number: '146',
    })
    expect(parseWatchdogCommand(['apply', REPOSITORY, '146', '{"a":', '1}'])).toEqual({
      verb: 'apply',
      repository: REPOSITORY,
      number: '146',
      json: '{"a": 1}',
    })
    expect(parseWatchdogCommand(['decide', REPOSITORY, '146'])).toEqual({
      verb: 'decide',
      repository: REPOSITORY,
      number: '146',
      isApproved: false,
    })
    expect(parseWatchdogCommand(['decide', REPOSITORY, '146', '--approve'])).toEqual({
      verb: 'decide',
      repository: REPOSITORY,
      number: '146',
      isApproved: true,
    })
    expect(
      parseWatchdogCommand(['resolve', REPOSITORY, '146', '{"a":', '1}', '--approve']),
    ).toEqual({
      verb: 'resolve',
      repository: REPOSITORY,
      number: '146',
      evidence: '{"a": 1}',
      isApproved: true,
    })
  })

  it('refuses bad shapes as usage', () => {
    expect(parseWatchdogCommand([])).toBeUndefined()
    expect(parseWatchdogCommand(['watch'])).toBeUndefined()
    expect(parseWatchdogCommand(['list', REPOSITORY])).toBeUndefined()
    expect(parseWatchdogCommand(['status', REPOSITORY, '146', 'extra'])).toBeUndefined()
    expect(parseWatchdogCommand(['pause'])).toBeUndefined()
    expect(parseWatchdogCommand(['evidence', REPOSITORY])).toBeUndefined()
    expect(parseWatchdogCommand(['apply', REPOSITORY, '146'])).toBeUndefined()
    expect(
      parseWatchdogCommand(['decide', REPOSITORY, '146', '--approve', 'extra']),
    ).toBeUndefined()
    expect(parseWatchdogCommand(['resolve', REPOSITORY, '146'])).toBeUndefined()
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
    expect(listed.text).toContain(REPOSITORY)
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
    const run = async (argv: string[]) => {
      const parsed = parseWatchdogCommand(argv)
      if (parsed === undefined) throw new TypeError('status parses')
      return await runWatchdogCommand(parsed, port)
    }
    const repo = await run(['status', REPOSITORY])
    expect(repo.ok).toBe(true)
    expect(repo.text).toContain('#146')
    expect(repo.text).toContain(UI_TEXT.watchdog.states.triaged)
    const issue = await run(['status', REPOSITORY, '146'])
    expect(issue.ok).toBe(true)
    expect(issue.text).toContain(`${REPOSITORY}#146`)
    expect(issue.text).toContain(UI_TEXT.watchdog.verdicts.needsInfo)
    expect(issue.text).toContain('What did you do?')
    const foreign = await run(['status', 'someone/else'])
    expect(foreign.text).toBe(UI_TEXT.watchdog.cli.notWatched)
    const missing = await run(['status', REPOSITORY, '999'])
    expect(missing).toEqual({ ok: false, text: UI_TEXT.watchdog.cli.unknownIssue })
    const malformed = await run(['status', REPOSITORY, 'nope'])
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
    const paused = await run(['pause', REPOSITORY])
    expect(paused.text).toContain(REPOSITORY)
    const again = await run(['pause', REPOSITORY])
    expect(again.text).toContain(REPOSITORY)
    const resumedBack = await run(['resume', REPOSITORY])
    expect(resumedBack.text).toContain(REPOSITORY)
    const resumed = await run(['resume', REPOSITORY])
    expect(resumed.ok).toBe(false)
    expect(resumed.text).toContain(REPOSITORY)
    const listed = await runWatchdogCommand({ verb: 'list' }, port)
    expect(listed.text).toContain('0 issues')
  })
})

describe('watchdog poll and evidence', () => {
  it('polls the served captures and posts the signed acknowledgement', async () => {
    const comments = capturedObjects('github-issue-comments')
    const [first] = comments
    if (first === undefined) throw new TypeError('the capture holds comments')
    const { port, calls } = await surface({
      [`GET ${BASE}/issues`]: { status: 200, body: searchList() },
      [`GET ${BASE}/issues/146/comments`]: { status: 200, body: [] },
      [`GET ${BASE}/issues/157/comments`]: { status: 200, body: [] },
      [`POST ${BASE}/issues/146/comments`]: { status: 201, body: first },
      [`POST ${BASE}/issues/157/comments`]: { status: 201, body: first },
      [`POST ${BASE}/issues/146/labels`]: { status: 200, body: watchdogCaptured('github-labels') },
      [`POST ${BASE}/issues/157/labels`]: { status: 200, body: watchdogCaptured('github-labels') },
    })
    const parsed = parseWatchdogCommand(['poll', REPOSITORY])
    if (parsed === undefined) throw new TypeError('poll parses')
    const result = await runWatchdogCommand(parsed, port)
    expect(result.ok).toBe(true)
    expect(result.text).toContain(REPOSITORY)
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
      [`GET ${BASE}/issues`]: { status: 404, body: { message: 'Not Found' } },
    })
    const parsed = parseWatchdogCommand(['poll', REPOSITORY])
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
        [`GET ${BASE}/issues/146`]: { status: 200, body: watchdogCaptured('github-issue') },
        [`GET ${BASE}/issues`]: { status: 200, body: searchList() },
        [`GET ${BASE}`]: { status: 200, body: watchdogCaptured('github-repository') },
        [`GET ${BASE}/releases`]: { status: 200, body: watchdogCaptured('github-releases') },
        [`GET ${BASE}/tags`]: { status: 200, body: watchdogCaptured('github-tags') },
        ['GET https://api.github.com/search/commits']: {
          status: 200,
          body: watchdogCaptured('github-search-commits'),
        },
      },
      (store) => seedIssues(store, [recordFor(146, 'acknowledged')]),
    )
    const parsed = parseWatchdogCommand(['evidence', REPOSITORY, '146'])
    if (parsed === undefined) throw new TypeError('evidence parses')
    const result = await runWatchdogCommand(parsed, port)
    expect(result.ok).toBe(true)
    expect(result.text).toContain('You are the triage agent of the Muse Spark issue watchdog.')
    expect(result.text).toContain('Issue #146')
    expect(result.text).toContain('main')
    expect(result.text).toContain('- v0.19.0 (2026-10-22T04:05:46Z)')
    const untracked = parseWatchdogCommand(['evidence', REPOSITORY, '999'])
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
    const applied = await run(['apply', REPOSITORY, '146', findings])
    expect(applied.ok).toBe(true)
    expect(applied.text).toContain(UI_TEXT.watchdog.verdicts.needsInfo)
    expect(await run(['apply', REPOSITORY, '146', 'not findings'])).toEqual({
      ok: false,
      text: UI_TEXT.watchdog.triage.unreadable,
    })
    expect(await run(['apply', REPOSITORY, '157', findings])).toEqual({
      ok: false,
      text: UI_TEXT.watchdog.cli.applyNeedsAck,
    })
  })

  it('decides through the approval flag and holds spam without a post', async () => {
    const comments = capturedObjects('github-issue-comments')
    const [first] = comments
    if (first === undefined) throw new TypeError('the capture holds comments')
    const routes: Routes = {
      [`GET ${BASE}/issues/146/comments`]: { status: 200, body: [] },
      [`POST ${BASE}/issues/146/comments`]: { status: 201, body: first },
    }
    const { port, calls } = await surface(routes, (store) =>
      seedIssues(store, [recordFor(146, 'triaged', 'needsInfo')]),
    )
    const run = async (argv: string[]) => {
      const parsed = parseWatchdogCommand(argv)
      if (parsed === undefined) throw new TypeError('decide parses')
      return await runWatchdogCommand(parsed, port)
    }
    const held = await run(['decide', REPOSITORY, '146'])
    expect(held.ok).toBe(true)
    expect(held.text).toContain(UI_TEXT.watchdog.refusal.approvalRequired)
    expect(calls.filter((call) => call.method === 'POST')).toHaveLength(0)
    const allowed = await run(['decide', REPOSITORY, '146', '--approve'])
    expect(allowed.ok).toBe(true)
    expect(allowed.text).toContain(UI_TEXT.watchdog.cli.posted)
    expect(allowed.text).toContain(UI_TEXT.watchdog.verdicts.needsInfo)
    const spam = await surface(routes, (store) =>
      seedIssues(store, [recordFor(146, 'triaged', 'spam')]),
    )
    const spamParsed = parseWatchdogCommand(['decide', REPOSITORY, '146', '--approve'])
    if (spamParsed === undefined) throw new TypeError('decide parses')
    const held2 = await runWatchdogCommand(spamParsed, spam.port)
    expect(held2.text).toContain(UI_TEXT.watchdog.refusal.spamHeld)
    expect(held2.text).toContain(UI_TEXT.watchdog.cli.closedNote)
    expect(spam.calls).toHaveLength(0)
  })

  it('resolves on passing verification and refuses the rest', async () => {
    const comments = capturedObjects('github-issue-comments')
    const [first] = comments
    if (first === undefined) throw new TypeError('the capture holds comments')
    const routes: Routes = {
      [`GET ${BASE}/issues/146/comments`]: { status: 200, body: [] },
      [`POST ${BASE}/issues/146/comments`]: { status: 201, body: first },
      [`PATCH ${BASE}/issues/146`]: { status: 200, body: watchdogCaptured('github-issue') },
    }
    const { port, calls } = await surface(routes, async (store) => {
      await store.exclusive(REPOSITORY, (_data) => ({
        data: {
          policy: { ...defaultWatchdogPolicy(REPOSITORY), closePolicy: 'onReply' },
          issues: [recordFor(146, 'planned', 'valid', 'planEntry')],
        },
        result: undefined,
      }))
    })
    const run = async (argv: string[]) => {
      const parsed = parseWatchdogCommand(argv)
      if (parsed === undefined) throw new TypeError('resolve parses')
      return await runWatchdogCommand(parsed, port)
    }
    const evidence = JSON.stringify({
      pullRequestNumber: 1,
      pullRequestUrl: `${BASE.replace('api.github.com/repos', 'github.com')}/pull/1`,
      version: 'v0.19.0',
      passed: true,
      notes: 'The reproduction passes on the fix.',
    })
    const resolved = await run(['resolve', REPOSITORY, '146', evidence, '--approve'])
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
    const { port: port2 } = await surface(routes, async (store) => {
      await store.exclusive(REPOSITORY, (_data) => ({
        data: {
          policy: { ...defaultWatchdogPolicy(REPOSITORY), closePolicy: 'onReply' },
          issues: [recordFor(146, 'planned', 'valid', 'planEntry')],
        },
        result: undefined,
      }))
    })
    const run2 = async (argv: string[]) => {
      const parsed = parseWatchdogCommand(argv)
      if (parsed === undefined) throw new TypeError('resolve parses')
      return await runWatchdogCommand(parsed, port2)
    }
    const unverified = await run2(['resolve', REPOSITORY, '146', failing, '--approve'])
    expect(unverified.text).toContain('Still crashes.')
    expect(await run2(['resolve', REPOSITORY, '146', 'oops', '--approve'])).toEqual({
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
        log: watchdogLogger(logged),
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
      log: watchdogLogger([]),
    })
    expect(missing).toBe(1)
    expect(stdout).toHaveLength(0)
    expect(stderr).toEqual([UI_TEXT.watchdog.cli.unavailable])
  })

  it('fails a bound store out loud, with the kind on the record', async () => {
    const folder = await mkdtemp(path.join(tmpdir(), 'watchdog-broken-'))
    folders.push(folder)
    const file = path.join(folder, 'file.json')
    await writeFile(file, '{}')
    const store = createWatchdogStore(createNodeScheduleFs(file))
    const stdout: string[] = []
    const stderr: string[] = []
    const logged: string[] = []
    const code = await runWatchdogCli(['list'], {
      port: { store, client: undefined, token: undefined, now: () => NOW, newRunId: () => 'run-1' },
      writeStdout: (text) => {
        stdout.push(text)
      },
      printError: (text) => {
        stderr.push(text)
      },
      log: watchdogLogger(logged),
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
    const quiet = watchdogLogger([])
    expect(
      await acpWatchdog(
        [{ type: 'text' as const, text: 'hello there' }],
        () => Promise.resolve(port),
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
        quiet,
      ),
    ).toEqual({ ok: false, text: UI_TEXT.watchdog.cli.usage })
    const listed = await acpWatchdog(
      [{ type: 'text' as const, text: '/watchdog list' }],
      () => Promise.resolve(port),
      quiet,
    )
    expect(listed?.ok).toBe(true)
    expect(listed?.text).toContain(REPOSITORY)
    const missing = await acpWatchdog(
      [{ type: 'text' as const, text: '/watchdog list' }],
      () => Promise.resolve(undefined),
      quiet,
    )
    expect(missing).toEqual({ ok: false, text: UI_TEXT.watchdog.cli.unavailable })
  })

  it('fails a bound store out loud at the ACP layer too', async () => {
    const folder = await mkdtemp(path.join(tmpdir(), 'watchdog-acp-broken-'))
    folders.push(folder)
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
          now: () => NOW,
          newRunId: () => 'run-1',
        }),
      watchdogLogger(logged),
    )
    expect(answer).toEqual({ ok: false, text: UI_TEXT.watchdog.cli.commandFailed })
    expect(logged.some((line) => line.includes('The watchdog command failed:'))).toBe(true)
  })
})
