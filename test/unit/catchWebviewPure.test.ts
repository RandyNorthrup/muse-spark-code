/** @vitest-environment jsdom */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { parseScheduleSettlement } from '../../src/webview/schedules/settlement'
import { windowResourceLoader } from '../../src/webview/resources/windowPort'
import { installUsageTable } from '../../src/webview/usage/installUsageTable'
import { createUiStore } from '../../src/webview/state/store'
import { initialUiState } from '../../src/webview/state/uiState'
import { USAGE_EN } from '../../src/shared/l10n/usageEn'

afterEach(() => {
  vi.unstubAllGlobals()
})

function hostileJson(boom: unknown): void {
  vi.stubGlobal('JSON', {
    ...JSON,
    parse: () => {
      throw boom
    },
  })
}

describe('CATCHAUDIT named-condition catches', () => {
  it('settles nothing for unparseable output, and lets a foreign failure through', () => {
    expect(parseScheduleSettlement('not json')).toEqual({ ok: false })
    const boom: unknown = 'settle-boom'
    hostileJson(boom)
    try {
      expect(() => parseScheduleSettlement('{}')).toThrow('settle-boom')
    } finally {
      vi.unstubAllGlobals()
    }
  })

  it('reads unreadable resource text as null, and lets a foreign failure through', () => {
    const store = createUiStore({ ...initialUiState, sessionId: 's1' })
    const loader = windowResourceLoader(store, () => {
      /* No listener in this test. */
    })
    store.dispatch({
      type: 'hostMessage',
      message: { type: 'resourceStatus', status: 'not json' },
      at: 0,
    })
    expect(loader.port.getSnapshot()).toBeNull()
    const boom: unknown = 'window-boom'
    hostileJson(boom)
    try {
      store.dispatch({
        type: 'hostMessage',
        message: { type: 'resourceStatus', status: '{}' },
        at: 1,
      })
      expect(() => loader.port.getSnapshot()).toThrow('window-boom')
    } finally {
      vi.unstubAllGlobals()
    }
  })

  it('names an invalid locale, and lets a foreign failure through', () => {
    expect(installUsageTable({ locale: 'not a tag!', table: USAGE_EN })).toBe('invalidLocale')
    const realIntl = Intl
    const boom: unknown = 'usage-intl-boom'
    vi.stubGlobal('Intl', {
      getCanonicalLocales: () => {
        throw boom
      },
    })
    try {
      expect(() => installUsageTable({ locale: 'en', table: USAGE_EN })).toThrow('usage-intl-boom')
    } finally {
      vi.stubGlobal('Intl', realIntl)
    }
  })
})
