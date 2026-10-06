import { nodeIdentifierSchema } from '../../../../src/shared/nodeAuth'
import {
  nodeTerminalClientFrameSchema,
  nodeTerminalSizeSchema,
  nodeToolRequestSchema,
  nodeToolResultSchema,
  type NodeToolHostPort,
  type NodeToolRequest,
} from '../../../../src/shared/node'
import { NODE_TOOLS_USER } from '../../../../src/shared/constants'

/** Scripted test tool host; no process, real credential or OS isolation claim. */
export class FakeNodeToolHost implements NodeToolHostPort {
  private nextTerminal = 0
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
    if (terminal === undefined) throw new Error('unknown terminal')
    return terminal
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
  ): ReturnType<NodeToolHostPort['openTerminal']> {
    this.requireWorkspace(workspaceId)
    const dimensions = nodeTerminalSizeSchema.parse(size)
    const id = `terminal-${String(++this.nextTerminal)}`
    this.terminals.set(id, { workspaceId, ...dimensions, input: [] })
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
    this.requireTerminal(id)
    this.terminals.delete(id)
    return Promise.resolve()
  }
  stopAll(): Promise<void> {
    this.terminals.clear()
    return Promise.resolve()
  }
}
