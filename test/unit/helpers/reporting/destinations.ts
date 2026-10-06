import { vi } from 'vitest'
import { EN } from '../../../../src/shared/l10n/en'
import { finalizeReport } from '../../../../src/core/reporting/render/canonical'
import { createReportRenderers } from '../../../../src/core/reporting/render'
import {
  ReportEmailDelivery,
  type ReportMailPort,
  type ReportMailState,
  type ReportMailStatePort,
} from '../../../../src/core/reporting/destinations/email'
import {
  ReportPostDelivery,
  type ReportPostPort,
} from '../../../../src/core/reporting/destinations/post'
import type { ReportBrowserPort } from '../../../../src/core/reporting/destinations/browser'
import type {
  ReportMailConnection,
  ReportGenerationPort,
  ReportOccurrenceRecord,
  ReportScheduleAuthorityPort,
  ScheduledReportAction,
} from '../../../../src/core/reporting/destinations/types'
import type { ScheduledReportPorts } from '../../../../src/core/reporting/destinations/runner'
import { renderFixture, REPORT_THEME } from '../../reportRenderFixtures'

export const OCCURRENCE = '2026-10-06T12:00:00+00:00'
export const CONNECTION = {
  provider: 'smtp',
  vaultItemId: 'user-mail',
} satisfies ReportMailConnection
export const ADDRESS = 'owner@example.test'
export function deliveryPayload(asOf = OCCURRENCE, format: ScheduledReportAction['format'] = 'md') {
  const document = renderFixture()
  document.header.asOf = asOf
  const checked = finalizeReport(document)
  const render = createReportRenderers({ textForLocale: () => EN })
  return {
    document: checked,
    format,
    locale: 'en',
    theme: REPORT_THEME,
    attachment: render[format](checked, 'en', REPORT_THEME),
    html: render.html(checked, 'en', REPORT_THEME),
    text: render.text(checked, 'en', REPORT_THEME),
    markdown: render.md(checked, 'en', REPORT_THEME),
  }
}
export function reportAction(
  destinations: ScheduledReportAction['destinations'],
): ScheduledReportAction {
  return {
    type: 'report',
    format: 'md',
    locale: 'en',
    theme: REPORT_THEME,
    destinations,
    options: {
      kind: 'project',
      scope: 'Fixture workspace',
      asOf: OCCURRENCE,
      full: false,
      network: false,
      failOn: [],
    },
  }
}
export class MailStore implements ReportMailStatePort {
  state: ReportMailState = { challenges: {}, verified: [], confirmed: [], reservations: [] }
  update<T>(
    change: (state: ReportMailState) => { readonly state: ReportMailState; readonly value: T },
  ): Promise<T> {
    const result = change(structuredClone(this.state))
    this.state = structuredClone(result.state)
    return Promise.resolve(result.value)
  }
}
export function mailRig() {
  const store = new MailStore()
  let time = Date.parse(OCCURRENCE)
  const port = {
    isRecipientAllowed: vi.fn((address: string) => Promise.resolve(address === ADDRESS)),
    connectionPolicy: vi.fn<ReportMailPort['connectionPolicy']>(() =>
      Promise.resolve({ connectedByUser: true, tls: true, certificateChecked: true }),
    ),
    send: vi.fn<ReportMailPort['send']>(() => Promise.resolve({ status: 'delivered' })),
    confirmFirstSend: vi.fn<ReportMailPort['confirmFirstSend']>(() => Promise.resolve(true)),
  } satisfies ReportMailPort
  const email = new ReportEmailDelivery(port, store, () => time)
  return {
    email,
    store,
    port,
    advance: (ms: number) => {
      time += ms
    },
    verify: async () => {
      await email.requestVerification(ADDRESS, CONNECTION)
      const code = port.send.mock.calls.at(-1)?.[1].text.match(/\d{6}/)?.[0]
      if (code === undefined) throw new Error('Fixture code was not sent')
      return await email.verify(ADDRESS, code)
    },
  }
}
export function runnerRig() {
  const mail = mailRig()
  const postPort = {
    isEnabled: vi.fn(() => Promise.resolve(true)),
    isConfirmed: vi.fn(() => Promise.resolve(true)),
    previewAndConfirm: vi.fn(() => Promise.resolve(true)),
    rememberConfirmation: vi.fn(() => Promise.resolve()),
    publish: vi.fn<ReportPostPort['publish']>(() => Promise.resolve({ status: 'delivered' })),
  } satisfies ReportPostPort
  const browser = {
    publishHtml: vi.fn<ReportBrowserPort['publishHtml']>(() =>
      Promise.resolve({ type: 'node', url: 'https://node.example.test/private/reports/one' }),
    ),
    hasActiveSession: vi.fn(() => Promise.resolve(true)),
    isAuthenticatedReportUrl: vi.fn(() => Promise.resolve(true)),
    open: vi.fn<ReportBrowserPort['open']>(() => Promise.resolve()),
  } satisfies ReportBrowserPort
  const records = new Map<string, ReportOccurrenceRecord>()
  const ports: ScheduledReportPorts = {
    authority: {
      authorize: vi.fn<ReportScheduleAuthorityPort['authorize']>(() =>
        Promise.resolve({ allowed: true, roots: [], network: false, creator: 'user' }),
      ),
    },
    generation: {
      generate: vi.fn<ReportGenerationPort['generate']>((options) =>
        Promise.resolve(deliveryPayload(options.asOf).document),
      ),
    },
    occurrences: {
      exclusive: async (_schedule, _occurrence, work) => await work(),
      read: (_schedule, occurrence) =>
        Promise.resolve(structuredClone(records.get(occurrence) ?? null)),
      write: (_schedule, occurrence, record) => {
        records.set(occurrence, structuredClone(record))
        return Promise.resolve()
      },
    },
    locale: { textForLocale: () => EN },
    redaction: {},
    email: mail.email,
    post: new ReportPostDelivery(postPort),
    browser,
    nodeSave: vi.fn(() => Promise.resolve()),
    sleep: vi.fn(() => Promise.resolve()),
  }
  return { ports, mail, browser, postPort, records }
}
