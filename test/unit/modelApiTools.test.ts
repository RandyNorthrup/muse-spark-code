import { afterEach, describe, expect, it } from 'vitest'
import {
  classifyTool,
  executeTool,
  parseQuestions,
  shellToolFor,
  type ToolContext,
  toolDefinitions,
} from '../../src/core/backends/modelapi/tools'
import { confineWorkspacePath, resolveWorkspacePath } from '../../src/core/workspacePath'
import { parsePatchFiles } from '../../src/shared/patchDocument'
import { EN } from '../../src/shared/l10n/en'
import { BASE_LOCALE, setUiText } from '../../src/shared/l10n/text'
import { revertHunks } from '../../src/core/patchApply'
import {
  FILE_REFUSAL_MODEL_TEXT,
  MODEL_API_MODEL_TEXT,
  MODEL_TEXT,
  SEARCH_MAX_CANDIDATES,
  SEARCH_MAX_FILE_BYTES,
  SEARCH_MAX_HITS,
  TOOL_OUTPUT_ELIDED_MARKER,
  TOOL_OUTPUT_MAX_CHARS,
} from '../../src/shared/constants'
import { memoryToolIo } from './helpers/fakeToolIo'

const ROOT = '/ws'

function context(files: Record<string, string> = {}, platform: NodeJS.Platform = 'linux') {
  const io = memoryToolIo(files, ROOT, (command) => ({
    stdout: `ran ${command}\n`,
    stderr: command.includes('warn') ? 'careful\n' : '',
    exitCode: command.includes('fail') ? 1 : 0,
    isTimedOut: command.includes('hang'),
    isCancelled: command.includes('stop'),
  }))
  const seen = new Map<string, string>()
  const ctx: ToolContext = { workspaceRoot: ROOT, platform, io, seen, provisionalSeen: new Map() }
  return {
    io,
    ctx,
    run: async (name: string, args: unknown) => {
      const outcome = await executeTool(name, JSON.stringify(args), ctx)
      if (outcome.failureReason === undefined)
        for (const [absolute, hash] of ctx.provisionalSeen) seen.set(absolute, hash)
      ctx.provisionalSeen.clear()
      return outcome
    },
  }
}

describe('resolveWorkspacePath', () => {
  it('keeps paths inside the workspace and refuses escapes, on both path styles', () => {
    expect(resolveWorkspacePath('/ws', 'src/a.ts', 'linux')).toEqual({
      ok: true,
      absolute: '/ws/src/a.ts',
      relative: 'src/a.ts',
      canonical: 'src/a.ts',
    })
    expect(resolveWorkspacePath('/ws', '/ws/b.ts', 'linux')).toMatchObject({ relative: 'b.ts' })
    expect(resolveWorkspacePath('/ws', '../etc/passwd', 'linux')).toMatchObject({ ok: false })
    expect(resolveWorkspacePath('/ws', '/etc/passwd', 'linux')).toMatchObject({ ok: false })
    expect(resolveWorkspacePath('/ws', '.', 'linux')).toMatchObject({ ok: false })
    expect(resolveWorkspacePath(String.raw`C:\ws`, String.raw`src\a.ts`, 'win32')).toEqual({
      ok: true,
      absolute: String.raw`C:\ws\src\a.ts`,
      relative: 'src/a.ts',
      canonical: 'src/a.ts',
    })
    expect(resolveWorkspacePath(String.raw`C:\ws`, String.raw`D:\other`, 'win32')).toMatchObject({
      ok: false,
    })
    expect(resolveWorkspacePath(String.raw`C:\ws`, String.raw`..\x`, 'win32')).toMatchObject({
      ok: false,
    })
  })
})

describe('resolveWorkspacePath: names Windows would reinterpret (D24)', () => {
  it('refuses alternate data streams, device names and trailing dots or spaces', () => {
    const root = String.raw`C:\ws`
    for (const given of [
      'a.txt:hidden',
      String.raw`C:\ws\a.txt::$DATA`,
      'NUL',
      String.raw`src\con.txt`,
      'COM1',
      '.git.',
      String.raw`.git.\hooks\pre-commit`,
      'notes.md ',
    ]) {
      expect(resolveWorkspacePath(root, given, 'win32'), given).toMatchObject({ ok: false })
    }
    // The same names are ordinary on POSIX file systems.
    expect(resolveWorkspacePath('/ws', 'a.txt:hidden', 'linux')).toMatchObject({ ok: true })
  })

  it('accepts a name that merely starts with two dots', () => {
    expect(resolveWorkspacePath('/ws', '..env', 'linux')).toMatchObject({
      ok: true,
      relative: '..env',
    })
    expect(resolveWorkspacePath(String.raw`C:\ws`, '..config', 'win32')).toMatchObject({
      ok: true,
    })
  })
})

