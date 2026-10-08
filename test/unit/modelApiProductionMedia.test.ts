import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { createHash } from 'node:crypto'
import { afterAll, describe, expect, it, vi } from 'vitest'
import { createModelApiHost } from '../../src/host/backend/modelApiEntry'
import { ModelApiBackendManager } from '../../src/host/backend/modelApiBackendManager'
import { fakeManagerDeps } from './helpers/modelApiManager'
import { MediaBudget } from '../../src/core/backends/modelapi/mediaBudget'
import {
  createProductionMediaReplay,
  productionMediaDirectory,
} from '../../src/core/media/productionMedia'
import { fill } from '../../src/shared/l10n/text'
import {
  MODEL_API_PRICES_PER_MILLION,
  TOKENS_PER_MILLION,
  UI_TEXT,
} from '../../src/shared/constants'
import { EN } from '../../src/shared/l10n/en'
import { Usd, type UsdAmount } from '../../src/shared/usd'
import type { ScheduleRunDeps } from '../../src/core/schedules/unattended'
import type { ToolIo } from '../../src/core/backends/modelapi/tools'
import { estimateInput, requestParts } from '../../src/core/backends/modelapi/sessionBudget'
import {
  fakeModelApi,
  fakeModelApiClient,
  fakeModelApiClientSettings,
  FAKE_MODEL_API_ACCOUNT_ID,
} from './helpers/fakeModelApi'
import { fakeFilesApi, type FakeFilesApi } from './helpers/fakeFiles'
import { fakeModelApiHostDeps } from './helpers/modelApiHostDeps'
import { FakeLogOutputChannel } from './helpers/fakes'
import { memoryToolIo } from './helpers/fakeToolIo'
import { memorySessionStore } from './helpers/fakeSessionStore'
import { watchSessionTurns } from './helpers/sessionTurns'
import { fakeRunContext, fakeSchedule } from './helpers/schedules/fixtures'
import { unattendedRun } from './helpers/schedules/unattended'
import type { ModelApiHost } from '../../src/core/backends/modelapi/ModelApiHost'
import {
  createRuntimeDailyBudget,
  withRuntimeAccounting,
} from '../../src/runtime/runtimeAccountingEntry'

const MODEL = 'muse-spark-1.3-contributor'
// The 10-second seed bills 2,751 input tokens; the largest calibrated default
// rate (275.1/s) times the safety factor 2 reserves exactly this.
const VIDEO_10S_BOUND = 5502
// Every image seed bills 4,086 tokens regardless of detail; times 2.
const IMAGE_BOUND = 8172

const folders: string[] = []
afterAll(() => {
  for (const folder of folders) rmSync(folder, { recursive: true, force: true })
})

function scratchDir(): string {
  const folder = mkdtempSync(path.join(tmpdir(), 'muse-production-media-'))
  folders.push(folder)
  return folder
}

function fixtureBytes(size: number): {
  bytes: Uint8Array
  chunk: Promise<Uint8Array>
  sha256: string
} {
  const bytes = new Uint8Array(size)
  for (let index = 0; index < size; index++) bytes[index] = index % 251
  return {
    bytes,
    chunk: Promise.resolve(bytes),
    sha256: createHash('sha256').update(bytes).digest('hex'),
  }
}

interface ProductionRig {
  host: ModelApiHost
  api: ReturnType<typeof fakeModelApi>
  files: FakeFilesApi
  io: ReturnType<typeof memoryToolIo>
  ledgerDir: string
  close: () => Promise<void>
}

async function productionHost(options: {
  ledgerDir: string
  readMedia?: NonNullable<ToolIo['readMedia']>
  getAccountId?: () => Promise<string | undefined>
  createProviderClient?: Parameters<typeof createModelApiHost>[0]['createProviderClient']
}): Promise<ProductionRig> {
  const api = fakeModelApi()
  const files = fakeFilesApi(api.fetch)
  const fetch = files.fetch
  const log = new FakeLogOutputChannel()
  const io = memoryToolIo({}, '/ws')
  if (options.readMedia !== undefined) Object.assign(io, { readMedia: options.readMedia })
  const host = await createModelApiHost({
    uiText: EN,
    uiLocale: 'en',
    client: { ...fakeModelApiClientSettings(log), fetch },
    ...(options.createProviderClient !== undefined && {
      createProviderClient: options.createProviderClient,
    }),
    host: {
      ...fakeModelApiHostDeps({
        client: fakeModelApiClient({ ...api, fetch }, log),
        log,
        io,
        workspaceRoot: '/ws',
      }),
      store: memorySessionStore(),
      isPaidFeatureOn: () => true,
      confirmContributorModel: () => Promise.resolve(true),
      ...(options.getAccountId !== undefined && { getAccountId: options.getAccountId }),
      uploadLedgerDir: options.ledgerDir,
    },
    hookSettingsPath: undefined,
    createMcpServers: undefined,
  })
  return { host, api, files, io, ledgerDir: options.ledgerDir, close: () => host.close() }
}

