import { afterAll, beforeAll, describe, it } from 'vitest'
import path from 'node:path'
import {
  startWindowsBrokerFixture,
  type WindowsBrokerFixture,
} from '../helpers/vault/windowsBrokerFixture'
import { drivePanelFlow } from '../helpers/vault/panelFlowDriver'

// The vault exactly as the Models & Agents panel drives it on Windows (the
// flow itself lives in the shared panel-flow driver): the real broker the
// real client platform launches, set up, unlocked, added to through the
// native editor's own code, written and read back as a first-party row,
// locked, unlocked and read again. The fixture carries no keyring binding,
// as the VSIX carries none.
const fixture = { current: undefined as WindowsBrokerFixture | undefined }

describe.skipIf(process.platform !== 'win32')('Windows vault through the panel', () => {
  beforeAll(async () => {
    fixture.current = await startWindowsBrokerFixture('vs-wpanel-')
  })
  afterAll(async () => {
    await fixture.current?.dispose()
  })

  it('sets up, unlocks, adds, reads back, locks and unlocks again through the real broker', async () => {
    const current = fixture.current
    if (!current) throw new Error('the client platform did not build')
    // VS Code's extension host works inside its own install folder, and the
    // broker inherits that folder: here the working folder holds every
    // helper (built pipe and slot helpers, job helpers, dist), so a launch
    // that refused an absolute helper path as a workspace planting fails.
    // It is the fixture's parent: the broker's working folder must not be
    // the folder the fixture removes (Windows refuses to remove it).
    await drivePanelFlow(
      {
        home: path.join(current.root, 'home'),
        connect: current.connect,
      },
      path.dirname(current.root),
      'windows',
      // Windows protects the vault with DPAPI, the OS store tier.
      'osStore',
    )
  }, 300_000)
})
