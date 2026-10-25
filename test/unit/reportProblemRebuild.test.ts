// A refused preview rebuild (lane REPORTFLOW R2, RVM109T 5): the vault
// scrub fails while an update builds, through the real handler and the real
// builder. The dialog re-posts the previous draft with the failed revision
// and the failure in its status line; the next edit retries the build.
import { describe, expect, it } from 'vitest'
import {
  createReportProblemHandler,
  type ReportProblemHandlerDeps,
} from '../../src/host/conversation/reportProblemHandler'
import { UI_TEXT } from '../../src/shared/constants'
import type { HostToWebviewMessage } from '../../src/shared/protocol'
import { captureLog } from './helpers/captureLog'
import { validReportSource, workingReportIo } from './helpers/reportFixtures'

function openDialog(failScrubCalls: ReadonlySet<number>): {
  deps: ReportProblemHandlerDeps
  posted: HostToWebviewMessage[]
  notices: string[]
  logLines: string[]
  handle: ReturnType<typeof createReportProblemHandler>['handle']
} {
  const posted: HostToWebviewMessage[] = []
  const notices: string[] = []
  const { logger, lines: logLines } = captureLog()
  const source = validReportSource()
  const io = workingReportIo()
  // Each build scrubs twice, title then text. The open takes calls 1-2; the
  // failing update takes 3-4; the retry takes 5-6.
  let scrubs = 0
  const deps: ReportProblemHandlerDeps = {
    post: (message) => {
      posted.push(message)
    },
    noticeError: (text) => {
      notices.push(text)
    },
    log: logger,
    source,
    io,
    onReportWebviewError: () => undefined,
    vaultScrub: {
      scrub: (text) => {
        scrubs += 1
        return failScrubCalls.has(scrubs)
          ? Promise.reject(new Error('vault unavailable'))
          : Promise.resolve(text)
      },
    },
  }
  const { handle } = createReportProblemHandler(deps)
  return { deps, posted, notices, logLines, handle }
}

type DraftMessage = Extract<HostToWebviewMessage, { type: 'reportDraft' }>

function draftsOf(posted: HostToWebviewMessage[]): DraftMessage[] {
  return posted.filter((message): message is DraftMessage => message.type === 'reportDraft')
}

describe('reportProblemRebuild', () => {
  it('settles a refused rebuild on the previous draft, marked, so the dialog can retry', async () => {
    const { posted, notices, logLines, handle } = openDialog(new Set([3]))
    await handle({ type: 'openReport' })
    const opened = draftsOf(posted)
    expect(opened).toHaveLength(1)
    await handle({
      type: 'updateReport',
      revision: 1,
      description: 'The panel went blank.',
      includeFacts: true,
      includeEvents: true,
      removedEventIndexes: [],
    })
    // One notice, and the previous draft re-posted with the failed
    // revision and the mark: the dialog's own status line says the preview
    // could not be updated instead of waiting with disabled exports.
    expect(notices).toEqual([UI_TEXT.actionFailed])
    expect(logLines.some((line) => line.includes('problem report rebuild failed'))).toBe(true)
    const settled = draftsOf(posted)
    expect(settled).toHaveLength(2)
    expect([settled[1]?.session, settled[1]?.revision]).toEqual([1, 1])
    expect(settled[1]?.hash).toBe(opened[0]?.hash)
    expect(settled[1]?.text).toBe(opened[0]?.text)
    expect(settled[1]?.rebuildFailed).toBe(true)
    // The next edit retries the build and answers it unmarked.
    await handle({
      type: 'updateReport',
      revision: 2,
      description: 'The panel went blank.',
      includeFacts: true,
      includeEvents: true,
      removedEventIndexes: [],
    })
    const retried = draftsOf(posted)
    expect(retried).toHaveLength(3)
    expect([retried[2]?.session, retried[2]?.revision]).toEqual([1, 2])
    expect(retried[2]?.rebuildFailed).not.toBe(true)
    expect(retried[2]?.text).toContain('The panel went blank.')
  })
})
