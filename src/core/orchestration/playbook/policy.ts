import {
  defaultPlaybookSettings,
  playbookDesignDecisionSchema,
  playbookRecordSchema,
  playbookRoundSchema,
  playbookSettingsSchema,
  playbookWhyNoteSchema,
  type PlaybookAction,
  type PlaybookBoard,
  type PlaybookCheck,
  type PlaybookCheckDecision,
  type PlaybookCommand,
  type PlaybookConfigurableRule,
  type PlaybookDecision,
  type PlaybookDesignDecision,
  type PlaybookLane,
  type PlaybookModule,
  type PlaybookOrderDecision,
  type PlaybookPolicy,
  type PlaybookRecord,
  type PlaybookReportItem,
  type PlaybookRequester,
  type PlaybookReviewAgents,
  type PlaybookRound,
  type PlaybookSettings,
  type PlaybookWhyNote,
} from '../../../shared/playbook'
import {
  parseReviewBlock,
  type ReviewBlock,
  type ReviewResolution,
} from '../../../shared/reviewFindings'
import { UI_TEXT } from '../../../shared/l10n/text'
import { actionIdentity, commandBlock } from './guard'
import { retainRecords, validatedRecords, type PlaybookJournal } from './journal'
import {
  hasOverlappingFiles,
  moduleStates,
  normalizedModule,
  predecessorIds,
  type ModuleState,
} from './modules'
import {
  hasReadyContracts,
  mergeBlock,
  missingPrerequisites,
  orderedLanes,
  type PlaybookDrillRequirements,
} from './planning'
import {
  hasCompleteIds,
  areFindingsAnswered,
  redesignBlock,
  resolutionOutcome,
  hasReviewConflict,
  reviewCoverage,
  reviewRounds,
  type OverrideAuthority,
} from './review'

export interface PlaybookPolicyOptions {
  readonly journal: PlaybookJournal
  readonly teamId: string
  readonly now: () => number
  /** Bound to trusted harness authority, never to a model's actor field. */
  readonly authorizeOverride: OverrideAuthority
  readonly drillRequirements: PlaybookDrillRequirements
  readonly checkAdmission: PlaybookCheckAdmission
}

/** I binds this to M107/the runner's actual resource admission. Policy selects
 * a target; a missing governor is never replaced by an allow implementation. */
export interface PlaybookCheckAdmission {
  admit(check: PlaybookCheck, target: PlaybookCheckDecision['target']): boolean
}

/** No effect is admitted until its evidence and why-note are published.
 * Every entrypoint reloads the shared journal; concurrent/stale writers fail
 * comparison instead of overwriting another team's strikes or refusals. */
export class OrchestratorPlaybook implements PlaybookPolicy {
  private records: PlaybookRecord[] = []
  private expected: readonly unknown[] = []
  private states = new Map<string, ModuleState>()
  private settings: PlaybookSettings

  constructor(private readonly options: PlaybookPolicyOptions) {
    this.settings = defaultPlaybookSettings(options.teamId)
    this.refresh()
  }

  private refresh(): void {
    this.expected = this.options.journal.read()
    this.records = validatedRecords(this.expected)
    this.states = moduleStates(this.records)
    this.settings = defaultPlaybookSettings(this.options.teamId)
    for (const record of this.records)
      if (record.kind === 'settings' && record.value.teamId === this.options.teamId)
        this.settings = record.value
  }

  private publish(records: readonly PlaybookRecord[]): void {
    const next = validatedRecords(retainRecords([...this.records, ...records]))
    const states = moduleStates(next)
    this.options.journal.replace(next, this.expected)
    this.expected = next
    this.records = next
    this.states = states
  }

  private note(
    rule: PlaybookWhyNote['rule'],
    code: PlaybookWhyNote['code'],
    fields: Partial<PlaybookWhyNote> = {},
  ): PlaybookWhyNote {
    return playbookWhyNoteSchema.parse({
      ...fields,
      rule,
      code,
      at: this.options.now(),
      needsUser: fields.needsUser ?? false,
    })
  }

