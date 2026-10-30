// @vitest-environment jsdom
import { expect, it } from 'vitest'
import { panelThemePort } from '../../src/webview/bridges/theme/panelThemePort'
import type { MessageSource } from '../../src/webview/hostBridge'

function source() {
  const target = new EventTarget()
  const messages: MessageSource = {
    addEventListener: target.addEventListener.bind(target),
    removeEventListener: target.removeEventListener.bind(target),
  }
  return {
    messages,
    post: (data: unknown) => target.dispatchEvent(new MessageEvent('message', { data })),
  }
}

it('starts on the system mode with the generated palette (no roles)', () => {
  const { messages } = source()
  expect(panelThemePort(messages, true).current()).toEqual({ mode: 'dark', roles: {} })
  expect(panelThemePort(messages, false).current()).toEqual({ mode: 'light', roles: {} })
})

it("maps a theme frame's --muse-* tokens onto host roles and notifies subscribers", () => {
  const { messages, post } = source()
  const port = panelThemePort(messages, false)
  const seen: unknown[] = []
  const unsubscribe = port.subscribe((snapshot) => {
    seen.push(snapshot)
  })
  post({
    type: 'theme',
    theme: {
      kind: 'highContrastDark',
      tokens: {
        '--muse-surface': '#000000',
        '--muse-font-ui': 'Inter, sans-serif',
        '--muse-not-a-role': '#ffffff',
      },
    },
  })
  expect(port.current()).toEqual({
    mode: 'hc-dark',
    roles: { 'colour.surface': '#000000', 'typography.font-ui': 'Inter, sans-serif' },
  })
  expect(seen).toEqual([port.current()])
  unsubscribe()
  post({ type: 'theme', theme: { kind: 'light', tokens: {} } })
  expect(seen).toHaveLength(1)
  expect(port.current()).toEqual({ mode: 'light', roles: {} })
})

it('ignores messages that are not valid theme frames', () => {
  const { messages, post } = source()
  const port = panelThemePort(messages, false)
  post({ type: 'notice', level: 'info', text: 'x' })
  post({ type: 'theme', theme: { kind: 'neon', tokens: {} } })
  post('theme')
  expect(port.current()).toEqual({ mode: 'light', roles: {} })
})
