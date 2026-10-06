import { readdir, readFile, readlink } from 'node:fs/promises'
import { BlockList, isIP } from 'node:net'
import { endianness, networkInterfaces } from 'node:os'
import path from 'node:path'
import * as z from 'zod/mini'
import { runProgram, windowsPowerShell, type RunProgram } from '../../host/processTree'
import {
  RUNTIME_MAKER_MAX_ITEMS,
  RUNTIME_MAKER_AGENT_MARKERS,
  WINDOWS_POWERSHELL_COMMAND_ARGS,
  RUNTIME_MAKER_IPV4_BYTES,
  RUNTIME_MAKER_IPV4_PREFIX,
  RUNTIME_MAKER_WINDOWS_SYSTEM_PID,
  RUNTIME_MAKER_SSH_CONNECTION_FIELDS,
  RUNTIME_MAKER_SSH_CLIENT_FIELDS,
  RUNTIME_MAKER_HEX_RADIX,
} from '../../shared/constants'

const processSchema = z.object({ pid: z.int(), parent: z.int(), name: z.string() })
const windowsRows = z.array(
  z.object({
    ProcessId: z.int(),
    ParentProcessId: z.int(),
    Name: z.string(),
    ExecutablePath: z.nullable(z.string()),
  }),
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
  readonly localAddresses?: () => readonly string[]
  readonly readSshPeer?: (pid: number) => Promise<string | undefined>
  readonly onMultiplexer?: () => void
}

/** Only the sshd session's established socket supplies Linux peer evidence. */
export async function readMakerSshPeer(pid: number): Promise<string | undefined> {
  const directory = `/proc/${String(pid)}`
  const sockets = new Set<string>()
  const descriptors = await readdir(`${directory}/fd`)
  for (const fd of descriptors) {
    try {
      const link = await readlink(`${directory}/fd/${fd}`)
      const inode = /^socket:\[(\d+)\]$/.exec(link)?.[1]
      if (inode !== undefined) sockets.add(inode)
    } catch {
      // A descriptor can close during enumeration; no descriptor is positive evidence.
    }
  }
  const peers = new Set<string>()
  for (const table of ['tcp', 'tcp6']) {
    const output = await readFile(`${directory}/net/${table}`, 'utf8')
    for (const line of output.split('\n')) {
      const fields = line.trim().split(/\s+/)
      if (fields[3] !== '01' || !sockets.has(fields[9] ?? '')) continue
      const hex = fields[2]?.split(':', 1)[0] ?? ''
      if (!/^(?:[\dA-F]{8}|[\dA-F]{32})$/i.test(hex)) continue
      const bytes = Buffer.from(hex, 'hex')
      if (endianness() === 'LE')
        for (let offset = 0; offset < bytes.length; offset += RUNTIME_MAKER_IPV4_BYTES)
          bytes.subarray(offset, offset + RUNTIME_MAKER_IPV4_BYTES).reverse()
      peers.add(
        table === 'tcp'
          ? [...bytes].join('.')
          : Array.from({ length: bytes.length / 2 }, (_, index) =>
              bytes.readUInt16BE(index * 2).toString(RUNTIME_MAKER_HEX_RADIX),
            ).join(':'),
      )
    }
  }
  return peers.size === 1 ? [...peers][0] : undefined
}

function isRemoteSshClient(deps: AttendanceDeps, peer: string | undefined): boolean {
  const connection = deps.env['SSH_CONNECTION']?.trim().split(/\s+/)
  const client = deps.env['SSH_CLIENT']?.trim().split(/\s+/)
  const addresses = [
    ...(connection === undefined
      ? []
      : [connection.length === RUNTIME_MAKER_SSH_CONNECTION_FIELDS ? connection[0] : undefined]),
    ...(client === undefined
      ? []
      : [client.length === RUNTIME_MAKER_SSH_CLIENT_FIELDS ? client[0] : undefined]),
    peer,
  ]
  if ((connection === undefined && client === undefined) || addresses.length === 0) return false
  const local = new BlockList()
  local.addSubnet('127.0.0.0', RUNTIME_MAKER_IPV4_PREFIX, 'ipv4')
  local.addAddress('::1', 'ipv6')
  local.addAddress('0.0.0.0', 'ipv4')
  local.addAddress('::', 'ipv6')
  const ownAddresses =
    deps.localAddresses?.() ??
    Object.values(networkInterfaces()).flatMap(
      (entries) => entries?.map((entry) => entry.address) ?? [],
    )
  for (const address of ownAddresses) {
    const family = isIP(address)
    if (family !== 0)
      local.addAddress(address, family === RUNTIME_MAKER_IPV4_BYTES ? 'ipv4' : 'ipv6')
  }
  const first = addresses[0]
  if (first === undefined || isIP(first) === 0) return false
  const same = new BlockList()
  same.addAddress(first, isIP(first) === RUNTIME_MAKER_IPV4_BYTES ? 'ipv4' : 'ipv6')
  return addresses.every((address) => {
    if (address === undefined || isIP(address) === 0) return false
    const family = isIP(address) === RUNTIME_MAKER_IPV4_BYTES ? 'ipv4' : 'ipv6'
    return !local.check(address, family) && same.check(address, family)
  })
}

