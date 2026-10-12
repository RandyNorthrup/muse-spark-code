import type { ScheduleFsPort } from '../../core/schedules/journal'
import { storeErrorCode } from '../../host/backend/storeErrors'
import { UI_TEXT } from '../../shared/constants'
import { fill } from '../../shared/l10n/text'
import { scheduleBackgroundConsentSchema } from '../../shared/scheduleV2'
import type { BackgroundConsentStore } from './background'

const MISSING_CODE = 'ENOENT'
const UNREADABLE_PREFIX = 'scheduleStoredUnreadable:'

/** The consent file every native host reads; the fs lease serializes writers. */
export function createBackgroundConsentStore(
  fs: ScheduleFsPort,
  file: string,
): BackgroundConsentStore {
  return {
    async exclusive(work) {
      return await fs.lock(file, async () => {
        // Deferred past the catches: the fixed refusals carry no cause
        // because a store failure's message can name the file's path.
        let unreadable: string | undefined
        let isInvalid = false
        let raw: string | undefined
        try {
          raw = await fs.read(file)
        } catch (error: unknown) {
          // A missing file is no consent; a file the store cannot read is
          // neither absent nor corrupt, so its errno kind is kept for the
          // fixed refusal below. Anything without an errno keeps its kind.
          if (!(error instanceof Error)) throw error
          const code = storeErrorCode(error)
          if (code === undefined) throw error
          if (code === MISSING_CODE) raw = undefined
          else unreadable = code
        }
        let parsed: unknown
        if (unreadable === undefined && raw !== undefined) {
          try {
            parsed = JSON.parse(raw)
          } catch (error: unknown) {
            // Only malformed text reads invalid here; anything else keeps its kind.
            if (!(error instanceof SyntaxError)) throw error
            isInvalid = true
          }
        }
        if (unreadable !== undefined) throw new Error(`${UNREADABLE_PREFIX}${unreadable}`)
        if (isInvalid) throw new Error('scheduleStoredJsonInvalid')
        if (raw === undefined) {
          return await work(undefined, async (consent) => {
            await fs.replace(file, JSON.stringify(scheduleBackgroundConsentSchema.parse(consent)))
          })
        }
        // The schema verdict never throws: a file that was read but is not
        // the consent shape is invalid.
        const verified = scheduleBackgroundConsentSchema.safeParse(parsed)
        if (!verified.success) throw new Error('scheduleStoredJsonInvalid')
        return await work(verified.data, async (next) => {
          await fs.replace(file, JSON.stringify(scheduleBackgroundConsentSchema.parse(next)))
        })
      })
    },
  }
}

/**
 * What the person is told when the consent file cannot be read (P3-4): the
 * errno the store kept reaches the sentence through a closed kind word,
 * never raw. Anything else (including the invalid shape) is not ours to say.
 */
export function scheduleStoredUnreadableReason(error: unknown): string | undefined {
  if (!(error instanceof Error)) return undefined
  if (!error.message.startsWith(UNREADABLE_PREFIX)) return undefined
  const code = error.message.slice(UNREADABLE_PREFIX.length)
  return fill(UI_TEXT.scheduleConsentUnreadable, { reason: scheduleStoreKindWord(code) })
}

function scheduleStoreKindWord(code: string): string {
  if (['EACCES', 'EPERM'].includes(code)) {
    return UI_TEXT.scheduleStoreReasonDenied
  }
  return ['ENOSPC', 'EROFS', 'EDQUOT'].includes(code)
    ? UI_TEXT.scheduleStoreReasonDiskFull
    : UI_TEXT.scheduleStoreReasonUnknown
}
