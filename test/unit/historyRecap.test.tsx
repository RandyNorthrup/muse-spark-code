// @vitest-environment jsdom
import { fireEvent, render, screen } from '@testing-library/react'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { UI_TEXT } from '../../src/shared/constants'
import type { SessionRow } from '../../src/shared/sessions'
import { HistoryPromptRow } from '../../src/webview/components/HistoryPromptRow'
import type { SessionRecapView } from '../../src/webview/state/uiState'

// M127's History recap over the recorded settlement: the 1.4.9 echo
// capture settled a recap `failed` with reason `providerFailed`. The
// row offers Recap where the backend keeps recaps, shows the loading
// line while the host answers, and the served reason under the row.

const recorded = (
  JSON.parse(
    readFileSync(path.join('test', 'fixtures', 'm127', 'note-recap-completed-1.4.9.json'), 'utf8'),
  ) as { outcome: string; reason: string; sessionId: string }[]
)[0]
if (recorded === undefined) throw new Error('the capture settled one recap')

const ROW: SessionRow = {
  sessionId: recorded.sessionId,
  title: 'A stored conversation',
  isNamed: false,
  createdAt: '2026-10-17T18:20:00Z',
  updatedAt: '2026-10-17T18:20:00Z',
  status: 'idle',
  turnCount: 3,
  isFork: false,
}

const recap: SessionRecapView = { outcome: recorded.outcome, reason: recorded.reason }

function renderRow(overrides?: {
  readonly onRecap?: (() => void) | undefined
  readonly recap?: SessionRecapView | undefined
  readonly isRecapPending?: boolean
}) {
  return render(
    <HistoryPromptRow
      row={ROW}
      isActive={false}
      isCurrent={false}
      isRowArchived={false}
      meta="idle"
      recap={overrides?.recap}
      isRecapPending={overrides?.isRecapPending ?? false}
      onHover={() => undefined}
      onResume={() => undefined}
      onSetArchived={() => undefined}
      onDelete={undefined}
      onRecap={overrides?.onRecap}
      onSavePrompt={undefined}
      menuContainer={null}
    />,
  )
}

describe('HistoryPromptRow recap', () => {
  it('offers Recap only where the backend keeps recaps', () => {
    let asked = 0
    const { unmount } = renderRow({
      onRecap: () => {
        asked += 1
      },
    })
    fireEvent.click(screen.getByText(UI_TEXT.historyRecap))
    expect(asked).toBe(1)
    unmount()
    renderRow({ onRecap: undefined })
    expect(screen.queryByText(UI_TEXT.historyRecap)).toBeNull()
  })

  it('shows the loading line while the host answers, then the served recap', () => {
    const { rerender } = renderRow({
      onRecap: () => undefined,
      isRecapPending: true,
    })
    expect(screen.getByText(UI_TEXT.historyRecapLoading)).toBeDefined()
    rerender(
      <HistoryPromptRow
        row={ROW}
        isActive={false}
        isCurrent={false}
        isRowArchived={false}
        meta="idle"
        recap={recap}
        isRecapPending={false}
        onHover={() => undefined}
        onResume={() => undefined}
        onSetArchived={() => undefined}
        onDelete={undefined}
        onRecap={() => undefined}
        onSavePrompt={undefined}
        menuContainer={null}
      />,
    )
    expect(screen.queryByText(UI_TEXT.historyRecapLoading)).toBeNull()
    expect(screen.getByText(recorded.reason)).toBeDefined()
  })
})
