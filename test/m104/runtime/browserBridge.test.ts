/** @vitest-environment jsdom */
import { expect, it, vi } from 'vitest'
import type { PlanPageProps } from '../../../src/webview/presentation/PlanPage'
import type { PanelBridge } from '../../../src/webview/bridges/types'
import { presentationRequestSchema } from '../../../src/shared/presentationProtocol'
import { mountPresentation } from '../../../src/shared/browser/presentation'

const owner = vi.hoisted(() => {
  const state: {
    plans: PlanPageProps | undefined
    failure: ReturnType<typeof vi.fn>
    dispose: ReturnType<typeof vi.fn>
  } = {
    plans: undefined,
    failure: vi.fn(),
    dispose: vi.fn(),
  }
  return state
})
vi.mock('../../../src/webview/installTable', () => ({
  installEmbeddedTable: () => new Error('No automatic fixture mount'),
}))
vi.mock('../../../src/webview/bridges/failure', () => ({ showBridgeFailure: owner.failure }))
vi.mock('../../../src/webview/presentation/presentationUi', () => ({
  createPresentationUi: () => {
    return {
      showPlans: (props: PlanPageProps) => {
        owner.plans = props
      },
      dispose: owner.dispose,
    }
  },
}))

it('waits for the matching validated acknowledgement and rejects retained handlers on disposal', async () => {
  const target = new EventTarget()
  const sent: unknown[] = []
  const bridge: PanelBridge = {
    post: (message) => {
      sent.push(presentationRequestSchema.parse(message))
    },
    messages: target,
    savedState: () => undefined,
    saveState: () => undefined,
    loadFallbacks: () => Promise.reject(new Error('No fixture fallback')),
    dispose: () => undefined,
  }
  const dispose = mountPresentation(bridge, document.createElement('main'))
  target.dispatchEvent(
    new MessageEvent('message', {
      data: {
        type: 'presentationState',
        state: {
          kind: 'plans',
          plans: [
            { fileName: 'actual.md', relativePath: '.agents/plans/actual.md', title: 'Actual' },
          ],
        },
      },
    }),
  )
  const plans = owner.plans
  if (plans === undefined) throw new Error('No adopted plan page')
  const settled = vi.fn()
  const read = (async () => {
    settled(await plans.onRead('actual.md'))
  })()
  const request = presentationRequestSchema.parse(sent.at(-1))
  if (request.type !== 'planAction') throw new Error('Missing read request')
  expect(settled).not.toHaveBeenCalled()
  target.dispatchEvent(
    new MessageEvent('message', {
      data: {
        type: 'presentationResult',
        requestId: 'foreign',
        result: { ok: true, text: 'Wrong result' },
      },
    }),
  )
  await Promise.resolve()
  expect(settled).not.toHaveBeenCalled()
  target.dispatchEvent(
    new MessageEvent('message', {
      data: {
        type: 'presentationResult',
        requestId: request.requestId,
        result: { ok: true, text: 'Exact saved text' },
      },
    }),
  )
  await read
  expect(settled).toHaveBeenCalledExactlyOnceWith('Exact saved text')
  const rejected = expect(plans.onRead('actual.md')).rejects.toThrow('MHP_PRESENTATION_DISPOSED')
  dispose()
  dispose()
  await rejected
  await expect(plans.onOpen('actual.md')).rejects.toThrow('MHP_PRESENTATION_UNAVAILABLE')
  expect(owner.dispose).toHaveBeenCalledOnce()
})
