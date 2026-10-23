import path from 'node:path'
import { expect } from 'vitest'
import { NodeListenerError } from '../../../../src/runtime/node/listenerGuard'
import { NodeStateStore } from '../../../../src/runtime/node/state'
import { NODE_ZERO_DIGEST } from '../../../../src/shared/constants'
import type { NodeState } from '../../../../src/shared/node'
import { nodeState } from './records'

/** A state store initialized empty: initialize demands the zero audit head. */
export async function initializedPageStore(
  root: string,
): Promise<{ store: NodeStateStore; initial: NodeState }> {
  const store = new NodeStateStore(path.join(root, 'state'), () => undefined)
  const initial = nodeState()
  initial.auditHead = { seq: 0, hash: NODE_ZERO_DIGEST }
  await store.initialize(initial)
  return { store, initial }
}

/** Captures a typed refusal: any other outcome fails the test. */
export async function pageRefusal(work: Promise<unknown>): Promise<NodeListenerError> {
  let failure: unknown = 'resolved'
  try {
    await work
  } catch (error: unknown) {
    failure = error
  }
  expect(failure).toBeInstanceOf(NodeListenerError)
  if (!(failure instanceof NodeListenerError)) throw new Error('expected a typed refusal')
  return failure
}
