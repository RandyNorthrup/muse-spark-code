// @vitest-environment jsdom
import { act, cleanup, fireEvent, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { HostToWebviewMessage, WebviewToHostMessage } from '../../src/shared/protocol'
import { UI_TEXT } from '../../src/shared/constants'
import { renderSignedInApp } from './helpers/initializedApp'

afterEach(cleanup)

describe('CX1R6 installed chat availability', () => {
  it('retains the legacy loop row without a v2 owner or workspace skill', async () => {
    renderSignedInApp(vi.fn())
    fireEvent.change(screen.getByLabelText(UI_TEXT.composerLabel), { target: { value: '/' } })
    expect(await screen.findByRole('option', { name: /\/loop/ })).toBeInTheDocument()
    expect(screen.queryByRole('option', { name: /\/schedule|\/estimate/ })).toBeNull()
  })

  it('omits dormant palette rows and completions even with reserved workspace skills', async () => {
    renderSignedInApp(vi.fn())
    act(() => {
      window.dispatchEvent(
        new MessageEvent('message', {
          data: {
            type: 'skillList',
            skills: ['schedule', 'estimate', 'loop'].map((selector) => ({
              selector,
              displayName: selector,
              description: selector,
            })),
          } satisfies HostToWebviewMessage,
        }),
      )
    })
    fireEvent.change(screen.getByLabelText(UI_TEXT.composerLabel), { target: { value: '/' } })
    expect(await screen.findByRole('option', { name: /compact/ })).toBeInTheDocument()
    expect(screen.getAllByRole('option', { name: /\/loop/ })).toHaveLength(2)
    expect(screen.queryByRole('option', { name: /\/schedule|\/estimate/ })).toBeNull()
    fireEvent.click(screen.getByLabelText(UI_TEXT.commandsTitle))
    expect(await screen.findByRole('combobox')).toBeInTheDocument()
    expect(screen.queryByText(UI_TEXT.scheduleV2.labels.schedulePrompt)).toBeNull()
    expect(screen.queryByText(UI_TEXT.estimateTitle)).toBeNull()
  })

  it.each([
    ['/schedule', () => UI_TEXT.scheduleV2.runtime.unavailable],
    ['/schedule add Keep this prompt', () => UI_TEXT.scheduleV2.runtime.unavailable],
    ['/estimate goal', () => UI_TEXT.estimateRuntimeUnavailable],
  ] as const)(
    'refuses %s plainly without opening or running an optional owner',
    async (text, reason) => {
      const post = vi.fn<(message: WebviewToHostMessage) => void>()
      renderSignedInApp(post)
      const box = screen.getByLabelText(UI_TEXT.composerLabel)
      fireEvent.change(box, { target: { value: text } })
      fireEvent.keyDown(box, { key: 'Enter' })
      const notices = await screen.findAllByText(reason())
      expect(notices.length).toBeGreaterThan(0)
      for (const [message] of post.mock.calls)
        expect([
          'openSchedules',
          'estimateRun',
          'sendMessage',
          'scheduleCreate',
          'scheduleList',
          'scheduleCancel',
        ]).not.toContain(message.type)
      expect(box).toHaveValue(text)
    },
  )
})
