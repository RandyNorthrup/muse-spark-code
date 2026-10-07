import { existsSync, readFileSync, statSync } from 'node:fs'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('node:fs', () => ({ existsSync: vi.fn(), readFileSync: vi.fn(), statSync: vi.fn() }))

const CONTENT_FILE = 'dist/whatsNew.json'
const CONTENT_BUDGET_BYTES = 40 * 1024

function mockWebviewMeta(meta, models, whatsNew) {
  let modelsMeta =
    models ??
    (meta.outputs['dist/webview/models.js'] === undefined
      ? { outputs: { 'dist/webview/models.js': { imports: [] } } }
      : meta)
  modelsMeta = {
    ...modelsMeta,
    outputs: {
      ...modelsMeta.outputs,
      'dist/webview/chunks/models-body.js': {
        imports: [],
        entryPoint: 'src/webview/models/panel.tsx',
      },
    },
  }
  const pageMetafiles = {
    'dist/meta/usageWebview.json': {
      outputs: {
        'dist/webview/usage.js': { imports: [] },
        'dist/webview/chunks/usage-body.js': {
          imports: [],
          entryPoint: 'src/webview/usage/UsageApp.tsx',
        },
      },
    },
    'dist/meta/modelsWebview.json': modelsMeta,
    'dist/meta/whatsNewPage.json': whatsNew ?? {
      outputs: { 'dist/webview/whatsNew.js': { imports: [] } },
    },
  }
  readFileSync.mockImplementation((file) => JSON.stringify(pageMetafiles[file] ?? meta))
}

beforeEach(() => {
  vi.resetModules()
  existsSync.mockReturnValue(true)
  mockWebviewMeta({ outputs: { 'dist/webview/main.js': { imports: [] } } })
  statSync.mockImplementation((file) => ({
    size: file === CONTENT_FILE ? CONTENT_BUDGET_BYTES : 0,
  }))
  vi.spyOn(console, 'log').mockImplementation(vi.fn())
  vi.spyOn(console, 'error').mockImplementation(vi.fn())
  vi.spyOn(process, 'exit').mockImplementation((code) => {
    throw new Error(`exit ${code}`)
  })
})

afterEach(() => vi.restoreAllMocks())

