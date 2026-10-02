// The extension's own question before Muse Code's browser check (M81,
// PLAN.md D49): a modal naming the URL, saying so when the host is beyond
// loopback, and allowing the one check only for Allow once.
import { window } from 'vscode'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { isBrowserCheckAllowed } from '../../src/host/browser/browserCheckConfirm'
import { UI_TEXT } from '../../src/shared/constants'

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
      detail: `intranet is not this computer. Allowing lets this one check reach it.\n\n${UI_TEXT.browserCheckConfirmDetail}`,
    })
  })

  it('opens nothing on Reject or when the modal is closed', async () => {
    const rejected = await ask('http://localhost/', undefined, 1)
    const closed = await ask('http://localhost/', undefined, undefined)
    expect(rejected.isAllowed).toBe(false)
    expect(closed.isAllowed).toBe(false)
  })
})
