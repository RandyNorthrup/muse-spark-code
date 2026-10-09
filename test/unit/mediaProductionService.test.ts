// M105 W redesign: one production media service per session, through the
// real factory (createModelApiHost) and the real backend manager, over fake
// HTTP. Every image and PDF a request carries (attached, read by a tool, or
// restored with the session) is priced through one admission path at the
// seeded upper bound; an unknown rate refuses only under a cap; and an inline
// visual is never registered for upload. Each case names the review finding
// it regresses (RVMONEY017D on c2689e116, RVMEDIAW on 27d8f1327).
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { createHash } from 'node:crypto'
import { afterAll, describe, expect, it, vi } from 'vitest'
import { createModelApiHost } from '../../src/host/backend/modelApiEntry'
import { createSessionUploads } from '../../src/host/backend/productionMediaEntry'
import { createFileSessionStore } from '../../src/host/backend/fileSessionStore'
import { ModelApiClient } from '../../src/core/backends/modelapi/client'
import { pdfPageCount } from '../../src/core/pdf'
import { fill } from '../../src/shared/l10n/text'
import {
  MEDIA_ATTACHED_MAX_ENTRIES,
  MODEL_API_PRICES_PER_MILLION,
  TOKENS_PER_MILLION,
  UI_TEXT,
} from '../../src/shared/constants'
import { EN } from '../../src/shared/l10n/en'
import { Usd, type UsdAmount } from '../../src/shared/usd'
import type { AgentSession, TurnPart } from '../../src/core/agent/agentBackend'
import type { SessionStore } from '../../src/core/backends/modelapi/sessionStore'
import type { ToolIo } from '../../src/core/backends/modelapi/tools'
import type { McpToolSource } from '../../src/core/backends/modelapi/mcp/pool'
import { fakeMcpSource } from './helpers/fakeMcpSource'
import {
  fakeModelApi,
  fakeModelApiClient,
  fakeModelApiClientSettings,
  FAKE_MODEL_API_ACCOUNT_ID,
  FAKE_MODEL_API_KEY,
} from './helpers/fakeModelApi'
import { fakeFilesApi } from './helpers/fakeFiles'
import { fakeModelApiHostDeps } from './helpers/modelApiHostDeps'
import { FakeLogOutputChannel } from './helpers/fakes'
import { memoryToolIo } from './helpers/fakeToolIo'
import { memorySessionStore } from './helpers/fakeSessionStore'
import { watchSessionTurns } from './helpers/sessionTurns'
import { videoFixture, wavFixture } from './helpers/media/fixtures'
import { AttachedMedia } from '../../src/core/media/attachedMedia'
import { sniffMediaBytes } from '../../src/core/media/limits'

const CONTRIBUTOR = 'muse-spark-1.3-contributor'
const STANDARD = 'muse-spark-1.3'
// Every image seed bills 4,086 tokens regardless of detail; times the safety factor 2.
const IMAGE_BOUND = 8172
const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
  'base64',
)
/** A three-page PDF whose page tree the product counts (core/pdf.ts). */
const PDF = Buffer.from(
  [
    '%PDF-1.4',
    '1 0 obj << /Type /Catalog /Pages 2 0 R >> endobj',
    '2 0 obj << /Type /Pages /Kids [3 0 R 4 0 R 5 0 R] /Count 3 >> endobj',
    '3 0 obj << /Type /Page /Parent 2 0 R >> endobj',
    '4 0 obj << /Type /Page /Parent 2 0 R >> endobj',
    '5 0 obj << /Type /Page /Parent 2 0 R >> endobj',
    'trailer << /Root 1 0 R >>',
    '%%EOF',
    '',
  ].join('\n'),
  'latin1',
)

// One root per run; every rig takes its own numbered folder beneath it.
const scratchRoot = mkdtempSync(path.join(tmpdir(), 'muse-media-service-'))
const scratch = { count: 0 }
afterAll(() => {
  rmSync(scratchRoot, { recursive: true, force: true })
})

function scratchDir(): string {
  scratch.count += 1
  const folder = path.join(scratchRoot, String(scratch.count))
  mkdirSync(folder)
  return folder
}

function imagePart(): TurnPart {
  return {
    type: 'image',
    base64Data: PNG.toString('base64'),
    mediaType: 'image/png',
    width: 1,
    height: 1,
  }
}

function pdfPart(): TurnPart {
  return {
    type: 'file',
    base64Data: PDF.toString('base64'),
    mediaType: 'application/pdf',
    name: 'report.pdf',
    sizeBytes: PDF.length,
    pageCount: 3,
  }
}

interface Rig {
  readonly api: ReturnType<typeof fakeModelApi>
  readonly files: ReturnType<typeof fakeFilesApi>
  readonly io: ReturnType<typeof memoryToolIo>
  readonly store: SessionStore
  readonly host: Awaited<ReturnType<typeof createModelApiHost>>
  readonly log: FakeLogOutputChannel
}

