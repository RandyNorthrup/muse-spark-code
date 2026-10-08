import { vaultTicketSchema, type VaultTicket, type VaultUse } from '../../../shared/vault'
import { vaultApprovalResultSchema } from '../../../shared/vaultProtocol'
import { vaultUseDigest } from '../useDigest'
import { type WebBrowserOwnerPort, type WebTargetLease, type WebUseBrokerPort } from './ports'
import { assertWebTarget } from './origin'

/** All secret-bearing browser operations share the M81 owner's queue and B's ticket lifetime. */
async function runTicket(
  browser: WebBrowserOwnerPort,
  broker: WebUseBrokerPort,
  ticketInput: VaultTicket,
  approved: VaultUse & { kind: 'fill' | 'session' },
  signal: AbortSignal,
  run: (target: WebTargetLease, check: () => void) => Promise<void>,
): Promise<void> {
  const ticket = vaultTicketSchema.parse(ticketInput)
  let hasSucceeded = false
  let hasClosed = false
  let closing: Promise<void> | undefined
  const close = (): void => {
    hasClosed = true
    if (hasSucceeded || closing !== undefined) {
      return
    }

    closing = (async () => {
      await browser.close()
    })()
    // The owned cleanup is awaited below; an event callback cannot return a promise.
    void closing.catch(() => {
      /* Cleanup is awaited below. */
    })
  }
  const check = (): void => {
    if (hasClosed || signal.aborted) throw new Error('useChanged')
  }
  signal.addEventListener('abort', close, { once: true })
  if (signal.aborted) close()
  const settle = async (): Promise<void> => {
    try {
      await broker.finish(ticket.id, hasSucceeded)
    } catch (error) {
      // An inserted value must not remain usable after its broker settlement fails.
      hasSucceeded = false
      close()
      throw error
    } finally {
      await closing
    }
  }
  try {
    check()
    if (ticket.digest !== vaultUseDigest(approved) || browser.browserId !== approved.browserId)
      throw new Error('useChanged')
    await browser.withTarget(
      approved.origin,
      approved.kind === 'fill' ? approved.field : null,
      async (target) => {
        assertWebTarget(target, approved.origin)
        if (approved.kind === 'fill' && target.facts.frameId !== approved.frameId)
          throw new Error('useChanged')
        const result = vaultApprovalResultSchema.parse(
          await broker.redeem(ticket, approved, {
            close,
            terminate: async () => {
              close()
              await closing
              return true
            },
          }),
        )
        check()
        if (
          result.kind !== 'ticket' ||
          result.ticket.id !== ticket.id ||
          result.ticket.digest !== ticket.digest
        )
          throw new Error('useChanged')
        assertWebTarget(target, approved.origin)
        await run(target, () => {
          check()
          assertWebTarget(target, approved.origin)
        })
        check()
      },
    )
    check()
    hasSucceeded = true
  } finally {
    signal.removeEventListener('abort', close)
    await settle()
  }
}

export async function withWebTicket(...args: Parameters<typeof runTicket>): Promise<void> {
  try {
    await runTicket(...args)
  } catch {
    throw new Error('useChanged')
  }
}
