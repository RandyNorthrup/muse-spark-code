import { NODE_PROTOCOL_VERSION } from '../../../shared/constants'
import {
  nodeMethods,
  type NodeMethodName,
  type NodeMethodParams,
  type NodeMethodResult,
} from '../../../shared/hostApi/nodeMethods'
import {
  nodeEventSchema,
  type NodeAudit,
  type NodeEvent,
  type NodeTerminalHostEvent,
  type NodeToolHostPort,
} from '../../../shared/node'
import type { NodeSession } from '../../../shared/nodeAuth'
import { nodeActionDigest } from '../listenerMethods'
import { guardNodeMethod, NodeListenerError } from '../listenerGuard'
import type { NodeTerminalSubscription } from '../listenerSocket'

type TerminalMethod = Extract<NodeMethodName, `node/terminal/${string}`>

/** The audit detail for one terminal session's start or end (hash-chained by N). */
type TerminalAuditDetails = Omit<
  Extract<NodeAudit, { kind: 'terminal' }>,
  'v' | 'seq' | 'nodeId' | 'previousHash' | 'hash'
>

/** N supplies the tool host, the audit store and the node's identity. The
page never sees a terminal outside its session's node, and the audit never
carries keystrokes: start and end with byte sizes only (D90.12). */
export interface NodeTerminalPagePort {
  host: NodeToolHostPort
  nodeId: string
  now: () => number
  audit(details: TerminalAuditDetails): Promise<NodeAudit>
  /** Files an unexpected method failure with the serve log. The report
  carries the raw error for the record; implementations print a fixed
  sentence, never its text (paths and prompts stay out of the log). */
  report(error: unknown): void
}

interface TerminalRecord {
  readonly workspaceId: string
  inputBytes: number
  outputBytes: number
  ended: boolean
  seq: number
  /** Ordered fan-out: each host event is fully delivered before the next. */
  queue: Promise<void>
  readonly subscribers: Set<(event: NodeEvent) => Promise<void>>
  /** Released once the end is delivered and audited. */
  readonly finishers: Set<() => void>
}

