import { describe, expect, it, vi } from 'vitest'
import { createRuntimeAuth, type RuntimeAuthDeps } from '../../../src/runtime/features/auth'
import { CredentialStore } from '../../../src/host/auth/credentialStore'
import { UI_TEXT, SECRET_KEYS } from '../../../src/shared/constants'
import { FAKE_MODEL_API_KEY } from '../../unit/helpers/fakeModelApi'
import { FakeLogOutputChannel, memorySecrets } from '../../unit/helpers/fakes'
import { engineFixtures } from './fixtures'

const fixtures = engineFixtures()
function setup() {
  const secrets = memorySecrets()
  const state = { hasCli: true, isCurrent: true, isHeld: false }
  const restart = vi.fn(() => Promise.resolve())
  const device = vi.fn<RuntimeAuthDeps['runDeviceSignIn']>(() => Promise.resolve('timedOut'))
  const key = vi.fn<RuntimeAuthDeps['runKeySignIn']>(() => Promise.resolve(false))
  const installer = vi.fn(() => Promise.resolve())
  const cancel = vi.fn()
  const drain = vi.fn(() => Promise.resolve())
  const service = createRuntimeAuth(
    {
      backend: {
        resolveCli: () =>
          state.hasCli
            ? { ok: true, cliPath: '/fixture/muse' }
            : { ok: false, reason: 'fixture missing' },
        cliSignIn: () => Promise.resolve('signedOut'),
        abandonCliProbe: () => undefined,
        forgetCliAnswers: () => undefined,
        credentialFilePath: () => '/fixture/structure-only',
        credentialFileModifiedAt: () => undefined,
        hasEnvironmentKey: () => false,
        getBackendMode: () => 'modelApi',
        restartBackend: restart,
        logOutCli: () => Promise.resolve(true),
      },
      credentials: new CredentialStore(secrets, () => undefined),
      logoutHold: {
        get: () => state.isHeld,
        set: (held) => {
          state.isHeld = held
          return Promise.resolve()
        },
      },
      installCommand: 'fixture installer',
      runInTerminal: () => Promise.reject(new Error('no terminal allowed')),
      runInstallerInTerminal: installer,
      runDeviceSignIn: device,
      runKeySignIn: key,
      broadcast: vi.fn(),
      sleep: () => new Promise(() => undefined),
      now: Date.now,
      log: new FakeLogOutputChannel(),
      assertCurrent: () => {
        if (!state.isCurrent) throw new Error('retired')
      },
      cancelNative: cancel,
      drainNative: drain,
      ensureHost: () => Promise.reject(new Error('fixture forbids host start')),
      accountFacts: () =>
        Promise.resolve({
          signInMethod: secrets.values.has(SECRET_KEYS.modelApiKey) ? 'apiKey' : 'none',
        }),
      isKeyStored: () => secrets.values.has(SECRET_KEYS.modelApiKey),
    },
    UI_TEXT,
    'en',
  )
  fixtures.own(service)
  return {
    service,
    auth: service.features.auth,
    secrets,
    state,
    restart,
    device,
    key,
    installer,
    cancel,
    drain,
  }
}

describe('F37 portable auth', () => {
  it('reads actual OS-store-compatible credential facts and clears the key on sign-out', async () => {
    const rig = setup()
    rig.secrets.values.set(SECRET_KEYS.modelApiKey, FAKE_MODEL_API_KEY)
    expect(await rig.auth.refresh()).toMatchObject({ status: 'signedIn', backend: 'modelApi' })
    expect(rig.service.isKeyStored()).toBe(true)
    expect(await rig.auth.signOut()).toMatchObject({ status: 'signedOut' })
    expect(rig.service.isKeyStored()).toBe(false)
    expect(rig.restart).toHaveBeenCalledWith(true)
    expect(rig.key).not.toHaveBeenCalled()
  })
  it('retires old work before terminal-only key entry and gates new hosts until completion', async () => {
    const rig = setup()
    rig.secrets.values.set(SECRET_KEYS.modelApiKey, FAKE_MODEL_API_KEY)
    await rig.auth.refresh()
    const accepted = Promise.withResolvers<boolean>()
    rig.key.mockImplementation((signal, beforeRun) => {
      signal.throwIfAborted()
      beforeRun()
      return accepted.promise
    })
    const generation = rig.auth.admissionGeneration
    const signing = rig.auth.signIn('apiKey')
    await vi.waitFor(() => {
      expect(rig.key).toHaveBeenCalledOnce()
    })
    expect(rig.restart).toHaveBeenCalledWith(true)
    expect(rig.auth.backend).toBeUndefined()
    expect(rig.auth.admissionGeneration).toBeGreaterThan(generation)
    await expect(rig.service.features.ensureHost()).rejects.toThrow(UI_TEXT.signInCancelled)
    accepted.resolve(true)
    expect(await signing).toMatchObject({ status: 'signedIn', backend: 'modelApi' })
    expect(rig.auth.backend).toBe('modelApi')
  })
  it('cancels and drains a held installer without any later terminal launch', async () => {
    const rig = setup()
    rig.state.hasCli = false
    const installing = rig.auth.installMuseCode()
    const refused = expect(installing).rejects.toThrow()
    await vi.waitFor(() => {
      expect(rig.installer).toHaveBeenCalledOnce()
    })
    await rig.service.dispose()
    await refused
    expect(rig.cancel).toHaveBeenCalledOnce()
    expect(rig.drain).toHaveBeenCalledOnce()
    await expect(rig.auth.signIn('apiKey')).rejects.toThrow()
    expect(rig.key).not.toHaveBeenCalled()
  })
  it('waits for cancelled key entry before clearing a key the terminal may still store', async () => {
    const rig = setup()
    const accepted = Promise.withResolvers<boolean>()
    rig.key.mockImplementation(() => accepted.promise)
    const deleting = vi.spyOn(rig.secrets, 'delete')
    const signing = rig.auth.signIn('apiKey')
    const refused = expect(signing).rejects.toThrow()
    await vi.waitFor(() => {
      expect(rig.key).toHaveBeenCalledOnce()
    })
    const ending = rig.auth.signOut()
    try {
      await new Promise((resolve) => setImmediate(resolve))
      expect(deleting).not.toHaveBeenCalled()
      rig.secrets.values.set(SECRET_KEYS.modelApiKey, FAKE_MODEL_API_KEY)
    } finally {
      accepted.resolve(true)
    }
    await refused
    await ending
    expect(rig.secrets.values.has(SECRET_KEYS.modelApiKey)).toBe(false)
    expect(rig.auth.backend).toBeUndefined()
  })
  it('rechecks profile ownership after old hosts retire and before key entry launches', async () => {
    const rig = setup()
    rig.restart.mockImplementation(() => {
      rig.state.isCurrent = false
      return Promise.resolve()
    })
    await expect(rig.auth.signIn('apiKey')).rejects.toThrow('retired')
    expect(rig.key).not.toHaveBeenCalled()
  })
})
