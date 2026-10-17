import { randomUUID } from 'node:crypto'
import * as z from 'zod/mini'

const windowIdentitySchema = z.strictObject({
  instanceId: z.uuid(),
  startedAt: z.number().check(z.int(), z.nonnegative()),
})

export type WindowIdentity = z.infer<typeof windowIdentitySchema>

/** No captured VS Code identity distinguishes reloads from duplicate windows yet. */
export function createWindowIdentity(now: number): WindowIdentity {
  return windowIdentitySchema.parse({ instanceId: randomUUID(), startedAt: now })
}

export interface WindowAuthority {
  readonly identity: WindowIdentity
  canWrite(owner: WindowIdentity): boolean
  assertCanWrite(owner: WindowIdentity): void
  /** Only a confirmed Take over action grants authority; its receipt is written first. */
  takeOver(owner: WindowIdentity, isConfirmed: boolean): Promise<boolean>
}

export function createWindowAuthority(
  identity: WindowIdentity,
  recordTakeover: (owner: WindowIdentity) => Promise<void>,
): WindowAuthority {
  const current = windowIdentitySchema.parse(identity)
  const takenOver = new Set<string>()
  const keyFor = (owner: WindowIdentity) => JSON.stringify(windowIdentitySchema.parse(owner))
  const canWrite = (owner: WindowIdentity) =>
    (owner.instanceId === current.instanceId && owner.startedAt === current.startedAt) ||
    takenOver.has(keyFor(owner))
  return {
    identity: current,
    canWrite,
    assertCanWrite(owner) {
      if (!canWrite(owner)) throw new Error('TEAM_JOURNAL_OWNER_UNCONFIRMED')
    },
    async takeOver(owner, isConfirmed) {
      if (!isConfirmed) return false
      const key = keyFor(owner)
      if (!canWrite(owner)) {
        await recordTakeover(windowIdentitySchema.parse(owner))
        takenOver.add(key)
      }
      return true
    },
  }
}
