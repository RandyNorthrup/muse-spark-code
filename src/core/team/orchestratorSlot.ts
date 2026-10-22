// The orchestrator slot (PLAN.md M96 lane T, D75 "The orchestrator").
// Default is today's behaviour: exactly the composer's model picker. The
// user may fill the slot with any configured model, per workspace; Reset to
// Default restores the picker's behaviour. The override is kept in workspace
// state, and new conversations in that workspace start on it; a picker
// change applies to the next delegation, and a running task keeps what it
// started on. Pure: workspace state arrives structurally (core never imports
// `vscode`), and the backend switch itself stays with M95's lane U.

import { teamSnapshotSchema, type TeamModelSettings } from '../../shared/team'
import { TEAM_WORKSPACE_KEYS } from '../../shared/teamConversation'
import { UI_TEXT } from '../../shared/constants'
import { fill } from '../../shared/l10n/text'
import { refuseUnservedSetting, type TeamSettingCapabilities } from './modelSettings'

/** A workspace's orchestrator override: a model on either backend. */
export interface OrchestratorOverride {
  readonly settings?: TeamModelSettings | undefined
  readonly modelId: string
  readonly backend: 'modelApi' | 'musecode'
}

/** The narrowest workspace-state shape this module touches. */
export interface OrchestratorSlotState {
  get(key: string): unknown
  update(key: string, value: unknown): unknown
}

/** The workspace's override, if the user set one; anything else stored reads as none. */
export function readOrchestratorOverride(
  state: Pick<OrchestratorSlotState, 'get'>,
): OrchestratorOverride | undefined {
  const result = teamSnapshotSchema.safeParse(state.get(TEAM_WORKSPACE_KEYS.team))
  const agent = result.success ? result.data.orchestrator?.agent : undefined
  if (agent === undefined || agent.kind === 'external') return
  return {
    modelId: agent.model,
    backend: agent.kind === 'engine' ? 'modelApi' : 'musecode',
    ...(result.success &&
      result.data.orchestrator?.settings !== undefined && {
        settings: result.data.orchestrator.settings,
      }),
  }
}

/** Reset to Default: forget the stored override, so the picker decides again. */
export async function resetOrchestratorSlot(state: OrchestratorSlotState): Promise<void> {
  const result = teamSnapshotSchema.safeParse(state.get(TEAM_WORKSPACE_KEYS.team))
  if (!result.success) return
  const { orchestrator: _orchestrator, orchestratorModel: _model, ...team } = result.data
  await state.update(TEAM_WORKSPACE_KEYS.team, team)
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
What Default resolves to right now: live, not a snapshot. Default takes
the slot's current model and backend (the picker's, or the override), so a
picker change applies to the next delegation.
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

/** The override settings a new conversation actually carries (effort, output cap). */
const CARRIED_OVERRIDE_SETTINGS = ['effort', 'outputCap'] as const

/**
The complete saved settings against the resolved model's current
capabilities, before any session exists. A setting this path does not
carry (temperature and friends) is refused, never ignored; an effort the
model does not serve and a malformed cap are refused, never silently
changed or clamped. Returns the specific translated reason, if any.
*/
export function validateOrchestratorSettings(
  settings: TeamModelSettings | undefined,
  modelId: string,
  capabilities?: TeamSettingCapabilities,
): string | undefined {
  const entries = Object.entries(settings ?? {})
  for (const [key, value] of entries) {
    if (CARRIED_OVERRIDE_SETTINGS.every((carried) => carried !== key))
      return fill(UI_TEXT.teamSettingUnsupported, {
        setting: key,
        value: String(value),
        model: modelId,
      })
  }
  // A setting this path does not carry is refused above, never ignored; an
  // effort the model does not serve and a cap above its maximum are refused
  // here too, never silently changed or clamped.
  return refuseUnservedSetting(settings, modelId, capabilities)
}
