import { window } from 'vscode'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { askPaidUse } from '../../src/host/paid/paidHost'
import { UI_TEXT } from '../../src/shared/constants'
import { scheduledRunPrice } from '../../src/shared/paid'

afterEach(() => {
  vi.mocked(window.showWarningMessage).mockReset()
})

function scheduledRun(prompt: string, modelId: string) {
  return { feature: 'scheduledPrompts', prompt, modelId } as const
}

describe('scheduled run paid-use popup (M52, M58)', () => {
  it('names model, prompt and price, then refuses a closed popup', async () => {
    vi.mocked(window.showWarningMessage).mockResolvedValueOnce(undefined)
    await expect(
      askPaidUse(scheduledRun('Review private tests', 'muse-spark-1.3'), true),
    ).resolves.toBe('deny')
    expect(window.showWarningMessage).toHaveBeenCalledWith(
      expect.stringContaining('muse-spark-1.3'),
      expect.objectContaining({
        modal: true,
        detail: expect.stringContaining('Review private tests'),
      }),
      { title: UI_TEXT.allowOnce },
      { title: UI_TEXT.paidAllowAlways },
      { title: UI_TEXT.paidDeny, isCloseAffordance: true },
    )
    const options = vi.mocked(window.showWarningMessage).mock.calls[0]?.[1]
    expect(options).toMatchObject({
      detail: expect.stringContaining(scheduledRunPrice('muse-spark-1.3')),
    })
  })

  it('allows the run only for an allow answer', async () => {
    vi.mocked(window.showWarningMessage).mockImplementationOnce((_message, _options, ...items) =>
      Promise.resolve(items[0]),
    )
    await expect(askPaidUse(scheduledRun('Review tests', 'muse-spark-1.3'), true)).resolves.toBe(
      'once',
    )
  })

  it('quotes only the selected contributor model rates, including the cached rate', async () => {
    vi.mocked(window.showWarningMessage).mockResolvedValueOnce(undefined)
    await expect(
      askPaidUse(scheduledRun('Review tests', 'muse-spark-1.3-contributor'), true),
    ).resolves.toBe('deny')
    const detail = vi.mocked(window.showWarningMessage).mock.calls[0]?.[1]?.detail
    expect(detail).toContain('$0.100/1M input')
    expect(detail).toContain('$0.0020/1M cached input')
    expect(detail).toContain('$0.200/1M output')
    expect(detail).not.toContain('$1.250/1M input')
  })

  it('refuses a model without verified rates before any popup', async () => {
    await expect(
      askPaidUse(scheduledRun('Review tests', 'muse-spark-future'), true),
    ).rejects.toThrow(UI_TEXT.subagentTariffUnknown)
    expect(window.showWarningMessage).not.toHaveBeenCalled()
  })
})
