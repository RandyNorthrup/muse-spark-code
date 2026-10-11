import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, expect, it } from 'vitest'
import { ACCOUNT_REQUEST_CERTIFICATION, MODEL_API_BASE_URL } from '../../src/shared/constants'
import { createRuntimeAccountServices } from '../../src/runtime/providers/runtimeServices'
import { ModelApiClient } from '../../src/core/backends/modelapi/client'
import { poolRequest } from './helpers/accounts/pool'
import { fakeModelApi } from './helpers/fakeModelApi'
import { CURRENT_SHAPE_KEYS } from './helpers/modelApiKeys'
import { memorySecrets, FakeLogOutputChannel } from './helpers/fakes'
import { featureCatalog } from '../../src/shared/featureCatalog'

const folders: string[] = []
afterEach(() => {
  ACCOUNT_REQUEST_CERTIFICATION.isComplete = false
  for (const folder of folders.splice(0)) rmSync(folder, { recursive: true, force: true })
})
it('one default-off switch hides installed request admission and its Help detail, then fences a held lease when closed', async () => {
  expect(ACCOUNT_REQUEST_CERTIFICATION.isComplete).toBe(false)
  const dataDir = mkdtempSync(path.join(tmpdir(), 'cm1082-availability-'))
  folders.push(dataDir)
  const services = createRuntimeAccountServices({ dataDir, secrets: memorySecrets() })
  const api = fakeModelApi({ keys: CURRENT_SHAPE_KEYS })
  const client = new ModelApiClient({
    baseUrl: MODEL_API_BASE_URL,
    apiKey: () => Promise.resolve(CURRENT_SHAPE_KEYS[0]),
    fetch: api.fetch,
    log: new FakeLogOutputChannel(),
    now: Date.now,
    sleep: () => Promise.resolve(),
    random: () => 0,
  })
  try {
    await expect(services.requests(client)).rejects.toThrow()
    expect(api.requests).toHaveLength(0)
    expect(featureCatalog().find((row) => row.id === 'accounts')?.details).not.toContainEqual({
      ui: 'referenceAccountRequests',
    })
    ACCOUNT_REQUEST_CERTIFICATION.isComplete = true
    expect(featureCatalog().find((row) => row.id === 'accounts')?.details).toContainEqual({
      ui: 'referenceAccountRequests',
    })
    await services.store.setCredential('meta', 'default', {
      v: 1,
      auth: 'apiKey',
      provider: 'meta',
      account: 'default',
      origin: new URL(MODEL_API_BASE_URL).origin,
      secret: CURRENT_SHAPE_KEYS[0],
    })
    const requests = await services.requests(client)
    const lease = await requests.acquire(
      poolRequest({
        modelId: 'muse-spark-1.3',
        account: 'default',
        checkSharedCaps: () => undefined,
      }),
      new URL(MODEL_API_BASE_URL).origin,
    )
    ACCOUNT_REQUEST_CERTIFICATION.isComplete = false
    expect(() => {
      lease.beforeSend()
    }).toThrow()
    await lease.settle(null)
    expect(api.responseBodies()).toHaveLength(0)
  } finally {
    services.dispose()
  }
})
