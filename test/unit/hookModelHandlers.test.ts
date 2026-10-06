import { fakeModelApiHostDeps } from './helpers/modelApiHostDeps'
// M91 lane H: the `prompt` and `agent` hook handlers on the Model API
// (PLAN.md D70). A paid use under D30 and D48: the kill switch, the price
// check and the paid-use popup all run before any model request, and the
// run is tallied on the hookModels line. Its answer parses like a command's:
// it can only refuse, narrow or add context — never grant, never widen.

import { describe, expect, it, vi } from 'vitest'
import { ModelApiHost, type ModelApiHostDeps } from '../../src/core/backends/modelapi/ModelApiHost'
import { parseHookAnswer, type HookDefinition } from '../../src/core/backends/modelapi/hooks'
import {
  runModelHandler,
  runTypedHandler,
  type HookModelPolicy,
  type HookModelTurnRunner,
} from '../../src/core/backends/modelapi/hookHandlers'
import type { PaidFeature } from '../../src/shared/constants'
import { UI_TEXT } from '../../src/shared/constants'
import { fakeModelApi, fakeModelApiClient, type ScriptedReply } from './helpers/fakeModelApi'
import { FakeLogOutputChannel } from './helpers/fakes'
import { memoryToolIo } from './helpers/fakeToolIo'
import { watchSessionTurns } from './helpers/sessionTurns'

const ROOT = '/ws'
const HOOK_MARK = 'You are a hook of the Muse Spark coding agent'
const MODEL_ID = 'muse-spark-1.3'
const PAYLOAD = JSON.stringify({ hook_event_name: 'PreToolUse', cwd: '/ws' })

function policy(overrides: Partial<HookModelPolicy> = {}): HookModelPolicy {
  return {
    isHookModelsOn: () => true,
    allowsHookModelUse: () => Promise.resolve(true),
    noteHookModelRun: () => undefined,
    modelId: MODEL_ID,
    ...overrides,
  }
}

function runner(text = '{}'): HookModelTurnRunner {
  return () =>
    Promise.resolve({
      text,
      usage: { inputTokens: 100, outputTokens: 20, cachedTokens: 10 },
    })
}

function config(kind: 'prompt' | 'agent' = 'prompt') {
  return {
    type: kind,
    event: 'PreToolUse',
    source: 'user' as const,
    modelPrompt: 'Is this safe?',
  }
}

const parse = (event: string, exit: number | null, stdout: string, stderr: string) =>
  parseHookAnswer(
    event === 'PermissionRequest' ? 'PermissionRequest' : 'PreToolUse',
    exit,
    stdout,
    stderr,
  )

function hook(): HookDefinition {
  return {
    event: 'PreToolUse',
    source: 'user',
    type: 'prompt',
    command: '',
    modelPrompt: 'Is this safe?',
    timeoutSeconds: 10,
    matcher: { kind: 'exact', names: new Set(['read_file']) },
    isAsync: false,
  }
}

function setupHost(isAllowed: boolean, overrides: Partial<ModelApiHostDeps> = {}) {
  const api = fakeModelApi()
  const log = new FakeLogOutputChannel()
  const io = memoryToolIo({ 'notes.txt': 'hello' }, ROOT)
  const paidPopups: { readonly feature: PaidFeature; readonly requestsSeen: number }[] = []
  const paidRuns: PaidFeature[] = []
  const settled: { readonly modelId: string; readonly usage: object }[] = []
  const host = new ModelApiHost({
    ...fakeModelApiHostDeps({ client: fakeModelApiClient(api, log), workspaceRoot: ROOT, io, log }),
    isPaidFeatureOn: (feature) => feature === 'hookModels',
    notePaidUse: (feature, units) => {
      for (let count = 0; count < units; count += 1) paidRuns.push(feature)
    },
    allowsPaidUse: (request) => {
      paidPopups.push({ feature: request.feature, requestsSeen: api.requests.length })
      return Promise.resolve(isAllowed)
    },
    noteHookModelUsage: (modelId, usage) => {
      settled.push({ modelId, usage: { ...usage } })
    },
    loadHooks: () => Promise.resolve([hook()]),
    isHooksEnabled: () => true,
    ...overrides,
  })
  return { api, host, paidPopups, paidRuns, settled }
}

