// @vitest-environment jsdom
// M97 lane W (PLAN.md D76): the legal scan's report. The host's report
// opens the dialog with its evidence, disclaimer and fixability; labelled
// checkboxes select exactly the findings to fix; "Fix all safe ones"
// previews the exact eligible findings before confirmation; Plan refuses
// upfront and the host's refusals are shown in words.

import { act, fireEvent, render, screen, within } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { UI_TEXT } from '../../src/shared/constants'
import type { LegalFinding, LegalScanResult } from '../../src/shared/legal'
import type { LegalFixSnapshot } from '../../src/shared/legalFix'
import type { HostToWebviewMessage, WebviewToHostMessage } from '../../src/shared/protocol'
import { App } from '../../src/webview/App'
import { initialUiState, uiReducer } from '../../src/webview/state/uiState'
import { testSettings } from './helpers/fakes'

const HEADER: LegalFinding = {
  id: 'header/1/1',
  severity: 'advice',
  category: 'codeQualityHeader',
  file: 'src/a.ts',
  line: 1,
  evidenceSource: 'header reader',
  confidence: 1,
  explanation: 'The file has no copyright header.',
  recommendation: 'Add the project copyright header.',
  fixable: true,
  evidenceExcerpt: '// no header here',
}

const LICENSE_PROJECT: LegalFinding = {
  id: 'license/1/1',
  severity: 'should-fix',
  category: 'license',
  evidenceSource: 'project manifest',
  confidence: 0.9,
  explanation: 'The project declares no license.',
  recommendation: 'Choose a license and confirm it separately.',
  fixable: true,
}

const DEP_BLOCKED: LegalFinding = {
  id: 'dep/1/1',
  severity: 'blocker',
  category: 'dependencyLicense',
  packageName: 'leftpad',
  packageVersion: '1.0.0',
  licenseExpression: 'GPL-3.0-only',
  evidenceSource: 'npm lock',
  confidence: 0.9,
  explanation: 'A dependency may oblige source distribution.',
  recommendation: 'Review the obligation with its evidence.',
  fixable: false,
}

const OUTSIDE: LegalFinding = {
  id: 'dep/1/9',
  severity: 'advice',
  category: 'dependencyLicense',
  file: '../etc/passwd',
  line: 1,
  evidenceSource: 'npm lock',
  confidence: 0.2,
  explanation: 'A lead outside the workspace.',
  recommendation: 'Treat it as a lead only.',
  fixable: true,
}

const RESULT: LegalScanResult = {
  version: 1,
  ruleVersion: '1',
  dataVersion: '2026-10-04',
  scope: '',
  distribution: 'source checkout, undistributed',
  exclusions: ['dist/generated.js'],
  incompleteChecks: ['private registry names were not queried'],
  findings: [HEADER, LICENSE_PROJECT, DEP_BLOCKED, OUTSIDE],
}

const SCAN_META = { ruleVersion: '1', dataVersion: '2026-10-04', scope: '' }
const HEADER_REQUEST = {
  type: 'requestLegalFix',
  scan: SCAN_META,
  findings: [HEADER],
  includeProjectLicense: false,
}

function renderReady() {
  const postMessage = vi.fn<(message: WebviewToHostMessage) => void>()
  let ids = 0
  const newLocalId = () => {
    ids += 1
    return `local-${String(ids)}`
  }
  render(<App postMessage={postMessage} newLocalId={newLocalId} />)
  const messages: HostToWebviewMessage[] = [
    {
      type: 'init',
      emptyStateHint: 'hint',
      composerPlaceholder: 'placeholder',
      settings: testSettings,
    },
    { type: 'authState', status: 'signedIn' },
  ]
  for (const message of messages) deliver(message)
  return postMessage
}

function deliver(data: HostToWebviewMessage) {
  act(() => {
    window.dispatchEvent(new MessageEvent('message', { data }))
  })
}

