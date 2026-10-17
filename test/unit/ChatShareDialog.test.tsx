// @vitest-environment jsdom
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { useState } from 'react'
import { describe, expect, it, vi } from 'vitest'
import {
  ChatShareDialog,
  type ChatShareDialogPort,
} from '../../src/webview/sharing/ChatShareDialog'
import { Header } from '../../src/webview/components/Header'
import { UI_TEXT } from '../../src/shared/constants'
import type { ChatSharePreview } from '../../src/core/sharing/shareRelease'
import { shareRequestSchema } from '../../src/shared/share'

function dialog(portOverrides: Partial<ChatShareDialogPort> = {}) {
  const confirm = vi.fn(() => Promise.resolve<'shared'>('shared'))
  const invalidate = vi.fn()
  const remember = vi.fn()
  const onClose = vi.fn()
  const port: ChatShareDialogPort = {
    preview: vi.fn((request) =>
      Promise.resolve({
        previewId: 'token',
        request: shareRequestSchema.parse(request),
        fileName: 'muse-chat.md',
        content: 'User [redacted] [home] [user] [path] [redacted account]\n',
      }),
    ),
    confirm,
    invalidate,
    remember,
    ...portOverrides,
  }
  const view = render(
    <ChatShareDialog
      sessionId="s1"
      messages={[
        { id: 'u1', label: 'First message' },
        { id: 'a1', label: 'Second message' },
      ]}
      attachments={[{ id: 'file', name: 'notes.txt' }]}
      initialMode="conversation"
      initialFormat="md"
      port={port}
      onClose={onClose}
    />,
  )
  return { ...view, port, confirm, invalidate, remember, onClose }
}

function ReplacementHost({
  port,
  onClose,
  keyed,
}: {
  readonly port: ChatShareDialogPort
  readonly onClose: () => void
  readonly keyed: boolean
}) {
  const [sessionId, setSessionId] = useState<string | undefined>('s1')
  return (
    <>
      <button
        onClick={() => {
          setSessionId('s2')
        }}
      >
        Replace session
      </button>
      {sessionId === undefined ? null : (
        <ChatShareDialog
          key={keyed ? sessionId : 'same-instance'}
          sessionId={sessionId}
          messages={[]}
          attachments={[]}
          initialMode="conversation"
          initialFormat="md"
          port={port}
          onClose={() => {
            onClose()
            setSessionId(undefined)
          }}
        />
      )}
    </>
  )
}
async function preview() {
  fireEvent.click(screen.getByRole('button', { name: UI_TEXT.sharePreview }))
  await waitFor(() => {
    expect(screen.getByRole('button', { name: UI_TEXT.shareConfirm })).toBeEnabled()
  })
}

