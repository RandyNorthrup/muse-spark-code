import { mkdirSync, mkdtempSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { CliSignIn } from '../../src/core/backends/musecode/credentialFile'
import type { AccountState } from '../../src/host/auth/accountHost'
import {
  AuthService,
  type AuthServiceDeps,
  type AuthSnapshot,
} from '../../src/host/auth/authService'
import { CliAccount } from '../../src/host/auth/cliAccount'
import { CredentialStore } from '../../src/host/auth/credentialStore'
import type { DeviceSignInOutcome } from '../../src/host/auth/deviceSignIn'
import { MUSE_INSTALL_TIMEOUT_MS, type BackendMode } from '../../src/shared/constants'
import { EN } from '../../src/shared/l10n/en'
import { fill } from '../../src/shared/l10n/text'
import type { HostToWebviewMessage } from '../../src/shared/protocol'
import { DEVICE_LOGIN_FILE, LOGOUT_SHELL } from './helpers/credentialShapes'
import { FakeLogOutputChannel, memorySecrets, unexpectedWarning } from './helpers/fakes'

const CREDENTIAL_PATH = '/home/u/.config/muse/auth.json'

interface Harness {
  readonly service: AuthService
  readonly deps: AuthServiceDeps
  readonly broadcasts: HostToWebviewMessage[]
  readonly facts: {
    cliPresent: boolean
    /** What the CLI's credential file (or `account/read`) says. */
    cli: CliSignIn
    envKey: boolean
    backendMode: BackendMode
    /** The credential file's modification time. */
    fileModifiedAt: number | undefined
  }
  readonly cliSignIn: ReturnType<typeof vi.fn<(isUserAction: boolean) => Promise<CliSignIn>>>
  readonly abandonCliProbe: ReturnType<typeof vi.fn<() => void>>
  readonly forgetCliAnswers: ReturnType<typeof vi.fn<() => void>>
  /** `account/logout`: by default it works and leaves the CLI signed out. */
  readonly logOutCli: ReturnType<typeof vi.fn<() => Promise<boolean>>>
  readonly restartBackend: ReturnType<
    typeof vi.fn<(isConversationEnding: boolean) => Promise<void>>
  >
  readonly runInTerminal: ReturnType<
    typeof vi.fn<(cliPath: string, args: readonly string[]) => void>
  >
  readonly runDeviceSignIn: ReturnType<
    typeof vi.fn<
      (
        signal: AbortSignal,
        onCode: (url: string, code: string) => void,
      ) => Promise<DeviceSignInOutcome>
    >
  >
  readonly runInstallerInTerminal: ReturnType<typeof vi.fn<() => void>>
  readonly logoutHoldState: { isHeld: boolean }
}

function harness(overrides: Partial<AuthServiceDeps> = {}): Harness {
  const broadcasts: HostToWebviewMessage[] = []
  const facts = {
    cliPresent: true,
    cli: 'signedOut' as CliSignIn,
    envKey: false,
    backendMode: 'auto' as BackendMode,
    fileModifiedAt: 1 as number | undefined,
  }
  const cliSignIn = vi.fn<(isUserAction: boolean) => Promise<CliSignIn>>(() =>
    Promise.resolve(facts.cli),
  )
  const abandonCliProbe = vi.fn<() => void>()
  const forgetCliAnswers = vi.fn<() => void>()
  const logOutCli = vi.fn<() => Promise<boolean>>(() => {
    facts.cli = 'signedOut'
    return Promise.resolve(true)
  })
  const restartBackend = vi.fn<(isConversationEnding: boolean) => Promise<void>>(() =>
    Promise.resolve(),
  )
  const runInTerminal = vi.fn<(cliPath: string, args: readonly string[]) => void>()
  const runDeviceSignIn = vi.fn<
    (
      signal: AbortSignal,
      onCode: (url: string, code: string) => void,
    ) => Promise<DeviceSignInOutcome>
  >(() => Promise.resolve('timedOut'))
  const runInstallerInTerminal = vi.fn<() => void>()
  const logoutHoldState = { isHeld: false }
  let clock = 0
  const deps: AuthServiceDeps = {
    backend: {
      resolveCli: () =>
        facts.cliPresent ? { ok: true, cliPath: '/bin/muse' } : { ok: false, reason: 'missing' },
      cliSignIn,
      abandonCliProbe,
      forgetCliAnswers,
      credentialFilePath: () => CREDENTIAL_PATH,
      credentialFileModifiedAt: () => facts.fileModifiedAt,
      hasEnvironmentKey: () => facts.envKey,
      getBackendMode: () => facts.backendMode,
      restartBackend,
      logOutCli,
    },
    credentials: new CredentialStore(memorySecrets(), unexpectedWarning),
    runInTerminal,
    installCommand: 'irm https://dev.meta.ai/install.ps1 | iex',
    runInstallerInTerminal,
    logoutHold: {
      get: () => logoutHoldState.isHeld,
      set: (isHeld: boolean) => {
        logoutHoldState.isHeld = isHeld
        return Promise.resolve()
      },
    },
    runDeviceSignIn,
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
  return {
    service: new AuthService(deps),
    deps,
    broadcasts,
    facts,
    cliSignIn,
    abandonCliProbe,
    forgetCliAnswers,
    logOutCli,
    restartBackend,
    runInTerminal,
    runDeviceSignIn,
    runInstallerInTerminal,
    logoutHoldState,
  }
}

/** A CLI sign-in the account host could not end: `muse logout` runs in a terminal instead. */
function withLogoutFallback(h: Harness): Harness {
  h.logOutCli.mockResolvedValue(false)
  return h
}

/** A CLI sign-in a sign-out could not end: the logout hold is on. */
async function heldCliSignIn(): Promise<Harness> {
  const h = withLogoutFallback(harness())
  h.facts.cli = 'signedIn'
  await h.service.refresh()
  await h.service.signOut()
  expect(h.logoutHoldState.isHeld).toBe(true)
  return h
}

async function signedInModelApi(overrides: Partial<AuthServiceDeps> = {}): Promise<Harness> {
  const h = harness(overrides)
  await h.deps.credentials.setApiKey('LLM|1|secret')
  await h.service.refresh()
  return h
}

async function expectSignedOutWithoutKey(h: Harness): Promise<void> {
  expect(await h.deps.credentials.getApiKey()).toBeUndefined()
  expect(h.service.current.status).toBe('signedOut')
  expect(h.broadcasts).not.toContainEqual(
    expect.objectContaining({ type: 'authState', status: 'signedIn' }),
  )
}

describe('AuthService.refresh', () => {
  it('reports noCli with the reason when the CLI is missing, offering the key path', async () => {
    const h = harness()
    h.facts.cliPresent = false
    await expect(h.service.refresh()).resolves.toEqual({
      status: 'noCli',
      detail: 'missing',
      backend: undefined,
      methods: ['apiKey'],
      hasCli: false,
      hasCliSession: false,
    })
    expect(h.broadcasts.at(-1)).toEqual({
      type: 'authState',
      status: 'noCli',
      detail: 'missing',
      methods: ['apiKey'],
      installCommand: 'irm https://dev.meta.ai/install.ps1 | iex',
      hasCli: false,
      hasCliSession: false,
    })
    expect(h.service.backend).toBeUndefined()
  })

  it('derives signed out / signed in from the CLI credential facts, on the Muse Code backend', async () => {
    const h = harness()
    await expect(h.service.refresh()).resolves.toMatchObject({
      status: 'signedOut',
      backend: 'museCode',
      methods: ['browser', 'apiKey'],
    })
    h.facts.cli = 'signedIn'
    await expect(h.service.refresh()).resolves.toMatchObject({ status: 'signedIn' })
    expect(h.broadcasts.at(-1)).toEqual({
      type: 'authState',
      status: 'signedIn',
      backend: 'museCode',
      methods: ['browser', 'apiKey'],
      installCommand: 'irm https://dev.meta.ai/install.ps1 | iex',
      hasCli: true,
      hasCliSession: true,
    })
    expect(h.service.backend).toBe('museCode')
  })

  it('takes the Model API backend from a stored key when the CLI has no session, and never mixes them', async () => {
    const h = harness()
    h.facts.cliPresent = false
    await h.deps.credentials.setApiKey('LLM|1|secret')
    await expect(h.service.refresh()).resolves.toMatchObject({
      status: 'signedIn',
      backend: 'modelApi',
    })
    // A CLI session takes precedence in auto: the subscription pays for CLI work.
    h.facts.cliPresent = true
    h.facts.cli = 'signedIn'
    await expect(h.service.refresh()).resolves.toMatchObject({
      status: 'signedIn',
      backend: 'museCode',
    })
    // Forced modes.
    h.facts.backendMode = 'modelApi'
    await expect(h.service.refresh()).resolves.toMatchObject({
      status: 'signedIn',
      backend: 'modelApi',
      methods: ['apiKey'],
    })
    h.facts.backendMode = 'museCode'
    h.facts.cli = 'signedOut'
    await expect(h.service.refresh()).resolves.toMatchObject({
      status: 'signedOut',
      backend: 'museCode',
      methods: ['browser'],
    })
    h.facts.cliPresent = false
    await expect(h.service.refresh()).resolves.toMatchObject({ status: 'noCli', methods: [] })
  })
})

// A CLI slow to answer about an ambiguous file must not hold up a stored
// key when the backend is forced to the Model API (Codex on 328efb52).
describe('AuthService with the backend forced to the Model API', () => {
  it('selects from the stored key without asking the CLI', async () => {
    const h = harness()
    h.facts.backendMode = 'modelApi'
    h.cliSignIn.mockImplementation(unanswered)
    await h.deps.credentials.setApiKey('LLM|1|secret')
    await expect(h.service.refresh(true)).resolves.toMatchObject({
      status: 'signedIn',
      backend: 'modelApi',
      hasCliSession: false,
    })
    expect(h.cliSignIn).not.toHaveBeenCalled()
  })
})

describe('AuthService.signIn', () => {
  it.each(['cancelled', 'timedOut'] as const)(
    'keeps a valid Model API session after CLI device sign-in is %s',
    async (outcome) => {
      const h = await signedInModelApi()
      h.runDeviceSignIn.mockResolvedValue(outcome)
      await expect(h.service.signIn('browser')).resolves.toMatchObject({
        status: 'signedIn',
        backend: 'modelApi',
      })
      expect(await h.deps.credentials.getApiKey()).toBe('LLM|1|secret')
      expect(h.restartBackend).not.toHaveBeenCalled()
      expect(h.broadcasts).toContainEqual(
        expect.objectContaining({ type: 'notice', text: expect.any(String) }),
      )
    },
  )

  it('keeps a valid Model API session when the temporary CLI host fails', async () => {
    const h = await signedInModelApi()
    h.runDeviceSignIn.mockRejectedValue(new Error('handshake failed'))
    await expect(h.service.signIn('browser')).resolves.toMatchObject({
      status: 'signedIn',
      backend: 'modelApi',
    })
    expect(h.restartBackend).not.toHaveBeenCalled()
    expect(h.broadcasts).toContainEqual(
      expect.objectContaining({ type: 'notice', level: 'warning' }),
    )
  })

  it('keeps the Model API session when Muse Code disappears before sign-in starts', async () => {
    const h = await signedInModelApi()
    h.facts.cliPresent = false
    await expect(h.service.signIn('browser')).resolves.toMatchObject({
      status: 'signedIn',
      backend: 'modelApi',
      hasCli: false,
    })
    expect(h.runDeviceSignIn).not.toHaveBeenCalled()
  })

  it('does not publish a device code after the user cancels sign-in', async () => {
    const h = harness()
    let publishCode: ((url: string, code: string) => void) | undefined
    const login = Promise.withResolvers<'cancelled'>()
    h.runDeviceSignIn.mockImplementation((_signal, onCode) => {
      publishCode = onCode
      return login.promise
    })
    const pending = h.service.signIn('browser')
    h.service.cancelSignIn()
    publishCode?.('https://auth.meta.com/oauth/device/', 'ABCD-EFGH')
    login.resolve('cancelled')
    await pending
    expect(
      h.broadcasts.some((message) => message.type === 'authState' && 'userCode' in message),
    ).toBe(false)
  })

  it('cancels at once while the pre-flight account probe goes unanswered (the review of PR #49)', async () => {
    const h = harness()
    h.cliSignIn.mockImplementation(() => new Promise<CliSignIn>(() => undefined))
    const pending = h.service.signIn('browser')
    await vi.waitFor(() => {
      expect(h.cliSignIn).toHaveBeenCalled()
    })
    h.service.cancelSignIn()
    await expect(pending).resolves.toMatchObject({ status: 'signedOut' })
    expect(h.runDeviceSignIn).not.toHaveBeenCalled()
  })

  it('signs out without waiting on a pre-flight probe the CLI never answered (the review of PR #49)', async () => {
    const h = harness()
    // Like CliAccount: a question joins the unanswered probe until it is abandoned.
    let isAbandoned = false
    h.cliSignIn.mockImplementation(() =>
      isAbandoned ? Promise.resolve(h.facts.cli) : new Promise<CliSignIn>(() => undefined),
    )
    h.abandonCliProbe.mockImplementation(() => {
      isAbandoned = true
    })
    const pending = h.service.signIn('browser')
    await vi.waitFor(() => {
      expect(h.cliSignIn).toHaveBeenCalled()
    })
    await expect(h.service.signOut()).resolves.toMatchObject({ status: 'signedOut' })
    // The interrupted sign-in settles too, instead of waiting out the probe.
    await expect(pending).resolves.toBeDefined()
    expect(h.abandonCliProbe).toHaveBeenCalled()
    // Its cancellation never showed over the sign-out's own state or as a notice.
    expect(
      h.broadcasts.some(
        (message) =>
          (message.type === 'authState' && message.detail === EN.signInCancelled) ||
          (message.type === 'notice' && message.text === EN.signInCancelled),
      ),
    ).toBe(false)
  })

  // A refresh begun before a sign-out, or during it, whose probe answers
  // after the sign-out ended (the review of PR #49).
  it.each([
    ['before it', false],
    ['during it', true],
  ])(
    'keeps the state a sign-out published when a refresh begun %s answers late',
    async (_name, isDuring) => {
      const h = harness()
      const stopping = Promise.withResolvers<undefined>()
      h.restartBackend.mockImplementation(() => stopping.promise)
      const late = Promise.withResolvers<CliSignIn>()
      const signingOut = isDuring ? h.service.signOut() : undefined
      h.cliSignIn.mockImplementationOnce(() => late.promise)
      const stale = h.service.refresh()
      const signedOut = signingOut ?? h.service.signOut()
      stopping.resolve(undefined)
      await expect(signedOut).resolves.toMatchObject({ status: 'signedOut' })
      const published = h.broadcasts.length
      late.resolve('signedIn')
      await expect(stale).resolves.toMatchObject({ status: 'signedOut' })
      expect(h.service.current.status).toBe('signedOut')
      expect(h.broadcasts).toHaveLength(published)
    },
  )

  it('shows the device code, waits for the credential, and restarts the backend', async () => {
    const h = harness()
    h.runDeviceSignIn.mockImplementation((_signal, onCode) => {
      onCode('https://auth.meta.com/oauth/device/', 'ABCD-EFGH')
      h.facts.cli = 'signedIn'
      return Promise.resolve('signedIn')
    })
    await expect(h.service.signIn('browser')).resolves.toMatchObject({ status: 'signedIn' })
    expect(h.runInTerminal).not.toHaveBeenCalled()
    expect(h.broadcasts).toContainEqual(
      expect.objectContaining({ type: 'authState', userCode: 'ABCD-EFGH' }),
    )
    expect(
      h.broadcasts.map((message) => (message.type === 'authState' ? message.status : '')),
    ).toEqual(['signingIn', 'signingIn', 'signedIn'])
    expect(h.restartBackend).toHaveBeenCalledOnce()
  })

  it('reports a timed-out browser sign-in as signed out with a detail', async () => {
    const h = harness()
    await expect(h.service.signIn('browser')).resolves.toMatchObject({
      status: 'signedOut',
      detail: 'The sign-in did not complete in time. Try again.',
    })
    expect(h.restartBackend).not.toHaveBeenCalled()
  })

  it('stores a pasted API key, restarts the backends and lands on the Model API backend', async () => {
    const h = harness()
    await expect(h.service.signIn('apiKey')).resolves.toMatchObject({
      status: 'signedIn',
      backend: 'modelApi',
    })
    await expect(h.deps.credentials.getApiKey()).resolves.toBe('LLM|1|secret')
    expect(h.restartBackend).toHaveBeenCalledOnce()
  })

  it('revokes host admission during a same-kind Model API key replacement', async () => {
    const h = await signedInModelApi({
      promptForApiKey: () => Promise.resolve('LLM|1|replacement'),
    })
    const priorGeneration = h.service.admissionGeneration
    const stored = Promise.withResolvers<undefined>()
    const originalStore = h.deps.credentials.setApiKey.bind(h.deps.credentials)
    const writing = vi
      .spyOn(h.deps.credentials, 'setApiKey')
      .mockImplementationOnce(async (key) => {
        await stored.promise
        await originalStore(key)
      })
    const replacing = h.service.signIn('apiKey')
    await vi.waitFor(() => {
      expect(writing).toHaveBeenCalledOnce()
    })
    expect(h.service.backend).toBeUndefined()
    expect(h.service.admissionGeneration).toBeGreaterThan(priorGeneration)
    stored.resolve(undefined)
    await replacing
    expect(h.service.backend).toBe('modelApi')
    expect(h.restartBackend).toHaveBeenLastCalledWith(true)
  })

  it('stops the old account before storing the replacement key', async () => {
    const h = await signedInModelApi({
      promptForApiKey: () => Promise.resolve('LLM|1|replacement'),
    })
    const stopStarted = Promise.withResolvers<undefined>()
    const finishStop = Promise.withResolvers<undefined>()
    h.restartBackend.mockImplementation(async () => {
      stopStarted.resolve(undefined)
      await finishStop.promise
    })
    const replacing = h.service.signIn('apiKey')
    await stopStarted.promise
    expect(await h.deps.credentials.getApiKey()).toBe('LLM|1|secret')
    finishStop.resolve(undefined)
    await replacing
    expect(await h.deps.credentials.getApiKey()).toBe('LLM|1|replacement')
  })

  it('accepts an API key without the CLI', async () => {
    const h = harness()
    h.facts.cliPresent = false
    await expect(h.service.signIn('apiKey')).resolves.toMatchObject({
      status: 'signedIn',
      backend: 'modelApi',
    })
    expect(h.runDeviceSignIn).not.toHaveBeenCalled()
  })

  it('leaves the state alone when the key prompt is dismissed', async () => {
    const h = harness({ promptForApiKey: vi.fn(() => Promise.resolve(undefined)) })
    await h.service.refresh()
    await expect(h.service.signIn('apiKey')).resolves.toMatchObject({ status: 'signedOut' })
    expect(h.restartBackend).not.toHaveBeenCalled()
  })

  it('does not restore a Model API key from a prompt completed after sign-out', async () => {
    const prompt = Promise.withResolvers<string>()
    const h = harness({ promptForApiKey: () => prompt.promise })
    const signingIn = h.service.signIn('apiKey')
    await h.service.signOut()
    prompt.resolve('LLM|1|late')
    await signingIn
    await expectSignedOutWithoutKey(h)
  })

  it('waits for an in-flight SecretStorage write before clearing the key at sign-out', async () => {
    const storeStarted = Promise.withResolvers<undefined>()
    const finishStore = Promise.withResolvers<undefined>()
    const secrets = memorySecrets()
    const credentials = new CredentialStore(
      {
        get: secrets.get,
        store: async (key, value) => {
          storeStarted.resolve(undefined)
          await finishStore.promise
          secrets.values.set(key, value)
        },
        delete: secrets.delete,
      },
      unexpectedWarning,
    )
    const h = harness({ credentials })
    const signingIn = h.service.signIn('apiKey')
    await storeStarted.promise
    const signingOut = h.service.signOut()
    finishStore.resolve(undefined)
    await Promise.all([signingIn, signingOut])
    await expectSignedOutWithoutKey(h)
  })

  it('stops the backend after a key sign-in restart already underway', async () => {
    const restartStarted = Promise.withResolvers<undefined>()
    const finishSignInRestart = Promise.withResolvers<undefined>()
    const h = harness()
    let isHostActive = false
    h.restartBackend.mockImplementation(async (isConversationEnding) => {
      if (isConversationEnding) {
        isHostActive = false
        return
      }
      restartStarted.resolve(undefined)
      await finishSignInRestart.promise
      isHostActive = true
    })
    const signingIn = h.service.signIn('apiKey')
    await restartStarted.promise
    const signingOut = h.service.signOut()
    await new Promise((resolve) => setTimeout(resolve, 0))
    finishSignInRestart.resolve(undefined)
    await Promise.all([signingIn, signingOut])
    await expectSignedOutWithoutKey(h)
    expect(isHostActive).toBe(false)
  })

  it('starts one device flow however often the button is pressed (D25)', async () => {
    const h = harness()
    h.runDeviceSignIn.mockImplementation(() => {
      h.facts.cli = 'signedIn'
      return Promise.resolve('signedIn')
    })
    const first = h.service.signIn('browser')
    const second = h.service.signIn('browser')
    await expect(Promise.all([first, second])).resolves.toMatchObject([
      { status: 'signedIn' },
      { status: 'signedIn' },
    ])
    expect(h.runDeviceSignIn).toHaveBeenCalledOnce()
  })

  it('refuses the browser sign-in when the CLI is missing', async () => {
    const h = harness()
    h.facts.cliPresent = false
    await expect(h.service.signIn('browser')).resolves.toMatchObject({ status: 'noCli' })
    expect(h.runDeviceSignIn).not.toHaveBeenCalled()
  })

  it('cancels the running device flow without changing credentials', async () => {
    const h = harness()
    h.runDeviceSignIn.mockImplementation(
      (signal) =>
        new Promise((resolve) => {
          signal.addEventListener(
            'abort',
            () => {
              resolve('cancelled')
            },
            { once: true },
          )
        }),
    )
    const pending = h.service.signIn('browser')
    h.service.cancelSignIn()
    await expect(pending).resolves.toMatchObject({
      status: 'signedOut',
      detail: 'Sign-in cancelled.',
    })
    expect(h.restartBackend).not.toHaveBeenCalled()
  })
})

/** A question to the CLI that is never answered. */
function unanswered(): Promise<CliSignIn> {
  return new Promise<CliSignIn>(() => undefined)
}

/** Resolves as soon as `signal` aborts. */
function aborted(signal: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    signal.addEventListener(
      'abort',
      () => {
        resolve()
      },
      { once: true },
    )
  })
}

