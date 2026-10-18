// MONEY017D / D85.2, D85.6: the production media replay factory. It builds
// the session replay through the real upload storage (UploadLedger over the
// captured Files wire), the calibrated estimator (the 23 capture seeds plus
// locally settled observations), the captured Responses codec and the
// captured model capabilities. The host supplies only what it owns: the
// HTTP client, the account digest, the storage directory, the session's cap
// and closing, and the source seam. Inline images and PDFs are identified from
// their own bytes (replayMedia.ts); attached video and audio resolve through
// the host's attached-media registry (lane V), whose sources reverify.
//
// Authorization (D85.6 U6c, D85.7): uploads are not billed, so the Files
// authorizer asks nothing beyond decision 7. A scheduled upload follows an
// approved read_file of the same workspace file; the read's own approval is
// the authorization, and interactive contributor consent stays at the attach
// port (D85.7), which binds before any upload. The source re-read resolves
// the adopted workspace-relative name under the workspace root and fails
// closed (expired) when the file is gone or changed.
import { readFileSync } from 'node:fs'
import path from 'node:path'
import * as z from 'zod/mini'
import { withMkdirLock } from '../fileLock'
import {
  MEDIA_ESTIMATE_SAFETY_FACTOR,
  MEDIA_MAX_UPLOAD_MIB,
  MEDIA_UPLOAD_LOCK_ATTEMPTS,
  MEDIA_UPLOAD_LOCK_WAIT_MS,
  BYTES_PER_MIB,
  MEDIA_PROVIDER_POOL_BYTES,
} from '../../shared/constants'
import {
  accountLedgerDirectory,
  fileUploadLedgerStorage,
  writeStateAtomically,
  type LedgerStoreLock,
} from './uploadLedgerStorage'
import type { CoreLogger } from '../logging'
import type { ModelApiClient } from '../backends/modelapi/client'
import { FilesApi, uploadExpirySeconds } from '../backends/modelapi/files'
import type { ToolIo } from '../backends/modelapi/tools'
import { pathModule } from '../workspaceRoot'
import { MediaCostEstimator, calibrationPointSchema, type CalibrationPoint } from './mediaCost'
import { productionCalibrationSeeds } from './mediaCalibration'
import { responsesMediaCodec } from './responsesMediaCodec'
import { metaMediaCapabilities } from './metaMediaCapabilities'
import { ReplayMedia, type ReplayMediaDeps, type StoredMediaPart } from './replayMedia'
import { UploadLedger } from './uploadLedger'
import type { AttachedMediaPort } from './attachedMedia'

const CALIBRATION_FILE = 'calibration.json'
const LOCK_SUFFIX = '.lock'

export type MediaStoreLock = LedgerStoreLock

function containedFile(directory: string, name: string): string {
  const resolved = path.resolve(directory, name)
  if (resolved !== directory && !resolved.startsWith(`${directory}${path.sep}`))
    throw new Error('Media path escapes its directory')
  return resolved
}

/** Holds the calibration mutex across the operation (core/fileLock, never stolen). */
function withCalibrationLock<T>(
  directory: string,
  options: MediaStoreLock | undefined,
  operation: () => Promise<T>,
): Promise<T> {
  return withMkdirLock(
    containedFile(directory, `${CALIBRATION_FILE}${LOCK_SUFFIX}`),
    {
      sleep:
        options?.sleep ?? ((ms: number) => new Promise<void>((settle) => setTimeout(settle, ms))),
      attempts: options?.attempts ?? MEDIA_UPLOAD_LOCK_ATTEMPTS,
      waitMs: options?.waitMs ?? MEDIA_UPLOAD_LOCK_WAIT_MS,
      locked: () => new Error('Media calibration is locked'),
    },
    operation,
  )
}
export interface ProductionMediaStore {
  readonly read: () => unknown
  readonly write: (points: readonly CalibrationPoint[]) => Promise<void>
  /** The shared mutex around read-merge-write, so no settlement is lost. */
  readonly withLock: <T>(operation: () => Promise<T>) => Promise<T>
}

/** The estimator's file store: seeds while nothing local settled yet. */
export function fileCalibrationStore(
  directory: string,
  log: Pick<CoreLogger, 'warn'>,
  lock?: MediaStoreLock,
): ProductionMediaStore {
  const pointsSchema = z.array(calibrationPointSchema)
  return {
    read: () => {
      let raw: unknown
      try {
        raw = JSON.parse(readFileSync(containedFile(directory, CALIBRATION_FILE), 'utf8'))
      } catch (error: unknown) {
        if (
          typeof error === 'object' &&
          error !== null &&
          'code' in error &&
          (error as { code: string }).code === 'ENOENT'
        )
          return productionCalibrationSeeds()
        // A corrupt local store never misprices a reservation: seeds stand in.
        log.warn('Media calibration cache read failed')
        return productionCalibrationSeeds()
      }
      const parsed = pointsSchema.safeParse(raw)
      if (!parsed.success) {
        log.warn('Media calibration cache read failed')
        return productionCalibrationSeeds()
      }
      return parsed.data
    },
    write: async (points): Promise<void> => {
      await writeStateAtomically(directory, CALIBRATION_FILE, pointsSchema.parse(points))
    },
    withLock: async <T>(operation: () => Promise<T>): Promise<T> =>
      await withCalibrationLock(directory, lock, operation),
  }
}

