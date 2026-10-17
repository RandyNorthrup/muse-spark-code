// The workspace's confidential policy (M118), read afresh at each admission
// by sharing and by the M124 connector; an unreadable policy refuses.
import { readFileSync } from 'node:fs'
import path from 'node:path'
import * as z from 'zod/mini'
import { SETTING_DEFAULTS } from '../../shared/constants'

const policySchema = z.object({ 'museSpark.confidentialWorkspace': z.optional(z.boolean()) })
/** Read the existing workspace setting afresh at each admission; unavailable policy refuses. */
export function runtimeSharingConfidential(cwd: string): boolean | undefined {
  try {
    return (
      policySchema.parse(
        JSON.parse(readFileSync(path.join(cwd, '.vscode', 'settings.json'), 'utf8')),
      )['museSpark.confidentialWorkspace'] ?? SETTING_DEFAULTS.confidentialWorkspace
    )
  } catch (error: unknown) {
    return error instanceof Error && 'code' in error && error.code === 'ENOENT'
      ? SETTING_DEFAULTS.confidentialWorkspace
      : undefined
  }
}
