// Lane R (M96, PLAN.md D75): the capability check when a model joins a role.
//
// The Roles section checks each entry's model against the role's needs. It
// refuses a model without tool calling or below `TEAM_ROLE_MIN_CONTEXT_TOKENS`,
// and warns about the recommended window, image input, reasoning and unknown
// capabilities. The warnings show on the entry; a refused model cannot be
// saved into that role. Capabilities come through one adapter (lane R reads
// M95's registry through it), so the tests use a fake catalogue.

import {
  TEAM_ROLE_MIN_CONTEXT_TOKENS,
  TEAM_ROLE_RECOMMENDED_CONTEXT_TOKENS,
  UI_TEXT,
  type TeamToolGroup,
} from '../../shared/constants'
import { fill } from '../../shared/l10n/text'

/** What the check knows about a model: unknown fields warn, never refuse. */
export interface TeamModelCapabilities {
  readonly toolCalling: boolean
  /** Input window in tokens; undefined means unknown. */
  readonly contextWindow?: number | undefined
  readonly imageInput?: boolean | undefined
  readonly reasoning?: boolean | undefined
}

/** One adapter to the model catalogue (M95's registry when D74 lands). */
export interface TeamCapabilitySource {
  /** A model's capabilities, or undefined when the model is unknown. */
  readonly capabilitiesOf: (model: string) => TeamModelCapabilities | undefined
}

export type TeamCapabilityWarningCode = 'window' | 'images' | 'reasoning' | 'unknown'

export interface TeamCapabilityWarning {
  readonly code: TeamCapabilityWarningCode
  readonly message: string
}

export interface TeamCapabilityVerdict {
  readonly allowed: boolean
  /** Why the model cannot be saved into the role; set only when refused. */
  readonly reason?: string | undefined
  readonly warnings: readonly TeamCapabilityWarning[]
}

/** The role an entry joins: its id and its groups. */
export interface TeamCapabilityRole {
  readonly id: string
  readonly groups: readonly TeamToolGroup[]
}

function recommendedWindow(roleId: string): number {
  return (TEAM_ROLE_RECOMMENDED_CONTEXT_TOKENS as Readonly<Record<string, number>>)[roleId] ?? 65_536
}

function needsReasoning(roleId: string): boolean {
  return roleId === 'engineering' || roleId === 'code-review'
}

function unknownWarning(model: string, roleId: string): TeamCapabilityWarning {
  return {
    code: 'unknown',
    message: fill(UI_TEXT.teamCapabilityUnknown, { model, role: roleId }),
  }
}

/**
 * Whether `model` may be saved into `role`: refused without tool calling
 * or below the minimum window, warned otherwise. An unknown model or an
 * unknown field warns; it never refuses.
 */
export function checkRoleCapability(
  model: string,
  role: TeamCapabilityRole,
  source: TeamCapabilitySource,
): TeamCapabilityVerdict {
  const capabilities = source.capabilitiesOf(model)
  if (capabilities === undefined) {
    return { allowed: true, warnings: [unknownWarning(model, role.id)] }
  }
  if (!capabilities.toolCalling) {
    return {
      allowed: false,
      reason: fill(UI_TEXT.teamCapabilityNoTools, { role: role.id }),
      warnings: [],
    }
  }
  if (capabilities.contextWindow !== undefined && capabilities.contextWindow < TEAM_ROLE_MIN_CONTEXT_TOKENS) {
    return {
      allowed: false,
      reason: fill(UI_TEXT.teamCapabilitySmallWindow, {
        tokens: capabilities.contextWindow,
        minimum: TEAM_ROLE_MIN_CONTEXT_TOKENS,
      }),
      warnings: [],
    }
  }
  const warnings: TeamCapabilityWarning[] = []
  const recommended = recommendedWindow(role.id)
  if (capabilities.contextWindow === undefined) {
    warnings.push(unknownWarning(model, role.id))
  } else if (capabilities.contextWindow < recommended) {
    warnings.push({
      code: 'window',
      message: fill(UI_TEXT.teamCapabilityWarnWindow, {
        tokens: capabilities.contextWindow,
        recommended,
        role: role.id,
      }),
    })
  }
  const wantsImages = role.groups.includes('images') || role.id === 'design'
  if (capabilities.imageInput === undefined) {
    if (wantsImages && !warnings.some((warning) => warning.code === 'unknown')) {
      warnings.push(unknownWarning(model, role.id))
    }
  } else if (!capabilities.imageInput && wantsImages) {
    warnings.push({
      code: 'images',
      message: fill(UI_TEXT.teamCapabilityWarnImages, { role: role.id }),
    })
  }
  if (capabilities.reasoning === undefined) {
    if (needsReasoning(role.id) && !warnings.some((warning) => warning.code === 'unknown')) {
      warnings.push(unknownWarning(model, role.id))
    }
  } else if (!capabilities.reasoning && needsReasoning(role.id)) {
    warnings.push({
      code: 'reasoning',
      message: fill(UI_TEXT.teamCapabilityWarnReasoning, { role: role.id }),
    })
  }
  return { allowed: true, warnings }
}
