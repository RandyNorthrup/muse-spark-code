import { NodeListenerError } from '../../../src/runtime/node/listenerGuard'

/** Reads the listener code off a method refusal: `plain` when the throw is untyped. */
export async function nodeErrorCode(work: Promise<unknown>): Promise<string> {
  try {
    await work
    return 'resolved'
  } catch (error: unknown) {
    return error instanceof NodeListenerError ? error.code : 'plain'
  }
}
