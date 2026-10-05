// M91 lane W (PLAN.md D70, step 10; acceptance 6, 13, 14a, 14b, 14d, 14g):
// imported hooks in a running Model API session. A foreign allow still shows
// the approval card; an imported Cursor shell guard sees a then_run command
// (SoL-Pi rule 4); a documented output replacement lands before the next
// request is built, so packing archives what the model saw (rule 2); hook
// context goes at the tail of an unchanged prefix (rule 1); and imported hooks
// that are off leave the request bytes as they were (rule 7).

import { describe, expect, it, vi } from 'vitest'
import { ModelApiHost, ModelApiSession } from '../../src/core/backends/modelapi/ModelApiHost'
import { parseForeignHooks, type HookDefinition } from '../../src/core/backends/modelapi/hooks'
import type { ToolIo } from '../../src/core/backends/modelapi/tools'
import type { VerifyHooks } from '../../src/core/backends/modelapi/verifyLoop'
import type { ShellResult } from '../../src/core/shellResult'
import type { AgentEvent } from '../../src/shared/agentEvents'
import { UI_TEXT } from '../../src/shared/constants'
import { FakeLogOutputChannel } from './helpers/fakes'
import {
  fakeModelApi,
  fakeModelApiClient,
  responseOutputsByCall,
  type ScriptedReply,
} from './helpers/fakeModelApi'
import { memoryToolIo } from './helpers/fakeToolIo'
import { fakeModelApiHostDeps } from './helpers/modelApiHostDeps'
import { watchSessionTurns } from './helpers/sessionTurns'

const ROOT = '/ws'

interface HookRun {
  readonly command: string
  readonly stdin: Record<string, unknown>
}

function spark(event: string, group: Record<string, unknown>): readonly HookDefinition[] {
  const parsed = parseForeignHooks(
    JSON.stringify({ hooks: { [event]: [group] } }),
    'project',
    'linux',
  )
  expect(parsed.warnings).toEqual([])
  return parsed.hooks
}

function answered(stdout: string, exitCode = 0, stderr = ''): ShellResult {
  return { stdout, stderr, exitCode, isTimedOut: false, isCancelled: false }
}

const noChecks: VerifyHooks = {
  isDiagnosticsOn: () => false,
  checkCommands: () => [],
  isFormatOnEdit: () => false,
  diagnosticsAfterEdit: (files) => Promise.resolve(files.map((file) => ({ file, entries: [] }))),
  formatAfterEdit: () => Promise.resolve(undefined),
}

async function session(options: {
  readonly hooks: readonly HookDefinition[]
  readonly answer?: (run: HookRun) => ShellResult
  readonly mode?: string
  readonly isHooksEnabled?: boolean
}) {
  const api = fakeModelApi()
  const log = new FakeLogOutputChannel()
  const io = memoryToolIo({ 'src/a.ts': 'const a = 1\n', 'notes.txt': 'hello' }, ROOT)
  const runs: HookRun[] = []
  const runHook: NonNullable<ToolIo['runHook']> = (command, stdin) => {
    const run = { command, stdin: JSON.parse(stdin) as Record<string, unknown> }
    runs.push(run)
    return Promise.resolve(options.answer?.(run) ?? answered(''))
  }
  io.runHook = runHook
  const host = new ModelApiHost({
    ...fakeModelApiHostDeps({ client: fakeModelApiClient(api, log), workspaceRoot: ROOT, io, log }),
    verify: noChecks,
    loadHooks: () => Promise.resolve(options.hooks),
    isHooksEnabled: () => options.isHooksEnabled ?? true,
  })
  const started = await host.startSession({
    workspaceRoot: ROOT,
    modelId: 'muse-spark-1.3',
    approvalMode: options.mode ?? 'allowAll',
  })
  if (!(started instanceof ModelApiSession)) {
    throw new TypeError('expected the Model API session')
  }
  const { events, turnDone } = watchSessionTurns(started)
  const turn = async (...replies: readonly ScriptedReply[]) => {
    api.script(...replies)
    const done = turnDone()
    await started.sendTurn([{ type: 'text', text: 'go' }])
    await done
  }
  return { api, io, runs, events, session: started, turn }
}

const editThenRun = (find: string, replace: string, thenRun: string) => ({
  name: 'edit_file',
  arguments: JSON.stringify({ path: 'src/a.ts', find, replace, then_run: thenRun }),
})

const cursorShellGuard = spark('PreToolUse', {
  matcher: 'Bash',
  format: 'cursor',
  sourceEvent: 'beforeShellExecution',
  flavor: 'specialized',
  commandPattern: 'curl',
  hooks: [{ type: 'command', command: './no-network.sh' }],
})

