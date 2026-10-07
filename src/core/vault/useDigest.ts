import { createHash } from 'node:crypto'
import { vaultUseSchema, type VaultUse } from '../../shared/vault'

function compare(a: string, b: string): number {
  return a === b ? 0 : Number(a > b) * 2 - 1
}

/** Stable order independent of object insertion order; arrays preserve argument order. */
function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map((entry) => canonical(entry)).join(',')}]`
  if (typeof value === 'object' && value !== null) {
    return `{${Object.entries(value)
      .toSorted(([a], [b]) => compare(a, b))
      .map(([key, entry]) => `${JSON.stringify(key)}:${canonical(entry)}`)
      .join(',')}}`
  }
  return JSON.stringify(value)
}

/** Validates before hashing. Environment names are a set; argv and all other arrays are ordered. */
export function canonicalVaultUse(input: VaultUse): string {
  const use = vaultUseSchema.parse(input)
  if (use.kind === 'environment' || use.kind === 'mcp')
    use.names = use.names.toSorted((a, b) => compare(a, b))
  return canonical({ v: 1, use })
}

export function vaultUseDigest(use: VaultUse): string {
  return createHash('sha256').update(canonicalVaultUse(use), 'utf8').digest('hex')
}
