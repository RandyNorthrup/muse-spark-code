import { mkdtemp, open, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { Readable } from 'node:stream'
import { describe, expect, it } from 'vitest'
import { runSecretScan } from '../../src/runtime/exec/scanSecrets'
import { createFdWriter } from '../../src/runtime/exec/fdWriter'
import { removeFolder } from './helpers/temporaryFolders'

// Actual input files and the production fd writer; no replaced stores, modules
// or provider. Canary strings are test data, never credentials.
describe('terminal secret scan', () => {
  it.each([
    ['ordinary hex 0123456789abcdef', 0, '0\n'],
    [`ghp_${'a'.repeat(40)}`, 10, '1\n'],
    [`mgst_${'A'.repeat(42)}A`, 10, '1\n'],
  ])('prints only a count and keeps excerpts private: %s', async (text, code, expected) => {
    const dir = await mkdtemp(path.join(tmpdir(), 'scanner-real-'))
    const file = path.join(dir, 'input.txt')
    const output = path.join(dir, 'stdout.txt')
    const handle = await open(output, 'w')
    try {
      await writeFile(file, text)
      const out = createFdWriter(handle.fd, () => {
        throw new Error('Unexpected output closure')
      })
      expect(
        await runSecretScan({
          file,
          keyFromStdin: false,
          stdin: Readable.from([]),
          signal: new AbortController().signal,
          readFile: (name) => readFile(name),
          out,
        }),
      ).toBe(code)
      expect(await readFile(output, 'utf8')).toBe(expected)
    } finally {
      await handle.close()
      await removeFolder(dir)
    }
  })

  it('refuses missing input and invalid UTF-8 without disclosing the file or path', async () => {
    const dir = await mkdtemp(path.join(tmpdir(), 'scanner-refusal-'))
    const output = path.join(dir, 'stdout.txt')
    const handle = await open(output, 'w')
    try {
      const invalid = path.join(dir, 'invalid.txt')
      await writeFile(invalid, new Uint8Array([255]))
      const out = createFdWriter(handle.fd, () => {
        throw new Error('Unexpected output closure')
      })
      for (const file of [path.join(dir, 'missing.txt'), invalid]) {
        expect(
          await runSecretScan({
            file,
            keyFromStdin: false,
            stdin: Readable.from([]),
            signal: new AbortController().signal,
            readFile: (name) => readFile(name),
            out,
          }),
        ).toBe(2)
      }
      expect(await readFile(output, 'utf8')).toBe('')
    } finally {
      await handle.close()
      await removeFolder(dir)
    }
  })
})
