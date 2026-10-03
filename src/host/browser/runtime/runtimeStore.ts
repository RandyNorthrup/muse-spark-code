// The browser check's runtime store (M81 A1, design spec v4 §§4.1–4.4), in
// the runtime bundle (dist/browserRuntime.js): the pinned headless shell
// found, or asked for, downloaded, verified, extracted and published under
// `<globalStorage>/browser-runtime/<version>/<platform>/`, all inside the
// preparation's own lifetime and its stage bounds (consent 2 minutes, the
// transfer 10, the verification and publication 3).
//
// - Installed: the receipt inside the published folder, bound to the pin's
//   platform record, and the executable's canonical path, length and mtime;
//   any change hashes the executable again against the pin, and a mismatch
//   refuses. Published folders are never changed, merged or removed here.
// - Not installed: the host's consent (Download, or nothing); a unique
//   private sibling stage of its own; the exact pinned URL fetched through
//   the extension's network posture (VS Code's fetch), with at most three
//   redirects that stay on the pinned storage origin and path, counted
//   against the pinned length (1% slack at most), hashed, and checked before
//   anything is read from it; the bounded ZIP reader; the executable's
//   length and hash; a receipt written last; then one rename of the stage's
//   folder to the final one, which is never created first. When another
//   window published first, that winner is verified like any installed
//   runtime and used only if it passes.
// - Every step is refused once the lifetime has ended or admission is gone;
//   a late answer, download or verification starts nothing. An attempt
//   removes only its own stage; a stage another process left is swept only
//   once its owner is known to be gone.
//
// Failures are the closed preparation reasons only: no response text,
// certificate, header, path or OS message leaves this module.

import { createHash, type Hash, randomBytes } from 'node:crypto'
import { createReadStream, type Stats } from 'node:fs'
import {
  type FileHandle,
  lstat,
  mkdir,
  open,
  readdir,
  readFile,
  realpath,
  rename,
  rm,
  writeFile,
} from 'node:fs/promises'
import path from 'node:path'
import { pipeline } from 'node:stream/promises'
import * as z from 'zod/mini'
import type {
  PreparationReason,
  RuntimePlatform,
  RuntimePreparation,
  RuntimePrepareRequest,
  VerifiedRuntime,
} from '../../../core/browser/runtimeTypes'
import {
  isPinFresh,
  type PlatformRecord,
  parseRuntimeManifest,
  type RuntimeManifest,
  runtimePlatform,
} from '../../../core/browser/runtime/runtimeManifest'
import {
  BROWSER_RUNTIME_ARCHIVE_PART,
  BROWSER_RUNTIME_CONSENT_MS,
  BROWSER_RUNTIME_DIR,
  BROWSER_RUNTIME_MAX_REDIRECTS,
  BROWSER_RUNTIME_RECEIPT,
  BROWSER_RUNTIME_STAGE_PREFIX,
  BROWSER_RUNTIME_STAGE_RANDOM_BYTES,
  BROWSER_RUNTIME_TRANSFER_MS,
  BROWSER_RUNTIME_TRANSFER_SLACK,
  BROWSER_RUNTIME_UNPACK_DIR,
  BROWSER_RUNTIME_VERIFY_MS,
} from '../../../shared/browserCheckConstants'
import { extractZipEntries, readZipEntries, ZipRefused } from './zipExtract'

/** What the store reaches the world through (tests replace it). */
export interface RuntimeStoreDeps {
  readonly platform: NodeJS.Platform
  readonly arch: NodeJS.Architecture
  readonly now: () => number
  /** The extension's network posture: VS Code's own fetch at each call. */
  readonly fetch: (url: string, init: RequestInit) => Promise<Response>
  /** The pin this release ships (browserRuntime.json). */
  readonly manifest: unknown
}

/** A preparation that ends here, with its closed reason. */
class Stop extends Error {
  public constructor(public readonly reason: PreparationReason) {
    super(reason)
    this.name = 'Stop'
  }
}

