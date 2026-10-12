import { describe, expect, it } from 'vitest'
import { ModelApiHost } from '../../src/core/backends/modelapi/ModelApiHost'
import { ModelCallLimitError } from '../../src/core/backends/modelapi/sessionBudget'
import { MODEL_API_MAX_TOOL_ROUNDS, UI_TEXT } from '../../src/shared/constants'
import { mspApprovalMode } from '../../src/shared/permissionModes'
import { plural } from '../../src/shared/l10n/text'
import { parseHookConfig } from '../../src/core/backends/modelapi/hooks'
import { Usd as PortUsd } from '../../src/shared/usd'
import { FAKE_MODEL_API_ACCOUNT_ID, fakeModelApi, fakeModelApiClient } from './helpers/fakeModelApi'
import { memoryToolIo } from './helpers/fakeToolIo'
import { fakeModelApiHostDeps } from './helpers/modelApiHostDeps'
import { FakeLogOutputChannel } from './helpers/fakes'
import { startWatchedSession } from './helpers/sessionTurns'

function remainingCalls(cap: number | (() => number) | undefined): (() => number) | undefined {
  if (typeof cap === 'function') return cap
  return cap === undefined ? undefined : () => cap
}

async function setup(cap?: number | (() => number)) {
  const api = fakeModelApi()
  const log = new FakeLogOutputChannel()
  const client = fakeModelApiClient(api, log)
  const io = memoryToolIo({}, '/ws')
  const host = new ModelApiHost({
    ...fakeModelApiHostDeps({ client, io, log, workspaceRoot: '/ws' }),
    remainingModelCalls: remainingCalls(cap),
  })
  return {
    api,
    host,
    io,
    ...(await startWatchedSession(host, '/ws', mspApprovalMode('acceptEdits'))),
  }
}

/** Scripted tool replies for a model that keeps calling instead of answering. */
function toolCallReplies(count: number) {
  return Array.from({ length: count }, () => ({
    calls: [{ name: 'get_goal', arguments: '{}' }],
  }))
}

/** The wrap-up's trailing developer note, by its limit sentence. */
function wrapUpNotesOf(body: Record<string, unknown>): string[] {
  const input: unknown = body['input']
  return Array.isArray(input)
    ? input
        .filter(
          (item): item is Record<string, unknown> =>
            typeof item === 'object' &&
            item !== null &&
            (item as Record<string, unknown>)['role'] === 'developer',
        )
        .flatMap((item) => {
          const content: unknown = item['content']
          return Array.isArray(content)
            ? content.flatMap((part) =>
                typeof part === 'object' && part !== null && 'text' in part
                  ? [String((part as Record<string, unknown>)['text'])]
                  : [],
              )
            : []
        })
    : []
}

