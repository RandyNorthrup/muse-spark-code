// The flight recorder's bundle (M93, PLAN.md D6, D72): esbuild builds this
// file into dist/recorder.js, which the window's ReportRecorder loads just
// after activation (or at the first failure, whichever comes first), so the
// journal, its policy and the frame mapping stay out of the bundle VS Code
// loads at activation. It needs no localized text.

import { reportEventsOf } from '../../core/support/journalEvents'
import { reportCodeOf } from '../../shared/stackFrames'
import type { ReportJournalSource } from '../conversation/reportProblemHandler'
import type { Logger } from '../logger'
import { hostFramesOf } from './hostFrames'
import { ReportJournal, type ReportJournalFs } from './reportJournal'
import type { PendingRecord, WindowJournal } from './reportRecorder'

export interface WindowJournalOptions {
  /** `ExtensionContext.globalStorageUri.fsPath`. */
  readonly globalStorageDir: string
  /** This window's instance: one journal and one marker. */
  readonly instance: string
  readonly ext: string
  readonly host: string
  readonly pid: number
  readonly log: Logger
  readonly isAlive: (pid: number) => boolean
  /** The installed extension's folder: frames are kept only inside it. */
  readonly extensionRoot: string
  readonly now: () => number
  readonly fs?: ReportJournalFs
}

/** The window's journal behind the facts-only records the activation bundle queues. */
export function createWindowJournal(options: WindowJournalOptions): WindowJournal {
  const journal = new ReportJournal({ ...options })
  return {
    startup: async () => {
      const { offerReport } = await journal.startup()
      return offerReport
    },
    shutdown: () => journal.shutdown(),
    record: (input: PendingRecord) =>
      journal.record(
        'error' in input
          ? {
              kind: input.kind,
              code: reportCodeOf(input.error),
              frames: hostFramesOf(input.error, options.extensionRoot),
              ...(input.backend !== undefined && { backend: input.backend }),
            }
          : input,
      ),
    readJournal: async (): Promise<ReportJournalSource> => {
      const merged = await journal.readMerged()
      return {
        entries: reportEventsOf(merged.entries, options.now()),
        recordingUnavailable: !journal.isAvailable,
      }
    },
  }
}
