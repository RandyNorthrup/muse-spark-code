// Best-of-N's host side (M77, PLAN.md D49): the session adapter maps the
// backend's events to the core worktree host, declines with `abort`, and
// validates the requirement it declines through the zod schema.

import { describe, expect, it, vi } from 'vitest'
import type {
  AgentSession,
  StartSessionOptions,
  TurnPart,
  TurnSubmission,
} from '../../src/core/agent/agentBackend'
import { BestOfNManager } from '../../src/host/bestOfN/bestOfNManager'
import type { AgentEvent } from '../../src/shared/agentEvents'
import type { BestOfNRun } from '../../src/shared/bestOfN'
import {
  awaitCompletedRun,
  awaitRunStatus,
  bestOfNManagerBase,
  bestOfNObjectOutput,
  FakeAgentHost,
} from './helpers/bestOfN'
import { FakeLogOutputChannel } from './helpers/fakes'

function turnStarted(turnId: string): AgentEvent {
  return { type: 'turnStarted', turnId }
}

function turnCompleted(turnId: string): AgentEvent {
  return { type: 'turnCompleted', turnId, terminal: 'completed' }
}

function usage(): AgentEvent {
  return { type: 'tokenUsage', inputTokens: 10, outputTokens: 5 }
}

function approval(approvalId: string, requirementId: unknown): AgentEvent {
  return {
    type: 'approvalRequested',
    approvalId,
    itemId: 'item-1',
    toolName: 'write_file',
    rawArgs: '{}',
    // The malformed-requirement test needs a backend that breaks its own
    // contract; the value only ever round-trips back to the session.
    requirementId: requirementId as { approvalId: string; sourceIndex: number },
    subject: { kind: 'fileAccess' },
    availableChoices: [{ choiceId: 'abort', label: 'Reject', decision: 'reject', scope: 'once' }],
    isJudgeEscalated: false,
    isProtectedWrite: true,
  }
}

function question(userInputId: string): AgentEvent {
  return {
    type: 'questionRequested',
    userInputId,
    itemId: 'item-2',
    questions: [
      {
        id: 'q',
        header: 'Shell',
        question: 'Run it?',
        selection: { mode: 'single' },
        options: [{ label: 'Yes' }],
      },
    ],
  }
}

function throwing(name: string): () => Promise<never> {
  return () => Promise.reject(new Error(`${name} is not scripted`))
}

function resolvedVoid(): Promise<void> {
  return Promise.resolve()
}

function returnedVoid(): void {
  // The fakes below unsubscribe and dispose with no work to do.
}

class FakeSession implements AgentSession {
  private listener: ((event: AgentEvent) => void) | undefined
  public readonly sessionId: string
  public readonly modelId = 'muse-spark-1.3'
  public readonly sent: TurnPart[][] = []
  public decideApproval = vi.fn(resolvedVoid)
  public deferQuestions = throwing('deferQuestions')
  public cancelQuestions = vi.fn(resolvedVoid)
  public cancel = vi.fn(resolvedVoid)
  public dispose = vi.fn(returnedVoid)
  public steer = throwing('steer')
  public setModel = throwing('setModel')
  public setReasoningEffort = throwing('setReasoningEffort')
  public setApprovalMode = throwing('setApprovalMode')
  public compact = throwing('compact')
  public answerQuestions = throwing('answerQuestions')
  public clarifyQuestions = throwing('clarifyQuestions')
  public moveToBackground = throwing('moveToBackground')
  public stopTask = throwing('stopTask')
  public stopAllTasks = throwing('stopAllTasks')
  public runUserShell = throwing('runUserShell')
  public controlSubagent = throwing('controlSubagent')
  public stopSubagent = throwing('stopSubagent')
  public readSubagentResult = throwing('readSubagentResult')
  public messageSubagent = throwing('messageSubagent')
  public controlGoal = throwing('controlGoal')
  public readOutput = throwing('readOutput')
  public listSkills = throwing('listSkills')
  public rename = throwing('rename')

  public constructor(sessionId: string) {
    this.sessionId = sessionId
  }

  public onEvent(listener: (event: AgentEvent) => void): () => void {
    this.listener = listener
    return () => {
      this.listener = undefined
    }
  }

  public sendTurn(parts: readonly TurnPart[]): Promise<TurnSubmission> {
    // The turn itself is scripted: the test emits its events.
    this.sent.push([...parts])
    return Promise.resolve({ turnId: 't-scripted', disposition: 'started' })
  }

  public emit(event: AgentEvent): void {
    this.listener?.(event)
  }
}

class FakeHost extends FakeAgentHost {
  private failStart: Error | undefined
  public readonly sessions: FakeSession[] = []
  public readonly started: StartSessionOptions[] = []
  public close = vi.fn(() => {
    for (const session of this.sessions) session.dispose()
    return resolvedVoid()
  })

  public refuseStart(error: Error): void {
    this.failStart = error
  }

  public startSession(options: StartSessionOptions): Promise<AgentSession> {
    if (this.failStart !== undefined) {
      throw this.failStart
    }
    this.started.push(options)
    const session = new FakeSession(`session-${String(this.sessions.length)}`)
    this.sessions.push(session)
    return Promise.resolve(session)
  }

