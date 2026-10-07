import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { permissionSettingsOf, readSettings, toSettingsSnapshot } from '../../src/host/settings'
import { SETTING_DEFAULTS } from '../../src/shared/constants'
import { FakeLogOutputChannel, fakeSettingsSource } from './helpers/fakes'

/** `cleanupPeriodDays` as read from a settings source holding only this value. */
function retentionOf(value: unknown): number {
  return readSettings(fakeSettingsSource({ cleanupPeriodDays: value }), new FakeLogOutputChannel())
    .cleanupPeriodDays
}

describe('readSettings', () => {
  it('documents Best-of-N default availability consistently with the manifest and fallback', () => {
    const readme = readFileSync('README.md', 'utf8')
    expect(SETTING_DEFAULTS.modelApiBestOfN).toBe(true)
    expect(/Best-of-N \(Model API, paid, available by\s+default\)/.test(readme)).toBe(true)
    expect(/Best-of-N \(Model API, paid, off by\s+default/.test(readme)).toBe(false)
  })

  it('enables D78 enhancements and respects each explicit false', () => {
    const keys = [
      'modelApiObservationPacking',
      'modelApiHooks',
      'modelApiReplyUsage',
      'modelApiWebSearch',
      'modelApiImageGeneration',
      'modelApiVoice',
      'modelApiAutoReviewer',
      'modelApiSubagents',
      'modelApiScheduledPrompts',
      'modelApiBestOfN',
    ] as const
    const log = new FakeLogOutputChannel()
    const defaults = readSettings(fakeSettingsSource({}), log)
    expect(keys).toHaveLength(10)
    for (const key of keys) {
      expect(defaults[key], key).toBe(true)
      expect(readSettings(fakeSettingsSource({ [key]: false }), log)[key], key).toBe(false)
    }
    expect(defaults.modelApiRepoMap).toBe(false)
    expect(defaults.paidDailyBudgetUsd).toBe(5)
    expect(defaults.dictationEngine).toBe('system')
  })

  it('validates the daily budget bounds and defaults invalid values to five dollars', () => {
    const log = new FakeLogOutputChannel()
    for (const value of [0.5, 5, 500]) {
      expect(
        readSettings(fakeSettingsSource({ paidDailyBudgetUsd: value }), log).paidDailyBudgetUsd,
      ).toBe(value)
    }
    for (const value of [0, 0.49, 500.01, NaN, '5']) {
      expect(
        readSettings(fakeSettingsSource({ paidDailyBudgetUsd: value }), log).paidDailyBudgetUsd,
      ).toBe(5)
    }
  })
  it('returns the documented defaults when nothing is configured', () => {
    const log = new FakeLogOutputChannel()
    expect(readSettings(fakeSettingsSource({}), log)).toEqual(SETTING_DEFAULTS)
    expect(log.warn).not.toHaveBeenCalled()
  })

  it('returns configured values that validate', () => {
    const settings = readSettings(
      fakeSettingsSource({
        preferredLocation: 'sidebar',
        initialPermissionMode: 'plan',
        useCtrlEnterToSend: true,
        museBinaryPath: 'C:/tools/muse.exe',
        environmentVariables: [{ name: 'MUSE_HOME', value: 'D:/muse' }],
        shellSandbox: 'off',
        backend: 'modelApi',
        sandboxNetwork: 'restricted',
        modelApiPromptCacheRetention: '24h',
        modelApiHooks: true,
        modelApiCommandRules: [{ pattern: ['ls'], decision: 'allow', match: ['ls'] }],
        modelApiPermissionProfiles: { locked: { denyRead: ['**/.env'] } },
        modelApiPermissionProfile: 'locked',
        modelApiRepositoryRules: { denyRead: ['x'] },
        modelApiAutoReviewer: true,
        modelApiObservationPacking: true,
        museCodeAutoReviewer: false,
        showWhatsNewOnUpdate: false,
      }),
      new FakeLogOutputChannel(),
    )
    // M78: kept whole here; the Model API bundle parses each rule.
    expect(permissionSettingsOf(settings)).toEqual({
      commandRules: [{ pattern: ['ls'], decision: 'allow', match: ['ls'] }],
      profiles: { locked: { denyRead: ['**/.env'] } },
      profile: 'locked',
      repositoryRules: { denyRead: ['x'] },
    })
    expect(settings.modelApiAutoReviewer).toBe(true)
    // M90: the Auto reviewer on Muse Code, on by default, off when the user says so.
    expect(settings.museCodeAutoReviewer).toBe(false)
    expect(SETTING_DEFAULTS.museCodeAutoReviewer).toBe(true)
    expect(toSettingsSnapshot(settings).museCodeAutoReviewer).toBe(false)
    // M99: What's New after an update, on by default, off when the user says so.
    expect(settings.showWhatsNewOnUpdate).toBe(false)
    expect(SETTING_DEFAULTS.showWhatsNewOnUpdate).toBe(true)
    // M56 (PLAN.md D43).
    expect(settings.sandboxNetwork).toBe('restricted')
    expect(settings.modelApiPromptCacheRetention).toBe('24h')
    expect(settings.preferredLocation).toBe('sidebar')
    expect(settings.initialPermissionMode).toBe('plan')
    expect(settings.useCtrlEnterToSend).toBe(true)
    expect(settings.museBinaryPath).toBe('C:/tools/muse.exe')
    expect(settings.environmentVariables).toEqual([{ name: 'MUSE_HOME', value: 'D:/muse' }])
    expect(settings.shellSandbox).toBe('off')
    expect(settings.backend).toBe('modelApi')
    expect(settings.modelApiHooks).toBe(true)
    // D78: observation packing is on by default.
    expect(settings.modelApiObservationPacking).toBe(true)
    expect(SETTING_DEFAULTS.modelApiObservationPacking).toBe(true)
  })

  it('reads the vault settings, all on and machine-scoped by default (M109)', () => {
    const log = new FakeLogOutputChannel()
    const defaults = readSettings(fakeSettingsSource({}), log)
    expect(defaults.vault).toBe(true)
    expect(defaults['vault.protection']).toBe('auto')
    expect(defaults['vault.agentFence']).toBe(true)
    expect(defaults['vault.lockAfterIdleMinutes']).toBe(240)
    expect(defaults['vault.lockOnScreenLock']).toBe(true)
    expect(log.warn).not.toHaveBeenCalled()
    const configured = readSettings(
      fakeSettingsSource({
        vault: false,
        'vault.protection': 'hardware',
        'vault.agentFence': false,
        'vault.lockAfterIdleMinutes': 30,
        'vault.lockOnScreenLock': false,
      }),
      log,
    )
    expect(configured.vault).toBe(false)
    expect(configured['vault.protection']).toBe('hardware')
    expect(configured['vault.agentFence']).toBe(false)
    expect(configured['vault.lockAfterIdleMinutes']).toBe(30)
    expect(configured['vault.lockOnScreenLock']).toBe(false)
  })

  it('falls back to the vault defaults for an invalid protection, idle time or flag (M109)', () => {
    const log = new FakeLogOutputChannel()
    const settings = readSettings(
      fakeSettingsSource({
        vault: 'yes',
        'vault.protection': 'keychain-biometry',
        'vault.agentFence': 1,
        'vault.lockAfterIdleMinutes': -5,
        'vault.lockOnScreenLock': 'always',
      }),
      log,
    )
    expect(settings.vault).toBe(true)
    expect(settings['vault.protection']).toBe('auto')
    expect(settings['vault.agentFence']).toBe(true)
    expect(settings['vault.lockAfterIdleMinutes']).toBe(240)
    expect(settings['vault.lockOnScreenLock']).toBe(true)
    expect(log.warn).toHaveBeenCalledTimes(5)
  })

  it('reads the retention period as a whole number of days, 0 keeping for ever (D26)', () => {
    expect(retentionOf(undefined)).toBe(30)
    expect(retentionOf(0)).toBe(0)
    expect(retentionOf(90)).toBe(90)
    expect(retentionOf(-1)).toBe(30)
    expect(retentionOf(1.5)).toBe(30)
    expect(retentionOf('7')).toBe(30)
  })

  it('reads the awareness and budget settings, 0 meaning no cap (M82)', () => {
    const settings = readSettings(
      fakeSettingsSource({
        notifyOnBackgroundTurn: false,
        modelApiReplyUsage: true,
        modelApiSessionBudgetUsd: 2.5,
      }),
      new FakeLogOutputChannel(),
    )
    expect(settings.notifyOnBackgroundTurn).toBe(false)
    expect(settings.modelApiReplyUsage).toBe(true)
    expect(settings.modelApiSessionBudgetUsd).toBe(2.5)
  })

  it('falls back to no cap for a negative or non-numeric budget (M82)', () => {
    const log = new FakeLogOutputChannel()
    expect(
      readSettings(fakeSettingsSource({ modelApiSessionBudgetUsd: -1 }), log)
        .modelApiSessionBudgetUsd,
    ).toBe(0)
    expect(
      readSettings(fakeSettingsSource({ modelApiSessionBudgetUsd: '5' }), log)
        .modelApiSessionBudgetUsd,
    ).toBe(0)
    expect(log.warn).toHaveBeenCalledTimes(2)
  })

  it('logs and falls back to the default for an invalid value', () => {
    const log = new FakeLogOutputChannel()
    const settings = readSettings(
      fakeSettingsSource({
        initialPermissionMode: 'yolo',
        environmentVariables: [{ name: 'X' }],
        shellSandbox: 'sometimes',
        sandboxNetwork: 'offline',
        modelApiPromptCacheRetention: '7d',
      }),
      log,
    )
    expect(settings.initialPermissionMode).toBe('manual')
    expect(settings.environmentVariables).toEqual([])
    expect(settings.shellSandbox).toBe('auto')
    expect(settings.sandboxNetwork).toBe('default')
    expect(settings.modelApiPromptCacheRetention).toBe('in_memory')
    expect(log.warn).toHaveBeenCalledTimes(5)
    expect(String(log.warn.mock.calls[0]?.[0])).toContain('museSpark.initialPermissionMode')
  })

  it('does not copy arbitrary environment values into an invalid-setting warning', () => {
    const log = new FakeLogOutputChannel()
    const value = 'private proxy passphrase with spaces'
    const settings = readSettings(
      fakeSettingsSource({
        environmentVariables: [{ name: 'HTTPS_PROXY', value }, { name: 'OTHER' }],
      }),
      log,
    )

    expect(settings.environmentVariables).toEqual([])
    expect(log.warn).toHaveBeenCalledOnce()
    expect(String(log.warn.mock.calls[0]?.[0])).toContain('museSpark.environmentVariables')
    expect(String(log.warn.mock.calls[0]?.[0])).not.toContain(value)
  })

  // M68 (PLAN.md D49): the verify loop's settings.
  it('reads the check commands, and refuses a list that does not validate whole', () => {
    const lint = { name: 'lint', command: 'npm run lint', changedFiles: true, timeoutSeconds: 60 }
    const valid = readSettings(
      fakeSettingsSource({
        checkCommands: [lint],
        formatOnEdit: true,
        diagnosticsAfterEdits: false,
      }),
      new FakeLogOutputChannel(),
    )
    expect(valid.checkCommands).toEqual([lint])
    expect(valid.formatOnEdit).toBe(true)
    expect(valid.diagnosticsAfterEdits).toBe(false)
    const log = new FakeLogOutputChannel()
    const invalid = readSettings(
      fakeSettingsSource({
        checkCommands: [lint, { name: 'lint', command: 'eslint .' }],
      }),
      log,
    )
    expect(invalid.checkCommands).toEqual([])
    expect(String(log.warn.mock.calls[0]?.[0])).toContain('museSpark.checkCommands')
    expect(String(log.warn.mock.calls[0]?.[0])).toContain('each check needs a name of its own')
  })

  // M81 (PLAN.md D49): only plain hosts widen the browser check.
  it('reads the hosts the browser check may reach, and refuses a list with one that is not a plain host', () => {
    const valid = readSettings(
      fakeSettingsSource({ browserCheckExtraHosts: ['dev.example.com', '192.168.1.20', '::1'] }),
      new FakeLogOutputChannel(),
    )
    expect(valid.browserCheckExtraHosts).toEqual(['dev.example.com', '192.168.1.20', '::1'])
    for (const bad of [['dev.example.com', '*.example.com'], ['a;b'], ['example.com:8080'], ['']]) {
      const log = new FakeLogOutputChannel()
      const invalid = readSettings(fakeSettingsSource({ browserCheckExtraHosts: bad }), log)
      expect(invalid.browserCheckExtraHosts, JSON.stringify(bad)).toEqual([])
      expect(String(log.warn.mock.calls[0]?.[0])).toContain('museSpark.browserCheckExtraHosts')
    }
    const tooMany = Array.from({ length: 33 }, (_, index) => `h${String(index)}.example`)
    expect(
      readSettings(
        fakeSettingsSource({ browserCheckExtraHosts: tooMany }),
        new FakeLogOutputChannel(),
      ).browserCheckExtraHosts,
    ).toEqual([])
  })

  // M81 A1: ask before the runtime is downloaded unless the user chose otherwise.
  it('reads how the browser check gets its runtime: ask by default, download or off, nothing else', () => {
    expect(
      readSettings(fakeSettingsSource({}), new FakeLogOutputChannel()).browserCheckRuntime,
    ).toBe('ask')
    for (const mode of ['ask', 'download', 'off'] as const) {
      expect(
        readSettings(fakeSettingsSource({ browserCheckRuntime: mode }), new FakeLogOutputChannel())
          .browserCheckRuntime,
      ).toBe(mode)
    }
    const log = new FakeLogOutputChannel()
    expect(
      readSettings(fakeSettingsSource({ browserCheckRuntime: 'always' }), log).browserCheckRuntime,
    ).toBe('ask')
    expect(String(log.warn.mock.calls[0]?.[0])).toContain('museSpark.browserCheckRuntime')
  })

  // M39: the settings are read about seven times a message.
  it('warns about an invalid value once, and again when it changes', () => {
    const log = new FakeLogOutputChannel()
    const read = (mode: string) =>
      readSettings(fakeSettingsSource({ initialPermissionMode: mode }), log)
    read('yolo')
    read('yolo')
    expect(log.warn).toHaveBeenCalledOnce()
    read('bold')
    expect(log.warn).toHaveBeenCalledTimes(2)
    // Another logger (another activation) hears it again.
    const fresh = new FakeLogOutputChannel()
    readSettings(fakeSettingsSource({ initialPermissionMode: 'yolo' }), fresh)
    expect(fresh.warn).toHaveBeenCalledOnce()
  })
})

describe('toSettingsSnapshot', () => {
  it('strips host-only settings', () => {
    const snapshot = toSettingsSnapshot(
      readSettings(fakeSettingsSource({}), new FakeLogOutputChannel()),
    )
    expect(snapshot).not.toHaveProperty('museBinaryPath')
    expect(snapshot).not.toHaveProperty('environmentVariables')
    expect(snapshot).not.toHaveProperty('shellSandbox')
    expect(snapshot).not.toHaveProperty('enableNewConversationShortcut')
    expect(snapshot).not.toHaveProperty('backend')
    expect(snapshot).not.toHaveProperty('modelApiHooks')
    expect(snapshot).not.toHaveProperty('notifyOnBackgroundTurn')
    expect(snapshot).not.toHaveProperty('modelApiSessionBudgetUsd')
    expect(snapshot.modelApiReplyUsage).toBe(true)
    expect(snapshot.preferredLocation).toBe(SETTING_DEFAULTS.preferredLocation)
  })
})