async function hostWithMedia(options: {
  ledgerDir: string
  info: { kind: 'video'; durationSeconds: number } | { kind: 'image' } | { kind: 'document' }
  name: string
  mediaType: string
  size?: number
}): Promise<ProductionRig & { sha256: string }> {
  const { bytes, chunk, sha256 } = fixtureBytes(options.size ?? 32_768)
  let info:
    | {
        kind: 'video'
        mediaType: 'video/mp4'
        sizeBytes: number
        durationSeconds: number
        hasSoundtrack: boolean
        width: number
        height: number
      }
    | { kind: 'image'; mediaType: 'image/png'; sizeBytes: number; width: number; height: number }
    | {
        kind: 'document'
        mediaType: 'application/pdf'
        sizeBytes: number
        pageCount: number
      }
  if (options.info.kind === 'video') {
    info = {
      kind: 'video',
      mediaType: 'video/mp4',
      sizeBytes: bytes.length,
      durationSeconds: options.info.durationSeconds,
      hasSoundtrack: true,
      width: 320,
      height: 240,
    }
  } else if (options.info.kind === 'image') {
    info = {
      kind: 'image',
      mediaType: 'image/png',
      sizeBytes: bytes.length,
      width: 3000,
      height: 2000,
    }
  } else {
    info = {
      kind: 'document',
      mediaType: 'application/pdf',
      sizeBytes: bytes.length,
      pageCount: 3,
    }
  }
  const readMedia: NonNullable<ToolIo['readMedia']> = () =>
    Promise.resolve({
      info,
      sha256,
      source: {
        name: options.name,
        mime: options.mediaType,
        bytes: bytes.length,
        open: async function* () {
          yield await chunk
        },
      },
    })
  const rig = await productionHost({ ledgerDir: options.ledgerDir, readMedia })
  return { ...rig, sha256 }
}

/** Whether a part is one of this file's fake uploads. */
function isTestFile(part: unknown): boolean {
  return (
    typeof part === 'object' &&
    part !== null &&
    'file_id' in part &&
    typeof part.file_id === 'string' &&
    (part as { file_id: string }).file_id.startsWith('file-test-')
  )
}

/** The tariff-aware admission fence: the seed bound, or a cap one nano under. */
function tariffReserve(bound: number, isBelowCap: boolean) {
  const settlements: ReturnType<
    typeof vi.fn<(amount: UsdAmount, isUnknown?: boolean) => Promise<unknown>>
  >[] = []
  const prices = MODEL_API_PRICES_PER_MILLION.contributor
  const reserve = vi.fn<NonNullable<ScheduleRunDeps['paid']>['reserve']>(
    (body, inputTokens, _signal, admitted) => {
      if (!('input' in body)) throw new Error('Expected Responses request')
      // Mirrors budgetParts: managed parts (file ids and priced inline
      // visuals) leave the text estimate; their bound is added instead.
      const stripped = {
        ...body,
        input: body.input.map((item) =>
          item.type === 'message'
            ? {
                ...item,
                content: item.content.filter(
                  (part) => !isTestFile(part) && !JSON.stringify(part).includes('data:image/'),
                ),
              }
            : item,
        ),
      }
      const textTokens = estimateInput(requestParts(stripped), undefined).inputTokens
      const serialized = JSON.stringify(body.input)
      const hasMedia = serialized.includes('file-test-') || serialized.includes('data:image/')
      const expected = Usd.from(prices.input)
        .times(textTokens + (hasMedia ? bound : 0))
        .add(Usd.from(prices.output).times(body.max_output_tokens))
        .divide(TOKENS_PER_MILLION)
        .toAmount()
      // The reserve equals the seed bound on top of the text estimate.
      expect(Usd.from(admitted ?? expected).compare(Usd.from(expected))).toBe(0)
      if (hasMedia && isBelowCap) {
        const cap = Usd.from(expected).subtract(Usd.from('0.000000001'))
        if (Usd.from(admitted ?? expected).compare(cap) > 0) throw new Error('schedule cap')
      }
      const amount = admitted ?? expected
      const settle = vi.fn((cost: UsdAmount, isUnknown?: boolean) => {
        expect(Usd.from(cost).compare(Usd.from(amount))).toBeLessThanOrEqual(0)
        return Promise.resolve({ spentUsd: cost, hasUnknownHistoricalFees: isUnknown === true })
      })
      settlements.push(settle)
      return Promise.resolve({
        claimId: 'production-fire',
        reservedUsd: amount,
        check: () => ({ spentUsd: amount, hasUnknownHistoricalFees: false }),
        settle,
      })
    },
  )
  return { reserve, settlements }
}

