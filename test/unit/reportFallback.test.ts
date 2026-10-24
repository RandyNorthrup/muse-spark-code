// The editor-native fallback (lane REPORTFLOW R2): the sealed draft behind
// the editor's own quick pick when the dialog cannot open. Copy, Save and
// the issue page run the same export paths as the dialog; a dismissed pick
// ends quietly; every outcome is said in the dialog's fixed words. The
// fallback never fails for lack of a fact.

import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { beforeEach, describe, expect, it } from 'vitest'
import {
  runFallbackAction,
  runReportFallback,
  type ReportFallbackDeps,
  type ReportFallbackWindow,
} from '../../src/host/support/reportFallback'
import type { ReportDataSource } from '../../src/host/conversation/reportProblemHandler'
import type { ReportEditorIo } from '../../src/host/support/reportProblem'
import type { SealedReportDraft } from '../../src/core/support/problemReport'
import { buildProblemReportDraft } from '../../src/core/support/problemReport'
import { REPORT_ISSUE_NEW_URL, UI_TEXT } from '../../src/shared/constants'
import { EN } from '../../src/shared/l10n/en'
import { setUiText } from '../../src/shared/l10n/text'
import { captureLog } from './helpers/captureLog'
import { REPORT_FACTS as FACTS, validReportSource } from './helpers/reportFixtures'

const MISSING = path.join('temp', 'report-fallback-never-written.txt')
const NOW_MS = 1_769_000_000_000
const SCRUB = { workspaceRoots: [], homeDir: '', extraLiterals: [] } as const

function sourceWith(overrides: Partial<ReportDataSource> = {}): ReportDataSource {
  return validReportSource({ nowMs: () => NOW_MS, ...overrides })
}

function ioWith(overrides: Partial<ReportEditorIo> = {}): ReportEditorIo & {
  copied: string[]
  opened: string[]
  saved: string[]
} {
  const copied: string[] = []
  const opened: string[] = []
  const saved: string[] = []
  return {
    copied,
    opened,
    saved,
    writeClipboard: (text: string) => {
      copied.push(text)
      return Promise.resolve()
    },
    openExternal: (url: string) => {
      opened.push(url)
      return Promise.resolve(true)
    },
    saveText: (text: string) => {
      saved.push(text)
      return Promise.resolve(true)
    },
    openIssueReporter: () => Promise.resolve(),
    ...overrides,
  }
}

function windowWith(pick?: number): ReportFallbackWindow & {
  labels: string[][]
  titles: string[]
  infos: string[]
  errors: string[]
} {
  const labels: string[][] = []
  const titles: string[] = []
  const infos: string[] = []
  const errors: string[] = []
  return {
    labels,
    titles,
    infos,
    errors,
    showQuickPick: (offered, title) => {
      labels.push([...offered])
      titles.push(title)
      return Promise.resolve(pick)
    },
    showInformationMessage: (text) => {
      infos.push(text)
      return Promise.resolve()
    },
    showErrorMessage: (text) => {
      errors.push(text)
      return Promise.resolve()
    },
  }
}

function depsWith(
  source: ReportDataSource,
  io: ReportEditorIo,
  window: ReportFallbackWindow,
): { deps: ReportFallbackDeps } {
  return { deps: { source, io, window, log: captureLog().logger } }
}

function draftWithFacts(): SealedReportDraft {
  return buildProblemReportDraft({
    description: '',
    includeFacts: true,
    includeEvents: true,
    facts: FACTS,
    events: [],
    recordingUnavailable: false,
    nowMs: NOW_MS,
    scrub: SCRUB,
  })
}

beforeEach(() => {
  setUiText(EN, 'en')
})

describe('reportFallback', () => {
  it('offers copy, save and the issue page, and ends quietly when dismissed', async () => {
    const io = ioWith()
    const win = windowWith(undefined)
    const { deps } = depsWith(sourceWith(), io, win)
    await runReportFallback(deps, undefined, undefined)
    expect(win.labels).toHaveLength(1)
    expect(win.labels[0]).toEqual([
      UI_TEXT.reportCopyAction,
      UI_TEXT.reportSaveAction,
      UI_TEXT.reportOpenIssueAction,
    ])
    expect(win.titles).toEqual([UI_TEXT.reportFallbackTitle])
    expect(io.copied).toEqual([])
    expect(io.saved).toEqual([])
    expect(io.opened).toEqual([])
  })

  it('copies the sealed draft behind the copy pick', async () => {
    const io = ioWith()
    const win = windowWith()
    const { deps } = depsWith(sourceWith(), io, win)
    await runFallbackAction(deps, draftWithFacts(), 'copy')
    expect(io.copied).toHaveLength(1)
    expect(win.infos).toEqual([UI_TEXT.reportCopied])
  })

  it('saves the sealed draft behind the save pick, quietly on cancel', async () => {
    const io = ioWith()
    const win = windowWith()
    const { deps } = depsWith(sourceWith(), io, win)
    await runFallbackAction(deps, draftWithFacts(), 'save')
    expect(io.saved).toHaveLength(1)
    expect(win.infos).toEqual([UI_TEXT.reportSaved])
    const cancelling = ioWith({ saveText: () => Promise.resolve(false) })
    const cancelledWin = windowWith()
    const cancelled = depsWith(sourceWith(), cancelling, cancelledWin)
    await runFallbackAction(cancelled.deps, draftWithFacts(), 'save')
    expect(cancelling.saved).toEqual([])
    expect(cancelledWin.infos).toEqual([])
    expect(cancelledWin.errors).toEqual([])
  })

  it('opens the prefilled issue page behind the issue pick', async () => {
    const io = ioWith()
    const win = windowWith()
    const { deps } = depsWith(sourceWith(), io, win)
    await runFallbackAction(deps, draftWithFacts(), 'issue')
    expect(io.opened).toHaveLength(1)
    expect(io.opened[0]).toContain('issues/new?title=')
    expect(win.infos).toEqual([UI_TEXT.reportIssueOpened])
  })

  it('says a copy failure in fallback words, without a preview to copy from', async () => {
    const io = ioWith({
      // A real refusal: the system's own ENOENT.
      writeClipboard: async () => {
        await readFile(MISSING, 'utf8')
      },
    })
    const win = windowWith()
    const { deps } = depsWith(sourceWith(), io, win)
    await runFallbackAction(deps, draftWithFacts(), 'copy')
    expect(win.errors).toEqual([UI_TEXT.reportFallbackCopyFailed])
  })

  it('opens the blank issue page when no draft could be built', async () => {
    const io = ioWith()
    const win = windowWith()
    const { deps } = depsWith(sourceWith(), io, win)
    await runFallbackAction(deps, undefined, 'issue')
    expect(io.opened).toEqual([REPORT_ISSUE_NEW_URL])
  })

  it('never fails for lack of a fact: unknown facts still offer every action', async () => {
    const io = ioWith()
    const win = windowWith(1)
    const { deps } = depsWith(
      sourceWith({
        readFacts: async () => {
          await readFile(MISSING, 'utf8')
          return FACTS
        },
      }),
      io,
      win,
    )
    await runReportFallback(deps, undefined, undefined)
    expect(io.saved).toHaveLength(1)
  })
})
