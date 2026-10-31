// M108 D two-process drill, as RLM100's pinned-TLS drill: two real node
// processes own two temp dirs. The sender routes account work by the
// pinned device's headroom; the receiver admits with its own record and
// confirmations. The child (deviceAccountTwoProcessDriver.ts) is bundled
// with esbuild. The file channel carries D's own fragments only — the
// offer record and the account request fragment — and the drill asserts
// nothing credential-bearing crosses it. The live M100 transport binding
// is RLF-DEVICES; this drill proves the sender/receiver composition that
// binding will carry.
import { spawn, type ChildProcess } from 'node:child_process'
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterAll, describe, expect, it } from 'vitest'
import { build } from 'esbuild'
import { fileURLToPath } from 'node:url'
import { localPlacementId } from '../../src/core/accounts/placement'

const here = path.dirname(fileURLToPath(import.meta.url))
const SIGNAL_BUDGET_MS = 30_000
const SIGNAL_POLL_MS = 10
// Two child processes plus esbuild bundling and six routing phases.
const DRILL_TIMEOUT_MS = 60_000

const scratch: string[] = []

function byString(a: string, b: string): number {
  if (a === b) return 0
  return a < b ? -1 : 1
}

// One persistent buffer per child: back-to-back signals can share a chunk,
// and a listener attached between waits would drop them.
function watchLines(child: ChildProcess): (match: string) => Promise<void> {
  const lines: string[] = []
  let fragment = ''
  let spawnError: Error | undefined
  child.stdout?.on('data', (chunk: Buffer) => {
    fragment += chunk.toString('utf8')
    const parts = fragment.split('\n')
    fragment = parts.pop() ?? ''
    for (const part of parts) lines.push(part.trim())
  })
  child.on('error', (error: Error) => {
    spawnError = error
  })
  return async (match: string): Promise<void> => {
    const startedAt = Date.now()
    for (;;) {
      const at = lines.indexOf(match)
      if (at !== -1) {
        lines.splice(0, at + 1)
        return
      }
      if (spawnError !== undefined) throw spawnError
      if (child.exitCode !== null)
        throw new Error(`child exited ${String(child.exitCode)} before ${match}`)
      if (Date.now() - startedAt > SIGNAL_BUDGET_MS) throw new Error(`signal not seen: ${match}`)
      await sleep(SIGNAL_POLL_MS)
    }
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms)
  })
}

function waitForExit(child: ChildProcess): Promise<number | null> {
  return new Promise((resolve, reject) => {
    // The child may already have exited after its last signal; resolve
    // eagerly so a listener attached late never hangs.
    if (child.exitCode !== null || child.signalCode !== null) {
      resolve(child.exitCode)
      return
    }
    child.on('error', reject)
    child.on('exit', (code) => {
      resolve(code)
    })
  })
}

function claimFiles(dir: string): string[] {
  const found: string[] = []
  const walk = (current: string): void => {
    const entries = readdirSync(current, { withFileTypes: true })
    for (const entry of entries) {
      const full = path.join(current, entry.name)
      if (entry.isDirectory()) walk(full)
      else if (entry.name.startsWith('claim-')) found.push(full)
    }
  }
  walk(dir)
  return found
}

