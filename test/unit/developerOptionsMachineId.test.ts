import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
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
import type { DeveloperProfileResources } from '../../src/core/developer/localProfiles'
import { createRuntimeAccountServices } from '../../src/runtime/providers/runtimeServices'
import { runTerminalDeveloperCommand } from '../../src/runtime/providers/accountsEntry'
import {
  DEVELOPER_FILES,
  DEVELOPER_MACHINE_ID_FILE,
  DEVELOPER_UNLOCK_MS,
  UI_TEXT,
} from '../../src/shared/constants'
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
    const winner = ids[0]
    if (winner === undefined) throw new Error('concurrent creators published no id')
    expect(readFileSync(developerMachineIdFile(folder), 'utf8')).toBe(`${winner}\n`)
    // The staging files are gone: only the published id remains.
    expect(readdirSync(folder)).toEqual([DEVELOPER_MACHINE_ID_FILE])
  })

  it.each([
    ['a partial prefix', '0123456789abcdef'],
    ['a single character', 'a'],
    ['garbage', 'garbage'],
    ['an empty file', ''],
  ])('refuses %s instead of adopting it as the identity', async (_label, contents) => {
    const folder = freshDir()
    writeFileSync(developerMachineIdFile(folder), contents)
    await expect(loadDeveloperMachineId(folder)).rejects.toMatchObject({
      code: 'unavailable',
      message: UI_TEXT.developer.unavailable,
    })
    // The refusal changed nothing: no prefix became an id.
    expect(readFileSync(developerMachineIdFile(folder), 'utf8')).toBe(contents)
  })

  it('never adopts a held partial publish, reading the complete id instead', async () => {
    const folder = freshDir()
    const file = developerMachineIdFile(folder)
    // A creator held mid-publish has only 16 of the 64 characters visible
    // at the published name; it finishes 30 ms later (well inside the
    // reader's retry budget). The reader must never adopt the prefix.
    const completeId = 'ab'.repeat(32)
    writeFileSync(file, '0123456789abcdef')
    setTimeout(() => {
      writeFileSync(file, `${completeId}\n`)
    }, 30)
    await expect(loadDeveloperMachineId(folder)).resolves.toBe(completeId)
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

  it('leaves foreign state untouched when reset is declined', async () => {
    const legacy = unlockedGrant('other-machine-identity')
    const h = developerFixture(structuredClone(legacy))
    const confirm = vi.fn(() => Promise.resolve(false))
    await expect(
      DeveloperOptions.resetForeign({ ...h.deps, machineId: STABLE_ID, confirm }, 'terminal'),
    ).rejects.toMatchObject({
      code: 'differentMachine',
      message: UI_TEXT.developer.differentMachine,
    })
    expect(confirm).toHaveBeenCalledTimes(1)
    // Nothing was mutated before the answer: identity, unlock, profiles
    // and audit sit exactly as before — nothing was re-bound.
    expect(h.persisted()).toEqual(legacy)
    expect(h.audits).toEqual([])
    expect(h.resources.stop).not.toHaveBeenCalled()
    expect(h.resources.remove).not.toHaveBeenCalled()
    // The next open still refuses with the honest identity message.
    await expect(
      DeveloperOptions.open({
        ...h.deps,
        machineId: STABLE_ID,
        previousMachineIds: developerMachineIdAliases(hostname()),
      }),
    ).rejects.toMatchObject({ code: 'differentMachine' })
  })

  it('clears foreign state on confirmation without stopping or transferring', async () => {
    const legacy = unlockedGrant('other-machine-identity')
    const h = developerFixture(structuredClone(legacy))
    // The runtime's resource port is unbound, so every call fails.
    // Recovery must still clear: foreign profiles are never stopped here.
    const unbound: DeveloperProfileResources = {
      start: vi.fn<DeveloperProfileResources['start']>(() =>
        Promise.reject(new DeveloperOptionsError('unavailable')),
      ),
      stop: vi.fn<DeveloperProfileResources['stop']>(() =>
        Promise.reject(new DeveloperOptionsError('unavailable')),
      ),
      remove: vi.fn<DeveloperProfileResources['remove']>(() =>
        Promise.reject(new DeveloperOptionsError('unavailable')),
      ),
    }
    const snapshot = await DeveloperOptions.resetForeign(
      { ...h.deps, machineId: STABLE_ID, resources: unbound },
      'terminal',
    )
    expect(snapshot).toMatchObject({
      isUnlocked: false,
      isMultipleAccountsOn: false,
      expiresAt: null,
      profiles: [],
    })
    const cleared = developerStateSchema.parse(h.persisted())
    expect(cleared.machineId).toBe(STABLE_ID)
    expect(cleared.unlockedAt).toBeNull()
    expect(cleared.expiresAt).toBeNull()
    expect(cleared.isMultipleAccountsOn).toBe(false)
    expect(cleared.profiles).toEqual([])
    // Nothing of the grant moved across: no stop, no removal, and the
    // only audit row is the reset itself — no disable, no per-profile row.
    expect(unbound.stop).not.toHaveBeenCalled()
    expect(unbound.remove).not.toHaveBeenCalled()
    expect(h.audits).toEqual([expect.objectContaining({ action: 'reset', source: 'terminal' })])
    // The next open on this machine is a fresh state, not a refusal.
    const owner = await DeveloperOptions.open({ ...h.deps, machineId: STABLE_ID })
    expect(owner.snapshot()).toMatchObject({ isUnlocked: false, profiles: [] })
  })

  it('transfers nothing when the reset save fails', async () => {
    const legacy = unlockedGrant('other-machine-identity')
    const h = developerFixture(structuredClone(legacy))
    vi.mocked(h.deps.store.commit).mockRejectedValueOnce(new Error('disk full'))
    await expect(
      DeveloperOptions.resetForeign({ ...h.deps, machineId: STABLE_ID }, 'terminal'),
    ).rejects.toThrow('disk full')
    // The foreign grant sits exactly as before: no re-bind, no clearing.
    expect(h.persisted()).toEqual(legacy)
    expect(h.audits).toEqual([])
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
        isMultipleAccountsOn: true,
        profiles: [{ id: 'profile-one', provider: 'meta', account: 'work' }],
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
    // The runtime's resource port is unbound, yet recovery cleared the
    // foreign grant: no unlock, no registration, nothing transferred.
    expect(cleared).toMatchObject({
      unlockedAt: null,
      expiresAt: null,
      isMultipleAccountsOn: false,
      profiles: [],
    })
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
