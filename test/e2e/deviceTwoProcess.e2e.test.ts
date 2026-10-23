// M100 two-process drill: two real node processes own two temp dirs, exchange
// invitations through files, then run one pinned-TLS frame exchange over
// loopback. The child (deviceTwoProcessDriver.ts) is bundled with esbuild;
// each side receives the peer's frame into its own dir.
import { readFileSync, rmSync } from 'node:fs'
import path from 'node:path'
import { afterAll, describe, expect, it } from 'vitest'
import { fileURLToPath } from 'node:url'
import { RIG_DRILL_TIMEOUT_MS, rigFinishPair, rigStartPair, rigWaitForLine } from './deviceRig'

const here = path.dirname(fileURLToPath(import.meta.url))

const scratch: string[] = []

describe('M100 two-process TLS drill', () => {
  afterAll(() => {
    for (const dir of scratch.splice(0)) rmSync(dir, { recursive: true, force: true })
  })

  it(
    'exchanges pairing frames between two processes over pinned TLS',
    async () => {
      const pair = await rigStartPair(
        path.join(here, 'deviceTwoProcessDriver.ts'),
        'device-two',
        scratch,
      )
      const { listener, dialer, dirA, dirB } = pair
      const listening = rigWaitForLine(listener, 'LISTENING')
      const listenerDone = rigWaitForLine(listener, 'LISTENER-DONE')
      const dialerDone = rigWaitForLine(dialer, 'DIALER-DONE')
      const { listenerCode, dialerCode } = await rigFinishPair(pair, async () => {
        await listening
        await dialerDone
        await listenerDone
      })
      expect(listenerCode).toBe(0)
      expect(dialerCode).toBe(0)
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