describe('confineWorkspacePath: links (D24)', () => {
  const io = memoryToolIo({}, ROOT, undefined, { linked: '/etc', inner: '/ws/src' })

  it('refuses a path that leaves the workspace through a link', async () => {
    expect(await confineWorkspacePath(ROOT, 'linked/passwd', 'linux', io)).toEqual({
      ok: false,
      reason: 'path linked/passwd leads outside the workspace through a link',
    })
  })

  it('keeps a link that stays inside and judges it by where it leads', async () => {
    expect(await confineWorkspacePath(ROOT, 'inner/a.ts', 'linux', io)).toEqual({
      ok: true,
      absolute: '/ws/inner/a.ts',
      relative: 'inner/a.ts',
      canonical: 'src/a.ts',
      checkedAbsolute: '/ws/src/a.ts',
    })
  })

  it('refuses a path the file system cannot resolve', async () => {
    const failing = { realPath: () => Promise.reject(new Error('ELOOP: too many links')) }
    expect(await confineWorkspacePath(ROOT, 'a.ts', 'linux', failing)).toMatchObject({
      ok: false,
      reason: expect.stringContaining('ELOOP') as string,
    })
  })

  it('makes the file tools refuse a linked escape before touching anything', async () => {
    const files = memoryToolIo({ 'a.txt': 'x' }, ROOT, undefined, { linked: '/etc' })
    const ctx: ToolContext = {
      workspaceRoot: ROOT,
      platform: 'linux',
      io: files,
      seen: new Map(),
      provisionalSeen: new Map(),
    }
    const write = await executeTool(
      'write_file',
      JSON.stringify({ path: 'linked/cron.d/x', content: 'evil' }),
      ctx,
    )
    expect(write.failureReason).toContain('through a link')
    const read = await executeTool('read_file', JSON.stringify({ path: 'linked/shadow' }), ctx)
    expect(read.failureReason).toContain('through a link')
    expect(files.files.size).toBe(1)
    expect(files.files.get('/ws/a.txt')).toBe('x')
  })
})

function retargetedIo(base: ReturnType<typeof memoryToolIo>) {
  let target = '/ws/safe'
  const pointedPath = (absolutePath: string) =>
    absolutePath.startsWith('/ws/link/')
      ? `${target}${absolutePath.slice('/ws/link'.length)}`
      : absolutePath
  return {
    ...base,
    realPath: (absolutePath: string) => {
      const checked = pointedPath(absolutePath)
      if (absolutePath.startsWith('/ws/link/')) {
        target = '/ws/outside'
      }
      return Promise.resolve(checked)
    },
    readFile: (absolutePath: string) => base.readFile(pointedPath(absolutePath)),
    readBytes: (absolutePath: string, maxBytes: number) =>
      base.readBytes(pointedPath(absolutePath), maxBytes),
  }
}

describe('read_file: retargeted links (M54)', () => {
  it('reads the checked canonical text target after a link retargets', async () => {
    const base = memoryToolIo({ 'safe/note.txt': 'inside', 'outside/note.txt': 'outside' }, ROOT)
    const io = retargetedIo(base)
    const result = await executeTool('read_file', '{"path":"link/note.txt"}', {
      workspaceRoot: ROOT,
      platform: 'linux',
      io,
      seen: new Map(),
      provisionalSeen: new Map(),
    })
    expect(result.output).toContain('inside')
    expect(result.output).not.toContain('outside')
  })

  it('reads the checked canonical PDF target after a link retargets', async () => {
    const base = memoryToolIo({}, ROOT)
    const inside = Buffer.from('%PDF-1.4\ninside\n')
    const outside = Buffer.from('%PDF-1.4\noutside\n')
    base.binaries.set('/ws/safe/report.pdf', inside)
    base.binaries.set('/ws/outside/report.pdf', outside)
    const io = retargetedIo(base)
    const result = await executeTool('read_file', '{"path":"link/report.pdf"}', {
      workspaceRoot: ROOT,
      platform: 'linux',
      io,
      seen: new Map(),
      provisionalSeen: new Map(),
    })
    expect(result.visibleFile?.part.base64Data).toBe(inside.toString('base64'))
  })
})

