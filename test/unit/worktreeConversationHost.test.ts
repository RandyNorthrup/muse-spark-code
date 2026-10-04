// One conversation rooted in one worktree (M77, PLAN.md D49): the ceiling,
// the declines, the trust gate and the confinement.

import { describe, expect, it, vi } from 'vitest'
import {
  WorktreeCeilingError,
  WorktreeConfinementError,
  WorktreeConversationHost,
  WorktreeUntrustedError,
  type WorktreeAttemptOutcome,
  type WorktreeConversationDeps,
  type WorktreeProgressEvent,
  type WorktreeSession,
  type WorktreeSessionEvent,
} from '../../src/core/bestOfN/worktreeConversationHost'
import { FakeLogOutputChannel } from './helpers/fakes'

function resolvedVoid(): Promise<void> {
  return Promise.resolve()
}

class FakeSession implements WorktreeSession {
  private listener: ((event: WorktreeSessionEvent) => void) | undefined
  public readonly sessionId = 'attempt-session'
  public readonly sent: string[] = []
  public decideApproval = vi.fn(resolvedVoid)
  public cancelQuestions = vi.fn(resolvedVoid)
  public cancel = vi.fn(resolvedVoid)

  public onEvent(listener: (event: WorktreeSessionEvent) => void): () => void {
    this.listener = listener
    return () => {
      this.listener = undefined
    }
  }

  public sendTurn(
    parts: readonly [{ readonly type: 'text'; readonly text: string }],
  ): Promise<unknown> {
    this.sent.push(parts[0].text)
    return Promise.resolve({ turnId: 't1' })
  }

  public emit(event: WorktreeSessionEvent): void {
    this.listener?.(event)
  }
}

function hostWith(overrides: Partial<WorktreeConversationDeps> & { session: WorktreeSession }): {
  host: WorktreeConversationHost
  session: WorktreeSession
  progress: WorktreeProgressEvent[]
} {
  const progress: WorktreeProgressEvent[] = []
  const host = new WorktreeConversationHost({
    worktreeRoot: '/repo/app.worktrees/best-of-n-bon-1-0',
    platform: 'linux',
    io: { realPath: (absolutePath: string) => Promise.resolve(absolutePath) },
    requestCeiling: 5,
    declineChoiceId: 'abort',
    onProgress: (event) => {
      progress.push(event)
    },
    log: new FakeLogOutputChannel(),
    ...overrides,
  })
  return { host, session: overrides.session, progress }
}

/** Runs a turn's opening: the prompt sent, its first request announced. */
function startAttempt(session: FakeSession): {
  pending: Promise<WorktreeAttemptOutcome>
  progress: WorktreeProgressEvent[]
} {
  const t = hostWith({ session })
  const pending = t.host.run('go', true)
  session.emit({ type: 'turnStarted', turnId: 't1' })
  return { pending, progress: t.progress }
}

function completeTurn(session: FakeSession, requests: number): void {
  session.emit({ type: 'turnStarted', turnId: 't1' })
  for (let index = 0; index < requests; index += 1) {
    session.emit({ type: 'modelRequestCompleted' })
  }
  session.emit({ type: 'turnCompleted', turnId: 't1', terminal: 'completed' })
}