/** The real factory with production media bound (an uploads root, a Files client, an account). */
async function factory(options: {
  readonly capUsd?: string
  readonly store?: SessionStore
  readonly readMedia?: NonNullable<ToolIo['readMedia']>
  readonly ledgerDir?: string
  readonly api?: ReturnType<typeof fakeModelApi>
  readonly mcp?: McpToolSource
  /** Properties a caller should not be able to install (cast past the type). */
  readonly strayHost?: Readonly<Record<string, unknown>>
  /** The window's attached-media registry (lane V seam 1). */
  readonly attachedMedia?: AttachedMedia
  /** Muse Voice's batch endpoint (U18), answering each multipart POST. */
  readonly asr?: (body: string) => Response
}): Promise<Rig> {
  const api = options.api ?? fakeModelApi()
  const files = fakeFilesApi(api.fetch)
  const log = new FakeLogOutputChannel()
  const io = memoryToolIo({}, '/ws')
  io.binaries.set('/ws/tile.png', new Uint8Array(PNG))
  io.binaries.set('/ws/report.pdf', new Uint8Array(PDF))
  if (options.readMedia !== undefined) Object.assign(io, { readMedia: options.readMedia })
  const store = options.store ?? memorySessionStore()
  const { asr } = options
  const transport = {
    ...api,
    fetch:
      asr === undefined
        ? files.fetch
        : async (input: string | URL | Request, init?: RequestInit) => {
            const url = new URL(input instanceof Request ? input.url : input)
            if (!url.pathname.endsWith('/asr/transcribe')) return await files.fetch(input, init)
            const body = await new Response(init?.body).text()
            api.requests.push({ path: '/asr/transcribe', method: 'POST', headers: {}, body })
            return asr(body)
          },
  }
  const capped =
    options.capUsd === undefined
      ? {}
      : { sessionBudgetUsd: () => Usd.from(options.capUsd ?? '0').toAmount() }
  // The production binding's three inputs: an uploads root, a Files-capable
  // client (the fake routes /files) and the key's account.
  const { mcp } = options
  const host = await createModelApiHost({
    hookSettingsPath: undefined,
    createMcpServers: mcp === undefined ? undefined : () => mcp,
    uiLocale: 'en',
    uiText: EN,
    client: { ...fakeModelApiClientSettings(log), fetch: transport.fetch },
    host: {
      ...fakeModelApiHostDeps({
        workspaceRoot: '/ws',
        io,
        log,
        client: fakeModelApiClient(transport, log),
      }),
      ...capped,
      uploadLedgerDir: options.ledgerDir ?? scratchDir(),
      confirmContributorModel: () => Promise.resolve(true),
      isPaidFeatureOn: () => true,
      store,
      ...(options.attachedMedia !== undefined && { attachedMedia: options.attachedMedia }),
      ...options.strayHost,
    },
  })
  return { api, files, io, store, host, log }
}

async function start(rig: Rig, modelId: string) {
  const session = await rig.host.startSession({
    workspaceRoot: '/ws',
    modelId,
    approvalMode: 'allowAll',
  })
  return { session, ...watchSessionTurns(session) }
}

/** Sends a turn and waits for it to end, whether it completes, fails or is refused up front. */
async function turn(
  h: { session: AgentSession; turnDone: () => Promise<void> },
  parts: readonly TurnPart[],
): Promise<string | undefined> {
  const done = h.turnDone()
  try {
    await h.session.sendTurn(parts)
  } catch (error: unknown) {
    return error instanceof Error ? error.message : String(error)
  }
  await done
  return undefined
}

function terminal(events: readonly { readonly type: string }[]) {
  return events.findLast((event) => event.type === 'turnCompleted') as
    { readonly terminal: string; readonly error?: { readonly message?: string } } | undefined
}

function readCall(file: string, callId: string) {
  return { calls: [{ name: 'read_file', arguments: JSON.stringify({ path: file }), callId }] }
}

/** The session-budget reservations a capped interactive turn makes, in USD. */
function watchReservations(store: SessionStore): UsdAmount[] {
  const reserved: UsdAmount[] = []
  const budget = store.budget
  if (budget === undefined) throw new Error('expected a budget journal')
  const reserve = budget.reserve.bind(budget)
  vi.spyOn(budget, 'reserve').mockImplementation((sessionId, accountId, costUsd, liability) => {
    reserved.push(costUsd)
    return reserve(sessionId, accountId, costUsd, liability)
  })
  return reserved
}

