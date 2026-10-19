// Types for scripts/lib/vsixTargets.mjs.
export const VSIX_TARGETS: readonly string[]
export function vsixArtifactName(name: string, version: string, target: string): string
export function vsixFallbackName(name: string, version: string): string
export function targetFromArgs(argv: readonly string[]): string | undefined
export function targetOfVsix(artifact: string): string | undefined
export function isVsixTargetFile(target: string, file: string): boolean
export function requiredNativeFiles(target?: string): readonly string[]
