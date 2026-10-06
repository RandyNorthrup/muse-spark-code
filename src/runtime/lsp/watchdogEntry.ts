// Independent POSIX guardian: EOF survives an abrupt supervisor SIGKILL.
import { execFile } from 'node:child_process'
import process from 'node:process'
import * as z from 'zod/mini'
import { LSP_LIMITS, RUNTIME_STOP } from '../../shared/constants'
import { withoutCredentials } from '../credentialVariables'

const rootSchema = z.strictObject({ pid: z.int().check(z.gte(1)) })
interface ProcessIdentity {
  readonly pid: number
  readonly parent: number
  readonly group: number
  readonly born: string
}
const env = withoutCredentials(process.env)
const tracked = new Map<number, ProcessIdentity>()
const owner = Number(process.argv[2])
if (!Number.isSafeInteger(owner) || owner <= 1 || process.platform === 'win32')
  throw new Error('EWATCH_OWNER')
const state: {
  root?: number
  input: string
  isEnding: boolean
  scanning?: Promise<void>
  isFailed: boolean
} = { input: '', isEnding: false, isFailed: false }

function table(): Promise<readonly ProcessIdentity[]> {
  return new Promise((resolve, reject) => {
    // nosemgrep: javascript.lang.security.detect-child-process.detect-child-process -- fixed OS ps, PID/parent/group/birth only, no command lines or credential environment (PLAN.md §8).
    execFile(
      '/bin/ps',
      ['-axo', 'pid=,ppid=,pgid=,lstart='],
      { env, timeout: LSP_LIMITS.watchdogScanMs, maxBuffer: LSP_LIMITS.frameBytes },
      (error, stdout) => {
        if (error !== null) {
          reject(new Error('EWATCH_SCAN'))
          return
        }
        const rows: ProcessIdentity[] = []
        for (const line of stdout.split('\n')) {
          const match = /^\s*(\d+)\s+(\d+)\s+(\d+)\s+(.+)$/u.exec(line)
          if (match !== null)
            rows.push({
              pid: Number(match[1]),
              parent: Number(match[2]),
              group: Number(match[3]),
              born: match[4] ?? '',
            })
        }
        resolve(rows)
      },
    )
  })
}
async function scan(): Promise<void> {
  const rows = await table()
  let isChanged = true
  while (isChanged) {
    isChanged = false
    for (const row of rows) {
      if (row.pid === process.pid || tracked.has(row.pid)) continue
      if (!(
        row.pid === state.root ||
        row.parent === state.root ||
        tracked.has(row.parent) ||
        (state.root !== undefined && row.group === state.root)
      )) {
        continue
      }

      if (tracked.size >= LSP_LIMITS.watchdogProcesses) throw new Error('EWATCH_CAP')
      tracked.set(row.pid, row)
      isChanged = true
    }
  }
}
function kill(pid: number): void {
  try {
    process.kill(pid, 'SIGKILL')
  } catch (error: unknown) {
    if (!(error instanceof Error && 'code' in error && error.code === 'ESRCH'))
      state.isFailed = true
  }
}
async function stop(): Promise<void> {
  if (state.isEnding) return
  state.isEnding = true
  clearInterval(timer)
  try {
    await state.scanning
    await scan()
    // Verify ownership immediately before signalling a group or a recycled PID.
    const rows = await table()
    if (
      state.root !== undefined &&
      rows.some((row) => row.group === state.root && tracked.get(row.pid)?.born === row.born)
    )
      kill(-state.root)
    for (const row of rows) if (tracked.get(row.pid)?.born === row.born) kill(row.pid)
    const deadline = Date.now() + RUNTIME_STOP.exitMs
    for (;;) {
      const observed = await table()
      const alive = observed.filter((row) => tracked.get(row.pid)?.born === row.born)
      if (alive.length === 0) break
      if (Date.now() >= deadline) {
        state.isFailed = true
        break
      }
      for (const row of alive) kill(row.pid)
      await new Promise<void>((resolve) => {
        setTimeout(resolve, RUNTIME_STOP.pollMs)
      })
    }
  } catch {
    state.isFailed = true
    if (state.root !== undefined) kill(-state.root)
  }
  process.exitCode = state.isFailed ? 1 : 0
  process.stdin.destroy()
}
async function poll(): Promise<void> {
  try {
    await scan()
  } catch {
    state.isFailed = true
    void stop()
  } finally {
    delete state.scanning
  }
}
const timer = setInterval(() => {
  state.scanning ??= poll()
}, LSP_LIMITS.watchdogPollMs)
process.stdin.on('data', (bytes: Buffer) => {
  state.input += bytes.toString('utf8')
  if (state.input.length > RUNTIME_STOP.handshakeChars) {
    state.isFailed = true
    void stop()
    return
  }
  if (!state.input.endsWith('\n')) return
  try {
    state.root = rootSchema.parse(JSON.parse(state.input)).pid
    state.input = ''
  } catch {
    state.isFailed = true
    void stop()
  }
})
process.stdin.once('end', () => {
  void stop()
})
process.stdin.once('error', () => {
  void stop()
})
process.once('SIGTERM', () => {
  void stop()
})
process.stdout.write('READY\n')
