// M95/D74: refresh the vendored models.dev provider catalogue. models.dev
// (MIT) publishes one JSON document with every provider's models, their
// per-million prices and their windows; the sync filters it to the M95
// presets' providers and their tool-capable models, checksums the download
// the way scripts/sync-bundled-skills.mjs does, and refuses truncated or
// partial data, as Cline does. Nothing fetches at run time (D4): the panel
// and the price lookup read the snapshot the build copies to
// dist/providerCatalog.json.
//
//   node scripts/sync-provider-catalog.mjs --fetch
//       download, verify the shape and print the SHA-256 to pin, writing
//       nothing (run this first, review, then --sync with the digest)
//   node scripts/sync-provider-catalog.mjs --sync --date YYYY-MM-DD --sha256 <hex>
//       verify the download against the pinned digest and write
//       vendor/models-dev/snapshot.json and VENDOR.json
//   node scripts/sync-provider-catalog.mjs --sync --from <saved-api.json> --date YYYY-MM-DD --sha256 <hex>
//       seal an already captured download without making a network request
//   node scripts/sync-provider-catalog.mjs --check
//       verify the vendor files against VENDOR.json (hashes, shape, size cap)
//   node scripts/sync-provider-catalog.mjs --copy
//       verify the complete manifest, shape and size cap, then copy byte-identical
//       to dist/providerCatalog.json (scripts/build.mjs runs this)
import { Buffer } from 'node:buffer'
import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { z } from 'zod'

export const CATALOG_SOURCE = 'https://models.dev/api.json'
export const CATALOG_UPSTREAM = 'https://github.com/anomalyco/models.dev'
const VENDOR_DIRNAME = 'models-dev'
const SNAPSHOT_FILENAME = 'snapshot.json'
const LICENSE_FILENAME = 'LICENSE'
const MANIFEST_FILENAME = 'VENDOR.json'
export const FETCH_TIMEOUT_MS = 60_000
// The download measured 5,314,706 bytes on 2026-10-04 (m95-research.md
// §2.10); three times that leaves room for growth while a runaway response
// cannot fill the disk before the cap trips.
export const MAX_DOWNLOAD_BYTES = 16 * 1024 * 1024
// The filtered snapshot is a fraction of the download, and the VSIX budget
// (scripts/check-vsix-size.mjs) is 2200 KiB for everything: half a megabyte
// forces the filter narrower before catalogue data can crowd the package out.
export const MAX_SNAPSHOT_BYTES = 512 * 1024
export const SNAPSHOT_VERSION = 1
const HEX_DIGEST = /^[\da-f]{64}$/i

// models.dev's provider id to the preset id the panel and the model
// references (`<providerId>/<modelId>`, D74) use. A wrong id here fails the
// sync loudly with the downloaded id list, and the catalogue test pins this
// table, so lane P's presets.ts and this table cannot drift apart silently.
export const CATALOG_PRESETS = [
  { catalog: 'openai', preset: 'openai' },
  { catalog: 'azure', preset: 'azure' },
  { catalog: 'xai', preset: 'xai' },
  { catalog: 'openrouter', preset: 'openrouter' },
  { catalog: 'groq', preset: 'groq' },
  { catalog: 'deepseek', preset: 'deepseek' },
  { catalog: 'mistral', preset: 'mistral' },
  { catalog: 'togetherai', preset: 'together' },
  { catalog: 'fireworks-ai', preset: 'fireworks' },
  { catalog: 'huggingface', preset: 'huggingface' },
  { catalog: 'zai', preset: 'zai' },
  { catalog: 'anthropic', preset: 'anthropic' },
  { catalog: 'google', preset: 'gemini' },
]

