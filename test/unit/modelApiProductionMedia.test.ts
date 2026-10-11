import type { InputContentPart } from '../../src/core/backends/modelapi/schemas'
import { boundedMediaSettlement } from './helpers/media/replay'
import { scratchDirectories } from './helpers/media/scratch'
import { existsSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { createHash } from 'node:crypto'
import { describe, expect, it, vi } from 'vitest'
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
import type { ScheduleRunDeps, ScheduledAgentSession } from '../../src/core/schedules/unattended'
import type { AgentSession } from '../../src/core/agent/agentBackend'
import type { ToolIo } from '../../src/core/backends/modelapi/tools'
import { estimateInput, requestParts } from '../../src/core/backends/modelapi/sessionBudget'
import {
  fakeModelApi,
  fakeModelApiClient,
  fakeModelApiClientSettings,
  FAKE_MODEL_API_ACCOUNT_ID,
  FAKE_MODEL_API_BASE_URL,
} from './helpers/fakeModelApi'
import { fakeFilesApi, type FakeFilesApi } from './helpers/fakeFiles'
import { fakeModelApiHostDeps } from './helpers/modelApiHostDeps'
import { FakeLogOutputChannel } from './helpers/fakes'
import { memoryToolIo } from './helpers/fakeToolIo'
import { memorySessionStore } from './helpers/fakeSessionStore'
import { watchSessionTurns, startWatchedSession } from './helpers/sessionTurns'
import { videoMedia, mediaByteSource } from './helpers/media/replay'
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

const scratchDir = scratchDirectories('muse-production-media-')

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

async function fixtureHost(
  api: ReturnType<typeof fakeModelApi>,
  fetch: typeof globalThis.fetch,
  log: FakeLogOutputChannel,
  io: ReturnType<typeof memoryToolIo>,
  overrides: Partial<Parameters<typeof createModelApiHost>[0]['host']>,
  createProviderClient?: Parameters<typeof createModelApiHost>[0]['createProviderClient'],
) {
  return await createModelApiHost({
    uiText: EN,
    uiLocale: 'en',
    client: { ...fakeModelApiClientSettings(log), fetch },
    ...(createProviderClient !== undefined && { createProviderClient }),
    host: {
      ...fakeModelApiHostDeps({
        client: fakeModelApiClient({ ...api, fetch }, log),
        log,
        io,
        workspaceRoot: '/ws',
      }),
      store: memorySessionStore(),
      isPaidFeatureOn: () => true,
      ...overrides,
    },
    hookSettingsPath: undefined,
    createMcpServers: undefined,
  })
}

async function binaryHost(
  api: ReturnType<typeof fakeModelApi>,
  files: FakeFilesApi,
  log: FakeLogOutputChannel,
  file: string,
  bytes: Uint8Array,
) {
  const io = memoryToolIo({}, '/ws')
  io.binaries.set(file, bytes)
  const ledgerDir = scratchDir()
  const host = await fixtureHost(api, files.fetch, log, io, {
    confirmContributorModel: () => Promise.resolve(true),
    uploadLedgerDir: ledgerDir,
  })
  return { io, ledgerDir, host }
}

async function productionHost(options: {
  ledgerDir: string
  readMedia?: NonNullable<ToolIo['readMedia']>
  getAccountId?: () => Promise<string | undefined>
  createProviderClient?: Parameters<typeof createModelApiHost>[0]['createProviderClient']
}): Promise<ProductionRig> {
  const api = fakeModelApi()
  const files = fakeFilesApi(api.fetch)
  const log = new FakeLogOutputChannel()
  const io = memoryToolIo({}, '/ws')
  if (options.readMedia !== undefined) Object.assign(io, { readMedia: options.readMedia })
  const host = await fixtureHost(
    api,
    files.fetch,
    log,
    io,
    {
      confirmContributorModel: () => Promise.resolve(true),
      ...(options.getAccountId !== undefined && { getAccountId: options.getAccountId }),
      uploadLedgerDir: options.ledgerDir,
    },
    options.createProviderClient,
  )
  return { host, api, files, io, ledgerDir: options.ledgerDir, close: () => host.close() }
}

async function hostWithMedia(options: {
  ledgerDir: string
  info: { kind: 'video'; durationSeconds: number } | { kind: 'image' } | { kind: 'document' }
  name: string
  mediaType: string
  size?: number
}): Promise<ProductionRig & { sha256: string }> {
  const { bytes, sha256 } = fixtureBytes(options.size ?? 32_768)
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
  // Images and PDFs ride readBytes through the visual path; io.readMedia
  // only ever serves video and audio. Anything else here is a test bug.
  const readMedia: NonNullable<ToolIo['readMedia']> = () =>
    info.kind === 'image' || info.kind === 'document'
      ? Promise.resolve({ kind: 'other' as const, reason: `unexpected readMedia for ${info.kind}` })
      : Promise.resolve({
          info,
          sha256,
          source: mediaByteSource(options.name, options.mediaType, bytes),
        })
  const rig = await productionHost({ ledgerDir: options.ledgerDir, readMedia })
  return { ...rig, sha256 }
}

/** Whether a part is one of this file's fake uploads. */
function videoHost() {
  return hostWithMedia({
    ledgerDir: scratchDir(),
    info: { kind: 'video', durationSeconds: 10 },
    name: 'clip.mp4',
    mediaType: 'video/mp4',
  })
}

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
    (body, _inputTokens, _signal, admitted) => {
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
      const settle = boundedMediaSettlement(amount)
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
    isCapped: () => true,
    isClosed: () => false,
    source: () => Promise.resolve(undefined),
  })
  return { replay, files, ledgerDir }
}

