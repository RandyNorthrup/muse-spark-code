import { mkdir, mkdtemp, rm } from 'node:fs/promises'
import path from 'node:path'
import { describe, expect, it, onTestFinished, vi } from 'vitest'
import {
  createRuntimePresentation,
  createRuntimePresentationFactory,
} from '../../../src/host/views/runtimePresentationEntry'
import {
  runtimeSettings,
  type RuntimeFeatureContext,
} from '../../../src/runtime/panel/runtimeFeatures'
import { RuntimeSettingsStore } from '../../../src/runtime/settingsStore'
import type { ServeOptions } from '../../../src/runtime/cliArgs'
import { EN } from '../../../src/shared/l10n/en'
import { setUiText, uiLocale } from '../../../src/shared/l10n/text'
import { fakeSurface } from '../../unit/helpers/fakes'
import { fakePanelRuntime } from '../../unit/helpers/runtimePanel'
import { fakeServices } from './services'

function runGit(): Promise<never> {
  return Promise.reject(new Error('NO_FIXTURE_GIT'))
}

async function fixture() {
  await mkdir('temp', { recursive: true })
  const root = await mkdtemp(path.resolve('temp/m104-pc-factory-'))
  onTestFinished(() => rm(root, { recursive: true, force: true }))
  const f = fakeServices()
  const options: ServeOptions = {
    backend: 'museCode',
    trustWorkspace: false,
    museBinary: '',
    shellSandbox: 'off',
    canBypass: false,
    allowsContributorModels: false,
    paidFeatures: [],
    isVerbose: false,
  }
  const store = new RuntimeSettingsStore(root, root)
  const settings = await runtimeSettings(store, f.log)
  onTestFinished(settings.dispose)
  const runtime = fakePanelRuntime({ options, distDir: root, homeDir: root, runGit, log: f.log })
  const surface = fakeSurface('chat')
  surface.takeRestoredSessionId.mockReturnValue('session')
  const owned: (() => Promise<void>)[] = []
  const context: RuntimeFeatureContext = {
    ports: {
      host: f.host,
      runtime,
      workspaceRoot: root,
      options,
      store,
      settings,
      surface,
      controllers: () => [],
      runGit,
      selection: () => null,
      documents: () => [],
      log: f.log,
    },
    own: (dispose) => {
      owned.push(dispose)
    },
    requireModelCapabilities: () => Promise.reject(new Error('INSPECTION_MUST_NOT_QUERY_A_MODEL')),
    openWorkspace: () => Promise.reject(new Error('NO_FIXTURE_WORKSPACE_OPEN')),
  }
  return { ...f, context, owned, surface }
}

describe('frozen runtime presentation factory', () => {
  it('provides real Tasks, follows the current session and registers early owned cleanup', async () => {
    const f = await fixture()
    const contribution = await createRuntimePresentation(f.context, EN, 'en')
    expect(f.owned).toHaveLength(1)
    contribution.features.tasksTab?.open({
      conversation: 'One',
      items: [],
    })
    await vi.waitFor(() => {
      expect(f.requests.at(-1)?.method).toBe('surfaces/open')
    })
    const binding = {
      surface: 'surface-1',
      surfaceKind: 'tasks',
      sessionId: 'session',
    } satisfies Parameters<NonNullable<typeof contribution.view>>[0]
    expect(contribution.view?.(binding)).toBeDefined()
    f.surface.takeRestoredSessionId.mockReturnValue('next')
    expect(contribution.view?.(binding)).toBeUndefined()
    const closing = contribution.dispose?.()
    expect(contribution.dispose?.()).toBe(closing)
    await closing
    await f.owned[0]?.()
    expect(f.requests.at(-1)?.method).toBe('surfaces/close')
  })
  it('binds the optional close subscription and unregisters it on release', async () => {
    const f = await fixture()
    const subscription = vi.fn<(listener: (id: string) => void) => () => void>(() => stop)
    const stop = vi.fn()
    const configured = createRuntimePresentationFactory(() => ({ onSurfaceClosed: subscription }))
    const contribution = await configured(f.context, EN, 'en')
    contribution.features.tasksTab?.open({
      conversation: 'One',
      items: [],
    })
    await vi.waitFor(() => {
      expect(
        contribution.view?.({ surface: 'surface-1', surfaceKind: 'tasks', sessionId: 'session' }),
      ).toBeDefined()
    })
    subscription.mock.calls[0]?.[0]('surface-1')
    expect(
      contribution.view?.({ surface: 'surface-1', surfaceKind: 'tasks', sessionId: 'session' }),
    ).toBeUndefined()
    await contribution.dispose?.()
    await Promise.all(f.owned.map((dispose) => dispose()))
    expect(stop).toHaveBeenCalledOnce()
    expect(f.requests.filter((request) => request.method === 'surfaces/close')).toHaveLength(0)
  })
  it('installs the caller locale before running owner configuration', async () => {
    const f = await fixture()
    const locales: string[] = []
    const configured = createRuntimePresentationFactory(() => {
      locales.push(uiLocale())
      return {}
    })
    try {
      const contribution = await configured(f.context, EN, 'tr')
      expect(locales).toEqual(['tr'])
      await contribution.dispose?.()
    } finally {
      setUiText(EN, 'en')
    }
  })
})
