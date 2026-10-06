import { existsSync, readFileSync, statSync } from 'node:fs'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('node:fs', () => ({ existsSync: vi.fn(), readFileSync: vi.fn(), statSync: vi.fn() }))

const CONTENT_FILE = 'dist/whatsNew.json'
const CONTENT_BUDGET_BYTES = 40 * 1024

beforeEach(() => {
  vi.resetModules()
  existsSync.mockReturnValue(true)
  readFileSync.mockReturnValue(
    JSON.stringify({ outputs: { 'dist/webview/main.js': { imports: [] } } }),
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

function pacingFixture(pacingBytes, deferredBytes = 0) {
  readFileSync.mockReturnValue(
    JSON.stringify({
      outputs: {
        'dist/webview/main.js': {
          imports: [
            { path: 'dist/webview/pacing.js', kind: 'dynamic-import' },
            { path: 'dist/webview/deferred.js', kind: 'dynamic-import' },
          ],
        },
        'dist/webview/pacing.js': {
          entryPoint: String.raw`src\webview\components\ServiceStatusRow.tsx`,
          imports: [],
        },
        'dist/webview/deferred.js': {
          entryPoint: 'src/webview/components/UsageDialog.tsx',
          imports: [],
        },
      },
    }),
  )
  statSync.mockImplementation((file) => {
    if (file.endsWith('pacing.js')) return { size: pacingBytes }
    return { size: file.endsWith('deferred.js') ? deferredBytes : 0 }
  })
}

describe('M106 pacing UI budget', () => {
  it('admits exactly 25 KiB of exclusive pacing UI alongside the unchanged 50 KiB group', async () => {
    pacingFixture(25 * 1024, 50 * 1024)
    await import('../../scripts/check-bundle-size.mjs')
    expect(console.log).toHaveBeenCalledWith(
      'ok   dist/webview pacing JS: 25.0 KiB (budget 25 KiB)',
    )
    expect(process.exit).not.toHaveBeenCalled()
  })

  it('rejects one byte over the independent pacing UI budget', async () => {
    pacingFixture(25 * 1024 + 1)
    await expect(import('../../scripts/check-bundle-size.mjs')).rejects.toThrow('exit 1')
    expect(console.log).toHaveBeenCalledWith(
      'OVER dist/webview pacing JS: 25.0 KiB (budget 25 KiB)',
    )
  })

  it('keeps the original deferred group capped at 50 KiB', async () => {
    pacingFixture(1, 50 * 1024 + 1)
    await expect(import('../../scripts/check-bundle-size.mjs')).rejects.toThrow('exit 1')
    expect(console.log).toHaveBeenCalledWith(
      'OVER dist/webview deferred JS: 50.0 KiB (budget 50 KiB)',
    )
  })

  it('keeps static dependencies shared with another optional surface in the original group', async () => {
    const { webviewPacingOutputs } = await import('../../scripts/lib/webviewBundles.mjs')
    const shared = { path: 'shared.js', kind: 'import-statement' }
    expect(
      webviewPacingOutputs({
        outputs: {
          'dist/webview/main.js': { imports: [] },
          'pacing.js': {
            entryPoint: 'src/webview/components/ServiceStatusRow.tsx',
            imports: [shared],
          },
          'usage.js': { entryPoint: 'src/webview/components/UsageDialog.tsx', imports: [shared] },
          'shared.js': { imports: [] },
        },
      }),
    ).toEqual(['pacing.js'])
  })
})
