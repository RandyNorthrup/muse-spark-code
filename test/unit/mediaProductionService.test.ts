// M105 W redesign: one production media service per session, through the
// real factory (createModelApiHost) and the real backend manager, over fake
// HTTP. Every image and PDF a request carries (attached, read by a tool, or
// restored with the session) is priced through one admission path at the
// seeded upper bound; an unknown rate refuses only under a cap; and an inline
// visual is never registered for upload. Each case names the review finding
// it regresses (RVMONEY017D on c2689e116, RVMEDIAW on 27d8f1327).
import { mkdtempSync, rmSync } from 'node:fs'
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
  MODEL_API_PRICES_PER_MILLION,
  TOKENS_PER_MILLION,
  UI_TEXT,
} from '../../src/shared/constants'
import { EN } from '../../src/shared/l10n/en'
import { Usd, type UsdAmount } from '../../src/shared/usd'
import type { AgentSession, TurnPart } from '../../src/core/agent/agentBackend'
import type { SessionStore } from '../../src/core/backends/modelapi/sessionStore'
import type { ToolIo } from '../../src/core/backends/modelapi/tools'
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

const folders: string[] = []
afterAll(() => {
  for (const folder of folders) rmSync(folder, { recursive: true, force: true })
})

function scratchDir(): string {
  const folder = mkdtempSync(path.join(tmpdir(), 'muse-media-service-'))
  folders.push(folder)
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
}): Promise<Rig> {
  const api = options.api ?? fakeModelApi()
  const files = fakeFilesApi(api.fetch)
  const log = new FakeLogOutputChannel()
  const io = memoryToolIo({}, '/ws')
  io.binaries.set('/ws/tile.png', new Uint8Array(PNG))
  io.binaries.set('/ws/report.pdf', new Uint8Array(PDF))
  if (options.readMedia !== undefined) Object.assign(io, { readMedia: options.readMedia })
  const store = options.store ?? memorySessionStore()
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
      store,
      isPaidFeatureOn: () => true,
      confirmContributorModel: () => Promise.resolve(true),
      uploadLedgerDir: options.ledgerDir ?? scratchDir(),
      ...(options.capUsd !== undefined && {
        sessionBudgetUsd: () => Usd.from(options.capUsd ?? '0').toAmount(),
      }),
    },
    hookSettingsPath: undefined,
    createMcpServers: undefined,
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

  it('refuses an MP3 read honestly: production binds no transcription port', async () => {
    // Lane V's seams (attach tokens, the transcription POST, the converter
    // binding, consent/reserve adapters, ACP media) are not bound, so the
    // product installs no audio port. A read MP3 is named as not taken by
    // the model; nothing uploads and no transcription request is made.
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
