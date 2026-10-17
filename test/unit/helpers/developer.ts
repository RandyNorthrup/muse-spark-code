import { vi } from 'vitest'
import {
  DeveloperOptions,
  type DeveloperOptionsDeps,
} from '../../../src/core/developer/developerOptions'
import type { DeveloperProfileResources } from '../../../src/core/developer/localProfiles'
import type {
  DeveloperAudit,
  DeveloperSnapshot,
  DeveloperState,
} from '../../../src/shared/developerOptions'

export function developerFixture(stored?: unknown) {
  let time = Date.parse('2026-10-06T12:00:00Z')
  let persisted: unknown = stored
  let serial = 0
  const audits: DeveloperAudit[] = []
  const snapshots: DeveloperSnapshot[] = []
  const admits = new Map<string, () => boolean>()
  const resources: DeveloperProfileResources = {
    start: vi.fn<DeveloperProfileResources['start']>((profile, current) => {
      admits.set(profile.id, current)
      return Promise.resolve()
    }),
    stop: vi.fn<DeveloperProfileResources['stop']>((profile) => {
      admits.delete(profile.id)
      return Promise.resolve()
    }),
    remove: vi.fn<DeveloperProfileResources['remove']>((profile) => {
      admits.delete(profile.id)
      return Promise.resolve()
    }),
  }
  const deps: DeveloperOptionsDeps = {
    machineId: 'this-machine',
    now: () => time,
    newProfileId: () => `profile-${String(++serial)}`,
    store: {
      read: vi.fn(() => Promise.resolve(persisted)),
      commit: vi.fn((state: DeveloperState, audit: DeveloperAudit) => {
        persisted = structuredClone(state)
        audits.push(audit)
        return Promise.resolve()
      }),
    },
    resources,
    checkAccount: vi.fn(() => Promise.resolve()),
    confirm: vi.fn(() => Promise.resolve(true)),
    changed: (snapshot) => {
      snapshots.push(snapshot)
    },
  }
  return {
    deps,
    resources,
    admits,
    audits,
    snapshots,
    now: () => time,
    advance: (ms: number) => {
      time += ms
    },
    persisted: () => persisted,
    open: () => DeveloperOptions.open(deps),
  }
}

export async function enabledDeveloper() {
  const fixture = developerFixture()
  const owner = await fixture.open()
  await owner.unlock('palette')
  await owner.setMultiple(true)
  return { ...fixture, owner }
}
