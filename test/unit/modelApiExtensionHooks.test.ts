// M91 lane E: the Model API session's extension hook points (PLAN.md M91
// acceptance 5-11; SoL-Pi rules 1, 2 and 7). Each operation fires once with
// the documented payload; with no extension hooks the requests stay
// byte-identical to the hooks-off golden file.

import { describe, expect, it, vi } from 'vitest'
import * as z from 'zod/mini'
import { metaHostedCapabilities } from '../../src/core/backends/modelapi/modelCapabilities'
import { M106_CAPTURED_META_MODEL } from '../../src/shared/constants'
import { ModelApiHost } from '../../src/core/backends/modelapi/ModelApiHost'
import type {
  ModelApiHostDeps,
  ModelApiSession,
} from '../../src/core/backends/modelapi/ModelApiHost'
import { parseHookConfig, type HookDefinition } from '../../src/core/backends/modelapi/hooks'
import {
  parseSparkHooksConfig,
  type ExtensionHookDefinition,
} from '../../src/core/backends/modelapi/extensionHooks'
import type { AgentEvent } from '../../src/shared/agentEvents'
import type { ShellResult } from '../../src/core/shellResult'
import { fakeModelApi, FAKE_MODEL_API_ACCOUNT_ID, fakeModelApiClient } from './helpers/fakeModelApi'
import { memoryContextIo } from './helpers/fakeContextIo'
import { memoryToolIo, hookResult } from './helpers/fakeToolIo'
import { FakeLogOutputChannel } from './helpers/fakes'
import { fakeModelApiHostDeps } from './helpers/modelApiHostDeps'
import { memoryStoreOver } from './helpers/fakeMemoryIo'
import { startWatchedSession } from './helpers/sessionTurns'
import { logLines } from './helpers/logText'

const ROOT = '/ws'
const hookRecordSchema = z.record(z.string(), z.unknown())

function sparkHooks(doc: unknown): readonly ExtensionHookDefinition[] {
  return parseSparkHooksConfig(JSON.stringify({ hooks: doc }), 'project', 'linux').hooks
}

const TASK_CREATION_HOOKS = sparkHooks({
  TaskCreated: [{ hooks: [{ type: 'command', command: 'guard' }] }],
})

const MODEL_SWITCH_HOOKS = sparkHooks({
  PreModelSwitch: [{ hooks: [{ type: 'command', command: 'freeze' }] }],
  PostModelSwitch: [{ hooks: [{ type: 'command', command: 'after' }] }],
})

function todoReply(callId: string, status: 'pending' | 'completed', activeForm?: string) {
  return {
    calls: [
      {
        name: 'todo_write',
        callId,
        arguments: JSON.stringify({
          items: [
            {
              text: 'Write tests',
              status,
              ...(activeForm !== undefined && { activeForm }),
            },
          ],
        }),
      },
    ],
  }
}

interface HookRun {
  readonly command: string
  readonly payload: Record<string, unknown>
}

