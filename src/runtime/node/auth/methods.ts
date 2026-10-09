import {
  nodeMethods,
  type NodeMethodPort,
  type NodeMethodName,
  type NodeMethodParams,
  type NodeMethodResult,
} from '../../../shared/hostApi/nodeMethods'
import type { NodeSession } from '../../../shared/nodeAuth'
import { UI_TEXT } from '../../../shared/constants'
import type { NodePasskeyAuth } from './service'
import { NodeListenerError, type NodeListenerErrorCode } from '../listenerGuard'

/** The listener supplies its real source and verified session; never accept these in params. */
export function nodeAuthMethods(
  auth: NodePasskeyAuth,
  source: string,
  session: NodeSession | null,
  next: NodeMethodPort,
  failure: (code: NodeListenerErrorCode) => Error,
): NodeMethodPort {
  const port = auth.forSource(source, session?.id)
  return {
    async request<M extends NodeMethodName>(
      method: M,
      params: NodeMethodParams<M>,
      signal: AbortSignal,
    ): Promise<NodeMethodResult<M>> {
      signal.throwIfAborted()
      let isAuth = true
      try {
        let result: unknown
        switch (method) {
          case 'node/auth/begin': {
            const input = nodeMethods['node/auth/begin'].params.parse(params)
            result = await port.begin(
              input.purpose,
              input.purpose === 'enroll' ? input.setupCode : undefined,
            )
            break
          }
          case 'node/auth/enroll': {
            const input = nodeMethods['node/auth/enroll'].params.parse(params)
            result = await port.enroll(input.challengeId, input.credential)
            break
          }
          case 'node/auth/signin': {
            const input = nodeMethods['node/auth/signin'].params.parse(params)
            result = await port.signIn(input.challengeId, input.credential)
            break
          }
          case 'node/auth/stepUp/begin': {
            if (session === null) throw new Error(UI_TEXT.nodeErrors.unauthenticated)
            const input = nodeMethods['node/auth/stepUp/begin'].params.parse(params)
            result = await port.beginStepUp(session.id, input.action, input.actionDigest)
            break
          }
          case 'node/auth/stepUp/complete': {
            const input = nodeMethods['node/auth/stepUp/complete'].params.parse(params)
            result = await port.stepUp(input.challengeId, input.credential)
            break
          }
          case 'node/auth/end': {
            nodeMethods['node/auth/end'].params.parse(params)
            if (session === null) throw new Error(UI_TEXT.nodeErrors.unauthenticated)
            await port.end(session.id)
            result = { done: true }
            break
          }
          default: {
            isAuth = false
            return await next.request(method, params, signal)
          }
        }
        signal.throwIfAborted()
        // The catalog lookup is generic; zod has validated the exact method's result.
        return nodeMethods[method].result.parse(result) as NodeMethodResult<M>
      } catch (error: unknown) {
        if (!isAuth) throw error
        signal.throwIfAborted()
        // N supplies its constructor: class identity differs across lazy bundles.
        throw failure(error instanceof NodeListenerError ? error.code : 'unauthenticated')
      }
    },
  }
}
