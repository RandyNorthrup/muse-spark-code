import path from 'node:path'
import { mkdir, readFile, writeFile, rename } from 'node:fs/promises'
import { constants } from 'node:fs'
import * as z from 'zod/mini'
import { UI_TEXT, VAULT_LIMITS } from '../../shared/constants'
import { vaultRequesterSchema, type VaultRequester } from '../../shared/vault'
import { type VaultCeiling } from '../../core/vault/broker/policy'
import { isVaultFileMissing, vaultPrivateDirectory } from '../../core/vault/broker/files'

const handle = z.string().check(z.regex(/^secret:\/\/[a-z][a-z0-9-]{0,47}$/u))
const text = z.string().check(z.minLength(1), z.maxLength(VAULT_LIMITS.text))

/** One person-set ceiling: which handles one workspace and role may use. */
const ceilingEntrySchema = z.strictObject({
  workspaceId: text,
  role: vaultRequesterSchema.shape.role,
  ceiling: z.union([z.literal('ask'), z.array(handle).check(z.maxLength(VAULT_LIMITS.items))]),
})

/**
D216's person vault policy: a ceiling per workspace and role, set by the
person (`vault policy`), kept beside the vault files. The broker reads
it at each registration; no entry means no ceiling of the person's, and
the use refuses in words. Never a ceiling of ours (D121/D208).
*/
export const vaultPolicySchema = z.strictObject({
  ceilings: z.array(ceilingEntrySchema).check(z.maxLength(VAULT_LIMITS.items)),
})
export type VaultPolicy = z.infer<typeof vaultPolicySchema>

export function vaultPolicyFile(dataDir: string): string {
  return path.join(dataDir, 'vault-policy.json')
}

/** The person's policy, or undefined when they have not set one. */
export async function readVaultPolicy(dataDir: string): Promise<VaultPolicy | undefined> {
  let raw: Buffer
  try {
    raw = await readFile(vaultPolicyFile(dataDir))
  } catch (error: unknown) {
    if (isVaultFileMissing(error)) return undefined
    throw error
  }
  try {
    if (raw.byteLength > VAULT_LIMITS.frameBytes) throw new Error(UI_TEXT.vault.noAccess)
    return vaultPolicySchema.parse(JSON.parse(raw.toString('utf8')))
  } finally {
    raw.fill(0)
  }
}

/** The ceiling for one requester: the person's entry, or 'none'. */
export async function vaultPolicyCeiling(
  dataDir: string,
  requester: VaultRequester,
): Promise<VaultCeiling> {
  let policy: VaultPolicy | undefined
  try {
    policy = await readVaultPolicy(dataDir)
  } catch {
    // A damaged policy refuses every use rather than guessing a ceiling;
    // the fixed word on the broker's stderr is the record.
    process.stderr.write('vault-policy-refused\n')
    return 'none'
  }
  const entry = policy?.ceilings.find(
    (candidate) =>
      candidate.workspaceId === requester.workspaceId &&
      JSON.stringify(candidate.role) === JSON.stringify(requester.role),
  )
  return entry ? entry.ceiling : 'none'
}

/** The person's write (`vault policy`): owner-only, replaced whole. */
export async function writeVaultPolicy(dataDir: string, policy: VaultPolicy): Promise<void> {
  const parsed = vaultPolicySchema.parse(policy)
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
