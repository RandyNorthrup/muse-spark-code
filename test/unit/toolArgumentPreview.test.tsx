// @vitest-environment jsdom
import { screen } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { loadUiTable } from '../../src/host/l10n'
import { UpdateTranslator } from '../../src/acp/translate'
import type { AgentEvent } from '../../src/shared/agentEvents'
import { UI_TEXT } from '../../src/shared/constants'
import { formatBytes } from '../../src/shared/l10n/text'
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

  it('shows pending without an empty content box or a false truncation marker', async () => {
    showPreview('', false)
    await screen.findByRole('status')
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
    await screen.findByRole('region', { name: 'Vorschau der Argumente' })
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

  it.each(['reconcile', 'terminal', 'interrupted'] as const)(
    'clears a persisted preview on %s settlement',
    (route) => {
      const live = uiReducer(
        { ...initialUiState, sessionId: 's1', activeTurnId: 'turn' },
        action(PREVIEW),
      )
      const restored = restoredUiState(webviewStateOf(live, true))
      const settled =
        route === 'reconcile'
          ? uiReducer(restored, {
              type: 'hostMessage',
              message: { type: 'surfaceState', sessionId: 's1' },
              at: 2,
            })
          : uiReducer(
              live,
              action(
                route === 'terminal'
                  ? { type: 'turnCompleted', turnId: 'turn', terminal: 'completed' }
                  : {
                      type: 'itemCompleted',
                      item: { ...PREVIEW.item, argumentPreview: undefined, status: 'interrupted' },
                    },
              ),
            )
      expect(settled.transcript[0]).toMatchObject({
        status: 'interrupted',
        argumentPreview: undefined,
      })
      renderTranscript(settled.transcript)
      expect(screen.queryByText(UI_TEXT.toolArgumentPreviewPending)).toBeNull()
    },
  )

  it.each(
    (['inProgress', 'completed', 'interrupted'] as const).flatMap((status) =>
      (['idle', 'live', 'history'] as const).map((route) => ({ status, route })),
    ),
  )(
    'clears restored previews without relying on running-turn freshness: $route/$status',
    ({ status, route }) => {
      const current = { ...PREVIEW.item, itemId: 'new-row', turnId: 'new-turn' }
      const state =
        route === 'history'
          ? uiReducer(initialUiState, {
              type: 'hostMessage',
              message: {
                type: 'historyLoaded',
                sessionId: 's1',
                items: [PREVIEW.item, current],
                todos: [],
                activeTurnId: 'new-turn',
              },
              at: 1,
            })
          : uiReducer(
              uiReducer({ ...initialUiState, sessionId: 's1' }, action(PREVIEW)),
              action({ ...PREVIEW, item: current }),
            )
      const saved = webviewStateOf(
        {
          ...state,
          transcript: state.transcript.map((entry) =>
            entry.id === PREVIEW.item.itemId && entry.kind === 'tool'
              ? { ...entry, status }
              : entry,
          ),
        },
        true,
      )
      const restored = restoredUiState(saved)
      const activeTurnId = route === 'idle' ? undefined : 'new-turn'
      const settled = uiReducer(restored, {
        type: 'hostMessage',
        message: { type: 'surfaceState', sessionId: 's1', activeTurnId },
        at: 2,
      })
      expect(settled.activeTurnId).toBe(activeTurnId)
      expect(settled.transcript[0]).toMatchObject({
        status: status === 'inProgress' ? 'interrupted' : status,
        argumentPreview: undefined,
      })
      expect(settled.transcript[1]).toMatchObject({
        status: 'interrupted',
        argumentPreview: undefined,
      })
    },
  )

  it('restores an active preview only from a fresh call update after reconciliation', () => {
    const started = uiReducer(
      { ...initialUiState, sessionId: 's1' },
      action({
        type: 'itemStarted',
        item: { ...PREVIEW.item, turnId: undefined, argumentPreview: undefined },
      }),
    )
    const state = uiReducer(started, action(PREVIEW))
    const restored = restoredUiState(webviewStateOf(state, true))
    const reconciled = uiReducer(restored, {
      type: 'hostMessage',
      message: { type: 'surfaceState', sessionId: 's1', activeTurnId: 'turn' },
      at: 2,
    })
    expect(reconciled.transcript[0]).toMatchObject({
      status: 'interrupted',
      argumentPreview: undefined,
    })
    const fresh = uiReducer(reconciled, action(PREVIEW))
    expect(fresh.transcript[0]).toMatchObject({
      id: PREVIEW.item.itemId,
      status: 'inProgress',
      argumentPreview: PREVIEW.item.argumentPreview,
    })
    expect(fresh.transcript).toHaveLength(1)
  })

  it('drops a completed call’s restored preview while the same turn continues', () => {
    const live = uiReducer(
      { ...initialUiState, sessionId: 's1', activeTurnId: 'turn' },
      action(PREVIEW),
    )
    const saved = webviewStateOf(live, true)
    const item = { ...PREVIEW.item, args: '{"path":"safe.ts"}', argumentPreview: undefined }
    const promoted = uiReducer(live, action({ type: 'itemStarted', item }))
    const completed = uiReducer(
      promoted,
      action({ type: 'itemCompleted', item: { ...item, status: 'completed' } }),
    )
    expect(completed.transcript[0]).toMatchObject({
      status: 'completed',
      argumentPreview: undefined,
    })
    const restored = uiReducer(restoredUiState(saved), {
      type: 'hostMessage',
      message: { type: 'surfaceState', sessionId: 's1', activeTurnId: 'turn' },
      at: 2,
    })
    expect(restored.activeTurnId).toBe('turn')
    expect(restored.transcript[0]).toMatchObject({ argumentPreview: undefined })
    renderTranscript(restored.transcript, { isRunning: true })
    expect(screen.queryByText(UI_TEXT.toolArgumentPreviewPending)).toBeNull()
    expect(screen.queryByRole('region', { name: UI_TEXT.toolArgumentPreviewLabel })).toBeNull()
  })

  it('drops a completed child call’s saved preview while the parent turn continues', () => {
    const parent = uiReducer(
      { ...initialUiState, sessionId: 's1', activeTurnId: 'turn' },
      action({
        type: 'itemStarted',
        item: {
          itemId: 'agent-row',
          kind: 'subagent',
          status: 'inProgress',
          turnId: 'turn',
          childSessionId: 'child',
        },
      }),
    )
    const state = uiReducer(
      parent,
      action({ ...PREVIEW, item: { ...PREVIEW.item, turnId: 'child' } }),
    )
    expect(state.childTranscripts['child']?.entries[0]).toMatchObject({
      argumentPreview: PREVIEW.item.argumentPreview,
    })
    const saved = webviewStateOf(state, true)
    const completed = uiReducer(
      state,
      action({
        type: 'itemCompleted',
        item: {
          ...PREVIEW.item,
          turnId: 'child',
          status: 'completed',
          argumentPreview: undefined,
        },
      }),
    )
    expect(completed.childTranscripts['child']?.entries[0]).toMatchObject({
      status: 'completed',
      argumentPreview: undefined,
    })

    const reconciled = uiReducer(restoredUiState(saved), {
      type: 'hostMessage',
      message: { type: 'surfaceState', sessionId: 's1', activeTurnId: 'turn' },
      at: 2,
    })
    expect(reconciled.childTranscripts['child']?.entries[0]).toMatchObject({
      status: 'interrupted',
      argumentPreview: undefined,
    })
    expect(reconciled.activeTurnId).toBe('turn')
  })

  it('shows frozen preparation and a localized running byte count in React and ACP', async () => {
    const preview = { text: '"path": …', truncated: false, frozen: true, bytes: 1234 }
    renderTranscript([
      tool({ tool: 'write_file', args: '', status: 'inProgress', argumentPreview: preview }),
    ])
    await screen.findByRole('status')
    expect(screen.getByRole('status').textContent).toBe(UI_TEXT.toolArgumentPreviewPreparing)
    const size = formatBytes(preview.bytes)
    expect(screen.getByText(size)).toBeTruthy()
    const translator = new UpdateTranslator('/ws', false)
    const translated = JSON.stringify(
      translator.updates({ ...PREVIEW, item: { ...PREVIEW.item, argumentPreview: preview } }),
    )
    expect(translated).toContain(UI_TEXT.toolArgumentPreviewPreparing)
    expect(translated).toContain(size)
    expect(translated).not.toContain(UI_TEXT.toolArgumentPreviewPending)
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
