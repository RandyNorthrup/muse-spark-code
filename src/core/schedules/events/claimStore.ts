import * as z from 'zod/mini'
import { scheduleEventSchema } from '../../../shared/scheduleEvents'
import { parseScheduleStoredJson, type ScheduleFsPort } from '../journal'
import { scheduleStorageHash } from '../store'
import type {
  ScheduleEventClaimState,
  ScheduleEventClaimStore,
  ScheduleEventPendingBurst,
} from './engine'

const burstSchema = z.strictObject({
  event: scheduleEventSchema,
  readyAt: z.int().check(z.gte(0)),
  count: z.int().check(z.gte(1)),
  owner: z.string().check(z.minLength(1)),
  runId: z.string().check(z.minLength(1)),
})
const claimStateSchema = z.strictObject({
  scheduleId: z.string().check(z.minLength(1)),
  receipts: z.array(z.string().check(z.minLength(1))),
  legacyReceipts: z.array(z.string().check(z.minLength(1))),
  open: z.optional(burstSchema),
  ready: z.array(burstSchema),
})
type StoredClaimState = z.infer<typeof claimStateSchema>

const folder = (workspaceKey: string): string => `${workspaceKey}/events`
const stateFile = (workspaceKey: string, scheduleId: string): string =>
  `${folder(workspaceKey)}/${scheduleStorageHash(scheduleId)}.json`

function toState(stored: StoredClaimState): ScheduleEventClaimState {
  return {
    receipts: new Set(stored.receipts),
    legacyReceipts: new Set(stored.legacyReceipts),
    ...(stored.open !== undefined && { open: stored.open }),
    ready: [...stored.ready],
  }
}

function fromState(scheduleId: string, state: ScheduleEventClaimState): StoredClaimState {
  const open: ScheduleEventPendingBurst | undefined = state.open
  return claimStateSchema.parse({
    scheduleId,
    receipts: [...state.receipts],
    legacyReceipts: [...state.legacyReceipts],
    ...(open !== undefined && { open }),
    ready: state.ready,
  })
}

/**
S's durable binding for E's engine: one state file per schedule, every
mutation under the store's cross-process lock, persisted before return.
Receipts never expire: an event instance fires once across restarts.
*/
export function createEventClaimStore(
  fs: ScheduleFsPort,
  workspaceKey: string,
): ScheduleEventClaimStore {
  return {
    async schedules(): Promise<readonly string[]> {
      const names = await fs.names(folder(workspaceKey))
      const ids: string[] = []
      for (const name of names) {
        if (!name.endsWith('.json')) continue
        const raw = await fs.read(`${folder(workspaceKey)}/${name}`)
        if (raw === undefined) continue
        const stored = claimStateSchema.parse(parseScheduleStoredJson(raw))
        ids.push(stored.scheduleId)
      }
      return ids
    },
    async transact<T>(
      scheduleId: string,
      update: (state: ScheduleEventClaimState) => T,
    ): Promise<T> {
      const file = stateFile(workspaceKey, scheduleId)
      return await fs.lock(file, async () => {
        const raw = await fs.read(file)
        const stored =
          raw === undefined
            ? claimStateSchema.parse({
                scheduleId,
                receipts: [],
                legacyReceipts: [],
                ready: [],
              })
            : claimStateSchema.parse(parseScheduleStoredJson(raw))
        if (stored.scheduleId !== scheduleId) throw new Error('scheduleStoredJsonInvalid')
        const state = toState(stored)
        const result = update(state)
        await fs.replace(file, JSON.stringify(fromState(scheduleId, state)))
        return result
      })
    },
  }
}
