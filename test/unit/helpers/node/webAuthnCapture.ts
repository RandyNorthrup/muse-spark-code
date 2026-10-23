import * as z from 'zod/mini'
import raw from '../../../fixtures/node-auth/cdp-v1.json'

// Public signed binary fields use byte arrays in storage, not secret-like tokens.
const publicBytes = z.array(z.number().check(z.int(), z.minimum(0), z.maximum(255)))
function decode<T extends { authenticatorData: number[] }>(response: T) {
  const { authenticatorData, ...fields } = response
  return {
    ...fields,
    authenticatorData: Buffer.from(publicBytes.parse(authenticatorData)).toString('base64url'),
  }
}

export const nodeWebAuthnCapture = {
  ...raw,
  assertions: raw.assertions.map((proof) => ({ ...proof, response: decode(proof.response) })),
  noUv: { ...raw.noUv, response: decode(raw.noUv.response) },
  sdkAssertion: { ...raw.sdkAssertion, response: decode(raw.sdkAssertion.response) },
  sdkRegistration: { ...raw.sdkRegistration, response: decode(raw.sdkRegistration.response) },
}