export interface ProductionMediaDeps {
  readonly sessionId: string
  readonly client: Pick<ModelApiClient, 'requestFile'>
  readonly accountId: string
  readonly currentAccountId: () => Promise<string | undefined>
  readonly directory: string
  readonly log: Pick<CoreLogger, 'warn'>
  readonly source: ReplayMediaDeps['source']
  /** The host's attached-media registry resolving `media` parts (lane V). */
  readonly attachment?: ReplayMediaDeps['attachment']
  readonly compactionTail?: ReplayMediaDeps['compactionTail']
  /** `museSpark.mediaUploadExpiryDays`, read per use; absent keeps the default. */
  readonly expiryDays?: () => number
  /** The session's cap, read per request (D85.6: unknown refuses only when capped). */
  readonly isCapped: () => boolean
  /** Whether the session is disposed: then nothing is read or uploaded (RVMEDIAV3 2). */
  readonly isClosed: () => boolean
  readonly now?: () => number
  readonly lock?: MediaStoreLock
}

/** One upload ledger per account (provider plus account id): a switched key
 * starts in its own empty directory, so a fresh upload never fails on
 * another account's state, and another account's files are never replayed.
 * The ledger's own account check still guards a replaced directory. */
export function productionMediaDirectory(directory: string, accountId: string): string {
  return accountLedgerDirectory(directory, accountId)
}

/**
 * The uploads' authorization (the header's D85.6/D85.7 rule): the gate's
 * own refusal, and Meta's Files API only. It lives in this lazy bundle
 * rather than the Model API bundle's host wiring (RVMEDIAV3 sizes).
 */
const authorizeMetaUpload: ReplayMediaDeps['authorize'] = (_media, model, gate, signal) => {
  signal.throwIfAborted()
  if (!gate.ok) throw new Error(gate.reason)
  if (model.provider !== 'meta') throw new Error('Media upload provider mismatch')
  return Promise.resolve()
}

/** The session replay over the real upload storage and calibration. */
export function createProductionMediaReplay(deps: ProductionMediaDeps): ReplayMedia {
  const files = new FilesApi({
    client: deps.client,
    provider: 'meta',
    // U6c (D85.6, lead decision 2026-10-08): storage is not billed, so the
    // upload asks nothing beyond decision 7. The ledger still binds every
    // request to the key digest and refuses on an account change.
    authorizeUpload: () => Promise.resolve(),
    // The setting is read on every upload, never frozen here.
    expirySeconds: () => uploadExpirySeconds(deps.expiryDays?.()),
  })
  const accountDirectory = productionMediaDirectory(deps.directory, deps.accountId)
  const ledger = new UploadLedger({
    storage: fileUploadLedgerStorage(accountDirectory, deps.lock),
    files,
    accountId: deps.accountId,
    provider: 'meta',
    poolBytes: MEDIA_PROVIDER_POOL_BYTES,
    currentAccountId: deps.currentAccountId,
    now: deps.now ?? (() => Date.now()),
  })
  const store = fileCalibrationStore(accountDirectory, deps.log, deps.lock)
  const estimator = new MediaCostEstimator({
    read: store.read,
    write: store.write,
    withLock: store.withLock,
    safetyFactor: MEDIA_ESTIMATE_SAFETY_FACTOR,
  })
  return new ReplayMedia(deps.sessionId, {
    estimator,
    capabilities: metaMediaCapabilities,
    codec: responsesMediaCodec,
    ledger: (provider) => {
      if (provider !== 'meta') throw new Error('Media upload provider mismatch')
      return ledger
    },
    // M101 C1 keeps the newest media verbatim; older media summarizes. The
    // host merges this turn with its own recent tail before summarizing.
    compactionTail:
      deps.compactionTail ??
      ((entries) => {
        const newest = entries.at(-1)
        return newest === undefined ? [] : [newest.turnId]
      }),
    source: deps.source,
    ...(deps.attachment !== undefined && { attachment: deps.attachment }),
    authorize: authorizeMetaUpload,
    isCapped: deps.isCapped,
    isClosed: deps.isClosed,
  })
}

/**
 * An attached record's own token's reverifying source (RVMEDIAV2: by the
 * token it resolved through, never by matching bytes), else the workspace
 * reopen a tool-read file uses. Neither guesses a path.
 */
export function attachedOrWorkspaceSource(
  attached: Pick<AttachedMediaPort, 'source'> | undefined,
  workspace: ReplayMediaDeps['source'],
): ReplayMediaDeps['source'] {
  return async (media, signal, token) =>
    (token === undefined ? undefined : attached?.source(token, media)) ??
    (await workspace(media, signal))
}

/** Reopen an adopted workspace file for the replay's re-verification. */
export function workspaceMediaSource(deps: {
  readonly workspaceRoot: string
  readonly platform: NodeJS.Platform
  readonly io: Pick<ToolIo, 'readMedia'>
}): ReplayMediaDeps['source'] {
  return async (media: StoredMediaPart, signal: AbortSignal) => {
    const readMedia = deps.io.readMedia
    if (readMedia === undefined) return
    const api = pathModule(deps.platform)
    const absolute = api.resolve(deps.workspaceRoot, media.name)
    const root = api.resolve(deps.workspaceRoot)
    // A filesystem root already ends in the separator: appending another
    // doubles it (`//`), so no child ever matches the prefix.
    const prefix = root.endsWith(api.sep) ? root : `${root}${api.sep}`
    if (absolute !== root && !absolute.startsWith(prefix)) return
    const read = await readMedia(absolute, MEDIA_MAX_UPLOAD_MIB * BYTES_PER_MIB, absolute, signal)
    if (
      read === undefined ||
      'kind' in read ||
      read.sha256 !== media.sha256 ||
      read.info.sizeBytes !== media.info.sizeBytes
    )
      return
    // The adopted name is the workspace-relative identity; the bytes and
    // their digest are what the replay verifies.
    const reopen = read.source.open.bind(read.source)
    return {
      name: media.name,
      mime: read.source.mime,
      bytes: read.source.bytes,
      open: (signal: AbortSignal) => reopen(signal),
    }
  }
}
