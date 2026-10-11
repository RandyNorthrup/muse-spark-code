import { mediaByteSource } from './helpers/media/replay'
import { emptyStoredSession } from './helpers/fakeSessionStore'
import { scratchDirectories } from './helpers/media/scratch'
// MEDIAW: the upload ledger and the calibration store share the
// repository's cross-process mutex (core/fileLock, the session-budget
// design); ledgers are per account; settlements merge under the lock.
// Each test fails on c2689e116: the lock module and per-account layout are
// absent there, and sequential settlements lose one observation (24 of 25).
import { spawn } from 'node:child_process'
import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { mkdir, readdir, readFile, stat } from 'node:fs/promises'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { describe, expect, it } from 'vitest'
import { withMkdirLock } from '../../src/core/fileLock'
import { MediaCostEstimator } from '../../src/core/media/mediaCost'
import {
  createProductionMediaReplay,
  productionMediaDirectory,
} from '../../src/core/media/productionMedia'
import { accountLedgerDirectory } from '../../src/core/media/uploadLedgerStorage'
import { fileCalibrationStore } from '../../src/core/media/productionMedia'
import { MEDIA_ESTIMATE_SAFETY_FACTOR } from '../../src/shared/constants'
import { ModelApiClient } from '../../src/core/backends/modelapi/client'
import { createFileSessionStore } from '../../src/host/backend/fileSessionStore'
import { createSessionUploads } from '../../src/host/backend/sessionUploads'
import type { StoredSession } from '../../src/core/backends/modelapi/sessionStore'
import { createConfiguredProviderServices } from '../../src/core/providers/configured'
import { createSubscriptionClient } from '../../src/core/providers/subscriptions/registry'
import {
  createRuntimeDailyBudget,
  withRuntimeAccounting,
} from '../../src/runtime/runtimeAccountingEntry'
import { FakeLogOutputChannel, memorySecrets } from './helpers/fakes'
import { fakeFilesApi } from './helpers/fakeFiles'
import {
  FAKE_MODEL_API_ACCOUNT_ID,
  FAKE_MODEL_API_KEY,
  fakeModelApi,
  fakeModelApiClientSettings,
} from './helpers/fakeModelApi'

const MODEL = 'muse-spark-1.3-contributor'
const KEY_B = 'mediaw-second-account-key'
const ACCOUNT_B = createHash('sha256').update(KEY_B).digest('hex')

const scratchDir = scratchDirectories('muse-upload-stores-')

/** One lock contender as a real OS process, importing the real mutex. */
function contenderScript(lockFile: string, orderFile: string, id: string, holdMs: number): string {
  const moduleUrl = pathToFileURL(path.resolve('src/core/fileLock.ts')).href
  return String.raw`
import { withMkdirLock } from ${JSON.stringify(moduleUrl)};
import { appendFile } from 'node:fs/promises';
const sleep = (ms) => new Promise((settle) => setTimeout(settle, ms));
await withMkdirLock(${JSON.stringify(lockFile)}, {
  sleep: async (ms) => {
    await appendFile(${JSON.stringify(orderFile)}, 'wait-${id}\n');
    await sleep(ms);
  },
  attempts: 500,
  waitMs: 10,
}, async () => {
  await appendFile(${JSON.stringify(orderFile)}, 'enter-${id}\n');
  await sleep(${String(holdMs)});
  await appendFile(${JSON.stringify(orderFile)}, 'leave-${id}\n');
});
`
}

function runContender(script: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(
      process.execPath,
      ['--experimental-strip-types', '--input-type=module', '-e', script],
      { stdio: ['ignore', 'pipe', 'pipe'] },
    )
    let stderr = ''
    child.stderr.on('data', (chunk: Buffer) => {
      stderr += chunk.toString('utf8')
    })
    child.on('error', reject)
    child.on('close', (code) => {
      if (code === 0) resolve()
      else reject(new Error(`lock contender exited ${String(code)}: ${stderr}`))
    })
  })
}

