import { Usd } from '../../src/shared/usd'
// M106 L2: synthetic loop faults use the existing fake wire; no new provider shapes.
import { Buffer } from 'node:buffer'
import type { AgentEvent } from '../../src/shared/agentEvents'
import { describe, expect, it, vi } from 'vitest'
import { parseHookConfig } from '../../src/core/backends/modelapi/hooks'
import { parseSparkHooksConfig } from '../../src/core/backends/modelapi/extensionHooks'
import { hookResult } from './helpers/fakeToolIo'
import { memorySessionStore } from './helpers/fakeSessionStore'
import { ModelApiClient } from '../../src/core/backends/modelapi/client'
import { ModelApiHost, type ModelApiHostDeps } from '../../src/core/backends/modelapi/ModelApiHost'
import {
  MODEL_API_MODEL_TEXT,
  MODEL_API_RECOMMENDED_MAX_OUTPUT_TOKENS,
  UI_TEXT,
} from '../../src/shared/constants'
import { FakeLogOutputChannel } from './helpers/fakes'
import {
  fakeModelApi,
  fakeModelApiClientSettings,
  TINY_PNG_BASE64,
  type ScriptedReply,
} from './helpers/fakeModelApi'
import { memoryToolIo } from './helpers/fakeToolIo'
import { fakeModelApiHostDeps } from './helpers/modelApiHostDeps'
import { memoryContextIo } from './helpers/fakeContextIo'
import { startWatchedSession } from './helpers/sessionTurns'

const ROOT = '/ws'
const read = (id: number) => ({
  name: 'read_file',
  arguments: JSON.stringify({ path: `${String(id)}.txt` }),
  callId: `c${String(id)}`,
})

async function setup(overrides: Partial<ModelApiHostDeps> = {}) {
  const log = new FakeLogOutputChannel()
  const api = fakeModelApi()
  const rawBodies: string[] = []
  const client = new ModelApiClient({
    ...fakeModelApiClientSettings(log),
    fetch: (input, init) => {
      if (
        typeof init?.body === 'string' &&
        (input instanceof Request ? input.url : String(input)).endsWith('/responses')
      )
        rawBodies.push(init.body)
      return api.fetch(input, init)
    },
  })
  const io = memoryToolIo(
    { '0.txt': 'first', '1.txt': 'second', '2.txt': 'third', '3.txt': 'fourth' },
    ROOT,
  )
  const host = new ModelApiHost({
    ...fakeModelApiHostDeps({ client, workspaceRoot: ROOT, io, log }),
    ...overrides,
  })
  const watched = await startWatchedSession(host, ROOT, 'allowAll')
  return { api, io, host, log, rawBodies, ...watched }
}

async function setupSkillSteering() {
  const hooks = parseSparkHooksConfig(
    '{"hooks":{"UserPromptExpansion":[{"hooks":[{"type":"command","command":"veto"}]}]}}',
    'project',
    'linux',
  ).hooks
  return await setup({
    contextIo: memoryContextIo(
      new Map([
        [
          '/ws/.agents/skills/shout/SKILL.md',
          '---\nname: shout\ndescription: Repeat in caps\n---\nUPPER CASE.',
        ],
      ]),
    ),
    loadExtensionHooks: () => Promise.resolve(hooks),
    isHooksEnabled: () => true,
  })
}

async function beginHeldReply(
  rig: Awaited<ReturnType<typeof setup>>,
  ...following: readonly ScriptedReply[]
) {
  const held = Promise.withResolvers<undefined>()
  const requested = Promise.withResolvers<undefined>()
  rig.api.script(
    {
      text: 'First reply.',
      hold: held.promise,
      onRequest() {
        requested.resolve(undefined)
      },
    },
    ...following,
  )
  const turn = await rig.session.sendTurn([{ type: 'text', text: 'Work.' }])
  await requested.promise
  return {
    turnId: turn.turnId,
    release: () => {
      held.resolve(undefined)
    },
  }
}

async function send(rig: Awaited<ReturnType<typeof setup>>) {
  const done = rig.turnDone()
  await rig.session.sendTurn([{ type: 'text', text: 'Work.' }])
  await done
}

async function attemptOverwrite(rig: Awaited<ReturnType<typeof setup>>) {
  rig.api.script(
    {
      calls: [
        {
          name: 'write_file',
          arguments: '{"path":"0.txt","content":"OVERWRITTEN"}',
          callId: 'write',
        },
      ],
    },
    { text: 'Write answered.' },
  )
  await send(rig)
  return JSON.stringify(rig.api.responseBodies().at(-1)?.['input'])
}

function repeatReplies(onRequest?: (id: number) => void) {
  return Array.from({ length: 4 }, (_, id) => ({
    calls: [{ ...read(0), callId: `repeat${String(id)}` }],
    ...(onRequest !== undefined && {
      onRequest: () => {
        onRequest(id)
      },
    }),
  }))
}

function holdTextReads(rig: Awaited<ReturnType<typeof setup>>, count: number) {
  const paths = Array.from({ length: count }, (_, id) => `/ws/${String(id)}.txt`)
  const gates = paths.map(() => Promise.withResolvers<undefined>())
  const entered: string[] = []
  const signals: (AbortSignal | undefined)[] = []
  const original = rig.io.readFile
  rig.io.readFile = async (absolute, expected, signal) => {
    const index = paths.indexOf(absolute.replaceAll('\\', '/'))
    if (index !== -1) {
      entered.push(absolute)
      signals.push(signal)
      await gates[index]?.promise
    }
    return await original(absolute, expected, signal)
  }
  return { gates, entered, signals }
}

const notices = (rig: Awaited<ReturnType<typeof setup>>) =>
  rig.events.filter((event) => event.type === 'backendNotice').map((event) => event.text)

// The fake alone generates these direct item IDs; all other raw bytes stay intact.
function normalizeBodies(raw: readonly string[]): string[] {
  const ids = new Map<string, string>()
  return raw.map((body) =>
    body.replaceAll(/"id":"((?:fc|rs|msg|ws)_[0-9]+)"/g, (_match: string, id: string) => {
      const replacement = ids.get(id) ?? `item${String(ids.size)}`
      ids.set(id, replacement)
      return `"id":"${replacement}"`
    }),
  )
}

