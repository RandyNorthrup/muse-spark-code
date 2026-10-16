// RVAPP-CM1091D5 P3-1: a probe error that is not "does not exist" is
// reported as what it is — permission, drive unavailable, other — and an
// unavailable drive is never "gone". Real drives cannot be failed here, so
// the OS codes are injected through a scoped lstatSync mock (every other
// fs call delegates to the real one). Each case fails without probeRefusal.
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanupTempHomes, importedNetrc } from './managementFixture'

const probe = vi.hoisted(() => ({ mode: 'real', home: '' }))

function coded(code: string): Error {
  return Object.assign(new Error(`injected ${code}`), { code })
}

/** The slice of node:fs this mock delegates to; everything else spreads through. */
interface ProbeFs {
  readonly lstatSync: (target: string, options?: { readonly bigint: true }) => object
}

vi.mock('node:fs', async () => {
  const actual = await vi.importActual<ProbeFs>('node:fs')
  return {
    ...actual,
    lstatSync: (target: string, options?: { bigint: true }): object => {
      if (probe.mode !== 'real' && target.endsWith('.netrc'))
        throw coded(probe.mode === 'deadDrive' ? 'ENOENT' : probe.mode)
      if (probe.mode === 'deadDrive' && target === probe.home) throw coded('EIO')
      return options === undefined ? actual.lstatSync(target) : actual.lstatSync(target, options)
    },
  }
})

describe('RVAPP-CM1091D5 P3-1 probe errors name their true reason', () => {
  afterEach(async () => {
    probe.mode = 'real'
    await cleanupTempHomes()
  })

  // One injected code per probe shape; each fails without probeRefusal.
  // The receipt always stays: retrying after the drive returns is honest.
  it.each([
    { mode: 'deadDrive', reason: 'sourceUnavailable' },
    { mode: 'EIO', reason: 'sourceUnavailable' },
    { mode: 'ELOOP', reason: 'invalid' },
  ])('$mode refuses as $reason, never gone and never permissions', async ({ mode, reason }) => {
    const { f, report, home, store } = await importedNetrc()
    probe.home = home
    probe.mode = mode
    try {
      await expect(f.management.deleteImport(report.receipt, () => true)).rejects.toMatchObject({
        reason,
      })
      expect(await store.readReceipt(report.receipt)).not.toBeNull()
    } finally {
      probe.mode = 'real'
    }
  })
})
