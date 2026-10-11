import { vaultUseSchema, type VaultUse } from '../../../shared/vault'
import { type VaultRun, vaultRunSchema } from './schema'

/** One use per item, with all its environment names bound into the digest. */
export function vaultExecUses(input: VaultRun): { handle: string; use: VaultUse }[] {
  const { command, secrets } = vaultRunSchema.parse(input)
  const uses: { handle: string; use: VaultUse }[] = []
  const environment = new Map<string, string[]>()
  const entries = Object.entries(secrets.env ?? {})
  for (const [name, handle] of entries) {
    const names = environment.get(handle) ?? []
    names.push(name)
    environment.set(handle, names)
  }
  for (const [handle, names] of environment)
    uses.push({ handle, use: { kind: 'environment', command, names } })
  if (secrets.stdin) uses.push({ handle: secrets.stdin, use: { kind: 'stdin', command } })
  if (secrets.totp) uses.push({ handle: secrets.totp, use: { kind: 'totp', command } })
  if (secrets.git) {
    const { handle, ...target } = secrets.git
    uses.push({ handle, use: { kind: 'git', command, ...target } })
  }
  if (secrets.sudo)
    uses.push({
      handle: secrets.sudo.handle,
      use: {
        kind: secrets.sudo.askpass ? 'askpass' : 'sudo',
        command,
        sudoPath: secrets.sudo.path,
      },
    })
  return uses.map(({ handle, use }) => ({ handle, use: vaultUseSchema.parse(use) }))
}
