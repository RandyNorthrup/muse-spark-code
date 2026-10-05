// Report a problem, lane P (M93, PLAN.md D72): the export paths in
// src/host/support/reportProblem.ts. The sealed draft is byte-identical to
// the preview on every path; a broken seal, a refused clipboard, a refused
// save and the over-long URL fallback each answer clearly, and nothing here
// touches the network itself.

import { beforeEach, describe, expect, it, vi } from 'vitest'
import { env, Uri, window, workspace } from 'vscode'
import {
  buildProblemReportDraft,
  sealReportDraft,
  type ProblemReportInput,
  type SealedReportDraft,
} from '../../src/core/support/report'
import { REPORT_ISSUE_NEW_URL, UI_TEXT } from '../../src/shared/constants'
import {
  copyProblemReport,
  openProblemReportIssue,
  saveProblemReport,
} from '../../src/host/support/reportProblem'

const FACTS = {
  extensionVersion: '0.12.1',
  vscodeVersion: '1.99.0',
  nodeVersion: '22.20.4',
  platform: 'linux',
  backend: 'auto',
  sandbox: 'auto',
  cliFound: false,
  cliSignIn: false,
  hasStoredApiKey: false,
  hasEnvironmentApiKey: false,
  settingNames: [],
} as const

const INPUT: ProblemReportInput = {
  description: 'The panel went blank after reload.',
  includeFacts: true,
  includeEvents: false,
  facts: FACTS,
  events: [],
  recordingUnavailable: true,
  nowMs: 1_769_000_000_000,
  scrub: { workspaceRoots: [], homeDir: '', extraLiterals: [] },
}

const SHORT: SealedReportDraft = sealReportDraft('Problem report', 'short body')
const LONG: SealedReportDraft = sealReportDraft('Problem report', 'a'.repeat(3000))

beforeEach(() => {
  vi.mocked(env.clipboard.writeText).mockReset()
  vi.mocked(env.openExternal).mockReset()
  vi.mocked(window.showSaveDialog).mockReset()
  vi.mocked(window.showInformationMessage).mockReset()
  vi.mocked(window.showErrorMessage).mockReset()
  vi.mocked(workspace.fs.writeFile).mockReset()
  vi.mocked(env.clipboard.writeText).mockResolvedValue(undefined)
  vi.mocked(env.openExternal).mockResolvedValue(true)
  vi.mocked(window.showInformationMessage).mockResolvedValue(undefined)
  vi.mocked(window.showErrorMessage).mockResolvedValue(undefined)
  vi.mocked(workspace.fs.writeFile).mockResolvedValue(undefined)
  vi.unstubAllGlobals()
})

function openedUrl(): string {
  const uri = vi.mocked(env.openExternal).mock.calls[0]?.[0]
  expect(uri).toBeDefined()
  return uri?.toString() ?? ''
}

describe('copy to clipboard', () => {
  it('writes the sealed text exactly and says so', async () => {
    const draft = buildProblemReportDraft(INPUT)
    const outcome = await copyProblemReport(draft)
    expect(outcome).toEqual({ ok: true })
    expect(vi.mocked(env.clipboard.writeText).mock.calls).toEqual([[draft.text]])
    expect(vi.mocked(window.showInformationMessage).mock.calls).toEqual([[UI_TEXT.reportCopied]])
    expect(UI_TEXT.reportCopied).toBe('The report was copied to the clipboard.')
  })

  it('reports a refused clipboard without pretending', async () => {
    vi.mocked(env.clipboard.writeText).mockRejectedValue(new Error('denied'))
    const outcome = await copyProblemReport(SHORT)
    expect(outcome).toEqual({ ok: false, reason: 'copyFailed', message: UI_TEXT.reportCopyFailed })
    expect(vi.mocked(window.showErrorMessage).mock.calls).toEqual([[UI_TEXT.reportCopyFailed]])
    expect(vi.mocked(window.showInformationMessage)).not.toHaveBeenCalled()
  })
})

