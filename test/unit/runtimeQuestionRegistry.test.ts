import { mkdtemp, readFile, writeFile, readdir, mkdir, rename, rmdir } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  createRuntimeQuestionRegistry,
  removeRuntimeQuestions,
} from '../../src/runtime/questions/acpRegistry'
import {
  createQuestionQueueStore,
  createQuestionStore,
} from '../../src/runtime/questions/questionStore'
import { FakeQuestionClock } from './helpers/questions/clock'
import { ScriptedQuestionSession } from './helpers/questions/session'
import { questionFixture } from './helpers/questions/fixtures'
import { removeFolder } from './helpers/temporaryFolders'
import { UI_TEXT } from '../../src/shared/constants'

const folders: string[] = []
afterEach(async () => {
  for (const folder of folders.splice(0)) await removeFolder(folder)
})
const event = (id = 'q-1') => ({
  type: 'questionRequested' as const,
  userInputId: id,
  itemId: 'item-1',
  questions: questionFixture().questions,
})
async function harness() {
  const directory = await mkdtemp(path.join(tmpdir(), 'm112-int-'))
  folders.push(directory)
  const session = new ScriptedQuestionSession('session-1', 'test-model')
  const clock = new FakeQuestionClock()
  const deliver = vi.fn(() => Promise.resolve('taken' as const))
  const failed = vi.fn()
  const create = () =>
    createRuntimeQuestionRegistry({ session, clock, deliver }, directory, 'modelApi', failed)
  const registry = create()
  await registry.load()

  const register = (id = 'q-1') =>
    registry.register(event(id), {
      askedAt: clock.now(),
      deadlineAt: clock.now() + 60_000,
      turnId: 'turn-1',
    })
  const message = (id: string) => ({
    sessionId: session.sessionId,
    userInputId: id,
    text: `answer ${id}`,
    displayText: undefined,
  })
  return { directory, session, clock, deliver, failed, registry, create, event, register, message }
}

