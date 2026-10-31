import path from 'node:path'
import { mkdir, open, readFile, rename, stat } from 'node:fs/promises'
import { constants } from 'node:fs'
import { randomBytes } from 'node:crypto'
import { UI_TEXT, VAULT_LIMITS } from '../../shared/constants'
import {
  vaultPersonPolicySchema,
  type VaultPersonPolicy,
  type VaultRequester,
} from '../../shared/vault'
import { type VaultCeiling } from '../../core/vault/broker/policy'
import { VaultError } from '../../core/vault/crypto'
import { isVaultFileMissing, readVaultFile, writeVaultFile } from '../../core/vault/broker/files'

/**
D243's person vault policy: a ceiling per workspace and role, set by the
person (`vault policy`), kept beside the vault files. The broker reads
it at each registration; no entry means no ceiling of the person's, and
the use refuses in words. Never a ceiling of ours (D121/D208). This
module is the file half only; it ships as its own lazy chunk
(dist/vaultPolicy.js) so neither the runtime nor the broker bindings
carry it in their measured budgets.

On POSIX the file is read and written through the vault's owner-only
helpers: a symlink is not followed, a second name or a mode another
account can read is refused, and the size is checked before the bytes
are allocated. The write publishes through an exclusive random temporary,
so a planted `vault-policy.json.next` cannot be aimed at another file.
*/
export function vaultPolicyFile(dataDir: string): string {
  return path.join(dataDir, 'vault-policy.json')
}

/**
A symlink, a non-owner-only mode, a second link, or a file past the frame
is the same refusal as a damaged policy. `readVaultFile` reports those as
the fixed no-access sentence or as ELOOP/EPERM from O_NOFOLLOW.
*/
function isHostilePolicyFile(error: unknown): boolean {
  if (!(error instanceof Error)) return false
  if (error.message === UI_TEXT.vault.noAccess) return true
  const code = 'code' in error ? error.code : undefined
  return code === 'ELOOP' || code === 'EPERM'
}

/** The policy bytes, or undefined when the person has not set a file. */
async function loadVaultPolicyBytes(dataDir: string): Promise<Buffer | undefined> {
  const target = vaultPolicyFile(dataDir)
  try {
    // Windows has no O_NOFOLLOW (the constant is 0) and its stat mode is not
    // the POSIX owner check, so the pipe directory's DACL stays the guard.
    // The size is still refused before the bytes are read.
    if (process.platform === 'win32') {
      const sample = await stat(target)
      if (sample.size > VAULT_LIMITS.frameBytes) throw new VaultError('invalid')
      return await readFile(target)
    }
    return await readVaultFile(target)
  } catch (error: unknown) {
    if (isVaultFileMissing(error)) return undefined
    if (error instanceof VaultError) throw error
    if (isHostilePolicyFile(error)) throw new VaultError('invalid', { cause: error })
    throw error
  }
}

/** The person's policy, or undefined when they have not set one. */
export async function readVaultPolicy(dataDir: string): Promise<VaultPersonPolicy | undefined> {
  const raw = await loadVaultPolicyBytes(dataDir)
  if (raw === undefined) return undefined
  try {
    if (raw.byteLength > VAULT_LIMITS.frameBytes) throw new VaultError('invalid')
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
    // A damaged policy (unparseable, schema-invalid, a link, a mode another
    // account can read, or oversize) refuses every use rather than guessing
    // a ceiling; the fixed word on the broker's stderr is the record. Any
    // other failure (an unreadable folder) is not a policy outcome and keeps
    // propagating.
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

/**
The person's write (`vault policy`): owner-only, replaced whole.
POSIX goes through `writeVaultFile` (exclusive random temporary, no
follow). Windows cannot use that helper — its owner check refuses a
normal file — so the write creates a random exclusive temporary and
renames it over the target, which replaces a directory entry instead of
following one.
*/
async function writeVaultPolicyWindows(
  dataDir: string,
  target: string,
  bytes: Uint8Array,
): Promise<void> {
  await mkdir(dataDir, { recursive: true })
  const temporary = `${target}.${randomBytes(VAULT_LIMITS.idBytes).toString('hex')}.tmp`
  const file = await open(
    temporary,
    constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL,
    constants.S_IRUSR | constants.S_IWUSR,
  )
  try {
    await file.writeFile(bytes)
  } finally {
    await file.close()
  }
  await rename(temporary, target)
}

/** The person's write (`vault policy`): owner-only, replaced whole. */
export async function writeVaultPolicy(dataDir: string, policy: VaultPersonPolicy): Promise<void> {
  const parsed = vaultPersonPolicySchema.parse(policy)
  const bytes = Buffer.from(`${JSON.stringify(parsed, null, 2)}\n`, 'utf8')
  try {
    const target = vaultPolicyFile(dataDir)
    if (process.platform === 'win32') await writeVaultPolicyWindows(dataDir, target, bytes)
    else await writeVaultFile(target, bytes)
  } finally {
    bytes.fill(0)
  }
}
