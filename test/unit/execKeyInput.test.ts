import { PassThrough, Readable } from 'node:stream'
import { describe, expect, it } from 'vitest'
import { memorySecretStore, readKeyLine, readPromptStdin } from '../../src/runtime/exec/keyInput'
import { SECRET_KEYS } from '../../src/shared/constants'

const KEY = `LLM_${'k'.repeat(20)}`
const signal = () => new AbortController().signal
describe('M80 key/stdin (A11)', () => {
  it.each([
    ['', 'empty'],
    ['bad', 'invalid'],
    ['x'.repeat(5120), 'tooLong'],
  ])('refuses %s with %s', async (text, reason) => {
    expect(await readKeyLine(Readable.from([text]), signal())).toEqual({ ok: false, reason })
  })
  it('refuses TTY input without reading it', async () => {
    const input = Object.assign(new PassThrough(), { isTTY: true })
    input.write(`${KEY}\n`)
    expect(await readKeyLine(input, signal())).toEqual({ ok: false, reason: 'tty' })
    expect(input.destroyed).toBe(true)
    // RVM80A P3-7: the key typed at a terminal is never consumed.
    expect(input.readableLength).toBe(KEY.length + 1)
  })
  it('zeroes every received piece of a key that arrived in several chunks (RVM80A P2-1)', async () => {
    const first = Buffer.from(KEY.slice(0, 7))
    const second = Buffer.from(`${KEY.slice(7)}\nrest`)
    const input = new Readable({ read: () => undefined })
    const pending = readKeyLine(input, signal())
    input.push(first)
    input.push(second)
    expect(await pending).toEqual({ ok: true, key: KEY })
    expect(first.every((byte) => byte === 0)).toBe(true)
    expect(second.subarray(0, KEY.length - 7).every((byte) => byte === 0)).toBe(true)
  })
  it('accepts one CRLF ending only; other white space is part of the value (RVM80A P3-2)', async () => {
    expect(await readKeyLine(Readable.from([`${KEY}\r\n`]), signal())).toEqual({
      ok: true,
      key: KEY,
    })
    for (const text of [` ${KEY}\n`, `${KEY} \n`, `${KEY}\t\n`, `${KEY}\r\r\n`, `\r${KEY}\n`]) {
      expect(await readKeyLine(Readable.from([text]), signal()), JSON.stringify(text)).toEqual({
        ok: false,
        reason: 'invalid',
      })
    }
  })
  it('returns at LF while the pipe is still open; ignores the rest and destroys it', async () => {
    const input = new PassThrough()
    const result = readKeyLine(input, signal())
    input.write(`${KEY}\r\n${'x'.repeat(5000)}`)
    expect(await result).toEqual({ ok: true, key: KEY })
    expect(input.destroyed).toBe(true)
    expect(input.listenerCount('data')).toBe(0)
  })
  it('accepts bounded EOF without LF and split chunks', async () => {
    expect(await readKeyLine(Readable.from([KEY.slice(0, 2), KEY.slice(2)]), signal())).toEqual({
      ok: true,
      key: KEY,
    })
    expect(await readKeyLine(Readable.from([`LLM|123|abc%tail+/=`]), signal())).toMatchObject({
      ok: true,
    })
  })
  it('aborts a hung pipe promptly and cleans listeners', async () => {
    const controller = new AbortController()
    const input = new PassThrough()
    const pending = readKeyLine(input, controller.signal)
    controller.abort(new Error('stop'))
    await expect(pending).rejects.toThrow('stop')
    expect(input.destroyed).toBe(true)
    expect(input.listenerCount('data')).toBe(0)
    await expect(readKeyLine(new PassThrough(), controller.signal)).rejects.toThrow('stop')
  })
  it('rejects unreadable, malformed UTF-8 and nonbyte streams', async () => {
    expect(await readKeyLine(Readable.from([Buffer.from([0xff])]), signal())).toMatchObject({
      ok: false,
      reason: 'invalid',
    })
    await expect(readKeyLine(Readable.from([{}]), signal())).rejects.toThrow()
    const input = new PassThrough()
    const pending = readKeyLine(input, signal())
    input.destroy(new Error('broken'))
    await expect(pending).rejects.toThrow('broken')
  })
  it('reads complete bounded UTF-8 prompts and rejects empty, oversize or malformed input', async () => {
    const bytes = Buffer.from('é\nhi')
    expect(
      await readPromptStdin(Readable.from([bytes.subarray(0, 1), bytes.subarray(1)]), 20, signal()),
    ).toBe('é\nhi')
    for (const data of ['', 'longer than two', Buffer.from([0xff])])
      await expect(readPromptStdin(Readable.from([data]), 2, signal())).rejects.toThrow()
  })
  it('memory store only exposes its key, refuses writes and clears it', async () => {
    const store = memorySecretStore(KEY)
    expect(await store.get(SECRET_KEYS.modelApiKey)).toBe(KEY)
    expect(await store.get('other')).toBeUndefined()
    await expect(store.store(SECRET_KEYS.modelApiKey, 'other')).rejects.toThrow()
    await store.delete('other')
    expect(await store.get(SECRET_KEYS.modelApiKey)).toBe(KEY)
    store.clear()
    expect(await store.get(SECRET_KEYS.modelApiKey)).toBeUndefined()
    const second = memorySecretStore(KEY)
    await second.delete(SECRET_KEYS.modelApiKey)
    expect(await second.get(SECRET_KEYS.modelApiKey)).toBeUndefined()
  })
})