describe('WorktreeConversationHost', () => {
  it('sends the prompt and counts its requests', async () => {
    const session = new FakeSession()
    const t = hostWith({ session })
    const pending = t.host.run('refactor this', true)
    completeTurn(session, 3)
    const outcome = await pending
    expect(session.sent).toEqual(['refactor this'])
    expect(outcome).toEqual({
      turnId: 't1',
      terminal: 'completed',
      requestsMade: 3,
      ceilingReached: false,
      approvalsDenied: 0,
    })
    expect(t.progress).toEqual([
      { type: 'requestCompleted', requestsMade: 1 },
      { type: 'requestCompleted', requestsMade: 2 },
      { type: 'requestCompleted', requestsMade: 3 },
    ])
  })

  it('cancels once at the ceiling and marks it', async () => {
    const session = new FakeSession()
    const t = hostWith({ session, requestCeiling: 5 })
    const pending = t.host.run('go', true)
    session.emit({ type: 'turnStarted', turnId: 't1' })
    for (let index = 0; index < 6; index += 1) {
      session.emit({ type: 'modelRequestCompleted' })
    }
    session.emit({ type: 'turnCompleted', turnId: 't1', terminal: 'completed' })
    const outcome = await pending
    expect(session.cancel).toHaveBeenCalledTimes(1)
    expect(outcome.ceilingReached).toBe(true)
    expect(outcome.requestsMade).toBe(6)
  })

  it('declines approvals and questions with abort, counted', async () => {
    const session = new FakeSession()
    const { pending, progress } = startAttempt(session)
    session.emit({
      type: 'approvalRequested',
      approvalId: 'a1',
      requirementId: { approvalId: 'a1', sourceIndex: 0 },
    })
    session.emit({ type: 'questionRequested', userInputId: 'q1' })
    session.emit({ type: 'turnCompleted', turnId: 't1', terminal: 'completed' })
    const outcome = await pending
    expect(session.decideApproval).toHaveBeenCalledWith({
      approvalId: 'a1',
      choiceId: 'abort',
      requirementId: { approvalId: 'a1', sourceIndex: 0 },
    })
    expect(session.cancelQuestions).toHaveBeenCalledWith('q1')
    expect(outcome.approvalsDenied).toBe(2)
    expect(progress).toEqual([{ type: 'approvalDenied' }, { type: 'approvalDenied' }])
  })

  it('keeps the outcome when a decline settles elsewhere', async () => {
    const session = new FakeSession()
    session.decideApproval = vi.fn(() => Promise.reject(new Error('already settled')))
    const { pending } = startAttempt(session)
    session.emit({
      type: 'approvalRequested',
      approvalId: 'a1',
      requirementId: { approvalId: 'a1', sourceIndex: 0 },
    })
    session.emit({ type: 'turnCompleted', turnId: 't1', terminal: 'completed' })
    const outcome = await pending
    expect(outcome.approvalsDenied).toBe(1)
  })

  it('refuses Restricted Mode before anything runs', async () => {
    const session = new FakeSession()
    const t = hostWith({ session })
    expect(() => {
      t.host.requireTrusted(false)
    }).toThrow(WorktreeUntrustedError)
    await expect(t.host.run('go', false)).rejects.toThrow(WorktreeUntrustedError)
    expect(session.sent).toEqual([])
  })

  it('refuses a ceiling outside the best-of-N bounds', async () => {
    const session = new FakeSession()
    const low = hostWith({ session, requestCeiling: 4 })
    await expect(low.host.run('go', true)).rejects.toThrow(WorktreeCeilingError)
    const high = hostWith({ session, requestCeiling: 51 })
    await expect(high.host.run('go', true)).rejects.toThrow(WorktreeCeilingError)
  })

  it('rejects when the turn never starts', async () => {
    const session = new FakeSession()
    session.sendTurn = () => Promise.reject(new Error('backend gone'))
    const t = hostWith({ session })
    await expect(t.host.run('go', true)).rejects.toThrow('backend gone')
  })

  it('rejects a turn that ends without an id', async () => {
    const session = new FakeSession()
    const t = hostWith({ session })
    const pending = t.host.run('go', true)
    session.emit({ type: 'turnCompleted', turnId: '', terminal: 'completed' })
    await expect(pending).rejects.toThrow('without a turn')
  })

  it('confines paths to the worktree', async () => {
    const session = new FakeSession()
    const t = hostWith({ session })
    await expect(t.host.resolvePath('src/a.ts')).resolves.toBe(
      '/repo/app.worktrees/best-of-n-bon-1-0/src/a.ts',
    )
    await expect(t.host.resolvePath('../../escape.ts')).rejects.toThrow(WorktreeConfinementError)
  })
})
