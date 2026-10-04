// The session board's host side (M77, PLAN.md D49): sessions from the
// backend's list, the surface's running turn, pending prompts and git's
// worktrees become board rows; without trust, git never runs.

import { existsSync, realpathSync } from 'node:fs'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type {
  ListSessionsOptions,
  SessionPage,
  SessionRecord,
} from '../../src/core/agent/agentBackend'
import { posixQuoted } from '../../src/core/shellQuote'
import { PendingPrompts } from '../../src/core/sessionBoard'
import { processGitRunner } from '../../src/host/git'
import { collectSessionBoard } from '../../src/host/sessionBoard'
import { GIT_METADATA_OPTIONS } from '../../src/shared/constants'
import type { BoardRow } from '../../src/shared/sessionBoard'
import type { BoardSession } from '../../src/core/sessionBoard'
import { FakeAgentHost } from './helpers/bestOfN'
import { FakeLogOutputChannel } from './helpers/fakes'
import { removeFolder } from './helpers/temporaryFolders'

function record(overrides: Partial<SessionRecord> & { sessionId: string }): SessionRecord {
  return {
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    status: 'idle',
    turnCount: 0,
    ...overrides,
  }
}

function throwing(name: string): () => Promise<never> {
  return () => Promise.reject(new Error(`${name} is not scripted`))
}

/** The session list, paged like the host serves it. */
class FakeBoardHost extends FakeAgentHost {
  public startSession = throwing('startSession')

  public constructor(private readonly pages: SessionRecord[][]) {
    super()
  }

  public listSessions(options: ListSessionsOptions): Promise<SessionPage> {
    const index = options.cursor === undefined ? 0 : Number(options.cursor)
    return Promise.resolve({
      sessions: this.pages[index] ?? [],
      nextCursor: index + 1 < this.pages.length ? String(index + 1) : undefined,
    })
  }

  public get sessionCount(): number {
    return this.pages.flat().length
  }

  public close(): Promise<void> {
    return Promise.resolve()
  }
}

function collectorWith(
  overrides: Partial<{
    records: SessionRecord[]
    isTrusted: boolean
    git: (args: readonly string[], cwd: string) => string
    currentSessionId: string | undefined
    currentTurnId: string | undefined
    pending: [string, string][]
    workspaceRoot: string | undefined
    liveSessions: readonly BoardSession[]
  }> = {},
): {
  rows: Promise<readonly BoardRow[]>
  gitCalls: { readonly args: readonly string[]; readonly cwd: string }[]
  ensureHost: ReturnType<typeof vi.fn>
} {
  const gitCalls: { readonly args: readonly string[]; readonly cwd: string }[] = []
  const pendingPrompts = new PendingPrompts()
  const pending = overrides.pending ?? []
  for (const [sessionId, promptId] of pending) {
    pendingPrompts.track(sessionId, promptId)
  }
  const host = new FakeBoardHost([overrides.records ?? []])
  const ensureHost = vi.fn(() => Promise.resolve(host))
  const rows = collectSessionBoard({
    ensureHost,
    backendOf: () => 'modelApi',
    workspaceRoot: Object.hasOwn(overrides, 'workspaceRoot')
      ? overrides.workspaceRoot
      : '/repo/app',
    isWorkspaceTrusted: () => overrides.isTrusted ?? true,
    runGit: (args, cwd) => {
      gitCalls.push({ args, cwd })
      // The metadata runner first reads the filter names: none configured here.
      const answer = args.includes('--get-regexp') ? () => '' : (overrides.git ?? (() => ''))
      return Promise.resolve(answer(args, cwd))
    },
    platform: 'linux',
    currentSessionId: overrides.currentSessionId,
    currentTurnId: overrides.currentTurnId,
    pendingPrompts,
    liveSessions: overrides.liveSessions,
    log: new FakeLogOutputChannel(),
  })
  return { rows, gitCalls, ensureHost }
}

const WORKTREE_PORCELAIN = [
  'worktree /repo/app',
  'HEAD 1111111111111111111111111111111111111111',
  'branch refs/heads/main',
  '',
  'worktree /repo/app.worktrees/best-of-n-bon-1-0',
  'HEAD 2222222222222222222222222222222222222222',
  'branch refs/heads/best-of-n/bon-1/0',
  '',
].join('\n')

