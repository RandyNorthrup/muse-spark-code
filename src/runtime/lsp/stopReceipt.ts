import * as z from 'zod/mini'
import {
  resourceProcessIdentitySchema,
  resourceTicketSchema,
  type ResourceProcessIdentity,
} from '../../shared/resources'
import { RUNTIME_STOP } from '../../shared/constants'

const stopBindingSchema = z.strictObject({
  generation: z
    .string()
    .check(
      z.regex(/^[a-f0-9]+$/u),
      z.minLength(RUNTIME_STOP.generationBytes * 2),
      z.maxLength(RUNTIME_STOP.generationBytes * 2),
    ),
  ownerId: z.string().check(z.uuid()),
  ticketId: z.string().check(z.uuid()),
  guardian: resourceProcessIdentitySchema,
  root: resourceProcessIdentitySchema,
})
export type StopBinding = z.infer<typeof stopBindingSchema>
export const treeReceiptSchema = z.extend(stopBindingSchema, {
  isComplete: z.boolean(),
  members: z.array(resourceProcessIdentitySchema).check(z.minLength(1)),
})
export function isSameProcess(
  left: ResourceProcessIdentity,
  right: ResourceProcessIdentity,
): boolean {
  return left.pid === right.pid && left.startTime === right.startTime
}
export function isReceiptMatching(
  receipt: z.infer<typeof treeReceiptSchema>,
  binding: StopBinding,
): boolean {
  return (
    receipt.generation === binding.generation &&
    receipt.ownerId === binding.ownerId &&
    receipt.ticketId === binding.ticketId &&
    isSameProcess(receipt.guardian, binding.guardian) &&
    isSameProcess(receipt.root, binding.root) &&
    receipt.members.some((member) => isSameProcess(member, binding.root))
  )
}

export const ownerSchema = z.strictObject({
  trustRoot: z.string().check(z.minLength(1), z.maxLength(RUNTIME_STOP.pathChars)),
  pid: z.int().check(z.gte(1)),
  generation: stopBindingSchema.shape.generation,
  ownerId: stopBindingSchema.shape.ownerId,
  binding: z.nullable(stopBindingSchema),
  pipe: z.string().check(z.maxLength(RUNTIME_STOP.pathChars)),
  token: z
    .string()
    .check(
      z.regex(/^[a-f0-9]+$/u),
      z.minLength(RUNTIME_STOP.tokenBytes * 2),
      z.maxLength(RUNTIME_STOP.tokenBytes * 2),
    ),
})

export type StopOwner = z.infer<typeof ownerSchema>
export const rootLocatorSchema = z.strictObject({ trustRoot: ownerSchema.shape.trustRoot })
export type StopReceipt = z.infer<typeof treeReceiptSchema>
export const guardianMessageSchema = z.strictObject({
  ticket: resourceTicketSchema,
  binding: stopBindingSchema,
})
