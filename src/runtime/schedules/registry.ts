import * as z from 'zod/mini'
import type { ScheduleFsPort } from '../../core/schedules/journal'

const registrySchema = z.strictObject({ workspaces: z.array(z.string()) })

/** S's validated persisted workspace registry: every workspace that owns schedules. */
export function createWorkspaceRegistry(fs: ScheduleFsPort, file: string) {
  const read = async (): Promise<readonly string[]> => {
    try {
      const raw = await fs.read(file)
      return raw === undefined ? [] : registrySchema.parse(JSON.parse(raw)).workspaces
    } catch {
      throw new Error('scheduleStoredJsonInvalid')
    }
  }
  return {
    async add(workspaceKey: string): Promise<void> {
      const workspaces = await read()
      if (workspaces.includes(workspaceKey)) return
      await fs.replace(file, JSON.stringify({ workspaces: [...workspaces, workspaceKey] }))
    },
    async list(): Promise<readonly string[]> {
      return await read()
    },
  }
}