/** One session's terminal methods. N binds the caller's session id; a null
session opens nothing (dispatch refuses unauthenticated callers first). */
export function createNodeTerminalMethods(port: NodeTerminalPagePort, sessionId: string | null) {
  const terminals = new Map<string, TerminalRecord>()

  const envelope = (
    record: TerminalRecord,
    event: NodeTerminalHostEvent,
    terminalId: string,
  ): NodeEvent => {
    record.seq += 1
    const fields = {
      v: NODE_PROTOCOL_VERSION,
      seq: record.seq,
      time: port.now(),
      nodeId: port.nodeId,
      terminalId,
    }
    return event.type === 'terminalOutput'
      ? nodeEventSchema.parse({ ...fields, type: 'terminalOutput', data: event.data })
      : nodeEventSchema.parse({
          ...fields,
          type: 'terminalEnded',
          exitCode: event.exitCode,
          reason: event.reason,
        })
  }

  const deliver = async (
    terminalId: string,
    record: TerminalRecord,
    event: NodeTerminalHostEvent,
  ): Promise<void> => {
    const previous = record.queue
    const step = (async () => {
      await previous
      if (record.ended) {
        return
      }
      if (event.type === 'terminalOutput') {
        record.outputBytes += Buffer.byteLength(event.data)
      } else {
        record.ended = true
      }
      const framed = envelope(record, event, terminalId)
      for (const send of record.subscribers) {
        try {
          await send(framed)
        } catch (error: unknown) {
          // One dead socket must not end the terminal for the rest: drop it
          // and file its failure; the abort that follows disposes nothing
          // while subscribers remain.
          record.subscribers.delete(send)
          port.report(error)
        }
      }
      if (event.type !== 'terminalEnded') {
        return
      }
      terminals.delete(terminalId)
      await port.audit({
        time: port.now(),
        sessionId,
        outcome: 'allowed',
        kind: 'terminal',
        terminalId,
        workspaceId: record.workspaceId,
        phase: 'end',
        inputBytes: record.inputBytes,
        outputBytes: record.outputBytes,
        source: 'person',
      })
      for (const finish of record.finishers) {
        finish()
      }
      record.finishers.clear()
    })()
    record.queue = (async () => {
      try {
        await step
      } catch (error: unknown) {
        // The observer owns the failure (it tears the terminal down at the
        // host); the report keeps the queue's journal observable.
        port.report(error)
      }
    })()
    await step
  }

  const open = async (
    input: NodeMethodParams<'node/terminal/open'>,
    signal: AbortSignal,
  ): Promise<NodeMethodResult<'node/terminal/open'>> => {
    const params = nodeMethods['node/terminal/open'].params.parse(input)
    signal.throwIfAborted()
    if (nodeActionDigest('node/terminal/open', params) !== params.actionDigest)
      throw new NodeListenerError('forbidden')
    const record: TerminalRecord = {
      workspaceId: params.workspaceId,
      inputBytes: 0,
      outputBytes: 0,
      ended: false,
      seq: 0,
      queue: Promise.resolve(),
      subscribers: new Set(),
      finishers: new Set(),
    }
    // The observer installs before the child starts, so an instant exit
    // arrives before the id resolves; those events wait for registration.
    // No await sits between the resolve and the registration, so none is
    // lost or delivered twice.
    const pending: NodeTerminalHostEvent[] = []
    let isRegistered = false
    const opened = await port.host.openTerminal(
      params.workspaceId,
      params.size,
      async (event) => {
        if (isRegistered) {
          await deliver(opened.id, record, event)
          return
        }
        pending.push(event)
      },
      signal,
    )
    terminals.set(opened.id, record)
    isRegistered = true
    for (const event of pending.splice(0)) {
      await deliver(opened.id, record, event)
    }
    await port.audit({
      time: port.now(),
      sessionId,
      outcome: 'allowed',
      kind: 'terminal',
      terminalId: opened.id,
      workspaceId: params.workspaceId,
      phase: 'start',
      inputBytes: 0,
      outputBytes: 0,
      source: 'person',
    })
    if (signal.aborted) {
      // Opened but no longer wanted: dispose the PTY (its end audits once,
      // in the terminalEnded delivery) before reporting the cancellation.
      try {
        await port.host.closeTerminal(opened.id)
      } catch (error: unknown) {
        port.report(error)
      }
      signal.throwIfAborted()
    }
    return nodeMethods['node/terminal/open'].result.parse({ terminalId: opened.id })
  }

  const write = async (
    input: NodeMethodParams<'node/terminal/write'>,
    signal: AbortSignal,
  ): Promise<NodeMethodResult<'node/terminal/write'>> => {
    const params = nodeMethods['node/terminal/write'].params.parse(input)
    signal.throwIfAborted()
    const record = terminals.get(params.terminalId)
    if (record === undefined || record.ended) throw new NodeListenerError('notFound')
    await port.host.writeTerminal(params.terminalId, params.data)
    record.inputBytes += Buffer.byteLength(params.data)
    signal.throwIfAborted()
    return nodeMethods['node/terminal/write'].result.parse({ done: true })
  }

  const resize = async (
    input: NodeMethodParams<'node/terminal/resize'>,
    signal: AbortSignal,
  ): Promise<NodeMethodResult<'node/terminal/resize'>> => {
    const params = nodeMethods['node/terminal/resize'].params.parse(input)
    signal.throwIfAborted()
    const record = terminals.get(params.terminalId)
    if (record === undefined || record.ended) throw new NodeListenerError('notFound')
    await port.host.resizeTerminal(params.terminalId, params.size)
    signal.throwIfAborted()
    return nodeMethods['node/terminal/resize'].result.parse({ done: true })
  }

  const close = async (
    input: NodeMethodParams<'node/terminal/close'>,
    signal: AbortSignal,
  ): Promise<NodeMethodResult<'node/terminal/close'>> => {
    const params = nodeMethods['node/terminal/close'].params.parse(input)
    signal.throwIfAborted()
    // Idempotent: a terminal already ended (or never opened here) is done.
    // The end audit lands once, in the terminalEnded delivery above.
    if (terminals.has(params.terminalId)) {
      await port.host.closeTerminal(params.terminalId)
    }
    signal.throwIfAborted()
    return nodeMethods['node/terminal/close'].result.parse({ done: true })
  }

  const attach = (
    input: NodeMethodParams<'node/terminal/attach'>,
    signal: AbortSignal,
  ): Promise<NodeMethodResult<'node/terminal/attach'>> => {
    const params = nodeMethods['node/terminal/attach'].params.parse(input)
    signal.throwIfAborted()
    const record = terminals.get(params.terminalId)
    if (record === undefined || record.ended) throw new NodeListenerError('notFound')
    return Promise.resolve(nodeMethods['node/terminal/attach'].result.parse({ done: true }))
  }

  // Every handler crosses the typed boundary: no raw TypeError or Error
  // from the port or a result parse escapes. Unexpected failures are
  // reported to the serve log before the typed `unavailable` refusal
  // reaches the person.
  const guard = <I, O>(work: (input: I, signal: AbortSignal) => Promise<O>) =>
    guardNodeMethod(work, (error) => {
      port.report(error)
    })

  /** The socket's authorized stream: live events from now (no replay). It
  settles on the terminal's end (delivered and audited) or the socket's
  abort. A disconnect drops its subscriber; the last one out disposes the
  PTY, so a page left behind never holds a shell open. */
  const subscribe: NodeTerminalSubscription = async (
    _session: NodeSession,
    terminalId: string,
    onEvent: (event: NodeEvent) => Promise<void>,
    signal: AbortSignal,
  ): Promise<void> => {
    const record = terminals.get(terminalId)
    if (record === undefined || record.ended) throw new NodeListenerError('notFound')
    record.subscribers.add(onEvent)
    await new Promise<void>((resolve) => {
      record.finishers.add(resolve)
      if (signal.aborted) {
        resolve()
        return
      }
      signal.addEventListener(
        'abort',
        () => {
          resolve()
        },
        { once: true },
      )
    })
    record.subscribers.delete(onEvent)
    // Ended terminals leave the registry in their end delivery, so presence
    // is liveness; a concurrent end disposes nothing twice.
    const live = terminals.get(terminalId)
    if (live?.subscribers.size === 0) {
      await port.host.closeTerminal(terminalId)
    }
  }

  return {
    open: guard(open),
    write: guard(write),
    resize: guard(resize),
    close: guard(close),
    attach: guard(attach),
    subscribe,
  } satisfies Record<
    string,
    | ((input: never, signal: AbortSignal) => Promise<NodeMethodResult<TerminalMethod>>)
    | NodeTerminalSubscription
  >
}