function setup(
  options: {
    readonly files?: Record<string, string>
    readonly extensionHooks?: readonly ExtensionHookDefinition[]
    readonly runHook?: (command: string, payload: Record<string, unknown>) => ShellResult
    readonly permissionSettings?: ModelApiHostDeps['permissionSettings']
    readonly isHooksEnabled?: () => boolean
    readonly isWorkspaceTrusted?: () => boolean
    readonly hooks?: readonly HookDefinition[]
    readonly paidSubagents?: boolean
    readonly paidWebSearch?: boolean
    readonly modelCapabilities?: ModelApiHostDeps['modelCapabilities']
    readonly compactionModel?: ModelApiHostDeps['compactionModel']
  } = {},
) {
  const api = fakeModelApi()
  const log = new FakeLogOutputChannel()
  const base = memoryToolIo(options.files ?? {}, ROOT)
  const hookRuns: HookRun[] = []
  base.runHook = (command, payload) => {
    const parsed = hookRecordSchema.parse(JSON.parse(payload))
    hookRuns.push({ command, payload: parsed })
    return Promise.resolve(options.runHook?.(command, parsed) ?? hookResult(''))
  }
  let clock = 1_000_000
  const host = new ModelApiHost({
    ...fakeModelApiHostDeps({
      client: fakeModelApiClient(api, log),
      workspaceRoot: ROOT,
      io: base,
      log,
    }),
    ...(options.modelCapabilities !== undefined && {
      modelCapabilities: options.modelCapabilities,
    }),
    contextIo: memoryContextIo(base.files),
    now: () => clock,
    getAccountId: () => Promise.resolve(FAKE_MODEL_API_ACCOUNT_ID),
    memory: memoryStoreOver(base.files, { platform: 'linux' }).store,
    ...(options.permissionSettings !== undefined && {
      permissionSettings: options.permissionSettings,
    }),
    loadExtensionHooks: () => Promise.resolve(options.extensionHooks ?? []),
    isHooksEnabled: options.isHooksEnabled ?? (() => true),
    isWorkspaceTrusted: options.isWorkspaceTrusted ?? (() => true),
    ...(options.paidWebSearch === true && { confirmContributorModel: () => Promise.resolve(true) }),
    loadHooks: () => Promise.resolve(options.hooks ?? []),
    ...(options.compactionModel !== undefined && { compactionModel: options.compactionModel }),
    ...((options.paidSubagents === true || options.paidWebSearch === true) && {
      isPaidFeatureOn: (feature) =>
        (feature === 'subagents' && options.paidSubagents === true) ||
        (feature === 'webSearch' && options.paidWebSearch === true),
      allowsPaidUse: (request) => Promise.resolve(request.feature !== 'webSearch' || request.quote),
    }),
  })
  return {
    api,
    host,
    log,
    hookRuns,
    io: base,
    advanceClock: (ms: number) => {
      clock += ms
    },
  }
}

async function startSession(
  t: ReturnType<typeof setup>,
  approvalMode: 'allowAll' | 'promptUnmatched' | 'onRequest' = 'allowAll',
): Promise<{ session: ModelApiSession; events: AgentEvent[]; turnDone: () => Promise<void> }> {
  return await startWatchedSession(t.host, ROOT, approvalMode)
}

async function runTodoWrites(
  t: ReturnType<typeof setup>,
  statuses: readonly ('pending' | 'completed')[],
  activeForm?: string,
) {
  const turn = await startSession(t)
  t.api.script(
    ...statuses.map((status, index) => todoReply(`t${String(index + 1)}`, status, activeForm)),
    { text: 'done' },
  )
  await turn.session.sendTurn([{ type: 'text', text: 'plan' }])
  await turn.turnDone()
  return turn
}

function toolFailure(events: readonly AgentEvent[], tool: string): string | undefined {
  return events.find(
    (event): event is Extract<AgentEvent, { type: 'itemCompleted' }> =>
      event.type === 'itemCompleted' && event.item.kind === 'toolCall' && event.item.tool === tool,
  )?.item.failureReason
}

function todoChanged(events: readonly AgentEvent[]): unknown[] {
  return events.filter((event) => event.type === 'todoChanged')
}

function turnFailed(events: readonly AgentEvent[]): string | undefined {
  return events.find(
    (event): event is Extract<AgentEvent, { type: 'turnCompleted' }> =>
      event.type === 'turnCompleted' && event.terminal !== 'completed',
  )?.reason
}

function skillFile(id: string, description: string, body: string): string {
  return `---\nname: ${id}\ndescription: ${description}\n---\n\n${body}\n`
}

