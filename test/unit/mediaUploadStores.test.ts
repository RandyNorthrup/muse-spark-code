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
import { describe, expect, it, vi } from 'vitest'
import { withMkdirLock } from '../../src/core/fileLock'
import { MediaCostEstimator } from '../../src/core/media/mediaCost'
import {
  createProductionMediaReplay,
  productionMediaDirectory,
} from '../../src/core/media/productionMedia'
import {
  accountLedgerDirectory,
  fileUploadLedgerStorage,
} from '../../src/core/media/uploadLedgerStorage'
import { UploadLedger } from '../../src/core/media/uploadLedger'
import { fileCalibrationStore } from '../../src/core/media/productionMedia'
import {
  MEDIA_ESTIMATE_SAFETY_FACTOR,
  MEDIA_PROVIDER_POOL_BYTES,
  MEDIA_UPLOAD_DELETE_RETRY_BASE_DELAY_MS,
} from '../../src/shared/constants'
import { ModelApiClient } from '../../src/core/backends/modelapi/client'
import { FilesApi } from '../../src/core/backends/modelapi/files'
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
    readonly clock?: { now: number }
  }) {
    const api = fakeModelApi()
    const files = fakeFilesApi(api.fetch)
    const log = new FakeLogOutputChannel()
    let shouldFailDeletes = options?.failDeletes ?? false
    const refusingFetch = async (
      input: string | URL | Request,
      init?: RequestInit,
    ): Promise<Response> => {
      const href = requestHref(input)
      const isDelete =
        (init?.method ?? 'GET') === 'DELETE' && new URL(href).pathname.includes('/files/')
      return isDelete && shouldFailDeletes
        ? Response.json({ error: { message: 'provider exploded' } }, { status: 500 })
        : await files.fetch(input, init)
    }
    const fetch: typeof globalThis.fetch = refusingFetch
    const keyClient = () =>
      new ModelApiClient({
        ...fakeModelApiClientSettings(log),
        apiKey: () => Promise.resolve(FAKE_MODEL_API_KEY),
        fetch,
      })
    // The replay and the store share one uploads root, as in the hosts.
    const uploadLedgerDir = scratchDir()
    const clock = options?.clock
    const uploads = createSessionUploads({
      uploadLedgerDir,
      currentAccountId: () => Promise.resolve(FAKE_MODEL_API_ACCOUNT_ID),
      filesClient: keyClient,
      ...(clock !== undefined && { now: () => clock.now }),
    })
    const store = createFileSessionStore({
      directory: scratchDir(),
      log,
      retentionDays: () => options?.retentionDays ?? 30,
      now: () => options?.clock?.now ?? options?.now ?? Date.parse(LAST_ACTIVITY),
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
    return {
      store,
      replay,
      files,
      setFailDeletes: (shouldFail: boolean) => {
        shouldFailDeletes = shouldFail
      },
    }
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

  it('removes the session when its provider deletion fails, and saves keep working until the next sweep cleans it', async () => {
    const clock = { now: Date.parse('2026-09-22T10:00:00.000Z') }
    const t = boundStore({ failDeletes: true, clock })
    const ref = await uploadedRef(t.replay)
    await t.store.save({
      ...stored('media-turn'),
      accountId: FAKE_MODEL_API_ACCOUNT_ID,
      fileRefs: [ref],
    })
    // The session file is gone, but the provider still holds the bytes: the
    // ledger keeps the unowned entry with its recorded failure instead of
    // orphaning it (RVAPP-PORTM105R4 P2-B).
    await t.store.remove('media-turn')
    await expect(t.store.load('media-turn')).resolves.toBeUndefined()
    expect(t.files.files.size).toBe(1)
    // Another entry's failed delete never fails a save: this session carries
    // no files, yet its save runs the same sweep under the same account.
    await t.store.save({ ...stored('other-turn'), accountId: FAKE_MODEL_API_ACCOUNT_ID })
    await expect(t.store.load('other-turn')).resolves.toMatchObject({ sessionId: 'other-turn' })
    expect(t.files.files.size).toBe(1)
    // The provider is back and the backoff is due: the next sweep deletes
    // the retained file.
    t.setFailDeletes(false)
    clock.now += MEDIA_UPLOAD_DELETE_RETRY_BASE_DELAY_MS
    await t.store.save({ ...stored('third-turn'), accountId: FAKE_MODEL_API_ACCOUNT_ID })
    expect(t.files.files.size).toBe(0)
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

/**
 * RVM105 1: an upload that reached the provider is never orphaned. The real
 * FilesApi and the real per-account ledger run over the fake provider; the
 * fetch wrapper cancels the caller just after the provider answers with its
 * receipt (the review's confirmed scenario), or refuses the clean-up DELETE.
 * VS Code, ACP and exec share this FilesApi and ledger: only their transports
 * differ, and the exec transport's bounded clean-up route is covered in
 * execFetch.test.ts.
 */
function orphanRig(options?: {
  readonly failDeletes?: boolean
  readonly failWrites?: number
  readonly abortAfterReceipt?: boolean
  readonly interruptAt?: 'json' | 'intent' | 'publication'
  readonly failPublication?: boolean
  /** Fail post-publication cancel-intent writes (RVM105B P2-2). */
  readonly failCancelIntentWrites?: number
  /** Fail the forget write after a successful cancel DELETE (RVM105B P2-2). */
  readonly failForgetWrites?: number
}) {
  const api = fakeModelApi()
  const files = fakeFilesApi(api.fetch)
  let shouldFailDeletes = options?.failDeletes ?? false
  let failWrites = options?.failWrites ?? 0
  let failCancelIntentWrites = options?.failCancelIntentWrites ?? 0
  let failForgetWrites = options?.failForgetWrites ?? 0
  let hasCommittedPublication = false
  let deletesAttempted = 0
  const shouldAbortAfterReceipt = options?.abortAfterReceipt ?? true
  const caller = new AbortController()
  const cleanupIntents: unknown[] = []
  const fetch: typeof globalThis.fetch = async (input, init) => {
    const pathname = new URL(requestHref(input)).pathname
    const method = init?.method ?? 'GET'
    if (method === 'DELETE') {
      deletesAttempted += 1
      cleanupIntents.push(await storage.read())
    }
    if (method === 'DELETE' && shouldFailDeletes && pathname.includes('/files/'))
      return Response.json(
        { error: { message: 'delete failed', type: 'server_error' } },
        { status: 500 },
      )
    const response = await files.fetch(input, init)
    if (method === 'POST' && options?.interruptAt === 'json') {
      const json = response.json.bind(response)
      vi.spyOn(response, 'json').mockImplementation(async () => {
        const receipt: unknown = await json()
        caller.abort(new Error('cancelled after receipt'))
        return receipt
      })
    }
    // Cancellation lands after the provider answered with its receipt.
    if (shouldAbortAfterReceipt && method === 'POST' && pathname.endsWith('/files'))
      caller.abort(new Error('cancelled after receipt'))
    return response
  }
  const log = new FakeLogOutputChannel()
  const client = () =>
    new ModelApiClient({
      ...fakeModelApiClientSettings(log),
      apiKey: () => Promise.resolve(FAKE_MODEL_API_KEY),
      fetch,
    })
  const accountId = FAKE_MODEL_API_ACCOUNT_ID
  const inner = fileUploadLedgerStorage(accountLedgerDirectory(scratchDir(), accountId), {
    sleep: () => Promise.resolve(),
  })
  const storage = {
    ...inner,
    write: async (state: Parameters<typeof inner.write>[0]) => {
      if (failWrites > 0) {
        failWrites -= 1
        throw new Error('Disk full')
      }
      if (options?.failPublication && state.entries.length > 0) throw new Error('Disk full')
      // After the publication commit, an entry-free write that still names an
      // orphan is the cancel intent; an entry-free write with no orphans
      // after a DELETE is the forget write. The intent-shaped write fails
      // whatever the DELETE count (RVAPP-PORTM105R4 P3-1), so the rig also
      // reproduces the old DELETE-first bug: a failed DELETE followed by a
      // failed intent write.
      if (hasCommittedPublication && state.entries.length === 0) {
        if ((state.orphans?.length ?? 0) > 0 && failCancelIntentWrites > 0) {
          failCancelIntentWrites -= 1
          throw new Error('Disk full')
        }
        if ((state.orphans?.length ?? 0) === 0 && deletesAttempted > 0 && failForgetWrites > 0) {
          failForgetWrites -= 1
          throw new Error('Disk full')
        }
      }
      await inner.write(state)
      if (state.entries.length > 0) hasCommittedPublication = true
      if (
        (options?.interruptAt === 'intent' && (state.orphans?.length ?? 0) > 0) ||
        (options?.interruptAt === 'publication' && state.entries.length > 0)
      )
        caller.abort(new Error('cancelled after receipt'))
    },
  }
  const ledger = () =>
    new UploadLedger({
      storage,
      files: new FilesApi({
        client: client(),
        provider: 'meta',
        authorizeUpload: () => Promise.resolve(),
      }),
      accountId,
      provider: 'meta',
      poolBytes: MEDIA_PROVIDER_POOL_BYTES,
      currentAccountId: () => Promise.resolve(accountId),
      now: () => Date.now(),
    })
  const bytes = new Uint8Array(2048)
  for (let index = 0; index < bytes.length; index++) bytes[index] = (index * 7) % 251
  const sha256 = createHash('sha256').update(bytes).digest('hex')
  const source = mediaByteSource('clip.mp4', 'video/mp4', bytes)
  return {
    files,
    cleanupIntents,
    caller,
    storage,
    ledger,
    setFailDeletes: (shouldFail: boolean) => {
      shouldFailDeletes = shouldFail
    },
    setFailWrites: (count: number) => {
      failWrites = count
    },
    ensure: (signal: AbortSignal) => ledger().ensure('session-1', sha256, source, signal),
    state: async () => await storage.read(),
  }
}

function hasIteratorReturn(
  target: object | null,
): target is { return(...args: unknown[]): unknown } {
  return target !== null && 'return' in target && typeof target.return === 'function'
}

function spyIteratorClose() {
  const value = Promise.resolve(1)
  const iterator = (async function* () {
    yield await value
  })()
  const prototype = Reflect.getPrototypeOf(Reflect.getPrototypeOf(iterator) ?? iterator)
  if (!hasIteratorReturn(prototype)) throw new Error('Async generator return is unavailable')
  return vi.spyOn(prototype, 'return')
}

describe('an upload that reached the provider is never orphaned', () => {
  it('has durable cleanup intent before the iterator-close await and upload publication', async () => {
    const t = orphanRig({ abortAfterReceipt: false })
    const close = spyIteratorClose().mockImplementationOnce(async () => {
      expect(await t.state()).toMatchObject({ entries: [], orphans: [t.files.uploads[0]?.fileId] })
      return { done: true, value: undefined }
    })
    try {
      await t.ensure(t.caller.signal)
      expect(close).toHaveBeenCalled()
    } finally {
      close.mockRestore()
    }
  })

  it('deletes the known receipt when the final iterator-close await fails', async () => {
    const close = spyIteratorClose().mockRejectedValueOnce(new Error('close failed'))
    const t = orphanRig({ abortAfterReceipt: false })
    try {
      await expect(t.ensure(t.caller.signal)).rejects.toThrow('close failed')
      expect(t.files.uploads).toHaveLength(1)
      expect(t.files.deletes).toEqual([t.files.uploads[0]?.fileId])
      expect(t.files.files.size).toBe(0)
    } finally {
      close.mockRestore()
    }
  })

  it.each(['json', 'intent', 'publication'] as const)(
    'keeps provider cleanup ownership when interrupted during %s',
    async (interruptAt) => {
      const t = orphanRig({ abortAfterReceipt: false, interruptAt })
      // Publication is durable before its await resolves; cancellation there
      // cannot remove ownership. Every earlier interruption deletes the file.
      try {
        await t.ensure(t.caller.signal)
      } catch {
        expect(t.caller.signal.aborted).toBe(true)
      }
      const id = t.files.uploads[0]?.fileId
      expect(id).toBeDefined()
      const state = await t.state()
      expect(t.files.deletes.includes(id ?? '') || JSON.stringify(state).includes(id ?? '')).toBe(
        true,
      )
    },
  )

  it.each([
    {
      name: 'retains the pre-publication intent when publication and provider deletion fail',
      isWriteFailure: true,
    },
    {
      name: 'records deletion after cancellation during a committed publication and a failed DELETE',
      isWriteFailure: false,
    },
  ])('$name', async ({ isWriteFailure }) => {
    const t = orphanRig({
      abortAfterReceipt: false,
      failDeletes: true,
      ...(isWriteFailure ? { failPublication: true } : { interruptAt: 'publication' }),
    })
    await expect(t.ensure(t.caller.signal)).rejects.toThrow(
      isWriteFailure ? 'Disk full' : 'cancelled after receipt',
    )
    expect(await t.state()).toMatchObject({ entries: [], orphans: [t.files.uploads[0]?.fileId] })
    t.setFailDeletes(false)
    await t.ledger().accountReport()
    expect(t.files.files.size).toBe(0)
  })
  it('cancels before any receipt without a clean-up: no DELETE, no intent', async () => {
    const t = orphanRig()
    t.caller.abort(new Error('cancelled before upload'))
    await expect(t.ensure(t.caller.signal)).rejects.toThrow('cancelled before upload')
    expect(t.files.uploads).toEqual([])
    expect(t.files.deletes).toEqual([])
    expect(await t.state()).toBeUndefined()
  })

  it('deletes at the provider when cancellation lands after the receipt', async () => {
    const t = orphanRig()
    await expect(t.ensure(t.caller.signal)).rejects.toThrow('cancelled after receipt')
    const uploaded = t.files.uploads[0]
    expect(uploaded).toBeDefined()
    // The intent was durable before the detached DELETE started.
    expect(t.files.deletes).toEqual([uploaded?.fileId])
    expect(t.files.files.size).toBe(0)
    expect(t.cleanupIntents[0]).toMatchObject({ entries: [], orphans: [uploaded?.fileId] })
    await t.ledger().accountReport()
    expect(await t.state()).toMatchObject({ entries: [], orphans: [] })
  })

  it.each([false, true])(
    'records a clean-up intent when DELETE fails (first write fails: %s)',
    async (failWrite) => {
      const t = orphanRig({
        failDeletes: true,
        failWrites: failWrite ? 1 : 0,
        abortAfterReceipt: !failWrite,
      })
      // The caller still sees the original upload failure, not the clean-up.
      await expect(t.ensure(t.caller.signal)).rejects.toThrow(
        failWrite ? 'Disk full' : 'cancelled after receipt',
      )
      const uploaded = t.files.uploads[0]
      expect(uploaded).toBeDefined()
      expect(t.files.deletes).toEqual([])
      expect(await t.state()).toMatchObject({ entries: [], orphans: [uploaded?.fileId] })
      // A fresh ledger over the same directory proves the intent is durable:
      // the next sweep deletes the provider file and clears the intent.
      t.setFailDeletes(false)
      await t.ledger().accountReport()
      expect(t.files.deletes).toEqual([uploaded?.fileId])
      expect(t.files.files.size).toBe(0)
      expect(await t.state()).toMatchObject({ entries: [], orphans: [] })
    },
  )

  it('deletes at the provider when the ledger write after a good upload fails', async () => {
    const t = orphanRig({ failWrites: 1, abortAfterReceipt: false })
    await expect(t.ensure(t.caller.signal)).rejects.toThrow('Disk full')
    expect(t.files.uploads).toHaveLength(1)
    // The write-failure path removed the receipt it could not record.
    expect(t.files.deletes).toEqual(t.files.uploads.map((file) => file.fileId))
    expect(t.files.files.size).toBe(0)
    expect(await t.state()).toBeUndefined()
  })
})

/**
 * RVM105B P2-2: a cancelled upload is never left referenced. The ledger
 * records the deletion intent BEFORE the remote DELETE, so the write-failure
 * table below always resolves: nothing remote is left forever (the next sweep
 * deletes it) and nothing in use is deleted (referenced entries are skipped).
 * Shared preparation and intent assertions keep the zero-clone gate green.
 */
async function cancelAfterPublication(options?: Parameters<typeof orphanRig>[0]) {
  const rig = orphanRig({ abortAfterReceipt: false, interruptAt: 'publication', ...options })
  // The caller keeps the original cancellation, never a cleanup write error.
  await expect(rig.ensure(rig.caller.signal)).rejects.toThrow('cancelled after receipt')
  const uploaded = rig.files.uploads[0]
  expect(uploaded).toBeDefined()
  if (uploaded === undefined) throw new Error('expected an upload')
  return { rig, uploaded }
}

async function expectDurableIntent(
  rig: ReturnType<typeof orphanRig>,
  uploaded: { readonly fileId: string },
) {
  expect(await rig.state()).toMatchObject({ entries: [], orphans: [uploaded.fileId] })
}

async function expectSweepCleans(
  rig: ReturnType<typeof orphanRig>,
  expectedDeletes: readonly string[],
) {
  // A fresh ledger proves the intent is durable: the next sweep deletes the
  // provider file and forgets it.
  rig.setFailDeletes(false)
  await rig.ledger().accountReport()
  expect(rig.files.deletes).toEqual(expectedDeletes)
  expect(rig.files.files.size).toBe(0)
  expect(await rig.state()).toMatchObject({ entries: [], orphans: [] })
}

describe('a cancelled upload is never left referenced', () => {
  it('resolves cancel after a committed publication when DELETE and the first intent write fail', async () => {
    const { rig, uploaded } = await cancelAfterPublication({
      failDeletes: true,
      failCancelIntentWrites: 1,
    })
    // Owned, cancel requested, intent unwritten never reaches durable state:
    // the retried intent replaced the ownership.
    await expectDurableIntent(rig, uploaded)
    // The intent was durable before the first DELETE started: under the old
    // DELETE-first order this read still names the uncommitted ownership.
    expect(rig.cleanupIntents[0]).toMatchObject({ entries: [], orphans: [uploaded.fileId] })
    await expectSweepCleans(rig, [uploaded.fileId])
  })

  it('forgets a cancelled upload whose remote copy is already gone when the forget write fails', async () => {
    const { rig, uploaded } = await cancelAfterPublication({ failForgetWrites: 1 })
    expect(rig.files.deletes).toEqual([uploaded.fileId])
    expect(rig.files.files.size).toBe(0)
    // The forget write failed, so the intent stays; the next sweep meets a
    // missing file, deletes as found, and forgets it.
    await expectDurableIntent(rig, uploaded)
    await rig.ledger().accountReport()
    expect(rig.files.files.size).toBe(0)
    expect(await rig.state()).toMatchObject({ entries: [], orphans: [] })
  })

  it('keeps the sweep intent across a failed sweep write and resolves on the next sweep', async () => {
    const { rig, uploaded } = await cancelAfterPublication({ failDeletes: true })
    await expectDurableIntent(rig, uploaded)
    // The provider is back but the sweep cannot write: it reports the failure
    // and keeps the intent (the remote copy is already deleted) for the next
    // sweep, which forgets it.
    rig.setFailDeletes(false)
    rig.setFailWrites(1)
    await expect(rig.ledger().accountReport()).rejects.toThrow('Disk full')
    expect(rig.files.files.size).toBe(0)
    await expectDurableIntent(rig, uploaded)
    await rig.ledger().accountReport()
    expect(rig.files.deletes).toEqual([uploaded.fileId, uploaded.fileId])
    expect(rig.files.files.size).toBe(0)
    expect(await rig.state()).toMatchObject({ entries: [], orphans: [] })
  })

  it('never deletes a referenced upload during a failing sweep', async () => {
    const t = orphanRig({ abortAfterReceipt: false })
    await t.ensure(t.caller.signal)
    const uploaded = t.files.uploads[0]
    expect(uploaded).toBeDefined()
    expect(await t.state()).toMatchObject({
      entries: [{ sessions: ['session-1'] }],
      orphans: [],
    })
    t.setFailDeletes(true)
    await t.ledger().accountReport()
    expect(t.files.deletes).toEqual([])
    expect(t.files.files.size).toBe(1)
    expect(await t.state()).toMatchObject({
      entries: [{ sessions: ['session-1'] }],
      orphans: [],
    })
  })
})
