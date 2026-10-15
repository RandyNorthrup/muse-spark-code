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
  const keyRead = Promise.withResolvers<string | undefined>()
  const secrets: SecretStore = {
    get: () => keyRead.promise,
    store: () => Promise.resolve(),
    delete: () => Promise.resolve(),
  }
  const messages: HostToWebviewMessage[] = []
  const svc = new AuthService({
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

// The parse keeps presence only (`0` stands in for the value, which the
// parse replaces; no credential ever lands in a test).
const INLINE = '{"schema_version":1,"providers":{"meta":{"api_key":0}}}'
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
