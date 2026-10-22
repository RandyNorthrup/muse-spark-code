import { UI_TEXT, TEAM_EXPORT_FORMAT, TEAM_PANEL_EXPORT_VERSION } from '../../shared/constants'
import { TEAM_WORKSPACE_KEYS } from '../../shared/teamConversation'
import {
  teamEditorDocumentSchema,
  teamPanelOfferSchema,
  teamPanelMessageSchema,
  type TeamEditorDocument,
  type TeamEditorRole,
  type TeamPanelOffer,
  type TeamPanelMessage,
  type TeamPanelSlice,
} from '../../shared/teamPanel'
import type { TeamStatePort } from './teamHostService'
import { buildTemplateDraft, type TeamTemplateId } from './templates'
import { TEAM_INTENSITY_SPECS, runningForLevel } from './intensity'
import { shiftEffort, roleBaseEffort } from './modelSettings'
import { fill } from '../../shared/l10n/text'
import { teamSnapshotSchema } from '../../shared/team'
import { builtinRoles } from './builtInRoles'
import { allowedGroups, deriveTeamPanel, isSameAgent } from './teamPanelViews'
import type { TeamRoleRecord } from './autofill'
import { Usd, type UsdAmount } from '../../shared/usd'
import { teamPanelExportSchema } from '../../shared/teamPanel'

export interface TeamPanelDeps {
  readonly isEnabled: () => boolean
  readonly isTrusted: () => boolean
  readonly state: TeamStatePort
  readonly offers: () => Promise<readonly TeamPanelOffer[]>
  readonly defaultRef: () => string
  readonly maxWorkers: () => number
  /**
  The shared daily budget left today (M96): undefined when no daily budget
  is set, which constrains nothing. A set budget that reads negative is
  invalid.
  */
  readonly remainingDailyBudgetUsd: () => UsdAmount | Promise<UsdAmount | undefined>
  readonly records: () => readonly TeamRoleRecord[] | Promise<readonly TeamRoleRecord[]>
  readonly newId: () => string
  readonly reload: () => void
  readonly confirmInPlace: () => Promise<boolean>
  readonly confirmOrchestrator: (modelRef: string | undefined) => Promise<void>
  readonly writeExport: (text: string) => Promise<void>
  readonly readImport: () => Promise<string | undefined>
  readonly dryRun?:
    | {
        readonly cost: () => string
        readonly run: (
          document: TeamEditorDocument,
          sample: TeamPanelSlice['sample'],
          signal: AbortSignal,
        ) => Promise<unknown>
      }
    | undefined
}
export interface TeamPanelController {
  readonly read: () => Promise<TeamPanelSlice | undefined>
  readonly handle: (message: TeamPanelMessage) => Promise<void>
  readonly dispose: () => void
}
const DISMISSALS_KEY = 'museSpark.team.suggestionDismissals'

const entryOf = (role: TeamEditorRole, id: string) => {
  const entry = role.pool.find((item) => item.id === id)
  if (entry === undefined) throw new Error(UI_TEXT.teamEntryMissing)
  return entry
}

