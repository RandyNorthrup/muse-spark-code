// The Models & Agents panel's vault mount (C-M109-1 P1): the section stays
// hidden behind the vault binding gate, and with the gate forced on the
// panel routes the vault's own messages to the binding and publishes its
// states to the webview. The production gate stays off until lanes (b) and
// (c) bind the broker; these tests force it on with a fake binding.

import { beforeEach, describe, expect, it, vi } from 'vitest'
import { window as fakeWindow } from './mocks/vscode'
import { type ModelsVaultBinding, type ModelsVaultFactory } from '../../src/host/models/modelsPanel'
import { parseHostToPanelMessage } from '../../src/shared/modelsPanel'
import {
  vaultHostMessageSchema,
  type VaultHostMessage,
} from '../../src/shared/hostApi/vaultMessages'
import { FakeWebviewPanel } from './helpers/fakes'
import {
  latestPanelState as latestState,
  sendPanelMessage as send,
  setupModelsPanel as setup,
} from './helpers/modelsPanelHarness'

function vaultPosts(panel: FakeWebviewPanel): unknown[] {
  return vi
    .mocked(panel.webview.postMessage)
    .mock.calls.map((call) => call[0])
    .filter((message) => vaultHostMessageSchema.safeParse(message).success)
}

function navigations(panel: FakeWebviewPanel): string[] {
  return vi
    .mocked(panel.webview.postMessage)
    .mock.calls.map((call) => call[0])
    .flatMap((message) => {
      const parsed = parseHostToPanelMessage(message)
      return parsed.ok && parsed.message.type === 'modelsPanel/navigate'
        ? [parsed.message.section]
        : []
    })
}

function fakeVault(): {
  factory: ModelsVaultFactory
  handled: unknown[]
  isDisposed: () => boolean
} {
  const handled: unknown[] = []
  let isDisposed = false
  const binding: ModelsVaultBinding = {
    handle: (raw) => {
      handled.push(raw)
      return Promise.resolve()
    },
    refresh: () => Promise.resolve(),
    dispose: () => {
      isDisposed = true
    },
  }
  return {
    factory: () => binding,
    handled,
    isDisposed: () => isDisposed,
  }
}

beforeEach(() => {
  fakeWindow.createWebviewPanel.mockReset()
  fakeWindow.createWebviewPanel.mockImplementation(
    (viewType, title) => new FakeWebviewPanel(viewType, title),
  )
})

describe('Vault mount gate', () => {
  it('stays hidden without the binding: no offer, vault messages dropped', async () => {
    const { panel, warnings } = setup()
    await send(panel, { type: 'modelsPanel/ready' }, () => {
      expect(latestState(panel).providers).toEqual([])
    })
    expect(latestState(panel).vaultOffered).not.toBe(true)
    expect(vaultPosts(panel)).toEqual([])
    await send(panel, { type: 'vaultReady' }, () => {
      expect(warnings).toContain('Dropped malformed models panel message')
    })
    expect(vaultPosts(panel)).toEqual([])
  })

  it('a factory that throws leaves the panel without the section', async () => {
    const { panel, warnings } = setup({
      vault: () => {
        throw new Error('broker blocked')
      },
    })
    await send(panel, { type: 'modelsPanel/ready' }, () => {
      expect(latestState(panel).providers).toEqual([])
    })
    expect(warnings).toContain('Vault section unavailable')
    expect(latestState(panel).vaultOffered).not.toBe(true)
  })

  it('with the gate forced on, offers the vault and routes its messages', async () => {
    const vault = fakeVault()
    const { panel } = setup({ vault: vault.factory })
    await send(panel, { type: 'modelsPanel/ready' }, () => {
      expect(latestState(panel).vaultOffered).toBe(true)
    })
    await send(panel, { type: 'vaultReady' }, () => {
      expect(vault.handled).toEqual([{ type: 'vaultReady' }])
    })
    // A malformed vault message is not a vault message: it falls through
    // to the panel parser, which drops it, and never reaches the binding.
    panel.webview.messages.fire({ type: 'vaultEdit' })
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(vault.handled).toEqual([{ type: 'vaultReady' }])
  })

  it('the binding publisher validates before posting: garbage never reaches the webview', async () => {
    let publish: ((message: VaultHostMessage) => void) | undefined
    const { panel } = setup({
      vault: (publishVault) => {
        publish = publishVault
        const binding: ModelsVaultBinding = {
          handle: () => Promise.resolve(),
          refresh: () => Promise.resolve(),
          dispose: () => undefined,
        }
        return binding
      },
    })
    await send(panel, { type: 'modelsPanel/ready' }, () => {
      expect(latestState(panel).vaultOffered).toBe(true)
    })
    expect(typeof publish).toBe('function')
    // Decoded-but-untrusted bytes, as a compromised bundle could send.
    publish?.('not a vault state' as unknown as VaultHostMessage)
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(vaultPosts(panel)).toEqual([])
  })

  it('deep-links to the vault section only while offered', async () => {
    const vault = fakeVault()
    const offered = setup({ vault: vault.factory })
    await send(offered.panel, { type: 'modelsPanel/ready' }, () => {
      expect(latestState(offered.panel).vaultOffered).toBe(true)
    })
    offered.created.reveal({ section: 'vault' })
    expect(navigations(offered.panel).at(-1)).toBe('vault')

    const hidden = setup()
    await send(hidden.panel, { type: 'modelsPanel/ready' }, () => {
      expect(latestState(hidden.panel).providers).toEqual([])
    })
    hidden.created.reveal({ section: 'vault' })
    expect(navigations(hidden.panel).at(-1)).toBe('providers')
  })

  it('disposes the binding with the panel', async () => {
    const vault = fakeVault()
    const { panel, created } = setup({ vault: vault.factory })
    await send(panel, { type: 'modelsPanel/ready' }, () => {
      expect(latestState(panel).vaultOffered).toBe(true)
    })
    expect(vault.isDisposed()).toBe(false)
    created.dispose()
    expect(vault.isDisposed()).toBe(true)
  })
})
