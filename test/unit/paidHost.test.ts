import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createPaidFeatures, isSubagentTaskConfirmed } from '../../src/host/paid/paidHost'
import {
  GLOBAL_STATE_KEYS,
  SUBAGENT_PRICE_ACCEPTANCE_VERSION,
  UI_TEXT,
} from '../../src/shared/constants'
import { FakeLogOutputChannel } from './helpers/fakes'
import { confirmModal } from './helpers/vscodeViews'
import { window } from './mocks/vscode'

const TASK = {
  role: 'reviewer',
  objective: 'Review local changes',
  modelId: 'muse-spark-1.3',
  attemptLimit: 4,
}

beforeEach(() => {
  window.state.focused = true
  vi.mocked(confirmModal).mockReset()
})

describe('M48 paid child task confirmation', () => {
  it('shows the selected model, actual rates, objective and retry-inclusive cap before approval', async () => {
    vi.mocked(confirmModal).mockResolvedValue(UI_TEXT.allowOnce)
    await expect(isSubagentTaskConfirmed(TASK)).resolves.toBe(true)
    const detail = vi.mocked(confirmModal).mock.calls[0]?.[1].detail
    expect(detail).toContain('Review local changes')
    expect(detail).toContain('muse-spark-1.3')
    expect(detail).toContain('$1.250')
    expect(detail).toContain('$0.150')
    expect(detail).toContain('$4.250')
    expect(detail).toContain('4 requests per task, including retries')
  })

  it('refuses an unfocused window and a model without verified rates before showing a modal', async () => {
    window.state.focused = false
    await expect(isSubagentTaskConfirmed(TASK)).resolves.toBe(false)
    window.state.focused = true
    await expect(isSubagentTaskConfirmed({ ...TASK, modelId: 'muse-spark-future' })).resolves.toBe(
      false,
    )
    expect(confirmModal).not.toHaveBeenCalled()
  })

  it('keeps a declined or unfocused answer refused', async () => {
    vi.mocked(confirmModal).mockResolvedValue(undefined)
    await expect(isSubagentTaskConfirmed(TASK)).resolves.toBe(false)
    vi.mocked(confirmModal).mockImplementation(() => {
      window.state.focused = false
      return Promise.resolve(UI_TEXT.allowOnce)
    })
    await expect(isSubagentTaskConfirmed(TASK)).resolves.toBe(false)
  })

  it('requires the current price revision in addition to the setting and accepted feature', () => {
    const data = new Map<string, unknown>([[GLOBAL_STATE_KEYS.paidConfirmations, ['subagents']]])
    const paid = createPaidFeatures({
      globalState: {
        get: (key) => data.get(key),
        update: (key, value) => {
          data.set(key, value)
          return Promise.resolve()
        },
      },
      isSettingOn: (feature) => feature === 'subagents',
      isKeyStored: () => true,
      log: new FakeLogOutputChannel(),
    })
    expect(paid.gate.isOn('subagents')).toBe(false)
    data.set(GLOBAL_STATE_KEYS.subagentPriceAcceptance, 'old-price')
    expect(paid.gate.isOn('subagents')).toBe(false)
    data.set(GLOBAL_STATE_KEYS.subagentPriceAcceptance, SUBAGENT_PRICE_ACCEPTANCE_VERSION)
    expect(paid.gate.isOn('subagents')).toBe(true)
  })
})
