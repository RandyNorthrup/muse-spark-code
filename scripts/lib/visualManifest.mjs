import { z } from 'zod'
import { ARCHIVE_BUDGET, digest, PIXEL_POLICY } from './visualImages.mjs'

const hash = z.string().regex(/^[\da-f]{64}$/)
const policySchema = z
  .object({
    threshold: z.literal(PIXEL_POLICY.threshold),
    includeAA: z.literal(PIXEL_POLICY.includeAA),
    maxChangedPixelRatio: z.literal(PIXEL_POLICY.maxChangedPixelRatio),
    maxChangedPixels: z.literal(PIXEL_POLICY.maxChangedPixels),
  })
  .strict()
const captureSchema = z
  .object({
    surface: z.enum(['panel', 'tasks', 'whats-new']),
    scene: z.string().regex(/^[\w-]+$/),
    state: z.string(),
    theme: z.string(),
    width: z.number().int().positive(),
    height: z.number().int().positive(),
    file: z.string(),
    sha256: hash,
    bytes: z.number().int().positive(),
    components: z.array(z.string()),
    target: z.string().nullable(),
    applied: z.boolean(),
  })
  .strict()
const manifestSchema = z
  .object({
    version: z.literal(1),
    revision: z.string().regex(/^[\da-f]{40}$/),
    review: z.string().trim().min(1),
    browser: z.string().regex(/^\d+\.\d+\.\d+\.\d+$/),
    rasterization: hash,
    platform: z.string(),
    archive: z.string().min(1),
    totalBytes: z.number().int().positive(),
    environment: z
      .object({
        locale: z.literal('en'),
        timezone: z.literal('UTC'),
        deviceScaleFactor: z.literal(1),
        reducedMotion: z.literal(true),
        animations: z.literal('disabled'),
        network: z.literal('loopback-only'),
      })
      .strict(),
    policy: policySchema,
    captures: z.array(captureSchema),
  })
  .strict()

export const ENVIRONMENT = Object.freeze({
  locale: 'en',
  timezone: 'UTC',
  deviceScaleFactor: 1,
  reducedMotion: true,
  animations: 'disabled',
  network: 'loopback-only',
})
export function surfaceForScene(scene) {
  if (scene.startsWith('tasks-tab')) return 'tasks'
  return scene.startsWith('whats-new') ? 'whats-new' : 'panel'
}
export const captureKey = (capture) =>
  `${capture.surface ?? surfaceForScene(capture.scene)}/${capture.scene}/${capture.state}/${capture.theme}/${capture.width}`

export const captureGroup = (capture) => `${capture.scene}/${capture.theme}/${capture.width}`

/** Keep every state of a scene together; the reviewed manifest fixes the order. */
export function selectVisualShard(manifest, shard) {
  if (shard === undefined) return manifest.captures
  const groups = [...new Set(manifest.captures.map((capture) => captureGroup(capture)))]
  const { index, count } = z
    .object({ index: z.number().int().positive(), count: z.number().int().positive() })
    .strict()
    .parse(shard)
  if (index > count || count > groups.length) throw new Error('Invalid visual shard range')
  const selected = new Set(
    groups.slice(
      Math.floor(((index - 1) * groups.length) / count),
      Math.floor((index * groups.length) / count),
    ),
  )
  return manifest.captures.filter((capture) => selected.has(captureGroup(capture)))
}

export const selectionDigest = (captures) =>
  digest(
    JSON.stringify(
      captures.map((capture) => captureKey(capture)).toSorted((a, b) => a.localeCompare(b)),
    ),
  )

