import { window } from 'vscode'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { isWebFetchAllowed } from '../../src/host/web/webFetchConfirm'
import { UI_TEXT } from '../../src/shared/constants'

afterEach(() => {
  vi.mocked(window.showWarningMessage).mockReset()
})

describe("the extension's own web fetch question (M69)", () => {
  it('names the host and the whole URL in a modal, and a closed modal refuses', async () => {
    vi.mocked(window.showWarningMessage).mockResolvedValueOnce(undefined)
    await expect(
      isWebFetchAllowed('https://docs.example.com/a?b=1', 'docs.example.com'),
    ).resolves.toBe(false)
    expect(window.showWarningMessage).toHaveBeenCalledWith(
      expect.stringContaining('docs.example.com'),
      expect.objectContaining({
        modal: true,
        detail: expect.stringContaining('https://docs.example.com/a?b=1'),
      }),
      { title: UI_TEXT.allowOnce },
      { title: UI_TEXT.reject, isCloseAffordance: true },
    )
  })

  it('allows the one fetch only for Allow once', async () => {
    vi.mocked(window.showWarningMessage).mockImplementationOnce((_message, _options, ...items) =>
      Promise.resolve(items[0]),
    )
    await expect(isWebFetchAllowed('https://docs.example.com/', 'docs.example.com')).resolves.toBe(
      true,
    )
    vi.mocked(window.showWarningMessage).mockImplementationOnce((_message, _options, ...items) =>
      Promise.resolve(items[1]),
    )
    await expect(isWebFetchAllowed('https://docs.example.com/', 'docs.example.com')).resolves.toBe(
      false,
    )
  })
})
