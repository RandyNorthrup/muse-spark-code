import { existsSync, readFileSync, statSync } from 'node:fs'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('node:fs', () => ({ existsSync: vi.fn(), readFileSync: vi.fn(), statSync: vi.fn() }))

const CONTENT_FILE = 'dist/whatsNew.json'
const CONTENT_BUDGET_BYTES = 40 * 1024

beforeEach(() => {
  vi.resetModules()
  existsSync.mockReturnValue(true)
  readFileSync.mockReturnValue(
    JSON.stringify({
      outputs: {
        'dist/webview/main.js': { imports: [] },
        'dist/webview/models.js': { imports: [] },
      },
    }),
  )
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
    { root: 'dist/webview/main.js', budget: 900, over: true },
    { root: 'dist/webview/models.js', budget: 475, over: true },
    { root: 'dist/webview/models.js', budget: 475, over: false },
  ])(
    'counts $root eager chunks at the $budget KiB boundary (over: $over)',
    async ({ root, budget, over }) => {
      const other = root.endsWith('main.js') ? 'dist/webview/models.js' : 'dist/webview/main.js'
      const eager = 'dist/webview/chunks/eager.js'
      readFileSync.mockReturnValue(
        JSON.stringify({
          outputs: {
            [root]: { imports: [{ path: eager, kind: 'import-statement' }] },
            [other]: { imports: [] },
            [eager]: { imports: [] },
          },
        }),
      )
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
  ])(
    'enforces the %s cap without widening the original deferred allowance',
    async (name, cap, entryPoint) => {
      const chunk = 'dist/webview/chunks/optional.js'
      readFileSync.mockReturnValue(
        JSON.stringify({
          outputs: {
            'dist/webview/main.js': { imports: [{ path: chunk, kind: 'dynamic-import' }] },
            'dist/webview/models.js': { imports: [] },
            [chunk]: { imports: [], entryPoint },
          },
        }),
      )
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
