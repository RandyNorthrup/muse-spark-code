// @vitest-environment jsdom
import { readFileSync } from 'node:fs'
import path from 'node:path'
import axe from 'axe-core'
import { fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { PaidBadge } from '../../src/webview/components/PaidBadge'
import { JudgeUsageRows } from '../../src/webview/components/PaidUsageSection'
import { UsageDialogContent } from '../../src/webview/components/UsageDialogContent'
import { JudgeSection } from '../../src/webview/models/sections/judge/JudgeSection'
import { ModelsPanel } from '../../src/webview/models/panel'
import { INITIAL_PANEL_UI } from '../../src/webview/models/reducer'
import { UI_TEXT } from '../../src/shared/constants'
import { EN } from '../../src/shared/l10n/en'
import { fill, setUiText } from '../../src/shared/l10n/text'
import { paidFeaturePrice } from '../../src/shared/paid'
import { projectJudgePanel, type JudgePanelSnapshot } from '../../src/shared/judgePanel'
import { judgePanelMoney, judgePanelStatusText } from '../../src/shared/judgePanelText'
import dark from '../harness/themes/dark.json'
import light from '../harness/themes/light.json'
import hcDark from '../harness/themes/hc-dark.json'
import hcLight from '../harness/themes/hc-light.json'
import { makeState } from './modelsPanelFixtures'
import { emptySubscriptionUsageDialog } from './helpers/usageDialog'
import { modelApiFacts, subscriptionFacts } from './judgePanelFixtures'

const modelsCss = readFileSync(path.join(process.cwd(), 'src/webview/models/models.css'), 'utf8')

const themes = [
  ['dark', dark],
  ['light', light],
  ['hc-dark', hcDark],
  ['hc-light', hcLight],
] as const

afterEach(() => {
  setUiText(EN, 'en')
  document.documentElement.removeAttribute('style')
  document.body.className = ''
})

function sectionProps(snapshot: JudgePanelSnapshot, post = vi.fn()) {
  return {
    panelState: makeState({ judge: snapshot }),
    post,
    navigate: () => undefined,
    dispatch: () => undefined,
    wizardOpen: false,
    importOpen: false,
    highlightedItem: undefined,
  }
}

function applyTheme(theme: {
  readonly bodyClass: string
  readonly variables: Readonly<Record<string, string>>
}): void {
  document.body.className = theme.bodyClass
  for (const [name, value] of Object.entries(theme.variables)) {
    document.documentElement.style.setProperty(name, value)
  }
}

describe('judge panel view', () => {
  it('shows the subscription note and no paid question', () => {
    const snapshot = projectJudgePanel(subscriptionFacts())
    render(
      <main>
        <h1>{UI_TEXT.modelsPanelTitle}</h1>
        <JudgeSection {...sectionProps(snapshot)} />
      </main>,
    )
    expect(screen.getByRole('status')).toHaveTextContent(judgePanelStatusText(snapshot))
    expect(screen.getByText(UI_TEXT.judgeSubscriptionNotice)).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: UI_TEXT.judgePanel.askOnce })).toBeNull()
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(screen.queryByRole('alertdialog')).toBeNull()
    expect(screen.queryByText(UI_TEXT.judgePanel.notKnown)).toBeNull()
    expect(screen.getByText(UI_TEXT.judgePanel.model)).toBeInTheDocument()
    expect(screen.getByText('openai/gpt-test')).toBeInTheDocument()
    const button = document.querySelector('.judge-panel button')
    expect(button).toBeNull()
  })

  it('asks from the keyboard only when a first charge is due', () => {
    const snapshot = projectJudgePanel(modelApiFacts({ reservedUsd: 0.000012 }))
    const post = vi.fn()
    const dispatch = vi.fn()
    render(
      <ModelsPanel
        panelState={makeState({ judge: snapshot })}
        ui={{ ...INITIAL_PANEL_UI, section: 'judge' }}
        post={post}
        dispatch={dispatch}
      />,
    )
    const ask = screen.getByRole('button', { name: UI_TEXT.judgePanel.askOnce })
    expect(ask).toHaveAttribute('type', 'button')
    expect(ask.tabIndex).toBeGreaterThanOrEqual(0)
    ask.focus()
    expect(document.activeElement).toBe(ask)
    // A native button turns Enter and Space into click. jsdom does not.
    fireEvent.click(ask)
    expect(post).toHaveBeenCalledWith({ type: 'judge/askConsent' })
    expect(screen.getByRole('status')).toHaveTextContent(judgePanelStatusText(snapshot))
    expect(screen.getByText(judgePanelMoney(0.000012))).toBeInTheDocument()
    expect(screen.getAllByText(UI_TEXT.judgePanel.notKnown).length).toBeGreaterThan(0)
    expect(screen.queryByRole('dialog')).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: UI_TEXT.providersSectionTitle }))
    expect(dispatch).toHaveBeenCalledWith({ type: 'navigate', section: 'providers' })
  })

  it('reads the installed language at render and wraps the nav at 320px', () => {
    setUiText(
      {
        ...EN,
        judgeStatusSubscription: 'Suscripción de prueba',
        judgeSubscriptionNotice: 'Nota de suscripción de prueba',
        judgePanel: { ...EN.judgePanel, source: 'Origen de prueba' },
      },
      'es',
    )
    const style = document.createElement('style')
    style.textContent = modelsCss
    document.head.append(style)
    const snapshot = projectJudgePanel(subscriptionFacts())
    render(
      <div style={{ width: '320px' }}>
        <ModelsPanel
          panelState={makeState({ judge: snapshot })}
          ui={{ ...INITIAL_PANEL_UI, section: 'judge' }}
          post={vi.fn()}
          dispatch={vi.fn()}
        />
      </div>,
    )
    expect(screen.getByRole('status')).toHaveTextContent('Suscripción de prueba')
    expect(screen.getByText('Origen de prueba')).toBeInTheDocument()
    expect(screen.getByText('Nota de suscripción de prueba')).toBeInTheDocument()
    const nav = document.querySelector('.models-nav')
    if (nav === null) {
      throw new Error('missing nav')
    }
    expect(navRule()).toContain('flex-wrap: wrap')
    expect(getComputedStyle(nav).flexWrap).toBe('wrap')
    expect(nav.querySelectorAll('button')).toHaveLength(3)
    style.remove()
  })

  it('has no axe violations in the four captured themes', async () => {
    const snapshot = projectJudgePanel(subscriptionFacts())
    document.title = 'Muse Spark Code'
    document.documentElement.lang = 'en'
    for (const [name, theme] of themes) {
      applyTheme(theme)
      const view = render(
        <main>
          <h1>{UI_TEXT.modelsPanelTitle}</h1>
          <JudgeSection {...sectionProps(snapshot)} />
        </main>,
      )
      const result = await axe.run(document, {
        rules: { 'color-contrast': { enabled: false } },
      })
      expect(result.violations, name).toEqual([])
      expect(document.body.className).toBe(theme.bodyClass)
      view.unmount()
    }
  })

  it('names Judge without another provider rate list, and uses an exact price when given', () => {
    const { unmount } = render(<PaidBadge feature="judge" />)
    expect(screen.getByText(UI_TEXT.paidJudgeName)).toHaveAttribute(
      'title',
      UI_TEXT.judgeStatusPaid,
    )
    unmount()
    const price = judgePanelMoney(1.25)
    render(<PaidBadge feature="judge" price={price} />)
    expect(screen.getByText(UI_TEXT.paidJudgeName)).toHaveAttribute(
      'title',
      fill(UI_TEXT.paidRowTitle, { price }),
    )
    render(<PaidBadge feature="webSearch" />)
    expect(screen.getByText(UI_TEXT.paidRowBadge)).toHaveAttribute(
      'title',
      fill(UI_TEXT.paidRowTitle, { price: paidFeaturePrice('webSearch') }),
    )
  })

  it('puts the same rows in Account & usage, including a subscription with no paid features', async () => {
    const subscription = projectJudgePanel(subscriptionFacts())
    render(<JudgeUsageRows snapshot={subscription} />)
    expect(screen.getByText(UI_TEXT.judgeSubscriptionNotice)).toBeInTheDocument()
    expect(screen.queryByText(UI_TEXT.judgePanel.notKnown)).toBeNull()
    const paid = projectJudgePanel(modelApiFacts())
    render(<JudgeUsageRows snapshot={paid} />)
    expect(screen.getAllByText(UI_TEXT.judgePanel.notKnown).length).toBeGreaterThan(0)
    render(<UsageDialogContent {...emptySubscriptionUsageDialog()} judgeUsage={subscription} />)
    expect(await screen.findByRole('heading', { name: UI_TEXT.paidJudgeName })).toBeInTheDocument()
    expect(screen.getAllByText(UI_TEXT.judgeSubscriptionNotice).length).toBeGreaterThan(0)
    expect(screen.queryByRole('button', { name: UI_TEXT.judgePanel.askOnce })).toBeNull()
  })

  it('keeps the experimental warning in Account & usage beside another status', () => {
    for (const reason of ['consent-needed', 'engine-failure'] as const) {
      const snapshot = projectJudgePanel(
        modelApiFacts({
          engine: 'separate',
          effectiveSource: 'separate',
          experimental: true,
          reason,
        }),
      )
      expect(snapshot.untested).toBe(true)
      const { unmount } = render(<JudgeUsageRows snapshot={snapshot} />)
      expect(screen.getByText(UI_TEXT.judgeSourceUntested)).toBeInTheDocument()
      expect(screen.getByText(judgePanelStatusText(snapshot))).toBeInTheDocument()
      unmount()
    }
  })

  it('renders usage facts as direct definition terms at 320px', () => {
    const snapshot = projectJudgePanel(modelApiFacts())
    const { container, unmount } = render(
      <div style={{ width: '320px' }}>
        <JudgeUsageRows snapshot={snapshot} />
      </div>,
    )
    const facts = container.querySelector('dl.usage-facts')
    if (facts === null) {
      throw new Error('missing usage facts')
    }
    expect(facts.querySelector(':scope > div')).toBeNull()
    const terms = facts.querySelectorAll(':scope > dt')
    expect(terms.length).toBeGreaterThan(0)
    expect(facts.querySelectorAll(':scope > dd')).toHaveLength(terms.length)
    unmount()
  })

  it('shows the judge usage dialog in four themes at 320px', async () => {
    const snapshot = projectJudgePanel(
      modelApiFacts({ engine: 'separate', effectiveSource: 'separate', experimental: true }),
    )
    expect(snapshot.untested).toBe(true)
    document.title = 'Muse Spark Code'
    document.documentElement.lang = 'en'
    for (const [name, theme] of themes) {
      applyTheme(theme)
      const { container, unmount } = render(
        <div style={{ width: '320px' }}>
          <UsageDialogContent {...emptySubscriptionUsageDialog()} judgeUsage={snapshot} />
        </div>,
      )
      expect(
        await screen.findByRole('heading', { name: UI_TEXT.paidJudgeName }),
      ).toBeInTheDocument()
      expect(screen.getByText(UI_TEXT.judgeSourceUntested)).toBeInTheDocument()
      expect(screen.getByText(judgePanelStatusText(snapshot))).toBeInTheDocument()
      const facts = container.querySelector(':scope .judge-usage dl.usage-facts')
      if (facts === null) {
        throw new Error(`missing usage facts (${name})`)
      }
      expect(facts.querySelector(':scope > div')).toBeNull()
      const result = await axe.run(container, {
        rules: { 'color-contrast': { enabled: false } },
      })
      expect(result.violations, name).toEqual([])
      unmount()
    }
  })
})

function navRule(): string {
  const start = modelsCss.indexOf('.models-nav {')
  const end = modelsCss.indexOf('.models-nav-item {')
  return modelsCss.slice(start, end).replaceAll('\\', '/')
}
