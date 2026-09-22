import { describe, expect, it } from 'vitest'
import { changeSummary, describeTool, writtenContent } from '../../src/webview/toolPresentation'

describe('describeTool', () => {
  it('labels the captured Muse Code tools and picks the summary per kind', () => {
    expect(describeTool('edit_file', '{"find":"a","path":"notes.md","replace":"b"}')).toEqual({
      label: 'Edit',
      summary: 'notes.md',
      body: 'edit',
      command: undefined,
    })
    expect(
      describeTool('write_file', String.raw`{"content":"hi\n","path":"hello.txt"}`),
    ).toMatchObject({
      label: 'Write',
      summary: 'hello.txt',
      body: 'edit',
    })
    expect(describeTool('read_file', '{"path":"notes.md"}')).toMatchObject({
      label: 'Read',
      summary: 'notes.md',
      body: 'read',
    })
    expect(
      describeTool('powershell', '{"command":"Get-ChildItem","description":"List files"}'),
    ).toEqual({
      label: 'PowerShell',
      summary: 'List files',
      body: 'shell',
      command: 'Get-ChildItem',
    })
    expect(describeTool('bash', '{"command":"ls"}')).toEqual({
      label: 'Bash',
      summary: 'ls',
      body: 'shell',
      command: 'ls',
    })
    expect(describeTool('request_user_input', '{"questions":[]}')).toMatchObject({
      label: 'Question',
      body: 'question',
    })
  })

  it('shows unknown tools by name with whatever path or description they carry', () => {
    expect(describeTool('grep_files', '{"path":"src","pattern":"x"}')).toEqual({
      label: 'grep_files',
      summary: 'src',
      body: 'generic',
      command: undefined,
    })
    expect(describeTool('mystery', 'not json')).toMatchObject({ label: 'mystery', summary: '' })
    expect(describeTool('mystery', '42')).toMatchObject({ summary: '' })
  })

  it('labels the search tool by its pattern and the IDE diagnostics tool by name (live 2026-09-22)', () => {
    expect(
      describeTool(
        'search',
        '{"glob":["**/notes.md"],"output_mode":"files_with_matches","pattern":"^"}',
      ),
    ).toEqual({ label: 'Search', summary: '^', body: 'generic', command: undefined })
    expect(describeTool('mcp__ide__getDiagnostics', '{}')).toMatchObject({
      label: 'Diagnostics',
      summary: '',
      body: 'generic',
    })
  })
})

describe('changeSummary', () => {
  it('reads Added / Removed / Modified from the patch summary', () => {
    expect(changeSummary({ files: 1, added: 1, removed: 0 })).toBe('Added 1 line')
    expect(changeSummary({ files: 1, added: 82, removed: 0 })).toBe('Added 82 lines')
    expect(changeSummary({ files: 1, added: 0, removed: 6 })).toBe('Removed 6 lines')
    expect(changeSummary({ files: 1, added: 2, removed: 1 })).toBe('Modified')
    expect(changeSummary(undefined)).toBeUndefined()
  })
})

describe('writtenContent', () => {
  it('returns the content argument of a write', () => {
    expect(writtenContent(String.raw`{"content":"hi\n","path":"hello.txt"}`)).toBe('hi\n')
    expect(writtenContent('{"path":"x"}')).toBeUndefined()
  })
})