function openReport() {
  const postMessage = renderReady()
  deliver({ type: 'legalScanReport', requestId: 'r1', result: RESULT })
  return { postMessage, dialog: screen.getByRole('dialog', { name: UI_TEXT.legalScanTitle }) }
}

const posted = (postMessage: ReturnType<typeof renderReady>, type: WebviewToHostMessage['type']) =>
  postMessage.mock.calls.map(([message]) => message).filter((message) => message.type === type)

const SNAPSHOT: LegalFixSnapshot = {
  version: 1,
  ruleVersion: '1',
  dataVersion: '2026-10-04',
  scope: '',
  evidence: [{ id: 'header/1/1', digest: '12345678' }],
  fileHashes: [{ path: 'src/a.ts', hash: 'a'.repeat(64) }],
  workspacePath: '/ws',
  permissionMode: 'manual',
}

const HEADER_PREVIEW: Extract<HostToWebviewMessage, { type: 'legalFixPreview' }> = {
  type: 'legalFixPreview',
  previewId: 'p1',
  snapshot: SNAPSHOT,
  eligible: ['header/1/1'],
  excluded: [],
  paths: ['src/a.ts'],
}

function requestHeaderPreview(dialog: HTMLElement) {
  fireEvent.click(within(dialog).getByLabelText('Fix header/1/1'))
  fireEvent.click(within(dialog).getByRole('button', { name: UI_TEXT.legalPreviewFixes }))
}

