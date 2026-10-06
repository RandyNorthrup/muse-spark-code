import { describe, expect, it, vi } from 'vitest'
import { lateAnswer } from '../../src/core/questions/lateAnswer'
import { LATE_ANSWER_QUESTION_MAX_CHARS, UI_TEXT } from '../../src/shared/constants'
import { registryHarness } from './helpers/questions/registry'
import { questionFixture } from './helpers/questions/fixtures'

const reply = { answers: [{ questionId: 'colour', selectedLabel: 'Blue' }] }

async function opened() {
  const t = registryHarness()
  await t.register()
  await t.registry.defer('q-1')
  return t
}

describe('late answers and lazy dismissals', () => {
  it('marks durably before dispatch, so two surfaces and double clicks send once', async () => {
    const t = await opened()
    const held = Promise.withResolvers<'taken'>()
    const deliver = vi.fn(() => held.promise)
    t.port.deliver = deliver
    const first = t.registry.answer('q-1', reply)
    await vi.waitFor(() => {
      expect(deliver).toHaveBeenCalledTimes(1)
    })
    const saved = await t.store.load('session-1')
    expect(saved.some((entry) => entry.state === 'open')).toBe(false)
    await expect(t.registry.answer('q-1', reply)).rejects.toThrow(UI_TEXT.answerNotAccepted)
    held.resolve('taken')
    expect(await first).toBe('taken')
    expect(deliver).toHaveBeenCalledWith(
      expect.objectContaining({
        text: 'Answer to your earlier question q-1\nQuestion:\nWhich colour?\nThe user answered:\n[{"questionId":"colour","selectedLabel":"Blue"}]',
        displayText: 'Answer to your earlier question: Colour',
      }),
    )
  })

  it('restores only a proven non-admission; an exception or uncertainty never retries', async () => {
    const t = await opened()
    t.port.deliver = vi.fn<typeof t.port.deliver>(() => Promise.resolve('notTaken'))
    expect(await t.registry.answer('q-1', reply)).toBe('notTaken')
    expect(t.registry.snapshot().questions[0]?.state).toBe('open')
    t.port.deliver = vi.fn<typeof t.port.deliver>(() => Promise.reject(new Error('lost ack')))
    expect(await t.registry.answer('q-1', reply)).toBe('uncertain')
    expect(t.registry.snapshot().questions).toEqual([])
    await expect(t.registry.answer('q-1', reply)).rejects.toThrow()
  })

  it('sends nothing if the durable mark fails and leaves the question answerable', async () => {
    const t = await opened()
    t.store.failNextSave = true
    await expect(t.registry.answer('q-1', reply)).rejects.toThrow('write failed')
    expect(t.port.deliver).not.toHaveBeenCalled()
    expect(t.registry.snapshot().questions[0]?.state).toBe('open')
    expect(await t.registry.answer('q-1', reply)).toBe('taken')
  })

  it('rejects missing/duplicate IDs, invented labels, ambiguous or out-of-bounds selections', async () => {
    const t = await opened()
    for (const answers of [
      [],
      [{ questionId: 'elsewhere', selectedLabel: 'Blue' }],
      [
        { questionId: 'colour', selectedLabel: 'Blue' },
        { questionId: 'colour', selectedLabel: 'Green' },
      ],
      [{ questionId: 'colour', selectedLabel: 'Red' }],
      [{ questionId: 'colour', selectedLabels: ['Blue', 'Green'] }],
      [{ questionId: 'colour', selectedLabel: 'Blue', freeText: 'Also text' }],
      [{ questionId: 'colour', selectedLabel: 'Blue', selectedLabels: ['Blue'] }],
      [{ questionId: 'colour', freeText: ' ' }],
    ]) {
      await expect(t.registry.answer('q-1', { answers })).rejects.toThrow()
    }
    await expect(t.registry.answer('q-1', { explanation: 'x'.repeat(501) })).rejects.toThrow()
    await expect(t.registry.answer('q-1', { explanation: ' '.repeat(3) })).rejects.toThrow()
    expect(t.port.deliver).not.toHaveBeenCalled()
    expect(await t.registry.answer('q-1', { explanation: '  Green please.  ' })).toBe('taken')
  })

  it('waits for an in-flight timeout settlement before sending a draft as a late answer', async () => {
    const t = registryHarness()
    const held = Promise.withResolvers<undefined>()
    t.session.holdDeferral(held.promise)
    await t.register()
    t.clock.advance(60_000)
    await vi.waitFor(() => {
      expect(t.session.deferQuestions).toHaveBeenCalled()
    })
    const repeated = t.registry.defer('q-1')
    const answering = t.registry.answer('q-1', reply)
    await t.registry.ready()
    await new Promise<undefined>((resolve) => {
      setImmediate(() => {
        resolve(undefined)
      })
    })
    expect(t.port.deliver).not.toHaveBeenCalled()
    held.resolve(undefined)
    expect(await answering).toBe('taken')
    await repeated
    expect(t.session.answerQuestions).not.toHaveBeenCalled()
  })

  it('keeps idle dismissals durably, never sends them alone, and restores them only on non-admission', async () => {
    const t = await opened()
    await t.registry.dismiss('q-1')
    expect(t.port.deliver).not.toHaveBeenCalled()
    expect(t.snapshots.at(-1)?.questions[0]?.state).toBe('dismissed')
    const notes = await t.registry.takeDismissals()
    expect(notes.text).toContain('The user dismissed question q-1 without answering.')
    await notes.finish('notTaken')
    const retry = await t.registry.takeDismissals()
    expect(retry.text).toBe(notes.text)
    await retry.finish('uncertain')
    const empty = await t.registry.takeDismissals()
    expect(empty.text).toBe('')
  })

  it('bounds the quoted question, keeps answers exact, and does not touch grants or modes', () => {
    const t = registryHarness()
    const delivery = lateAnswer(
      questionFixture({
        questions: questionFixture().questions.map((question) => ({
          ...question,
          question: 'x'.repeat(5000),
        })),
      }),
      reply,
      t.port.formatAnswer,
    )
    expect(delivery.text).toContain('x'.repeat(LATE_ANSWER_QUESTION_MAX_CHARS))
    expect(delivery.text).not.toContain('x'.repeat(LATE_ANSWER_QUESTION_MAX_CHARS + 1))
    expect(t.session.decideApproval).not.toHaveBeenCalled()
    expect(t.session.setApprovalMode).not.toHaveBeenCalled()
  })
})