describe('model-call turn limit', () => {
  it('is typed and carries the permitted count', () => {
    const stop = new ModelCallLimitError(MODEL_API_MAX_TOOL_ROUNDS)
    expect(stop).toMatchObject({ name: 'ModelCallLimitError', limit: MODEL_API_MAX_TOOL_ROUNDS })
    expect(stop.message).toBe(plural(UI_TEXT.modelApiTurnLimit, MODEL_API_MAX_TOOL_ROUNDS))
  })

  it.each([51, 80, 198])('finishes %s tool rounds under the default cap', async (rounds) => {
    const t = await setup()
    try {
      const answer = `Answer after ${String(rounds)} tool rounds`
      t.api.script(...toolCallReplies(rounds), { text: answer })
      await t.session.sendTurn([{ type: 'text', text: 'Long review' }])
      await t.turnDone()
      expect(t.api.responseBodies()).toHaveLength(rounds + 1)
      // A natural finish under the limit carries no errorKind.
      expect(t.events.findLast((e) => e.type === 'turnCompleted')).toMatchObject({
        terminal: 'completed',
      })
      expect(t.events.findLast((e) => e.type === 'turnCompleted')).not.toHaveProperty('errorKind')
      expect(t.session.history().items).toContainEqual(
        expect.objectContaining({ kind: 'agentMessage', text: answer }),
      )
      expect(JSON.stringify(t.events)).not.toContain('Internal error')
    } finally {
      await t.host.close()
    }
  })

  it('finishes the 199th tool round at the default cap with the limit typed', async () => {
    const rounds = 199
    const t = await setup()
    try {
      const answer = `Answer after ${String(rounds)} tool rounds`
      t.api.script(...toolCallReplies(rounds), { text: answer })
      await t.session.sendTurn([{ type: 'text', text: 'Long review' }])
      await t.turnDone()
      expect(t.api.responseBodies()).toHaveLength(rounds + 1)
      // A wrap-up answer reached its limit: the answer is kept and the stop
      // says what it means.
      expect(t.events.findLast((e) => e.type === 'turnCompleted')).toMatchObject({
        terminal: 'completed',
        errorKind: 'max_turn_requests',
      })
      expect(t.session.history().items).toContainEqual(
        expect.objectContaining({ kind: 'agentMessage', text: answer }),
      )
      expect(JSON.stringify(t.events)).not.toContain('Internal error')
    } finally {
      await t.host.close()
    }
  })

  it('lets a caller use more than the default 200 calls', async () => {
    const cap = 205
    const t = await setup(cap)
    try {
      t.api.script(...toolCallReplies(cap - 1), { text: 'Final review summary' })
      await t.session.sendTurn([{ type: 'text', text: 'Use the caller allowance' }])
      await t.turnDone()
      const bodies = t.api.responseBodies()
      expect(bodies).toHaveLength(cap)
      const ordinary = bodies.at(-2)!
      const last = bodies.at(-1)!
      // The wrap-up keeps the production side-call shape: instructions
      // byte-identical to the last ordinary call, no tools declared, the
      // choice field as ever, the note a trailing input item.
      expect(last['tools']).toEqual([])
      expect(last['tool_choice']).toBe('auto')
      expect(last['instructions']).toBe(ordinary['instructions'])
      expect(wrapUpNotesOf(last)).toEqual([expect.stringContaining('limit of 205 model calls')])
      expect(t.session.history().items).toContainEqual(
        expect.objectContaining({ text: 'Final review summary' }),
      )
    } finally {
      await t.host.close()
    }
  })

  it('rebuilds an HTTP retry into a wrap-up when one call remains', async () => {
    const t = await setup(3)
    try {
      t.api.script(
        { calls: [{ name: 'get_goal', arguments: '{}' }] },
        { httpError: { status: 429 } },
        { text: 'Retried final answer' },
      )
      await t.session.sendTurn([{ type: 'text', text: 'Review with a retry' }])
      await t.turnDone()
      // The refused attempt was sent, so it counts: two sent calls, then
      // the wrap-up on the last slot.
      expect(t.api.responseBodies()).toHaveLength(3)
      const last = t.api.responseBodies().at(-1)!
      expect(last).toMatchObject({ tools: [], tool_choice: 'auto' })
      expect(wrapUpNotesOf(last)).toEqual([expect.stringContaining('limit of 3 model calls')])
      expect(t.events.findLast((e) => e.type === 'turnCompleted')).toMatchObject({
        errorKind: 'max_turn_requests',
      })
    } finally {
      await t.host.close()
    }
  })

  it('ends a tool loop with a translated resumable limit, then accepts another message', async () => {
    const cap = 3
    const t = await setup(cap)
    try {
      t.api.script(
        ...toolCallReplies(cap - 1),
        {
          text: 'Done; found a bug; tests remain',
          calls: [
            {
              name: 'write_file',
              arguments: JSON.stringify({ path: 'should-not-run.txt', content: 'wrong' }),
            },
          ],
        },
        { text: 'Continued answer' },
      )
      await t.session.sendTurn([{ type: 'text', text: 'Review' }])
      await t.turnDone()
      const bodies = t.api.responseBodies()
      expect(bodies).toHaveLength(cap)
      expect(t.events).toContainEqual(
        expect.objectContaining({
          type: 'turnCompleted',
          terminal: 'completed',
          errorKind: 'max_turn_requests',
          reason: plural(UI_TEXT.modelApiTurnLimit, cap),
        }),
      )
      expect(t.events).toContainEqual({
        type: 'backendNotice',
        level: 'warning',
        text: plural(UI_TEXT.modelApiTurnLimit, cap),
      })
      expect(t.io.files.has('/ws/should-not-run.txt')).toBe(false)
      const ordinary = bodies.at(-2)!
      const last = bodies.at(-1)!
      expect(last['tools']).toEqual([])
      expect(last['tool_choice']).toBe('auto')
      expect(last['instructions']).toBe(ordinary['instructions'])
      expect(wrapUpNotesOf(last)).toEqual([expect.stringContaining('limit of 3 model calls')])
      expect(t.session.history().items).toContainEqual(
        expect.objectContaining({ kind: 'agentMessage', text: 'Done; found a bug; tests remain' }),
      )
      expect(JSON.stringify(t.events)).not.toContain('Internal error')
      await t.session.sendTurn([{ type: 'text', text: 'Continue' }])
      await t.turnDone()
      expect(t.events.findLast((event) => event.type === 'turnCompleted')).toMatchObject({
        type: 'turnCompleted',
        terminal: 'completed',
      })
      expect(t.session.history().items).toContainEqual(
        expect.objectContaining({ kind: 'agentMessage', text: 'Continued answer' }),
      )
    } finally {
      await t.host.close()
    }
  })

  it('runs the only permitted call with tools: an answer completes, plainly', async () => {
    const t = await setup(1)
    try {
      t.api.script({ text: 'Two plus two is four.' })
      await t.session.sendTurn([{ type: 'text', text: 'What is 2+2?' }])
      await t.turnDone()
      const bodies = t.api.responseBodies()
      expect(bodies).toHaveLength(1)
      const only = bodies[0]!
      // The first call is always ordinary, even when it is also the last
      // one allowed: tools declared, no wrap-up note.
      expect((only['tools'] as unknown[]).length).toBeGreaterThan(0)
      expect(only['tool_choice']).toBe('auto')
      expect(wrapUpNotesOf(only)).toEqual([])
      expect(t.events.findLast((e) => e.type === 'turnCompleted')).toMatchObject({
        terminal: 'completed',
      })
      expect(t.events.findLast((e) => e.type === 'turnCompleted')).not.toHaveProperty('errorKind')
    } finally {
      await t.host.close()
    }
  })

  it('ends the only permitted call that asks for tools at the request cap, plainly', async () => {
    const t = await setup(1)
    try {
      t.api.script({ calls: [{ name: 'get_goal', arguments: '{}' }] })
      await t.session.sendTurn([{ type: 'text', text: 'Check the goal' }])
      await t.turnDone()
      const bodies = t.api.responseBodies()
      expect(bodies).toHaveLength(1)
      // No wrap-up exists before a call went out: the request cap is said
      // plainly, with no final answer kept.
      expect(t.events.findLast((e) => e.type === 'turnCompleted')).toMatchObject({
        terminal: 'completed',
        errorKind: 'max_turn_requests',
        reason: plural(UI_TEXT.modelApiTurnLimit, 1),
      })
    } finally {
      await t.host.close()
    }
  })

  it('stops a wrap-up cut at the output limit with its own sentence, never "again"', async () => {
    const t = await setup(2)
    try {
      t.api.script(
        { calls: [{ name: 'get_goal', arguments: '{}' }] },
        { text: 'Partial final', incomplete: { reason: 'max_output_tokens' } },
      )
      await t.session.sendTurn([{ type: 'text', text: 'Review' }])
      await t.turnDone()
      expect(t.api.responseBodies()).toHaveLength(2)
      const done = t.events.findLast((e) => e.type === 'turnCompleted')
      expect(done).toMatchObject({
        terminal: 'completed',
        errorKind: 'max_turn_requests',
        reason: plural(UI_TEXT.modelApiWrapUpTruncated, 2),
      })
      // The partial answer is kept, and the continuation-limit sentence
      // never appears for a wrap-up.
      expect(t.session.history().items).toContainEqual(
        expect.objectContaining({ kind: 'agentMessage', text: 'Partial final' }),
      )
      expect(JSON.stringify(t.events)).not.toContain(UI_TEXT.modelApiContinuationLimit)
    } finally {
      await t.host.close()
    }
  })

  it('holds steering arriving before the wrap-up for its own turn with tools', async () => {
    const t = await setup(2)
    try {
      const held = Promise.withResolvers<undefined>()
      const requested = Promise.withResolvers<undefined>()
      t.api.script(
        {
          calls: [{ name: 'get_goal', arguments: '{}' }],
          hold: held.promise,
          onRequest() {
            requested.resolve(undefined)
          },
        },
        { text: 'Wrap-up answer' },
        { text: 'Steered answer' },
      )
      const turn = await t.session.sendTurn([{ type: 'text', text: 'Review' }])
      await requested.promise
      await t.session.steer(turn.turnId, [{ type: 'text', text: 'Steered follow-up' }])
      held.resolve(undefined)
      await t.turnDone()
      await t.turnDone()
      const bodies = t.api.responseBodies()
      expect(bodies).toHaveLength(3)
      const [first, wrapUp, steered] = bodies as [
        Record<string, unknown>,
        Record<string, unknown>,
        Record<string, unknown>,
      ]
      // The wrap-up answers without the steer and without tools.
      expect(wrapUp['tools']).toEqual([])
      expect(wrapUp['instructions']).toBe(first['instructions'])
      expect(JSON.stringify(wrapUp['input'])).not.toContain('Steered follow-up')
      // The steer gets its own turn with tools, as before.
      expect((steered['tools'] as unknown[]).length).toBeGreaterThan(0)
      expect(JSON.stringify(steered['input'])).toContain('Steered follow-up')
      expect(wrapUpNotesOf(steered)).toEqual([])
      const completed = t.events.filter((e) => e.type === 'turnCompleted')
      expect(completed).toHaveLength(2)
      expect(completed[0]).toMatchObject({ terminal: 'completed', errorKind: 'max_turn_requests' })
      expect(completed[1]).toMatchObject({ terminal: 'completed' })
      expect(completed[1]).not.toHaveProperty('errorKind')
    } finally {
      await t.host.close()
    }
  })

  it('runs Stop hooks on a wrap-up turn but keeps the answer when one asks for more', async () => {
    const api = fakeModelApi()
    const log = new FakeLogOutputChannel()
    const client = fakeModelApiClient(api, log)
    const io = memoryToolIo({}, '/ws')
    io.runHook = () =>
      Promise.resolve({
        stdout: JSON.stringify({ decision: 'block', reason: 'keep working' }),
        stderr: '',
        exitCode: 0,
        isTimedOut: false,
        isCancelled: false,
      })
    const host = new ModelApiHost({
      ...fakeModelApiHostDeps({ client, io, log, workspaceRoot: '/ws' }),
      remainingModelCalls: () => 2,
      loadHooks: () =>
        Promise.resolve(
          parseHookConfig(
            JSON.stringify({
              hooks: { Stop: [{ hooks: [{ type: 'command', command: 'more' }] }] },
            }),
            'project',
            'linux',
          ).hooks,
        ),
    })
    const t = {
      api,
      host,
      ...(await startWatchedSession(host, '/ws', mspApprovalMode('acceptEdits'))),
    }
    try {
      api.script({ calls: [{ name: 'get_goal', arguments: '{}' }] }, { text: 'Wrap-up answer' })
      await t.session.sendTurn([{ type: 'text', text: 'Review' }])
      await t.turnDone()
      expect(api.responseBodies()).toHaveLength(2)
      // More work cannot be honoured past the limit: the answer stands,
      // the stop stays typed, and the notice says so.
      expect(t.events.findLast((e) => e.type === 'turnCompleted')).toMatchObject({
        terminal: 'completed',
        errorKind: 'max_turn_requests',
      })
      expect(t.events).toContainEqual({
        type: 'backendNotice',
        level: 'warning',
        text: UI_TEXT.modelApiWrapUpHookBlocked,
      })
      expect(t.session.history().items).toContainEqual(
        expect.objectContaining({ kind: 'agentMessage', text: 'Wrap-up answer' }),
      )
    } finally {
      await host.close()
    }
  })

  it('counts a shrunk allowance in the wrap-up limit it names', async () => {
    let allowance = 2
    const t = await setup(() => allowance)
    try {
      // The allowance shrinks after the first call went out: the wrap-up
      // still goes, naming one sent call plus one remaining.
      t.api.script(
        {
          calls: [{ name: 'get_goal', arguments: '{}' }],
          onRequest() {
            allowance = 1
          },
        },
        { text: 'Final answer' },
      )
      await t.session.sendTurn([{ type: 'text', text: 'Review' }])
      await t.turnDone()
      const bodies = t.api.responseBodies()
      expect(bodies).toHaveLength(2)
      const last = bodies.at(-1)!
      expect(last['tools']).toEqual([])
      expect(wrapUpNotesOf(last)).toEqual([expect.stringContaining('limit of 2 model calls')])
      expect(t.events.findLast((e) => e.type === 'turnCompleted')).toMatchObject({
        terminal: 'completed',
        errorKind: 'max_turn_requests',
      })
    } finally {
      await t.host.close()
    }
  })

  it('keeps the typed limit when a Stop hook answers continue:false on the wrap-up', async () => {
    const api = fakeModelApi()
    const log = new FakeLogOutputChannel()
    const client = fakeModelApiClient(api, log)
    const io = memoryToolIo({}, '/ws')
    io.runHook = () =>
      Promise.resolve({
        stdout: JSON.stringify({ continue: false, stopReason: 'halt now' }),
        stderr: '',
        exitCode: 0,
        isTimedOut: false,
        isCancelled: false,
      })
    const host = new ModelApiHost({
      ...fakeModelApiHostDeps({ client, io, log, workspaceRoot: '/ws' }),
      remainingModelCalls: () => 2,
      loadHooks: () =>
        Promise.resolve(
          parseHookConfig(
            JSON.stringify({
              hooks: { Stop: [{ hooks: [{ type: 'command', command: 'halt' }] }] },
            }),
            'project',
            'linux',
          ).hooks,
        ),
    })
    const t = {
      api,
      host,
      ...(await startWatchedSession(host, '/ws', mspApprovalMode('acceptEdits'))),
    }
    try {
      api.script({ calls: [{ name: 'get_goal', arguments: '{}' }] }, { text: 'Wrap-up answer' })
      await t.session.sendTurn([{ type: 'text', text: 'Review' }])
      await t.turnDone()
      expect(api.responseBodies()).toHaveLength(2)
      // The one exit: a Stop hook stopping the wrap-up still reports the
      // typed limit, and the answer stands.
      expect(t.events.findLast((e) => e.type === 'turnCompleted')).toMatchObject({
        terminal: 'completed',
        errorKind: 'max_turn_requests',
      })
      expect(t.session.history().items).toContainEqual(
        expect.objectContaining({ kind: 'agentMessage', text: 'Wrap-up answer' }),
      )
    } finally {
      await host.close()
    }
  })

  it('re-queues a goal wake held across the wrap-up for its own turn', async () => {
    const { MODEL_API_MODEL_TEXT } = await import('../../src/shared/constants')
    const t = await setup(2)
    try {
      const held = Promise.withResolvers<undefined>()
      const requested = Promise.withResolvers<undefined>()
      t.api.script(
        {
          calls: [{ name: 'get_goal', arguments: '{}' }],
          hold: held.promise,
          onRequest() {
            requested.resolve(undefined)
          },
        },
        { text: 'Wrap-up answer' },
        { text: 'Goal follow-up' },
      )
      const send = t.session.sendTurn([{ type: 'text', text: 'Review' }])
      await requested.promise
      // A goal accepted while the first request streams waits out the wrap-up.
      await t.session.controlGoal({ verb: 'set', objective: 'Ship it' })
      held.resolve(undefined)
      await send
      await t.turnDone()
      await t.turnDone()
      const bodies = t.api.responseBodies()
      expect(bodies).toHaveLength(3)
      const [first, wrapUp, woken] = bodies as [
        Record<string, unknown>,
        Record<string, unknown>,
        Record<string, unknown>,
      ]
      expect(first['tools']).not.toEqual([])
      // The wrap-up never consumes the wake: no wake text, no tools.
      expect(wrapUp['tools']).toEqual([])
      expect(JSON.stringify(wrapUp['input'])).not.toContain(MODEL_API_MODEL_TEXT.goalWake)
      // The wake arrives afterwards, on its own turn with tools.
      expect(JSON.stringify(woken['input'])).toContain(MODEL_API_MODEL_TEXT.goalWake)
      expect((woken['tools'] as unknown[]).length).toBeGreaterThan(0)
      const completed = t.events.filter((e) => e.type === 'turnCompleted')
      expect(completed).toHaveLength(2)
      expect(completed[0]).toMatchObject({ terminal: 'completed', errorKind: 'max_turn_requests' })
    } finally {
      await t.host.close()
    }
  })

  it('holds a scheduled steer arriving before the wrap-up for its own turn with tools', async () => {
    const { unattendedRun } = await import('./helpers/schedules/unattended')
    const { fakeRunContext } = await import('./helpers/schedules/fixtures')
    const t = await setup(2)
    try {
      const held = Promise.withResolvers<undefined>()
      const requested = Promise.withResolvers<undefined>()
      t.api.script(
        {
          calls: [{ name: 'get_goal', arguments: '{}' }],
          hold: held.promise,
          onRequest() {
            requested.resolve(undefined)
          },
        },
        { text: 'Wrap-up answer' },
        { text: 'Scheduled answer' },
      )
      const turn = await t.session.sendTurn([{ type: 'text', text: 'Review' }])
      await requested.promise
      const context = fakeRunContext()
      const { run } = unattendedRun({
        context: {
          ...context,
          grant: { ...context.grant, paidCapUsd: PortUsd.from(1).toAmount() },
        },
        paid: {
          modelId: 'muse-spark-1.3',
          accountId: FAKE_MODEL_API_ACCOUNT_ID,
          allows: (feature) => feature === 'scheduledPrompts',
          reserve: () =>
            Promise.resolve({
              claimId: 'paid-claim',
              reservedUsd: PortUsd.from(1).toAmount(),
              check: () => ({
                spentUsd: PortUsd.from(0).toAmount(),
                hasUnknownHistoricalFees: false,
              }),
              settle: () =>
                Promise.resolve({
                  spentUsd: PortUsd.from(0).toAmount(),
                  hasUnknownHistoricalFees: false,
                }),
            }),
        },
      })
      // The scheduled steer arrives while the first request streams: the
      // sibling drain must not feed it to the wrap-up.
      await t.session.steerScheduledTurn(
        turn.turnId,
        [{ type: 'text', text: 'Scheduled follow-up' }],
        run,
      )
      held.resolve(undefined)
      await t.turnDone()
      await t.turnDone()
      const bodies = t.api.responseBodies()
      expect(bodies).toHaveLength(3)
      const [first, wrapUp, scheduled] = bodies as [
        Record<string, unknown>,
        Record<string, unknown>,
        Record<string, unknown>,
      ]
      expect(first['tools']).not.toEqual([])
      expect(wrapUp['tools']).toEqual([])
      expect(JSON.stringify(wrapUp['input'])).not.toContain('Scheduled follow-up')
      // The scheduled steer gets its own turn with tools.
      expect((scheduled['tools'] as unknown[]).length).toBeGreaterThan(0)
      expect(JSON.stringify(scheduled['input'])).toContain('Scheduled follow-up')
      expect(wrapUpNotesOf(scheduled)).toEqual([])
      const completed = t.events.filter((e) => e.type === 'turnCompleted')
      expect(completed).toHaveLength(2)
      expect(completed[0]).toMatchObject({ terminal: 'completed', errorKind: 'max_turn_requests' })
    } finally {
      await t.host.close()
    }
  })

  it('still runs the Stop hook model on a wrap-up turn with no caller allowance', async () => {
    // Interactive turn, no caller allowance: hook-model calls use the
    // direct budget and never touch the turn's count, so they cannot take
    // the reserved slot and the gate stays off, whatever the turn limit says.
    const api = fakeModelApi()
    const log = new FakeLogOutputChannel()
    const client = fakeModelApiClient(api, log)
    const io = memoryToolIo({}, '/ws')
    const host = new ModelApiHost({
      ...fakeModelApiHostDeps({ client, io, log, workspaceRoot: '/ws' }),
      isPaidFeatureOn: (feature) => feature === 'hookModels',
      allowsPaidUse: () => Promise.resolve(true),
      loadHooks: () =>
        Promise.resolve(
          parseHookConfig(
            JSON.stringify({
              hooks: { Stop: [{ hooks: [{ type: 'prompt', prompt: 'Check the stop.' }] }] },
            }),
            'project',
            'linux',
          ).hooks,
        ),
    })
    const t = {
      api,
      host,
      ...(await startWatchedSession(host, '/ws', mspApprovalMode('acceptEdits'))),
    }
    try {
      api.script(...toolCallReplies(199), { text: 'Wrap-up answer' }, { text: '{}' })
      await t.session.sendTurn([{ type: 'text', text: 'Long review' }])
      await t.turnDone()
      // The hook model answered on the wrap-up turn: one hook-marked
      // request went out, and the stop stays typed.
      const hookMarked = api
        .responseBodies()
        .filter((body) => JSON.stringify(body).includes('hook of the Muse Spark'))
      expect(hookMarked).toHaveLength(1)
      expect(t.events.findLast((e) => e.type === 'turnCompleted')).toMatchObject({
        terminal: 'completed',
        errorKind: 'max_turn_requests',
      })
      expect(t.session.history().items).toContainEqual(
        expect.objectContaining({ kind: 'agentMessage', text: 'Wrap-up answer' }),
      )
    } finally {
      await host.close()
    }
  })

  it('renders the wrap-up note in the singular for a limit of 1', async () => {
    // A limit of 1 never reaches the wire (the first call is always
    // ordinary, and a wrap-up needs a call already out), but the template
    // keeps its count noun correct through the same slots the host fills.
    const { fill } = await import('../../src/shared/l10n/text')
    const { MODEL_API_MODEL_TEXT } = await import('../../src/shared/constants')
    expect(fill(MODEL_API_MODEL_TEXT.turnWrapUp, { limit: 1, calls: 'model call' })).toContain(
      'limit of 1 model call.',
    )
    expect(fill(MODEL_API_MODEL_TEXT.turnWrapUp, { limit: 2, calls: 'model calls' })).toContain(
      'limit of 2 model calls.',
    )
  })
})
