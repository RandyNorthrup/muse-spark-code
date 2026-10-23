// Shared two-process rig for the device drills: N real node processes own
// N temp dirs, exchange files, then talk pinned TLS over loopback. One
// copy of the spawn/wait/bundle lines for the duplication gate; no test
// runner import, so the drivers bundle this too.
import { spawn, type ChildProcess } from 'node:child_process'
import { createServer } from 'node:net'
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