describe('the legal report (M97 lane W)', () => {
  it('opens on the host report with the disclaimer, evidence and fixability', () => {
    const { postMessage, dialog } = openReport()
    expect(within(dialog).getByText(UI_TEXT.legalScanDisclaimer)).toBeDefined()
    expect(within(dialog).getByText('Distribution: source checkout, undistributed')).toBeDefined()
    expect(within(dialog).getByText('Excluded: dist/generated.js')).toBeDefined()
    expect(within(dialog).getAllByText('Confidence: 90%')).toHaveLength(2)
    expect(within(dialog).getByText('4 findings')).toBeDefined()
    expect(within(dialog).getByText(UI_TEXT.legalSeverities.blocker)).toBeDefined()
    expect(within(dialog).getByText('The file has no copyright header.')).toBeDefined()
    expect(within(dialog).getByText('Evidence: header reader')).toBeDefined()
    expect(within(dialog).getByText(UI_TEXT.legalNotFixable)).toBeDefined()
    expect(
      within(dialog).getByText('Incomplete: private registry names were not queried'),
    ).toBeDefined()
    // A location that climbs out of the workspace is text, never a link.
    expect(within(dialog).queryByRole('button', { name: /passwd/ })).toBeNull()
    expect(within(dialog).getByText('../etc/passwd:1')).toBeDefined()
    // A workspace location opens its file at its line.
    fireEvent.click(within(dialog).getByRole('button', { name: 'src/a.ts:1' }))
    expect(posted(postMessage, 'openFile')).toEqual([
      { type: 'openFile', path: 'src/a.ts', startLine: 1, endLine: 1 },
    ])
  })

  it('leaves what the scanner marked unfixable unselectable', () => {
    const { dialog } = openReport()
    const blocked = within(dialog).getByLabelText<HTMLInputElement>('Fix dep/1/1')
    expect(blocked.disabled).toBe(true)
    expect(within(dialog).getByLabelText<HTMLInputElement>('Fix header/1/1').disabled).toBe(false)
  })

  it('asks for a selection before previewing, even with nothing pre-authorized', () => {
    const { postMessage, dialog } = openReport()
    fireEvent.click(within(dialog).getByRole('button', { name: UI_TEXT.legalPreviewFixes }))
    expect(posted(postMessage, 'requestLegalFix')).toEqual([])
    expect(within(dialog).getByText(UI_TEXT.legalFixNothingSelected)).toBeDefined()
  })

  it('previews exactly the checked findings with the scan versions', () => {
    const { postMessage, dialog } = openReport()
    fireEvent.click(within(dialog).getByLabelText('Fix header/1/1'))
    expect(within(dialog).getByText('1 selected')).toBeDefined()
    fireEvent.click(within(dialog).getByRole('button', { name: UI_TEXT.legalPreviewFixes }))
    expect(posted(postMessage, 'requestLegalFix')).toEqual([HEADER_REQUEST])
  })

  it('fixes all safe ones without the unfixable or the project license', () => {
    const { postMessage, dialog } = openReport()
    fireEvent.click(within(dialog).getByRole('button', { name: UI_TEXT.legalFixAllSafe }))
    const [request] = posted(postMessage, 'requestLegalFix')
    expect(request).toEqual({
      type: 'requestLegalFix',
      scan: SCAN_META,
      // The outside-workspace lead is fixable, so it is selected too; the
      // host keeps it out of the batch with its reason.
      findings: [HEADER, OUTSIDE],
      includeProjectLicense: false,
    })
  })

  it('asks the project license separately, and only then includes it', () => {
    const { postMessage, dialog } = openReport()
    fireEvent.click(within(dialog).getByLabelText('Fix license/1/1'))
    expect(within(dialog).getByLabelText(UI_TEXT.legalFixSeparateConfirm)).toBeDefined()
    fireEvent.click(within(dialog).getByRole('button', { name: UI_TEXT.legalPreviewFixes }))
    expect(posted(postMessage, 'requestLegalFix')).toEqual([
      { ...HEADER_REQUEST, findings: [LICENSE_PROJECT] },
    ])
  })

  it('shows the host preview with its files and exclusions, and confirms exactly it', () => {
    const { postMessage, dialog } = openReport()
    requestHeaderPreview(dialog)
    deliver({ ...HEADER_PREVIEW, excluded: [{ id: 'dep/1/1', reason: 'notFixable' }] })
    expect(within(dialog).getByText(UI_TEXT.legalFixPreviewTitle)).toBeDefined()
    expect(within(dialog).getByText('src/a.ts')).toBeDefined()
    expect(within(dialog).getByText(`dep/1/1: ${UI_TEXT.legalFixReasonNotFixable}`)).toBeDefined()
    fireEvent.click(within(dialog).getByRole('button', { name: UI_TEXT.legalFixApply }))
    expect(posted(postMessage, 'confirmLegalFix')).toEqual([
      { type: 'confirmLegalFix', previewId: 'p1' },
    ])
  })

  it('shows a refused preview in words', () => {
    const { dialog } = openReport()
    requestHeaderPreview(dialog)
    deliver({
      type: 'legalFixPreview',
      previewId: 'p1',
      eligible: [],
      excluded: [],
      paths: [],
      refusal: 'workspaceUntrusted',
    })
    expect(within(dialog).getByText(UI_TEXT.legalFixRefusedTrust)).toBeDefined()
  })

  it('shows a stale outcome after confirming the preview, with a rescan hint', () => {
    const { dialog } = openReport()
    requestHeaderPreview(dialog)
    deliver(HEADER_PREVIEW)
    fireEvent.click(within(dialog).getByRole('button', { name: UI_TEXT.legalFixApply }))
    // The file changed between the preview and the confirm: refuse, rescan.
    deliver({
      type: 'legalFixResult',
      previewId: 'p1',
      outcome: 'refused',
      applied: [],
      failed: [],
      refusal: 'staleEvidence',
    })
    expect(within(dialog).getByText(UI_TEXT.legalFixRefusedStale)).toBeDefined()
    expect(within(dialog).getByText(UI_TEXT.legalFixRescanHint)).toBeDefined()
  })

  it('says an empty scan found nothing and offers another scan', () => {
    const postMessage = renderReady()
    deliver({
      type: 'legalScanReport',
      requestId: 'r1',
      result: { ...RESULT, findings: [], incompleteChecks: [] },
    })
    const dialog = screen.getByRole('dialog', { name: UI_TEXT.legalScanTitle })
    expect(within(dialog).getByText(UI_TEXT.legalScanEmpty)).toBeDefined()
    expect(within(dialog).queryByRole('button', { name: UI_TEXT.legalFixAllSafe })).toBeNull()
    fireEvent.click(within(dialog).getByRole('button', { name: UI_TEXT.legalScanAgain }))
    expect(posted(postMessage, 'requestLegalScan')).toEqual([{ type: 'requestLegalScan' }])
  })

  it('refuses fixes upfront in Plan mode, and closes on ×', () => {
    const postMessage = renderReady()
    deliver({
      type: 'composerState',
      effort: 'xhigh',
      isThinkingEnabled: false,
      permissionMode: 'plan',
    })
    deliver({ type: 'legalScanReport', requestId: 'r1', result: RESULT })
    const dialog = screen.getByRole('dialog', { name: UI_TEXT.legalScanTitle })
    expect(within(dialog).getByText(UI_TEXT.legalFixRefusedPlan)).toBeDefined()
    expect(within(dialog).getByLabelText<HTMLInputElement>('Fix header/1/1').disabled).toBe(true)
    expect(within(dialog).queryByRole('button', { name: UI_TEXT.legalFixAllSafe })).toBeNull()
    expect(posted(postMessage, 'requestLegalFix')).toEqual([])
    fireEvent.click(within(dialog).getByRole('button', { name: UI_TEXT.usageClose }))
    expect(screen.queryByRole('dialog', { name: UI_TEXT.legalScanTitle })).toBeNull()
  })

  it('drops a stale preview when a new scan answers', () => {
    const { dialog } = openReport()
    requestHeaderPreview(dialog)
    deliver(HEADER_PREVIEW)
    expect(within(dialog).getByText(UI_TEXT.legalFixPreviewTitle)).toBeDefined()
    deliver({ type: 'legalScanReport', requestId: 'r2', result: RESULT })
    const again = screen.getByRole('dialog', { name: UI_TEXT.legalScanTitle })
    expect(within(again).queryByText(UI_TEXT.legalFixPreviewTitle)).toBeNull()
  })
})

