import { describe, expect, it } from 'vitest'
import {
  createBundledSkillsOffer,
  type BundledSkillsOfferDeps,
} from '../../src/host/skills/bundledSkills'
import type { BundledSkillsStatus } from '../../src/host/skills/bundledSkillsInstall'

const KEYS = { installDeclined: 'install', updateDeclined: 'update' }

function memory() {
  const values = new Map<string, unknown>()
  return {
    values,
    get: (key: string): unknown => values.get(key),
    update: (key: string, value: unknown): Promise<void> => {
      values.set(key, value)
      return Promise.resolve()
    },
  }
}

const notInstalled: BundledSkillsStatus = {
  kind: 'notInstalled',
  vendorTag: 'v0.7.0',
  skillIds: ['plan'],
}

function offerFor(
  status: () => Promise<BundledSkillsStatus>,
  state = memory(),
): {
  readonly state: ReturnType<typeof memory>
  readonly offer: ReturnType<typeof createBundledSkillsOffer>
} {
  const offer = createBundledSkillsOffer({
    isEnabled: () => true,
    state,
    keys: KEYS,
    status,
  } satisfies BundledSkillsOfferDeps)
  return { state, offer }
}

describe('bundled skills Not now across windows', () => {
  it('remembers Not now for a later window that never showed the notice', async () => {
    const shared = memory()
    const first = offerFor(() => Promise.resolve(notInstalled), shared)
    await first.offer.next()
    await first.offer.decline()
    expect(shared.values.get('install')).toBe(true)
    // A new window: its own offer, the same stored answer, no notice shown.
    const second = offerFor(() => Promise.resolve(notInstalled), shared)
    await expect(second.offer.next()).resolves.toBeUndefined()
  })

  it('remembers a click that arrives without this window ever offering', async () => {
    // A host restart between the offer and the click (or a second window's
    // session): `shown` is empty, yet the panel still shows Not now. The
    // copy's state then decides what the click declines.
    const shared = memory()
    const restarted = offerFor(() => Promise.resolve(notInstalled), shared)
    await restarted.offer.decline()
    expect(shared.values.get('install')).toBe(true)
    const later = offerFor(() => Promise.resolve(notInstalled), shared)
    await expect(later.offer.next()).resolves.toBeUndefined()
  })

  it('a stray click with a current copy remembers nothing', async () => {
    const shared = memory()
    const current: BundledSkillsStatus = {
      kind: 'installed',
      installedTag: 'v0.7.0',
      vendorTag: 'v0.7.0',
      skillIds: ['plan'],
    }
    const restarted = offerFor(() => Promise.resolve(current), shared)
    await restarted.offer.decline()
    expect(shared.values.size).toBe(0)
  })

  it('a stray click on an update remembers that release, not the install', async () => {
    const shared = memory()
    const outdated: BundledSkillsStatus = {
      kind: 'installed',
      installedTag: 'v0.6.0',
      vendorTag: 'v0.7.0',
      skillIds: ['plan'],
    }
    const restarted = offerFor(() => Promise.resolve(outdated), shared)
    await restarted.offer.decline()
    expect(shared.values.get('update')).toBe('v0.7.0')
    expect(shared.values.has('install')).toBe(false)
  })
})
