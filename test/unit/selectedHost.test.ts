import { describe, expect, it, vi } from 'vitest'
import { selectBackend } from '../../src/core/backendSelection'
import { chooseAuthorizedHost } from '../../src/host/backend/selectedHost'
import { UI_TEXT } from '../../src/shared/constants'

const rawCli = selectBackend({
  setting: 'auto',
  hasCli: true,
  hasCliSession: true,
  hasStoredKey: false,
})

describe('host selection after authentication', () => {
  it('does not inspect raw credentials or open a host during a logout hold', async () => {
    const readRaw = vi.fn(() => Promise.resolve(rawCli))
    const openHost = vi.fn(() => Promise.resolve({ close: () => Promise.resolve() }))
    await expect(
      chooseAuthorizedHost(
        () => undefined,
        readRaw,
        openHost,
        () => 0,
      ),
    ).rejects.toThrow(UI_TEXT.sendDisabledReason)
    expect(readRaw).not.toHaveBeenCalled()
    expect(openHost).not.toHaveBeenCalled()
  })

  it('refuses a sign-out that begins during the raw credential read', async () => {
    let admitted: 'museCode' | undefined = 'museCode'
    const openHost = vi.fn(() => Promise.resolve({ close: () => Promise.resolve() }))
    await expect(
      chooseAuthorizedHost(
        () => admitted,
        () => {
          admitted = undefined
          return Promise.resolve(rawCli)
        },
        openHost,
        () => 0,
      ),
    ).rejects.toThrow(UI_TEXT.sendDisabledReason)
    expect(openHost).not.toHaveBeenCalled()
  })

  it('leaves a manager-owned host to its manager after sign-out revokes admission', async () => {
    const opened = Promise.withResolvers<{ close: () => Promise<void> }>()
    const openStarted = Promise.withResolvers<undefined>()
    const host = { close: vi.fn(() => Promise.resolve()) }
    let admitted: 'museCode' | undefined = 'museCode'
    const selected = chooseAuthorizedHost(
      () => admitted,
      () => Promise.resolve(rawCli),
      () => {
        openStarted.resolve(undefined)
        return opened.promise
      },
      () => 0,
    )
    await openStarted.promise
    admitted = undefined
    opened.resolve(host)
    await expect(selected).rejects.toThrow(UI_TEXT.sendDisabledReason)
    expect(host.close).not.toHaveBeenCalled()
  })

  it('refuses a host selection begun before sign-out even after same-kind sign-in', async () => {
    const rawRead = Promise.withResolvers<typeof rawCli>()
    const openHost = vi.fn(() => Promise.resolve({ close: vi.fn(() => Promise.resolve()) }))
    let admitted: 'museCode' | undefined = 'museCode'
    let generation = 0
    const selected = chooseAuthorizedHost(
      () => admitted,
      () => rawRead.promise,
      openHost,
      () => generation,
    )
    admitted = undefined
    generation += 1
    admitted = 'museCode'
    rawRead.resolve(rawCli)
    await expect(selected).rejects.toThrow(UI_TEXT.sendDisabledReason)
    expect(openHost).not.toHaveBeenCalled()
  })

  it('does not kill a cached CLI host when only its secondary key changes', async () => {
    const opened = Promise.withResolvers<{ close: () => Promise<void> }>()
    const opening = Promise.withResolvers<undefined>()
    const host = { close: vi.fn(() => Promise.resolve()) }
    let generation = 0
    const selected = chooseAuthorizedHost(
      () => 'museCode',
      () => Promise.resolve(rawCli),
      () => {
        opening.resolve(undefined)
        return opened.promise
      },
      () => generation,
    )
    await opening.promise
    generation += 1
    opened.resolve(host)
    await expect(selected).rejects.toThrow(UI_TEXT.sendDisabledReason)
    expect(host.close).not.toHaveBeenCalled()
  })

  it('opens only the backend admitted by auth and current raw facts', async () => {
    const host = { close: () => Promise.resolve() }
    const openHost = vi.fn((_kind: 'museCode' | 'modelApi') => Promise.resolve(host))
    await expect(
      chooseAuthorizedHost(
        () => 'museCode',
        () => Promise.resolve(rawCli),
        openHost,
        () => 0,
      ),
    ).resolves.toBe(host)
    expect(openHost).toHaveBeenCalledExactlyOnceWith('museCode')
    await expect(
      chooseAuthorizedHost(
        () => 'modelApi',
        () => Promise.resolve(rawCli),
        openHost,
        () => 0,
      ),
    ).rejects.toThrow(UI_TEXT.sendDisabledReason)
  })
})
