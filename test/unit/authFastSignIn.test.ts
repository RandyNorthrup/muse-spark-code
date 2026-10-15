import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import type { AccountState } from '../../src/host/auth/accountHost'
import { AuthService, type AuthBackendFacts } from '../../src/host/auth/authService'
import { CliAccount } from '../../src/host/auth/cliAccount'
import { CredentialStore, type SecretStore } from '../../src/host/auth/credentialStore'
import type { Logger } from '../../src/host/logger'
import type { HostToWebviewMessage } from '../../src/shared/protocol'

const log: Logger = {
  trace: () => undefined,
  info: () => undefined,
  warn: () => undefined,
  error: () => undefined,
}

const dirs: string[] = []
afterEach(() => {
  while (dirs.length > 0) {
    rmSync(dirs.pop()!, { recursive: true, force: true })
  }
})

/** A credential file on disk and the real account reader over it. */
function accountFor(
  contents: string,
  probe: () => Promise<AccountState | undefined>,
): { readonly account: CliAccount; readonly file: string } {
  const dir = mkdtempSync(path.join(tmpdir(), 'fast-signin-'))
  dirs.push(dir)
  const file = path.join(dir, 'auth.json')
  writeFileSync(file, contents)
  return {
    file,
    account: new CliAccount({ platform: 'linux', credentialFilePath: () => file, probe, log }),
  }
}

/**
 * The real service wired as activation wires it: `cliSignIn` and the peek
 * are one real `CliAccount` over the file, so a state the file settles
 * never reaches the probe. The secret table's `get` is the refresh's
 * remaining wait, handed in as a promise the test settles.
 */
function service(
  account: CliAccount,
  file: string,
  secretGet: Promise<string | undefined>,
): { readonly svc: AuthService; readonly messages: HostToWebviewMessage[] } {
  const messages: HostToWebviewMessage[] = []
  const backend: AuthBackendFacts = {
    resolveCli: () => ({ ok: true, cliPath: '/bin/muse' }),
    cliSignIn: (isUserAction) => account.signIn(isUserAction),
    peekCliSignIn: () => account.peekFile(),
    abandonCliProbe: () => {
      account.abandonProbe()
    },
    forgetCliAnswers: () => {
      account.forgetAnswers()
    },
    credentialFilePath: () => file,
    credentialFileModifiedAt: () => undefined,
    hasEnvironmentKey: () => false,
    getBackendMode: () => 'auto',
    restartBackend: () => Promise.resolve(),
    logOutCli: () => Promise.resolve(false),
  }
  const secrets: SecretStore = {
    get: () => secretGet,
    store: () => Promise.resolve(),
    delete: () => Promise.resolve(),
  }
  const svc = new AuthService({
    backend,
    credentials: new CredentialStore(secrets, () => undefined),
    logoutHold: { get: () => false, set: () => Promise.resolve() },
    runInTerminal: () => undefined,
    installCommand: 'install',
    runInstallerInTerminal: () => undefined,
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

// The parse keeps presence only (`0` stands in for the value, which the
// parse replaces; no credential ever lands in a test).
const INLINE = '{"schema_version":1,"providers":{"meta":{"api_key":0}}}'
const SIGNED_OUT = '{"schema_version":1,"providers":{}}'

describe('sign-in fast path', () => {
  it('shows a signed-in file before the stored-key read answers', async () => {
    const { account, file } = accountFor(INLINE, () => Promise.resolve(undefined))
    const keyRead = Promise.withResolvers<string | undefined>()
    const { svc, messages } = service(account, file, keyRead.promise)
    const pending = svc.refresh()
    // The stored-key read is still unanswered, yet the panel already knows.
    expect(authStates(messages)).toHaveLength(1)
    expect(authStates(messages)[0]).toMatchObject({ status: 'signedIn', backend: 'museCode' })
    keyRead.resolve(undefined)
    const final = await pending
    expect(final).toMatchObject({ status: 'signedIn', backend: 'museCode' })
  })

  it('waits for the CLI when the file settles nothing', async () => {
    const probe = Promise.withResolvers<AccountState | undefined>()
    const { account, file } = accountFor('not json at all', () => probe.promise)
    const { svc, messages } = service(account, file, Promise.resolve(undefined))
    const pending = svc.refresh()
    expect(authStates(messages)).toHaveLength(0)
    probe.resolve(undefined)
    const final = await pending
    expect(final).toMatchObject({ status: 'signedIn', backend: 'museCode' })
  })

  it('never jumps ahead with a signed-out file', async () => {
    const { account, file } = accountFor(SIGNED_OUT, () => Promise.resolve(undefined))
    const keyRead = Promise.withResolvers<string | undefined>()
    const { svc, messages } = service(account, file, keyRead.promise)
    const pending = svc.refresh()
    expect(authStates(messages)).toHaveLength(0)
    keyRead.resolve(undefined)
    const final = await pending
    expect(final).toMatchObject({ status: 'signedOut', backend: 'museCode' })
  })
})
