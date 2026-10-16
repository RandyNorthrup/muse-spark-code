// The Models & Agents panel's vault binding (C-M109-1 P1): the same
// broker-backed host the window uses, over an injected service, publishing
// into the panel and driving the lock status item.

import { beforeEach, describe, expect, it, vi } from 'vitest'
import { window as fakeWindow, FakeStatusBarItem } from '../mocks/vscode'
import { FakeLogOutputChannel } from '../helpers/fakes'
import * as vaultActions from '../../../src/host/vault/vaultActionsEntry'
import { createModelsVaultBinding } from '../../../src/host/vault/vaultPanelEntry'
import type { VaultPanelService } from '../../../src/host/vault/vaultPanelHost'
import type { VaultApprovalAnswer } from '../../../src/shared/vault'
import {
  vaultHostMessageSchema,
  type VaultHostMessage,
} from '../../../src/shared/hostApi/vaultMessages'
import { UI_TEXT } from '../../../src/shared/constants'
import { EN } from '../../../src/shared/l10n/en'
import { inertVaultSetup, metadata, panel } from '../helpers/vault/fixtures'

function serviceFixture(): {
  service: VaultPanelService
  unsubscribe: ReturnType<typeof vi.fn>
} {
  const state = panel()
  const unsubscribe = vi.fn(() => undefined)
  const service: VaultPanelService = {
    snapshot: vi.fn(() => Promise.resolve(structuredClone(state))),
    subscribe: () => unsubscribe,
    unlock: vi.fn((authorize: () => void) => {
      authorize()
      return Promise.resolve()
    }),
    lock: vi.fn(() => {
      state.status.state = 'locked'
      state.status.lockEpoch += 1
      state.pending = []
      return Promise.resolve()
    }),
    write: vi.fn((_item, authorize: () => void) => {
      authorize()
      return Promise.resolve()
    }),
    updateMetadata: vi.fn((_item, authorize: () => void) => {
      authorize()
      return Promise.resolve()
    }),
    remove: vi.fn((_id, authorize: () => void) => {
      authorize()
      return Promise.resolve()
    }),
    grant: vi.fn((_grant, authorize: () => void) => {
      authorize()
      return Promise.resolve()
    }),
    revoke: vi.fn((_grantId: string) => Promise.resolve()),
    answer: vi.fn((_answer: VaultApprovalAnswer, authorize: () => void) => {
      authorize()
      return Promise.resolve()
    }),
    importFile: vi.fn((_path: string, authorize: () => void) => {
      authorize()
      return Promise.resolve({ receipt: 'unused', items: [] })
    }),
    keepImport: vi.fn((_receipt: string) => Promise.resolve()),
    deleteImport: vi.fn((_receipt: string, authorize: () => void) => {
      authorize()
      return Promise.resolve()
    }),
    resetBegin: vi.fn(() => Promise.resolve({ resetId: 'reset', word: 'RESET' })),
    resetConfirm: vi.fn((_resetId: string, _word: string, authorize: () => void) => {
      authorize()
      return Promise.resolve()
    }),
    ...inertVaultSetup(),
  }
  return { service, unsubscribe }
}

beforeEach(() => {
  fakeWindow.createStatusBarItem.mockReset()
  fakeWindow.createStatusBarItem.mockImplementation(() => new FakeStatusBarItem())
  fakeWindow.showInformationMessage.mockReset()
  fakeWindow.showWarningMessage.mockReset()
  fakeWindow.showInputBox.mockReset()
  fakeWindow.showErrorMessage.mockReset()
})

function setupBinding(): {
  binding: ReturnType<typeof createModelsVaultBinding>
  published: VaultHostMessage[]
  service: VaultPanelService
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
      log: new FakeLogOutputChannel(),
      // The real actions module (the mocked vscode window answers its
      // dialogs); production requires it from dist on first use.
      loadActionsBundle: () => vaultActions,
    },
    EN,
    'en',
  )
  return { binding, published, service, unsubscribe }
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

/**
 * The pressed dialog item. The vscode mock keeps the overloaded dialog
 * type (whose last overload resolves MessageItem), while the host
 * compares the pressed title as a plain string, so the string crosses
 * as never (PLAN.md §8: CM1091DADOPT dialog-item cast).
 */