  private decide(
    kind: PlaybookDecision['kind'],
    rule: PlaybookWhyNote['rule'],
    code: PlaybookWhyNote['code'] = 'checksPassed',
    fields: Partial<PlaybookWhyNote> = {},
  ): PlaybookDecision {
    const note = this.note(rule, code, fields)
    this.publish([{ kind: 'note', value: note }])
    const safe = validatedRecords([{ kind: 'note', value: note }])[0]
    if (safe?.kind !== 'note') throw new Error(UI_TEXT.playbookUnavailable)
    return { kind, note: safe.value }
  }

  private on(rule: PlaybookConfigurableRule): boolean {
    return this.settings.rules[rule].enabled
  }

  private moduleNote(state: ModuleState): Pick<PlaybookWhyNote, 'module' | 'round' | 'classes'> {
    return {
      module: state.module.key,
      round: state.counts.get(undefined),
      classes: [
        ...new Set(
          state.current?.findings.flatMap((finding) => (finding.class ? [finding.class] : [])),
        ),
      ],
    }
  }

  private strikeRefusal(state: ModuleState): PlaybookDecision | undefined {
    const code = this.on('threeStrikes')
      ? redesignBlock(state, this.settings.patchRoundsMax)
      : undefined
    return code
      ? this.decide('refuse', 'threeStrikes', code, {
          ...this.moduleNote(state),
          needsUser: code === 'redesignEscalated' || state.design?.outcome === 'caught',
        })
      : undefined
  }

  private passed(
    rule: PlaybookConfigurableRule,
    fields: Partial<PlaybookWhyNote> = {},
  ): PlaybookDecision {
    const setting = this.settings.rules[rule]
    return setting.enabled
      ? this.decide('allow', rule, 'checksPassed', fields)
      : this.decide('allow', rule, 'ruleDisabled', {
          ...fields,
          actor: setting.actor,
          reason: setting.reason,
        })
  }

  private declare(
    input: PlaybookModule,
    override?: Extract<PlaybookRecord, { kind: 'module' }>['value']['override'],
  ): PlaybookDecision | undefined {
    const module = normalizedModule(input)
    const existing = this.states.get(module.id)
    if (
      existing?.module.key === module.key &&
      JSON.stringify(existing.module.files) === JSON.stringify(module.files)
    )
      return undefined
    const predecessors = predecessorIds(module)
    const isInvalidLineage =
      new Set(predecessors).size !== predecessors.length ||
      predecessors.some((id) => !this.states.has(id)) ||
      (module.lineage !== undefined &&
        'renamedFrom' in module.lineage &&
        module.lineage.renamedFrom !== module.id) ||
      (module.lineage !== undefined &&
        !('renamedFrom' in module.lineage) &&
        (predecessors.includes(module.id) || existing !== undefined))
    const overlap = [...this.states]
      .map(([, state]) => state)
      .filter(
        (state) =>
          (state.counts.get(undefined) ?? 0) > 0 &&
          (hasOverlappingFiles(module, state.module) || module.key === state.module.key),
      )
    const isUnlinked =
      (existing !== undefined && predecessors.length === 0) ||
      overlap.some((state) => !predecessors.includes(state.module.id))
    const isAuthorized =
      override !== undefined && this.options.authorizeOverride(override, module.id)
    if (isInvalidLineage || (isUnlinked && !isAuthorized))
      return this.decide('refuse', 'threeStrikes', 'lineageRequired', {
        module: module.key,
        needsUser: true,
      })
    const value = playbookRecordSchema.parse({
      kind: 'module',
      value: { module, ...(isAuthorized && { override }), at: this.options.now() },
    })
    this.publish([value])
    return undefined
  }

  private state(input: PlaybookModule): ModuleState | PlaybookDecision {
    const refusal = this.declare(input)
    if (refusal) return refusal
    const state = this.states.get(input.id)
    if (!state) throw new Error(UI_TEXT.playbookUnavailable)
    return state
  }

  private reviewAdmission(
    module: PlaybookModule,
    agents: PlaybookReviewAgents,
  ): PlaybookDecision | undefined {
    if (hasReviewConflict(agents))
      return this.decide('refuse', 'onePassReview', 'reviewerConflict', {
        module: module.key,
        needsUser: true,
      })
    const state = this.state(module)
    if ('kind' in state) return state
    if (!areFindingsAnswered(state, this.options.authorizeOverride, this.on('onePassReview')))
      return this.decide('refuse', 'onePassReview', 'answersPending', { module: module.key })
    return this.on('threeStrikes') &&
      state.strikes > this.settings.patchRoundsMax &&
      (!state.design || state.design.outcome === 'impossible')
      ? this.decide('refuse', 'threeStrikes', 'designRequired', { module: module.key })
      : undefined
  }