it('validates every question ID, unique labels and both multi-selection bounds', async () => {
  const t = registryHarness()
  const questions = questionFixture().questions.map((question) => ({
    ...question,
    selection: { mode: 'multi' as const, minSelections: 2, maxSelections: 2 },
    options: [...question.options, { label: 'Red' }],
  }))
  await t.registry.register({ userInputId: 'multi', itemId: 'item', turnId: 'turn', questions }, 0)
  await t.registry.defer('multi')
  for (const answers of [
    [{ questionId: 'colour', selectedLabels: ['Blue'] }],
    [{ questionId: 'colour', selectedLabels: ['Blue', 'Blue'] }],
    [{ questionId: 'colour', selectedLabels: ['Blue', 'Green', 'Red'] }],
    [
      { questionId: 'colour', selectedLabel: 'Blue' },
      { questionId: 'colour', selectedLabel: 'Green' },
    ],
  ])
    await expect(t.registry.answer('multi', { answers })).rejects.toThrow()
  await expect(t.registry.answer('multi', undefined)).rejects.toThrow(UI_TEXT.questionCancelFailed)
  expect(t.port.deliver).not.toHaveBeenCalled()
  expect(
    await t.registry.answer('multi', {
      answers: [{ questionId: 'colour', selectedLabels: ['Blue', 'Green'] }],
    }),
  ).toBe('taken')
})

it('keeps a waiting explanation Explained, settles cancellation once, and never sends a late message', async () => {
  const t = registryHarness()
  await t.register('explained', 60)
  await t.registry.answer('explained', { explanation: 'Green please.' })
  expect(t.snapshots.at(-1)?.questions[0]?.state).toBe('clarified')
  await t.register('cancelled', 60)
  await t.registry.answer('cancelled', undefined)
  expect(t.snapshots.at(-1)?.questions[0]?.state).toBe('cancelled')
  await expect(t.registry.answer('cancelled', undefined)).rejects.toThrow()
  t.clock.advance(60_000)
  expect(t.session.deferQuestions).not.toHaveBeenCalled()
  expect(t.session.clarifyQuestions).toHaveBeenCalledTimes(1)
  expect(t.session.cancelQuestions).toHaveBeenCalledTimes(1)
  expect(t.port.deliver).not.toHaveBeenCalled()
})

it('rejects an empty answer even if a captured question allows zero selections', async () => {
  const t = registryHarness()
  const questions = questionFixture().questions.map((question) => ({
    ...question,
    selection: { mode: 'multi', minSelections: 0 },
  }))
  await t.registry.register({ userInputId: 'empty', itemId: 'item', turnId: 'turn', questions }, 0)
  await t.registry.defer('empty')
  await expect(
    t.registry.answer('empty', {
      answers: [{ questionId: 'colour', freeText: ' ' }],
    }),
  ).rejects.toThrow()
  expect(t.port.deliver).not.toHaveBeenCalled()
})

it('waits when the deadline wins the same-tick race with a submitted draft', async () => {
  const t = registryHarness()
  const held = Promise.withResolvers<undefined>()
  t.session.holdDeferral(held.promise)
  await t.register()
  const answering = t.registry.answer('q-1', reply)
  t.clock.advance(60_000)
  await vi.waitFor(() => {
    expect(t.session.deferQuestions).toHaveBeenCalledTimes(1)
  })
  await new Promise<undefined>((resolve) => {
    setImmediate(() => {
      resolve(undefined)
    })
  })
  expect(t.port.deliver).not.toHaveBeenCalled()
  held.resolve(undefined)
  expect(await answering).toBe('taken')
  expect(t.session.answerQuestions).not.toHaveBeenCalled()
})
