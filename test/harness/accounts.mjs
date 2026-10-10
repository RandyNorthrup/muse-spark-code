// Test-only host. Production imports the same lazy entry through M95/M104.
import { createElement, lazy, Suspense, useState } from 'react'
import { createRoot } from 'react-dom/client'
import { panelQuestion, panelSlice } from '../unit/helpers/accounts/panel'
import { UI_TEXT } from '../../src/shared/l10n/text'
import { installEmbeddedTable } from '../../src/webview/installTable'
import '../../src/webview/styles.css'

async function accountsModule() {
  const english = await import('../../src/shared/l10n/deferredEnglish')
  await english.loadDeferredEnglish()
  return await import('../../src/webview/models/sections/accounts/accountsEntry')
}

const Section = lazy(async () => {
  const module = await accountsModule()
  return { default: module.AccountsSection }
})
const Dialog = lazy(async () => {
  const module = await accountsModule()
  return { default: module.AccountsConfirmationDialog }
})
const Chip = lazy(async () => {
  const module = await accountsModule()
  return { default: module.AccountChip }
})
const Notices = lazy(async () => {
  const module = await accountsModule()
  return { default: module.AccountNotices }
})
// The Node accessibility test uses this entry without mounting a document.
export const accountsHarnessEntry = 'test/harness/accounts.mjs'

async function mountAccountsHarness() {
  const params = new globalThis.URLSearchParams(globalThis.location.search)
  const lang = params.get('lang')
  if (lang !== null) {
    const response = await fetch(`../../l10n/ui.${lang}.json`)
    const element = globalThis.document.createElement('script')
    element.id = 'muse-l10n'
    element.type = 'application/json'
    element.textContent = JSON.stringify({ locale: lang, table: await response.json() })
    globalThis.document.head.append(element)
    const error = installEmbeddedTable(globalThis.document)
    if (error !== undefined) throw error
    globalThis.document.documentElement.lang = lang
  }
  const themeResponse = await fetch(`themes/${params.get('theme') ?? 'dark'}.json`)
  const theme = await themeResponse.json()
  for (const [name, value] of Object.entries(theme.variables)) {
    globalThis.document.documentElement.style.setProperty(name, value)
  }
  globalThis.document.body.className = theme.bodyClass

  function openLink(url) {
    globalThis.document.body.dataset.link = url
  }

  function AccountsHarness() {
    const [slice, setSlice] = useState(() =>
      panelSlice({
        confirmation: 'confirm',
        planWindows: ['five-hour', 'weekly'],
        hasRateHeadroom: true,
      }),
    )
    const [hasQuestion, setQuestion] = useState(true)
    const scene = params.get('scene') ?? 'section'
    if (scene === 'dialog' && hasQuestion)
      return createElement(Dialog, {
        provider: slice.provider,
        providerLabel: slice.providerLabel,
        value: panelQuestion(slice.policy),
        onChoose: () => {
          setQuestion(false)
          return Promise.resolve()
        },
        onOpenLink: openLink,
      })
    const request = (message) => {
      const next = { ...slice }
      switch (message.type) {
        case 'accounts/use': {
          next.currentAccount = message.account
          break
        }
        case 'accounts/revoke': {
          next.confirmation = null
          break
        }
        case 'accounts/thresholds': {
          {
            next.accounts = next.accounts.map((row) =>
              row.id === message.account ? { ...row, thresholds: message.thresholds } : row,
            )
            // No default
          }
          break
        }
      }
      return Promise.resolve(next)
    }
    const trigger = {
      kind: 'userCap',
      metric: 'spendUsd',
      period: 'day',
      value: 20,
      threshold: 20,
      resetAt: '2026-10-07T00:00:00Z',
    }
    if (scene === 'swap')
      return createElement(
        'div',
        null,
        createElement(Chip, {
          value: { ...slice, currentAccount: 'personal' },
          isPending: false,
          onUse: (message) => {
            void request(message).then(setSlice)
          },
        }),
        createElement(Notices, {
          value: slice,
          onOpenLink: openLink,
          events: [
            {
              type: 'swap',
              provider: 'openai',
              account: 'personal',
              previousAccount: 'work',
              time: '2026-10-06T00:00:00Z',
              trigger,
              coldCacheUsd: 0.000000001,
            },
            {
              type: 'stop',
              provider: 'openai',
              account: 'personal',
              time: '2026-10-06T00:00:00Z',
              trigger,
            },
          ].map((event) => ({ event, resetAt: event.type === 'stop' ? trigger.resetAt : null })),
        }),
      )
    return createElement(Section, { value: slice, port: { request, accept: setSlice, openLink } })
  }

  createRoot(globalThis.document.querySelector('#root')).render(
    createElement(
      Suspense,
      { fallback: createElement('p', null, UI_TEXT.usageLoading) },
      createElement(AccountsHarness),
    ),
  )
}

if (globalThis.document !== undefined) await mountAccountsHarness()
