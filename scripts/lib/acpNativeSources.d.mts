// Types for scripts/lib/acpNativeSources.mjs.
export const JOB_SOURCES: readonly string[]
export const DARWIN_HELPER: string
export const LINUX_HELPERS: readonly string[]
export const VOICE_WINDOWS_HELPERS: readonly string[]
export const RUNNER_HELPERS: string
// The Action scripts the package ships as its other-CI launcher (ci/lib, ci/prompts).
export const CI_LAUNCHER_SOURCES: readonly string[]
export function acpNativeFiles(target?: string): readonly string[]
