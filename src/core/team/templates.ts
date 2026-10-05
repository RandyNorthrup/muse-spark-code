// Team templates (M96 lane F, PLAN.md D75): Solo, Pair, Full team and
// Custom. Choosing one prefills the workspace draft — roles with their
// workspace modes and tool sets, and suggested pools from the agents and
// models the user has — which the user then adjusts in the Roles section
// (lane U1). Pure; no `vscode` import.
//
// Seams for the parallel lanes (kept as explicit interfaces, never fakes):
// - roles, charters and tool sets are lane R's; the draft carries the role
//   key, the mode and the tool-group names from `TEAM_ROLE_TOOLSETS`
//   (lane 0), and lane R's charter generator fills the charter text.
// - pools, caps and selection are lane A's; the draft carries ordered model
//   references with prefilled caps, and lane A resolves them.
// - the model catalogue, capabilities and price cards are M95's; here they
//   arrive as the injected `TeamAgentOffer` list.

import { UI_TEXT } from '../../shared/constants'
import { fill } from '../../shared/l10n/text'

/** The seven built-in role keys (D75). Custom roles add their own keys. */
export type TeamRoleKey =
  'research' | 'design' | 'marketing' | 'engineering' | 'qa' | 'code-review' | 'docs'

export const BUILT_IN_ROLE_KEYS: readonly TeamRoleKey[] = [
  'research',
  'design',
  'engineering',
  'qa',
  'code-review',
  'docs',
  'marketing',
]

/** Where a role's workers run (D75's workspace modes). */
export type TeamWorkspaceMode = 'read-only' | 'own-branch' | 'in-place'

/** A cap on a pool entry: a measure, an amount and its window (D75). */
export interface TeamCapDraft {
  readonly measure: 'tokens' | 'inputTokens' | 'outputTokens' | 'spendUsd' | 'tasks'
  readonly window: 'task' | 'day' | 'lifetime'
  readonly amount: number
}

/** One pool entry in the draft: a model reference with its own limits. */
export interface TeamEntryDraft {
  /** M95's model reference, or `default` for the orchestrator slot's model. */
  readonly modelRef: string
  readonly caps: readonly TeamCapDraft[]
  readonly concurrent?: number
}

/** One role in the draft: its key, mode, tool groups and ordered pool. */
export interface TeamRoleDraft {
  readonly role: string
  readonly mode: TeamWorkspaceMode
  /** Tool-group names from `TEAM_ROLE_TOOLSETS` (lane 0). */
  readonly toolGroups: readonly string[]
  readonly pool: readonly TeamEntryDraft[]
  readonly exhausted?: 'ask' | 'queue' | 'self'
  readonly continueOnNext?: boolean
}

/** The unsaved workspace draft a template prefills. */
export interface TeamDraft {
  readonly template: TeamTemplateId
  readonly roles: readonly TeamRoleDraft[]
}

/** The four templates (D75). */
export type TeamTemplateId = 'solo' | 'pair' | 'full' | 'custom'

export const TEAM_TEMPLATES: readonly TeamTemplateId[] = ['solo', 'pair', 'full', 'custom']

/**
 * An agent or model the user has, offered as a pool entry (M95's picker
 * rows reduced to what the templates need: the reference, its vendor and
 * which backend pays for it).
 */
export interface TeamAgentOffer {
  readonly modelRef: string
  readonly vendor: string
  /** Who pays: a key bills dollars, a subscription spends plan limits. */
  readonly payKind: 'key' | 'subscription' | 'local'
}

/**
 * Typical use per role in tokens per task (D75). The starting value before
 * the local record has five tasks here; autofill (lane F) follows the
 * record after that.
 */
export const TEAM_ROLE_TYPICAL_TASK_TOKENS: Readonly<Record<TeamRoleKey, number>> = {
  research: 150_000,
  design: 80_000,
  marketing: 40_000,
  engineering: 400_000,
  qa: 200_000,
  'code-review': 120_000,
  docs: 60_000,
}

/** A template's name in the display language. */
export function templateName(template: TeamTemplateId): string {
  switch (template) {
    case 'solo': {
      return UI_TEXT.teamTemplateSolo
    }
    case 'pair': {
      return UI_TEXT.teamTemplatePair
    }
    case 'full': {
      return UI_TEXT.teamTemplateFull
    }
    case 'custom': {
      return UI_TEXT.teamTemplateCustom
    }
  }
}