describe('read_file: localized visual summaries (M54)', () => {
  afterEach(() => {
    setUiText(EN, BASE_LOCALE)
  })

  it('keeps PDF function output English while the row translates known and unknown pages', async () => {
    setUiText(
      {
        ...EN,
        toolReadPdf: 'PDF gelesen: `{path}` ({pages}, {bytes} Byte)',
        toolReadPdfPages: { one: '{count} Seite', other: '{count} Seiten' },
        toolReadPdfPagesUnknown: 'Seitenzahl unbekannt',
      },
      'de',
    )
    const { io, run } = context()
    const known = Buffer.alloc(12_345, 0x20)
    known.write('%PDF-1.4\n<< /Type /Pages /Count 1234 >>\n', 0, 'ascii')
    io.binaries.set('/ws/docs/report.pdf', known)

    const result = await run('read_file', { path: 'docs/report.pdf' })
    expect(result.output).toBe(
      'Read PDF `docs/report.pdf` (page count 1234, 12345 bytes). The file itself follows in the next message; you see its text and page images.',
    )
    expect(result.visibleOutput).toBe('PDF gelesen: `docs/report.pdf` (1.234 Seiten, 12.345 Byte)')
    expect(result.visibleFile?.part).toMatchObject({ pageCount: 1234, sizeBytes: 12_345 })

    io.binaries.set('/ws/docs/one.pdf', Buffer.from('%PDF-1.4\n<< /Type /Pages /Count 1 >>'))
    const singular = await run('read_file', { path: 'docs/one.pdf' })
    expect(singular.visibleOutput).toContain('1 Seite')

    io.binaries.set('/ws/docs/uncounted.pdf', Buffer.from('%PDF-1.4\nno page tree'))
    const unknown = await run('read_file', { path: 'docs/uncounted.pdf' })
    expect(unknown.output).toContain('page count unknown')
    expect(unknown.visibleOutput).toContain('Seitenzahl unbekannt')
  })

  it('keeps image function output English while the row groups dimensions and bytes', async () => {
    setUiText(
      {
        ...EN,
        toolReadImage: 'Bild gelesen: `{path}` ({mediaType}, {width}×{height}, {bytes} Byte)',
      },
      'de',
    )
    const { io, run } = context()
    const png = Buffer.alloc(12_345)
    Buffer.from('89504e470d0a1a0a', 'hex').copy(png)
    png.write('IHDR', 12, 'ascii')
    png.writeUInt32BE(1234, 16)
    png.writeUInt32BE(2345, 20)
    io.binaries.set('/ws/img/large.png', png)

    const result = await run('read_file', { path: 'img/large.png' })
    expect(result.output).toBe(
      'Read image `img/large.png` (image/png, 1234×2345, 12345 bytes). The image itself follows in the next message.',
    )
    expect(result.visibleOutput).toBe(
      'Bild gelesen: `img/large.png` (image/png, 1.234×2.345, 12.345 Byte)',
    )
    expect(result.visibleFile?.part).toMatchObject({ width: 1234, height: 2345 })
  })

  it('localizes invalid PDF and image rows without changing model errors', async () => {
    setUiText(
      {
        ...EN,
        toolReadPdfInvalid: 'PDF-Datei `{path}` ist ungültig',
        toolReadImageInvalid: 'Bilddatei `{path}` ist ungültig',
      },
      'de',
    )
    const { io, run } = context()
    io.binaries.set('/ws/docs/fake.pdf', Buffer.from('not a PDF'))
    io.binaries.set('/ws/img/fake.png', Buffer.from('not an image'))

    const pdf = await run('read_file', { path: 'docs/fake.pdf' })
    expect(pdf.output).toBe(
      'Error: docs/fake.pdf is named as a PDF but is not one (it has no %PDF- header)',
    )
    expect(pdf.visibleOutput).toBe('PDF-Datei `docs/fake.pdf` ist ungültig')
    expect(pdf.failureReason).toBe(pdf.visibleOutput)
    expect(pdf.visibleFile).toBeUndefined()

    const image = await run('read_file', { path: 'img/fake.png' })
    expect(image.output).toBe(
      'Error: img/fake.png is named as an image but is not a PNG, JPEG, GIF or WebP image',
    )
    expect(image.visibleOutput).toBe('Bilddatei `img/fake.png` ist ungültig')
    expect(image.failureReason).toBe(image.visibleOutput)
    expect(image.visibleFile).toBeUndefined()
  })

  it('localizes a missing PDF or image while retaining the English model result', async () => {
    setUiText({ ...EN, toolVisualFileMissing: 'Datei `{path}` fehlt' }, 'de')
    const { run } = context()
    for (const file of ['docs/missing.pdf', 'img/missing.png']) {
      const result = await run('read_file', { path: file })
      expect(result.output).toBe(`Error: file not found: ${file}`)
      expect(result.visibleOutput).toBe(`Datei \`${file}\` fehlt`)
      expect(result.failureReason).toBe(result.visibleOutput)
      expect(result.visibleFile).toBeUndefined()
    }
  })

  it('localizes visual read exceptions and preserves their English model error', async () => {
    setUiText({ ...EN, toolVisualReadFailed: 'Datei `{path}` kann nicht gelesen werden' }, 'de')
    const { io, ctx } = context()
    const failures: readonly { readonly file: string; readonly reason: string }[] = [
      { file: 'img/huge.png', reason: 'huge.png is 12345 bytes, over the 10000 allowed' },
      { file: 'docs/unreadable.pdf', reason: 'EIO: disk unavailable' },
    ]
    for (const { file, reason } of failures) {
      io.readBytes = () => Promise.reject(new Error(reason))
      const result = await executeTool('read_file', JSON.stringify({ path: file }), ctx)
      expect(result.output).toBe(`Error: ${reason}`)
      expect(result.visibleOutput).toBe(`Datei \`${file}\` kann nicht gelesen werden`)
      expect(result.failureReason).toBe(result.visibleOutput)
      expect(result.visibleFile).toBeUndefined()
    }
  })

  it('still propagates an aborted visual read to the turn cancellation boundary', async () => {
    const { io, ctx } = context()
    const abort = new AbortController()
    abort.abort()
    io.readBytes = () => Promise.reject(new Error('stopped read'))
    await expect(
      executeTool('read_file', '{"path":"img/stopped.png"}', { ...ctx, signal: abort.signal }),
    ).rejects.toMatchObject({ name: 'AbortError' })
  })

  it('passes the turn signal to native text, image, listing and search and discards late results', async () => {
    const calls = [
      { name: 'read_file', args: { path: 'a.txt' } },
      { name: 'read_file', args: { path: 'a.png' } },
      { name: 'list_files', args: {} },
      { name: 'search', args: { pattern: 'late' } },
    ]
    for (const call of calls) {
      const { io, ctx } = context({ 'a.txt': 'late bytes' })
      const abort = new AbortController()
      const stop = (signal: AbortSignal | undefined) => {
        expect(signal).toBe(abort.signal)
        abort.abort()
      }
      io.readFile = (_absolute, _expected, signal) => {
        stop(signal)
        return Promise.resolve('late bytes')
      }
      io.readBytes = (_absolute, _max, _expected, signal) => {
        stop(signal)
        return Promise.resolve(new Uint8Array())
      }
      if (call.name === 'list_files')
        io.listFiles = (signal) => {
          stop(signal)
          return Promise.resolve(['late.txt'])
        }
      io.searchFiles = (_job, signal) => {
        stop(signal)
        return Promise.resolve({ ok: true, hits: [] })
      }
      await expect(
        executeTool(call.name, JSON.stringify(call.args), { ...ctx, signal: abort.signal }),
      ).rejects.toMatchObject({ name: 'AbortError' })
      expect(ctx.seen.size).toBe(0)
    }
  })
})

