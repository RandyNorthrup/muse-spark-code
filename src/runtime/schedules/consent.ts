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
        try {
          const raw = await fs.read(file)
          current =
            raw === undefined ? undefined : scheduleBackgroundConsentSchema.parse(JSON.parse(raw))
        } catch {
          throw new Error('scheduleStoredJsonInvalid')
        }
        return await work(current, async (consent) => {
          await fs.replace(file, JSON.stringify(scheduleBackgroundConsentSchema.parse(consent)))
        })
      })
    },
  }
}
