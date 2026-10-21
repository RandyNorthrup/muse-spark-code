// The backend readiness failure rules: a denying store reads as the
// store-down condition (signed out with the store-down flag), and a foreign
// failure resolves as plain unavailable, never wearing the store-down flag.
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import type { SecretStore } from '../../src/host/auth/credentialStore'
import { createRuntimeBackend, type RuntimeBackendDeps } from '../../src/runtime/backends'
import { StoreUnavailableError } from '../../src/runtime/keyStore'
import { UI_TEXT } from '../../src/shared/constants'

function deps(secrets: SecretStore): RuntimeBackendDeps {
  const folder = mkdtempSync(path.join(tmpdir(), 'backend-readiness-'))
  return {
    options: {
      backend: 'modelApi',
      trustWorkspace: false,
      museBinary: '',
      shellSandbox: 'off',
      canBypass: false,
      allowsContributorModels: false,
      paidFeatures: [],
      isVerbose: false,
    },
    version: '0.0.0-test',
    distDir: folder,
    platform: process.platform,
    env: {},
    homeDir: folder,
    secrets,
    runGit: () => Promise.reject(new Error('no git on this check')),
    fetch,
    sleep: () => Promise.resolve(),
    log: collectingLog(),
  }
}

/** A log the test never triggers. */
function ignoreLog(): void {
  // Nothing to observe on this path.
}

function collectingLog(): {
  trace: (message: string) => void
  info: (message: string) => void
  warn: (message: string) => void
  error: (message: string) => void
} {
  return { trace: ignoreLog, info: ignoreLog, warn: ignoreLog, error: ignoreLog }
}

function denying(failure: Error): SecretStore {
  return {
    get: () => Promise.reject(failure),
    store: () => Promise.resolve(),
    delete: () => Promise.resolve(),
  }
}

describe('modelApiReadiness store failures', () => {
  it('reads a denying store as the store-down condition', async () => {
    const backend = createRuntimeBackend(deps(denying(new StoreUnavailableError())))
    const readiness = await backend.backend.readiness(false)
    expect(readiness).toMatchObject({ state: 'signedOut', storeDown: true })
    if (readiness.state !== 'signedOut') throw new Error('unreachable')
    expect(readiness.message).toBe(UI_TEXT.acpStoreDown)
  })

  it('does not report a foreign failure as the store condition', async () => {
    const backend = createRuntimeBackend(deps(denying(new Error('foreign-boom'))))
    const readiness = await backend.backend.readiness(false)
    expect(readiness.state).toBe('unavailable')
    expect(readiness).not.toMatchObject({ storeDown: true })
  })
})
