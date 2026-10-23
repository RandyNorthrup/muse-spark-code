// M100 two-process drill: two real node processes own two temp dirs, exchange
// invitations through files, then run one pinned-TLS frame exchange over
// loopback. The child (deviceTwoProcessDriver.ts) is bundled with esbuild;
// each side receives the peer's frame into its own dir.
import { mkdtempSync, mkdirSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterAll, describe, expect, it } from 'vitest'
import { fileURLToPath } from 'node:url'
import {
  RIG_DRILL_TIMEOUT_MS,
  rigBundleDriver,
  rigFreePort,
  rigSpawnSide,
  rigWaitForExit,
  rigWaitForLine,
} from './deviceRig'

const here = path.dirname(fileURLToPath(import.meta.url))

const scratch: string[] = []

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
      await rigBundleDriver(path.join(here, 'deviceTwoProcessDriver.ts'), driverJs)
      const root = mkdtempSync(path.join(tmpdir(), 'device-two-run-'))
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
      })
      const dialer = rigSpawnSide(driverJs, {
        dir: dirB,
        role: 'dial',
        port,
        own: path.join(dirB, 'invitation.json'),
        peer: path.join(dirA, 'invitation.json'),
        ready: path.join(dirA, 'ready'),
      })
      const listening = rigWaitForLine(listener, 'LISTENING')
      const listenerDone = rigWaitForLine(listener, 'LISTENER-DONE')
      const dialerDone = rigWaitForLine(dialer, 'DIALER-DONE')
      // Attached up front: a side can exit between its last signal and the
      // parent's next await, and a late exit listener misses it.
      const listenerExit = rigWaitForExit(listener)
      const dialerExit = rigWaitForExit(dialer)
      try {
        await listening
        try {
          await dialerDone
          await listenerDone
          const [listenerCode, dialerCode] = await Promise.all([listenerExit, dialerExit])
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
    RIG_DRILL_TIMEOUT_MS,
  )
})
