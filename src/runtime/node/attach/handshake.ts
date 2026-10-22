// Attaching to a node (M110d lane G, D90.12): the editor's side proves
// which node it speaks to, and the node proves itself back, by signing a
// fresh challenge with its identity key. The transport under this (M100's
// lane T) is the leg that waits; the handshake itself runs anywhere.
import { randomBytes } from 'node:crypto'
import * as z from 'zod/mini'
import {
  identityPublicKeySchema,
  isIdentityChallengeValid,
  signIdentityChallenge,
} from '../../../core/devices/identity'

const ATTACH_CHALLENGE_BYTES = 32

export const attachChallengeSchema = z.strictObject({
  challenge: z.string().check(z.minLength(1)),
})
export type AttachChallenge = z.infer<typeof attachChallengeSchema>

/** A fresh challenge for the other side to sign. */
export function createAttachChallenge(): AttachChallenge {
  return { challenge: randomBytes(ATTACH_CHALLENGE_BYTES).toString('base64') }
}

/** Answer with this side's identity; the signature names no one else. */
export function answerAttachChallenge(privateKey: string, challenge: AttachChallenge): string {
  const parsed = attachChallengeSchema.parse(challenge)
  return signIdentityChallenge(privateKey, Buffer.from(parsed.challenge, 'base64'))
}

/** Accept only the expected node's live signature on this challenge. */
export function isAttachAnswerValid(
  expectedNode: string,
  challenge: AttachChallenge,
  answer: string,
): boolean {
  const node = identityPublicKeySchema.parse(expectedNode)
  const parsed = attachChallengeSchema.parse(challenge)
  return isIdentityChallengeValid(node, Buffer.from(parsed.challenge, 'base64'), answer)
}
