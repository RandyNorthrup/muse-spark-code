import { existsSync, readFileSync, statSync } from 'node:fs'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('node:fs', () => ({ existsSync: vi.fn(), readFileSync: vi.fn(), statSync: vi.fn() }))

const CONTENT_FILE = 'dist/whatsNew.json'
const CONTENT_BUDGET_BYTES = 40 * 1024

function mockWebviewMeta(meta, models, whatsNew) {
  const modelsMeta = models ?? { outputs: { 'dist/webview/models.js': { imports: [] } } }
  const pageMetafiles = {
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

  it('counts shared static chunks against the unchanged Models startup cap', async () => {
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
    statSync.mockImplementation((file) => ({ size: file === chunk ? 475 * 1024 : 0 }))
    await import('../../scripts/check-bundle-size.mjs')
    expect(process.exit).not.toHaveBeenCalled()
    vi.resetModules()
    statSync.mockImplementation((file) => ({ size: file === chunk ? 475 * 1024 + 1 : 0 }))
    await expect(import('../../scripts/check-bundle-size.mjs')).rejects.toThrow('exit 1')
    expect(console.log).toHaveBeenCalledWith(
      'OVER dist/webview/models.js + static imports: 475.0 KiB (budget 475 KiB)',
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
    ['deferred JS', 50, undefined],
    ['code highlighting', 125, 'src/webview/components/HighlightedCode.tsx'],
    ['action dialogs', 25, 'src/webview/components/ShareView.tsx'],
    ['tasks tab', 25, 'src/webview/TasksApp.tsx'],
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
