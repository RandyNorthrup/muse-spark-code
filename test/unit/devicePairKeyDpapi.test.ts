// M100 lane K: Windows pair keys under OS store protection (M109 P's
// DPAPI tier). The real helper wraps a real pair key through the real
// DPAPI slot; the envelope holds no PEM and opens byte-exact. Windows CI:
// DPAPI is per-user crypto with no named store entry, so nothing of the
// owner's store is read or written; nothing stands in for it elsewhere.
import { mkdtemp, readFile, realpath, rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { protectPairKey, unprotectPairKey } from '../../src/core/devices/ownerBind'
import { validateDevicePair } from '../../src/core/devices/pairing'
import { configureResources } from '../../src/core/resources/admission'
import { windowsPipeExecutable } from '../../src/host/vault/slots/windowsVaultBuild'
import { runtimeWindowsJob } from '../../src/runtime/resources/jobs'
import { WindowsVaultSlots } from '../../src/runtime/vault/slots/windowsVaultSlots'
import type { WindowsVaultExecutable } from '../../src/runtime/vault/slots/windowsVaultTransport'
import { completeDevicePair } from './helpers/devicePairs'

const NOW = Date.UTC(2026, 9, 23)
const OWNER_DEVICE = '0d'.repeat(16)
const REQUESTER_DEVICE = '0e'.repeat(16)

const fixture: { root: string; helper?: WindowsVaultExecutable; dispose?: () => void } = {
  root: '',
}

describe.runIf(process.platform === 'win32')('M100 lane K Windows DPAPI pair keys', () => {
  // The native helper builds and broker starts take as long as the machine
  // needs (a slow hosted Windows runner passed the 30 s hook budget, PR
  // #258): no time limit of ours on this setup (owner 2026-10-16).
  beforeAll(async () => {
    fixture.root = await mkdtemp(path.join(await realpath(os.tmpdir()), 'lane-k-dpapi-'))
    const storageDir = path.join(fixture.root, 'data', 'vault', 'helpers')
    const systemRoot = process.env['SystemRoot']
    if (systemRoot === undefined || systemRoot === '') throw new Error('SystemRoot is missing')
    const windowsJob = runtimeWindowsJob(path.join(fixture.root, 'jobs'), path.resolve('.'))
    fixture.dispose = configureResources({
      inspect: () => ({}),
      onError: () => undefined,
      windowsJob,
    })
    if ((await windowsJob()) === undefined) throw new Error('the Windows job helpers did not build')
    fixture.helper = await windowsPipeExecutable({
      storageDir,
      systemRoot,
      readSlotSource: () => readFile(path.resolve('native/windows/MuseSparkVault.cs'), 'utf8'),
      readPipeSource: () => readFile(path.resolve('native/windows/MuseSparkVaultPipe.cs'), 'utf8'),
    })
  }, 0)

  afterAll(async () => {
    fixture.dispose?.()
    await rm(fixture.root, { recursive: true, force: true })
  })

  it('rests a real pair key under DPAPI with no PEM in the envelope', async () => {
    if (fixture.helper === undefined) throw new Error('the vault helper was not built')
    const { pair, localPem } = completeDevicePair(OWNER_DEVICE, REQUESTER_DEVICE, NOW)
    const slots = new WindowsVaultSlots(fixture.helper, { platform: 'win32' })
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
