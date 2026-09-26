import { describe, expect, it } from 'vitest'
import {
  museSettingsPath,
  readDelegationMode,
  readWorkflowTriggerMode,
} from '../../src/host/backend/museSettings'

const base = { platform: 'linux' as const, homeDir: '/home/r', xdgConfigHome: undefined }

describe('museSettingsPath', () => {
  it('follows XDG_CONFIG_HOME on every platform, else ~/.config', () => {
    expect(museSettingsPath(base)).toBe('/home/r/.config/muse/settings.json')
    expect(museSettingsPath({ ...base, xdgConfigHome: '/xdg' })).toBe('/xdg/muse/settings.json')
    expect(
      museSettingsPath({
        platform: 'win32',
        homeDir: String.raw`C:\Users\r`,
        xdgConfigHome: undefined,
      }),
    ).toBe(String.raw`C:\Users\r\.config\muse\settings.json`)
  })
})

describe('readDelegationMode', () => {
  it('reads run.subagent_delegation_mode and defaults to off when unset, absent or malformed', () => {
    const files: Record<string, string | undefined> = {
      '/home/r/.config/muse/settings.json':
        '{"schema_version":1,"run":{"subagent_delegation_mode":"auto"}}',
    }
    const deps = { ...base, readTextFile: (file: string) => files[file] }
    expect(readDelegationMode(deps)).toBe('auto')
    files['/home/r/.config/muse/settings.json'] = '{"schema_version":1,"tui":{}}'
    expect(readDelegationMode(deps)).toBe('off')
    files['/home/r/.config/muse/settings.json'] = '{not json'
    expect(readDelegationMode(deps)).toBe('off')
    files['/home/r/.config/muse/settings.json'] = '{"run":{"subagent_delegation_mode":7}}'
    expect(readDelegationMode(deps)).toBe('off')
    files['/home/r/.config/muse/settings.json'] = undefined
    expect(readDelegationMode(deps)).toBe('off')
  })
})

describe('readWorkflowTriggerMode (M47)', () => {
  it('reads run.workflow_trigger_mode, as it came, and defaults to auto as Muse Code 1.3.0 ran', () => {
    const files: Record<string, string | undefined> = {
      '/home/r/.config/muse/settings.json': '{"run":{"workflow_trigger_mode":"explicit"}}',
    }
    const deps = { ...base, readTextFile: (file: string) => files[file] }
    expect(readWorkflowTriggerMode(deps)).toBe('explicit')
    files['/home/r/.config/muse/settings.json'] = '{"run":{"workflow_trigger_mode":"sometimes"}}'
    expect(readWorkflowTriggerMode(deps)).toBe('sometimes')
    // The owner's own file on 2026-09-25: no `run` block at all.
    files['/home/r/.config/muse/settings.json'] = '{"schema_version":1,"tui":{}}'
    expect(readWorkflowTriggerMode(deps)).toBe('auto')
    files['/home/r/.config/muse/settings.json'] = '{not json'
    expect(readWorkflowTriggerMode(deps)).toBe('auto')
    files['/home/r/.config/muse/settings.json'] = undefined
    expect(readWorkflowTriggerMode(deps)).toBe('auto')
  })

  it('reads each member on its own: one of another type costs only that fact', () => {
    const deps = {
      ...base,
      readTextFile: () => '{"run":{"subagent_delegation_mode":"auto","workflow_trigger_mode":3}}',
    }
    expect(readDelegationMode(deps)).toBe('auto')
    expect(readWorkflowTriggerMode(deps)).toBe('auto')
    const offDeps = {
      ...base,
      readTextFile: () => '{"run":{"subagent_delegation_mode":[],"workflow_trigger_mode":"off"}}',
    }
    expect(readDelegationMode(offDeps)).toBe('off')
    expect(readWorkflowTriggerMode(offDeps)).toBe('off')
  })
})
