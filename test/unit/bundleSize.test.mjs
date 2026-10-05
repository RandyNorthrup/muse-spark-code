import { existsSync, statSync } from 'node:fs'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('node:fs', () => ({ existsSync: vi.fn(), statSync: vi.fn() }))

const CONTENT_FILE = 'dist/whatsNew.json'
const CONTENT_BUDGET_BYTES = 40 * 1024

beforeEach(() => {
  vi.resetModules()
  existsSync.mockReturnValue(true)
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