/**
 * A browser sign-in whose Cancel is pressed just after the browser
 * approved: the credential file changed and the CLI reads signed in.
 */
async function cancelAfterApproval(h: Harness): Promise<AuthSnapshot> {
  h.runDeviceSignIn.mockImplementation(async (signal) => {
    h.facts.fileModifiedAt = 2
    h.facts.cli = 'signedIn'
    await aborted(signal)
    return 'cancelled'
  })
  const pending = h.service.signIn('browser')
  await vi.waitFor(() => {
    expect(h.runDeviceSignIn).toHaveBeenCalled()
  })
  h.service.cancelSignIn()
  return await pending
}

/**
 * A Model API session switching to a CLI now signed in (Check again), held
 * in the restart that ends the Model API conversation until the test
 * settles `stopping`.
 */
async function switchHeldInRestart() {
  const h = await signedInModelApi()
  const stopping = Promise.withResolvers<undefined>()
  h.restartBackend.mockImplementationOnce(() => stopping.promise)
  h.facts.cli = 'signedIn'
  const switching = h.service.checkAgain()
  await vi.waitFor(() => {
    expect(h.restartBackend).toHaveBeenCalledOnce()
  })
  return { h, stopping, switching }
}

// The review of PR #49: what a sign-out, Cancel or the window closing must
// not wait on, and what they must not overwrite.
describe('AuthService: sign-in, sign-out and Cancel racing', () => {
  // The device runner saw the sign-in; the CLI then never answers the
  // confirming question, before the hold is lifted or in the last refresh.
  it.each([
    ['confirming the sign-in after a sign-out', true],
    ['refreshing after the sign-in', false],
  ])('signs out without waiting on a finished sign-in %s', async (_name, isHeld) => {
    const h = withLogoutFallback(harness())
    if (isHeld) {
      h.facts.cli = 'signedIn'
      await h.service.refresh()
      await h.service.signOut()
      expect(h.logoutHoldState.isHeld).toBe(true)
    }
    let isConfirming = false
    h.runDeviceSignIn.mockImplementation(() => {
      h.cliSignIn.mockImplementationOnce(() => {
        isConfirming = true
        return unanswered()
      })
      return Promise.resolve('signedIn')
    })
    const signingIn = h.service.signIn('browser')
    await vi.waitFor(() => {
      expect(isConfirming).toBe(true)
    })
    h.facts.cli = 'signedOut'
    await expect(h.service.signOut()).resolves.toMatchObject({ status: 'signedOut' })
    await expect(signingIn).resolves.toBeDefined()
  })

  it('signs out without waiting on the refresh a failed sign-in began', async () => {
    const h = await signedInModelApi()
    let isRefreshing = false
    h.runDeviceSignIn.mockImplementation(() => {
      h.cliSignIn.mockImplementationOnce(() => {
        isRefreshing = true
        return unanswered()
      })
      return Promise.resolve('timedOut')
    })
    const signingIn = h.service.signIn('browser')
    await vi.waitFor(() => {
      expect(isRefreshing).toBe(true)
    })
    await expect(h.service.signOut()).resolves.toMatchObject({ status: 'signedOut' })
    await expect(signingIn).resolves.toBeDefined()
    expect(await h.deps.credentials.getApiKey()).toBeUndefined()
  })

  // The browser approved as Cancel was pressed: the file changed since the
  // flow began, so its structure decides, not the click.
  it('lets the credential file decide a Cancel pressed just after the browser approved', async () => {
    const h = harness()
    await expect(cancelAfterApproval(h)).resolves.toMatchObject({
      status: 'signedIn',
      backend: 'museCode',
    })
  })

  // `account/logout` cleared the file, but META_API_KEY made `account/read`
  // answer `envKey`, which confirms nothing.
  it('opens no muse logout terminal once the file shows no sign-in after an unconfirmed logout', async () => {
    const h = harness()
    h.facts.cli = 'signedIn'
    h.facts.envKey = true
    await h.service.refresh()
    h.logOutCli.mockImplementation(() => {
      h.facts.cli = 'signedOut'
      return Promise.resolve(false)
    })
    await h.service.signOut()
    expect(h.logOutCli).toHaveBeenCalledOnce()
    expect(h.forgetCliAnswers).toHaveBeenCalled()
    expect(h.runInTerminal).not.toHaveBeenCalled()
  })

  // The window closed while a click was still asking the CLI whether the
  // held sign-in can be replaced: no host starts afterwards, and no later
  // click starts one or opens a key prompt (the review of PR #49).
  it('starts no sign-in once the window is closing, not even from a click in its pre-flight', async () => {
    const h = await heldCliSignIn()
    const preflight = Promise.withResolvers<CliSignIn>()
    let isAsking = false
    h.cliSignIn.mockImplementationOnce(() => {
      isAsking = true
      return preflight.promise
    })
    const clicked = h.service.signIn('browser')
    await vi.waitFor(() => {
      expect(isAsking).toBe(true)
    })
    await h.service.stopSignIn()
    preflight.resolve('signedIn')
    await clicked
    expect(h.runDeviceSignIn).not.toHaveBeenCalled()
  })

  it('opens no key prompt and starts no device flow once the window is closing', async () => {
    const h = harness()
    await h.service.refresh()
    await h.service.stopSignIn()
    await expect(h.service.signIn('apiKey')).resolves.toMatchObject({ status: 'signedOut' })
    await h.service.signIn('browser')
    expect(h.deps.promptForApiKey).not.toHaveBeenCalled()
    expect(h.runDeviceSignIn).not.toHaveBeenCalled()
  })

  // A refresh that released the hold, then answered after a whole sign-out
  // ran and released it too, must not put the hold back (the review of PR
  // #49).
  it('leaves the hold as a finished sign-out left it when a refresh answers late', async () => {
    const h = harness()
    h.facts.envKey = true
    await h.service.refresh()
    await h.service.signOut()
    expect(h.logoutHoldState.isHeld).toBe(true)
    h.facts.envKey = false
    const late = Promise.withResolvers<CliSignIn>()
    let asked = 0
    // The third question is the refresh's look after it released the hold.
    h.cliSignIn.mockImplementation(() =>
      ++asked === 3 ? late.promise : Promise.resolve(h.facts.cli),
    )
    const stale = h.service.refresh()
    await vi.waitFor(() => {
      expect(asked).toBe(3)
    })
    await expect(h.service.signOut()).resolves.toMatchObject({ status: 'signedOut' })
    expect(h.logoutHoldState.isHeld).toBe(false)
    late.resolve('signedOut')
    await stale
    expect(h.logoutHoldState.isHeld).toBe(false)
    expect(h.service.current.status).toBe('signedOut')
  })

  // Cancel with the hold on, or with a Model API session: the code leaves
  // the panel before the refresh that follows, which may wait on the CLI
  // (the review of PR #49).
  it.each([
    ['with the logout hold on', true],
    ['with a Model API session', false],
  ])('clears the code at once after Cancel %s', async (_name, isHeld) => {
    const h = isHeld ? await heldCliSignIn() : await signedInModelApi()
    h.runDeviceSignIn.mockImplementation(async (signal, onCode) => {
      onCode('https://auth.meta.com/oauth/device/', 'ABCD-EFGH')
      await aborted(signal)
      return 'cancelled'
    })
    const signingIn = h.service.signIn('browser')
    await vi.waitFor(() => {
      expect(h.service.current.userCode).toBe('ABCD-EFGH')
    })
    const refreshing = Promise.withResolvers<CliSignIn>()
    let isRefreshAsking = false
    h.cliSignIn.mockImplementation(() => {
      isRefreshAsking = true
      return refreshing.promise
    })
    h.service.cancelSignIn()
    await vi.waitFor(() => {
      expect(isRefreshAsking).toBe(true)
    })
    expect(h.service.current).toMatchObject({ userCode: undefined, verificationUrl: undefined })
    expect(h.broadcasts.findLast((message) => message.type === 'authState')).not.toHaveProperty(
      'userCode',
    )
    refreshing.resolve(h.facts.cli)
    await signingIn
  })

  // Two refreshes answer out of order: the older one's facts never replace
  // what the newer one published (the review of PR #49).
  it('never publishes an older refresh over a newer one', async () => {
    const h = harness()
    const older = Promise.withResolvers<CliSignIn>()
    h.cliSignIn.mockImplementationOnce(() => older.promise)
    const stale = h.service.refresh()
    h.facts.cli = 'signedIn'
    await expect(h.service.refresh()).resolves.toMatchObject({ status: 'signedIn' })
    const published = h.broadcasts.length
    older.resolve('signedOut')
    await expect(stale).resolves.toMatchObject({ status: 'signedIn' })
    expect(h.service.current.status).toBe('signedIn')
    expect(h.broadcasts).toHaveLength(published)
  })

  // A refresh while the browser sign-in waits (a setting changed) leaves the
  // code on screen; the flow publishes its own ending (the review of PR #49).
  it('keeps the device code on screen through a refresh while the flow waits', async () => {
    const h = harness()
    const runner = Promise.withResolvers<DeviceSignInOutcome>()
    h.runDeviceSignIn.mockImplementation((_signal, onCode) => {
      onCode('https://auth.meta.com/oauth/device/', 'ABCD-EFGH')
      return runner.promise
    })
    const signingIn = h.service.signIn('browser')
    await vi.waitFor(() => {
      expect(h.service.current.userCode).toBe('ABCD-EFGH')
    })
    await h.service.refresh()
    expect(h.service.current).toMatchObject({ status: 'signingIn', userCode: 'ABCD-EFGH' })
    runner.resolve('timedOut')
    await expect(signingIn).resolves.toMatchObject({ status: 'signedOut', userCode: undefined })
  })

  // The window closing: its host must be closed before the backends stop.
  it('cancels the browser sign-in and waits for it to end', async () => {
    const h = harness()
    h.runDeviceSignIn.mockImplementation(async (signal) => {
      await aborted(signal)
      await new Promise((resolve) => setTimeout(resolve, 10))
      return 'cancelled'
    })
    const pending = h.service.signIn('browser')
    await vi.waitFor(() => {
      expect(h.runDeviceSignIn).toHaveBeenCalled()
    })
    await h.service.stopSignIn()
    expect(h.service.current.status).toBe('signedOut')
    await pending
  })
})

