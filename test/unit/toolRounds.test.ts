import { describe, expect, it } from 'vitest'
import {
  ChildTaskRefusedError,
  ContextOverflowError,
  HookCancelledError,
  ModelApiHost,
  canReserveSideSlot,
  releaseSideSlotToken,
  takeSideSlotToken,
  type SideSlotReservation,
  type SideSlotToken,
  wrapUpFailedKindFor,
} from '../../src/core/backends/modelapi/ModelApiHost'
import {
  ModelCallLimitError,
  SessionBudgetExceededError,
  wrapUpFailedLimit,
} from '../../src/core/backends/modelapi/sessionBudget'
import { ModelApiError } from '../../src/core/backends/modelapi/transport'
import {
  HOOK_AGENT_MAX_STEPS,
  MODEL_API_MAX_TOOL_ROUNDS,
  MODEL_API_MODEL_TEXT,
  UI_TEXT,
} from '../../src/shared/constants'
import { mspApprovalMode } from '../../src/shared/permissionModes'
import { plural } from '../../src/shared/l10n/text'
import { parseHookConfig } from '../../src/core/backends/modelapi/hooks'
import { Usd as PortUsd } from '../../src/shared/usd'
import {
  FAKE_MODEL_API_ACCOUNT_ID,
  fakeModelApi,
  fakeModelApiClient,
  type ScriptedReply,
} from './helpers/fakeModelApi'
import { memoryToolIo } from './helpers/fakeToolIo'
import { fakeModelApiHostDeps } from './helpers/modelApiHostDeps'
import { FakeLogOutputChannel } from './helpers/fakes'
import { startWatchedSession } from './helpers/sessionTurns'
import type { MediaReplayPort } from '../../src/core/media/replayMedia'

function remainingCalls(cap: number | (() => number) | undefined): (() => number) | undefined {
  if (typeof cap === 'function') return cap
  return cap === undefined ? undefined : () => cap
}