describe('one production media service per session (M105 W redesign)', () => {
  it('prices an attached image at the seeded bound in a capped session (RVMONEY017D 6, RVMEDIAW 3)', async () => {
    // The same capped turn, with and without the attached image: the
    // reservation differs by exactly the image's seeded upper bound, never by
    // its encoded bytes (about 171 tokens through the old attachment bypass).
    const reservedFor = async (parts: readonly TurnPart[]) => {
      const rig = await factory({ capUsd: '1' })
      const reserved = watchReservations(rig.store)
      try {
        const h = await start(rig, CONTRIBUTOR)
        rig.api.script({ text: 'A transparent tile.', usage: { input: 4300, output: 16 } })
        expect(await turn(h, parts)).toBeUndefined()
        expect(terminal(h.events)).toMatchObject({ terminal: 'completed' })
        expect(rig.files.uploads).toHaveLength(0)
        const body = JSON.stringify(rig.api.responseBodies()[0])
        return { reserved, body }
      } finally {
        await rig.host.close()
      }
    }
    const withImage = await reservedFor([{ type: 'text', text: 'Describe it' }, imagePart()])
    const without = await reservedFor([{ type: 'text', text: 'Describe it' }])
    // The bytes stay inline on the wire; only the price changed.
    expect(withImage.body).toContain('data:image/png;base64,')
    expect(withImage.reserved).toHaveLength(1)
    expect(without.reserved).toHaveLength(1)
    const delta = Usd.from(withImage.reserved[0]!).subtract(Usd.from(without.reserved[0]!))
    const bound = Usd.from(MODEL_API_PRICES_PER_MILLION.contributor.input)
      .times(IMAGE_BOUND)
      .divide(TOKENS_PER_MILLION)
    // Nano-USD rounding of the two reservations is the only slack.
    const slack = Usd.from('0.000000002')
    expect(delta.subtract(bound).compare(slack)).toBeLessThanOrEqual(0)
    expect(bound.subtract(delta).compare(slack)).toBeLessThanOrEqual(0)
  })

  it('refuses an attached PDF with no page rate in a capped session before inference (RVMEDIAW 3)', async () => {
    expect(pdfPageCount(PDF)).toBe(3)
    const rig = await factory({ capUsd: '1' })
    try {
      const h = await start(rig, CONTRIBUTOR)
      rig.api.script({ text: 'must not be asked' })
      const refused = await turn(h, [{ type: 'text', text: 'Summarize' }, pdfPart()])
      const reason = refused ?? terminal(h.events)?.error?.message ?? JSON.stringify(h.events)
      expect(reason).toContain(fill(UI_TEXT.media.cappedRateUnknown, { model: CONTRIBUTOR }))
      expect(rig.api.responseBodies()).toHaveLength(0)
      expect(rig.files.uploads).toHaveLength(0)
    } finally {
      await rig.host.close()
    }
  })

  it('sends an attached PDF in an uncapped session at its byte count (capped-only refusal)', async () => {
    const rig = await factory({})
    try {
      const h = await start(rig, CONTRIBUTOR)
      rig.api.script({ text: 'Three pages.' })
      expect(await turn(h, [{ type: 'text', text: 'Summarize' }, pdfPart()])).toBeUndefined()
      expect(terminal(h.events)).toMatchObject({ terminal: 'completed' })
      const body = JSON.stringify(rig.api.responseBodies()[0])
      expect(body).toContain('"type":"input_file"')
      expect(body).toContain('data:application/pdf;base64,')
      expect(rig.files.uploads).toHaveLength(0)
    } finally {
      await rig.host.close()
    }
  })

  it('keeps a tool-read image inline on later turns, saved and reopened (RVMEDIAW 1, P1)', async () => {
    // Pricing the read once registered it for upload: the next turn tried to
    // reopen a workspace image through the video/audio reader and failed
    // with "The upload expired. Attach tile.png again." before inference.
    const ledgerDir = scratchDir()
    const log = new FakeLogOutputChannel()
    const api = fakeModelApi()
    const files = fakeFilesApi(api.fetch)
    const store = createFileSessionStore({
      directory: scratchDir(),
      log,
      // The fake host's clock is fixed in the past; nothing here expires.
      retentionDays: () => 36_500,
      now: () => Date.now(),
      sleep: () => Promise.resolve(),
      // The production binding, from the production media bundle's entry.
      uploads: createSessionUploads({
        uploadLedgerDir: ledgerDir,
        currentAccountId: () => Promise.resolve(FAKE_MODEL_API_ACCOUNT_ID),
        filesClient: () =>
          new ModelApiClient({
            ...fakeModelApiClientSettings(log),
            apiKey: () => Promise.resolve(FAKE_MODEL_API_KEY),
            fetch: files.fetch,
          }),
      }),
    })
    const rig = await factory({ store, ledgerDir, api })
    let sessionId: string
    try {
      const h = await start(rig, CONTRIBUTOR)
      sessionId = h.session.sessionId
      rig.api.script(
        readCall('tile.png', 'read-tile'),
        { text: 'A transparent tile.' },
        { text: 'Still a transparent tile.' },
      )
      expect(await turn(h, [{ type: 'text', text: 'Read tile.png' }])).toBeUndefined()
      expect(terminal(h.events)).toMatchObject({ terminal: 'completed' })
      expect(await turn(h, [{ type: 'text', text: 'Look again' }])).toBeUndefined()
      expect(terminal(h.events)).toMatchObject({ terminal: 'completed' })
      const bodies = rig.api.responseBodies()
      expect(bodies).toHaveLength(3)
      // The follow-up re-sends the same inline bytes: no upload, no file id,
      // no false expiry.
      expect(JSON.stringify(bodies[2])).toContain('data:image/png;base64,')
      expect(JSON.stringify(bodies[2])).not.toContain('"file_id"')
      expect(JSON.stringify(h.events)).not.toContain('The upload expired')
      expect(rig.files.uploads).toHaveLength(0)
      // The turn saved through the real file store, uploads binding and all.
      await rig.host.flush()
      const saved = await store.list()
      expect(saved.map((stored) => stored.sessionId)).toContain(sessionId)
    } finally {
      await rig.host.close()
    }
    // Reopened from the real file store on a new host: the inline image was
    // never an upload, so the resumed turn neither reopens nor uploads it.
    const again = await factory({ store, ledgerDir, api })
    try {
      const loaded = await again.host.resumeSession(sessionId, CONTRIBUTOR)
      const h = { session: loaded.session, ...watchSessionTurns(loaded.session) }
      again.api.script({ text: 'The same tile.' })
      expect(await turn(h, [{ type: 'text', text: 'And once more' }])).toBeUndefined()
      expect(terminal(h.events)).toMatchObject({ terminal: 'completed' })
      expect(JSON.stringify(h.events)).not.toContain('The upload expired')
      expect(again.files.uploads).toHaveLength(0)
    } finally {
      await again.host.close()
    }
  })

  it('sends a standard-model image read in an uncapped session (RVMEDIAW 2)', async () => {
    // Uncapped, a model with no captured media record keeps the established
    // inline path; no "capped session" refusal reaches an uncapped read.
    const rig = await factory({})
    try {
      const h = await start(rig, STANDARD)
      rig.api.script(readCall('tile.png', 'read-tile'), { text: 'A tile.' })
      expect(await turn(h, [{ type: 'text', text: 'Read tile.png' }])).toBeUndefined()
      expect(terminal(h.events)).toMatchObject({ terminal: 'completed' })
      const followup = JSON.stringify(rig.api.responseBodies()[1])
      expect(followup).toContain('data:image/png;base64,')
      expect(followup).not.toContain(fill(UI_TEXT.media.cappedRateUnknown, { model: STANDARD }))
    } finally {
      await rig.host.close()
    }
  })

  it('sends a contributor PDF read in an uncapped session (RVMEDIAW 2)', async () => {
    const rig = await factory({})
    try {
      const h = await start(rig, CONTRIBUTOR)
      rig.api.script(readCall('report.pdf', 'read-pdf'), { text: 'Three pages.' })
      expect(await turn(h, [{ type: 'text', text: 'Read report.pdf' }])).toBeUndefined()
      expect(terminal(h.events)).toMatchObject({ terminal: 'completed' })
      const followup = JSON.stringify(rig.api.responseBodies()[1])
      expect(followup).toContain('data:application/pdf;base64,')
      expect(followup).not.toContain(fill(UI_TEXT.media.cappedRateUnknown, { model: CONTRIBUTOR }))
    } finally {
      await rig.host.close()
    }
  })

  it('refuses a contributor PDF read under a session cap before its bytes go', async () => {
    // The tool read is admitted through the same path as an attachment:
    // the model reads the honest reason, and no PDF byte is dispatched.
    const rig = await factory({ capUsd: '1' })
    try {
      const h = await start(rig, CONTRIBUTOR)
      rig.api.script(readCall('report.pdf', 'read-pdf'), { text: 'Could not read it.' })
      expect(await turn(h, [{ type: 'text', text: 'Read report.pdf' }])).toBeUndefined()
      const bodies = rig.api.responseBodies()
      expect(bodies).toHaveLength(2)
      const followup = JSON.stringify(bodies[1])
      expect(followup).toContain(fill(UI_TEXT.media.cappedRateUnknown, { model: CONTRIBUTOR }))
      expect(followup).not.toContain('data:application/pdf;base64,')
    } finally {
      await rig.host.close()
    }
  })

  it('drops a caller-supplied audio port: the bundle binds the only one (RVMEDIAW2 2)', async () => {
    // The factory spread hostDeps, so a stray prepareAudioMessage was
    // accepted and ran on an ordinary turn. Audio preparation is now the
    // bundle's own binding; a caller's callback never runs.
    const stray = vi.fn(() => Promise.resolve(undefined))
    const rig = await factory({ strayHost: { prepareAudioMessage: stray } })
    try {
      const h = await start(rig, CONTRIBUTOR)
      rig.api.script({ text: 'Hello.' })
      expect(await turn(h, [{ type: 'text', text: 'Hi' }])).toBeUndefined()
      expect(terminal(h.events)).toMatchObject({ terminal: 'completed' })
      expect(stray).not.toHaveBeenCalled()
      expect(rig.log.warn).toHaveBeenCalledWith(
        'A caller-supplied audio preparation port was ignored',
      )
    } finally {
      await rig.host.close()
    }
  })

  it('prices an MCP image at the seeded bound in a capped contributor turn (RVMEDIAW2 3)', async () => {
    // An MCP tool's image rides inside function_call_output. It was
    // byte-counted (a 1x1 PNG is a few dozen tokens), under-reserving
    // against the cap; it now reserves the image's seeded upper bound.
    const image = `data:image/png;base64,${PNG.toString('base64')}`
    const reservedFor = async (hasImage: boolean) => {
      const mcp = fakeMcpSource([{ server: 'pics', tool: 'snap', isReadOnly: true }])
      mcp.outcomes = [
        {
          output: 'mcp ok',
          ...(hasImage && {
            outputParts: [
              { type: 'input_text', text: 'mcp ok' },
              { type: 'input_image', image_url: image, detail: 'auto' },
            ],
          }),
          visibleOutput: 'mcp ok',
        },
      ]
      const rig = await factory({ capUsd: '1', mcp })
      const reserved = watchReservations(rig.store)
      try {
        const h = await start(rig, CONTRIBUTOR)
        rig.api.script(
          { calls: [{ name: 'mcp__pics__snap', arguments: '{}', callId: 'snap-1' }] },
          { text: 'A tile.' },
        )
        expect(await turn(h, [{ type: 'text', text: 'Snap it' }])).toBeUndefined()
        expect(terminal(h.events)).toMatchObject({ terminal: 'completed' })
        expect(mcp.calls).toHaveLength(1)
        const followup = JSON.stringify(rig.api.responseBodies()[1])
        expect(followup.includes(image)).toBe(hasImage)
        return reserved
      } finally {
        await rig.host.close()
      }
    }
    const withImage = await reservedFor(true)
    const without = await reservedFor(false)
    expect(withImage).toHaveLength(2)
    expect(without).toHaveLength(2)
    const delta = Usd.from(withImage[1]!).subtract(Usd.from(without[1]!))
    const tokens = (count: number) =>
      Usd.from(MODEL_API_PRICES_PER_MILLION.contributor.input)
        .times(count)
        .divide(TOKENS_PER_MILLION)
    // The bound, plus at most the few tokens of the output's part structure.
    expect(delta.compare(tokens(IMAGE_BOUND))).toBeGreaterThanOrEqual(0)
    expect(delta.compare(tokens(IMAGE_BOUND + 64))).toBeLessThanOrEqual(0)
  })

  it('refuses an MP3 read honestly: a tool read is never transcribed', async () => {
    // Muse Voice transcribes only what the user attached (lane V seam 3B),
    // after its paid question; a file the model reads is never sent there.
    // A read MP3 is named as not taken by the model; nothing uploads and no
    // transcription request is made.
    const bytes = new Uint8Array(4096).fill(7)
    const sha256 = createHash('sha256').update(bytes).digest('hex')
    const chunk = Promise.resolve(bytes)
    const readMedia: NonNullable<ToolIo['readMedia']> = () =>
      Promise.resolve({
        info: {
          kind: 'audio',
          mediaType: 'audio/mpeg',
          sizeBytes: bytes.length,
          durationSeconds: 2,
        },
        sha256,
        source: {
          name: 'speech.mp3',
          mime: 'audio/mpeg',
          bytes: bytes.length,
          open: async function* () {
            yield await chunk
          },
        },
      })
    const rig = await factory({ readMedia })
    try {
      const h = await start(rig, CONTRIBUTOR)
      rig.api.script(readCall('speech.mp3', 'read-mp3'), { text: 'I cannot hear audio.' })
      expect(await turn(h, [{ type: 'text', text: 'Read speech.mp3' }])).toBeUndefined()
      const bodies = rig.api.responseBodies()
      expect(bodies).toHaveLength(2)
      expect(JSON.stringify(bodies[1])).toContain(
        fill(UI_TEXT.media.audioUnsupported, { model: CONTRIBUTOR }),
      )
      expect(rig.files.uploads).toHaveLength(0)
      expect(rig.api.requests.some((request) => request.path.includes('/asr/'))).toBe(false)
    } finally {
      await rig.host.close()
    }
  })
})

