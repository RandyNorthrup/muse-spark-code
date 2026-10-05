import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { runInNewContext } from 'node:vm'
import { build } from 'esbuild'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type * as vscode from 'vscode'
import { isJudgeEngineOn } from '../../src/core/judge/engine'
import { createPaidFeatures } from '../../src/host/paid/paidHost'
import {
  PAID_FEATURE_SETTINGS,
  SETTING_DEFAULTS,
  type PaidFeature,
  UI_TEXT,
} from '../../src/shared/constants'
import type { ExtensionSettings } from '../../src/host/settings'
import { FakeLogOutputChannel } from './helpers/fakes'
import { mockJudgePaidConfiguration } from './helpers/judgePaidConfiguration'
import { confirmModal } from './helpers/vscodeViews'
import { window, workspace } from './mocks/vscode'

vi.mock('vscode', async (importOriginal) => ({
  ...(await importOriginal<typeof vscode>()),
  ConfigurationTarget: { Global: 1 },
}))

// Evaluate activation's actual callback over validated test settings, as
// activationReview.ts does for the adapters outside unit coverage.
function isActivationSettingOn(feature: PaidFeature, settings: ExtensionSettings): boolean {
  const source = readFileSync(new URL('../../src/extension.ts', import.meta.url), 'utf8')
  const paidAt = source.indexOf('const paid = createPaidFeatures(')
  const start = source.indexOf('isSettingOn:', paidAt)
  const end = source.indexOf('isKeyStored:', start)
  if (paidAt === -1 || start < paidAt || end <= start) {
    throw new Error('activation paid callback not found')
  }
  const value: unknown = runInNewContext(`({${source.slice(start, end)}}).isSettingOn(feature)`, {
    feature,
    currentSettings: () => settings,
    PAID_FEATURE_SETTINGS,
    isJudgeEngineOn,
  })
  if (typeof value !== 'boolean') {
    throw new TypeError('activation paid callback did not return a boolean')
  }
  return value
}

function paidAtActivation(settings: ExtensionSettings, isKeyStored = false) {
  const stored = new Map<string, unknown>()
  const state = {
    get: (key: string) => stored.get(key),
    update: vi.fn((key: string, value: unknown) => {
      stored.set(key, value)
      return Promise.resolve()
    }),
  }
  return createPaidFeatures({
    globalState: state,
    workspaceState: state,
    isSettingOn: (feature) => isActivationSettingOn(feature, settings),
    isKeyStored: () => isKeyStored,
    canRememberPaidUse: () => true,
    log: new FakeLogOutputChannel(),
  })
}

beforeEach(() => {
  window.state.focused = true
  vi.mocked(confirmModal).mockReset()
  vi.mocked(workspace.getConfiguration).mockReset()
  mockJudgePaidConfiguration()
})

describe('judge activation routing', () => {
  it.each(['auto', 'same', 'off'] as const)(
    'does not ask or disable a subscription-only judge at startup with %s',
    async (engine) => {
      vi.mocked(confirmModal).mockResolvedValue(UI_TEXT.paidConfirmAccept)
      const settings = { ...SETTING_DEFAULTS, 'judge.engine': engine }
      const paid = paidAtActivation(settings)
      await paid.gate.review()
      expect(confirmModal).not.toHaveBeenCalled()
      expect(workspace.getConfiguration).not.toHaveBeenCalled()
      expect(paid.gate.isOn('judge')).toBe(false)
      expect(settings['judge.engine']).toBe(engine)
    },
  )

  it('declining an unrelated Model API price leaves the judge selection alone', async () => {
    const { update } = mockJudgePaidConfiguration()
    vi.mocked(confirmModal).mockResolvedValue(undefined)
    const paid = paidAtActivation({ ...SETTING_DEFAULTS, modelApiImageGeneration: true }, true)
    await paid.gate.review()
    expect(confirmModal).toHaveBeenCalledTimes(1)
    expect(update).toHaveBeenCalledExactlyOnceWith('modelApiImageGeneration', false, 1)
    expect(paid.gate.isOn('judge')).toBe(false)
  })
})

describe('judge activation bundle', () => {
  it('keeps judge schemas out of the activation dependency graph', async () => {
    const result = await build({
      absWorkingDir: fileURLToPath(new URL('../../', import.meta.url)),
      entryPoints: ['src/extension.ts'],
      bundle: true,
      platform: 'node',
      format: 'cjs',
      target: 'node20.18',
      external: ['vscode'],
      write: false,
      metafile: true,
      logLevel: 'silent',
    })
    expect(Object.keys(result.metafile.inputs)).not.toContain('src/core/judge/schema.ts')
  })

  it('bundles the engine predicate without zod or the judge contract', async () => {
    const result = await build({
      absWorkingDir: fileURLToPath(new URL('../../', import.meta.url)),
      entryPoints: ['src/core/judge/engine.ts'],
      bundle: true,
      platform: 'node',
      format: 'cjs',
      write: false,
      metafile: true,
      logLevel: 'silent',
    })
    expect(Object.keys(result.metafile.inputs)).toEqual(['src/core/judge/engine.ts'])
  })
})
