// @vitest-environment jsdom
// RVCM1141B: the browser certification waited on the header title/subtitle,
// which UsageApp renders while state is undefined. The data-usage-ready
// marker below is set only after the view renders real host state, so a
// permanently pending journal read never looks settled.
import { act, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { UsageApp } from '../../src/webview/usage/UsageApp'
import { USAGE_EN } from '../../src/shared/l10n/usageEn'
import { setUsageText } from '../../src/shared/l10n/usageTable'
import { EN } from '../../src/shared/l10n/en'
import { setUiText } from '../../src/shared/l10n/text'
import { usageStateFor } from './helpers/usageFixtures'
import type { HostBridge } from '../../src/webview/hostBridge'

const NOW = new Date(2026, 9, 5, 12).getTime()

function setup() {
  const messages = new EventTarget()
  const host: HostBridge = {
    post: vi.fn(),
    savedState: () => undefined,
    saveState: vi.fn(),
    messages,
  }
  render(<UsageApp host={host} now={() => NOW} />)
  const send = (data: unknown) => {
    act(() => {
      messages.dispatchEvent(new MessageEvent('message', { data }))
    })
  }
  return { host, send }
}

function marker() {
  return document.querySelector('main.usage-page[data-usage-ready="true"]')
}

afterEach(() => {
  setUsageText(USAGE_EN)
  setUiText(EN, 'en')
})

describe('usage readiness marker', () => {
  it('stays absent while the journal read is pending, although the header shell renders', () => {
    setup()
    // The old browser wait (title + subtitle) passes on this shell.
    expect(screen.getByRole('heading', { name: USAGE_EN.title, level: 1 })).toBeInTheDocument()
    expect(screen.getByText(USAGE_EN.subtitle)).toBeInTheDocument()
    expect(screen.getByText(USAGE_EN.loading)).toBeInTheDocument()
    expect(marker()).toBeNull()
  })

  it('appears only after host state renders, with the settled values', () => {
    const { send } = setup()
    send({ type: 'usage/state', state: usageStateFor('empty', NOW) })
    expect(marker()).not.toBeNull()
    expect(marker()?.getAttribute('aria-busy')).toBe('false')
    expect(screen.getByText('History is stored on win11 · remote workspace.')).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: USAGE_EN.emptyTitle })).toBeInTheDocument()
    expect(screen.queryByText(USAGE_EN.loading)).toBeNull()
  })

  it('stays absent when the read settles on an error', () => {
    const { send } = setup()
    send({ type: 'usage/error', code: 'readFailed' })
    // aria-busy settles here too, so it alone cannot prove a rendered view.
    expect(document.querySelector('main.usage-page')?.getAttribute('aria-busy')).toBe('false')
    expect(screen.getByRole('alert')).toBeInTheDocument()
    expect(marker()).toBeNull()
  })
})