/** An attached mp4 registered as the attach port does: metadata, digest, a reopening source. */
// No soundtrack: these cases pin upload and replay, never Muse Voice (seam 3B).
function attachedVideo(
  registry: AttachedMedia,
  token: string,
  bytes = videoFixture({ soundtrack: false }),
) {
  const info = sniffMediaBytes(bytes)
  if (info === undefined) throw new Error('fixture must sniff')
  const reads = { count: 0 }
  const chunk = Promise.resolve(bytes)
  const part = registry.register(
    token,
    { name: 'clip.mp4', info, sha256: createHash('sha256').update(bytes).digest('hex') },
    {
      read: async function* () {
        reads.count += 1
        yield await chunk
      },
    },
  )
  return { part, reads }
}

/** A first reply held open once its request arrives, so later input queues or steers. */
function holdFirstReply(rig: Rig, after?: { readonly text: string }) {
  const held = Promise.withResolvers<undefined>()
  const requested = Promise.withResolvers<undefined>()
  rig.api.script(
    {
      text: 'First.',
      hold: held.promise,
      onRequest: () => {
        requested.resolve(undefined)
      },
    },
    ...(after === undefined ? [] : [after]),
  )
  return { held, requested }
}

describe('attached video through the session media service (M105 lane V seam 1)', () => {
  it('uploads an attached video once and replays its file id on the next turn', async () => {
    const registry = new AttachedMedia()
    const { part, reads } = attachedVideo(registry, 'attach-1')
    const rig = await factory({ attachedMedia: registry })
    try {
      const h = await start(rig, CONTRIBUTOR)
      rig.api.script({ text: 'A short clip.' }, { text: 'Still the clip.' })
      expect(await turn(h, [{ type: 'text', text: 'What happens?' }, part])).toBeUndefined()
      expect(terminal(h.events)).toMatchObject({ terminal: 'completed' })
      expect(rig.files.uploads).toHaveLength(1)
      const fileId = rig.files.uploads[0]?.fileId ?? ''
      const first = JSON.stringify(rig.api.responseBodies()[0])
      expect(first).toContain('"input_video"')
      expect(first).toContain(fileId)
      // No bytes and no path ride the request: only the provider's file id.
      expect(first).not.toContain('data:video')
      expect(await turn(h, [{ type: 'text', text: 'And then?' }])).toBeUndefined()
      expect(rig.files.uploads).toHaveLength(1)
      expect(JSON.stringify(rig.api.responseBodies()[1])).toContain(fileId)
      expect(reads.count).toBe(1)
      // The finished turn's one-use token is released (RVMEDIAV 7).
      expect(registry.resolve(part)).toBeUndefined()
    } finally {
      await rig.host.close()
    }
  })

  it('holds a queued turn’s video from acceptance: the bound never evicts it (RVMEDIAV2)', async () => {
    const registry = new AttachedMedia()
    const { part, reads } = attachedVideo(registry, 'queued')
    const rig = await factory({ attachedMedia: registry })
    try {
      const h = await start(rig, CONTRIBUTOR)
      const { held, requested } = holdFirstReply(rig, { text: 'The clip.' })
      const both = new Promise<void>((resolve) => {
        h.session.onEvent(() => {
          if (h.events.filter((seen) => seen.type === 'turnCompleted').length === 2) resolve()
        })
      })
      await h.session.sendTurn([{ type: 'text', text: 'Hold on.' }])
      await requested.promise
      const queued = await h.session.sendTurn([{ type: 'text', text: 'Watch' }, part])
      expect(queued.disposition).toBe('queued')
      expect(registry.state('queued')).toBe('claimed')
      for (let index = 0; index < MEDIA_ATTACHED_MAX_ENTRIES; index++)
        attachedVideo(registry, `later-${String(index)}`)
      expect(registry.state('queued')).toBe('claimed')
      held.resolve(undefined)
      await both
      expect(h.events.filter((event) => event.type === 'turnCompleted')).toMatchObject([
        { terminal: 'completed' },
        { terminal: 'completed' },
      ])
      expect([rig.files.uploads.length, reads.count]).toEqual([1, 1])
      expect(registry.state('queued')).toBeUndefined()
    } finally {
      await rig.host.close()
    }
  })

  it('releases a withdrawn queued turn’s and a withdrawn steer’s claims (RVMEDIAV2)', async () => {
    const registry = new AttachedMedia()
    const queuedVideo = attachedVideo(registry, 'queued').part
    const steeredVideo = attachedVideo(registry, 'steered').part
    const rig = await factory({ attachedMedia: registry })
    try {
      const h = await start(rig, CONTRIBUTOR)
      const { held, requested } = holdFirstReply(rig)
      const first = await h.session.sendTurn([{ type: 'text', text: 'Hold on.' }])
      await requested.promise
      const steer = await h.session.steer(first.turnId, [
        { type: 'text', text: 'Also' },
        steeredVideo,
      ])
      const queued = await h.session.sendTurn([{ type: 'text', text: 'Watch' }, queuedVideo])
      expect([registry.state('steered'), registry.state('queued')]).toEqual(['claimed', 'claimed'])
      for (const submission of [steer, queued]) {
        const outcome = await h.session.withdrawQueued?.({
          turnId: submission.turnId,
          userMessageId: submission.userMessageId,
          disposition: submission.disposition,
        })
        expect(outcome).toMatchObject({ status: 'withdrawn' })
      }
      expect([registry.state('steered'), registry.state('queued')]).toEqual([undefined, undefined])
      const done = h.turnDone()
      held.resolve(undefined)
      await done
    } finally {
      await rig.host.close()
    }
  })

  it('refuses a media part the registry does not hold, before any upload or inference', async () => {
    const registry = new AttachedMedia()
    const { part } = attachedVideo(registry, 'attach-2')
    const rig = await factory({ attachedMedia: registry })
    try {
      const h = await start(rig, CONTRIBUTOR)
      for (const forged of [
        { ...part, token: 'never-issued' },
        { ...part, sha256: '0'.repeat(64) },
      ]) {
        const refusal = await turn(h, [{ type: 'text', text: 'Watch' }, forged])
        expect(refusal ?? JSON.stringify(h.events)).toContain(
          fill(UI_TEXT.media.sourceChanged, { name: 'clip.mp4' }),
        )
      }
      expect(rig.files.uploads).toHaveLength(0)
      expect(rig.api.responseBodies()).toHaveLength(0)
    } finally {
      await rig.host.close()
    }
  })

  it('refuses an attached video whose bytes changed since it was attached', async () => {
    const registry = new AttachedMedia()
    const original = videoFixture({ soundtrack: false })
    const info = sniffMediaBytes(original)
    if (info === undefined) throw new Error('fixture must sniff')
    const changed = new Uint8Array(original)
    changed[changed.length - 1] = (changed.at(-1) ?? 0) ^ 0xff
    const chunk = Promise.resolve(changed)
    const part = registry.register(
      'attach-3',
      { name: 'clip.mp4', info, sha256: createHash('sha256').update(original).digest('hex') },
      {
        read: async function* () {
          yield await chunk
        },
      },
    )
    const rig = await factory({ attachedMedia: registry })
    try {
      const h = await start(rig, CONTRIBUTOR)
      const refusal = await turn(h, [{ type: 'text', text: 'Watch' }, part])
      expect(refusal ?? JSON.stringify(h.events)).toContain('clip.mp4')
      // The changed source never completes an upload.
      expect(rig.files.uploads).toHaveLength(0)
      expect(rig.api.responseBodies()).toHaveLength(0)
    } finally {
      await rig.host.close()
    }
  })

  it('refuses an attached video when the session has no media service, never sending its name alone', async () => {
    const registry = new AttachedMedia()
    const { part } = attachedVideo(registry, 'attach-5')
    // No uploads root: the factory installs no production media service.
    const rig = await factory({
      attachedMedia: registry,
      strayHost: { uploadLedgerDir: undefined },
    })
    try {
      const h = await start(rig, CONTRIBUTOR)
      const refusal = await turn(h, [{ type: 'text', text: 'Watch' }, part])
      expect(refusal ?? JSON.stringify(h.events)).toContain(UI_TEXT.media.uploadUnavailable)
      expect(rig.api.responseBodies()).toHaveLength(0)
      expect(rig.files.uploads).toHaveLength(0)
    } finally {
      await rig.host.close()
    }
  })

  it('refuses an attached video on a model with no captured video record', async () => {
    const registry = new AttachedMedia()
    const { part } = attachedVideo(registry, 'attach-4')
    const rig = await factory({ attachedMedia: registry })
    try {
      const h = await start(rig, STANDARD)
      const refusal = await turn(h, [{ type: 'text', text: 'Watch' }, part])
      expect(refusal ?? JSON.stringify(h.events)).toContain(
        fill(UI_TEXT.media.videoUnknown, { model: STANDARD }),
      )
      expect(rig.files.uploads).toHaveLength(0)
    } finally {
      await rig.host.close()
    }
  })
})

