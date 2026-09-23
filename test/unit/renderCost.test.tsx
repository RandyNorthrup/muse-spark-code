// @vitest-environment jsdom
import { act, fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { App } from '../../src/webview/App'
import * as highlightModule from '../../src/webview/highlight'
import * as presentation from '../../src/webview/toolPresentation'
import { testSettings } from './helpers/fakes'

// M25 (PLAN.md D28): a keystroke re-rendered every row of the transcript, and
// every delta re-rendered every row too; a code block was re-highlighted per
// delta. The rows are memoised and the app's callbacks stable now. A tool
// row's render is counted through `changeSummary`, which it calls on every
// render; highlighting through `highlight`.

vi.mock('../../src/webview/toolPresentation', async (original) => {
  const actual = await original<typeof presentation>()
  return { ...actual, changeSummary: vi.fn(actual.changeSummary) }
})

vi.mock('../../src/webview/highlight', async (original) => {
  const actual = await original<typeof highlightModule>()
  return { ...actual, highlight: vi.fn(actual.highlight) }
})

function deliver(data: unknown) {
  act(() => {
    window.dispatchEvent(new MessageEvent('message', { data }))
  })
}

function event(payload: unknown) {
  deliver({ type: 'agentEvent', event: payload })
}

function textarea() {
  return screen.getByLabelText<HTMLTextAreaElement>('Message Muse')
}

describe('render cost (M25)', () => {
  it('renders no row for a keystroke and only the changed row for a delta', () => {
    render(<App postMessage={vi.fn()} />)
    deliver({
      type: 'init',
      emptyStateHint: 'hint',
      composerPlaceholder: 'placeholder',
      settings: testSettings,
    })
    deliver({ type: 'authState', status: 'signedIn' })
    for (const id of ['t1', 't2', 't3']) {
      event({
        type: 'itemCompleted',
        item: {
          itemId: id,
          kind: 'toolCall',
          status: 'completed',
          tool: 'read_file',
          args: `{"path":"${id}.ts"}`,
        },
      })
    }
    event({
      type: 'itemCompleted',
      item: {
        itemId: 'done',
        kind: 'agentMessage',
        status: 'completed',
        text: '```ts\nconst a = 1\n```',
      },
    })
    event({
      type: 'itemStarted',
      item: { itemId: 'm1', kind: 'agentMessage', status: 'inProgress', text: '' },
    })
    const rowRender = vi.mocked(presentation.changeSummary)
    const highlight = vi.mocked(highlightModule.highlight)
    const rowRenders = rowRender.mock.calls.length
    const highlights = highlight.mock.calls.length
    expect(rowRenders).toBeGreaterThan(0)
    fireEvent.change(textarea(), { target: { value: 'typing a message' } })
    fireEvent.change(textarea(), { target: { value: 'typing a message, more' } })
    expect(rowRender).toHaveBeenCalledTimes(rowRenders)
    event({ type: 'textDelta', itemId: 'm1', field: 'text', delta: 'streaming' })
    event({ type: 'textDelta', itemId: 'm1', field: 'text', delta: ' on\n\n```ts\nlet b' })
    event({ type: 'textDelta', itemId: 'm1', field: 'text', delta: ' = 2\nlet c = 3' })
    expect(screen.getByText('streaming on')).toBeInTheDocument()
    // Neither the tool rows nor the finished block render again, and the
    // block still streaming is not highlighted per delta.
    expect(rowRender).toHaveBeenCalledTimes(rowRenders)
    expect(highlight).toHaveBeenCalledTimes(highlights)
    event({ type: 'textDelta', itemId: 'm1', field: 'text', delta: '\n```\n' })
    event({
      type: 'itemCompleted',
      item: { itemId: 'm1', kind: 'agentMessage', status: 'completed' },
    })
    expect(highlight).toHaveBeenCalledTimes(highlights + 1)
  })
})
