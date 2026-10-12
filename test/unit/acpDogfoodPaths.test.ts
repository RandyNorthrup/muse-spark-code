import * as z from 'zod/mini'
import { describe, expect, it, vi } from 'vitest'
import { executeTool, type ToolContext } from '../../src/core/backends/modelapi/tools'
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
              'museSpark.refusal': {
                code: 'outside_workspace',
                reason: UI_TEXT.acpOutsideWorkspaceRefused,
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