const receiptSchema = z.strictObject({
  schemaVersion: z.literal(1),
  version: z.string(),
  platform: z.string(),
  archiveSha256: z.string(),
  executable: z.string(),
  executableSha256: z.string(),
  executableBytes: z.number(),
  executableMtimeMs: z.number(),
})
type Receipt = z.infer<typeof receiptSchema>

const PRIVATE_DIR_MODE = 0o700
const PRIVATE_FILE_MODE = 0o600
const OWNER_FILE = 'owner'
const STAGE_SWEEP_MAX = 8
// The redirect answers followed (each checked before it is).
const REDIRECT_STATUS = { moved: 301, found: 302, seeOther: 303, temporary: 307, permanent: 308 }
const REDIRECTS: ReadonlySet<number> = new Set(Object.values(REDIRECT_STATUS))
const STATUS_OK = 200
const EXISTS_CODES: ReadonlySet<string> = new Set(['EEXIST', 'ENOTEMPTY', 'EPERM', 'EACCES'])

/** Runs `work`; its failure leaves only this attempt's own stage behind. */
async function quietly(work: () => Promise<unknown>): Promise<void> {
  try {
    await work()
  } catch {
    // Nothing further: the next attempt or sweep sees what is left.
  }
}

/** A file's lstat, or undefined when it cannot be read. */
async function lstatOrNone(file: string): Promise<Stats | undefined> {
  try {
    return await lstat(file)
  } catch {
    return undefined
  }
}

/** A file's text, or '' when it cannot be read. */
async function textOrNone(file: string): Promise<string> {
  try {
    return await readFile(file, 'utf8')
  } catch {
    return ''
  }
}

function codeOf(error: unknown): string {
  return typeof error === 'object' && error !== null && 'code' in error ? String(error.code) : ''
}

async function sha256File(file: string, signal: AbortSignal): Promise<string> {
  const hash = createHash('sha256')
  await pipeline(createReadStream(file), hash, { signal })
  return hash.digest('hex')
}

/** The executable's path inside a runtime folder. */
function executablePath(folder: string, record: PlatformRecord): string {
  return path.join(folder, ...record.executable.split('/'))
}

/**
 * A published (or winning) runtime, verified against the pin: 'absent' when
 * there is none, the runtime when it passes, a Stop otherwise. `isHashed`
 * hashes the executable even when its metadata matches the receipt.
 */
async function verifyPublished(
  folder: string,
  pin: {
    readonly manifest: RuntimeManifest
    readonly platform: RuntimePlatform
    readonly record: PlatformRecord
    readonly digest: string
  },
  signal: AbortSignal,
  isHashed: boolean,
): Promise<VerifiedRuntime | 'absent'> {
  try {
    const info = await lstat(folder)
    if (!info.isDirectory() || info.isSymbolicLink()) {
      throw new Stop('runtimeIntegrity')
    }
  } catch (error: unknown) {
    if (codeOf(error) === 'ENOENT') {
      return 'absent'
    }
    throw error instanceof Stop ? error : new Stop('runtimeIntegrity')
  }
  const { record } = pin
  let receipt: Receipt
  try {
    const parsed = receiptSchema.safeParse(
      JSON.parse(await readFile(path.join(folder, BROWSER_RUNTIME_RECEIPT), 'utf8')),
    )
    if (!parsed.success) {
      throw new Stop('runtimeIntegrity')
    }
    receipt = parsed.data
  } catch {
    throw new Stop('runtimeIntegrity')
  }
  const executable = executablePath(folder, record)
  const info = await lstatOrNone(executable)
  const isPinned =
    receipt.version === pin.manifest.version &&
    receipt.platform === pin.platform &&
    receipt.archiveSha256 === record.archiveSha256 &&
    receipt.executable === record.executable &&
    receipt.executableSha256 === record.executableSha256 &&
    receipt.executableBytes === record.executableBytes &&
    info !== undefined &&
    info.isFile() &&
    !info.isSymbolicLink() &&
    info.size === record.executableBytes &&
    (await realpath(executable)) === executablePath(await realpath(folder), record)
  if (!isPinned) {
    throw new Stop('runtimeIntegrity')
  }
  // The receipt's metadata unchanged: no hash. Any change: the content decides.
  if (
    (isHashed || info.mtimeMs !== receipt.executableMtimeMs) &&
    (await sha256File(executable, signal)) !== record.executableSha256
  ) {
    throw new Stop('runtimeIntegrity')
  }
  return {
    version: pin.manifest.version,
    platform: pin.platform,
    executable: await realpath(executable),
    manifestDigest: pin.digest,
    executableDigest: record.executableSha256,
    executableBytes: info.size,
    executableMtimeMs: info.mtimeMs,
    publishedAtMs: pin.manifest.publication.publishedAtMs,
  }
}

