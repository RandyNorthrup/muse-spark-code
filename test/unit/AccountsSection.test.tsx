// @vitest-environment jsdom
import { render, screen, within } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import AccountsSection from '../../src/webview/usage/AccountsSection'
import { loadAccountsSection } from '../../src/webview/usage/accountsSectionLoader'
import {
  accountUsageEventText,
  accountUsageMeterText,
  accountUsageRowText,
} from '../../src/core/usage/usageText'
import { EN } from '../../src/shared/l10n/en'
import { setUiText } from '../../src/shared/l10n/text'
import { usageAccount, usageEvents, usageFixture } from './helpers/accounts/usage'

afterEach(() => {
  setUiText(EN, 'en')
})

describe('M108 J shared account section', () => {
  it('loads the real section through the usage page factory', async () => {
    const { default: Section } = await loadAccountsSection()
    render(<Section report={usageFixture().report()} />)
    expect(screen.getByRole('region', { name: 'Accounts' })).toBeVisible()
  })
  it('renders the same per-account facts and canonical event history as the text renderer', () => {
    const f = usageFixture()
    f.events.push(...usageEvents())
    const report = f.report()
    render(<AccountsSection report={report} />)
    expect(screen.getByRole('region', { name: 'Accounts' })).toBeVisible()
    for (const row of report.accounts) {
      const account = screen.getByRole('region', { name: `${row.providerLabel} · ${row.label}` })
      for (const line of accountUsageRowText(row))
        expect(within(account).getByText(line)).toBeVisible()
    }
    const events = within(screen.getByRole('region', { name: 'Account events' })).getAllByRole(
      'listitem',
    )
    expect(events).toHaveLength(3)
    for (const [index, event] of report.events.entries()) {
      expect(events[index]).toHaveTextContent(accountUsageEventText(event, report))
    }
  })

  it('gives every available meter an accessible name and exact text; unavailable meters have no misleading progress bar', () => {
    const f = usageFixture()
    f.catalog[0]!.accounts[0] = usageAccount('default', {
      spendUsd: { day: 0.3 },
      requests: { month: 10 },
      planWindowPercent: { 'five-hour': 80 },
    })
    const report = f.report()
    render(<AccountsSection report={report} />)
    const meters = report.accounts[0]!.meters
    for (const meter of meters) {
      const text = accountUsageMeterText(meter)
      if (meter.progress === null) {
        expect(screen.queryByRole('progressbar', { name: text.label })).toBeNull()
        expect(screen.getByText(`${text.label}: ${text.value}`)).toBeVisible()
      } else {
        const bar = screen.getByRole('progressbar', { name: text.label })
        expect(bar).toHaveAttribute('value', String(meter.progress))
        expect(bar).toHaveAttribute('max', '100')
        expect(bar).toHaveAttribute('aria-valuetext', text.value)
      }
    }
    expect(screen.getAllByRole('progressbar')).toHaveLength(2)
  })

  it('uses current translations, handles repeated mounts and renders labels and worker ids as text', () => {
    const f = usageFixture()
    f.catalog[0]!.accounts[0]!.label = '<img src=x onerror=alert(1)>'
    setUiText({ ...EN, accounts: { ...EN.accounts, title: 'Konten' } }, 'de')
    const report = f.report()
    const { container } = render(
      <>
        <AccountsSection report={report} />
        <AccountsSection report={report} />
      </>,
    )
    expect(screen.getAllByRole('region', { name: 'Konten' })).toHaveLength(2)
    expect(container.querySelector('img')).toBeNull()
    const labels = [...container.querySelectorAll('h2')].map((heading) => heading.id)
    expect(new Set(labels).size).toBe(2)
  })
})
