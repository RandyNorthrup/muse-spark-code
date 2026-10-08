import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { hostname, tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  developerMachineIdAliases,
  developerMachineIdFile,
  legacyDeveloperMachineId,
  loadDeveloperMachineId,
} from '../../src/core/developer/machineId'
import { DeveloperOptions, DeveloperOptionsError } from '../../src/core/developer/developerOptions'
import { createRuntimeAccountServices } from '../../src/runtime/providers/runtimeServices'
import { runTerminalDeveloperCommand } from '../../src/runtime/providers/accountsEntry'
import { DEVELOPER_FILES, DEVELOPER_UNLOCK_MS, UI_TEXT } from '../../src/shared/constants'
import { developerStateSchema } from '../../src/shared/developerOptions'
import { developerFixture } from './helpers/developer'
import { memoryKeyring } from './helpers/keyring'

const dirs: string[] = []
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true })
})

// macOS spells $TMPDIR through a /var symlink the developer root refuses.
function freshDir(): string {
  const folder = mkdtempSync(path.join(realpathSync.native(tmpdir()), 'devid017b-'))
  dirs.push(folder)
  return folder
}

const locked = {
  v: 1,
  machineId: 'machine',
  unlockedAt: null,
  expiresAt: null,
  isMultipleAccountsOn: false,
  profiles: [],
}

function unlockedGrant(machineId: string): {
  v: number
  machineId: string
  unlockedAt: number
  expiresAt: number
  isMultipleAccountsOn: boolean
  profiles: { id: string; provider: string; account: string }[]
} {
  const unlockedAt = Date.parse('2026-10-06T12:00:00Z')
  return {
    v: 1,
    machineId,
    unlockedAt,
    expiresAt: unlockedAt + DEVELOPER_UNLOCK_MS,
    isMultipleAccountsOn: true,
    profiles: [{ id: 'profile-one', provider: 'meta', account: 'work' }],
  }
}

// A stable id that never appears in an alias list, standing in for the
// stored random value without touching the filesystem.
const STABLE_ID = 'this-machine-stable-id'

async function openLegacy(storedId: string, currentHost: string) {
  const legacy = unlockedGrant(storedId)
  const h = developerFixture(legacy)
  const owner = await DeveloperOptions.open({
    ...h.deps,
    machineId: STABLE_ID,
    previousMachineIds: developerMachineIdAliases(currentHost),
  })
  expect(owner.snapshot().isUnlocked).toBe(true)
  return { legacy, h, owner }
}

