import { PassThrough, Readable } from 'node:stream'
import { describe, expect, it, vi } from 'vitest'
import { runSecretScan } from '../../src/runtime/exec/scanSecrets'
import { outputWriter } from './helpers/execContract'

describe('M80 scanner (A21)', () => {
  it.each([
    ['ordinary hex 0123456789abcdef', 0],
    [`ghp_${'a'.repeat(400)}`, 10],
    ['LLM|123|key%punctuation', 10],
  ])('counts without excerpts: %s', async (text, code) => {
    const out = outputWriter()
    const controller = new AbortController()
    expect(
      await runSecretScan({
        file: 'private.patch',
        keyFromStdin: true,
        stdin: Readable.from(['LLM|123|key%punctuation\n']),
        signal: controller.signal,
        readFile: () => Promise.resolve(Buffer.from(text)),
        out,
      }),
    ).toBe(code)
    expect(out.chunks.join('')).toBe(`${code === 0 ? '0 secret matches' : '1 secret match'}\n`)
    expect(out.chunks.join('')).not.toContain(text)
  })
  it.each(['unreadable', 'oversize', 'utf8', 'invalidKey', 'closed', 'flush'])(
    'refuses %s with 2 and no file content',
    async (fault) => {
      const out = outputWriter()
      if (fault === 'closed') Object.defineProperty(out, 'isClosed', { value: true })
      else if (fault === 'flush') vi.mocked(out.flush).mockResolvedValue(false)
      const readFile = () => {
        if (fault === 'unreadable') return Promise.reject(new Error('private path'))
        let bytes = Buffer.from('private contents')
        if (fault === 'oversize') bytes = Buffer.alloc(16_777_217)
        else if (fault === 'utf8') bytes = Buffer.from([255])
        return Promise.resolve(bytes)
      }
      expect(
        await runSecretScan({
          file: 'private.patch',
          keyFromStdin: fault === 'invalidKey',
          stdin: Readable.from(['bad']),
          signal: new AbortController().signal,
          readFile,
          out,
        }),
      ).toBe(2)
      expect(out.chunks.join('')).not.toContain('private')
    },
  )
  it('aborts a hung key reader and never reads the file or prints', async () => {
    const controller = new AbortController()
    const out = outputWriter()
    const readFile = vi.fn(() => Promise.resolve(Buffer.from('text')))
    const pending = runSecretScan({
      file: 'x',
      keyFromStdin: true,
      stdin: new PassThrough(),
      signal: controller.signal,
      readFile,
      out,
    })
    controller.abort()
    expect(await pending).toBe(2)
    expect(readFile).not.toHaveBeenCalled()
    expect(out.chunks).toEqual([])
  })
  it('refuses cancellation before reading and after the file read', async () => {
    const controller = new AbortController()
    const input = {
      file: 'x',
      keyFromStdin: false,
      stdin: new PassThrough(),
      signal: controller.signal,
      readFile: () => {
        controller.abort()
        return Promise.resolve(Buffer.from('secret'))
      },
      out: outputWriter(),
    }
    expect(await runSecretScan(input)).toBe(2)
    expect(await runSecretScan(input)).toBe(2)
    expect(input.out.chunks).toEqual([])
  })
})
