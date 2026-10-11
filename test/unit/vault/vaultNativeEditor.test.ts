import { describe, expect, it, vi, beforeEach } from 'vitest'
import { randomBytes } from 'node:crypto'
import { window, commands, env } from 'vscode'
import { editVaultItem, type VaultNativeInput } from '../../../src/host/vault/vaultNativeEditor'
import { createVaultPanelHost } from '../../../src/host/vault/vaultPanelEntry'
import {
  VAULT_COMMANDS,
  VAULT_LOCK_KEYBINDING,
  registerVaultCommands,
} from '../../../src/host/vault/vaultPanelBundle'
import { UI_TEXT } from '../../../src/shared/constants'
import { EN } from '../../../src/shared/l10n/en'
import { metadata, panel } from '../helpers/vault/fixtures'
import { FakeStatusBarItem } from '../mocks/vscode'
import { type VaultPanelService } from '../../../src/host/vault/vaultPanelHost'

function native(kind = 'secret'): VaultNativeInput {
  const value = randomBytes(32).toString('base64')
  return {
    input: vi.fn<VaultNativeInput['input']>((options) => {
      if (options.password) return Promise.resolve(value)
      if (options.prompt.startsWith(UI_TEXT.vault.name + ':')) return Promise.resolve('entered')
      if (options.prompt.startsWith(UI_TEXT.vault.label + ':'))
        return Promise.resolve('Entered item')
      if (options.prompt === UI_TEXT.vault.target) return Promise.resolve('[]')
      if (options.prompt === UI_TEXT.vault.origin) return Promise.resolve('https://origin.test')
      if (options.prompt === 'issuer') return Promise.resolve('https://issuer.test/path/')
      if (options.prompt === UI_TEXT.vault.resource)
        return Promise.resolve('https://origin.test/resource')
      return options.prompt === UI_TEXT.vault.expires
        ? Promise.resolve('2030-01-01T00:00:00Z')
        : Promise.resolve(undefined)
    }),
    pick: vi.fn<VaultNativeInput['pick']>((options) =>
      Promise.resolve(options.some((option) => option.id === kind) ? kind : options[0]?.id),
    ),
    sshKey: vi.fn<VaultNativeInput['sshKey']>(() =>
      Promise.resolve({
        material: {
          kind: 'sshKey',
          storage: 'software',
          privateKey: randomBytes(32),
          algorithm: 'ed25519',
        },
        publicKey: 'ssh-ed25519 public',
        fingerprint: 'SHA256:' + 'A'.repeat(43),
      }),
    ),
    now: () => 1000,
  }
}

describe('U native credential entry', () => {
  it.each(['secret', 'password', 'apiKey', 'webLogin', 'totp', 'oauth', 'session', 'sshKey'])(
    'adds %s with private bytes; all sensitive inputs are password boxes',
    async (kind) => {
      const n = native(kind)
      const result = await editVaultItem(n)
      expect(result).not.toBeNull()
      if (result !== null && 'material' in result) {
        expect(result.material.kind).toBe(kind)
        for (const entry of Object.values(result.material))
          if (entry instanceof Uint8Array) {
            expect(entry.byteLength).toBeGreaterThan(0)
            expect(entry.some((byte) => byte !== 0)).toBe(true)
            entry.fill(0)
          }
      }
      const calls = vi.mocked(n.input).mock.calls.map(([options]) => options)
      const privateCalls = calls.filter((options) =>
        [
          UI_TEXT.vault.value,
          UI_TEXT.vault.password,
          UI_TEXT.vault.username,
          UI_TEXT.vault.seed,
          UI_TEXT.vault.session,
        ].includes(options.prompt),
      )
      for (const options of privateCalls) {
        expect(options.password).toBe(true)
        expect(options).not.toHaveProperty('value')
      }
    },
  )
  it('V7 cancellation after acquiring SSH bytes erases them before returning', async () => {
    const n = native('sshKey')
    const cancellation = new AbortController()
    const key = randomBytes(32)
    vi.mocked(n.sshKey).mockImplementationOnce(() => {
      cancellation.abort()
      return Promise.resolve({
        material: { kind: 'sshKey', storage: 'software', privateKey: key, algorithm: 'ed25519' },
        publicKey: 'public',
        fingerprint: 'SHA256:' + 'A'.repeat(43),
      })
    })
    expect(await editVaultItem(n, undefined, cancellation.signal)).toBeNull()
    expect(key.every((byte) => byte === 0)).toBe(true)
  })
  it('edits metadata without opening or reading an existing credential', async () => {
    const n = native()
    const result = await editVaultItem(n, metadata())
    expect(result).not.toHaveProperty('material')
    expect(vi.mocked(n.input).mock.calls.every(([options]) => !options.password)).toBe(true)
  })
  it('V12 first-party edits remain hidden, Never, undisclosable and attended', async () => {
    const n = native()
    const current = {
      ...metadata(),
      firstParty: true,
      hidden: true,
      policy: { mode: 'never' as const, allowDisclosure: false, unattendedAllowed: false },
    }
    const result = await editVaultItem(n, current)
    expect(result).toMatchObject({
      firstParty: true,
      hidden: true,
      policy: { mode: 'never', unattendedAllowed: false, allowDisclosure: false },
    })
  })
  it.each(['never', 'alwaysAllow', 'askOncePerSession'] as const)(
    'RVM109U-3 accepting every default preserves the existing %s policy',
    async (mode) => {
      const n = native()
      const current = {
        ...metadata(),
        policy: { mode, allowDisclosure: false, unattendedAllowed: false },
      }
      const result = await editVaultItem(n, current)
      expect(result).toMatchObject({ policy: { mode } })
    },
  )
  it('cancel at any prompt returns no item and erases acquired buffers', async () => {
    const n = native('sshKey')
    vi.mocked(n.sshKey).mockResolvedValueOnce(null)
    expect(await editVaultItem(n)).toBeNull()
    vi.mocked(n.input).mockResolvedValueOnce(undefined)
    expect(await editVaultItem(n)).toBeNull()
    vi.mocked(n.pick).mockResolvedValueOnce(undefined)
    expect(await editVaultItem(n)).toBeNull()
  })
  it('V7 native validation failure erases transferred SSH bytes and reports fixed words only', async () => {
    const n = native('sshKey')
    const key = randomBytes(32)
    vi.mocked(n.sshKey).mockResolvedValueOnce({
      material: { kind: 'sshKey', storage: 'software', privateKey: key, algorithm: 'ed25519' },
      publicKey: 'public',
      fingerprint: 'invalid',
    })
    await expect(editVaultItem(n)).rejects.toThrow(UI_TEXT.vault.operationFailed)
    expect(key.every((byte) => byte === 0)).toBe(true)
  })
  it('invalid targets and names fail before any secret entry', async () => {
    const n = native()
    vi.mocked(n.input).mockResolvedValueOnce('BAD')
    await expect(editVaultItem(n)).rejects.toThrow(UI_TEXT.vault.operationFailed)
    expect(vi.mocked(n.input).mock.calls.every(([options]) => !options.password)).toBe(true)
  })
})

