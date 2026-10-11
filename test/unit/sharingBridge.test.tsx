// @vitest-environment jsdom
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { StrictMode } from 'react'
import { describe, expect, it, vi } from 'vitest'
import { PromptLibraryBridge } from '../../src/webview/prompts/PromptLibraryBridge'
import { ChatShareBridge } from '../../src/webview/sharing/ChatShareBridge'
import { sharingRpc } from '../../src/webview/sharing/sharingRpc'
import type { WebviewToHostMessage } from '../../src/shared/protocol'
import { UI_TEXT } from '../../src/shared/constants'
import { savedPromptFixture } from './helpers/sharingFixtures'

function answer(id: string, value: unknown) {
  act(() => {
    window.dispatchEvent(
      new MessageEvent('message', { data: { type: 'sharingResult', id, value } }),
    )
  })
}
describe('M118 shared host bridge', () => {
  it('renders host-owned prompts and sends an insert action without a model submission', async () => {
    const messages: WebviewToHostMessage[] = []
    const post = (message: WebviewToHostMessage) => {
      messages.push(message)
    }
    const view = render(
      <StrictMode>
        <PromptLibraryBridge post={post} onClose={vi.fn()} />
      </StrictMode>,
    )
    const list = messages.findLast(
      (message) => message.type === 'sharingAction' && message.action === 'list',
    )
    if (list?.type !== 'sharingAction') throw new Error('Missing library request')
    answer(list.id, { prompts: [savedPromptFixture], hasWorkspace: false, canImportLinks: true })
    expect(await screen.findByText(savedPromptFixture.title)).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: UI_TEXT.promptInsert }))
    expect(messages.at(-1)).toMatchObject({
      type: 'sharingAction',
      action: 'insert',
      payload: savedPromptFixture,
    })
    expect(messages.some((message) => message.type === 'sendMessage')).toBe(false)
    view.unmount()
    expect(messages.at(-1)).toMatchObject({ type: 'sharingAction', action: 'invalidate' })
  })
  it('renders an exact chat preview and confirms only from the final button', async () => {
    const messages: WebviewToHostMessage[] = []
    render(
      <ChatShareBridge
        post={(message) => {
          messages.push(message)
        }}
        onClose={vi.fn()}
      />,
    )
    const context = messages[0]
    if (context?.type !== 'sharingAction') throw new Error('Missing chat context')
    answer(context.id, {
      sessionId: 's1',
      messages: [{ id: 'u1', label: 'Exact text' }],
      attachments: [],
      initialMode: 'conversation',
      initialFormat: 'md',
    })
    fireEvent.click(await screen.findByRole('button', { name: UI_TEXT.sharePreview }))
    const preview = messages.at(-1)
    if (preview?.type !== 'sharingAction') throw new Error('Missing preview request')
    answer(preview.id, {
      previewId: 'token',
      request: preview.payload,
      content: 'Exact [redacted] bytes\n',
      fileName: 'chat.md',
    })
    await waitFor(() => {
      expect(screen.getByText('[redacted]', { selector: 'mark' })).toBeInTheDocument()
    })
    expect(
      messages.some(
        (message) => message.type === 'sharingAction' && message.action === 'chatConfirm',
      ),
    ).toBe(false)
    fireEvent.click(screen.getByRole('button', { name: UI_TEXT.shareConfirm }))
    expect(messages.at(-1)).toMatchObject({
      type: 'sharingAction',
      action: 'chatConfirm',
      payload: { step: 'confirmed', previewId: 'token' },
    })
  })
  it('ignores malformed envelopes and rejects pending or late actions on close', async () => {
    const post = vi.fn<(message: WebviewToHostMessage) => void>()
    const rpc = sharingRpc(post)
    rpc.open()
    const waiting = rpc.ask('list')
    const result = expect(waiting).rejects.toThrow(UI_TEXT.shareCancelled)
    window.dispatchEvent(
      new MessageEvent('message', { data: { type: 'sharingResult', id: 1, value: 'forged' } }),
    )
    rpc.close()
    await result
    const calls = post.mock.calls.length
    await expect(rpc.ask('insert', {})).rejects.toThrow(UI_TEXT.shareCancelled)
    expect(post).toHaveBeenCalledTimes(calls)
  })
})
