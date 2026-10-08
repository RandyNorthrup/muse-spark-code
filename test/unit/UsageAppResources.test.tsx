// @vitest-environment jsdom
import { appendFile, mkdir, mkdtemp, readdir } from 'node:fs/promises'
import path from 'node:path'
import { act, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { RESOURCE_JOURNAL_ROOT, ResourceJournal } from '../../src/core/usage/resourceJournal'
import { NodeUsageFs } from '../../src/runtime/usage/nodeUsageFs'
import { createUsageAccess } from '../../src/runtime/usage/usageServiceEntry'
import { UI_TEXT } from '../../src/shared/constants'
import { EN } from '../../src/shared/l10n/en'
import { formatPercent, setUiText } from '../../src/shared/l10n/text'
import { USAGE_EN } from '../../src/shared/l10n/usageEn'
import { setUsageText } from '../../src/shared/l10n/usageTable'
import type { UsagePageState } from '../../src/shared/usagePage'
import type { HostBridge } from '../../src/webview/hostBridge'
import { UsageApp } from '../../src/webview/usage/UsageApp'
import { FakeLogOutputChannel } from './helpers/fakes'
import { removeFolder } from './helpers/temporaryFolders'

const folders: string[] = []
beforeEach(() => {
  setUiText(EN, 'en')
  vi.stubGlobal('fetch', vi.fn())
})
afterEach(async () => {
  vi.unstubAllGlobals()
  setUsageText(USAGE_EN)
  for (const folder of folders.splice(0)) await removeFolder(folder)
})

async function journalFolder(): Promise<string> {
  await mkdir('temp', { recursive: true })
  const folder = await mkdtemp(path.resolve('temp/m107-usage-app-'))
  folders.push(folder)
  // The production writer every governor uses.
  const writer = new ResourceJournal(new NodeUsageFs(folder), {
    writerId: 'window',
    now: Date.now,
    isEnabled: () => true,
  })
  const atMs = Date.now() - 60_000
  await writer.append({
    type: 'resource',
    atMs,
    event: null,
    minute: {
      cpuPercent: 37,
      memoryUsedPercent: 61,
      availableMemory: 'ample',
      gpuPercent: null,
      diskBusyPercent: null,
      level: 'throttle',
      thresholds: { cpuMaxPercent: 85, memoryMaxPercent: 90, memoryMinFreeGiB: 2 },
    },
    work: [{ kind: 'check', cpuSeconds: 3, peakMemoryBytes: 2048 }],
  })
  return folder
}

async function productionState(folder: string): Promise<UsagePageState> {
  const usage = createUsageAccess({
    dataFolder: folder,
    packageRoot: process.cwd(),
    host: 'VS Code',
    locale: 'en',
    uiText: EN,
    log: new FakeLogOutputChannel(),
  })
  return await usage.read({ range: 'today', groupBy: 'provider', metric: 'cost' })
}

function mount(state: UsagePageState) {
  const messages = new EventTarget()
  const host: HostBridge = {
    post: vi.fn(),
    savedState: () => undefined,
    saveState: vi.fn(),
    messages,
  }
  render(<UsageApp host={host} now={Date.now} />)
  act(() => {
    messages.dispatchEvent(new MessageEvent('message', { data: { type: 'usage/state', state } }))
  })
}

it('mounts the lazy Resources section with the journal the usage service read', async () => {
  const state = await productionState(await journalFolder())
  mount(state)
  expect(await screen.findByText(UI_TEXT.resourceHistoryObserved)).toBeTruthy()
  expect(screen.getByRole('region', { name: UI_TEXT.resourceHistory })).toBeTruthy()
  expect(screen.getByText(`${formatPercent(37)} / ${formatPercent(85)}`)).toBeTruthy()
  expect(screen.getByText(`${formatPercent(61)} / ${formatPercent(90)}`)).toBeTruthy()
  expect(screen.getByRole('region', { name: UI_TEXT.resourceHarness })).toBeTruthy()
  expect(screen.queryByText(UI_TEXT.resourceHistoryInvalid)).toBeNull()
})

it('shows an unreadable journal as unavailable, never as empty history', async () => {
  const folder = await journalFolder()
  const root = path.join(folder, ...RESOURCE_JOURNAL_ROOT.split('/'))
  const [day] = await readdir(root)
  const dayPath = path.join(root, day ?? '')
  const [file] = await readdir(dayPath)
  await appendFile(path.join(dayPath, file ?? ''), '{"v":1}\n')
  const state = await productionState(folder)
  expect(state.resources).toBeNull()
  mount(state)
  const alert = await screen.findByRole('alert')
  expect(alert.textContent).toBe(UI_TEXT.resourceHistoryInvalid)
  expect(screen.queryByText(UI_TEXT.resourceHistoryEmpty)).toBeNull()
})

it('leaves the section out when a host reads no resource journal', async () => {
  const { resources: _absent, ...state } = await productionState(await journalFolder())
  mount(state)
  expect(await screen.findByText(USAGE_EN.privacyNote)).toBeTruthy()
  expect(screen.queryByText(UI_TEXT.resourceHistoryObserved)).toBeNull()
})
