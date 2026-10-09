// Live supervision needs a private control socket and the platform process
// table (/bin/ps on Darwin). Sandboxes that forbid unix-domain listen or
// process listing fail every supervised fixture with a timeout; fail fast
// with the named block instead. Outside such a sandbox the probes pass and
// every gated test runs its full lifecycle.
import { execFile, spawnSync, type ChildProcess } from 'node:child_process'
import { readdirSync, readFileSync } from 'node:fs'
import { createServer } from 'node:net'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { promisify } from 'node:util'
import { killTree } from '../../../src/host/processTree'

// Root-selection tests temporarily replace process.platform; cleanup uses the host.
const hostPlatform = process.platform

const state: { verdict?: { ok: true } | { ok: false; reason: string } } = {}

async function probeSocket(): Promise<string | undefined> {
  const folder = await mkdtemp(path.join(tmpdir(), 'muse-live-probe-'))
  const socket = path.join(folder, 'probe')
  try {
    await new Promise<void>((resolve, reject) => {
      const server = createServer()
      server.once('error', reject)
      server.listen(socket, () => {
        server.close(() => {
          resolve()
        })
      })
    })
    return undefined
  } catch (error: unknown) {
    return error instanceof Error ? error.message : String(error)
  } finally {
    await rm(folder, { recursive: true, force: true })
  }
}

function probeTable(): string | undefined {
  // Mirror what the M107 readers scan: /bin/ps on Darwin, /proc on Linux.
  if (process.platform === 'linux') {
    try {
      readdirSync('/proc')
      readFileSync('/proc/self/stat', 'utf8')
      return undefined
    } catch (error: unknown) {
      return error instanceof Error ? error.message : String(error)
    }
  }
  try {
    const probed = spawnSync('/bin/ps', ['-o', 'pid=', '-p', String(process.pid)], {
      encoding: 'utf8',
    })
    if (probed.error !== undefined) throw probed.error
    if (probed.status !== 0) throw new Error(`ps exited ${String(probed.status)}`)
    return undefined
  } catch (error: unknown) {
    return error instanceof Error ? error.message : String(error)
  }
}

async function fixtureProcessTable() {
  const result = await promisify(execFile)('/bin/ps', ['-axo', 'pid=,ppid=,lstart='], {
    env: { LC_ALL: 'C' },
  })
  return result.stdout
    .trim()
    .split('\n')
    .map((line) => {
      const match = /^\s*(\d+)\s+(\d+)\s+(.+)$/.exec(line)
      if (match === null) throw new Error('invalid fixture process row')
      return { pid: Number(match[1]), parent: Number(match[2]), birth: match[3] ?? '' }
    })
}

/** Every fixture process a suite starts. A failed assertion or a timeout still
 * reaps the whole tree instead of leaking supervised pairs that burn CPU. */
export function trackFixtureTree() {
  const live = new Set<ChildProcess>()
  const known = new Map<number, string>()
  let timer: ReturnType<typeof setInterval> | undefined
  let sampling: Promise<{ pid: number; parent: number; birth: string }[]> | undefined
  const read = async () => {
    if (hostPlatform === 'win32') return []
    const rows = await fixtureProcessTable()
    for (const child of live) {
      if (child.exitCode !== null || child.signalCode !== null) continue
      const row = rows.find((entry) => entry.pid === child.pid)
      if (row !== undefined && !known.has(row.pid)) known.set(row.pid, row.birth)
    }
    let hasGrown = true
    while (hasGrown) {
      hasGrown = false
      for (const row of rows) {
        if (known.has(row.pid)) continue
        const parent = rows.find((entry) => entry.pid === row.parent)
        if (parent === undefined || known.get(parent.pid) !== parent.birth) continue
        known.set(row.pid, row.birth)
        hasGrown = true
      }
    }
    return rows.filter((row) => known.get(row.pid) === row.birth)
  }
  const sample = async () => {
    const pending = (sampling ??= read())
    try {
      return await pending
    } finally {
      if (sampling === pending) sampling = undefined
    }
  }
  let samplingError: Error | undefined
  const track = (child: ChildProcess): ChildProcess => {
    live.add(child)
    // Keep observed ancestry after parent exit, including setsid descendants.
    timer ??= setInterval(() => {
      void sample().catch((error: unknown) => {
        samplingError =
          error instanceof Error ? error : new Error('fixture table failed', { cause: error })
      })
    }, 100)
    timer.unref()
    return child
  }
  const reap = async (): Promise<void> => {
    clearInterval(timer)
    timer = undefined
    const rows = await sample()
    for (const row of rows.toReversed()) {
      try {
        process.kill(row.pid, 'SIGKILL')
      } catch {
        /* The next table confirms departure. */
      }
    }
    for (const child of live) {
      if (hostPlatform === 'win32')
        await killTree(
          child,
          {
            platform: hostPlatform,
            systemRoot: process.env['SystemRoot'],
            log: () => {
              /* The survivor assertion reports failed fixture cleanup. */
            },
          },
          0,
        )
      else child.kill('SIGKILL')
    }
    const deadline = Date.now() + 4000
    let survivors = rows.map((row) => row.pid)
    while (Date.now() < deadline) {
      const current = await sample()
      survivors = current.map((row) => row.pid)
      if (
        survivors.length === 0 &&
        [...live].every(
          (child) =>
            child.exitCode !== null || child.signalCode !== null || child.pid === undefined,
        )
      )
        break
      await new Promise<void>((resolve) => {
        setTimeout(resolve, 25)
      })
    }
    for (const child of live) {
      if (child.pid === undefined) continue
      try {
        process.kill(child.pid, 0)
        survivors.push(child.pid)
      } catch {
        /* Direct child has also been reaped. */
      }
    }
    live.clear()
    known.clear()
    if (samplingError !== undefined) {
      const error = samplingError
      samplingError = undefined
      throw error
    }
    if (survivors.length > 0) throw new Error(`leaked fixture processes: ${survivors.join(', ')}`)
  }
  return { track, reap }
}

/** Throw a named failure when the platform process table cannot be read here. */
export function requireProcessTable(): void {
  const blocked = probeTable()
  if (blocked !== undefined)
    throw new Error(`process table unavailable on this machine: ${blocked}`)
}

/** Throw a named, actionable failure when live supervision cannot run here. */
export async function requireLiveSupervision(): Promise<void> {
  if (state.verdict === undefined) {
    const socket = await probeSocket()
    if (socket === undefined) {
      const table = probeTable()
      state.verdict =
        table === undefined ? { ok: true } : { ok: false, reason: `process table: ${table}` }
    } else {
      state.verdict = { ok: false, reason: `control socket: ${socket}` }
    }
  }
  const verdict = state.verdict
  if (verdict.ok) return
  throw new Error(`live supervision unavailable on this machine: ${verdict.reason}`)
}
