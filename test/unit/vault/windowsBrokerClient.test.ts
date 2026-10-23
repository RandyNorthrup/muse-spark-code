import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { setTimeout as delay } from 'node:timers/promises'
import { windowsVaultPipeNameSchema } from '../../../src/core/vault/broker/windowsPipe'
import {
  startWindowsBrokerFixture,
  type WindowsBrokerFixture,
} from '../helpers/vault/windowsBrokerFixture'

// Windows end to end on Windows CI: the real client platform builds both
// helpers, launches the real installed broker entry (bundled exactly as the
// packages lay it out), dials its pipe and reads a real status. Nothing is
// invented: the pipe name, the trust and the status all come from the
// helper and the broker. Skipped elsewhere with this reason.
const fixture = { current: undefined as WindowsBrokerFixture | undefined }
describe.skipIf(process.platform !== 'win32')('Windows vault broker end to end', () => {
  // The native helper builds and broker starts take as long as the machine
  // needs (a slow hosted Windows runner passed the 30 s hook budget, PR #258):
  // no time limit of ours on this setup (owner 2026-10-16).
  beforeAll(async () => {
    // Helper builds (the person's own C# compiler) happen here, inside the
    // hook budget; the test below stays a fast launch plus round trip.
    fixture.current = await startWindowsBrokerFixture('vs-wbroker-')
  }, 0)
  afterAll(async () => {
    await fixture.current?.dispose()
  })

  it('builds, launches, dials and reads status through the real broker', async () => {
    const current = fixture.current
    if (!current) throw new Error('the client platform did not build')
    const client = await current.connect()
    try {
      const location = await current.broker.get()
      // The claim publishes a pipe name, never a socket path.
      expect(windowsVaultPipeNameSchema.safeParse(location.lock.socket).success).toBe(true)
      const first = await client.send({ kind: 'status' })
      if (first.kind !== 'status') throw new Error('broker answered outside the channel')
      // The broker alone answers `locked` with no store open: `uncreated`
      // is the management view's answer (its snapshot over the data
      // folder), and this request never reaches it.
      expect(first.status.state).toBe('locked')
      expect(first.status.reason).toBe('locked')
      // The idle interval must not lock under a live broker: every lock
      // bumps the epoch, so a stable epoch across more than one
      // one-second tick proves the unlock survives while the broker runs.
      const epoch = first.status.lockEpoch
      await delay(1200)
      const second = await client.send({ kind: 'status' })
      if (second.kind !== 'status') throw new Error('broker answered outside the channel')
      expect(second.status.state).toBe('locked')
      expect(second.status.lockEpoch).toBe(epoch)
    } finally {
      client.close()
    }
  })
})
