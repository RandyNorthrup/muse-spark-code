// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import type { HostToWebviewMessage, WebviewToHostMessage } from '../../src/shared/protocol'
import { UI_TEXT } from '../../src/shared/constants'
import { testSettings } from './helpers/fakes'
import { renderSignedInApp } from './helpers/initializedApp'
import { warmDeferredSurfaces } from './helpers/warmDeferredSurfaces'

// The palette, the slash menu and the schedule prompt mapping load on first
// use: their cold transforms stay outside Testing Library's findBy deadline.
beforeAll(warmDeferredSurfaces)

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

// RVREL0171FIX P3: the refusal's words arrive with a lazy module. A command
// typed in a conversation that was replaced meanwhile leaves no notice in the
// new one, whether the module loads or fails.
describe('CX1 /schedule refusal while its words load', () => {
  const PROMPT_MODULE = '../../src/webview/schedules/prompt'

  afterEach(() => {
    vi.doUnmock(PROMPT_MODULE)
  })

  /** A fresh App whose schedule prompt module stays pending until settled. */
  async function coldChat(shouldFail: boolean) {
    const held = Promise.withResolvers<undefined>()
    vi.resetModules()
    vi.doMock(PROMPT_MODULE, async (importOriginal) => {
      await held.promise
      if (shouldFail) throw new Error('the schedule prompt chunk did not load')
      return await importOriginal()
    })
    const { App: ColdApp } = await import('../../src/webview/App')
    const post = vi.fn<(message: WebviewToHostMessage) => void>()
    render(<ColdApp postMessage={post} />)
    act(() => {
      for (const data of [
        { type: 'init', settings: testSettings, emptyStateHint: '', composerPlaceholder: '' },
        { type: 'authState', status: 'signedIn' },
      ] satisfies HostToWebviewMessage[])
        window.dispatchEvent(new MessageEvent('message', { data }))
    })
    const box = screen.getByLabelText(UI_TEXT.composerLabel)
    fireEvent.change(box, { target: { value: '/schedule list' } })
    fireEvent.keyDown(box, { key: 'Enter' })
    return {
      post,
      settle: async () => {
        await act(async () => {
          held.resolve(undefined)
          await new Promise((resolve) => setTimeout(resolve, 0))
        })
      },
    }
  }

  const outcomes = [
    ['the unavailable reason', false, () => UI_TEXT.scheduleV2.runtime.unavailable],
    ['the failed-load warning', true, () => UI_TEXT.scheduleCommandFailed],
  ] as const

  it.each(outcomes)(
    'shows %s in the conversation the command was typed in',
    async (_outcome, shouldFail, notice) => {
      const chat = await coldChat(shouldFail)
      expect(screen.queryByText(notice())).toBeNull()
      await chat.settle()
      expect(await screen.findAllByText(notice())).not.toHaveLength(0)
    },
  )

  it.each(outcomes)(
    'leaves a new conversation without %s for the old command',
    async (_outcome, shouldFail, notice) => {
      const chat = await coldChat(shouldFail)
      fireEvent.click(screen.getByRole('button', { name: UI_TEXT.newConversationTitle }))
      expect(chat.post).toHaveBeenCalledWith(expect.objectContaining({ type: 'clearConversation' }))
      await chat.settle()
      await new Promise((resolve) => setTimeout(resolve, 0))
      expect(screen.queryByText(notice())).toBeNull()
    },
  )
})
