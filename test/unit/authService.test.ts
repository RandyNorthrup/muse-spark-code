import { describe, expect, it, vi } from 'vitest'
import { AuthService, type AuthServiceDeps } from '../../src/host/auth/authService'
import { CredentialStore } from '../../src/host/auth/credentialStore'
import type { HostToWebviewMessage } from '../../src/shared/protocol'
import { FakeLogOutputChannel, memorySecrets } from './helpers/fakes'

interface Harness {
  readonly service: AuthService
  readonly deps: AuthServiceDeps
  readonly broadcasts: HostToWebviewMessage[]
  readonly facts: { cliPresent: boolean; credentialFile: boolean; envKey: boolean }
  readonly restartBackend: ReturnType<typeof vi.fn<() => Promise<void>>>
  readonly runInTerminal: ReturnType<
    typeof vi.fn<(cliPath: string, args: readonly string[]) => void>
  >
}

function harness(overrides: Partial<AuthServiceDeps> = {}): Harness {
  const broadcasts: HostToWebviewMessage[] = []
  const facts = { cliPresent: true, credentialFile: false, envKey: false }
  const restartBackend = vi.fn<() => Promise<void>>(() => Promise.resolve())
  const runInTerminal = vi.fn<(cliPath: string, args: readonly string[]) => void>()
  let clock = 0
  const deps: AuthServiceDeps = {
    backend: {
      resolveCli: () =>
        facts.cliPresent ? { ok: true, cliPath: '/bin/muse' } : { ok: false, reason: 'missing' },
      credentialFileExists: () => facts.credentialFile,
      hasEnvironmentKey: () => facts.envKey,
      restartBackend,
    },
    credentials: new CredentialStore(memorySecrets()),
    runInTerminal,
    promptForApiKey: vi.fn(() => Promise.resolve('LLM|1|secret')),
    broadcast: (message) => {
      broadcasts.push(message)
    },
    sleep: (ms) => {
      clock += ms
      return Promise.resolve()
    },
    now: () => clock,
    log: new FakeLogOutputChannel(),
    ...overrides,
  }
  return { service: new AuthService(deps), deps, broadcasts, facts, restartBackend, runInTerminal }
}

describe('AuthService.refresh', () => {
  it('reports noCli with the reason when the CLI is missing', async () => {
    const h = harness()
    h.facts.cliPresent = false
    await expect(h.service.refresh()).resolves.toEqual({ status: 'noCli', detail: 'missing' })
    expect(h.broadcasts.at(-1)).toEqual({ type: 'authState', status: 'noCli', detail: 'missing' })
  })

  it('derives signed out / signed in from the credential facts', async () => {
    const h = harness()
    await expect(h.service.refresh()).resolves.toMatchObject({ status: 'signedOut' })
    h.facts.credentialFile = true
    await expect(h.service.refresh()).resolves.toMatchObject({ status: 'signedIn' })
    expect(h.broadcasts.at(-1)).toEqual({ type: 'authState', status: 'signedIn' })
  })
})

describe('AuthService.signIn', () => {
  it('runs muse login in a terminal, waits for the credential, and restarts the backend', async () => {
    const h = harness()
    h.runInTerminal.mockImplementation(() => {
      h.facts.credentialFile = true
    })
    await expect(h.service.signIn('browser')).resolves.toMatchObject({ status: 'signedIn' })
    expect(h.runInTerminal).toHaveBeenCalledWith('/bin/muse', ['login'])
    expect(
      h.broadcasts.map((message) => (message.type === 'authState' ? message.status : '')),
    ).toEqual(['signingIn', 'signedIn'])
    expect(h.restartBackend).toHaveBeenCalledOnce()
  })

  it('reports a timed-out browser sign-in as signed out with a detail', async () => {
    const h = harness()
    await expect(h.service.signIn('browser')).resolves.toEqual({
      status: 'signedOut',
      detail: 'The sign-in did not complete in time. Try again.',
    })
    expect(h.restartBackend).not.toHaveBeenCalled()
  })

  it('stores a pasted API key and restarts the backend', async () => {
    const h = harness()
    await expect(h.service.signIn('apiKey')).resolves.toMatchObject({ status: 'signedIn' })
    await expect(h.deps.credentials.getApiKey()).resolves.toBe('LLM|1|secret')
    expect(h.restartBackend).toHaveBeenCalledOnce()
  })

  it('leaves the state alone when the key prompt is dismissed', async () => {
    const h = harness({ promptForApiKey: vi.fn(() => Promise.resolve(undefined)) })
    await h.service.refresh()
    await expect(h.service.signIn('apiKey')).resolves.toMatchObject({ status: 'signedOut' })
    expect(h.restartBackend).not.toHaveBeenCalled()
  })

  it('refuses to sign in when the CLI is missing', async () => {
    const h = harness()
    h.facts.cliPresent = false
    await expect(h.service.signIn('browser')).resolves.toMatchObject({ status: 'noCli' })
    expect(h.runInTerminal).not.toHaveBeenCalled()
  })
})

describe('AuthService.signOut and host reports', () => {
  it('clears the key, logs the CLI out when it holds a session, and restarts', async () => {
    const h = harness()
    await h.service.signIn('apiKey')
    h.facts.credentialFile = true
    await expect(h.service.signOut()).resolves.toMatchObject({ status: 'signedOut' })
    await expect(h.deps.credentials.getApiKey()).resolves.toBeUndefined()
    expect(h.runInTerminal).toHaveBeenLastCalledWith('/bin/muse', ['logout'])
    expect(h.restartBackend).toHaveBeenCalledTimes(2)
  })

  it('does not run muse logout when there is no CLI session to end', async () => {
    const h = harness()
    await h.service.signOut()
    expect(h.runInTerminal).not.toHaveBeenCalled()
  })

  it('accepts the host verdict over its own estimate', async () => {
    const h = harness()
    h.facts.credentialFile = true
    await h.service.refresh()
    expect(h.service.markAuthRequired('not logged in')).toEqual({
      status: 'signedOut',
      detail: 'not logged in',
    })
    expect(h.service.markBackendError('crashed')).toEqual({ status: 'error', detail: 'crashed' })
    expect(h.service.toMessage()).toEqual({ type: 'authState', status: 'error', detail: 'crashed' })
  })
})
