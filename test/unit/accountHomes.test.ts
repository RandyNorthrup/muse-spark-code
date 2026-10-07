import { describe, expect, it, vi } from 'vitest'
import {
  MuseCodeAccountHomes,
  recoverMuseCodeAccount,
  type MuseCodeHomeCapture,
} from '../../src/core/backends/musecode/accountHomes'
import { evaluateAccountThresholds } from '../../src/core/accounts/thresholds'
import { buildChildEnvironment } from '../../src/core/backends/musecode/launch'
import { accountPolicyFor } from '../../src/core/providers/accountPolicy'
import * as accountPolicy from '../../src/core/providers/accountPolicy'
import { UI_TEXT } from '../../src/shared/constants'
import { parseUsd } from '../../src/shared/accountUsd'
import type { SubscriptionUsage } from '../../src/shared/usage'

// Local capture evidence is test-owned. It is NOT the missing Q-M108 capture.
const capture: MuseCodeHomeCapture = {
  reference: 'test-only-home-capture',
  cliVersion: 'test-cli',
  platform: 'linux',
  nonSecretConfiguration: ['settings', 'hooks', 'skills', 'mcpServers', 'memory'],
}
// Wire fixture from M8's scratchpad/live-m8.log, four attempts in C:\muse-live-ws.
const capturedUsage: SubscriptionUsage = {
  observedAtMs: 1_790_108_487_971,
  tier: '27681393394859588',
  window: { usedPercent: 0, resetsAtMs: 1_790_126_464_000, windowDurationMins: 300 },
  weekly: { usedPercent: 0, resetsAtMs: 1_790_553_600_000 },
}
const launch = {
  command: '/opt/muse/bin/muse',
  args: ['serve', '--disable-sandbox'],
  serveArgs: ['serve', '--disable-sandbox'],
  installDir: '/opt/muse/bin',
  cliPath: '/opt/muse/bin/muse',
}

function setup(
  options: { platform?: NodeJS.Platform; storageRoot?: string; provider?: string } = {},
) {
  const platform = options.platform ?? 'linux'
  let evidence: unknown = { ...capture, platform }
  let accounts = ['work', 'personal']
  let now = capturedUsage.observedAtMs
  const ensureOwnerOnlyDirectory = vi.fn(() => Promise.resolve())
  const copyNonSecretConfiguration = vi.fn(() => Promise.resolve())
  const openLoginTerminal = vi.fn(() => Promise.resolve())
  const homes = new MuseCodeAccountHomes({
    provider: options.provider ?? 'meta',
    platform,
    storageRoot: options.storageRoot ?? '/private/storage',
    cliVersion: () => 'test-cli',
    capture: () => evidence,
    hasAccount: (account) => accounts.includes(account),
    ensureOwnerOnlyDirectory,
    copyNonSecretConfiguration,
    openLoginTerminal,
    now: () => now,
  })
  return {
    homes,
    ensureOwnerOnlyDirectory,
    copyNonSecretConfiguration,
    openLoginTerminal,
    setCapture: (value: unknown) => {
      evidence = value
    },
    setAccounts: (value: string[]) => {
      accounts = value
    },
    setNow: (value: number) => {
      now = value
    },
  }
}

