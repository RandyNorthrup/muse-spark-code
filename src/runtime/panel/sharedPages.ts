import path from 'node:path'
import { pathToFileURL } from 'node:url'
import type { RuntimeFeatureContext } from './runtimeFeatures'
import type { RuntimePresentationPage } from './presentationViews'
import type { PlanFiles } from '../../host/conversation/conversationController'
import { UI_TEXT } from '../../shared/constants'
import type { HostAction } from '../../shared/protocol'

/** Real saved-file and advertised-model indices; optional native page sources extend this set. */
export function sharedPresentationPages(
  context: RuntimeFeatureContext,
  plans: PlanFiles | undefined,
): Partial<Record<HostAction, RuntimePresentationPage>> {
  const check = (signal: AbortSignal) => {
    signal.throwIfAborted()
    context.signal?.throwIfAborted()
  }
  return {
    ...(plans !== undefined && {
      showPlans: {
        readState: async () => {
          if (!context.ports.options.trustWorkspace) throw new Error('MHP_WORKSPACE_UNTRUSTED')
          return { kind: 'plans', plans: [...(await plans.list())] }
        },
        act: async (request, state, signal) => {
          check(signal)
          if (
            !context.ports.options.trustWorkspace ||
            request.type !== 'planAction' ||
            state.kind !== 'plans'
          )
            throw new Error('MHP_PRESENTATION_INVALID_INDEX')
          const row = state.plans.find((plan) => plan.fileName === request.fileName)
          if (row === undefined) throw new Error('MHP_PRESENTATION_INVALID_INDEX')
          const file = await plans.read(row.fileName)
          check(signal)
          if (request.action === 'read') return file.document.body
          if (request.action === 'open')
            await context.ports.host.request(
              'editor/open',
              {
                uri: pathToFileURL(path.join(context.ports.workspaceRoot, file.relativePath)).href,
              },
              signal,
            )
          else {
            const controller = context.controller?.()
            if (controller === undefined) throw new Error('MHP_PRESENTATION_ACTION_FAILED')
            await controller.implementSavedPlan(row.fileName)
          }
          return
        },
      } satisfies RuntimePresentationPage,
    }),
    showWalkthrough: {
      readState: async () => {
        const host = await context.ports.runtime.backend.hostFor(context.ports.workspaceRoot)
        const models = await host.listModels(context.sessionId?.())
        return {
          kind: 'walkthrough',
          steps: models.map((model) => ({
            id: model.modelId,
            title: UI_TEXT.modelListLabel,
            detail: UI_TEXT.switchModel,
            actionTitle: model.displayLabel,
            action: { type: 'setModel', modelId: model.modelId },
          })),
        }
      },
      act: async (request, state, signal) => {
        check(signal)
        if (request.type !== 'walkthroughAction' || state.kind !== 'walkthrough')
          throw new Error('MHP_PRESENTATION_INVALID_INDEX')
        const step = state.steps.find((row) => row.id === request.stepId)
        const controller = context.controller?.()
        if (controller === undefined || step?.action.type !== 'setModel')
          throw new Error('MHP_PRESENTATION_ACTION_FAILED')
        await controller.handle(step.action)
        return
      },
    },
  }
}