describe('ModelApiSession extension hooks', () => {
  it('refuses hosted-tool dispatch when a narrowing excludes paid web search', async () => {
    const t = setup({
      paidWebSearch: true,
      // D86.4/U8: bind the captured selected-model tool and bound.
      modelCapabilities: metaHostedCapabilities,
      extensionHooks: sparkHooks({
        BeforeToolSelection: [{ hooks: [{ type: 'command', command: 'narrow' }] }],
      }),
      runHook: () => hookResult('{"allowedTools":["read_file"]}'),
    })
    const { session, events, turnDone } = await startSession(t)
    await session.setModel(M106_CAPTURED_META_MODEL)
    await session.sendTurn([{ type: 'text', text: 'search' }])
    await turnDone()
    expect(t.api.responseBodies()).toEqual([])
    expect(turnFailed(events)).toContain('web_search')
    await t.host.close()
  })
  it('keeps a refused completion pending', async () => {
    const t = setup({
      extensionHooks: sparkHooks({
        TaskCompleted: [{ hooks: [{ type: 'command', command: 'finish' }] }],
      }),
      runHook: () => hookResult('', { exitCode: 2, stderr: 'still open' }),
    })
    const { session, events } = await runTodoWrites(t, ['pending', 'completed'])
    expect(todoChanged(events)).toHaveLength(1)
    expect(session.snapshot().todos[0]?.status).toBe('pending')
    expect(toolFailure(events, 'todo_write')).toBeUndefined()
    expect(events).toContainEqual(
      expect.objectContaining({
        type: 'itemCompleted',
        item: expect.objectContaining({ failureReason: expect.stringContaining('still open') }),
      }),
    )
    await t.host.close()
  })
  it('refuses an expanded slash review before the model sees its instructions', async () => {
    const t = setup({
      extensionHooks: sparkHooks({
        UserPromptExpansion: [{ matcher: 'review', hooks: [{ type: 'command', command: 'veto' }] }],
      }),
      runHook: () => hookResult('', { exitCode: 2, stderr: 'review refused' }),
    })
    const { session, events, turnDone } = await startSession(t)
    await session.review(
      [{ type: 'text', text: 'Expanded review instructions.' }],
      '/review branch main',
    )
    await turnDone()
    expect(t.api.responseBodies()).toEqual([])
    expect(turnFailed(events)).toContain('review refused')
    expect(t.hookRuns[0]?.payload).toMatchObject({ trigger: 'slash', name: 'review' })
    await t.host.close()
  })
  it('observes the root rules once, with filenames and no contents', async () => {
    const t = setup({
      files: { 'AGENTS.md': 'PRIVATE RULE CONTENT' },
      extensionHooks: sparkHooks({
        InstructionsLoaded: [{ hooks: [{ type: 'command', command: 'rules' }] }],
      }),
    })
    const { session, turnDone } = await startSession(t)
    for (const text of ['first', 'second']) {
      t.api.script({ text: 'ok' })
      await session.sendTurn([{ type: 'text', text }])
      await turnDone()
    }
    expect(t.hookRuns).toHaveLength(1)
    expect(t.hookRuns[0]?.payload).toMatchObject({ path: 'AGENTS.md', reason: 'rules' })
    expect(JSON.stringify(t.hookRuns)).not.toContain('PRIVATE RULE CONTENT')
    await t.host.close()
  })

  it('keeps BeforeToolSelection shell admission on an edit then_run', async () => {
    const t = setup({
      extensionHooks: sparkHooks({
        BeforeToolSelection: [{ hooks: [{ type: 'command', command: 'narrow' }] }],
      }),
      runHook: () => hookResult(JSON.stringify({ allowedTools: ['write_file'] })),
    })
    const { session, turnDone } = await startSession(t)
    t.api.script(
      {
        calls: [
          {
            name: 'write_file',
            arguments: '{"path":"note.txt","content":"hi","then_run":"echo unsafe"}',
            callId: 'w1',
          },
        ],
      },
      { text: 'done' },
    )
    await session.sendTurn([{ type: 'text', text: 'write' }])
    await turnDone()
    expect(t.io.files.get('/ws/note.txt')).toBe('hi')
    expect(t.io.shellCalls).toEqual([])
    expect(JSON.stringify(t.api.responseBodies()[1])).toContain('Tools unavailable for this turn')
    await t.host.close()
  })

  it.each([1, 3])(
    'keeps an idle child inside its original consent, with no prompt hooks on hidden turns (%i keeps)',
    async (keepLimit) => {
      const first = Promise.withResolvers<boolean>()
      const second = Promise.withResolvers<boolean>()
      let idleRuns = 0
      const t = setup({
        paidSubagents: true,
        hooks: parseHookConfig(
          JSON.stringify({
            hooks: { UserPromptSubmit: [{ hooks: [{ type: 'command', command: 'submit' }] }] },
          }),
          'project',
          'linux',
        ).hooks,
        extensionHooks: sparkHooks({
          TeammateIdle: [{ hooks: [{ type: 'command', command: 'idle' }] }],
        }),
        runHook: (command) =>
          command === 'idle' && ++idleRuns <= keepLimit
            ? hookResult('', { exitCode: 2, stderr: 'another check' })
            : hookResult(''),
      })
      const { session, turnDone } = await startSession(t)
      try {
        t.api.script(
          {
            calls: [
              {
                name: 'subagent_spawn',
                arguments: '{"role":"worker","objective":"first"}',
                callId: 's1',
              },
              {
                name: 'subagent_spawn',
                arguments: '{"role":"worker","objective":"second"}',
                callId: 's2',
              },
            ],
          },
          { text: 'first done', hold: first.promise },
          { text: 'second done', hold: second.promise },
          { text: 'parent done' },
          ...Array.from({ length: keepLimit }, () => ({ text: 'checked again' })),
        )
        await session.sendTurn([{ type: 'text', text: 'delegate' }])
        await turnDone()
        first.resolve(true)
        await vi.waitFor(() => {
          expect(idleRuns).toBe(Math.min(keepLimit + 1, 3))
        })
        expect(t.api.responseBodies()).toHaveLength(4 + keepLimit)
        expect(t.hookRuns.filter((run) => run.command === 'submit')).toHaveLength(3)
        expect(t.hookRuns.find((run) => run.command === 'idle')?.payload).toMatchObject({
          siblings_running: 1,
        })
        expect(JSON.stringify(session.history())).not.toContain('another check')
        const childPrompts = session
          .snapshot()
          .children?.flatMap((child) =>
            child.session.transcript.flatMap(({ item }) =>
              item.kind === 'userMessage' ? [item.text] : [],
            ),
          )
        expect(childPrompts).toHaveLength(2)
        expect(childPrompts).toEqual(expect.arrayContaining(['first', 'second']))
      } finally {
        first.resolve(true)
        second.resolve(true)
        await t.host.close()
      }
    },
  )

  it('fires no extension hooks after workspace trust is withdrawn', async () => {
    let isTrusted = true
    const t = setup({
      isWorkspaceTrusted: () => isTrusted,
      extensionHooks: sparkHooks({
        PreModelSwitch: [{ hooks: [{ type: 'command', command: 'switch' }] }],
      }),
    })
    const { session } = await startSession(t)
    isTrusted = false
    await session.setModel('other')
    expect(t.hookRuns).toEqual([])
    await t.host.close()
  })
  it('runs TaskCreated with the bounded subject and description, and a refusal keeps the old list', async () => {
    const t = setup({
      extensionHooks: TASK_CREATION_HOOKS,
      runHook: () => hookResult('', { exitCode: 2, stderr: 'not yet' }),
    })
    const { events } = await runTodoWrites(t, ['pending'], 'Writing tests')
    expect(t.hookRuns).toHaveLength(1)
    expect(t.hookRuns[0]?.payload).toMatchObject({
      hook_event_name: 'TaskCreated',
      subject: 'Write tests',
      description: 'Writing tests',
    })
    expect(toolFailure(events, 'todo_write')).toBe('A hook refused the task “Write tests”: not yet')
    expect(todoChanged(events)).toEqual([])
  })

  it('applies the write when TaskCreated allows, and completes fire TaskCompleted', async () => {
    const t = setup({
      extensionHooks: sparkHooks({
        TaskCreated: [{ hooks: [{ type: 'command', command: 'guard' }] }],
        TaskCompleted: [{ hooks: [{ type: 'command', command: 'done-guard' }] }],
      }),
    })
    const { events } = await runTodoWrites(t, ['pending', 'completed'])
    expect(todoChanged(events)).toHaveLength(2)
    expect(t.hookRuns.map((run) => run.command)).toEqual(['guard', 'done-guard'])
    expect(t.hookRuns[1]?.payload).toMatchObject({
      hook_event_name: 'TaskCompleted',
      subject: 'Write tests',
    })
  })

  it('ends the turn after eight task refusals without admitting the refused task', async () => {
    const t = setup({
      extensionHooks: TASK_CREATION_HOOKS,
      runHook: () => hookResult('', { exitCode: 2, stderr: 'not yet' }),
    })
    const { session, events, turnDone } = await startSession(t)
    for (let index = 0; index < 8; index += 1) {
      t.api.script(todoReply(`t${String(index)}`, 'pending'))
    }
    await session.sendTurn([{ type: 'text', text: 'plan' }])
    await turnDone()
    expect(t.hookRuns).toHaveLength(8)
    expect(todoChanged(events)).toEqual([])
    expect(turnFailed(events)).toContain('not yet')
    expect(t.api.responseBodies()).toHaveLength(8)
    expect(
      logLines(t.log).some((line) => line.includes('task continuation limit after 8 refusals')),
    ).toBe(true)
  })

  it('refuses a skill expansion with a visible reason before any model request', async () => {
    const t = setup({
      files: {
        '.agents/skills/shout/SKILL.md': skillFile('shout', 'Repeat in caps', 'UPPER CASE.'),
      },
      extensionHooks: sparkHooks({
        UserPromptExpansion: [{ hooks: [{ type: 'command', command: 'veto' }] }],
      }),
      runHook: (command, payload) => {
        expect(command).toBe('veto')
        expect(payload).toMatchObject({ hook_event_name: 'UserPromptExpansion', name: 'shout' })
        return hookResult(
          JSON.stringify({
            decision: { behavior: 'deny', message: 'not now' },
            additionalContext: 'DENIED CONTEXT',
          }),
        )
      },
    })
    const { session, events, turnDone } = await startSession(t)
    await session.sendTurn([{ type: 'skill', selector: 'shout', arguments: 'good morning' }])
    await turnDone()
    expect(t.api.responseBodies()).toEqual([])
    expect(turnFailed(events)).toBe('A hook refused /shout: not now')
    // A refused expansion ends like a blocked prompt (M51): the invocation
    // stays visible in History, but never reaches a model request.
    expect(session.history().items).toMatchObject([
      { kind: 'userMessage', text: '/shout good morning' },
    ])
    t.api.script({ text: 'ok' })
    await session.sendTurn([{ type: 'text', text: 'next' }])
    await turnDone()
    const second = JSON.stringify(t.api.responseBodies()[0])
    expect(second).toContain('next')
    expect(second).not.toContain('/shout')
    expect(second).not.toContain('UPPER CASE.')
    expect(second).not.toContain('DENIED CONTEXT')
  })

  it('expands a skill when its hook allows', async () => {
    const t = setup({
      files: {
        '.agents/skills/shout/SKILL.md': skillFile('shout', 'Repeat in caps', 'UPPER CASE.'),
      },
      extensionHooks: sparkHooks({
        UserPromptExpansion: [{ matcher: 'shout', hooks: [{ type: 'command', command: 'veto' }] }],
      }),
    })
    const { session, turnDone } = await startSession(t)
    t.api.script({ text: 'ok' })
    await session.sendTurn([{ type: 'skill', selector: 'shout', arguments: 'good morning' }])
    await turnDone()
    expect(t.hookRuns).toHaveLength(1)
    const input = z.array(hookRecordSchema).parse(t.api.responseBodies()[0]?.['input'])
    expect(input[0]).toMatchObject({ type: 'message', role: 'user' })
  })

  it('fires InstructionsLoaded once for a touched path with new rules', async () => {
    const t = setup({
      files: { 'src/AGENTS.md': 'Use tabs.', 'src/app.ts': 'export {}' },
      extensionHooks: sparkHooks({
        InstructionsLoaded: [{ matcher: 'src/**', hooks: [{ type: 'command', command: 'note' }] }],
      }),
    })
    const { session, turnDone } = await startSession(t)
    t.api.script(
      { calls: [{ name: 'read_file', arguments: '{"path":"src/app.ts"}', callId: 'r1' }] },
      { calls: [{ name: 'read_file', arguments: '{"path":"src/app.ts"}', callId: 'r2' }] },
      { text: 'done' },
    )
    await session.sendTurn([{ type: 'text', text: 'look' }])
    await turnDone()
    expect(t.hookRuns).toHaveLength(1)
    expect(t.hookRuns[0]?.payload).toMatchObject({ path: 'src/AGENTS.md', reason: 'touched-path' })
  })

  it('fires PermissionDenied when a forbid rule refuses, and the model still gets the refusal', async () => {
    const t = setup({
      extensionHooks: sparkHooks({
        PermissionDenied: [{ hooks: [{ type: 'command', command: 'witness' }] }],
      }),
      permissionSettings: () => ({
        commandRules: [{ pattern: ['npm', 'test'], decision: 'forbid', match: ['npm test'] }],
        profiles: {},
        profile: '',
        repositoryRules: {},
      }),
    })
    const { session, events, turnDone } = await startSession(t)
    t.api.script(
      { calls: [{ name: 'bash', arguments: '{"command":"npm test"}', callId: 'sh1' }] },
      { text: 'done' },
    )
    await session.sendTurn([{ type: 'text', text: 'test' }])
    await turnDone()
    expect(t.hookRuns).toHaveLength(1)
    expect(t.hookRuns[0]?.payload).toMatchObject({
      hook_event_name: 'PermissionDenied',
      tool_name: 'bash',
    })
    expect(toolFailure(events, 'bash')).toContain('bash')
  })

  it('narrows tools at admission while the declared list stays whole', async () => {
    const t = setup({
      files: { 'notes.txt': 'hi' },
      extensionHooks: sparkHooks({
        BeforeToolSelection: [{ hooks: [{ type: 'command', command: 'narrow' }] }],
      }),
      runHook: (command, payload) => {
        expect(command).toBe('narrow')
        expect(payload).toMatchObject({ hook_event_name: 'BeforeToolSelection' })
        return hookResult(JSON.stringify({ allowedTools: ['read_file'] }))
      },
    })
    const { session, events, turnDone } = await startSession(t)
    t.api.script(
      { calls: [{ name: 'bash', arguments: '{"command":"echo hi"}', callId: 'sh1' }] },
      { calls: [{ name: 'read_file', arguments: '{"path":"notes.txt"}', callId: 'r1' }] },
      { text: 'done' },
    )
    await session.sendTurn([{ type: 'text', text: 'work' }])
    await turnDone()
    expect(toolFailure(events, 'bash')).toBe('bash: a hook removed this tool for this turn')
    // The declared list still offers bash on the next request (SoL-Pi rule 1).
    const bodies = t.api.responseBodies()
    expect(bodies.length).toBeGreaterThan(1)
    for (const body of bodies) {
      const tools = z.array(hookRecordSchema).parse(body['tools'])
      expect(
        tools.map((tool) => (tool['type'] === 'function' ? tool['name'] : tool['type'])),
      ).toContain('bash')
    }
  })

  it('leaves compaction alone: the tool-less summary fires no extension hook', async () => {
    const t = setup({
      compactionModel: () => ({
        contextTokens: undefined,
        capabilities: { toolCalling: true },
        quirks: { keepToolsWithHistory: false, reasoningReplay: 'same-model' },
      }),
      extensionHooks: sparkHooks({
        BeforeToolSelection: [{ hooks: [{ type: 'command', command: 'narrow' }] }],
        AfterAgentThought: [{ hooks: [{ type: 'command', command: 'think' }] }],
      }),
      runHook: () => hookResult(JSON.stringify({ allowedTools: ['read_file'] })),
    })
    const { session, turnDone } = await startSession(t)
    t.api.script({ text: 'First reply.' })
    await session.sendTurn([{ type: 'text', text: 'First.' }])
    await turnDone()
    const turnRuns = t.hookRuns.length
    expect(turnRuns).toBeGreaterThan(0)
    t.api.script({ text: 'THE SUMMARY' })
    await expect(session.compact()).resolves.toEqual({ status: 'accepted', reason: undefined })
    expect(t.hookRuns).toHaveLength(turnRuns)
  })

  it('fires FileChanged for an external edit, debounced per path', async () => {
    const t = setup({
      files: { 'notes.txt': 'external' },
      extensionHooks: sparkHooks({
        FileChanged: [{ matcher: '**', hooks: [{ type: 'command', command: 'watch' }] }],
      }),
    })
    const { session } = await startSession(t)
    session.noteExternalEdit({ relative: 'notes.txt', absolute: '/ws/notes.txt' })
    session.noteExternalEdit({ relative: 'notes.txt', absolute: '/ws/notes.txt' })
    await vi.waitFor(() => {
      expect(t.hookRuns).toHaveLength(1)
    })
    expect(t.hookRuns[0]?.payload).toMatchObject({ path: 'notes.txt', reason: 'external-edit' })
    t.advanceClock(1000)
    session.noteExternalEdit({ relative: 'notes.txt', absolute: '/ws/notes.txt' })
    await vi.waitFor(() => {
      expect(t.hookRuns).toHaveLength(2)
    })
  })

  it('refuses a model switch and keeps the session on its model', async () => {
    const t = setup({
      extensionHooks: MODEL_SWITCH_HOOKS,
      runHook: (command, payload) => {
        if (command === 'freeze') {
          expect(payload).toMatchObject({ old_model: 'muse-spark-1.3', new_model: 'other' })
          return hookResult('', { exitCode: 2, stderr: 'frozen' })
        }
        return hookResult('')
      },
    })
    const { session, events } = await startSession(t)
    await session.setModel('other')
    expect(session.snapshot().modelId).toBe('muse-spark-1.3')
    expect(t.hookRuns.map((run) => run.command)).toEqual(['freeze'])
    expect(
      events.some(
        (event) =>
          event.type === 'backendNotice' &&
          event.text === 'A hook kept the model on muse-spark-1.3: frozen',
      ),
    ).toBe(true)
  })

  it('runs PostModelSwitch after a switch its hook allows', async () => {
    const t = setup({
      extensionHooks: MODEL_SWITCH_HOOKS,
    })
    const { session } = await startSession(t)
    await session.setModel('other')
    expect(session.snapshot().modelId).toBe('other')
    expect(t.hookRuns.map((run) => run.command)).toEqual(['freeze', 'after'])
  })

  it('fires AfterAgentThought for a finished reasoning block', async () => {
    const t = setup({
      files: { 'notes.txt': 'hi' },
      extensionHooks: sparkHooks({
        AfterAgentThought: [{ hooks: [{ type: 'command', command: 'think' }] }],
      }),
      runHook: (_command, payload) => {
        expect(payload).toMatchObject({
          hook_event_name: 'AfterAgentThought',
          thought: 'thinking hard',
        })
        return hookResult(JSON.stringify({ additionalContext: 'remember this' }))
      },
    })
    const { session, turnDone } = await startSession(t)
    t.api.script(
      {
        reasoning: 'thinking hard',
        text: 'working',
        calls: [{ name: 'read_file', arguments: '{"path":"notes.txt"}', callId: 'r1' }],
      },
      { text: 'hi' },
    )
    await session.sendTurn([{ type: 'text', text: 'think' }])
    await turnDone()
    expect(t.hookRuns.map((run) => run.command)).toEqual(['think'])
    // The thought's context joins the turn after the response that produced it,
    // exactly once: hook context lives in the replay, never in History.
    const body = JSON.stringify(t.api.responseBodies()[1])
    expect(body.indexOf('remember this')).toBeGreaterThan(body.indexOf('working'))
    expect(body.split('remember this')).toHaveLength(2)
    expect(JSON.stringify(session.history())).not.toContain('remember this')
    expect(session.snapshot().hookTokensAdded).toBeGreaterThan(0)
  })

  it('runs no extension hook with the opt-in off', async () => {
    const t = setup({
      extensionHooks: TASK_CREATION_HOOKS,
      isHooksEnabled: () => false,
    })
    const { session, events, turnDone } = await startSession(t)
    t.api.script(todoReply('t1', 'pending'), { text: 'done' })
    await session.sendTurn([{ type: 'text', text: 'plan' }])
    await turnDone()
    expect(t.hookRuns).toEqual([])
    expect(todoChanged(events)).toHaveLength(1)
  })
})
