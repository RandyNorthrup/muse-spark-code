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

describe("Muse Code's own tools (M43)", () => {
  // The CLI's canonical tool list (Muse Code 1.3.0 binary, PLAN.md D36) and
  // the extra names seen in its sessions: every one has a row label.
  const MUSE_CODE_TOOLS = [
    'read_file',
    'edit_file',
    'write_file',
    'apply_patch',
    'search',
    'bash',
    'bash_input',
    'powershell',
    'powershell_input',
    'shell',
    'work_stop',
    'work_status',
    'monitor',
    'artifact',
    'image_generation',
    'read_memory',
    'add_memory',
    'edit_memory',
    'create_goal',
    'update_goal',
    'get_goal',
    'report_progress',
    'cron_create',
    'cron_delete',
    'cron_list',
    'workflow',
    'code_exec',
    'code_wait',
    'web_search',
    'web_fetch',
    'tool_search',
    'read_skill',
    'send_session_message',
    'list_peer_sessions',
    'request_user_input',
    'subagent_spawn',
    'subagent_status',
    'subagent_send_message',
    'subagent_wait',
    'subagent_read_result',
    'subagent_cancel',
    'update_plan',
    'TodoWrite',
    'write_todos',
    'snooze_reminder',
    'submit_reminder_decision',
    'submit_result',
  ]

  it('labels every tool Muse Code can run', () => {
    expect(MUSE_CODE_TOOLS.filter((name) => toolLabel(name) === undefined)).toEqual([])
  })

  it('picks each family’s body and summary from the captured arguments', () => {
    expect(
      describeTool('add_memory', '{"content":"x","path":"palette.md","scope":"personal_project"}'),
    ).toMatchObject({ label: 'Save memory', summary: 'palette.md', body: 'memory' })
    expect(describeTool('create_goal', '{"objective":"Ship it"}')).toMatchObject({
      summary: 'Ship it',
      body: 'goal',
    })
    expect(describeTool('get_goal', '{}')).toMatchObject({ summary: '', body: 'goal' })
    expect(describeTool('report_progress', '{"current_work":"Testing"}')).toMatchObject({
      summary: 'Testing',
    })
    expect(describeTool('cron_delete', '{"id":"2ef46218"}')).toMatchObject({
      summary: '2ef46218',
      body: 'schedule',
    })
    expect(describeTool('web_search', '{"query":"vite"}')).toMatchObject({
      summary: 'vite',
      body: 'web',
    })
    // The captured call carries a script (M47); the run is its own card below the row.
    expect(
      describeTool('workflow', '{"script":"export default async function workflow(host) {}"}'),
    ).toMatchObject({
      label: 'Workflow',
      summary: '',
      body: 'workflow',
    })
    expect(describeTool('apply_patch', '{"path":"a.ts","patch":"@@"}')).toMatchObject({
      label: 'Patch',
      body: 'edit',
    })
  })

  it('names the picture a read or a generated image shows, and no other', () => {
    expect(describeTool('read_file', '{"path":"media/Dot.PNG"}').imagePath).toBe('media/Dot.PNG')
    expect(describeTool('generate_image', '{"path":"a.webp"}').imagePath).toBe('a.webp')
    expect(describeTool('read_file', '{"path":"notes.md"}').imagePath).toBeUndefined()
    expect(describeTool('write_file', '{"path":"a.png"}').imagePath).toBeUndefined()
    expect(describeTool('read_file', '{"path":"archive.png.md"}').imagePath).toBeUndefined()
  })

  it('names an MCP tool the table does not know by tool and server', () => {
    expect(describeTool('mcp__github__create_issue', '{}').label).toBe('create_issue (github)')
    expect(describeTool('mcp__my__server__do', '{}').label).toBe('server__do (my)')
    expect(describeTool('mcp__ide__getDiagnostics', '{}').label).toBe('Diagnostics')
  })
})

describe('image edits and the ide server’s images (M44)', () => {
  it('labels them, and names the picture each one makes', () => {
    expect(describeTool('edit_image', '{"path":"art/fox-hat.png"}')).toMatchObject({
      label: 'Edit image',
      imagePath: 'art/fox-hat.png',
    })
    expect(describeTool('mcp__ide__generateImage', '{"path":"media/l.png"}')).toMatchObject({
      label: 'Image',
      imagePath: 'media/l.png',
    })
    expect(describeTool('mcp__ide__editImage', '{"path":"b.png"}')).toMatchObject({
      label: 'Edit image',
      imagePath: 'b.png',
    })
  })
})
