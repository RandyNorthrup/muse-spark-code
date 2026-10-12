import { execFileSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { realpath } from 'node:fs/promises'
import * as z from 'zod/mini'
import { describe, expect, it, vi } from 'vitest'
import { executeTool, type ToolContext } from '../../src/core/backends/modelapi/tools'
import { confineWorkspacePath } from '../../src/core/workspacePath'
import { ModelApiHost } from '../../src/core/backends/modelapi/ModelApiHost'
import { UpdateTranslator } from '../../src/acp/translate'
import { UI_TEXT } from '../../src/shared/constants'
import { fakeModelApi, fakeModelApiClient } from './helpers/fakeModelApi'
import { fakeModelApiHostDeps } from './helpers/modelApiHostDeps'
import { FakeLogOutputChannel } from './helpers/fakes'
import { memoryToolIo } from './helpers/fakeToolIo'
import { watchSessionTurns } from './helpers/sessionTurns'

const tools = ['read_file', 'write_file', 'edit_file', 'list_files', 'search'] as const
function args(tool: string, file: string) {
  if (tool === 'list_files') return { glob: `${file}/*` }
  if (tool === 'search') return { glob: `${file}/*`, pattern: 'report' }
  if (tool === 'write_file') return { path: file, content: 'report' }
  return tool === 'edit_file' ? { path: file, find: 'old', replace: 'new' } : { path: file }
}

describe('ACPDOG explicit workspace refusals', () => {
  it.each(['linux', 'win32'] as const)(
    'refuses all outside file operations without I/O (%s)',
    async (platform) => {
      const root = platform === 'win32' ? String.raw`C:\workspace` : '/workspace'
      const outside = platform === 'win32' ? String.raw`C:\outside\report.md` : '/outside/report.md'
      const io = memoryToolIo({}, root)
      const reads = vi.spyOn(io, 'readFile')
      const writes = vi.spyOn(io, 'writeFile')
      const list = vi.spyOn(io, 'listFiles')
      const context: ToolContext = {
        workspaceRoot: root,
        platform,
        io,
        seen: new Map(),
        provisionalSeen: new Map(),
      }
      for (const tool of tools) {
        const outcome = await executeTool(tool, JSON.stringify(args(tool, outside)), context)
        expect(outcome).toMatchObject({
          refusalCode: 'outside_workspace',
          visibleOutput: UI_TEXT.acpOutsideWorkspaceRefused,
        })
        expect(outcome.output).toContain('outside_workspace')
        expect(outcome.output).toContain('not read or written')
      }
      expect(reads).not.toHaveBeenCalled()
      expect(writes).not.toHaveBeenCalled()
      expect(list).not.toHaveBeenCalled()
    },
  )
  it('returns every refusal to the model and ends each client tool row as refused', async () => {
    const api = fakeModelApi()
    const log = new FakeLogOutputChannel()
    const io = memoryToolIo({ 'inside.md': 'inside' }, '/workspace')
    api.script(
      {
        calls: tools.map((tool) => ({
          name: tool,
          callId: tool,
          arguments: JSON.stringify(args(tool, '/outside/report.md')),
        })),
      },
      { text: 'Model received the refusals' },
    )
    const host = new ModelApiHost(
      fakeModelApiHostDeps({
        client: fakeModelApiClient(api, log),
        workspaceRoot: '/workspace',
        io,
        log,
      }),
    )
    try {
      const session = await host.startSession({
        workspaceRoot: '/workspace',
        modelId: 'muse-spark-1.3',
        approvalMode: 'allowAll',
      })
      const watch = watchSessionTurns(session)
      const done = watch.turnDone()
      await session.sendTurn([{ type: 'text', text: 'write the report outside' }])
      await done
      const body = z
        .object({ input: z.array(z.object({ type: z.string(), output: z.optional(z.unknown()) })) })
        .parse(api.responseBodies()[1])
      const outputs = body.input.filter((item) => item.type === 'function_call_output')
      expect(outputs).toHaveLength(5)
      for (const item of outputs) expect(item.output).toContain('outside_workspace')
      const completed = watch.events.filter(
        (event) => event.type === 'itemCompleted' && event.item.kind === 'toolCall',
      )
      expect(completed).toHaveLength(5)
      const translator = new UpdateTranslator('/workspace', false)
      for (const event of completed)
        expect(translator.updates(event)).toContainEqual(
          expect.objectContaining({
            sessionUpdate: 'tool_call_update',
            status: 'failed',
            _meta: {
              // The client reads the specific reason (the refused path or
              // glob), not the shown sentence.
              'museSpark.refusal': {
                code: 'outside_workspace',
                reason: expect.stringContaining('/outside/report.md'),
              },
            },
          }),
        )
      expect(watch.events.some((event) => event.type === 'approvalRequested')).toBe(false)
      expect(io.files).toEqual(new Map([['/workspace/inside.md', 'inside']]))
    } finally {
      await host.close()
    }
  })
})

describe('ACPDOG resolved-identity containment (R4)', () => {
  // Containment compares resolved identity, not spelling: an alias of the
  // workspace is inside it, while link and junction escapes stay refused.
  it('reads through an alias spelling of the workspace by identity', async () => {
    const long = '/ws/workspaceLongName'
    const base = memoryToolIo({ 'notes.md': 'workspace notes' }, long)
    const io = {
      ...base,
      realPath: (absolutePath: string) =>
        base.realPath(absolutePath.split('/ws/WORKSP~1').join(long)),
    }
    const context: ToolContext = {
      workspaceRoot: long,
      platform: 'linux',
      io,
      seen: new Map(),
      provisionalSeen: new Map(),
    }
    const read = await executeTool(
      'read_file',
      JSON.stringify({ path: '/ws/WORKSP~1/notes.md' }),
      context,
    )
    expect(read.failureReason).toBeUndefined()
    expect(read.output).toContain('workspace notes')
    const listed = await executeTool(
      'list_files',
      JSON.stringify({ glob: '/ws/WORKSP~1/*.md' }),
      context,
    )
    expect(listed.failureReason).toBeUndefined()
    expect(listed.output).toBe('notes.md')
    // A sibling the alias does not name stays outside.
    const outside = await executeTool(
      'read_file',
      JSON.stringify({ path: '/ws/other/notes.md' }),
      context,
    )
    expect(outside).toMatchObject({ refusalCode: 'outside_workspace' })
  })

  it.skipIf(process.platform === 'win32')(
    'accepts a symbolic-link alias of the root (POSIX)',
    async () => {
      const dir = mkdtempSync(path.join(realpathSync(tmpdir()), 'acp-alias-'))
      try {
        const real = path.join(dir, 'workspace')
        mkdirSync(real)
        writeFileSync(path.join(real, 'notes.md'), 'real notes')
        const alias = path.join(dir, 'link-workspace')
        symlinkSync(real, alias)
        const io = { realPath: (absolutePath: string) => realpath(absolutePath) }
        const confined = await confineWorkspacePath(
          real,
          path.join(alias, 'notes.md'),
          process.platform,
          io,
        )
        expect(confined).toMatchObject({ ok: true })
        // A link inside the workspace that leads outside stays refused.
        const outsideDir = path.join(dir, 'outside')
        mkdirSync(outsideDir)
        writeFileSync(path.join(outsideDir, 'x.md'), 'outside')
        const escape = path.join(real, 'escape')
        symlinkSync(outsideDir, escape)
        const refused = await confineWorkspacePath(
          real,
          path.join(escape, 'x.md'),
          process.platform,
          io,
        )
        expect(refused).toMatchObject({
          ok: false,
          code: 'outside_workspace',
          reason: expect.stringContaining('through a link'),
        })
      } finally {
        rmSync(dir, { recursive: true, force: true })
      }
    },
  )

  it.runIf(process.platform === 'win32')(
    'accepts a Windows 8.3 short-name alias of the workspace',
    async (context) => {
      const dir = mkdtempSync(path.join(realpathSync(tmpdir()), 'acp-short-'))
      try {
        const long = path.join(dir, 'workspaceLongName')
        mkdirSync(long)
        writeFileSync(path.join(long, 'notes.md'), 'short-name notes')
        let short: string | null = null
        try {
          const out = execFileSync(
            'powershell.exe',
            [
              '-NoProfile',
              '-Command',
              `(New-Object -ComObject Scripting.FileSystemObject).GetFolder(${JSON.stringify(long)}).ShortPath`,
            ],
            { encoding: 'utf8', timeout: 30_000 },
          ).trim()
          if (out !== '' && out.toLowerCase() !== long.toLowerCase()) short = out
        } catch {
          short = null
        }
        if (short === null) {
          context.skip('this volume provides no 8.3 short name for the workspace')
          return
        }
        const io = { realPath: (absolutePath: string) => realpath(absolutePath) }
        const confined = await confineWorkspacePath(long, path.join(short, 'notes.md'), 'win32', io)
        expect(confined).toMatchObject({ ok: true })
      } finally {
        rmSync(dir, { recursive: true, force: true })
      }
    },
  )
})
