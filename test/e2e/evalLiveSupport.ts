// The live harnesses use the ACP agent's existing OS credential entry in
// this process. No key comes from arguments, environment or a fixture file.
// Native entry access is deferred until the owner enables the live test.

import { createHash } from 'node:crypto'
import {
  CredentialStore,
  isValidModelApiKey,
  type SecretStore,
} from '../../src/host/auth/credentialStore'
import { keyringSecretStore } from '../../src/runtime/keyStore'
import { EVAL_TURN_TIMEOUT_MS, EVAL_VERIFY_TIMEOUT_MS } from '../../src/shared/constants'

const LEGACY_KEY_VARIABLE = 'MUSE_LIVE_MODEL_API_KEY'
const STORE_UNAVAILABLE =
  'No Model API key is available from the operating system credential store. Use muse-spark-code-acp auth set before enabling live tests.'

/** Reject the old transport without reading, echoing or deleting its value. */
export function assertNoLiveKeyEnvironment(env: NodeJS.ProcessEnv): void {
  if (Object.hasOwn(env, LEGACY_KEY_VARIABLE)) {
    throw new Error(
      'MUSE_LIVE_MODEL_API_KEY is not supported. Remove that environment variable and use muse-spark-code-acp auth set for the operating system credential store.',
    )
  }
}

export interface EvalLiveCredentials {
  readonly accountId: string
  readonly apiKey: () => Promise<string | undefined>
  readonly redact: (text: string) => string
  readonly contains: (value: string | Uint8Array) => boolean
}

async function liveSecretStore(): Promise<SecretStore> {
  const { AsyncEntry } = await import('@napi-rs/keyring')
  return keyringSecretStore(
    (service, account) => new AsyncEntry(service, account, { linux: { store: 'secret-service' } }),
  )
}

/** One live run stays bound to its initial stored account; replacement stops admission. */
export async function loadEvalLiveCredentials(
  isEnabled: boolean,
  secrets?: SecretStore,
): Promise<EvalLiveCredentials> {
  if (!isEnabled) {
    throw new Error('Live Model API tests are not enabled.')
  }
  let credentials: CredentialStore
  let key: string
  try {
    credentials = new CredentialStore(
      secrets ?? (await liveSecretStore()),
      () => {
        // Native error text is replaced by the fixed failure below, never logged.
      },
      'the operating system credential store',
    )
    const stored = await credentials.getApiKey()
    if (stored === undefined || !isValidModelApiKey(stored)) {
      throw new Error(STORE_UNAVAILABLE)
    }
    key = stored.trim()
  } catch {
    throw new Error(STORE_UNAVAILABLE)
  }
  const needle = Buffer.from(key)
  return {
    accountId: createHash('sha256').update(key).digest('hex'),
    apiKey: async () => {
      try {
        const current = await credentials.getApiKey()
        return current?.trim() === key ? key : undefined
      } catch {
        return undefined
      }
    },
    redact: (text) => text.replaceAll(key, '[key]'),
    contains: (value) =>
      typeof value === 'string' ? value.includes(key) : Buffer.from(value).includes(needle),
  }
}

/** Outer deadline covers every task/arm run; each turn and verifier keeps its own limit. */
export function evalRunTimeoutMs(taskCount: number, armCount: number, marginMs: number): number {
  const counts = [taskCount, armCount, marginMs]
  const deadline = taskCount * armCount * (EVAL_TURN_TIMEOUT_MS + EVAL_VERIFY_TIMEOUT_MS) + marginMs
  if (
    counts.some((count) => !Number.isSafeInteger(count)) ||
    taskCount < 1 ||
    armCount < 1 ||
    marginMs < 0 ||
    !Number.isSafeInteger(deadline)
  ) {
    throw new Error(
      'The live eval deadline requires valid task and arm counts and a finite margin.',
    )
  }
  return deadline
}
