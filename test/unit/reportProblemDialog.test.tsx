// @vitest-environment jsdom
// Report a problem, lane W (M93, PLAN.md D72): the preview dialog in
// src/webview/components/ReportDialog.tsx. The dialog lists every item the
// report contains with a Remove each, shows lane P's final draft exactly,
// posts choices (never content) and states every export answer plainly.

import { fireEvent, render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { UI_TEXT } from '../../src/shared/constants'
import { EN } from '../../src/shared/l10n/en'
import { setUiText } from '../../src/shared/l10n/text'
import type { ReportDraftItem } from '../../src/shared/protocol'
import {
  reportDialogStatusText,
  ReportDialog,
  type ReportDialogProps,
} from '../../src/webview/components/ReportDialog'
import type { ReportExportStatus } from '../../src/webview/state/uiState'

const ITEMS: readonly ReportDraftItem[] = [
  { kind: 'facts', label: 'Support facts' },
  { kind: 'event', eventIndex: 0, label: 'toolCallFailed · 45s ago' },
  { kind: 'event', eventIndex: 1, label: 'backendExit · 2m ago' },
]

const DRAFT_TEXT = [
  'Muse Spark problem report',
  '',
  'Support facts:',
  'extension: 0.12.1',
  '',
  'Recent events (2):',
  '- 45s ago toolCallFailed exit1',
  '- 2m ago backendExit unknown',
].join('\n')

function propsWith(overrides: Partial<ReportDialogProps> = {}): ReportDialogProps {
  return {
    description: '',
    includeFacts: true,
    includeEvents: true,
    items: ITEMS,
    draftText: DRAFT_TEXT,
    canUseVscodeReporter: true,
    recordingUnavailable: false,
    statusText: undefined,
    isUpdating: false,
    onDescriptionChange: vi.fn(),
    onToggleFacts: vi.fn(),
    onToggleEvents: vi.fn(),
    onRemoveItem: vi.fn(),
    onExport: vi.fn(),
    onClose: vi.fn(),
    ...overrides,
  }
}

beforeEach(() => {
  setUiText(EN, 'en')
})

describe('ReportDialog', () => {
  it('lists every item with a Remove each and shows the draft exactly', () => {
    const props = propsWith()
    render(<ReportDialog {...props} />)
    expect(screen.getByRole('dialog', { name: 'Report a problem' })).toBeInTheDocument()
    const list = screen.getByRole('list', { name: 'What this report contains' })
    expect(list.querySelectorAll(':scope > li')).toHaveLength(3)
    for (const item of ITEMS) {
      expect(screen.getByRole('button', { name: `Remove ${item.label}` })).toBeInTheDocument()
    }
    // The preview is the final draft byte-identical, hand-copyable.
    const preview = screen.getByRole('textbox', { name: 'Preview' })
    expect(preview).toHaveValue(DRAFT_TEXT)
    expect(preview).toHaveAttribute('readonly')
    expect(
      screen.getByRole('textbox', { name: 'What were you doing when it happened?' }),
    ).toHaveValue('')
  })

  it('removes the facts section and single events', () => {
    const props = propsWith()
    render(<ReportDialog {...props} />)
    fireEvent.click(screen.getByRole('button', { name: 'Remove Support facts' }))
    expect(props.onRemoveItem).toHaveBeenCalledWith(ITEMS[0])
    fireEvent.click(screen.getByRole('button', { name: 'Remove backendExit · 2m ago' }))
    expect(props.onRemoveItem).toHaveBeenCalledWith(ITEMS[2])
  })

  it('posts description edits and section switches', () => {
    const props = propsWith()
    render(<ReportDialog {...props} />)
    fireEvent.change(
      screen.getByRole('textbox', { name: 'What were you doing when it happened?' }),
      {
        target: { value: 'The panel went blank.' },
      },
    )
    expect(props.onDescriptionChange).toHaveBeenCalledWith('The panel went blank.')
    fireEvent.click(screen.getByRole('checkbox', { name: 'Include support facts' }))
    expect(props.onToggleFacts).toHaveBeenCalledWith(false)
    fireEvent.click(screen.getByRole('checkbox', { name: 'Include recent events' }))
    expect(props.onToggleEvents).toHaveBeenCalledWith(false)
  })

  it('exports through every offered channel with the seal of the draft on screen', () => {
    const props = propsWith()
    render(<ReportDialog {...props} />)
    for (const [name, via] of [
      ['Copy report', 'copy'],
      ['Open issue page', 'issue'],
      ['Save to a file', 'save'],
      ['Use the VS Code issue reporter', 'vscodeReporter'],
    ] as const) {
      fireEvent.click(screen.getByRole('button', { name }))
      expect(props.onExport).toHaveBeenCalledWith(via)
    }
  })

  it('hides the VS Code reporter action while its command is missing', () => {
    render(<ReportDialog {...propsWith({ canUseVscodeReporter: false })} />)
    expect(
      screen.queryByRole('button', { name: 'Use the VS Code issue reporter' }),
    ).not.toBeInTheDocument()
    expect(screen.queryByText(UI_TEXT.reportVscodeReporterNote)).not.toBeInTheDocument()
  })

  it('disables exports while a rebuilt preview is on its way', () => {
    render(
      <ReportDialog {...propsWith({ isUpdating: true, statusText: UI_TEXT.reportUpdating })} />,
    )
    for (const name of ['Copy report', 'Open issue page', 'Save to a file']) {
      expect(screen.getByRole('button', { name })).toBeDisabled()
    }
    expect(screen.getByRole('status')).toHaveTextContent('Updating the preview…')
  })

  it('says the recording gap instead of listing events that do not exist', () => {
    render(<ReportDialog {...propsWith({ items: [], recordingUnavailable: true })} />)
    expect(
      screen.getByText('Event recording was unavailable, so this report has no recent events.'),
    ).toBeInTheDocument()
  })

  it('cancels without exporting', () => {
    const props = propsWith()
    render(<ReportDialog {...props} />)
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))
    expect(props.onClose).toHaveBeenCalledTimes(1)
    expect(props.onExport).not.toHaveBeenCalled()
  })
})

