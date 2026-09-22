import { describe, expect, it } from 'vitest'
import {
  classifyTool,
  executeTool,
  parseQuestions,
  resolveWorkspacePath,
  shellToolFor,
  type ToolContext,
  toolDefinitions,
} from '../../src/core/backends/modelapi/tools'
import { parsePatchFiles } from '../../src/shared/patchDocument'
import { revertHunks } from '../../src/core/patchApply'
import { memoryToolIo } from './helpers/fakeToolIo'

const ROOT = '/ws'

function context(files: Record<string, string> = {}, platform: NodeJS.Platform = 'linux') {
  const io = memoryToolIo(files, ROOT, (command) => ({
    stdout: `ran ${command}\n`,
    stderr: command.includes('warn') ? 'careful\n' : '',
    exitCode: command.includes('fail') ? 1 : 0,
    isTimedOut: command.includes('hang'),
  }))
  const ctx: ToolContext = { workspaceRoot: ROOT, platform, io }
  return {
    io,
    ctx,
    run: (name: string, args: unknown) => executeTool(name, JSON.stringify(args), ctx),
  }
}

describe('resolveWorkspacePath', () => {
  it('keeps paths inside the workspace and refuses escapes, on both path styles', () => {
    expect(resolveWorkspacePath('/ws', 'src/a.ts', 'linux')).toEqual({
      ok: true,
      absolute: '/ws/src/a.ts',
      relative: 'src/a.ts',
    })
    expect(resolveWorkspacePath('/ws', '/ws/b.ts', 'linux')).toMatchObject({ relative: 'b.ts' })
    expect(resolveWorkspacePath('/ws', '../etc/passwd', 'linux')).toMatchObject({ ok: false })
    expect(resolveWorkspacePath('/ws', '/etc/passwd', 'linux')).toMatchObject({ ok: false })
    expect(resolveWorkspacePath('/ws', '.', 'linux')).toMatchObject({ ok: false })
    expect(resolveWorkspacePath(String.raw`C:\ws`, String.raw`src\a.ts`, 'win32')).toEqual({
      ok: true,
      absolute: String.raw`C:\ws\src\a.ts`,
      relative: 'src/a.ts',
    })
    expect(resolveWorkspacePath(String.raw`C:\ws`, String.raw`D:\other`, 'win32')).toMatchObject({
      ok: false,
    })
    expect(resolveWorkspacePath(String.raw`C:\ws`, String.raw`..\x`, 'win32')).toMatchObject({
      ok: false,
    })
  })
})

describe('toolDefinitions / classifyTool', () => {
  it('offers the platform shell and classifies every tool', () => {
    const linux = toolDefinitions('linux').map((tool) => tool.name)
    expect(linux).toEqual([
      'read_file',
      'edit_file',
      'write_file',
      'search',
      'list_files',
      'bash',
      'ask_user',
      'todo_write',
    ])
    expect(toolDefinitions('win32').map((tool) => tool.name)).toContain('powershell')
    expect(shellToolFor('win32')).toEqual({ name: 'powershell', shellName: 'PowerShell' })
    for (const name of linux) {
      expect(classifyTool(name), name).toBeDefined()
    }
    expect(classifyTool('read_file')).toBe('read')
    expect(classifyTool('write_file')).toBe('edit')
    expect(classifyTool('bash')).toBe('shell')
    expect(classifyTool('ask_user')).toBe('interactive')
    expect(classifyTool('nope')).toBeUndefined()
    for (const tool of toolDefinitions('linux')) {
      expect(tool.parameters).toMatchObject({ type: 'object', additionalProperties: false })
      expect(tool.strict).toBe(false)
    }
  })
})