// The model fields the snapshot keeps (m95-research.md §2.10): the identity,
// the capability flags the Models table filters and badges on (`tool_call`
// is always true here; it documents the filter invariant), the modalities the
// vision filter reads, the release date the New badge reads, the per-million
// prices the budgets settle from, and the window and output cap the harness
// sizes requests with. Reasoning/sampling/structured-output metadata stays
// with the row for the capability resolver. Everything else (docs links, key names,
// knowledge cutoffs, weights, status) stays in the download.
const COST_FIELDS = ['input', 'output', 'cache_read', 'cache_write', 'reasoning']
const LIMIT_FIELDS = ['context', 'input', 'output']
const MAX_ID_LENGTH = 256
const MAX_NAME_LENGTH = 256
const MAX_ORIGIN_LENGTH = 512
const MAX_DATE_LENGTH = 64

const digestSchema = z.string().regex(HEX_DIGEST)
const dateSchema = z.iso.date()
const numberSchema = z.number().nonnegative().finite()
const pricesSchema = z
  .object(Object.fromEntries(COST_FIELDS.map((field) => [field, numberSchema.optional()])))
  .catchall(z.json())
const limitsSchema = z.object(
  Object.fromEntries(LIMIT_FIELDS.map((field) => [field, z.number().int().positive().optional()])),
)
const modelSchema = z.object({
  id: z.string().min(1).max(MAX_ID_LENGTH),
  name: z.string().min(1).max(MAX_NAME_LENGTH).optional(),
  tool_call: z.boolean().optional(),
  reasoning: z.boolean().optional(),
  attachment: z.boolean().optional(),
  temperature: z.boolean().optional(),
  top_p: z.boolean().optional(),
  reasoning_options: z.json().optional(),
  structured_output: z.boolean().optional(),
  interleaved: z.json().optional(),
  // Catalogue metadata stays JSON data; the runtime reader owns its interpretation.
  modalities: z.json().optional(),
  release_date: z.string().max(MAX_DATE_LENGTH).optional(),
  cost: pricesSchema.optional(),
  limit: limitsSchema.optional(),
})
const providerSchema = z.object({
  id: z.string().optional(),
  name: z.string().max(MAX_NAME_LENGTH).optional(),
  api: z.string().max(MAX_ORIGIN_LENGTH).optional(),
  models: z.record(z.string().min(1).max(MAX_ID_LENGTH), modelSchema),
})
// The captured image/audio models use zero for inapplicable token limits.
// Retained tool models still require positive limits through modelSchema.
const sourceModelSchema = modelSchema.extend({
  limit: z
    .object(
      Object.fromEntries(
        LIMIT_FIELDS.map((field) => [field, z.number().int().nonnegative().optional()]),
      ),
    )
    .optional(),
})
const apiSchema = z.record(
  z.string(),
  providerSchema.extend({
    models: z.record(z.string().min(1).max(MAX_ID_LENGTH), sourceModelSchema),
  }),
)

