import { afterEach, describe, expect, it } from 'vitest'
import { EN } from '../../src/shared/l10n/en'
import { setUiText } from '../../src/shared/l10n/text'
import {
  changeSummary,
  describeTool,
  toolLabel,
  writtenContent,
} from '../../src/webview/toolPresentation'

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

describe('toolLabel', () => {
  afterEach(() => {
    setUiText(EN, 'en')
  })

  it("names the table's tools and nothing else, not even Object.prototype's members", () => {
    expect(toolLabel('powershell')).toBe('PowerShell')
    expect(toolLabel('grep_files')).toBeUndefined()
    expect(toolLabel('toString')).toBeUndefined()
    expect(toolLabel('__proto__')).toBeUndefined()
  })

  it('reads the installed table (M40)', () => {
    setUiText({ ...EN, toolLabels: { ...EN.toolLabels, read_file: 'Lesen' } }, 'de')
    expect(toolLabel('read_file')).toBe('Lesen')
    expect(describeTool('read_file', '{"path":"a.md"}').label).toBe('Lesen')
  })
})

describe('changeSummary', () => {
  afterEach(() => {
    setUiText(EN, 'en')
  })

  it('reads Added / Removed / Modified from the patch summary', () => {
    expect(changeSummary({ files: 1, added: 1, removed: 0 })).toBe('Added 1 line')
    expect(changeSummary({ files: 1, added: 82, removed: 0 })).toBe('Added 82 lines')
    expect(changeSummary({ files: 1, added: 0, removed: 6 })).toBe('Removed 6 lines')
    expect(changeSummary({ files: 1, added: 2, removed: 1 })).toBe('Modified')
    expect(changeSummary(undefined)).toBeUndefined()
  })

  it('picks the plural form by the display language’s rules (M40)', () => {
    setUiText(
      {
        ...EN,
        addedLines: {
          one: 'Dodano {count} wiersz',
          few: 'Dodano {count} wiersze',
          many: 'Dodano {count} wierszy',
          other: 'Dodano {count} wiersza',
        },
      },
      'pl',
    )
    expect(changeSummary({ files: 1, added: 1, removed: 0 })).toBe('Dodano 1 wiersz')
    expect(changeSummary({ files: 1, added: 3, removed: 0 })).toBe('Dodano 3 wiersze')
    expect(changeSummary({ files: 1, added: 5, removed: 0 })).toBe('Dodano 5 wierszy')
  })
})

describe('writtenContent', () => {
  it('returns the content argument of a write', () => {
    expect(writtenContent(String.raw`{"content":"hi\n","path":"hello.txt"}`)).toBe('hi\n')
    expect(writtenContent('{"path":"x"}')).toBeUndefined()
  })
})

describe('subagent tool labels (M18)', () => {
  it("labels Muse Code's native subagent tools", () => {
    expect(describeTool('subagent_spawn', '{"objective":"Map the tree"}')).toMatchObject({
      label: 'Spawn agent',
      body: 'generic',
    })
    expect(describeTool('subagent_wait', '{}').label).toBe('Wait for agents')
    expect(describeTool('subagent_read_result', '{}').label).toBe('Agent result')
  })
})
