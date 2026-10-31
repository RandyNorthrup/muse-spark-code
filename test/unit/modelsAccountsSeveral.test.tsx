// @vitest-environment jsdom
// D88 b2: the Accounts page's per-provider several-accounts switch runs the
// real panel handler, the real confirmations owner (decision 6's record and
// grant) and the real section: accept flips the switch, deny leaves it off
// with no write, and a provider without a policy row renders it disabled.
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { useState } from 'react'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { AccountConfirmations } from '../../src/core/accounts/confirmations'
import { AccountStore } from '../../src/core/providers/accounts'
import { accountPolicyFor } from '../../src/core/providers/accountPolicy'
import { AccountsPanelHandler } from '../../src/host/models/accountsHandler'
import { EN } from '../../src/shared/l10n/en'
import { BASE_LOCALE, setUiText, UI_TEXT } from '../../src/shared/l10n/text'
import type { ModelsAccountsSlice } from '../../src/shared/accountsPanel'
import { AccountsSection } from '../../src/webview/models/sections/accounts/AccountsSection'

beforeEach(() => {
  setUiText(EN, BASE_LOCALE)
})

afterEach(() => {
  cleanup()
})

function entry() {
  return {
    id: 'meta',
    policyProvider: 'meta',
    product: 'model-api',
    auth: 'apiKey' as const,
    origin: 'https://example.com/',
    accounts: [{ id: 'default', label: 'Default', order: 0, thresholds: {} }],
  }
}

type Entry = ReturnType<typeof entry>

function setup(answer: 'confirm' | 'cancel', override?: Entry) {
  let isSeveralOn = false
  const writes: boolean[] = []
  const stored = new Map<string, unknown>()
  const confirmations = new AccountConfirmations({
    machineId: 'test-machine',
    store: {
      read: (provider, product) => Promise.resolve(stored.get(`${provider} ${product}`)),
      write: (provider, product, value) => {
        stored.set(`${provider} ${product}`, value)
        return Promise.resolve()
      },
      remove: (provider, product) => {
        stored.delete(`${provider} ${product}`)
        return Promise.resolve()
      },
    },
    now: () => 0,
    ask: () => Promise.resolve(answer),
  })
  const live = override ?? entry()
  const handler = new AccountsPanelHandler({
    accounts: new AccountStore(
      { read: () => Promise.resolve(live), writeAccounts: () => Promise.resolve() },
      {
        read: () => Promise.resolve(undefined),
        readForRemoval: () => Promise.resolve(undefined),
        write: () => Promise.resolve(),
        remove: () => Promise.resolve(),
      },
    ),
    confirmations,
    provider: () => Promise.resolve(live),
    currentAccount: () => 'default',
    settings: () => ({ isSwapOn: false, isParallelOn: false, severalOnThisDevice: isSeveralOn }),
    capabilities: () => ({
      planWindows: [],
      hasRateHeadroom: false,
      usageUrl: null,
      label: 'Meta',
    }),
    credential: () => Promise.resolve(),
    use: () => Promise.resolve(),
    answer: () => false,
    confirmSeveral: async (provider) => {
      const row = accountPolicyFor(provider, live.product)
      if (row === undefined) return false
      const grant = await confirmations.obtain(row, true)
      return grant !== undefined && grant.choice !== 'cancel'
    },
    setSeveral: (enabled) => {
      writes.push(enabled)
      isSeveralOn = enabled
      return Promise.resolve()
    },
    now: () => 0,
  })
  return { handler, writes }
}

function Harness({
  handler,
  initial,
  opened,
}: {
  readonly handler: AccountsPanelHandler
  readonly initial: ModelsAccountsSlice
  readonly opened: string[]
}) {
  const [value, setValue] = useState<unknown>(initial)
  return (
    <AccountsSection
      value={value}
      port={{
        request: (message) => handler.handle(message),
        accept: (slice) => {
          setValue(slice)
        },
        openLink: (url) => {
          opened.push(url)
        },
      }}
    />
  )
}

function severalBox() {
  const box = screen.getByRole('checkbox', { name: /Allow Several Accounts/ })
  if (!(box instanceof HTMLInputElement)) throw new TypeError('several switch is not a checkbox')
  return box
}

describe('accounts several switch', () => {
  it('turns on through the vendor-terms confirmation', async () => {
    const { handler, writes } = setup('confirm')
    render(<Harness handler={handler} opened={[]} initial={await handler.snapshot('meta')} />)
    expect(severalBox().checked).toBe(false)
    fireEvent.click(severalBox())
    await waitFor(() => {
      expect(severalBox().checked).toBe(true)
    })
    expect(writes).toEqual([true])
    expect(screen.getByText(UI_TEXT.developer.allowMultiple, { exact: false })).toBeVisible()
  })

  it('stays off with no write when the confirmation denies', async () => {
    const { handler, writes } = setup('cancel')
    render(<Harness handler={handler} opened={[]} initial={await handler.snapshot('meta')} />)
    fireEvent.click(severalBox())
    await waitFor(() => {
      expect(writes).toEqual([])
    })
    expect(severalBox().checked).toBe(false)
    expect(screen.queryByRole('alert')).toBeNull()
  })

  it('renders disabled where the policy record never offers accounts', async () => {
    // Anthropic's Claude plan is never held (D74): the real policy row
    // refuses the switch instead of offering it.
    const { handler } = setup('confirm', {
      id: 'anthropic',
      policyProvider: 'anthropic',
      product: 'claude-plan',
      auth: 'apiKey' as const,
      origin: 'https://example.com/',
      accounts: [{ id: 'default', label: 'Default', order: 0, thresholds: {} }],
    })
    render(<Harness handler={handler} opened={[]} initial={await handler.snapshot('anthropic')} />)
    expect(severalBox()).toBeDisabled()
  })
})
