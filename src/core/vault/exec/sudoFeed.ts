import { UI_TEXT, VAULT_ASKPASS_TTL_MS, VAULT_ASKPASS_USES } from '../../../shared/constants'
import { vaultUseSchema, type VaultUse } from '../../../shared/vault'
import { vaultUseDigest } from '../useDigest'
import { type VaultExecFeederPort } from './feeder'

/** Absolute sudo path, fresh authentication, no timestamp update, exact approved argv. */
export function sudoInvocation(use: Extract<VaultUse, { kind: 'sudo' }>, digest: string) {
  const checked = vaultUseSchema.parse(use)
  if (checked.kind !== 'sudo' || vaultUseDigest(checked) !== digest)
    throw new Error(UI_TEXT.vault.useChanged)
  return {
    file: checked.sudoPath,
    args: ['-S', '-k', '-p', '', '--', checked.command.executable, ...checked.command.argv],
    cwd: checked.command.cwd,
  }
}

/** Feeder-owned helper access: never an environment/argument ticket and never a cached grant. */
export class VaultAskpass {
  private uses = 0
  private closed = false
  private readonly deadline: number
  constructor(
    private readonly password: Uint8Array,
    private readonly now: () => number,
  ) {
    if (
      password.includes(0) ||
      password.includes('\n'.codePointAt(0) ?? 0) ||
      password.includes('\r'.codePointAt(0) ?? 0)
    )
      throw new Error(UI_TEXT.vault.noAccess)
    this.deadline = now() + VAULT_ASKPASS_TTL_MS
  }
  read(): Buffer {
    if (this.closed || this.now() >= this.deadline || this.uses >= VAULT_ASKPASS_USES)
      throw new Error(UI_TEXT.vault.noAccess)
    this.uses += 1
    const bytes = Buffer.alloc(this.password.byteLength + 1)
    bytes.set(this.password)
    bytes[bytes.length - 1] = '\n'.codePointAt(0) ?? 0
    return bytes
  }
  close(): void {
    this.closed = true
    this.password.fill(0)
  }
}

/** Cleanup has its own signal, and never executes a swapped sudo or cwd. */
export async function clearSudoTimestamp(
  sudoPath: string,
  cwd: string,
  env: NodeJS.ProcessEnv,
  port: Pick<VaultExecFeederPort, 'realPath' | 'run'>,
): Promise<void> {
  for (const original of [sudoPath, cwd]) {
    const actual = await port.realPath(original)
    if (actual.replaceAll('\\', '/') !== original.replaceAll('\\', '/'))
      throw new Error(UI_TEXT.vault.useChanged)
  }
  const result = await port.run(
    { file: sudoPath, args: ['-K'], cwd, env, stdin: null, cleanup: true },
    new AbortController().signal,
    (bytes) => bytes.fill(0),
    (bytes) => bytes.fill(0),
  )
  if (result.exitCode !== 0) throw new Error(UI_TEXT.vault.noAccess)
}
