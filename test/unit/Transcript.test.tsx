// @vitest-environment jsdom
import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { Transcript } from '../../src/webview/components/Transcript'

describe('Transcript', () => {
  it('renders every entry kind with its status', () => {
    render(
      <Transcript
        entries={[
          { kind: 'user', id: 'u1', text: 'hello', status: 'sent' },
          { kind: 'user', id: 'u2', text: 'lost', status: 'failed', reason: 'nope' },
          { kind: 'assistant', id: 'a1', text: 'streaming', isStreaming: true },
          { kind: 'assistant', id: 'a2', text: 'done', isStreaming: false },
          { kind: 'activity', id: 't1', itemKind: 'toolCall', status: 'inProgress' },
          { kind: 'activity', id: 't2', itemKind: 'toolCall', status: 'completed' },
          { kind: 'error', id: 'e1', text: 'The turn failed.' },
        ]}
      />,
    )
    const list = screen.getByRole('list', { name: 'Conversation' })
    expect(list.querySelectorAll('li')).toHaveLength(7)
    expect(screen.getByText('hello')).toBeInTheDocument()
    expect(screen.getAllByRole('alert').map((node) => node.textContent)).toEqual([
      'nope',
      'The turn failed.',
    ])
    expect(screen.getByText('streaming').closest('li')).toHaveAttribute('aria-busy', 'true')
    expect(screen.getByText('done').closest('li')).toHaveAttribute('aria-busy', 'false')
    expect(screen.getByText('Working…')).toBeInTheDocument()
    expect(screen.getByText('completed')).toBeInTheDocument()
  })
})
