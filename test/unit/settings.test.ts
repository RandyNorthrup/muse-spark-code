import { describe, expect, it } from 'vitest'
import { readSettings, toSettingsSnapshot } from '../../src/host/settings'
import { SETTING_DEFAULTS } from '../../src/shared/constants'
import { FakeLogOutputChannel, fakeSettingsSource } from './helpers/fakes'

/** `cleanupPeriodDays` as read from a settings source holding only this value. */
function retentionOf(value: unknown): number {
  return readSettings(fakeSettingsSource({ cleanupPeriodDays: value }), new FakeLogOutputChannel())
    .cleanupPeriodDays
}

describe('readSettings', () => {
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
      }),
      new FakeLogOutputChannel(),
    )
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
  })

  it('reads the retention period as a whole number of days, 0 keeping for ever (D26)', () => {
    expect(retentionOf(undefined)).toBe(30)
    expect(retentionOf(0)).toBe(0)
    expect(retentionOf(90)).toBe(90)
    expect(retentionOf(-1)).toBe(30)
    expect(retentionOf(1.5)).toBe(30)
    expect(retentionOf('7')).toBe(30)
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
    expect(snapshot.preferredLocation).toBe(SETTING_DEFAULTS.preferredLocation)
  })
})
