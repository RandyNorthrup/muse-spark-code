// The runtime panel's settings and storage store (M104 lane B) over real
// files. A user setting written through it is the one the runtime's own
// readers already read (the daily ledger, the converter path, the reports
// plan limit, the resource governor's machine file): one copy, not two. The
// file contents fed by hand are the documented format (docs/acp.md:
// `{"paidDailyBudgetUsd":5}`); everything else goes through the store.
import { randomUUID } from 'node:crypto'
import { readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { setTimeout as delay } from 'node:timers/promises'
import { describe, expect, it } from 'vitest'
import { runtimeDailyBudgetUsd } from '../../src/runtime/dailyBudgetSetting'
import { runtimeConverterPath } from '../../src/runtime/runtimeConverterPath'
import { runtimeReportsPlanMaxBytes } from '../../src/runtime/runtimeReportsPlan'
import { resourceMachineStore } from '../../src/runtime/resources/settings'
import {
  RuntimeSettingsStore,
  RuntimeStateError,
  runtimeSettingFileKey,
} from '../../src/runtime/settingsStore'
import { workspaceDataFolder } from '../../src/runtime/dataFolder'
import {
  MACHINE_SCOPED_SETTINGS,
  RUNTIME_PANEL_STATE,
  RUNTIME_RESOURCE_SETTINGS_FILE,
  RUNTIME_SETTINGS_FILE,
  SETTING_DEFAULTS,
} from '../../src/shared/constants'
import { RESOURCE_SETTING_KEYS } from '../../src/shared/resources'
import { collectingLogger } from './helpers/collectingLogger'
import { SYNTHETIC } from './helpers/syntheticTokens'
import { fileRoots } from './helpers/tempDirs'

const roots = fileRoots()
const sleep = (ms: number) => delay(ms)

async function storeIn(prefix: string) {
  const dataFolder = await roots.fresh(prefix)
  const store = new RuntimeSettingsStore({
    dataFolder,
    workspaceRoot: path.join(dataFolder, 'workspace-a'),
    log: collectingLogger([]),
    sleep,
  })
  return { dataFolder, store }
}

async function refusal(work: Promise<unknown>): Promise<string> {
  try {
    await work
  } catch (error: unknown) {
    if (error instanceof RuntimeStateError) return error.message
    throw error
  }
  throw new Error('the store accepted what it should refuse')
}

describe('RuntimeSettingsStore', () => {
  it('writes a user setting where the runtime already reads it, keeping the person’s own lines', async () => {
    const { dataFolder, store } = await storeIn('settings-user-')
    const file = path.join(dataFolder, RUNTIME_SETTINGS_FILE)
    // The person's own file, in the format docs/acp.md gives, plus the
    // converter path the media docs name.
    await writeFile(file, '{"paidDailyBudgetUsd":5,"mediaConverterPath":"/opt/ffmpeg"}\n')
    expect(runtimeDailyBudgetUsd(dataFolder)).toBe(5)
    expect(await store.getSetting('museSpark.paidDailyBudgetUsd')).toBe(5)

    await store.updateSetting('museSpark.paidDailyBudgetUsd', 12.5, 'user')
    await store.updateSetting('museSpark.reports.planMaxBytes', 4096, 'user')

    expect(runtimeDailyBudgetUsd(dataFolder)).toBe(12.5)
    expect(runtimeReportsPlanMaxBytes(dataFolder)).toBe(4096)
    expect(runtimeConverterPath(dataFolder)).toBe('/opt/ffmpeg')
    expect(JSON.parse(await readFile(file, 'utf8'))).toEqual({
      paidDailyBudgetUsd: 12.5,
      mediaConverterPath: '/opt/ffmpeg',
      reportsPlanMaxBytes: 4096,
    })
  })

  it('routes the resource governor’s settings to its machine file', async () => {
    const { dataFolder, store } = await storeIn('settings-resources-')
    await store.updateSetting('museSpark.resourceCpuMaxPercent', 70, 'user')
    const machine = resourceMachineStore({
      settingsFile: path.join(dataFolder, RUNTIME_RESOURCE_SETTINGS_FILE),
      resumeFile: path.join(dataFolder, 'resource-resume.json'),
      sleep,
    })
    const machineSettings = await machine.readSettings()
    expect(machineSettings.cpuMaxPercent).toBe(70)
    expect(await store.getSetting('museSpark.resourceCpuMaxPercent')).toBe(70)
  })

  it('answers an unset setting with its default and every setting through readAll', async () => {
    const { store } = await storeIn('settings-defaults-')
    expect(await store.getSetting('museSpark.autosave')).toBe(SETTING_DEFAULTS.autosave)
    const all = await store.readAll()
    expect(all.initialPermissionMode).toBe(SETTING_DEFAULTS.initialPermissionMode)
    expect(all.autosave).toBe(SETTING_DEFAULTS.autosave)
  })

  it('gives a workspace’s own value precedence, in that workspace only', async () => {
    const { dataFolder, store } = await storeIn('settings-workspace-')
    const other = new RuntimeSettingsStore({
      dataFolder,
      workspaceRoot: path.join(dataFolder, 'workspace-b'),
      log: collectingLogger([]),
      sleep,
    })
    await store.updateSetting('museSpark.autosave', true, 'user')
    await store.updateSetting('museSpark.autosave', false, 'workspace')
    expect(await store.getSetting('museSpark.autosave')).toBe(false)
    expect(await other.getSetting('museSpark.autosave')).toBe(true)
    // The workspace's value never lands in the repository or the user file.
    expect(
      JSON.parse(await readFile(path.join(dataFolder, RUNTIME_SETTINGS_FILE), 'utf8')),
    ).toEqual({ autosave: true })
    const workspaceFile = path.join(
      workspaceDataFolder(dataFolder, path.join(dataFolder, 'workspace-a')),
      RUNTIME_PANEL_STATE.workspaceSettingsFile,
    )
    expect(JSON.parse(await readFile(workspaceFile, 'utf8'))).toEqual({ autosave: false })
  })

  it('keeps a machine-scoped setting the person’s alone', async () => {
    const { store } = await storeIn('settings-machine-')
    expect(MACHINE_SCOPED_SETTINGS).toContain('paidDailyBudgetUsd')
    expect(await refusal(store.updateSetting('museSpark.paidDailyBudgetUsd', 1, 'workspace'))).toBe(
      'MHP_STATE_MACHINE_SETTING',
    )
    expect(await store.getSetting('museSpark.paidDailyBudgetUsd')).toBe(
      SETTING_DEFAULTS.paidDailyBudgetUsd,
    )
    // Reading the person's `gh` login is theirs to allow (D104): a workspace cannot switch it on.
    expect(MACHINE_SCOPED_SETTINGS).toContain('github.useGhLogin')
    expect(
      await refusal(store.updateSetting('museSpark.github.useGhLogin', true, 'workspace')),
    ).toBe('MHP_STATE_MACHINE_SETTING')
    expect(await store.getSetting('museSpark.github.useGhLogin')).toBe(false)
    await store.updateSetting('museSpark.github.useGhLogin', true, 'user')
    expect(await store.getSetting('museSpark.github.useGhLogin')).toBe(true)
  })

  it('tells which settings the person has set, and never counts a default', async () => {
    const { store } = await storeIn('settings-configured-')
    expect(await store.configuredSettings()).toEqual(new Set())
    await store.updateSetting(
      'museSpark.modelApiWebSearch',
      SETTING_DEFAULTS.modelApiWebSearch,
      'user',
    )
    await store.updateSetting('museSpark.autosave', false, 'workspace')
    // Written at its default value is still the person's own setting (D78 reads "set", not "differs").
    expect(await store.configuredSettings()).toEqual(new Set(['modelApiWebSearch', 'autosave']))
  })

  it('refuses an unknown setting and a value its schema refuses, writing nothing', async () => {
    const { dataFolder, store } = await storeIn('settings-invalid-')
    expect(await refusal(store.updateSetting('museSpark.noSuchSetting', true, 'user'))).toBe(
      'MHP_STATE_UNKNOWN_SETTING',
    )
    expect(await refusal(store.updateSetting('museSpark.autosave', 'yes', 'user'))).toBe(
      'MHP_STATE_INVALID_VALUE',
    )
    expect(await refusal(store.updateSetting('museSpark.paidDailyBudgetUsd', -1, 'user'))).toBe(
      'MHP_STATE_INVALID_VALUE',
    )
    await expect(readFile(path.join(dataFolder, RUNTIME_SETTINGS_FILE))).rejects.toMatchObject({
      code: 'ENOENT',
    })
  })

  it('never stores a credential: a named variable, a credential field or key-shaped text', async () => {
    const { dataFolder, store } = await storeIn('settings-credentials-')
    expect(
      await refusal(
        store.updateSetting(
          'museSpark.environmentVariables',
          [{ name: 'OPENAI_API_KEY', value: 'x' }],
          'user',
        ),
      ),
    ).toBe('MHP_STATE_CREDENTIAL')
    expect(
      await refusal(
        store.updateSetting(
          'museSpark.environmentVariables',
          [{ name: 'EDITOR_HINT', value: SYNTHETIC.openAiKey }],
          'user',
        ),
      ),
    ).toBe('MHP_STATE_CREDENTIAL')
    expect(await refusal(store.setStorage('accessToken', 'abc', 'user'))).toBe(
      'MHP_STATE_CREDENTIAL',
    )
    expect(await refusal(store.setStorage('notes', { apiKey: 'abc' }, 'workspace'))).toBe(
      'MHP_STATE_CREDENTIAL',
    )
    expect(await refusal(store.setStorage('notes', SYNTHETIC.githubToken, 'user'))).toBe(
      'MHP_STATE_CREDENTIAL',
    )
    await expect(readFile(path.join(dataFolder, RUNTIME_SETTINGS_FILE))).rejects.toMatchObject({
      code: 'ENOENT',
    })
    // An ordinary environment entry is a setting like any other.
    await store.updateSetting(
      'museSpark.environmentVariables',
      [{ name: 'EDITOR_HINT', value: 'compact' }],
      'user',
    )
    expect(await store.getSetting('museSpark.environmentVariables')).toEqual([
      { name: 'EDITOR_HINT', value: 'compact' },
    ])
  })

  // About 300 durable atomic writes, one after another: seconds when the disk is busy with other suites.
  it(
    'accepts every setting’s own default, under a key no other setting shares',
    { timeout: 30_000 },
    async () => {
      const { store } = await storeIn('settings-every-')
      const { store: untouched } = await storeIn('settings-untouched-')
      const names = [...Object.keys(SETTING_DEFAULTS), ...Object.values(RESOURCE_SETTING_KEYS)]
      expect(new Set(names.map((name) => runtimeSettingFileKey(name))).size).toBe(names.length)
      for (const name of names) {
        const value = await untouched.getSetting(`museSpark.${name}`)
        await store.updateSetting(`museSpark.${name}`, value, 'user')
        expect(await store.getSetting(`museSpark.${name}`), name).toEqual(value)
      }
      expect(await store.readAll()).toEqual(await untouched.readAll())
    },
  )

  it('loses no key when several writers change one file at once', async () => {
    const { dataFolder, store } = await storeIn('settings-concurrent-')
    const second = new RuntimeSettingsStore({
      dataFolder,
      workspaceRoot: path.join(dataFolder, 'workspace-a'),
      log: collectingLogger([]),
      sleep,
    })
    const keys = Array.from({ length: 24 }, (_, index) => `entry-${String(index)}`)
    await Promise.all(
      keys.map((key, index) =>
        (index % 2 === 0 ? store : second).setStorage(key, { index }, 'workspace'),
      ),
    )
    for (const [index, key] of keys.entries())
      expect(await store.getStorage(key, 'workspace')).toEqual({ index })
    await Promise.all([
      store.updateSetting('museSpark.autosave', true, 'user'),
      second.updateSetting('museSpark.paidDailyBudgetUsd', 3, 'user'),
      store.updateSetting('museSpark.respectGitIgnore', false, 'user'),
    ])
    expect(
      JSON.parse(await readFile(path.join(dataFolder, RUNTIME_SETTINGS_FILE), 'utf8')),
    ).toEqual({ autosave: true, paidDailyBudgetUsd: 3, respectGitIgnore: false })
  })

  it('keeps the two storage scopes apart, and null removes a key', async () => {
    const { dataFolder, store } = await storeIn('settings-storage-')
    const sessionId = randomUUID()
    await store.setStorage('lastSession', { sessionId }, 'workspace')
    await store.setStorage('lastSession', 'global', 'user')
    expect(await store.getStorage('lastSession', 'workspace')).toEqual({
      sessionId,
    })
    expect(await store.getStorage('lastSession', 'user')).toBe('global')
    const reopened = new RuntimeSettingsStore({
      dataFolder,
      workspaceRoot: path.join(dataFolder, 'workspace-a'),
      log: collectingLogger([]),
      sleep,
    })
    expect(await reopened.getStorage('lastSession', 'user')).toBe('global')
    await reopened.setStorage('lastSession', null, 'user')
    expect(await store.getStorage('lastSession', 'user')).toBeNull()
    expect(await store.getStorage('missing', 'workspace')).toBeNull()
  })

  it('refuses a damaged settings file and leaves it as it was', async () => {
    const { dataFolder, store } = await storeIn('settings-damaged-')
    const file = path.join(dataFolder, RUNTIME_SETTINGS_FILE)
    // A hand edit that broke the documented object: a trailing comma.
    await writeFile(file, '{"paidDailyBudgetUsd":5,}\n')
    expect(await refusal(store.getSetting('museSpark.autosave'))).toBe('MHP_STATE_DAMAGED')
    expect(await refusal(store.updateSetting('museSpark.autosave', true, 'user'))).toBe(
      'MHP_STATE_DAMAGED',
    )
    expect(await readFile(file, 'utf8')).toBe('{"paidDailyBudgetUsd":5,}\n')
  })

  it('tells every store in the process over the same files what changed', async () => {
    const { dataFolder, store } = await storeIn('settings-observe-')
    const heard: (readonly string[])[] = []
    const elsewhere: (readonly string[])[] = []
    const stop = store.onSettingsChanged((keys) => {
      heard.push(keys)
    })
    const otherWorkspace = new RuntimeSettingsStore({
      dataFolder,
      workspaceRoot: path.join(dataFolder, 'workspace-b'),
      log: collectingLogger([]),
      sleep,
    })
    const stopOther = otherWorkspace.onSettingsChanged((keys) => {
      elsewhere.push(keys)
    })
    const writer = new RuntimeSettingsStore({
      dataFolder,
      workspaceRoot: path.join(dataFolder, 'workspace-a'),
      log: collectingLogger([]),
      sleep,
    })
    await writer.updateSetting('museSpark.autosave', true, 'user')
    await writer.updateSetting('museSpark.respectGitIgnore', false, 'workspace')
    expect(heard).toEqual([['museSpark.autosave'], ['museSpark.respectGitIgnore']])
    expect(elsewhere).toEqual([['museSpark.autosave']])
    stop()
    stopOther()
    await writer.updateSetting('museSpark.autosave', false, 'user')
    expect(heard).toHaveLength(2)
  })
})
