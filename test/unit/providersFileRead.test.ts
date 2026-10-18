// D119 catch burn-down: only a missing file reads as missing, only
// malformed text as unparseable. The file system fails for real below;
// any other read failure keeps its cause on the refusal.
import { writeFileSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { emptyProvidersFile, readProvidersFile } from '../../src/core/providers/providersFile'
import { usingTempDir } from './helpers/temporaryFolders'

function coded(code: string): Error {
  return Object.assign(new Error(`${code}: permission denied, open 'providers.json'`), { code })
}

describe('providers file read failures', () => {
  it('reads a missing file as missing', async () => {
    await usingTempDir('providers-read-', async (folder) => {
      const result = await readProvidersFile(path.join(folder, 'providers.json'))
      expect(result).toEqual({ ok: false, reason: 'missing', detail: expect.any(String) })
    })
  })

  it('reads malformed text as unparseable naming the file', async () => {
    await usingTempDir('providers-read-', async (folder) => {
      const file = path.join(folder, 'providers.json')
      writeFileSync(file, '{oops')
      const result = await readProvidersFile(file)
      expect(result).toEqual({ ok: false, reason: 'unparseable', detail: file })
    })
  })

  it('keeps a non-missing read failure’s cause off the detail', async () => {
    const failure = coded('EACCES')
    const result = await readProvidersFile('providers.json', () => Promise.reject(failure))
    expect(result).toMatchObject({ ok: false, reason: 'unparseable', detail: 'providers.json' })
    if (result.ok) throw new Error('expected a refusal')
    expect(result.cause).toBe(failure)
  })

  it('reads a refused file as missing only for ENOENT', async () => {
    const missing = await readProvidersFile('providers.json', () => Promise.reject(coded('ENOENT')))
    expect(missing).toEqual({ ok: false, reason: 'missing', detail: 'providers.json' })
  })

  it('still reads a valid file', async () => {
    await usingTempDir('providers-read-', async (folder) => {
      const file = path.join(folder, 'providers.json')
      writeFileSync(file, JSON.stringify(emptyProvidersFile()))
      const result = await readProvidersFile(file)
      expect(result.ok).toBe(true)
    })
  })
})
