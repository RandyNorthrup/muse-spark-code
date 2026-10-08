import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  mkdtemp,
  readFile,
  writeFile,
  mkdir,
  lstat,
  symlink,
  rm,
  link,
  readdir,
  rename,
} from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import type * as FsPromises from 'node:fs/promises'
import { DeveloperLocalFiles } from '../../src/runtime/developer/localFiles'
import {
  DEVELOPER_AUDIT_MAX_BYTES,
  DEVELOPER_FILES,
  DEVELOPER_STATE_MAX_BYTES,
  DEVELOPER_UNLOCK_MS,
} from '../../src/shared/constants'
import type { DeveloperAudit, DeveloperState } from '../../src/shared/developerOptions'

vi.mock('node:fs/promises', async (importOriginal) => {
  const fs = await importOriginal<typeof FsPromises>()
  return { ...fs, rename: vi.fn(fs.rename) }
})

const roots: string[] = []
afterEach(async () => {
  for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true })
})
async function files() {
  const root = await mkdtemp(path.join(os.tmpdir(), 'm108-x-'))
  roots.push(root)
  return {
    root,
    store: new DeveloperLocalFiles(path.join(root, 'developer')),
    statePath: path.join(root, 'developer', DEVELOPER_FILES.state),
    auditPath: path.join(root, 'developer', DEVELOPER_FILES.audit),
  }
}
const state: DeveloperState = {
  v: 1,
  machineId: 'this-machine',
  unlockedAt: 100,
  expiresAt: 100 + DEVELOPER_UNLOCK_MS,
  isMultipleAccountsOn: false,
  profiles: [],
}
const audit: DeveloperAudit = { v: 1, time: 100, action: 'unlock', source: 'palette' }

