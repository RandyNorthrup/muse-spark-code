import { describe, expect, it } from 'vitest'
import { UI_TEXT } from '../../../src/shared/constants'
import type { VaultRequester, VaultUse } from '../../../src/shared/vault'
import type { VaultBrokerPort } from '../../../src/shared/vaultProtocol'
import { HeadlessVaultSession } from '../../../src/runtime/vault/headlessSession'
import { VaultSurface, type VaultPanelPort } from '../../../src/runtime/vault/vaultSurface'

const SESSION_ID = 'session-1'
const HANDLE = 'secret://deploy-key'

function requester(): VaultRequester {
  return {
    id: 'a'.repeat(32),
    hostId: 'b'.repeat(32),
    conversationId: SESSION_ID,
    taskId: null,
    role: { kind: 'headless' },
    workspaceId: 'workspace-1',
    deviceId: null,
    peerProcessId: 4242,
    sessionId: null,
    unattended: true,
    source: 'headless',
  }
}

function sudoUse(): VaultUse {
  return {
    kind: 'sudo',
    command: { executable: '/usr/bin/apt', argv: [], cwd: '/' },
    sudoPath: '/usr/bin/sudo',
  }
}

function unreached(what: string): never {
  throw new Error(`${what} must not be reached`)
}

/** The broker is never consulted on these paths; a call would fail the test. */
function unreachedBroker(): VaultBrokerPort {
  return {
    clock: { now: () => unreached('broker') },
    status: () => unreached('broker'),
    list: () => unreached('broker'),
    request: () => unreached('broker'),
    answer: () => unreached('broker'),
    lock: () => unreached('broker'),
  }
}

function session(onDenied: (message: string) => void) {
  return new HeadlessVaultSession(
    requester(),
    unreachedBroker(),
    {
      cwd: '/',
      sessionId: SESSION_ID,
      signal: new AbortController().signal,
      source: 'headless',
      unattended: true,
      onDenied,
    },
    () => Promise.resolve(),
  )
}

/** The panel port is never consulted for an unparsable message. */
function unreachedPanel(): VaultPanelPort {
  return { dispatch: () => unreached('panel port'), terminal: () => unreached('panel port') }
}

// Fail-closed denials: every failure the headless session or the panel
// bridge cannot validate stops the use with fixed words, never raw text.
describe('vault fail-closed denials', () => {
  it('an unparsable use is denied as unattended with the fixed sentence', async () => {
    const denied: string[] = []
    const result = await session((message) => {
      denied.push(message)
    }).request(HANDLE, { kind: 'nope' } as unknown as VaultUse, {
      tainted: false,
      reasons: [],
    })
    expect(result).toEqual({ kind: 'denied', reason: 'unattended' })
    expect(denied).toEqual([UI_TEXT.vault.noAccess])
  })

  it('a tainted use is denied as tainted without consulting the broker', async () => {
    const denied: string[] = []
    const result = await session((message) => {
      denied.push(message)
    }).request(HANDLE, sudoUse(), {
      tainted: true,
      reasons: [{ source: 'web', label: 'pasted text' }],
    })
    expect(result).toEqual({ kind: 'denied', reason: 'tainted' })
    expect(denied).toHaveLength(1)
    expect(denied[0]).toContain('tainted')
  })

  it('an unparsable panel message is denied with the fixed sentence', async () => {
    const surface = new VaultSurface(unreachedPanel())
    let failure: unknown
    try {
      await surface.dispatch({ type: 'vaultNope' })
    } catch (error: unknown) {
      failure = error
    }
    expect(failure).toBeInstanceOf(Error)
    expect((failure as Error).message).toBe(UI_TEXT.vault.noAccess)
  })
})
