import { spawnSync } from 'node:child_process'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import * as z from 'zod/mini'
import {
  buildCursorStdin,
  buildForeignStdin,
  parseCursorResult,
  parseForeignResult,
} from '../../src/core/backends/modelapi/hookFormats'
import { createTabHooks, type TabHookRun } from '../../src/core/tab/tabHooks'
import {
  EXTENSION_HOOK_EVENTS,
  WINDOWS_POWERSHELL_COMMAND_ARGS,
  WINDOWS_POWERSHELL_RELATIVE_PATH,
} from '../../src/shared/constants'
import { cursorTabExample } from './helpers/cursorTabFixture'

const WORKSPACE_ROOT = process.platform === 'win32' ? String.raw`C:\workspace` : '/workspace'
const FILE_PATH = path.join(WORKSPACE_ROOT, 'a.ts')
const CONTEXT = {
  workspaceRoots: [WORKSPACE_ROOT],
  model: 'muse-spark-1.3',
  generationId: 'tab-generation',
}

function stdinValue(stdin: string): Record<string, unknown> {
  return z.record(z.string(), z.unknown()).parse(JSON.parse(stdin))
}

function savedTabEdit(): Record<string, unknown> {
  const example = cursorTabExample('afterTabFileEdit')
  const [edit] = z.array(z.record(z.string(), z.unknown())).parse(example['edits'])
  if (edit === undefined) throw new Error('The saved edit must exist')
  return edit
}

describe('Cursor Tab contracts from M91 saved examples', () => {
  it('keeps both source names in the extension-only event list', () => {
    expect(EXTENSION_HOOK_EVENTS).toContain('beforeTabFileRead')
    expect(EXTENSION_HOOK_EVENTS).toContain('afterTabFileEdit')
  })

  it.each(['file_path', 'content'])('refuses a read missing %s', (field) => {
    const payload: Record<string, unknown> = { file_path: FILE_PATH, content: 'text' }
    Reflect.deleteProperty(payload, field)
    expect(buildCursorStdin('beforeTabFileRead', payload).outcome).toBe('refused')
  })

  it.each(['beforeTabFileRead', 'afterTabFileEdit'] as const)(
    '%s uses the saved shape and the actual Tab generation',
    (event) => {
      const example = cursorTabExample(event)
      const payload = {
        ...example,
        file_path: FILE_PATH,
        hook_event_name: event,
        workspace_roots: CONTEXT.workspaceRoots,
        model: CONTEXT.model,
        generation_id: CONTEXT.generationId,
      }
      const native = buildCursorStdin(event, payload)
      const generic = buildForeignStdin('cursor', event, payload, { sourceEvent: event })
      expect(generic).toEqual(native)
      if (native.outcome !== 'run') throw new Error('Tab fixture must build')
      expect(stdinValue(native.stdin)).toEqual(payload)
    },
  )

  it('drops inferred metadata from Cursor stdin and refuses numeric line text or nonpositive ranges', () => {
    const example = cursorTabExample('afterTabFileEdit')
    const edits = z.array(z.record(z.string(), z.unknown())).parse(example['edits'])
    const marked = {
      file_path: FILE_PATH,
      edits: edits.map((edit) => ({ ...edit, inferred: true })),
    }
    const built = buildCursorStdin('afterTabFileEdit', marked)
    if (built.outcome !== 'run') throw new Error('An inferred Tab fixture must build')
    expect(stdinValue(built.stdin)['edits']).toEqual(edits)
    expect(built.stdin).not.toContain('inferred')
    expect(buildCursorStdin('afterTabFileEdit', { ...marked, edits: [] }).outcome).toBe('refused')
    const edit = edits[0]
    if (edit === undefined) throw new Error('The saved edit must exist')
    expect(
      buildCursorStdin('afterTabFileEdit', { ...marked, edits: [{ ...edit, old_line: 10 }] })
        .outcome,
    ).toBe('refused')
    const range = z.record(z.string(), z.unknown()).parse(edit['range'])
    expect(
      buildCursorStdin('afterTabFileEdit', {
        ...marked,
        edits: [{ ...edit, range: { ...range, start_column: 0 } }],
      }).outcome,
    ).toBe('refused')
  })

  it.each([
    [0, '{"permission":"deny"}'],
    [2, '{"permission":"allow"}'],
    [1, '{"permission":"allow"}'],
    [null, '{"permission":"allow"}'],
    [0, ''],
    [0, '{'],
    [0, '{"permission":"ask"}'],
    [0, '{"permission":"allow","user_message":"undocumented"}'],
  ] satisfies readonly (readonly [number | null, string])[])(
    'read exit %s and output %s always fails closed',
    (exit, stdout) => {
      for (const isFailClosed of [false, true]) {
        const answer = parseForeignResult('cursor', 'beforeTabFileRead', exit, stdout, '', {
          failClosed: isFailClosed,
        })
        expect(answer.status).toBe('blocked')
        expect(answer.permissionDecision).not.toBe('allow')
        expect(answer.approvalDecision).not.toBe('allow')
      }
    },
  )

  it('an explicit read allow is only a successful guard, never a grant', () => {
    expect(parseCursorResult('beforeTabFileRead', 0, '{"permission":"allow"}', '')).toEqual({
      status: 'completed',
    })
  })

  it('keeps Agent generation handling unchanged while Tab uses its own id', () => {
    const built = buildCursorStdin('PreToolUse', {
      tool_name: 'read_file',
      tool_input: { path: 'a.ts' },
      cwd: WORKSPACE_ROOT,
      turn_id: 'agent-turn',
      generation_id: 'unrelated-tab-generation',
    })
    if (built.outcome !== 'run') throw new Error('The existing Agent shape must build')
    expect(stdinValue(built.stdin)['generation_id']).toBe('agent-turn')
  })

  it.each(['start_line_number', 'start_column', 'end_line_number', 'end_column'])(
    'refuses invalid %s in the saved edit range',
    (field) => {
      const edit = savedTabEdit()
      const range = z.record(z.string(), z.unknown()).parse(edit['range'])
      for (const value of [0, -1, 1.5, '1']) {
        expect(
          buildCursorStdin('afterTabFileEdit', {
            file_path: FILE_PATH,
            edits: [{ ...edit, range: { ...range, [field]: value } }],
          }).outcome,
        ).toBe('refused')
      }
    },
  )

  it.each(['old_string', 'new_string', 'old_line', 'new_line'])(
    'refuses invalid %s in the saved edit',
    (field) => {
      const edit = savedTabEdit()
      expect(
        buildCursorStdin('afterTabFileEdit', {
          file_path: FILE_PATH,
          edits: [{ ...edit, [field]: 1 }],
        }).outcome,
      ).toBe('refused')
    },
  )

  it.each([0, 1, 2, null])('edit output is observation only even at exit %s', (exit) => {
    const answer = parseCursorResult(
      'afterTabFileEdit',
      exit,
      '{"permission":"deny","followup_message":"work"}',
      'local text',
    )
    expect(answer.status).not.toBe('blocked')
    expect(answer.permissionDecision).toBeUndefined()
    expect(answer.approvalDecision).toBeUndefined()
    expect(answer.context).toBeUndefined()
  })
})

