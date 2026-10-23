// Host-owned derived views for U1; all computation is local and costs nothing.
import {
  UI_TEXT,
  TEAM_ROLE_TOOLSETS,
  TEAM_TOOL_GROUPS,
  TEAM_BUILTIN_ROLE_IDS,
  REPO_MAP_CHARS_PER_TOKEN,
  TEAM_INTENSITY_ORDER,
  PERMISSION_MODES,
  TEAM_TOKENS_PER_MTOK,
  TEAM_PREVIEW_OUTPUT_PERCENT,
} from '../../shared/constants'
import { fill, formatNumber } from '../../shared/l10n/text'
import type {
  TeamEditorDocument,
  TeamEditorRole,
  TeamPanelOffer,
  TeamPanelSlice,
} from '../../shared/teamPanel'
import { buildTeamCharter } from './charter'
import { builtinRoles, toolsOfGroups } from './builtInRoles'
import { resolveTeamToolset } from './toolsets'
import { checkRoleCapability } from './capabilityCheck'
import { validateEntryCaps } from './capValidation'
import { TEAM_INTENSITY_SPECS, levelCostPerHour, levelCostLabel } from './intensity'
import {
  buildTeamSuggestions,
  typicalTokensFor,
  type TeamDismissalStore,
  type TeamRoleRecord,
} from './autofill'
import { previewDraft, previewCostLabel, previewSwitchLabel } from './preview'
import { Usd, type UsdAmount } from '../../shared/usd'
import type { TeamModelSettings } from '../../shared/team'
import type { TeamDraft } from './templates'
import { checkTeamAvailability } from '../../shared/teamAvailability'
import { isSameTeamModel } from './sameModel'

