import * as z from 'zod/mini'
import { MHP, MHP_ZERO_VERSION_COMPONENT } from '../constants'

// A capability promises every method in its group, including notifications.
// Hosts with a partial implementation omit that group and use its fallback.
export const MHP_CAPABILITIES = [
  'lifecycle',
  'workspace',
  'documents',
  'editor',
  'diff',
  'diagnostics',
  'codeIntel',
  'terminal',
  'ui',
  'surfaces',
  'settings',
  'storage',
  'commands',
  'tab',
  'voice',
  'auth',
  'window',
] as const
export const capabilitySchema = z.enum(MHP_CAPABILITIES)
export type MhpCapability = z.infer<typeof capabilitySchema>
// Sparse declarations are accepted at initialization. Missing means false;
// lifecycle alone is mandatory and cannot be replaced by a fallback.
export const offeredCapabilitiesSchema = z
  .array(capabilitySchema)
  .check(
    z.refine(
      (capabilities) =>
        capabilities.includes('lifecycle') && new Set(capabilities).size === capabilities.length,
    ),
  )
export type MhpCapabilities = readonly MhpCapability[]

export const MHP_FALLBACKS = [
  'required',
  'runtime-workspace',
  'disk-with-dirty-buffer-refusal',
  'launcher-or-clipboard',
  'react-diff',
  'lsp-or-check-commands',
  'lsp-broker',
  'os-terminal',
  'react-ui',
  'companion-tabs',
  'runtime-settings',
  'runtime-storage',
  'panel-palette',
  'lsp-or-completions-or-invoke',
  'runtime-or-browser-capture',
  'gh-credential-store',
  'companion-notification',
  'shared-controller',
] as const
export const fallbackSchema = z.enum(MHP_FALLBACKS)
export type MhpFallback = z.infer<typeof fallbackSchema>

export function selectMhpRoute(
  capability: MhpCapability,
  offered: MhpCapabilities,
  fallback: MhpFallback,
): 'native' | MhpFallback {
  return offered.includes(capability) ? 'native' : fallback
}

const versionPattern = /^mhp\/(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/u
export const versionSchema = z.string().check(z.regex(versionPattern))
export const versionRangeSchema = z.strictObject({
  minimum: versionSchema,
  maximumExclusive: versionSchema,
})

// Negotiate only the frozen version. Future minor versions must preserve v1
// or offer a range containing it; unknown majors are never guessed compatible.
function versionParts(version: string): bigint[] {
  return version.slice('mhp/'.length).split('.').map(BigInt)
}
function compareVersions(left: string, right: string): bigint {
  const rightParts = versionParts(right)
  for (const [index, part] of versionParts(left).entries()) {
    const difference = part - (rightParts[index] ?? MHP_ZERO_VERSION_COMPONENT)
    if (difference !== MHP_ZERO_VERSION_COMPONENT) return difference
  }
  return MHP_ZERO_VERSION_COMPONENT
}
export function isMhpVersionSupported(range: z.infer<typeof versionRangeSchema>): boolean {
  return (
    versionRangeSchema.safeParse(range).success &&
    compareVersions(range.minimum, MHP.version) <= MHP_ZERO_VERSION_COMPONENT &&
    compareVersions(MHP.version, range.maximumExclusive) < MHP_ZERO_VERSION_COMPONENT
  )
}

// The editor offers a range; only the reviewed 1.3 contract is implemented.
// A range containing it can select it, but no older/future version is guessed.
export function selectMhpVersion(range: z.infer<typeof versionRangeSchema>) {
  return isMhpVersionSupported(range) ? MHP.version : undefined
}