describe('private local Developer state and audit files', () => {
  it.each(['disable', 'expire', 'reset'] as const)(
    'restores off after a failed %s state rename',
    async (action) => {
      const h = await files()
      const enabled = { ...state, isMultipleAccountsOn: true }
      await h.store.commit(enabled, { ...audit, action: 'enable' })
      vi.mocked(rename).mockRejectedValueOnce(new Error('rename failed'))
      await expect(h.store.commit({ ...state }, { ...audit, action })).rejects.toThrow(
        'rename failed',
      )
      expect(JSON.parse(await readFile(h.statePath, 'utf8'))).toEqual(enabled)
      expect(await new DeveloperLocalFiles(path.dirname(h.statePath)).read()).toEqual(state)
    },
  )

  it('atomically persists validated state and a credential-free authorization audit', async () => {
    const h = await files()
    expect(await h.store.read()).toBeUndefined()
    await h.store.commit(state, audit)
    expect(await h.store.read()).toEqual(state)
    const auditRow = await readFile(h.auditPath, 'utf8')
    expect(JSON.parse(auditRow.trim())).toEqual(audit)
    expect(new Set(await readdir(path.dirname(h.statePath)))).toEqual(
      new Set([DEVELOPER_FILES.audit, DEVELOPER_FILES.state]),
    )
    if (process.platform === 'win32') return
    const stateInfo = await lstat(h.statePath)
    expect(stateInfo.mode & 0o777).toBe(0o600)
    const rootInfo = await lstat(path.dirname(h.statePath))
    expect(rootInfo.mode & 0o777).toBe(0o700)
  })

  it('rejects oversized or corrupt state without an empty successful restore', async () => {
    const h = await files()
    await h.store.read()
    await writeFile(h.statePath, ' '.repeat(DEVELOPER_STATE_MAX_BYTES + 1))
    await expect(h.store.read()).rejects.toThrow()
    await writeFile(h.statePath, '{corrupt')
    await expect(h.store.read()).rejects.toThrow()
  })

  it('keeps existing state off when the audit cannot be appended', async () => {
    const h = await files()
    await h.store.commit(state, audit)
    await rm(h.auditPath)
    await mkdir(h.auditPath)
    await expect(
      h.store.commit({ ...state, isMultipleAccountsOn: true }, { ...audit, action: 'enable' }),
    ).rejects.toThrow()
    expect(await h.store.read()).toEqual(state)
  })

  it('publishes revocation even when the audit append fails', async () => {
    const h = await files()
    await h.store.commit({ ...state, isMultipleAccountsOn: true }, { ...audit, action: 'enable' })
    await rm(h.auditPath)
    await mkdir(h.auditPath)
    await expect(h.store.commit(state, { ...audit, action: 'disable' })).rejects.toThrow()
    expect(await h.store.read()).toEqual(state)
  })

  it('never publishes a reset clear when the audit append fails', async () => {
    const h = await files()
    const enabled = { ...state, isMultipleAccountsOn: true }
    await h.store.commit(enabled, { ...audit, action: 'enable' })
    await rm(h.auditPath)
    await mkdir(h.auditPath)
    const cleared = { ...state, unlockedAt: null, expiresAt: null }
    await expect(h.store.commit(cleared, { ...audit, action: 'reset' })).rejects.toThrow()
    // The stored grant is untouched: no unaudited clearing was published.
    expect(JSON.parse(await readFile(h.statePath, 'utf8'))).toEqual(enabled)
  })

  it('bounds the local audit and retains only one previous segment', async () => {
    const h = await files()
    await h.store.commit(state, audit)
    await writeFile(h.auditPath, 'x'.repeat(DEVELOPER_AUDIT_MAX_BYTES))
    await h.store.commit(state, { ...audit, action: 'enable' })
    const currentAudit = await readFile(h.auditPath, 'utf8')
    expect(currentAudit.trim()).toContain('enable')
    const firstPrevious = await lstat(`${h.auditPath}.previous`)
    expect(firstPrevious.size).toBe(DEVELOPER_AUDIT_MAX_BYTES)
    await writeFile(h.auditPath, 'x'.repeat(DEVELOPER_AUDIT_MAX_BYTES))
    await h.store.commit(state, { ...audit, action: 'disable' })
    const secondPrevious = await lstat(`${h.auditPath}.previous`)
    expect(secondPrevious.size).toBe(DEVELOPER_AUDIT_MAX_BYTES)
  })

  it('isolates profile folders, validates ids and removes only the requested profile', async () => {
    const h = await files()
    const one = await h.store.prepare('profile-one')
    const two = await h.store.prepare('profile-two')
    expect(one.replaceAll('\\', '/')).toContain('/profiles/profile-one')
    await writeFile(path.join(one, 'state.json'), 'profile one')
    await writeFile(path.join(two, 'state.json'), 'profile two')
    await h.store.remove('profile-one')
    expect(await readFile(path.join(two, 'state.json'), 'utf8')).toBe('profile two')
    await h.store.remove('profile-one')
    for (const id of ['../escape', String.raw`..\escape`, '/absolute', String.raw`C:\private`]) {
      await expect(h.store.prepare(id)).rejects.toThrow()
      await expect(h.store.remove(id)).rejects.toThrow()
    }
  })

  it('unlinks a profile symlink or junction without touching its target', async () => {
    const h = await files()
    await h.store.prepare('profile-one')
    const outside = path.join(h.root, 'outside')
    await mkdir(outside)
    await writeFile(path.join(outside, 'keep'), 'keep')
    const profilePath = path.join(h.root, 'developer', 'profiles', 'profile-one')
    await rm(profilePath, { recursive: true })
    await symlink(outside, profilePath, process.platform === 'win32' ? 'junction' : 'dir')
    await h.store.remove('profile-one')
    expect(await readFile(path.join(outside, 'keep'), 'utf8')).toBe('keep')
    await expect(lstat(profilePath)).rejects.toMatchObject({ code: 'ENOENT' })
  })

  it('refuses a symlinked profile parent and linked state or audit files', async () => {
    const h = await files()
    await h.store.prepare('profile-one')
    const parent = path.join(h.root, 'developer', 'profiles')
    const outside = path.join(h.root, 'outside')
    await mkdir(outside)
    await rm(parent, { recursive: true })
    await symlink(outside, parent, process.platform === 'win32' ? 'junction' : 'dir')
    await expect(h.store.prepare('profile-two')).rejects.toThrow()
    await expect(h.store.remove('profile-two')).rejects.toThrow()
    expect(await readdir(outside)).toEqual([])
    const payload = path.join(outside, 'payload')
    await writeFile(payload, JSON.stringify(state))
    await link(payload, h.statePath)
    await expect(h.store.read()).rejects.toThrow()
    await expect(h.store.commit(state, audit)).rejects.toThrow()
    await rm(h.statePath)
    await link(payload, h.auditPath)
    await expect(h.store.commit(state, audit)).rejects.toThrow()
    expect(await readFile(payload, 'utf8')).toBe(JSON.stringify(state))
  })

  it('refuses a symlinked storage root before publishing anything', async () => {
    const h = await files()
    const outside = path.join(h.root, 'outside')
    await mkdir(outside)
    await symlink(
      outside,
      path.dirname(h.statePath),
      process.platform === 'win32' ? 'junction' : 'dir',
    )
    await expect(h.store.commit(state, audit)).rejects.toThrow()
    expect(await readdir(outside)).toEqual([])
  })
})