async function setup(cap?: number | (() => number), changes?: Record<string, unknown>) {
  const api = fakeModelApi()
  const log = new FakeLogOutputChannel()
  const client = fakeModelApiClient(api, log)
  const io = memoryToolIo({}, '/ws')
  const host = new ModelApiHost({
    ...fakeModelApiHostDeps({ client, io, log, workspaceRoot: '/ws' }),
    remainingModelCalls: remainingCalls(cap),
    ...changes,
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
      // byte-identical to the last ordinary call, tools and tool choice
      // omitted alike, the note a trailing input item.
      expect(last).not.toHaveProperty('tools')
      expect(last).not.toHaveProperty('tool_choice')
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
      expect(last).not.toHaveProperty('tools')
      expect(last).not.toHaveProperty('tool_choice')
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
      expect(last).not.toHaveProperty('tools')
      expect(last).not.toHaveProperty('tool_choice')
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
      // The wrap-up answers without the steer and without tools or choice.
      expect(wrapUp).not.toHaveProperty('tools')
      expect(wrapUp).not.toHaveProperty('tool_choice')
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
      expect(last).not.toHaveProperty('tools')
      expect(last).not.toHaveProperty('tool_choice')
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
      // The wrap-up never consumes the wake: no wake text, no tools, no choice.
      expect(wrapUp).not.toHaveProperty('tools')
      expect(wrapUp).not.toHaveProperty('tool_choice')
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
      expect(wrapUp).not.toHaveProperty('tools')
      expect(wrapUp).not.toHaveProperty('tool_choice')
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

  it('names the fixed kind of every wrap-up-request failure', () => {
    expect(wrapUpFailedKindFor(new SessionBudgetExceededError('budget'))).toBe('budget')
    expect(wrapUpFailedKindFor(new HookCancelledError('halt'))).toBe('stopped')
    // A 429 that reaches the loop unretried (quota, an over-cap
    // Retry-After, a status the format's table does not retry) is still
    // rate limited, not a model error.
    expect(wrapUpFailedKindFor(new ModelApiError('rate limited', 429, undefined, undefined))).toBe(
      'rateLimited',
    )
    expect(wrapUpFailedKindFor(new ModelApiError('boom', 500, undefined, undefined))).toBe(
      'modelError',
    )
    expect(wrapUpFailedKindFor(new Error('boom'))).toBe('modelError')
    // An already-named limit, the overflow's typed path, a child's refusal
    // and a non-error keep their own shape.
    expect(wrapUpFailedKindFor(new ModelCallLimitError(2))).toBeUndefined()
    expect(
      wrapUpFailedKindFor(new ContextOverflowError('error', 'model', undefined)),
    ).toBeUndefined()
    expect(wrapUpFailedKindFor(new ChildTaskRefusedError('requestLimit'))).toBeUndefined()
    expect(wrapUpFailedKindFor('nope')).toBeUndefined()
    const failed = wrapUpFailedLimit(2, 'rateLimited')
    expect(failed).toBeInstanceOf(ModelCallLimitError)
    expect(failed.wrapUpFailed).toBe('rateLimited')
    expect(failed.message).toBe(
      plural(UI_TEXT.modelApiWrapUpFailed, 2, {
        reason: UI_TEXT.modelApiWrapUpFailedReason.rateLimited,
      }),
    )
  })

  it('refuses a racing second side slot with two calls left', () => {
    const reservation: SideSlotReservation = { reserved: 0 }
    // The first concurrent side call takes the reservation synchronously.
    expect(canReserveSideSlot(reservation, 2)).toBe(true)
    expect(reservation.reserved).toBe(1)
    // The racer sees one left and refuses, so the turn's last request stays
    // the wrap-up; the take and the refusal are one synchronous block.
    expect(canReserveSideSlot(reservation, 2)).toBe(false)
    expect(reservation.reserved).toBe(1)
    // With one call left even the first refuses.
    expect(canReserveSideSlot({ reserved: 0 }, 1)).toBe(false)
  })

  it('takes a side slot for exactly one of two parallel side calls, releasing only its own', async () => {
    const reservation: SideSlotReservation = { reserved: 0 }
    // Two side calls race from parallel tool calls through the same
    // take/give the host uses: takes run to completion, so the first
    // takes and the second refuses, and each give releases its own.
    async function sideCall(): Promise<'ran' | 'refused'> {
      const token = takeSideSlotToken(reservation, 2)
      if (token === undefined) return 'refused'
      await new Promise((resolve) => setImmediate(resolve))
      releaseSideSlotToken(reservation, token)
      return 'ran'
    }
    const [first, second] = await Promise.all([sideCall(), sideCall()])
    expect(new Set([first, second])).toEqual(new Set(['ran', 'refused']))
    expect(reservation.reserved).toBe(0)
    // A ledger-free take returns a zero token that releases nothing...
    const free: SideSlotToken = { count: 0 }
    releaseSideSlotToken(reservation, free)
    expect(reservation.reserved).toBe(0)
    // ...while a multi-step hook agent reserves its maximum steps up front:
    // with three calls left five do not fit, and nothing is held.
    expect(takeSideSlotToken({ reserved: 0 }, 3, HOOK_AGENT_MAX_STEPS)).toBeUndefined()
    const roomy: SideSlotReservation = { reserved: 0 }
    const agent = takeSideSlotToken(roomy, 7, HOOK_AGENT_MAX_STEPS)
    expect(agent).toEqual({ count: HOOK_AGENT_MAX_STEPS })
    expect(roomy.reserved).toBe(HOOK_AGENT_MAX_STEPS)
    releaseSideSlotToken(roomy, agent!)
    expect(roomy.reserved).toBe(0)
  })

  it('refuses a 3-step hook agent on an exec ledger of 3 and still runs the wrap-up', async () => {
    // By construction the caller's last call can only be spent by the
    // wrap-up builder: the agent reserves its maximum steps up front, so
    // with three calls left it never starts — no hook request goes out.
    const t = await setup(3, {
      isPaidFeatureOn: () => true,
      allowsPaidUse: () => Promise.resolve(true),
      loadHooks: () =>
        Promise.resolve(
          parseHookConfig(
            JSON.stringify({
              hooks: {
                PreToolUse: [
                  {
                    hooks: [
                      {
                        type: 'agent',
                        prompt: 'Check the call.',
                        matcher: 'get_goal',
                      },
                    ],
                  },
                ],
              },
            }),
            'project',
            'linux',
          ).hooks,
        ),
    })
    try {
      t.api.script(
        { calls: [{ name: 'get_goal', arguments: '{}', callId: 'first' }] },
        { calls: [{ name: 'get_goal', arguments: '{}', callId: 'second' }] },
        { text: 'Done, found, remaining.' },
      )
      await t.session.sendTurn([{ type: 'text', text: 'Review within the limit' }])
      await t.turnDone()
      // The turn's own three requests went out (two tool rounds and the
      // wrap-up); the hook agent sent none.
      const bodies = t.api.responseBodies()
      expect(bodies).toHaveLength(3)
      const last = bodies.at(-1)!
      expect(last).not.toHaveProperty('tools')
      expect(last).not.toHaveProperty('tool_choice')
      expect(wrapUpNotesOf(last)).toEqual([expect.stringContaining('limit of 3 model calls')])
      expect(t.events.findLast((e) => e.type === 'turnCompleted')).toMatchObject({
        terminal: 'completed',
        errorKind: 'max_turn_requests',
      })
      expect(t.session.history().items).toContainEqual(
        expect.objectContaining({ text: 'Done, found, remaining.' }),
      )
    } finally {
      await t.host.close()
    }
  })

  it('leaves a first-call overflow standing on a single-call allowance', async () => {
    // A caller allowance of 1 leaves no room for both a recovery compaction
    // and the wrap-up: the loop skips compaction outright, and overflow
    // recovery refuses the reserved slot, so the overflow stands typed.
    const api = fakeModelApi()
    const log = new FakeLogOutputChannel()
    const client = fakeModelApiClient(api, log)
    const io = memoryToolIo({}, '/ws')
    let admissions = 0
    const model = { window: 100_000 }
    const host = new ModelApiHost({
      ...fakeModelApiHostDeps({ client, io, log, workspaceRoot: '/ws' }),
      remainingModelCalls: () => 1,
      contextModel: () => ({ format: 'responses', contextTokens: model.window }),
      autoCompaction: () => true,
      autoCompactionEvaluated: () => true,
      admitAutoCompaction: () => {
        admissions += 1
        return Promise.resolve({
          guard: Object.assign(() => undefined, { onRequestStarted: () => undefined }),
          settle: () => undefined,
        })
      },
    })
    const t = {
      api,
      host,
      ...(await startWatchedSession(host, '/ws', mspApprovalMode('acceptEdits'))),
    }
    try {
      // A small tool round first, under the wide window: compactable history
      // and a stored prefix, so only the reserved-slot refusal stands
      // between the next turn's overflow and a real recovery compaction.
      api.script({ calls: [{ name: 'get_goal', arguments: '{}' }] })
      await t.session.sendTurn([{ type: 'text', text: 'Seed the history' }])
      await t.turnDone()
      // Shrink the window below the stored context: the next turn's only
      // permitted call overflows before it is sent.
      model.window = 64
      api.script({ text: 'summary one' }, { text: 'summary two' })
      await t.session.sendTurn([{ type: 'text', text: 'Review' }])
      await t.turnDone()
      // No compaction ran (neither in-loop, skipped for the single slot, nor
      // recovery, refused for it): the only request is the seed tool call,
      // and the turn ends on the overflow's own stop.
      expect(t.api.responseBodies()).toHaveLength(1)
      expect(admissions).toBe(0)
      expect(t.events.findLast((e) => e.type === 'turnCompleted')).toMatchObject({
        terminal: 'failed',
        errorKind: 'context_overflow',
        reason: UI_TEXT.contextWindowFull,
      })
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

  it.each([
    {
      path: 'first attempt',
      cap: 4,
      script: () => [...toolCallReplies(3), { text: 'Wrap-up answer' }],
    },
    {
      path: 'first attempt',
      cap: 2,
      script: () => [...toolCallReplies(1), { text: 'Wrap-up answer' }],
    },
    {
      path: 'HTTP 429 retry',
      cap: 4,
      script: () => [
        ...toolCallReplies(1),
        { httpError: { status: 429 } },
        ...toolCallReplies(1),
        { text: 'Wrap-up answer' },
      ],
    },
    {
      path: 'HTTP 429 retry',
      cap: 3,
      script: () => [
        ...toolCallReplies(1),
        { httpError: { status: 429 } },
        { text: 'Wrap-up answer' },
      ],
    },
    {
      path: 'HTTP 5xx retry',
      cap: 4,
      script: () => [
        ...toolCallReplies(1),
        { httpError: { status: 500 } },
        ...toolCallReplies(1),
        { text: 'Wrap-up answer' },
      ],
    },
    {
      path: 'HTTP 5xx retry',
      cap: 3,
      script: () => [
        ...toolCallReplies(1),
        { httpError: { status: 500 } },
        { text: 'Wrap-up answer' },
      ],
    },
    {
      path: 'whole-stream retry',
      cap: 4,
      script: () => [
        ...toolCallReplies(1),
        { text: 'partial', streamError: { code: 'server_shutting_down', message: 'draining' } },
        ...toolCallReplies(1),
        { text: 'Wrap-up answer' },
      ],
    },
    {
      path: 'whole-stream retry',
      cap: 3,
      script: () => [
        ...toolCallReplies(1),
        { text: 'partial', streamError: { code: 'server_shutting_down', message: 'draining' } },
        { text: 'Wrap-up answer' },
      ],
    },
  ])('sends the last permitted call as the wrap-up after a $path', async ({ cap, script }) => {
    const t = await setup(cap)
    try {
      t.api.script(...script())
      await t.session.sendTurn([{ type: 'text', text: 'Review' }])
      await t.turnDone()
      const bodies = t.api.responseBodies()
      const last = bodies.at(-1)!
      // Whatever failure preceded it, the last permitted call answers
      // without tools or tool choice and carries the wrap-up note; the
      // turn ends with the wrap-up text under the typed limit.
      expect(last).not.toHaveProperty('tools')
      expect(last).not.toHaveProperty('tool_choice')
      expect(wrapUpNotesOf(last)).toEqual([
        expect.stringContaining(`limit of ${String(cap)} model calls`),
      ])
      expect(t.events.findLast((e) => e.type === 'turnCompleted')).toMatchObject({
        terminal: 'completed',
        errorKind: 'max_turn_requests',
      })
      expect(t.session.history().items).toContainEqual(
        expect.objectContaining({ kind: 'agentMessage', text: 'Wrap-up answer' }),
      )
      expect(JSON.stringify(t.events)).not.toContain('Internal error')
    } finally {
      await t.host.close()
    }
  })

  it('sends the last permitted call as the wrap-up after media recovery', async () => {
    const api = fakeModelApi()
    const log = new FakeLogOutputChannel()
    const client = fakeModelApiClient(api, log)
    const io = memoryToolIo({}, '/ws')
    const host = new ModelApiHost({
      ...fakeModelApiHostDeps({ client, io, log, workspaceRoot: '/ws' }),
      remainingModelCalls: () => 3,
      // The seam `createMediaReplay` owns: recover once, then stay out. Every
      // other port method is an undefined-returning no-op, which the host's
      // `??` fallbacks absorb for a turn carrying no media.
      createMediaReplay: () => {
        const methods: Record<string, (() => unknown) | undefined> = {
          recover: () => Promise.resolve(true),
        }
        // The cast below is the test-only media stub (a Proxy cannot carry
        // the port's method types). Reason recorded in PLAN.md §8.
        return new Proxy(methods, {
          get: (target, prop) =>
            typeof prop === 'string' ? (target[prop] ?? (() => undefined)) : undefined,
        }) as unknown as MediaReplayPort
      },
    })
    const t = {
      api,
      host,
      ...(await startWatchedSession(host, '/ws', mspApprovalMode('acceptEdits'))),
    }
    try {
      // A non-retryable stream failure recovered by the media port rebuilds
      // through the same request builder, so the last slot is the wrap-up.
      t.api.script(
        { calls: [{ name: 'get_goal', arguments: '{}' }] },
        { text: 'partial', streamError: { code: 'bad_request', message: 'invalid' } },
        { text: 'Wrap-up answer' },
      )
      await t.session.sendTurn([{ type: 'text', text: 'Review' }])
      await t.turnDone()
      const bodies = t.api.responseBodies()
      expect(bodies).toHaveLength(3)
      const last = bodies.at(-1)!
      expect(last).not.toHaveProperty('tools')
      expect(last).not.toHaveProperty('tool_choice')
      expect(wrapUpNotesOf(last)).toEqual([expect.stringContaining('limit of 3 model calls')])
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

  // A money cell is not drivable in this harness: a capped session budget
  // needs a durable budget journal, which the fake host deps have no knob
  // for (without one the first request already fails with the
  // store-unavailable stop). The budget kind mapping is unit-tested, and
  // the budget failure flows through the same one exit the cells below
  // prove; the loop-level driver belongs to the ledger lane.
  interface WrapUpLoss {
    readonly kind: string
    readonly changes?: Record<string, unknown>
    readonly hooks?: true
    readonly script: () => readonly ScriptedReply[]
    readonly terminal: 'completed' | 'failed'
    readonly errorKind: string
    readonly reason: string
  }
  it.each([
    {
      kind: 'rate limit',
      script: () => [{ httpError: { status: 429 } }] as const,
      terminal: 'completed',
      errorKind: 'max_turn_requests',
      reason: plural(UI_TEXT.modelApiWrapUpFailed, 2, {
        reason: UI_TEXT.modelApiWrapUpFailedReason.rateLimited,
      }),
    },
    {
      kind: 'model error',
      script: () => [{ httpError: { status: 400 } }] as const,
      terminal: 'completed',
      errorKind: 'max_turn_requests',
      reason: plural(UI_TEXT.modelApiWrapUpFailed, 2, {
        reason: UI_TEXT.modelApiWrapUpFailedReason.modelError,
      }),
    },
    {
      kind: 'repeated model error',
      script: () => [{ httpError: { status: 500 } }] as const,
      terminal: 'completed',
      errorKind: 'max_turn_requests',
      reason: plural(UI_TEXT.modelApiWrapUpFailed, 2, {
        reason: UI_TEXT.modelApiWrapUpFailedReason.modelError,
      }),
    },
    {
      kind: 'context overflow',
      script: () =>
        [
          {
            httpError: {
              status: 400,
              body: { error: { message: 'maximum context length exceeded' } },
            },
          },
        ] as const,
      terminal: 'failed',
      errorKind: 'context_overflow',
      reason: UI_TEXT.contextWindowFull,
    },
    {
      kind: 'hook stop',
      // A Stop hook answering continue:false after the wrap-up answer ends
      // the turn at its limit through the same one exit.
      changes: {
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
      },
      hooks: true,
      script: () => [{ text: 'Wrap-up answer' }] as const,
      terminal: 'completed',
      errorKind: 'max_turn_requests',
      reason: plural(UI_TEXT.modelApiTurnLimit, 2),
    },
  ] satisfies WrapUpLoss[])(
    're-queues held input when a wrap-up is lost to a $kind, then ends the turn',
    async ({ script, terminal, errorKind, reason, changes, hooks }) => {
      const t = await setup(2, changes)
      try {
        const held = Promise.withResolvers<undefined>()
        const requested = Promise.withResolvers<undefined>()
        if (hooks === true) {
          let hasBlocked = false
          t.io.runHook = () => {
            const isFirst = !hasBlocked
            hasBlocked = true
            return Promise.resolve({
              stdout: isFirst ? JSON.stringify({ continue: false, stopReason: 'halt now' }) : '{}',
              stderr: '',
              exitCode: 0,
              isTimedOut: false,
              isCancelled: false,
            })
          }
        }
        t.api.script(
          {
            calls: [{ name: 'get_goal', arguments: '{}' }],
            hold: held.promise,
            onRequest() {
              requested.resolve(undefined)
            },
          },
          ...script(),
          { text: 'Goal follow-up' },
        )
        const send = t.session.sendTurn([{ type: 'text', text: 'Review' }])
        await requested.promise
        // A goal accepted while the first request streams waits out the
        // wrap-up; whatever ends the wrap-up, the wake keeps its own turn.
        await t.session.controlGoal({ verb: 'set', objective: 'Ship it' })
        held.resolve(undefined)
        await send
        await t.turnDone()
        await t.turnDone()
        const bodies = t.api.responseBodies()
        // The failed request is the wrap-up itself: no tools, no choice,
        // the note, and no retry with tools afterwards.
        expect(bodies).toHaveLength(3)
        const [, wrapUp, woken] = bodies as [
          Record<string, unknown>,
          Record<string, unknown>,
          Record<string, unknown>,
        ]
        expect(wrapUp).not.toHaveProperty('tools')
        expect(wrapUp).not.toHaveProperty('tool_choice')
        expect(wrapUpNotesOf(wrapUp)).toContainEqual(
          expect.stringContaining('limit of 2 model calls'),
        )
        const completed = t.events.filter((e) => e.type === 'turnCompleted')
        expect(completed).toHaveLength(2)
        expect(completed[0]).toMatchObject({ terminal, errorKind, reason })
        // ...and the held wake still gets its own turn with tools.
        expect(JSON.stringify(woken['input'])).toContain(MODEL_API_MODEL_TEXT.goalWake)
        expect((woken['tools'] as unknown[]).length).toBeGreaterThan(0)
        expect(completed[1]).toMatchObject({ terminal: 'completed' })
        expect(completed[1]).not.toHaveProperty('errorKind')
        expect(t.session.history().items).toContainEqual(
          expect.objectContaining({ kind: 'agentMessage', text: 'Goal follow-up' }),
        )
      } finally {
        await t.host.close()
      }
    },
  )

  it('refuses an image on a caller allowance the old gate could not see', async () => {
    const api = fakeModelApi()
    const log = new FakeLogOutputChannel()
    const client = fakeModelApiClient(api, log)
    const io = memoryToolIo({}, '/ws')
    const host = new ModelApiHost({
      ...fakeModelApiHostDeps({ client, io, log, workspaceRoot: '/ws' }),
      // Past the feature switch and paid consent so the call reaches the
      // reserved-slot gate.
      isPaidFeatureOn: (feature) => feature === 'imageGeneration',
      allowsPaidUse: () => Promise.resolve(true),
    })
    // Production ACP-style: no remainingModelCalls dep, the allowance bound
    // by hand. The old gate read only the dep and would have let this
    // through; the reserved-slot check refuses it.
    const t = {
      api,
      host,
      // allowAll so the image call reaches execution (and its slot gate)
      // instead of stopping at approval.
      ...(await startWatchedSession(host, '/ws', 'allowAll')),
    }
    t.session.setModelCallAllowance(() => 1)
    const approvals: Promise<void>[] = []
    t.session.onEvent((event) => {
      if (event.type !== 'approvalRequested' || event.isReplayed === true) return
      approvals.push(
        t.session.decideApproval({
          approvalId: event.approvalId,
          requirementId: event.requirementId,
          choiceId: 'allow_once',
        }),
      )
    })
    try {
      t.api.script({
        calls: [
          {
            name: 'generate_image',
            arguments: '{"path":"logo.png","prompt":"a logo"}',
          },
        ],
      })
      await t.session.sendTurn([{ type: 'text', text: 'Draw the logo' }])
      await t.turnDone()
      await Promise.all(approvals)
      expect(JSON.stringify(t.session.history().items)).toContain(UI_TEXT.modelApiWrapUpReserved)
      expect(t.events.findLast((e) => e.type === 'turnCompleted')).toMatchObject({
        terminal: 'completed',
        errorKind: 'max_turn_requests',
      })
    } finally {
      await host.close()
    }
  })
})
