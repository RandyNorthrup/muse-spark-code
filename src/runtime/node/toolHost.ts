// This runs in the tools process, never the service process. C supplies the
// socket's kernel peer check and node-pty adapter (M110-N-tools / A0-PTY).
import { spawn } from 'node:child_process'
import { realpath } from 'node:fs/promises'
import path from 'node:path'
import { randomUUID } from 'node:crypto'
import {
  NODE_FORCE_KILL_MS,
  NODE_TERMINAL_INPUT_BYTES,
  NODE_TERMINAL_OUTPUT_BYTES,
  NODE_TOOLS_PATH,
  NODE_TOOLS_USER,
  UI_TEXT,
} from '../../shared/constants'
import {
  nodeRelativePathSchema,
  nodeTerminalHostEventSchema,
  nodeTerminalSizeSchema,
  nodeToolRequestSchema,
  nodeToolResultSchema,
  type NodeTerminalHostEvent,
  type NodeToolHostPort,
  type NodeToolRequest,
} from '../../shared/node'

export interface NodePty {
  /** A paused, bounded source: adapter pauses PTY reads until next() is requested. */
  readonly output: AsyncIterable<string>
  readonly exited: Promise<number | null>
  write(data: string): Promise<void>
  resize(cols: number, rows: number): Promise<void>
  /** Resolves only when PTY and all descendants are disposed. */
  close(): Promise<void>
}
export interface NodePtyFactory {
  open(options: {
    cwd: string
    shell: string
    env: NodeJS.ProcessEnv
    cols: number
    rows: number
    signal: AbortSignal
  }): Promise<NodePty>
}
export interface NodeToolHostOptions {
  readonly toolsUid: number
  readonly serviceUid: number
  readonly currentUid: () => number
  readonly workspaceRoot: string
  readonly workspaces: ReadonlyMap<string, { path: string; trusted: boolean }>
  readonly toolsHome: string
  readonly shell: string
  readonly pty: NodePtyFactory
  /** PTY and terminal failures the caller never sees, fixed text at the edge. */
  readonly report: (error: unknown) => void
}
type TerminalSink = (event: NodeTerminalHostEvent) => Promise<void>
interface TerminalDimensions {
  cols: number
  rows: number
}

interface Terminal {
  readonly pty: NodePty
  readonly controller: AbortController
  readonly done: Promise<void>
  reason: 'exit' | 'closed' | 'stopped' | 'locked' | 'lost'
}

/** process.kill throws ESRCH for an already reaped child; anything else surfaces. */
function isProcessGone(error: unknown): boolean {
  return typeof error === 'object' && error !== null && 'code' in error && error.code === 'ESRCH'
}

// Open races the caller already handles: stop aborts the opening, unknown or
// untrusted workspaces are refused. Forbidden paths and sizes are validated
// upstream, so they report as service bugs with adapter and disk failures.
function isRoutineOpenFailure(error: unknown): boolean {
  return (
    (error instanceof Error && error.name === 'AbortError') ||
    (error instanceof Error &&
      [
        UI_TEXT.nodeErrors.cancelled,
        UI_TEXT.nodeErrors.noSuchWorkspace,
        UI_TEXT.nodeErrors.untrusted,
      ].includes(error.message))
  )
}

/** Constructed only after the process has dropped to C's separately assigned tools UID. */
export class NodeProcessToolHost implements NodeToolHostPort {
  private readonly terminals = new Map<string, Terminal>()
  private readonly runs = new Set<AbortController>()
  private readonly runDisposals = new Set<Promise<void>>()
  private readonly openings = new Map<AbortController, Promise<void>>()
  private stopped = false

  constructor(private readonly options: NodeToolHostOptions) {
    if (
      options.toolsUid <= 0 ||
      options.toolsUid === options.serviceUid ||
      options.currentUid() !== options.toolsUid
    ) {
      throw new Error(UI_TEXT.nodeErrors.forbidden)
    }
    if (!path.isAbsolute(options.shell) || !path.isAbsolute(options.toolsHome))
      throw new Error(UI_TEXT.nodeErrors.invalidRequest)
  }

  private environment(): NodeJS.ProcessEnv {
    // Do not spread process.env: credentials, agent sockets, GIT_*, loaders,
    // proxies and shell startup variables must never reach a repository child.
    return {
      PATH: NODE_TOOLS_PATH,
      HOME: this.options.toolsHome,
      LANG: 'C.UTF-8',
      TERM: 'xterm-256color',
    }
  }

