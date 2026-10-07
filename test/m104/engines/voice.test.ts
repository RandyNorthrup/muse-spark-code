import { describe, expect, it, vi } from 'vitest'
import { createHash } from 'node:crypto'
import type { OwnedSessionBudgetScope } from '../../../src/core/backends/modelapi/sessionBudget'
import { createRuntimeVoice } from '../../../src/runtime/features/voice'
import { MuseVoiceDictation } from '../../../src/core/voice/museVoice'
import type { DictationListener } from '../../../src/core/voice/dictation'
import { UI_TEXT } from '../../../src/shared/constants'
import { FAKE_MODEL_API_KEY } from '../../unit/helpers/fakeModelApi'
import { FakeLogOutputChannel } from '../../unit/helpers/fakes'
import { engineFixtures } from './fixtures'

const fixtures = engineFixtures()
function setup(scope?: OwnedSessionBudgetScope) {
  const state = { isCurrent: true, canStart: true, isDrained: false }
  const observed: DictationListener[] = []
  const key = Promise.withResolvers<string | undefined>()
  const socket = vi.fn(() => {
    throw new Error('fixture forbids socket')
  })
  const capture = { start: vi.fn(), stop: vi.fn(), dispose: vi.fn() }
  const drain = vi.fn(() => Promise.resolve())
  const service = createRuntimeVoice(
    {
      setup: {
        isAvailable: true,
        create: (listener) => {
          observed.push(listener)
          return new MuseVoiceDictation(
            {
              createCapture: () => capture,
              apiKey: () => key.promise,
              openSocket: socket,
              url: 'wss://fixture.invalid',
              onSeconds: () => undefined,
              log: new FakeLogOutputChannel(),
            },
            listener,
          )
        },
      },
      assertCurrent: () => {
        if (!state.isCurrent) throw new Error('retired')
      },
      canStart: () => state.canStart,
      cancelNative: vi.fn(),
      drainNative: drain,
    },
    UI_TEXT,
    'en',
  )
  fixtures.own({
    dispose: async () => {
      key.resolve(undefined)
      await service.dispose()
    },
  })
  if (!service.dictation.isAvailable) throw new Error('fixture unavailable')
  const listener = {
    onStatus: vi.fn(),
    onText: vi.fn(),
    onError: vi.fn(),
    ...(scope !== undefined && { ownedBudgetScope: () => Promise.resolve(scope) }),
  }
  const driver = service.dictation.create(listener)
  return { service, driver, listener, observed, capture, key, socket, drain, state }
}

async function releaseHeld(rig: ReturnType<typeof setup>, unblock: () => void) {
  const done = (async () => {
    await rig.service.dispose()
    rig.state.isDrained = true
  })()
  try {
    await new Promise((resolve) => setImmediate(resolve))
    expect(rig.state.isDrained).toBe(false)
  } finally {
    unblock()
  }
  await done
  expect(rig.drain).toHaveBeenCalledOnce()
}

describe('F41 portable voice owner', () => {
  it('refuses unknown or withdrawn start admission without reading a key or starting capture', () => {
    const rig = setup()
    rig.state.canStart = false
    expect(() => {
      rig.driver.start()
    }).toThrow(UI_TEXT.dictationNotLoaded)
    expect(rig.capture.start).not.toHaveBeenCalled()
  })
  it('suppresses a late transcript after individual driver disposal and profile withdrawal', () => {
    const rig = setup()
    rig.driver.dispose()
    rig.observed[0]?.onText('late')
    expect(rig.listener.onText).not.toHaveBeenCalled()
    expect(() => {
      rig.driver.start()
    }).toThrow(UI_TEXT.dictationNotLoaded)
    rig.state.isCurrent = false
    rig.observed[0]?.onError('late error')
    expect(rig.listener.onError).not.toHaveBeenCalled()
  })
  it('waits for actual Muse Voice key preparation before native release, without opening a late socket', async () => {
    const rig = setup()
    rig.driver.start()
    await releaseHeld(rig, () => {
      rig.key.resolve(FAKE_MODEL_API_KEY)
    })
    expect(rig.capture.dispose).toHaveBeenCalledOnce()
    expect(rig.socket).not.toHaveBeenCalled()
  })
  it('drains an actual driver claim settlement that began after preparation finished', async () => {
    const settled = Promise.withResolvers<undefined>()
    const settle = vi.fn(async () => {
      await settled.promise
      return { spentUsd: 0, hasUnknownHistoricalFees: false }
    })
    const scope: OwnedSessionBudgetScope = {
      sessionId: 'voice-fixture',
      accountId: createHash('sha256').update(FAKE_MODEL_API_KEY).digest('hex'),
      capUsd: () => 0,
      isStillAllowed: () => true,
      journal: {
        reserve: () =>
          Promise.resolve({
            claimId: 'held',
            reservedUsd: 0,
            check: () => ({ spentUsd: 0, hasUnknownHistoricalFees: false }),
            settle,
          }),
        read: () => Promise.reject(new Error('fixture forbids read')),
        record: () => Promise.reject(new Error('fixture forbids record')),
      },
    }
    const rig = setup(scope)
    rig.driver.start()
    rig.key.resolve(FAKE_MODEL_API_KEY)
    await vi.waitFor(() => {
      expect(settle).toHaveBeenCalledOnce()
    })
    await releaseHeld(rig, () => {
      settled.resolve(undefined)
    })
  })
})
