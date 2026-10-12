// RVAPP-CM1091D5 P3-1: a probe error that is not "does not exist" is
// reported as what it is — permission, drive unavailable, other — and an
// unavailable drive is never "gone". Real drives cannot be failed here, so
// the OS codes are injected through a scoped lstatSync mock (every other
// fs call delegates to the real one). Each case fails without probeRefusal.
import { afterEach, describe, expect, it, vi } from 'vitest'
import { writeFile } from 'node:fs/promises'
import path from 'node:path'
import { cleanupTempHomes, lockedVault, managementFixture, tempHome } from './managementFixture'

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

async function imported(): Promise<{
  f: ReturnType<typeof managementFixture>
  receipt: string
}> {
  const home = await tempHome()
  probe.home = home
  const file = path.join(home, '.netrc')
  await writeFile(file, 'machine example.test login generated-user password generated-password\n')
  const f = managementFixture(undefined, home)
  const setup = await lockedVault(f)
  setup.fill(0)
  await f.broker.unlock(null)
  const report = await f.management.importFile(file, () => true)
  return { f, receipt: report.receipt }
}

describe('RVAPP-CM1091D5 P3-1 probe errors name their true reason', () => {
  afterEach(async () => {
    probe.mode = 'real'
    await cleanupTempHomes()
  })

  it('ENOENT with an unreachable home is unavailable, never gone', async () => {
    const { f, receipt } = await imported()
    const store = f.repository.current()
    probe.mode = 'deadDrive'
    try {
      await expect(f.management.deleteImport(receipt, () => true)).rejects.toMatchObject({
        reason: 'sourceUnavailable',
      })
      // The receipt stays: retrying after the drive returns is honest.
      expect(await store.readReceipt(receipt)).not.toBeNull()
    } finally {
      probe.mode = 'real'
    }
  })

  it('a drive error on the source is unavailable, never permissions', async () => {
    const { f, receipt } = await imported()
    const store = f.repository.current()
    probe.mode = 'EIO'
    try {
      await expect(f.management.deleteImport(receipt, () => true)).rejects.toMatchObject({
        reason: 'sourceUnavailable',
      })
      expect(await store.readReceipt(receipt)).not.toBeNull()
    } finally {
      probe.mode = 'real'
    }
  })

  it('any other probe code is invalid, never gone and never permissions', async () => {
    const { f, receipt } = await imported()
    const store = f.repository.current()
    probe.mode = 'ELOOP'
    try {
      await expect(f.management.deleteImport(receipt, () => true)).rejects.toMatchObject({
        reason: 'invalid',
      })
      expect(await store.readReceipt(receipt)).not.toBeNull()
    } finally {
      probe.mode = 'real'
    }
  })
})
