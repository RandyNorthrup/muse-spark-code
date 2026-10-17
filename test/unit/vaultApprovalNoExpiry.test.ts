import { describe, expect, it } from 'vitest'
import { awaitVaultApproval } from '../../src/core/vault/fleet'
import { vaultApprovalRequestSchema, vaultTicketSchema } from '../../src/shared/vault'
import { approval, ticket } from './helpers/vault/fixtures'

describe('vault approvals without an expiry of their own (NOLIMITS2 A33)', () => {
  it('an approval request names no expiry', () => {
    const parsed = vaultApprovalRequestSchema.parse(approval())
    expect('expiresAt' in parsed).toBe(false)
  })

  it('a ticket carries the item lifetime, or none when it never expires', () => {
    expect(vaultTicketSchema.parse(ticket()).expiresAt).toBeNull()
  })

  it('a late answer still resolves', async () => {
    const controller = new AbortController()
    const answer = new Promise((resolve) =>
      setTimeout(() => {
        resolve('allowOnce')
      }, 20),
    )
    await expect(awaitVaultApproval(answer, controller.signal)).resolves.toBe('allowOnce')
  })

  it('Stop ends the wait with its own reason, not an expiry', async () => {
    const controller = new AbortController()
    const waiting = awaitVaultApproval(new Promise(() => undefined), controller.signal)
    controller.abort(new Error('stopped by the test'))
    await expect(waiting).rejects.toThrow('stopped by the test')
  })

  it('an already-stopped wait ends at once', async () => {
    const controller = new AbortController()
    controller.abort(new Error('stopped by the test'))
    await expect(
      awaitVaultApproval(new Promise(() => undefined), controller.signal),
    ).rejects.toThrow('stopped by the test')
  })
})
