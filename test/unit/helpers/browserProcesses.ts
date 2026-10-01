// What a real browser check leaves running or listening (M81): every
// process whose command line names the check's profile folder (Chrome hands
// `--user-data-dir` to its helper processes too), and the TCP listeners
// those processes own. Linux reads /proc and asks `ss`, macOS asks `ps` and
// `lsof`, Windows asks Windows PowerShell.
import { execFile } from 'node:child_process'
import { readdir, readFile } from 'node:fs/promises'
import { promisify } from 'node:util'
import { windowsPowerShell } from '../../../src/host/processTree'

const run = promisify(execFile)
const DIGITS = /^\d+$/

function numbers(stdout: string): number[] {
  return stdout
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => DIGITS.test(line))
    .map(Number)
}

async function powerShell(script: string): Promise<string> {
  const shell = windowsPowerShell(process.env['SystemRoot'] ?? String.raw`C:\Windows`)
  const { stdout } = await run(shell.file, ['-NoProfile', '-NonInteractive', '-Command', script], {
    env: shell.env,
    windowsHide: true,
  })
  return stdout
}

/** The processes (other than this one) whose command line contains `text`. */
export async function processesNaming(text: string): Promise<number[]> {
  if (process.platform === 'win32') {
    const quoted = text.replaceAll("'", "''")
    return numbers(
      await powerShell(
        `Get-CimInstance Win32_Process | Where-Object { $_.ProcessId -ne $PID -and $_.CommandLine -and $_.CommandLine.Contains('${quoted}') } | ForEach-Object { $_.ProcessId }`,
      ),
    )
  }
  if (process.platform === 'darwin') {
    const { stdout } = await run('ps', ['-axww', '-o', 'pid=,command='])
    return stdout
      .split('\n')
      .filter((line) => line.includes(text))
      .map((line) => Number(line.trim().split(/\s+/, 1)[0]))
      .filter((pid) => pid !== process.pid)
  }
  const found: number[] = []
  const entries = await readdir('/proc')
  for (const entry of entries) {
    if (!DIGITS.test(entry) || Number(entry) === process.pid) {
      continue
    }
    try {
      const commandLine = await readFile(`/proc/${entry}/cmdline`, 'utf8')
      if (commandLine.includes(text)) {
        found.push(Number(entry))
      }
    } catch {
      // The process ended while the table was read.
    }
  }
  return found
}

/** The TCP listeners the processes own, as `address:port` (empty: none). */
export async function tcpListenersOf(pids: readonly number[]): Promise<string[]> {
  if (pids.length === 0) {
    return []
  }
  if (process.platform === 'win32') {
    const stdout = await powerShell(
      `$owners = @(${pids.join(',')}); Get-NetTCPConnection -State Listen -ErrorAction SilentlyContinue | Where-Object { $owners -contains $_.OwningProcess } | ForEach-Object { "$($_.LocalAddress):$($_.LocalPort)" }`,
    )
    return stdout
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter((line) => line !== '')
  }
  if (process.platform === 'darwin') {
    try {
      const { stdout } = await run('lsof', [
        '-nP',
        '-a',
        '-iTCP',
        '-sTCP:LISTEN',
        '-p',
        pids.join(','),
      ])
      return stdout
        .split('\n')
        .slice(1)
        .filter((line) => line.trim() !== '')
    } catch (error: unknown) {
      // lsof exits 1 when it lists nothing.
      if (typeof error === 'object' && error !== null && 'code' in error && error.code === 1) {
        return []
      }
      throw error
    }
  }
  const { stdout } = await run('ss', ['-ltnpH'])
  return stdout
    .split('\n')
    .filter((line) => pids.some((pid) => line.includes(`pid=${String(pid)},`)))
}