  getRecord(): readonly PlaybookRecord[] {
    this.refresh()
    return structuredClone(this.records)
  }
  getSettings(): PlaybookSettings {
    this.refresh()
    return structuredClone(this.settings)
  }

  updateSettings(settings: PlaybookSettings): PlaybookDecision {
    this.refresh()
    const parsed = playbookSettingsSchema.parse(settings)
    if (parsed.teamId !== this.options.teamId) throw new Error(UI_TEXT.playbookUnavailable)
    this.publish([{ kind: 'settings', value: parsed }])
    return this.decide('allow', 'threeStrikes')
  }

  declareModule(
    input: PlaybookModule,
    override?: Extract<PlaybookRecord, { kind: 'module' }>['value']['override'],
  ): PlaybookDecision {
    this.refresh()
    return (
      this.declare(input, override) ??
      this.decide('allow', 'threeStrikes', 'checksPassed', { module: input.key })
    )
  }

  beforeFixRound(module: PlaybookModule): PlaybookDecision {
    this.refresh()
    const state = this.state(module)
    return 'kind' in state
      ? state
      : (this.strikeRefusal(state) ?? this.passed('threeStrikes', { module: state.module.key }))
  }

  beforeReview(module: PlaybookModule, agents: PlaybookReviewAgents): PlaybookDecision {
    this.refresh()
    return (
      this.reviewAdmission(module, agents) ?? this.passed('onePassReview', { module: module.key })
    )
  }

  afterReview(
    module: PlaybookModule,
    input: ReviewBlock,
    agents: PlaybookReviewAgents,
  ): PlaybookDecision {
    this.refresh()
    const refusal = this.reviewAdmission(module, agents)
    if (refusal) return refusal
    const review = parseReviewBlock(JSON.stringify(input))
    if (!review) throw new Error(UI_TEXT.playbookUnavailable)
    const coverage = reviewCoverage(review)
    if (this.on('onePassReview') && coverage.length > 0)
      return this.decide('refuse', 'onePassReview', 'coverageIncomplete', {
        module: module.key,
        classes: coverage,
      })
    const state = this.states.get(module.id)
    if (!state) throw new Error(UI_TEXT.playbookUnavailable)
    if (
      this.on('threeStrikes') &&
      state.current?.findings.length &&
      state.strikes > this.settings.patchRoundsMax &&
      (!state.design || state.design.outcome === 'impossible')
    )
      return this.decide('refuse', 'threeStrikes', 'designRequired', { module: module.key })
    const redesign = state.design && state.design.outcome !== 'impossible'
    if (
      redesign &&
      !hasCompleteIds(
        state.current?.findings.map((finding) => finding.id) ?? [],
        review.resolution?.map((item) => item.findingId) ?? [],
      )
    )
      return this.decide('refuse', 'threeStrikes', 'redesignOpen', { module: module.key })
    const rounds = reviewRounds(state.module, state, review, agents, this.options.now())
    const records: PlaybookRecord[] = rounds.map((value) => ({ kind: 'round', value }))
    if (redesign && state.design)
      records.push({
        kind: 'design',
        value: {
          ...state.design,
          outcome: rounds[0]?.findings.some(
            (finding) => !state.current?.findings.some((prior) => prior.id === finding.id),
          )
            ? 'remains'
            : resolutionOutcome(review.resolution ?? []),
        },
      })
    this.publish(records)
    const next = this.states.get(module.id)
    const code =
      next && this.on('threeStrikes')
        ? redesignBlock(next, this.settings.patchRoundsMax)
        : undefined
    return this.decide(code ? 'refuse' : 'allow', 'threeStrikes', code, {
      module: module.key,
      round: next?.counts.get(undefined),
      classes: [
        ...new Set(
          rounds[0]?.findings.flatMap((finding) => (finding.class ? [finding.class] : [])),
        ),
      ],
      needsUser: code === 'redesignEscalated' || next?.design?.outcome === 'caught',
    })
  }

