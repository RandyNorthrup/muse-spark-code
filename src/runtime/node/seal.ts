// Sealed at boot (M110d lane X2, D90.9): a node set to start sealed keeps
// its data key wrapped until a paired device authorizes the unseal. The
// authorization is a signed unseal statement the node checks against the
// approver's identity key; the KEK's own slot (M109's paired slot) is the
// leg that waits, so wrapping takes the KEK as a parameter.
import { createDecipheriv, createCipheriv, createPublicKey, randomBytes } from 'node:crypto'
import * as z from 'zod/mini'
import {
  identityPublicKeySchema,
  isIdentityChallengeValid,
  signIdentityChallenge,
} from '../../core/devices/identity'

const DATA_KEY_BYTES = 32
const KEK_BYTES = 32
const GCM_IV_BYTES = 12
const GCM_TAG_BYTES = 16
const UNSEAL_STATEMENT = 'muse-node-unseal-v1'

export const nodeSealSchema = z.union([
  z.strictObject({ state: z.literal('sealed') }),
  z.strictObject({ state: z.literal('open'), nodeId: z.string().check(z.minLength(1)) }),
])
export type NodeSeal = z.infer<typeof nodeSealSchema>

export const unsealAuthorizationSchema = z.strictObject({
  nodeId: z.string().check(z.minLength(1)),
  approver: identityPublicKeySchema,
  signature: z.string().check(z.minLength(1)),
})
export type UnsealAuthorization = z.infer<typeof unsealAuthorizationSchema>

function unsealStatement(nodeId: string): Uint8Array {
  return Buffer.from(`${UNSEAL_STATEMENT}:${nodeId}`, 'utf8')
}

/** The paired device's side: sign this node's unseal statement. */
export function authorizeUnseal(
  nodeId: string,
  approverPrivateKey: Uint8Array,
): UnsealAuthorization {
  if (nodeId.length === 0) throw new Error('an unseal names its node')
  const approver = createPublicKey({
    key: Buffer.from(approverPrivateKey),
    format: 'der',
    type: 'pkcs8',
  })
    .export({ type: 'spki', format: 'der' })
    .toString('base64')
  const signature = signIdentityChallenge(
    Buffer.from(approverPrivateKey).toString('base64'),
    unsealStatement(nodeId),
  )
  return unsealAuthorizationSchema.parse({ nodeId, approver, signature })
}

/** The node's side: open only on a paired approver's live signature. */
export function unsealNode(
  seal: NodeSeal,
  authorization: UnsealAuthorization,
  pairedApprovers: readonly string[],
): NodeSeal {
  const parsed = nodeSealSchema.parse(seal)
  if (parsed.state === 'open') throw new Error('this node is already open')
  const grant = unsealAuthorizationSchema.parse(authorization)
  if (!pairedApprovers.includes(grant.approver)) throw new Error('this approver is not paired')
  if (!isIdentityChallengeValid(grant.approver, unsealStatement(grant.nodeId), grant.signature))
    throw new Error('this unseal signature is wrong')
  return { state: 'open', nodeId: grant.nodeId }
}

export function sealNode(seal: NodeSeal): NodeSeal {
  nodeSealSchema.parse(seal)
  return { state: 'sealed' }
}

export function wrapDataKey(dataKey: Uint8Array, kek: Uint8Array): string {
  if (dataKey.length !== DATA_KEY_BYTES) throw new Error('the data key is 32 bytes')
  if (kek.length !== KEK_BYTES) throw new Error('the wrapping key is 32 bytes')
  const iv = randomBytes(GCM_IV_BYTES)
  const cipher = createCipheriv('aes-256-gcm', kek, iv)
  const sealed = Buffer.concat([cipher.update(dataKey), cipher.final(), cipher.getAuthTag()])
  return `${iv.toString('base64')}.${sealed.toString('base64')}`
}

/** Unwrap, or undefined when the key or the bytes are wrong. Never throws. */
export function unwrapDataKey(wrapped: string, kek: Uint8Array): Uint8Array | undefined {
  if (kek.length !== KEK_BYTES) return undefined
  const [ivText, sealedText] = wrapped.split('.', 2)
  if (ivText === undefined || sealedText === undefined) return undefined
  const iv = Buffer.from(ivText, 'base64')
  const sealed = Buffer.from(sealedText, 'base64')
  if (iv.length !== GCM_IV_BYTES || sealed.length !== DATA_KEY_BYTES + GCM_TAG_BYTES)
    return undefined
  try {
    const decipher = createDecipheriv('aes-256-gcm', kek, iv)
    decipher.setAuthTag(sealed.subarray(sealed.length - GCM_TAG_BYTES))
    const dataKey = Buffer.concat([
      decipher.update(sealed.subarray(0, sealed.length - GCM_TAG_BYTES)),
      decipher.final(),
    ])
    return dataKey.length === DATA_KEY_BYTES ? dataKey : undefined
  } catch (error) {
    if (error instanceof Error) return undefined
    throw error
  }
}
