// @vitest-environment jsdom
// RVCM1091D P2 (state table): the vault section names the vault's real state.
// Every typed state has its own true heading and sentence; nothing tells a
// person to unlock a vault that does not exist or is lost, and no cached slot
// claims protection for a vault that cannot be opened.
import { render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import {
  VaultSection,
  tierWarning,
  vaultStateHeading,
} from '../../../src/webview/models/sections/vault/VaultSection'
import { UI_TEXT } from '../../../src/shared/constants'
import { type VaultStatus } from '../../../src/shared/vaultStatus'
import { metadata, panel } from '../helpers/vault/fixtures'

function status(overrides: Partial<VaultStatus>): VaultStatus {
  return { ...panel().status, ...overrides }
}

interface StateSentence {
  readonly state: VaultStatus['state']
  readonly tier: VaultStatus['tier']
  readonly reason: VaultStatus['reason']
  readonly sentence: string
}

interface StateCase extends StateSentence {
  readonly heading: string
}

describe('RVCM1091D vault state table', () => {
  it('gives every typed state its own true heading', () => {
    const states: VaultStatus['state'][] = [
      'unlocked',
      'locked',
      'uncreated',
      'setupPending',
      'unavailable',
      'firstPartyOnly',
    ]
    const headings: Readonly<Record<VaultStatus['state'], string>> = {
      unlocked: UI_TEXT.vault.unlocked,
      locked: UI_TEXT.vault.locked,
      uncreated: UI_TEXT.vault.stateUncreated,
      setupPending: UI_TEXT.vault.stateSetupPending,
      unavailable: UI_TEXT.vault.stateUnavailable,
      firstPartyOnly: UI_TEXT.vault.firstParty,
    }
    for (const state of states) {
      expect(vaultStateHeading(status({ state }))).toBe(headings[state])
    }
  })

  it('gives every typed state its own true sentence, never an unlock for other states', () => {
    const sentences: StateSentence[] = [
      { state: 'unlocked', tier: 'osStore', reason: null, sentence: UI_TEXT.vault.osStoreWarning },
      { state: 'locked', tier: null, reason: 'locked', sentence: UI_TEXT.vault.unknownTierWarning },
      { state: 'uncreated', tier: null, reason: 'locked', sentence: UI_TEXT.vault.setupNeeded },
      { state: 'setupPending', tier: null, reason: null, sentence: UI_TEXT.vault.setupPending },
      {
        state: 'unavailable',
        tier: null,
        reason: 'vaultLost',
        sentence: UI_TEXT.vault.vaultLost,
      },
      {
        state: 'firstPartyOnly',
        tier: null,
        reason: 'brokerBlocked',
        sentence: UI_TEXT.vault.brokerBlocked,
      },
    ]
    for (const entry of sentences) {
      expect(
        tierWarning(status({ state: entry.state, tier: entry.tier, reason: entry.reason })),
      ).toBe(entry.sentence)
    }
  })

  it('a cached slot never claims protection for a vault that cannot be opened', () => {
    for (const entry of [
      { state: 'uncreated', reason: 'locked', sentence: UI_TEXT.vault.setupNeeded },
      { state: 'setupPending', reason: null, sentence: UI_TEXT.vault.setupPending },
      { state: 'unavailable', reason: 'vaultLost', sentence: UI_TEXT.vault.vaultLost },
    ] as const) {
      expect(tierWarning(status({ ...entry, tier: 'osStore', provider: 'loginKeychain' }))).toBe(
        entry.sentence,
      )
    }
  })

  it('a vault that cannot be opened shows no protection in its detail rows', () => {
    for (const entry of [
      { state: 'uncreated', reason: 'locked' },
      { state: 'setupPending', reason: null },
      { state: 'unavailable', reason: 'vaultLost' },
    ] as const) {
      // The true post-fix shape: the snapshot carries no slot (RVCM1091E P3).
      const state = panel()
      state.status = status({ ...entry, tier: null, provider: null, silentUnlock: false })
      const { container, unmount } = render(<VaultSection state={state} post={vi.fn()} />)
      // The tier card div: the retry live region is a separate persistent
      // paragraph with the same role (RVAPP-CM1091D5 P3-4).
      const card = container.querySelector('div[role="status"]')
      const cells = [...(card?.querySelectorAll('dd') ?? [])].map((cell) => cell.textContent)
      expect(cells[0]).toBe('—')
      expect(cells[1]).toBe('—')
      expect(cells[2]).toBe(UI_TEXT.toggleOff)
      unmount()
    }
  })

  it('an unreachable broker is not a lost vault', () => {
    expect(tierWarning(status({ state: 'unavailable', tier: null, reason: 'brokerBlocked' }))).toBe(
      UI_TEXT.vault.brokerBlocked,
    )
    expect(tierWarning(status({ state: 'unavailable', tier: null, reason: 'vaultLost' }))).toBe(
      UI_TEXT.vault.vaultLost,
    )
    expect(UI_TEXT.vault.brokerBlocked.toLowerCase()).not.toContain('reset')
  })

  it('an open vault with no observed slot names no protection and no unlock', () => {
    expect(tierWarning(status({ state: 'unlocked', tier: null, reason: null }))).toBe(
      UI_TEXT.vault.tierUnknown,
    )
    expect(UI_TEXT.vault.tierUnknown.toLowerCase()).not.toContain('unlock')
  })

  it('renders the true heading and sentence per state, with no unlock talk for other states', () => {
    const cases: StateCase[] = [
      {
        state: 'uncreated',
        reason: 'locked',
        tier: null,
        heading: UI_TEXT.vault.stateUncreated,
        sentence: UI_TEXT.vault.setupNeeded,
      },
      {
        state: 'setupPending',
        reason: null,
        tier: null,
        heading: UI_TEXT.vault.stateSetupPending,
        sentence: UI_TEXT.vault.setupPending,
      },
      {
        state: 'locked',
        reason: 'locked',
        tier: null,
        heading: UI_TEXT.vault.locked,
        sentence: UI_TEXT.vault.unknownTierWarning,
      },
      {
        state: 'unlocked',
        reason: null,
        tier: 'osStore',
        heading: UI_TEXT.vault.unlocked,
        sentence: UI_TEXT.vault.osStoreWarning,
      },
      {
        state: 'unavailable',
        reason: 'vaultLost',
        tier: null,
        heading: UI_TEXT.vault.stateUnavailable,
        sentence: UI_TEXT.vault.vaultLost,
      },
      {
        state: 'firstPartyOnly',
        reason: 'brokerBlocked',
        tier: 'osStore',
        heading: UI_TEXT.vault.firstParty,
        sentence: UI_TEXT.vault.brokerBlocked,
      },
    ]
    for (const entry of cases) {
      const state = panel()
      state.status = status({ state: entry.state, tier: entry.tier, reason: entry.reason })
      const { container, unmount } = render(<VaultSection state={state} post={vi.fn()} />)
      expect(screen.getByRole('heading', { level: 2 })).toHaveTextContent(entry.heading)
      // The tier card's sentence paragraph carries the one true sentence; the
      // card's detail rows (like Silent Unlock) and the action buttons below
      // keep their fixed names. The card div is selected explicitly: the
      // retry live region shares the role (RVAPP-CM1091D5 P3-4).
      const card = container.querySelector('div[role="status"]')
      const sentence = card?.querySelector('p')?.textContent ?? ''
      expect(sentence).toContain(entry.sentence)
      if (entry.state !== 'locked' && entry.state !== 'unlocked') {
        expect(sentence.toLowerCase()).not.toContain('unlock')
      }
      unmount()
    }
  })

  it('the lost vault offers Reset, not an enabled unlock', () => {
    const state = panel()
    state.status = status({ state: 'unavailable', reason: 'vaultLost' })
    render(<VaultSection state={state} post={vi.fn()} />)
    expect(screen.getByRole('button', { name: UI_TEXT.vault.unlock })).toBeDisabled()
    expect(screen.getByRole('button', { name: UI_TEXT.vault.resetVault })).toBeEnabled()
  })

  it('RVCM1091F transient reasons name themselves, never the repair message', () => {
    const sentences: StateSentence[] = [
      { state: 'unavailable', tier: null, reason: 'busy', sentence: UI_TEXT.vault.busy },
      {
        state: 'unavailable',
        tier: null,
        reason: 'timeout',
        sentence: UI_TEXT.vault.operationFailed,
      },
      {
        state: 'unavailable',
        tier: null,
        reason: 'watchLost',
        sentence: UI_TEXT.vault.operationFailed,
      },
      {
        state: 'unavailable',
        tier: null,
        reason: 'unreachable',
        sentence: UI_TEXT.vault.operationFailed,
      },
      {
        state: 'unavailable',
        tier: null,
        reason: 'storeUnavailable',
        sentence: UI_TEXT.vault.storeUnavailable,
      },
    ]
    for (const entry of sentences) {
      const sentence = tierWarning(
        status({ state: entry.state, tier: entry.tier, reason: entry.reason }),
      )
      expect(sentence).toBe(entry.sentence)
      expect(sentence).not.toBe(UI_TEXT.vault.brokerBlocked)
    }
  })

  it('RVCM1091F a transient outage offers Retry, a repair or restore does not', () => {
    for (const reason of ['busy', 'timeout', 'watchLost', 'unreachable'] as const) {
      const state = panel()
      state.status = status({ state: 'unavailable', tier: null, reason })
      const post = vi.fn()
      const { unmount } = render(<VaultSection state={state} post={post} />)
      const retry = screen.getByRole('button', { name: UI_TEXT.vault.retry })
      expect(retry).toBeEnabled()
      retry.click()
      expect(post).toHaveBeenCalledWith({ type: 'vaultRetry' })
      unmount()
    }
    for (const reason of ['brokerBlocked', 'rollback', 'vaultLost'] as const) {
      const state = panel()
      state.status = status({ state: 'unavailable', tier: null, reason })
      const { unmount } = render(<VaultSection state={state} post={vi.fn()} />)
      expect(screen.queryByRole('button', { name: UI_TEXT.vault.retry })).toBeNull()
      unmount()
    }
  })
})

describe('RVCM1091G retrying views and keyboard focus', () => {
  it('a kept view with a retry scheduled says it is retrying with aria-busy', () => {
    const retrying = panel()
    retrying.retrying = true
    const { unmount } = render(<VaultSection state={retrying} post={vi.fn()} />)
    const notice = screen.getByText(UI_TEXT.vault.retrying)
    expect(notice.getAttribute('role')).toBe('status')
    const section = screen.getByLabelText(UI_TEXT.vault.title, { selector: 'section' })
    expect(section.getAttribute('aria-busy')).toBe('true')
    unmount()
    const fresh = panel()
    const settled = render(<VaultSection state={fresh} post={vi.fn()} />)
    expect(screen.queryByText(UI_TEXT.vault.retrying)).toBeNull()
    settled.unmount()
  })

  it('a successful Retry hands focus to the Lock control, never the body', () => {
    const failed = panel()
    failed.status = status({ state: 'unavailable', tier: null, reason: 'busy' })
    failed.items = []
    failed.grants = []
    const { rerender, unmount } = render(<VaultSection state={failed} post={vi.fn()} />)
    const retry = screen.getByRole('button', { name: UI_TEXT.vault.retry })
    retry.focus()
    expect(document.activeElement).toBe(retry)
    // The authoritative unlocked frame removes the focused button.
    rerender(<VaultSection state={panel()} post={vi.fn()} />)
    const focused = document.activeElement
    expect(focused).not.toBe(document.body)
    expect(focused?.textContent).toBe(UI_TEXT.vault.lock)
    unmount()
  })

  it('focus falls back to the heading when no control can act', () => {
    const failed = panel()
    failed.status = status({ state: 'unavailable', tier: null, reason: 'busy' })
    const { rerender, unmount } = render(<VaultSection state={failed} post={vi.fn()} />)
    screen.getByRole('button', { name: UI_TEXT.vault.retry }).focus()
    // First-party-only offers no enabled control at all.
    const stuck = panel()
    stuck.status = status({ state: 'firstPartyOnly', tier: 'osStore', reason: 'brokerBlocked' })
    rerender(<VaultSection state={stuck} post={vi.fn()} />)
    const focused = document.activeElement
    expect(focused).not.toBe(document.body)
    expect(focused?.tagName).toBe('H2')
    unmount()
  })

  it('losing focus to nowhere while the control lives never pulls focus back in', () => {
    // RVAPP-CM1091D5 P3-3: clicking a non-focusable spot fires focusout with
    // a null target while the control is still in the page. The next render
    // must leave focus where the person put it. Fails without the fix: focus
    // jumps to the first vault action.
    const state = panel()
    const { rerender, unmount } = render(<VaultSection state={state} post={vi.fn()} />)
    const lock = screen.getByRole('button', { name: UI_TEXT.vault.lock })
    lock.focus()
    expect(document.activeElement).toBe(lock)
    // The person clicks a non-focusable spot: focus falls to the body while
    // the button lives on.
    lock.blur()
    expect(document.activeElement).toBe(document.body)
    rerender(<VaultSection state={panel()} post={vi.fn()} />)
    expect(document.activeElement).toBe(document.body)
    unmount()
  })

  it('the retry announcement lives in the page before its text changes', () => {
    // RVAPP-CM1091D5 P3-4: screen readers announce changes inside an
    // existing live region, not text mounted with it. Fails without the fix:
    // no live region exists until retrying starts.
    const { container, rerender, unmount } = render(<VaultSection state={panel()} post={vi.fn()} />)
    const regions = [...container.querySelectorAll('p[role="status"]')]
    expect(regions).toHaveLength(1)
    const live = regions[0]
    expect(live?.textContent).toBe('')
    const retrying = panel()
    retrying.retrying = true
    rerender(<VaultSection state={retrying} post={vi.fn()} />)
    expect(container.querySelector('p[role="status"]')).toBe(live)
    expect(live?.textContent).toBe(UI_TEXT.vault.retrying)
    unmount()
  })
})

describe('RVAPP-CM1091D5 P2-2 kept receipts finish from the section', () => {
  const RECEIPT = 'a1b2c3d4-e5f6-7890-abcd-ef1234567890'
  function listed() {
    const state = panel()
    state.pendingReceipts = [{ receipt: RECEIPT, path: '/home/user/.netrc', items: [metadata()] }]
    return state
  }
  it('a listed receipt offers Keep and Delete, posting its own messages', () => {
    const post = vi.fn()
    const { unmount } = render(<VaultSection state={listed()} post={post} />)
    screen.getByText(UI_TEXT.vault.pendingImports)
    screen.getByText(UI_TEXT.vault.importKeepOrDelete)
    screen.getByRole('button', { name: UI_TEXT.vault.keepFile }).click()
    expect(post).toHaveBeenLastCalledWith({ type: 'vaultKeepReceipt', receipt: RECEIPT })
    screen.getByRole('button', { name: UI_TEXT.vault.deleteFile }).click()
    expect(post).toHaveBeenLastCalledWith({ type: 'vaultDeleteReceipt', receipt: RECEIPT })
    unmount()
  })
  it('no unfinished import means no heading and no receipt buttons', () => {
    const { unmount } = render(<VaultSection state={panel()} post={vi.fn()} />)
    expect(screen.queryByText(UI_TEXT.vault.pendingImports)).toBeNull()
    expect(screen.queryByRole('button', { name: UI_TEXT.vault.keepFile })).toBeNull()
    expect(screen.queryByRole('button', { name: UI_TEXT.vault.deleteFile })).toBeNull()
    unmount()
  })
})