describe('bundled What’s New content budget', () => {
  it.each([
    ['models', 75],
    ['usage', 50],
  ])('bounds the complete lazy %s body at %i KiB', async (name, budget) => {
    const body = `dist/webview/chunks/${name}-body.js`
    statSync.mockImplementation((file) => ({ size: file === body ? budget * 1024 : 0 }))
    await import('../../scripts/check-bundle-size.mjs')
    expect(process.exit).not.toHaveBeenCalled()
    vi.resetModules()
    statSync.mockImplementation((file) => ({ size: file === body ? budget * 1024 + 1 : 0 }))
    await expect(import('../../scripts/check-bundle-size.mjs')).rejects.toThrow('exit 1')
    expect(console.log).toHaveBeenCalledWith(
      `OVER dist/webview ${name} body: ${budget.toFixed(1)} KiB (budget ${budget} KiB)`,
    )
  })
  it('bounds reachable deferred chat chunks while allowing the separately budgeted usage page', async () => {
    mockWebviewMeta({
      outputs: {
        'dist/webview/main.js': {
          imports: [{ path: 'dist/webview/chunks/dialog.js', kind: 'dynamic-import' }],
        },
        'dist/webview/chunks/dialog.js': { imports: [] },
        'dist/webview/models.js': { imports: [] },
        'dist/webview/usage.js': { imports: [] },
        'dist/webview/whatsNew.js': { imports: [] },
      },
    })
    statSync.mockImplementation((file) => ({ size: file.endsWith('usage.js') ? 200 * 1024 : 0 }))
    await import('../../scripts/check-bundle-size.mjs')
    expect(process.exit).not.toHaveBeenCalled()
    vi.resetModules()
    statSync.mockImplementation((file) => ({
      size: file.endsWith('dialog.js') ? 50 * 1024 + 1 : 0,
    }))
    await expect(import('../../scripts/check-bundle-size.mjs')).rejects.toThrow('exit 1')
    expect(console.log).toHaveBeenCalledWith(
      'OVER dist/webview deferred JS: 50.0 KiB (budget 50 KiB)',
    )
  })

  it('counts eager chunks against the unchanged startup cap', async () => {
    mockWebviewMeta({
      outputs: {
        'dist/webview/main.js': {
          imports: [{ path: 'dist/webview/chunks/eager.js', kind: 'import-statement' }],
        },
        'dist/webview/chunks/eager.js': { imports: [] },
      },
    })
    statSync.mockImplementation((file) => ({
      size: file.endsWith('eager.js') ? 900 * 1024 + 1 : 0,
    }))
    await expect(import('../../scripts/check-bundle-size.mjs')).rejects.toThrow('exit 1')
  })

  it('counts shared static chunks against the measured Models startup cap', async () => {
    const chunk = 'dist/webview/chunks/models-shared.js'
    mockWebviewMeta(
      { outputs: { 'dist/webview/main.js': { imports: [] } } },
      {
        outputs: {
          'dist/webview/models.js': { imports: [{ path: chunk, kind: 'import-statement' }] },
          [chunk]: { imports: [] },
        },
      },
    )
    statSync.mockImplementation((file) => ({ size: file === chunk ? 500 * 1024 : 0 }))
    await import('../../scripts/check-bundle-size.mjs')
    expect(process.exit).not.toHaveBeenCalled()
    vi.resetModules()
    statSync.mockImplementation((file) => ({ size: file === chunk ? 500 * 1024 + 1 : 0 }))
    await expect(import('../../scripts/check-bundle-size.mjs')).rejects.toThrow('exit 1')
    expect(console.log).toHaveBeenCalledWith(
      'OVER dist/webview/models.js + static imports: 500.0 KiB (budget 500 KiB)',
    )
  })

  it('counts shared static chunks against the unchanged What’s New page cap', async () => {
    const chunk = 'dist/webview/chunks/notes-shared.js'
    mockWebviewMeta({ outputs: { 'dist/webview/main.js': { imports: [] } } }, undefined, {
      outputs: {
        'dist/webview/whatsNew.js': { imports: [{ path: chunk, kind: 'import-statement' }] },
        [chunk]: { imports: [] },
      },
    })
    statSync.mockImplementation((file) => ({ size: file === chunk ? 25 * 1024 : 0 }))
    await import('../../scripts/check-bundle-size.mjs')
    expect(process.exit).not.toHaveBeenCalled()
    vi.resetModules()
    statSync.mockImplementation((file) => ({ size: file === chunk ? 25 * 1024 + 1 : 0 }))
    await expect(import('../../scripts/check-bundle-size.mjs')).rejects.toThrow('exit 1')
  })

  it.each([
    { root: 'dist/webview/main.js', budget: 900, over: true },
    { root: 'dist/webview/models.js', budget: 500, over: true },
    { root: 'dist/webview/models.js', budget: 500, over: false },
  ])(
    'counts $root eager chunks at the $budget KiB boundary (over: $over)',
    async ({ root, budget, over }) => {
      const other = root.endsWith('main.js') ? 'dist/webview/models.js' : 'dist/webview/main.js'
      const eager = 'dist/webview/chunks/eager.js'
      mockWebviewMeta({
        outputs: {
          [root]: { imports: [{ path: eager, kind: 'import-statement' }] },
          [other]: { imports: [] },
          'dist/webview/usage.js': { imports: [] },
          [eager]: { imports: [] },
        },
      })
      statSync.mockImplementation((file) => ({
        size: file === eager ? budget * 1024 + (over ? 1 : 0) : 0,
      }))
      const run = import('../../scripts/check-bundle-size.mjs')
      if (over) {
        await expect(run).rejects.toThrow('exit 1')
        expect(console.log).toHaveBeenCalledWith(expect.stringContaining(`OVER ${root}`))
      } else {
        await run
        expect(process.exit).not.toHaveBeenCalled()
      }
    },
  )

  it.each([
    ['deferred JS', 50, 'src/webview/deferredUnknown.ts'],
    ['code highlighting', 125, 'src/webview/components/HighlightedCode.tsx'],
    ['action dialogs', 25, 'src/webview/components/ShareView.tsx'],
    ['tasks tab', 25, 'src/webview/TasksApp.tsx'],
    ['provider usage', 25, 'src/webview/components/ProviderUsageSection.tsx'],
    ['paid usage', 25, 'src/webview/components/PaidUsageSection.tsx'],
    ['team UI', 25, 'src/webview/components/TeamUi.tsx'],
    ['SignIn', 25, 'src/webview/components/SignIn.tsx'],
    ['GoalPanel', 25, 'src/webview/components/GoalPanel.tsx'],
    ['SchedulePanel', 25, 'src/webview/components/SchedulePanel.tsx'],
    ['Palette', 25, 'src/webview/components/Palette.tsx'],
    ['PopoverMenu', 25, 'src/webview/components/PopoverMenu.tsx'],
    ['GooeyMenuContent', 25, 'src/webview/components/GooeyMenuContent.tsx'],
    ['UsageDialogContent', 25, 'src/webview/components/UsageDialogContent.tsx'],
    ['AgentMapContent', 25, 'src/webview/components/AgentMapContent.tsx'],
    ['LegalReport', 25, 'src/webview/components/LegalReport.tsx'],
    ['ReviewCommentForm', 25, 'src/webview/components/ReviewCommentForm.tsx'],
    ['surface English', 25, 'browser-surface-english:browser-surface-english'],
  ])(
    'enforces the %s cap without widening the original deferred allowance',
    async (name, cap, entryPoint) => {
      const chunk = 'dist/webview/chunks/optional.js'
      mockWebviewMeta({
        outputs: {
          'dist/webview/main.js': { imports: [{ path: chunk, kind: 'dynamic-import' }] },
          [chunk]: { imports: [], entryPoint },
        },
      })
      statSync.mockImplementation((file) => ({ size: file === chunk ? cap * 1024 : 0 }))
      await import('../../scripts/check-bundle-size.mjs')
      expect(console.log).toHaveBeenCalledWith(
        `ok   dist/webview ${name}: ${cap}.0 KiB (budget ${cap} KiB)`,
      )
      vi.resetModules()
      statSync.mockImplementation((file) => ({ size: file === chunk ? cap * 1024 + 1 : 0 }))
      await expect(import('../../scripts/check-bundle-size.mjs')).rejects.toThrow('exit 1')
    },
  )

  it('admits exactly 40 KiB of raw JSON', async () => {
    await import('../../scripts/check-bundle-size.mjs')
    expect(console.log).toHaveBeenCalledWith('ok   dist/whatsNew.json: 40.0 KiB (budget 40 KiB)')
    expect(process.exit).not.toHaveBeenCalled()
  })

  it('rejects one byte over 40 KiB', async () => {
    statSync.mockImplementation((file) => ({
      size: file === CONTENT_FILE ? CONTENT_BUDGET_BYTES + 1 : 0,
    }))
    await expect(import('../../scripts/check-bundle-size.mjs')).rejects.toThrow('exit 1')
    expect(console.log).toHaveBeenCalledWith('OVER dist/whatsNew.json: 40.0 KiB (budget 40 KiB)')
  })

  it('rejects a missing content file', async () => {
    existsSync.mockImplementation((file) => file !== CONTENT_FILE)
    await expect(import('../../scripts/check-bundle-size.mjs')).rejects.toThrow('exit 1')
    expect(console.log).toHaveBeenCalledWith('MISS dist/whatsNew.json: not built (budget 40 KiB)')
  })
})
