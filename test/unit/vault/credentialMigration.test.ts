// The extension's key-store migration (D89.14 lane M) through its designed
// seams only: real codecs against a Map SecretStorage, the real shell around
// it, and the real controller against dead vault ports (which must stay
// contained — a vault-less window keeps working exactly as now). The
// broker-backed copy/verify/mirror round trip lives in
// credentialMigrationStore.test.ts, where a real VaultStore can open.
import { describe, expect, it } from 'vitest'
import type { SecretStore } from '../../../src/host/auth/credentialStore'
import type { Logger } from '../../../src/host/logger'
import { capturingLog, mapSecrets } from '../helpers/vault/migrationFixtures'
import { SECRET_KEYS, UI_TEXT, VAULT_PROTOCOL_VERSION } from '../../../src/shared/constants'
import {
  buildMigrationCredentials,
  CredentialMigrationController,
  listMigrationKeys,
  type CredentialMigrationPorts,
} from '../../../src/host/vault/migrateCredentials'
import { createMigrationShell } from '../../../src/host/vault/migrationShell'

const now = () => 1_700_000_000_000
const MODEL_API_KEY = 'LLM_0123456789abcdef'
const API_KEY_RECORD = {
  v: 1,
  auth: 'apiKey',
  origin: 'https://openrouter.ai',
  secret: 'not-a-real-key-for-tests',
}
const OAUTH_RECORD = {
  v: 1,
  auth: 'oauth',
  origin: 'https://openrouter.ai',
  secret: 'not-a-real-token-for-tests',
}

interface PortCalls {
  snapshots: number
  writes: number
  removes: number
  reads: number
}

function vaultUnavailable(): Promise<never> {
  return Promise.reject(new Error('vault unavailable'))
}

function countingPorts(calls: PortCalls, shouldFailWrites: boolean): CredentialMigrationPorts {
  return {
    snapshot: () => {
      calls.snapshots += 1
      return Promise.resolve({ items: [] })
    },
    write: () => {
      calls.writes += 1
      return shouldFailWrites ? vaultUnavailable() : Promise.resolve()
    },
    remove: () => {
      calls.removes += 1
      return vaultUnavailable()
    },
    firstPartyRead: () => {
      calls.reads += 1
      return vaultUnavailable()
    },
  }
}

function runContained(store: SecretStore): {
  controller: CredentialMigrationController
  calls: PortCalls
  logged: string[]
} {
  const { log, logged } = capturingLog()
  const calls: PortCalls = { snapshots: 0, writes: 0, removes: 0, reads: 0 }
  return { controller: startController(store, calls, log), calls, logged }
}

function startController(
  secrets: SecretStore,
  calls: PortCalls,
  log: Logger,
): CredentialMigrationController {
  return new CredentialMigrationController({
    secrets,
    listProviderIds: () => Promise.resolve(['openrouter']),
    ports: countingPorts(calls, true),
    minorRelease: () => 19,
    now,
    label: UI_TEXT.vault.secret,
    log,
  })
}

describe('migration key list', () => {
  it('takes the model API key and every provider slot but chatgpt, without duplicates', () => {
    expect(listMigrationKeys(['openrouter', 'chatgpt', 'openrouter'])).toEqual([
      SECRET_KEYS.modelApiKey,
      'museSpark.provider.openrouter',
    ])
  })

  it('builds one codec per key with matching item ids', () => {
    const credentials = buildMigrationCredentials(['openrouter'], now)
    expect(credentials.map((entry) => entry.key)).toEqual([
      SECRET_KEYS.modelApiKey,
      'museSpark.provider.openrouter',
    ])
    const [modelApi] = credentials
    expect(modelApi?.request).toMatchObject({
      v: VAULT_PROTOCOL_VERSION,
      kind: 'firstPartyRead',
      origin: 'https://api.meta.ai',
    })
    expect(modelApi?.decode(Buffer.from(MODEL_API_KEY, 'utf8')).material.kind).toBe('apiKey')
  })
})

describe('migration shell', () => {
  it('reads and writes SecretStorage straight through while unbound', async () => {
    const { store, saved } = mapSecrets()
    const shell = createMigrationShell(store)
    await shell.store.store(SECRET_KEYS.modelApiKey, MODEL_API_KEY)
    expect(await shell.store.get(SECRET_KEYS.modelApiKey)).toBe(MODEL_API_KEY)
    await shell.store.delete(SECRET_KEYS.modelApiKey)
    expect(saved.has(SECRET_KEYS.modelApiKey)).toBe(false)
  })

  it('keeps the save when the mirror cannot land, and mirrors once bound', async () => {
    const { store, saved } = mapSecrets()
    const shell = createMigrationShell(store)
    shell.bind({
      mirrorWrite: () => Promise.reject(new Error('vault locked')),
      mirrorDelete: () => Promise.reject(new Error('vault locked')),
    })
    await shell.store.store('museSpark.provider.openrouter', JSON.stringify(API_KEY_RECORD))
    expect(saved.get('museSpark.provider.openrouter')).toBe(JSON.stringify(API_KEY_RECORD))
    const mirrored: string[] = []
    shell.bind({
      mirrorWrite: (key) => {
        mirrored.push(key)
        return Promise.resolve()
      },
      mirrorDelete: () => Promise.resolve(),
    })
    await shell.store.store('museSpark.provider.openrouter', JSON.stringify(API_KEY_RECORD))
    expect(mirrored).toEqual(['museSpark.provider.openrouter'])
  })
})

describe('migration controller without a vault', () => {
  it('stays contained and leaves every key working when the broker is down', async () => {
    const { store, saved } = mapSecrets({
      [SECRET_KEYS.modelApiKey]: MODEL_API_KEY,
      'museSpark.provider.openrouter': JSON.stringify(API_KEY_RECORD),
    })
    const { controller, logged } = runContained(store)
    await controller.ensureMigrated()
    expect(saved.get(SECRET_KEYS.modelApiKey)).toBe(MODEL_API_KEY)
    expect(saved.get('museSpark.provider.openrouter')).toBe(JSON.stringify(API_KEY_RECORD))
    expect(logged.some((line) => line.startsWith('warn:'))).toBe(true)
  })

  it('never writes the vault for opaque records, and says why', async () => {
    const { store } = mapSecrets({
      'museSpark.provider.openrouter': JSON.stringify(OAUTH_RECORD),
    })
    const { controller, calls, logged } = runContained(store)
    await controller.ensureMigrated()
    expect(calls.writes).toBe(0)
    expect(calls.removes).toBe(0)
    expect(
      logged.some(
        (line) => line.includes('museSpark.provider.openrouter') && line.includes('opaque'),
      ),
    ).toBe(true)
  })
})
