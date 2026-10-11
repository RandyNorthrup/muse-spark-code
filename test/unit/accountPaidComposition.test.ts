import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterAll, beforeAll, expect, it, vi } from 'vitest'
import { ACCOUNT_REQUEST_CERTIFICATION, MODEL_API_BASE_URL } from '../../src/shared/constants'
import { ModelApiClient } from '../../src/core/backends/modelapi/client'
import type { PaidUseAsker } from '../../src/acp/paid'
import { Usd } from '../../src/shared/usd'
import { poolRequest } from './helpers/accounts/pool'
import {
  accountComposition,
  ACCOUNT_TEST_KEYS,
  ACCOUNT_TEST_MODEL,
} from './helpers/accountComposition'
import { buildModelApiBundle } from './helpers/modelApiBundle'
import { removeFolder } from './helpers/temporaryFolders'

const dist = mkdtempSync(path.join(tmpdir(), 'cm1082-paid-composition-'))
beforeAll(async () => {
  ACCOUNT_REQUEST_CERTIFICATION.isComplete = true
  await buildModelApiBundle(dist)
})
afterAll(async () => {
  ACCOUNT_REQUEST_CERTIFICATION.isComplete = false
  await removeFolder(dist)
})
it('ACP production paid caller asks once per admitted account and never borrows the previous account grant', async () => {
  const t = await accountComposition(dist)
  try {
    const ask = vi.fn<PaidUseAsker>(() => Promise.resolve('always'))
    t.runtime.paid.attach(ask)
    const client = new ModelApiClient({
      baseUrl: MODEL_API_BASE_URL,
      apiKey: () => Promise.resolve(ACCOUNT_TEST_KEYS[0]),
      fetch: t.api.fetch,
      log: t.log,
      now: Date.now,
      sleep: () => Promise.resolve(),
      random: () => 0,
    })
    const requests = await t.services.requests(client)
    const use = async () => {
      const lease = await requests.acquire(
        poolRequest({
          owner: 'paid-owner',
          modelId: ACCOUNT_TEST_MODEL,
          account: 'default',
          checkSharedCaps: () => undefined,
        }),
        new URL(MODEL_API_BASE_URL).origin,
      )
      try {
        return await requests.within(lease, () =>
          t.runtime.paid.allows(
            t.folder,
            'paid-session',
            {
              feature: 'imageGeneration',
              kind: 'generate',
              path: 'fixture.png',
              sources: [],
              prompt: 'fixture',
            },
            false,
          ),
        )
      } finally {
        await lease.settle(Usd.from(0).toAmount())
      }
    }
    expect(await use()).toBe(true)
    expect(await use()).toBe(true)
    expect(ask).toHaveBeenCalledOnce()
    await t.services.sessions('meta').use('paid-owner', 'work', () => true)
    expect(await use()).toBe(true)
    expect(await use()).toBe(true)
    expect(ask).toHaveBeenCalledTimes(2)
    expect(ask.mock.calls[1]?.[3]).toContain('meta · work')
    expect(t.headers()).toEqual([])
  } finally {
    await t.dispose()
    await removeFolder(t.folder)
  }
})
