// The secret scanner refuses instead of echoing: an unreadable file reads
// as a usage refusal, never as key, path or exception text.
import { readFile } from 'node:fs/promises'
import { Readable } from 'node:stream'
import { describe, expect, it } from 'vitest'
import type { FdWriter } from '../../src/runtime/exec/fdWriter'
import { runSecretScan } from '../../src/runtime/exec/scanSecrets'
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