describe('executeTool: read_file', () => {
  it('numbers lines, windows with offset and limit, and clips long lines', async () => {
    const long = 'x'.repeat(2500)
    const { run } = context({ 'a.txt': `one\ntwo\nthree\n${long}\n` })
    const all = await run('read_file', { path: 'a.txt' })
    expect(all.output).toBe(
      `Read text file \`a.txt\`.\n1|one\n2|two\n3|three\n4|${'x'.repeat(2000)}…`,
    )
    const window = await run('read_file', { path: 'a.txt', offset: 2, limit: 1 })
    expect(window.output).toBe('Read text file `a.txt`.\n2|two\n[2 more lines]')
    expect(window.failureReason).toBeUndefined()
  })

  it('refuses paths outside the workspace and reports a missing file', async () => {
    const { run } = context({})
    expect(await run('read_file', { path: '../secret' })).toMatchObject({
      failureReason: 'path ../secret is outside the workspace',
      output: 'Error: path ../secret is outside the workspace',
    })
    expect(await run('read_file', { path: 'missing.txt' })).toMatchObject({
      failureReason: 'file not found: missing.txt',
    })
    expect(await run('read_file', { nope: 1 })).toMatchObject({
      failureReason: expect.stringContaining('invalid arguments'),
    })
    expect(await executeTool('read_file', '{not json', context().ctx)).toMatchObject({
      failureReason: 'arguments are not valid JSON',
    })
  })
})

describe('executeTool: write_file and edit_file', () => {
  it('creates a file with an all-added patch and overwrites with a minimal hunk', async () => {
    const { io, run } = context({})
    const created = await run('write_file', { path: 'new.txt', content: 'a\nb\n' })
    expect(io.files.get('/ws/new.txt')).toBe('a\nb\n')
    expect(created.visibleOutput).toContain('created new.txt')
    expect(created.patch?.summary).toEqual({ files: 1, added: 2, removed: 0 })
    const files = parsePatchFiles(created.patch?.document ?? '')
    expect(files?.[0]).toMatchObject({ path: 'new.txt', hunks: [{ oldStart: 0, newStart: 1 }] })
    const reverted = revertHunks('a\nb\n', files?.[0]?.hunks ?? [])
    expect(reverted).toEqual({ ok: true, content: '', isCreatedFile: true })

    const rewritten = await run('write_file', { path: 'new.txt', content: 'a\nB\nc\n' })
    expect(rewritten.patch?.summary).toEqual({ files: 1, added: 2, removed: 1 })
    const hunks = parsePatchFiles(rewritten.patch?.document ?? '')?.[0]?.hunks ?? []
    expect(hunks).toEqual([
      { oldStart: 2, oldLines: 1, newStart: 2, newLines: 2, lines: ['-b', '+B', '+c'] },
    ])
    expect(revertHunks('a\nB\nc\n', hunks)).toEqual({
      ok: true,
      content: 'a\nb\n',
      isCreatedFile: false,
    })
  })

  it('edits exactly one occurrence and refuses zero or several', async () => {
    const { io, run } = context({ 'notes.md': '# Notes\n\nfirst line\nfirst line?\n' })
    const dup = await run('edit_file', { path: 'notes.md', find: 'first line', replace: 'x' })
    expect(dup.failureReason).toContain('more than once')
    const none = await run('edit_file', { path: 'notes.md', find: 'zzz', replace: 'x' })
    expect(none.failureReason).toContain('not found')
    const empty = await run('edit_file', { path: 'notes.md', find: '', replace: 'x' })
    expect(empty.failureReason).toBe('find must not be empty')
    const ok = await run('edit_file', {
      path: 'notes.md',
      find: 'first line?',
      replace: 'second\nthird',
    })
    expect(io.files.get('/ws/notes.md')).toBe('# Notes\n\nfirst line\nsecond\nthird\n')
    expect(ok.visibleOutput).toBe(
      'edited\n--- original\n+++ updated\n@@\n-first line?\n+second\n+third\n',
    )
    expect(ok.patch?.summary).toEqual({ files: 1, added: 2, removed: 1 })
    const missing = await run('edit_file', { path: 'nope.md', find: 'a', replace: 'b' })
    expect(missing.failureReason).toBe('file not found: nope.md')
    const same = await run('write_file', {
      path: 'notes.md',
      content: io.files.get('/ws/notes.md'),
    })
    expect(same.patch?.summary).toEqual({ files: 1, added: 0, removed: 0 })
  })
})