/** The production replay (real estimator, ledger, codec and capabilities) over fake HTTP. */
function productionReplay() {
  const api = fakeModelApi()
  const files = fakeFilesApi(api.fetch)
  const log = new FakeLogOutputChannel()
  const client = fakeModelApiClient({ ...api, fetch: files.fetch }, log)
  const ledgerDir = scratchDir()
  const replay = createProductionMediaReplay({
    sessionId: 'file-id-replay',
    client,
    accountId: FAKE_MODEL_API_ACCOUNT_ID,
    currentAccountId: () => Promise.resolve(FAKE_MODEL_API_ACCOUNT_ID),
    directory: ledgerDir,
    log,
    attachment: () => undefined,
    source: () => Promise.resolve(undefined),
    authorize: () => Promise.resolve(),
  })
  return { replay, files, ledgerDir }
}

async function startContributorSession(rig: ProductionRig) {
  const session = await rig.host.startSession({
    workspaceRoot: '/ws',
    modelId: MODEL,
    approvalMode: 'allowAll',
  })
  if (!('sendScheduledTurn' in session)) throw new Error('Expected a Model API session')
  return { session, ...watchSessionTurns(session) }
}

function scheduledRun(
  rig: ProductionRig,
  reserve: NonNullable<ScheduleRunDeps['paid']>['reserve'],
) {
  const { run } = unattendedRun({
    context: fakeRunContext(
      fakeSchedule({ grant: { rules: [], destinationIds: [], paidCapUsd: 1 } }),
    ),
    io: rig.io,
    workspaceRoot: '/ws',
    paid: {
      modelId: MODEL,
      accountId: FAKE_MODEL_API_ACCOUNT_ID,
      allows: () => true,
      reserve,
    },
  })
  return run
}