function isWindowsExecutable(name: string, executable: string | null, root: string): boolean {
  const base = root.replaceAll('\\', '/').toLowerCase()
  if (executable === null || !/^[a-z]:\/windows$/.test(base)) return false
  const file = executable.replaceAll('\\', '/').toLowerCase()
  const word = name.toLowerCase()
  if (word === 'explorer.exe') return file === `${base}/${word}`
  if (word === 'powershell.exe') return file === `${base}/system32/windowspowershell/v1.0/${word}`
  if (word === 'pwsh.exe') return file === `${base.slice(0, 2)}/program files/powershell/7/${word}`
  const windowsApps = `${base.slice(0, 2)}/program files/windowsapps/`
  return word === 'windowsterminal.exe' || word === 'openconsole.exe'
    ? file === `${base}/system32/${word}` ||
        (file.startsWith(windowsApps) &&
          file.endsWith(`/${word}`) &&
          /^microsoft\.windowsterminal(?:preview)?_[\w.]+__8wekyb3d8bbwe\/(?:windowsterminal|openconsole)\.exe$/.test(
            file.slice(windowsApps.length),
          ))
    : /^(?:cmd|conhost|wininit|winlogon|services|svchost)\.exe$/.test(word) &&
        file === `${base}/system32/${word}`
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
    let rows: (z.infer<typeof processSchema> & { executable?: string | null })[]
    if (deps.platform === 'win32') {
      const root = deps.env['SystemRoot']
      if (root === undefined) return false
      const shell = windowsPowerShell(root)
      const raw: unknown = JSON.parse(
        await run(
          shell.file,
          [
            ...WINDOWS_POWERSHELL_COMMAND_ARGS,
            'Get-CimInstance Win32_Process | Select-Object ProcessId, ParentProcessId, Name, ExecutablePath | ConvertTo-Json -Compress',
          ],
          shell.env,
        ),
      )
      rows = windowsRows.parse(raw).map((row) => ({
        pid: row.ProcessId,
        parent: row.ParentProcessId,
        name: row.Name,
        executable: row.ExecutablePath,
      }))
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
    let isMultiplexed = (deps.env['TMUX'] ?? '') !== '' || (deps.env['STY'] ?? '') !== ''
    let hasCheckedSsh = false
    while (pid !== 0 && seen.size < RUNTIME_MAKER_MAX_ITEMS) {
      if (seen.has(pid)) return false
      seen.add(pid)
      const row = rows.find((entry) => entry.pid === pid)
      if (row === undefined || !terminals.test(row.name)) return false
      if (
        deps.platform === 'win32' &&
        !(pid === RUNTIME_MAKER_WINDOWS_SYSTEM_PID && row.parent === 0 && row.name === 'System') &&
        !isWindowsExecutable(row.name, row.executable ?? null, deps.env['SystemRoot'] ?? '')
      )
        return false
      if (!hasCheckedSsh && row.name === 'sshd') {
        let peer: string | undefined
        if (deps.readSshPeer !== undefined) peer = await deps.readSshPeer(pid)
        else if (deps.platform === 'linux') peer = await readMakerSshPeer(pid)
        else {
          const output = await run(
            '/usr/sbin/lsof',
            ['-nP', '-a', '-p', String(pid), '-iTCP', '-sTCP:ESTABLISHED', '-Fn'],
            deps.env,
          )
          const peers = new Set(
            output.split('\n').flatMap((line) => {
              const match = /^n.+->(?:\[([\da-f:]+)\]|([\d.]+)):\d+$/i.exec(line)
              return match === null ? [] : [match[1] ?? match[2]]
            }),
          )
          peer = peers.size === 1 ? [...peers][0] : undefined
        }
        if (!isRemoteSshClient(deps, peer)) return false
        hasCheckedSsh = true
      }
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
      if (/^(?:screen|tmux(?::.*)?)$/i.test(row.name)) isMultiplexed = true
      pid = row.parent
    }
    if (pid === 0 && hasTerminalBoundary && isMultiplexed) deps.onMultiplexer?.()
    return pid === 0 && hasTerminalBoundary
  } catch {
    return false
  }
}