describe('executeTool: search and list_files', () => {
  const files = {
    'src/a.ts': 'const x = 1\nconst y = 2\n',
    'src/b.tsx': 'x\n',
    'README.md': 'hello x\n',
    'bin/blob': 'x\0binary',
  }

  it('reports matching lines, files or counts, honouring the glob and the cap', async () => {
    const { run } = context(files)
    const lines = await run('search', { pattern: 'x' })
    expect(lines.output).toBe('src/a.ts:1: const x = 1\nsrc/b.tsx:1: x\nREADME.md:1: hello x')
    const paths = await run('search', {
      pattern: 'x',
      glob: '*.ts',
      output_mode: 'files_with_matches',
    })
    expect(paths.output).toBe('src/a.ts')
    const counts = await run('search', { pattern: 'const', output_mode: 'count' })
    expect(counts.output).toBe('src/a.ts: 2')
    const capped = await run('search', { pattern: 'x', max_results: 2 })
    expect(capped.output).toBe('src/a.ts:1: const x = 1\nsrc/b.tsx:1: x')
    const none = await run('search', { pattern: 'nothing-here' })
    expect(none.output).toBe('No matches.')
    expect(await run('search', { pattern: '(' })).toMatchObject({
      failureReason: expect.stringContaining('invalid pattern'),
    })
    expect(await run('search', { pattern: 'x'.repeat(513) })).toMatchObject({
      failureReason: 'pattern longer than 512 characters',
    })
    expect(await run('search', { pattern: 'x', glob: 'a'.repeat(257) })).toMatchObject({
      failureReason: 'glob longer than 256 characters',
    })
    expect(await run('list_files', { glob: 'a'.repeat(257) })).toMatchObject({
      failureReason: 'glob longer than 256 characters',
    })
  })

  it('lists files with an optional glob and limit', async () => {
    const { run } = context(files)
    const all = await run('list_files', {})
    expect(all.output).toBe('src/a.ts\nsrc/b.tsx\nREADME.md\nbin/blob')
    const globbed = await run('list_files', { glob: 'src/*' })
    expect(globbed.output).toBe('src/a.ts\nsrc/b.tsx')
    const limited = await run('list_files', { limit: 1 })
    expect(limited.output).toBe('src/a.ts\n[3 more files]')
    const none = await run('list_files', { glob: '*.rs' })
    expect(none.output).toBe('No files.')
  })
})

describe('executeTool: shell', () => {
  it('runs the platform shell in the workspace with a bounded timeout and reports exits', async () => {
    const { io, run } = context({}, 'win32')
    const ok = await run('powershell', { command: 'Get-Location', description: 'where am I' })
    expect(io.shellCalls[0]).toEqual({ command: 'Get-Location', cwd: ROOT, timeoutMs: 120_000 })
    expect(ok.output).toBe('ran Get-Location\n[exit code 0]')
    expect(ok.failureReason).toBeUndefined()
    const failed = await run('powershell', {
      command: 'fail',
      description: 'd',
      timeout_ms: 10_000_000,
    })
    expect(io.shellCalls[1]?.timeoutMs).toBe(600_000)
    expect(failed.output).toBe('ran fail\n[exit code 1]')
    const hung = await run('powershell', { command: 'hang warn', description: 'd', timeout_ms: 5 })
    expect(hung.output).toBe('ran hang warn\ncareful\n[stopped after 5 ms]')
    expect(hung.failureReason).toBe('stopped after 5 ms')
    // The other platform's shell is not offered here.
    expect(await run('bash', { command: 'ls', description: 'd' })).toMatchObject({
      failureReason: 'unknown tool bash',
    })
    expect(await run('zip_it', {})).toMatchObject({ failureReason: 'unknown tool zip_it' })
  })
})

describe('parseQuestions', () => {
  it('validates the ask_user questions or explains why not', () => {
    const questions = parseQuestions(
      JSON.stringify({
        questions: [
          {
            id: 'q',
            header: 'Colour',
            question: 'Which?',
            selection: { mode: 'single' },
            options: [{ label: 'Red' }],
          },
        ],
      }),
    )
    expect(questions).toEqual([
      {
        id: 'q',
        header: 'Colour',
        question: 'Which?',
        selection: { mode: 'single' },
        options: [{ label: 'Red' }],
      },
    ])
    expect(parseQuestions('{"questions":[{"id":1}]}')).toContain('invalid arguments')
    expect(parseQuestions('nope')).toBe('arguments are not valid JSON')
  })
})
