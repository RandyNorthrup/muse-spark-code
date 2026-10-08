// Shared production-binding test helpers (M98 P2B): one definition for
// the lane-runtime adapter and the window deps base, so the binding suites
// share them instead of repeating each other or the wiring suites.
import { vi } from 'vitest'
import type { JudgeCascadeSide } from '../../../src/core/judge/cascade'
import type { JudgeRuntime } from '../../../src/core/judge/engine'
import { createPaidFeatures } from '../../../src/host/paid/paidHost'
import { FakeLogOutputChannel } from './fakes'
import { memento } from './memento'

/** Adapts a fixture side's run into the lane-runtime shape the factory takes. */
export function toRuntime(side: JudgeCascadeSide): Pick<JudgeRuntime, 'judge'> {
  return {
    judge: async (request, signal) => {
      const receipt = await side.run(request, signal)
      return receipt.outcome
    },
  }
}

/** The window deps every production-binding surface test starts from. */
export function bindingWindowBase() {
  const log = new FakeLogOutputChannel()
  return {
    log,
    notice: vi.fn(),
    emit: vi.fn(),
    startSession: vi.fn(),
    modelApi: () => undefined,
    readSettingsText: () => undefined,
    paid: createPaidFeatures({
      log,
      globalState: memento(new Map()),
      workspaceState: memento(new Map()),
      isSettingOn: () => false,
      isJudgeOn: () => true,
      isKeyStored: () => false,
      canRememberPaidUse: () => false,
    }),
    context: () => ({
      confidential: false,
      contextLimit: 32_000,
      ownerId: 'owner-1',
      modelId: 'chosen',
      backend: 'museCode' as const,
    }),
  }
}