function isRecord(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/** Require the pinned hex digest and return it normalised. */
export function assertDownloadChecksum(bytes, expectedSha256) {
  if (typeof expectedSha256 !== 'string' || !HEX_DIGEST.test(expectedSha256)) {
    throw new Error('A 64-character hex SHA-256 is required to verify the catalogue download')
  }
  const expected = expectedSha256.toLowerCase()
  const actual = createHash('sha256').update(bytes).digest('hex')
  if (actual !== expected) {
    throw new Error(`Catalogue SHA-256 mismatch: expected ${expected}, got ${actual}`)
  }
  return actual
}

/** Parse the download, refusing a truncated response or an empty one. */
export function parseCatalogApi(text) {
  let api
  try {
    api = JSON.parse(text)
  } catch {
    throw new Error('Provider catalogue download is not valid JSON (truncated download?)')
  }
  if (!isRecord(api) || Object.keys(api).length === 0) {
    throw new Error('Provider catalogue download is empty or not an object (partial data?)')
  }
  for (const [id, section] of Object.entries(api)) {
    if (!isRecord(section) || !isRecord(section.models)) {
      throw new Error(`Provider catalogue section '${id}' has no models (partial data?)`)
    }
  }
  return apiSchema.parse(api)
}

// The snapshot keys models by the download's key: keys are unique by
// construction, while an entry's own id field is untrusted text.
function filterModel(key, entry) {
  if (!isRecord(entry) || entry.tool_call !== true) return
  entry = modelSchema.parse(entry)
  const model = { id: key, name: entry.name ?? key, tool_call: true }
  for (const field of [
    'reasoning',
    'attachment',
    'temperature',
    'top_p',
    'reasoning_options',
    'structured_output',
    'interleaved',
  ]) {
    if (entry[field] !== undefined) model[field] = entry[field]
  }
  if (entry.modalities !== undefined) model.modalities = entry.modalities
  if (entry.release_date !== undefined) model.release_date = entry.release_date
  if (entry.cost !== undefined && Object.keys(entry.cost).length > 0) model.cost = entry.cost
  if (entry.limit !== undefined && Object.keys(entry.limit).length > 0) model.limit = entry.limit
  return model
}

/**
 * Keep the presets' providers and their tool-capable models, refusing a
 * download that misses a listed provider or keeps none of its models.
 * Returns the snapshot's providers, keyed by preset id.
 */
export function filterCatalog(api) {
  if (!isRecord(api)) throw new Error('Provider catalogue must be an object')
  api = apiSchema.parse(api)
  const available = Object.keys(api)
  const providers = {}
  for (const { catalog, preset } of CATALOG_PRESETS) {
    const section = api[catalog]
    if (!isRecord(section)) {
      throw new Error(
        `Provider catalogue is missing '${catalog}' (partial data; available: ${available.join(', ') || 'none'})`,
      )
    }
    const entries = isRecord(section.models) ? section.models : {}
    const keptModels = []
    for (const [key, entry] of Object.entries(entries)) {
      const kept = filterModel(key, entry)
      if (kept !== undefined) keptModels.push([kept.id, kept])
    }
    const models = Object.fromEntries(keptModels)
    if (Object.keys(models).length === 0) {
      throw new Error(
        `Provider catalogue kept no tool-capable models for '${catalog}' (partial data?)`,
      )
    }
    providers[preset] = {
      catalog,
      name: section.name || catalog,
      ...(section.api !== undefined && { api: section.api }),
      models,
    }
  }
  return providers
}

/** Build a dated snapshot document; an empty fallback is not a catalogue. */
export function snapshotDocument(providers, fetchedAt) {
  dateSchema.parse(fetchedAt)
  return { version: SNAPSHOT_VERSION, source: CATALOG_SOURCE, fetchedAt, providers }
}

/** Refuse a snapshot past the size cap; returns its byte length. */
export function assertSnapshotSize(byteLength) {
  if (!Number.isSafeInteger(byteLength) || byteLength < 0) {
    throw new Error('The catalogue snapshot size must be counted in bytes')
  }
  if (byteLength > MAX_SNAPSHOT_BYTES) {
    throw new Error(
      `Provider catalogue snapshot is ${byteLength} bytes; the cap is ${MAX_SNAPSHOT_BYTES} bytes`,
    )
  }
  return byteLength
}

/** Compact data keeps complete capability metadata inside the unchanged cap. */
export function snapshotText(document) {
  const text = `${JSON.stringify(document)}\n`
  assertSnapshotSize(Buffer.byteLength(text, 'utf8'))
  return text
}

/** Parse a committed or shipped snapshot, refusing version, source or sync-state drift. */
export function parseCatalogSnapshot(text) {
  let document
  try {
    document = JSON.parse(text)
  } catch {
    throw new Error('Provider catalogue snapshot is not valid JSON')
  }
  if (!isRecord(document)) throw new Error('Provider catalogue snapshot must be an object')
  if (document.version !== SNAPSHOT_VERSION) {
    throw new Error(
      `Provider catalogue snapshot version ${String(document.version)}; expected ${SNAPSHOT_VERSION}`,
    )
  }
  if (document.source !== CATALOG_SOURCE) {
    throw new Error('Provider catalogue snapshot has an unexpected source')
  }
  if (!dateSchema.safeParse(document.fetchedAt).success) {
    throw new Error('Provider catalogue snapshot has an unexpected fetch date')
  }
  if (!isRecord(document.providers)) {
    throw new Error('Provider catalogue snapshot must carry a providers object')
  }
  if (Object.keys(document.providers).length === 0) {
    throw new Error('A dated catalogue snapshot must carry providers (partial data?)')
  }
  const expected = CATALOG_PRESETS.map(({ preset }) => preset).toSorted((a, b) =>
    a.localeCompare(b, 'en'),
  )
  if (
    JSON.stringify(Object.keys(document.providers).toSorted((a, b) => a.localeCompare(b, 'en'))) !==
    JSON.stringify(expected)
  ) {
    throw new Error('The catalogue snapshot presets do not match the sync table')
  }
  for (const { catalog, preset } of CATALOG_PRESETS) {
    const provider = document.providers[preset]
    if (!isRecord(provider) || provider.catalog !== catalog) {
      throw new Error(`The catalogue snapshot source for '${preset}' does not match '${catalog}'`)
    }
    const parsed = providerSchema.parse(provider)
    if (Object.keys(parsed.models).length === 0) {
      throw new Error(`The catalogue snapshot has no models for '${preset}' (partial data?)`)
    }
    for (const [key, model] of Object.entries(parsed.models)) {
      if (model.id !== key || model.tool_call !== true) {
        throw new Error(
          `The catalogue snapshot model '${key}' is not a tool-capable model with a matching id`,
        )
      }
    }
  }
  return document
}

const WORKTREE_ROOT = path.resolve(import.meta.dirname, '..')
const DEFAULT_VENDOR_DIR = path.join(WORKTREE_ROOT, 'vendor', VENDOR_DIRNAME)
const DEFAULT_DIST_FILE = path.join(WORKTREE_ROOT, 'dist', 'providerCatalog.json')

function vendorPaths(vendorDir = DEFAULT_VENDOR_DIR) {
  return {
    dir: vendorDir,
    snapshot: path.join(vendorDir, SNAPSHOT_FILENAME),
    license: path.join(vendorDir, LICENSE_FILENAME),
    manifest: path.join(vendorDir, MANIFEST_FILENAME),
  }
}

function sha256File(file) {
  return createHash('sha256').update(readFileSync(file)).digest('hex')
}

function presentFiles(directory, prefix = '') {
  return readdirSync(directory, { withFileTypes: true })
    .flatMap((entry) => {
      const relative = `${prefix}${entry.name}`
      return entry.isDirectory()
        ? presentFiles(path.join(directory, entry.name), `${relative}/`)
        : [relative]
    })
    .map((file) => file.split(path.sep).join('/'))
    .toSorted((a, b) => a.localeCompare(b, 'en'))
}

/** Parse VENDOR.json, refusing a missing file or a malformed manifest. */
function readVendorManifest(paths) {
  let manifest
  try {
    manifest = JSON.parse(readFileSync(paths.manifest, 'utf8'))
  } catch {
    throw new Error(
      'The catalogue manifest is missing or invalid: run "node scripts/sync-provider-catalog.mjs --sync"',
    )
  }
  if (!isRecord(manifest)) throw new Error('The catalogue manifest must be an object')
  if (manifest.source !== CATALOG_SOURCE) {
    throw new Error('The catalogue manifest has an unexpected source')
  }
  if (manifest.upstream !== CATALOG_UPSTREAM) {
    throw new Error('The catalogue manifest has an unexpected upstream')
  }
  if (!dateSchema.safeParse(manifest.fetchedAt).success) {
    throw new Error('The catalogue manifest has an unexpected fetch date')
  }
  if (!digestSchema.safeParse(manifest.downloadSha256).success) {
    throw new Error('The catalogue manifest has an unexpected download digest')
  }
  if (
    !Array.isArray(manifest.providers) ||
    manifest.providers.some((id) => typeof id !== 'string')
  ) {
    throw new Error('The catalogue manifest must list provider ids')
  }
  if (
    !Array.isArray(manifest.files) ||
    manifest.files.length === 0 ||
    manifest.files.some(
      (file) =>
        !isRecord(file) ||
        typeof file.path !== 'string' ||
        typeof file.sha256 !== 'string' ||
        !HEX_DIGEST.test(file.sha256),
    )
  ) {
    throw new Error('The catalogue manifest must list files with SHA-256 digests')
  }
  const listed = manifest.files
    .map((file) => file.path)
    .toSorted((a, b) => a.localeCompare(b, 'en'))
  if (
    JSON.stringify(listed) !==
    JSON.stringify(
      [LICENSE_FILENAME, SNAPSHOT_FILENAME].toSorted((a, b) => a.localeCompare(b, 'en')),
    )
  ) {
    throw new Error('The catalogue manifest must list exactly LICENSE and snapshot.json')
  }
  const providers = CATALOG_PRESETS.map(({ catalog }) => catalog).toSorted((a, b) =>
    a.localeCompare(b, 'en'),
  )
  if (
    JSON.stringify(manifest.providers.toSorted((a, b) => a.localeCompare(b, 'en'))) !==
    JSON.stringify(providers)
  ) {
    throw new Error('The catalogue manifest providers do not match the sync table')
  }
  return manifest
}

/**
 * Verify the vendor directory against VENDOR.json: exactly the listed files,
 * every digest matching, the licence present, and the snapshot's shape, size
 * cap and manifest agreement. Returns the sealed file and snapshot sizes.
 */
export function verifyVendorFiles(vendorDir = DEFAULT_VENDOR_DIR) {
  const paths = vendorPaths(vendorDir)
  const manifest = readVendorManifest(paths)
  const present = presentFiles(paths.dir).filter((file) => file !== MANIFEST_FILENAME)
  const listed = manifest.files
    .map((file) => file.path)
    .toSorted((a, b) => a.localeCompare(b, 'en'))
  for (const file of listed) {
    if (!present.includes(file)) {
      throw new Error(`The catalogue manifest lists '${file}', which is not vendored`)
    }
  }
  for (const file of present) {
    if (!listed.includes(file)) {
      throw new Error(`Vendored catalogue file '${file}' is not in the manifest`)
    }
  }
  const contents = new Map()
  for (const { path: relative, sha256 } of manifest.files) {
    const bytes = readFileSync(path.join(paths.dir, relative))
    if (createHash('sha256').update(bytes).digest('hex') !== sha256.toLowerCase()) {
      throw new Error(`Catalogue SHA-256 mismatch for vendored '${relative}'`)
    }
    contents.set(relative, bytes)
  }
  const licenseBytes = contents.get(LICENSE_FILENAME)
  const snapshotBytes = contents.get(SNAPSHOT_FILENAME)
  if (licenseBytes === undefined || snapshotBytes === undefined) {
    throw new Error('The catalogue manifest must include LICENSE and snapshot.json')
  }
  if (!licenseBytes.toString('utf8').includes('models.dev')) {
    throw new Error('The vendored catalogue licence does not name models.dev')
  }
  assertSnapshotSize(snapshotBytes.length)
  const document = parseCatalogSnapshot(snapshotBytes.toString('utf8'))
  if (manifest.fetchedAt !== document.fetchedAt) {
    throw new Error('The catalogue manifest date does not match the snapshot')
  }
  {
    const snapshotCatalogs = Object.values(document.providers)
      .map((provider) => provider.catalog)
      .toSorted((a, b) => a.localeCompare(b, 'en'))
    const manifestCatalogs = [...manifest.providers].toSorted((a, b) => a.localeCompare(b, 'en'))
    if (JSON.stringify(snapshotCatalogs) !== JSON.stringify(manifestCatalogs)) {
      throw new Error('The catalogue manifest providers do not match the snapshot')
    }
    const snapshotPresets = Object.keys(document.providers).toSorted((a, b) =>
      a.localeCompare(b, 'en'),
    )
    const expectedPresets = CATALOG_PRESETS.map(({ preset }) => preset).toSorted((a, b) =>
      a.localeCompare(b, 'en'),
    )
    if (JSON.stringify(snapshotPresets) !== JSON.stringify(expectedPresets)) {
      throw new Error('The catalogue snapshot presets do not match the sync table')
    }
  }
  return { files: manifest.files.length, bytes: snapshotBytes.length, snapshotBytes }
}

/** Write VENDOR.json for the current vendor files, returning the manifest. */
export function writeVendorManifest(vendorDir, { downloadSha256, fetchedAt, providers }) {
  const paths = vendorPaths(vendorDir)
  digestSchema.parse(downloadSha256)
  dateSchema.parse(fetchedAt)
  const manifest = {
    source: CATALOG_SOURCE,
    upstream: CATALOG_UPSTREAM,
    fetchedAt,
    downloadSha256,
    providers: [...providers].toSorted((a, b) => a.localeCompare(b, 'en')),
    files: [SNAPSHOT_FILENAME, LICENSE_FILENAME]
      .map((relative) => ({
        path: relative,
        sha256: sha256File(path.join(paths.dir, relative)),
      }))
      .toSorted((a, b) => a.path.localeCompare(b.path, 'en')),
  }
  writeFileSync(paths.manifest, `${JSON.stringify(manifest, null, 2)}\n`)
  return manifest
}

// The build copies the reviewed vendor snapshot as data, never code: shape
// and size cap checked on every build, byte-identical to the sealed file.
export function copyCatalogToDist(vendorDir = DEFAULT_VENDOR_DIR, outFile = DEFAULT_DIST_FILE) {
  const paths = vendorPaths(vendorDir)
  if (!existsSync(paths.snapshot)) {
    throw new Error(
      'The catalogue snapshot is missing: run "node scripts/sync-provider-catalog.mjs --sync" to fetch it',
    )
  }
  const { snapshotBytes: bytes } = verifyVendorFiles(vendorDir)
  assertSnapshotSize(bytes.length)
  parseCatalogSnapshot(bytes.toString('utf8'))
  mkdirSync(path.dirname(outFile), { recursive: true })
  writeFileSync(outFile, bytes)
  return bytes.length
}

/** Validate every input before replacing the reviewed snapshot or its manifest. */
export function syncCatalog(bytes, expectedSha256, date, vendorDir = DEFAULT_VENDOR_DIR) {
  const digest = assertDownloadChecksum(bytes, expectedSha256)
  const providers = filterCatalog(parseCatalogApi(Buffer.from(bytes).toString('utf8')))
  const text = snapshotText(snapshotDocument(providers, date))
  parseCatalogSnapshot(text)
  const paths = vendorPaths(vendorDir)
  // Read the required licence before touching either existing catalogue file.
  const license = readFileSync(paths.license, 'utf8')
  if (!license.includes('MIT License') || !license.includes('Copyright (c) 2025 models.dev')) {
    throw new Error('The vendored catalogue requires the upstream models.dev MIT licence')
  }
  writeFileSync(paths.snapshot, text)
  writeVendorManifest(paths.dir, {
    downloadSha256: digest,
    fetchedAt: date,
    providers: CATALOG_PRESETS.map(({ catalog }) => catalog),
  })
  return verifyVendorFiles(vendorDir)
}

export async function download(fetcher = fetch) {
  let response
  try {
    response = await fetcher(CATALOG_SOURCE, {
      redirect: 'error',
      signal: globalThis.AbortSignal.timeout(FETCH_TIMEOUT_MS),
    })
  } catch (error) {
    throw new Error(`Could not download ${CATALOG_SOURCE}`, { cause: error })
  }
  if (!response.ok) throw new Error(`HTTP ${response.status} downloading ${CATALOG_SOURCE}`)
  const announced = Number(response.headers.get('content-length'))
  if (Number.isFinite(announced) && announced > MAX_DOWNLOAD_BYTES) {
    throw new Error(
      `Catalogue download announces ${announced} bytes; the cap is ${MAX_DOWNLOAD_BYTES} bytes`,
    )
  }
  if (response.body === null) throw new Error('Catalogue download has no body')
  const chunks = []
  let size = 0
  const reader = response.body.getReader()
  try {
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      size += value.byteLength
      if (size > MAX_DOWNLOAD_BYTES) {
        throw new Error(`Catalogue download exceeds ${MAX_DOWNLOAD_BYTES} bytes`)
      }
      chunks.push(value)
    }
  } finally {
    await reader.cancel()
    reader.releaseLock()
  }
  // Fetch decodes compressed bodies; Content-Length counts their encoded bytes.
  if (size !== announced && announced > 0 && response.headers.get('content-encoding') === null) {
    throw new Error('Catalogue download is truncated')
  }
  return Buffer.concat(chunks, size)
}

