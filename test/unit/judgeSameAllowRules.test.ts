// Lane M98-S: the CLI user-settings allow-rule check (PLAN.md M98 acceptance
// item 5). Missing settings or no standing selection stays on; standing
// always-allows for write or network, unidentified dimensions, dangling or
// cyclic profiles, and anything unverifiable turn the judge off. Shapes from
// the Muse Code 1.4.2 capture (docs/certification/m98-s.md).

import { describe, expect, it } from 'vitest'
import { checkStandingAllowRules } from '../../src/core/judge/same/allowRules'

function settings(permissions: unknown): string {
  return JSON.stringify({ schema_version: 1, permissions })
}

const RESTRICTIVE = {
  schema_version: 1,
  default_profile: 'ask',
  profiles: {
    ask: {
      description: 'Ask me',
      filesystem: { mode: 'read' },
      network: { mode: 'restricted', targets: {} },
    },
  },
}

describe('checkStandingAllowRules', () => {
  it('stays on with no settings file', () => {
    expect(checkStandingAllowRules(undefined)).toEqual({ allowed: true })
  })

  it('stays on with no permissions block or no standing selection', () => {
    expect(checkStandingAllowRules(JSON.stringify({ schema_version: 1 }))).toEqual({
      allowed: true,
    })
    expect(
      checkStandingAllowRules(
        settings({ schema_version: 1, profiles: { ask: RESTRICTIVE.profiles.ask } }),
      ),
    ).toEqual({ allowed: true })
  })

  it('stays on for a restrictive default profile', () => {
    expect(checkStandingAllowRules(settings(RESTRICTIVE))).toEqual({ allowed: true })
  })

  it('turns off on a standing write allow', () => {
    const text = settings({
      schema_version: 1,
      default_profile: 'open',
      profiles: {
        open: { filesystem: { mode: 'write' }, network: { mode: 'restricted', targets: {} } },
      },
    })
    expect(checkStandingAllowRules(text)).toEqual({
      allowed: false,
      reason: 'standing-allow-rules',
    })
  })

  it('turns off on a standing network allow', () => {
    const text = settings({
      schema_version: 1,
      default_profile: 'open',
      profiles: {
        open: { filesystem: { mode: 'read' }, network: { mode: 'enabled' } },
      },
    })
    expect(checkStandingAllowRules(text)).toEqual({
      allowed: false,
      reason: 'standing-allow-rules',
    })
  })

  it('turns off on non-empty network targets', () => {
    const text = settings({
      schema_version: 1,
      default_profile: 'open',
      profiles: {
        open: {
          filesystem: { mode: 'deny' },
          network: { mode: 'restricted', targets: { 'example.com': {} } },
        },
      },
    })
    expect(checkStandingAllowRules(text)).toEqual({
      allowed: false,
      reason: 'standing-allow-rules',
    })
  })

  it('turns off on an unidentified dimension, which may allow shell', () => {
    const text = settings({
      schema_version: 1,
      default_profile: 'custom',
      profiles: {
        custom: {
          filesystem: { mode: 'read' },
          network: { mode: 'restricted', targets: {} },
          execution: { mode: 'allow' },
        },
      },
    })
    expect(checkStandingAllowRules(text)).toEqual({
      allowed: false,
      reason: 'standing-allow-rules',
    })
  })

  it('resolves extends chains and refuses dangling or cyclic parents', () => {
    const child = settings({
      schema_version: 1,
      default_profile: 'child',
      profiles: {
        base: RESTRICTIVE.profiles.ask,
        child: { extends: 'base' },
      },
    })
    expect(checkStandingAllowRules(child)).toEqual({ allowed: true })
    const dangling = settings({
      schema_version: 1,
      default_profile: 'child',
      profiles: { child: { extends: 'missing' } },
    })
    expect(checkStandingAllowRules(dangling)).toEqual({
      allowed: false,
      reason: 'settings-unreadable',
    })
    const cyclic = settings({
      schema_version: 1,
      default_profile: 'a',
      profiles: { a: { extends: 'b' }, b: { extends: 'a' } },
    })
    expect(checkStandingAllowRules(cyclic)).toEqual({
      allowed: false,
      reason: 'settings-unreadable',
    })
    const missingProfile = settings({ schema_version: 1, default_profile: 'gone' })
    expect(checkStandingAllowRules(missingProfile)).toEqual({
      allowed: false,
      reason: 'settings-unreadable',
    })
  })

  it('fails closed on malformed settings', () => {
    for (const text of [
      'not json{',
      JSON.stringify({}),
      JSON.stringify({ schema_version: 2 }),
      settings({}),
      settings({ schema_version: 2 }),
      settings({ schema_version: 1, default_profile: 'ask', profiles: 'nope' }),
    ]) {
      expect(checkStandingAllowRules(text)).toEqual({
        allowed: false,
        reason: 'settings-unreadable',
      })
    }
  })

  it('turns off for an empty or dimension-missing profile, which proves nothing', () => {
    for (const profile of [
      {},
      { filesystem: { mode: 'read' } },
      { network: { mode: 'restricted', targets: {} } },
    ]) {
      const text = settings({
        schema_version: 1,
        default_profile: 'thin',
        profiles: { thin: profile },
      })
      expect(checkStandingAllowRules(text)).toEqual({
        allowed: false,
        reason: 'standing-allow-rules',
      })
    }
  })

  it('a restrictive profile ignores inactive permissive profiles', () => {
    const text = settings({
      schema_version: 1,
      default_profile: 'ask',
      profiles: {
        ask: RESTRICTIVE.profiles.ask,
        open: { filesystem: { mode: 'write' }, network: { mode: 'enabled' } },
      },
    })
    expect(checkStandingAllowRules(text)).toEqual({ allowed: true })
  })
})