function isScheduledSession(session: AgentSession): session is ScheduledAgentSession {
  return 'sendScheduledTurn' in session
}

async function startContributorSession(
  rig: { host: { startSession: ModelApiHost['startSession'] } },
  modelId = MODEL,
) {
  const session = await rig.host.startSession({
    workspaceRoot: '/ws',
    modelId,
    approvalMode: 'allowAll',
  })
  if (!isScheduledSession(session)) throw new Error('Expected a Model API session')
  return { session, ...watchSessionTurns(session) }
}

async function sendScheduled(
  h: Awaited<ReturnType<typeof startContributorSession>>,
  run: ReturnType<typeof scheduledRun>,
  text: string,
) {
  const done = h.turnDone()
  await h.session.sendScheduledTurn([{ type: 'text', text }], run)
  await done
}

function expectCompleted(h: Pick<Awaited<ReturnType<typeof startContributorSession>>, 'events'>) {
  expect(h.events.findLast((event) => event.type === 'turnCompleted')).toMatchObject({
    terminal: 'completed',
  })
}

function scheduledClip(api: ReturnType<typeof fakeModelApi>) {
  api.script(scheduledRead('clip.mp4'), {
    text: 'The clip shows colour bars.',
    usage: { input: 2800, output: 64 },
  })
}

function scheduledRead(name: string) {
  return {
    calls: [
      { name: 'read_file', arguments: JSON.stringify({ path: name }), callId: 'scheduled-read' },
    ],
  }
}

function mediaRequest(content: InputContentPart[]) {
  return {
    model: MODEL,
    input: [{ type: 'message' as const, role: 'user' as const, content }],
    instructions: '',
    tools: [],
    tool_choice: 'auto' as const,
    reasoning: { effort: 'none' },
    stream: true as const,
    store: false as const,
    include: [],
    max_output_tokens: 64,
    prompt_cache_key: 'media-test',
    prompt_cache_retention: 'in_memory' as const,
  }
}