/**
 * `run` within `ms` and the lifetime: its own signal ends at whichever comes
 * first. `onTimeout` names the reason when the stage's own bound passes.
 */
async function within<T>(
  request: RuntimePrepareRequest,
  ms: number,
  onTimeout: PreparationReason,
  run: (signal: AbortSignal) => Promise<T>,
): Promise<T> {
  const controller = new AbortController()
  const timer = setTimeout(() => {
    controller.abort(new Stop(onTimeout))
  }, ms)
  const signal = AbortSignal.any([controller.signal, request.lifetime.signal])
  try {
    return await request.lifetime.step(async () => await run(signal))
  } catch (error: unknown) {
    if (controller.signal.aborted && !request.lifetime.signal.aborted) {
      throw new Stop(onTimeout)
    }
    throw error
  } finally {
    clearTimeout(timer)
  }
}

/** The pinned archive, streamed to `file`: the exact URL, bounded redirects, counted and hashed. */
async function download(
  deps: RuntimeStoreDeps,
  manifest: RuntimeManifest,
  record: PlatformRecord,
  file: string,
  signal: AbortSignal,
): Promise<void> {
  let current = new URL(record.url)
  let response: Response
  for (let redirects = 0; ; redirects += 1) {
    try {
      response = await deps.fetch(current.href, {
        redirect: 'manual',
        signal,
        headers: { 'Accept-Encoding': 'identity' },
      })
    } catch {
      throw new Stop(signal.aborted ? 'cancelled' : 'runtimeMissing')
    }
    if (!REDIRECTS.has(response.status)) {
      break
    }
    await quietly(async () => await response.body?.cancel())
    const location = response.headers.get('location')
    const next = location === null ? undefined : new URL(location, current)
    if (
      redirects >= BROWSER_RUNTIME_MAX_REDIRECTS ||
      next?.protocol !== 'https:' ||
      next.origin !== manifest.storage.origin ||
      !next.pathname.startsWith(manifest.storage.pathPrefix) ||
      next.username !== '' ||
      next.password !== ''
    ) {
      throw new Stop('runtimeMissing')
    }
    current = next
  }
  const declared = response.headers.get('content-length')
  if (response.status !== STATUS_OK || response.body === null) {
    throw new Stop('runtimeMissing')
  }
  if (declared !== null && Number(declared) !== record.archiveBytes) {
    throw new Stop('runtimeIntegrity')
  }
  const hash = createHash('sha256')
  const output = await open(file, 'wx', PRIVATE_FILE_MODE)
  let count: number
  try {
    count = await streamCapped(response.body, record, hash, output)
  } catch (error: unknown) {
    if (error instanceof Stop) {
      throw error
    }
    throw new Stop(signal.aborted ? 'cancelled' : 'runtimeMissing')
  } finally {
    await output.close()
  }
  if (count !== record.archiveBytes || hash.digest('hex') !== record.archiveSha256) {
    throw new Stop('runtimeIntegrity')
  }
}

/** The body written to `output` and hashed, refused past the pinned length plus its slack; the bytes read. */
async function streamCapped(
  body: ReadableStream<Uint8Array>,
  record: PlatformRecord,
  hash: Hash,
  output: FileHandle,
): Promise<number> {
  const cap = Math.ceil(record.archiveBytes * BROWSER_RUNTIME_TRANSFER_SLACK)
  const reader = body.getReader()
  let count = 0
  for (;;) {
    const { done, value } = await reader.read()
    if (done) {
      return count
    }
    count += value.length
    if (count > cap) {
      await quietly(async () => {
        await reader.cancel()
      })
      throw new Stop('runtimeIntegrity')
    }
    hash.update(value)
    await output.write(value)
  }
}

