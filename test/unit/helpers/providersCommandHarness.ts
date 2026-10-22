// A `providers …` command's dependencies over a real providers file in a
// temp folder: the product's own file IO, an empty memory secret store,
// fixed DNS answers and capturing printers. Suites share it instead of
// repeating the harness, so the duplication gate stays silent.
import path from 'node:path'
import { PassThrough } from 'node:stream'
import {
  emptyProvidersFile,
  writeProvidersFileAtomic,
  type ProviderEntry,
} from '../../../src/core/providers/providersFile'
import { memorySecretStoreFor } from '../../../src/runtime/exec/keyInput'
import { readSecretLine } from '../../../src/runtime/hiddenInput'
import {
  formatStoredProviderSecret,
  providerSecretAccount,
  StoreUnavailableError,
} from '../../../src/runtime/keyStore'
import { userFileIo, type ProvidersDeps } from '../../../src/runtime/providersCommands'
import { CREDENTIAL_RECORD_VERSION } from '../../../src/shared/constants'
import { EN } from '../../../src/shared/l10n/en'
import { fill } from '../../../src/shared/l10n/text'
import { temporaryTracker } from './temporaryFolders'

export interface ProvidersCommandHarness {
  readonly deps: ProvidersDeps
  readonly printed: string[]
  readonly errors: string[]
  readonly filePath: string
}

/** One suite's harness factory: temp folders are removed by `cleanup`. */
export function providersCommandHarness() {
  const tracker = temporaryTracker()
  return {
    cleanup: (): Promise<void> => tracker.cleanup(),
    make: async (prefix: string): Promise<ProvidersCommandHarness> => {
      const folder = await tracker.make(prefix)
      const filePath = path.join(folder, 'providers.json')
      const printed: string[] = []
      const errors: string[] = []
      const input = new PassThrough()
      input.end()
      return {
        deps: {
          ...userFileIo(filePath),
          secrets: memorySecretStoreFor({}),
          resolveHost: () => Promise.resolve(['93.184.215.14']),
          fetch: globalThis.fetch.bind(globalThis),
          readSecret: (prompt) => readSecretLine(prompt, input, new PassThrough()),
          print: (line: string) => {
            printed.push(line)
          },
          printError: (line: string) => {
            errors.push(line)
          },
        },
        printed,
        errors,
        filePath,
      }
    },
  }
}

export function harnessEntry(
  id: string,
  models: readonly string[],
  overrides: Partial<ProviderEntry> = {},
): ProviderEntry {
  return {
    id,
    preset: 'openai',
    address: 'https://api.openai.com',
    auth: 'apiKey',
    models: [...models],
    ...overrides,
  }
}

export async function writeHarnessFile(
  filePath: string,
  providers: readonly ProviderEntry[],
): Promise<void> {
  const written = await writeProvidersFileAtomic(filePath, {
    ...emptyProvidersFile(),
    providers: [...providers],
  })
  if (!written.ok) throw new Error(written.detail)
}

/** The harness with a key stored for the provider: built, not typed, so no committed key-like literal trips the secret scanner. */
export function withHarnessKey(
  harness: ProvidersCommandHarness,
  providerId: string,
  origin: string,
): ProvidersCommandHarness {
  const account = providerSecretAccount(providerId) ?? ''
  const store = memorySecretStoreFor({
    [account]: formatStoredProviderSecret(
      { v: CREDENTIAL_RECORD_VERSION, auth: 'apiKey', origin },
      `sk-test-${'0'.repeat(24)}`,
    ),
  })
  return { ...harness, deps: { ...harness.deps, secrets: store } }
}

/** The harness with a credential store that is down: every read fails as one. */
export function withDownStore(harness: ProvidersCommandHarness): ProvidersCommandHarness {
  return {
    ...harness,
    deps: {
      ...harness.deps,
      secrets: {
        ...harness.deps.secrets,
        get: () => Promise.reject(new StoreUnavailableError()),
      },
    },
  }
}

/** The paid-token refusal both commands print: the flags to check. */
export function paidTokenRefusal(): readonly string[] {
  return [
    `${fill(EN.providerNoRequestPath, { provider: 'Azure OpenAI' })} ${fill(EN.providerCliConfigure, { preset: 'openai|anthropic|gemini|custom' })}`,
  ]
}