describe('shared cross-process lock over real processes', () => {
  it('serializes two contenders while the holder pauses mid-acquire', async () => {
    const folder = scratchDir()
    const lockFile = path.join(folder, 'uploads.json.lock')
    const orderFile = path.join(folder, 'order.log')
    const holder = runContender(contenderScript(lockFile, orderFile, 'A', 600))
    await new Promise((settle) => setTimeout(settle, 150))
    await runContender(contenderScript(lockFile, orderFile, 'B', 0))
    await holder
    const orderText = await readFile(orderFile, 'utf8')
    const order = orderText.split('\n').filter((line) => line !== '')
    const enters = order.filter((line) => line.startsWith('enter-'))
    const leaves = order.filter((line) => line.startsWith('leave-'))
    expect(enters).toEqual(['enter-A', 'enter-B'])
    expect(leaves).toEqual(['leave-A', 'leave-B'])
    // The contender paused between attempts (mid-acquire) while A held the
    // lock, and still entered only after A left: no overlap, no steal.
    expect(order).toContain('wait-B')
    expect(order.indexOf('enter-B')).toBeGreaterThan(order.indexOf('leave-A'))
  })

  it('never steals a live lock: a pre-existing holder fails closed', async () => {
    const folder = scratchDir()
    const lockFile = path.join(folder, 'uploads.json.lock')
    await mkdir(lockFile, { recursive: true })
    await expect(
      withMkdirLock(
        lockFile,
        {
          sleep: () => Promise.resolve(),
          attempts: 3,
          waitMs: 0,
          locked: () => new Error('Upload ledger is locked'),
        },
        () => Promise.resolve('must not enter'),
      ),
    ).rejects.toThrow('Upload ledger is locked')
    // The holder's directory survives: nothing removed a live lock.
    const lockStat = await stat(lockFile)
    expect(lockStat.isDirectory()).toBe(true)
  })
})

function filesBackedClient() {
  const api = fakeModelApi()
  const files = fakeFilesApi(api.fetch)
  const log = new FakeLogOutputChannel()
  const client = new ModelApiClient({
    ...fakeModelApiClientSettings(log),
    fetch: files.fetch,
  })
  return { client, files }
}

describe('Files transport through the provider wrappers', () => {
  it('rides through runtime accounting when the inner client carries it', async () => {
    const { client, files } = filesBackedClient()
    const daily = createRuntimeDailyBudget({
      dataFolder: scratchDir(),
      now: () => Date.now(),
      sleep: () => Promise.resolve(),
    })
    const wrapped = withRuntimeAccounting(client, daily)
    expect('requestFile' in wrapped).toBe(true)
    const response = await wrapped.requestFile?.('/files', 'GET', AbortSignal.timeout(10_000))
    expect(response?.status).toBe(200)
    expect(files.uploads).toEqual([])
  })

  it('stays absent through runtime accounting when the inner client lacks it', () => {
    const { client } = filesBackedClient()
    const daily = createRuntimeDailyBudget({
      dataFolder: scratchDir(),
      now: () => Date.now(),
      sleep: () => Promise.resolve(),
    })
    const withoutFiles = { ...withRuntimeAccounting(client, daily) }
    delete withoutFiles.requestFile
    const rewrapped = withRuntimeAccounting(withoutFiles, daily)
    // A wrapped client without the transport keeps the established refusal.
    expect('requestFile' in rewrapped).toBe(false)
  })

  it('rides through configured providers to the Meta delegate', async () => {
    const { client } = filesBackedClient()
    const services = createConfiguredProviderServices(client, {
      configFile: path.join(scratchDir(), 'providers.json'),
      catalogFile: path.resolve('vendor/models-dev/snapshot.json'),
      secrets: memorySecrets(),
      hasMetaKey: () => Promise.resolve(true),
    })
    const response = await services.client.requestFile?.(
      '/files',
      'GET',
      AbortSignal.timeout(10_000),
    )
    expect(response?.status).toBe(200)
  })

  it('rides through the subscription client to Meta', async () => {
    const { client } = filesBackedClient()
    const api = fakeModelApi()
    const subscribed = createSubscriptionClient(client, {
      fetch: api.fetch,
      hasMetaKey: () => Promise.resolve(true),
      providers: () => Promise.resolve({ v: 1 as const, providers: [] }),
      chatgpt: () => Promise.reject(new Error('no subscription sign-in')),
      accountId: () => Promise.resolve(undefined),
    })
    const response = await subscribed.requestFile?.('/files', 'GET', AbortSignal.timeout(10_000))
    expect(response?.status).toBe(200)
  })
})

