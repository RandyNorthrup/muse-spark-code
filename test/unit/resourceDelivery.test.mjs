import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import path from 'node:path'
import { createRequire } from 'node:module'
import { build } from 'esbuild'
import { afterAll, beforeAll, expect, it } from 'vitest'

const fixture = { root: '', host: undefined, errors: [] }
// Compile and bundle once; tests exercise the actual default helper callback.
beforeAll(async () => {
  if (process.platform !== 'linux') return
  mkdirSync('temp', { recursive: true })
  fixture.root = mkdtempSync(path.resolve('temp', 'fixw-delivery-'))
  const native = path.join(fixture.root, 'native', 'linux', process.arch)
  mkdirSync(native, { recursive: true })
  const helper = path.join(native, 'muse-created')
  execFileSync(
    '/usr/bin/cc',
    [
      '-Os',
      '-s',
      '-Wall',
      '-Wextra',
      '-Werror',
      '-DMUSE_CREATED_STANDALONE',
      'native/darwin/MuseSparkCreated.c',
      '-Wl,--gc-sections',
      '-Wl,-Bstatic',
      '-lcrypto',
      '-Wl,-Bdynamic',
      '-o',
      helper,
    ],
    { env: { PATH: '/usr/bin:/bin' } },
  )
  const entry = path.join(fixture.root, 'dist', 'resourceGovernor.js')
  await build({
    entryPoints: ['src/core/resources/resourceGovernorEntry.ts'],
    outfile: entry,
    bundle: true,
    platform: 'node',
    format: 'cjs',
    target: 'node22',
    logLevel: 'silent',
  })
  fixture.host = createRequire(import.meta.url)(entry).resourceGovernorHost({
    inspect: (key) => (key === 'resourceGovernor' ? { globalValue: false } : undefined),
    registryFile: path.join(fixture.root, 'records', 'created.json'),
    onError: () => {
      fixture.errors.push('resource error')
    },
  })
})
afterAll(() => {
  fixture.host?.dispose()
  if (fixture.root) rmSync(fixture.root, { recursive: true, force: true })
})
it('P1 the delivered Linux helper admits an ordinary shell with the governor off', async () => {
  if (process.platform !== 'linux') return
  const lease = await fixture.host.admit('toolShell')
  expect(lease.temp.root.startsWith(fixture.root)).toBe(true)
  expect(lease.temp.environment.TMPDIR).toBe(lease.temp.root)
  expect(readFileSync('THIRD_PARTY_NOTICES.txt', 'utf8')).toContain(
    'OpenSSL (Linux native helper, Apache-2.0)',
  )
  // Wait for actual registered retirement before deleting the test's private build root.
  const root = lease.temp.root
  lease.complete(true)
  await expect.poll(() => existsSync(root)).toBe(false)
  await expect
    .poll(() =>
      JSON.parse(readFileSync(path.join(fixture.root, 'records', 'created.json'), 'utf8')),
    )
    .toEqual([])
  expect(fixture.errors).toEqual([])
})
it('P3 the security guide reflects repaired DK guards and the precise qualifications', () => {
  const security = readFileSync('SECURITY.md', 'utf8')
  expect(security).toContain('The final DK repair is joined')
  expect(security).toContain('final same-user empty-name window')
  expect(security).not.toContain('FIXM107DK4 is separately assigned')
})