function pressedTitle(value: string): never {
  return value as never
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

  it('import asks Keep or Delete natively and keeps the source on Keep', async () => {
    const { binding, service } = setupBinding()
    const imported = { ...metadata(), id: 'a'.repeat(32), name: 'netrc login' }
    vi.mocked(service.snapshot).mockImplementation(() =>
      Promise.resolve({
        ...panel(),
        ambientFiles: [{ path: '/home/user/.netrc', kind: 'netrc' }],
      }),
    )
    vi.mocked(service.importFile).mockImplementation((_path, authorize) => {
      authorize()
      return Promise.resolve({ receipt: 'receipt', items: [imported] })
    })
    fakeWindow.showInformationMessage.mockResolvedValue(pressedTitle(UI_TEXT.vault.keepFile))
    await binding.handle({ type: 'vaultImport', path: '/home/user/.netrc' })
    expect(fakeWindow.showInformationMessage).toHaveBeenCalledOnce()
    expect(service.keepImport).toHaveBeenCalledWith('receipt')
    expect(service.deleteImport).not.toHaveBeenCalled()
    binding.dispose()
  })

  it('a failed Delete reloads so the section shows the imported items', async () => {
    const { binding, published, service } = setupBinding()
    const state = panel()
    state.ambientFiles = [{ path: '/home/user/.netrc', kind: 'netrc' }]
    vi.mocked(service.snapshot).mockImplementation(() => Promise.resolve(structuredClone(state)))
    const imported = {
      ...metadata(),
      id: 'a'.repeat(32),
      name: 'netrc-login',
      handle: 'secret://netrc-login',
    }
    vi.mocked(service.importFile).mockImplementation((_path, authorize) => {
      authorize()
      state.items.push(imported)
      return Promise.resolve({ receipt: 'receipt', items: [imported] })
    })
    fakeWindow.showInformationMessage.mockResolvedValue(pressedTitle(UI_TEXT.vault.deleteFile))
    vi.mocked(service.deleteImport).mockRejectedValueOnce(new Error('disk gone'))
    await binding.handle({ type: 'vaultImport', path: '/home/user/.netrc' })
    // The reload republishes with the imported item the failed Delete left behind.
    expect(
      publishedStates(published)
        .at(-1)
        ?.items.map((item) => item.id),
    ).toContain('a'.repeat(32))
    expect(fakeWindow.showErrorMessage).toHaveBeenCalledWith(UI_TEXT.vault.operationFailed)
    binding.dispose()
  })

  it('reset asks the typed word natively, only for the lost vault', async () => {
    const { binding, service } = setupBinding()
    const lost = panel()
    lost.status.state = 'unavailable'
    lost.status.reason = 'vaultLost'
    vi.mocked(service.snapshot).mockImplementation(() => Promise.resolve(structuredClone(lost)))
    fakeWindow.showWarningMessage.mockResolvedValue(pressedTitle(UI_TEXT.vault.resetContinue))
    fakeWindow.showInputBox.mockResolvedValue('RESET')
    await binding.handle({ type: 'vaultReset' })
    expect(service.resetConfirm).toHaveBeenCalledOnce()
    binding.dispose()

    const { binding: refused, service: refusedService } = setupBinding()
    vi.mocked(refusedService.snapshot).mockImplementation(() => Promise.resolve(panel()))
    await refused.handle({ type: 'vaultReset' })
    expect(refusedService.resetBegin).not.toHaveBeenCalled()
    expect(fakeWindow.showErrorMessage).toHaveBeenCalledWith(UI_TEXT.vault.useChanged)
    refused.dispose()
  })

  it('a typed refusal keeps its sentence; foreign text stays generic', async () => {
    const { binding, service } = setupBinding()
    vi.mocked(service.unlock).mockRejectedValueOnce(new Error(UI_TEXT.vault.storeUnavailable))
    await binding.handle({ type: 'vaultUnlock' })
    expect(fakeWindow.showErrorMessage).toHaveBeenCalledWith(UI_TEXT.vault.storeUnavailable)
    binding.dispose()

    const { binding: generic, service: genericService } = setupBinding()
    vi.mocked(genericService.unlock).mockRejectedValueOnce(new Error('EACCES: native blew up'))
    await generic.handle({ type: 'vaultUnlock' })
    expect(fakeWindow.showErrorMessage).toHaveBeenCalledWith(UI_TEXT.vault.operationFailed)
    generic.dispose()
  })
})
