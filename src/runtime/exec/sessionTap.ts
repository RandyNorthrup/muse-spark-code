import type { AcpBackend } from '../../acp/agent'
import type { AgentHost, AgentSession } from '../../core/agent/agentBackend'
import type { AgentEvent, ItemSnapshot } from '../../shared/agentEvents'
import { UI_TEXT } from '../../shared/constants'
import type { LastResponse } from './execProtocol'

interface ReleasedMessage {
  itemId: string
  kind: 'agentMessage' | 'reasoning'
  text: string
  complete: boolean
}
export interface SessionTap {
  readonly backend: AcpBackend
  subscribe(sessionId: string, listener: (event: AgentEvent) => void): () => void
  beginResponse(n: number): void
  settleResponse(outcome: LastResponse): void
  releasedMessages(): readonly ReleasedMessage[]
}

export function observeBackend(backend: AcpBackend): SessionTap {
  const hosts = new WeakMap<AgentHost, AgentHost>()
  const sessions = new Map<string, AgentSession>()
  const items = new Map<string, { n: number; item: ItemSnapshot; isDone: boolean }>()
  const outcomes = new Map<number, LastResponse>()
  let current = 0
  const wrap = (host: AgentHost): AgentHost => {
    const existing = hosts.get(host)
    if (existing !== undefined) return existing
    // Explicit forwarding preserves prototype methods and optional features;
    // never subscribe here: ACP must receive Muse Code's backlog first.
    const wrapped: AgentHost = {
      info: host.info,
      onExit: host.onExit.bind(host),
      listModels: host.listModels.bind(host),
      async startSession(options) {
        const session = await host.startSession(options)
        sessions.set(session.sessionId, session)
        return session
      },
      listSessions: host.listSessions.bind(host),
      readSession: host.readSession.bind(host),
      readSessionOutput: host.readSessionOutput.bind(host),
      resumeSession: host.resumeSession.bind(host),
      forkSession: host.forkSession.bind(host),
      onSessionListEvent: host.onSessionListEvent.bind(host),
      readUsage: host.readUsage.bind(host),
      onUsageChanged: host.onUsageChanged.bind(host),
      importSession: host.importSession?.bind(host),
      get sessionCount() {
        return host.sessionCount
      },
      close: host.close.bind(host),
    }
    hosts.set(host, wrapped)
    return wrapped
  }
  const observe = (event: AgentEvent) => {
    if (['itemStarted', 'itemUpdated', 'itemCompleted'].includes(event.type) && 'item' in event) {
      const { item } = event
      if (item.kind !== 'agentMessage' && item.kind !== 'reasoning') return
      const previous = items.get(item.itemId)
      items.set(item.itemId, {
        n: previous?.n ?? current,
        item,
        isDone: event.type === 'itemCompleted' || previous?.isDone === true,
      })
    } else if (event.type === 'textDelta') {
      const previous = items.get(event.itemId)
      if (previous === undefined) return
      if (event.field === 'text')
        previous.item = { ...previous.item, text: (previous.item.text ?? '') + event.delta }
    } else if (backend.kind === 'museCode' && event.type === 'turnCompleted') {
      outcomes.set(current, {
        n: current,
        terminal: event.terminal,
        incompleteReason: event.reason ?? null,
        endedWithoutTerminal: false,
        httpStatus: null,
        transportError: null,
        usage: 'missing',
        settlement: 'full-reservation',
      })
    }
  }
  return {
    backend: {
      kind: backend.kind,
      readiness: backend.readiness.bind(backend),
      async hostFor(cwd) {
        return wrap(await backend.hostFor(cwd))
      },
    },
    subscribe(sessionId, listener) {
      const session = sessions.get(sessionId)
      if (session === undefined) throw new Error(UI_TEXT.execRequestShape)
      return session.onEvent((event) => {
        observe(event)
        listener(event)
      })
    },
    beginResponse(n) {
      current = n
    },
    settleResponse(outcome) {
      outcomes.set(outcome.n, { ...outcome })
    },
    releasedMessages() {
      const released: ReleasedMessage[] = []
      for (const [itemId, entry] of items) {
        const outcome = outcomes.get(entry.n)
        if (outcome === undefined) continue
        const isComplete =
          outcome.terminal === 'completed' &&
          outcome.usage !== 'invalid' &&
          outcome.transportError === null &&
          !outcome.endedWithoutTerminal &&
          outcome.httpStatus === null
        if (isComplete && !entry.isDone) continue
        const kind = entry.item.kind
        if (kind !== 'agentMessage' && kind !== 'reasoning') continue
        released.push({
          itemId,
          kind,
          text: isComplete
            ? (entry.item.text ?? entry.item.summary?.join('\n') ?? '')
            : UI_TEXT.execMessageWithheld,
          complete: isComplete,
        })
      }
      return released
    },
  }
}
