import { describe, expect, it } from 'vitest'
import { decodeContextText, readContextText } from '../../src/core/context/contextFiles'
import { encoded, memoryContextIo } from './helpers/fakeContextIo'

const TEXT = 'Regeln für 日本 🚀\r\nline two\n'

describe('decodeContextText (D27)', () => {
  it('reads UTF-8, with or without its mark, and UTF-16 in either byte order by its mark', () => {
    expect(decodeContextText(Buffer.from(TEXT))).toEqual({ ok: true, text: TEXT })
    expect(decodeContextText(encoded.utf8Bom(TEXT))).toEqual({ ok: true, text: TEXT })
    expect(decodeContextText(encoded.utf16le(TEXT))).toEqual({ ok: true, text: TEXT })
    expect(decodeContextText(encoded.utf16be(TEXT))).toEqual({ ok: true, text: TEXT })
    expect(decodeContextText(new Uint8Array())).toEqual({ ok: true, text: '' })
  })

  it('refuses bytes that are not valid in their encoding', () => {
    expect(decodeContextText(encoded.latin1('café'))).toEqual({
      ok: false,
      reason: 'is not valid UTF-8 text',
    })
    const odd = encoded.utf16be('ab').subarray(0, 5)
    expect(decodeContextText(odd)).toEqual({ ok: false, reason: 'is not valid UTF-16BE text' })
    const loneSurrogate = Buffer.from([0xff, 0xfe, 0x00, 0xd8, 0x41, 0x00])
    expect(decodeContextText(loneSurrogate)).toEqual({
      ok: false,
      reason: 'is not valid UTF-16LE text',
    })
  })

  it('refuses text that still holds NUL characters rather than giving the model garbage', () => {
    const refusal = {
      ok: false,
      reason: 'contains NUL characters (a binary file, or UTF-16 text without a byte-order mark)',
    }
    expect(decodeContextText(encoded.utf16leWithoutBom('rules'))).toEqual(refusal)
    expect(decodeContextText(Buffer.from('a\0b'))).toEqual(refusal)
  })
})

describe('readContextText', () => {
  const files = new Map<string, string | Uint8Array>([
    ['/ws/AGENTS.md', encoded.utf16le('inside')],
    ['/ws/shared/AGENTS.md', 'shared'],
    ['/outside/AGENTS.md', 'secret'],
  ])
  const io = memoryContextIo(files, {
    '/ws/linked': '/ws/shared',
    '/ws/escape': '/outside',
  })
  const deps = { io, platform: 'linux' as const }

  it('decodes a workspace file and reports a missing one as undefined', async () => {
    await expect(readContextText(deps, '/ws/AGENTS.md', '/ws')).resolves.toEqual({
      ok: true,
      text: 'inside',
    })
    await expect(readContextText(deps, '/ws/none.md', '/ws')).resolves.toBeUndefined()
  })

  it('follows a link that stays in the workspace and refuses one that leaves it', async () => {
    await expect(readContextText(deps, '/ws/linked/AGENTS.md', '/ws')).resolves.toEqual({
      ok: true,
      text: 'shared',
    })
    await expect(readContextText(deps, '/ws/escape/AGENTS.md', '/ws')).resolves.toEqual({
      ok: false,
      reason: 'is refused: path /ws/escape/AGENTS.md leads outside the workspace through a link',
    })
  })

  it('follows any link when nothing confines the file (the personal skill root)', async () => {
    await expect(readContextText(deps, '/ws/escape/AGENTS.md', undefined)).resolves.toEqual({
      ok: true,
      text: 'secret',
    })
  })
})
