import { type VaultUse } from '../../../../src/shared/vault'
import { vaultUseDigest } from '../../../../src/core/vault/useDigest'

export class FakeSudo {
  readonly runs: { executable: string; argv: string[]; cwd: string; bytes: number }[] = []
  cached = false
  run(
    use: Extract<VaultUse, { kind: 'sudo' }>,
    approvedDigest: string,
    password: Uint8Array,
  ): void {
    if (vaultUseDigest(use) !== approvedDigest) throw new Error('fake sudo: changed use')
    this.runs.push({
      executable: use.sudoPath,
      argv: ['-S', '-k', '-p', '', '--', use.command.executable, ...use.command.argv],
      cwd: use.command.cwd,
      bytes: password.byteLength,
    })
    this.cached = false
  }
  clear(): void {
    this.cached = false
  }
}

export class FakeGit {
  readonly operations: string[] = []
  constructor(private readonly scope: { protocol: string; host: string; path: string }) {}
  get(
    operation: 'get' | 'store' | 'erase',
    target: { protocol: string; host: string; path: string },
  ): { ephemeral: true; password_expiry_utc: number } | null {
    this.operations.push(operation)
    return operation !== 'get' ||
      target.protocol !== this.scope.protocol ||
      target.host !== this.scope.host ||
      target.path !== this.scope.path
      ? null
      : { ephemeral: true, password_expiry_utc: 1_000_000 }
  }
}

/** No actual browser. L injects a CDP target and verifies live facts before insertText. */
export class FakeCdpTarget {
  readonly inserted: number[] = []
  constructor(
    readonly origin: string,
    readonly frameOrigin = origin,
    readonly isCertificateValid = true,
    readonly inputKind: 'password' | 'text' = 'password',
  ) {}
  insert(use: Extract<VaultUse, { kind: 'fill' }>, value: Uint8Array): void {
    if (
      use.origin !== this.origin ||
      use.frameOrigin !== this.frameOrigin ||
      !this.isCertificateValid ||
      !this.origin.startsWith('https://') ||
      (use.field === 'password' && this.inputKind !== 'password')
    )
      throw new Error('fake CDP: destination changed')
    this.inserted.push(value.byteLength)
  }
  readPassword(): never {
    throw new Error('fake CDP: password read forbidden')
  }
}
