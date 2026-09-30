import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  assertNoLiveKeyEnvironment,
  evalRunTimeoutMs,
  loadEvalLiveCredentials,
} from '../../e2e/evalLiveSupport'
import {
  EVAL_TURN_TIMEOUT_MS,
  EVAL_VERIFY_TIMEOUT_MS,
  KEYRING_SERVICE,
  SECRET_KEYS,
} from '../../../src/shared/constants'
import { memorySecrets } from '../helpers/fakes'
import { FAKE_MODEL_API_ACCOUNT_ID, FAKE_MODEL_API_KEY } from '../helpers/fakeModelApi'

const native = vi.hoisted(() => ({
  open: vi.fn<(service: string, account: string, options: unknown) => void>(),
  getPassword: vi.fn<() => Promise<string | null | undefined>>(),
  setPassword: vi.fn<(value: string) => Promise<void>>(),
  deletePassword: vi.fn<() => Promise<boolean>>(),
}))

vi.mock('@napi-rs/keyring', () => ({
  AsyncEntry: class {
    public getPassword = native.getPassword
    public setPassword = native.setPassword
    public deletePassword = native.deletePassword

    public constructor(service: string, account: string, options: unknown) {
      native.open(service, account, options)
    }
  },
}))

beforeEach(() => {
  vi.clearAllMocks()
  native.getPassword.mockResolvedValue(FAKE_MODEL_API_KEY)
})

afterEach(() => {
  vi.useRealTimers()
  vi.restoreAllMocks()
})

function storedCredentials() {
  const secrets = memorySecrets()
  secrets.values.set(SECRET_KEYS.modelApiKey, FAKE_MODEL_API_KEY)
  return {
    secrets,
    get: vi.spyOn(secrets, 'get'),
    store: vi.spyOn(secrets, 'store'),
    remove: vi.spyOn(secrets, 'delete'),
  }
}

/** An environment naming the old variable whose value throws when read. */
function environmentWithLegacyKey() {
  const read = vi.fn(() => {
    throw new Error('the environment value must not be read')
  })
  const env: NodeJS.ProcessEnv = {}
  Object.defineProperty(env, 'MUSE_LIVE_MODEL_API_KEY', { get: read })
  return { env, read }
}

