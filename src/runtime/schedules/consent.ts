import type * as z from 'zod/mini'
import type { ScheduleFsPort } from '../../core/schedules/journal'
import { scheduleBackgroundConsentSchema } from '../../shared/scheduleV2'
import type { BackgroundConsentStore } from './background'

/** The consent file every native host reads; the fs lease serializes writers. */
export function createBackgroundConsentStore(
  fs: ScheduleFsPort,
  file: string,
): BackgroundConsentStore {
  return {
    async exclusive(work) {
      return await fs.lock(file, async () => {
        let current: z.infer<typeof scheduleBackgroundConsentSchema> | undefined
        // Deferred past the catch: the fixed refusal carries no cause
        // because a store failure's message can name the file's path.
        let isInvalid = false
        try {
          const raw = await fs.read(file)
          current =
            raw === undefined ? undefined : scheduleBackgroundConsentSchema.parse(JSON.parse(raw))
        } catch (error: unknown) {
          // A missing file is no consent; a file that cannot be read or
          // parsed is invalid, never consent. Anything else keeps its kind.
          if (!(error instanceof Error)) throw error
          isInvalid = true
        }
        if (isInvalid) throw new Error('scheduleStoredJsonInvalid')
        return await work(current, async (consent) => {
          await fs.replace(file, JSON.stringify(scheduleBackgroundConsentSchema.parse(consent)))
        })
      })
    },
  }
}
