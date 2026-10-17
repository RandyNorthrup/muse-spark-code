import { randomUUID } from 'node:crypto'
import type { CreateElicitationRequest } from '@agentclientprotocol/sdk'
import type { CoreLogger } from '../../core/logging'
import { UI_TEXT } from '../../shared/constants'
import type { UsageAdapter } from './usageAdapter'
import { usageCompanionUrl } from './usageAdapter'
export { setUiText } from '../../shared/l10n/text'

/** The command's rendering and URL elicitation load on the first /usage. */
export async function replyAcpUsage(input: {
  readonly usage: Pick<UsageAdapter, 'access' | 'openPage'>
  readonly preparing: { abandonElicitation?: () => void }
  readonly canReply: () => boolean
  readonly send: (text: string) => void
  readonly canElicitUrl: boolean
  readonly sessionId: string
  readonly request: (params: CreateElicitationRequest, signal: AbortSignal) => Promise<unknown>
  readonly log: CoreLogger
}): Promise<void> {
  if (!input.canReply()) return
  const access = input.usage.access()
  const state = await access.read({ range: '30d', groupBy: 'provider', metric: 'cost' })
  if (!input.canReply()) return
  input.send(access.usageText(state, 'markdown', 'summary'))
  const url = usageCompanionUrl(await input.usage.openPage())
  if (!input.canReply()) return
  if (input.canElicitUrl) {
    const cancellation = new AbortController()
    const abandoned = new Promise<void>((resolve) => {
      input.preparing.abandonElicitation = () => {
        cancellation.abort()
        resolve()
      }
    })
    try {
      await Promise.race([
        input.request(
          {
            sessionId: input.sessionId,
            mode: 'url',
            elicitationId: randomUUID(),
            message: UI_TEXT.openUsagePage,
            url,
          },
          cancellation.signal,
        ),
        abandoned,
      ])
      return
    } catch {
      input.log.warn('ACP usage URL elicitation failed')
    } finally {
      delete input.preparing.abandonElicitation
    }
  }
  if (input.canReply()) input.send(`\n[${UI_TEXT.openUsagePage}](${url})`)
}