/** The roles a template staffs. Solo staffs none: delegation is off. */
export function templateRoles(template: TeamTemplateId): readonly TeamRoleKey[] {
  switch (template) {
    case 'solo': {
      return []
    }
    case 'pair': {
      return ['engineering', 'code-review']
    }
    case 'full': {
      return ['research', 'design', 'engineering', 'qa', 'code-review', 'docs']
    }
    case 'custom': {
      return []
    }
  }
}

/**
 * The workspace mode a fresh role starts in. Writers share clones on
 * branches; reviewers and readers start read-only.
 */
export function defaultModeFor(role: TeamRoleKey): TeamWorkspaceMode {
  switch (role) {
    case 'research':
    case 'code-review': {
      return 'read-only'
    }
    case 'design':
    case 'marketing':
    case 'engineering':
    case 'qa':
    case 'docs': {
      return 'own-branch'
    }
  }
}

/** The tool groups a fresh role starts with (lane R owns the definition). */
export function defaultToolGroupsFor(role: TeamRoleKey): readonly string[] {
  switch (role) {
    case 'research': {
      return [
        'read',
        'codeIntel',
        'readOnlyShell',
        'webFetch',
        'webSearch',
        'memoryRead',
        'skills',
        'report',
      ]
    }
    case 'design': {
      return ['read', 'write', 'webFetch', 'images', 'skills', 'report']
    }
    case 'marketing': {
      return ['read', 'write', 'webFetch', 'webSearch', 'images', 'skills', 'report']
    }
    case 'engineering': {
      return [
        'read',
        'codeIntel',
        'rename',
        'write',
        'shell',
        'checks',
        'diagnostics',
        'webFetch',
        'memoryRead',
        'skills',
        'report',
      ]
    }
    case 'qa': {
      return [
        'read',
        'codeIntel',
        'write',
        'testShell',
        'checks',
        'diagnostics',
        'skills',
        'report',
      ]
    }
    case 'code-review': {
      return ['read', 'codeIntel', 'readOnlyShell', 'diagnostics', 'skills', 'report']
    }
    case 'docs': {
      return ['read', 'codeIntel', 'write', 'skills', 'report']
    }
  }
}

/** The prefilled `task` token cap for a role: its typical use. */
export function prefilledTaskCap(role: TeamRoleKey): TeamCapDraft {
  return {
    measure: 'tokens',
    window: 'task',
    amount: TEAM_ROLE_TYPICAL_TASK_TOKENS[role],
  }
}

/**
 * Builds the draft for a template from the agents the user has. Entries
 * come from the offers in order: the first offer staffs the first role,
 * and Pair puts `code-review` on another vendor where one is offered
 * (the owner's own split: Muse codes, Codex reviews). Roles the offers
 * cannot staff resolve to Default downstream (lanes A and T).
 */
export function buildTemplateDraft(
  template: TeamTemplateId,
  offers: readonly TeamAgentOffer[],
): TeamDraft {
  const roles = templateRoles(template)
  if (template === 'pair') {
    return { template, roles: buildPairRoles(offers) }
  }
  return {
    template,
    roles: roles.map((role, index) => ({
      role,
      mode: defaultModeFor(role),
      toolGroups: defaultToolGroupsFor(role),
      pool: poolFor(role, offers, index),
    })),
  }
}

function poolFor(
  role: TeamRoleKey,
  offers: readonly TeamAgentOffer[],
  index: number,
): readonly TeamEntryDraft[] {
  if (offers.length === 0) {
    return []
  }
  const offer = offers[index % offers.length]
  return offer === undefined ? [] : [{ modelRef: offer.modelRef, caps: [prefilledTaskCap(role)] }]
}

function buildPairRoles(offers: readonly TeamAgentOffer[]): readonly TeamRoleDraft[] {
  const [first, ...rest] = offers
  const reviewer = rest.find((offer) => offer.vendor !== first?.vendor) ?? rest[0]
  return [
    {
      role: 'engineering',
      mode: defaultModeFor('engineering'),
      toolGroups: defaultToolGroupsFor('engineering'),
      pool:
        first === undefined
          ? []
          : [{ modelRef: first.modelRef, caps: [prefilledTaskCap('engineering')] }],
    },
    {
      role: 'code-review',
      mode: defaultModeFor('code-review'),
      toolGroups: defaultToolGroupsFor('code-review'),
      pool:
        reviewer === undefined
          ? []
          : [{ modelRef: reviewer.modelRef, caps: [prefilledTaskCap('code-review')] }],
    },
  ]
}

/** The guided first run's steps (D75): template, agents, pools, limits, preview. */
export function setupStepLabel(step: number): string {
  return fill(UI_TEXT.teamSetupStep, { step })
}
