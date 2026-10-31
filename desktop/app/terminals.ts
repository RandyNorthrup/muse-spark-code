// Muse Desktop (M111, D91.13) lanes WB and BP: terminal sessions for the
// bottom panel. Lane BP runs the person's real shell on a real
// pseudoterminal (node-pty, the module VS Code's terminal uses), on the
// same bridge channels WB's pipe sessions used. Credentials never reach a
// child: every *_API_KEY variable is removed from the environment first,
// as the ACP agent does (AGENTS rule 8). Agents' sessions are read-only:
// main refuses every write to one (H13).

import { randomUUID } from 'node:crypto'
import * as pty from 'node-pty'
import type { TerminalAgent, TerminalSessionInfo } from '../../src/shared/desktop/bridge'
import { hasChildProcesses } from './processTree'

export interface TerminalSession {
  readonly id: string
  readonly title: string
  readonly process: pty.IPty
  readonly agent: TerminalAgent | undefined
}

export interface TerminalEvents {
  onData(id: string, data: string): void
  onExit(id: string, code: number | null): void
}

export interface TerminalCreateOptions {
  readonly cwd: string
  readonly cols: number
  readonly rows: number
  readonly agent?: TerminalAgent
}

const CREDENTIAL_SUFFIX = '_API_KEY'

export function cleanTerminalEnvironment(source: NodeJS.ProcessEnv): Record<string, string> {
  const cleaned: Record<string, string> = {}
  for (const [name, value] of Object.entries(source)) {
    if (value === undefined || name.toUpperCase().endsWith(CREDENTIAL_SUFFIX)) continue
    cleaned[name] = value
  }
  cleaned['TERM'] = 'xterm-256color'
  return cleaned
}

function defaultShell(): { command: string; args: string[] } {
  return process.platform === 'win32'
    ? { command: process.env['ComSpec'] ?? 'cmd.exe', args: [] }
    : { command: process.env['SHELL'] ?? '/bin/bash', args: ['-i'] }
}

export class TerminalSessions {
  private readonly sessions = new Map<string, TerminalSession>()

  public constructor(private readonly events: TerminalEvents) {}

  public create(options: TerminalCreateOptions): TerminalSessionInfo {
    const { command, args } = defaultShell()
    const child = pty.spawn(command, args, {
      name: 'xterm-256color',
      cols: options.cols,
      rows: options.rows,
      cwd: options.cwd,
      env: cleanTerminalEnvironment(process.env),
    })
    const id = randomUUID()
    const title = command.split(/[\\/]/).pop() ?? command
    const session: TerminalSession = { id, title, process: child, agent: options.agent }
    this.sessions.set(id, session)
    child.onData((data: string) => {
      if (this.sessions.has(id)) this.events.onData(id, data)
    })
    child.onExit(({ exitCode }) => {
      if (!this.sessions.has(id)) return
      this.sessions.delete(id)
      this.events.onExit(id, exitCode)
    })
    return options.agent === undefined ? { id, title } : { id, title, agent: options.agent }
  }

  public write(id: string, data: string): void {
    const session = this.sessions.get(id)
    // Unknown ids are exit races, not errors. A read-only agent session
    // never receives input, from anyone (H13): the surface never sends,
    // and main refuses what reaches it anyway.
    if (session === undefined || session.agent !== undefined) return
    session.process.write(data)
  }

  public resize(id: string, cols: number, rows: number): void {
    const session = this.sessions.get(id)
    if (session === undefined) return
    try {
      session.process.resize(cols, rows)
    } catch (error: unknown) {
      // The PTY died between the lookup and the resize (probed on
      // Linux/macOS: node-pty throws 'ioctl(2) failed, EBADF'); its exit
      // event already told the renderer. Anything else is rethrown.
      if (error instanceof Error && error.message.includes('EBADF')) return
      throw error
    }
  }

  public hasChildren(id: string): boolean {
    const session = this.sessions.get(id)
    return session !== undefined && hasChildProcesses(session.process.pid)
  }

  public list(): TerminalSessionInfo[] {
    return Array.from(this.sessions.values(), (session) =>
      session.agent === undefined
        ? { id: session.id, title: session.title }
        : { id: session.id, title: session.title, agent: session.agent },
    )
  }

  public close(id: string): void {
    const session = this.sessions.get(id)
    if (session === undefined) return
    this.sessions.delete(id)
    session.process.kill()
  }

  public closeAll(): void {
    for (const session of this.sessions.values()) session.process.kill()
    this.sessions.clear()
  }
}