function retargetedWritablePath(absolutePath: string): string {
  return absolutePath.startsWith('/ws/link/')
    ? `/etc/${absolutePath.slice('/ws/link/'.length)}`
    : absolutePath
}

function retargetedWritableIo(initial: Record<string, string>) {
  const base = memoryToolIo(initial, ROOT)
  const io = {
    ...base,
    realPath: (absolutePath: string) =>
      Promise.resolve(
        absolutePath.startsWith('/ws/link/')
          ? `/ws/safe/${absolutePath.slice('/ws/link/'.length)}`
          : absolutePath,
      ),
    readFile: (absolutePath: string) => base.readFile(retargetedWritablePath(absolutePath)),
    writeFile: (absolutePath: string, content: string) =>
      base.writeFile(retargetedWritablePath(absolutePath), content),
  }
  return { base, io }
}

describe('write_file and edit_file: retargeted links (M54)', () => {
  it('creates at the checked target instead of a retargeted outside path', async () => {
    const { base, io } = retargetedWritableIo({})
    const result = await executeTool('write_file', '{"path":"link/new.txt","content":"safe"}', {
      workspaceRoot: ROOT,
      platform: 'linux',
      io,
      seen: new Map(),
      provisionalSeen: new Map(),
    })
    expect(result.failureReason).toBeUndefined()
    expect(base.files.get('/ws/safe/new.txt')).toBe('safe')
    expect(base.files.has('/etc/new.txt')).toBe(false)
  })

  it('edits the checked text and keeps the outside file untouched', async () => {
    const { base, io } = retargetedWritableIo({ 'safe/note.txt': 'before' })
    base.files.set('/etc/note.txt', 'before')
    const result = await executeTool(
      'edit_file',
      '{"path":"link/note.txt","find":"before","replace":"after"}',
      { workspaceRoot: ROOT, platform: 'linux', io, seen: new Map(), provisionalSeen: new Map() },
    )
    expect(result.failureReason).toBeUndefined()
    expect(base.files.get('/ws/safe/note.txt')).toBe('after')
    expect(base.files.get('/etc/note.txt')).toBe('before')
  })

  it('replaces the checked text the model read through the requested path', async () => {
    const { base, io } = retargetedWritableIo({ 'safe/note.txt': 'before' })
    base.files.set('/etc/note.txt', 'before')
    const seen = new Map<string, string>()
    const ctx: ToolContext = {
      workspaceRoot: ROOT,
      platform: 'linux',
      io,
      seen,
      provisionalSeen: new Map(),
    }
    const read = await executeTool('read_file', '{"path":"link/note.txt"}', ctx)
    expect(read.output).toContain('before')
    for (const [absolute, hash] of ctx.provisionalSeen) seen.set(absolute, hash)
    ctx.provisionalSeen.clear()
    const written = await executeTool(
      'write_file',
      '{"path":"link/note.txt","content":"after"}',
      ctx,
    )
    expect(written.failureReason).toBeUndefined()
    expect(base.files.get('/ws/safe/note.txt')).toBe('after')
    expect(base.files.get('/etc/note.txt')).toBe('before')
  })

  it('refuses an unsaved canonical editor file even when the alias is not open', async () => {
    const { base, io } = retargetedWritableIo({ 'safe/note.txt': 'before' })
    base.unsaved.add('/ws/safe/note.txt')
    const result = await executeTool(
      'edit_file',
      '{"path":"link/note.txt","find":"before","replace":"after"}',
      { workspaceRoot: ROOT, platform: 'linux', io, seen: new Map(), provisionalSeen: new Map() },
    )
    expect(result.failureReason).toContain(FILE_REFUSAL_MODEL_TEXT.fileHasUnsavedChanges)
    expect(base.files.get('/ws/safe/note.txt')).toBe('before')
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
      // Muse Code's goal tools (M45), offered in every session.
      'create_goal',
      'get_goal',
      'update_goal',
      'report_progress',
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
    expect(classifyTool('report_progress')).toBe('interactive')
    expect(classifyTool('nope')).toBeUndefined()
    for (const tool of toolDefinitions('linux')) {
      expect(tool.parameters).toMatchObject({ type: 'object', additionalProperties: false })
      expect(tool.strict).toBe(false)
    }
  })

  it('offers Muse Code’s memory tools last, only with memory on (M49)', () => {
    const options = { hasShell: true, hasSkills: false, hasMemory: true }
    const withMemory = toolDefinitions('linux', options)
    const memoryTools = withMemory.slice(-3)
    expect(memoryTools.map((tool) => tool.name)).toEqual([
      'read_memory',
      'add_memory',
      'edit_memory',
    ])
    for (const tool of memoryTools) {
      expect(tool.parameters).toMatchObject({ type: 'object', additionalProperties: false })
      expect(tool.strict).toBe(false)
    }
    expect(
      toolDefinitions('linux', { hasShell: true, hasSkills: false }).map((tool) => tool.name),
    ).not.toContain('read_memory')
    expect(classifyTool('read_memory')).toBe('read')
    expect(classifyTool('add_memory')).toBe('edit')
    expect(classifyTool('edit_memory')).toBe('edit')
  })

  it('offers subagent controls to the parent and omits panel tools from a child (M48)', () => {
    const parent = toolDefinitions('linux', {
      hasShell: true,
      hasSkills: false,
      hasSubagents: true,
    }).map((tool) => tool.name)
    expect(parent).toContain('subagent_spawn')
    expect(parent).toContain('subagent_read_result')
    expect(classifyTool('subagent_spawn')).toBe('spawn')
    const child = toolDefinitions('linux', {
      hasShell: true,
      hasSkills: false,
      isSubagent: true,
    }).map((tool) => tool.name)
    expect(child).not.toContain('subagent_spawn')
    expect(child).not.toContain('ask_user')
    expect(child).not.toContain('todo_write')
    expect(child).toContain('read_file')
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
  it('creates a file with an all-added patch and overwrites with a hunk in context', async () => {
    const { io, run } = context({})
    const created = await run('write_file', { path: 'new.txt', content: 'a\nb\n' })
    expect(io.files.get('/ws/new.txt')).toBe('a\nb\n')
    expect(created.visibleOutput).toContain('created new.txt')
    expect(created.patch?.summary).toEqual({ files: 1, added: 2, removed: 0 })
    const files = parsePatchFiles(created.patch?.document ?? '')
    expect(files?.[0]).toMatchObject({
      path: 'new.txt',
      created: true,
      hunks: [{ oldStart: 0, oldLines: 0, newStart: 1 }],
    })
    const reverted = revertHunks('a\nb\n', files?.[0]?.hunks ?? [], files?.[0]?.created)
    expect(reverted).toEqual({ ok: true, content: '', isCreatedFile: true })

    const rewritten = await run('write_file', { path: 'new.txt', content: 'a\nB\nc\n' })
    expect(rewritten.patch?.summary).toEqual({ files: 1, added: 2, removed: 1 })
    const [file] = parsePatchFiles(rewritten.patch?.document ?? '') ?? []
    expect(file).toEqual({
      path: 'new.txt',
      created: false,
      hunks: [
        { oldStart: 1, oldLines: 2, newStart: 1, newLines: 3, lines: [' a', '-b', '+B', '+c'] },
      ],
    })
    expect(revertHunks('a\nB\nc\n', file?.hunks ?? [], file?.created)).toEqual({
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
      'edited\n--- original\n+++ updated\n@@\n # Notes\n \n first line\n-first line?\n+second\n+third\n',
    )
    expect(ok.patch?.summary).toEqual({ files: 1, added: 2, removed: 1 })
    const missing = await run('edit_file', { path: 'nope.md', find: 'a', replace: 'b' })
    expect(missing.failureReason).toBe('file not found: nope.md')
    // The edit counts as having seen the file, so it may be replaced whole.
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

const names = (options?: { hasShell: boolean; hasSkills: boolean }) =>
  toolDefinitions('linux', options).map((tool) => tool.name)

describe('toolDefinitions options and read_skill (M10)', () => {
  it('omits the shell in Restricted Mode and offers read_skill with a catalogue', async () => {
    expect(names({ hasShell: true, hasSkills: false })).toEqual(names())
    expect(names()).toContain('bash')
    expect(names()).not.toContain('read_skill')
    const restricted = names({ hasShell: false, hasSkills: true })
    expect(restricted).not.toContain('bash')
    expect(restricted).toContain('read_skill')
    expect(classifyTool('read_skill')).toBe('read')
    // The session serves read_skill (it needs the catalogue); the harness refuses it.
    await expect(context().run('read_skill', { id: 'x' })).resolves.toMatchObject({
      failureReason: 'unknown tool read_skill',
    })
  })
})

describe('executeTool: files as they are (D27)', () => {
  it('matches LF text in a CRLF file and writes CRLF back', async () => {
    const { io, run } = context({ 'win.txt': 'one\r\ntwo\r\nthree\r\n' })
    const read = await run('read_file', { path: 'win.txt' })
    expect(read.output).toBe('Read text file `win.txt`.\n1|one\n2|two\n3|three')
    const edited = await run('edit_file', {
      path: 'win.txt',
      find: 'one\ntwo',
      replace: 'ONE\nTWO\nand more',
    })
    expect(edited.failureReason).toBeUndefined()
    expect(io.files.get('/ws/win.txt')).toBe('ONE\r\nTWO\r\nand more\r\nthree\r\n')
    await run('write_file', { path: 'win.txt', content: 'replaced\nwhole' })
    // Its line breaks and its final one kept.
    expect(io.files.get('/ws/win.txt')).toBe('replaced\r\nwhole\r\n')
  })

  it('keeps a UTF-8 BOM out of the model’s view and in the file', async () => {
    const { io, run } = context({ 'bom.md': '\u{FEFF}# Title\nbody\n' })
    const read = await run('read_file', { path: 'bom.md' })
    expect(read.output).toBe('Read text file `bom.md`.\n1|# Title\n2|body')
    await run('edit_file', { path: 'bom.md', find: '# Title', replace: '# New title' })
    expect(io.files.get('/ws/bom.md')).toBe('\u{FEFF}# New title\nbody\n')
    await run('write_file', { path: 'bom.md', content: 'all new\n' })
    expect(io.files.get('/ws/bom.md')).toBe('\u{FEFF}all new\n')
  })

  it('replaces a file only as the model last saw it (Claude Code’s rule)', async () => {
    const { io, run } = context({ 'a.txt': 'original\n' })
    const unseen = await run('write_file', { path: 'a.txt', content: 'mine\n' })
    expect(unseen.failureReason).toBe(`a.txt ${MODEL_API_MODEL_TEXT.fileChangedSinceRead}`)
    expect(io.files.get('/ws/a.txt')).toBe('original\n')
    await run('read_file', { path: 'a.txt' })
    io.files.set('/ws/a.txt', 'the user changed it\n')
    const stale = await run('write_file', { path: 'a.txt', content: 'mine\n' })
    expect(stale.failureReason).toBe(`a.txt ${MODEL_API_MODEL_TEXT.fileChangedSinceRead}`)
    await run('read_file', { path: 'a.txt' })
    const fresh = await run('write_file', { path: 'a.txt', content: 'mine\n' })
    expect(fresh.failureReason).toBeUndefined()
    expect(io.files.get('/ws/a.txt')).toBe('mine\n')
  })

  it('leaves a file alone while an editor holds unsaved changes to it', async () => {
    const { io, run } = context({ 'open.ts': 'x\n' })
    io.unsaved.add('/ws/open.ts')
    await run('read_file', { path: 'open.ts' })
    for (const outcome of [
      await run('edit_file', { path: 'open.ts', find: 'x', replace: 'y' }),
      await run('write_file', { path: 'open.ts', content: 'y\n' }),
    ]) {
      expect(outcome.failureReason).toBe(`open.ts ${FILE_REFUSAL_MODEL_TEXT.fileHasUnsavedChanges}`)
    }
    expect(io.files.get('/ws/open.ts')).toBe('x\n')
  })

  it('says a file is not text instead of rewriting it', async () => {
    const { io, run } = context({})
    io.readFile = () => Promise.reject(new Error(`/ws/a.bin ${MODEL_TEXT.fileNotText}`))
    await expect(run('edit_file', { path: 'a.bin', find: 'x', replace: 'y' })).rejects.toThrow(
      MODEL_TEXT.fileNotText,
    )
  })
})

/** Lines as a file's text, each ending with a line break. */
function text(lines: readonly string[]): string {
  return `${lines.join('\n')}\n`
}

describe('executeTool: patches a Revert can trust (D27)', () => {
  const tenLines = Array.from({ length: 10 }, (_, index) => `line ${String(index + 1)}`)

  it('records an insertion at the top as an insertion, not as a new file', async () => {
    const { io, run } = context({ 'a.ts': text(tenLines) })
    const edit = await run('edit_file', {
      path: 'a.ts',
      find: 'line 1\n',
      replace: 'import x\nline 1\n',
    })
    const [file] = parsePatchFiles(edit.patch?.document ?? '') ?? []
    expect(file).toMatchObject({ created: false })
    expect(file?.hunks[0]).toMatchObject({ oldStart: 1, newStart: 1 })
    const reverted = revertHunks(io.files.get('/ws/a.ts') ?? '', file?.hunks ?? [], file?.created)
    expect(reverted).toEqual({ ok: true, content: text(tenLines), isCreatedFile: false })
  })

  it('puts deleted lines back between their own context, wherever it moved to (M36)', async () => {
    const { io, run } = context({ 'a.ts': text(tenLines) })
    const edit = await run('edit_file', { path: 'a.ts', find: 'line 5\n', replace: '' })
    const [file] = parsePatchFiles(edit.patch?.document ?? '') ?? []
    expect(file?.hunks[0]?.lines).toEqual([
      ' line 2',
      ' line 3',
      ' line 4',
      '-line 5',
      ' line 6',
      ' line 7',
      ' line 8',
    ])
    // The user added a line above the deletion since: the context moved down
    // one line, intact, so line 5 goes back between lines 4 and 6.
    const shifted = `added by the user\n${io.files.get('/ws/a.ts') ?? ''}`
    expect(revertHunks(shifted, file?.hunks ?? [], file?.created)).toEqual({
      ok: true,
      content: `added by the user\n${text(tenLines)}`,
      isCreatedFile: false,
    })
    // A file whose context itself changed is refused, not guessed at (D27).
    const changed = (io.files.get('/ws/a.ts') ?? '').replace('line 3', 'line three')
    expect(revertHunks(changed, file?.hunks ?? [], file?.created)).toMatchObject({ ok: false })
  })
})

describe('executeTool: a flood of shell output (D27)', () => {
  it('keeps each stream’s beginning and end and always the exit line', async () => {
    const huge = `${'start '.repeat(10)}${'x'.repeat(200_000)} the end`
    const io = memoryToolIo({}, ROOT, () => ({
      stdout: huge,
      stderr: `${'e'.repeat(100_000)} last error`,
      exitCode: 3,
      isTimedOut: false,
      isCancelled: false,
    }))
    const outcome = await executeTool(
      'bash',
      JSON.stringify({ command: 'flood', description: 'd' }),
      {
        workspaceRoot: ROOT,
        platform: 'linux',
        io,
        seen: new Map(),
        provisionalSeen: new Map(),
      },
    )
    expect(outcome.output.startsWith('start start')).toBe(true)
    expect(outcome.output).toContain(' the end')
    expect(outcome.output).toContain(' last error')
    expect(outcome.output.endsWith('[exit code 3]')).toBe(true)
    expect(outcome.output).toContain(TOOL_OUTPUT_ELIDED_MARKER)
    expect(outcome.output.length).toBeLessThan(
      TOOL_OUTPUT_MAX_CHARS + TOOL_OUTPUT_ELIDED_MARKER.length,
    )
  })
})

describe('executeTool: search limits (D27)', () => {
  it('says when the search stopped early or read only part of the files', async () => {
    const io = memoryToolIo({ 'a.ts': 'x\n' }, ROOT)
    io.searchFiles = () =>
      Promise.resolve({ ok: true, hits: [{ file: 'a.ts', line: 1, text: 'x' }], isPartial: true })
    const ctx: ToolContext = {
      workspaceRoot: ROOT,
      platform: 'linux',
      io,
      seen: new Map(),
      provisionalSeen: new Map(),
    }
    const partial = await executeTool('search', JSON.stringify({ pattern: 'x' }), ctx)
    expect(partial.output).toContain('a.ts:1: x')
    expect(partial.output).toContain('these results are partial')
    io.listFiles = () =>
      Promise.resolve(Array.from({ length: SEARCH_MAX_CANDIDATES + 1 }, (_, i) => `f${String(i)}`))
    let searched = 0
    io.searchFiles = (job) => {
      searched = job.files.length
      expect(job.maxFileBytes).toBe(SEARCH_MAX_FILE_BYTES)
      expect(job.maxHits).toBe(SEARCH_MAX_HITS)
      return Promise.resolve({ ok: true, hits: [] })
    }
    const capped = await executeTool('search', JSON.stringify({ pattern: 'x' }), ctx)
    expect(searched).toBe(SEARCH_MAX_CANDIDATES)
    expect(capped.output).toContain(
      `searched the first ${String(SEARCH_MAX_CANDIDATES)} of ${String(SEARCH_MAX_CANDIDATES + 1)} files`,
    )
  })
})

// M71: a conversation in a worktree runs with the worktree as its root, so
// its file tools cannot reach the main checkout beside it, by a relative or
// an absolute path.
describe('a conversation in a worktree (M71)', () => {
  const MAIN = '/repos/app'
  const WORKTREE = '/repos/app.worktrees/feature'

  it('cannot read, write or edit the main checkout', async () => {
    const io = memoryToolIo({ 'src/a.ts': 'worktree\n' }, WORKTREE)
    io.files.set(`${MAIN}/src/a.ts`, 'main\n')
    const seen = new Map<string, string>()
    const ctx: ToolContext = {
      workspaceRoot: WORKTREE,
      platform: 'linux',
      io,
      seen,
      provisionalSeen: new Map(),
    }
    const run = (name: string, args: unknown) => executeTool(name, JSON.stringify(args), ctx)
    for (const target of ['../../app/src/a.ts', `${MAIN}/src/a.ts`]) {
      expect(await run('read_file', { path: target })).toMatchObject({
        failureReason: `path ${target} is outside the workspace`,
      })
      expect(await run('write_file', { path: target, content: 'x\n' })).toMatchObject({
        failureReason: `path ${target} is outside the workspace`,
      })
      expect(await run('edit_file', { path: target, find: 'main', replace: 'x' })).toMatchObject({
        failureReason: `path ${target} is outside the workspace`,
      })
    }
    expect(io.files.get(`${MAIN}/src/a.ts`)).toBe('main\n')
    // Its own files are its to change.
    await run('read_file', { path: 'src/a.ts' })
    for (const [absolute, hash] of ctx.provisionalSeen) seen.set(absolute, hash)
    ctx.provisionalSeen.clear()
    const written = await run('write_file', { path: 'src/a.ts', content: 'changed\n' })
    expect(written.failureReason).toBeUndefined()
    expect(io.files.get(`${WORKTREE}/src/a.ts`)).toBe('changed\n')
  })
})