describe('real ACP question registry binding', () => {
  it('observes a corrupt registry immediately and preserves its explicit load failure', async () => {
    const h = await harness()
    await writeFile(path.join(h.directory, 'session-1.json'), '{PRIVATE-REGISTRY-CANARY')
    const resumed = h.create()
    await vi.waitFor(() => {
      expect(h.failed).toHaveBeenCalled()
    })
    await expect(resumed.load()).rejects.toThrow(UI_TEXT.questionAnswerFailed)
    expect(h.failed).toHaveBeenCalled()
    resumed.dispose()
    await expect(resumed.flush()).rejects.toThrow(UI_TEXT.questionAnswerFailed)
    h.registry.dispose()
    await h.registry.flush()
  })
  it('retains a prefix after commit persistence fails and permits a fresh lease', async () => {
    const h = await harness()
    await h.registry.queue(h.message('first'))
    const lease = (await h.registry.peekQueued())!
    const file = path.join(h.directory, 'queued', 'session-1.json')
    const backup = `${file}.backup`
    await rename(file, backup)
    await mkdir(file)
    await expect(h.registry.commitQueued(lease.token)).rejects.toThrow(UI_TEXT.questionAnswerFailed)
    await rmdir(file)
    await rename(backup, file)
    const retry = (await h.registry.peekQueued())!
    expect(retry.parts).toEqual([{ type: 'text', text: 'answer first' }])
    await h.registry.commitQueued(retry.token)
    h.registry.dispose()
    await h.registry.flush()
  })
  it('reports failed backend deferral and cancels every failed coalesced request', async () => {
    const h = await harness()
    await h.register()
    await h.register('q-2')
    h.session.deferQuestions.mockRejectedValue(new Error('PRIVATE-CANARY'))
    await expect(h.registry.defer('q-1')).rejects.toThrow(UI_TEXT.questionAnswerFailed)
    expect(h.session.cancelQuestions.mock.calls.map(([id]) => id)).toEqual(['q-1', 'q-2'])
    expect(h.failed).toHaveBeenCalled()
    h.registry.dispose()
    await h.registry.flush()
  })
  it('preserves ACP arrival timing and leaves the only deadline timer to the form controller', async () => {
    const h = await harness()
    h.clock.advance(5000)
    const record = await h.registry.register(h.event(), {
      askedAt: 1000,
      deadlineAt: 61_000,
      turnId: 'turn-1',
    })
    expect(record.askedAt).toBe(1000)
    expect(record.deadlineAt).toBe(61_000)
    expect(h.clock.pendingTimers).toBe(0)
    h.clock.advance(60_000)
    expect(h.session.deferQuestions).not.toHaveBeenCalled()
    expect(await h.registry.defer('q-1')).toBe(true)
    expect(await h.registry.defer('q-1')).toBe(false)
    expect(h.session.deferQuestions).toHaveBeenCalledTimes(1)
    h.registry.dispose()
    await h.registry.flush()
  })

  it('coalesces real requests and answers every waiting request without a late message', async () => {
    const h = await harness()
    await h.register()
    const second = await h.register('q-2')
    expect(second.userInputId).toBe('q-1')
    await h.registry.replyWaiting('q-2', {
      kind: 'answered',
      answers: [{ questionId: 'colour', selectedLabel: 'Blue' }],
    })
    expect(h.session.answerQuestions.mock.calls.map(([id]) => id)).toEqual(['q-1', 'q-2'])
    expect(h.deliver).not.toHaveBeenCalled()
    expect(h.registry.list()).toEqual([])
    h.registry.dispose()
    await h.registry.flush()
  })

  it('validates late answers and uses the existing model formatter exactly once', async () => {
    const h = await harness()
    await h.register()
    await h.registry.defer('q-1')
    await expect(
      h.registry.answer('q-1', { answers: [{ questionId: 'invented', selectedLabel: 'Blue' }] }),
    ).rejects.toThrow(UI_TEXT.answerNotAccepted)
    expect(h.deliver).not.toHaveBeenCalled()
    expect(await h.registry.answer('q-1', { explanation: 'Teal' })).toBe('taken')
    expect(await h.registry.answer('q-1', { explanation: 'Teal' })).toBeUndefined()
    expect(h.deliver).toHaveBeenCalledTimes(1)
    expect(h.deliver).toHaveBeenCalledWith(
      expect.objectContaining({
        text: expect.stringContaining(
          'The user chose none of the options and explained instead:\nTeal',
        ),
      }),
    )
    h.registry.dispose()
    await h.registry.flush()
  })

  it('flushes interrupted waiting records as open and reloads from the actual owner-only files', async () => {
    const h = await harness()
    await h.register()
    h.registry.dispose()
    await h.registry.flush()
    const resumed = h.create()
    await resumed.load()
    expect(resumed.list()).toEqual([expect.objectContaining({ state: 'open', userInputId: 'q-1' })])
    expect(h.clock.pendingTimers).toBe(0)
    resumed.dispose()
    await resumed.flush()
  })

  it('commits only the leased prefix, retaining answers queued concurrently', async () => {
    const h = await harness()
    expect(await h.registry.queue(h.message('first'))).toBe('taken')
    const first = (await h.registry.peekQueued())!
    expect(first.parts).toEqual([{ type: 'text', text: 'answer first' }])
    await h.registry.queue(h.message('second'))
    await h.registry.commitQueued(first.token)
    const second = (await h.registry.peekQueued())!
    expect(second.parts).toEqual([{ type: 'text', text: 'answer second' }])
    await h.registry.releaseQueued(second.token)
    h.registry.dispose()
    await h.registry.flush()
    const resumed = h.create()
    await resumed.load()
    const retry = (await resumed.peekQueued())!
    expect(retry.parts).toEqual(second.parts)
    await resumed.commitQueued(retry.token)
    expect(await resumed.peekQueued()).toBeUndefined()
    resumed.dispose()
    await resumed.flush()
  })

  it('restart between peek and commit retains the durable answer', async () => {
    const h = await harness()
    await h.registry.queue(h.message('first'))
    await h.registry.peekQueued()
    const resumed = h.create()
    await resumed.load()
    const lease = (await resumed.peekQueued())!
    expect(lease.parts).toEqual([{ type: 'text', text: 'answer first' }])
    await resumed.commitQueued(lease.token)
    h.registry.dispose()
    resumed.dispose()
    await h.registry.flush()
    await resumed.flush()
  })

  it('serializes concurrent peeks and rejects stale tokens without releasing current ownership', async () => {
    const h = await harness()
    await h.registry.queue(h.message('first'))
    const peeks = await Promise.allSettled([h.registry.peekQueued(), h.registry.peekQueued()])
    const first = peeks[0]
    expect(peeks[1]).toMatchObject({ status: 'rejected' })
    if (first.status !== 'fulfilled' || first.value === undefined) throw new Error('Missing lease')
    await h.registry.releaseQueued(first.value.token)
    const second = (await h.registry.peekQueued())!
    await expect(h.registry.commitQueued(first.value.token)).rejects.toThrow(
      UI_TEXT.questionQueueLeaseFailed,
    )
    await expect(h.registry.releaseQueued(first.value.token)).rejects.toThrow(
      UI_TEXT.questionQueueLeaseFailed,
    )
    await expect(h.registry.peekQueued()).rejects.toThrow(UI_TEXT.questionQueueLeaseFailed)
    await h.registry.commitQueued(second.token)
    expect(await h.registry.peekQueued()).toBeUndefined()
    h.registry.dispose()
    await h.registry.flush()
  })
  it('bounds the durable queue and refuses a message from another session', async () => {
    const h = await harness()
    expect(await h.registry.queue({ ...h.message('foreign'), sessionId: 'other' })).toBe('notTaken')
    for (let index = 0; index < 20; index += 1)
      expect(await h.registry.queue(h.message(String(index)))).toBe('taken')
    expect(await h.registry.queue(h.message('overflow'))).toBe('notTaken')
    const lease = (await h.registry.peekQueued())!
    expect(await h.registry.queue(h.message('leased-overflow'))).toBe('notTaken')
    await h.registry.commitQueued(lease.token)
    h.registry.dispose()
    await h.registry.flush()
  })

  it.each(['version', 'owner', 'message-owner', 'extra-field', 'overflow'])(
    'rejects a structurally valid but invalid private queue (%s)',
    async (defect) => {
      const h = await harness()
      await h.registry.queue(h.message('first'))
      const record = {
        version: defect === 'version' ? 2 : 1,
        sessionId: defect === 'owner' ? 'another-session' : 'session-1',
        messages:
          defect === 'overflow'
            ? Array.from({ length: 21 }, (_, index) => h.message(String(index)))
            : [
                {
                  ...h.message('first'),
                  sessionId: defect === 'message-owner' ? 'another-session' : 'session-1',
                },
              ],
        ...(defect === 'extra-field' && { secret: 'PRIVATE-QUEUE-CANARY' }),
      }
      await writeFile(path.join(h.directory, 'queued', 'session-1.json'), JSON.stringify(record))
      await expect(
        createQuestionQueueStore(path.join(h.directory, 'queued')).load('session-1'),
      ).rejects.toThrow(UI_TEXT.questionAnswerFailed)
      h.registry.dispose()
      await h.registry.flush()
    },
  )

  it('removes registry, queued text and crash temporaries with a session', async () => {
    const h = await harness()
    await h.register()
    await h.registry.queue(h.message('answer'))
    h.registry.dispose()
    await h.registry.flush()
    await writeFile(path.join(h.directory, 'session-1.json.crash.tmp'), 'PRIVATE-CANARY')
    await writeFile(path.join(h.directory, 'queued', 'session-1.json.crash.tmp'), 'PRIVATE-CANARY')
    await removeRuntimeQuestions(h.directory, 'session-1')
    expect(await readdir(h.directory)).toEqual(['queued'])
    expect(await readdir(path.join(h.directory, 'queued'))).toEqual([])
    expect(await createQuestionStore(h.directory).load('session-1')).toEqual([])
  })

  it('rejects malformed queued text without exposing parser details or fabricating an empty queue', async () => {
    const h = await harness()
    const store = createQuestionQueueStore(path.join(h.directory, 'queued'))
    await store.save('session-1', [h.message('answer')])
    const file = path.join(h.directory, 'queued', 'session-1.json')
    expect(JSON.parse(await readFile(file, 'utf8'))).toMatchObject({
      version: 1,
      sessionId: 'session-1',
    })
    await writeFile(file, '{PRIVATE-CANARY')
    await expect(store.load('session-1')).rejects.toThrow(UI_TEXT.questionAnswerFailed)
    const resumed = h.create()
    await expect(resumed.load()).rejects.toThrow(UI_TEXT.questionAnswerFailed)
    h.registry.dispose()
    await h.registry.flush()
  })
})