// Every path that can publish a sign-in on another backend than
// conversations run on ends those conversations first, through one helper
// (Codex on 1ae3604f).
describe('AuthService: a switch of backends ends the running one’s conversations first', () => {
  it('ends the Model API conversation when a Cancel still lands a CLI sign-in', async () => {
    const h = await signedInModelApi()
    const generation = h.service.admissionGeneration
    await expect(cancelAfterApproval(h)).resolves.toMatchObject({
      status: 'signedIn',
      backend: 'museCode',
    })
    expect(h.restartBackend.mock.calls).toEqual([[true]])
    expect(h.service.admissionGeneration).toBeGreaterThan(generation)
  })

  it('ends the Model API conversation when Check again finds the CLI signed in', async () => {
    const h = await signedInModelApi()
    h.facts.cli = 'signedIn'
    await expect(h.service.checkAgain()).resolves.toMatchObject({
      status: 'signedIn',
      backend: 'museCode',
    })
    expect(h.restartBackend.mock.calls).toEqual([[true]])
  })

  it('ends the Model API conversation when a failed sign-in’s refresh finds the CLI signed in', async () => {
    const h = await signedInModelApi()
    h.runDeviceSignIn.mockImplementation(() => {
      h.facts.cli = 'signedIn'
      return Promise.resolve('timedOut')
    })
    await expect(h.service.signIn('browser')).resolves.toMatchObject({ backend: 'museCode' })
    expect(h.restartBackend.mock.calls).toEqual([[true]])
  })

  it('ends the Muse Code conversation when a pasted key moves conversations to the Model API', async () => {
    const h = harness()
    h.facts.cli = 'signedIn'
    await h.service.refresh()
    // The CLI turned out signed out mid-conversation.
    h.service.markAuthRequired('authRequired')
    h.facts.cli = 'signedOut'
    await expect(h.service.signIn('apiKey')).resolves.toMatchObject({
      status: 'signedIn',
      backend: 'modelApi',
    })
    expect(h.restartBackend.mock.calls).toEqual([[false], [true]])
  })

  it('ends the Model API conversation when a failed install finds the CLI signed in', async () => {
    const h = await signedInModelApi()
    h.facts.cliPresent = false
    h.runInstallerInTerminal.mockImplementation(() => {
      h.facts.cliPresent = true
      h.facts.cli = 'signedIn'
      throw new Error('terminal unavailable')
    })
    await expect(h.service.installMuseCode()).resolves.toMatchObject({
      status: 'signedIn',
      backend: 'museCode',
    })
    expect(h.restartBackend.mock.calls).toEqual([[true]])
  })

  // A newer refresh signs in while an older switch's restart is still under
  // way: that restart's late end leaves the newer record, so the next switch
  // still ends its conversations (Codex on 19e74b07).
  it('keeps the backend a newer refresh signed in on when an older restart ends', async () => {
    const { h, stopping, switching } = await switchHeldInRestart()
    await expect(h.service.refresh()).resolves.toMatchObject({ backend: 'museCode' })
    stopping.resolve(undefined)
    await switching
    h.facts.cli = 'signedOut'
    await expect(h.service.refresh()).resolves.toMatchObject({ backend: 'modelApi' })
    expect(h.restartBackend.mock.calls).toEqual([[true], [true], [true]])
  })

  // An older switch's restart fails after a newer refresh, or a sign-out,
  // published: the failure does not replace the newer state (Codex on
  // 86d63652).
  it.each([
    ['a newer refresh', 'signedIn'],
    ['a sign-out', 'signedOut'],
  ] as const)('lets %s stand when an older switch’s restart fails late', async (newer, status) => {
    const { h, stopping, switching } = await switchHeldInRestart()
    await (newer === 'a sign-out' ? h.service.signOut() : h.service.refresh())
    stopping.reject(new Error('the host would not stop'))
    await switching
    expect(h.service.current.status).toBe(status)
  })

  // A finished sign-in's restart fails after a newer refresh published: the
  // flow's failure does not replace it (Codex on 86d63652).
  it('lets a newer refresh stand when a finished sign-in’s restart fails late', async () => {
    const h = harness()
    const stopping = Promise.withResolvers<undefined>()
    h.restartBackend.mockImplementationOnce(() => stopping.promise)
    h.runDeviceSignIn.mockImplementation(() => {
      h.facts.cli = 'signedIn'
      return Promise.resolve('signedIn')
    })
    const signingIn = h.service.signIn('browser')
    await vi.waitFor(() => {
      expect(h.restartBackend).toHaveBeenCalledOnce()
    })
    await expect(h.service.refresh()).resolves.toMatchObject({ status: 'signedIn' })
    stopping.reject(new Error('the host would not stop'))
    await signingIn
    expect(h.service.current).toMatchObject({ status: 'signedIn', backend: 'museCode' })
  })

  // A failed install asks for the selection; a newer state published while
  // it asked stands (Codex on 86d63652).
  it('lets a newer state stand when a failed install’s question answers late', async () => {
    const h = await signedInModelApi()
    h.facts.cliPresent = false
    const late = Promise.withResolvers<CliSignIn>()
    let isAsking = false
    h.runInstallerInTerminal.mockImplementation(() => {
      h.cliSignIn.mockImplementationOnce(() => {
        isAsking = true
        return late.promise
      })
      throw new Error('terminal unavailable')
    })
    const installing = h.service.installMuseCode()
    await vi.waitFor(() => {
      expect(isAsking).toBe(true)
    })
    h.service.markAuthRequired('authRequired')
    late.resolve('signedOut')
    await installing
    expect(h.service.current).toMatchObject({ status: 'signedOut', detail: 'authRequired' })
  })

  // An older logout-hold write fails after newer ones were saved: the hold
  // is saved as it stands, so admission is not held shut (Codex on
  // 19e74b07).
  it('keeps the latest logout-hold write’s outcome when an older one fails late', async () => {
    const older = Promise.withResolvers<undefined>()
    let writes = 0
    const h = harness({
      logoutHold: {
        get: () => true,
        set: () => (++writes === 1 ? older.promise : Promise.resolve()),
      },
    })
    const releasing = h.service.refresh()
    await vi.waitFor(() => {
      expect(writes).toBe(1)
    })
    await h.service.signOut()
    older.reject(new Error('state storage unavailable'))
    await releasing
    await expect(h.service.signIn('apiKey')).resolves.toMatchObject({ backend: 'modelApi' })
    expect(h.service.backend).toBe('modelApi')
  })

  // A sign-out already ended every conversation: the next sign-in on the
  // other backend has none to end.
  it('ends conversations once: a sign-out leaves none for the next sign-in to end', async () => {
    const h = harness()
    h.facts.cli = 'signedIn'
    await h.service.refresh()
    await h.service.signOut()
    await expect(h.service.signIn('apiKey')).resolves.toMatchObject({ backend: 'modelApi' })
    expect(h.restartBackend.mock.calls).toEqual([[true], [false]])
  })
})

