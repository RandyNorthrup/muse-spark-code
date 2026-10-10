// The Models & Agents panel's vault binding (C-M109-1 P1): the same
// broker-backed host the window uses, over an injected service, publishing
// into the panel and driving the lock status item.

import { beforeEach, describe, expect, it, vi } from 'vitest'
import { window as fakeWindow, FakeStatusBarItem } from '../mocks/vscode'
import { createModelsVaultBinding } from '../../../src/host/vault/vaultPanelEntry'
import type { VaultPanelService } from '../../../src/host/vault/vaultPanelHost'
import {
  vaultHostMessageSchema,
  type VaultHostMessage,
} from '../../../src/shared/hostApi/vaultMessages'
import { EN } from '../../../src/shared/l10n/en'
import { panel } from '../helpers/vault/fixtures'

function serviceFixture(): {
  service: VaultPanelService
  unsubscribe: ReturnType<typeof vi.fn>
} {
  const state = panel()
  const unsubscribe = vi.fn(() => undefined)
  const service: VaultPanelService = {
    snapshot: () => Promise.resolve(structuredClone(state)),
    subscribe: () => unsubscribe,
    unlock: (authorize) => {
      authorize()
      return Promise.resolve()
    },
    lock: () => {
      state.status.state = 'locked'
      state.status.lockEpoch += 1
      state.pending = []
      return Promise.resolve()
    },
    write: (_item, authorize) => {
      authorize()
      return Promise.resolve()
    },
    updateMetadata: (_item, authorize) => {
      authorize()
      return Promise.resolve()
    },
    remove: (_id, authorize) => {
      authorize()
      return Promise.resolve()
    },
    grant: (_grant, authorize) => {
      authorize()
      return Promise.resolve()
    },
    revoke: () => Promise.resolve(),
    answer: () => Promise.resolve(),
    importFile: (_path, authorize) => {
      authorize()
      return Promise.resolve()
    },
    setup: () => Promise.reject(new Error('unused')),
    confirmSetup: () => Promise.resolve(),
    cancelSetup: () => Promise.resolve(),
  }
  return { service, unsubscribe }
}

beforeEach(() => {
  fakeWindow.createStatusBarItem.mockReset()
  fakeWindow.createStatusBarItem.mockImplementation(() => new FakeStatusBarItem())
})

function setupBinding(): {
  binding: ReturnType<typeof createModelsVaultBinding>
  published: VaultHostMessage[]
  unsubscribe: ReturnType<typeof vi.fn>
} {
  const published: VaultHostMessage[] = []
  const { service, unsubscribe } = serviceFixture()
  const binding = createModelsVaultBinding(
    {
      distDir: '/dist',
      now: () => 1000,
      sshKey: () => Promise.resolve(null),
      publish: (message) => {
        published.push(message)
      },
      service,
    },
    EN,
    'en',
  )
  return { binding, published, unsubscribe }
}

function publishedStates(published: VaultHostMessage[]): VaultHostMessage['state'][] {
  return published.flatMap((message) => {
    const parsed = vaultHostMessageSchema.safeParse(message)
    return parsed.success ? [parsed.data.state] : []
  })
}

function statusItem(): FakeStatusBarItem {
  const item = fakeWindow.createStatusBarItem.mock.results[0]?.value
  if (!(item instanceof FakeStatusBarItem)) {
    throw new TypeError('Expected status item')
  }
  return item
}

describe('createModelsVaultBinding', () => {
  it('publishes the snapshot on vaultReady and shows the unlocked status', async () => {
    const { binding, published } = setupBinding()
    await binding.handle({ type: 'vaultReady' })
    const states = publishedStates(published)
    expect(states.length).toBeGreaterThan(0)
    expect(states.at(-1)?.status.state).toBe('unlocked')
    expect(states.at(-1)?.items.map((item) => item.label)).toEqual(['Generated test item'])
    expect(statusItem().visible).toBe(true)
    binding.dispose()
  })

  it('locks through the service and hides the status item', async () => {
    const { binding, published } = setupBinding()
    await binding.handle({ type: 'vaultReady' })
    await binding.handle({ type: 'vaultLock' })
    expect(publishedStates(published).at(-1)?.status.state).toBe('locked')
    expect(statusItem().visible).toBe(false)
    binding.dispose()
  })

  it('dispose unsubscribes and drops late publishes', async () => {
    const { binding, published, unsubscribe } = setupBinding()
    binding.dispose()
    expect(unsubscribe).toHaveBeenCalledOnce()
    const count = published.length
    await binding.handle({ type: 'vaultReady' })
    expect(published.length).toBe(count)
  })
})
