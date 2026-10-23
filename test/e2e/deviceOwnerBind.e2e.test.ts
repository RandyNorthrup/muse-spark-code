// M100 lane K drills over the two-process pinned-TLS rig: a valid pair
// key for the wrong owner fails; a grant replayed past its bound fails;
// every claim is audited; and the scrub detector proves itself red on a
// planted sentinel and green on the real traffic.
import { randomBytes } from 'node:crypto'
import { readFileSync, rmSync } from 'node:fs'
import path from 'node:path'
import { afterAll, describe, expect, it } from 'vitest'
import { fileURLToPath } from 'node:url'
import { VaultScrubber } from '../../src/core/vault/scrub'
import type { DeviceOwnerAuditRecord } from '../../src/core/devices/ownerBind'
import { RIG_DRILL_TIMEOUT_MS, rigFinishPair, rigStartPair, rigWaitForLine } from './deviceRig'

const here = path.dirname(fileURLToPath(import.meta.url))

const scratch: string[] = []

describe('M100 lane K owner-bind drills', () => {
  afterAll(() => {
    for (const dir of scratch.splice(0)) rmSync(dir, { recursive: true, force: true })
  })

  it(
    'refuses the wrong owner and the expired replay, and audits every claim',
    async () => {
      const pair = await rigStartPair(
        path.join(here, 'deviceTwoProcessDriver.ts'),
        'device-owner',
        scratch,
        ['--scenario', 'owner-bind'],
      )
      const { listener, dialer, dirA, dirB } = pair
      const listening = rigWaitForLine(listener, 'LISTENING')
      const ownerAllowed = rigWaitForLine(dialer, 'OWNER-ALLOWED')
      const ownerRefused = rigWaitForLine(dialer, 'OWNER-REFUSED')
      const grantAllowed = rigWaitForLine(dialer, 'GRANT-ALLOWED')
      const replayRefused = rigWaitForLine(dialer, 'GRANT-REPLAY-REFUSED')
      const listenerDone = rigWaitForLine(listener, 'LISTENER-DONE')
      const dialerDone = rigWaitForLine(dialer, 'DIALER-DONE')
      const { listenerCode, dialerCode } = await rigFinishPair(pair, async () => {
        await listening
        await ownerAllowed
        await ownerRefused
        await grantAllowed
        await replayRefused
        await dialerDone
        await listenerDone
      })
      expect(listenerCode).toBe(0)
      expect(dialerCode).toBe(0)
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
