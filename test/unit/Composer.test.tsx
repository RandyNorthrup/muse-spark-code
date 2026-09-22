// @vitest-environment jsdom
import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { Composer, type ComposerProps } from '../../src/webview/components/Composer'
import { testSettings } from './helpers/fakes'

function renderComposer(overrides: Partial<ComposerProps> = {}) {
  const props: ComposerProps = {
    draft: '',
    placeholder: 'type here',
    settings: testSettings,
    canSend: true,
    focusRequests: 0,
    pendingInsert: undefined,
    onDraftChange: vi.fn(),
    onInsertApplied: vi.fn(),
    onSubmit: vi.fn(),
    onFocusChange: vi.fn(),
    ...overrides,
  }
  const view = render(<Composer {...props} />)
  const textarea = screen.getByLabelText<HTMLTextAreaElement>('Message Muse')
  return { props, view, textarea }
}

describe('Composer keyboard semantics', () => {
  it('sends on Enter and suppresses the newline', () => {
    const { props, textarea } = renderComposer()
    const wasDefaultAllowed = fireEvent.keyDown(textarea, { key: 'Enter' })
    expect(wasDefaultAllowed).toBe(false)
    expect(props.onSubmit).toHaveBeenCalledOnce()
  })

  it('inserts a newline on Shift+Enter without sending', () => {
    const { props, textarea } = renderComposer()
    const wasDefaultAllowed = fireEvent.keyDown(textarea, { key: 'Enter', shiftKey: true })
    expect(wasDefaultAllowed).toBe(true)
    expect(props.onSubmit).not.toHaveBeenCalled()
  })

  it('requires Ctrl/Cmd+Enter when useCtrlEnterToSend is on', () => {
    const { props, textarea } = renderComposer({
      settings: { ...testSettings, useCtrlEnterToSend: true },
    })
    expect(fireEvent.keyDown(textarea, { key: 'Enter' })).toBe(true)
    expect(props.onSubmit).not.toHaveBeenCalled()
    expect(fireEvent.keyDown(textarea, { key: 'Enter', ctrlKey: true })).toBe(false)
    expect(fireEvent.keyDown(textarea, { key: 'Enter', metaKey: true })).toBe(false)
    expect(props.onSubmit).toHaveBeenCalledTimes(2)
  })

  it('swallows the send gesture but does not submit while sending is disabled', () => {
    const { props, textarea } = renderComposer({ canSend: false })
    expect(fireEvent.keyDown(textarea, { key: 'Enter' })).toBe(false)
    expect(props.onSubmit).not.toHaveBeenCalled()
    expect(screen.getByLabelText('Send')).toBeDisabled()
  })

  it('ignores other keys', () => {
    const { props, textarea } = renderComposer()
    expect(fireEvent.keyDown(textarea, { key: 'a' })).toBe(true)
    expect(props.onSubmit).not.toHaveBeenCalled()
  })
})

describe('Composer focus and insertion', () => {
  it('reports focus changes', () => {
    const onFocusChange = vi.fn<(isFocused: boolean) => void>()
    const { textarea } = renderComposer({ onFocusChange })
    fireEvent.focus(textarea)
    fireEvent.blur(textarea)
    expect(onFocusChange.mock.calls).toEqual([[true], [false]])
  })

  it('focuses the textarea when a focus request arrives', () => {
    const { view, textarea, props } = renderComposer()
    expect(document.activeElement).not.toBe(textarea)
    view.rerender(<Composer {...props} focusRequests={1} />)
    expect(document.activeElement).toBe(textarea)
  })

  it('inserts pending text at the caret and reports it applied', () => {
    const { view, props, textarea } = renderComposer({ draft: 'hello world' })
    textarea.setSelectionRange(5, 5)
    view.rerender(<Composer {...props} pendingInsert=" @a.ts#1" />)
    expect(props.onDraftChange).toHaveBeenCalledWith('hello @a.ts#1 world')
    expect(props.onInsertApplied).toHaveBeenCalledOnce()
  })

  it('replaces a selection with the pending text', () => {
    const { view, props, textarea } = renderComposer({ draft: 'hello world' })
    textarea.setSelectionRange(6, 11)
    view.rerender(<Composer {...props} pendingInsert="there" />)
    expect(props.onDraftChange).toHaveBeenCalledWith('hello there')
  })

  it('reports the draft as the user types', () => {
    const { props, textarea } = renderComposer()
    fireEvent.change(textarea, { target: { value: 'typed' } })
    expect(props.onDraftChange).toHaveBeenCalledWith('typed')
  })
})

describe('Composer chrome', () => {
  it('shows the permission mode label from settings', () => {
    renderComposer({ settings: { ...testSettings, initialPermissionMode: 'acceptEdits' } })
    expect(screen.getByLabelText('Permission mode: Edit automatically')).toBeDisabled()
  })

  it('shows the not-signed-in pill and disabled attach and command buttons', () => {
    renderComposer()
    expect(screen.getByText('Not signed in')).toBeDisabled()
    expect(screen.getByLabelText('Attach')).toBeDisabled()
    expect(screen.getByLabelText('Commands')).toBeDisabled()
  })

  it('grows with the draft', () => {
    const { textarea } = renderComposer({ draft: 'a\nb\nc' })
    expect(textarea).toHaveAttribute('rows', '3')
  })

  it('caps the row count', () => {
    const { textarea } = renderComposer({
      draft: Array.from({ length: 40 }, () => 'x').join('\n'),
    })
    expect(textarea).toHaveAttribute('rows', '10')
  })
})