function flagValue(args, flag) {
  const index = args.indexOf(flag)
  if (index === -1 || index + 1 >= args.length) {
    throw new Error(`"${flag}" needs a value`)
  }
  return args[index + 1]
}

const USAGE =
  'Usage: node scripts/sync-provider-catalog.mjs --fetch | --sync [--from <saved-api.json>] --date YYYY-MM-DD --sha256 <hex> | --check | --copy'

export async function run(argv, vendorDir = DEFAULT_VENDOR_DIR) {
  const [command, ...rest] = argv
  if (command === '--fetch' && rest.length === 0) {
    const bytes = await download()
    const providers = filterCatalog(parseCatalogApi(bytes.toString('utf8')))
    const digest = createHash('sha256').update(bytes).digest('hex')
    console.log(`${CATALOG_SOURCE}: ${bytes.length} bytes, SHA-256 ${digest}`)
    for (const [preset, provider] of Object.entries(providers)) {
      console.log(
        `  ${provider.catalog} (${preset}): ${Object.keys(provider.models).length} models`,
      )
    }
    console.log('wrote nothing: re-run with --sync --date YYYY-MM-DD --sha256 <hex> to seal it')
    return
  }
  if (command === '--sync' && (rest.length === 4 || rest.length === 6)) {
    const from = rest.includes('--from') ? flagValue(rest, '--from') : undefined
    if (rest.length !== (from === undefined ? 4 : 6)) throw new Error(USAGE)
    const date = flagValue(rest, '--date')
    const expected = flagValue(rest, '--sha256')
    dateSchema.parse(date)
    digestSchema.parse(expected)
    const bytes = from === undefined ? await download() : readFileSync(from)
    const result = syncCatalog(bytes, expected, date, vendorDir)
    console.log(
      `${VENDOR_DIRNAME} ${date}: ${result.bytes} snapshot bytes (${expected.toLowerCase()})`,
    )
    return
  }
  if (command === '--check' && rest.length === 0) {
    const { files, bytes } = verifyVendorFiles()
    console.log(`ok   ${VENDOR_DIRNAME}: ${files} files sealed, snapshot ${bytes} bytes`)
    return
  }
  if (command === '--copy' && rest.length === 0) {
    console.log(`${DEFAULT_DIST_FILE}: ${copyCatalogToDist()} bytes`)
    return
  }
  throw new Error(USAGE)
}

if (
  process.argv[1] !== undefined &&
  import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href
) {
  try {
    await run(process.argv.slice(2))
  } catch (error) {
    console.error(error.message)
    process.exitCode = 1
  }
}
