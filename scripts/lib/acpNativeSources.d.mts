// Types for scripts/lib/acpNativeSources.mjs.
export const JOB_SOURCES: readonly string[]
export const DARWIN_HELPER: string
export const LINUX_HELPERS: readonly string[]
export const RUNNER_HELPERS: string
export function acpHelperPlan(
  platform?: string,
  arch?: string,
): { required: string[]; optional: string[] }
