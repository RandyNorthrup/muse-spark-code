// RVAPP-CM1091D5 P2-1: the person's own Lock or Revoke during an Import or
// Delete aborts the in-flight call; the abort recorded on the signal owns the
// outcome (the veto the host settles silent), not the channel error the close
// produced. Each case fails without the fix: the raw channel error escapes.
import { describe, expect, it, vi } from 'vitest'
import { UI_TEXT } from '../../../src/shared/constants'
import { VaultChannelError } from '../../../src/core/vault/broker/client'
import {
  VaultManageSession,
  type VaultBrokerConnection,
} from '../../../src/core/vault/broker/manageClient'

describe('RVAPP-CM1091D5 P2-1 an aborted Import or Delete reports the veto', () => {
  it.each(['importFile', 'deleteImport'] as const)(
    'a barrier abort during %s throws useChanged, not the channel error',
    async (method) => {
      const request = Promise.withResolvers<never>()
      const send = vi.fn(() => request.promise)
      // The broker closes the aborted connection: the pending request fails
      // with the channel error, exactly as VaultBrokerClient.close does.
      const close = vi.fn(() => {
        request.reject(new VaultChannelError('closed'))
      })
      const connection: VaultBrokerConnection = {
        send,
        close,
        watch: () => Promise.resolve(),
        closed: () => Promise.resolve(),
      }
      const session = new VaultManageSession(() => Promise.resolve(connection))
      const controller = new AbortController()
      const pending =
        method === 'importFile'
          ? session.importFile('/home/user/.netrc', undefined, controller.signal)
          : session.deleteImport(
              'a1b2c3d4-e5f6-7890-abcd-ef1234567890',
              undefined,
              controller.signal,
            )
      await vi.waitFor(() => {
        expect(send).toHaveBeenCalledOnce()
      })
      // The person's own Lock or Revoke: abort mid-call, as the panel does.
      controller.abort()
      await expect(pending).rejects.toThrow(UI_TEXT.vault.useChanged)
      expect(close).toHaveBeenCalled()
    },
  )

  it('a channel failure without an abort still reaches the caller unchanged', async () => {
    const failure = new VaultChannelError('closed')
    const session = new VaultManageSession(() =>
      Promise.resolve({
        send: () => Promise.reject(failure),
        close: vi.fn(),
        watch: () => Promise.resolve(),
        closed: () => Promise.resolve(),
      }),
    )
    await expect(session.importFile('/home/user/.netrc')).rejects.toBe(failure)
  })
})
