// Keyless default-plan exec readiness (Codex on PR #227): without
// `--model`, the configured default decides before the stored-key gate, so
// a default plan model reaches its subscription check instead of being
// refused as keyless. Real backend, real providers file, no stored key.
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
// The plan path lazily imports the subscription client: import it here so
// the transform happens during collection, outside the timed cases.
import '../../src/host/backend/configuredProvidersEntry'
import '../../src/runtime/chatGptProviderCommands'
import type { SecretStore } from '../../src/host/auth/credentialStore'
import type { Logger } from '../../src/host/logger'
import { createRuntimeBackend } from '../../src/runtime/backends'
import type { ServeOptions } from '../../src/runtime/cliArgs'
import { PROVIDERS_CONFIG_DIR_NAME, PROVIDERS_FILE_NAME, UI_TEXT } from '../../src/shared/constants'
import {
  emptyProvidersFile,
  type ProviderEntry,
  type ProvidersFile,
} from '../../src/core/providers/providersFile'
import { removeFolder } from './helpers/temporaryFolders'

const silent = (): undefined => undefined
const log: Logger = { trace: silent, info: silent, warn: silent, error: silent }

const folders: string[] = []
afterEach(async () => {
  await Promise.all(folders.splice(0).map((folder) => removeFolder(folder)))
})

/** A home dir whose providers file carries `file`; the backend reads it there. */
function homeWith(file: ProvidersFile): { homeDir: string; configDir: string } {
  const homeDir = mkdtempSync(path.join(tmpdir(), 'exec-readiness-'))
  folders.push(homeDir)
  const configDir = path.join(homeDir, '.config')
  mkdirSync(path.join(configDir, PROVIDERS_CONFIG_DIR_NAME), { recursive: true })
  writeFileSync(
    path.join(configDir, PROVIDERS_CONFIG_DIR_NAME, PROVIDERS_FILE_NAME),
    JSON.stringify(file),
  )
  return { homeDir, configDir }
}

const secrets: SecretStore = {
  get: () => Promise.resolve(undefined),
  store: () => Promise.resolve(),
  delete: () => Promise.resolve(),
}

function readiness(homeDir: string, configDir: string) {
  const options: ServeOptions = {
    backend: 'modelApi',
    trustWorkspace: false,
    museBinary: '',
    shellSandbox: 'off',
    canBypass: false,
    allowsContributorModels: false,
    paidFeatures: [],
    isVerbose: false,
  }
  const backend = createRuntimeBackend({
    options,
    exec: {
      isEphemeral: true,
      headlessPaid: () => Promise.resolve(false),
      streamIdleMs: 0,
    },
    version: 'test',
    distDir: homeDir,
    platform: 'linux',
    env: { XDG_CONFIG_HOME: configDir },
    homeDir,
    secrets,
    runGit: () => Promise.reject(new Error('no git in this suite')),
    fetch: globalThis.fetch.bind(globalThis),
    sleep: () => Promise.resolve(),
    log,
  })
  return backend.backend.readiness
}

const chatgptEntry: ProviderEntry = {
  id: 'chatgpt',
  preset: 'chatgpt',
  address: 'https://api.openai.com',
  format: 'responses',
  auth: 'subscription',
  models: ['gpt-4o'],
}

describe('exec readiness without --model', () => {
  it('checks the subscription before refusing a keyless default plan run', async () => {
    const { homeDir, configDir } = homeWith({
      ...emptyProvidersFile(),
      defaultModel: 'chatgpt/gpt-4o',
      providers: [chatgptEntry],
    })
    const result = await readiness(homeDir, configDir)(false, undefined)
    // The plan's own sign-in is named, never the Meta key: the run reached
    // the subscription checks instead of the key gate.
    expect(result).toEqual({
      state: 'signedOut',
      message: UI_TEXT.acpChatGpt.states['signed-out'],
    })
  })

  it('still refuses a keyless default Meta run at the key gate', async () => {
    const { homeDir, configDir } = homeWith({
      ...emptyProvidersFile(),
      defaultModel: 'muse-spark-1.3',
      providers: [],
    })
    const result = await readiness(homeDir, configDir)(false, undefined)
    expect(result).toEqual({ state: 'signedOut', message: UI_TEXT.acpNoStoredKey })
  })
})