describe('M108 Muse Code isolated account homes', () => {
  it('stays unavailable without the config-home capture and explains why', async () => {
    const s = setup()
    s.setCapture(undefined)
    await expect(s.homes.prepare('work')).rejects.toThrow(UI_TEXT.accounts.museCodeUnavailable)
    expect(s.ensureOwnerOnlyDirectory).not.toHaveBeenCalled()
    expect(s.copyNonSecretConfiguration).not.toHaveBeenCalled()
    expect(s.openLoginTerminal).not.toHaveBeenCalled()
  })

  it.each([
    { ...capture, cliVersion: 'different-cli' },
    { ...capture, platform: 'win32' },
    { ...capture, reference: '' },
    { ...capture, secret: 'planted-credential' },
    { ...capture, nonSecretConfiguration: ['auth'] },
  ])('refuses unsupported or malformed capture evidence %#', async (evidence) => {
    const s = setup()
    s.setCapture(evidence)
    await expect(s.homes.prepare('work')).rejects.toThrow(UI_TEXT.accounts.museCodeUnavailable)
    expect(s.ensureOwnerOnlyDirectory).not.toHaveBeenCalled()
  })

  it('uses a distinct owner-only home for each account and copies nothing by default', async () => {
    const s = setup()
    const work = await s.homes.prepare('work')
    const personal = await s.homes.prepare('personal')
    expect(work.configHome).toBe('/private/storage/muse-code-accounts/meta/work')
    expect(personal.configHome).toBe('/private/storage/muse-code-accounts/meta/personal')
    expect(work.configHome).not.toBe(personal.configHome)
    expect(Reflect.set(work, 'configHome', personal.configHome)).toBe(false)
    expect(s.ensureOwnerOnlyDirectory.mock.calls).toEqual([
      [work.configHome],
      [personal.configHome],
    ])
    expect(s.copyNonSecretConfiguration).not.toHaveBeenCalled()
    expect(() => {
      work.assertCurrent()
    }).not.toThrow()
  })

  it.each(['win32', 'darwin', 'linux'] as const)(
    'keeps %s account paths under native storage',
    async (platform) => {
      const s = setup({
        platform,
        storageRoot: platform === 'win32' ? String.raw`C:\Users\owner\storage` : '/private/storage',
      })
      const home = await s.homes.prepare('work')
      const normalized = home.configHome!.replaceAll('\\', '/')
      expect(normalized).toBe(
        `${platform === 'win32' ? 'C:/Users/owner/storage' : '/private/storage'}/muse-code-accounts/meta/work`,
      )
    },
  )

  it.each(['../escape', String.raw`..\escape`, 'Work', 'work@example.com', 'unknown'])(
    'refuses invalid or absent account %s before I/O',
    async (account) => {
      const s = setup()
      await expect(s.homes.prepare(account)).rejects.toThrow(UI_TEXT.accounts.invalidAccount)
      expect(s.ensureOwnerOnlyDirectory).not.toHaveBeenCalled()
    },
  )

  it('refuses relative storage roots and propagates a private-folder refusal', async () => {
    await expect(setup({ storageRoot: 'relative/storage' }).homes.prepare('work')).rejects.toThrow()
    const s = setup()
    s.ensureOwnerOnlyDirectory.mockRejectedValueOnce(new Error('owner-only ACL refused'))
    await expect(s.homes.prepare('work')).rejects.toThrow('owner-only ACL refused')
    expect(s.copyNonSecretConfiguration).not.toHaveBeenCalled()
  })

  it('rejects malformed configured provider and account identities before folder I/O', async () => {
    const invalidProvider = setup({ provider: '../escape' })
    await expect(invalidProvider.homes.prepare('work')).rejects.toThrow(
      UI_TEXT.accounts.invalidAccount,
    )
    expect(invalidProvider.ensureOwnerOnlyDirectory).not.toHaveBeenCalled()
    const invalidAccount = setup()
    invalidAccount.setAccounts(['../escape'])
    await expect(invalidAccount.homes.prepare('../escape')).rejects.toThrow(
      UI_TEXT.accounts.invalidAccount,
    )
    expect(invalidAccount.ensureOwnerOnlyDirectory).not.toHaveBeenCalled()
  })

  it('preserves the migrated default sign-in and environment without creating or copying a home', async () => {
    const s = setup()
    s.setAccounts(['default', 'work'])
    const home = await s.homes.prepare('default')
    expect(home.configHome).toBeUndefined()
    const environment = {
      platform: 'linux' as const,
      baseEnv: {
        PATH: '/usr/bin',
        XDG_CONFIG_HOME: '/existing-config',
        META_API_KEY: 'default-shell-canary',
      },
      extraVariables: [],
      systemRoot: undefined,
      programFiles: undefined,
    }
    expect(buildChildEnvironment({ ...environment, accountHome: home })).toEqual(
      environment.baseEnv,
    )
    expect(s.ensureOwnerOnlyDirectory).not.toHaveBeenCalled()
    expect(s.copyNonSecretConfiguration).not.toHaveBeenCalled()
    await expect(s.homes.prepare('default', ['skills'])).rejects.toThrow(
      UI_TEXT.accounts.invalidAccount,
    )
    home.observeUsage(capturedUsage)
    expect(s.homes.subscription('default')).toEqual(capturedUsage)
  })

  it('copies only the selected captured non-secret configuration', async () => {
    const s = setup()
    const home = await s.homes.prepare('work', ['skills', 'memory'])
    expect(s.copyNonSecretConfiguration).toHaveBeenCalledWith({
      account: 'work',
      configHome: home.configHome,
      selection: ['skills', 'memory'],
    })
    s.setCapture({ ...capture, nonSecretConfiguration: ['skills'] })
    await expect(s.homes.prepare('personal', ['hooks'])).rejects.toThrow()
    expect(s.copyNonSecretConfiguration).toHaveBeenCalledOnce()
    expect(s.ensureOwnerOnlyDirectory).toHaveBeenCalledOnce()
  })

  it('freezes selected configuration before asynchronous directory preparation', async () => {
    const s = setup()
    const ready = Promise.withResolvers<undefined>()
    s.ensureOwnerOnlyDirectory.mockReturnValueOnce(ready.promise)
    const selection: ('skills' | 'memory')[] = ['skills']
    const preparing = s.homes.prepare('work', selection)
    selection.push('memory')
    ready.resolve(undefined)
    const home = await preparing
    expect(s.copyNonSecretConfiguration).toHaveBeenCalledWith({
      account: 'work',
      configHome: home.configHome,
      selection: ['skills'],
    })
  })

  it('invalidates an in-flight home when the account is removed and re-added', async () => {
    const s = setup()
    const ready = Promise.withResolvers<undefined>()
    s.ensureOwnerOnlyDirectory.mockReturnValueOnce(ready.promise)
    const preparing = s.homes.prepare('work', ['skills'])
    const refused = expect(preparing).rejects.toThrow(UI_TEXT.accounts.invalidAccount)
    s.homes.invalidate('work')
    ready.resolve(undefined)
    await refused
    expect(s.copyNonSecretConfiguration).not.toHaveBeenCalled()
    const home = await s.homes.prepare('work')
    s.homes.invalidate('work')
    expect(() => {
      home.assertCurrent()
    }).toThrow(UI_TEXT.accounts.invalidAccount)
  })

  it('revokes all leases of one generation while keeping other accounts and replacement leases live', async () => {
    const s = setup()
    const work = await s.homes.prepare('work')
    const sameGeneration = await s.homes.prepare('work')
    const personal = await s.homes.prepare('personal')
    expect(work.generation).toBe(0)
    expect(work.signal).toBe(sameGeneration.signal)
    s.homes.invalidate('work')
    expect(work.signal.aborted).toBe(true)
    expect(sameGeneration.signal.aborted).toBe(true)
    expect(personal.signal.aborted).toBe(false)
    const replacement = await s.homes.prepare('work')
    expect(replacement.generation).toBe(1)
    expect(replacement.signal.aborted).toBe(false)
    expect(replacement.signal).not.toBe(work.signal)
    expect(() => {
      work.assertCurrent()
    }).toThrow(UI_TEXT.accounts.invalidAccount)
    expect(() => {
      replacement.assertCurrent()
    }).not.toThrow()
  })

  it('rechecks capture and membership after asynchronous configuration copying', async () => {
    const s = setup()
    const ready = Promise.withResolvers<undefined>()
    s.copyNonSecretConfiguration.mockReturnValueOnce(ready.promise)
    const preparing = s.homes.prepare('work', ['skills'])
    const refused = expect(preparing).rejects.toThrow(UI_TEXT.accounts.museCodeUnavailable)
    await Promise.resolve()
    s.setCapture(undefined)
    ready.resolve(undefined)
    await refused
    const next = setup()
    const home = await next.homes.prepare('work')
    next.setAccounts(['personal'])
    expect(() => {
      home.assertCurrent()
    }).toThrow(UI_TEXT.accounts.invalidAccount)
  })

  it('runs terminal sign-in with the same home and no inherited credential overrides', async () => {
    const s = setup()
    const home = await s.homes.prepare('work')
    await s.homes.login(home, launch, {
      platform: 'linux',
      baseEnv: {
        PATH: '/usr/bin',
        META_API_KEY: 'shell-account-canary',
        MUSE_AUTH_PATH: '/another-account/auth.json',
      },
      extraVariables: [{ name: 'XDG_CONFIG_HOME', value: '/another-account' }],
      systemRoot: undefined,
      programFiles: undefined,
    })
    expect(s.openLoginTerminal).toHaveBeenCalledWith({
      command: launch.command,
      args: ['login'],
      strictEnv: true,
      env: { PATH: '/usr/bin', XDG_CONFIG_HOME: home.configHome },
      assertCurrent: home.assertCurrent,
    })
  })

  it('refuses a stale or foreign terminal home before sign-in', async () => {
    const s = setup()
    const home = await s.homes.prepare('work')
    const other = await setup().homes.prepare('work')
    const env = {
      platform: 'linux' as const,
      baseEnv: {},
      extraVariables: [],
      systemRoot: undefined,
      programFiles: undefined,
    }
    await expect(s.homes.login(other, launch, env)).rejects.toThrow()
    await expect(s.homes.login(home, launch, { ...env, platform: 'win32' })).rejects.toThrow()
    s.homes.invalidate('work')
    await expect(s.homes.login(home, launch, env)).rejects.toThrow()
    expect(s.openLoginTerminal).not.toHaveBeenCalled()
  })
})