const throwing: HookModelTurnRunner = () => {
  return Promise.reject(new Error('down'))
}

const run = async (text: string, event = 'PreToolUse') =>
  await runModelHandler(
    { ...config(), event },
    PAYLOAD,
    runner(text),
    policy(),
    new AbortController().signal,
    vi.fn(),
    parse,
  )

const MAIN_READ_REPLY: ScriptedReply = {
  calls: [{ name: 'read_file', arguments: '{"path":"notes.txt"}', callId: 'c1' }],
}
const AGENT_HOOK_CONFIG: Partial<ModelApiHostDeps> = {
  loadHooks: () => Promise.resolve([{ ...hook(), type: 'agent' }]),
}

async function finishRead(t: ReturnType<typeof setupHost>, ...scripts: readonly ScriptedReply[]) {
  const session = await t.host.startSession({
    workspaceRoot: ROOT,
    modelId: MODEL_ID,
    approvalMode: 'allowAll',
  })
  const watched = watchSessionTurns(session)
  t.api.script(...scripts)
  await session.sendTurn([{ type: 'text', text: 'read the notes' }])
  await watched.turnDone()
  return watched
}

describe('prompt/agent gate and consent (M91 D70, D48)', () => {
  it('rechecks the kill switch after consent', async () => {
    let isOn = true
    const turn = vi.fn(runner())
    expect(
      await runModelHandler(
        config(),
        PAYLOAD,
        turn,
        policy({
          isHookModelsOn: () => isOn,
          allowsHookModelUse: () => {
            isOn = false
            return Promise.resolve(true)
          },
        }),
        new AbortController().signal,
        vi.fn(),
        parse,
      ),
    ).toMatchObject({ status: 'blocked' })
    expect(turn).not.toHaveBeenCalled()
  })
  it('refuses with the paid feature off, before anything else', async () => {
    const allowsHookModelUse = vi.fn()
    const runTurn = vi.fn(runner())
    const warn = vi.fn()
    const answer = await runModelHandler(
      config(),
      PAYLOAD,
      runTurn,
      policy({ isHookModelsOn: () => false, allowsHookModelUse }),
      new AbortController().signal,
      warn,
      parse,
    )
    expect(answer).toMatchObject({ status: 'blocked', reason: UI_TEXT.hookModelPaidOff })
    expect(warn).toHaveBeenCalledWith(UI_TEXT.hookModelPaidOff)
    expect(allowsHookModelUse).not.toHaveBeenCalled()
    expect(runTurn).not.toHaveBeenCalled()
  })

  it('refuses a model with no verified price, before the popup', async () => {
    const allowsHookModelUse = vi.fn()
    const answer = await runModelHandler(
      config(),
      PAYLOAD,
      vi.fn(runner()),
      policy({ modelId: 'unpriced-model', allowsHookModelUse }),
      new AbortController().signal,
      vi.fn(),
      parse,
    )
    expect(answer.status).toBe('blocked')
    expect(allowsHookModelUse).not.toHaveBeenCalled()
  })

  it('asks the paid-use popup before any model request, and stops on deny', async () => {
    const order: string[] = []
    const runTurn: HookModelTurnRunner = vi.fn(() => {
      order.push('request')
      return Promise.resolve({
        text: '{}',
        usage: { inputTokens: 1, outputTokens: 1, cachedTokens: 0 },
      })
    })
    const noteHookModelRun = vi.fn()
    const denied = await runModelHandler(
      config(),
      PAYLOAD,
      runTurn,
      policy({
        allowsHookModelUse: () => {
          order.push('popup')
          return Promise.resolve(false)
        },
        noteHookModelRun,
      }),
      new AbortController().signal,
      vi.fn(),
      parse,
    )
    expect(denied.status).toBe('failed')
    expect(order).toEqual(['popup'])
    expect(noteHookModelRun).not.toHaveBeenCalled()

    const allowed = await runModelHandler(
      config('agent'),
      PAYLOAD,
      runTurn,
      policy({ allowsHookModelUse: () => Promise.resolve(true), noteHookModelRun }),
      new AbortController().signal,
      vi.fn(),
      parse,
    )
    expect(allowed.status).toBe('completed')
    expect(order).toEqual(['popup', 'request'])
    expect(noteHookModelRun).toHaveBeenCalledTimes(1)
  })

  it('tallies the run and settles its reported use', async () => {
    const noteHookModelRun = vi.fn()
    const noteHookModelUsage = vi.fn()
    await runModelHandler(
      config(),
      PAYLOAD,
      runner(),
      policy({ noteHookModelRun, noteHookModelUsage }),
      new AbortController().signal,
      vi.fn(),
      parse,
    )
    expect(noteHookModelRun).toHaveBeenCalledTimes(1)
    expect(noteHookModelUsage).toHaveBeenCalledWith(MODEL_ID, {
      inputTokens: 100,
      outputTokens: 20,
      cachedTokens: 10,
    })
  })

  it('fails a broken model call, and rethrows on abort', async () => {
    const warn = vi.fn()

    expect(
      await runModelHandler(
        config(),
        PAYLOAD,
        throwing,
        policy(),
        new AbortController().signal,
        warn,
        parse,
      ),
    ).toMatchObject({ status: 'failed' })

    const controller = new AbortController()
    controller.abort()
    await expect(
      runModelHandler(config(), PAYLOAD, throwing, policy(), controller.signal, warn, parse),
    ).rejects.toMatchObject({ name: 'AbortError' })
  })
})

