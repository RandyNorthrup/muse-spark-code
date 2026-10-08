// MONEY017D / D85.2, D85.6: the production media replay factory. It builds
// the session replay through the real upload storage (UploadLedger over the
// captured Files wire), the calibrated estimator (the 23 capture seeds plus
// locally settled observations), the captured Responses codec and the
// captured model capabilities. The host supplies only what it owns: the
// HTTP client, the account digest, the storage directory, and the
// attachment/source/authorize seams.
//
// Authorization (D85.6 U6c, D85.7): uploads are not billed, so the Files
// authorizer asks nothing beyond decision 7. A scheduled upload follows an
// approved read_file of the same workspace file; the read's own approval is
// the authorization, and interactive contributor consent stays at the attach
// port (D85.7), which binds before any upload. The source re-read resolves
// the adopted workspace-relative name under the workspace root and fails
// closed (expired) when the file is gone or changed.
import { mkdir, readFile, readdir, rename, rm, rmdir, writeFile } from 'node:fs/promises'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import * as z from 'zod/mini'
import {
  MEDIA_ESTIMATE_SAFETY_FACTOR,
  MEDIA_MAX_UPLOAD_MIB,
  BYTES_PER_MIB,
  MEDIA_PROVIDER_POOL_BYTES,
} from '../../shared/constants'
import type { CoreLogger } from '../logging'
import type { ModelApiClient } from '../backends/modelapi/client'
import { FilesApi } from '../backends/modelapi/files'
import type { ToolIo } from '../backends/modelapi/tools'
import { pathModule } from '../workspaceRoot'
import { MediaCostEstimator, calibrationPointSchema, type CalibrationPoint } from './mediaCost'
import { productionCalibrationSeeds } from './mediaCalibration'
import { responsesMediaCodec } from './responsesMediaCodec'
import { metaMediaCapabilities } from './metaMediaCapabilities'
import { ReplayMedia, type ReplayMediaDeps, type StoredMediaPart } from './replayMedia'
import type { UploadLedgerStorage } from './uploadLedger'
import { UploadLedger } from './uploadLedger'

const LEDGER_FILE = 'uploads.json'
const CALIBRATION_FILE = 'calibration.json'
const LOCK_SUFFIX = '.lock'
const LOCK_WAIT_MS = 25
const LOCK_ATTEMPTS = 200
const OWNER_DIRECTORY_MODE = 0o700
const OWNER_FILE_MODE = 0o600

function containedFile(directory: string, name: string): string {
  const resolved = path.resolve(directory, name)
  if (resolved !== directory && !resolved.startsWith(`${directory}${path.sep}`))
    throw new Error('Media path escapes its directory')
  return resolved
}

function isLivePid(pid: number): boolean {
  try {
    process.kill(pid, 0)
    return true
  } catch (error: unknown) {
    // ESRCH means the holder is gone; any other failure keeps the lock.
    return (
      typeof error === 'object' &&
      error !== null &&
      'code' in error &&
      (error as { code?: unknown }).code !== 'ESRCH'
    )
  }
}

