/** One approval's displayed-byte lifetime. Terminal decisions cannot be rebound. */
export class MakerApprovalReceipt {
  private readonly live = new AbortController()
  private current: 'awaiting-render' | 'rendered' | 'decided' | 'revoked' = 'awaiting-render'
  readonly signal = this.live.signal

  constructor(
    readonly id: string,
    readonly digest: string,
    private readonly close: () => void,
  ) {}

  get state() {
    return this.current
  }

  rendered(id: string, digest: string): void {
    if (this.current === 'decided' || this.current === 'revoked') return
    if (id !== this.id || digest !== this.digest) this.revoke()
    else this.current = 'rendered'
  }

  canSend(id: string, digest: string): boolean {
    return (
      this.current === 'rendered' &&
      !this.signal.aborted &&
      id === this.id &&
      digest === this.digest
    )
  }

  /** Check the live rendered binding and latch the decision in the same synchronous step. */
  decide(id: string, digest: string): boolean {
    if (!this.canSend(id, digest)) {
      this.revoke()
      return false
    }
    this.current = 'decided'
    return true
  }

  revoke(): void {
    if (this.current === 'decided' || this.current === 'revoked') return
    this.current = 'revoked'
    this.live.abort()
  }

  dispose(): void {
    this.revoke()
    this.close()
  }
}
