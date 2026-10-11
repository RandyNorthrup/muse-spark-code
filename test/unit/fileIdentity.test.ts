import { mkdtemp, open, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { expect, it } from 'vitest'
import {
  fileIdentityKey,
  fileReadIdentity,
  handleIdentity,
  lstatIdentity,
  sameFile,
  statIdentity,
  statIdentitySync,
} from '../../src/core/fs/fileIdentity'

it.each(['ino', 'dev'] as const)('keeps distinct native %s IDs that alias as Numbers', (field) => {
  const first = { dev: 77n, ino: 88n, [field]: 9_007_199_254_740_992n }
  const second = { ...first, [field]: 9_007_199_254_740_993n }
  expect(Number(first[field])).toBe(Number(second[field]))
  expect(sameFile(first, second)).toBe(false)
  expect(sameFile(first, first)).toBe(true)
  expect(fileIdentityKey(first)).not.toBe(fileIdentityKey(second))
})

it('samples pathname, link pathname and held handle as BigInts', async () => {
  const folder = await mkdtemp(path.join(tmpdir(), 'muse-identity-'))
  const file = path.join(folder, 'file.txt')
  try {
    await writeFile(file, 'bytes')
    const handle = await open(file, 'r')
    try {
      const held = await handleIdentity(handle)
      for (const sample of [
        await statIdentity(file),
        await lstatIdentity(file),
        statIdentitySync(file),
      ]) {
        expect(typeof sample.ino).toBe('bigint')
        expect(typeof sample.dev).toBe('bigint')
        expect(sameFile(sample, held)).toBe(true)
      }
    } finally {
      await handle.close()
    }
  } finally {
    await rm(folder, { recursive: true, force: true })
  }
})

it('refuses missing or invalid native identity keys', () => {
  expect(fileIdentityKey({ dev: 1n, ino: 0n })).toBeUndefined()
  expect(fileIdentityKey({ dev: -1n, ino: 1n })).toBeUndefined()
})

it('retains exact source IDs and nanosecond timestamps above the Number precision boundary', () => {
  expect(
    fileReadIdentity({
      dev: 9_007_199_254_740_993n,
      ino: 9_007_199_254_740_995n,
      size: 12n,
      mtimeNs: 1_791_305_700_123_456_789n,
    }),
  ).toEqual({
    dev: '9007199254740993',
    ino: '9007199254740995',
    size: 12,
    mtime: '1791305700123456789',
  })
})
