import { mkdtempSync, readFileSync, realpathSync, rmSync } from 'node:fs'
import { hostname, tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { developerMachineId } from '../../src/core/developer/machineId'
import { DeveloperOptions } from '../../src/core/developer/developerOptions'
import { developerConfirmation } from '../../src/core/developer/surfaces'
import { createRuntimeAccountServices } from '../../src/runtime/providers/runtimeServices'
import type { KeyringEntryFactory } from '../../src/runtime/keyStore'
import { DEVELOPER_FILES, DEVELOPER_UNLOCK_MS } from '../../src/shared/constants'
import { developerStateSchema } from '../../src/shared/developerOptions'
import { developerFixture } from './helpers/developer'

const dirs: string[] = []
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true })
})

// macOS spells $TMPDIR through a /var symlink the developer root refuses.
function freshDir(): string {
  const folder = mkdtempSync(path.join(realpathSync.native(tmpdir()), 'devid017-'))
  dirs.push(folder)
  return folder
}

function keyring(): KeyringEntryFactory {
  const values = new Map<string, string>()
  return (_service, name) => ({
    getPassword: () => Promise.resolve(values.get(name)),
    setPassword: (value: string) => {
      values.set(name, value)
      return Promise.resolve()
    },
    deletePassword: () => Promise.resolve(values.delete(name)),
  })
}

const locked = {
  v: 1,
  machineId: 'machine',
  unlockedAt: null,
  expiresAt: null,
  isMultipleAccountsOn: false,
  profiles: [],
}

describe('developer machine identity (DEVID017)', () => {
  it.each(['Macmini.ivettnet', 'host.local'])(
    'maps dotted hostname %s to a schema-valid id',
    (host) => {
      // The raw hostname never validates: dots are outside the schema.
      expect(developerStateSchema.safeParse({ ...locked, machineId: host }).success).toBe(false)
      const id = developerMachineId(host)
      expect(developerStateSchema.safeParse({ ...locked, machineId: id }).success).toBe(true)
    },
  )

  it('derives one stable id per machine, shared by every host', () => {
    // A published vector: the same hostname in the extension host, the
    // CLI/ACP runtime or the companion yields the same id.
    expect(developerMachineId('macmini.ivettnet')).toBe(
      '1f78da4562a5e81df9a860c494ea41dd6974651d17049b355cb262cee96190d1',
    )
    expect(developerMachineId('host.local')).toBe(
      '84345dbbba633e49930fa0ae278faf4c72c69fb4c14147c0768331f14df9aed6',
    )
    expect(developerMachineId('Host.Local')).toBe(developerMachineId('host.local'))
    expect(developerMachineId('host.local')).toBe(developerMachineId('host.local'))
    expect(developerMachineId('host.local')).not.toBe(developerMachineId('other.local'))
  })

  it('opens the runtime developer owner on this dotted-hostname machine', async () => {
    const folder = freshDir()
    const services = createRuntimeAccountServices({ dataDir: folder, openEntry: keyring() })
    try {
      const owner = await services.developer({
        readLine: () => Promise.resolve(developerConfirmation('unlock').accept),
        print: vi.fn(),
      })
      expect(owner.snapshot().isUnlocked).toBe(false)
      await owner.unlock('terminal')
      expect(owner.snapshot().isUnlocked).toBe(true)
    } finally {
      services.dispose()
    }
  })

  it('persists the shared id, never the raw hostname', async () => {
    const folder = freshDir()
    const services = createRuntimeAccountServices({ dataDir: folder, openEntry: keyring() })
    try {
      const owner = await services.developer({
        readLine: () => Promise.resolve(developerConfirmation('unlock').accept),
        print: vi.fn(),
      })
      await owner.unlock('terminal')
      const stored = developerStateSchema.parse(
        JSON.parse(readFileSync(path.join(folder, 'developer', DEVELOPER_FILES.state), 'utf8')),
      )
      expect(stored.machineId).toBe(developerMachineId(hostname()))
      expect(stored.machineId).not.toContain('.')
    } finally {
      services.dispose()
    }
  })

  it('adopts a grant stored under this machine’s raw hostname without losing it', async () => {
    const host = 'my-pc'
    const id = developerMachineId(host)
    expect(id).not.toBe(host)
    const legacy = {
      ...locked,
      machineId: host,
      unlockedAt: Date.parse('2026-10-06T12:00:00Z') - 1000,
      expiresAt: Date.parse('2026-10-06T12:00:00Z') - 1000 + DEVELOPER_UNLOCK_MS,
      isMultipleAccountsOn: true,
      profiles: [{ id: 'profile-one', provider: 'meta', account: 'work' }],
    }
    const h = developerFixture(legacy)
    const owner = await DeveloperOptions.open({
      ...h.deps,
      machineId: id,
      previousMachineIds: [host],
    })
    expect(owner.snapshot().isUnlocked).toBe(true)
    expect(owner.snapshot().expiresAt).toBe(legacy.expiresAt)
    // The next save re-binds the grant to the opaque id; nothing else changes.
    await owner.setMultiple(false)
    const stored = developerStateSchema.parse(h.persisted())
    expect(stored.machineId).toBe(id)
    expect(stored.unlockedAt).toBe(legacy.unlockedAt)
    expect(stored.expiresAt).toBe(legacy.expiresAt)
    expect(stored.profiles).toEqual(legacy.profiles)
  })

  it('still refuses another machine and a future-dated legacy grant', async () => {
    const host = 'my-pc'
    const legacy = { ...locked, machineId: host }
    const h = developerFixture(legacy)
    await expect(
      DeveloperOptions.open({
        ...h.deps,
        machineId: developerMachineId('other-pc'),
        previousMachineIds: ['other-pc'],
      }),
    ).rejects.toMatchObject({ code: 'unavailable' })
    await expect(
      DeveloperOptions.open({ ...h.deps, machineId: developerMachineId(host) }),
    ).rejects.toMatchObject({ code: 'unavailable' })
    const future = developerFixture({
      ...legacy,
      unlockedAt: Date.parse('2026-10-06T12:00:00Z') + 1000,
      expiresAt: Date.parse('2026-10-06T12:00:00Z') + 1000 + DEVELOPER_UNLOCK_MS,
    })
    await expect(
      DeveloperOptions.open({
        ...future.deps,
        machineId: developerMachineId(host),
        previousMachineIds: [host],
      }),
    ).rejects.toMatchObject({ code: 'unavailable' })
  })
})
