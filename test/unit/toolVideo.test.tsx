/** @vitest-environment jsdom */
import { Suspense } from 'react'
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ToolVideo } from '../../src/webview/media/toolEntry'
import { UI_TEXT } from '../../src/shared/constants'

afterEach(cleanup)
describe('lazy tool video', () => {
  it('resolves an approved path through the host port, with controls and no autoplay', async () => {
    const resources = {
      resolve: vi.fn(() => Promise.resolve('blob:private-preview')),
      isAllowed: vi.fn(() => true),
    }
    render(
      <Suspense fallback={<p>{UI_TEXT.loadingOutput}</p>}>
        <ToolVideo path={String.raw`C:\media\clip.mp4`} resources={resources} />
      </Suspense>,
    )
    const video = await screen.findByLabelText(String.raw`C:\media\clip.mp4`)
    expect(video).toHaveAttribute('src', 'blob:private-preview')
    expect(video).toHaveAttribute('controls')
    expect(video).not.toHaveAttribute('autoplay')
    expect(resources.resolve).toHaveBeenCalledWith(
      String.raw`C:\media\clip.mp4`,
      expect.any(AbortSignal),
    )
  })
  it('refuses an unapproved resource URL', async () => {
    const resources = {
      resolve: () => Promise.resolve('https://foreign.example/clip.mp4'),
      isAllowed: () => false,
    }
    render(
      <Suspense fallback={<p>{UI_TEXT.loadingOutput}</p>}>
        <ToolVideo path="clip.mp4" resources={resources} />
      </Suspense>,
    )
    await waitFor(() => {
      expect(screen.getByRole('status')).toHaveTextContent(UI_TEXT.attachmentUnreadable)
    })
    expect(screen.queryByLabelText('clip.mp4')).toBeNull()
  })
  it('changing paths aborts the old read and never renders its late resource', async () => {
    const first = Promise.withResolvers<string>()
    const second = Promise.withResolvers<string>()
    const resources = {
      resolve: vi.fn((_path: string, _signal: AbortSignal) => first.promise),
      isAllowed: () => true,
    }
    const view = render(
      <Suspense fallback={<p>{UI_TEXT.loadingOutput}</p>}>
        <ToolVideo path="first.mp4" resources={resources} />
      </Suspense>,
    )
    await waitFor(() => {
      expect(resources.resolve).toHaveBeenCalledOnce()
    })
    const oldSignal = resources.resolve.mock.calls[0]?.[1]
    resources.resolve.mockReturnValueOnce(second.promise)
    view.rerender(
      <Suspense fallback={<p>{UI_TEXT.loadingOutput}</p>}>
        <ToolVideo path="second.mp4" resources={resources} />
      </Suspense>,
    )
    expect(oldSignal?.aborted).toBe(true)
    first.resolve('blob:old')
    second.resolve('blob:new')
    const video = await screen.findByLabelText('second.mp4')
    expect(video).toHaveAttribute('src', 'blob:new')
  })
})
