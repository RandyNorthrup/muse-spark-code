import { pathToFileURL } from 'node:url'
import path from 'node:path'
import * as z from 'zod/mini'
import { UI_TEXT } from '../../../shared/constants'
import type { ReportDeliveryPayload } from './types'

const browserResourceSchema = z.discriminatedUnion('type', [
  z.strictObject({
    type: z.literal('local'),
    path: z.string().check(z.refine((value) => path.isAbsolute(value))),
  }),
  z.strictObject({ type: z.literal('node'), url: z.url() }),
])
export type ReportBrowserResource = z.infer<typeof browserResourceSchema>
export interface ReportBrowserPort {
  // Local storage confines/atomically saves HTML; the node supplies its private route.
  publishHtml(
    scheduleId: string,
    occurrence: string,
    html: string,
    storage: 'local' | 'node',
  ): Promise<ReportBrowserResource>
  hasActiveSession(): Promise<boolean>
  isAuthenticatedReportUrl(url: string): Promise<boolean>
  open(url: string): Promise<void>
}

export async function openReportInBrowser(
  port: ReportBrowserPort,
  scheduleId: string,
  payload: ReportDeliveryPayload,
  storage: 'local' | 'node',
): Promise<'opened' | 'waiting'> {
  // Do not publish or open anything until the user returns. The occurrence's
  // frozen payload is retained by the scheduler for Open when I'm back.
  if (!(await port.hasActiveSession())) return 'waiting'
  const resource = browserResourceSchema.parse(
    await port.publishHtml(scheduleId, payload.document.header.asOf, payload.html, storage),
  )
  let url: string
  if (storage === 'local' && resource.type === 'local') {
    url = pathToFileURL(resource.path).href
  } else if (storage === 'node' && resource.type === 'node') {
    const parsed = new URL(resource.url)
    if (
      parsed.protocol !== 'https:' ||
      parsed.username !== '' ||
      parsed.password !== '' ||
      !(await port.isAuthenticatedReportUrl(resource.url))
    )
      throw new Error(UI_TEXT.reportUi.generationFailed)
    url = resource.url
  } else throw new Error(UI_TEXT.reportUi.generationFailed)
  if (!(await port.hasActiveSession())) return 'waiting'
  await port.open(url)
  return 'opened'
}
