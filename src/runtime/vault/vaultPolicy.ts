import path from 'node:path'
import { mkdir, readFile, writeFile, rename } from 'node:fs/promises'
import { constants } from 'node:fs'
import { UI_TEXT, VAULT_LIMITS } from '../../shared/constants'
import {
  vaultPersonPolicySchema,
  type VaultPersonPolicy,
  type VaultRequester,
} from '../../shared/vault'
import { type VaultCeiling } from '../../core/vault/broker/policy'
import { VaultError } from '../../core/vault/crypto'
import { isVaultFileMissing, vaultPrivateDirectory } from '../../core/vault/broker/files'

/**
D243's person vault policy: a ceiling per workspace and role, set by the
person (`vault policy`), kept beside the vault files. The broker reads
it at each registration; no entry means no ceiling of the person's, and
the use refuses in words. Never a ceiling of ours (D121/D208). This
module is the file half only; it ships as its own lazy chunk
(dist/vaultPolicy.js) so neither the runtime nor the broker bindings
carry it in their measured budgets.
*/
export function vaultPolicyFile(dataDir: string): string {
  return path.join(dataDir, 'vault-policy.json')
}

/** The person's policy, or undefined when they have not set one. */
export async function readVaultPolicy(dataDir: string): Promise<VaultPersonPolicy | undefined> {
  let raw: Buffer
  try {
    raw = await readFile(vaultPolicyFile(dataDir))
  } catch (error: unknown) {
    if (isVaultFileMissing(error)) return undefined
    throw error
  }
  try {
    if (raw.byteLength > VAULT_LIMITS.frameBytes) throw new Error(UI_TEXT.vault.noAccess)
    return vaultPersonPolicySchema.parse(JSON.parse(raw.toString('utf8')))
  } finally {
    raw.fill(0)
  }
}

/** The ceiling for one requester: the person's entry, or 'none'. */
export async function vaultPolicyCeiling(
  dataDir: string,
  requester: VaultRequester,
): Promise<VaultCeiling> {
  let policy: VaultPersonPolicy | undefined
  try {
    policy = await readVaultPolicy(dataDir)
  } catch (error: unknown) {
    // A damaged policy (unparseable, schema-invalid or oversize) refuses
    // every use rather than guessing a ceiling; the fixed word on the
    // broker's stderr is the record. Any other failure (an unreadable
    // folder) is not a policy outcome and keeps propagating.
    if (error instanceof SyntaxError) {
      process.stderr.write('vault-policy-refused\n')
      return 'none'
    }
    if (error instanceof VaultError) {
      process.stderr.write('vault-policy-refused\n')
      return 'none'
    }
    if (error instanceof Error && error.name === '$ZodError') {
      process.stderr.write('vault-policy-refused\n')
      return 'none'
    }
    throw error
  }
  const entry = policy?.ceilings.find(
    (candidate) =>
      candidate.workspaceId === requester.workspaceId &&
      JSON.stringify(candidate.role) === JSON.stringify(requester.role),
  )
  return entry ? entry.ceiling : 'none'
}

/** The person's write (`vault policy`): owner-only, replaced whole. */
export async function writeVaultPolicy(dataDir: string, policy: VaultPersonPolicy): Promise<void> {
  const parsed = vaultPersonPolicySchema.parse(policy)
  // POSIX modes make the directory owner-only; on Windows the vault
  // directory already carries the pipe guard's DACL, and modes set none.
  if (process.platform === 'win32') await mkdir(dataDir, { recursive: true })
  else await vaultPrivateDirectory(dataDir)
  const target = vaultPolicyFile(dataDir)
  const temporary = `${target}.next`
  await writeFile(temporary, `${JSON.stringify(parsed, null, 2)}\n`, {
    mode: constants.S_IRUSR | constants.S_IWUSR,
  })
  await rename(temporary, target)
}
