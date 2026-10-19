import * as z from 'zod/mini'
import type { ScheduleFsPort } from '../../core/schedules/journal'
import path from 'node:path'
import { workspaceKey as keyOf } from '../dataFolder'

const registrySchema = z.strictObject({
  workspaces: z.array(z.string()),
  roots: z.optional(z.record(z.string(), z.string())),
})

/** S's validated persisted workspace registry: every workspace that owns schedules. */
export function createWorkspaceRegistry(fs: ScheduleFsPort, file: string) {
  const read = async () => {
    try {
      const raw = await fs.read(file)
      return raw === undefined ? { workspaces: [] } : registrySchema.parse(JSON.parse(raw))
    } catch (error: unknown) {
      throw new Error('scheduleStoredJsonInvalid', { cause: error })
    }
  }
  return {
    async add(workspaceKey: string, root?: string): Promise<void> {
      if (
        root !== undefined &&
        (!path.isAbsolute(root) || keyOf(path.resolve(root)) !== workspaceKey)
      )
        throw new Error('scheduleStoredJsonInvalid')
      await fs.lock(file, async (guard) => {
        const current = await read()
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
        )
      })
    },
    async list(): Promise<readonly string[]> {
      const current = await read()
      return current.workspaces
    },
    async root(workspaceKey: string): Promise<string | undefined> {
      const current = await read()
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
