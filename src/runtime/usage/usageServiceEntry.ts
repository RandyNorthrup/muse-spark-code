// Lazy entry for VSIX hosts, ACP, native stdio adapters and the CLI. Lane W
// registers this entry as dist/usageService.js; no eager host imports it.
import {
  createUsageService,
  type UsageService,
  type UsageServiceDeps,
} from '../../core/usage/usageService'
import { usageText, type UsageTextFormat } from '../../core/usage/usageText'
import type { UiText } from '../../shared/l10n/en'
import { setUiText } from '../../shared/l10n/text'
import { setUsageText } from '../../shared/l10n/usageTable'
import {
  usageServiceToPageMessageSchema,
  type UsagePageState,
  type UsageServiceToPageMessage,
} from '../../shared/usagePage'
import { USAGE_RECORD_MAX_BYTES } from '../../shared/constants'

export interface UsageServiceEntryDeps extends UsageServiceDeps {
  readonly uiText: UiText
  readonly uiLocale: string
}
export function createUsageFeatures(
  deps: UsageServiceEntryDeps,
): UsageService & { readonly text: (state: UsagePageState, format?: UsageTextFormat) => string } {
  setUiText(deps.uiText, deps.uiLocale)
  setUsageText(deps.table.table)
  return { ...createUsageService(deps), text: usageText }
}

/** NDJSON transport for native plugins; CLI routing belongs to lane E. */
export async function serveUsageStdio(
  service: UsageService,
  ports: {
    readonly requests: AsyncIterable<string>
    readonly sendLine: (line: string) => Promise<void>
  },
): Promise<void> {
  for await (const line of ports.requests) {
    let replies: UsageServiceToPageMessage[]
    try {
      if (Buffer.byteLength(line, 'utf8') >= USAGE_RECORD_MAX_BYTES)
        throw new Error('oversized usage request')
      const input: unknown = JSON.parse(line)
      replies = await service.handle(input)
    } catch {
      replies = [{ type: 'usage/error', code: 'invalidMessage' }]
    }
    for (const reply of replies) {
      await ports.sendLine(`${JSON.stringify(usageServiceToPageMessageSchema.parse(reply))}\n`)
    }
  }
}
