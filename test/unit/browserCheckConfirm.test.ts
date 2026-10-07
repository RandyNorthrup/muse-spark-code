// The extension's own question before Muse Code's browser check (M81,
// PLAN.md D49): a modal naming the URL, saying so when the host is beyond
// loopback, and allowing the one check only for Allow once.
import { window, type MessageItem } from 'vscode'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  isBrowserCheckAllowed,
  browserDevOrigins,
} from '../../src/host/browser/browserCheckConfirm'
import { memoryMemento } from './helpers/fakeGit'
import { BROWSER_DEV_ORIGIN_GRANTS_KEY, UI_TEXT } from '../../src/shared/constants'

afterEach(() => {
  vi.mocked(window.showWarningMessage).mockReset()
})

/** The modal's arguments for one question answered with the item at `answer`. */
async function ask(url: string, host: string | undefined, answer: number | undefined) {
  vi.mocked(window.showWarningMessage).mockImplementationOnce((_message, _options, ...items) =>
    Promise.resolve(answer === undefined ? undefined : items[answer]),
  )
  const isAllowed = await isBrowserCheckAllowed(url, {
    widenedHost: host,
    allowedHosts: host === undefined ? [] : [host],
  })
  const [title, options, ...items] = vi.mocked(window.showWarningMessage).mock.calls.at(-1) ?? []
  return { isAllowed, title, options, items }
}

describe("the extension's own browser check question (M81)", () => {
  it('refuses a stale settings answer after an origin was removed and re-added', async () => {
    const origin = 'http://192.168.1.50:5173'
    let configured = [origin]
    const response = Promise.withResolvers<MessageItem | undefined>()
    const asked = Promise.withResolvers<MessageItem>()
    vi.mocked(window.showWarningMessage).mockImplementationOnce((_message, _options, ...items) => {
      if (items[0] === undefined) throw new Error('missing allow item')
      asked.resolve(items[0])
      return response.promise
    })
    const state = memoryMemento()
    const origins = browserDevOrigins(state, () => configured)
    const pending = origins.change()
    const allow = await asked.promise
    configured = []
    await origins.change()
    configured = [origin]
    response.resolve(allow)
    await pending
    expect(origins.read()).toEqual([])
    expect(browserDevOrigins(state, () => configured).read()).toEqual([])
  })
  it('requires an explicit settings UI confirmation naming each non-loopback dev origin', async () => {
    const local = 'http://localhost:3000'
    const lan = 'http://192.168.1.50:5173'
    let configured = [local, lan]
    const origins = browserDevOrigins(memoryMemento(), () => configured)
    expect(origins.read()).toEqual([local])
    expect(window.showWarningMessage).not.toHaveBeenCalled()
    vi.mocked(window.showWarningMessage).mockImplementationOnce((_message, _options, ...items) =>
      Promise.resolve(items[0]),
    )
    await origins.change()
    expect(origins.read()).toEqual([local, lan])
    const [title, options] = vi.mocked(window.showWarningMessage).mock.calls[0] ?? []
    expect(title).toContain(lan)
    expect(options).toEqual({ modal: true })
    configured = [local]
    await origins.change()
    configured = [local, lan]
    expect(origins.read()).toEqual([local])
    await origins.change() // Closing the new settings question refuses.
    expect(origins.read()).toEqual([local])
  })
  it('refuses known machine UI settings even when their origin was remembered', async () => {
    const origin = 'http://192.168.1.50:5000'
    const origins = browserDevOrigins(
      memoryMemento({ [BROWSER_DEV_ORIGIN_GRANTS_KEY]: [origin] }),
      () => [origin],
    )
    await origins.change()
    expect(origins.read()).toEqual([])
    expect(window.showWarningMessage).not.toHaveBeenCalled()
  })
  it('names the URL in a modal, and says what the page may reach', async () => {
    const local = await ask('http://localhost:3000/', undefined, 0)
    expect(local.isAllowed).toBe(true)
    expect(local.title).toBe('Muse Code wants to open http://localhost:3000/ in a headless browser')
    expect(local.options).toEqual({ modal: true, detail: UI_TEXT.browserCheckConfirmDetail })
    expect(local.items).toEqual([
      { title: UI_TEXT.allowOnce },
      { title: UI_TEXT.reject, isCloseAffordance: true },
    ])
  })

  it('names a host beyond loopback, which allowing widens this one check to', async () => {
    const beyond = await ask('http://intranet:8080/', 'intranet', 0)
    expect(beyond.options).toEqual({
      modal: true,
      detail: `intranet is not this computer. Allowing lets this one check reach it, over https and WebSockets too. That traffic is encrypted, so the extension cannot inspect it, and a site there may sign in as you with this computer’s account (on Windows in particular).\n\n${UI_TEXT.browserCheckConfirmDetail}`,
    })
  })

  it('opens nothing on Reject or when the modal is closed', async () => {
    const rejected = await ask('http://localhost/', undefined, 1)
    const closed = await ask('http://localhost/', undefined, undefined)
    expect(rejected.isAllowed).toBe(false)
    expect(closed.isAllowed).toBe(false)
  })
})