describe('AuthService.installMuseCode', () => {
  it('reports terminal launch failure without signing out a Model API session', async () => {
    const h = await signedInModelApi()
    h.facts.cliPresent = false
    h.runInstallerInTerminal.mockImplementation(() => {
      throw new Error('terminal unavailable')
    })
    await expect(h.service.installMuseCode()).resolves.toMatchObject({
      status: 'signedIn',
      backend: 'modelApi',
      installState: 'failed',
      detail: 'The installer terminal could not open. Try again or use the install instructions.',
    })
    expect(h.broadcasts).toContainEqual(
      expect.objectContaining({ type: 'notice', level: 'warning' }),
    )
    expect(h.restartBackend).not.toHaveBeenCalled()
  })

  it('does not restore an old Model API session when install times out after sign-out', async () => {
    let clock = 0
    const poll = Promise.withResolvers<undefined>()
    const h = harness({
      now: () => clock,
      sleep: () => poll.promise,
    })
    h.facts.cliPresent = false
    await h.deps.credentials.setApiKey('LLM|1|secret')
    await h.service.refresh()
    const pending = h.service.installMuseCode()
    expect(h.runInstallerInTerminal).toHaveBeenCalledOnce()
    await h.service.signOut()
    clock = MUSE_INSTALL_TIMEOUT_MS
    poll.resolve(undefined)
    await pending
    expect(await h.deps.credentials.getApiKey()).toBeUndefined()
    expect(h.service.current.status).not.toBe('signedIn')
  })

  it('does not restore a signed-in state when the installer fails during sign-out', async () => {
    let clock = 0
    const poll = Promise.withResolvers<undefined>()
    const stopping = Promise.withResolvers<undefined>()
    const h = await signedInModelApi({
      now: () => clock,
      sleep: () => poll.promise,
    })
    h.facts.cliPresent = false
    h.restartBackend.mockImplementation(() => stopping.promise)

    const installing = h.service.installMuseCode()
    const signingOut = h.service.signOut()
    clock = MUSE_INSTALL_TIMEOUT_MS
    poll.resolve(undefined)
    const installResult = await installing
    const visibleDuringSignOut = h.service.current.status
    stopping.resolve(undefined)
    await signingOut

    expect(installResult.status).not.toBe('signedIn')
    expect(visibleDuringSignOut).not.toBe('signedIn')
  })

  it('keeps a logout hold when an installer terminal fails after the CLI appears', async () => {
    const h = harness()
    h.facts.cliPresent = false
    h.facts.envKey = true
    await h.service.refresh()
    await h.service.signOut()
    h.runInstallerInTerminal.mockImplementation(() => {
      h.facts.cliPresent = true
      throw new Error('terminal unavailable')
    })

    const result = await h.service.installMuseCode()
    expect(result.status).not.toBe('signedIn')
    expect(h.service.backend).toBeUndefined()
    expect(h.logoutHoldState.isHeld).toBe(true)
  })

  it('does not open an installer terminal after sign-out has started', async () => {
    const stopping = Promise.withResolvers<undefined>()
    const h = harness()
    h.facts.cliPresent = false
    h.restartBackend.mockImplementation(() => stopping.promise)

    const signingOut = h.service.signOut()
    const result = await h.service.installMuseCode()
    stopping.resolve(undefined)
    await signingOut

    expect(result.status).not.toBe('signedIn')
    expect(h.runInstallerInTerminal).not.toHaveBeenCalled()
  })

  it('keeps a signed-in Model API session while watching a CLI install', async () => {
    const h = harness()
    h.facts.cliPresent = false
    await h.deps.credentials.setApiKey('LLM|1|secret')
    await h.service.refresh()
    h.runInstallerInTerminal.mockImplementation(() => {
      h.facts.cliPresent = true
    })
    await h.service.installMuseCode()
    expect(h.broadcasts).toContainEqual(
      expect.objectContaining({
        type: 'authState',
        status: 'signedIn',
        backend: 'modelApi',
        installState: 'running',
      }),
    )
    expect(h.service.current).toMatchObject({
      status: 'signedIn',
      backend: 'modelApi',
      hasCli: true,
    })
    expect(h.restartBackend).not.toHaveBeenCalled()
  })

  it('keeps Model API signed in when the CLI install times out', async () => {
    const h = harness()
    h.facts.cliPresent = false
    await h.deps.credentials.setApiKey('LLM|1|secret')
    await h.service.refresh()
    await expect(h.service.installMuseCode()).resolves.toMatchObject({
      status: 'signedIn',
      backend: 'modelApi',
      installState: 'failed',
      hasCli: false,
    })
    expect(h.restartBackend).not.toHaveBeenCalled()
  })

  it('stores a secondary key without restarting a signed-in Muse Code session', async () => {
    const h = harness()
    h.facts.cli = 'signedIn'
    await h.service.refresh()
    await h.service.signIn('apiKey')
    expect(h.service.current).toMatchObject({ status: 'signedIn', backend: 'museCode' })
    expect(await h.deps.credentials.getApiKey()).toBe('LLM|1|secret')
    expect(h.restartBackend).not.toHaveBeenCalled()
  })

  it('retires an active Model API session before auto-selecting the newly installed CLI', async () => {
    const h = await signedInModelApi()
    h.facts.cliPresent = false
    h.runInstallerInTerminal.mockImplementation(() => {
      h.facts.cliPresent = true
      h.facts.cli = 'signedIn'
    })
    const selected = await h.service.installMuseCode()
    expect(selected).toMatchObject({ status: 'signedIn', backend: 'museCode' })
    expect(h.restartBackend).toHaveBeenCalledWith(true)
  })

  it('retires the active Model API session when the CLI appeared before Install was pressed', async () => {
    const h = await signedInModelApi()
    h.facts.cliPresent = true
    h.facts.cli = 'signedIn'
    const selected = await h.service.installMuseCode()
    expect(selected).toMatchObject({ status: 'signedIn', backend: 'museCode' })
    expect(h.restartBackend).toHaveBeenCalledWith(true)
    expect(h.runInstallerInTerminal).not.toHaveBeenCalled()
  })

  it('keeps admission closed if the old host cannot stop during installer auto-switch', async () => {
    const h = await signedInModelApi()
    h.facts.cliPresent = false
    h.runInstallerInTerminal.mockImplementation(() => {
      h.facts.cliPresent = true
      h.facts.cli = 'signedIn'
    })
    h.restartBackend.mockRejectedValue(new Error('cannot stop'))
    const selected = await h.service.installMuseCode()
    expect(selected.status).toBe('error')
    expect(h.service.backend).toBeUndefined()
  })

  it('replaces the secondary key without ending the signed-in Muse Code session', async () => {
    const h = harness({ promptForApiKey: () => Promise.resolve('LLM|1|replacement') })
    h.facts.cli = 'signedIn'
    await h.deps.credentials.setApiKey('LLM|1|secret')
    await h.service.refresh()
    await h.service.signIn('apiKey')
    expect(await h.deps.credentials.getApiKey()).toBe('LLM|1|replacement')
    expect(h.service.current).toMatchObject({ status: 'signedIn', backend: 'museCode' })
    expect(h.restartBackend).not.toHaveBeenCalled()
  })

  it('opens one installer terminal and notices the CLI', async () => {
    const h = harness()
    h.facts.cliPresent = false
    h.runInstallerInTerminal.mockImplementation(() => {
      h.facts.cliPresent = true
    })
    const first = h.service.installMuseCode()
    const second = h.service.installMuseCode()
    await expect(Promise.all([first, second])).resolves.toMatchObject([
      { status: 'signedOut' },
      { status: 'signedOut' },
    ])
    expect(h.runInstallerInTerminal).toHaveBeenCalledOnce()
    expect(
      h.broadcasts.some(
        (message) => message.type === 'authState' && message.status === 'installing',
      ),
    ).toBe(true)
  })

  it('does not run an installer when the CLI is already present', async () => {
    const h = harness()
    await h.service.installMuseCode()
    expect(h.runInstallerInTerminal).not.toHaveBeenCalled()
  })
})

