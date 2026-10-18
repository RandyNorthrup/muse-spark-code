// D119 catch burn-down: only malformed text (a real SyntaxError from the
// real JSON parser) reads as unparseable; only malformed bytes (a real
// TypeError from the real decoder) read as non-text.
import { describe, expect, it } from 'vitest'
import { mergeJsonTable } from '../../src/core/team/merge/jsonTable'
import { mergeFile, type MergeRoutineDeps } from '../../src/core/team/mergeRoutine'

const textDeps: MergeRoutineDeps = {
  jsonTable: () => Promise.resolve({ status: 'clean', file: null }),
  changelog: () => Promise.resolve({ status: 'clean', file: null }),
  text: () => Promise.resolve({ bytes: Buffer.from('merged'), conflicts: false }),
}

function version(bytes: Buffer): { mode: '100644'; bytes: Buffer } {
  return { mode: '100644', bytes }
}

describe('merge parse failures', () => {
  it('reads a bad string escape as a parse conflict', () => {
    expect(mergeJsonTable(String.raw`{"k": "a\zb"}`, '{"k": "a"}', '{"k": "a"}')).toMatchObject({
      kind: 'conflict',
      reason: 'parse',
    })
  })

  it('still merges a valid table', () => {
    const result = mergeJsonTable('{"k": 1}', '{"k": 1}', '{"k": 2}')
    expect(result.kind).toBe('merged')
  })

  it('reads malformed bytes as non-text without running the text merge', async () => {
    let textCalls = 0
    const result = await mergeFile(
      {
        path: 'notes.txt',
        kind: 'text',
        base: version(Buffer.from('base')),
        ours: version(Buffer.from([0xff, 0xfe])),
        theirs: version(Buffer.from('theirs')),
      },
      {
        ...textDeps,
        text: () => {
          textCalls += 1
          return Promise.resolve({ bytes: Buffer.from('merged'), conflicts: false })
        },
      },
    )
    expect(result).toEqual({ status: 'conflict', markers: null })
    expect(textCalls).toBe(0)
  })

  it('still merges text files', async () => {
    const result = await mergeFile(
      {
        path: 'notes.txt',
        kind: 'text',
        base: version(Buffer.from('base')),
        ours: version(Buffer.from('ours')),
        theirs: version(Buffer.from('theirs')),
      },
      textDeps,
    )
    expect(result).toEqual({
      status: 'clean',
      file: { mode: '100644', bytes: Buffer.from('merged') },
    })
  })
})
