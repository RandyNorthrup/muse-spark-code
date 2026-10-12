// @vitest-environment jsdom
import { render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { UI_TEXT } from '../../src/shared/constants'
import { FeedbackSurface } from '../../src/webview/components/FeedbackSurface'

function renderSurface(opener: HTMLElement | null) {
  const postMessage = vi.fn()
  const onClose = vi.fn()
  const view = render(
    <FeedbackSurface sessionId="s1" opener={opener} postMessage={postMessage} onClose={onClose} />,
  )
  return { ...view, postMessage, onClose }
}

describe('FeedbackSurface focus return (RVCM1063D cause 2)', () => {
  it('returns focus to the control that opened the dialog', async () => {
    const opener = document.createElement('button')
    document.body.append(opener)
    try {
      const { unmount } = renderSurface(opener)
      await screen.findByLabelText(UI_TEXT.feedbackNote)
      unmount()
      expect(document.activeElement).toBe(opener)
    } finally {
      opener.remove()
    }
  })

  it('falls back to the composer when the opener is gone', async () => {
    const holder = document.createElement('div')
    holder.innerHTML =
      '<div class="composer-area"><textarea class="composer-input" aria-label="box"></textarea></div>'
    document.body.append(holder)
    try {
      // Never attached: the row menu that opened the dialog is gone.
      const { unmount } = renderSurface(document.createElement('button'))
      await screen.findByLabelText(UI_TEXT.feedbackNote)
      unmount()
      expect(document.activeElement).toBe(holder.querySelector('textarea'))
    } finally {
      holder.remove()
    }
  })
})
