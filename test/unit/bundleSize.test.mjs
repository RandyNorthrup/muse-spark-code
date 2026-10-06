import { existsSync, readFileSync, statSync } from 'node:fs'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('node:fs', () => ({ existsSync: vi.fn(), readFileSync: vi.fn(), statSync: vi.fn() }))

const CONTENT_FILE = 'dist/whatsNew.json'
const CONTENT_BUDGET_BYTES = 40 * 1024

beforeEach(() => {
  vi.resetModules()
  existsSync.mockReturnValue(true)
  readFileSync.mockImplementation((file) =>
    JSON.stringify({
      outputs: {
        [file === 'dist/meta/portable.json'
          ? 'dist/webview/portable/main.js'
          : 'dist/webview/main.js']: { imports: [] },
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

describe('independent portable artifact budget', () => {
  const portable = 'dist/webview/portable/main.js'
  const chunk = 'dist/webview/portable/chunks/lazy.js'
  const bridge = 'dist/webview/portable/bridge.js'
  const budget = 1100 * 1024
  beforeEach(() => {
    readFileSync.mockImplementation((file) =>
      JSON.stringify({
        outputs:
          file === 'dist/meta/portable.json'
            ? { [portable]: { imports: [] }, [chunk]: { imports: [] }, [bridge]: { imports: [] } }
            : { 'dist/webview/main.js': { imports: [] } },
      }),
    )
  })
  it('admits the exact aggregate cap, including lazy chunks and bridge entry', async () => {
    statSync.mockImplementation((file) => ({
      size: file === portable ? budget - 2 : Number(file === chunk || file === bridge),
    }))
    await import('../../scripts/check-bundle-size.mjs')
    expect(process.exit).not.toHaveBeenCalled()
  })
  it.each([chunk, bridge])('rejects one byte over the total in %s', async (extra) => {
    statSync.mockImplementation((file) => ({
      size: file === portable ? budget : Number(file === extra),
    }))
    await expect(import('../../scripts/check-bundle-size.mjs')).rejects.toThrow('exit 1')
    expect(console.log).toHaveBeenCalledWith(
      'OVER dist/webview/portable/main.js: 1100.0 KiB (budget 1100 KiB)',
    )
  })
  it('rejects a missing lazy portable chunk', async () => {
    existsSync.mockImplementation((file) => file !== chunk)
    await expect(import('../../scripts/check-bundle-size.mjs')).rejects.toThrow('exit 1')
    expect(console.log).toHaveBeenCalledWith(`MISS ${portable}: missing chunks ${chunk}`)
  })
  it('retains the existing deferred VS Code cap', async () => {
    readFileSync.mockReturnValue(
      JSON.stringify({
        outputs: {
          'dist/webview/main.js': { imports: [] },
          'dist/webview/chunks/lazy.js': { imports: [] },
        },
      }),
    )
    statSync.mockImplementation((file) => ({
      size: file === 'dist/webview/chunks/lazy.js' ? 50 * 1024 + 1 : 0,
    }))
    await expect(import('../../scripts/check-bundle-size.mjs')).rejects.toThrow('exit 1')
    expect(console.log).toHaveBeenCalledWith(
      'OVER dist/webview deferred JS: 50.0 KiB (budget 50 KiB)',
    )
  })
})

afterEach(() => vi.restoreAllMocks())

describe('bundled What’s New content budget', () => {
  it('counts eager chunks against the unchanged startup cap', async () => {
    readFileSync.mockReturnValue(
      JSON.stringify({
        outputs: {
          'dist/webview/main.js': {
            imports: [{ path: 'dist/webview/chunks/eager.js', kind: 'import-statement' }],
          },
          'dist/webview/chunks/eager.js': { imports: [] },
        },
      }),
    )
    statSync.mockImplementation((file) => ({
      size: file.endsWith('eager.js') ? 900 * 1024 + 1 : 0,
    }))
    await expect(import('../../scripts/check-bundle-size.mjs')).rejects.toThrow('exit 1')
  })

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
