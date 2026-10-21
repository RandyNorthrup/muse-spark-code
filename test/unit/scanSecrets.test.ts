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
    ['clean', 'ordinary hex 0123456789abcdef', 0, '0\n'],
    ['github canary', `ghp_${'a'.repeat(40)}`, 10, '1\n'],
    ['gadgets canary', `mgst_${'A'.repeat(42)}A`, 10, '1\n'],
    ['missing', undefined, 2, ''],
    ['invalid UTF-8', new Uint8Array([255]), 2, ''],
  ] as const)(
    'counts or refuses %s without disclosing content or paths',
    async (_label, input, code, expected) => {
      const dir = await mkdtemp(path.join(tmpdir(), 'scanner-real-'))
      const file = path.join(dir, 'input.txt')
      const output = path.join(dir, 'stdout.txt')
      const handle = await open(output, 'w')
      try {
        if (input !== undefined) await writeFile(file, input)
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
    },
  )
})
// The secret scanner refuses instead of echoing: an unreadable file reads
// as a usage refusal, never as key, path or exception text.
import type { FdWriter } from '../../src/runtime/exec/fdWriter'
import { EXEC_EXIT } from '../../src/shared/constants'

function untouchedOut(): FdWriter {
  return {
    write: () => {
      throw new Error('no output is written on refusal')
    },
    queuedBytes: 0,
    isClosed: false,
    flush: () => Promise.resolve(true),
  }
}

describe('runSecretScan refusal', () => {
  it('refuses an unreadable file without echoing it', async () => {
    const exit = await runSecretScan({
      file: 'no-such-scan-file.txt',
      keyFromStdin: false,
      stdin: Readable.from([]),
      signal: new AbortController().signal,
      readFile: async (filePath, maxBytes, signal): Promise<Uint8Array> => {
        if (signal.aborted) throw new Error('aborted')
        const bytes = await readFile(filePath)
        return bytes.subarray(0, maxBytes)
      },
      out: untouchedOut(),
    })
    expect(exit).toBe(EXEC_EXIT.usage)
  })

  it('refuses when already aborted', async () => {
    const controller = new AbortController()
    controller.abort()
    const exit = await runSecretScan({
      file: 'no-such-scan-file.txt',
      keyFromStdin: false,
      stdin: Readable.from([]),
      signal: controller.signal,
      readFile: (filePath) => readFile(filePath),
      out: untouchedOut(),
    })
    expect(exit).toBe(EXEC_EXIT.usage)
  })
})