function asTemplateDraft(
  document: TeamEditorDocument,
  offers: readonly TeamPanelOffer[],
): TeamDraft {
  return {
    template: document.template,
    roles: document.roles.map((role) => ({
      role: role.role,
      mode: role.workspace ?? 'read-only',
      toolGroups: role.tools ?? [],
      exhausted: role.exhausted ?? 'ask',
      continueOnNext: role.continueOnNext ?? false,
      pool: role.pool.map((entry) => ({
        modelRef:
          entry.agent === undefined
            ? 'default'
            : (offers.find((offer) => isSameAgent(offer, entry.agent))?.ref ??
              `${entry.agent.agentId}/${entry.agent.model}`),
        caps: entry.caps,
        concurrent: entry.concurrent,
      })),
    })),
  }
}
export function isSameAgent(
  offer: TeamPanelOffer,
  agent: TeamPanelOffer['agent'] | undefined,
): boolean {
  return (
    offer.agent.kind === agent?.kind &&
    offer.agent.agentId === agent.agentId &&
    offer.agent.model === agent.model &&
    offer.agent.provider === agent.provider &&
    offer.agent.pays === agent.pays
  )
}
export function allowedGroups(role: string) {
  const builtin = TEAM_BUILTIN_ROLE_IDS.find((id) => id === role)
  return builtin === undefined ? [...TEAM_TOOL_GROUPS] : [...TEAM_ROLE_TOOLSETS[builtin]]
}
function roleCharter(role: TeamEditorRole) {
  const builtin = builtinRoles().find((item) => item.id === role.role)
  const groups = role.tools ?? allowedGroups(role.role)
  const tools = resolveTeamToolset(
    { groups, writePaths: role.writePaths },
    {
      offered: toolsOfGroups(groups),
      webSearchAllowed: true,
      imagesAllowed: true,
      delegates: role.delegates ?? [],
    },
  )
  return buildTeamCharter(
    {
      id: role.role,
      description: role.purpose ?? builtin?.description ?? role.role,
      done: role.done ?? builtin?.done,
      body: role.guidance ?? builtin?.body ?? '',
      workspace: role.workspace ?? builtin?.workspace ?? 'read-only',
      writePaths: role.writePaths ?? builtin?.writePaths,
      report: role.report ?? builtin?.report ?? 'summary',
      delegates: role.delegates ?? [],
    },
    tools,
  )
}
function isSettingValueValid(control: TeamPanelOffer['controls'][number], value: unknown): boolean {
  switch (control.kind) {
    case 'boolean': {
      return typeof value === 'boolean'
    }
    case 'choice': {
      return typeof value === 'string' && (control.choices?.includes(value) ?? false)
    }
    case 'number': {
      return (
        typeof value === 'number' &&
        Number.isFinite(value) &&
        (control.min === undefined || value >= control.min) &&
        (control.max === undefined || value <= control.max)
      )
    }
  }
}
function settingIssues(offer: TeamPanelOffer, settings: TeamModelSettings | undefined): string[] {
  const issues: string[] = []
  const entries = Object.entries(settings ?? {})
  for (const [key, value] of entries) {
    const control = offer.controls.find((item) => item.key === key)
    if (control === undefined || !isSettingValueValid(control, value))
      issues.push(UI_TEXT.teamEditor.invalid)
  }
  return issues
}
function roleIssues(
  role: TeamEditorRole,
  document: TeamEditorDocument,
  offers: readonly TeamPanelOffer[],
  defaultRef: string,
  maximum: number,
): { issues: string[]; warnings: string[] } {
  const issues: string[] = []
  const warnings: string[] = []
  const groups = role.tools ?? allowedGroups(role.role)
  if (groups.some((group) => !allowedGroups(role.role).includes(group)))
    issues.push(UI_TEXT.teamEditor.invalid)
  if (
    role.permissionMode !== undefined &&
    PERMISSION_MODES.every((mode) => mode !== role.permissionMode)
  )
    issues.push(UI_TEXT.teamEditor.invalid)
  if (
    role.delegates?.some(
      (id) => id === role.role || document.roles.every((other) => other.role !== id),
    )
  )
    issues.push(UI_TEXT.teamEditor.invalid)
  const prefixTokens = Math.ceil(roleCharter(role).charter.length / REPO_MAP_CHARS_PER_TOKEN)
  const spec = TEAM_INTENSITY_SPECS[document.intensity]
  for (const entry of role.pool) {
    const offer =
      entry.agent === undefined
        ? offers.find((item) => item.ref === defaultRef)
        : offers.find((item) => isSameAgent(item, entry.agent))
    if (offer === undefined) {
      issues.push(UI_TEXT.teamEntryMissing)
      continue
    }
    const verdict = checkRoleCapability(
      offer.ref,
      { id: role.role, groups },
      { capabilitiesOf: () => offer },
    )
    if (verdict.reason !== undefined) issues.push(verdict.reason)
    warnings.push(...verdict.warnings.map((warning) => warning.message))
    issues.push(
      ...validateEntryCaps(
        entry.caps.map((cap) => ({ ...cap, prefixTokens })),
        {
          usdPerMTok:
            offer.inputRate !== undefined && offer.outputRate !== undefined
              ? offer.inputRate
              : undefined,
          billedToKey: offer.agent.pays === 'key',
        },
        {
          maxConcurrent: Math.min(maximum, offer.ceiling),
          teamDailyBudgetUsd: spec.dailyBudgetUsd,
          teamDailyBudgetTokens: spec.dailyBudgetTokens,
        },
        entry.concurrent,
      ).map((issue) => issue.message),
    )
    const capIds = entry.caps.map((cap) => `${cap.measure}/${cap.window}`)
    if (new Set(capIds).size !== capIds.length) issues.push(UI_TEXT.teamEditor.invalid)
    if (entry.agent === undefined && entry.settings !== undefined)
      issues.push(UI_TEXT.teamEditor.invalid)
    issues.push(...settingIssues(offer, entry.settings))
    if (role.workspace === 'in-place' && offer.agent.kind !== 'engine')
      issues.push(UI_TEXT.teamInPlaceConfirm)
  }
  return { issues: [...new Set(issues)], warnings: [...new Set(warnings)] }
}
interface PreviewStepNeed {
  readonly typical: number
  readonly stepInput: number
  readonly stepOutput: number
  readonly usedTokens: number
  /** Exact decimals: a preview total is money the user reads (M96 review). */
  readonly usedUsd: Usd
  readonly usedTasks: number
  /** Undefined when the entry's model is unpriced; validation refuses dollar caps there. */
  readonly stepUsd: Usd | undefined
}

