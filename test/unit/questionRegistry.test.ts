import { describe, expect, it, vi } from 'vitest'
import { QuestionRegistry, questionDeferSeconds } from '../../src/core/questions/registry'
import { OPEN_QUESTIONS_MAX } from '../../src/shared/constants'
import { FakeQuestionStore } from './helpers/questions/store'
import { registryHarness } from './helpers/questions/registry'
import { questionFixture } from './helpers/questions/fixtures'

async function settled(t: ReturnType<typeof registryHarness>) {
  await t.registry.ready()
  await vi.waitFor(() => {
    expect(t.session.deferQuestions).toHaveBeenCalled()
  })
}

describe('portable question registry', () => {
  it('gives a re-ask its own deferral when the preceding acknowledgement is still held', async () => {
    const t = registryHarness()
    const held = Promise.withResolvers<undefined>()
    t.session.holdDeferral(held.promise)
    await t.register('old', 10)
    const first = t.registry.defer('old')
    await vi.waitFor(() => {
      expect(t.session.deferQuestions).toHaveBeenCalledWith('old')
    })
    await t.registry.settle('old', 'deferred')
    const reask = await t.register('new', 10)
    expect(reask.deadlineAt).toBe(t.clock.now() + 10_000)
    t.clock.advance(10_000)
    await t.registry.ready()
    const beforeOldAcknowledgement = t.session.deferQuestions.mock.calls.map(([id]) => id)
    held.resolve(undefined)
    await first
    expect(beforeOldAcknowledgement).toEqual(['old', 'new'])
    expect(t.registry.snapshot().questions[0]?.state).toBe('open')
    expect(t.clock.pendingTimers).toBe(0)
  })

  it('publishes a terminal answer with one atomic save so a second-write failure cannot lose an unsent answer', async () => {
    const t = registryHarness()
    await t.register()
    await t.registry.defer('q-1')
    const save = t.store.save.getMockImplementation()
    if (save === undefined) throw new Error('missing fake save')
    t.store.save.mockClear()
    t.store.save
      .mockImplementationOnce(save)
      .mockRejectedValueOnce(new Error('second save refused'))
    const answering = t.registry.answer('q-1', {
      answers: [{ questionId: 'colour', selectedLabel: 'Blue' }],
    })
    await expect(answering).resolves.toBe('taken')
    expect(t.store.save).toHaveBeenCalledTimes(1)
    expect(await t.store.load('session-1')).toEqual(t.registry.snapshot().questions)
    expect(t.port.deliver).toHaveBeenCalledTimes(1)
  })

  it('restores disk and republishes the open state when publication fails after the atomic save', async () => {
    const t = registryHarness()
    await t.register()
    await t.registry.defer('q-1')
    const changed = t.port.changed
    vi.spyOn(t.port, 'changed').mockImplementationOnce((snapshot) => {
      changed(snapshot)
      throw new Error('publication refused')
    })
    await expect(
      t.registry.answer('q-1', { answers: [{ questionId: 'colour', selectedLabel: 'Blue' }] }),
    ).rejects.toThrow('publication refused')
    expect(t.port.deliver).not.toHaveBeenCalled()
    expect(await t.store.load('session-1')).toEqual(t.registry.snapshot().questions)
    expect(t.snapshots.at(-1)?.questions[0]?.state).toBe('open')
    const reloaded = new QuestionRegistry('session-1', 'modelApi', t.port)
    await reloaded.ready()
    expect(reloaded.snapshot().questions[0]?.state).toBe('open')
  })

  it('attempts every coalesced reply independently and retires the shared card only after all results', async () => {
    const t = registryHarness()
    await t.register('first')
    await t.register('second')
    const held = Promise.withResolvers<undefined>()
    const reply = vi
      .fn<typeof t.port.reply>()
      .mockRejectedValueOnce(new Error('lost first acknowledgement'))
      .mockReturnValueOnce(held.promise)
    vi.spyOn(t.port, 'reply').mockImplementation(reply)
    const answering = t.registry.answer('first', {
      answers: [{ questionId: 'colour', selectedLabel: 'Blue' }],
    })
    await t.registry.ready()
    await new Promise<void>((resolve) => {
      setImmediate(resolve)
    })
    const beforeSettlement = t.registry.snapshot()
    const lastPublication = t.snapshots.at(-1)
    const durableMark = await t.store.load('session-1')
    expect(durableMark).toEqual(t.registry.snapshot(false).questions)
    expect(durableMark).toEqual([])
    await t.registry.settle('first', 'answered')
    expect(t.registry.snapshot()).toEqual(beforeSettlement)
    held.resolve(undefined)
    expect(await answering).toBe('uncertain')
    expect(reply.mock.calls.map(([id]) => id)).toEqual(['first', 'second'])
    expect(beforeSettlement.questions[0]?.state).toBe('waiting')
    expect(lastPublication?.questions[0]?.state).toBe('waiting')
    expect(t.port.failed).toHaveBeenCalledTimes(1)
    expect(t.registry.snapshot().questions).toEqual([])
    expect(t.clock.pendingTimers).toBe(0)
    await t.registry.settle('second', 'answered')
    expect(t.registry.snapshot().questions).toEqual([])
  })

  it('defers on the injected 60-second clock and cancels its timer after an early answer', async () => {
    const t = registryHarness()
    const entry = await t.register()
    expect(entry.deadlineAt).toBe(61_000)
    t.clock.advance(59_999)
    expect(t.session.deferQuestions).not.toHaveBeenCalled()
    t.clock.advance(1)
    await settled(t)
    expect(t.session.deferQuestions).toHaveBeenCalledWith('q-1')
    expect(t.registry.snapshot().questions[0]?.state).toBe('open')
    await t.register('q-2', 60, false, 'A different question?')
    await t.registry.answer('q-2', { answers: [{ questionId: 'colour', selectedLabel: 'Blue' }] })
    expect(t.clock.pendingTimers).toBe(0)
    t.clock.advance(60_000)
    expect(t.session.deferQuestions).toHaveBeenCalledTimes(1)
    expect(t.session.answerQuestions).toHaveBeenCalledWith('q-2', [
      { questionId: 'colour', selectedLabel: 'Blue' },
    ])
  })

  it('never starts an interactive clock at zero, clamps five to ten, and freezes the deadline', async () => {
    expect(questionDeferSeconds(5)).toBe(10)
    expect(questionDeferSeconds(4000)).toBe(3600)
    expect(questionDeferSeconds(NaN)).toBe(60)
    expect(questionDeferSeconds(10.3)).toBe(60)
    const t = registryHarness()
    const never = await t.register('never', 0)
    expect(never.deadlineAt).toBeUndefined()
    t.clock.advance(3_600_000)
    expect(t.session.deferQuestions).not.toHaveBeenCalled()
    const ten = await t.register('ten', 5, false, 'Another?')
    expect(ten.deadlineAt).toBe(t.clock.now() + 10_000)
    t.clock.advance(10_000)
    await settled(t)
    expect(t.session.deferQuestions).toHaveBeenCalledWith('ten')
  })

  it.each([0, 60])(
    'scheduled questions defer at once even with interactive value %i',
    async (seconds) => {
      const t = registryHarness()
      await t.register('scheduled', seconds, true)
      t.clock.advance(0)
      await settled(t)
      expect(t.session.deferQuestions).toHaveBeenCalledWith('scheduled')
      expect(t.registry.snapshot().questions[0]?.state).toBe('open')
    },
  )

  it('expires the oldest of twenty-one open questions and retires terminal records after publication', async () => {
    const t = registryHarness()
    for (let index = 0; index <= OPEN_QUESTIONS_MAX; index += 1) {
      await t.register(`q-${String(index)}`, 0, false, `Question ${String(index)}?`)
      await t.registry.defer(`q-${String(index)}`)
      t.clock.advance(1)
    }
    expect(t.registry.snapshot().questions).toHaveLength(OPEN_QUESTIONS_MAX)
    expect(
      t.snapshots.some((snapshot) =>
        snapshot.questions.some(
          (entry) => entry.userInputId === 'q-0' && entry.state === 'expired',
        ),
      ),
    ).toBe(true)
    expect(await t.store.load('session-1')).toHaveLength(OPEN_QUESTIONS_MAX)
  })

  it('reloads waiting questions as open, preserves open ones, and deletes only its session', async () => {
    const t = registryHarness()
    await t.register()
    const reloaded = new QuestionRegistry('session-1', 'modelApi', t.port)
    await reloaded.ready()
    expect(reloaded.snapshot().questions[0]).toMatchObject({
      userInputId: 'q-1',
      state: 'open',
      deferredAt: t.clock.now(),
    })
    await t.store.save('other', [questionFixture({ sessionId: 'other' })])
    await reloaded.remove()
    expect(await t.store.load('session-1')).toEqual([])
    expect(await t.store.load('other')).toHaveLength(1)
    t.registry.dispose()
  })

  it('rejects corrupt storage instead of pretending to load an empty registry', async () => {
    const store = new FakeQuestionStore()
    store.files.set('session-1', { invalid: true })
    await expect(registryHarness(store).registry.ready()).rejects.toThrow(
      'invalid fake question store',
    )
  })

  it('coalesces waiting requests and a re-ask, answering fresh IDs without a late message', async () => {
    const t = registryHarness()
    await t.register()
    const duplicate = await t.registry.register(
      {
        userInputId: 'q-2',
        itemId: 'item-2',
        turnId: 'turn-1',
        questions: questionFixture().questions.map((question) => ({
          ...question,
          id: 'fresh-colour',
          options: [{ label: ' BLUE ' }, { label: 'green' }],
        })),
      },
      60,
    )
    expect(duplicate.userInputId).toBe('q-1')
    expect(t.registry.snapshot().questions).toHaveLength(1)
    await t.registry.answer('q-1', { answers: [{ questionId: 'colour', selectedLabel: 'Blue' }] })
    expect(t.session.answerQuestions).toHaveBeenCalledTimes(2)
    expect(t.session.answerQuestions).toHaveBeenCalledWith('q-2', [
      { questionId: 'fresh-colour', selectedLabel: ' BLUE ' },
    ])
    expect(t.port.deliver).not.toHaveBeenCalled()
    await t.register('q-3')
    await t.registry.defer('q-3')
    await t.register('q-4')
    await t.registry.answer('q-3', { explanation: 'Green please.' })
    expect(t.session.clarifyQuestions).toHaveBeenCalledWith('q-4', 'Green please.')
    expect(t.snapshots.at(-1)?.questions[0]?.state).toBe('answeredOnReask')
    expect(t.port.deliver).not.toHaveBeenCalled()
  })

  it('a failed/interrupted turn retains a waiting question; an explicit Stop cancels it', async () => {
    const t = registryHarness()
    await t.register('failed', 60)
    await t.registry.endTurn('turn-1', false, false)
    expect(t.registry.snapshot().questions[0]?.state).toBe('open')
    await t.register('stopped', 60, false, 'Stop?', 'turn-2')
    await t.registry.endTurn('turn-2', true, false)
    expect(
      t.snapshots.some((snapshot) =>
        snapshot.questions.some(
          (entry) => entry.userInputId === 'stopped' && entry.state === 'cancelled',
        ),
      ),
    ).toBe(true)
    expect(t.clock.pendingTimers).toBe(0)
  })
})

