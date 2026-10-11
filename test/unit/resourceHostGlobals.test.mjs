import { existsSync, readFileSync } from 'node:fs'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'

vi.mock('node:fs', () => ({ existsSync: vi.fn(), readFileSync: vi.fn() }))
beforeEach(() => {
  vi.resetModules()
  existsSync.mockReturnValue(true)
  readFileSync.mockReturnValue('module.exports = {}')
  vi.spyOn(console, 'log').mockImplementation(vi.fn())
  vi.spyOn(console, 'error').mockImplementation(vi.fn())
  vi.spyOn(process, 'exit').mockImplementation((code) => {
    throw new Error(`exit ${code}`)
  })
})
afterEach(() => vi.restoreAllMocks())

it.each(['dist/resourceGovernor.js', 'dist/resourceProcess.js', 'dist/resourceAdmission.js'])(
  'M107 checks forbidden host globals and missing %s',
  async (file) => {
    readFileSync.mockImplementation((entry) => (entry === file ? 'typeof navigator' : ''))
    await expect(import('../../scripts/check-host-globals.mjs')).rejects.toThrow('exit 1')
    vi.resetModules()
    readFileSync.mockReturnValue('')
    existsSync.mockImplementation((entry) => entry !== file)
    await expect(import('../../scripts/check-host-globals.mjs')).rejects.toThrow('exit 1')
  },
)