  answerFindings(module: PlaybookModule, answers: PlaybookRound['answers']): PlaybookDecision {
    this.refresh()
    const state = this.state(module)
    if ('kind' in state) return state
    const current = state.current
    if (
      !current ||
      !hasCompleteIds(
        current.findings.map((finding) => finding.id),
        answers.map((answer) => answer.findingId),
      )
    )
      return this.decide('refuse', 'onePassReview', 'answersPending', { module: module.key })
    const round = playbookRoundSchema.parse({ ...current, module: state.module, answers })
    if (!areFindingsAnswered({ ...state, current: round }, this.options.authorizeOverride))
      return this.decide('refuse', 'onePassReview', 'answersPending', { module: module.key })
    this.publish([{ kind: 'round', value: round }])
    return this.decide('allow', 'onePassReview', 'checksPassed', { module: module.key })
  }

  recordDesignDecision(input: PlaybookDesignDecision): PlaybookDecision {
    this.refresh()
    const decision = playbookDesignDecisionSchema.parse(input)
    const state = this.state(decision.module)
    if ('kind' in state) return state
    if (
      decision.outcome !== 'pending' ||
      !state.current?.findings.length ||
      this.records.some((record) => record.kind === 'design' && record.value.id === decision.id)
    )
      return this.decide('refuse', 'threeStrikes', 'designRequired', {
        module: decision.module.key,
      })
    this.publish([{ kind: 'design', value: { ...decision, module: state.module } }])
    return this.decide('allow', 'threeStrikes', 'checksPassed', { module: decision.module.key })
  }

  resolveRedesign(
    module: PlaybookModule,
    resolutions: readonly ReviewResolution[],
  ): PlaybookDecision {
    this.refresh()
    const state = this.state(module)
    if ('kind' in state) return state
    // Structural closure is accepted only as part of a complete, independent
    // redesign review. This convenience seam can report its persisted result,
    // never turn model-supplied resolution text into a review by itself.
    if (
      state.current?.phase !== 'redesign' ||
      !state.design ||
      JSON.stringify(state.current.resolution) !== JSON.stringify(resolutions)
    )
      return this.decide('refuse', 'threeStrikes', 'redesignOpen', { module: module.key })
    const openCode = state.design.outcome === 'remains' ? 'redesignEscalated' : 'redesignOpen'
    const code = state.design.outcome === 'impossible' ? 'checksPassed' : openCode
    return this.decide(code === 'checksPassed' ? 'allow' : 'refuse', 'threeStrikes', code, {
      module: module.key,
      needsUser: code === 'redesignEscalated' || state.design.outcome === 'caught',
    })
  }

  beforeDispatch(lane: PlaybookLane, board: PlaybookBoard): PlaybookDecision {
    this.refresh()
    if (this.on('contractsFirst') && lane.kind !== 'contracts' && !hasReadyContracts(lane, board))
      return this.decide('refuse', 'contractsFirst', 'contractsPending', { laneId: lane.id })
    const missing = missingPrerequisites(lane, board)
    if (this.on('contractsFirst') && missing.length > 0)
      return this.decide('refuse', 'contractsFirst', 'prerequisiteMissing', {
        laneId: lane.id,
        missing,
      })
    const state = this.state(lane.module)
    if ('kind' in state) return state
    if (this.on('threeStrikes')) {
      if (
        lane.kind === 'redesign' &&
        (state.design?.outcome !== 'pending' ||
          state.design.redesignLane !== lane.id ||
          state.design.id !== lane.designDecisionId)
      )
        return this.decide('refuse', 'threeStrikes', 'designRequired', {
          module: lane.module.key,
          laneId: lane.id,
        })
      if (lane.kind !== 'redesign') return this.beforeFixRound(lane.module)
    }
    return this.passed('contractsFirst', { laneId: lane.id })
  }

