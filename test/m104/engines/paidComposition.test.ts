import { writeFile } from 'node:fs/promises'
import path from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import { paidGrantFile } from '../../../src/runtime/paidGrants'
import { workspaceKey } from '../../../src/runtime/dataFolder'
import * as atomic from '../../../src/host/fsAtomic'
import { FakeLogOutputChannel } from '../../unit/helpers/fakes'
import { engineFixtures } from './fixtures'
import { paidHarness as policy } from './paidHarness'
import type { PaidFeature } from '../../../src/shared/constants'

const fixtures = engineFixtures()

async function captureFailure(work: Promise<unknown>): Promise<unknown> {
  try {
    return await work
  } catch (error: unknown) {
    return error
  }
}

async function expectHeldShutdown(
  paid: { dispose(): Promise<void> },
  held: PromiseWithResolvers<undefined>,
  work: readonly Promise<unknown>[],
) {
  const state = { isClosed: false }
  const completion = (async () => {
    await paid.dispose()
    state.isClosed = true
  })()
  try {
    await Promise.resolve()
    await Promise.resolve()
    expect(state.isClosed).toBe(false)
  } finally {
    held.resolve(undefined)
    await Promise.allSettled([...work, completion])
  }
}
async function setup() {
  const directory = await fixtures.folder('m104-pb-grants-')
  const file = path.join(directory, 'grants.json')
  const grants = paidGrantFile({
    file,
    log: new FakeLogOutputChannel(),
    sleep: () => Promise.resolve(),
  })
  return { grants, file }
}
describe('contract v2 workspace paid revocation', () => {
  it('cannot regrant a different feature from a snapshot queued behind its revocation', async () => {
    const { paid, ask, grants, granted } = policy()
    granted.set('/ws', new Set(['webSearch']))
    const held = Promise.withResolvers<undefined>()
    const revoking = Promise.withResolvers<undefined>()
    vi.mocked(grants.forget).mockImplementation(async (features) => {
      revoking.resolve(undefined)
      await held.promise
      for (const [root, existing] of granted)
        granted.set(root, new Set([...existing].filter((feature) => !features.includes(feature))))
    })
    ask.mockResolvedValue('always')
    const composition = paid.composition('/ws', 'window')
    const forgetting = composition.gate.turnOff('webSearch')
    await revoking.promise
    const allowing = composition.consent.allows({ feature: 'voice' })
    try {
      await Promise.resolve()
      await Promise.resolve()
      await Promise.resolve()
      await Promise.resolve()
    } finally {
      held.resolve(undefined)
      await Promise.all([forgetting, allowing])
    }
    expect(granted.get('/ws')).toEqual(new Set(['voice']))
    await paid.dispose()
  })

  it('drains a grant store write and refuses queued workspace revocation after disposal', async () => {
    const { paid, ask, grants } = policy()
    const held = Promise.withResolvers<undefined>()
    const writing = Promise.withResolvers<undefined>()
    ask.mockResolvedValue('always')
    vi.mocked(grants.add).mockImplementation(async () => {
      writing.resolve(undefined)
      await held.promise
    })
    const composition = paid.composition('/ws', 'window')
    const allowing = composition.consent.allows({ feature: 'voice' })
    await writing.promise
    const forgetting = composition.consent.forget()
    const forgetOutcome = captureFailure(forgetting)
    await expectHeldShutdown(paid, held, [allowing, forgetting])
    expect(await allowing).toBe(false)
    expect(await forgetOutcome).toBeInstanceOf(Error)
    expect(grants.forgetWorkspace).not.toHaveBeenCalled()
  })

  it('cancels an unanswered gate confirmation without writing after disposal', async () => {
    const held = Promise.withResolvers<boolean>()
    const asked = Promise.withResolvers<undefined>()
    const writeAccepted = vi.fn(() => Promise.resolve())
    const setSetting = vi.fn(() => Promise.resolve())
    const { paid } = policy([], undefined, {
      readAccepted: () => new Set(),
      confirm: () => {
        asked.resolve(undefined)
        return held.promise
      },
      writeAccepted,
      setSetting,
    })
    const turningOn = paid.composition('/ws', 'window').gate.turnOn('voice')
    const refused = expect(turningOn).rejects.toThrow()
    await asked.promise
    await paid.dispose()
    held.resolve(true)
    await refused
    expect(writeAccepted).not.toHaveBeenCalled()
    expect(setSetting).not.toHaveBeenCalled()
  })

  it('drains an accepted store write and discards later and queued mutations on disposal', async () => {
    const held = Promise.withResolvers<undefined>()
    const writing = Promise.withResolvers<undefined>()
    const setSetting = vi.fn(() => Promise.resolve())
    const writeAccepted = vi.fn(async () => {
      writing.resolve(undefined)
      await held.promise
    })
    const { paid, grants } = policy([], undefined, {
      readAccepted: () => new Set(),
      confirm: () => Promise.resolve(true),
      writeAccepted,
      setSetting,
    })
    const composition = paid.composition('/ws', 'window')
    const first = composition.gate.turnOn('voice')
    const firstOutcome = captureFailure(first)
    await writing.promise
    const next = composition.gate.turnOff('webSearch')
    const nextOutcome = captureFailure(next)
    await expectHeldShutdown(paid, held, [first, next])
    expect(await firstOutcome).toBeInstanceOf(Error)
    expect(await nextOutcome).toBeInstanceOf(Error)
    expect(writeAccepted).toHaveBeenCalledOnce()
    expect(setSetting).not.toHaveBeenCalled()
    expect(grants.forget).not.toHaveBeenCalled()
  })

  it('serializes gate acceptances so two toggles retain both accepted features', async () => {
    const held = Promise.withResolvers<undefined>()
    const writing = Promise.withResolvers<undefined>()
    let accepted = new Set<PaidFeature>()
    const writeAccepted = vi.fn(async (next: ReadonlySet<PaidFeature>) => {
      writing.resolve(undefined)
      await held.promise
      accepted = new Set(next)
    })
    const { paid } = policy([], undefined, {
      readAccepted: () => accepted,
      confirm: () => Promise.resolve(true),
      writeAccepted,
    })
    const composition = paid.composition('/ws', 'window')
    const first = composition.gate.turnOn('voice')
    await writing.promise
    const second = composition.gate.turnOn('imageGeneration')
    try {
      await Promise.resolve()
      await Promise.resolve()
      expect(writeAccepted).toHaveBeenCalledOnce()
    } finally {
      held.resolve(undefined)
      await Promise.all([first, second])
    }
    expect(accepted).toEqual(new Set(['voice', 'imageGeneration']))
    await paid.dispose()
  })

  it('revokes only this workspace and permits a fresh explicit grant', async () => {
    const { grants } = await setup()
    await grants.add('/one', ['webSearch'])
    await grants.add('/two', ['webSearch'])
    await grants.forgetWorkspace('/one')
    expect(grants.read('/one').size).toBe(0)
    expect(grants.read('/two').has('webSearch')).toBe(true)
    await grants.add('/one', ['webSearch'])
    expect(grants.read('/one').has('webSearch')).toBe(true)
    await grants.forget(['webSearch'])
    expect(grants.read('/one').size).toBe(0)
    expect(grants.read('/two').size).toBe(0)
  })
  it('cannot resurrect a grant whose writer was admitted before workspace revocation', async () => {
    const { grants } = await setup()
    await grants.add('/one', ['voice'])
    const gate = Promise.withResolvers<undefined>()
    const write = atomic.writeFileAtomically
    const started = Promise.withResolvers<undefined>()
    const spy = vi
      .spyOn(atomic, 'writeFileAtomically')
      .mockImplementation(async (file, text, options) => {
        if (
          file.endsWith('.json') &&
          !file.endsWith('generation.json') &&
          file.includes(`${workspaceKey('/one')}.`)
        ) {
          started.resolve(undefined)
          await gate.promise
        }
        await write(file, text, options)
      })
    try {
      const adding = grants.add('/one', ['voice'])
      await started.promise
      await grants.forgetWorkspace('/one')
      gate.resolve(undefined)
      await adding
      expect(grants.read('/one').has('voice')).toBe(false)
    } finally {
      gate.resolve(undefined)
      spy.mockRestore()
    }
  })
  it('refuses a damaged workspace revocation record instead of falling back to a legacy grant', async () => {
    const { grants, file } = await setup()
    await grants.add('/one', ['voice'])
    await writeFile(
      path.join(`${file}.d`, 'voice', `${workspaceKey('/one')}.generation.json`),
      '{}',
    )
    expect(() => grants.read('/one')).toThrow('could not be read')
    await expect(grants.add('/one', ['voice'])).rejects.toThrow('could not be read')
  })
})
