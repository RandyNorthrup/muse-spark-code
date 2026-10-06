// Finite child-process determinism fixture. All external services are test fakes.
import {
  ScheduledReportRunner,
  type ScheduledReportPorts,
} from '../../../../src/core/reporting/destinations/runner'
import { ReportEmailDelivery } from '../../../../src/core/reporting/destinations/email'
import { ReportPostDelivery } from '../../../../src/core/reporting/destinations/post'
import { EN } from '../../../../src/shared/l10n/en'
import { reportDocumentSchema } from '../../../../src/shared/reportSchema'
import { finalizeReport } from '../../../../src/core/reporting/render/canonical'
import { renderFixture, REPORT_THEME } from '../../reportRenderFixtures'
import type { ReportOccurrenceRecord } from '../../../../src/core/reporting/destinations/types'

export async function runScheduledReportFixture(): Promise<string> {
  const email = new ReportEmailDelivery(
    {
      isRecipientAllowed: () => Promise.resolve(false),
      connectionPolicy: () =>
        Promise.resolve({ connectedByUser: false, tls: false, certificateChecked: false }),
      send: () => Promise.reject(new Error('Fixture prohibits mail')),
      confirmFirstSend: () => Promise.resolve(false),
    },
    { update: () => Promise.reject(new Error('Fixture prohibits mail state')) },
    () => 0,
  )
  const post = new ReportPostDelivery({
    isEnabled: () => Promise.resolve(false),
    isConfirmed: () => Promise.resolve(false),
    previewAndConfirm: () => Promise.resolve(false),
    rememberConfirmation: () => Promise.reject(new Error('Fixture prohibits posting')),
    publish: () => Promise.reject(new Error('Fixture prohibits posting')),
  })
  let record: ReportOccurrenceRecord | null = null
  const ports: ScheduledReportPorts = {
    authority: {
      authorize: () =>
        Promise.resolve({ allowed: true, roots: [], creator: 'user', network: false }),
    },
    generation: {
      generate: (options) => {
        const document = reportDocumentSchema.parse(renderFixture())
        document.header.asOf = options.asOf
        return Promise.resolve(finalizeReport(document))
      },
    },
    occurrences: {
      exclusive: async (_schedule, _occurrence, work) => await work(),
      read: () => Promise.resolve(record),
      write: (_schedule, _occurrence, next) => {
        record = next
        return Promise.resolve()
      },
    },
    locale: { textForLocale: () => EN },
    redaction: {},
    email,
    post,
    browser: {
      publishHtml: () => Promise.reject(new Error('Inactive fixture never publishes')),
      hasActiveSession: () => Promise.resolve(false),
      isAuthenticatedReportUrl: () => Promise.resolve(false),
      open: () => Promise.reject(new Error('Inactive fixture never opens')),
    },
    nodeSave: () => Promise.reject(new Error('Fixture prohibits node saves')),
    sleep: () => Promise.resolve(),
  }
  await new ScheduledReportRunner(ports).run('one', '2026-10-06T12:00:00+00:00', {
    type: 'report',
    options: {
      kind: 'project',
      scope: 'Fixture workspace',
      asOf: '2025-01-01T00:00:00Z',
      full: false,
      network: false,
      failOn: [],
    },
    format: 'md',
    locale: 'en',
    theme: REPORT_THEME,
    destinations: [{ type: 'browser', id: 'browser', storage: 'node' }],
  })
  const saved = await ports.occurrences.read('one', '2026-10-06T12:00:00+00:00')
  if (saved === null) throw new Error('Fixture did not save occurrence')
  return JSON.stringify(saved.payload)
}
