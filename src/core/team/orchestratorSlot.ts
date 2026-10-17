// The orchestrator slot (PLAN.md M96 lane T, D75 "The orchestrator").
// Default is today's behaviour: exactly the composer's model picker. The
// user may fill the slot with any configured model, per workspace; Reset to
// Default restores the picker's behaviour. The override is kept in workspace
// state, and new conversations in that workspace start on it; a picker
// change applies to the next delegation, and a running task keeps what it
// started on. Pure: workspace state arrives structurally (core never imports
// `vscode`), and the backend switch itself stays with M95's lane U.

import * as z from 'zod/mini'

/** A workspace's orchestrator override: a model on either backend. */
export interface OrchestratorOverride {
  readonly modelId: string
  readonly backend: 'modelApi' | 'musecode'
}

const overrideSchema = z.object({
  modelId: z.string().check(z.minLength(1)),
  backend: z.enum(['modelApi', 'musecode']),
})

/** The narrowest workspace-state shape this module touches. */
export interface OrchestratorSlotState {
  get(key: string): unknown
  update(key: string, value: unknown): unknown
}

const OVERRIDE_KEY = 'museSpark.team.orchestrator'

/** The workspace's override, if the user set one; anything else stored reads as none. */
export function readOrchestratorOverride(
  state: Pick<OrchestratorSlotState, 'get'>,
): OrchestratorOverride | undefined {
  const result = overrideSchema.safeParse(state.get(OVERRIDE_KEY))
  return result.success ? { modelId: result.data.modelId, backend: result.data.backend } : undefined
}

/** Reset to Default: forget the stored override, so the picker decides again. */
export async function resetOrchestratorSlot(
  state: Pick<OrchestratorSlotState, 'update'>,
): Promise<void> {
  await state.update(OVERRIDE_KEY, undefined)
}

/** What a new conversation in the workspace starts on: the override, or the picker's model. */
export function resolveOrchestratorModel(options: {
  readonly override: OrchestratorOverride | undefined
  readonly pickerModelId: string
  readonly pickerBackend: OrchestratorOverride['backend']
}): {
  readonly modelId: string
  readonly backend: OrchestratorOverride['backend']
  readonly isOverridden: boolean
} {
  return options.override === undefined
    ? { modelId: options.pickerModelId, backend: options.pickerBackend, isOverridden: false }
    : { modelId: options.override.modelId, backend: options.override.backend, isOverridden: true }
}

/**
 * What Default resolves to right now: live, not a snapshot. Default takes
 * the slot's current model and backend (the picker's, or the override), so a
 * picker change applies to the next delegation.
 */
export function resolveDefaultModel(options: {
  readonly override: OrchestratorOverride | undefined
  readonly pickerModelId: string
  readonly pickerBackend: OrchestratorOverride['backend']
}): { readonly modelId: string; readonly backend: OrchestratorOverride['backend'] } {
  const resolved = resolveOrchestratorModel(options)
  return { modelId: resolved.modelId, backend: resolved.backend }
}

/** Whether starting on the resolved model needs the backend switch (M95's switch and its confirmation). */
export function requiresBackendSwitch(
  current: OrchestratorOverride['backend'],
  resolved: OrchestratorOverride['backend'],
): boolean {
  return current !== resolved
}