  private async cwd(workspaceId: string, relative: string | null): Promise<string> {
    if (this.stopped) throw new Error(UI_TEXT.nodeErrors.cancelled)
    const workspace = this.options.workspaces.get(workspaceId)
    if (workspace === undefined) throw new Error(UI_TEXT.nodeErrors.noSuchWorkspace)
    if (!workspace.trusted) throw new Error(UI_TEXT.nodeErrors.untrusted)
    nodeRelativePathSchema.parse(workspace.path)
    if (relative !== null) nodeRelativePathSchema.parse(relative)
    const root = await realpath(this.options.workspaceRoot)
    const workspaceFolder = await realpath(path.join(root, workspace.path))
    const folder = await realpath(path.join(workspaceFolder, relative ?? ''))
    const normalizedRoot = root.replaceAll('\\', '/')
    const normalized = folder.replaceAll('\\', '/')
    if (!normalized.startsWith(`${normalizedRoot}/`)) throw new Error(UI_TEXT.nodeErrors.forbidden)
    const normalizedWorkspace = workspaceFolder.replaceAll('\\', '/')
    if (normalized !== normalizedWorkspace && !normalized.startsWith(`${normalizedWorkspace}/`))
      throw new Error(UI_TEXT.nodeErrors.forbidden)
    return folder
  }

  private async consume(id: string, terminal: Terminal, onEvent: TerminalSink): Promise<void> {
    try {
      for await (const data of terminal.pty.output) {
        if (Buffer.byteLength(data) > NODE_TERMINAL_OUTPUT_BYTES)
          throw new Error(UI_TEXT.nodeErrors.tooLarge)
        await onEvent(
          nodeTerminalHostEventSchema.parse({ type: 'terminalOutput', terminalId: id, data }),
        )
      }
      const exitCode = await terminal.pty.exited
      await onEvent(
        nodeTerminalHostEventSchema.parse({
          type: 'terminalEnded',
          terminalId: id,
          exitCode,
          reason: terminal.reason,
        }),
      )
    } finally {
      try {
        await terminal.pty.close()
      } finally {
        this.terminals.delete(id)
      }
    }
  }

  private async openTerminalNow(
    workspaceId: string,
    size: TerminalDimensions,
    onEvent: TerminalSink,
    signal: AbortSignal,
  ): Promise<{ id: string; user: typeof NODE_TOOLS_USER }> {
    signal.throwIfAborted()
    nodeTerminalSizeSchema.parse(size)
    const cwd = await this.cwd(workspaceId, null)
    if (this.stopped) throw new Error(UI_TEXT.nodeErrors.cancelled)
    const controller = new AbortController()
    const abort = () => {
      controller.abort()
    }
    signal.addEventListener('abort', abort, { once: true })
    let pty: NodePty
    try {
      signal.throwIfAborted()
      pty = await this.options.pty.open({
        cwd,
        shell: this.options.shell,
        env: this.environment(),
        ...size,
        signal: controller.signal,
      })
    } catch (error: unknown) {
      signal.removeEventListener('abort', abort)
      throw error
    }
    if (controller.signal.aborted || signal.aborted) {
      signal.removeEventListener('abort', abort)
      await pty.close()
      throw new Error(UI_TEXT.nodeErrors.cancelled)
    }
    const id = randomUUID()
    const started: { resolve?: () => void } = {}
    const gate = new Promise<void>((resolve) => {
      started.resolve = resolve
    })
    const deliver = async (): Promise<void> => {
      await gate
      try {
        await this.consume(id, terminal, onEvent)
      } finally {
        signal.removeEventListener('abort', abort)
        controller.signal.removeEventListener('abort', dispose)
      }
    }
    const dispose = (): void => {
      terminal.reason = 'lost'
      void (async () => {
        try {
          await pty.close()
        } catch (error: unknown) {
          // PTY teardown must not fail the process; consume still reports through done.
          this.options.report(error)
        }
      })()
    }
    const terminal: Terminal = { pty, controller, reason: 'exit', done: deliver() }
    controller.signal.addEventListener('abort', dispose, { once: true })
    this.terminals.set(id, terminal)
    started.resolve?.()
    // Observe spontaneous failures even when nobody calls close after exit.
    // The event sink absorbs a gone peer, so residual done failures are terminal faults.
    void (async () => {
      try {
        await terminal.done
      } catch (error: unknown) {
        // Completion failures must not fail the observer; closeTerminal still awaits done.
        this.options.report(error)
      }
    })()
    return { id, user: NODE_TOOLS_USER }
  }