describe('collectSessionBoard', () => {
  it('joins sessions, the running turn, approvals and git worktrees', async () => {
    const t = collectorWith({
      records: [
        record({ sessionId: 's1', title: 'Main chat', status: 'idle', branch: 'main' }),
        record({
          sessionId: 's2',
          title: 'Attempt',
          status: 'idle',
          branch: 'best-of-n/bon-1/0',
          workspaceRoot: '/repo/app.worktrees/best-of-n-bon-1-0',
        }),
      ],
      currentSessionId: 's1',
      currentTurnId: 'turn-1',
      pending: [['s2', 'approval-1']],
      git: (args) => {
        return args.includes('worktree') ? WORKTREE_PORCELAIN : ' M src/a.ts\n?? notes.txt\n'
      },
    })
    const rows = await t.rows
    // Every call is a metadata read: no fsmonitor, maintenance or replacement refs.
    for (const call of t.gitCalls) {
      expect(call.args.slice(0, GIT_METADATA_OPTIONS.length)).toEqual([...GIT_METADATA_OPTIONS])
    }
    expect(t.gitCalls.filter((call) => call.args.at(-1) === '--porcelain=v1')).toHaveLength(2)
    expect(rows).toEqual([
      {
        sessionId: 's1',
        title: 'Main chat',
        backend: 'modelApi',
        status: 'running',
        branch: 'main',
        worktreePath: '/repo/app',
        changedFiles: 2,
        awaitingApproval: false,
      },
      {
        sessionId: 's2',
        title: 'Attempt',
        backend: 'modelApi',
        status: 'idle',
        branch: 'best-of-n/bon-1/0',
        worktreePath: '/repo/app.worktrees/best-of-n-bon-1-0',
        changedFiles: 2,
        awaitingApproval: true,
      },
    ])
  })

  it('keeps the row when git cannot read its changes', async () => {
    const t = collectorWith({
      records: [record({ sessionId: 's1', title: 'A', branch: 'main' })],
      git: (args) => {
        if (args.includes('worktree')) {
          return WORKTREE_PORCELAIN
        }
        throw new Error('repo locked')
      },
    })
    const rows = await t.rows
    expect(rows).toEqual([
      {
        sessionId: 's1',
        title: 'A',
        backend: 'modelApi',
        status: 'idle',
        branch: 'main',
        worktreePath: '/repo/app',
        awaitingApproval: false,
      },
    ])
  })

  it('never runs git in Restricted Mode', async () => {
    const t = collectorWith({
      records: [record({ sessionId: 's1', title: 'A', branch: 'main' })],
      isTrusted: false,
    })
    const rows = await t.rows
    expect(t.gitCalls).toEqual([])
    expect(rows).toEqual([
      {
        sessionId: 's1',
        title: 'A',
        backend: 'modelApi',
        status: 'idle',
        branch: 'main',
        awaitingApproval: false,
      },
    ])
  })

  it('lists the current conversation even before the host knows it', async () => {
    const t = collectorWith({
      records: [],
      currentSessionId: 'fresh',
      currentTurnId: 'turn-9',
    })
    const rows = await t.rows
    expect(rows).toEqual([
      {
        sessionId: 'fresh',
        title: 'Untitled',
        backend: 'modelApi',
        status: 'running',
        awaitingApproval: false,
      },
    ])
  })

  it('pages the session list to its cap', async () => {
    const host = new FakeBoardHost([
      [record({ sessionId: 's1', title: 'First' })],
      [record({ sessionId: 's2', title: 'Second' })],
    ])
    const rows = await collectSessionBoard({
      ensureHost: () => Promise.resolve(host),
      backendOf: () => 'museCode',
      workspaceRoot: '/repo/app',
      isWorkspaceTrusted: () => false,
      runGit: () => Promise.reject(new Error('git must not run')),
      platform: 'linux',
      currentSessionId: undefined,
      currentTurnId: undefined,
      pendingPrompts: new PendingPrompts(),
      log: new FakeLogOutputChannel(),
    })
    expect(rows.map((row) => row.sessionId)).toEqual(['s1', 's2'])
    expect(rows[0]).toMatchObject({ backend: 'museCode' })
  })

  it('merges captured live turn state from every open backend surface', async () => {
    const t = collectorWith({
      records: [record({ sessionId: 'api-chat', title: 'API', status: 'notLoaded' })],
      liveSessions: [
        {
          sessionId: 'api-chat',
          backend: 'modelApi',
          status: 'running',
          workspaceRoot: '/repo/app',
        },
        {
          sessionId: 'native-chat',
          backend: 'museCode',
          status: 'running',
          title: 'Native',
          workspaceRoot: '/repo/app',
        },
      ],
      pending: [['native-chat', 'approval-1']],
    })
    const rows = await t.rows
    expect(rows).toHaveLength(2)
    expect(rows.find((row) => row.sessionId === 'api-chat')).toMatchObject({
      backend: 'modelApi',
      status: 'running',
    })
    expect(rows.find((row) => row.sessionId === 'native-chat')).toMatchObject({
      backend: 'museCode',
      status: 'running',
      awaitingApproval: true,
    })
  })
})

