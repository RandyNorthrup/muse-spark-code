import { describe, expect, it } from 'vitest'
import { diffTally } from '../../src/shared/diffTally'
import type { TranscriptEntry } from '../../src/webview/state/transcriptEntries'

type ToolEntry = Extract<TranscriptEntry, { kind: 'tool' }>

function tool(overrides: Partial<ToolEntry> = {}): ToolEntry {
  return {
    kind: 'tool',
    id: 'edit-1',
    tool: 'edit_file',
    args: '{"path":"notes.md"}',
    status: 'completed',
    output: '',
    isBackground: false,
    patchSummary: { files: 1, added: 3, removed: 2 },
    ...overrides,
  }
}

describe('diffTally', () => {
  it('returns undefined when there are no edits', () => {
    expect(diffTally([])).toBeUndefined()
    const messages: TranscriptEntry[] = [
      { kind: 'user', id: 'user-1', seq: 1, text: 'Hello', status: 'sent', attachments: [] },
      { kind: 'assistant', id: 'reply-1', text: 'Hello', isStreaming: false },
    ]
    expect(diffTally(messages)).toBeUndefined()
  })

  it.each(['edit_file', 'write_file', 'apply_patch', 'rename_symbol'])(
    'counts one %s edit',
    (name) => {
      expect(diffTally([tool({ tool: name })])).toEqual({ files: 1, added: 3, removed: 2 })
    },
  )

  it('counts two edits to the same path as one file and sums their lines', () => {
    expect(
      diffTally([
        tool(),
        tool({
          id: 'edit-2',
          tool: 'write_file',
          patchSummary: { files: 1, added: 5, removed: 1 },
        }),
      ]),
    ).toEqual({ files: 1, added: 8, removed: 3 })
  })

  it('counts two distinct paths and sums their lines', () => {
    expect(
      diffTally([
        tool(),
        tool({
          id: 'edit-2',
          args: '{"path":"src/app.ts"}',
          patchSummary: { files: 1, added: 5, removed: 1 },
        }),
      ]),
    ).toEqual({ files: 2, added: 8, removed: 3 })
  })

  it('uses the file count of a multi-file patch without a single path', () => {
    expect(
      diffTally([
        tool({
          tool: 'apply_patch',
          args: '{}',
          patchSummary: { files: 3, added: 5, removed: 2 },
        }),
      ]),
    ).toEqual({ files: 3, added: 5, removed: 2 })
  })

  it('adds each pathless patch count alongside distinct known paths', () => {
    expect(
      diffTally([
        tool(),
        tool({ id: 'edit-2' }),
        tool({
          id: 'patch-1',
          tool: 'apply_patch',
          args: '{}',
          patchSummary: { files: 3, added: 5, removed: 2 },
        }),
        tool({
          id: 'patch-2',
          tool: 'rename_symbol',
          args: '{}',
          patchSummary: { files: 2, added: 4, removed: 4 },
        }),
      ]),
    ).toEqual({ files: 6, added: 15, removed: 10 })
  })

  it('ignores non-edit tool rows even when they have a patch summary and path', () => {
    const nonEdits = ['read_file', 'bash', 'unknown_tool'].map((name) => tool({ tool: name }))
    expect(diffTally(nonEdits)).toBeUndefined()
    expect(diffTally([...nonEdits, tool()])).toEqual({ files: 1, added: 3, removed: 2 })
  })

  it('ignores an edit row without a patch summary', () => {
    const missingSummary = tool({ patchSummary: undefined })
    expect(diffTally([missingSummary])).toBeUndefined()
    expect(diffTally([missingSummary, tool({ id: 'edit-2' })])).toEqual({
      files: 1,
      added: 3,
      removed: 2,
    })
  })

  it('keeps an edit with zero added and removed lines', () => {
    expect(diffTally([tool({ patchSummary: { files: 1, added: 0, removed: 0 } })])).toEqual({
      files: 1,
      added: 0,
      removed: 0,
    })
  })

  it('shares portable history counts and normalizes Windows separators', () => {
    expect(
      diffTally([
        {
          kind: 'toolCall',
          tool: 'edit_file',
          args: String.raw`{"path":"src\\app.ts"}`,
          patchSummary: { files: 1, added: 2, removed: 1 },
        },
        tool({ args: '{"path":"src/app.ts"}' }),
        {
          kind: 'assistantMessage',
          tool: 'edit_file',
          patchSummary: { files: 9, added: 99, removed: 99 },
        },
      ]),
    ).toEqual({ files: 1, added: 5, removed: 3 })
  })

  it.each(['bad-json', 'null', '[]', '{"path":1}'])('retains pathless counts for %s', (args) => {
    expect(diffTally([tool({ args })])).toEqual({ files: 1, added: 3, removed: 2 })
  })
})
