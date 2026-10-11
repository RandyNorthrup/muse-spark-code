// @vitest-environment jsdom
import { act, fireEvent, screen } from '@testing-library/react'
import type { Root } from 'react-dom/client'
import type * as ReactDomClient from 'react-dom/client'
import { afterEach, expect, it, vi } from 'vitest'
import {
  CHATGPT_PLAN_NOTICE_STORAGE_KEY,
  UI_TEXT,
  WEBVIEW_ROOT_ELEMENT_ID,
} from '../../src/shared/constants'
import type { HostToWebviewMessage, WebviewToHostMessage } from '../../src/shared/protocol'
import { testSettings } from './helpers/fakes'

const mounted = vi.hoisted(() => {
  const roots: Root[] = []
  return { roots }
})
vi.mock('react-dom/client', async (importOriginal) => {
  const actual = await importOriginal<typeof ReactDomClient>()
  return {
    ...actual,
    createRoot: (...args: Parameters<typeof actual.createRoot>) => {
      const root = actual.createRoot(...args)
      mounted.roots.push(root)
      return root
    },
  }
})

afterEach(() => {
  act(() => {
    for (const root of mounted.roots) root.unmount()
  })
  document.body.replaceChildren()
  localStorage.clear()
  vi.unstubAllGlobals()
})

it('uses the production entry port for account-scoped notice persistence and mounted account changes', async () => {
  const postMessage = vi.fn<(message: WebviewToHostMessage) => void>()
  vi.stubGlobal('acquireVsCodeApi', () => ({
    postMessage,
    getState: () => undefined,
    setState: vi.fn(),
  }))
  const element = document.createElement('div')
  element.id = WEBVIEW_ROOT_ELEMENT_ID
  document.body.append(element)
  await act(async () => {
    await import('../../src/webview/main')
  })
  const deliver = (message: HostToWebviewMessage) => {
    act(() => {
      window.dispatchEvent(new MessageEvent('message', { data: message }))
    })
  }
  const accountA = 'a'.repeat(64)
  const accountB = 'b'.repeat(64)
  const authenticate = (accountIdHash: string) => {
    deliver({
      type: 'authState',
      status: 'signedIn',
      backend: 'modelApi',
      planAccount: { providerId: 'chatgpt', accountIdHash },
    })
  }
  deliver({ type: 'init', emptyStateHint: '', composerPlaceholder: '', settings: testSettings })
  authenticate(accountA)
  deliver({ type: 'sessionInfo', modelId: 'chatgpt/gpt-6-astra', sessionId: 's1' })
  fireEvent.click(await screen.findByRole('button', { name: UI_TEXT.planUi.understood }))
  expect(localStorage.getItem(`${CHATGPT_PLAN_NOTICE_STORAGE_KEY}:chatgpt:${accountA}`)).toBe('1')
  expect(localStorage.getItem(CHATGPT_PLAN_NOTICE_STORAGE_KEY)).toBeNull()
  authenticate(accountB)
  fireEvent.click(await screen.findByRole('button', { name: UI_TEXT.planUi.understood }))
  expect(localStorage.getItem(`${CHATGPT_PLAN_NOTICE_STORAGE_KEY}:chatgpt:${accountB}`)).toBe('1')
  authenticate(accountA)
  expect(screen.queryByRole('dialog')).toBeNull()
  expect(postMessage).not.toHaveBeenCalledWith(expect.objectContaining({ type: 'sendMessage' }))
})