  async run(input: NodeToolRequest, signal: AbortSignal) {
    if (process.platform === 'win32') throw new Error(UI_TEXT.nodeErrors.unsupported)
    const request = nodeToolRequestSchema.parse(input)
    signal.throwIfAborted()
    const cwd = await this.cwd(request.workspaceId, request.cwd)
    signal.throwIfAborted()
    if (this.stopped) throw new Error(UI_TEXT.nodeErrors.cancelled)
    const controller = new AbortController()
    this.runs.add(controller)
    const finished: { resolve?: () => void } = {}
    const disposal = new Promise<void>((resolve) => {
      finished.resolve = resolve
    })
    this.runDisposals.add(disposal)
    const abort = () => {
      controller.abort()
    }
    signal.addEventListener('abort', abort, { once: true })
    let timer: ReturnType<typeof setTimeout> | undefined
    try {
      return await new Promise<ReturnType<typeof nodeToolResultSchema.parse>>((resolve, reject) => {
        const child = spawn(request.argv[0] ?? '', request.argv.slice(1), {
          cwd,
          env: this.environment(),
          detached: true,
          stdio: ['ignore', 'pipe', 'pipe'],
        })
        const stdout: Buffer[] = []
        const stderr: Buffer[] = []
        let total = 0
        let failure: Error | undefined
        const terminate = () => {
          if (child.pid === undefined) return
          try {
            process.kill(-child.pid, 'SIGTERM')
          } catch (error: unknown) {
            if (!isProcessGone(error)) throw error
            /* Already exited. */
          }
          timer ??= setTimeout(() => {
            if (child.pid === undefined) return
            try {
              process.kill(-child.pid, 'SIGKILL')
            } catch (error: unknown) {
              if (!isProcessGone(error)) throw error
              /* Already disposed. */
            }
          }, NODE_FORCE_KILL_MS)
        }
        const cancel = () => {
          failure = new Error(UI_TEXT.nodeErrors.cancelled)
          terminate()
        }
        controller.signal.addEventListener('abort', cancel, { once: true })
        const data = (buffers: Buffer[], chunk: Buffer) => {
          total += chunk.byteLength
          if (total > NODE_TERMINAL_OUTPUT_BYTES) {
            failure = new Error(UI_TEXT.nodeErrors.tooLarge)
            terminate()
          } else buffers.push(chunk)
        }
        child.stdout.on('data', (chunk: Buffer) => {
          data(stdout, chunk)
        })
        child.stderr.on('data', (chunk: Buffer) => {
          data(stderr, chunk)
        })
        child.once('error', () => {
          failure = new Error(UI_TEXT.nodeErrors.unavailable)
        })
        child.once('close', (exitCode) => {
          controller.signal.removeEventListener('abort', cancel)
          if (failure !== undefined || exitCode === null) {
            reject(failure ?? new Error(UI_TEXT.nodeErrors.cancelled))
            return
          }
          try {
            resolve(
              nodeToolResultSchema.parse({
                id: request.id,
                user: NODE_TOOLS_USER,
                exitCode,
                stdout: Buffer.concat(stdout).toString('utf8'),
                stderr: Buffer.concat(stderr).toString('utf8'),
              }),
            )
          } catch (error: unknown) {
            // Only the result shape throws here; anything else surfaces.
            if (error instanceof Error && error.name === 'ZodError') {
              reject(new Error(UI_TEXT.nodeErrors.invalidRequest))
            } else {
              throw error
            }
          }
        })
        if (controller.signal.aborted || signal.aborted) cancel()
      })
    } finally {
      clearTimeout(timer)
      signal.removeEventListener('abort', abort)
      this.runs.delete(controller)
      this.runDisposals.delete(disposal)
      finished.resolve?.()
    }
  }

  async openTerminal(
    workspaceId: string,
    size: TerminalDimensions,
    onEvent: TerminalSink,
    signal: AbortSignal,
  ): Promise<{ id: string; user: typeof NODE_TOOLS_USER }> {
    const opening = new AbortController()
    const operation = this.openTerminalNow(
      workspaceId,
      size,
      onEvent,
      AbortSignal.any([signal, opening.signal]),
    )
    const settled = (async () => {
      try {
        await operation
      } catch (error: unknown) {
        // The caller receives opening errors through the operation; the journal
        // must not reject, and unexpected open failures are reported.
        if (!isRoutineOpenFailure(error)) this.options.report(error)
      }
    })()
    this.openings.set(opening, settled)
    try {
      return await operation
    } finally {
      this.openings.delete(opening)
    }
  }

  async writeTerminal(id: string, data: string): Promise<void> {
    const terminal = this.terminals.get(id)
    if (terminal === undefined) throw new Error(UI_TEXT.nodeErrors.notFound)
    if (Buffer.byteLength(data) > NODE_TERMINAL_INPUT_BYTES)
      throw new Error(UI_TEXT.nodeErrors.tooLarge)
    await terminal.pty.write(data)
  }

  async resizeTerminal(id: string, size: TerminalDimensions): Promise<void> {
    nodeTerminalSizeSchema.parse(size)
    const terminal = this.terminals.get(id)
    if (terminal === undefined) throw new Error(UI_TEXT.nodeErrors.notFound)
    await terminal.pty.resize(size.cols, size.rows)
  }

  async closeTerminal(id: string): Promise<void> {
    const terminal = this.terminals.get(id)
    if (terminal === undefined) return
    terminal.reason = 'closed'
    await terminal.pty.close()
    await terminal.done
  }

  async stopAll(reason: 'stopped' | 'locked'): Promise<void> {
    this.stopped = true
    for (const controller of this.openings.keys()) controller.abort()
    for (const controller of this.runs) controller.abort()
    await Promise.all(this.openings.values())
    await Promise.all(this.runDisposals)
    const results = await Promise.allSettled(
      Array.from(this.terminals.values(), async (terminal) => {
        terminal.reason = reason
        await terminal.pty.close()
        await terminal.done
      }),
    )
    if (results.some((result) => result.status === 'rejected'))
      throw new Error(UI_TEXT.nodeErrors.unavailable)
  }
}
