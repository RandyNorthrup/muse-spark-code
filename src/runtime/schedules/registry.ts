import * as z from 'zod/mini'
import type { ScheduleFsPort } from '../../core/schedules/journal'
import path from 'node:path'
import { eitherSignal, type ScheduleCallOptions } from '../../shared/scheduleV2'
import { workspaceKey as keyOf } from '../dataFolder'

const registrySchema = z.strictObject({
  workspaces: z.array(z.string()),
  roots: z.optional(z.record(z.string(), z.string())),
})

/** S's validated persisted workspace registry: every workspace that owns schedules. */
export function createWorkspaceRegistry(
  fs: ScheduleFsPort,
  file: string,
  bound?: ScheduleCallOptions,
) {
  const effective = (call?: ScheduleCallOptions): ScheduleCallOptions | undefined => {
    const signal = eitherSignal(bound?.signal, call?.signal)
    return signal === undefined ? undefined : { signal }
  }
  const read = async (call?: ScheduleCallOptions) => {
    try {
      const raw = await fs.read(file, call)
      return raw === undefined ? { workspaces: [] } : registrySchema.parse(JSON.parse(raw))
    } catch (error: unknown) {
      // The stop is not corruption: an abort ends the read instead of
      // refusing the file as invalid.
      call?.signal?.throwIfAborted()
      throw new Error('scheduleStoredJsonInvalid', { cause: error })
    }
  }
  return {
    async add(workspaceKey: string, root?: string, options?: ScheduleCallOptions): Promise<void> {
      if (
        root !== undefined &&
        (!path.isAbsolute(root) || keyOf(path.resolve(root)) !== workspaceKey)
      )
        throw new Error('scheduleStoredJsonInvalid')
      const call = effective(options)
      await fs.lock(
        file,
        async (guard) => {
          const current = await read(call)
          const workspaces = current.workspaces.includes(workspaceKey)
            ? current.workspaces
            : [...current.workspaces, workspaceKey]
          await fs.replace(
            file,
            JSON.stringify({
              workspaces,
              ...((current.roots !== undefined || root !== undefined) && {
                roots: { ...current.roots, ...(root !== undefined && { [workspaceKey]: root }) },
              }),
            }),
            guard,
            call,
          )
        },
        call,
      )
    },
    async list(options?: ScheduleCallOptions): Promise<readonly string[]> {
      const current = await read(effective(options))
      return current.workspaces
    },
    async root(workspaceKey: string, options?: ScheduleCallOptions): Promise<string | undefined> {
      const current = await read(effective(options))
      const root = current.roots?.[workspaceKey]
      if (root === undefined) return undefined
      if (
        !current.workspaces.includes(workspaceKey) ||
        !path.isAbsolute(root) ||
        keyOf(path.resolve(root)) !== workspaceKey
      )
        throw new Error('scheduleStoredJsonInvalid')
      return path.resolve(root)
    },
  }
}