describe('M108 D two-process routing drill', () => {
  afterAll(() => {
    for (const dir of scratch.splice(0)) rmSync(dir, { recursive: true, force: true })
  })

  it(
    "routes by pinned-device headroom and admits with the receiver's own record",
    async () => {
      const outdir = mkdtempSync(path.join(tmpdir(), 'device-account-driver-'))
      scratch.push(outdir)
      const driverJs = path.join(outdir, 'driver.mjs')
      await build({
        entryPoints: [path.join(here, 'deviceAccountTwoProcessDriver.ts')],
        bundle: true,
        platform: 'node',
        format: 'esm',
        outfile: driverJs,
        logLevel: 'silent',
      })
      const root = mkdtempSync(path.join(tmpdir(), 'device-account-run-'))
      scratch.push(root)
      const dirA = path.join(root, 'a')
      const dirB = path.join(root, 'b')
      const exchange = path.join(root, 'exchange')
      const peerB = localPlacementId(dirB)
      const sender = spawn(
        process.execPath,
        [
          driverJs,
          '--role',
          'sender',
          '--dir',
          dirA,
          '--exchange',
          exchange,
          '--peer',
          dirB,
          '--peer-id',
          peerB,
        ],
        { stdio: ['ignore', 'pipe', 'inherit'] },
      )
      const receiver = spawn(
        process.execPath,
        [driverJs, '--role', 'receiver', '--dir', dirB, '--exchange', exchange],
        { stdio: ['ignore', 'pipe', 'inherit'] },
      )
      const senderSignals = watchLines(sender)
      const receiverSignals = watchLines(receiver)
      const senderDone = (async (): Promise<void> => {
        await senderSignals('ROUTED-1')
        await senderSignals('ROUTED-2')
        await senderSignals('MISSING-DEVICE-OK')
        await senderSignals('OVERLAP-STOP-OK')
        await senderSignals('RESTORE-STOP-OK')
        await senderSignals('WITHDRAWN-STOP-OK')
        await senderSignals('SENDER-DONE')
      })()
      const receiverDone = (async (): Promise<void> => {
        await receiverSignals('OFFER-WRITTEN')
        await receiverSignals('SERVED-1')
        await receiverSignals('SERVED-2')
        await receiverSignals('RECEIVER-DONE')
      })()
      try {
        await senderDone
        await receiverDone
        const [senderCode, receiverCode] = await Promise.all([
          waitForExit(sender),
          waitForExit(receiver),
        ])
        expect(senderCode).toBe(0)
        expect(receiverCode).toBe(0)
      } finally {
        sender.kill()
        receiver.kill()
      }

      // The receiver served both phases from its own pinned account.
      for (const tag of ['1', '2']) {
        const result = JSON.parse(
          readFileSync(path.join(exchange, `result-${tag}.json`), 'utf8'),
        ) as { value?: unknown; account?: unknown }
        expect(result).toEqual({ value: 'served-br1', account: 'br1' })
      }
      // The stops sent nothing: only the two routed fragments crossed.
      const frags = readdirSync(exchange)
        .filter((name) => name.startsWith('frag-'))
        .toSorted(byString)
      expect(frags).toEqual(['frag-1.json', 'frag-2.json'])
      // The channel carried no account id, label or credential material.
      // The offer the sender routed on is its own kept copy: the live
      // offer file was withdrawn in the last phase.
      expect(existsSync(path.join(exchange, 'offer.json'))).toBe(false)
      const seen = JSON.parse(readFileSync(path.join(dirA, 'offer-seen.json'), 'utf8')) as {
        device?: unknown
        offer?: unknown
      }
      expect(seen.device).toBe(peerB)
      expect(seen.offer).toEqual({ meta: 'ample' })
      const channel = [
        readFileSync(path.join(dirA, 'offer-seen.json'), 'utf8'),
        readFileSync(path.join(exchange, 'frag-1.json'), 'utf8'),
        readFileSync(path.join(exchange, 'frag-2.json'), 'utf8'),
      ].join('\n')
      for (const secret of ['br1', 'default', 'Label', 'B one', 'B receiver', 'secret']) {
        expect(channel.includes(secret)).toBe(false)
      }
      const fragment = JSON.parse(
        readFileSync(path.join(exchange, 'frag-1.json'), 'utf8'),
      ) as Record<string, unknown>
      expect('account' in fragment).toBe(false)
      // The receiver consulted its own record once, for the vendor limit;
      // the user-cap spread asked nothing.
      const asked = JSON.parse(readFileSync(path.join(dirB, 'asked.json'), 'utf8')) as unknown[]
      expect(asked).toEqual([{ provider: 'meta', product: 'model-api' }])
      expect(existsSync(path.join(dirB, 'confirmations', 'confirmation-meta-model-api.json'))).toBe(
        true,
      )
      // Both admissions settled through the real journal on the receiver.
      expect(claimFiles(path.join(dirB, 'account-requests')).length).toBeGreaterThanOrEqual(2)
      // Both claims finished returned, sender and receiver alike.
      for (const dir of [dirA, dirB]) {
        const outcomes = readFileSync(path.join(dir, 'claims.jsonl'), 'utf8').trim().split('\n')
        expect(outcomes).toEqual(['returned', 'returned'])
      }
      // The overlapping vendor-limit fence persisted on the sender.
      const limits = readdirSync(path.join(dirA, 'remote-limits'))
      expect(limits).toHaveLength(1)
      const first = limits[0]
      if (first === undefined) throw new Error('no limit record was written')
      expect(statSync(path.join(dirA, 'remote-limits', first)).isFile()).toBe(true)
      const block = (
        JSON.parse(readFileSync(path.join(dirA, 'remote-limits', first), 'utf8')) as {
          block?: unknown
        }
      ).block as { isOverlapping?: unknown } | undefined
      expect(block?.isOverlapping).toBe(true)
    },
    DRILL_TIMEOUT_MS,
  )
})