describe('imported hooks in a Model API session', () => {
  it('a foreign allow still shows the approval card (acceptance 6)', async () => {
    const hooks = spark('PreToolUse', {
      matcher: 'Bash',
      format: 'cursor',
      sourceEvent: 'preToolUse',
      flavor: 'generic',
      hooks: [{ type: 'command', command: './allow.sh' }],
    })
    const t = await session({
      hooks,
      mode: 'promptUnmatched',
      answer: () => answered(JSON.stringify({ permission: 'allow' })),
    })
    t.api.script(
      { calls: [{ name: 'bash', arguments: JSON.stringify({ command: 'rm -rf build' }) }] },
      { text: 'done' },
    )
    void t.session.sendTurn([{ type: 'text', text: 'clean' }])
    await vi.waitFor(() => {
      expect(t.events.some((event) => event.type === 'approvalRequested')).toBe(true)
    })
    expect(t.runs.map((run) => run.stdin['hook_event_name'])).toEqual(['preToolUse'])
    expect(t.io.shellCalls).toEqual([])
    await t.session.cancel()
  })

  it('an imported Cursor shell guard blocks a then_run command it selects (SoL-Pi 14d)', async () => {
    const t = await session({
      hooks: cursorShellGuard,
      answer: () => answered('', 2, 'no network from edits'),
    })
    await t.turn({ calls: [editThenRun('1', '2', 'curl https://evil.example')] }, { text: 'ok' })
    expect(t.runs.map((run) => run.stdin['command'])).toEqual(['curl https://evil.example'])
    expect(t.io.shellCalls.some((call) => call.command.includes('curl'))).toBe(false)
    // A command the pattern does not select runs, and the guard never started.
    await t.turn({ calls: [editThenRun('2', '3', 'npm test')] }, { text: 'ok' })
    expect(t.runs).toHaveLength(1)
    expect(t.io.shellCalls.some((call) => call.command.includes('npm test'))).toBe(true)
  })

  it('applies a documented output replacement before the next request (SoL-Pi 14b)', async () => {
    const hooks = spark('PostToolUse', {
      format: 'copilot',
      sourceEvent: 'postToolUse',
      flavor: 'copilot',
      hooks: [{ type: 'command', command: './redact.sh', timeout: 30 }],
    })
    const t = await session({
      hooks,
      answer: () =>
        answered(
          JSON.stringify({
            modifiedResult: { resultType: 'success', textResultForLlm: 'REDACTED' },
          }),
        ),
    })
    await t.turn(
      {
        calls: [
          { name: 'read_file', arguments: JSON.stringify({ path: 'notes.txt' }), callId: 'c1' },
        ],
      },
      { text: 'ok' },
    )
    expect(responseOutputsByCall(t.api, 1).get('c1')).toBe('REDACTED')
    // The hook saw the bounded preview of the real output; the row keeps it.
    expect(JSON.stringify(t.runs[0]?.stdin)).toContain('hello')
    const row = t.events.find(
      (event): event is Extract<AgentEvent, { type: 'itemCompleted' }> =>
        event.type === 'itemCompleted' && event.item.tool === 'read_file',
    )
    expect(row?.item.visibleOutput).not.toContain('REDACTED')
    expect(
      t.events.some(
        (event) => event.type === 'backendNotice' && event.text === UI_TEXT.hookOutputReplaced,
      ),
    ).toBe(true)
  })

  it('appends hook context at the tail: request N+1 begins with request N (SoL-Pi 14a)', async () => {
    const hooks = spark('PostToolUse', {
      format: 'copilot',
      sourceEvent: 'postToolUse',
      flavor: 'copilot',
      hooks: [{ type: 'command', command: './context.sh', timeout: 30 }],
    })
    const t = await session({
      hooks,
      answer: () => answered(JSON.stringify({ additionalContext: 'FOREIGN-CONTEXT' })),
    })
    await t.turn(
      { calls: [{ name: 'read_file', arguments: JSON.stringify({ path: 'notes.txt' }) }] },
      { text: 'ok' },
    )
    const [first, second] = t.api.responseBodies()
    const before = first?.['input'] as readonly unknown[]
    const after = second?.['input'] as readonly unknown[]
    expect(JSON.stringify(after.slice(0, before.length))).toBe(JSON.stringify(before))
    expect(JSON.stringify(after.slice(before.length))).toContain('FOREIGN-CONTEXT')
    expect(JSON.stringify(first?.['instructions'])).not.toContain('FOREIGN-CONTEXT')
    expect(JSON.stringify(second?.['tools'])).toBe(JSON.stringify(first?.['tools']))
    expect(second?.['prompt_cache_key']).toBe(first?.['prompt_cache_key'])
  })

  it('imported hooks that are off leave every request byte as it was (SoL-Pi 14g)', async () => {
    const bodies = async (hooks: readonly HookDefinition[], isHooksEnabled: boolean) => {
      const t = await session({ hooks, isHooksEnabled })
      await t.turn(
        {
          calls: [{ name: 'bash', arguments: JSON.stringify({ command: 'curl x' }), callId: 'c1' }],
        },
        { text: 'ok' },
      )
      expect(t.runs).toEqual([])
      // The fake API's item ids count up across sessions: named by first use.
      const ids = new Map<string, string>()
      return t.api.requests.map((request) =>
        JSON.stringify(request.body).replaceAll(/\b(?:rs|ws|msg|fc|call|resp)_\d+\b/g, (id) => {
          const named = ids.get(id) ?? `id${String(ids.size)}`
          ids.set(id, named)
          return named
        }),
      )
    }
    expect(await bodies(cursorShellGuard, false)).toEqual(await bodies([], true))
  })
})
