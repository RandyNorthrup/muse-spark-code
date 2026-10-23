// M100 two-process drill: two real node processes own two temp dirs, exchange
// invitations through files, then run one pinned-TLS frame exchange over
// loopback. The child (deviceTwoProcessDriver.ts) is bundled with esbuild;
// each side receives the peer's frame into its own dir.
import { spawn, type ChildProcess } from 'node:child_process'
import { mkdtempSync, mkdirSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterAll, describe, expect, it } from 'vitest'
import { build } from 'esbuild'
import { fileURLToPath } from 'node:url'
import { createServer } from 'node:net'

const here = path.dirname(fileURLToPath(import.meta.url))
const SIGNAL_BUDGET_MS = 30_000
// Two child processes plus two TLS handshakes over loopback.
const DRILL_TIMEOUT_MS = 60_000

const scratch: string[] = []

async function freePort(): Promise<number> {
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

function waitForLine(child: ChildProcess, match: string): Promise<void> {
  return new Promise((resolve, reject) => {
    let pending = ''
    const timer = setTimeout(() => {
      reject(new Error(`signal not seen: ${match}`))
    }, SIGNAL_BUDGET_MS)
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

function waitForExit(child: ChildProcess): Promise<number | null> {
  return new Promise((resolve, reject) => {
    child.on('error', reject)
    child.on('exit', (code) => {
      resolve(code)
    })
  })
}

function spawnSide(
  driverJs: string,
  options: {
    dir: string
    role: 'listen' | 'dial'
    port: number
    own: string
    peer: string
    ready?: string
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
  ]
  if (options.ready !== undefined) args.push('--ready', options.ready)
  return spawn(process.execPath, args, { stdio: ['ignore', 'pipe', 'inherit'] })
}

describe('M100 two-process TLS drill', () => {
  afterAll(() => {
    for (const dir of scratch.splice(0)) rmSync(dir, { recursive: true, force: true })
  })

  it(
    'exchanges pairing frames between two processes over pinned TLS',
    async () => {
      const outdir = mkdtempSync(path.join(tmpdir(), 'device-two-driver-'))
      scratch.push(outdir)
      const driverJs = path.join(outdir, 'driver.mjs')
      await build({
        entryPoints: [path.join(here, 'deviceTwoProcessDriver.ts')],
        bundle: true,
        platform: 'node',
        format: 'esm',
        outfile: driverJs,
        logLevel: 'silent',
      })
      const root = mkdtempSync(path.join(tmpdir(), 'device-two-run-'))
      scratch.push(root)
      const dirA = path.join(root, 'a')
      const dirB = path.join(root, 'b')
      mkdirSync(dirA)
      mkdirSync(dirB)
      const port = await freePort()
      const listener = spawnSide(driverJs, {
        dir: dirA,
        role: 'listen',
        port,
        own: path.join(dirA, 'invitation.json'),
        peer: path.join(dirB, 'invitation.json'),
      })
      const dialer = spawnSide(driverJs, {
        dir: dirB,
        role: 'dial',
        port,
        own: path.join(dirB, 'invitation.json'),
        peer: path.join(dirA, 'invitation.json'),
        ready: path.join(dirA, 'ready'),
      })
      const listening = waitForLine(listener, 'LISTENING')
      const listenerDone = waitForLine(listener, 'LISTENER-DONE')
      const dialerDone = waitForLine(dialer, 'DIALER-DONE')
      try {
        await listening
        try {
          await dialerDone
          await listenerDone
          const [listenerCode, dialerCode] = await Promise.all([
            waitForExit(listener),
            waitForExit(dialer),
          ])
          expect(listenerCode).toBe(0)
          expect(dialerCode).toBe(0)
        } finally {
          dialer.kill()
        }
      } finally {
        listener.kill()
      }
      const heardA = JSON.parse(readFileSync(path.join(dirA, 'received.json'), 'utf8')) as {
        body: { kind: string }
      }
      const heardB = JSON.parse(readFileSync(path.join(dirB, 'received.json'), 'utf8')) as {
        body: { kind: string }
      }
      expect(heardA.body.kind).toBe('reconcile')
      expect(heardB.body.kind).toBe('offers')
      for (const side of [dirA, dirB]) {
        const published = readFileSync(path.join(side, 'invitation.json'), 'utf8')
        expect(published).not.toContain('privateKey')
      }
    },
    DRILL_TIMEOUT_MS,
  )
})