describe('the legal report state', () => {
  const at = 0
  const report: Extract<HostToWebviewMessage, { type: 'legalScanReport' }> = {
    type: 'legalScanReport',
    requestId: 'r1',
    result: RESULT,
  }

  it('announces the report and clears its preview and outcome', () => {
    const opened = uiReducer(initialUiState, { type: 'hostMessage', at, message: report })
    expect(opened.legalReport?.requestId).toBe('r1')
    expect(opened.announcement?.text).toBe(`${UI_TEXT.legalScanTitle}: 4 findings`)
    const previewed = uiReducer(opened, {
      type: 'hostMessage',
      at,
      message: HEADER_PREVIEW,
    })
    expect(previewed.legalFixPreview?.previewId).toBe('p1')
    const rescanned = uiReducer(previewed, {
      type: 'hostMessage',
      at,
      message: { ...report, requestId: 'r2' },
    })
    expect(rescanned.legalReport?.requestId).toBe('r2')
    expect(rescanned.legalFixPreview).toBeUndefined()
    expect(rescanned.legalFixResult).toBeUndefined()
  })

  it('closes the report and clears it with the conversation', () => {
    const opened = uiReducer(initialUiState, { type: 'hostMessage', at, message: report })
    const closed = uiReducer(opened, { type: 'legalReportClosed' })
    expect(closed.legalReport).toBeUndefined()
    const cleared = uiReducer(opened, { type: 'conversationCleared' })
    expect(cleared.legalReport).toBeUndefined()
    expect(cleared.legalFixPreview).toBeUndefined()
  })
})
