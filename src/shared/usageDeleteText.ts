import { plural } from './l10n/text'
import { USAGE_TEXT } from './l10n/usageTable'

/**
 * The Delete history prompt names what it removes with the real counts: the
 * usage records and, when there are any, the resource history entries (M107
 * J) kept under the same usage folder. Every editor's dialog uses this text.
 */
export function usageDeleteDetail(records: number, resources: number): string {
  const usage = plural(USAGE_TEXT.deleteConfirm, records)
  return resources === 0
    ? usage
    : `${usage} ${plural(USAGE_TEXT.deleteConfirmResources, resources)}`
}
