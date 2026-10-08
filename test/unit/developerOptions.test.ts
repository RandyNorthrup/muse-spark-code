import { describe, expect, it, vi } from 'vitest'
import { DeveloperOptions } from '../../src/core/developer/developerOptions'
import {
  DEVELOPER_CLICK_WINDOW_MS,
  DEVELOPER_UNLOCK_MS,
  DEVELOPER_VERSION_CLICKS,
} from '../../src/shared/constants'
import { developerStateSchema } from '../../src/shared/developerOptions'
import { developerFixture, enabledDeveloper } from './helpers/developer'

describe('machine-local Developer options', () => {
  it('rejects an unknown removal without changing state or live resources', async () => {
    const h = await enabledDeveloper()
    await h.owner.addProfile('meta', 'work')
    const before = h.owner.snapshot()
    const publications = h.snapshots.length
    await expect(h.owner.removeProfile('missing')).rejects.toMatchObject({ code: 'invalidRequest' })
    expect(h.owner.snapshot()).toEqual(before)
    expect(h.snapshots).toHaveLength(publications)
    expect(h.admits.get('profile-1')?.()).toBe(true)
    expect(h.resources.stop).not.toHaveBeenCalled()
    expect(h.resources.remove).not.toHaveBeenCalled()
  })

  it.each(['disable', 'expiry', 'reset'] as const)(
    'stops profiles before a failed %s save',
    async (action) => {
      const h = await enabledDeveloper()
      await h.owner.addProfile('meta', 'work')
      const admit = h.admits.get('profile-1')
      vi.mocked(h.deps.store.commit).mockImplementationOnce(() => {
        expect(admit?.()).toBe(false)
        expect(h.resources.stop).toHaveBeenCalledTimes(1)
        return Promise.reject(new Error('save failed'))
      })
      if (action === 'expiry') h.advance(DEVELOPER_UNLOCK_MS)
      const revokes = {
        disable: () => h.owner.setMultiple(false),
        expiry: () => h.owner.refresh(),
        reset: () => h.owner.reset(),
      }
      const revoke = revokes[action]()
      await expect(revoke).rejects.toThrow('save failed')
      expect(h.owner.isMultipleAccountsOn()).toBe(false)
      expect(h.resources.stop).toHaveBeenCalledTimes(1)
    },
  )

  it('starts locked and refuses multiple accounts and profiles before unlock', async () => {
    const h = developerFixture()
    const owner = await h.open()
    expect(owner.snapshot()).toMatchObject({
      isUnlocked: false,
      isMultipleAccountsOn: false,
      expiresAt: null,
      profiles: [],
    })
    await expect(owner.setMultiple(true)).rejects.toMatchObject({ code: 'locked' })
    await expect(owner.addProfile('meta', 'work')).rejects.toMatchObject({ code: 'locked' })
    expect(h.deps.confirm).not.toHaveBeenCalled()
  })

  it.each(['palette', 'terminal'] as const)(
    'unlocks through %s but never enables profiles implicitly',
    async (source) => {
      const h = developerFixture()
      const owner = await h.open()
      await owner.unlock(source)
      expect(owner.snapshot()).toMatchObject({
        isUnlocked: true,
        isMultipleAccountsOn: false,
        expiresAt: h.now() + DEVELOPER_UNLOCK_MS,
      })
      expect(h.audits).toMatchObject([{ action: 'unlock', source }])
      await owner.unlock(source)
      expect(h.deps.confirm).toHaveBeenCalledTimes(1)
    },
  )

  it('requires seven version clicks on the same surface within the complete time window', async () => {
    const h = developerFixture()
    const owner = await h.open()
    for (let n = 1; n < DEVELOPER_VERSION_CLICKS; n += 1) await owner.versionClick('panel')
    await owner.versionClick('other')
    expect(owner.snapshot().isUnlocked).toBe(false)
    h.advance(DEVELOPER_CLICK_WINDOW_MS + 1)
    await owner.versionClick('panel')
    expect(owner.snapshot().isUnlocked).toBe(false)
    for (let n = 1; n < DEVELOPER_VERSION_CLICKS; n += 1) await owner.versionClick('panel')
    expect(owner.snapshot().isUnlocked).toBe(true)
    expect(h.audits[0]).toMatchObject({ action: 'unlock', source: 'version' })
  })

  it('does not extend the click window on each click', async () => {
    const h = developerFixture()
    const owner = await h.open()
    for (let n = 0; n < DEVELOPER_VERSION_CLICKS; n += 1) {
      await owner.versionClick('panel')
      h.advance(DEVELOPER_CLICK_WINDOW_MS / 2)
    }
    expect(owner.snapshot().isUnlocked).toBe(false)
  })

  it('requires separate explicit confirmation for the visible setting', async () => {
    const h = developerFixture()
    const owner = await h.open()
    vi.mocked(h.deps.confirm).mockResolvedValueOnce(false)
    const refusedUnlock = await owner.unlock('palette')
    expect(refusedUnlock.isUnlocked).toBe(false)
    await owner.unlock('palette')
    vi.mocked(h.deps.confirm).mockResolvedValueOnce(false)
    const refusedEnable = await owner.setMultiple(true)
    expect(refusedEnable.isMultipleAccountsOn).toBe(false)
    await Promise.all([owner.setMultiple(true), owner.setMultiple(true)])
    expect(owner.isMultipleAccountsOn()).toBe(true)
    expect(vi.mocked(h.deps.confirm).mock.calls.map(([question]) => question)).toEqual([
      'unlock',
      'unlock',
      'multiple',
      'multiple',
    ])
  })

  it('invalidates a late enable confirmation synchronously on disable', async () => {
    const h = developerFixture()
    const owner = await h.open()
    await owner.unlock('palette')
    const question = Promise.withResolvers<boolean>()
    vi.mocked(h.deps.confirm).mockReturnValueOnce(question.promise)
    const enabling = owner.setMultiple(true)
    const refused = expect(enabling).rejects.toMatchObject({ code: 'locked' })
    await vi.waitFor(() => {
      expect(h.deps.confirm).toHaveBeenCalledWith('multiple')
    })
    const disabling = owner.setMultiple(false)
    question.resolve(true)
    await refused
    await disabling
    expect(owner.isMultipleAccountsOn()).toBe(false)
    expect(h.audits.some((row) => row.action === 'enable')).toBe(false)
  })

  it('cannot publish a stale enabled state after a pending write and Reset', async () => {
    const h = developerFixture()
    const owner = await h.open()
    await owner.unlock('palette')
    const write = Promise.withResolvers<undefined>()
    const original = h.deps.store.commit
    vi.mocked(original).mockImplementationOnce(async (state, audit) => {
      await write.promise
      await original(state, audit)
    })
    const enabling = owner.setMultiple(true)
    const refused = expect(enabling).rejects.toMatchObject({ code: 'locked' })
    await vi.waitFor(() => {
      expect(h.deps.store.commit).toHaveBeenCalledTimes(2)
    })
    const reset = owner.reset()
    expect(owner.isMultipleAccountsOn()).toBe(false)
    write.resolve(undefined)
    await refused
    await reset
    expect(developerStateSchema.parse(h.persisted())).toMatchObject({
      unlockedAt: null,
      isMultipleAccountsOn: false,
      profiles: [],
    })
  })

  it('records profiles before launch and refuses an ineligible account before creating resources', async () => {
    const h = await enabledDeveloper()
    vi.mocked(h.deps.checkAccount).mockRejectedValueOnce(new Error('not offered'))
    await expect(h.owner.addProfile('meta', 'work')).rejects.toThrow('not offered')
    expect(h.owner.snapshot().profiles).toEqual([])
    expect(h.resources.start).not.toHaveBeenCalled()
    await h.owner.addProfile('meta', 'work')
    expect(h.audits.at(-1)).toMatchObject({ action: 'create', profile: 'profile-2' })
    expect(h.owner.snapshot().profiles[0]).toMatchObject({ provider: 'meta', account: 'work' })
    await expect(h.owner.addProfile('meta', 'work')).rejects.toThrow()
  })

  it('expires at the exact boundary, withdraws admission immediately and retains profile ownership', async () => {
    const h = await enabledDeveloper()
    await h.owner.addProfile('meta', 'work')
    const admit = h.admits.get('profile-1')
    expect(admit?.()).toBe(true)
    h.advance(DEVELOPER_UNLOCK_MS - 1)
    expect(admit?.()).toBe(true)
    h.advance(1)
    expect(admit?.()).toBe(false)
    expect(h.owner.snapshot().isUnlocked).toBe(false)
    await h.owner.refresh()
    expect(h.resources.stop).toHaveBeenCalledTimes(1)
    expect(h.resources.remove).not.toHaveBeenCalled()
    expect(h.owner.snapshot().profiles).toHaveLength(1)
    expect(h.audits.at(-1)?.action).toBe('expire')
  })

  it('fences a pending account check before it can create a profile', async () => {
    const h = await enabledDeveloper()
    const lookup = Promise.withResolvers<undefined>()
    vi.mocked(h.deps.checkAccount).mockReturnValueOnce(lookup.promise)
    const adding = h.owner.addProfile('meta', 'work')
    const refused = expect(adding).rejects.toMatchObject({ code: 'locked' })
    await vi.waitFor(() => {
      expect(h.deps.checkAccount).toHaveBeenCalled()
    })
    h.advance(DEVELOPER_UNLOCK_MS)
    const expiry = h.owner.refresh()
    lookup.resolve(undefined)
    await refused
    await expiry
    expect(h.resources.start).not.toHaveBeenCalled()
    expect(h.owner.snapshot().profiles).toEqual([])
  })

  it('stops a late profile launch after Reset without losing its cleanup ledger', async () => {
    const h = await enabledDeveloper()
    const started = Promise.withResolvers<undefined>()
    vi.mocked(h.resources.start).mockReturnValueOnce(started.promise)
    const adding = h.owner.addProfile('meta', 'work')
    const refused = expect(adding).rejects.toMatchObject({ code: 'locked' })
    await vi.waitFor(() => {
      expect(h.resources.start).toHaveBeenCalled()
    })
    const reset = h.owner.reset()
    started.resolve(undefined)
    await refused
    await reset
    expect(h.resources.remove).toHaveBeenCalledWith({
      id: 'profile-1',
      provider: 'meta',
      account: 'work',
    })
    expect(h.owner.snapshot()).toMatchObject({
      isUnlocked: false,
      isMultipleAccountsOn: false,
      profiles: [],
    })
  })

  it('denied Reset still stops profiles but never deletes resources', async () => {
    const h = await enabledDeveloper()
    await h.owner.addProfile('meta', 'work')
    vi.mocked(h.deps.confirm).mockResolvedValueOnce(false)
    await h.owner.reset()
    expect(h.resources.stop).toHaveBeenCalled()
    expect(h.resources.remove).not.toHaveBeenCalled()
    expect(h.owner.snapshot().profiles).toHaveLength(1)
    expect(h.owner.isMultipleAccountsOn()).toBe(false)
  })

  it('persists disable before a failed stop and preserves failed removals for retry', async () => {
    const h = await enabledDeveloper()
    await h.owner.addProfile('meta', 'work')
    vi.mocked(h.resources.stop).mockRejectedValueOnce(new Error('stop failed'))
    await expect(h.owner.setMultiple(false)).rejects.toMatchObject({ code: 'unavailable' })
    expect(developerStateSchema.parse(h.persisted()).isMultipleAccountsOn).toBe(false)
    vi.mocked(h.resources.remove).mockRejectedValueOnce(new Error('remove failed'))
    await expect(h.owner.reset()).rejects.toThrow('remove failed')
    expect(h.owner.snapshot().profiles).toHaveLength(1)
    await h.owner.reset()
    expect(h.owner.snapshot().profiles).toEqual([])
  })

  it('removal disables and stops all profiles, and never invents a cleanup target', async () => {
    const h = await enabledDeveloper()
    await h.owner.addProfile('meta', 'work')
    await h.owner.addProfile('meta', 'personal')
    await h.owner.removeProfile('profile-1')
    expect(h.resources.stop).toHaveBeenCalledTimes(2)
    expect(h.owner.snapshot().profiles).toMatchObject([{ id: 'profile-2' }])
    expect(h.owner.isMultipleAccountsOn()).toBe(false)
    await expect(h.owner.removeProfile('../outside')).rejects.toMatchObject({
      code: 'invalidRequest',
    })
    expect(h.resources.remove).toHaveBeenCalledTimes(1)
  })

  it('refuses enabling after audit/storage failure without a successful publication', async () => {
    const h = developerFixture()
    const owner = await h.open()
    vi.mocked(h.deps.store.commit).mockRejectedValueOnce(new Error('audit failed'))
    await expect(owner.unlock('palette')).rejects.toThrow('audit failed')
    expect(owner.snapshot().isUnlocked).toBe(false)
    await owner.unlock('palette')
    vi.mocked(h.deps.store.commit).mockRejectedValueOnce(new Error('audit failed'))
    await expect(owner.setMultiple(true)).rejects.toThrow('audit failed')
    expect(owner.isMultipleAccountsOn()).toBe(false)
  })

  it('restores only this machine’s unexpired grant without extending expiry', async () => {
    const h = await enabledDeveloper()
    await h.owner.addProfile('meta', 'work')
    const stored = developerStateSchema.parse(h.persisted())
    const restored = developerFixture(stored)
    const owner = await restored.open()
    expect(owner.snapshot().expiresAt).toBe(stored.expiresAt)
    expect(restored.resources.start).toHaveBeenCalledTimes(1)
    await expect(
      DeveloperOptions.open({ ...restored.deps, machineId: 'other-machine' }),
    ).rejects.toMatchObject({ code: 'unavailable' })
    const future = developerFixture({
      ...stored,
      unlockedAt: stored.unlockedAt === null ? 1 : stored.unlockedAt + 1,
    })
    await expect(future.open()).rejects.toMatchObject({ code: 'unavailable' })
  })

  it('clears an expired restored grant before any process starts', async () => {
    const h = await enabledDeveloper()
    await h.owner.addProfile('meta', 'work')
    const restored = developerFixture(h.persisted())
    restored.advance(DEVELOPER_UNLOCK_MS)
    const reopened = await restored.open()
    expect(reopened.snapshot()).toMatchObject({
      isUnlocked: false,
      isMultipleAccountsOn: false,
    })
    expect(restored.resources.start).not.toHaveBeenCalled()
    expect(restored.resources.stop).toHaveBeenCalledTimes(1)
  })
})
