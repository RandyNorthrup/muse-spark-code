import { readlink } from 'node:fs/promises'
import path from 'node:path'
import * as z from 'zod/mini'
import { runProgram, windowsPowerShell, type RunProgram } from '../../host/processTree'
import {
  RUNTIME_MAKER_MAX_ITEMS,
  RUNTIME_MAKER_AGENT_MARKERS,
  WINDOWS_POWERSHELL_COMMAND_ARGS,
} from '../../shared/constants'

const processSchema = z.object({ pid: z.int(), parent: z.int(), name: z.string() })
const windowsRows = z.array(
  z.object({ ProcessId: z.int(), ParentProcessId: z.int(), Name: z.string() }),
)
// A known terminal/login chain is required. Generic interpreters and unknown ancestors fail closed.
const terminalBoundary =
  /^(?:login|sshd|konsole|gnome-terminal(?:-server)?|xfce4-terminal|xterm|Terminal|iTerm2|WindowsTerminal\.exe|OpenConsole\.exe|explorer\.exe)$/i
const terminals =
  /^(?:bash|zsh|fish|sh|dash|login|sshd|systemd|init|launchd|konsole|gnome-terminal(?:-server)?|xfce4-terminal|xterm|screen|tmux(?::.*)?|Terminal|iTerm2|powershell(?:\.exe)?|pwsh(?:\.exe)?|cmd\.exe|WindowsTerminal\.exe|OpenConsole\.exe|conhost\.exe|explorer\.exe|wininit\.exe|winlogon\.exe|services\.exe|svchost\.exe|System)$/i
export interface AttendanceDeps {
  readonly stdinTty: boolean
  readonly stdoutTty: boolean
  readonly parentPid: number
  readonly platform: NodeJS.Platform
  readonly env: NodeJS.ProcessEnv
  readonly run?: RunProgram
  readonly readExecutable?: (pid: number) => Promise<string>
}
/** A TTY allocated by an agent does not make its process tree a person. */
export async function isMakerTerminalAttended(deps: AttendanceDeps): Promise<boolean> {
  if (
    !deps.stdinTty ||
    !deps.stdoutTty ||
    RUNTIME_MAKER_AGENT_MARKERS.some((key) => (deps.env[key] ?? '') !== '')
  )
    return false
  try {
    const run = deps.run ?? runProgram
    let rows: z.infer<typeof processSchema>[]
    if (deps.platform === 'win32') {
      const root = deps.env['SystemRoot']
      if (root === undefined) return false
      const shell = windowsPowerShell(root)
      const raw: unknown = JSON.parse(
        await run(
          shell.file,
          [
            ...WINDOWS_POWERSHELL_COMMAND_ARGS,
            'Get-CimInstance Win32_Process | Select-Object ProcessId, ParentProcessId, Name | ConvertTo-Json -Compress',
          ],
          shell.env,
        ),
      )
      rows = windowsRows
        .parse(raw)
        .map((row) => ({ pid: row.ProcessId, parent: row.ParentProcessId, name: row.Name }))
    } else if (deps.platform === 'linux' || deps.platform === 'darwin') {
      const output = await run('/bin/ps', ['-eo', 'pid=,ppid=,comm='], deps.env)
      rows = output
        .trim()
        .split(/\r?\n/)
        .map((line) => {
          const match = /^\s*(\d+)\s+(\d+)\s+(.+)$/.exec(line)
          if (match === null) throw new Error('maker-ancestry-unknown')
          return processSchema.parse({
            pid: Number(match[1]),
            parent: Number(match[2]),
            name: match[3]?.split('/').at(-1),
          })
        })
    } else return false
    let pid = deps.parentPid
    const seen = new Set<number>()
    let hasTerminalBoundary = false
    while (pid !== 0 && seen.size < RUNTIME_MAKER_MAX_ITEMS) {
      if (seen.has(pid)) return false
      seen.add(pid)
      const row = rows.find((entry) => entry.pid === pid)
      if (row === undefined || !terminals.test(row.name)) return false
      if (pid !== 1 && deps.platform === 'linux') {
        const executable = await (
          deps.readExecutable ?? ((id) => readlink(`/proc/${String(id)}/exe`))
        )(pid)
        if (
          !/^\/(?:usr\/)?(?:bin|sbin|lib(?:64)?)(?:\/|$)/.test(executable) ||
          path.basename(executable) !== row.name.split(':', 1)[0]
        )
          return false
      }
      if (terminalBoundary.test(row.name)) hasTerminalBoundary = true
      pid = row.parent
    }
    return pid === 0 && hasTerminalBoundary
  } catch {
    return false
  }
}
