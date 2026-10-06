// Report a problem (M93, PLAN.md D72): the export paths in
// src/host/support/reportProblem.ts. The sealed draft is byte-identical to
// the preview on every path; a broken seal, a refused clipboard, a refused
// save, a browser that would not open and the over-long URL fallback each
// answer in a fixed word (the dialog states it), no notification is awaited,
// and nothing here touches the network itself.

import { beforeEach, describe, expect, it, vi } from 'vitest'
import { env, Uri, window, workspace } from 'vscode'
import {
  buildProblemReportDraft,
  sealReportDraft,
  type ProblemReportInput,
  type SealedReportDraft,
} from '../../src/core/support/problemReport'
import { REPORT_ISSUE_NEW_URL } from '../../src/shared/constants'
import {
  copyProblemReport,
  openProblemReportIssue,
  saveProblemReport,
} from '../../src/host/support/reportProblem'
import { vscodeReportEditorIo as io } from '../../src/host/support/reportEditorIo'

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

/** No path shows (or waits on) a notification: the dialog's status line says the outcome. */
function expectNoNotification(): void {
  expect(vi.mocked(window.showInformationMessage)).not.toHaveBeenCalled()
  expect(vi.mocked(window.showErrorMessage)).not.toHaveBeenCalled()
}

describe('copy to clipboard', () => {
  it('writes the sealed text exactly', async () => {
    const draft = buildProblemReportDraft(INPUT)
    const outcome = await copyProblemReport(draft, io)
    expect(outcome).toEqual({ ok: true })
    expect(vi.mocked(env.clipboard.writeText).mock.calls).toEqual([[draft.text]])
    expectNoNotification()
  })

  it('reports a refused clipboard without pretending', async () => {
    vi.mocked(env.clipboard.writeText).mockRejectedValue(new Error('denied'))
    const outcome = await copyProblemReport(SHORT, io)
    expect(outcome).toEqual({ ok: false, reason: 'copyFailed' })
    expectNoNotification()
  })
})

describe('open issue page', () => {
  it('opens the prefilled page for a short draft with no clipboard', async () => {
    const outcome = await openProblemReportIssue(SHORT, io)
    expect(outcome).toEqual({ ok: true, isIssueFallback: false })
    const url = openedUrl()
    expect(url).toContain(`${REPORT_ISSUE_NEW_URL}?title=`)
    expect(url).toContain(`body=${encodeURIComponent('short body')}`)
    expect(decodeURIComponent(url.split('body=', 2)[1] ?? '')).toBe('short body')
    expect(vi.mocked(env.clipboard.writeText)).not.toHaveBeenCalled()
    expectNoNotification()
  })

  it('copies the same draft then opens the unfilled form past the cap', async () => {
    const outcome = await openProblemReportIssue(LONG, io)
    expect(outcome).toEqual({ ok: true, isIssueFallback: true })
    expect(vi.mocked(env.clipboard.writeText).mock.calls).toEqual([[LONG.text]])
    expect(openedUrl()).toContain(REPORT_ISSUE_NEW_URL)
    expect(openedUrl()).not.toContain('body=')
    const clipboardOrder = vi.mocked(env.clipboard.writeText).mock.invocationCallOrder[0] ?? 0
    const openOrder = vi.mocked(env.openExternal).mock.invocationCallOrder[0] ?? 0
    expect(clipboardOrder).toBeLessThan(openOrder)
    expectNoNotification()
  })

  it('opens nothing and says so when the fallback copy fails', async () => {
    vi.mocked(env.clipboard.writeText).mockRejectedValue(new Error('denied'))
    const outcome = await openProblemReportIssue(LONG, io)
    expect(outcome).toEqual({ ok: false, reason: 'copyFailed' })
    expect(vi.mocked(env.openExternal)).not.toHaveBeenCalled()
  })

  it('says a browser that refused or threw did not open', async () => {
    vi.mocked(env.openExternal).mockResolvedValueOnce(false)
    expect(await openProblemReportIssue(SHORT, io)).toEqual({ ok: false, reason: 'openFailed' })
    vi.mocked(env.openExternal).mockRejectedValueOnce(new Error('no browser'))
    expect(await openProblemReportIssue(SHORT, io)).toEqual({ ok: false, reason: 'openFailed' })
    vi.mocked(env.openExternal).mockResolvedValueOnce(false)
    expect(await openProblemReportIssue(LONG, io)).toEqual({ ok: false, reason: 'openFailed' })
  })
})

