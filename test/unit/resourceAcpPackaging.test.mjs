import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { copyFileSync, existsSync, readFileSync, statSync } from 'node:fs'
import { execFileSync } from 'node:child_process'

vi.mock('node:fs', () => ({
  copyFileSync: vi.fn(),
  cpSync: vi.fn(),
  existsSync: vi.fn(),
  mkdirSync: vi.fn(),
  readFileSync: vi.fn(),
  rmSync: vi.fn(),
  statSync: vi.fn(),
  writeFileSync: vi.fn(),
}))
vi.mock('node:child_process', () => ({ execFileSync: vi.fn() }))
vi.mock('../../scripts/check-badges.mjs', () => ({ renderPackageReadme: (text) => text }))

beforeEach(() => {
  vi.resetModules()
  vi.clearAllMocks()
  vi.spyOn(console, 'log').mockImplementation(vi.fn())
  existsSync.mockReturnValue(true)
  statSync.mockReturnValue({ isFile: () => true })
  readFileSync.mockImplementation((file) => {
    if (file === 'package.json')
      return JSON.stringify({
        version: '0.0.0',
        license: 'MIT',
        repository: { url: 'https://example.invalid/project.git' },
        engines: { node: '>=22' },
        devDependencies: { '@napi-rs/keyring': '0.0.0' },
      })
    return file.endsWith('.schema.json') ? '{}' : 'fixture landing page'
  })
  execFileSync.mockReturnValue('fixture.tgz')
})
afterEach(() => vi.restoreAllMocks())

it('M107 copies both resource bundles and all three exec schemas into the ACP package before packing', async () => {
  await import('../../scripts/package-acp.mjs')
  const normalized = copyFileSync.mock.calls.map(([source, target]) => [
    source.replaceAll('\\', '/'),
    target.replaceAll('\\', '/'),
  ])
  for (const file of ['resourceGovernor.js', 'resourceAdmission.js'])
    expect(normalized).toContainEqual([`dist/${file}`, `dist/acp-package/dist/${file}`])
  for (const file of [
    'exec-result-v1.schema.json',
    'exec-event-v1.schema.json',
    'exec-event-v2.schema.json',
  ])
    expect(normalized).toContainEqual([`docs/schemas/${file}`, `dist/acp-package/schemas/${file}`])
  expect(execFileSync.mock.calls.at(-1)[0]).toBe('npm')
})

it.each(['resourceGovernor.js', 'resourceAdmission.js'])(
  'M107 refuses absent %s before any staging or child process',
  async (file) => {
    existsSync.mockImplementation((source) => source.replaceAll('\\', '/') !== `dist/${file}`)
    await expect(import('../../scripts/package-acp.mjs')).rejects.toThrow(`dist/${file} is missing`)
    expect(copyFileSync).not.toHaveBeenCalled()
    expect(execFileSync).not.toHaveBeenCalled()
  },
)

it('M107 refuses a non-file or malformed v2 schema before any staging or child process', async () => {
  statSync.mockImplementation((file) => ({
    isFile: () => !file.endsWith('exec-event-v2.schema.json'),
  }))
  await expect(import('../../scripts/package-acp.mjs')).rejects.toThrow('is not a regular file')
  expect(copyFileSync).not.toHaveBeenCalled()
  vi.resetModules()
  statSync.mockReturnValue({ isFile: () => true })
  const read = readFileSync.getMockImplementation()
  readFileSync.mockImplementation((file) =>
    file.endsWith('exec-event-v2.schema.json') ? 'invalid JSON' : read(file),
  )
  await expect(import('../../scripts/package-acp.mjs')).rejects.toThrow()
  expect(copyFileSync).not.toHaveBeenCalled()
  expect(execFileSync).not.toHaveBeenCalled()
})
