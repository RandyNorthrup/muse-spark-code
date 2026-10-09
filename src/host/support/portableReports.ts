import type { ConversationReports } from '../conversation/conversationController'
import type { ReportScrubContext } from '../../core/support/problemReport'
import type { HostServices } from '../../shared/hostApi/methods'
import type { ReportEditorIo } from './reportProblem'
import { createWindowJournal, type WindowJournalOptions } from './recorderEntry'
import { ReportRecorder } from './reportRecorder'

export interface PortableReportDeps {
  readonly journal: WindowJournalOptions
  readonly host: HostServices
  /** Locally gathered allowlisted facts; the report builder validates and scrubs them again. */
  readonly readFacts: () => Promise<unknown>
  readonly readScrub: () => ReportScrubContext
  /** Native/companion save picker and exact-text write; false only for user cancellation. */
  readonly saveText: ReportEditorIo['saveText']
  /** Register shutdown immediately, before startup awaits or any controller publication. */
  readonly own: (dispose: () => Promise<void>) => void
}

/** Uses the existing persistent, bounded, facts-only recorder and sealed export handler. */
export async function createPortableReports(deps: PortableReportDeps): Promise<{
  readonly reports: ConversationReports
  readonly offerReport: boolean
  readonly dispose: () => Promise<void>
}> {
  const recorder = new ReportRecorder({
    load: () => Promise.resolve(createWindowJournal(deps.journal)),
    now: deps.journal.now,
    onUnavailable: () => {
      deps.journal.log.warn('MHP_REPORT_RECORDING_UNAVAILABLE')
    },
  })
  const dispose = () => recorder.shutdown()
  deps.own(dispose)
  const shouldOfferReport = await recorder.start()
  return {
    offerReport: shouldOfferReport,
    dispose,
    reports: {
      source: {
        readFacts: deps.readFacts,
        readJournal: () => recorder.readJournal(),
        readScrub: deps.readScrub,
        nowMs: deps.journal.now,
        canUseVscodeReporter: () => Promise.resolve(false),
      },
      io: {
        writeClipboard: async (text) => {
          await deps.host.request('ui/clipboard', { text })
        },
        openExternal: async (uri) => {
          await deps.host.request('ui/openExternal', { uri })
          return true
        },
        saveText: deps.saveText,
        openIssueReporter: () => Promise.reject(new Error('MHP_UNSUPPORTED_CAPABILITY')),
      },
      record: (kind, code) => recorder.record(kind, code),
      recordWebviewError: (error) => {
        recorder.recordWebviewError(error)
      },
    },
  }
}
