// @vitest-environment jsdom
import { screen } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { loadUiTable } from '../../src/host/l10n'
import { UpdateTranslator } from '../../src/acp/translate'
import type { AgentEvent } from '../../src/shared/agentEvents'
import { UI_TEXT } from '../../src/shared/constants'
import { initialUiState, uiReducer } from '../../src/webview/state/uiState'
import { restoredUiState, webviewStateOf } from '../../src/webview/state/snapshot'
import { renderTranscript, tool } from './helpers/transcriptFixtures'
import { restoreEnglish } from './helpers/germanTable'
import { FakeLogOutputChannel } from './helpers/fakes'

const PREVIEW: Extract<AgentEvent, { type: 'toolArgumentPreview' }> = {
  type: 'toolArgumentPreview',
  item: {
    itemId: 'call-row',
    kind: 'toolCall',
    turnId: 'turn',
    status: 'inProgress',
    tool: 'write_file',
    args: '',
    argumentPreview: { text: 'safe content', truncated: false },
  },
}

afterEach(restoreEnglish)

function showPreview(text: string, isTruncated: boolean) {
  renderTranscript([
    tool({
      tool: 'write_file',
      args: '',
      status: 'inProgress',
      argumentPreview: { text, truncated: isTruncated },
    }),
  ])
}

const action = (event: AgentEvent) => ({
  type: 'hostMessage' as const,
  message: { type: 'agentEvent' as const, event },
  at: 1,
})

describe('argument preview across editor surfaces', () => {
  it('renders escaped text with its label, waiting status and truncation marker', async () => {
    showPreview('<img src=x onerror="alert(1)">', true)
    await screen.findByText('<img src=x onerror="alert(1)">')
    expect(screen.getByRole('region', { name: UI_TEXT.toolArgumentPreviewLabel })).toBeTruthy()
    expect(document.querySelector('img')).toBeNull()
    expect(document.querySelector('pre')?.textContent).toBe('<img src=x onerror="alert(1)">')
    expect(screen.getByRole('status').textContent).toBe(UI_TEXT.toolArgumentPreviewPending)
    expect(screen.getByText(UI_TEXT.toolArgumentPreviewTruncated)).toBeTruthy()
  })

  it('shows pending without an empty content box or a false truncation marker', () => {
    showPreview('', false)
    expect(document.querySelector('pre')).toBeNull()
    expect(screen.queryByText(UI_TEXT.toolArgumentPreviewTruncated)).toBeNull()
    expect(screen.getByRole('status')).toBeTruthy()
  })

  it('uses installed translations at render time', async () => {
    const log = new FakeLogOutputChannel()
    const loaded = await loadUiTable({
      language: 'de',
      readExtensionFile: () =>
        Promise.resolve(readFileSync(path.resolve(__dirname, '../../l10n/ui.de.json'), 'utf8')),
      log,
    })
    expect(loaded.locale, JSON.stringify(log.warn.mock.calls)).toBe('de')
    showPreview('', true)
    expect(screen.getByRole('region', { name: 'Vorschau der Argumente' })).toBeTruthy()
    expect(screen.getByRole('status').textContent).toBe(UI_TEXT.toolArgumentPreviewPending)
    expect(screen.getByText(UI_TEXT.toolArgumentPreviewTruncated)).toBeTruthy()
  })

  it('replaces a preview in one tool row and clears it when executable arguments arrive', async () => {
    const state = uiReducer(initialUiState, action(PREVIEW))
    expect(state.transcript).toHaveLength(1)
    expect(state.transcript[0]).toMatchObject({
      id: 'call-row',
      kind: 'tool',
      args: '',
      argumentPreview: PREVIEW.item.argumentPreview,
    })
    const next = uiReducer(
      state,
      action({
        ...PREVIEW,
        item: { ...PREVIEW.item, argumentPreview: { text: 'new content', truncated: true } },
      }),
    )
    expect(next.transcript).toHaveLength(1)
    expect(next.transcript[0]).toMatchObject({
      argumentPreview: { text: 'new content', truncated: true },
    })
    const restored = restoredUiState(webviewStateOf(next, true))
    expect(restored.transcript[0]).toMatchObject({
      argumentPreview: { text: 'new content', truncated: true },
    })
    renderTranscript(next.transcript, { isRunning: true })
    expect(
      await screen.findByRole('region', { name: UI_TEXT.toolArgumentPreviewLabel }),
    ).toBeTruthy()
    expect(screen.getByText('new content')).toBeTruthy()
    expect(
      screen.queryByRole('button', { name: /Move to background|Stop task|Open file/ }),
    ).toBeNull()
    const completed = uiReducer(
      next,
      action({
        type: 'itemCompleted',
        item: {
          itemId: 'call-row',
          kind: 'toolCall',
          status: 'completed',
          tool: 'write_file',
          args: '{"path":"a.ts","content":"complete"}',
        },
      }),
    )
    expect(completed.transcript).toHaveLength(1)
    expect(completed.transcript[0]).toMatchObject({
      argumentPreview: undefined,
      args: '{"path":"a.ts","content":"complete"}',
    })
  })

  it('sends the same labeled preview through ACP, pending until the real call begins', () => {
    const translator = new UpdateTranslator('/ws', false)
    const [started] = translator.updates(PREVIEW)
    expect(started).toMatchObject({
      sessionUpdate: 'tool_call',
      toolCallId: 'call-row',
      status: 'pending',
      rawInput: '',
      content: [
        {
          type: 'content',
          content: { type: 'text', text: expect.stringContaining('safe content') },
        },
      ],
    })
    expect(JSON.stringify(started)).toContain(UI_TEXT.toolArgumentPreviewLabel)
    const updated = translator.updates({
      ...PREVIEW,
      item: { ...PREVIEW.item, argumentPreview: { text: 'updated', truncated: true } },
    })
    expect(updated[0]).toMatchObject({
      sessionUpdate: 'tool_call_update',
      toolCallId: 'call-row',
      status: 'pending',
    })
    expect(JSON.stringify(updated)).toContain(UI_TEXT.toolArgumentPreviewTruncated)
    const promoted = translator.updates({
      type: 'itemStarted',
      item: {
        itemId: 'call-row',
        kind: 'toolCall',
        status: 'inProgress',
        tool: 'write_file',
        args: '{"path":"a.ts","content":"ready"}',
      },
    })
    expect(promoted).toEqual([
      {
        sessionUpdate: 'tool_call_update',
        toolCallId: 'call-row',
        status: 'in_progress',
        rawInput: { path: 'a.ts', content: 'ready' },
        title: 'Write: a.ts',
        content: [],
      },
    ])
  })

  it('lets an ACP client joining through history see the same current preview', () => {
    const translator = new UpdateTranslator('/ws', true)
    expect(translator.itemUpdates(PREVIEW.item, false)[0]).toMatchObject({
      status: 'pending',
      content: expect.any(Array),
    })
  })
})