it('freezes the first deadline through matching arrivals and preserves future settlement outcomes as open', async () => {
  const t = registryHarness()
  const first = await t.register('first', 60)
  t.clock.advance(10_000)
  const duplicate = await t.register('second', 0)
  expect(duplicate.deadlineAt).toBe(first.deadlineAt)
  const changedSetting = await t.register('third', 10)
  expect(changedSetting.deadlineAt).toBe(first.deadlineAt)
  expect(t.registry.snapshot().questions).toHaveLength(1)
  await t.registry.settle('first', 'a-future-word')
  expect(t.registry.snapshot().questions[0]?.state).toBe('waiting')
  await t.registry.settle('second', 'a-future-word')
  expect(t.registry.snapshot().questions[0]?.state).toBe('waiting')
  await t.registry.settle('third', 'a-future-word')
  expect(t.registry.snapshot().questions[0]?.state).toBe('open')
  t.clock.advance(60_000)
  expect(t.session.deferQuestions).not.toHaveBeenCalled()
})

it('validates the loaded session envelope even when a store port returns another session', async () => {
  const store = new FakeQuestionStore()
  store.load.mockResolvedValueOnce([questionFixture({ sessionId: 'another-session' })])
  await expect(registryHarness(store).registry.ready()).rejects.toThrow()
})

