export interface ExecVaultContext {
  readonly cwd: string
  readonly sessionId: string
  readonly signal: AbortSignal
  readonly source: 'headless'
  readonly unattended: true
  /** Every refusal stops exec; this is independent of ordinary tool-denial policy. */
  readonly onDenied: (message: string) => void
}
export interface ExecVaultSession {
  close(): Promise<void>
}
export interface ExecVaultPort {
  open(context: ExecVaultContext): Promise<ExecVaultSession>
}