describe('M108 captured subscription windows per account', () => {
  it('attributes usage to its home, preserves the subscription row and trips both thresholds', async () => {
    const s = setup()
    const work = await s.homes.prepare('work')
    const personal = await s.homes.prepare('personal')
    work.observeUsage({
      ...capturedUsage,
      window: { ...capturedUsage.window, usedPercent: 80 },
      weekly: { ...capturedUsage.weekly, usedPercent: 90 },
    })
    personal.observeUsage(capturedUsage)
    const triggers = evaluateAccountThresholds({
      provider: 'meta',
      account: { id: 'work', thresholds: { planWindowPercent: { window: 80, weekly: 90 } } },
      now: capturedUsage.observedAtMs,
      journal: {
        read: () => {
          throw new Error('no journal read expected')
        },
      },
      limits: s.homes,
    })
    expect(triggers).toEqual([
      {
        kind: 'vendorLimit',
        reason: 'planWindow',
        resetAt: new Date(capturedUsage.window.resetsAtMs).toISOString(),
      },
      {
        kind: 'vendorLimit',
        reason: 'planWindow',
        resetAt: new Date(capturedUsage.weekly.resetsAtMs).toISOString(),
      },
    ])
    expect(s.homes.read('meta', 'personal').planWindows?.['weekly']?.usedPercent).toBe(0)
    expect(s.homes.subscription('work')?.tier).toBe(capturedUsage.tier)
    expect(() => s.homes.read('other', 'work')).toThrow()
    expect(() => s.homes.read('meta', 'unknown')).toThrow()
  })

  it('fails admission for configured windows before any captured usage arrives', async () => {
    const s = setup()
    await s.homes.prepare('work')
    expect(() =>
      evaluateAccountThresholds({
        provider: 'meta',
        account: { id: 'work', thresholds: { planWindowPercent: { weekly: 90 } } },
        now: capturedUsage.observedAtMs,
        journal: {
          read: () => {
            throw new Error('unexpected journal read')
          },
        },
        limits: s.homes,
      }),
    ).toThrow(UI_TEXT.sessionBudgetStoreUnavailable)
  })

  it('keeps percentages above 100 for display while enforcing the latest full-window reset', async () => {
    const s = setup()
    const home = await s.homes.prepare('work')
    home.observeUsage({
      ...capturedUsage,
      window: { ...capturedUsage.window, usedPercent: 123 },
      weekly: { ...capturedUsage.weekly, usedPercent: 101 },
    })
    expect(s.homes.subscription('work')?.window.usedPercent).toBe(123)
    expect(s.homes.read('meta', 'work')).toMatchObject({
      planWindows: { window: { usedPercent: 100 }, weekly: { usedPercent: 100 } },
      blocked: {
        reason: 'usageLimit',
        resetAt: new Date(capturedUsage.weekly.resetsAtMs).toISOString(),
      },
    })
  })

  it('ignores out-of-order usage and refuses invalid or post-invalidation observations', async () => {
    const s = setup()
    const home = await s.homes.prepare('work')
    home.observeUsage({ ...capturedUsage, weekly: { ...capturedUsage.weekly, usedPercent: 90 } })
    home.observeUsage({ ...capturedUsage, observedAtMs: capturedUsage.observedAtMs - 1 })
    expect(s.homes.subscription('work')?.weekly.usedPercent).toBe(90)
    expect(() => {
      home.observeUsage({ ...capturedUsage, weekly: { usedPercent: -1, resetsAtMs: NaN } })
    }).toThrow()
    s.homes.invalidate('work')
    expect(() => {
      home.observeUsage(capturedUsage)
    }).toThrow(UI_TEXT.accounts.invalidAccount)
    expect(s.homes.subscription('work')).toBeUndefined()
  })

  it.each([
    { ...capturedUsage, observedAtMs: capturedUsage.observedAtMs + 1 },
    { ...capturedUsage, observedAtMs: capturedUsage.observedAtMs - 0.5 },
    { ...capturedUsage, observedAtMs: -Number.MAX_SAFE_INTEGER },
    { ...capturedUsage, window: { ...capturedUsage.window, windowDurationMins: 0 } },
    { ...capturedUsage, window: { ...capturedUsage.window, usedPercent: -1 } },
    { ...capturedUsage, weekly: { ...capturedUsage.weekly, usedPercent: -1 } },
    {
      ...capturedUsage,
      weekly: { ...capturedUsage.weekly, resetsAtMs: capturedUsage.weekly.resetsAtMs + 0.5 },
    },
    { ...capturedUsage, weekly: { ...capturedUsage.weekly, resetsAtMs: Number.MAX_SAFE_INTEGER } },
  ])(
    'refuses unusable subscription observation %# without replacing the last row',
    async (usage) => {
      const s = setup()
      const home = await s.homes.prepare('work')
      home.observeUsage(capturedUsage)
      expect(() => {
        home.observeUsage(usage)
      }).toThrow(UI_TEXT.sessionBudgetStoreUnavailable)
      expect(s.homes.subscription('work')).toEqual(capturedUsage)
    },
  )

  it('does not expose mutable subscription data to consumers', async () => {
    const s = setup()
    const home = await s.homes.prepare('work')
    const input = structuredClone(capturedUsage)
    home.observeUsage(input)
    input.window.usedPercent = 90
    const output = s.homes.subscription('work')!
    output.weekly.usedPercent = 90
    expect(s.homes.subscription('work')).toEqual(capturedUsage)
  })

  it('refuses invalid clocks and stops enforcing full windows once their captured resets pass', async () => {
    const s = setup()
    const home = await s.homes.prepare('work')
    home.observeUsage({ ...capturedUsage, weekly: { ...capturedUsage.weekly, usedPercent: 100 } })
    s.setNow(capturedUsage.weekly.resetsAtMs)
    expect(s.homes.read('meta', 'work').blocked).toBeUndefined()
    s.setNow(NaN)
    expect(() => s.homes.read('meta', 'work')).toThrow(UI_TEXT.sessionBudgetStoreUnavailable)
    expect(() => {
      home.observeUsage(capturedUsage)
    }).toThrow(UI_TEXT.sessionBudgetStoreUnavailable)
  })
})

