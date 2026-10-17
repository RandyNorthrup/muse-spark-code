// The session board's rows (M77, PLAN.md D49): every conversation joined
// with its worktree, and the window-wide pending prompts behind the
// awaiting-approval mark.

import { describe, expect, it } from 'vitest'
import { buildSessionBoard, PendingPrompts, type BoardSession } from '../../src/core/sessionBoard'
import type { WorktreeEntry } from '../../src/core/worktrees'

const PLATFORM = 'linux'

function entry(path: string, branch: string | undefined): WorktreeEntry {
  return {
    path,
    branch,
    isBare: false,
    isDetached: branch === undefined,
    isLocked: false,
    isPrunable: false,
  }
}

function session(overrides: Partial<BoardSession> & { sessionId: string }): BoardSession {
  return { backend: 'modelApi', status: 'idle', ...overrides }
}

describe('buildSessionBoard', () => {
  it('lists a conversation with no worktree, untitled when it has no name', () => {
    const rows = buildSessionBoard({
      sessions: [session({ sessionId: 's1' })],
      worktrees: [],
      approvalsPending: new Set(),
      platform: PLATFORM,
    })
    expect(rows).toEqual([
      {
        sessionId: 's1',
        title: 'Untitled',
        backend: 'modelApi',
        status: 'idle',
        awaitingApproval: false,
      },
    ])
  })

  it('joins a worktree by folder first, falling back to the branch', () => {
    const rows = buildSessionBoard({
      sessions: [
        session({
          sessionId: 'by-folder',
          title: 'Folder',
          branch: 'other',
          workspaceRoot: '/repo/app.worktrees/best-of-n/bon-1-0',
        }),
        session({ sessionId: 'by-branch', title: 'Branch', branch: 'main' }),
      ],
      worktrees: [
        {
          entry: entry('/repo/app.worktrees/best-of-n/bon-1-0', 'best-of-n/bon-1-0'),
          changedFiles: 3,
        },
        { entry: entry('/repo/app', 'main'), changedFiles: 0 },
      ],
      approvalsPending: new Set(),
      platform: PLATFORM,
    })
    expect(rows).toEqual([
      {
        sessionId: 'by-branch',
        title: 'Branch',
        backend: 'modelApi',
        status: 'idle',
        branch: 'main',
        worktreePath: '/repo/app',
        changedFiles: 0,
        awaitingApproval: false,
      },
      {
        sessionId: 'by-folder',
        title: 'Folder',
        backend: 'modelApi',
        status: 'idle',
        branch: 'other',
        worktreePath: '/repo/app.worktrees/best-of-n/bon-1-0',
        changedFiles: 3,
        awaitingApproval: false,
      },
    ])
  })

  it('leaves the change count unknown when git could not say', () => {
    const rows = buildSessionBoard({
      sessions: [session({ sessionId: 's1', title: 'A', workspaceRoot: '/wt' })],
      worktrees: [{ entry: entry('/wt', 'feature') }],
      approvalsPending: new Set(),
      platform: PLATFORM,
    })
    expect(rows[0]).toMatchObject({ worktreePath: '/wt' })
    expect(rows[0]).not.toHaveProperty('changedFiles')
  })

  it('sorts running, then waiting, then the rest by title', () => {
    const rows = buildSessionBoard({
      sessions: [
        session({ sessionId: 'idle-b', title: 'b' }),
        session({ sessionId: 'running', title: 'z', status: 'running' }),
        session({ sessionId: 'waiting', title: 'a' }),
        session({ sessionId: 'idle-a', title: 'a' }),
      ],
      worktrees: [],
      approvalsPending: new Set(['waiting']),
      platform: PLATFORM,
    })
    expect(rows.map((row) => row.sessionId)).toEqual(['running', 'waiting', 'idle-a', 'idle-b'])
    expect(rows.find((row) => row.sessionId === 'waiting')?.awaitingApproval).toBe(true)
  })
})

describe('PendingPrompts', () => {
  it('tracks, dedupes replays, resolves and drops', () => {
    const pending = new PendingPrompts()
    pending.track('s1', 'approval-1')
    pending.track('s1', 'approval-1')
    pending.track('s1', 'question-2')
    expect(pending.pendingSessionIds()).toEqual(new Set(['s1']))
    pending.resolve('s1', 'approval-1')
    expect(pending.pendingSessionIds()).toEqual(new Set(['s1']))
    pending.resolve('s1', 'question-2')
    expect(pending.pendingSessionIds()).toEqual(new Set<string>())
  })

  it('ignores resolves for sessions and prompts it never saw', () => {
    const pending = new PendingPrompts()
    pending.resolve('missing', 'approval-1')
    pending.track('s1', 'approval-1')
    pending.resolve('s1', 'other')
    expect(pending.pendingSessionIds()).toEqual(new Set(['s1']))
  })

  it('drops a closed session and clears a dead host', () => {
    const pending = new PendingPrompts()
    pending.track('s1', 'approval-1')
    pending.track('s2', 'question-1')
    pending.drop('s1')
    expect(pending.pendingSessionIds()).toEqual(new Set(['s2']))
    pending.clear()
    expect(pending.pendingSessionIds()).toEqual(new Set<string>())
  })
})