export function mergeVisualResults(values, manifest, manifestSha256, candidateSha256) {
  const receiptSchema = z
    .object({
      revision: z.literal(manifest.revision),
      manifestSha256: z.literal(manifestSha256),
      candidateSha256: z.literal(candidateSha256),
      shard: z
        .object({ index: z.number().int().positive(), count: z.number().int().positive() })
        .strict(),
      selectionSha256: hash,
      checked: z.number().int().positive(),
      changedPixels: z.number().int().nonnegative(),
      maxImageChangedPixels: z.number().int().nonnegative().max(PIXEL_POLICY.maxChangedPixels),
      baselineBytes: z.number().int().positive(),
      candidateBytes: z.number().int().positive(),
      regenerated: z.boolean(),
      browser: z.string(),
      rasterization: hash,
      platform: z.string(),
      policy: policySchema,
    })
    .strict()
  const results = values.map((value) => receiptSchema.parse(value))
  const count = results[0]?.shard.count
  if (count === undefined || results.length !== count)
    throw new Error('Missing visual shard receipts')
  const seen = new Set()
  const environment = results[0]
  let checked = 0
  let baselineBytes = 0
  let candidateBytes = 0
  let changedPixels = 0
  let maxImageChangedPixels = 0
  for (const result of results) {
    if (result.shard.count !== count || seen.has(result.shard.index))
      throw new Error('Duplicate or inconsistent visual shard')
    const selected = selectVisualShard(manifest, result.shard)
    if (result.checked !== selected.length || result.selectionSha256 !== selectionDigest(selected))
      throw new Error('Incomplete visual shard coverage')
    for (const key of ['browser', 'rasterization', 'platform', 'regenerated'])
      if (result[key] !== environment[key]) throw new Error('Visual shard environment changed')
    seen.add(result.shard.index)
    checked += result.checked
    baselineBytes += result.baselineBytes
    candidateBytes += result.candidateBytes
    changedPixels += result.changedPixels
    maxImageChangedPixels = Math.max(maxImageChangedPixels, result.maxImageChangedPixels)
  }
  if (checked !== manifest.captures.length) throw new Error('Incomplete visual matrix coverage')
  if (baselineBytes > ARCHIVE_BUDGET || candidateBytes > ARCHIVE_BUDGET)
    throw new Error('Visual archive exceeds its 512 MiB budget')
  return {
    checked,
    baselineBytes,
    candidateBytes,
    changedPixels,
    maxImageChangedPixels,
    shards: count,
  }
}

const compareRendererInputs = (a, b) => a.localeCompare(b)

export function validateManifest(value, audit, matrix) {
  const renderers = audit.components.map((row) => row.file.replaceAll('\\', '/'))
  const inputs = matrix.componentAuditInputs.map((file) => file.replaceAll('\\', '/'))
  if (
    new Set(renderers).size !== renderers.length ||
    JSON.stringify(renderers.toSorted(compareRendererInputs)) !==
      JSON.stringify(inputs.toSorted(compareRendererInputs))
  )
    throw new Error('Renderer inventory coverage differs from the current matrix')
  const manifest = manifestSchema.parse(value)
  const expected = new Set(
    audit.scenes.flatMap((scene) =>
      matrix.states.flatMap((state) =>
        matrix.themes.flatMap((theme) =>
          matrix.widths.map((width) => captureKey({ scene, state, theme, width })),
        ),
      ),
    ),
  )
  let total = 0
  for (const capture of manifest.captures) {
    const key = captureKey(capture)
    if (!expected.delete(key)) throw new Error(`Duplicate or unexpected visual capture: ${key}`)
    if (capture.file.replaceAll('\\', '/') !== `${key}.png` || capture.height !== matrix.height)
      throw new Error(`Invalid visual path or dimensions: ${key}`)
    const components = audit.components
      .filter((row) => row.scene === capture.scene)
      .map((row) => row.file)
    if (JSON.stringify(capture.components) !== JSON.stringify(components))
      throw new Error(`Missing component coverage: ${key}`)
    if (
      ['hover', 'focus-visible', 'pressed'].includes(capture.state) &&
      capture.target !== null &&
      !capture.applied
    )
      throw new Error(`Unapplied control state: ${key}`)
    total += capture.bytes
  }
  if (expected.size > 0) throw new Error(`Missing visual captures: ${expected.size}`)
  if (total !== manifest.totalBytes || total > ARCHIVE_BUDGET)
    throw new Error('Visual archive byte budget or total mismatch')
  if (JSON.stringify(manifest.policy) !== JSON.stringify(PIXEL_POLICY))
    throw new Error('Visual comparison policy changed')
  return manifest
}
