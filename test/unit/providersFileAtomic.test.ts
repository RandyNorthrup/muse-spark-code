// The providers file's atomic write (D119): a briefly denied rename is
// retried, then the failure keeps its kind with its cause for the caller.
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { rename } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { ATOMIC_RENAME_ATTEMPTS } from '../../src/shared/constants'
import {
  emptyProvidersFile,
  writeProvidersFileAtomic,
} from '../../src/core/providers/providersFile'

const dirs: string[] = []

afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true })
})

function folder(): string {
  const dir = mkdtempSync(path.join(tmpdir(), 'pr161-atomic-'))
  dirs.push(dir)
  return dir
}

/** A real denied-rename failure shape: an Error carrying the platform code. */
function denied(code: string): NodeJS.ErrnoException {
  return Object.assign(new Error(`rename denied: ${code}`), { code })
}

describe('writeProvidersFileAtomic failures', () => {
  it('retries a briefly denied rename, then writes the complete file', async () => {
    const dir = folder()
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

  it('keeps a persistent denial with its cause after the bounded attempts', async () => {
    const dir = folder()
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
    expect(result.reason).toBe('io-error')
    expect(result.cause).toBe(failure)
  })

  it('keeps a non-retryable failure at once, without retrying', async () => {
    const dir = folder()
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
    expect(result.reason).toBe('io-error')
    expect(result.cause).toBe(failure)
  })
})