// Real git, disposable repositories under the OS temp directory, no model calls.
const realRoots: string[] = []
// Real git and a node program per command take seconds on a busy Windows host.
const REAL_GIT_TEST_MS = 120_000
// The fixture's configuration is its own, never a developer's global or system one.
const FIXTURE_GIT_ENV = {
  ...process.env,
  GIT_CONFIG_NOSYSTEM: '1',
  GIT_CONFIG_GLOBAL: process.platform === 'win32' ? 'NUL' : '/dev/null',
}

afterEach(async () => {
  for (const root of realRoots.splice(0)) {
    await removeFolder(root)
  }
})

/**
 * A committed repository with one changed file, and a runner whose
 * `core.fsmonitor` (given at command scope, in its environment, as the
 * review's probe gave it) names a program that leaves a marker file.
 */
async function monitoredRepository() {
  const temp = realpathSync.native(await mkdtemp(path.join(tmpdir(), 'muse-board-')))
  realRoots.push(temp)
  const root = path.join(temp, 'app')
  await mkdir(root)
  const git = processGitRunner({ env: FIXTURE_GIT_ENV })
  await git(['init', '--initial-branch=main'], root)
  await git(['config', 'user.name', 'Offline test'], root)
  await git(['config', 'user.email', 'offline@example.invalid'], root)
  await writeFile(path.join(root, 'tracked.txt'), 'before\n')
  await git(['add', '--all'], root)
  await git(['commit', '-m', 'fixture'], root)
  await writeFile(path.join(root, 'tracked.txt'), 'after, longer\n')
  const marker = path.join(temp, 'fsmonitor-ran')
  const program = path.join(temp, 'fsmonitor.cjs')
  await writeFile(
    program,
    String.raw`require('node:fs').writeFileSync(process.argv[2], 'ran');process.stdout.write(process.argv[3] === '2' ? 'board-token\0/\0' : '/\0')`,
  )
  const command = [process.execPath, program, marker]
    .map((file) => posixQuoted(file.replaceAll('\\', '/')))
    .join(' ')
  const monitored = processGitRunner({
    env: {
      ...FIXTURE_GIT_ENV,
      GIT_CONFIG_COUNT: '1',
      GIT_CONFIG_KEY_0: 'core.fsmonitor',
      GIT_CONFIG_VALUE_0: command,
    },
  })
  return { root, marker, monitored }
}

describe('collectSessionBoard over real git (M77, the RV78 review)', () => {
  it(
    'counts a worktree’s changes without starting the fsmonitor its git is configured with',
    async () => {
      const { root, marker, monitored } = await monitoredRepository()
      // The canary is live: an ordinary status starts the configured program.
      await monitored(['status', '--porcelain=v1'], root)
      expect(await readFile(marker, 'utf8')).toBe('ran')
      await rm(marker)
      const rows = await collectSessionBoard({
        ensureHost: () =>
          Promise.resolve(
            new FakeBoardHost([
              [record({ sessionId: 's1', title: 'A', branch: 'main', workspaceRoot: root })],
            ]),
          ),
        backendOf: () => 'modelApi',
        workspaceRoot: root,
        isWorkspaceTrusted: () => true,
        runGit: monitored,
        platform: process.platform,
        currentSessionId: undefined,
        currentTurnId: undefined,
        pendingPrompts: new PendingPrompts(),
        log: new FakeLogOutputChannel(),
      })
      expect(rows).toMatchObject([{ sessionId: 's1', changedFiles: 1 }])
      expect(existsSync(marker)).toBe(false)
    },
    REAL_GIT_TEST_MS,
  )
})
