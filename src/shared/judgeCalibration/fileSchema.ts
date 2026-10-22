// M125 lane L: the committed calibration profile file. One JSON file
// per (technique, family, engine) under profiles/<technique>/<family>/,
// dated and naming the independent label set it was fitted from. The
// envelope is validated here; the profile body goes through the
// calibration parser itself, so files can never outrun the runtime.
import * as z from 'zod/mini'

/** Kept aligned with `CALIBRATION_TECHNIQUES` in calibration/schema.ts. */
export const JUDGE_CALIBRATION_TECHNIQUES: readonly string[] = ['logprob', 'stated', 'systemone']

/** Kept aligned with `CALIBRATION_FAMILIES` in calibration/schema.ts. */
export const JUDGE_CALIBRATION_FAMILIES: readonly string[] = [
  'risk.destructive',
  'skill.fit',
  'triage.needFull',
  'context.include',
  'loop.stuck',
  'effort.lower',
  'edit.misfit',
  'failure.unmentioned',
  'scope.outside',
  'claim.inconsistent',
  'done.unbacked',
]

export const committedCalibrationFileSchema = z.strictObject({
  /** Commit date (YYYY-MM-DD); the newest file wins its tier. Never the future. */
  committedAt: z.iso.date(),
  /** The independent label set the fit used (a V run id or bench name). */
  labelSet: z.string().check(z.minLength(1)),
  /** The profile body, validated by `parseCalibrationProfile`, never trusted blind. */
  profile: z.record(z.string(), z.unknown()),
})
export type CommittedCalibrationFile = z.infer<typeof committedCalibrationFileSchema>