function recovery(choice: 'upgrade' | 'wait' | 'payAsYouGo' | 'cancel' = 'payAsYouGo') {
  const payAsYouGo = {
    binding: {
      provider: 'meta',
      account: 'personal',
      price: '$0.10 / 1M input; $0.30 / 1M output',
      dailyBudgetUsd: parseUsd('1'),
    },
    assertCurrent: vi.fn(),
    allows: vi.fn(() => Promise.resolve(true)),
    admit: vi.fn(async (start: () => Promise<void>) => {
      await start()
    }),
    start: vi.fn(() => Promise.resolve()),
  }
  return {
    offer: vi.fn(() => Promise.resolve(choice)),
    upgrade: vi.fn(() => Promise.resolve()),
    payAsYouGo,
  }
}

describe('M108 Muse Code subscription recovery', () => {
  it('refuses recovery when the researched subscription policy is absent', async () => {
    const r = recovery()
    const policy = vi.spyOn(accountPolicy, 'accountPolicyFor').mockReturnValue(undefined)
    try {
      await expect(recoverMuseCodeAccount(r)).rejects.toThrow(UI_TEXT.accounts.museCodeUnavailable)
      expect(r.offer).not.toHaveBeenCalled()
      expect(r.payAsYouGo.start).not.toHaveBeenCalled()
    } finally {
      policy.mockRestore()
    }
  })
  it('refuses a removed PAYG account before asking for paid consent', async () => {
    const r = recovery()
    r.payAsYouGo.assertCurrent.mockImplementation(() => {
      throw new Error('removed account')
    })
    await expect(recoverMuseCodeAccount(r)).rejects.toThrow('removed account')
    expect(r.payAsYouGo.allows).not.toHaveBeenCalled()
    expect(r.payAsYouGo.start).not.toHaveBeenCalled()
  })

  it('rechecks account authority after paid consent before budget admission', async () => {
    const r = recovery()
    r.payAsYouGo.allows.mockImplementation(() => {
      r.payAsYouGo.assertCurrent.mockImplementation(() => {
        throw new Error('revoked during paid consent')
      })
      return Promise.resolve(true)
    })
    await expect(recoverMuseCodeAccount(r)).rejects.toThrow('revoked during paid consent')
    expect(r.payAsYouGo.admit).not.toHaveBeenCalled()
    expect(r.payAsYouGo.start).not.toHaveBeenCalled()
  })
  it('refuses an unknown recovery choice before spending', async () => {
    const r = recovery()
    await expect(
      recoverMuseCodeAccount({ ...r, offer: () => Promise.resolve('allow') }),
    ).rejects.toThrow()
    expect(r.payAsYouGo.allows).not.toHaveBeenCalled()
    expect(r.payAsYouGo.start).not.toHaveBeenCalled()
  })

  it('keeps the account and tariff shown before the recovery choice immutable through dispatch', async () => {
    const r = recovery()
    const original = { ...r.payAsYouGo.binding }
    r.offer.mockImplementation(() => {
      r.payAsYouGo.binding.account = 'changed'
      r.payAsYouGo.binding.price = 'changed-price'
      return Promise.resolve('payAsYouGo')
    })
    await recoverMuseCodeAccount(r)
    expect(r.payAsYouGo.allows).toHaveBeenCalledWith(original)
    expect(r.payAsYouGo.start).toHaveBeenCalledWith(original)
  })
  it('offers the researched subscription row and recovery before a separate D48 PAYG question', async () => {
    const r = recovery()
    expect(await recoverMuseCodeAccount(r)).toBe('payAsYouGo')
    expect(r.offer).toHaveBeenCalledWith({
      detail: UI_TEXT.accounts.museCodeRecovery,
      policy: accountPolicyFor('meta', 'muse-code'),
      hasPayAsYouGo: true,
    })
    expect(r.payAsYouGo.allows).toHaveBeenCalledWith(r.payAsYouGo.binding)
    expect(r.payAsYouGo.admit).toHaveBeenCalledOnce()
    expect(r.payAsYouGo.start).toHaveBeenCalledOnce()
    expect(r.offer.mock.invocationCallOrder[0]).toBeLessThan(
      r.payAsYouGo.allows.mock.invocationCallOrder[0]!,
    )
    expect(r.payAsYouGo.allows.mock.invocationCallOrder[0]).toBeLessThan(
      r.payAsYouGo.admit.mock.invocationCallOrder[0]!,
    )
    expect(r.payAsYouGo.admit.mock.invocationCallOrder[0]).toBeLessThan(
      r.payAsYouGo.start.mock.invocationCallOrder[0]!,
    )
  })

  it.each(['upgrade', 'wait', 'cancel'] as const)(
    'choosing %s never incurs a paid call',
    async (choice) => {
      const r = recovery(choice)
      expect(await recoverMuseCodeAccount(r)).toBe(choice)
      expect(r.upgrade).toHaveBeenCalledTimes(choice === 'upgrade' ? 1 : 0)
      expect(r.payAsYouGo.allows).not.toHaveBeenCalled()
      expect(r.payAsYouGo.start).not.toHaveBeenCalled()
    },
  )

  it('does not offer PAYG without the stored-key path and refuses a forged choice', async () => {
    const r = recovery()
    await expect(recoverMuseCodeAccount({ offer: r.offer, upgrade: r.upgrade })).rejects.toThrow(
      UI_TEXT.accounts.invalidAccount,
    )
    expect(r.offer).toHaveBeenCalledWith(expect.objectContaining({ hasPayAsYouGo: false }))
    expect(r.payAsYouGo.start).not.toHaveBeenCalled()
  })

  it('carries only billing metadata across the PAYG consent port', async () => {
    const r = recovery()
    const expected = { ...r.payAsYouGo.binding }
    Reflect.set(r.payAsYouGo.binding, 'secret', 'credential-canary')
    await recoverMuseCodeAccount(r)
    expect(r.payAsYouGo.allows).toHaveBeenCalledWith(expected)
    expect(r.payAsYouGo.start).toHaveBeenCalledWith(expected)
  })

  it('refuses paid dispatch on denial, stale account or exhausted shared budget', async () => {
    const denied = recovery()
    denied.payAsYouGo.allows.mockResolvedValue(false)
    expect(await recoverMuseCodeAccount(denied)).toBe('cancel')
    expect(denied.payAsYouGo.admit).not.toHaveBeenCalled()
    expect(denied.payAsYouGo.start).not.toHaveBeenCalled()
    const stale = recovery()
    stale.payAsYouGo.admit.mockImplementation(async (start) => {
      stale.payAsYouGo.assertCurrent.mockImplementation(() => {
        throw new Error('account removed')
      })
      await start()
    })
    await expect(recoverMuseCodeAccount(stale)).rejects.toThrow('account removed')
    expect(stale.payAsYouGo.start).not.toHaveBeenCalled()
    const full = recovery()
    full.payAsYouGo.admit.mockRejectedValue(new Error('daily budget exhausted'))
    await expect(recoverMuseCodeAccount(full)).rejects.toThrow('daily budget exhausted')
    expect(full.payAsYouGo.start).not.toHaveBeenCalled()
  })
})
