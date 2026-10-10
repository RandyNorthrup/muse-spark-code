import { execFileSync } from 'node:child_process'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir, totalmem } from 'node:os'
import path from 'node:path'
import { afterAll, beforeAll, expect, it } from 'vitest'
import { DarwinMemoryReader } from '../../src/core/resources/sampler/darwinMemory'

const PARITY_SLACK_BYTES = 64 * 1024 * 1024
const fixture = { folder: '', helper: '' }
const limits = { timeoutMs: 1000, maxOutputBytes: 128 }

beforeAll(async () => {
  if (process.platform !== 'darwin') return
  fixture.folder = await mkdtemp(path.join(tmpdir(), 'm107-memory-native-'))
  fixture.helper = path.join(fixture.folder, 'memory')
  execFileSync(
    '/usr/bin/cc',
    [
      '-Os',
      '-Wall',
      '-Wextra',
      '-Werror',
      '-DMUSE_CREATED_STANDALONE',
      '-arch',
      'x86_64',
      '-arch',
      'arm64',
      '-mmacosx-version-min=12.0',
      path.resolve('native/darwin/MuseSparkCreated.c'),
      '-o',
      fixture.helper,
    ],
    { env: { PATH: '/usr/bin:/bin', TMPDIR: fixture.folder } },
  )
  execFileSync('/usr/bin/codesign', ['--force', '--sign', '-', fixture.helper], { env: {} })
})
afterAll(async () => {
  if (fixture.folder) await rm(fixture.folder, { recursive: true, force: true })
})

it('matches libuv 1.52 available memory within one adjacent sample', async () => {
  if (process.platform !== 'darwin') return
  const sample = new DarwinMemoryReader(limits, fixture.helper)
  try {
    const compatibleProcess: { availableMemory?: () => number } = process
    const [major = 0, minor = 0] = process.versions.uv.split('.').map(Number)
    const hasParity = major > 1 || (major === 1 && minor >= 52)
    for (let index = 0; index < 5; index++) {
      const before = compatibleProcess.availableMemory?.()
      const native = await sample.read()
      const after = compatibleProcess.availableMemory?.()
      expect(native).toBeTypeOf('number')
      expect(native).toBeGreaterThanOrEqual(0)
      expect(native).toBeLessThanOrEqual(totalmem())
      // Old runtimes exercise the native reader; only 1.52+ has a parity oracle.
      if (before === undefined || after === undefined || !hasParity) continue
      expect(native).toBeGreaterThanOrEqual(Math.min(before, after) - PARITY_SLACK_BYTES)
      expect(native).toBeLessThanOrEqual(Math.max(before, after) + PARITY_SLACK_BYTES)
    }
  } finally {
    sample.dispose()
  }
})

it('exits on EOF, rejects foreign requests and preserves the existing directory protocol', () => {
  if (process.platform !== 'darwin') return
  expect(execFileSync(fixture.helper, ['--memory-headroom'], { input: '', env: {} }).length).toBe(0)
  expect(() =>
    execFileSync(fixture.helper, ['--memory-headroom'], { input: 'wrong\n', env: {} }),
  ).toThrow()
  expect(() =>
    execFileSync(fixture.helper, ['--memory-headroom', 'extra'], { input: '', env: {} }),
  ).toThrow()
  expect(() => execFileSync(fixture.helper, [], { input: '', env: {} })).toThrow()
})
