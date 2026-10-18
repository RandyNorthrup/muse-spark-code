import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import type { AccountState } from '../../src/host/auth/accountHost'
import {
  AuthService,
  type AuthBackendFacts,
  type AuthSnapshot,
} from '../../src/host/auth/authService'
import { CliAccount } from '../../src/host/auth/cliAccount'
import { CredentialStore, type SecretStore } from '../../src/host/auth/credentialStore'
import type { Logger } from '../../src/host/logger'
import type { HostToWebviewMessage } from '../../src/shared/protocol'

const silent = (): undefined => undefined
const log: Logger = { trace: silent, info: silent, warn: silent, error: silent }

const scratchDirs = new Set<string>()
afterEach(() => {
  for (const dir of scratchDirs) {
    rmSync(dir, { recursive: true, force: true })
  }
  scratchDirs.clear()
})

interface Started {
  readonly pending: Promise<AuthSnapshot>
  readonly messages: HostToWebviewMessage[]
  readonly answerKeyRead: () => void
}

/** The backend facts over one real `CliAccount`, as activation wires them. */
function backendFor(
  account: CliAccount,
  file: string,
  restartBackend: () => Promise<unknown>,
): AuthBackendFacts {
  return {
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
    restartBackend: async () => {
      await restartBackend()
    },
    logOutCli: () => Promise.resolve(false),
  }
}

function serviceFor(
  backend: AuthBackendFacts,
  secrets: SecretStore,
  messages: HostToWebviewMessage[],
): AuthService {
  return new AuthService({
    backend,
    credentials: new CredentialStore(secrets, silent),
    logoutHold: { get: () => false, set: () => Promise.resolve() },
    runInTerminal: silent,
    installCommand: 'install',
    runInstallerInTerminal: silent,
    runDeviceSignIn: () => Promise.resolve('timedOut'),
    promptForApiKey: () => Promise.resolve(undefined),
    broadcast: (message: HostToWebviewMessage) => {
      messages.push(message)
    },
    sleep: () => Promise.resolve(),
    now: () => Date.now(),
    log,
  })
}

/**
 * One refresh, wired as activation wires it: `cliSignIn` and the peek are
 * one real `CliAccount` over a temp credential file, so a state the file
 * settles never reaches the probe. The secret table's `get` is the
 * refresh's remaining wait, settled by `answerKeyRead`.
 */
function start(contents: string, probe: () => Promise<AccountState | undefined>): Started {
  const dir = mkdtempSync(path.join(tmpdir(), 'fast-signin-'))
  scratchDirs.add(dir)
  const file = path.join(dir, 'auth.json')
  writeFileSync(file, contents)
  const account = new CliAccount({ platform: 'linux', credentialFilePath: () => file, probe, log })
  const backend = backendFor(account, file, () => Promise.resolve())
  const keyRead = Promise.withResolvers<string | undefined>()
  const secrets: SecretStore = {
    get: () => keyRead.promise,
    store: () => Promise.resolve(),
    delete: () => Promise.resolve(),
  }
  const messages: HostToWebviewMessage[] = []
  const svc = serviceFor(backend, secrets, messages)
  return {
    pending: svc.refresh(),
    messages,
    answerKeyRead: () => {
      keyRead.resolve(undefined)
    },
  }
}

function authStates(messages: readonly HostToWebviewMessage[]): HostToWebviewMessage[] {
  return messages.filter((message) => message.type === 'authState')
}

// The parse keeps presence only (a placeholder string stands in for the
// value, which the parse replaces with a boolean; no credential ever lands
// in a test). Only a string key is the captured inline sign-in (F94).
const INLINE = '{"schema_version":1,"providers":{"meta":{"api_key":"<placeholder>"}}}'
const SIGNED_OUT = '{"schema_version":1,"providers":{}}'

describe('sign-in fast path', () => {
  it('shows a signed-in file before the stored-key read answers', async () => {
    const run = start(INLINE, () => Promise.resolve(undefined))
    // The stored-key read is still unanswered, yet the panel already knows.
    expect(authStates(run.messages)).toHaveLength(1)
    expect(authStates(run.messages)[0]).toMatchObject({ status: 'signedIn', backend: 'museCode' })
    run.answerKeyRead()
    await expect(run.pending).resolves.toMatchObject({ status: 'signedIn', backend: 'museCode' })
  })

  it('waits for the CLI when the file settles nothing', async () => {
    const probe = Promise.withResolvers<AccountState | undefined>()
    const run = start('not json at all', () => probe.promise)
    run.answerKeyRead()
    expect(authStates(run.messages)).toHaveLength(0)
    probe.resolve(undefined)
    await expect(run.pending).resolves.toMatchObject({ status: 'signedIn', backend: 'museCode' })
  })

  it('never jumps ahead while a backend switch is ending conversations', async () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'fast-signin-'))
    scratchDirs.add(dir)
    const file = path.join(dir, 'auth.json')
    writeFileSync(file, SIGNED_OUT)
    const account = new CliAccount({
      platform: 'linux',
      credentialFilePath: () => file,
      probe: () => Promise.resolve(undefined),
      log,
    })
    const restart = Promise.withResolvers<undefined>()
    let isRestartHeld = false
    const backend = backendFor(account, file, () =>
      isRestartHeld ? restart.promise : Promise.resolve(),
    )
    const secrets: SecretStore = {
      get: () => Promise.resolve('key'),
      store: () => Promise.resolve(),
      delete: () => Promise.resolve(),
    }
    const messages: HostToWebviewMessage[] = []
    const svc = serviceFor(backend, secrets, messages)
    // Signed in on the Model API (stored key, no CLI session): conversations
    // now run on that backend (`liveBackend`).
    await expect(svc.refresh()).resolves.toMatchObject({
      status: 'signedIn',
      backend: 'modelApi',
    })
    // The CLI signs in too, so the next refresh switches backends: the
    // switch publishes `checking` while the old backend's conversations end.
    writeFileSync(file, INLINE)
    isRestartHeld = true
    const switching = svc.refresh()
    await new Promise((resolve) => setTimeout(resolve, 0))
    const before = authStates(messages).length
    // A refresh during the switch must not publish Muse Code signed-in
    // ahead of the switch: `publishSelection` ends the old conversations
    // first, and the fast path publishes through `set` directly.
    const during = svc.refresh()
    const jumped = authStates(messages)
      .slice(before)
      .filter(
        (message) =>
          message.type === 'authState' &&
          message.status === 'signedIn' &&
          message.backend === 'museCode',
      )
    expect(jumped).toHaveLength(0)
    restart.resolve(undefined)
    await expect(switching).resolves.toMatchObject({ status: 'signedIn' })
    await expect(during).resolves.toMatchObject({ status: 'signedIn', backend: 'museCode' })
  })

  it('never jumps ahead with a signed-out file', async () => {
    const run = start(SIGNED_OUT, () => Promise.resolve(undefined))
    expect(authStates(run.messages)).toHaveLength(0)
    run.answerKeyRead()
    await expect(run.pending).resolves.toMatchObject({
      status: 'signedOut',
      backend: 'museCode',
    })
  })
})