describe('AuthService.signOut and host reports', () => {
  it('keeps admission closed while two panels sign out and one stop is held', async () => {
    const h = await signedInModelApi()
    const heldStop = Promise.withResolvers<undefined>()
    let stops = 0
    h.restartBackend.mockImplementation((isEnding) =>
      isEnding && ++stops === 1 ? heldStop.promise : Promise.resolve(),
    )
    const firstPanel = h.service.signOut()
    const secondPanel = h.service.signOut()
    await new Promise<undefined>((resolve) => {
      setImmediate(() => {
        resolve(undefined)
      })
    })
    await h.service.signIn('apiKey')
    const admittedDuringSignOut = h.service.backend
    heldStop.resolve(undefined)
    await Promise.allSettled([firstPanel, secondPanel])
    expect(admittedDuringSignOut).toBeUndefined()
    expect(await h.deps.credentials.getApiKey()).toBeUndefined()
  })

  it('does not start an old browser click after a newer sign-out', async () => {
    const delayedRead = Promise.withResolvers<string | undefined>()
    const secrets = memorySecrets()
    let isNextReadDelayed = false
    const credentials = new CredentialStore(
      {
        get: (key) => {
          if (isNextReadDelayed) {
            isNextReadDelayed = false
            return delayedRead.promise
          }
          return secrets.get(key)
        },
        store: secrets.store,
        delete: secrets.delete,
      },
      unexpectedWarning,
    )
    const h = withLogoutFallback(harness({ credentials }))
    h.facts.cli = 'signedIn'
    await h.service.refresh()
    await h.service.signOut()

    isNextReadDelayed = true
    const staleClick = h.service.signIn('browser')
    await h.service.signOut()
    delayedRead.resolve(undefined)
    await staleClick

    expect(h.runDeviceSignIn).not.toHaveBeenCalled()
    expect(h.logoutHoldState.isHeld).toBe(true)
  })

  it('recovers a held old CLI sign-in through an explicit fresh device approval', async () => {
    const h = await heldCliSignIn()
    h.runDeviceSignIn.mockResolvedValue('signedIn')
    await expect(h.service.signIn('browser')).resolves.toMatchObject({
      status: 'signedIn',
      backend: 'museCode',
    })
    expect(h.runDeviceSignIn).toHaveBeenCalledOnce()
    expect(h.logoutHoldState.isHeld).toBe(false)
  })

  it('keeps the hold when the CLI does not confirm a device runner’s success', async () => {
    const h = withLogoutFallback(harness())
    h.facts.cli = 'signedIn'
    await h.service.refresh()
    await h.service.signOut()
    h.runDeviceSignIn.mockImplementation(() => {
      // The file changed, but `account/read` could not say whose sign-in it holds.
      h.facts.cli = 'unknown'
      return Promise.resolve('signedIn')
    })
    await expect(h.service.signIn('browser')).resolves.toMatchObject({ status: 'error' })
    expect(h.runDeviceSignIn).toHaveBeenCalledOnce()
    expect(h.logoutHoldState.isHeld).toBe(true)
    expect(h.restartBackend.mock.calls).toEqual([[true]])
  })

  it('gates auth and starts ending sessions before hold persistence settles', async () => {
    const saving = Promise.withResolvers<undefined>()
    const h = harness({
      logoutHold: {
        get: () => false,
        set: (isHeld) => (isHeld ? saving.promise : Promise.resolve()),
      },
    })
    h.facts.cli = 'signedIn'
    await h.service.refresh()
    const ending = h.service.signOut()
    expect(h.service.current.status).toBe('error')
    expect(h.service.backend).toBeUndefined()
    expect(h.restartBackend).toHaveBeenCalledWith(true)
    saving.resolve(undefined)
    await ending
  })

  it('still ends the host and reports an error when SecretStorage key deletion fails', async () => {
    const secrets = memorySecrets()
    const credentials = new CredentialStore(
      {
        get: secrets.get,
        store: secrets.store,
        delete: () => Promise.reject(new Error('keyring unavailable')),
      },
      unexpectedWarning,
    )
    const h = harness({ credentials })
    h.facts.cli = 'signedIn'
    await credentials.setApiKey('LLM|1|secret')
    await h.service.refresh()
    await expect(h.service.signOut()).resolves.toMatchObject({
      status: 'error',
      detail: expect.stringContaining('Model API key'),
    })
    expect(h.restartBackend).toHaveBeenCalledWith(true)
    expect(h.service.backend).toBeUndefined()
  })

  it('ends the host and clears the key when the CLI logout terminal cannot open', async () => {
    const h = withLogoutFallback(harness())
    h.facts.cli = 'signedIn'
    await h.deps.credentials.setApiKey('LLM|1|secret')
    await h.service.refresh()
    h.runInTerminal.mockImplementation(() => {
      throw new Error('terminal unavailable')
    })
    // `error`: the panel offers Check again, which the detail asks for (the
    // review of PR #49).
    await expect(h.service.signOut()).resolves.toMatchObject({
      status: 'error',
      detail: expect.stringContaining('terminal'),
    })
    expect(h.restartBackend).toHaveBeenCalledWith(true)
    expect(await h.deps.credentials.getApiKey()).toBeUndefined()
    await expect(h.service.refresh()).resolves.toMatchObject({ status: 'error' })
  })

  it('keeps an environment-authenticated CLI gated until its key is removed', async () => {
    const h = harness()
    h.facts.envKey = true
    await h.service.refresh()
    await expect(h.service.signOut()).resolves.toMatchObject({
      status: 'error',
      detail: expect.stringContaining('META_API_KEY'),
    })
    expect(h.runInTerminal).not.toHaveBeenCalled()
    expect(h.logOutCli).not.toHaveBeenCalled()
    await expect(h.service.refresh()).resolves.toMatchObject({
      status: 'error',
      detail: expect.stringContaining('META_API_KEY'),
    })
    expect(h.service.backend).toBeUndefined()
    h.facts.envKey = false
    await expect(h.service.refresh()).resolves.toMatchObject({
      status: 'signedOut',
      detail: undefined,
    })
  })

  // `muse logout` rewrites auth.json as {"schema_version": 1, "providers": {}}
  // and never deletes it (1.3.0 and 1.4.0, every OS): the hold ends when the
  // CLI reports no sign-in, although the file is still there.
  it('does not reassert CLI sign-in until terminal logout has emptied the credential file', async () => {
    const h = withLogoutFallback(harness())
    h.facts.cli = 'signedIn'
    await h.service.refresh()
    await h.service.signOut()
    expect(h.runInTerminal).toHaveBeenCalledWith('/bin/muse', ['logout'])
    await expect(h.service.refresh()).resolves.toMatchObject({
      status: 'error',
      detail: EN.signOutPending,
    })
    h.facts.cli = 'signedOut'
    await expect(h.service.refresh()).resolves.toMatchObject({
      status: 'signedOut',
      detail: undefined,
    })
    expect(h.logoutHoldState.isHeld).toBe(false)
    expect(h.service.backend).toBeUndefined()
  })

  it('does not publish a stale signed-in choice when the held CLI key disappears during refresh', async () => {
    const pendingRead = Promise.withResolvers<string | undefined>()
    const secrets = memorySecrets()
    let isReadDelayed = false
    const credentials = new CredentialStore(
      {
        get: (key) => (isReadDelayed ? pendingRead.promise : secrets.get(key)),
        store: secrets.store,
        delete: secrets.delete,
      },
      unexpectedWarning,
    )
    const h = harness({ credentials })
    h.facts.envKey = true
    await h.service.refresh()
    await h.service.signOut()
    isReadDelayed = true
    const refreshing = h.service.refresh()
    h.facts.envKey = false
    pendingRead.resolve(undefined)
    await expect(refreshing).resolves.toMatchObject({ status: 'signedOut' })
    expect(h.service.backend).toBeUndefined()
  })

  it('keeps the logout hold across a new AuthService using the same stored state', async () => {
    const h = harness()
    h.facts.envKey = true
    await h.service.refresh()
    await h.service.signOut()
    expect(h.logoutHoldState.isHeld).toBe(true)
    const reactivated = new AuthService(h.deps)
    await expect(reactivated.refresh()).resolves.toMatchObject({ status: 'error' })
    h.facts.envKey = false
    await expect(reactivated.refresh()).resolves.toMatchObject({ status: 'signedOut' })
    expect(h.logoutHoldState.isHeld).toBe(false)
  })

  it('closes the host and reports an error when the logout hold cannot be persisted', async () => {
    const h = harness({
      logoutHold: {
        get: () => false,
        set: () => Promise.reject(new Error('state storage unavailable')),
      },
    })
    h.facts.envKey = true
    await h.service.refresh()
    await expect(h.service.signOut()).resolves.toMatchObject({
      status: 'error',
      detail: expect.stringContaining('save'),
    })
    expect(h.restartBackend).toHaveBeenCalledWith(true)
    expect(h.service.backend).toBeUndefined()
  })

  it('does not let browser approval reuse a still-present pay-as-you-go environment key', async () => {
    const h = harness()
    h.facts.envKey = true
    await h.service.refresh()
    await h.service.signOut()
    h.runDeviceSignIn.mockImplementation(() => {
      h.facts.cli = 'signedIn'
      return Promise.resolve('signedIn')
    })
    await expect(h.service.signIn('browser')).resolves.toMatchObject({
      status: 'error',
      detail: expect.stringContaining('META_API_KEY'),
    })
    expect(h.restartBackend.mock.calls).toEqual([[true]])
    expect(h.logoutHoldState.isHeld).toBe(true)
  })

  it('clears the key, signs the CLI out through account/logout, and restarts', async () => {
    const h = harness()
    await h.service.signIn('apiKey')
    h.facts.cli = 'signedIn'
    await expect(h.service.signOut()).resolves.toMatchObject({
      status: 'signedOut',
      detail: undefined,
      hasCliSession: false,
    })
    await expect(h.deps.credentials.getApiKey()).resolves.toBeUndefined()
    expect(h.logOutCli).toHaveBeenCalledOnce()
    expect(h.runInTerminal).not.toHaveBeenCalled()
    // The CLI confirmed it: no hold is left to wait out.
    expect(h.logoutHoldState.isHeld).toBe(false)
    expect(h.restartBackend).toHaveBeenCalledTimes(2)
    // A sign-in keeps the conversations; a sign-out ends them (D25).
    expect(h.restartBackend.mock.calls).toEqual([[false], [true]])
    // Sign-out is a click: macOS may ask the CLI about a Keychain sign-in.
    expect(h.cliSignIn.mock.calls.at(-1)).toEqual([true])
  })

  // The hold is kept: `error`, so the panel offers the Check again its
  // detail asks for, as `refresh` does for the same state (the review of PR
  // #49).
  it('falls back to muse logout in a terminal when account/logout does not confirm', async () => {
    const h = withLogoutFallback(harness())
    h.facts.cli = 'signedIn'
    await h.service.refresh()
    await expect(h.service.signOut()).resolves.toMatchObject({
      status: 'error',
      detail: EN.signOutPending,
    })
    expect(h.logOutCli).toHaveBeenCalledOnce()
    expect(h.runInTerminal).toHaveBeenLastCalledWith('/bin/muse', ['logout'])
    expect(h.logoutHoldState.isHeld).toBe(true)
  })

  it('does not sign the CLI out when it holds no sign-in', async () => {
    const h = harness()
    await h.service.signOut()
    expect(h.logOutCli).not.toHaveBeenCalled()
    expect(h.runInTerminal).not.toHaveBeenCalled()
  })

  it('signs out a sign-in only the CLI could confirm, and counts it until then', async () => {
    const h = harness()
    h.facts.cli = 'unknown'
    await expect(h.service.refresh()).resolves.toMatchObject({
      status: 'signedIn',
      backend: 'museCode',
    })
    await expect(h.service.signOut()).resolves.toMatchObject({ status: 'signedOut' })
    expect(h.logOutCli).toHaveBeenCalledOnce()
    expect(h.logoutHoldState.isHeld).toBe(false)
  })

  // The reason is the backend's own text: the panel shows it, the log only
  // in the shape of a protocol word (the review of PR #49).
  it('logs an authRequired reason only in the shape of a protocol word', () => {
    const log = new FakeLogOutputChannel()
    const h = harness({ log })
    const reason = String.raw`not signed in; see C:\Users\someone\.config\muse`
    expect(h.service.markAuthRequired(reason)).toMatchObject({ detail: reason })
    expect(log.warn).toHaveBeenCalledWith(
      'The backend reported authRequired: an unrecognized value',
    )
    h.service.markAuthRequired('authRequired')
    expect(log.warn).toHaveBeenLastCalledWith('The backend reported authRequired: authRequired')
  })

  it('accepts the host verdict over its own estimate', async () => {
    const h = harness()
    h.facts.cli = 'signedIn'
    await h.service.refresh()
    expect(h.service.markAuthRequired('not logged in')).toMatchObject({
      status: 'signedOut',
      detail: 'not logged in',
      backend: 'museCode',
    })
    expect(h.service.markBackendError('crashed')).toMatchObject({
      status: 'error',
      detail: 'crashed',
    })
    expect(h.service.toMessage()).toEqual({
      type: 'authState',
      status: 'error',
      detail: 'crashed',
      backend: 'museCode',
      methods: ['browser', 'apiKey'],
      installCommand: 'irm https://dev.meta.ai/install.ps1 | iex',
      hasCli: true,
      hasCliSession: true,
    })
  })
})

