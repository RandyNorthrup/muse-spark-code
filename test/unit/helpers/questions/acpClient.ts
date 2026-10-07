import type * as acp from '@agentclientprotocol/sdk'

interface PendingForm {
  readonly id: number
  readonly settle: (response: acp.CreateElicitationResponse) => void
  readonly signal: AbortSignal | undefined
  readonly onCancel: () => void
}

/** Matches pinned SDK 1.5.0: cancellation is cooperative; a withdrawn form may still answer. */
export class FakeQuestionAcpClient {
  private readonly pending = new Map<number, PendingForm>()
  private sequence = 0
  public readonly requests: acp.CreateElicitationRequest[] = []
  public readonly cancellations: { readonly method: '$/cancel_request'; readonly id: number }[] = []

  public constructor(
    public readonly hasForms: boolean,
    public readonly canCancel = true,
  ) {}

  public createElicitation(
    request: acp.CreateElicitationRequest,
    options: { readonly cancellationSignal?: AbortSignal } = {},
  ): Promise<acp.CreateElicitationResponse> {
    if (!this.hasForms) {
      return Promise.reject(new Error('fake client has no forms'))
    }
    this.requests.push(structuredClone(request))
    this.sequence += 1
    const id = this.sequence
    const signal = options.cancellationSignal
    return new Promise((settle) => {
      const onCancel = (): void => {
        if (this.canCancel) {
          this.cancellations.push({ method: '$/cancel_request', id })
        }
      }
      this.pending.set(id, { id, settle, signal, onCancel })
      if (signal?.aborted === true) {
        onCancel()
      } else {
        signal?.addEventListener('abort', onCancel, { once: true })
      }
    })
  }

  /** A malicious/old client may answer after cancellation; the agent must deliver once. */
  public answer(id: number, response: acp.CreateElicitationResponse): void {
    const form = this.pending.get(id)
    if (form === undefined) {
      throw new Error('fake form is not pending')
    }
    this.pending.delete(id)
    form.signal?.removeEventListener('abort', form.onCancel)
    form.settle(structuredClone(response))
  }
}
