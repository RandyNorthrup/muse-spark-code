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
  exclusions: [],
  incompleteChecks: ['private registry names were not queried'],
  findings: [HEADER, LICENSE_PROJECT, DEP_BLOCKED, OUTSIDE],
}

const SCAN_META = { scanId: 'r1', ruleVersion: '1', dataVersion: '2026-10-04', scope: '' }

function deliver(message: HostToWebviewMessage) {
  const event = new MessageEvent('message', { data: message })
  act(() => {
    window.dispatchEvent(event)
  })
}

function renderReady() {
  const postMessage = vi.fn<(message: WebviewToHostMessage) => void>()
  let ids = 0
  const nextId = () => {
    ids += 1
    return `local-${String(ids)}`
  }
  render(<App postMessage={postMessage} newLocalId={nextId} />)
  const boot: readonly HostToWebviewMessage[] = [
    {
      type: 'init',
      emptyStateHint: 'hint',
      composerPlaceholder: 'placeholder',
      settings: testSettings,
    },
    { type: 'authState', status: 'signedIn' },
  ]
  for (const message of boot) deliver(message)
  return postMessage
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

function selectHeader(dialog: HTMLElement) {
  fireEvent.click(within(dialog).getByLabelText('Fix header/1/1'))
  fireEvent.click(within(dialog).getByRole('button', { name: UI_TEXT.legalPreviewFixes }))
}
function showPreview(
  over: Partial<Extract<HostToWebviewMessage, { type: 'legalFixPreview' }>> = {},
) {
  deliver({
    type: 'legalFixPreview',
    previewId: 'p1',
    snapshot: SNAPSHOT,
    eligible: [HEADER.id],
    excluded: [],
    paths: ['src/a.ts'],
    patches: [{ path: 'src/a.ts', diff: '+// verified header' }],
    ...over,
  })
}
function expectSelection(
  postMessage: ReturnType<typeof renderReady>,
  findings: readonly LegalFinding[],
) {
  expect(posted(postMessage, 'requestLegalFix')).toEqual([
    {
      type: 'requestLegalFix',
      requestId: 'local-1',
      scan: SCAN_META,
      findings,
      includeProjectLicense: false,
    },
  ])
}

describe('the legal report (M97 lane W)', () => {
  it('opens on the host report with the disclaimer, evidence and fixability', () => {
    const { postMessage, dialog } = openReport()
    expect(within(dialog).getByText(UI_TEXT.legalScanDisclaimer)).toBeDefined()
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
    expectSelection(postMessage, [HEADER])
  })

  it('fixes all safe ones without the unfixable or the project license', () => {
    const { postMessage, dialog } = openReport()
    fireEvent.click(within(dialog).getByRole('button', { name: UI_TEXT.legalFixAllSafe }))
    const [request] = posted(postMessage, 'requestLegalFix')
    expect(request).toEqual({
      type: 'requestLegalFix',
      requestId: 'local-1',
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
    expectSelection(postMessage, [LICENSE_PROJECT])
  })

  it('shows the host preview with its files and exclusions, and confirms exactly it', () => {
    const { postMessage, dialog } = openReport()
    selectHeader(dialog)
    showPreview({
      excluded: [{ id: 'dep/1/1', reason: 'notFixable' }],
    })
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
    selectHeader(dialog)
    showPreview({
      eligible: [],
      paths: [],
      refusal: 'workspaceUntrusted',
    })
    expect(within(dialog).getByText(UI_TEXT.legalFixRefusedTrust)).toBeDefined()
  })

  it('shows a stale outcome after confirming the preview, with a rescan hint', () => {
    const { dialog } = openReport()
    selectHeader(dialog)
    showPreview({})
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
    selectHeader(dialog)
    showPreview({})
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
      message: {
        type: 'legalFixPreview',
        previewId: 'p1',
        snapshot: SNAPSHOT,
        patches: [{ path: 'src/a.ts', diff: '+// verified header' }],
        eligible: ['header/1/1'],
        excluded: [],
        paths: ['src/a.ts'],
      },
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

describe('RVM97SW report regressions', () => {
  it('F9 renders package coordinates, license and scan assumptions', () => {
    const postMessage = renderReady()
    deliver({
      type: 'legalScanReport',
      requestId: 'r1',
      result: { ...RESULT, scope: 'src', exclusions: ['generated/a.ts'] },
    })
    expect(screen.getByText('leftpad@1.0.0')).toBeDefined()
    expect(screen.getByText('GPL-3.0-only')).toBeDefined()
    expect(screen.getByText('src')).toBeDefined()
    expect(screen.getByText('Distribution: source checkout, undistributed')).toBeDefined()
    expect(screen.getByText('Excluded: generated/a.ts')).toBeDefined()
    expect(posted(postMessage, 'confirmLegalFix')).toEqual([])
  })

  it('F8 closing the report returns keyboard focus to the composer', () => {
    renderReady()
    const composer = screen.getByLabelText('Message Muse')
    composer.focus()
    deliver({ type: 'legalScanReport', requestId: 'r1', result: RESULT })
    fireEvent.click(screen.getByRole('button', { name: UI_TEXT.questionCancel }))
    expect(document.activeElement).toBe(composer)
  })

  it('F7 report and incoming handoff have only one modal owner', () => {
    renderReady()
    deliver({ type: 'sessionInfo', modelId: 'muse-spark-1.3', sessionId: 's1' })
    const composer = screen.getByLabelText('Message Muse')
    fireEvent.change(composer, { target: { value: '/handoff Ship it' } })
    fireEvent.keyDown(composer, { key: 'Enter' })
    deliver({ type: 'handoffCommandResult', requestId: 'handoff:local-1:1', accepted: true })
    deliver({ type: 'legalScanReport', requestId: 'r1', result: RESULT })
    deliver({ type: 'handoffReady', requestId: 'handoff:local-1:1', brief: 'Ship it', todos: [] })
    expect(document.querySelectorAll('[aria-modal="true"]')).toHaveLength(1)
    fireEvent.click(screen.getByRole('button', { name: UI_TEXT.questionCancel }))
    expect(screen.getByLabelText(UI_TEXT.handoffDialogBody)).toBeDefined()
    expect(document.querySelectorAll('[aria-modal="true"]')).toHaveLength(1)
  })

  it('F6 selection changes and pending previews cannot confirm old work', () => {
    const { postMessage, dialog } = openReport()
    selectHeader(dialog)
    showPreview({
      requestId: 'local-1',
      previewId: 'old-p1',
    })
    fireEvent.click(within(dialog).getByLabelText('Fix header/1/1'))
    fireEvent.click(within(dialog).getByLabelText('Fix license/1/1'))
    expect(within(dialog).queryByRole('button', { name: UI_TEXT.legalFixApply })).toBeNull()
    fireEvent.click(within(dialog).getByRole('button', { name: UI_TEXT.legalPreviewFixes }))
    expect(within(dialog).queryByRole('button', { name: UI_TEXT.legalFixApply })).toBeNull()
    showPreview({
      requestId: 'local-1',
      previewId: 'late-old-p1',
    })
    expect(within(dialog).queryByRole('button', { name: UI_TEXT.legalFixApply })).toBeNull()
    expect(posted(postMessage, 'confirmLegalFix')).toEqual([])
  })

  it('F4 apply becomes unavailable immediately after the first confirmation', () => {
    const { postMessage, dialog } = openReport()
    selectHeader(dialog)
    showPreview({
      requestId: 'local-1',
    })
    const button = within(dialog).getByRole('button', { name: UI_TEXT.legalFixApply })
    fireEvent.click(button)
    fireEvent.click(button)
    expect(posted(postMessage, 'confirmLegalFix')).toHaveLength(1)
  })
})