// `expired`, `denied` and `failed` as captured live (2026-09-27); any other
// ending as Muse Code named it.
describe('AuthService: how Muse Code ends a browser sign-in (D26)', () => {
  it.each([
    ['the captured expired', 'expired', EN.signInExpired],
    ['the captured denied', 'denied', 'You denied the sign-in in the browser.'],
    ['the captured failed', 'failed', 'Muse Code signed in but could not save the credential.'],
    [
      'an unknown',
      { endedAs: 'somethingNew' },
      'Sign-in ended: somethingNew. Sign in again to get a new code.',
    ],
  ] as const)(
    'ends %s sign-in at once, signed out with its reason',
    async (_name, outcome, text) => {
      const h = harness()
      h.runDeviceSignIn.mockResolvedValue(outcome)
      await expect(h.service.signIn('browser')).resolves.toMatchObject({
        status: 'signedOut',
        detail: text,
      })
      expect(h.restartBackend).not.toHaveBeenCalled()
    },
  )

  it('keeps a live Model API session after a CLI sign-in ends unsigned, with a notice', async () => {
    const h = await signedInModelApi()
    h.runDeviceSignIn.mockResolvedValue('denied')
    await expect(h.service.signIn('browser')).resolves.toMatchObject({
      status: 'signedIn',
      backend: 'modelApi',
    })
    expect(h.broadcasts).toContainEqual({
      type: 'notice',
      level: 'warning',
      text: EN.signInDenied,
    })
  })
})

