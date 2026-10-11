// @vitest-environment jsdom
import { act, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ReportApp, type ReportingBridge } from '../../src/webview/reporting/ReportApp'
import type {
  ReportingHostMessage,
  ReportingWebviewMessage,
} from '../../src/webview/reporting/protocol'
import { EN } from '../../src/shared/l10n/en'
import { setUiText } from '../../src/shared/l10n/text'
import { renderFixture, RENDERERS, REPORT_THEME } from './reportRenderFixtures'

function send(data: unknown): void {
  act(() => {
    window.dispatchEvent(new MessageEvent('message', { data }))
  })
}

function setup() {
  const post = vi.fn<(message: ReportingWebviewMessage) => void>()
  const bridge: ReportingBridge = { post, messages: window }
  const view = render(<ReportApp bridge={bridge} />)
  const document = renderFixture()
  const state: ReportingHostMessage = {
    type: 'reportingState',
    busy: false,
    header: document.header,
    html: RENDERERS.html(document, 'en', REPORT_THEME),
    history: null,
    diff: null,
    status: '',
    isError: false,
  }
  send(state)
  return { post, view, state, send }
}

describe('the shared report page', () => {
  afterEach(() => {
    setUiText(EN, 'en')
  })

  it('uses a separate bridge and sandboxed static document with all six report actions', () => {
    const t = setup()
    expect(t.post).toHaveBeenCalledWith({ type: 'reportingReady' })
    const frame = screen.getByTitle('Project')
    expect(frame).toHaveAttribute('sandbox', '')
    expect(frame).toHaveAttribute('srcdoc', t.state.html)
    expect(frame).not.toHaveAttribute('src')
    for (const [name, action] of [
      [EN.reportUi.copyMarkdown, 'copy'],
      [EN.reportUi.attach, 'attach'],
      [EN.reportUi.history, 'history'],
      [EN.reportUi.diffPrevious, 'diff'],
      [EN.reportUi.refresh, 'refresh'],
      [EN.reportUi.show, 'pick'],
    ] as const) {
      fireEvent.click(screen.getByRole('button', { name }))
      expect(t.post).toHaveBeenLastCalledWith({ type: 'reportingAction', action })
    }
    fireEvent.change(screen.getByLabelText(EN.reportUi.format), { target: { value: 'text' } })
    fireEvent.click(screen.getByRole('button', { name: EN.reportUi.saveAs }))
    expect(t.post).toHaveBeenLastCalledWith({ type: 'reportingSave', format: 'text' })
  })

  it('ignores malformed host states and disables exports until a document is available', () => {
    const t = setup()
    t.send({ ...t.state, header: null, html: '' })
    expect(screen.getByRole('button', { name: EN.reportUi.copyMarkdown })).toBeDisabled()
    expect(screen.queryByTitle('Project')).not.toBeInTheDocument()
    t.send({ ...t.state, unexpected: 'field' })
    expect(screen.queryByTitle('Project')).not.toBeInTheDocument()
    t.send({ ...t.state, busy: true })
    expect(screen.getByRole('button', { name: EN.reportUi.refresh })).toBeDisabled()
    t.view.unmount()
    t.send(t.state)
    expect(t.post).toHaveBeenCalledOnce()
  })

  it('renders history selections, errors and diff row values as text data', () => {
    const t = setup()
    t.send({
      ...t.state,
      history: [{ id: 'saved-report', header: t.state.header }],
      status: EN.reportUi.generationFailed,
      isError: true,
    })
    expect(screen.getByRole('alert')).toHaveTextContent(EN.reportUi.generationFailed)
    fireEvent.click(screen.getByRole('button', { name: /Project · Fixture workspace/ }))
    expect(t.post).toHaveBeenLastCalledWith({ type: 'reportingOpen', id: 'saved-report' })
    t.send({
      ...t.state,
      diff: {
        from: t.state.header,
        to: t.state.header,
        sections: [
          {
            id: 'changes',
            label: 'changelog',
            added: [
              {
                key: 'safe',
                cells: { detail: { type: 'text', value: '<img src=x onerror=alert(1)>' } },
                sourceIds: ['plan'],
              },
            ],
            removed: [],
            changed: [],
            unchangedRows: 1,
          },
        ],
      },
    })
    expect(screen.getByRole('heading', { name: EN.reportLabels.diff })).toBeInTheDocument()
    expect(screen.getByText(/<img src=x onerror=alert\(1\)>/)).toBeInTheDocument()
    expect(t.view.container.querySelector('img')).toBeNull()
  })

  it('reads installed labels at render time', () => {
    setUiText(
      {
        ...EN,
        reportUi: { ...EN.reportUi, title: 'Berichte', copyMarkdown: 'Als Markdown kopieren' },
      },
      'de',
    )
    setup()
    expect(screen.getByRole('heading', { name: 'Berichte' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Als Markdown kopieren' })).toBeInTheDocument()
  })
})