it('disposal cancels the clock and rejects further mutation instead of sending untracked work', async () => {
  const t = registryHarness()
  await t.register()
  t.registry.dispose()
  expect(t.clock.pendingTimers).toBe(0)
  t.clock.advance(60_000)
  await expect(t.register('after-disposal')).rejects.toThrow()
  expect(t.session.deferQuestions).not.toHaveBeenCalled()
})

it('does not replace an existing request ID with a new key or a new deadline', async () => {
  const t = registryHarness()
  const first = await t.register('same-id', 60)
  t.clock.advance(10_000)
  expect(await t.register('same-id', 10, false, 'Changed text?')).toEqual(first)
  expect(t.registry.snapshot().questions).toHaveLength(1)
})

it('reports a deadline storage failure without repeatedly rearming an expired timer', async () => {
  const t = registryHarness()
  await t.register()
  t.store.save.mockRejectedValue(new Error('write refused'))
  t.clock.advance(60_000)
  await vi.waitFor(() => {
    expect(t.port.failed).toHaveBeenCalledTimes(1)
  })
  expect(t.clock.pendingTimers).toBe(0)
  t.clock.advance(0)
  await t.registry.ready()
  expect(t.port.failed).toHaveBeenCalledTimes(1)
  expect(t.session.deferQuestions).not.toHaveBeenCalled()
  expect(t.registry.snapshot().questions[0]?.state).toBe('waiting')
})
