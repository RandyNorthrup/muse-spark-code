// Live supervision needs a private control socket and the platform process
// table (/bin/ps on Darwin). Sandboxes that forbid unix-domain listen or
// process listing fail every supervised fixture with a timeout; fail fast
// with the named block instead. Outside such a sandbox the probes pass and
// every gated test runs its full lifecycle.
import { spawnSync, type ChildProcess } from 'node:child_process'
import { readdirSync, readFileSync } from 'node:fs'
import { createServer } from 'node:net'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'

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

/** Every fixture process a suite starts. A failed assertion or a timeout still
 * reaps the whole tree instead of leaking supervised pairs that burn CPU. */
export function trackFixtureTree() {
  const live = new Set<ChildProcess>()
  const track = (child: ChildProcess): ChildProcess => {
    live.add(child)
    child.once('exit', () => {
      live.delete(child)
    })
    return child
  }
  const reap = async (): Promise<void> => {
    for (const child of live) {
      try {
        child.kill('SIGKILL')
      } catch {
        /* Already gone; the sweep below confirms it. */
      }
    }
    const deadline = Date.now() + 4000
    while (live.size > 0 && Date.now() < deadline)
      await new Promise<void>((resolve) => {
        setTimeout(resolve, 25)
      })
    const survivors: number[] = []
    for (const child of live) {
      if (child.pid === undefined) continue
      try {
        process.kill(child.pid, 0)
        survivors.push(child.pid)
      } catch {
        live.delete(child)
      }
    }
    live.clear()
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
