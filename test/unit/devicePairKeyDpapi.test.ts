// M100 lane K: Windows pair keys under OS store protection (M109 P's
// DPAPI tier). The real helper wraps a real pair key through the real
// DPAPI slot; the envelope holds no PEM and opens byte-exact. Windows CI:
// DPAPI is per-user crypto with no named store entry, so nothing of the
// owner's store is read or written; nothing stands in for it elsewhere.
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { protectPairKey, unprotectPairKey } from '../../src/core/devices/ownerBind'
import { validateDevicePair } from '../../src/core/devices/pairing'
import { WindowsVaultSlots } from '../../src/runtime/vault/slots/windowsVaultSlots'
import { completeDevicePair } from './helpers/devicePairs'
import {
  buildWindowsVaultHelper,
  disposeWindowsVaultHelper,
  type WindowsVaultHelper,
} from './helpers/windowsVaultHelper'

const NOW = Date.UTC(2026, 9, 23)
const OWNER_DEVICE = '0d'.repeat(16)
const REQUESTER_DEVICE = '0e'.repeat(16)

const fixture: { built?: WindowsVaultHelper } = {}

describe.runIf(process.platform === 'win32')('M100 lane K Windows DPAPI pair keys', () => {
  // The native helper builds and broker starts take as long as the machine
  // needs (a slow hosted Windows runner passed the 30 s hook budget, PR
  // #258): no time limit of ours on this setup (owner 2026-10-16).
  beforeAll(async () => {
    fixture.built = await buildWindowsVaultHelper('lane-k-dpapi-')
  }, 0)

  afterAll(async () => {
    if (fixture.built !== undefined) await disposeWindowsVaultHelper(fixture.built)
  })

  it('rests a real pair key under DPAPI with no PEM in the envelope', async () => {
    if (fixture.built === undefined) throw new Error('the vault helper was not built')
    const { pair, localPem } = completeDevicePair(OWNER_DEVICE, REQUESTER_DEVICE, NOW)
    const slots = new WindowsVaultSlots(fixture.built.helper, { platform: 'win32' })
    const vaultId = '1a'.repeat(16)
    const slotId = '1b'.repeat(16)
    const pairId = validateDevicePair(pair, NOW)
    const envelope = await protectPairKey(slots.osStore(vaultId, slotId), pairId, localPem)
    expect(envelope.slot.provider).toBe('windowsDpapi')
    expect(envelope.slot.backend).toBe('dpapi')
    expect(JSON.stringify(envelope)).not.toContain('PRIVATE KEY')
    const opener = slots.slotFor(envelope.slot)
    if (opener === null) throw new Error('the DPAPI slot did not accept its own record')
    await expect(unprotectPairKey(opener, envelope)).resolves.toBe(localPem)
  })
})
