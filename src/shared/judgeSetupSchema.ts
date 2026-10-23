// M125 lane W (D107 §8.1): the Set Up Local Judge wizard's wire
// shapes. The host runs the scan and the install; the webview renders
// steps and sends commands. Both sides validate before a snapshot or
// a command crosses postMessage, and every editor speaks this same
// contract through its own bridge.
import * as z from 'zod/mini'

export const JUDGE_SETUP_STEPS = ['scan', 'recommendation', 'licence', 'install', 'done'] as const
export type JudgeSetupStep = (typeof JUDGE_SETUP_STEPS)[number]

const nonEmpty = z.string().check(z.minLength(1))

const scanSchema = z.strictObject({
  step: z.literal('scan'),
  /** A scan is running; the step shows progress, not results. */
  running: z.boolean(),
  /** The completed scan's plain-words summary lines, most important first. */
  summary: z.array(nonEmpty),
  /** Why the scan failed, when it did; a retry stays available. */
  error: z.optional(nonEmpty),
})

const recommendationSchema = z.strictObject({
  step: z.literal('recommendation'),
  /** The pick, when one row contends; absent fits nothing. */
  model: z.optional(nonEmpty),
  digest: z.optional(nonEmpty),
  backend: z.enum(['cuda', 'rocm', 'metal', 'cpu']),
  /** The pick's verified-path p95 in milliseconds, the worst measured. */
  p95Ms: z.optional(z.number().check(z.gte(0))),
  /** Exactly the classes `eligible` admits for the pick. */
  classes: z.array(z.enum(['I', 'S', 'B', 'P'])),
  /** Every fitting model, most accurate first; the Advanced choice. */
  fitting: z.array(nonEmpty),
  reasons: z.array(nonEmpty),
  /** The Advanced panel's CPU-only toggle; re-runs the recommender. */
  cpuOnly: z.boolean(),
  /** The Advanced panel's hosted choice; leaves to the hosted flow. */
  hosted: z.boolean(),
})

const licenceSchema = z.strictObject({
  step: z.literal('licence'),
  model: nonEmpty,
  name: nonEmpty,
  url: z.optional(z.string()),
})

export const JUDGE_SETUP_PHASES = [
  'fetch',
  'verify',
  'install',
  'register',
  'preload',
  'health',
  'smoke',
] as const
export type JudgeSetupPhase = (typeof JUDGE_SETUP_PHASES)[number]

const installSchema = z.strictObject({
  step: z.literal('install'),
  model: nonEmpty,
  phase: z.enum(JUDGE_SETUP_PHASES),
  /** Bytes fetched of the blob total, when the phase reports them. */
  doneBytes: z.optional(z.number().check(z.gte(0))),
  totalBytes: z.optional(z.number().check(z.gte(0))),
  /** Why the install stopped, when it did; a retry stays available. */
  error: z.optional(nonEmpty),
})

const doneClassSchema = z.strictObject({
  timingClass: z.enum(['I', 'S', 'B', 'P']),
  on: z.boolean(),
  reason: nonEmpty,
})

const doneCheckSchema = z.strictObject({
  family: nonEmpty,
  on: z.boolean(),
  reason: nonEmpty,
})

const doneSchema = z.strictObject({
  step: z.literal('done'),
  model: nonEmpty,
  backend: z.enum(['cuda', 'rocm', 'metal', 'cpu']),
  /** One row per timing class, from `eligible` on the installed model. */
  classes: z.array(doneClassSchema),
  /** One row per accuracy family, from its committed profile. */
  checks: z.array(doneCheckSchema),
  smokeCorrect: z.number().check(z.gte(0)),
  smokeTotal: z.number().check(z.gte(0)),
})

export const judgeSetupSnapshotSchema = z.union([
  scanSchema,
  recommendationSchema,
  licenceSchema,
  installSchema,
  doneSchema,
])
export type JudgeSetupSnapshot = z.infer<typeof judgeSetupSnapshotSchema>

/** Every command the wizard's buttons send the host. */
export const JUDGE_SETUP_COMMANDS = [
  'startScan',
  'chooseModel',
  'chooseCpuOnly',
  'chooseHosted',
  'chooseSkip',
  'acceptLicence',
  'startInstall',
  'back',
  'cancel',
  'setUpLater',
] as const
export type JudgeSetupCommand = (typeof JUDGE_SETUP_COMMANDS)[number]

export const judgeSetupCommandSchema = z.strictObject({
  command: z.enum(JUDGE_SETUP_COMMANDS),
  /** The Advanced model's pick, for `chooseModel`. */
  model: z.optional(nonEmpty),
})
export type JudgeSetupCommandMessage = z.infer<typeof judgeSetupCommandSchema>