  beforeMerge(lane: PlaybookLane): PlaybookDecision {
    this.refresh()
    const block = mergeBlock(
      lane,
      this.options.drillRequirements,
      this.on('breakOnPurpose'),
      this.on('continuousIntegration'),
    )
    if (block)
      return this.decide(
        'refuse',
        block === 'drillMissing' ? 'breakOnPurpose' : 'continuousIntegration',
        block,
        { laneId: lane.id },
      )
    const state = this.state(lane.module)
    if ('kind' in state) return state
    return areFindingsAnswered(state, this.options.authorizeOverride)
      ? (this.strikeRefusal(state) ?? this.passed('continuousIntegration', { laneId: lane.id }))
      : this.decide('refuse', 'onePassReview', 'answersPending', { module: lane.module.key })
  }

  beforeCommand(command: PlaybookCommand, _requester: PlaybookRequester): PlaybookDecision {
    this.refresh()
    const code = commandBlock(command, this.records, this.options.now())
    return this.decide(code ? 'refuse' : 'allow', 'neverAround', code, {
      ...(code && { module: actionIdentity(command) }),
      needsUser: code !== undefined,
    })
  }

  recordRefusal(
    action: PlaybookAction,
    requester: PlaybookRequester,
    source: 'permission' | 'classifier',
  ): void {
    this.refresh()
    this.decide(
      'refuse',
      'neverAround',
      source === 'classifier' ? 'classifierBlocked' : 'permissionLaundering',
      { module: actionIdentity(action), actor: requester.agentId, needsUser: true },
    )
  }

  beforeCheck(
    check: PlaybookCheck,
    board: PlaybookBoard,
  ): PlaybookCheckDecision | { readonly kind: 'refuse'; readonly note: PlaybookWhyNote } {
    this.refresh()
    const worker =
      this.on('offload') && check.heavy
        ? board.workers
            .filter((candidate) => candidate.available)
            .toSorted((a, b) => Number(a.id > b.id) - Number(a.id < b.id))[0]
        : undefined
    const localTarget: PlaybookCheckDecision['target'] = worker
      ? { kind: 'worker', id: worker.id }
      : { kind: 'local' }
    const target: PlaybookCheckDecision['target'] =
      this.on('offload') && check.fullGate && board.hasCi ? { kind: 'ci' } : localTarget
    const localCode = target.kind === 'worker' ? 'offloaded' : 'localCheck'
    const code = target.kind === 'ci' ? 'ciGate' : localCode
    if (!this.options.checkAdmission.admit(check, target))
      return {
        kind: 'refuse',
        note: this.decide('refuse', 'offload', 'prerequisiteMissing', {
          laneId: check.id,
          missing: ['resourceGovernor'],
        }).note,
      }
    const decision = this.on('offload')
      ? this.decide('allow', 'offload', code, {
          ...(target.kind === 'worker' && { workerId: target.id }),
        })
      : this.passed('offload')
    return { kind: 'allow', target, note: decision.note }
  }

  order(
    queue: readonly PlaybookLane[],
  ): PlaybookOrderDecision | { readonly kind: 'refuse'; readonly note: PlaybookWhyNote } {
    this.refresh()
    const ordered = orderedLanes(queue)
    if ('missing' in ordered)
      return {
        kind: 'refuse',
        note: this.decide('refuse', 'smallFirst', 'prerequisiteMissing', {
          missing: ordered.missing,
          laneId: queue[0]?.id ?? 'queue',
        }).note,
      }
    const isEnabled = this.on('smallFirst')
    const decision = isEnabled
      ? this.decide('allow', 'smallFirst', 'reordered')
      : this.passed('smallFirst')
    return {
      kind: 'allow',
      queue: structuredClone(isEnabled ? ordered.queue : queue),
      notes: [decision.note],
    }
  }

  orderReport(items: readonly PlaybookReportItem[]): {
    readonly items: readonly PlaybookReportItem[]
    readonly note: PlaybookWhyNote
  } {
    this.refresh()
    const ordered = [...items]
    if (this.on('loudFailures'))
      ordered.sort(
        (a, b) =>
          Number(b.needsUser) - Number(a.needsUser) || Number(b.failing) - Number(a.failing),
      )
    const decision = this.on('loudFailures')
      ? this.decide('allow', 'loudFailures', 'ownerFirst')
      : this.passed('loudFailures')
    return { items: structuredClone(ordered), note: decision.note }
  }
}
