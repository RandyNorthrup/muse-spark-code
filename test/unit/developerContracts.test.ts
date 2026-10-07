import { describe, expect, it } from 'vitest'
import { DEVELOPER_MAX_PROFILES, DEVELOPER_UNLOCK_MS } from '../../src/shared/constants'
import {
  developerAuditSchema,
  developerReplySchema,
  developerRequestSchema,
  developerStateSchema,
} from '../../src/shared/developerOptions'

const empty = {
  v: 1,
  machineId: 'machine',
  unlockedAt: null,
  expiresAt: null,
  isMultipleAccountsOn: false,
  profiles: [],
}
const unlocked = { ...empty, unlockedAt: 100, expiresAt: 100 + DEVELOPER_UNLOCK_MS }
const profile = { id: 'profile-one', provider: 'meta', account: 'work' }

describe('Developer options boundary contracts', () => {
  it('accepts the off default, finite unlock and credential-free profile', () => {
    expect(developerStateSchema.safeParse(empty).success).toBe(true)
    expect(
      developerStateSchema.safeParse({
        ...unlocked,
        isMultipleAccountsOn: true,
        profiles: [profile],
      }).success,
    ).toBe(true)
  })
  it.each([
    { ...empty, machineId: '' },
    { ...empty, machineId: 'owner@example.com' },
    { ...empty, isMultipleAccountsOn: true },
    { ...empty, expiresAt: 1 },
    { ...unlocked, expiresAt: 100 },
    { ...unlocked, expiresAt: 100 + DEVELOPER_UNLOCK_MS + 1 },
    { ...unlocked, unlockedAt: -1 },
    { ...unlocked, expiresAt: NaN },
    { ...unlocked, profiles: [profile, profile] },
    { ...unlocked, profiles: [profile, { ...profile, id: 'other' }] },
    { ...unlocked, profiles: [{ ...profile, id: '../escape' }] },
    { ...unlocked, profiles: [{ ...profile, secret: 'canary' }] },
    { ...unlocked, profiles: [{ ...profile, stateFolder: '/private' }] },
    {
      ...unlocked,
      profiles: Array.from({ length: DEVELOPER_MAX_PROFILES + 1 }, (_, n) => ({
        ...profile,
        id: `profile-${String(n)}`,
        account: `account-${String(n)}`,
      })),
    },
    { ...empty, apiKey: 'canary' },
  ])('rejects invalid or credential-bearing machine state %#', (state) => {
    expect(developerStateSchema.safeParse(state).success).toBe(false)
  })
  it.each([
    { type: 'developer/unlock', machineId: 'another' },
    { type: 'developer/unlock', source: 'terminal' },
    { type: 'developer/setMultiple', enabled: true, confirmed: true },
    { type: 'developer/addProfile', provider: 'meta', account: 'work', credential: 'canary' },
    { type: 'developer/addProfile', provider: 'meta', account: '../escape' },
    { type: 'developer/reset', paths: ['/private'] },
  ])('refuses page-owned authority, credentials and paths %#', (message) => {
    expect(developerRequestSchema.safeParse(message).success).toBe(false)
  })
  it('rejects leaked fields from replies and audit and inconsistent enabled snapshots', () => {
    const snapshot = {
      type: 'developer/state',
      isUnlocked: false,
      isMultipleAccountsOn: false,
      expiresAt: null,
      profiles: [],
    }
    expect(developerReplySchema.safeParse(snapshot).success).toBe(true)
    expect(
      developerReplySchema.safeParse({ ...snapshot, isMultipleAccountsOn: true }).success,
    ).toBe(false)
    expect(developerReplySchema.safeParse({ ...snapshot, machineId: 'machine' }).success).toBe(
      false,
    )
    const audit = { v: 1, time: 100, action: 'create', source: 'page', profile: 'profile-one' }
    expect(developerAuditSchema.safeParse(audit).success).toBe(true)
    for (const field of ['secret', 'label', 'origin', 'path', 'provider', 'account'])
      expect(developerAuditSchema.safeParse({ ...audit, [field]: 'canary' }).success).toBe(false)
  })
})
