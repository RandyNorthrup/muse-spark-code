import { z } from 'zod'
import { ARCHIVE_BUDGET, PIXEL_POLICY } from './visualImages.mjs'

const hash = z.string().regex(/^[\da-f]{64}$/)
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
    policy: z
      .object({
        threshold: z.literal(PIXEL_POLICY.threshold),
        includeAA: z.literal(PIXEL_POLICY.includeAA),
        maxChangedPixelRatio: z.literal(PIXEL_POLICY.maxChangedPixelRatio),
        maxChangedPixels: z.literal(PIXEL_POLICY.maxChangedPixels),
      })
      .strict(),
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

export function validateManifest(value, audit, matrix) {
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
