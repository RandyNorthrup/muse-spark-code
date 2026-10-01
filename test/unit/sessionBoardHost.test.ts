// The session board's host side (M77, PLAN.md D49): sessions from the
// backend's list, the surface's running turn, pending prompts and git's
// worktrees become board rows; without trust, git never runs.

import { describe, expect, it, vi } from 'vitest'
import type {
  ListSessionsOptions,
  SessionPage,
  SessionRecord,
} from '../../src/core/agent/agentBackend'
import { PendingPrompts } from '../../src/core/sessionBoard'
import { collectSessionBoard } from '../../src/host/sessionBoard'
import type { BoardRow } from '../../src/shared/sessionBoard'
import type { BoardSession } from '../../src/core/sessionBoard'
import { FakeAgentHost } from './helpers/bestOfN'
import { FakeLogOutputChannel } from './helpers/fakes'

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
      return Promise.resolve((overrides.git ?? (() => ''))(args, cwd))
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
        return args[0] === 'worktree' ? WORKTREE_PORCELAIN : ' M src/a.ts\n?? notes.txt\n'
      },
    })
    const rows = await t.rows
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
        if (args[0] === 'worktree') {
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