/** Stages this window's processes left that no live process owns: removed, a few at a time. */
async function sweepStages(root: string): Promise<void> {
  let names: readonly string[]
  try {
    names = await readdir(root)
  } catch {
    return
  }
  const stages = names
    .filter((entry) => entry.startsWith(BROWSER_RUNTIME_STAGE_PREFIX))
    .slice(0, STAGE_SWEEP_MAX)
  for (const name of stages) {
    const stage = path.join(root, name)
    const owner = Number(await textOrNone(path.join(stage, OWNER_FILE)))
    if (!Number.isSafeInteger(owner) || owner <= 0 || owner === process.pid) {
      continue
    }
    try {
      process.kill(owner, 0)
    } catch (error: unknown) {
      if (codeOf(error) === 'ESRCH') {
        await quietly(async () => {
          await rm(stage, { recursive: true, force: true })
        })
      }
    }
  }
}

/** Downloads, verifies, extracts and publishes the pinned runtime; the verified result. */
async function install(
  request: RuntimePrepareRequest,
  deps: RuntimeStoreDeps,
  pin: Parameters<typeof verifyPublished>[1],
  root: string,
  final: string,
): Promise<VerifiedRuntime> {
  const { manifest, platform, record } = pin
  const versionDir = path.join(root, manifest.version)
  await mkdir(versionDir, { recursive: true, mode: PRIVATE_DIR_MODE })
  await sweepStages(root)
  const stage = path.join(
    root,
    `${BROWSER_RUNTIME_STAGE_PREFIX}${manifest.version}-${platform}-${randomBytes(BROWSER_RUNTIME_STAGE_RANDOM_BYTES).toString('hex')}`,
  )
  await mkdir(stage, { mode: PRIVATE_DIR_MODE })
  // This attempt's own stage, and nothing else, goes when the attempt ends;
  // the lifetime's cleanup is the backstop for a step that ended early.
  const removeStage = async (): Promise<void> => {
    await quietly(async () => {
      await rm(stage, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 })
    })
  }
  request.lifetime.onEnd(removeStage)
  try {
    await writeFile(path.join(stage, OWNER_FILE), String(process.pid), {
      flag: 'wx',
      mode: PRIVATE_FILE_MODE,
    })
    const archive = path.join(stage, BROWSER_RUNTIME_ARCHIVE_PART)
    const unpack = path.join(stage, BROWSER_RUNTIME_UNPACK_DIR)
    await within(request, BROWSER_RUNTIME_TRANSFER_MS, 'preparationTimedOut', async (signal) => {
      await download(deps, manifest, record, archive, signal)
    })
    admitted(request)
    return await within(
      request,
      BROWSER_RUNTIME_VERIFY_MS,
      'preparationTimedOut',
      async (signal) => {
        const plan = {
          entryCount: record.entryCount,
          extractedBytes: record.extractedBytes,
          executableEntries: new Set(record.executableEntries),
        }
        const handle = await open(archive, 'r')
        let entries
        try {
          entries = await readZipEntries(handle, record.archiveBytes, plan)
        } finally {
          await handle.close()
        }
        await mkdir(unpack, { mode: PRIVATE_DIR_MODE })
        await extractZipEntries(archive, entries, unpack, plan, signal)
        const executable = executablePath(unpack, record)
        const info = await lstat(executable)
        if (
          !info.isFile() ||
          info.size !== record.executableBytes ||
          (await sha256File(executable, signal)) !== record.executableSha256
        ) {
          throw new Stop('runtimeIntegrity')
        }
        const receipt: Receipt = {
          schemaVersion: 1,
          version: manifest.version,
          platform,
          archiveSha256: record.archiveSha256,
          executable: record.executable,
          executableSha256: record.executableSha256,
          executableBytes: info.size,
          executableMtimeMs: info.mtimeMs,
        }
        const receiptFile = await open(
          path.join(unpack, BROWSER_RUNTIME_RECEIPT),
          'wx',
          PRIVATE_FILE_MODE,
        )
        try {
          await receiptFile.writeFile(JSON.stringify(receipt))
          await receiptFile.sync()
        } finally {
          await receiptFile.close()
        }
        admitted(request)
        try {
          await rename(unpack, final)
        } catch (error: unknown) {
          // Another window published first: its folder counts only if it verifies.
          if (!EXISTS_CODES.has(codeOf(error))) {
            throw new Stop('runtimeMissing')
          }
          const winner = await verifyPublished(final, pin, signal, true)
          if (winner === 'absent') {
            throw new Stop('runtimeMissing')
          }
          return winner
        }
        const published = await verifyPublished(final, pin, signal, false)
        if (published === 'absent') {
          throw new Stop('runtimeIntegrity')
        }
        return published
      },
    )
  } finally {
    await removeStage()
  }
}

