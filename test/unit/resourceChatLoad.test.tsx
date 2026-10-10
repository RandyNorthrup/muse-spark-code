// @vitest-environment jsdom
// M107 U–C1/W (RVM107W1 P2-3): the optional chip chunk, slow or failing,
// through the production chat entry. Loading is announced in place; a failed
// chunk shows a scoped failure with Try again; the conversation and the
// composer stay mounted and nothing reaches the panel's crash screen.
import { fireEvent, screen, waitFor, within } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import { UI_TEXT } from '../../src/shared/constants'
import { mountChatEntry, resourceStatusText } from './helpers/resourceChat'

const chunk = vi.hoisted((): { mode: 'pending' | 'reject' } => ({ mode: 'pending' }))
vi.mock('../../src/webview/resources/ResourceSurface', () => {
  if (chunk.mode === 'reject') throw new Error('resource chunk failed to load')
  return new Promise<never>(() => undefined)
})

afterEach(() => {
  document.body.replaceChildren()
  vi.unstubAllGlobals()
})

const composer = () => document.querySelector('.composer-input')

it('announces a slow chip chunk in place and keeps the composer usable', async () => {
  chunk.mode = 'pending'
  const { deliver } = await mountChatEntry()
  deliver({ type: 'resourceStatus', status: resourceStatusText('throttle') })
  const scoped = await waitFor(() => {
    const element = document.querySelector('.resource-surface')
    if (!(element instanceof HTMLElement)) throw new Error('no resource surface yet')
    return element
  })
  const loading = within(scoped).getByRole('status')
  expect(loading).toHaveTextContent(`${UI_TEXT.resourceTitle}: ${UI_TEXT.loadingOutput}`)
  expect(composer()).toBeInTheDocument()
  expect(screen.queryByText(UI_TEXT.crashTitle)).toBeNull()
})

it('shows a scoped failure with Try again for a rejected chunk, never the crash screen', async () => {
  chunk.mode = 'reject'
  const { deliver, postMessage } = await mountChatEntry()
  deliver({ type: 'resourceStatus', status: resourceStatusText('pause') })
  const alert = await waitFor(() => {
    const element = document.querySelector('.resource-surface [role="alert"]')
    if (!(element instanceof HTMLElement)) throw new Error('no scoped failure yet')
    return element
  })
  expect(alert).toHaveTextContent(`${UI_TEXT.resourceTitle}: ${UI_TEXT.surfaceLoadFailed}`)
  expect(composer()).toBeInTheDocument()
  expect(screen.queryByText(UI_TEXT.crashTitle)).toBeNull()
  expect(postMessage).not.toHaveBeenCalledWith(
    expect.objectContaining({ type: 'webviewError', source: 'render' }),
  )
  fireEvent.click(within(alert).getByRole('button', { name: UI_TEXT.surfaceLoadRetry }))
  // The deferred-surface helper's retry: save the conversation, then a fresh document.
  expect(postMessage).toHaveBeenCalledWith({ type: 'hostAction', action: 'reload' })
})
