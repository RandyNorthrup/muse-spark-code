// M125 lane H (D107, D90.27): the judged-models table schema. Each row
// carries what the recommender proves: the served name, sizes, a digest
// when installing is possible, verified-path latency when recommending
// is possible, accuracy from our measurements, the fitted families,
// and its source with its check date. Absent means unproven, never
// zero: no digest is not installable, no verified latency on a
// platform is not recommended there. Only a missing source or date
// fails a row.
import * as z from 'zod/mini'

const checkDateSchema = z.string().check(z.regex(/^\d{4}-\d{2}-\d{2}$/))
const digestSchema = z.string().check(z.regex(/^[a-f\d]{64}$/))
const positiveInt = z.int().check(z.positive())
const nonEmpty = z.string().check(z.minLength(1))

const latencySchema = z.strictObject({
  backend: z.enum(['cuda', 'rocm', 'metal', 'cpu']),
  platform: z.enum(['linux', 'darwin', 'win32']),
  p50Ms: z.number().check(z.positive()),
  p95Ms: z.number().check(z.positive()),
  /** Verified path setup runs, or raw inference for information only. */
  path: z.enum(['verified', 'raw']),
  source: nonEmpty,
})

const accuracySchema = z.strictObject({
  correct: z.int().check(z.gte(0)),
  total: positiveInt,
  brier: z.optional(z.number().check(z.gte(0), z.lte(1))),
  source: nonEmpty,
})

const licenceSchema = z.strictObject({
  name: nonEmpty,
  url: z.optional(z.string()),
  needsAccept: z.boolean(),
})

export const judgeModelRowSchema = z.strictObject({
  /** The served name, as /api/tags reports it. */
  model: nonEmpty,
  technique: z.enum(['systemone', 'logprob', 'stated']),
  quantization: nonEmpty,
  /** The manifest digest; absent is not installable. */
  digest: z.optional(digestSchema),
  weightDigest: z.optional(digestSchema),
  weightBytes: z.optional(positiveInt),
  downloadBytes: positiveInt,
  residentBytesGpu: z.optional(positiveInt),
  residentBytesCpu: z.optional(positiveInt),
  accuracy: z.optional(accuracySchema),
  latency: z.array(latencySchema),
  /** Calibration families with a fitted profile for this digest. */
  profiledFamilies: z.array(nonEmpty),
  /** Last resort only: where no full row fits, speed decisions only. */
  speedOnly: z.optional(z.boolean()),
  /** Joins the ranking only once a profile lands for it. */
  requiresCalibration: z.optional(z.boolean()),
  /** Absent is shown as unrecorded; the user decides with eyes open. */
  licence: z.optional(licenceSchema),
  source: nonEmpty,
  checkDate: checkDateSchema,
})

const runtimeArchiveSchema = z.strictObject({
  platform: z.enum(['linux', 'darwin', 'win32']),
  backend: z.enum(['cuda', 'rocm', 'metal', 'cpu']),
  url: nonEmpty,
  sha256: digestSchema,
})

const runtimeSchema = z.strictObject({
  /** The pinned release; only its responses are captured. */
  version: nonEmpty,
  /** Reuse needs at least this; it equals the pin until another release is captured. */
  minimum: nonEmpty,
  /** Empty until the pin's archives land with their SHA-256 (rule 9). */
  archives: z.array(runtimeArchiveSchema),
})

export const judgeModelsEnvelopeSchema = z.strictObject({
  version: z.literal(1),
  checkedDate: checkDateSchema,
  runtime: runtimeSchema,
  rows: z.array(z.unknown()).check(z.minLength(1)),
})

export type JudgeModelsTable = Omit<z.infer<typeof judgeModelsEnvelopeSchema>, 'rows'> & {
  readonly rows: readonly JudgeModelRow[]
}
export type JudgeModelRow = z.infer<typeof judgeModelRowSchema>
export type JudgeModelLatency = z.infer<typeof latencySchema>