/** The step's estimated cost on the entry's model, at full input rates. */
function previewStepUsd(
  entry: TeamEditorRole['pool'][number],
  offers: readonly TeamPanelOffer[],
  defaultRef: string,
  stepInput: number,
  stepOutput: number,
): Usd | undefined {
  const offer =
    entry.agent === undefined
      ? offers.find((item) => item.ref === defaultRef)
      : offers.find((item) => isSameAgent(item, entry.agent))
  const inputRate = offer?.inputRate
  const outputRate = offer?.outputRate
  return inputRate === undefined || outputRate === undefined
    ? undefined
    : Usd.from(inputRate)
        .times(stepInput)
        .divide(TEAM_TOKENS_PER_MTOK)
        .add(Usd.from(outputRate).times(stepOutput).divide(TEAM_TOKENS_PER_MTOK))
}

/** Whether one cap leaves room for the preview step: every measure, every window. */
function hasPreviewCapRoom(
  cap: TeamEditorRole['pool'][number]['caps'][number],
  need: PreviewStepNeed,
): boolean {
  switch (cap.measure) {
    case 'tokens': {
      const total = cap.window === 'task' ? need.typical : need.usedTokens + need.typical
      return total <= cap.amount
    }
    case 'inputTokens': {
      const used = need.usedTokens * (1 - TEAM_PREVIEW_OUTPUT_PERCENT / 100)
      const total = cap.window === 'task' ? need.stepInput : used + need.stepInput
      return total <= cap.amount
    }
    case 'outputTokens': {
      const used = need.usedTokens * (TEAM_PREVIEW_OUTPUT_PERCENT / 100)
      const total = cap.window === 'task' ? need.stepOutput : used + need.stepOutput
      return total <= cap.amount
    }
    case 'spendUsd': {
      // An unpriced entry cannot be costed; validation refuses its dollar caps instead.
      if (need.stepUsd === undefined) return true
      const step = cap.window === 'task' ? need.stepUsd : need.usedUsd.add(need.stepUsd)
      return step.compare(Usd.from(cap.amount)) <= 0
    }
    case 'tasks': {
      const total = cap.window === 'task' ? 1 : need.usedTasks + 1
      return total <= cap.amount
    }
  }
}
export function deriveTeamPanel(
  document: TeamEditorDocument,
  offers: TeamPanelOffer[],
  defaultRef: string,
  maxWorkers: number,
  dismissals: TeamDismissalStore,
  sample: TeamPanelSlice['sample'],
  isDirty: boolean,
  hasSavedConfiguration: boolean,
  remainingDailyBudgetUsd: UsdAmount | undefined,
  records: readonly TeamRoleRecord[],
): TeamPanelSlice {
  defaultRef =
    offers.find((offer) => isSameAgent(offer, document.orchestrator?.agent))?.ref ?? defaultRef
  const draft = asTemplateDraft(document, offers)
  const spec = TEAM_INTENSITY_SPECS[document.intensity]
  const roleViews = document.roles.map((role) => ({
    role: role.role,
    name: (() => {
      const id = TEAM_BUILTIN_ROLE_IDS.find((id) => id === role.role)
      return id === undefined ? role.role : UI_TEXT.teamEditorRoles[id]
    })(),
    generated: roleCharter(role).generated,
    allowedTools: allowedGroups(role.role),
    ...roleIssues(role, document, offers, defaultRef, maxWorkers),
    reasons: Object.fromEntries(
      role.pool.map((entry) => [
        entry.id,
        fill(UI_TEXT.teamCapPrefillDefault, {
          amount: formatNumber(
            entry.caps.find((cap) => cap.measure === 'tokens' && cap.window === 'task')?.amount ??
              0,
          ),
          window: UI_TEXT.teamEditor.task,
          role: role.role,
        }),
      ]),
    ),
  }))
  const prices = offers.map((offer) => ({
    modelRef: offer.ref,
    billable: offer.agent.pays === 'key',
    usdPerMTokInput: offer.inputRate,
    usdPerMTokOutput: offer.outputRate,
    usdPerMTokCachedInput: offer.cachedRate,
  }))
  // Per-entry spend and step counts behind the preview's selection, so
  // `day` and `lifetime` dollar and task caps see what earlier steps used.
  const previewSpentUsd = new Map<string, Usd[]>()
  const previewTaskCounts = new Map<string, number[]>()
  const preview = previewDraft({
    draft,
    sample,
    prices,
    resolveDefault: () => defaultRef,
    select: (roleId, _size, spent) => {
      const pool = document.roles.find((role) => role.role === roleId)?.pool ?? []
      const typical = typicalTokensFor(roleId)
      const stepInput = Math.round(typical * (1 - TEAM_PREVIEW_OUTPUT_PERCENT / 100))
      const stepOutput = typical - stepInput
      const usedUsd = previewSpentUsd.get(roleId) ?? []
      const usedTasks = previewTaskCounts.get(roleId) ?? []
      const chosen = pool.findIndex((entry, index) =>
        entry.caps.every((cap) =>
          hasPreviewCapRoom(cap, {
            typical,
            stepInput,
            stepOutput,
            usedTokens: spent[index] ?? 0,
            usedUsd: usedUsd[index] ?? Usd.from(0),
            usedTasks: usedTasks[index] ?? 0,
            stepUsd: previewStepUsd(entry, offers, defaultRef, stepInput, stepOutput),
          }),
        ),
      )
      if (chosen === -1) return chosen
      const placed = pool[chosen]
      if (placed !== undefined) {
        const cost = previewStepUsd(placed, offers, defaultRef, stepInput, stepOutput)
        usedUsd[chosen] = (usedUsd[chosen] ?? Usd.from(0)).add(cost ?? Usd.from(0))
        usedTasks[chosen] = (usedTasks[chosen] ?? 0) + 1
        previewSpentUsd.set(roleId, usedUsd)
        previewTaskCounts.set(roleId, usedTasks)
      }
      return chosen
    },
  })
  const ceilings = { provider: maxWorkers, hard: maxWorkers, machine: maxWorkers }
  const issues = roleViews.flatMap((role) => role.issues)
  const roleIds = document.roles.map((role) => role.role)
  const entryIds = document.roles.flatMap((role) => role.pool.map((entry) => entry.id))
  if (
    new Set(roleIds).size !== roleIds.length ||
    new Set(entryIds).size !== entryIds.length ||
    document.roles.some((role) => role.pool.filter((entry) => entry.agent === undefined).length > 1)
  )
    issues.push(UI_TEXT.teamEditor.invalid)
  const orchestrator = document.orchestrator?.agent
  if (orchestrator !== undefined) {
    const offer = offers.find((item) => isSameAgent(item, orchestrator))
    if (offer === undefined) issues.push(UI_TEXT.teamEntryMissing)
    else if (offer.agent.kind === 'external') issues.push(UI_TEXT.teamEditor.invalid)
    else issues.push(...settingIssues(offer, document.orchestrator?.settings))
  }
  // D217: a delegating draft needs a lead plus a worker. Offers are usable
  // by construction (tool-calling models with limits and a worker kind),
  // so a draft that delegates but offers no second model beside the
  // orchestrator's says how to enable teams instead of saving an
  // unrunnable team. Solo delegates nothing and needs no second model.
  // Key-billed offers count here: paid consent gates runs, not the draft.
  if (document.template !== 'solo') {
    const leadModel =
      document.orchestrator?.agent?.model ??
      offers.find((offer) => offer.ref === defaultRef)?.agent.model ??
      defaultRef.slice(defaultRef.indexOf(':') + 1)
    const availability = checkTeamAvailability({
      isSwitchedOff: false,
      leadModelId: leadModel,
      candidates: offers.map((offer) => ({
        modelId: offer.agent.model,
        billsKey: offer.agent.pays === 'key',
        isAvailable: true,
      })),
      isSameModel: isSameTeamModel,
      teamWorkersOn: true,
    })
    if (!availability.isAvailable) issues.push(UI_TEXT.teamNeedsSecondModel)
  }
  return {
    document,
    offers,
    roleViews,
    suggestions: buildTeamSuggestions({
      draft,
      models: offers.map((offer) => ({
        modelRef: offer.ref,
        vendor: offer.agent.provider ?? offer.agent.agentId,
        usdPerMTokInput: offer.inputRate,
        free: offer.agent.pays === 'local',
      })),
      records,
      dismissals,
      isCapable: (ref, role) =>
        checkRoleCapability(
          ref,
          { id: role, groups: document.roles.find((item) => item.role === role)?.tools ?? [] },
          { capabilitiesOf: () => offers.find((offer) => offer.ref === ref) },
        ).allowed,
      remainingDailyBudgetUsd:
        remainingDailyBudgetUsd !== undefined &&
        Usd.from(remainingDailyBudgetUsd).compare(Usd.from(spec.dailyBudgetUsd)) < 0
          ? remainingDailyBudgetUsd
          : spec.dailyBudgetUsd,
    })
      .filter(
        (item) =>
          item.kind !== 'roleBudget' ||
          (item.amount !== undefined &&
            item.amount > 0 &&
            document.roles
              .find((role) => role.role === item.role)
              ?.pool.some((entry) => {
                const offer =
                  entry.agent === undefined
                    ? offers.find((candidate) => candidate.ref === defaultRef)
                    : offers.find((candidate) => isSameAgent(candidate, entry.agent))
                return (
                  offer?.agent.pays === 'key' &&
                  offer.inputRate !== undefined &&
                  offer.outputRate !== undefined
                )
              }) === true),
      )
      .map((item) => ({ ...item })),
    levelCosts: Object.fromEntries(
      TEAM_INTENSITY_ORDER.map((level) => [
        level,
        levelCostLabel(
          levelCostPerHour(
            level,
            ceilings,
            document.roles.length,
            document.roles
              .map((role) => {
                const agent = role.pool[0]?.agent
                return agent === undefined
                  ? offers.find((item) => item.ref === defaultRef)
                  : offers.find((item) => isSameAgent(item, agent))
              })
              .filter((offer) => offer !== undefined)
              .map((offer) => ({
                billable: offer.agent.pays === 'key',
                usdPerMTok:
                  offer.inputRate === undefined || offer.outputRate === undefined
                    ? undefined
                    : (offer.inputRate + offer.outputRate) / 2,
                cachedUsdPerMTok:
                  offer.cachedRate === undefined || offer.outputRate === undefined
                    ? undefined
                    : (offer.cachedRate + offer.outputRate) / 2,
              })),
          ),
        ),
      ]),
    ),
    sample,
    preview: {
      cost: previewCostLabel(preview),
      switches: previewSwitchLabel(preview),
      steps: preview.steps.map((step) => ({
        role: step.role,
        model: step.modelRef,
        switched: step.switched,
      })),
      unstaffed: [...preview.unstaffedRoles],
    },
    dirty: isDirty,
    hasSavedConfiguration,
    issues: [...new Set(issues)],
    defaultRef,
    maxWorkers,
  }
}