describe('production media through the real factory (MONEY017D)', () => {
  it('sends a scheduled video read through the real upload storage', async () => {
    const rig = await hostWithMedia({
      ledgerDir: scratchDir(),
      info: { kind: 'video', durationSeconds: 10 },
      name: 'clip.mp4',
      mediaType: 'video/mp4',
    })
    try {
      const h = await startContributorSession(rig)
      const { reserve, settlements } = tariffReserve(VIDEO_10S_BOUND, false)
      const run = scheduledRun(rig, reserve)
      rig.api.script(
        {
          calls: [
            {
              name: 'read_file',
              arguments: JSON.stringify({ path: 'clip.mp4' }),
              callId: 'scheduled-read',
            },
          ],
        },
        { text: 'The clip shows colour bars.', usage: { input: 2800, output: 64 } },
      )
      const done = h.turnDone()
      await h.session.sendScheduledTurn([{ type: 'text', text: 'Read clip.mp4' }], run)
      await done
      expect(h.events.findLast((event) => event.type === 'turnCompleted')).toMatchObject({
        terminal: 'completed',
      })
      // One upload, then the file id on the wire without an fps (default).
      expect(rig.files.uploads).toHaveLength(1)
      expect(rig.files.uploads[0]).toMatchObject({ name: 'clip.mp4', bytes: 32_768 })
      const dispatched = rig.api.responseBodies()
      expect(dispatched).toHaveLength(2)
      expect(JSON.stringify(dispatched[1])).toContain(
        `{"type":"input_video","file_id":"${rig.files.uploads[0]!.fileId}"}`,
      )
      expect(JSON.stringify(dispatched[1])).not.toContain('"fps"')
      // Settlement stayed within the reserve, and the settled turn became a
      // new local observation beside the seeds.
      expect(settlements).toHaveLength(2)
      const calibration = JSON.parse(
        readFileSync(
          path.join(
            productionMediaDirectory(rig.ledgerDir, FAKE_MODEL_API_ACCOUNT_ID),
            'calibration.json',
          ),
          'utf8',
        ),
      ) as { inputTokens: number; upperOnly: boolean }[]
      expect(calibration).toHaveLength(24)
      expect(calibration[23]).toMatchObject({ inputTokens: 2800, upperOnly: false })
      expect(
        JSON.parse(
          readFileSync(
            path.join(
              productionMediaDirectory(rig.ledgerDir, FAKE_MODEL_API_ACCOUNT_ID),
              'uploads.json',
            ),
            'utf8',
          ),
        ),
      ).toMatchObject({
        accountId: FAKE_MODEL_API_ACCOUNT_ID,
      })
    } finally {
      await rig.close()
    }
  })

  it('keeps production media through the real runtime accounting wrapper', async () => {
    // The CLI/ACP runtime always wraps the provider client with
    // withRuntimeAccounting: the Files transport must ride through it, or no
    // replay is installed and this scheduled upload count drops to zero.
    const daily = createRuntimeDailyBudget({
      dataFolder: scratchDir(),
      now: () => Date.now(),
      sleep: () => Promise.resolve(),
    })
    const rig = await hostWithMedia({
      ledgerDir: scratchDir(),
      info: { kind: 'video', durationSeconds: 10 },
      name: 'clip.mp4',
      mediaType: 'video/mp4',
    })
    const wrapped = await productionHost({
      ledgerDir: rig.ledgerDir,
      readMedia: rig.io.readMedia,
      createProviderClient: (meta) => Promise.resolve(withRuntimeAccounting(meta, daily)),
    })
    try {
      await rig.close()
      const h = await startContributorSession(wrapped)
      const { reserve } = tariffReserve(VIDEO_10S_BOUND, false)
      const run = scheduledRun(wrapped, reserve)
      wrapped.api.script(
        {
          calls: [
            {
              name: 'read_file',
              arguments: JSON.stringify({ path: 'clip.mp4' }),
              callId: 'scheduled-read',
            },
          ],
        },
        { text: 'The clip shows colour bars.', usage: { input: 2800, output: 64 } },
      )
      const done = h.turnDone()
      await h.session.sendScheduledTurn([{ type: 'text', text: 'Read clip.mp4' }], run)
      await done
      expect(h.events.findLast((event) => event.type === 'turnCompleted')).toMatchObject({
        terminal: 'completed',
      })
      expect(wrapped.files.uploads).toHaveLength(1)
      expect(JSON.stringify(wrapped.api.responseBodies()[1])).toContain(
        `{"type":"input_video","file_id":"${wrapped.files.uploads[0]!.fileId}"}`,
      )
    } finally {
      await wrapped.close()
    }
  })

  it('reuses the file id on the follow-up without re-uploading', async () => {
    const rig = await hostWithMedia({
      ledgerDir: scratchDir(),
      info: { kind: 'video', durationSeconds: 10 },
      name: 'clip.mp4',
      mediaType: 'video/mp4',
    })
    try {
      const h = await startContributorSession(rig)
      const { reserve } = tariffReserve(VIDEO_10S_BOUND, false)
      const run = scheduledRun(rig, reserve)
      rig.api.script(
        {
          calls: [
            {
              name: 'read_file',
              arguments: JSON.stringify({ path: 'clip.mp4' }),
              callId: 'scheduled-read',
            },
          ],
        },
        { text: 'First look.', usage: { input: 2751, output: 64 } },
        { text: 'Second look.', usage: { input: 2751, output: 64 } },
      )
      const first = h.turnDone()
      await h.session.sendScheduledTurn([{ type: 'text', text: 'Read clip.mp4' }], run)
      await first
      // A follow-up is an interactive turn against the same session replay.
      const second = h.turnDone()
      await h.session.sendTurn([{ type: 'text', text: 'Look again' }])
      await second
      expect(h.events.findLast((event) => event.type === 'turnCompleted')).toMatchObject({
        terminal: 'completed',
      })
      const fileId = rig.files.uploads[0]!.fileId
      expect(rig.files.uploads).toHaveLength(1)
      const dispatched = rig.api.responseBodies()
      expect(dispatched).toHaveLength(3)
      expect(JSON.stringify(dispatched[1])).toContain(`"file_id":"${fileId}"`)
      expect(JSON.stringify(dispatched[2])).toContain(`"file_id":"${fileId}"`)
    } finally {
      await rig.close()
    }
  })

  it('keeps a scheduled image read inline: no upload, no file id', async () => {
    // D85.2: small images stay inline on the wire. The transport never
    // changes, but the calibrated image envelope governs the reservation:
    // pricing cannot be bypassed by staying inline.
    const api = fakeModelApi()
    const files = fakeFilesApi(api.fetch)
    const log = new FakeLogOutputChannel()
    const png = Buffer.from(
      'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
      'base64',
    )
    const io = memoryToolIo({}, '/ws')
    io.binaries.set('/ws/tile.png', new Uint8Array(png))
    const ledgerDir = scratchDir()
    const host = await createModelApiHost({
      uiText: EN,
      uiLocale: 'en',
      client: { ...fakeModelApiClientSettings(log), fetch: files.fetch },
      host: {
        ...fakeModelApiHostDeps({
          client: fakeModelApiClient({ ...api, fetch: files.fetch }, log),
          log,
          io,
          workspaceRoot: '/ws',
        }),
        store: memorySessionStore(),
        isPaidFeatureOn: () => true,
        confirmContributorModel: () => Promise.resolve(true),
        uploadLedgerDir: ledgerDir,
      },
      hookSettingsPath: undefined,
      createMcpServers: undefined,
    })
    try {
      const session = await host.startSession({
        workspaceRoot: '/ws',
        modelId: MODEL,
        approvalMode: 'allowAll',
      })
      if (!('sendScheduledTurn' in session)) throw new Error('Expected a Model API session')
      const h = { session, ...watchSessionTurns(session) }
      const { reserve } = tariffReserve(IMAGE_BOUND, false)
      const run = scheduledRun(
        { host, api, files, io, ledgerDir, close: () => host.close() },
        reserve,
      )
      api.script(
        {
          calls: [
            {
              name: 'read_file',
              arguments: JSON.stringify({ path: 'tile.png' }),
              callId: 'scheduled-read',
            },
          ],
        },
        { text: 'The tile is transparent.', usage: { input: 4200, output: 64 } },
      )
      const done = h.turnDone()
      await h.session.sendScheduledTurn([{ type: 'text', text: 'Read tile.png' }], run)
      await done
      expect(h.events.findLast((event) => event.type === 'turnCompleted')).toMatchObject({
        terminal: 'completed',
      })
      expect(files.uploads).toHaveLength(0)
      const dispatched = api.responseBodies()
      expect(dispatched).toHaveLength(2)
      expect(JSON.stringify(dispatched[1])).toContain('"type":"input_image"')
      expect(JSON.stringify(dispatched[1])).toContain('data:image/png;base64,')
      expect(JSON.stringify(dispatched[1])).not.toContain('file-test-')
      // The inline send settles its bound but teaches nothing: the provider
      // counted inline bytes, so no observation is recorded at all.
      expect(
        existsSync(
          path.join(
            productionMediaDirectory(ledgerDir, FAKE_MODEL_API_ACCOUNT_ID),
            'calibration.json',
          ),
        ),
      ).toBe(false)
    } finally {
      await host.close()
    }
  })

  it('refuses a scheduled PDF read with no page rate under a cap', async () => {
    // A document with no page rate cannot be priced: the inline read
    // refuses at tool time with the estimator's honest reason, and no PDF
    // bytes are ever dispatched.
    const api = fakeModelApi()
    const files = fakeFilesApi(api.fetch)
    const log = new FakeLogOutputChannel()
    const io = memoryToolIo({}, '/ws')
    io.binaries.set('/ws/report.pdf', new TextEncoder().encode('%PDF-1.4\nno pages counted\n'))
    const ledgerDir = scratchDir()
    const host = await createModelApiHost({
      uiText: EN,
      uiLocale: 'en',
      client: { ...fakeModelApiClientSettings(log), fetch: files.fetch },
      host: {
        ...fakeModelApiHostDeps({
          client: fakeModelApiClient({ ...api, fetch: files.fetch }, log),
          log,
          io,
          workspaceRoot: '/ws',
        }),
        store: memorySessionStore(),
        isPaidFeatureOn: () => true,
        confirmContributorModel: () => Promise.resolve(true),
        uploadLedgerDir: ledgerDir,
      },
      hookSettingsPath: undefined,
      createMcpServers: undefined,
    })
    try {
      const session = await host.startSession({
        workspaceRoot: '/ws',
        modelId: MODEL,
        approvalMode: 'allowAll',
      })
      if (!('sendScheduledTurn' in session)) throw new Error('Expected a Model API session')
      const h = { session, ...watchSessionTurns(session) }
      const { reserve } = tariffReserve(0, false)
      const run = scheduledRun(
        { host, api, files, io, ledgerDir, close: () => host.close() },
        reserve,
      )
      api.script(
        {
          calls: [
            {
              name: 'read_file',
              arguments: JSON.stringify({ path: 'report.pdf' }),
              callId: 'scheduled-read',
            },
          ],
        },
        { text: 'The report was refused.', usage: { input: 4200, output: 64 } },
      )
      const done = h.turnDone()
      await h.session.sendScheduledTurn([{ type: 'text', text: 'Read report.pdf' }], run)
      await done
      expect(h.events.findLast((event) => event.type === 'turnCompleted')).toMatchObject({
        terminal: 'completed',
      })
      expect(files.uploads).toHaveLength(0)
      const dispatched = api.responseBodies()
      expect(dispatched).toHaveLength(2)
      expect(JSON.stringify(dispatched[1])).not.toContain('data:application/pdf')
      // The model sees the refusal as the tool result, not the bytes.
      expect(JSON.stringify(dispatched[1])).toContain('needs a calibrated media rate')
    } finally {
      await host.close()
    }
  })

  it.each([false, true])(
    'reserves the seed bound for an image file id (belowCap=%s)',
    async (isBelowCap) => {
      // The file-id image replay (round-3 I13 shape): the reserve equals the
      // seed bound, a cap one nano under refuses before any dispatch, and
      // settlement stays within the reserve and becomes an observation.
      const { replay, files, ledgerDir } = productionReplay()
      const { bytes, chunk, sha256 } = fixtureBytes(2048)
      const uploaded = await replay.upload(
        {
          name: 'tile.png',
          info: { kind: 'image', mediaType: 'image/png', sizeBytes: bytes.length },
          sha256,
          source: {
            name: 'tile.png',
            mime: 'image/png',
            bytes: bytes.length,
            open: async function* () {
              yield await chunk
            },
          },
        },
        MODEL,
        AbortSignal.timeout(10_000),
      )
      expect(files.uploads).toHaveLength(1)
      const budget = new MediaBudget()
      const adopted = replay.adopt(
        {
          name: 'tile.png',
          info: { kind: 'image', mediaType: 'image/png', sizeBytes: bytes.length },
          sha256,
          file: uploaded,
        },
        MODEL,
        budget,
      )
      const prices = MODEL_API_PRICES_PER_MILLION.contributor
      const textInputTokens = 170
      const expected = Usd.from(prices.input)
        .times(textInputTokens + IMAGE_BOUND)
        .add(Usd.from(prices.output).times(64))
        .divide(TOKENS_PER_MILLION)
        .toAmount()
      const cap = isBelowCap
        ? Usd.from(expected).subtract(Usd.from('0.000000001')).toAmount()
        : Usd.from(1).toAmount()
      const settled: UsdAmount[] = []
      const claim = {
        check: () => undefined,
        settle: (cost: UsdAmount) => {
          settled.push(cost)
          return Promise.resolve()
        },
      }
      const session = {
        reserve: (cost: UsdAmount) => {
          if (isBelowCap && Usd.from(cost).compare(Usd.from(cap)) > 0)
            return Promise.reject(new Error(UI_TEXT.sessionBudgetStoreUnavailable))
          expect(Usd.from(cost).compare(Usd.from(expected))).toBe(0)
          return Promise.resolve(claim)
        },
      }
      const body = {
        model: MODEL,
        input: [{ type: 'message' as const, role: 'user' as const, content: [adopted] }],
        max_output_tokens: 64,
        stream: false as const,
      }
      if (isBelowCap) {
        await expect(
          replay.reserveRequest(body, {
            provider: 'meta',
            modelId: MODEL,
            textInputTokens,
            maxOutputTokens: 64,
            captureId: 'image-cap',
            log: { warn: () => undefined },
            prices,
            session,
          }),
        ).rejects.toThrow(UI_TEXT.sessionBudgetStoreUnavailable)
        expect(settled).toHaveLength(0)
        return
      }
      const accounting = await replay.reserveRequest(body, {
        provider: 'meta',
        modelId: MODEL,
        textInputTokens,
        maxOutputTokens: 64,
        captureId: 'image-settle',
        log: { warn: () => undefined },
        prices,
        session,
      })
      expect(accounting).toBeDefined()
      // The host marks the dispatch sent before usage arrives.
      accounting!.started()
      await accounting!.settle({ input_tokens: textInputTokens + 4086, output_tokens: 64 })
      expect(settled).toHaveLength(1)
      expect(Usd.from(settled[0]!).compare(Usd.from(expected))).toBeLessThanOrEqual(0)
      const calibration = JSON.parse(
        readFileSync(
          path.join(
            productionMediaDirectory(ledgerDir, FAKE_MODEL_API_ACCOUNT_ID),
            'calibration.json',
          ),
          'utf8',
        ),
      ) as { inputTokens: number }[]
      expect(calibration).toHaveLength(24)
      // Detail never changes the estimate: the codec always replays `auto`.
      const projected = replay.project(
        [{ type: 'message', role: 'user', content: [adopted] }],
        MODEL,
        budget,
      )
      expect(JSON.stringify(projected)).toContain(
        `{"type":"input_image","file_id":"${uploaded.fileId}","detail":"auto"}`,
      )
    },
  )

  it('refuses a document under a cap with the existing honest reason', async () => {
    // No PDF page bill was captured, so the file-id document replay refuses
    // at reserve time. Scheduled PDF reads stay inline on the established
    // path; only a replayed document reaches this refusal.
    const { replay, files } = productionReplay()
    const { bytes, chunk, sha256 } = fixtureBytes(2048)
    const uploaded = await replay.upload(
      {
        name: 'paper.pdf',
        info: {
          kind: 'document',
          mediaType: 'application/pdf',
          sizeBytes: bytes.length,
          pageCount: 3,
        },
        sha256,
        source: {
          name: 'paper.pdf',
          mime: 'application/pdf',
          bytes: bytes.length,
          open: async function* () {
            yield await chunk
          },
        },
      },
      MODEL,
      AbortSignal.timeout(10_000),
    )
    expect(files.uploads).toHaveLength(1)
    const budget = new MediaBudget()
    const adopted = replay.adopt(
      {
        name: 'paper.pdf',
        info: {
          kind: 'document',
          mediaType: 'application/pdf',
          sizeBytes: bytes.length,
          pageCount: 3,
        },
        sha256,
        file: uploaded,
      },
      MODEL,
      budget,
    )
    const claim = {
      check: () => undefined,
      settle: (_cost: UsdAmount) => Promise.resolve(),
    }
    await expect(
      replay.reserveRequest(
        {
          model: MODEL,
          input: [{ type: 'message' as const, role: 'user' as const, content: [adopted] }],
          max_output_tokens: 64,
          stream: false as const,
        },
        {
          provider: 'meta',
          modelId: MODEL,
          textInputTokens: 170,
          maxOutputTokens: 64,
          captureId: 'document-cap',
          log: { warn: () => undefined },
          prices: MODEL_API_PRICES_PER_MILLION.contributor,
          session: { reserve: () => Promise.resolve(claim) },
        },
      ),
    ).rejects.toThrow(fill(UI_TEXT.media.cappedRateUnknown, { model: MODEL }))
  })

  it('wires the same real path through the backend manager (CLI/ACP runtime shape)', async () => {
    // The runtime builds ModelApiBackendManager with an upload ledger
    // directory from its data folder; the manager must hand it to the
    // bundle entry, and scheduled media must flow.
    const api = fakeModelApi()
    const files = fakeFilesApi(api.fetch)
    // The manager builds its own client from the fake API: route its fetch
    // through the Files server so uploads land here too.
    api.fetch = files.fetch
    const log = new FakeLogOutputChannel()
    const io = memoryToolIo({}, '/ws')
    const { bytes, chunk, sha256 } = fixtureBytes(32_768)
    Object.assign(io, {
      readMedia: () =>
        Promise.resolve({
          info: {
            kind: 'video' as const,
            mediaType: 'video/mp4' as const,
            sizeBytes: bytes.length,
            durationSeconds: 10,
            hasSoundtrack: true,
            width: 320,
            height: 240,
          },
          sha256,
          source: {
            name: 'clip.mp4',
            mime: 'video/mp4',
            bytes: bytes.length,
            open: async function* () {
              yield await chunk
            },
          },
        }),
    })
    const ledgerDir = scratchDir()
    const seen: (string | undefined)[] = []
    const manager = new ModelApiBackendManager(
      fakeManagerDeps(api, log, {
        workspaceRoot: '/ws',
        bundlePath: 'manager-media-bundle',
        loadBundle: () => ({
          createModelApiHost: (deps: { host?: { uploadLedgerDir?: string } }) => {
            seen.push(deps.host?.uploadLedgerDir)
            return createModelApiHost(deps as Parameters<typeof createModelApiHost>[0])
          },
        }),
        io,
        store: memorySessionStore(),
        isPaidFeatureOn: () => true,
        confirmContributorModel: () => Promise.resolve(true),
        uploadLedgerDir: ledgerDir,
      }),
    )
    const host = await manager.ensureHost()
    try {
      const session = await host.startSession({
        workspaceRoot: '/ws',
        modelId: MODEL,
        approvalMode: 'allowAll',
      })
      if (!('sendScheduledTurn' in session)) throw new Error('Expected a Model API session')
      const h = { session, ...watchSessionTurns(session) }
      const rig = { host, api, files, io, ledgerDir, close: () => host.close() }
      const { reserve } = tariffReserve(VIDEO_10S_BOUND, false)
      const run = scheduledRun(rig, reserve)
      api.script(
        {
          calls: [
            {
              name: 'read_file',
              arguments: JSON.stringify({ path: 'clip.mp4' }),
              callId: 'scheduled-read',
            },
          ],
        },
        { text: 'The clip shows colour bars.', usage: { input: 2800, output: 64 } },
      )
      const done = h.turnDone()
      await h.session.sendScheduledTurn([{ type: 'text', text: 'Read clip.mp4' }], run)
      await done
      expect(seen).toEqual([ledgerDir])
      expect(h.events.findLast((event) => event.type === 'turnCompleted')).toMatchObject({
        terminal: 'completed',
      })
      expect(files.uploads).toHaveLength(1)
      expect(JSON.stringify(api.responseBodies()[1])).toContain(
        `{"type":"input_video","file_id":"${files.uploads[0]!.fileId}"}`,
      )
    } finally {
      await host.close()
    }
  })

  it('keeps the honest refusal while no storage directory is supplied', async () => {
    const api = fakeModelApi()
    const log = new FakeLogOutputChannel()
    const io = memoryToolIo({}, '/ws')
    const host = await createModelApiHost({
      uiText: EN,
      uiLocale: 'en',
      client: { ...fakeModelApiClientSettings(log), fetch: api.fetch },
      host: {
        ...fakeModelApiHostDeps({
          client: fakeModelApiClient(api, log),
          log,
          io,
          workspaceRoot: '/ws',
        }),
        store: memorySessionStore(),
        isPaidFeatureOn: () => true,
      },
      hookSettingsPath: undefined,
      createMcpServers: undefined,
    })
    try {
      const session = await host.startSession({
        workspaceRoot: '/ws',
        modelId: 'muse-spark-1.3',
        approvalMode: 'allowAll',
      })
      if (!('sendScheduledTurn' in session)) throw new Error('Expected a Model API session')
      const h = { session, ...watchSessionTurns(session) }
      const reserve = vi.fn<NonNullable<ScheduleRunDeps['paid']>['reserve']>(
        (_body, _tokens, _signal, admitted) => {
          const amount = admitted ?? Usd.from(1).toAmount()
          return Promise.resolve({
            claimId: 'fake-fire',
            reservedUsd: amount,
            check: () => ({ spentUsd: amount, hasUnknownHistoricalFees: false }),
            settle: (cost: UsdAmount) =>
              Promise.resolve({ spentUsd: cost, hasUnknownHistoricalFees: false }),
          })
        },
      )
      const { run } = unattendedRun({
        context: fakeRunContext(
          fakeSchedule({ grant: { rules: [], destinationIds: [], paidCapUsd: 1 } }),
        ),
        io,
        workspaceRoot: '/ws',
        paid: {
          modelId: 'muse-spark-1.3',
          accountId: FAKE_MODEL_API_ACCOUNT_ID,
          allows: () => true,
          reserve,
        },
      })
      api.script(
        {
          calls: [
            {
              name: 'read_file',
              arguments: JSON.stringify({ path: 'clip.mp4' }),
              callId: 'scheduled-read',
            },
          ],
        },
        { text: 'The media could not be read.' },
      )
      const done = h.turnDone()
      await h.session.sendScheduledTurn([{ type: 'text', text: 'Read clip.mp4' }], run)
      await done
      const followup = JSON.stringify(api.responseBodies()[1])
      expect(followup).toContain(UI_TEXT.scheduledMediaUnavailable)
      expect(followup).not.toContain('file-test-')
      expect(api.responseBodies()).toHaveLength(2)
    } finally {
      await host.close()
    }
  })

  it('fails closed when the account changes mid-session', async () => {
    const ledgerDir = scratchDir()
    const rig = await hostWithMedia({
      ledgerDir,
      info: { kind: 'video', durationSeconds: 10 },
      name: 'clip.mp4',
      mediaType: 'video/mp4',
    })
    try {
      // Seed the ledger under the real account first.
      const h = await startContributorSession(rig)
      const { reserve } = tariffReserve(VIDEO_10S_BOUND, false)
      const run = scheduledRun(rig, reserve)
      rig.api.script(
        {
          calls: [
            {
              name: 'read_file',
              arguments: JSON.stringify({ path: 'clip.mp4' }),
              callId: 'scheduled-read',
            },
          ],
        },
        { text: 'The clip shows colour bars.', usage: { input: 2800, output: 64 } },
      )
      const first = h.turnDone()
      await h.session.sendScheduledTurn([{ type: 'text', text: 'Read clip.mp4' }], run)
      await first
      expect(rig.files.uploads).toHaveLength(1)
      await rig.close()
      // A host whose key changed reads the same directory: the ledger's
      // account binding refuses before any further upload HTTP runs.
      const again = await productionHost({
        ledgerDir,
        getAccountId: () => Promise.resolve('0'.repeat(64)),
        readMedia: rig.io.readMedia,
      })
      try {
        const h2 = await startContributorSession(again)
        const { reserve: reserve2 } = tariffReserve(VIDEO_10S_BOUND, false)
        const run2 = scheduledRun(again, reserve2)
        again.api.script(
          {
            calls: [
              {
                name: 'read_file',
                arguments: JSON.stringify({ path: 'clip.mp4' }),
                callId: 'scheduled-read',
              },
            ],
          },
          { text: 'The clip shows colour bars.' },
        )
        const second = h2.turnDone()
        await h2.session.sendScheduledTurn([{ type: 'text', text: 'Read clip.mp4' }], run2)
        await second
        expect(h2.events.findLast((event) => event.type === 'turnCompleted')).toMatchObject({
          terminal: 'failed',
        })
        expect(again.files.uploads).toHaveLength(0)
        expect(
          again.api.responseBodies().every((body) => !JSON.stringify(body).includes('file-test-')),
        ).toBe(true)
      } finally {
        await again.close()
      }
    } finally {
      // Closed above; the helper's close is idempotent through the host.
    }
  })
})
