// Synthetic keys only. This actual child ends after durable send reservation,
// without calling settlement, as an abruptly lost process would.
import path from 'node:path'
import { createRuntimeAccountServices } from '../../../src/runtime/providers/runtimeServices'
import { AccountRequestJournal } from '../../../src/runtime/providers/accountRequestJournal'
import { accountPeriodRange } from '../../../src/core/accounts/thresholds'
import { ModelApiClient } from '../../../src/core/backends/modelapi/client'
import { Usd } from '../../../src/shared/usd'
import { parseUsd } from '../../../src/shared/accountUsd'
import {
  ACCOUNT_REQUEST_CERTIFICATION,
  ACCOUNT_REQUEST_STORE,
  MODEL_API_BASE_URL,
} from '../../../src/shared/constants'
import { memoryKeyring } from './keyring'
import { CURRENT_SHAPE_KEYS } from './modelApiKeys'
import { fakeModelApi } from './fakeModelApi'
import { accountSecretKey } from '../../../src/core/providers/accountCredentialRecord'

export async function runAccountCrashProcess() {
  ACCOUNT_REQUEST_CERTIFICATION.isComplete = true
  const [folder, action] = process.argv.slice(2)
  if (folder === undefined) throw new Error('missing fixture directory')
  const keyring = memoryKeyring()
  const origin = new URL(MODEL_API_BASE_URL).origin
  keyring.values.set(accountSecretKey('meta', 'default'), CURRENT_SHAPE_KEYS[0])
  keyring.values.set(
    accountSecretKey('meta', 'work'),
    JSON.stringify({
      v: 1,
      auth: 'apiKey',
      provider: 'meta',
      account: 'work',
      origin,
      secret: CURRENT_SHAPE_KEYS[1],
    }),
  )
  const services = createRuntimeAccountServices({ dataDir: folder, openEntry: keyring.openEntry })
  const api = fakeModelApi({ keys: CURRENT_SHAPE_KEYS })
  api.models = ['muse-spark-1.3']
  const client = new ModelApiClient({
    baseUrl: MODEL_API_BASE_URL,
    apiKey: () => Promise.resolve(CURRENT_SHAPE_KEYS[0]),
    fetch: api.fetch,
    now: Date.now,
    sleep: () => Promise.resolve(),
    random: () => 0,
    log: {
      trace: () => undefined,
      info: () => undefined,
      warn: () => undefined,
      error: () => undefined,
    },
  })
  if (action !== 'inspect') {
    const requests = await services.requests(client, {
      account: 'default',
      isInteractive: false,
      hasPoolFlag: true,
    })
    const lease = await requests.acquire(
      {
        owner: 'crash-test',
        budgetOwner: 'fixed-budget',
        kind: 'conversation',
        account: 'default',
        modelId: 'muse-spark-1.3',
        isInteractive: false,
        hasPoolFlag: true,
        estimate: { costUsd: parseUsd('0.1'), inputTokens: 10, outputTokens: 2, requests: 1 },
        checkSharedCaps: () => undefined,
      },
      origin,
    )
    lease.beforeSend()
    if (action === 'crash') process.kill(process.pid, 'SIGKILL')
    await lease.settle(Usd.from('0.02').toAmount(), { inputTokens: 10, outputTokens: 2 })
  }
  const journal = new AccountRequestJournal(
    path.join(folder, ACCOUNT_REQUEST_STORE.directory),
    Date.now,
  )
  const query = { provider: 'meta', ...accountPeriodRange('day', Date.now()) }
  process.stdout.write(
    JSON.stringify({
      a: journal.read({ ...query, account: 'default' }),
      b: journal.read({ ...query, account: 'work' }),
    }),
  )
  services.dispose()
}