describe('M118 preview dialog and header', () => {
  it.each([true, false])(
    'keeps the replacement session dialog open when an old confirmation completes (keyed=%s)',
    async (keyed) => {
      const { promise: pending, resolve: finish } = Promise.withResolvers<'shared'>()
      const t = dialog({ confirm: () => pending })
      t.unmount()
      render(<ReplacementHost port={t.port} onClose={t.onClose} keyed={keyed} />)
      await preview()
      fireEvent.click(screen.getByRole('button', { name: UI_TEXT.shareConfirm }))
      fireEvent.click(screen.getByRole('button', { name: 'Replace session' }))
      // The host invalidates its token, but an already committed sink can still settle.
      t.port.invalidate()
      await act(async () => {
        finish('shared')
        await pending
      })
      expect(t.onClose).not.toHaveBeenCalled()
      expect(screen.getByRole('button', { name: UI_TEXT.shareConfirm })).toBeDisabled()
      await preview()
      expect(t.port.preview).toHaveBeenLastCalledWith(expect.objectContaining({ sessionId: 's2' }))
    },
  )
  it('invalidates on unmount and ignores a late committed confirmation', async () => {
    const { promise: pending, resolve: finish } = Promise.withResolvers<'shared'>()
    const t = dialog({ confirm: () => pending })
    await preview()
    fireEvent.click(screen.getByRole('button', { name: UI_TEXT.shareConfirm }))
    t.invalidate.mockClear()
    t.unmount()
    await act(async () => {
      finish('shared')
      await pending
    })
    expect(t.invalidate).toHaveBeenCalledOnce()
    expect(t.onClose).not.toHaveBeenCalled()
  })
  it('opens from the header only when supplied by the host', () => {
    const onShare = vi.fn()
    const { rerender } = render(
      <Header title="Chat" isFocusView={false} onNewConversation={vi.fn()} />,
    )
    expect(screen.queryByRole('button', { name: UI_TEXT.shareChat })).toBeNull()
    rerender(
      <Header title="Chat" isFocusView={false} onNewConversation={vi.fn()} onShare={onShare} />,
    )
    fireEvent.click(screen.getByRole('button', { name: UI_TEXT.shareChat }))
    expect(onShare).toHaveBeenCalledOnce()
  })
  it('shows exact scrubbed bytes with every redaction highlighted and dispatches only on final confirmation', async () => {
    const t = dialog()
    expect(t.port.preview).not.toHaveBeenCalled()
    expect(t.confirm).not.toHaveBeenCalled()
    expect(screen.getByRole('button', { name: UI_TEXT.shareConfirm })).toBeDisabled()
    await preview()
    const bytes = document.querySelector('pre')
    expect(bytes?.textContent).toBe('User [redacted] [home] [user] [path] [redacted account]\n')
    expect(bytes?.querySelectorAll('mark')).toHaveLength(5)
    expect(t.remember).toHaveBeenCalledWith('conversation', 'md')
    expect(t.confirm).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: UI_TEXT.shareConfirm }))
    await waitFor(() => {
      expect(t.onClose).toHaveBeenCalledOnce()
    })
    expect(t.confirm).toHaveBeenCalledWith(
      expect.objectContaining({ step: 'confirmed', previewId: 'token' }),
    )
  })
  it('invalidates on range, options, mode, format, attachment and destination edits, and exposes only local destinations', async () => {
    const t = dialog()
    await preview()
    fireEvent.change(screen.getByLabelText(UI_TEXT.shareRangeFrom), { target: { value: 'a1' } })
    expect(screen.getByRole('button', { name: UI_TEXT.shareConfirm })).toBeDisabled()
    expect(t.invalidate).toHaveBeenCalled()
    fireEvent.click(screen.getByLabelText(UI_TEXT.shareFull))
    fireEvent.click(screen.getByLabelText(UI_TEXT.shareCodeBlocks))
    fireEvent.click(screen.getByLabelText(UI_TEXT.shareAttachmentNames))
    fireEvent.click(screen.getByLabelText(UI_TEXT.shareDiffs))
    fireEvent.click(screen.getByLabelText('notes.txt'))
    fireEvent.change(screen.getByLabelText(UI_TEXT.shareFormat), { target: { value: 'json' } })
    fireEvent.click(screen.getByLabelText(UI_TEXT.shareBrowser))
    await preview()
    expect(t.port.preview).toHaveBeenLastCalledWith(
      expect.objectContaining({
        range: { from: 'a1', to: 'a1' },
        mode: 'full',
        format: 'html',
        destination: 'browser',
        options: {
          codeBlocks: false,
          attachmentNames: false,
          diffs: true,
          attachmentContents: ['file'],
        },
      }),
    )
    expect(screen.queryByText('gist')).toBeNull()
    expect(t.confirm).not.toHaveBeenCalled()
  })
  it('remembers workspace mode and format edits even when closed without previewing', () => {
    const t = dialog()
    fireEvent.click(screen.getByLabelText(UI_TEXT.shareFull))
    fireEvent.change(screen.getByLabelText(UI_TEXT.shareFormat), { target: { value: 'json' } })
    fireEvent.click(screen.getByRole('button', { name: UI_TEXT.usageClose }))
    expect(t.remember).toHaveBeenLastCalledWith('full', 'json')
    expect(t.port.preview).not.toHaveBeenCalled()
    expect(t.confirm).not.toHaveBeenCalled()
  })
  it('shows confidential refusal and never enables release', async () => {
    const t = dialog({ preview: () => Promise.reject(new Error(UI_TEXT.shareConfidential)) })
    fireEvent.click(screen.getByRole('button', { name: UI_TEXT.sharePreview }))
    expect(await screen.findByRole('alert')).toHaveTextContent(UI_TEXT.shareConfidential)
    expect(screen.getByRole('button', { name: UI_TEXT.shareConfirm })).toBeDisabled()
    expect(t.confirm).not.toHaveBeenCalled()
  })
  it('does not accept a malformed or mismatched host preview', async () => {
    const t = dialog({
      preview: () =>
        Promise.resolve({ previewId: 'token', request: {}, fileName: 'file', content: 'text' }),
    })
    fireEvent.click(screen.getByRole('button', { name: UI_TEXT.sharePreview }))
    expect(await screen.findByRole('alert')).toHaveTextContent(UI_TEXT.exportFailed)
    expect(screen.getByRole('button', { name: UI_TEXT.shareConfirm })).toBeDisabled()
    expect(t.confirm).not.toHaveBeenCalled()
  })
  it('rejects a valid host preview for different options', async () => {
    const t = dialog({
      preview: (request) =>
        Promise.resolve({
          previewId: 'token',
          request: shareRequestSchema.parse({ ...request, mode: 'full' }),
          fileName: 'chat.md',
          content: 'text',
        }),
    })
    fireEvent.click(screen.getByRole('button', { name: UI_TEXT.sharePreview }))
    expect(await screen.findByRole('alert')).toHaveTextContent(UI_TEXT.sharePreviewExpired)
    expect(screen.getByRole('button', { name: UI_TEXT.shareConfirm })).toBeDisabled()
    expect(t.confirm).not.toHaveBeenCalled()
  })
  it('ignores an asynchronous preview that finishes after close and invalidates its host token', async () => {
    const { promise: pending, resolve: finish } = Promise.withResolvers<ChatSharePreview>()
    const t = dialog({ preview: () => pending })
    fireEvent.click(screen.getByRole('button', { name: UI_TEXT.sharePreview }))
    fireEvent.click(screen.getByRole('button', { name: UI_TEXT.usageClose }))
    const request = shareRequestSchema.parse({
      target: 'chat',
      sessionId: 's1',
      mode: 'conversation',
      format: 'md',
      destination: 'copy',
    })
    if (request.target !== 'chat') throw new Error('fake not ready')
    finish({ previewId: 'stale', request, fileName: 'chat.md', content: 'late' })
    await waitFor(() => {
      expect(t.onClose).toHaveBeenCalledOnce()
    })
    expect(t.invalidate).toHaveBeenCalled()
    expect(screen.getByRole('button', { name: UI_TEXT.shareConfirm })).toBeDisabled()
    expect(t.confirm).not.toHaveBeenCalled()
    expect(t.remember).not.toHaveBeenCalled()
  })
})
