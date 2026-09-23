import { describe, expect, it } from 'vitest'
import { readSettings, toSettingsSnapshot } from '../../src/host/settings'
import { SETTING_DEFAULTS } from '../../src/shared/constants'
import { FakeLogOutputChannel, fakeSettingsSource } from './helpers/fakes'

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
      }),
      new FakeLogOutputChannel(),
    )
    expect(settings.preferredLocation).toBe('sidebar')
    expect(settings.initialPermissionMode).toBe('plan')
    expect(settings.useCtrlEnterToSend).toBe(true)
    expect(settings.museBinaryPath).toBe('C:/tools/muse.exe')
    expect(settings.environmentVariables).toEqual([{ name: 'MUSE_HOME', value: 'D:/muse' }])
    expect(settings.shellSandbox).toBe('off')
    expect(settings.backend).toBe('modelApi')
  })

  it('logs and falls back to the default for an invalid value', () => {
    const log = new FakeLogOutputChannel()
    const settings = readSettings(
      fakeSettingsSource({
        initialPermissionMode: 'yolo',
        environmentVariables: [{ name: 'X' }],
        shellSandbox: 'sometimes',
      }),
      log,
    )
    expect(settings.initialPermissionMode).toBe('manual')
    expect(settings.environmentVariables).toEqual([])
    expect(settings.shellSandbox).toBe('auto')
    expect(log.warn).toHaveBeenCalledTimes(3)
    expect(String(log.warn.mock.calls[0]?.[0])).toContain('museSpark.initialPermissionMode')
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
    expect(snapshot.preferredLocation).toBe(SETTING_DEFAULTS.preferredLocation)
  })
})
