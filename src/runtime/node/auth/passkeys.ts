import { verifyAuthenticationResponse, verifyRegistrationResponse } from '@simplewebauthn/server'
import * as z from 'zod/mini'
import { NODE_AUTH_ALGORITHMS, UI_TEXT } from '../../../shared/constants'
import {
  nodeAssertionSchema,
  nodePasskeySchema,
  nodeRegistrationSchema,
  type NodeAuthChallenge,
} from '../../../shared/nodeAuth'

export type NodePasskey = z.infer<typeof nodePasskeySchema>
export interface NodePasskeyVerifier {
  enroll(challenge: NodeAuthChallenge, raw: unknown, ownerId: string): Promise<NodePasskey>
  assert(challenge: NodeAuthChallenge, raw: unknown, key: NodePasskey): Promise<number>
}
const clientData = z.object({ crossOrigin: z.optional(z.boolean()) })

function checkClientData(encoded: string): void {
  const raw: unknown = JSON.parse(
    new TextDecoder('utf-8', { fatal: true }).decode(Buffer.from(encoded, 'base64url')),
  )
  if (clientData.parse(raw).crossOrigin === true) throw new Error(UI_TEXT.nodeErrors.forbidden)
}

function credentialFields(
  response: z.infer<typeof nodeRegistrationSchema> | z.infer<typeof nodeAssertionSchema>,
) {
  return {
    id: response.id,
    rawId: response.rawId,
    type: response.type,
    clientExtensionResults:
      response.clientExtensionResults.credProps?.rk === undefined
        ? {}
        : { credProps: { rk: response.clientExtensionResults.credProps.rk } },
    ...(response.authenticatorAttachment !== undefined && {
      authenticatorAttachment: response.authenticatorAttachment,
    }),
  }
}

/** No library error text leaves this boundary: it may contain proof/challenge bytes. */
export class SimpleNodePasskeys implements NodePasskeyVerifier {
  async enroll(challenge: NodeAuthChallenge, raw: unknown, ownerId: string): Promise<NodePasskey> {
    try {
      const response = nodeRegistrationSchema.parse(raw)
      if (challenge.purpose !== 'enroll' || response.id !== response.rawId)
        throw new Error(UI_TEXT.nodeErrors.unauthenticated)
      checkClientData(response.response.clientDataJSON)
      const result = await verifyRegistrationResponse({
        response: {
          ...credentialFields(response),
          response: {
            clientDataJSON: response.response.clientDataJSON,
            attestationObject: response.response.attestationObject,
            transports: response.response.transports ?? [],
          },
        },
        expectedChallenge: challenge.challenge,
        expectedOrigin: challenge.origin,
        expectedRPID: challenge.rpId,
        expectedType: 'webauthn.create',
        requireUserPresence: true,
        requireUserVerification: true,
        supportedAlgorithmIDs: [...NODE_AUTH_ALGORITHMS],
      })
      if (!result.verified || !result.registrationInfo.userVerified)
        throw new Error(UI_TEXT.nodeErrors.unauthenticated)
      const credential = result.registrationInfo.credential
      return nodePasskeySchema.parse({
        id: credential.id,
        ownerId,
        publicKey: Buffer.from(credential.publicKey).toString('base64url'),
        counter: credential.counter,
        failures: 0,
        disabled: false,
      })
    } catch (error: unknown) {
      throw new Error(UI_TEXT.nodeErrors.unauthenticated, { cause: error })
    }
  }

  async assert(challenge: NodeAuthChallenge, raw: unknown, key: NodePasskey): Promise<number> {
    try {
      const response = nodeAssertionSchema.parse(raw)
      if (
        challenge.purpose === 'enroll' ||
        key.disabled ||
        response.id !== key.id ||
        response.id !== response.rawId
      )
        throw new Error(UI_TEXT.nodeErrors.unauthenticated)
      checkClientData(response.response.clientDataJSON)
      const result = await verifyAuthenticationResponse({
        response: {
          ...credentialFields(response),
          response: {
            clientDataJSON: response.response.clientDataJSON,
            authenticatorData: response.response.authenticatorData,
            signature: response.response.signature,
            ...(response.response.userHandle != null && {
              userHandle: response.response.userHandle,
            }),
          },
        },
        credential: {
          id: key.id,
          publicKey: Buffer.from(key.publicKey, 'base64url'),
          counter: key.counter,
        },
        expectedChallenge: challenge.challenge,
        expectedOrigin: challenge.origin,
        expectedRPID: challenge.rpId,
        expectedType: 'webauthn.get',
        requireUserVerification: true,
      })
      if (!result.verified || !result.authenticationInfo.userVerified)
        throw new Error(UI_TEXT.nodeErrors.unauthenticated)
      return result.authenticationInfo.newCounter
    } catch (error: unknown) {
      throw new Error(UI_TEXT.nodeErrors.unauthenticated, { cause: error })
    }
  }
}
