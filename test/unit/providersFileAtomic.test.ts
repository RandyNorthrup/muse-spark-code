// The providers file's atomic write (D119): a briefly denied rename is
// retried, then the failure keeps its kind with its cause for the caller.
import { readFileSync } from 'node:fs'
import { rename } from 'node:fs/promises'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { usingTempDir } from './helpers/temporaryFolders'
import { ATOMIC_RENAME_ATTEMPTS } from '../../src/shared/constants'
import {
  emptyProvidersFile,
  writeProvidersFileAtomic,
} from '../../src/core/providers/providersFile'

/** A real denied-rename failure shape: an Error carrying the platform code. */
function denied(code: string): NodeJS.ErrnoException {
  return Object.assign(new Error(`rename denied: ${code}`), { code })
}

describe('writeProvidersFileAtomic failures', () => {
  it('retries a briefly denied rename, then writes the complete file', async () => {
    await usingTempDir('pr161-atomic-', async (dir) => {
      const filePath = path.join(dir, 'providers.json')
      const file = emptyProvidersFile()
      let calls = 0
      const result = await writeProvidersFileAtomic(filePath, file, async (from, to) => {
        calls += 1
        if (calls <= 2) throw denied('EPERM')
        await rename(from, to)
      })
      expect(result).toEqual({ ok: true })
      expect(calls).toBe(3)
      expect(JSON.parse(readFileSync(filePath, 'utf8'))).toEqual(file)
    })
  })

  it('keeps a persistent denial with its cause after the bounded attempts', async () => {
    await usingTempDir('pr161-atomic-', async (dir) => {
      const filePath = path.join(dir, 'providers.json')
      const failure = denied('EACCES')
      let calls = 0
      const result = await writeProvidersFileAtomic(filePath, emptyProvidersFile(), () => {
        calls += 1
        throw failure
      })
      expect(calls).toBe(ATOMIC_RENAME_ATTEMPTS)
      expect(result.ok).toBe(false)
      if (result.ok) throw new Error('a denied rename must not read as written')
      if (result.reason !== 'io-error') throw new Error('expected an io-error denial')
      expect(result.cause).toBe(failure)
    })
  })

  it('keeps a non-retryable failure at once, without retrying', async () => {
    await usingTempDir('pr161-atomic-', async (dir) => {
      const filePath = path.join(dir, 'providers.json')
      const failure = new TypeError('not a path')
      let calls = 0
      const result = await writeProvidersFileAtomic(filePath, emptyProvidersFile(), () => {
        calls += 1
        throw failure
      })
      expect(calls).toBe(1)
      expect(result.ok).toBe(false)
      if (result.ok) throw new Error('a failed rename must not read as written')
      if (result.reason !== 'io-error') throw new Error('expected an io-error denial')
      expect(result.cause).toBe(failure)
    })
  })
})
