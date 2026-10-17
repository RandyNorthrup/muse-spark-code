import { Buffer } from 'node:buffer'
import * as z from 'zod/mini'
import { VAULT_TOTP_DIGITS } from '../../../shared/constants'
import { vaultUseSchema, vaultItemSchema, type VaultTicket } from '../../../shared/vault'
import { vaultUseDigest } from '../useDigest'
import { totpCode, WEB_TOTP_PERIOD_SECONDS } from './totp'
import { withWebTicket } from './ticket'
import {
  type WebBrowserOwnerPort,
  type WebFillUse,
  type WebTargetLease,
  type WebUseBrokerPort,
} from './ports'

import { webOrigin, assertWebTarget } from './origin'

function fillUse(
  browser: WebBrowserOwnerPort,
  target: WebTargetLease,
  origin: string,
  field: WebFillUse['field'],
): WebFillUse {
  assertWebTarget(target, origin)
  const input = target.facts.input
  if (
    input?.tag !== 'INPUT' ||
    input.disabled ||
    input.readOnly ||
    (field === 'password' && input.type !== 'password') ||
    (field === 'username' && !['text', 'email'].includes(input.type)) ||
    (field === 'totp' &&
      (!['text', 'tel', 'number'].includes(input.type) || input.autocomplete !== 'one-time-code'))
  )
    throw new Error('useChanged')
  const use = vaultUseSchema.parse({
    kind: 'fill',
    origin,
    topOrigin: webOrigin(target.facts.topUrl),
    frameOrigin: webOrigin(target.facts.frameUrl),
    frameId: target.facts.frameId,
    browserId: browser.browserId,
    certificateValid: true,
    field,
  })
  if (use.kind !== 'fill') throw new Error('useChanged')
  return use
}

/** Runs only in the broker-owned browser adapter, never in an extension/model tool handler. */
export class WebLoginFill {
  constructor(
    private readonly browser: WebBrowserOwnerPort,
    private readonly broker: WebUseBrokerPort,
    private readonly now: () => number,
  ) {}

  async describe(origin: string, field: WebFillUse['field']): Promise<WebFillUse> {
    return await this.browser.withTarget(webOrigin(origin), field, (target) =>
      Promise.resolve(fillUse(this.browser, target, webOrigin(origin), field)),
    )
  }

  /** The broker checks policy, taint, presence, replay and expiry before material is available. */
  async fill(ticketInput: VaultTicket, approved: WebFillUse, signal: AbortSignal): Promise<void> {
    await withWebTicket(
      this.browser,
      this.broker,
      ticketInput,
      approved,
      signal,
      async (target, check) => {
        const actual = fillUse(this.browser, target, approved.origin, approved.field)
        if (vaultUseDigest(actual) !== vaultUseDigest(approved)) throw new Error('useChanged')
        await this.broker.withApprovedMaterial(ticketInput.id, actual, async (raw) => {
          const item = vaultItemSchema.parse(raw)
          const material = item.material
          if (material.kind === 'webLogin' && !material.origins.includes(actual.origin))
            throw new Error('useChanged')
          let value: Buffer | undefined
          try {
            if (actual.field === 'totp') {
              if (material.kind === 'totp') value = totpCode(material.seed, this.now(), material)
              else if (material.kind === 'webLogin' && material.totpSeed !== null) {
                value = totpCode(material.totpSeed, this.now(), {
                  algorithm: 'sha1',
                  digits: VAULT_TOTP_DIGITS.standard,
                  periodSeconds: WEB_TOTP_PERIOD_SECONDS,
                })
              } else throw new Error('useChanged')
            } else {
              if (material.kind !== 'webLogin') throw new Error('useChanged')
              const bytes = material[actual.field]
              value = Buffer.alloc(bytes.byteLength)
              value.set(bytes)
            }
            check()
            if (
              vaultUseDigest(fillUse(this.browser, target, actual.origin, actual.field)) !==
              vaultUseDigest(approved)
            )
              throw new Error('useChanged')
            // No evaluate call, setter or value read. CDP needs a transient JS string;
            // its lifetime is unavoidable and is documented in the lane's residuals.
            z.object({}).parse(
              await target.cdp.send(
                'Input.insertText',
                { text: new TextDecoder('utf-8', { fatal: true }).decode(value) },
                target.sessionId,
              ),
            )
            check()
          } finally {
            value?.fill(0)
          }
        })
      },
    )
  }
}
