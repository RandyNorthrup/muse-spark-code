// M100 lane K drills over the two-process pinned-TLS rig: a valid pair
// key for the wrong owner fails; a grant replayed past its bound fails;
// every claim is audited; and the scrub detector proves itself red on a
// planted sentinel and green on the real traffic.
import { randomBytes } from 'node:crypto'
import { mkdtempSync, mkdirSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterAll, describe, expect, it } from 'vitest'
import { fileURLToPath } from 'node:url'
import { VaultScrubber } from '../../src/core/vault/scrub'
import type { DeviceOwnerAuditRecord } from '../../src/core/devices/ownerBind'
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

describe('M100 lane K owner-bind drills', () => {
  afterAll(() => {
    for (const dir of scratch.splice(0)) rmSync(dir, { recursive: true, force: true })
  })

  it(
    'refuses the wrong owner and the expired replay, and audits every claim',
    async () => {
      const outdir = mkdtempSync(path.join(tmpdir(), 'device-owner-driver-'))
      scratch.push(outdir)
      const driverJs = path.join(outdir, 'driver.mjs')
      await rigBundleDriver(path.join(here, 'deviceTwoProcessDriver.ts'), driverJs)
      const root = mkdtempSync(path.join(tmpdir(), 'device-owner-run-'))
      scratch.push(root)
      const dirA = path.join(root, 'a')
      const dirB = path.join(root, 'b')
      mkdirSync(dirA)
      mkdirSync(dirB)
      const port = await rigFreePort()
      const extra = ['--scenario', 'owner-bind']
      const listener = rigSpawnSide(driverJs, {
        dir: dirA,
        role: 'listen',
        port,
        own: path.join(dirA, 'invitation.json'),
        peer: path.join(dirB, 'invitation.json'),
        extra,
      })
      const dialer = rigSpawnSide(driverJs, {
        dir: dirB,
        role: 'dial',
        port,
        own: path.join(dirB, 'invitation.json'),
        peer: path.join(dirA, 'invitation.json'),
        ready: path.join(dirA, 'ready'),
        extra,
      })
      const listening = rigWaitForLine(listener, 'LISTENING')
      const ownerAllowed = rigWaitForLine(dialer, 'OWNER-ALLOWED')
      const ownerRefused = rigWaitForLine(dialer, 'OWNER-REFUSED')
      const grantAllowed = rigWaitForLine(dialer, 'GRANT-ALLOWED')
      const replayRefused = rigWaitForLine(dialer, 'GRANT-REPLAY-REFUSED')
      const listenerDone = rigWaitForLine(listener, 'LISTENER-DONE')
      const dialerDone = rigWaitForLine(dialer, 'DIALER-DONE')
      // Attached up front: a side can exit between its last signal and the
      // parent's next await, and a late exit listener misses it.
      const listenerExit = rigWaitForExit(listener)
      const dialerExit = rigWaitForExit(dialer)
      try {
        await listening
        try {
          await ownerAllowed
          await ownerRefused
          await grantAllowed
          await replayRefused
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
      // Every security-relevant action audited, in claim order.
      const audit = readFileSync(path.join(dirA, 'audit.jsonl'), 'utf8')
        .trim()
        .split('\n')
        .map((line) => JSON.parse(line) as DeviceOwnerAuditRecord)
      expect(audit.map((record) => [record.action, record.decision, record.reason ?? ''])).toEqual([
        ['bind', 'allow', ''],
        ['issue', 'allow', ''],
        ['issue', 'allow', ''],
        ['authorize', 'allow', ''],
        ['authorize', 'deny', 'owner-mismatch'],
        ['authorize', 'allow', ''],
        ['authorize', 'deny', 'grant-expired'],
      ])
      // No private key material crossed in any frame.
      const traffic =
        readFileSync(path.join(dirA, 'capture.jsonl'), 'utf8') +
        readFileSync(path.join(dirB, 'capture.jsonl'), 'utf8')
      expect(traffic).not.toContain('PRIVATE KEY')
      expect(traffic).not.toContain('BEGIN')
      // The scrub detector: green on the real traffic, red on a plant.
      const sentinel = randomBytes(32)
      const scrubber = new VaultScrubber([sentinel])
      try {
        expect(scrubber.scrub(traffic)).toBe(traffic)
        const planted = `${traffic}\nplanted ${sentinel.toString('base64')}\n`
        expect(scrubber.scrub(planted) === planted).toBe(false)
      } finally {
        sentinel.fill(0)
        scrubber.dispose()
      }
    },
    RIG_DRILL_TIMEOUT_MS,
  )
})