/** One tab's draft. The panel host serializes calls; dispose invalidates async work. */
export function createTeamPanelController(deps: TeamPanelDeps): TeamPanelController {
  let document: TeamEditorDocument | undefined
  let offers: TeamPanelOffer[] = []
  let sample: TeamPanelSlice['sample'] = 'feature-tests'
  let isDirty = false
  let isDisposed = false
  let notice: string | undefined
  let trying: AbortController | undefined
  const confirmedInPlace = new Set<string>()
  const dismissed = new Set<string>()
  const storedDismissals = deps.state.get(DISMISSALS_KEY)
  if (Array.isArray(storedDismissals))
    for (const value of storedDismissals) if (typeof value === 'string') dismissed.add(value)
  const dismissals = {
    isDismissed: (role: string, kind: string) => dismissed.has(`${role}/${kind}`),
    dismiss: (role: string, kind: string) => {
      dismissed.add(`${role}/${kind}`)
    },
  }
  const assertOpen = () => {
    if (isDisposed || !deps.isEnabled() || !deps.isTrusted())
      throw new Error(UI_TEXT.teamEditor.invalid)
  }
  const empty = (): TeamEditorDocument => ({ roles: [], intensity: 'balanced', template: 'custom' })
  const loadStored = (): TeamEditorDocument => {
    const raw = deps.state.get(TEAM_WORKSPACE_KEYS.team)
    const parsed = teamEditorDocumentSchema.safeParse(raw)
    if (raw === undefined) return empty()
    if (parsed.success) return parsed.data
    const legacy = teamSnapshotSchema.safeParse(raw)
    if (!legacy.success) throw new Error(UI_TEXT.teamEditor.invalid)
    return { ...legacy.data, template: 'custom' }
  }
  const current = (): TeamEditorDocument => {
    assertOpen()
    document ??= loadStored()
    return document
  }
  const view = async () => {
    const [budget, history] = await Promise.allSettled([
      (async () => await deps.remainingDailyBudgetUsd())(),
      (async () => await deps.records())(),
    ])
    assertOpen()
    if (budget.status === 'rejected')
      throw new Error(UI_TEXT.teamBudgetUnavailable, { cause: budget.reason })
    if (history.status === 'rejected')
      throw new Error(UI_TEXT.teamBudgetUnavailable, { cause: history.reason })
    const remaining = budget.value === undefined ? undefined : Usd.from(budget.value)
    if (remaining !== undefined && remaining.compare(Usd.from(0)) < 0)
      throw new Error(UI_TEXT.teamEditor.invalid)
    return deriveTeamPanel(
      current(),
      offers,
      deps.defaultRef(),
      deps.maxWorkers(),
      dismissals,
      sample,
      isDirty,
      deps.state.get(TEAM_WORKSPACE_KEYS.team) !== undefined,
      remaining?.toAmount(),
      history.value,
    )
  }
  const roleOf = (id: string) => {
    const role = current().roles.find((item) => item.role === id)
    if (role === undefined) throw new Error(fill(UI_TEXT.teamRoleNotFound, { role: id }))
    return role
  }
  const offerOf = (ref: string) => {
    const offer = offers.find((item) => item.ref === ref)
    if (offer === undefined) throw new Error(UI_TEXT.teamEntryMissing)
    return offer
  }
  const resolvedDefaultRef = () =>
    offers.find((offer) => isSameAgent(offer, current().orchestrator?.agent))?.ref ??
    deps.defaultRef()
  const defaultCeiling = () =>
    offers.find((item) => item.ref === resolvedDefaultRef())?.ceiling ?? deps.maxWorkers()
  const defaultConcurrent = () =>
    Math.max(
      1,
      runningForLevel(current().intensity, {
        provider: defaultCeiling(),
        hard: deps.maxWorkers(),
        machine: deps.maxWorkers(),
      }),
    )
  const makeEntry = (role: string, ref: string) => {
    const spec = TEAM_INTENSITY_SPECS[current().intensity]
    // Default is live, not a snapshot (D75): it runs on the orchestrator
    // slot's model, so a Default entry carries that model's ceiling, not
    // the machine limit. An unsaved orchestrator override resolves first.
    // A Default entry stays agent-free (its marker) and settings-free
    // (validation refuses settings on Default); only its ceiling follows
    // the resolved model.
    const offer = ref === 'default' ? undefined : offerOf(ref)
    const ceiling = ref === 'default' ? defaultCeiling() : (offer?.ceiling ?? deps.maxWorkers())
    return {
      id: deps.newId(),
      ...(offer !== undefined && { agent: offer.agent }),
      concurrent: Math.max(
        1,
        runningForLevel(current().intensity, {
          provider: ceiling,
          hard: deps.maxWorkers(),
          machine: deps.maxWorkers(),
        }),
      ),
      caps: [
        { measure: 'tokens' as const, window: 'task' as const, amount: spec.tokensPerTask },
        { measure: 'tokens' as const, window: 'day' as const, amount: spec.dailyBudgetTokens },
      ],
      ...(offer?.controls.some((control) => control.key === 'effort') === true && {
        settings: {
          effort: shiftEffort(
            roleBaseEffort(role),
            spec.effortSteps,
            offer.controls.find((control) => control.key === 'effort')?.choices ?? [],
          ),
        },
      }),
    }
  }
  const makeRole = (id: string): TeamEditorRole => {
    const builtin = builtinRoles().find((item) => item.id === id)
    return {
      role: id,
      workspace: builtin?.workspace ?? 'read-only',
      tools: builtin === undefined ? ['read', 'codeIntel', 'report'] : allowedGroups(id),
      writePaths: builtin?.writePaths === undefined ? undefined : [...builtin.writePaths],
      report: builtin?.report ?? 'summary',
      exhausted: 'ask',
      pool: [makeEntry(id, 'default')],
      purpose: builtin?.description,
      done: builtin?.done,
      guidance: builtin?.body,
      custom: false,
    }
  }
  const applyLevel = (role: TeamEditorRole) => {
    role.pool = role.pool.map((entry) => {
      const ref =
        entry.agent === undefined
          ? 'default'
          : offers.find((offer) => isSameAgent(offer, entry.agent))?.ref
      if (ref === undefined) return entry
      const next = makeEntry(role.role, ref)
      return {
        ...entry,
        concurrent: next.concurrent,
        caps: next.caps,
        // Merging two absent settings must stay absent: validation
        // refuses any settings object on a Default entry.
        ...((entry.settings ?? next.settings) !== undefined && {
          settings: { ...entry.settings, ...next.settings },
        }),
      }
    })
    role.custom = false
  }
  const template = (id: TeamTemplateId) => {
    document = { ...empty(), template: id, intensity: current().intensity }
    confirmedInPlace.clear()
    const draft = buildTemplateDraft(
      id,
      offers
        .filter((offer) => offer.toolCalling)
        .map((offer) => ({
          modelRef: offer.ref,
          vendor: offer.agent.provider ?? offer.agent.agentId,
          payKind: offer.agent.pays,
        })),
    )
    document.roles = draft.roles.map((role) => {
      const result = makeRole(role.role)
      result.pool = role.pool.map((entry) => makeEntry(role.role, entry.modelRef))
      if (result.pool.every((entry) => entry.agent !== undefined))
        result.pool.push(makeEntry(role.role, 'default'))
      return result
    })
  }
  const handle = async (raw: TeamPanelMessage) => {
    assertOpen()
    const parsed = teamPanelMessageSchema.safeParse(raw)
    if (!parsed.success) throw new Error(UI_TEXT.teamEditor.invalid)
    const message = parsed.data
    const draft = current()
    notice = undefined
    switch (message.type) {
      case 'roles/template': {
        template(message.template)
        break
      }
      case 'roles/addRole': {
        if (draft.roles.some((role) => role.role === message.role))
          throw new Error(UI_TEXT.teamEditor.invalid)
        draft.roles.push(makeRole(message.role))
        break
      }
      case 'roles/removeRole': {
        roleOf(message.role)
        draft.roles = draft.roles.filter((role) => role.role !== message.role)
        break
      }
      case 'roles/updateRole': {
        const role = roleOf(message.role)
        if (message.fields.workspace === 'in-place' && role.workspace !== 'in-place') {
          if (role.pool.some((entry) => entry.agent !== undefined && entry.agent.kind !== 'engine'))
            throw new Error(UI_TEXT.teamInPlaceConfirm)
          if (!(await deps.confirmInPlace())) return
          assertOpen()
          confirmedInPlace.add(role.role)
        }
        Object.assign(role, message.fields, { custom: true })
        break
      }
      case 'roles/addEntry': {
        const role = roleOf(message.role)
        if (message.modelRef === 'default' && role.pool.some((entry) => entry.agent === undefined))
          throw new Error(UI_TEXT.teamEditor.invalid)
        const entry = makeEntry(role.role, message.modelRef)
        role.pool = [
          ...role.pool.filter((item) => item.agent !== undefined),
          entry,
          ...role.pool.filter((item) => item.agent === undefined),
        ]
        role.custom = true
        break
      }
      case 'roles/removeEntry': {
        const role = roleOf(message.role)
        entryOf(role, message.entryId)
        role.pool = role.pool.filter((entry) => entry.id !== message.entryId)
        role.custom = true
        break
      }
      case 'roles/moveEntry': {
        const role = roleOf(message.role)
        const entry = entryOf(role, message.entryId)
        if (message.to >= role.pool.length) throw new Error(UI_TEXT.teamEditor.invalid)
        const pool = role.pool.filter((item) => item.id !== entry.id)
        pool.splice(message.to, 0, entry)
        role.pool = pool
        role.custom = true
        break
      }
      case 'roles/updateEntry': {
        const role = roleOf(message.role)
        Object.assign(entryOf(role, message.entryId), message.fields)
        role.custom = true
        break
      }
      case 'roles/cap': {
        const role = roleOf(message.role)
        const entry = entryOf(role, message.entryId)
        if (message.index > entry.caps.length) throw new Error(UI_TEXT.teamEditor.invalid)
        if (message.cap === undefined) entry.caps.splice(message.index, 1)
        else
          entry.caps.splice(message.index, message.index === entry.caps.length ? 0 : 1, message.cap)
        role.custom = true
        break
      }
      case 'roles/orchestrator': {
        draft.orchestrator =
          message.modelRef === undefined
            ? undefined
            : { agent: offerOf(message.modelRef).agent, settings: message.settings }
        draft.orchestratorModel = draft.orchestrator?.agent?.model
        // Default follows the resolved model's ceiling. A custom role keeps
        // its manual concurrency unless that ceiling requires lowering it.
        for (const role of draft.roles)
          for (const entry of role.pool)
            if (entry.agent === undefined)
              entry.concurrent =
                role.custom === true
                  ? Math.min(entry.concurrent, defaultCeiling(), deps.maxWorkers())
                  : defaultConcurrent()
        break
      }
      case 'roles/intensity': {
        draft.intensity = message.level
        for (const role of draft.roles) if (role.custom !== true) applyLevel(role)
        break
      }
      case 'roles/reapply': {
        applyLevel(roleOf(message.role))
        break
      }
      case 'roles/suggestion': {
        const derived = await view()
        const suggestion = derived.suggestions.find(
          (item) => item.role === message.role && item.kind === message.kind,
        )
        if (suggestion === undefined) throw new Error(UI_TEXT.teamEditor.invalid)
        if (message.decision === 'dismiss') {
          const key = `${message.role}/${message.kind}`
          await deps.state.update(DISMISSALS_KEY, [...dismissed, key])
          assertOpen()
          dismissed.add(key)
        } else if (suggestion.modelRef !== undefined) {
          const previousIds = new Set(roleOf(message.role).pool.map((entry) => entry.id))
          await handle({
            type: 'roles/addEntry',
            role: message.role,
            modelRef: suggestion.modelRef,
          })
          if (suggestion.kind !== 'poolFallback') {
            const pool = roleOf(message.role).pool
            const added = pool.find((entry) => !previousIds.has(entry.id))
            if (added !== undefined)
              roleOf(message.role).pool = [added, ...pool.filter((entry) => entry.id !== added.id)]
          }
        } else if (suggestion.amount !== undefined) {
          const role = roleOf(message.role)
          // The suggestion names the role's share of the remaining budget
          // (D75); the meters count caps per entry, so the share is split
          // across the priced entries rather than copied onto each one.
          const priced = role.pool.filter((entry) => {
            const offer =
              entry.agent === undefined
                ? offers.find((item) => item.ref === derived.defaultRef)
                : offers.find((item) => isSameAgent(item, entry.agent))
            return (
              offer?.agent.pays === 'key' &&
              offer.inputRate !== undefined &&
              offer.outputRate !== undefined
            )
          })
          if (priced.length === 0) throw new Error(UI_TEXT.teamEditor.invalid)
          for (const entry of priced) {
            entry.caps = [
              ...entry.caps.filter((cap) => cap.measure !== 'spendUsd' || cap.window !== 'day'),
              {
                measure: 'spendUsd',
                window: 'day',
                amount: suggestion.amount / priced.length,
              },
            ]
          }
          role.custom = true
        }
        break
      }
      case 'roles/preview': {
        sample = message.sample
        return
      }
      case 'roles/try': {
        if (deps.dryRun === undefined) throw new Error(UI_TEXT.teamEditor.invalid)
        const derived = await view()
        if (derived.issues.length > 0) throw new Error(UI_TEXT.teamEditor.invalid)
        if (trying !== undefined) throw new Error(UI_TEXT.teamEditor.invalid)
        const abort = new AbortController()
        trying = abort
        try {
          const result = await deps.dryRun.run(
            teamEditorDocumentSchema.parse(draft),
            sample,
            abort.signal,
          )
          if (typeof result === 'string') notice = result
        } finally {
          trying = undefined
        }
        assertOpen()
        return
      }
      case 'roles/reset': {
        document = loadStored()
        confirmedInPlace.clear()
        isDirty = false
        return
      }
      case 'roles/save': {
        const derived = await view()
        if (derived.issues.length > 0) throw new Error(UI_TEXT.teamEditor.invalid)
        for (const role of draft.roles)
          if (role.workspace === 'in-place' && !confirmedInPlace.has(role.role)) {
            if (!(await deps.confirmInPlace())) return
            assertOpen()
            confirmedInPlace.add(role.role)
          }
        const parsedDocument = teamEditorDocumentSchema.parse(draft)
        const ref =
          draft.orchestrator?.agent === undefined
            ? undefined
            : offers.find((offer) => isSameAgent(offer, draft.orchestrator?.agent))?.ref
        await deps.confirmOrchestrator(ref)
        assertOpen()
        await deps.state.update(TEAM_WORKSPACE_KEYS.team, parsedDocument)
        if (isDisposed) return
        deps.reload()
        isDirty = false
        notice = UI_TEXT.teamEditor.saved
        return
      }
      case 'roles/import': {
        const text = await deps.readImport()
        assertOpen()
        if (text === undefined) return
        const rawImport: unknown = JSON.parse(text)
        const imported = teamPanelExportSchema.safeParse(rawImport)
        if (!imported.success) throw new Error(UI_TEXT.teamEditor.invalid)
        document = imported.data.document
        confirmedInPlace.clear()
        notice = UI_TEXT.teamImportDraft
        break
      }
      case 'roles/export': {
        await deps.writeExport(
          JSON.stringify(
            { format: TEAM_EXPORT_FORMAT, version: TEAM_PANEL_EXPORT_VERSION, document: draft },
            null,
            2,
          ),
        )
        assertOpen()
        return
      }
      default: {
        throw new Error(UI_TEXT.teamEditor.invalid)
      }
    }
    isDirty = true
  }
  return {
    read: async () => {
      if (isDisposed || !deps.isEnabled() || !deps.isTrusted()) return
      assertOpen()
      const found = await deps.offers()
      assertOpen()
      offers = found.map((offer) => teamPanelOfferSchema.parse(offer))
      const slice = await view()
      slice.notice = notice
      if (deps.dryRun !== undefined) slice.dryRunCost = deps.dryRun.cost()
      return slice
    },
    handle,
    dispose: () => {
      isDisposed = true
      trying?.abort()
      document = undefined
      offers = []
    },
  }
}