beforeEach(() => {
  vi.mocked(commands.registerCommand).mockClear()
  vi.mocked(commands.registerCommand).mockReturnValue({ dispose: vi.fn() })
  vi.mocked(window.createStatusBarItem).mockReset()
})
it('U commands and status: opening is explicit; Lock is always available and status follows unlock', async () => {
  const state = panel()
  const status = new FakeStatusBarItem()
  vi.spyOn(status, 'show')
  vi.spyOn(status, 'hide')
  vi.spyOn(status, 'dispose')
  vi.mocked(window.createStatusBarItem).mockReturnValue(status)
  const service: VaultPanelService = {
    snapshot: vi.fn(() => Promise.resolve(state)),
    subscribe: vi.fn(() => vi.fn()),
    unlock: vi.fn(() => Promise.resolve()),
    lock: vi.fn(() => {
      state.status.state = 'locked'
      return Promise.resolve()
    }),
    write: vi.fn(() => Promise.resolve()),
    updateMetadata: vi.fn(() => Promise.resolve()),
    remove: vi.fn(() => Promise.resolve()),
    grant: vi.fn(() => Promise.resolve()),
    revoke: vi.fn(() => Promise.resolve()),
    answer: vi.fn(() => Promise.resolve()),
    importFile: vi.fn(() => Promise.resolve()),
  }
  const deps = {
    service,
    now: () => 1000,
    publish: vi.fn(),
    openPanel: vi.fn(() => Promise.resolve()),
    sshKey: native().sshKey,
  }
  const entry = createVaultPanelHost(deps, EN, 'en')
  const loaded = vi.fn(() => entry)
  const registration = registerVaultCommands(
    (id, callback) => commands.registerCommand(id, callback),
    loaded,
  )
  expect(loaded).not.toHaveBeenCalled()
  expect(service.snapshot).not.toHaveBeenCalled()
  expect(service.unlock).not.toHaveBeenCalled()
  expect(status.show).not.toHaveBeenCalled()
  expect(VAULT_LOCK_KEYBINDING).toEqual({
    command: 'museSpark.lockVault',
    key: 'ctrl+alt+shift+l',
    mac: 'cmd+alt+shift+l',
  })
  const callback = vi
    .mocked(commands.registerCommand)
    .mock.calls.find(([id]) => id === VAULT_COMMANDS.open)?.[1]
  if (callback === undefined) throw new Error('missing open command')
  await callback()
  expect(deps.openPanel).toHaveBeenCalledOnce()
  expect(status.command).toBe(VAULT_COMMANDS.lock)
  expect(status.show).toHaveBeenCalledOnce()
  await entry.host.lock()
  expect(status.hide).toHaveBeenCalled()
  registration.dispose()
  expect(status.dispose).toHaveBeenCalledOnce()
  expect(env.clipboard.writeText).not.toHaveBeenCalled()
})
