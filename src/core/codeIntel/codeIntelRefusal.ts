// Portable refusal shared with admission without loading code intelligence.
export class CodeIntelRefusal extends Error {
  public constructor(
    reason: string,
    public readonly visibleReason: string = reason,
  ) {
    super(reason)
    this.name = 'CodeIntelRefusal'
  }
}