describe('secure live Model API credentials', () => {
  it('does not open or read a credential entry while live tests are disabled', async () => {
    const { secrets, get } = storedCredentials()
    await expect(loadEvalLiveCredentials(false, secrets)).rejects.toThrow('not enabled')
    expect(get).not.toHaveBeenCalled()
    expect(native.open).not.toHaveBeenCalled()
  })

  it('refuses legacy key environment presence without reading its value', () => {
    const { env, read } = environmentWithLegacyKey()
    expect(() => {
      assertNoLiveKeyEnvironment(env, true)
    }).toThrow('Remove that environment variable')
    expect(read).not.toHaveBeenCalled()
    expect(() => {
      assertNoLiveKeyEnvironment({}, true)
    }).not.toThrow()
  })

  it('lets a stale key variable pass while live tests are off, so the default run still collects', () => {
    const { env, read } = environmentWithLegacyKey()
    expect(() => {
      assertNoLiveKeyEnvironment(env, false)
    }).not.toThrow()
    expect(read).not.toHaveBeenCalled()
  })

  it('uses the existing OS entry in process, with Secret Service on Linux and no writes', async () => {
    const credentials = await loadEvalLiveCredentials(true)
    expect(credentials.accountId).toBe(FAKE_MODEL_API_ACCOUNT_ID)
    expect(await credentials.apiKey()).toBe(FAKE_MODEL_API_KEY)
    expect(native.open).toHaveBeenCalledTimes(2)
    expect(native.open).toHaveBeenCalledWith(KEYRING_SERVICE, SECRET_KEYS.modelApiKey, {
      linux: { store: 'secret-service' },
    })
    expect(native.setPassword).not.toHaveBeenCalled()
    expect(native.deletePassword).not.toHaveBeenCalled()
    expect(JSON.stringify(credentials)).not.toContain(FAKE_MODEL_API_KEY)
  })

  it('reads only the injected secret entry and masks the key in text and byte scans', async () => {
    const { secrets, get, store, remove } = storedCredentials()
    const credentials = await loadEvalLiveCredentials(true, secrets)
    expect(get).toHaveBeenCalledWith(SECRET_KEYS.modelApiKey)
    expect(native.open).not.toHaveBeenCalled()
    expect(credentials.contains(Buffer.from(`before ${FAKE_MODEL_API_KEY} after`))).toBe(true)
    expect(credentials.contains('ordinary fixture text')).toBe(false)
    expect(credentials.redact(`${FAKE_MODEL_API_KEY} / ${FAKE_MODEL_API_KEY}`)).toBe(
      '[key] / [key]',
    )
    expect(store).not.toHaveBeenCalled()
    expect(remove).not.toHaveBeenCalled()
  })

  it.each(['missing', 'invalid', 'unreadable'] as const)(
    'fails closed with fixed text when the store is %s',
    async (kind) => {
      const { secrets, get } = storedCredentials()
      if (kind === 'missing') {
        secrets.values.clear()
      } else if (kind === 'invalid') {
        secrets.values.set(SECRET_KEYS.modelApiKey, 'not a credential')
      } else {
        get.mockRejectedValue(new Error(FAKE_MODEL_API_KEY))
      }
      let failure: unknown
      try {
        await loadEvalLiveCredentials(true, secrets)
      } catch (error: unknown) {
        failure = error
      }
      expect(failure).toBeInstanceOf(Error)
      expect(String(failure)).toContain('operating system credential store')
      expect(String(failure)).not.toContain(FAKE_MODEL_API_KEY)
    },
  )

  it.each(['removed', 'replaced', 'unreadable'] as const)(
    'rereads the provider and refuses admission when its initial account is %s',
    async (kind) => {
      const { secrets, get } = storedCredentials()
      const credentials = await loadEvalLiveCredentials(true, secrets)
      expect(await credentials.apiKey()).toBe(FAKE_MODEL_API_KEY)
      if (kind === 'removed') {
        secrets.values.clear()
      } else if (kind === 'replaced') {
        secrets.values.set(SECRET_KEYS.modelApiKey, 'a different account')
      } else {
        get.mockRejectedValue(new Error(FAKE_MODEL_API_KEY))
      }
      expect(await credentials.apiKey()).toBeUndefined()
      expect(credentials.accountId).toBe(FAKE_MODEL_API_ACCOUNT_ID)
    },
  )

  it('fails closed if a native failure cannot even be described safely', async () => {
    const { secrets, get } = storedCredentials()
    const credentials = await loadEvalLiveCredentials(true, secrets)
    get.mockRejectedValue({
      toString: () => {
        throw new Error('opaque store failure')
      },
    })
    await expect(credentials.apiKey()).resolves.toBeUndefined()
  })
})

const RUN_MARGIN_MS = 60_000
const ONE_RUN_MS = EVAL_TURN_TIMEOUT_MS + EVAL_VERIFY_TIMEOUT_MS

describe('live paired eval overall deadline', () => {
  it('keeps the existing one-arm deadline', () => {
    expect(evalRunTimeoutMs(10, 1, RUN_MARGIN_MS)).toBe(10 * ONE_RUN_MS + RUN_MARGIN_MS)
  })

  it('allows both arms their full task budgets before the overall timer expires', async () => {
    vi.useFakeTimers()
    const expired = vi.fn()
    const timer = setTimeout(expired, evalRunTimeoutMs(2, 2, RUN_MARGIN_MS))
    await vi.advanceTimersByTimeAsync(2 * ONE_RUN_MS + RUN_MARGIN_MS)
    expect(expired).not.toHaveBeenCalled()
    await vi.advanceTimersByTimeAsync(2 * ONE_RUN_MS)
    expect(expired).toHaveBeenCalledOnce()
    clearTimeout(timer)
  })

  it.each([
    [0, 1, RUN_MARGIN_MS],
    [1, 0, RUN_MARGIN_MS],
    [-1, 1, RUN_MARGIN_MS],
    [1.5, 1, RUN_MARGIN_MS],
    [1, 1, -1],
    [Number.MAX_SAFE_INTEGER, 2, RUN_MARGIN_MS],
    [1, Infinity, RUN_MARGIN_MS],
  ])('refuses invalid counts/margin %j', (tasks, arms, margin) => {
    expect(() => evalRunTimeoutMs(tasks, arms, margin)).toThrow('valid task and arm counts')
  })
})
