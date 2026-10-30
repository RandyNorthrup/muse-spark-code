// Muse Desktop (M111, D91.13) lane WB: terminal sessions for the bottom
// panel. Lane BP owns the xterm.js surface; this module owns the processes
// behind the bridge's terminal channels. Credentials never reach a child:
// every *_API_KEY variable is removed from the environment first, as the
// ACP agent does (AGENTS rule 8).

import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process'
import { randomUUID } from 'node:crypto'

export interface TerminalSession {
  readonly id: string
  readonly title: string
  readonly process: ChildProcessWithoutNullStreams
}

export interface TerminalEvents {
  onData(id: string, data: string): void
  onExit(id: string, code: number | null): void
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

  public create(cwd: string): { id: string; title: string } {
    const { command, args } = defaultShell()
    const child = spawn(command, args, {
      cwd,
      env: cleanTerminalEnvironment(process.env),
      stdio: ['pipe', 'pipe', 'pipe'],
    })
    const id = randomUUID()
    const title = command.split(/[\\/]/).pop() ?? command
    const session: TerminalSession = { id, title, process: child }
    this.sessions.set(id, session)
    child.stdout.on('data', (chunk: Buffer) => {
      this.events.onData(id, chunk.toString('utf8'))
    })
    child.stderr.on('data', (chunk: Buffer) => {
      this.events.onData(id, chunk.toString('utf8'))
    })
    child.on('exit', (code) => {
      this.sessions.delete(id)
      this.events.onExit(id, code)
    })
    return { id, title }
  }

  public write(id: string, data: string): void {
    this.sessions.get(id)?.process.stdin.write(data)
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
