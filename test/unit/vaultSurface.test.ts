import { describe, expect, it, vi } from 'vitest'
import { VaultSurface, type VaultPanelPort } from '../../src/runtime/vault/vaultSurface'
import { UI_TEXT } from '../../src/shared/constants'
import { AcpVault } from '../../src/acp/vault'
import {
  runtimeVaultLoader,
  type RuntimeVaultContext,
  type RuntimeVaultBinding,
} from '../../src/runtime/vault/vaultRuntime'
import { panel, approval } from './helpers/vault/fixtures'
import { commandHarness } from './helpers/vault/runtime'

function harness() {
  const port = {
    dispatch: vi.fn<VaultPanelPort['dispatch']>(() =>
      Promise.resolve({ type: 'vaultState', state: panel() }),
    ),
    terminal: vi.fn<VaultPanelPort['terminal']>(() => Promise.resolve()),
  }
  return { port, bridge: new VaultSurface(port) }
}
describe('M109 H public panel bridges', () => {
  it.each(['companion', 'native'] as const)(
    'H40 %s uses same validated panel and bound answers',
    async () => {
      const h = harness()
      expect(await h.bridge.dispatch({ type: 'vaultReady' })).toEqual({
        type: 'vaultState',
        state: panel(),
      })
      const request = approval()
      await h.bridge.dispatch({
        type: 'vaultAnswer',
        answer: { requestId: request.id, digest: request.digest, decision: 'allowOnce' },
      })
      expect(h.port.dispatch).toHaveBeenLastCalledWith(
        {
          type: 'vaultAnswer',
          answer: { requestId: request.id, digest: request.digest, decision: 'allowOnce' },
        },
        expect.any(AbortSignal),
      )
    },
  )
  it('H41 values and first-party read frames never cross either bridge', async () => {
    for (const _surface of ['companion', 'native'] as const) {
      const h = harness()
      for (const raw of [
        { type: 'vaultAdd', value: 'private-canary' },
        { type: 'firstPartyRead', itemId: 'a'.repeat(32) },
        { type: 'vaultAnswer', answer: { requestId: 'a'.repeat(32), decision: 'allowOnce' } },
      ])
        await expect(h.bridge.dispatch(raw)).rejects.toThrow()
      expect(h.port.dispatch).not.toHaveBeenCalled()
      h.port.dispatch.mockResolvedValue({
        type: 'vaultState',
        state: { ...panel(), value: 'private-canary' },
      })
      await expect(h.bridge.dispatch({ type: 'vaultReady' })).rejects.toThrow()
    }
  })
  it('H41b adapter errors cannot leak private diagnostic text onto public bridge', async () => {
    const h = harness()
    h.port.dispatch.mockRejectedValue(new Error('private-canary'))
    await expect(h.bridge.dispatch({ type: 'vaultReady' })).rejects.toThrow(UI_TEXT.vault.noAccess)
  })
  it('H42 native and companion add/edit open host terminal with no private entry', async () => {
    const native = harness()
    await native.bridge.dispatch({ type: 'vaultAdd' })
    await native.bridge.dispatch({ type: 'vaultEdit', itemId: 'a'.repeat(32) })
    expect(native.port.terminal.mock.calls.map(([command, id]) => [command, id])).toEqual([
      ['add', null],
      ['edit', 'a'.repeat(32)],
    ])
    expect(native.port.dispatch).not.toHaveBeenCalled()
    const companion = harness()
    await companion.bridge.dispatch({ type: 'vaultAdd' })
    expect(companion.port.terminal).toHaveBeenCalledWith('add', null, expect.any(AbortSignal))
  })
  it('H43 one owner serializes effects; close discards stale response and queued work', async () => {
    const h = harness()
    const held = Promise.withResolvers<unknown>()
    h.port.dispatch.mockImplementationOnce(() => held.promise)
    const first = h.bridge.dispatch({ type: 'vaultReady' })
    const second = h.bridge.dispatch({ type: 'vaultReady' })
    const observed = Promise.allSettled([first, second])
    await Promise.resolve()
    expect(h.port.dispatch).toHaveBeenCalledOnce()
    h.bridge.close()
    held.resolve({ type: 'vaultState', state: panel() })
    const outcomes = await observed
    expect(outcomes.map((result) => result.status)).toEqual(['rejected', 'rejected'])
    expect(h.port.dispatch).toHaveBeenCalledOnce()
  })
  it('H43b lock preempts blocked panel work and aborts its effects', async () => {
    const h = harness()
    const held = Promise.withResolvers<unknown>()
    h.port.dispatch.mockImplementationOnce(() => held.promise)
    const first = h.bridge.dispatch({ type: 'vaultReady' })
    const observed = Promise.allSettled([first])
    await Promise.resolve()
    const oldSignal = h.port.dispatch.mock.calls[0]?.[1]
    await h.bridge.dispatch({ type: 'vaultLock' })
    expect(oldSignal?.aborted).toBe(true)
    expect(h.port.dispatch).toHaveBeenCalledTimes(2)
    held.resolve({ type: 'vaultState', state: panel() })
    const outcomes = await observed
    expect(outcomes[0].status).toBe('rejected')
  })
  it('H43c terminal result after close is discarded and entry receives cancellation', async () => {
    const h = harness()
    const held = Promise.withResolvers<undefined>()
    h.port.terminal.mockImplementation(() => held.promise)
    const waiting = h.bridge.dispatch({ type: 'vaultAdd' })
    const observed = Promise.allSettled([waiting])
    await Promise.resolve()
    const signal = h.port.terminal.mock.calls[0]?.[2]
    h.bridge.close()
    held.resolve(undefined)
    expect(signal?.aborted).toBe(true)
    const outcomes = await observed
    expect(outcomes[0].status).toBe('rejected')
  })
})

function loader(load: (file: string) => unknown) {
  const h = commandHarness()
  return runtimeVaultLoader(
    { dataDir: '/data', distDir: '/dist', processId: 100, acp: new AcpVault(h.deps.open) },
    load,
  )
}
describe('M109 H lazy runtime binding', () => {
  it('H44 construction reads nothing; concurrent needs share one installed factory', async () => {
    const commands = commandHarness().deps.open
    const create = vi.fn<(context: RuntimeVaultContext) => Promise<RuntimeVaultBinding>>(() =>
      Promise.resolve({ commands, exec: { open: vi.fn() } }),
    )
    const load = vi.fn<(file: string) => unknown>(() => ({ createRuntimeVault: create }))
    const open = loader(load)
    expect(load).not.toHaveBeenCalled()
    const [first, second] = await Promise.all([open(), open()])
    expect(first).toBe(second)
    expect(load).toHaveBeenCalledOnce()
    expect(load.mock.calls[0]?.[0]?.replaceAll('\\', '/')).toBe('/dist/vault.js')
    expect(create).toHaveBeenCalledOnce()
    expect(create.mock.calls[0]?.[0]).toMatchObject({
      uiText: expect.objectContaining({ vault: expect.any(Object) }),
      locale: expect.any(String),
    })
  })
  it.each([null, {}, { createRuntimeVault: () => Promise.resolve({}) }])(
    'H45 missing/malformed module fails explicitly and can retry',
    async (module) => {
      const load = vi.fn<(file: string) => unknown>(() => module)
      const open = loader(load)
      await expect(open()).rejects.toThrow()
      await expect(open()).rejects.toThrow()
      expect(load).toHaveBeenCalledTimes(2)
    },
  )
})