function fakeScheduleReserve() {
  return vi.fn<NonNullable<ScheduleRunDeps['paid']>['reserve']>(
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
}

function scheduledRun(
  rig: Pick<ProductionRig, 'io'>,
  reserve: NonNullable<ScheduleRunDeps['paid']>['reserve'],
  modelId = MODEL,
) {
  const { run } = unattendedRun({
    context: fakeRunContext(
      fakeSchedule({
        grant: { rules: [], destinationIds: [], paidCapUsd: Usd.from(1).toAmount() },
      }),
    ),
    io: rig.io,
    workspaceRoot: '/ws',
    paid: {
      modelId,
      accountId: FAKE_MODEL_API_ACCOUNT_ID,
      allows: () => true,
      reserve,
    },
  })
  return run
}

describe('production media through the real factory (MONEY017D)', () => {
  it('sends a scheduled video read through the real upload storage', async () => {
    const rig = await videoHost()
    try {
      const h = await startContributorSession(rig)
      const { reserve, settlements } = tariffReserve(VIDEO_10S_BOUND, false)
      const run = scheduledRun(rig, reserve)
      scheduledClip(rig.api)
      await sendScheduled(h, run, 'Read clip.mp4')
      expectCompleted(h)
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
    const rig = await videoHost()
    const { readMedia } = rig.io
    if (readMedia === undefined) throw new Error('expected the media read rail')
    const wrapped = await productionHost({
      ledgerDir: rig.ledgerDir,
      readMedia,
      createProviderClient: (meta) => Promise.resolve(withRuntimeAccounting(meta, daily)),
    })
    try {
      await rig.close()
      const h = await startContributorSession(wrapped)
      const { reserve } = tariffReserve(VIDEO_10S_BOUND, false)
      const run = scheduledRun(wrapped, reserve)
      scheduledClip(wrapped.api)
      await sendScheduled(h, run, 'Read clip.mp4')
      expectCompleted(h)
      expect(wrapped.files.uploads).toHaveLength(1)
      expect(JSON.stringify(wrapped.api.responseBodies()[1])).toContain(
        `{"type":"input_video","file_id":"${wrapped.files.uploads[0]!.fileId}"}`,
      )
    } finally {
      await wrapped.close()
    }
  })

  it('reuses the file id on the follow-up without re-uploading', async () => {
    const rig = await videoHost()
    try {
      const h = await startContributorSession(rig)
      const { reserve } = tariffReserve(VIDEO_10S_BOUND, false)
      const run = scheduledRun(rig, reserve)
      rig.api.script(
        scheduledRead('clip.mp4'),
        { text: 'First look.', usage: { input: 2751, output: 64 } },
        { text: 'Second look.', usage: { input: 2751, output: 64 } },
      )
      await sendScheduled(h, run, 'Read clip.mp4')
      // A follow-up is an interactive turn against the same session replay.
      const second = h.turnDone()
      await h.session.sendTurn([{ type: 'text', text: 'Look again' }])
      await second
      expectCompleted(h)
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
    const { io, ledgerDir, host } = await binaryHost(
      api,
      files,
      log,
      '/ws/tile.png',
      new Uint8Array(png),
    )
    try {
      const h = await startContributorSession({ host }, MODEL)
      const { reserve } = tariffReserve(IMAGE_BOUND, false)
      const run = scheduledRun({ io }, reserve)
      api.script(scheduledRead('tile.png'), {
        text: 'The tile is transparent.',
        usage: { input: 4200, output: 64 },
      })
      await sendScheduled(h, run, 'Read tile.png')
      expectCompleted(h)
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
    const { io, host } = await binaryHost(
      api,
      files,
      log,
      '/ws/report.pdf',
      new TextEncoder().encode('%PDF-1.4\nno pages counted\n'),
    )
    try {
      const h = await startContributorSession({ host }, MODEL)
      const { reserve } = tariffReserve(0, false)
      const run = scheduledRun({ io }, reserve)
      api.script(scheduledRead('report.pdf'), {
        text: 'The report was refused.',
        usage: { input: 4200, output: 64 },
      })
      await sendScheduled(h, run, 'Read report.pdf')
      expectCompleted(h)
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
      const { bytes, sha256 } = fixtureBytes(2048)
      const uploaded = await replay.upload(
        {
          name: 'tile.png',
          info: { kind: 'image', mediaType: 'image/png', sizeBytes: bytes.length },
          sha256,
          source: mediaByteSource('tile.png', 'image/png', bytes),
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
      const body = mediaRequest([adopted])
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
    const { bytes, sha256 } = fixtureBytes(2048)
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
        source: mediaByteSource('paper.pdf', 'application/pdf', bytes),
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
      replay.reserveRequest(mediaRequest([adopted]), {
        provider: 'meta',
        modelId: MODEL,
        textInputTokens: 170,
        maxOutputTokens: 64,
        captureId: 'document-cap',
        log: { warn: () => undefined },
        prices: MODEL_API_PRICES_PER_MILLION.contributor,
        session: { reserve: () => Promise.resolve(claim) },
      }),
    ).rejects.toThrow(fill(UI_TEXT.media.cappedRateUnknown, { model: MODEL }))
  })

  it('wires the same real path through the backend manager (CLI/ACP runtime shape)', async () => {
    // The runtime builds ModelApiBackendManager with an upload ledger
    // directory from its data folder; the manager must hand it to the
    // bundle entry, and scheduled media must flow.
    const api = fakeModelApi()
    const files = fakeFilesApi(api.fetch)
    // The manager builds its own client from the fake API: hand it the fetch
    // routed through the Files server so uploads land here too. The script
    // and recorded bodies stay on the shared fake.
    const routed = { ...api, fetch: files.fetch }
    const log = new FakeLogOutputChannel()
    const io = memoryToolIo({}, '/ws')
    const { bytes, sha256 } = fixtureBytes(32_768)
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
          source: mediaByteSource('clip.mp4', 'video/mp4', bytes),
        }),
    })
    const ledgerDir = scratchDir()
    const seen: (string | undefined)[] = []
    const manager = new ModelApiBackendManager(
      fakeManagerDeps(routed, log, {
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
      const h = await startContributorSession({ host }, MODEL)
      const rig = { host, api, files, io, ledgerDir, close: () => host.close() }
      const { reserve } = tariffReserve(VIDEO_10S_BOUND, false)
      const run = scheduledRun(rig, reserve)
      scheduledClip(api)
      await sendScheduled(h, run, 'Read clip.mp4')
      expect(seen).toEqual([ledgerDir])
      expectCompleted(h)
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
    const host = await fixtureHost(api, api.fetch, log, io, {})
    try {
      const h = await startContributorSession({ host }, 'muse-spark-1.3')
      const reserve = fakeScheduleReserve()
      const run = scheduledRun({ io }, reserve, 'muse-spark-1.3')
      api.script(scheduledRead('clip.mp4'), { text: 'The media could not be read.' })
      await sendScheduled(h, run, 'Read clip.mp4')
      const followup = JSON.stringify(api.responseBodies()[1])
      expect(followup).toContain(UI_TEXT.scheduledMediaSupport)
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
      scheduledClip(rig.api)
      await sendScheduled(h, run, 'Read clip.mp4')
      expect(rig.files.uploads).toHaveLength(1)
      await rig.close()
      // A host whose key changed reads the same directory: the ledger's
      // account binding refuses before any further upload HTTP runs.
      const { readMedia } = rig.io
      if (readMedia === undefined) throw new Error('expected the media read rail')
      const again = await productionHost({
        ledgerDir,
        getAccountId: () => Promise.resolve('0'.repeat(64)),
        readMedia,
      })
      try {
        const h2 = await startContributorSession(again)
        const { reserve: reserve2 } = tariffReserve(VIDEO_10S_BOUND, false)
        const run2 = scheduledRun(again, reserve2)
        again.api.script(scheduledRead('clip.mp4'), { text: 'The clip shows colour bars.' })
        await sendScheduled(h2, run2, 'Read clip.mp4')
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

// No replay, codec, calibration or upload port is injected into the production factory.
describe('the production Model API factory while verified upload bindings are unavailable', () => {
  it.each([
    { kind: 'video', hasReader: true },
    { kind: 'audio', hasReader: true },
    { kind: 'video', hasReader: false },
    { kind: 'audio', hasReader: false },
  ] as const)(
    'honestly refuses scheduled $kind (reader=$hasReader) before any upload',
    async ({ kind, hasReader }) => {
      const api = fakeModelApi()
      const transport = vi.spyOn(api, 'fetch')
      const log = new FakeLogOutputChannel()
      const io = memoryToolIo({}, '/ws')
      const video = videoMedia()
      const info =
        kind === 'video'
          ? video.info
          : {
              kind: 'audio' as const,
              mediaType: 'audio/wav' as const,
              sizeBytes: video.info.sizeBytes,
              durationSeconds: video.info.durationSeconds,
            }
      const name = kind === 'video' ? 'clip.mp4' : 'sound.wav'
      const chunk = Promise.resolve(new Uint8Array(1))
      const readMedia = vi.fn<NonNullable<ToolIo['readMedia']>>(
        (_path, _max, _expected, _signal, observe) => {
          observe?.({
            kind: 'file',
            contentHash: video.sha256,
            file: { path: `/ws/${name}`, dev: '1', ino: '2', size: info.sizeBytes, mtime: '3' },
          })
          return Promise.resolve({
            info,
            sha256: video.sha256,
            source: {
              name,
              mime: info.mediaType,
              bytes: info.sizeBytes,
              open: async function* () {
                yield await chunk
              },
            },
          })
        },
      )
      if (hasReader) Object.assign(io, { readMedia })
      const host = await fixtureHost(api, api.fetch, log, io, {})
      const reserve = fakeScheduleReserve()
      try {
        const h = await startWatchedSession(host, '/ws', 'allowAll')
        const context = fakeRunContext(
          fakeSchedule({
            grant: { rules: [], destinationIds: [], paidCapUsd: Usd.from(1).toAmount() },
          }),
        )
        const { run } = unattendedRun({
          context,
          io,
          workspaceRoot: '/ws',
          paid: {
            modelId: 'muse-spark-1.3',
            accountId: FAKE_MODEL_API_ACCOUNT_ID,
            allows: () => true,
            reserve,
          },
        })
        api.script(scheduledRead(name), { text: 'The media could not be read.' })
        await sendScheduled(h, run, `Read ${name}`)
        const followup = JSON.stringify(api.responseBodies()[1])
        expect(followup).toContain(UI_TEXT.scheduledMediaSupport)
        expect(followup).not.toContain('file-clip')
        expect(h.session.snapshot().replay.every((entry) => entry.media === undefined)).toBe(true)
        expect(api.responseBodies()).toHaveLength(2)
        expect(transport.mock.calls.map(([url]) => url)).toEqual([
          `${FAKE_MODEL_API_BASE_URL}/responses`,
          `${FAKE_MODEL_API_BASE_URL}/responses`,
        ])
        expect(readMedia).toHaveBeenCalledTimes(hasReader ? 1 : 0)
        expectCompleted(h)
      } finally {
        await host.close()
      }
    },
  )
})