describe('M106 loop guarantees', () => {
  it('transfers both steering messages before a throwing reassignment listener and finishes queued work', async () => {
    const rig = await setup({ outputContinuation: () => false })
    const held = Promise.withResolvers<undefined>()
    const requested = Promise.withResolvers<undefined>()
    rig.api.script(
      {
        text: 'Partial.',
        incomplete: { reason: 'max_output_tokens' },
        hold: held.promise,
        onRequest: () => {
          requested.resolve(undefined)
        },
      },
      { text: 'One.' },
      { text: 'Two.' },
      { text: 'Queued.' },
    )
    const submitted = await rig.session.sendTurn([{ type: 'text', text: 'Work.' }])
    await requested.promise
    const steering = await Promise.all(
      ['STEER_ONE', 'STEER_TWO'].map((text) =>
        rig.session.steer(submitted.turnId, [{ type: 'text', text }]),
      ),
    )
    const queued = await rig.session.sendTurn([{ type: 'text', text: 'QUEUED_WORK' }])
    let ownership: unknown
    rig.session.onEvent((event) => {
      if (ownership !== undefined || event.type !== 'userMessageTurnChanged') return
      ownership = structuredClone(Reflect.get(rig.session, 'queuedTurns'))
      throw new Error('private callback detail')
    })
    const later = vi.fn()
    rig.session.onEvent(later)
    held.resolve(undefined)
    await rig.session.settled()
    expect(ownership).toEqual(
      expect.arrayContaining(
        steering.map(({ userMessageId }): unknown => expect.objectContaining({ userMessageId })),
      ),
    )
    expect(rig.api.responseBodies()).toHaveLength(4)
    for (const [index, text] of ['STEER_ONE', 'STEER_TWO', 'QUEUED_WORK'].entries()) {
      expect(JSON.stringify(rig.api.responseBodies()[index + 1]?.['input'])).toContain(text)
    }
    expect(
      rig.session
        .history()
        .items.filter((item) =>
          steering.some(({ userMessageId }) => item.itemId === userMessageId),
        ),
    ).toHaveLength(2)
    expect(rig.session.record()).toMatchObject({ status: 'idle' })
    expect(rig.events.filter((event) => event.type === 'turnCompleted')).toHaveLength(4)
    expect(rig.events).toContainEqual({ type: 'turnStarted', turnId: queued.turnId })
    expect(later).toHaveBeenCalledWith(expect.objectContaining({ type: 'userMessageTurnChanged' }))
    expect(rig.log.error).toHaveBeenCalledWith(
      'Backend notification listener failed: modelApi.event',
    )
    expect(notices(rig)).toContain(UI_TEXT.backendListenerFailed)
    await rig.host.close()
  })

  it.each([
    'turnStarted',
    'turnCompleted',
    'itemStarted',
    'itemCompleted',
    'textDelta',
    'sessionStatus',
    'tokenUsage',
    'messageAdmitted',
    'approvalResolved',
  ])('continues the turn and later listeners after a throwing %s observer', async (type) => {
    const rig = await setup({ showReplyUsage: () => true })
    if (type === 'approvalResolved') await rig.session.setApprovalMode('promptUnmatched')
    const throwing = vi.fn((event: { type: string }) => {
      if (event.type === type || event.type === 'backendNotice')
        throw new Error('private callback detail')
    })
    rig.session.onEvent(throwing)
    const later = vi.fn()
    rig.session.onEvent(later)
    const replay = vi.fn((event: AgentEvent) => {
      if (event.type === 'approvalRequested' && event.isReplayed === true)
        throw new Error('private replay detail')
    })
    const approvals: Promise<void>[] = []
    rig.session.onEvent((event) => {
      if (event.type !== 'approvalRequested' || event.isReplayed === true) return
      rig.session.onEvent(replay)
      approvals.push(
        rig.session.decideApproval({
          approvalId: event.approvalId,
          requirementId: event.requirementId,
          choiceId: 'allow_once',
        }),
      )
    })
    const pending = await beginHeldReply(rig, { text: 'Steering answered.' })
    await rig.session.steer(pending.turnId, [{ type: 'text', text: 'STEERING' }])
    pending.release()
    await rig.session.settled()
    if (type === 'approvalResolved') {
      rig.api.script(
        { calls: [{ name: 'bash', arguments: '{"command":"pwd"}', callId: 'shell' }] },
        { text: 'Tool answered.' },
      )
      await send(rig)
    }
    await Promise.all(approvals)
    if (type === 'approvalResolved') {
      expect(replay).toHaveBeenCalledWith(expect.objectContaining({ isReplayed: true }))
      expect(rig.log.error).toHaveBeenCalledWith(
        'Backend notification listener failed: modelApi.replay',
      )
    }
    expect(throwing).toHaveBeenCalledWith(expect.objectContaining({ type }))
    expect(later).toHaveBeenCalledWith(expect.objectContaining({ type }))
    expect(rig.session.record()).toMatchObject({ status: 'idle' })
    expect(notices(rig)).toContain(UI_TEXT.backendListenerFailed)
    expect(rig.log.error).toHaveBeenCalledWith(
      'Backend notification listener failed: modelApi.event',
    )
    await rig.host.close()
  })

  it('keeps usage and list observer failures out of turn state transitions', async () => {
    const rig = await setup({
      noteResponseUsage: () => {
        throw new Error('private usage detail')
      },
    })
    rig.log.error.mockImplementation(() => {
      throw new Error('broken log sink')
    })
    rig.host.onSessionListEvent(() => {
      throw new Error('private list detail')
    })
    const later = vi.fn()
    rig.host.onSessionListEvent(later)
    rig.api.script({ text: 'Answered.' })
    await send(rig)
    await rig.session.settled()
    expect(later).toHaveBeenCalled()
    expect(rig.session.record()).toMatchObject({ status: 'idle' })
    expect(rig.log.error).toHaveBeenCalledWith(
      'Backend notification listener failed: modelApi.list',
    )
    expect(rig.log.error).toHaveBeenCalledWith(
      'Backend notification listener failed: modelApi.usage',
    )
    expect(notices(rig)).toContain(UI_TEXT.backendListenerFailed)
    await rig.host.close()
  })

  it('uses the selected per-model output cap and fixes it for that model', async () => {
    const cap = vi.fn((modelId: string) =>
      modelId === 'muse-spark-1.3' ? MODEL_API_RECOMMENDED_MAX_OUTPUT_TOKENS : 4096,
    )
    const rig = await setup({ modelOutputMaxTokens: cap })
    rig.api.script({ text: 'first' }, { text: 'next' })
    await send(rig)
    await send(rig)
    expect(rig.api.responseBodies().map((body) => body['max_output_tokens'])).toEqual([
      131_072, 131_072,
    ])
    expect(cap).toHaveBeenCalledExactlyOnceWith('muse-spark-1.3')
    await rig.session.setModel('muse-spark-1.2')
    rig.api.script({ text: 'Other model.' })
    await send(rig)
    expect(rig.api.responseBodies().at(-1)?.['max_output_tokens']).toBe(4096)
    await rig.session.setModel('muse-spark-1.3')
    rig.api.script({ text: 'Original model.' })
    await send(rig)
    expect(cap).toHaveBeenCalledTimes(2)
    expect(rig.api.responseBodies().at(-1)?.['max_output_tokens']).toBe(131_072)
    await rig.host.close()
  })

  it('refuses invalid model output records before dispatch', async () => {
    for (const cap of [0, -1, 1.5, Infinity, NaN]) {
      const rig = await setup({ modelOutputMaxTokens: () => cap })
      rig.api.script({ text: 'Never requested.' })
      await send(rig)
      expect(rig.api.responseBodies()).toHaveLength(0)
      expect(
        rig.events.some(
          (event) =>
            event.type === 'turnCompleted' && event.reason?.includes('invalid output.maxTokens'),
        ),
      ).toBe(true)
      await rig.host.close()
    }
  })

  it('changes only the declared output cap bytes in the first on request', async () => {
    const off = await setup({ parallelReads: () => false, outputContinuation: () => false })
    const on = await setup({
      parallelReads: () => true,
      outputContinuation: () => true,
      modelOutputMaxTokens: () => MODEL_API_RECOMMENDED_MAX_OUTPUT_TOKENS,
    })
    off.api.script({ text: 'Done.' })
    on.api.script({ text: 'Done.' })
    await send(off)
    await send(on)
    expect(on.rawBodies[0]).toBe(
      off.rawBodies[0]?.replace('"max_output_tokens":32768', '"max_output_tokens":131072'),
    )
    await off.host.close()
    await on.host.close()
  })

  it('continues once, preserves partial text and pairs cut-short calls with errors without executing', async () => {
    const rig = await setup()
    rig.api.script(
      {
        text: 'Partial.',
        calls: [
          { name: 'write_file', arguments: '{"path":"new.txt","content":"unsafe"}', callId: 'cut' },
        ],
        incomplete: { reason: 'max_output_tokens' },
      },
      { text: 'Still partial.', incomplete: { reason: 'max_output_tokens' } },
      { text: 'Never requested.' },
    )
    await send(rig)
    expect(rig.api.responseBodies()).toHaveLength(2)
    expect(rig.io.files.has('/ws/new.txt')).toBe(false)
    const next = JSON.stringify(rig.api.responseBodies()[1]?.['input'])
    expect(next).toContain('Partial.')
    expect(next).toContain(
      JSON.stringify({
        call_id: 'cut',
        output: `Error: ${MODEL_API_MODEL_TEXT.incompleteCallNotRun}`,
      }).slice(1, -1),
    )
    expect(next).toContain(MODEL_API_MODEL_TEXT.continuationPrompt)
    expect(notices(rig)).toContain(UI_TEXT.modelApiContinuing)
    expect(notices(rig)).toContain(UI_TEXT.modelApiContinuationLimit)
    expect(rig.events).toContainEqual({
      type: 'itemCompleted',
      item: expect.objectContaining({ kind: 'toolCall', tool: 'write_file', status: 'failed' }),
    })
    await rig.host.close()
  })

  it('does not continue other incomplete reasons, and keeps the off request at the legacy cap', async () => {
    for (const reason of ['max_output_tokens', 'content_filter']) {
      const rig = await setup({ outputContinuation: () => false, parallelReads: () => false })
      rig.api.script({ text: 'Partial.', incomplete: { reason } })
      await send(rig)
      expect(rig.api.responseBodies()).toHaveLength(1)
      expect(rig.api.responseBodies()[0]?.['max_output_tokens']).toBe(32_768)
      expect(notices(rig)).not.toContain(UI_TEXT.modelApiContinuing)
      await rig.host.close()
    }
    const rig = await setup()
    rig.api.script({ incomplete: { reason: 'content_filter' } })
    await send(rig)
    expect(rig.api.responseBodies()).toHaveLength(1)
    await rig.host.close()
  })

  it('queues accepted steering after exhausted, disabled and other incomplete responses', async () => {
    for (const scenario of ['exhausted', 'disabled', 'other']) {
      const rig = await setup({ outputContinuation: () => scenario !== 'disabled' })
      const held = Promise.withResolvers<undefined>()
      const requested = Promise.withResolvers<undefined>()
      const reason = scenario === 'other' ? 'content_filter' : 'max_output_tokens'
      rig.api.script(
        ...(scenario === 'exhausted' ? [{ text: 'Partial.', incomplete: { reason } }] : []),
        {
          text: 'Last partial.',
          incomplete: { reason },
          hold: held.promise,
          onRequest: () => {
            requested.resolve(undefined)
          },
        },
        { text: 'Steering answered.' },
      )
      const submitted = await rig.session.sendTurn([{ type: 'text', text: 'Work.' }])
      await requested.promise
      const steering = await rig.session.steer(submitted.turnId, [
        { type: 'text', text: 'Keep this accepted steering.' },
      ])
      expect(steering.disposition).toBe('steered')
      held.resolve(undefined)
      await rig.session.settled()
      expect(rig.api.responseBodies()).toHaveLength(scenario === 'exhausted' ? 3 : 2)
      expect(JSON.stringify(rig.api.responseBodies().at(-1)?.['input'])).toContain(
        'Keep this accepted steering.',
      )
      const reassigned = rig.events.find(
        (event) =>
          event.type === 'userMessageTurnChanged' && event.userMessageId === steering.userMessageId,
      )
      if (reassigned?.type !== 'userMessageTurnChanged') throw new Error('missing reassignment')
      expect(reassigned.turnId).not.toBe(submitted.turnId)
      expect(rig.events).toContainEqual({ type: 'turnStarted', turnId: reassigned.turnId })
      expect(rig.session.history().items).toContainEqual(
        expect.objectContaining({
          itemId: steering.userMessageId,
          kind: 'userMessage',
          text: 'Keep this accepted steering.',
        }),
      )
      await rig.host.close()
    }
  })

  it('preserves later accepted steering when a skill expansion is refused', async () => {
    const rig = await setupSkillSteering()
    rig.io.runHook = () =>
      Promise.resolve(hookResult('{"decision":{"behavior":"deny","message":"not now"}}'))
    const submitted = await beginHeldReply(rig, { text: 'Steering answered.' })
    const refused = await rig.session.steer(submitted.turnId, [
      { type: 'skill', selector: 'shout', arguments: 'hello' },
    ])
    const plain = await rig.session.steer(submitted.turnId, [
      { type: 'text', text: 'SURVIVING_PLAIN_STEERING' },
    ])
    expect(refused.disposition).toBe('steered')
    expect(plain.disposition).toBe('steered')
    submitted.release()
    await rig.session.settled()
    expect(rig.api.responseBodies()).toHaveLength(2)
    const next = JSON.stringify(rig.api.responseBodies()[1]?.['input'])
    expect(next).toContain('SURVIVING_PLAIN_STEERING')
    expect(next).not.toContain('UPPER CASE.')
    expect(rig.session.history().items).toContainEqual(
      expect.objectContaining({
        itemId: refused.userMessageId,
        kind: 'userMessage',
        status: 'rejected',
        failureReason: 'A hook refused /shout: not now',
      }),
    )
    expect(rig.events).toContainEqual(
      expect.objectContaining({
        type: 'itemCompleted',
        item: expect.objectContaining({
          itemId: refused.userMessageId,
          status: 'rejected',
        }),
      }),
    )
    const reassigned = rig.events.find(
      (event) =>
        event.type === 'userMessageTurnChanged' && event.userMessageId === plain.userMessageId,
    )
    if (reassigned?.type !== 'userMessageTurnChanged') throw new Error('missing reassignment')
    expect(rig.events).toContainEqual({ type: 'turnStarted', turnId: reassigned.turnId })
    expect(rig.session.history().items).toContainEqual(
      expect.objectContaining({
        itemId: plain.userMessageId,
        text: 'SURVIVING_PLAIN_STEERING',
        status: 'completed',
      }),
    )
    await rig.host.close()
  })

  it('promotes the unprocessed steering head and tail when Stop interrupts skill hooks', async () => {
    const rig = await setupSkillSteering()
    const expansion = Promise.withResolvers<undefined>()
    const hookHeld = Promise.withResolvers<undefined>()
    let runs = 0
    rig.io.runHook = async () => {
      runs += 1
      if (runs === 1) {
        expansion.resolve(undefined)
        await hookHeld.promise
      }
      return hookResult('')
    }
    const submitted = await beginHeldReply(
      rig,
      { text: 'Skill answered.' },
      { text: 'Plain answered.' },
    )
    const skill = await rig.session.steer(submitted.turnId, [
      { type: 'skill', selector: 'shout', arguments: 'hello' },
    ])
    const plain = await rig.session.steer(submitted.turnId, [
      { type: 'text', text: 'SURVIVING_STOP_STEERING' },
    ])
    submitted.release()
    await expansion.promise
    await rig.session.cancel()
    hookHeld.resolve(undefined)
    await rig.session.settled()
    expect(rig.api.responseBodies()).toHaveLength(3)
    expect(JSON.stringify(rig.api.responseBodies()[1]?.['input'])).toContain('UPPER CASE.')
    expect(JSON.stringify(rig.api.responseBodies()[2]?.['input'])).toContain(
      'SURVIVING_STOP_STEERING',
    )
    expect(
      rig.events
        .filter((event) => event.type === 'userMessageTurnChanged')
        .map((event) => event.userMessageId),
    ).toEqual([skill.userMessageId, plain.userMessageId])
    for (const id of [skill.userMessageId, plain.userMessageId]) {
      const reassigned = rig.events.find(
        (event) => event.type === 'userMessageTurnChanged' && event.userMessageId === id,
      )
      if (reassigned?.type !== 'userMessageTurnChanged') throw new Error('missing reassignment')
      expect(rig.events).toContainEqual({ type: 'turnStarted', turnId: reassigned.turnId })
      expect(rig.session.history().items.filter((item) => item.itemId === id)).toHaveLength(1)
    }
    await rig.host.close()
  })

  it('suppresses the third unchanged text read, stops the fourth and resets for a new turn', async () => {
    const rig = await setup()
    rig.api.script(...repeatReplies(), { text: 'Never requested.' })
    await send(rig)
    expect(rig.api.responseBodies()).toHaveLength(4)
    const input = JSON.stringify(rig.api.responseBodies()[3]?.['input'])
    expect(input).toContain(
      '"call_id":"repeat2","output":"' + MODEL_API_MODEL_TEXT.toolRepeatStopped + '"',
    )
    expect(notices(rig)).toContain(UI_TEXT.modelApiToolStuck)
    rig.api.script({ calls: [read(0)] }, { text: 'Fresh turn.' })
    await send(rig)
    expect(JSON.stringify(rig.api.responseBodies().at(-1)?.['input'])).toContain(
      '"call_id":"c0","output":"Read text file',
    )
    await rig.host.close()
  })

  it('runs a changed file on the third attempt and checks again after the skipped third', async () => {
    for (const changeAt of [2, 3]) {
      const rig = await setup()
      rig.api.script(
        ...repeatReplies((id) => {
          if (id === changeAt) rig.io.files.set('/ws/0.txt', 'changed result')
        }),
        { text: 'Done.' },
      )
      await send(rig)
      expect(rig.api.responseBodies()).toHaveLength(5)
      expect(JSON.stringify(rig.api.responseBodies().at(-1)?.['input'])).toContain('changed result')
      expect(notices(rig)).not.toContain(UI_TEXT.modelApiToolStuck)
      await rig.host.close()
    }
  })

  it('keeps repeated identical calls in one batch serial so the third can be suppressed', async () => {
    const rig = await setup()
    rig.api.script(
      {
        calls: Array.from({ length: 4 }, (_, id) => ({
          ...read(0),
          callId: `repeat${String(id)}`,
        })),
      },
      { text: 'Never requested.' },
    )
    await send(rig)
    expect(rig.api.responseBodies()).toHaveLength(1)
    expect(notices(rig)).toContain(UI_TEXT.modelApiToolStuck)
    const outputs = rig.session.history().items.filter((item) => item.kind === 'toolCall')
    expect(outputs).toHaveLength(4)
    await rig.host.close()
  })

  it('runs repeated shell calls when their future result cannot be proven unchanged', async () => {
    const rig = await setup()
    rig.api.script(
      ...Array.from({ length: 4 }, (_, id) => ({
        calls: [
          { name: 'bash', arguments: '{"command":"echo result"}', callId: `shell${String(id)}` },
        ],
      })),
      { text: 'Done.' },
    )
    await send(rig)
    expect(rig.io.shellCalls).toHaveLength(4)
    expect(notices(rig)).not.toContain(UI_TEXT.modelApiToolStuck)
    await rig.host.close()
  })

  it('runs legitimate repeats when either trusted result-proof operation fails', async () => {
    for (const failure of ['observed', 'current']) {
      const rig = await setup({
        repeatResultWitness: {
          observed: () => {
            if (failure === 'observed') throw new Error('no proof')
            return 'state'
          },
          current: () =>
            failure === 'current'
              ? Promise.reject(new Error('no proof'))
              : Promise.resolve('state'),
        },
      })
      rig.api.script(...repeatReplies(), { text: 'Done.' })
      await send(rig)
      expect(rig.api.responseBodies()).toHaveLength(5)
      expect(notices(rig)).not.toContain(UI_TEXT.modelApiToolStuck)
      const replay = JSON.stringify(rig.api.responseBodies().at(-1)?.['input'])
      for (const id of [2, 3])
        expect(replay).toContain(`"call_id":"repeat${String(id)}","output":"Read text file`)
      await rig.host.close()
    }
  })

  it('settles pre and post hooks, writes and shell barriers in call order', async () => {
    const hooks = parseHookConfig(
      JSON.stringify({
        hooks: {
          PreToolUse: [{ hooks: [{ type: 'command', command: 'pre' }] }],
          PostToolUse: [{ hooks: [{ type: 'command', command: 'post' }] }],
        },
      }),
      'project',
      'linux',
    ).hooks
    const rig = await setup({ loadHooks: () => Promise.resolve(hooks), isHooksEnabled: () => true })
    const phases: string[] = []
    rig.io.runHook = (command, payload) => {
      const parsed: unknown = JSON.parse(payload)
      if (
        typeof parsed !== 'object' ||
        parsed === null ||
        !('tool_use_id' in parsed) ||
        typeof parsed.tool_use_id !== 'string'
      )
        throw new Error('invalid hook payload')
      phases.push(`${command}:${parsed.tool_use_id}`)
      return Promise.resolve(hookResult(''))
    }
    const readFile = rig.io.readFile
    rig.io.readFile = async (absolute, expected) => {
      if (absolute.endsWith('.txt')) phases.push(`read:${absolute}`)
      return await readFile(absolute, expected)
    }
    rig.api.script(
      {
        calls: [
          read(0),
          read(1),
          {
            name: 'write_file',
            arguments: '{"path":"new.txt","content":"created"}',
            callId: 'write',
          },
          { name: 'bash', arguments: '{"command":"echo after"}', callId: 'shell' },
          read(2),
        ],
      },
      { text: 'Done.' },
    )
    await send(rig)
    const pre = phases.filter((phase) => phase.startsWith('pre:'))
    const post = phases.filter((phase) => phase.startsWith('post:'))
    expect(pre).toHaveLength(5)
    expect(post.map((phase) => phase.replace('post:', ''))).toEqual(
      pre.map((phase) => phase.replace('pre:', '')),
    )
    expect(phases.indexOf(pre[1] ?? '')).toBeGreaterThan(phases.indexOf(post[0] ?? ''))
    expect(phases.indexOf(pre[2] ?? '')).toBeGreaterThan(phases.indexOf(post[1] ?? ''))
    expect(rig.io.files.get('/ws/new.txt')).toBe('created')
    expect(rig.io.shellCalls).toHaveLength(1)
    await rig.host.close()
  })

  it('keeps hook-mutated read sources byte-identical with concurrency on and off', async () => {
    for (const event of ['PreToolUse', 'PostToolUse']) {
      const hooks = parseHookConfig(
        JSON.stringify({
          hooks: {
            [event]: [{ matcher: 'Read', hooks: [{ type: 'command', command: 'mutate' }] }],
          },
        }),
        'project',
        'linux',
      ).hooks
      expect(hooks).toHaveLength(1)
      const capture = async (isParallel: boolean) => {
        const rig = await setup({
          parallelReads: () => isParallel,
          loadHooks: () => Promise.resolve(hooks),
          isHooksEnabled: () => true,
        })
        rig.io.files.set('/ws/0.txt', 'OLD')
        rig.io.files.set('/ws/1.txt', 'OLD')
        rig.io.runHook = (_command, payload) => {
          if (event === 'PostToolUse' && payload.includes('0.txt'))
            rig.io.files.set('/ws/1.txt', 'NEW')
          if (event === 'PreToolUse' && payload.includes('1.txt'))
            rig.io.files.set('/ws/0.txt', 'NEW')
          return Promise.resolve(hookResult(''))
        }
        rig.api.script({ calls: [read(0), read(1)] }, { text: 'Done.' })
        await send(rig)
        const bodies = normalizeBodies(rig.rawBodies)
        expect(bodies.at(-1)).toContain(event === 'PostToolUse' ? '1|NEW' : '1|OLD')
        await rig.host.close()
        return bodies
      }
      expect(await capture(true)).toEqual(await capture(false))
    }
  })

  it('serializes enabled extension hooks and permits overlap when hooks are disabled', async () => {
    const hooks = parseSparkHooksConfig(
      '{"hooks":{"InstructionsLoaded":[{"hooks":[{"type":"command","command":"observe"}]}]}}',
      'project',
      'linux',
    ).hooks
    expect(hooks).toHaveLength(1)
    for (const isEnabled of [true, false]) {
      const rig = await setup({
        loadExtensionHooks: () => Promise.resolve(hooks),
        isHooksEnabled: () => isEnabled,
      })
      const { gates, entered } = holdTextReads(rig, 2)
      rig.api.script({ calls: [read(0), read(1)] }, { text: 'Done.' })
      const done = rig.turnDone()
      await rig.session.sendTurn([{ type: 'text', text: 'Read.' }])
      await vi.waitFor(() => {
        expect(entered).toHaveLength(isEnabled ? 1 : 2)
      })
      for (const gate of gates) gate.resolve(undefined)
      await done
      await rig.host.close()
    }
  })

  it('reserves the continuation afresh and refuses it when its budget is exhausted', async () => {
    const rig = await setup({
      store: memorySessionStore(),
      sessionBudgetUsd: () => Usd.from(0.1).toAmount(),
    })
    rig.api.script(
      {
        text: 'Partial.',
        incomplete: { reason: 'max_output_tokens' },
        usage: { input: 0, output: 100_000 },
      },
      { text: 'Never requested.' },
    )
    await send(rig)
    expect(rig.api.responseBodies()).toHaveLength(1)
    expect(
      rig.events.some((event) => event.type === 'turnCompleted' && event.terminal === 'failed'),
    ).toBe(true)
    await rig.host.close()
  })

  it('does not overlap a hook-forced asking read with reads on either side', async () => {
    const hooks = parseHookConfig(
      JSON.stringify({
        hooks: {
          PreToolUse: [{ hooks: [{ type: 'command', command: 'pre' }] }],
        },
      }),
      'project',
      'linux',
    ).hooks
    const rig = await setup({ loadHooks: () => Promise.resolve(hooks), isHooksEnabled: () => true })
    rig.io.runHook = (_command, payload) =>
      Promise.resolve(
        hookResult(
          payload.includes('1.txt')
            ? JSON.stringify({
                hookSpecificOutput: { hookEventName: 'PreToolUse', permissionDecision: 'ask' },
              })
            : '',
        ),
      )
    const gate = Promise.withResolvers<undefined>()
    const entered: string[] = []
    const originalRead = rig.io.readFile
    rig.io.readFile = async (absolute, expected) => {
      if (absolute.endsWith('.txt')) entered.push(absolute)
      if (absolute === '/ws/0.txt') await gate.promise
      return await originalRead(absolute, expected)
    }
    rig.api.script({ calls: [read(0), read(1), read(2)] }, { text: 'Done.' })
    const done = rig.turnDone()
    await rig.session.sendTurn([{ type: 'text', text: 'Read.' }])
    await vi.waitFor(() => {
      expect(entered).toEqual(['/ws/0.txt'])
    })
    expect(rig.events.some((event) => event.type === 'approvalRequested')).toBe(false)
    gate.resolve(undefined)
    await vi.waitFor(() => {
      expect(rig.events.some((event) => event.type === 'approvalRequested')).toBe(true)
    })
    const approval = rig.events.find((event) => event.type === 'approvalRequested')
    if (approval?.type !== 'approvalRequested') throw new Error('missing approval')
    expect(entered).toEqual(['/ws/0.txt'])
    await rig.session.decideApproval({
      approvalId: approval.approvalId,
      requirementId: approval.requirementId,
      choiceId: 'allow_once',
    })
    await done
    expect(entered).toEqual(['/ws/0.txt', '/ws/1.txt', '/ws/2.txt'])
    await rig.host.close()
  })

  it('reserves media in call order even when later image reads finish first', async () => {
    const capture = async (isParallel: boolean) => {
      const rig = await setup({
        parallelReads: () => isParallel,
        mediaBudgetMaxEncodedChars: TINY_PNG_BASE64.length * 2 - 1,
      })
      rig.io.binaries.set('/ws/first.png', Buffer.from(TINY_PNG_BASE64, 'base64'))
      rig.io.binaries.set('/ws/second.png', Buffer.from(TINY_PNG_BASE64, 'base64'))
      const original = rig.io.readBytes
      const gates = [Promise.withResolvers<undefined>(), Promise.withResolvers<undefined>()]
      const entered: string[] = []
      rig.io.readBytes = async (absolute, maxBytes, expected) => {
        entered.push(absolute)
        await gates[absolute.endsWith('first.png') ? 0 : 1]?.promise
        return await original(absolute, maxBytes, expected)
      }
      rig.api.script(
        {
          calls: [
            { name: 'read_file', arguments: '{"path":"first.png"}', callId: 'first' },
            { name: 'read_file', arguments: '{"path":"second.png"}', callId: 'second' },
          ],
        },
        { text: 'Done.' },
      )
      const done = rig.turnDone()
      await rig.session.sendTurn([{ type: 'text', text: 'Read images.' }])
      await vi.waitFor(() => {
        expect(entered).toHaveLength(isParallel ? 2 : 1)
      })
      for (const gate of gates.toReversed()) gate.resolve(undefined)
      await done
      const next = JSON.stringify(rig.api.responseBodies()[1]?.['input'])
      expect(next).toContain('Read image')
      expect(next).toContain(MODEL_API_MODEL_TEXT.toolMediaBudgetExceeded)
      expect(next.match(/"type":"input_image"/g)).toHaveLength(1)
      const bodies = normalizeBodies(rig.rawBodies)
      await rig.host.close()
      return bodies
    }
    expect(await capture(true)).toEqual(await capture(false))
  })

  it('forgets parallel reads stopped before settlement so a later edit still requires a read', async () => {
    const rig = await setup()
    const { gates, entered } = holdTextReads(rig, 2)
    rig.api.script({ calls: [read(0), read(1)] }, { text: 'Never requested.' })
    const done = rig.turnDone()
    await rig.session.sendTurn([{ type: 'text', text: 'Read.' }])
    await vi.waitFor(() => {
      expect(entered).toHaveLength(2)
    })
    const cancelled = rig.session.cancel()
    for (const gate of gates) gate.resolve(undefined)
    await cancelled
    await done
    const saved = rig.session.history().items.filter((item) => item.kind === 'toolCall')
    expect(saved.every((item) => item.status === 'cancelled')).toBe(true)
    rig.api.script(
      {
        calls: [
          { name: 'write_file', arguments: '{"path":"0.txt","content":"changed"}', callId: 'edit' },
        ],
      },
      { text: 'Refused.' },
    )
    await send(rig)
    expect(rig.io.files.get('/ws/0.txt')).toBe('first')
    expect(JSON.stringify(rig.api.responseBodies().at(-1)?.['input'])).toContain(
      MODEL_API_MODEL_TEXT.fileChangedSinceRead,
    )
    await rig.host.close()
  })

  it.each([false, true])(
    'drops provisional text-read proofs when Stop lands two microtasks after native resolution (parallel %s)',
    async (isParallel) => {
      const rig = await setup({ parallelReads: () => isParallel })
      rig.io.files.set('/ws/0.txt', 'ORIGINAL')
      const originalRead = rig.io.readFile
      rig.io.readFile = (absolute, expected, signal) => {
        const resolved = originalRead(absolute, expected, signal)
        if (absolute.replaceAll('\\', '/') === '/ws/0.txt')
          queueMicrotask(() => {
            queueMicrotask(() => {
              void rig.session.cancel()
            })
          })
        return resolved
      }
      rig.api.script({ calls: [read(0)] })
      await send(rig)
      const rows = rig.session.history().items.filter((item) => item.kind === 'toolCall')
      expect(rows).toHaveLength(1)
      expect(rows[0]?.status).toBe('cancelled')
      expect(rig.session).toHaveProperty('seenFiles.size', 0)
      expect(JSON.stringify(rig.session.history().items)).not.toContain('1|ORIGINAL')
      rig.io.readFile = originalRead
      const next = await attemptOverwrite(rig)
      expect(rig.io.files.get('/ws/0.txt')).toBe('ORIGINAL')
      expect(next).not.toContain('1|ORIGINAL')
      expect(next).toContain(MODEL_API_MODEL_TEXT.fileChangedSinceRead)
      await rig.host.close()
    },
  )

  it.each([false, true])(
    'commits completed read proofs with replay and authorizes a later write (parallel %s)',
    async (isParallel) => {
      const rig = await setup({ parallelReads: () => isParallel })
      const proofsAtCompletion: number[] = []
      const subscription = rig.session.onEvent((event) => {
        if (
          event.type !== 'itemCompleted' ||
          event.item.tool !== 'read_file' ||
          event.item.status !== 'completed'
        )
          return
        expect(rig.session).toHaveProperty('seenFiles.size', 1)
        expect(rig.session.history().items).toContainEqual(
          expect.objectContaining({
            itemId: event.item.itemId,
            status: 'completed',
            visibleOutput: expect.stringContaining('1|first'),
          }),
        )
        expect(rig.session).toHaveProperty(
          'replay',
          expect.arrayContaining([
            expect.objectContaining({
              item: expect.objectContaining({
                type: 'function_call_output',
                call_id: 'c0',
                output: expect.stringContaining('1|first'),
              }),
            }),
          ]),
        )
        proofsAtCompletion.push(1)
      })
      rig.api.script({ calls: [read(0)] }, { text: 'Read complete.' })
      await send(rig)
      expect(proofsAtCompletion).toEqual([1])
      await attemptOverwrite(rig)
      expect(rig.io.files.get('/ws/0.txt')).toBe('OVERWRITTEN')
      expect(rig.session.history().items).toContainEqual(
        expect.objectContaining({
          tool: 'write_file',
          status: 'completed',
        }),
      )
      subscription()
      await rig.host.close()
    },
  )

  it('keeps hook-agent read proofs private so they cannot authorize conversation writes', async () => {
    const hooks = parseHookConfig(
      '{"hooks":{"UserPromptSubmit":[{"hooks":[{"type":"agent","prompt":"Check the prompt."}]}]}}',
      'project',
      'linux',
    ).hooks
    expect(hooks).toHaveLength(1)
    let isEnabled = true
    const rig = await setup({
      loadHooks: () => Promise.resolve(hooks),
      isHooksEnabled: () => isEnabled,
      isPaidFeatureOn: (feature) => feature === 'hookModels',
      allowsPaidUse: () => Promise.resolve(true),
    })
    rig.api.script({ calls: [read(0)] }, { text: '{}' }, { text: 'Main reply.' })
    await send(rig)
    expect(JSON.stringify(rig.api.responseBodies()[1]?.['input'])).toContain('1|first')
    expect(rig.session).toHaveProperty('seenFiles.size', 0)
    isEnabled = false
    const next = await attemptOverwrite(rig)
    expect(rig.io.files.get('/ws/0.txt')).toBe('first')
    expect(next).toContain(MODEL_API_MODEL_TEXT.fileChangedSinceRead)
    await rig.host.close()
  })

  it('discards reads stopped during held realPath settlement, including later recall_output', async () => {
    for (const isPacking of [false, true]) {
      const rig = await setup({
        observationPacking: () => isPacking,
        parallelReads: () => isPacking,
      })
      const marker = 'DISCARDED_SETTLEMENT_CONTENT'
      rig.io.files.set('/ws/0.txt', `${marker}\n${'long output\n'.repeat(500)}`)
      const held = Promise.withResolvers<undefined>()
      const entered = Promise.withResolvers<undefined>()
      let reads = 0
      const originalRead = rig.io.readFile
      rig.io.readFile = async (...args) => {
        const value = await originalRead(...args)
        reads += 1
        return value
      }
      const originalPath = rig.io.realPath
      rig.io.realPath = async (absolute) => {
        if (reads === (isPacking ? 2 : 1) && absolute.replaceAll('\\', '/') === '/ws/0.txt') {
          entered.resolve(undefined)
          await held.promise
        }
        return await originalPath(absolute)
      }
      rig.api.script({ calls: [read(0), read(1)] })
      const done = rig.turnDone()
      await rig.session.sendTurn([{ type: 'text', text: 'Read.' }])
      await entered.promise
      await rig.session.cancel()
      try {
        await vi.waitFor(() => {
          expect(rig.events.at(-1)).toEqual({ type: 'sessionStatus', status: 'idle' })
        })
      } finally {
        held.resolve(undefined)
      }
      await done
      const rows = rig.session.history().items.filter((item) => item.kind === 'toolCall')
      expect(rows).toHaveLength(isPacking ? 2 : 1)
      expect(rows.every((item) => item.status === 'cancelled')).toBe(true)
      expect(
        rig.events.some(
          (event) => event.type === 'itemCompleted' && event.item.visibleOutput?.includes(marker),
        ),
      ).toBe(false)
      rig.api.script(
        { calls: [{ name: 'recall_output', arguments: '{"id":"c0"}', callId: 'recall' }] },
        { text: 'Recall refused.' },
      )
      await send(rig)
      expect(JSON.stringify(rig.api.responseBodies())).not.toContain(marker)
      rig.api.script(
        {
          calls: [
            {
              name: 'write_file',
              arguments: '{"path":"0.txt","content":"changed"}',
              callId: 'edit',
            },
          ],
        },
        { text: 'Edit refused.' },
      )
      await send(rig)
      expect(rig.io.files.get('/ws/0.txt')).toContain(marker)
      expect(JSON.stringify(rig.api.responseBodies().at(-1)?.['input'])).toContain(
        MODEL_API_MODEL_TEXT.fileChangedSinceRead,
      )
      await rig.host.close()
    }
  })

  it('discards speculative results when Stop arrives in the post-settlement await', async () => {
    const rig = await setup({
      repeatResultWitness: {
        observed: () => {
          queueMicrotask(() => {
            void rig.session.cancel()
          })
          return 'witness'
        },
        current: () => Promise.resolve('witness'),
      },
    })
    rig.api.script({ calls: [read(0), read(1)] })
    await send(rig)
    const rows = rig.session.history().items.filter((item) => item.kind === 'toolCall')
    expect(rows.every((item) => item.status === 'cancelled')).toBe(true)
    expect(
      rig.events.some(
        (event) =>
          event.type === 'itemCompleted' &&
          event.item.kind === 'toolCall' &&
          event.item.status === 'completed',
      ),
    ).toBe(false)
    await rig.host.close()
  })

  it('rechecks live permission revocation after speculative settlement awaits', async () => {
    let isDenied = false
    const rig = await setup({
      permissionSettings: () => ({
        commandRules: [],
        profiles: {},
        profile: '',
        repositoryRules: isDenied ? { denyRead: ['0.txt'] } : undefined,
      }),
      repeatResultWitness: {
        observed: () => {
          queueMicrotask(() => {
            isDenied = true
          })
          return 'witness'
        },
        current: () => Promise.resolve('witness'),
      },
    })
    rig.api.script({ calls: [read(0), read(1)] }, { text: 'Done.' })
    await send(rig)
    expect(JSON.stringify(rig.api.responseBodies()[1]?.['input'])).not.toContain('1|first')
    expect(rig.session.history().items).toContainEqual(
      expect.objectContaining({
        kind: 'toolCall',
        tool: 'read_file',
        status: 'failed',
      }),
    )
    await rig.host.close()
  })

  it('becomes idle on Stop with diagnostics before a stalled read that remains held', async () => {
    for (const isParallel of [false, true]) {
      const diagnosticsEntered = Promise.withResolvers<undefined>()
      const rig = await setup({
        parallelReads: () => isParallel,
        ideTools: [
          {
            name: 'getDiagnostics',
            description: 'Read diagnostics',
            inputSchema: { type: 'object' },
            annotations: { readOnlyHint: true },
            call: (_args, signal) => {
              diagnosticsEntered.resolve(undefined)
              return new Promise<string>((_resolve, reject) => {
                signal.addEventListener(
                  'abort',
                  () => {
                    reject(new Error('stopped'))
                  },
                  { once: true },
                )
              })
            },
          },
        ],
      })
      const { gates, entered, signals } = holdTextReads(rig, 1)
      rig.api.script({
        calls: [
          { name: 'mcp__ide__getDiagnostics', arguments: '{}', callId: 'diagnostics' },
          read(0),
        ],
      })
      await rig.session.sendTurn([{ type: 'text', text: 'Read.' }])
      await diagnosticsEntered.promise
      if (isParallel)
        await vi.waitFor(() => {
          expect(entered).toHaveLength(1)
        })
      try {
        await rig.session.cancel()
        await vi.waitFor(() => {
          expect(rig.events).toContainEqual(
            expect.objectContaining({ type: 'turnCompleted', terminal: 'cancelled' }),
          )
          expect(rig.events.at(-1)).toEqual({ type: 'sessionStatus', status: 'idle' })
        })
        await rig.session.settled()
        if (isParallel) expect(signals[0]?.aborted).toBe(true)
        else expect(entered).toEqual([])
      } finally {
        for (const gate of gates) gate.resolve(undefined)
        await rig.host.close()
      }
      expect(
        rig.session
          .history()
          .items.filter((item) => item.kind === 'toolCall')
          .every((item) => item.status === 'cancelled'),
      ).toBe(true)
    }
  })

  it('overlaps real read execution and returns identical raw requests with packing on', async () => {
    const capture = async (isParallel: boolean) => {
      const rig = await setup({ parallelReads: () => isParallel, observationPacking: () => true })
      rig.io.files.set(
        '/ws/0.txt',
        Array.from({ length: 500 }, (_, index) => `line ${String(index)} ${'x'.repeat(20)}`).join(
          '\n',
        ),
      )
      const { gates, entered } = holdTextReads(rig, 4)
      rig.api.script(
        { calls: [read(0), read(1), read(2), read(3)] },
        { text: 'Read.' },
        { text: 'Again.' },
        { text: 'Packed.' },
      )
      const done = rig.turnDone()
      await rig.session.sendTurn([{ type: 'text', text: 'Read.' }])
      await vi.waitFor(() => {
        expect(entered).toHaveLength(isParallel ? 4 : 1)
      })
      for (const gate of gates.toReversed()) gate.resolve(undefined)
      await done
      await send(rig)
      await send(rig)
      const raw = normalizeBodies(rig.rawBodies)
      expect(raw.at(-1)).toContain('Packed output')
      await rig.host.close()
      return raw
    }
    expect(await capture(true)).toEqual(await capture(false))
  })
})