describe('AuthService: a credential file Muse Code cannot start with (D26)', () => {
  it('names a macOS file on Windows or Linux instead of offering a dead sign-in', async () => {
    const h = harness()
    h.facts.cli = 'unsupportedHere'
    const refreshed = await h.service.refresh()
    expect(refreshed).toMatchObject({ status: 'error', backend: 'museCode', hasCliSession: false })
    expect(refreshed.detail).toBe(fill(EN.cliCredentialUnsupported, { path: CREDENTIAL_PATH }))
    expect(h.service.backend).toBeUndefined()
    await expect(h.service.signIn('browser')).resolves.toMatchObject({ status: 'error' })
    expect(h.runDeviceSignIn).not.toHaveBeenCalled()
  })

  it('does not block the Model API key a user already stored', async () => {
    const h = await signedInModelApi()
    h.facts.cli = 'unsupportedHere'
    await expect(h.service.refresh()).resolves.toMatchObject({
      status: 'signedIn',
      backend: 'modelApi',
      detail: undefined,
    })
  })

  // The panel shows the path; the log names the state in fixed words, since
  // the path is under the user's profile (the review of PR #49).
  it('logs no credential path for that state', async () => {
    const log = new FakeLogOutputChannel()
    const h = harness({ log })
    h.facts.cli = 'unsupportedHere'
    await h.service.refresh()
    expect(log.info).toHaveBeenCalledWith(
      'Sign-in state: error on the museCode backend: the Muse Code credential file is in a format Muse Code cannot start with on this system',
    )
    expect(log.info.mock.calls.flat().join('\n')).not.toContain(CREDENTIAL_PATH)
    expect(h.service.current.detail).toContain(CREDENTIAL_PATH)
  })

  // Captured on Windows and Linux: with META_API_KEY set `muse serve` starts
  // with an empty version-2 file, a version-2 pointer and a version-1
  // Keychain lane, and answers `envKey` (probe-v2-serve-win.json,
  // probe-v2-serve-linux.json).
  it('leaves the file to the CLI while META_API_KEY signs it in', async () => {
    const h = harness()
    h.facts.envKey = true
    h.facts.cli = 'unsupportedHere'
    await expect(h.service.refresh()).resolves.toMatchObject({ status: 'signedIn' })
    expect(h.cliSignIn).not.toHaveBeenCalled()
  })
})

describe('AuthService: when the CLI may be asked (macOS Keychain prompts follow a click)', () => {
  it('does not let a passive refresh ask, and lets Check again and sign-in ask', async () => {
    const h = harness()
    await h.service.refresh()
    expect(h.cliSignIn.mock.calls.every(([isUserAction]) => !isUserAction)).toBe(true)
    h.cliSignIn.mockClear()
    await h.service.refresh(true)
    expect(h.cliSignIn.mock.calls.length).toBeGreaterThan(0)
    expect(h.cliSignIn.mock.calls.every(([isUserAction]) => isUserAction)).toBe(true)
  })
})

// The same service over the CLI's real credential file in a temporary
// config home: the file shapes Muse Code 1.3.0 and 1.4.0 were captured
// writing (helpers/credentialShapes.ts), no token in any of them.
// Synthetic: a file cut short, which only the CLI can place.
const MALFORMED = '{"schema_version": 1, "providers": '
const SIGNED_IN_ANSWER: AccountState = { state: 'accountLogin', credentialRequired: true }
const LOGGED_OUT_ANSWER: AccountState = { state: 'loggedOut', credentialRequired: true }
// Not captured here: macOS's pointer as a third party observed it (aonia
// §2.3); on macOS it is asked of the CLI, on a user action only.
const MAC_POINTER =
  '{"schema_version":2,"providers":{"meta":{"mechanism":"oauth","storage":"keychain"}}}'