describe('prompt/agent answers cannot widen (M91 D70)', () => {
  it('parses the model text like a command answer', async () => {
    // A grant is rejected by the command answer schema.
    expect(await run('{"decision":"allow"}')).toMatchObject({ status: 'failed' })
    expect(await run('{}')).toMatchObject({ status: 'completed' })
    // A block refuses, with its reason.
    expect(await run('{"decision":"block","reason":"no"}')).toMatchObject({
      status: 'blocked',
      reason: 'no',
    })
    // Context narrows or adds, never grants.
    expect(
      await run(
        '{"hookSpecificOutput":{"hookEventName":"PreToolUse","additionalContext":"careful"}}',
      ),
    ).toMatchObject({ status: 'completed', context: 'careful' })
    // An allow without the command's updated input fails, like a command's.
    expect(await run('{"permissionDecision":"allow"}', 'PermissionRequest')).toMatchObject({
      status: 'failed',
    })
  })

  it('skips prompt/agent hooks without a model runner or policy', async () => {
    const warn = vi.fn()
    const signal = new AbortController().signal
    expect(
      await runTypedHandler(
        { type: 'prompt', event: 'PreToolUse', source: 'user', modelPrompt: 'x' },
        PAYLOAD,
        { httpAllowlist: () => [], isNetworkAllowed: () => true },
        signal,
        warn,
        parse,
      ),
    ).toBeUndefined()
    expect(warn).toHaveBeenCalledWith('PreToolUse: prompt hook runner is unavailable')
  })
})