interface UploadedRef {
  readonly fileId: string
  readonly provider: string
  readonly expiresAt: number
  readonly sha256: string
  readonly bytes: number
  readonly name: string
  readonly mime: string
}

function requestHref(input: string | URL | Request): string {
  if (typeof input === 'string') return input
  return input instanceof URL ? input.href : input.url
}

async function uploadedRef(
  replay: ReturnType<typeof createProductionMediaReplay>,
): Promise<UploadedRef> {
  const bytes = new Uint8Array(2048)
  for (let index = 0; index < bytes.length; index++) bytes[index] = (index * 7) % 251
  const sha256 = createHash('sha256').update(bytes).digest('hex')
  return await replay.upload(
    {
      name: 'clip.mp4',
      info: {
        kind: 'video',
        mediaType: 'video/mp4',
        sizeBytes: bytes.length,
        durationSeconds: 10,
        hasSoundtrack: true,
        width: 320,
        height: 240,
      },
      sha256,
      source: mediaByteSource('clip.mp4', 'video/mp4', bytes),
    },
    MODEL,
    AbortSignal.timeout(10_000),
  )
}

describe('session store ownership over the real ledger', () => {
  const LAST_ACTIVITY = '2026-09-22T10:00:00.000Z'
  const stored = (sessionId: string, name?: string): StoredSession =>
    emptyStoredSession(sessionId, LAST_ACTIVITY, name)

  function boundStore(options?: {
    readonly failDeletes?: boolean
    readonly retentionDays?: number
    readonly now?: number
  }) {
    const api = fakeModelApi()
    const files = fakeFilesApi(api.fetch)
    const log = new FakeLogOutputChannel()
    const refusingFetch = async (
      input: string | URL | Request,
      init?: RequestInit,
    ): Promise<Response> => {
      const href = requestHref(input)
      const isDelete =
        (init?.method ?? 'GET') === 'DELETE' && new URL(href).pathname.includes('/files/')
      return isDelete
        ? Response.json({ error: { message: 'provider exploded' } }, { status: 500 })
        : await files.fetch(input, init)
    }
    const fetch: typeof globalThis.fetch =
      options?.failDeletes === true ? refusingFetch : files.fetch
    const keyClient = () =>
      new ModelApiClient({
        ...fakeModelApiClientSettings(log),
        apiKey: () => Promise.resolve(FAKE_MODEL_API_KEY),
        fetch,
      })
    // The replay and the store share one uploads root, as in the hosts.
    const uploadLedgerDir = scratchDir()
    const uploads = createSessionUploads({
      uploadLedgerDir,
      currentAccountId: () => Promise.resolve(FAKE_MODEL_API_ACCOUNT_ID),
      filesClient: keyClient,
    })
    const store = createFileSessionStore({
      directory: scratchDir(),
      log,
      retentionDays: () => options?.retentionDays ?? 30,
      now: () => options?.now ?? Date.parse(LAST_ACTIVITY),
      sleep: () => Promise.resolve(),
      uploads,
    })
    const replay = createProductionMediaReplay({
      sessionId: 'media-turn',
      client: keyClient(),
      accountId: FAKE_MODEL_API_ACCOUNT_ID,
      currentAccountId: () => Promise.resolve(FAKE_MODEL_API_ACCOUNT_ID),
      directory: uploadLedgerDir,
      log,
      isCapped: () => true,
      isClosed: () => false,
      source: () => Promise.resolve(undefined),
    })
    return { store, replay, files }
  }

  it('saves and reopens a media turn through the real file session store', async () => {
    const t = boundStore()
    // The replay and the store share one uploads root, as in the hosts.
    const ref = await uploadedRef(t.replay)
    const session = {
      ...stored('media-turn'),
      accountId: FAKE_MODEL_API_ACCOUNT_ID,
      fileRefs: [ref],
    }
    await t.store.save(session)
    // A media turn survives reopening with its file references intact.
    await expect(t.store.load('media-turn')).resolves.toMatchObject({ fileRefs: [ref] })
    const headers = await t.store.list()
    expect(headers.map((header) => header.sessionId)).toContain('media-turn')
  })

  it('releases the session provider uploads on delete, confirmed by the provider', async () => {
    const t = boundStore()
    const ref = await uploadedRef(t.replay)
    await t.store.save({
      ...stored('media-turn'),
      accountId: FAKE_MODEL_API_ACCOUNT_ID,
      fileRefs: [ref],
    })
    await t.store.remove('media-turn')
    await expect(t.store.load('media-turn')).resolves.toBeUndefined()
    // The provider deletion ran: the fake records it, and nothing is retained.
    expect(t.files.deletes).toEqual([ref.fileId])
  })

  it('releases uploads on retention purge', async () => {
    const t = boundStore({
      retentionDays: 30,
      now: Date.parse(LAST_ACTIVITY) + 31 * 24 * 3_600_000,
    })
    const ref = await uploadedRef(t.replay)
    await t.store.save({
      ...stored('media-turn'),
      accountId: FAKE_MODEL_API_ACCOUNT_ID,
      fileRefs: [ref],
    })
    expect(await t.store.list()).toEqual([])
    expect(t.files.deletes).toEqual([ref.fileId])
  })

  it('reports a provider deletion failure honestly and retains the session', async () => {
    const t = boundStore({ failDeletes: true })
    const ref = await uploadedRef(t.replay)
    await t.store.save({
      ...stored('media-turn'),
      accountId: FAKE_MODEL_API_ACCOUNT_ID,
      fileRefs: [ref],
    })
    await expect(t.store.remove('media-turn')).rejects.toThrow()
    // Nothing was silently dropped: the session still reopens.
    await expect(t.store.load('media-turn')).resolves.toMatchObject({ fileRefs: [ref] })
  })
})
describe('per-account upload ledgers', () => {
  it('isolates accounts: B uploads fresh after A, replaying only its own files', async () => {
    const api = fakeModelApi()
    const files = fakeFilesApi(api.fetch)
    const log = new FakeLogOutputChannel()
    const root = scratchDir()
    const replayFor = (accountId: string, key: string) =>
      createProductionMediaReplay({
        sessionId: `session-${accountId.slice(0, 8)}`,
        client: new ModelApiClient({
          ...fakeModelApiClientSettings(log),
          apiKey: () => Promise.resolve(key),
          fetch: files.fetch,
        }),
        accountId,
        currentAccountId: () => Promise.resolve(accountId),
        directory: root,
        log,
        isCapped: () => true,
        isClosed: () => false,
        source: () => Promise.resolve(undefined),
      })
    const bytes = new Uint8Array(4096)
    for (let index = 0; index < bytes.length; index++) bytes[index] = index % 251
    const sha256 = createHash('sha256').update(bytes).digest('hex')
    const source = () => mediaByteSource('clip.mp4', 'video/mp4', bytes)
    const media = (digest: string) => ({
      name: 'clip.mp4',
      info: {
        kind: 'video' as const,
        mediaType: 'video/mp4' as const,
        sizeBytes: bytes.length,
        durationSeconds: 10,
        hasSoundtrack: true,
        width: 320,
        height: 240,
      },
      sha256: digest,
      source: source(),
    })
    const uploadedA = await replayFor(FAKE_MODEL_API_ACCOUNT_ID, FAKE_MODEL_API_KEY).upload(
      media(sha256),
      MODEL,
      AbortSignal.timeout(10_000),
    )
    // The same bytes on a switched key upload fresh: no account-mismatch
    // failure, and B never replays A's file id.
    const uploadedB = await replayFor(ACCOUNT_B, KEY_B).upload(
      media(sha256),
      MODEL,
      AbortSignal.timeout(10_000),
    )
    expect(uploadedB.fileId).not.toBe(uploadedA.fileId)
    expect(files.uploads).toHaveLength(2)
    // Each account owns its ledger file, bound to its own digest.
    for (const accountId of [FAKE_MODEL_API_ACCOUNT_ID, ACCOUNT_B]) {
      const state = JSON.parse(
        readFileSync(path.join(productionMediaDirectory(root, accountId), 'uploads.json'), 'utf8'),
      ) as { accountId: string; entries: { file: { fileId: string } }[] }
      expect(state.accountId).toBe(accountId)
      expect(state.entries).toHaveLength(1)
    }
    const stateB = JSON.parse(
      readFileSync(path.join(accountLedgerDirectory(root, ACCOUNT_B), 'uploads.json'), 'utf8'),
    ) as { entries: { file: { fileId: string } }[] }
    expect(stateB.entries[0]?.file.fileId).toBe(uploadedB.fileId)
  })
})

