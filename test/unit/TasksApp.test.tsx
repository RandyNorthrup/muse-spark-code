// @vitest-environment jsdom
import { act, fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { tasksWebviewMessageSchema } from '../../src/shared/tasksProtocol'
import { TasksApp } from '../../src/webview/TasksApp'

function state(overrides: Record<string, unknown> = {}) {
  act(() => {
    window.dispatchEvent(
      new MessageEvent('message', {
        data: {
          type: 'tasksState',
          conversation: 'Fix parser',
          items: [{ text: 'Test parser', status: 'inProgress' }],
          ended: false,
          canMoveToWindow: false,
          ...overrides,
        },
      }),
    )
  })
}

describe('TasksApp', () => {
  it('announces ready, renders live tasks and never offers a composer', () => {
    const postMessage = vi.fn()
    const { unmount } = render(<TasksApp messages={window} postMessage={postMessage} />)
    expect(postMessage).toHaveBeenCalledExactlyOnceWith({ type: 'tasksReady' })
    expect(screen.getByText('No tasks yet.')).toBeVisible()
    state()
    expect(screen.getByRole('heading', { name: 'Tasks: Fix parser' })).toBeVisible()
    expect(screen.getByText('Test parser')).toBeVisible()
    expect(screen.queryByRole('textbox')).toBeNull()
    state({ items: [] })
    expect(screen.getByText('No tasks yet.')).toBeVisible()
    unmount()
    render(<TasksApp messages={window} postMessage={postMessage} />)
    expect(postMessage).toHaveBeenCalledTimes(2)
  })

  it('offers window movement only when supported', () => {
    const postMessage = vi.fn()
    render(<TasksApp messages={window} postMessage={postMessage} />)
    state()
    expect(screen.queryByRole('button', { name: 'Move into new window' })).toBeNull()
    state({ canMoveToWindow: true })
    fireEvent.click(screen.getByRole('button', { name: 'Move into new window' }))
    expect(postMessage).toHaveBeenLastCalledWith({ type: 'moveTasksToWindow' })
  })

  it('shows ended instead of tasks', () => {
    render(<TasksApp messages={window} postMessage={vi.fn()} />)
    state({ ended: true })
    expect(screen.getByRole('status')).toHaveTextContent(
      'The conversation this list belongs to was closed.',
    )
    expect(screen.queryByText('Test parser')).toBeNull()
  })

  it('rejects malformed host data and all chat commands at its outbound boundary', () => {
    render(<TasksApp messages={window} postMessage={vi.fn()} />)
    state()
    state({ items: [{ text: 7 }] })
    expect(screen.getByText('Test parser')).toBeVisible()
    for (const type of ['sendMessage', 'hostAction', 'ready']) {
      expect(tasksWebviewMessageSchema.safeParse({ type }).success).toBe(false)
    }
    expect(
      tasksWebviewMessageSchema.safeParse({ type: 'tasksReady', action: 'send' }).success,
    ).toBe(false)
  })
})
