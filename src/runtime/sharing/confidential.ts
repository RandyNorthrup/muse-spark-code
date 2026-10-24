// The workspace's confidential policy (M118), read afresh at each admission
// by sharing and by the M124 connector; an unreadable policy refuses.
import { readFileSync } from 'node:fs'
import path from 'node:path'
import * as z from 'zod/mini'
import { stripJsonc } from '../../core/jsonc'
import { SETTING_DEFAULTS } from '../../shared/constants'

const policySchema = z.object({ 'museSpark.confidentialWorkspace': z.optional(z.boolean()) })
const POLICY_UNREADABLE_CODES: ReadonlySet<string> = new Set(['EACCES', 'EPERM'])
/** An unreadable or corrupt policy refuses admission; anything else keeps its kind. */
function isConfidentialPolicyError(error: unknown): boolean {
  return (
    error instanceof SyntaxError ||
    (error instanceof Error && error.name === '$ZodError') ||
    (error instanceof Error &&
      'code' in error &&
      typeof error.code === 'string' &&
      POLICY_UNREADABLE_CODES.has(error.code))
  )
}

/** Read the existing workspace setting afresh at each admission; unavailable policy refuses. */
export function runtimeSharingConfidential(cwd: string): boolean | undefined {
  try {
    return (
      policySchema.parse(
        JSON.parse(stripJsonc(readFileSync(path.join(cwd, '.vscode', 'settings.json'), 'utf8'))),
      )['museSpark.confidentialWorkspace'] ?? SETTING_DEFAULTS.confidentialWorkspace
    )
  } catch (error: unknown) {
    // A missing settings file reads the default; an unreadable or corrupt
    // policy refuses admission. Anything else keeps its kind.
    if (error instanceof Error && 'code' in error && error.code === 'ENOENT')
      return SETTING_DEFAULTS.confidentialWorkspace
    if (isConfidentialPolicyError(error)) return undefined
    throw error
  }
}