function calibrationStore(folder: string, log: FakeLogOutputChannel) {
  return fileCalibrationStore(folder, log, {
    sleep: () => Promise.resolve(),
    attempts: 50,
    waitMs: 1,
  })
}

describe('calibration settlement merge', () => {
  it('keeps both sessions settlements: 25 points, not 24', async () => {
    const folder = scratchDir()
    const log = new FakeLogOutputChannel()
    const store = calibrationStore(folder, log)
    const estimatorFor = () =>
      new MediaCostEstimator({
        read: store.read,
        write: store.write,
        withLock: store.withLock,
        safetyFactor: MEDIA_ESTIMATE_SAFETY_FACTOR,
      })
    // Both sessions start from the 23 seeds, then settle one turn each.
    const first = estimatorFor()
    const second = estimatorFor()
    const item = {
      info: { kind: 'image' as const, mediaType: 'image/png' as const, sizeBytes: 2048 },
    }
    await first.observe('meta', MODEL, [item], { input_tokens: 4086, output_tokens: 64 }, 'cap-a')
    await second.observe('meta', MODEL, [item], { input_tokens: 4086, output_tokens: 64 }, 'cap-b')
    const points = JSON.parse(readFileSync(path.join(folder, 'calibration.json'), 'utf8')) as {
      captureId: string
    }[]
    expect(points).toHaveLength(25)
    expect(points.filter((point) => point.captureId === 'cap-a')).toHaveLength(1)
    expect(points.filter((point) => point.captureId === 'cap-b')).toHaveLength(1)
  })

  it('writes staging files with unique names per writer', async () => {
    const folder = scratchDir()
    const log = new FakeLogOutputChannel()
    const store = calibrationStore(folder, log)
    const estimator = new MediaCostEstimator({
      read: store.read,
      write: store.write,
      withLock: store.withLock,
      safetyFactor: MEDIA_ESTIMATE_SAFETY_FACTOR,
    })
    const item = {
      info: { kind: 'image' as const, mediaType: 'image/png' as const, sizeBytes: 2048 },
    }
    await estimator.observe(
      'meta',
      MODEL,
      [item],
      { input_tokens: 4086, output_tokens: 64 },
      'cap-x',
    )
    const names = await readdir(folder)
    const leftovers = names.filter((name) => name.endsWith('.tmp'))
    expect(leftovers).toEqual([])
    await mkdir(folder, { recursive: true })
    expect(readFileSync(path.join(folder, 'calibration.json'), 'utf8')).toContain('cap-x')
  })
})
