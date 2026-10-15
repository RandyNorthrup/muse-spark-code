import { describe, expect, it, vi } from 'vitest'
import { AuthService, type AuthBackendFacts } from '../../src/host/auth/authService'
import { CredentialStore } from '../../src/host/auth/credentialStore'
import type { CliSignIn } from '../../src/core/backends/musecode/credentialFile'
import type { Logger } from '../../src/host/logger'
import type { HostToWebviewMessage } from '../../src/shared/protocol'

const log: Logger = {
  trace: vi.fn(),
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
}

interface Probe {
  readonly promise: Promise<CliSignIn>
  resolve: (value: CliSignIn) => void
}

function deferredProbe(): Probe {
  const { promise, resolve } = Promise.withResolvers<CliSignIn>()
  return { promise, resolve }
}

function service(
  probe: Probe,
  peek: CliSignIn | undefined,
): {
  readonly svc: AuthService
  readonly messages: HostToWebviewMessage[]
} {
  const messages: HostToWebviewMessage[] = []
  const backend: AuthBackendFacts = {
    resolveCli: () => ({ ok: true, cliPath: '/bin/muse' }),
    cliSignIn: () => probe.promise,
    peekCliSignIn: () => peek,
    abandonCliProbe: vi.fn(),
    forgetCliAnswers: vi.fn(),
    credentialFilePath: () => '/home/user/.muse/credentials.json',
    credentialFileModifiedAt: () => undefined,
    hasEnvironmentKey: () => false,
    getBackendMode: () => 'auto',
    restartBackend: () => Promise.resolve(),
    logOutCli: () => Promise.resolve(false),
  }
  // The real credential store over an empty in-memory secret table: no key
  // is stored, so only the CLI's answer counts.
  const secrets = new Map<string, string>()
  const credentials = new CredentialStore(
    {
      get: (key: string) => Promise.resolve(secrets.get(key)),
      store: (key: string, value: string) => {
        secrets.set(key, value)
        return Promise.resolve()
      },
      delete: (key: string) => {
        secrets.delete(key)
        return Promise.resolve()
      },
    },
    vi.fn(),
  )
  const svc = new AuthService({
    backend,
    credentials,
    logoutHold: {
      get: () => false,
      set: () => Promise.resolve(),
    },
    runInTerminal: vi.fn(),
    installCommand: 'install',
    runInstallerInTerminal: vi.fn(),
    runDeviceSignIn: () => Promise.resolve('timedOut'),
    promptForApiKey: () => Promise.resolve(undefined),
    broadcast: (message: HostToWebviewMessage) => {
      messages.push(message)
    },
    sleep: () => Promise.resolve(),
    now: () => Date.now(),
    log,
  })
  return { svc, messages }
}

function authStates(messages: readonly HostToWebviewMessage[]): HostToWebviewMessage[] {
  return messages.filter((message) => message.type === 'authState')
}

describe('sign-in fast path', () => {
  it('shows a signed-in file before the CLI probe answers', async () => {
    const probe = deferredProbe()
    const { svc, messages } = service(probe, 'signedIn')
    const pending = svc.refresh()
    // The probe is still unanswered, yet the panel already knows.
    expect(authStates(messages)).toHaveLength(1)
    expect(authStates(messages)[0]).toMatchObject({ status: 'signedIn', backend: 'museCode' })
    probe.resolve('signedIn')
    const final = await pending
    expect(final).toMatchObject({ status: 'signedIn', backend: 'museCode' })
  })

  it('waits for the probe when the file settles nothing', async () => {
    const probe = deferredProbe()
    const { svc, messages } = service(probe, undefined)
    const pending = svc.refresh()
    expect(authStates(messages)).toHaveLength(0)
    probe.resolve('signedIn')
    const final = await pending
    expect(final).toMatchObject({ status: 'signedIn', backend: 'museCode' })
  })

  it('lets the full facts overrule a stale fast answer', async () => {
    const probe = deferredProbe()
    const { svc, messages } = service(probe, 'signedIn')
    const pending = svc.refresh()
    expect(authStates(messages)[0]).toMatchObject({ status: 'signedIn' })
    probe.resolve('signedOut')
    const final = await pending
    expect(final).toMatchObject({ status: 'signedOut', backend: 'museCode' })
  })
})
