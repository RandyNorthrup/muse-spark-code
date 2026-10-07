// @vitest-environment jsdom
import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { Header } from '../../src/webview/components/Header'
import { Clipped } from '../../src/webview/components/ToolBlocks'
import { EN } from '../../src/shared/l10n/en'

// Behaviour assertions are independent of the registry being documented. The
// remaining contexts have their owning Composer/Modal/menu/card/dialog suites.
describe('reference keyboard behaviour truth', () => {
  it.each(['Enter', ' '])('opens the full tool output with %s', (key) => {
    const onOpen = vi.fn()
    render(<Clipped text="output" className="output" onOpen={onOpen} />)
    fireEvent.keyDown(screen.getByRole('button', { name: 'output' }), { key })
    expect(onOpen).toHaveBeenCalledOnce()
  })
  it('rename Enter commits the new title and Escape abandons it', () => {
    const onRename = vi.fn()
    render(
      <Header title="Before" isFocusView={false} onRename={onRename} onNewConversation={vi.fn()} />,
    )
    fireEvent.click(screen.getByRole('button', { name: 'Before' }))
    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'After' } })
    fireEvent.keyDown(screen.getByRole('textbox'), { key: 'Enter' })
    expect(onRename).toHaveBeenCalledWith('After')
    fireEvent.click(screen.getByRole('button', { name: 'Before' }))
    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'Discard' } })
    fireEvent.keyDown(screen.getByRole('textbox'), { key: 'Escape' })
    expect(onRename).toHaveBeenCalledOnce()
    expect(screen.queryByRole('textbox')).not.toBeInTheDocument()
    expect(EN.referenceRenameKeys).toContain('Confirm or cancel')
  })
})