/** Atomic writes under a cross-process mutex; a stale holder never blocks. */
export function fileUploadLedgerStorage(directory: string): UploadLedgerStorage {
  const stateFile = () => containedFile(directory, LEDGER_FILE)
  const lockDir = () => containedFile(directory, `${LEDGER_FILE}${LOCK_SUFFIX}`)
  const occupantFile = () => path.join(lockDir(), String(process.pid))
  const acquire = async (): Promise<void> => {
    await mkdir(directory, { recursive: true, mode: OWNER_DIRECTORY_MODE })
    for (let attempt = 0; attempt < LOCK_ATTEMPTS; attempt++) {
      try {
        await mkdir(lockDir())
        await writeFile(occupantFile(), `${String(process.pid)} ${String(Date.now())}`, {
          mode: OWNER_FILE_MODE,
        })
        return
      } catch (error: unknown) {
        if (typeof error !== 'object' || error === null || !('code' in error)) throw error
        if ((error as { code: string }).code !== 'EEXIST') throw error
      }
      // A holder that died between mkdir and its pid write leaves an empty
      // directory; a vanished directory means a rival won the race.
      let pids: string[]
      try {
        pids = await readdir(lockDir())
      } catch {
        continue
      }
      if (pids.every((pid) => !Number.isSafeInteger(Number(pid)) || !isLivePid(Number(pid)))) {
        try {
          await rm(lockDir(), { recursive: true, force: true })
        } catch {
          // A rival won the race; fall through to the wait.
        }
        continue
      }
      await new Promise((settle) => setTimeout(settle, LOCK_WAIT_MS))
    }
    throw new Error('Upload ledger is locked')
  }
  const release = async (): Promise<void> => {
    // Never clear a rival's lock: if the occupant is not this process, the
    // lock was stolen mid-hold and its owner releases it.
    try {
      const held = await readFile(occupantFile(), 'utf8')
      const occupant = held.split(' ', 2)[0] ?? ''
      if (occupant !== String(process.pid)) return
    } catch {
      return
    }
    await rm(occupantFile(), { force: true })
    try {
      await rmdir(lockDir())
    } catch {
      // A rival already cleared it; nothing is held either way.
    }
  }
  return {
    async read(): Promise<unknown> {
      try {
        return JSON.parse(await readFile(stateFile(), 'utf8'))
      } catch (error: unknown) {
        if (
          typeof error === 'object' &&
          error !== null &&
          'code' in error &&
          (error as { code: string }).code === 'ENOENT'
        )
          return undefined
        throw error
      }
    },
    async write(state): Promise<void> {
      await mkdir(directory, { recursive: true, mode: OWNER_DIRECTORY_MODE })
      const staging = containedFile(directory, `${LEDGER_FILE}.${String(process.pid)}.tmp`)
      await writeFile(staging, JSON.stringify(state), { mode: OWNER_FILE_MODE })
      await rename(staging, stateFile())
    },
    async withLock<T>(operation: () => Promise<T>): Promise<T> {
      await acquire()
      try {
        return await operation()
      } finally {
        await release()
      }
    },
  }
}

export interface ProductionMediaStore {
  readonly read: () => unknown
  readonly write: (points: readonly CalibrationPoint[]) => Promise<void>
}

/** The estimator's file store: seeds while nothing local settled yet. */
export function fileCalibrationStore(
  directory: string,
  log: Pick<CoreLogger, 'warn'>,
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
      await mkdir(directory, { recursive: true, mode: OWNER_DIRECTORY_MODE })
      const staging = containedFile(directory, `${CALIBRATION_FILE}.${String(process.pid)}.tmp`)
      await writeFile(staging, JSON.stringify(pointsSchema.parse(points)), {
        mode: OWNER_FILE_MODE,
      })
      await rename(staging, containedFile(directory, CALIBRATION_FILE))
    },
  }
}

export interface ProductionMediaDeps {
  readonly sessionId: string
  readonly client: Pick<ModelApiClient, 'requestFile'>
  readonly accountId: string
  readonly currentAccountId: () => Promise<string | undefined>
  readonly directory: string
  readonly log: Pick<CoreLogger, 'warn'>
  readonly attachment: ReplayMediaDeps['attachment']
  readonly source: ReplayMediaDeps['source']
  readonly authorize: ReplayMediaDeps['authorize']
  readonly compactionTail?: ReplayMediaDeps['compactionTail']
  readonly now?: () => number
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
  })
  const ledger = new UploadLedger({
    storage: fileUploadLedgerStorage(deps.directory),
    files,
    accountId: deps.accountId,
    provider: 'meta',
    poolBytes: MEDIA_PROVIDER_POOL_BYTES,
    currentAccountId: deps.currentAccountId,
    now: deps.now ?? (() => Date.now()),
  })
  const store = fileCalibrationStore(deps.directory, deps.log)
  const estimator = new MediaCostEstimator({
    read: store.read,
    write: store.write,
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
    attachment: deps.attachment,
    source: deps.source,
    authorize: deps.authorize,
  })
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
    if (absolute !== root && !absolute.startsWith(`${root}${api.sep}`)) return
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
