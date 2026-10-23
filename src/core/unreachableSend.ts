// A send-level failure, shared by the spend reports and the provider
// probe: leaf-ward only, so the light probe chunk carries no reporter.
import { isModelApiError } from './backends/modelapi/transport'
import { isRequestNotSent } from './refusal'

/**
A fetch that never brought a usable answer, so the report reads
`unreachable`: a wrapped transport failure, the endpoint pin's
not-sent refusal, its rebinding refusal, or a raw fetch failure below
the wrap. A wrapped HTTP answer the fetcher raised instead of
returning reads the same. Anything else is a bug or a refusal with
its own sentence, and is the caller's to throw.
*/
export function isUnreachableSend(error: unknown): boolean {
  return (
    isModelApiError(error) ||
    isRequestNotSent(error) ||
    (error instanceof Error && error.message === 'rebinding') ||
    error instanceof TypeError
  )
}