/** Two seconds of 16 kHz mono 16-bit PCM: the batch contract, so nothing converts. */
function contractWav(): Uint8Array {
  return wavFixture(2, { sampleRate: 16_000 })
}

/** An attached WAV, registered as the attach port does. */
function attachedWav(registry: AttachedMedia, token: string) {
  const bytes = contractWav()
  const info = sniffMediaBytes(bytes)
  if (info === undefined) throw new Error('fixture must sniff')
  const chunk = Promise.resolve(bytes)
  return registry.register(
    token,
    { name: 'note.wav', info, sha256: createHash('sha256').update(bytes).digest('hex') },
    {
      read: async function* () {
        yield await chunk
      },
    },
  )
}

/** A D78 ledger double recording exact reservations and settlements. */
function dailyLedger() {
  const reserved: UsdAmount[] = []
  const settled: { readonly amount: UsdAmount; readonly unknown: boolean | undefined }[] = []
  return {
    reserved,
    settled,
    reservePaidExtra: (costUsd: UsdAmount) => {
      reserved.push(costUsd)
      return Promise.resolve({
        reservedUsd: costUsd,
        check: () => undefined,
        settle: (amount: UsdAmount, hasUnknownCost?: boolean) => {
          settled.push({ amount, unknown: hasUnknownCost })
          return Promise.resolve()
        },
      })
    },
  }
}