/** Refuses once the lifetime has ended or admission (trust, mode, posture, setting, scope) is gone. */
function admitted(request: RuntimePrepareRequest): void {
  if (request.lifetime.signal.aborted) {
    throw new Stop('cancelled')
  }
  if (!request.admissionStillValid()) {
    throw new Stop('notOffered')
  }
}

/** The verified runtime for this machine, or the closed reason there is none. */
export async function prepareRuntime(
  request: RuntimePrepareRequest,
  deps: RuntimeStoreDeps,
): Promise<RuntimePreparation> {
  try {
    admitted(request)
    const manifest = parseRuntimeManifest(deps.manifest)
    if (manifest === undefined) {
      return { ok: false, reason: 'runtimeIntegrity' }
    }
    const platform = runtimePlatform(deps.platform, deps.arch)
    if (platform === undefined) {
      return { ok: false, reason: 'runtimeUnsupported' }
    }
    if (!isPinFresh(manifest.publication.publishedAtMs, deps.now())) {
      return { ok: false, reason: 'runtimeOutdated' }
    }
    const record = manifest.platforms[platform]
    const digest = createHash('sha256').update(JSON.stringify(manifest)).digest('hex')
    const pin = { manifest, platform, record, digest }
    const root = path.join(request.storageDir, BROWSER_RUNTIME_DIR)
    const final = path.join(root, manifest.version, platform)
    const installed = await within(
      request,
      BROWSER_RUNTIME_VERIFY_MS,
      'preparationTimedOut',
      async (signal) => await verifyPublished(final, pin, signal, false),
    )
    admitted(request)
    if (installed !== 'absent') {
      return { ok: true, runtime: installed }
    }
    const answer = await within(
      request,
      BROWSER_RUNTIME_CONSENT_MS,
      'runtimeDeclined',
      async (signal) => await request.consent(manifest.version, record.archiveBytes, signal),
    )
    admitted(request)
    if (answer !== 'download') {
      return { ok: false, reason: 'runtimeDeclined' }
    }
    const runtime = await install(request, deps, pin, root, final)
    // Published even if the preparation ended meanwhile; nothing is launched then.
    admitted(request)
    return { ok: true, runtime }
  } catch (error: unknown) {
    if (error instanceof Stop) {
      return { ok: false, reason: error.reason }
    }
    const end: unknown = request.lifetime.signal.reason
    if (request.lifetime.signal.aborted) {
      const isDeadline =
        typeof end === 'object' && end !== null && 'end' in end && end.end === 'deadline'
      return { ok: false, reason: isDeadline ? 'preparationTimedOut' : 'cancelled' }
    }
    if (!request.admissionStillValid()) {
      return { ok: false, reason: 'notOffered' }
    }
    // A refused archive is an integrity failure; any other filesystem error leaves it not installed.
    return {
      ok: false,
      reason: error instanceof ZipRefused ? 'runtimeIntegrity' : 'runtimeMissing',
    }
  }
}