describe('developer machine identity (DEVID017B)', () => {
  it('creates one stored id per machine folder and reuses it', async () => {
    const folder = freshDir()
    const first = await loadDeveloperMachineId(folder)
    expect(first).toMatch(/^[0-9a-f]{64}$/)
    expect(readFileSync(developerMachineIdFile(folder), 'utf8').trim()).toBe(first)
    expect(await loadDeveloperMachineId(folder)).toBe(first)
  })

  it('keeps the unlock and profiles across a rename', async () => {
    const legacy = unlockedGrant(STABLE_ID)
    const h = developerFixture(legacy)
    // The stored id never mentions the hostname, so opening after a rename
    // matches directly; the aliases of the new name are irrelevant.
    const owner = await DeveloperOptions.open({
      ...h.deps,
      machineId: STABLE_ID,
      previousMachineIds: developerMachineIdAliases('renamed-machine'),
    })
    expect(owner.snapshot().isUnlocked).toBe(true)
    expect(owner.snapshot().profiles).toEqual(legacy.profiles)
    expect(owner.snapshot().expiresAt).toBe(legacy.expiresAt)
  })

  it.each([
    ['host', 'host.local'],
    ['host.local', 'host'],
  ])('keeps a legacy grant across %s vs %s', async (storedHost, currentHost) => {
    const { legacy, owner } = await openLegacy(legacyDeveloperMachineId(storedHost), currentHost)
    expect(owner.snapshot().profiles).toEqual(legacy.profiles)
  })

  it('adopts a differently-cased raw hostname', async () => {
    await openLegacy('OLD-MACHINE', 'old-machine')
  })

  it('migrates a legacy raw-hostname grant and drops the hostname on open', async () => {
    const { legacy, h } = await openLegacy('old-machine', 'old-machine')
    // The raw hostname is gone from stored state right after the open: no
    // further save is needed.
    const stored = developerStateSchema.parse(h.persisted())
    expect(stored.machineId).toBe(STABLE_ID)
    expect(stored.unlockedAt).toBe(legacy.unlockedAt)
    expect(stored.expiresAt).toBe(legacy.expiresAt)
    expect(stored.profiles).toEqual(legacy.profiles)
    expect(JSON.stringify(h.persisted())).not.toContain('old-machine')
    expect(h.audits.at(-1)).toMatchObject({ action: 'migrate' })
  })

  it('migrates a legacy digest grant', async () => {
    const legacy = unlockedGrant(legacyDeveloperMachineId('my-pc'))
    const h = developerFixture(legacy)
    const owner = await DeveloperOptions.open({
      ...h.deps,
      machineId: STABLE_ID,
      previousMachineIds: developerMachineIdAliases('my-pc'),
    })
    expect(owner.snapshot().isUnlocked).toBe(true)
    expect(developerStateSchema.parse(h.persisted()).machineId).toBe(STABLE_ID)
  })

  it('creates one id under concurrent first use', async () => {
    const folder = freshDir()
    const ids = await Promise.all(Array.from({ length: 8 }, () => loadDeveloperMachineId(folder)))
    expect(new Set(ids).size).toBe(1)
    expect(readFileSync(developerMachineIdFile(folder), 'utf8').trim()).toBe(ids[0])
  })

  it('refuses honestly when the id file cannot be created or read', async () => {
    const folder = freshDir()
    mkdirSync(developerMachineIdFile(folder))
    const loaded = loadDeveloperMachineId(folder)
    await expect(loaded).rejects.toBeInstanceOf(DeveloperOptionsError)
    await expect(loaded).rejects.toMatchObject({
      code: 'unavailable',
      message: UI_TEXT.developer.unavailable,
    })
    const services = createRuntimeAccountServices({
      dataDir: folder,
      openEntry: memoryKeyring().openEntry,
    })
    try {
      await expect(
        services.developer({ readLine: () => Promise.resolve(''), print: vi.fn() }),
      ).rejects.toMatchObject({ code: 'unavailable' })
    } finally {
      services.dispose()
    }
  })

  it('refuses a different machine identity with an honest message and keeps profiles', async () => {
    const legacy = unlockedGrant('other-machine-identity')
    const h = developerFixture(legacy)
    const opened = DeveloperOptions.open({
      ...h.deps,
      machineId: STABLE_ID,
      previousMachineIds: developerMachineIdAliases(hostname()),
    })
    await expect(opened).rejects.toBeInstanceOf(DeveloperOptionsError)
    await expect(opened).rejects.toMatchObject({
      code: 'differentMachine',
      message: UI_TEXT.developer.differentMachine,
    })
    await expect(opened).rejects.not.toThrow('unavailable')
    expect(h.persisted()).toEqual(legacy)
  })

  it('resets foreign state after confirmation and keeps it on denial', async () => {
    const legacy = unlockedGrant('other-machine-identity')
    const denied = developerFixture(structuredClone(legacy))
    await expect(
      DeveloperOptions.resetForeign(
        { ...denied.deps, machineId: STABLE_ID, confirm: () => Promise.resolve(false) },
        'terminal',
      ),
    ).rejects.toMatchObject({ code: 'differentMachine' })
    expect(developerStateSchema.parse(denied.persisted()).profiles).toEqual(legacy.profiles)

    const h = developerFixture(structuredClone(legacy))
    const snapshot = await DeveloperOptions.resetForeign(
      { ...h.deps, machineId: STABLE_ID },
      'terminal',
    )
    expect(snapshot).toMatchObject({ isUnlocked: false, profiles: [] })
    const cleared = developerStateSchema.parse(h.persisted())
    expect(cleared).toMatchObject({ machineId: STABLE_ID, profiles: [] })
    expect(h.resources.remove).toHaveBeenCalledTimes(1)
    expect(h.audits.at(-1)).toMatchObject({ action: 'reset' })
  })

  it('opens on this machine and persists the stored id', async () => {
    const folder = freshDir()
    const services = createRuntimeAccountServices({
      dataDir: folder,
      openEntry: memoryKeyring().openEntry,
    })
    try {
      const owner = await services.developer({
        readLine: () => Promise.resolve(UI_TEXT.accounts.confirm),
        print: vi.fn(),
      })
      expect(owner.snapshot().isUnlocked).toBe(false)
      await owner.unlock('terminal')
      expect(owner.snapshot().isUnlocked).toBe(true)
      const stored = developerStateSchema.parse(
        JSON.parse(readFileSync(path.join(folder, 'developer', DEVELOPER_FILES.state), 'utf8')),
      )
      // The stored id is the file every host shares, never the hostname.
      expect(stored.machineId).toBe(await loadDeveloperMachineId(folder))
      expect(stored.machineId).not.toContain('.')
    } finally {
      services.dispose()
    }
  })

  it('names the identity on status and recovers through reset', async () => {
    const folder = freshDir()
    mkdirSync(path.join(folder, 'developer'), { recursive: true })
    const unlockedAt = Date.now() - 1000
    writeFileSync(
      path.join(folder, 'developer', DEVELOPER_FILES.state),
      JSON.stringify({
        ...locked,
        machineId: 'foreign-machine-identity',
        unlockedAt,
        expiresAt: unlockedAt + DEVELOPER_UNLOCK_MS,
      }),
    )
    const input = { dataDir: folder, openEntry: memoryKeyring().openEntry }
    const status = await runTerminalDeveloperCommand(
      UI_TEXT,
      'en',
      input,
      { readLine: () => Promise.resolve(''), print: vi.fn() },
      ['developer', 'status'],
      'terminal',
    )
    expect(status).toEqual({ text: UI_TEXT.developer.differentMachine, exitCode: 1 })

    const reset = await runTerminalDeveloperCommand(
      UI_TEXT,
      'en',
      input,
      { readLine: () => Promise.resolve(UI_TEXT.accounts.confirm), print: vi.fn() },
      ['developer', 'reset'],
      'terminal',
    )
    expect(reset.exitCode).toBe(0)
    const cleared = developerStateSchema.parse(
      JSON.parse(readFileSync(path.join(folder, 'developer', DEVELOPER_FILES.state), 'utf8')),
    )
    expect(cleared).toMatchObject({ profiles: [] })
    expect(cleared.machineId).toBe(await loadDeveloperMachineId(folder))

    const again = await runTerminalDeveloperCommand(
      UI_TEXT,
      'en',
      input,
      { readLine: () => Promise.resolve(''), print: vi.fn() },
      ['developer', 'status'],
      'terminal',
    )
    expect(again).toEqual({ text: UI_TEXT.developer.locked, exitCode: 0 })
  })

  it('keeps the legacy derivation pinned for migration aliases', () => {
    // A published vector: the same hostname yields the same alias on every host.
    expect(legacyDeveloperMachineId('macmini.ivettnet')).toBe(
      '1f78da4562a5e81df9a860c494ea41dd6974651d17049b355cb262cee96190d1',
    )
    expect(legacyDeveloperMachineId('host.local')).toBe(
      '84345dbbba633e49930fa0ae278faf4c72c69fb4c14147c0768331f14df9aed6',
    )
    expect(legacyDeveloperMachineId('Host.Local')).toBe(legacyDeveloperMachineId('host.local'))
    // The raw hostname never validates: dots are outside the schema.
    for (const host of ['Macmini.ivettnet', 'host.local'])
      expect(developerStateSchema.safeParse({ ...locked, machineId: host }).success).toBe(false)
    expect(developerMachineIdAliases('host.local')).toContain(
      legacyDeveloperMachineId('host.local'),
    )
    expect(developerMachineIdAliases('host.local')).toContain(legacyDeveloperMachineId('host'))
  })
})