const TRANSCRIPT = 'The Blue Llama.'

/** Sends the attached part on the contributor model; the refusal or the turn's events. */
async function refusalOf(rig: Rig, part: TurnPart): Promise<string> {
  const h = await start(rig, CONTRIBUTOR)
  const refusal = await turn(h, [{ type: 'text', text: 'Listen' }, part])
  return refusal ?? JSON.stringify(h.events)
}

/** A production rig with one attached WAV, a paid-use yes and a D78 ledger double. */
async function soundRig(
  token: string,
  asr: (body: string) => Response,
  host: Readonly<Record<string, unknown>> = {},
) {
  const registry = new AttachedMedia()
  const part = attachedWav(registry, token)
  const ledger = dailyLedger()
  const rig = await factory({
    attachedMedia: registry,
    asr,
    strayHost: {
      reservePaidExtra: ledger.reservePaidExtra,
      allowsPaidUse: () => Promise.resolve(true),
      ...host,
    },
  })
  return { part, ledger, rig }
}

describe('attached sound through Muse Voice (M105 lane V seam 3B)', () => {
  it('transcribes an attached WAV once, under the daily ledger and the tally', async () => {
    const notePaidUse = vi.fn()
    const { part, ledger, rig } = await soundRig(
      'sound-1',
      () => Response.json({ transcript: TRANSCRIPT, audioDurationMs: 2080 }),
      { notePaidUse },
    )
    try {
      const h = await start(rig, CONTRIBUTOR)
      rig.api.script({ text: 'A llama.' })
      expect(await turn(h, [{ type: 'text', text: 'What is said?' }, part])).toBeUndefined()
      expect(terminal(h.events)).toMatchObject({ terminal: 'completed' })
      const posts = rig.api.requests.filter((request) => request.path === '/asr/transcribe')
      expect(posts).toHaveLength(1)
      expect(String(posts[0]?.body)).toContain('PUSH_TO_TALK')
      const body = JSON.stringify(rig.api.responseBodies()[0])
      expect(body).toContain(TRANSCRIPT)
      expect(body).not.toContain('input_audio')
      expect(rig.files.uploads).toHaveLength(0)
      // Two billed seconds at $0.18 per hour, reserved and settled exactly.
      expect(ledger.reserved).toEqual(['0.0001'])
      expect(ledger.settled).toEqual([{ amount: '0.0001', unknown: false }])
      expect(notePaidUse).toHaveBeenCalledWith('voice', 2)
    } finally {
      await rig.host.close()
    }
  })

  it('leaves a turn without attached sound byte-identical, with no transcription request', async () => {
    const bodyOf = async (attachedMedia?: AttachedMedia) => {
      const rig = await factory({
        ...(attachedMedia !== undefined && { attachedMedia }),
        asr: () => Response.json({ transcript: 'unused', audioDurationMs: 1000 }),
      })
      try {
        const h = await start(rig, CONTRIBUTOR)
        rig.api.script({ text: 'Hi.' })
        expect(await turn(h, [{ type: 'text', text: 'Hello' }])).toBeUndefined()
        expect(rig.api.requests.some((request) => request.path === '/asr/transcribe')).toBe(false)
        return JSON.stringify(rig.api.responseBodies()[0])
      } finally {
        await rig.host.close()
      }
    }
    expect(await bodyOf(new AttachedMedia())).toBe(await bodyOf())
  })

  it('refuses attached audio when Muse Voice is off, posting and reserving nothing', async () => {
    const { part, ledger, rig } = await soundRig(
      'sound-2',
      () => Response.json({ transcript: TRANSCRIPT, audioDurationMs: 2080 }),
      { isPaidFeatureOn: (feature: string) => feature !== 'voice' },
    )
    try {
      expect(await refusalOf(rig, part)).toContain(
        fill(UI_TEXT.media.audioUnsupported, { model: CONTRIBUTOR }),
      )
      expect(rig.api.requests.some((request) => request.path === '/asr/transcribe')).toBe(false)
      expect(ledger.reserved).toHaveLength(0)
      expect(rig.api.responseBodies()).toHaveLength(0)
    } finally {
      await rig.host.close()
    }
  })

  it('shows the server refusal as sent and settles nothing billed', async () => {
    const refusalText = "The 'audio' part must be a mono 16-bit PCM WAV at 16 or 24 kHz"
    const { part, ledger, rig } = await soundRig('sound-3', () =>
      Response.json(
        { error: { message: refusalText, param: 'audio', type: 'invalid_request_error' } },
        { status: 400 },
      ),
    )
    try {
      expect(await refusalOf(rig, part)).toContain(refusalText)
      expect(rig.api.responseBodies()).toHaveLength(0)
      // Sent but unbilled: the reservation stays as uncertain liability.
      expect(ledger.settled).toEqual([{ amount: '0.0001', unknown: true }])
    } finally {
      await rig.host.close()
    }
  })
})
