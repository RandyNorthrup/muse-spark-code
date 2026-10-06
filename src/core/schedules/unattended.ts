import type { AgentSession, TurnPart, TurnSubmission } from '../agent/agentBackend'
import type { AgentEvent } from '../../shared/agentEvents'
import { UI_TEXT, type PaidFeature } from '../../shared/constants'
import { fill } from '../../shared/l10n/text'
import {
  scheduleApprovalActionSchema,
  scheduleRunContextSchema,
  type ScheduleApprovalAction,
  type ScheduleGrant,
  type ScheduleGrantMatcher,
  type ScheduleRunContext,
} from '../../shared/scheduleV2'
import { confineWorkspacePath, type RealPathIo } from '../workspacePath'
import { isProtectedPath } from '../protectedPaths'
import type { ScheduleGrantAudit } from './grantAudit'
import type { SessionBudgetClaim } from '../backends/modelapi/sessionBudget'
import type { CreateResponseBody, CreateImageBody } from '../backends/modelapi/schemas'

/** W supplies SCHEDULE_MODEL_TEXT from its declared lazy bundle readers. */
export interface ScheduleModelText {
  readonly unattendedNote: string
  readonly approvalRefused: string
  readonly physicalRefused: string
  readonly protectedRefused: string
  readonly requiresAskingRefused: string
  readonly paidRefused: string
  readonly questionsDeferred: string
}

export interface ScheduleRunDeps {
  readonly context: ScheduleRunContext
  readonly modelText: ScheduleModelText
  readonly workspaceRoot: string
  readonly platform: NodeJS.Platform
  readonly io: RealPathIo
  readonly matcher: ScheduleGrantMatcher
  readonly now: () => number
  readonly readGrant: () => Promise<ScheduleGrant | undefined>
  /** Revocation, mode/model/key changes and governor admission remain live. */
  readonly isActive: () => boolean
  readonly audit: (entry: ScheduleGrantAudit) => Promise<void>
  readonly row: (text: string) => void
  readonly deferQuestions: (
    event: Extract<AgentEvent, { type: 'questionRequested' }>,
    context: ScheduleRunContext,
  ) => Promise<void>
  /** M103/M109 bind physical/requiresAsking/D65 and schedule-scoped vault policy. */
  readonly safety: (action: ScheduleApprovalAction, requesterId: string) => string | undefined
  readonly paid?: {
    readonly modelId: string
    readonly accountId: string
    allows(feature: PaidFeature): boolean
    reserve(
      body: CreateResponseBody | CreateImageBody,
      estimatedInputTokens: number | undefined,
      signal: AbortSignal,
    ): Promise<SessionBudgetClaim>
  }
}

/** The run object never crosses a wire, persists a credential or opens a modal. */
export class UnattendedRun {
  public readonly context: ScheduleRunContext
  public readonly refusedActions: {
    actionClass: ScheduleApprovalAction['class']
    tool: string
    reason: string
  }[] = []
  public constructor(private readonly deps: ScheduleRunDeps) {
    this.context = scheduleRunContextSchema.parse(deps.context)
  }
  public get modelText(): ScheduleModelText {
    return this.deps.modelText
  }
  public get paid(): ScheduleRunDeps['paid'] {
    return this.deps.paid
  }
  public isActive(): boolean {
    return this.deps.isActive()
  }
  public parts(parts: readonly TurnPart[]): readonly TurnPart[] {
    return [...parts, { type: 'text', text: this.modelText.unattendedNote }]
  }
  public refuse(action: ScheduleApprovalAction, reason: string): string {
    this.refusedActions.push({ actionClass: action.class, tool: action.tool, reason })
    this.deps.row(fill(UI_TEXT.scheduleV2.messages.unattendedRefusal, { action: action.tool }))
    return reason
  }
  public async decide(
    action: ScheduleApprovalAction,
    requiresApproval = true,
  ): Promise<{ allowed: boolean; reason?: string }> {
    action = scheduleApprovalActionSchema.parse(action)
    let reason: string | undefined
    if (action.class === 'physical') reason = this.modelText.physicalRefused
    else if (action.class === 'protectedPath' || action.protectedPath)
      reason = this.modelText.protectedRefused
    else if (action.class === 'requiresAsking' || action.requiresAsking)
      reason = this.modelText.requiresAskingRefused
    else if (this.isActive())
      reason = this.deps.safety(action, `schedule:${this.context.scheduleId}`)
    else reason = this.modelText.approvalRefused
    const canonical: string[] = []
    if (reason === undefined) {
      for (const path of action.paths) {
        const confined = await confineWorkspacePath(
          this.deps.workspaceRoot,
          path,
          this.deps.platform,
          this.deps.io,
        )
        if (
          !confined.ok ||
          isProtectedPath(confined.relative) ||
          isProtectedPath(confined.canonical)
        ) {
          reason = this.modelText.protectedRefused
          break
        }
        canonical.push(confined.canonical)
      }
    }
    if (reason !== undefined) return { allowed: false, reason: this.refuse(action, reason) }
    if (!requiresApproval) return { allowed: this.isActive() }
    const grant = await this.deps.readGrant()
    const checked = { ...action, paths: canonical }
    const rule = grant === undefined ? undefined : this.deps.matcher.matches(grant, checked)
    const captured = this.deps.matcher.matches(this.context.grant, checked)
    if (rule === undefined || captured === undefined || !this.isActive()) {
      return { allowed: false, reason: this.refuse(action, this.modelText.approvalRefused) }
    }
    await this.deps.audit({
      scheduleId: this.context.scheduleId,
      atMs: this.deps.now(),
      kind: 'used',
      runId: this.context.runId,
      ruleId: rule.id,
      actionClass: action.class,
    })
    return this.isActive()
      ? { allowed: true }
      : { allowed: false, reason: this.refuse(action, this.modelText.approvalRefused) }
  }
  public async defer(event: Extract<AgentEvent, { type: 'questionRequested' }>): Promise<string> {
    await this.deps.deferQuestions(event, this.context)
    return this.modelText.questionsDeferred
  }
  public allowsPaid(feature: PaidFeature, requiresAsking = false): boolean {
    return !requiresAsking && this.isActive() && this.paid?.allows(feature) === true
  }
}

/** D/X use these entry points; ordinary AgentSession methods keep their existing behavior. */
export interface ScheduledAgentSession extends AgentSession {
  sendScheduledTurn(
    parts: readonly TurnPart[],
    run: UnattendedRun,
    displayText?: string,
  ): Promise<TurnSubmission>
  steerScheduledTurn(
    expectedTurnId: string,
    parts: readonly TurnPart[],
    run: UnattendedRun,
  ): Promise<TurnSubmission>
}