describe('real hook output, no model calls', () => {
  it.each(['allow', 'deny', 'crash', 'garbage'] as const)(
    '%s output goes through the Tab guard',
    async (mode) => {
      const requests: TabHookRun[] = []
      const hooks = createTabHooks({
        isWorkspaceTrusted: () => true,
        isHooksEnabled: () => true,
        configurationVersion: () => 'fixture',
        log: () => undefined,
        run: (request) => {
          requests.push(request)
          const isWindows = process.platform === 'win32'
          const systemRoot = process.env['SystemRoot']
          if (isWindows && systemRoot === undefined)
            throw new Error('Windows fixture requires SystemRoot')
          const program = isWindows
            ? path.win32.join(systemRoot ?? '', WINDOWS_POWERSHELL_RELATIVE_PATH)
            : '/bin/sh'
          const args = isWindows
            ? [
                ...WINDOWS_POWERSHELL_COMMAND_ARGS.filter((arg) => arg !== '-Command'),
                '-File',
                'test/fixtures/tabHooks/read.ps1',
                mode,
              ]
            : ['test/fixtures/tabHooks/read.sh', mode]
          const child = spawnSync(program, args, {
            input: request.stdin,
            encoding: 'utf8',
            env: isWindows ? { SystemRoot: systemRoot } : {},
          })
          if (child.error !== undefined) throw child.error
          return Promise.resolve([
            {
              exitCode: child.status,
              stdout: child.stdout,
              stderr: child.stderr,
              isTimedOut: false,
              isCancelled: false,
            },
          ])
        },
      })
      const example = cursorTabExample('beforeTabFileRead')
      const content = z.string().parse(example['content'])
      expect(await hooks.beforeRead('/workspace/a.ts', content, CONTEXT)).toBe(mode === 'allow')
      expect(requests).toHaveLength(1)
    },
  )
})
