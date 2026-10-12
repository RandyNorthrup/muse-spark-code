import { describe, expect, it, vi } from 'vitest'
import { randomBytes } from 'node:crypto'
import { UI_TEXT } from '../../../src/shared/constants'
import {
  VaultManageSession,
  type VaultBrokerConnection,
} from '../../../src/core/vault/broker/manageClient'
import { decodeVaultMaterial, encodeVaultMaterial } from '../../../src/core/vault/crypto'
import {
  createRuntimeVault,
  openHeadlessVault,
  vaultCommandPort,
} from '../../../src/runtime/vault/vaultRuntimeEntry'
import { type ExecVaultContext } from '../../../src/runtime/vault/execVault'
import { AcpVault } from '../../../src/acp/vault'
import { metadata, panel } from '../helpers/vault/fixtures'

type Sent = Parameters<VaultBrokerConnection['send']>[0]
type Answer = Awaited<ReturnType<VaultBrokerConnection['send']>>

/** A generated connection: each send answers from the script; nothing touches a broker. */
function connection(answer: (request: Sent) => Answer) {
  const sent: Sent[] = []
  const client: VaultBrokerConnection = {
    send: vi.fn((request: Sent) => {
      sent.push(structuredClone(request))
      return Promise.resolve(answer(request))
    }),
    close: vi.fn(),
    watch: vi.fn(() => Promise.resolve()),
    closed: vi.fn(() => Promise.resolve()),
  }
  return { client, sent }
}

function context(onDenied = vi.fn()): ExecVaultContext {
  return {
    cwd: '/workspace',
    sessionId: 'session-1',
    signal: new AbortController().signal,
    source: 'headless',
    unattended: true,
    onDenied,
  }
}

describe('C-M109-1 manage session', () => {
  it('sends values only in a private add frame and closes each connection', async () => {
    const { client, sent } = connection(() => ({ kind: 'ok' }))
    const session = new VaultManageSession(() => Promise.resolve(client), encodeVaultMaterial)
    const value = randomBytes(24)
    await session.write({ metadata: metadata(), material: { kind: 'secret', value } }, false)
    const [frame] = sent
    if (frame?.kind !== 'add') throw new Error('expected a private add frame')
    const decoded = decodeVaultMaterial(Buffer.from(frame.material, 'base64'))
    expect(decoded.kind === 'secret' && Buffer.from(decoded.value).equals(value)).toBe(true)
    expect(client.close).toHaveBeenCalledOnce()
  })
  it('turns each fixed refusal into its message and a denial into no access', async () => {
    const refused = connection(() => ({ kind: 'refused', reason: 'uncreated' }))
    await expect(
      new VaultManageSession(() => Promise.resolve(refused.client)).remove('a'.repeat(32)),
    ).rejects.toThrow(UI_TEXT.vault.setupNeeded)
    const denied = connection(() => ({ kind: 'denied', reason: 'peer' }))
    await expect(
      new VaultManageSession(() => Promise.resolve(denied.client)).snapshot(),
    ).rejects.toThrow(UI_TEXT.vault.noAccess)
  })
  it('returns the setup code as owned bytes from the private frame', async () => {
    const code = randomBytes(20).toString('hex')
    const { client } = connection(() => ({
      v: 2,
      kind: 'recoveryCode',
      setupId: 'b'.repeat(32),
      code,
    }))
    const shown = await new VaultManageSession(() => Promise.resolve(client)).setup()
    expect(shown.setupId).toBe('b'.repeat(32))
    expect(shown.code.toString('ascii')).toBe(code)
  })
})

describe('C-M109-1 dist/vaultRuntime.js', () => {
  it('refuses with the broker-blocked reason until a platform lane binds the connection', async () => {
    await expect(
      createRuntimeVault({
        uiText: UI_TEXT,
        locale: 'en',
        dataDir: '/data',
        distDir: '/dist',
        processId: 1,
        acp: new AcpVault(() => Promise.reject(new Error('unused'))),
      }),
    ).rejects.toThrow(UI_TEXT.vault.brokerBlocked)
  })
  it('lists every item for the CLI from the value-free snapshot', async () => {
    const state = panel()
    const { client } = connection(() => ({
      kind: 'snapshot',
      snapshot: {
        status: state.status,
        setupId: null,
        items: [metadata()],
        grants: [],
        pending: [],
        pendingReceipts: [],
      },
    }))
    const port = vaultCommandPort(new VaultManageSession(() => Promise.resolve(client)))
    expect(await port.list()).toEqual([metadata()])
  })
  it('registers one headless requester and fails closed with its reason', async () => {
    const onDenied = vi.fn()
    const { client, sent } = connection((request) =>
      'kind' in request && request.kind === 'registerRequester'
        ? { kind: 'ok' }
        : { kind: 'denied', reason: 'unattended' },
    )
    const session = await openHeadlessVault(
      () => Promise.resolve(client),
      context(onDenied),
      'c'.repeat(32),
      4242,
    )
    const [registration] = sent
    if (registration?.kind !== 'registerRequester') throw new Error('expected registration')
    expect(registration.requester).toMatchObject({
      source: 'headless',
      unattended: true,
      role: { kind: 'headless' },
      peerProcessId: 4242,
    })
    await session.close()
    expect(client.close).toHaveBeenCalledOnce()
  })
  it('closes the connection when the broker refuses the registration', async () => {
    const { client } = connection(() => ({ kind: 'denied', reason: 'peer' }))
    await expect(
      openHeadlessVault(() => Promise.resolve(client), context(), 'c'.repeat(32), 1),
    ).rejects.toThrow(UI_TEXT.vault.noAccess)
    expect(client.close).toHaveBeenCalledOnce()
  })
})