describe('prompt on the Model API backend (M91 D70, D48)', () => {
  it('reserves the shared daily budget before a request, and settles actual cost', async () => {
    const check = vi.fn()
    const settle = vi.fn<(costUsd: number, isUnknown: boolean) => Promise<void>>(() =>
      Promise.resolve(),
    )
    const reserve = vi.fn(() => Promise.resolve({ check, settle }))
    const t = setupHost(true, { hookModelDailyBudget: { capUsd: () => 2, reserve } })
    await finishRead(t, MAIN_READ_REPLY, { text: '{}' }, { text: 'done' })
    expect(reserve).toHaveBeenCalledTimes(1)
    expect(check).toHaveBeenCalled()
    expect(settle).toHaveBeenCalledWith(expect.any(Number), false)
    expect(settle.mock.calls[0]?.[0]).toBeCloseTo(0.00004375)
  })

  it('sends no hook request when daily-budget admission refuses it', async () => {
    const t = setupHost(true, {
      hookModelDailyBudget: {
        capUsd: () => 1,
        reserve: () => Promise.reject(new Error('daily budget exhausted')),
      },
    })
    await finishRead(t, MAIN_READ_REPLY, { text: 'done' })
    expect(
      t.api
        .responseBodies()
        .some(
          (body) =>
            typeof body['instructions'] === 'string' && body['instructions'].includes(HOOK_MARK),
        ),
    ).toBe(false)
  })

  it('agent helpers expose only read tools, fire no hooks, and settle once', async () => {
    const t = setupHost(true, AGENT_HOOK_CONFIG)
    await finishRead(
      t,
      MAIN_READ_REPLY,
      { calls: [{ name: 'read_file', arguments: '{"path":"notes.txt"}', callId: 'h1' }] },
      { text: '{}' },
      { text: 'done' },
    )
    const helpers = t.api
      .responseBodies()
      .filter(
        (body) =>
          typeof body['instructions'] === 'string' && body['instructions'].includes(HOOK_MARK),
      )
    expect(helpers).toHaveLength(2)
    expect(helpers[0]?.['tools']).toMatchObject([
      { name: 'read_file' },
      { name: 'search' },
      { name: 'list_files' },
    ])
    expect(helpers[0]?.['tools']).toHaveLength(3)
    expect(t.paidPopups).toHaveLength(1)
    expect(t.settled).toEqual([
      { modelId: MODEL_ID, usage: { inputTokens: 20, outputTokens: 10, cachedTokens: 0 } },
    ])
  })

  it('refuses a fabricated write tool in a hidden agent turn', async () => {
    const t = setupHost(true, AGENT_HOOK_CONFIG)
    await finishRead(
      t,
      MAIN_READ_REPLY,
      {
        calls: [
          { name: 'write_file', arguments: '{"path":"notes.txt","content":"wrong"}', callId: 'h1' },
        ],
      },
      { text: 'done' },
    )
    expect(t.settled).toEqual([])
    expect(t.api.responseBodies()).toHaveLength(3)
  })

  it('asks the paid popup before any hook request, runs once, and settles its use', async () => {
    const t = setupHost(true)
    const watched = await finishRead(
      t,
      MAIN_READ_REPLY,
      {
        text: '{"hookSpecificOutput":{"hookEventName":"PreToolUse","additionalContext":"hook says hi"}}',
      },
      { text: 'done' },
    )
    // The popup asked once, before the hook's request went out (request 1
    // was the turn's own), and the run was tallied and settled apart.
    expect(t.paidPopups).toEqual([{ feature: 'hookModels', requestsSeen: 1 }])
    expect(t.paidRuns).toEqual(['hookModels'])
    expect(t.settled).toEqual([
      { modelId: MODEL_ID, usage: { inputTokens: 10, outputTokens: 5, cachedTokens: 0 } },
    ])
    const bodies = t.api.responseBodies()
    expect(bodies.filter((body) => JSON.stringify(body).includes(HOOK_MARK))).toHaveLength(1)
    // The paid run is loud: a hook_model row names the kind and the event.
    const rows = watched.events.filter(
      (event) => event.type === 'itemStarted' && event.item.tool === 'hook_model',
    )
    expect(rows).toHaveLength(1)
    const row = rows[0]
    if (row?.type !== 'itemStarted') throw new Error('Expected a paid hook row')
    expect(row.item.args).toContain('PreToolUse')
  })

  it('sends no hook request when the popup denies it', async () => {
    const t = setupHost(false)
    const watched = await finishRead(t, MAIN_READ_REPLY, { text: 'done' })
    expect(t.paidPopups).toEqual([{ feature: 'hookModels', requestsSeen: 1 }])
    expect(t.paidRuns).toEqual([])
    expect(t.settled).toEqual([])
    expect(t.api.responseBodies().some((body) => JSON.stringify(body).includes(HOOK_MARK))).toBe(
      false,
    )
    expect(
      watched.events.some(
        (event) => event.type === 'itemStarted' && event.item.tool === 'hook_model',
      ),
    ).toBe(false)
  })
})
