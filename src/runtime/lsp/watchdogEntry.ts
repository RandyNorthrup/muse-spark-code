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
  owner?: ProcessIdentity
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
function isTracked(row: ProcessIdentity | undefined): boolean {
  return row !== undefined && tracked.get(row.pid)?.born === row.born
}
async function scan(): Promise<void> {
  const rows = await table()
  const current = new Map(rows.map((row) => [row.pid, row]))
  const root = state.root === undefined ? undefined : current.get(state.root)
  const parent = current.get(owner)
  let isChanged = true
  while (isChanged) {
    isChanged = false
    for (const row of rows) {
      if (row.pid === process.pid || tracked.has(row.pid)) continue
      const isRoot =
        row.pid === state.root &&
        row.parent === owner &&
        state.owner !== undefined &&
        parent?.born === state.owner.born
      const isGroup = row.group === root?.group && isTracked(root)
      if (!isRoot && !isGroup && !isTracked(current.get(row.parent))) continue
      if (tracked.size >= LSP_LIMITS.watchdogProcesses) throw new Error('EWATCH_CAP')
      tracked.set(row.pid, row)
      isChanged = true
    }
  }
}
async function kill(identity: ProcessIdentity, deadline: number): Promise<void> {
  if (Date.now() >= deadline) throw new Error('EWATCH_EXIT')
  // Re-read each PID's birth immediately before its signal; group signals
  // could include an untracked/recycled member and are never authority.
  const rows = await table()
  if (Date.now() >= deadline) throw new Error('EWATCH_EXIT')
  const current = rows.find((row) => row.pid === identity.pid)
  if (current?.born !== identity.born || !isTracked(current)) return
  try {
    process.kill(identity.pid, 'SIGKILL')
  } catch (error: unknown) {
    if (!(error instanceof Error && 'code' in error && error.code === 'ESRCH'))
      state.isFailed = true
  }
}
async function stop(): Promise<void> {
  if (state.isEnding) return
  state.isEnding = true
  clearInterval(timer)
  const deadline = Date.now() + RUNTIME_STOP.exitMs
  try {
    await state.scanning
    await scan()
    const rows = await table()
    for (const row of rows) if (isTracked(row)) await kill(row, deadline)
    for (;;) {
      const observed = await table()
      const alive = observed.filter((row) => isTracked(row))
      if (alive.length === 0) break
      if (Date.now() >= deadline) {
        state.isFailed = true
        break
      }
      for (const row of alive) await kill(row, deadline)
      await new Promise<void>((resolve) => {
        setTimeout(resolve, RUNTIME_STOP.pollMs)
      })
    }
  } catch {
    state.isFailed = true
    // No fresh identity table: do not signal a potentially recycled PID/group.
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
// Capture the supervisor's birth before publishing READY or accepting a root.
async function start(): Promise<void> {
  try {
    const rows = await table()
    const captured = rows.find((row) => row.pid === owner)
    if (captured === undefined) throw new Error('EWATCH_OWNER')
    state.owner = captured
    if (!state.isEnding) process.stdout.write('READY\n')
  } catch {
    state.isFailed = true
    void stop()
  }
}
void start()
