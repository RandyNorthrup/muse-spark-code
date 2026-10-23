// Shared two-process rig for the device drills: N real node processes own
// N temp dirs, exchange files, then talk pinned TLS over loopback. One
// copy of the spawn/wait/bundle lines for the duplication gate; no test
// runner import, so the drivers bundle this too.
import { spawn, type ChildProcess } from 'node:child_process'
import { mkdtempSync, mkdirSync } from 'node:fs'
import { createServer } from 'node:net'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { build } from 'esbuild'
export const RIG_SIGNAL_BUDGET_MS = 30_000
// Two child processes plus two TLS handshakes over loopback.
export const RIG_DRILL_TIMEOUT_MS = 60_000

export async function rigFreePort(): Promise<number> {
  const server = createServer()
  await new Promise<void>((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      resolve()
    })
  })
  const address = server.address()
  const port = typeof address === 'object' && address !== null ? address.port : 0
  await new Promise<void>((resolve, reject) => {
    server.close((error) => {
      if (error) reject(error)
      else resolve()
    })
  })
  return port
}

export function rigWaitForLine(child: ChildProcess, match: string): Promise<void> {
  return new Promise((resolve, reject) => {
    let pending = ''
    const timer = setTimeout(() => {
      reject(new Error(`signal not seen: ${match}`))
    }, RIG_SIGNAL_BUDGET_MS)
    timer.unref()
    const onData = (chunk: Buffer): void => {
      pending += chunk.toString('utf8')
      const lines = pending.split('\n')
      pending = lines.pop() ?? ''
      const hasMatch = lines.some((line) => line.trim() === match)
      if (!hasMatch) return
      clearTimeout(timer)
      child.stdout?.removeListener('data', onData)
      resolve()
    }
    child.stdout?.on('data', onData)
    child.on('error', reject)
    child.on('exit', (code) => {
      clearTimeout(timer)
      reject(new Error(`child exited ${String(code)} before ${match}`))
    })
  })
}

export function rigWaitForExit(child: ChildProcess): Promise<number | null> {
  return new Promise((resolve, reject) => {
    child.on('error', reject)
    child.on('exit', (code) => {
      resolve(code)
    })
  })
}

export function rigSpawnSide(
  driverJs: string,
  options: {
    dir: string
    role: 'listen' | 'dial'
    port: number
    own: string
    peer: string
    ready?: string
    extra?: string[]
  },
): ChildProcess {
  const args = [
    driverJs,
    '--dir',
    options.dir,
    '--role',
    options.role,
    '--port',
    String(options.port),
    '--own',
    options.own,
    '--peer',
    options.peer,
    ...(options.extra ?? []),
  ]
  if (options.ready !== undefined) args.push('--ready', options.ready)
  return spawn(process.execPath, args, { stdio: ['ignore', 'pipe', 'inherit'] })
}

export async function rigBundleDriver(driverTs: string, outfile: string): Promise<void> {
  await build({
    entryPoints: [driverTs],
    bundle: true,
    platform: 'node',
    format: 'esm',
    outfile,
    logLevel: 'silent',
  })
}

export interface RigPair {
  readonly listener: ChildProcess
  readonly dialer: ChildProcess
  readonly dirA: string
  readonly dirB: string
}

/**
Bundles the driver, makes the run dirs and starts both sides. The caller
owns the scratch dirs; the exits stay for rigFinishPair.
*/
export async function rigStartPair(
  driverTs: string,
  tag: string,
  scratch: string[],
  extra?: string[],
): Promise<RigPair> {
  const outdir = mkdtempSync(path.join(tmpdir(), `${tag}-driver-`))
  scratch.push(outdir)
  const driverJs = path.join(outdir, 'driver.mjs')
  await rigBundleDriver(driverTs, driverJs)
  const root = mkdtempSync(path.join(tmpdir(), `${tag}-run-`))
  scratch.push(root)
  const dirA = path.join(root, 'a')
  const dirB = path.join(root, 'b')
  mkdirSync(dirA)
  mkdirSync(dirB)
  const port = await rigFreePort()
  const listener = rigSpawnSide(driverJs, {
    dir: dirA,
    role: 'listen',
    port,
    own: path.join(dirA, 'invitation.json'),
    peer: path.join(dirB, 'invitation.json'),
    ...(extra !== undefined && { extra }),
  })
  const dialer = rigSpawnSide(driverJs, {
    dir: dirB,
    role: 'dial',
    port,
    own: path.join(dirB, 'invitation.json'),
    peer: path.join(dirA, 'invitation.json'),
    ready: path.join(dirA, 'ready'),
    ...(extra !== undefined && { extra }),
  })
  return { listener, dialer, dirA, dirB }
}

/**
Runs the drill's signal waits, then asserts both sides exited cleanly.
Exit listeners attach before the first wait: a side can exit between its
last signal and the parent's next await, and a late listener misses it.
*/
export async function rigFinishPair(
  pair: RigPair,
  signals: () => Promise<void>,
): Promise<{ listenerCode: number | null; dialerCode: number | null }> {
  const listenerExit = rigWaitForExit(pair.listener)
  const dialerExit = rigWaitForExit(pair.dialer)
  try {
    await signals()
    const [listenerCode, dialerCode] = await Promise.all([listenerExit, dialerExit])
    return { listenerCode, dialerCode }
  } finally {
    pair.dialer.kill()
    pair.listener.kill()
  }
}