describe('open issue page', () => {
  it('opens the prefilled page for a short draft with no clipboard or notice', async () => {
    const outcome = await openProblemReportIssue(SHORT)
    expect(outcome).toEqual({ ok: true })
    const url = openedUrl()
    expect(url).toContain(`${REPORT_ISSUE_NEW_URL}?title=`)
    expect(url).toContain(`body=${encodeURIComponent('short body')}`)
    expect(decodeURIComponent(url.split('body=')[1] ?? '')).toBe('short body')
    expect(vi.mocked(env.clipboard.writeText)).not.toHaveBeenCalled()
    expect(vi.mocked(window.showInformationMessage)).not.toHaveBeenCalled()
  })

  it('copies the same draft then opens the unfilled form past the cap', async () => {
    const outcome = await openProblemReportIssue(LONG)
    expect(outcome).toEqual({ ok: true })
    expect(vi.mocked(env.clipboard.writeText).mock.calls).toEqual([[LONG.text]])
    expect(openedUrl()).toContain(REPORT_ISSUE_NEW_URL)
    expect(openedUrl()).not.toContain('body=')
    const clipboardOrder = vi.mocked(env.clipboard.writeText).mock.invocationCallOrder[0] ?? 0
    const openOrder = vi.mocked(env.openExternal).mock.invocationCallOrder[0] ?? 0
    expect(clipboardOrder).toBeLessThan(openOrder)
    expect(vi.mocked(window.showInformationMessage).mock.calls).toEqual([[UI_TEXT.reportUrlTooLong]])
  })

  it('still opens the form but reports the failed fallback copy', async () => {
    vi.mocked(env.clipboard.writeText).mockRejectedValue(new Error('denied'))
    const outcome = await openProblemReportIssue(LONG)
    expect(outcome).toEqual({ ok: false, reason: 'copyFailed', message: UI_TEXT.reportCopyFailed })
    expect(openedUrl()).toContain(REPORT_ISSUE_NEW_URL)
    expect(vi.mocked(window.showErrorMessage).mock.calls).toEqual([[UI_TEXT.reportCopyFailed]])
  })
})

describe('save to a file', () => {
  it('writes the sealed bytes to the picked file', async () => {
    const draft = buildProblemReportDraft(INPUT)
    vi.mocked(window.showSaveDialog).mockResolvedValue(Uri.file('C:/reports/problem.md'))
    const outcome = await saveProblemReport(draft)
    expect(outcome).toEqual({ ok: true })
    const written = vi.mocked(workspace.fs.writeFile).mock.calls[0]?.[1]
    expect(written).toBeInstanceOf(Uint8Array)
    expect(new TextDecoder().decode(written)).toBe(draft.text)
    expect(vi.mocked(window.showInformationMessage).mock.calls).toEqual([[UI_TEXT.reportSaved]])
  })

  it('ends quietly when the picker is dismissed', async () => {
    vi.mocked(window.showSaveDialog).mockResolvedValue(undefined)
    const outcome = await saveProblemReport(SHORT)
    expect(outcome).toEqual({ ok: false, reason: 'cancelled', message: undefined })
    expect(vi.mocked(workspace.fs.writeFile)).not.toHaveBeenCalled()
    expect(vi.mocked(window.showInformationMessage)).not.toHaveBeenCalled()
    expect(vi.mocked(window.showErrorMessage)).not.toHaveBeenCalled()
  })

  it('reports a refused write', async () => {
    vi.mocked(window.showSaveDialog).mockResolvedValue(Uri.file('C:/reports/problem.md'))
    vi.mocked(workspace.fs.writeFile).mockRejectedValue(new Error('EACCES'))
    const outcome = await saveProblemReport(SHORT)
    expect(outcome).toEqual({ ok: false, reason: 'saveFailed', message: UI_TEXT.reportSaveFailed })
    expect(vi.mocked(window.showErrorMessage).mock.calls).toEqual([[UI_TEXT.reportSaveFailed]])
  })

  it('reports a picker that throws instead of answering', async () => {
    vi.mocked(window.showSaveDialog).mockRejectedValue(new Error('no dialog'))
    const outcome = await saveProblemReport(SHORT)
    expect(outcome).toEqual({ ok: false, reason: 'saveFailed', message: UI_TEXT.reportSaveFailed })
  })
})

describe('draft identity across exports', () => {
  it('invalidates every path after a post-preview change, silently', async () => {
    const tampered: SealedReportDraft = { ...SHORT, text: `${SHORT.text} (edited)` }
    for (const outcome of [
      await copyProblemReport(tampered),
      await openProblemReportIssue(tampered),
      await saveProblemReport(tampered),
    ]) {
      expect(outcome).toEqual({ ok: false, reason: 'stale', message: undefined })
    }
    expect(vi.mocked(env.clipboard.writeText)).not.toHaveBeenCalled()
    expect(vi.mocked(env.openExternal)).not.toHaveBeenCalled()
    expect(vi.mocked(workspace.fs.writeFile)).not.toHaveBeenCalled()
    expect(vi.mocked(window.showSaveDialog)).not.toHaveBeenCalled()
    expect(vi.mocked(window.showInformationMessage)).not.toHaveBeenCalled()
    expect(vi.mocked(window.showErrorMessage)).not.toHaveBeenCalled()
  })
})

describe('no network', () => {
  it('exports without touching fetch', async () => {
    const fetchSpy = vi.fn(async () => {
      throw new Error('network is forbidden here')
    })
    vi.stubGlobal('fetch', fetchSpy)
    vi.mocked(window.showSaveDialog).mockResolvedValue(Uri.file('C:/reports/problem.md'))
    await copyProblemReport(SHORT)
    await openProblemReportIssue(SHORT)
    await openProblemReportIssue(LONG)
    await saveProblemReport(SHORT)
    expect(fetchSpy).not.toHaveBeenCalled()
    expect(vi.mocked(env.openExternal).mock.calls.length).toBeGreaterThan(0)
  })
})
