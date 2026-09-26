// A scripted AgentHost and AgentSession for the ACP agent's tests (M63): each
// call is a spy, and a test plays the backend's side by emitting events.

import { vi } from 'vitest'
import type {
  AgentHost,
  AgentSession,
  HostExit,
  HostInfo,
  LoadedSession,
  ModelSummary,
  SessionEventListener,
  SessionPage,
  SkillSummary,
} from '../../../src/core/agent/agentBackend'
import type { AgentEvent, ItemSnapshot, TodoItem } from '../../../src/shared/agentEvents'

function resolved(): Promise<void> {
  return Promise.resolve()
}

function unsubscribe(): undefined {
  return undefined
}

function sameTurn(expectedTurnId: string): Promise<string> {
  return Promise.resolve(expectedTurnId)
}

function noOutput(request: { readonly itemId: string }): Promise<never> {
  return Promise.reject(new Error(`no output ${request.itemId}`))
}

function sameName(name: string): Promise<string> {
  return Promise.resolve(name)
}

function goalAdmitted(): ReturnType<AgentSession['controlGoal']> {
  return Promise.resolve({ turnId: undefined })
}

export class FakeAgentSession implements AgentSession {
  private readonly listeners = new Set<SessionEventListener>()
  private turns = 0
  public skills: readonly SkillSummary[] = []
  public readonly sendTurn = vi.fn<AgentSession['sendTurn']>(() => {
    this.turns += 1
    return Promise.resolve({ turnId: `turn-${String(this.turns)}`, disposition: 'started' })
  })
  public readonly steer = vi.fn<AgentSession['steer']>(sameTurn)
  public readonly cancel = vi.fn<AgentSession['cancel']>(resolved)
  public readonly setModel = vi.fn<AgentSession['setModel']>(resolved)
  public readonly setReasoningEffort = vi.fn<AgentSession['setReasoningEffort']>(resolved)
  public readonly setApprovalMode = vi.fn<AgentSession['setApprovalMode']>(resolved)
  public readonly compact = vi.fn<AgentSession['compact']>(() =>
    Promise.resolve({ status: this.sessionId, reason: undefined }),
  )
  public readonly decideApproval = vi.fn<AgentSession['decideApproval']>(resolved)
  public readonly answerQuestions = vi.fn<AgentSession['answerQuestions']>(resolved)
  public readonly cancelQuestions = vi.fn<AgentSession['cancelQuestions']>(resolved)
  public readonly controlSubagent = vi.fn<AgentSession['controlSubagent']>(resolved)
  public readonly messageSubagent = vi.fn<AgentSession['messageSubagent']>(resolved)
  public readonly controlGoal = vi.fn<AgentSession['controlGoal']>(goalAdmitted)
  public readonly clarifyQuestions = vi.fn<AgentSession['clarifyQuestions']>(resolved)
  public readonly moveToBackground = vi.fn<AgentSession['moveToBackground']>(resolved)
  public readonly stopTask = vi.fn<AgentSession['stopTask']>(resolved)
  public readonly stopAllTasks = vi.fn<AgentSession['stopAllTasks']>(resolved)
  public readonly runUserShell = vi.fn<AgentSession['runUserShell']>(resolved)
  public readonly readOutput = vi.fn<AgentSession['readOutput']>(noOutput)
  public readonly listSkills = vi.fn<AgentSession['listSkills']>(() => Promise.resolve(this.skills))
  public readonly rename = vi.fn<AgentSession['rename']>(sameName)
  public readonly dispose = vi.fn<AgentSession['dispose']>()

  public constructor(
    public readonly sessionId: string,
    public readonly modelId: string,
  ) {}

  public onEvent(listener: SessionEventListener): () => void {
    this.listeners.add(listener)
    return () => {
      this.listeners.delete(listener)
    }
  }

  public emit(...events: AgentEvent[]): void {
    for (const event of events) {
      for (const listener of this.listeners) {
        listener(event)
      }
    }
  }
}

export const FAKE_MODELS: readonly ModelSummary[] = [
  {
    modelId: 'muse-spark-1.3',
    displayLabel: 'Muse Spark 1.3',
    contextLimit: 1_000_000,
    isDefault: true,
    isActive: true,
  },
  {
    modelId: 'muse-spark-1.3-contributor',
    displayLabel: 'Muse Spark 1.3 (contributor)',
    contextLimit: 1_000_000,
    isDefault: false,
    isActive: false,
  },
]

export interface FakeHistory {
  readonly items: readonly ItemSnapshot[]
  readonly todos: readonly TodoItem[]
}

export class FakeAgentHost implements AgentHost {
  private readonly exitListeners = new Set<(exit: HostExit) => void>()
  public info: HostInfo = {
    kind: 'museCode',
    serverName: 'fake',
    serverVersion: '0.0.0',
    grantedCapabilities: ['sessionMcp'],
    canEditSessions: true,
  }
  public readonly sessions: FakeAgentSession[] = []
  public history: FakeHistory = { items: [], todos: [] }
  public page: SessionPage = { sessions: [], nextCursor: undefined }
  public readonly startSession = vi.fn<AgentHost['startSession']>((options) =>
    Promise.resolve(
      this.newSession(`session-${String(this.sessions.length + 1)}`, options.modelId),
    ),
  )
  public readonly resumeSession = vi.fn<AgentHost['resumeSession']>((sessionId, modelId) => {
    const loaded: LoadedSession = {
      session: this.newSession(sessionId, modelId),
      record: {
        sessionId,
        createdAt: '2026-09-26T00:00:00Z',
        updatedAt: '2026-09-26T00:00:00Z',
        status: 'idle',
        turnCount: 1,
      },
      history: {
        mode: 'inline',
        items: this.history.items,
        name: undefined,
        todos: this.history.todos,
      },
      activeTurnId: undefined,
    }
    return Promise.resolve(loaded)
  })
  public readonly listSessions = vi.fn<AgentHost['listSessions']>(() => Promise.resolve(this.page))

  public constructor(public models: readonly ModelSummary[] = FAKE_MODELS) {}

  private newSession(sessionId: string, modelId: string): FakeAgentSession {
    const session = new FakeAgentSession(sessionId, modelId)
    this.sessions.push(session)
    return session
  }

  public get sessionCount(): number {
    return this.sessions.length
  }

  public onExit(listener: (exit: HostExit) => void): () => void {
    this.exitListeners.add(listener)
    return () => {
      this.exitListeners.delete(listener)
    }
  }

  public exit(description: string): void {
    for (const listener of this.exitListeners) {
      listener({ description, isExpected: false, isPersistent: false })
    }
  }

  public listModels(): Promise<readonly ModelSummary[]> {
    return Promise.resolve(this.models)
  }

  public readSession(): Promise<never> {
    return Promise.reject(new Error('not used'))
  }

  public forkSession(): Promise<never> {
    return Promise.reject(new Error('not used'))
  }

  public onSessionListEvent(): () => void {
    return unsubscribe
  }

  public readUsage(): Promise<undefined> {
    return Promise.resolve(undefined)
  }

  public onUsageChanged(): () => void {
    return unsubscribe
  }

  public close(): Promise<void> {
    return Promise.resolve()
  }
}