describe('AuthService over the CLI’s real credential file', () => {
  const homes: string[] = []
  afterEach(() => {
    for (const home of homes.splice(0)) {
      rmSync(home, { recursive: true, force: true })
    }
  })

  function withFile(contents: string | undefined, platform: NodeJS.Platform = 'linux') {
    const home = mkdtempSync(path.join(tmpdir(), 'muse-auth-'))
    homes.push(home)
    const file = path.join(home, 'muse', 'auth.json')
    mkdirSync(path.dirname(file), { recursive: true })
    if (contents !== undefined) {
      writeFileSync(file, contents)
    }
    const probe = vi.fn<() => Promise<AccountState | undefined>>(() => Promise.resolve(undefined))
    const account = new CliAccount({
      platform,
      credentialFilePath: () => file,
      probe,
      log: new FakeLogOutputChannel(),
    })
    const h = harness()
    const facts = h.deps.backend
    const service = new AuthService({
      ...h.deps,
      backend: {
        ...facts,
        cliSignIn: (isUserAction) => account.signIn(isUserAction),
        abandonCliProbe: () => {
          account.abandonProbe()
        },
        forgetCliAnswers: () => {
          account.forgetAnswers()
        },
        credentialFileModifiedAt: () => statSync(file, { throwIfNoEntry: false })?.mtimeMs,
      },
    })
    return { h, file, service, probe }
  }

  /**
   * A browser sign-in on macOS whose code is shown, then Cancel; `onShown`
   * runs as the code shows (the browser approving, a file rewritten).
   */
  async function cancelAfterCodeOnMacOs(
    t: ReturnType<typeof withFile>,
    onShown: () => void = () => undefined,
  ): Promise<AuthSnapshot> {
    t.h.runDeviceSignIn.mockImplementation(async (signal, onCode) => {
      onCode('https://auth.meta.com/oauth/device/', 'ABCD-EFGH')
      onShown()
      await aborted(signal)
      return 'cancelled'
    })
    const pending = t.service.signIn('browser')
    await vi.waitFor(() => {
      expect(t.service.current.userCode).toBe('ABCD-EFGH')
    })
    t.service.cancelSignIn()
    return await pending
  }

  // On macOS an approval may land in the Keychain alone, the pointer file
  // as it was: a Cancel after the code was shown asks the CLI afresh, past
  // the answer it gave before the flow (Codex on 55b9e24c).
  it('asks the CLI afresh on a Cancel after the code, when the Keychain alone changed', async () => {
    const t = withFile(MAC_POINTER, 'darwin')
    t.probe.mockResolvedValueOnce(LOGGED_OUT_ANSWER).mockResolvedValue(SIGNED_IN_ANSWER)
    await expect(t.service.refresh(true)).resolves.toMatchObject({ status: 'signedOut' })
    await expect(cancelAfterCodeOnMacOs(t)).resolves.toMatchObject({
      status: 'signedIn',
      backend: 'museCode',
    })
    expect(t.probe).toHaveBeenCalledTimes(2)
  })

  it('reports the Cancel when the CLI, asked afresh, is still signed out', async () => {
    const t = withFile(MAC_POINTER, 'darwin')
    t.probe.mockResolvedValue(LOGGED_OUT_ANSWER)
    await t.service.refresh(true)
    await expect(cancelAfterCodeOnMacOs(t)).resolves.toMatchObject({ status: 'signedOut' })
    expect(t.probe).toHaveBeenCalledTimes(2)
    expect(t.h.broadcasts).toContainEqual({
      type: 'notice',
      level: 'info',
      text: EN.signInCancelled,
    })
  })

  // The file changed as Cancel was pressed: Cancel is a click, so on macOS
  // the CLI is asked about the new file rather than estimated (Codex on
  // 55b9e24c).
  it('asks the CLI about a file rewritten as Cancel was pressed, on macOS too', async () => {
    const t = withFile(MAC_POINTER, 'darwin')
    t.probe.mockResolvedValue(SIGNED_IN_ANSWER)
    const rewrite = () => {
      writeFileSync(t.file, `${MAC_POINTER} `)
    }
    await expect(cancelAfterCodeOnMacOs(t, rewrite)).resolves.toMatchObject({
      status: 'signedIn',
    })
    expect(t.probe).toHaveBeenCalledOnce()
  })

  it('reads the empty file a sign-out leaves as signed out, without starting the CLI', async () => {
    const t = withFile(LOGOUT_SHELL)
    await expect(t.service.refresh()).resolves.toMatchObject({
      status: 'signedOut',
      hasCliSession: false,
    })
    expect(t.probe).not.toHaveBeenCalled()
  })

  // A Keychain logout removes the vault item and leaves the pointer file as it was.
  it('forgets the CLI answer once account/logout confirms, the file unchanged (the review of PR #49)', async () => {
    const t = withFile(MALFORMED)
    t.probe.mockResolvedValueOnce(SIGNED_IN_ANSWER).mockResolvedValue(LOGGED_OUT_ANSWER)
    await expect(t.service.refresh(true)).resolves.toMatchObject({ status: 'signedIn' })
    await expect(t.service.signOut()).resolves.toMatchObject({ status: 'signedOut' })
    expect(t.h.logoutHoldState.isHeld).toBe(false)
  })

  // A Keychain sign-in or sign-out made elsewhere leaves the file as it was:
  // Check again asks the CLI afresh (the review of PR #49).
  it('asks the CLI afresh on Check again, even about a sign-in it confirmed', async () => {
    const t = withFile(MALFORMED)
    t.probe.mockResolvedValueOnce(SIGNED_IN_ANSWER).mockResolvedValue(LOGGED_OUT_ANSWER)
    await expect(t.service.refresh(true)).resolves.toMatchObject({ status: 'signedIn' })
    await expect(t.service.refresh(true)).resolves.toMatchObject({ status: 'signedIn' })
    await expect(t.service.checkAgain()).resolves.toMatchObject({ status: 'signedOut' })
    expect(t.probe).toHaveBeenCalledTimes(2)
  })

  // Two presses of Check again while the CLI answers: the second joins the
  // first, rather than forgetting its probe and starting another host (the
  // review of PR #49).
  it('asks the CLI once however often Check again is pressed while it answers', async () => {
    const t = withFile(MALFORMED)
    const answer = Promise.withResolvers<AccountState | undefined>()
    t.probe.mockImplementation(() => answer.promise)
    const first = t.service.checkAgain()
    const second = t.service.checkAgain()
    answer.resolve(LOGGED_OUT_ANSWER)
    await expect(Promise.all([first, second])).resolves.toMatchObject([
      { status: 'signedOut' },
      { status: 'signedOut' },
    ])
    expect(t.probe).toHaveBeenCalledOnce()
    // Once it has answered, the next press asks afresh.
    await t.service.checkAgain()
    expect(t.probe).toHaveBeenCalledTimes(2)
  })

  // A passive refresh's probe answers after Check again forgot it and got a
  // newer answer: the old answer is never published (the review of PR #49).
  it('publishes no answer from a probe Check again left behind', async () => {
    const t = withFile(MALFORMED)
    const stale = Promise.withResolvers<AccountState | undefined>()
    t.probe.mockImplementationOnce(() => stale.promise).mockResolvedValue(LOGGED_OUT_ANSWER)
    const passive = t.service.refresh()
    await vi.waitFor(() => {
      expect(t.probe).toHaveBeenCalledOnce()
    })
    await expect(t.service.checkAgain()).resolves.toMatchObject({ status: 'signedOut' })
    const published = t.h.broadcasts.length
    stale.resolve(SIGNED_IN_ANSWER)
    await passive
    expect(t.service.current.status).toBe('signedOut')
    expect(t.h.broadcasts.slice(published)).not.toContainEqual(
      expect.objectContaining({ type: 'authState', status: 'signedIn' }),
    )
  })

  // A Keychain sign-in made elsewhere leaves the file as it was: the sign-out
  // must not decide on the `signedOut` the CLI said before it (the review of
  // PR #49).
  it('asks the CLI afresh at sign-out, so a sign-in made since is signed out', async () => {
    const t = withFile(MALFORMED)
    t.probe
      .mockResolvedValueOnce(LOGGED_OUT_ANSWER)
      .mockResolvedValueOnce(SIGNED_IN_ANSWER)
      .mockResolvedValue(LOGGED_OUT_ANSWER)
    await expect(t.service.refresh(true)).resolves.toMatchObject({ status: 'signedOut' })
    await expect(t.service.signOut()).resolves.toMatchObject({ status: 'signedOut' })
    expect(t.h.logOutCli).toHaveBeenCalledOnce()
    expect(t.h.logoutHoldState.isHeld).toBe(false)
  })

  // A sign-in that leaves the file as it was (a Keychain sign-in) is not
  // hidden by what the CLI said before it (the review of PR #49).
  it('asks the CLI afresh after a browser sign-in, the file unchanged', async () => {
    const t = withFile(MALFORMED)
    t.probe.mockResolvedValueOnce(LOGGED_OUT_ANSWER).mockResolvedValue(SIGNED_IN_ANSWER)
    await expect(t.service.refresh(true)).resolves.toMatchObject({ status: 'signedOut' })
    t.h.runDeviceSignIn.mockResolvedValue('signedIn')
    await expect(t.service.signIn('browser')).resolves.toMatchObject({ status: 'signedIn' })
    expect(t.probe).toHaveBeenCalledTimes(2)
  })

  // Cancel leaves an unanswered probe behind but keeps what the CLI already
  // said, so what it shows next asks nothing new (the review of PR #49).
  it('shows what follows Cancel from the answer the CLI already gave', async () => {
    const t = withFile(MALFORMED)
    t.probe.mockResolvedValue(LOGGED_OUT_ANSWER)
    await t.h.deps.credentials.setApiKey('LLM|1|secret')
    await expect(t.service.refresh(true)).resolves.toMatchObject({ backend: 'modelApi' })
    t.h.runDeviceSignIn.mockImplementation(async (signal) => {
      await new Promise((resolve) => {
        signal.addEventListener('abort', resolve, { once: true })
      })
      return 'cancelled'
    })
    const pending = t.service.signIn('browser')
    await vi.waitFor(() => {
      expect(t.h.runDeviceSignIn).toHaveBeenCalled()
    })
    t.service.cancelSignIn()
    await expect(pending).resolves.toMatchObject({ status: 'signedIn', backend: 'modelApi' })
    expect(t.probe).toHaveBeenCalledOnce()
  })

  it('signs out through account/logout: the file stays, empty, and the hold is released', async () => {
    const t = withFile(DEVICE_LOGIN_FILE)
    t.h.logOutCli.mockImplementation(() => {
      writeFileSync(t.file, LOGOUT_SHELL)
      return Promise.resolve(true)
    })
    await expect(t.service.refresh()).resolves.toMatchObject({ status: 'signedIn' })
    await expect(t.service.signOut()).resolves.toMatchObject({
      status: 'signedOut',
      detail: undefined,
    })
    expect(statSync(t.file).isFile()).toBe(true)
    expect(t.h.logoutHoldState.isHeld).toBe(false)
    await expect(t.service.refresh()).resolves.toMatchObject({ status: 'signedOut' })
    expect(t.probe).not.toHaveBeenCalled()
  })

  it('finishes a terminal sign-out once muse logout has rewritten the file', async () => {
    const t = withFile(DEVICE_LOGIN_FILE)
    t.h.logOutCli.mockResolvedValue(false)
    await t.service.refresh()
    await expect(t.service.signOut()).resolves.toMatchObject({ detail: EN.signOutPending })
    await expect(t.service.refresh(true)).resolves.toMatchObject({ status: 'error' })
    // What `muse logout` does in the terminal: the same file, emptied.
    writeFileSync(t.file, LOGOUT_SHELL)
    await expect(t.service.refresh(true)).resolves.toMatchObject({
      status: 'signedOut',
      detail: undefined,
    })
    expect(t.h.logoutHoldState.isHeld).toBe(false)
  })
})
