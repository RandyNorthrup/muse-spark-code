import { nodeIdentifierSchema } from '../../../../src/shared/nodeAuth'
import {
  nodeTerminalClientFrameSchema,
  nodeTerminalSizeSchema,
  nodeTerminalHostEventSchema,
  nodeToolRequestSchema,
  nodeToolResultSchema,
  type NodeToolHostPort,
  type NodeToolRequest,
  type NodeTerminalHostEvent,
} from '../../../../src/shared/node'
import { NODE_TERMINAL_OUTPUT_BYTES, NODE_TOOLS_USER } from '../../../../src/shared/constants'

interface TerminalObserver {
  onEvent: (event: NodeTerminalHostEvent) => Promise<void>
  signal: AbortSignal
  abort: () => void
  delivery: Promise<void>
  pendingBytes: number
  ending: boolean
}

/** Scripted test tool host; no process, real credential or OS isolation claim. */
export class FakeNodeToolHost implements NodeToolHostPort {
  private nextTerminal = 0
  private readonly observers = new Map<string, TerminalObserver>()
  readonly requests: NodeToolRequest[] = []
  readonly terminals = new Map<
    string,
    { workspaceId: string; cols: number; rows: number; input: string[] }
  >()
  constructor(
    private readonly workspaces: ReadonlySet<string>,
    private readonly replies: { exitCode: number; stdout: string; stderr: string }[] = [],
  ) {}
  private requireWorkspace(id: string): void {
    nodeIdentifierSchema.parse(id)
    if (!this.workspaces.has(id)) throw new Error('unknown workspace')
  }
  private requireTerminal(id: string): {
    workspaceId: string
    cols: number
    rows: number
    input: string[]
  } {
    const terminal = this.terminals.get(id)
    if (terminal === undefined || this.observers.get(id)?.ending)
      throw new Error('unknown terminal')
    return terminal
  }
  private disposeTerminal(id: string): void {
    const observer = this.observers.get(id)
    observer?.signal.removeEventListener('abort', observer.abort)
    this.observers.delete(id)
    this.terminals.delete(id)
  }
  private deliver(id: string, event: NodeTerminalHostEvent): Promise<void> {
    const parsed = nodeTerminalHostEventSchema.parse(event)
    const observer = this.observers.get(id)
    if (observer === undefined) throw new Error('unknown terminal')
    const bytes =
      parsed.type === 'terminalOutput' ? new TextEncoder().encode(parsed.data).byteLength : 0
    if (observer.pendingBytes + bytes > NODE_TERMINAL_OUTPUT_BYTES)
      throw new Error('script must wait for terminal backpressure')
    observer.pendingBytes += bytes
    const previous = observer.delivery
    observer.delivery = (async () => {
      try {
        await previous
        await observer.onEvent(parsed)
      } catch (error: unknown) {
        this.disposeTerminal(id)
        throw error
      } finally {
        observer.pendingBytes -= bytes
        if (parsed.type === 'terminalEnded') this.disposeTerminal(id)
      }
    })()
    return observer.delivery
  }
  run(request: NodeToolRequest, signal: AbortSignal): ReturnType<NodeToolHostPort['run']> {
    if (signal.aborted) return Promise.reject(new Error('aborted'))
    const parsed = nodeToolRequestSchema.parse(request)
    this.requireWorkspace(parsed.workspaceId)
    this.requests.push(parsed)
    const reply = this.replies.shift()
    return reply === undefined
      ? Promise.reject(new Error('no scripted tool reply'))
      : Promise.resolve(
          nodeToolResultSchema.parse({ ...reply, id: parsed.id, user: NODE_TOOLS_USER }),
        )
  }
  openTerminal(
    workspaceId: string,
    size: { cols: number; rows: number },
    onEvent: (event: NodeTerminalHostEvent) => Promise<void>,
    signal: AbortSignal,
  ): ReturnType<NodeToolHostPort['openTerminal']> {
    this.requireWorkspace(workspaceId)
    if (signal.aborted) return Promise.reject(new Error('aborted'))
    const dimensions = nodeTerminalSizeSchema.parse(size)
    const id = `terminal-${String(++this.nextTerminal)}`
    this.terminals.set(id, { workspaceId, ...dimensions, input: [] })
    const abort = (): void => {
      void (async () => {
        try {
          await this.endTerminal(id, null, 'lost')
        } catch {
          this.disposeTerminal(id)
        }
      })()
    }
    this.observers.set(id, {
      onEvent,
      signal,
      abort,
      delivery: Promise.resolve(),
      pendingBytes: 0,
      ending: false,
    })
    signal.addEventListener('abort', abort, { once: true })
    return Promise.resolve({ id, user: NODE_TOOLS_USER })
  }
  writeTerminal(id: string, data: string): Promise<void> {
    nodeTerminalClientFrameSchema.parse({ type: 'input', data })
    this.requireTerminal(id).input.push(data)
    return Promise.resolve()
  }
  resizeTerminal(id: string, size: { cols: number; rows: number }): Promise<void> {
    Object.assign(this.requireTerminal(id), nodeTerminalSizeSchema.parse(size))
    return Promise.resolve()
  }
  closeTerminal(id: string): Promise<void> {
    return this.terminals.has(id) ? this.endTerminal(id, null, 'closed') : Promise.resolve()
  }
  /** Scripted child output; scripts must wait when the bounded queue is full. */
  outputTerminal(id: string, data: string): Promise<void> {
    this.requireTerminal(id)
    return this.deliver(id, { type: 'terminalOutput', terminalId: id, data })
  }
  /** Scripted spontaneous child exit, serialized behind pending output. */
  endTerminal(
    id: string,
    exitCode: number | null,
    reason: 'exit' | 'closed' | 'stopped' | 'locked' | 'lost' = 'exit',
  ): Promise<void> {
    const observer = this.observers.get(id)
    if (observer === undefined) throw new Error('unknown terminal')
    if (observer.ending) return observer.delivery
    observer.ending = true
    observer.delivery = this.deliver(id, {
      type: 'terminalEnded',
      terminalId: id,
      exitCode,
      reason,
    })
    return observer.delivery
  }
  async stopAll(reason: 'stopped' | 'locked'): Promise<void> {
    await Promise.all(Array.from(this.terminals.keys(), (id) => this.endTerminal(id, null, reason)))
  }
}