describe('reportDialogStatusText', () => {
  const cases: readonly { status: ReportExportStatus | undefined; text: string | undefined }[] = [
    { status: undefined, text: undefined },
    { status: { via: 'copy', ok: true }, text: 'The report was copied to the clipboard.' },
    { status: { via: 'save', ok: true }, text: 'The report was saved.' },
    { status: { via: 'issue', ok: true }, text: 'The issue page was opened in the browser.' },
    {
      status: { via: 'issue', ok: true, issueFallback: true },
      text: 'The report is too long to open in a browser address. Copy it instead, then paste it into the new-issue form.',
    },
    { status: { via: 'vscodeReporter', ok: true }, text: 'The VS Code issue reporter was opened.' },
    {
      status: { via: 'copy', ok: false, reason: 'stale' },
      text: 'The report changed while exporting. The preview below is current — export again.',
    },
    {
      status: { via: 'copy', ok: false, reason: 'copyFailed' },
      text: 'The report could not be copied. Copy it from the preview instead.',
    },
    {
      status: { via: 'save', ok: false, reason: 'saveFailed' },
      text: 'The report could not be saved.',
    },
    {
      status: { via: 'vscodeReporter', ok: false, reason: 'reporterFailed' },
      text: 'The VS Code issue reporter could not be opened.',
    },
    // A dismissed save picker ends quietly.
    { status: { via: 'save', ok: false, reason: 'cancelled' }, text: undefined },
  ]
  for (const { status, text } of cases) {
    it(`reads ${JSON.stringify(status)} as ${JSON.stringify(text)}`, () => {
      expect(reportDialogStatusText(status, false)).toBe(text)
    })
  }

  it('reads the updating state while a rebuilt preview is on its way', () => {
    expect(reportDialogStatusText({ via: 'copy', ok: true }, true)).toBe('Updating the preview…')
  })
})