  public listSessions(): Promise<{ sessions: []; nextCursor: undefined }> {
    return Promise.resolve({ sessions: [], nextCursor: undefined })
  }

  public get sessionCount(): number {
    return this.sessions.length
  }
}

function managerWith(host: FakeHost): {
  manager: BestOfNManager
  updates: BestOfNRun[]
  gitCalls: { readonly args: readonly string[] }[]
} {
  const updates: BestOfNRun[] = []
  const gitCalls: { readonly args: readonly string[] }[] = []
  const log = new FakeLogOutputChannel()
  const manager = new BestOfNManager({
    isBestOfNOn: () => true,
    allowsPaidUse: () => Promise.resolve(true),
    notePaidUse: () => undefined,
    runGit: (args) => {
      gitCalls.push({ args })
      return Promise.resolve(bestOfNObjectOutput(args))
    },
    repositoryRoot: () => '/repo/app',
    platform: 'linux',
    buildAttemptHost: () => Promise.resolve(host),
    ...bestOfNManagerBase(updates, log),
  })
  return { manager, updates, gitCalls }
}

describe('BestOfNManager', () => {
  it('starts sessions in the worktrees and declines with abort', async () => {
    const host = new FakeHost()
    const t = managerWith(host)
    await t.manager.start(
      { prompt: 'leave a note', attempts: 2, requestCeilingPerAttempt: 20 },
      'modelApi',
    )
    expect(host.started).toHaveLength(2)
    expect(host.started[0]).toMatchObject({
      modelId: 'muse-spark-1.3',
      approvalMode: 'onRequest',
    })
    expect(host.started[0]?.workspaceRoot).toContain('.worktrees')
    const [first, second] = host.sessions
    if (first === undefined || second === undefined) {
      throw new Error('Expected two attempt sessions')
    }
    first.emit(turnStarted('t1'))
    first.emit(usage())
    first.emit(approval('a1', { approvalId: 'a1', sourceIndex: 0 }))
    first.emit(question('q1'))
    first.emit(usage())
    first.emit(turnCompleted('t1'))
    expect(first.cancel).toHaveBeenCalled()
    second.emit(turnStarted('t2'))
    second.emit(turnCompleted('t2'))
    await awaitCompletedRun(t.updates)
    expect(first.decideApproval).toHaveBeenCalledWith({
      approvalId: 'a1',
      choiceId: 'abort',
      requirementId: { approvalId: 'a1', sourceIndex: 0 },
    })
    expect(first.cancelQuestions).toHaveBeenCalledWith('q1')
    const finished = t.updates.at(-1)
    expect(finished?.runAttempts[0]).toMatchObject({
      status: 'completed',
      requestsMade: 0,
      ceilingReached: false,
      approvalsDenied: 2,
    })
    expect(finished?.runAttempts[1]).toMatchObject({ status: 'completed', requestsMade: 0 })
    // Settled attempts release their sessions and hosts.
    expect(first.dispose).toHaveBeenCalled()
    expect(host.close).toHaveBeenCalled()
  })

  it('completes the attempt when a decline carries no requirement', async () => {
    const host = new FakeHost()
    const t = managerWith(host)
    await t.manager.start({ prompt: 'go', attempts: 2, requestCeilingPerAttempt: 20 }, 'modelApi')
    const [first, second] = host.sessions
    if (first === undefined || second === undefined) {
      throw new Error('Expected two attempt sessions')
    }
    first.emit(turnStarted('t1'))
    first.emit(approval('a1', 42))
    first.emit(turnCompleted('t1'))
    second.emit(turnStarted('t2'))
    second.emit(turnCompleted('t2'))
    await awaitCompletedRun(t.updates)
    // The malformed requirement never reaches the session's decline.
    expect(first.decideApproval).not.toHaveBeenCalled()
    expect(t.updates.at(-1)?.runAttempts[0]).toMatchObject({
      status: 'completed',
      approvalsDenied: 1,
    })
  })

  it('fails the attempt when its host never starts', async () => {
    const host = new FakeHost()
    host.refuseStart(new Error('key missing'))
    const t = managerWith(host)
    await t.manager.start({ prompt: 'go', attempts: 2, requestCeilingPerAttempt: 20 }, 'modelApi')
    await awaitRunStatus(t.updates, 'failed')
    expect(t.updates.at(-1)?.runAttempts[0]).toMatchObject({
      status: 'failed',
      failureReason: 'key missing',
    })
  })

  it('cancels the turn and closes the host on dispose', async () => {
    const host = new FakeHost()
    const t = managerWith(host)
    await t.manager.start({ prompt: 'go', attempts: 2, requestCeilingPerAttempt: 20 }, 'modelApi')
    await t.manager.cancel()
    const [first] = host.sessions
    expect(first?.cancel).toHaveBeenCalled()
    expect(first?.dispose).toHaveBeenCalled()
    expect(host.close).toHaveBeenCalled()
  })
})