describe('save to a file', () => {
  it('writes the sealed bytes to the picked file', async () => {
    const draft = buildProblemReportDraft(INPUT)
    vi.mocked(window.showSaveDialog).mockResolvedValue(Uri.file('C:/reports/problem.md'))
    const outcome = await saveProblemReport(draft, io)
    expect(outcome).toEqual({ ok: true })
    const written = vi.mocked(workspace.fs.writeFile).mock.calls[0]?.[1]
    expect(written).toBeInstanceOf(Uint8Array)
    expect(new TextDecoder().decode(written)).toBe(draft.text)
    expectNoNotification()
  })

  it('ends quietly when the picker is dismissed', async () => {
    vi.mocked(window.showSaveDialog).mockResolvedValue(undefined)
    const outcome = await saveProblemReport(SHORT, io)
    expect(outcome).toEqual({ ok: false, reason: 'cancelled' })
    expect(vi.mocked(workspace.fs.writeFile)).not.toHaveBeenCalled()
    expectNoNotification()
  })

  it('reports a refused write', async () => {
    vi.mocked(window.showSaveDialog).mockResolvedValue(Uri.file('C:/reports/problem.md'))
    vi.mocked(workspace.fs.writeFile).mockRejectedValue(new Error('EACCES'))
    const outcome = await saveProblemReport(SHORT, io)
    expect(outcome).toEqual({ ok: false, reason: 'saveFailed' })
  })

  it('reports a picker that throws instead of answering', async () => {
    vi.mocked(window.showSaveDialog).mockRejectedValue(new Error('no dialog'))
    const outcome = await saveProblemReport(SHORT, io)
    expect(outcome).toEqual({ ok: false, reason: 'saveFailed' })
  })
})

describe('draft identity across exports', () => {
  it('preserves a Windows CRLF description in Copy, Save and the decoded issue body', async () => {
    const draft = buildProblemReportDraft({
      ...INPUT,
      description: 'The panel failed.\r\nAfter Reload Window.\r\nUnicode: café 雪.',
      includeFacts: false,
    })
    expect(draft.text).toContain('failed.\r\nAfter Reload Window.\r\nUnicode: café 雪.')
    vi.mocked(window.showSaveDialog).mockResolvedValue(Uri.file('C:/reports/problem.md'))
    expect(await copyProblemReport(draft, io)).toEqual({ ok: true })
    expect(await saveProblemReport(draft, io)).toEqual({ ok: true })
    expect(await openProblemReportIssue(draft, io)).toEqual({ ok: true, isIssueFallback: false })
    expect(vi.mocked(env.clipboard.writeText).mock.calls).toEqual([[draft.text]])
    expect(vi.mocked(workspace.fs.writeFile).mock.calls[0]?.[1]).toEqual(
      new TextEncoder().encode(draft.text),
    )
    expect(decodeURIComponent(openedUrl().split('body=', 2)[1] ?? '')).toBe(draft.text)
  })

  it('invalidates every path after a post-preview change, silently', async () => {
    const tampered: SealedReportDraft = { ...SHORT, text: `${SHORT.text} (edited)` }
    for (const outcome of [
      await copyProblemReport(tampered, io),
      await openProblemReportIssue(tampered, io),
      await saveProblemReport(tampered, io),
    ]) {
      expect(outcome).toEqual({ ok: false, reason: 'stale' })
    }
    expect(vi.mocked(env.clipboard.writeText)).not.toHaveBeenCalled()
    expect(vi.mocked(env.openExternal)).not.toHaveBeenCalled()
    expect(vi.mocked(workspace.fs.writeFile)).not.toHaveBeenCalled()
    expect(vi.mocked(window.showSaveDialog)).not.toHaveBeenCalled()
    expectNoNotification()
  })
})

describe('no network', () => {
  it('exports without touching fetch', async () => {
    const fetchSpy = vi.fn(() => Promise.reject(new Error('network is forbidden here')))
    vi.stubGlobal('fetch', fetchSpy)
    vi.mocked(window.showSaveDialog).mockResolvedValue(Uri.file('C:/reports/problem.md'))
    await copyProblemReport(SHORT, io)
    await openProblemReportIssue(SHORT, io)
    await openProblemReportIssue(LONG, io)
    await saveProblemReport(SHORT, io)
    expect(fetchSpy).not.toHaveBeenCalled()
    expect(vi.mocked(env.openExternal).mock.calls.length).toBeGreaterThan(0)
  })
})
