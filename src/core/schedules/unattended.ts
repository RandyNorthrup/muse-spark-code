import type { UsdAmount } from '../../shared/usd'
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
import { confineWorkspacePath, isBelow, type RealPathIo } from '../workspacePath'
import { isProtectedPath } from '../protectedPaths'
import type { ScheduleGrantAudit } from './grantAudit'
import type { SessionBudgetClaim } from '../backends/modelapi/sessionBudget'
import type { ModelApiClientDeps } from '../backends/modelapi/client'
import nodePath from 'node:path'
import type { ContentSource } from './provenance'
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
      reservationUsd?: UsdAmount,
    ): Promise<SessionBudgetClaim>
  }
}

/** The run object never crosses a wire, persists a credential or opens a modal. */
export class UnattendedRun {
  private canonicalRoot: Promise<string> | undefined
  public readonly context: ScheduleRunContext
  public readonly refusedActions: {
    actionClass: ScheduleApprovalAction['class']
    tool: string
    reason: string
  }[] = []
  /** The sole paid reservation port for this fire, shared by every modality. */
  public readonly reservePaidRequest: NonNullable<ModelApiClientDeps['reservePaidRequest']> =
    async (body, feature, tokens, signal = new AbortController().signal, reservationUsd) => {
      try {
        if (
          !this.allowsPaid(feature) ||
          this.paid === undefined ||
          ('input' in body &&
            body.tools.some((tool) => tool.type === 'web_search') &&
            !this.allowsPaid('webSearch'))
        )
          throw new Error(this.modelText.paidRefused)
        return await this.paid.reserve(body, tokens, signal, reservationUsd)
      } catch (error: unknown) {
        this.refuse(
          {
            id: this.context.scheduleId,
            class: 'paidExtra',
            tool: feature,
            paths: [],
            requiresAsking: false,
            protectedPath: false,
          },
          this.modelText.paidRefused,
        )
        throw error
      }
    }

  public constructor(private readonly deps: ScheduleRunDeps) {
    this.context = scheduleRunContextSchema.parse(deps.context)
  }
  private async decideAction(
    action: ScheduleApprovalAction,
    requiresApproval: boolean,
    capturedPath?: string,
  ): Promise<{ allowed: boolean; reason?: string }> {
    action = scheduleApprovalActionSchema.parse(action)
    let reason: string | undefined
    if (action.class === 'physical') reason = this.modelText.physicalRefused
    else if (action.class === 'protectedPath' || action.protectedPath)
      reason = this.modelText.protectedRefused
    else if (action.class === 'requiresAsking' || action.requiresAsking)
      reason = this.modelText.requiresAskingRefused
    else if (!this.isActive()) reason = this.modelText.approvalRefused
    const canonical: string[] = []
    if (reason === undefined) {
      for (const path of action.paths) {
        const p = this.deps.platform === 'win32' ? nodePath.win32 : nodePath.posix
        let root: string
        try {
          root = await (this.canonicalRoot ??= this.deps.io.realPath(this.deps.workspaceRoot))
        } catch {
          reason = this.modelText.protectedRefused
          break
        }
        const relative =
          capturedPath === undefined
            ? undefined
            : p.relative(root, capturedPath).replaceAll('\\', '/')
        const given =
          p.isAbsolute(path) && isBelow(p.relative(root, path), p) ? p.relative(root, path) : path
        const confined =
          capturedPath === undefined
            ? await confineWorkspacePath(this.deps.workspaceRoot, given, this.deps.platform, {
                realPath: async (absolute) =>
                  absolute === this.deps.workspaceRoot
                    ? root
                    : await this.deps.io.realPath(absolute),
              })
            : {
                ok: relative !== undefined && isBelow(relative.split('/').join(p.sep), p),
                relative: relative ?? '',
                canonical: relative ?? '',
              }
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
    const checked = { ...action, paths: canonical }
    reason ??= this.deps.safety(checked, `schedule:${this.context.scheduleId}`)
    if (reason !== undefined) return { allowed: false, reason: this.refuse(action, reason) }
    if (!requiresApproval) return { allowed: this.isActive() }
    const grant = await this.deps.readGrant()
    const rule = grant === undefined ? undefined : this.deps.matcher.matches(grant, checked)
    const captured = this.deps.matcher.matches(this.context.grant, checked)
    if (rule === undefined || captured === undefined || !this.isActive()) {
      return { allowed: false, reason: this.refuse(action, this.modelText.approvalRefused) }
    }
    try {
      await this.deps.audit({
        scheduleId: this.context.scheduleId,
        atMs: this.deps.now(),
        kind: 'used',
        runId: this.context.runId,
        ruleId: rule.id,
        actionClass: action.class,
      })
    } catch {
      return { allowed: false, reason: this.refuse(action, this.modelText.approvalRefused) }
    }
    return this.isActive()
      ? { allowed: true }
      : { allowed: false, reason: this.refuse(action, this.modelText.approvalRefused) }
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
    requiresApproval = !(this.context.mode === 'acceptEdits' && action.class === 'edit'),
  ): Promise<{ allowed: boolean; reason?: string }> {
    return await this.decideAction(action, requiresApproval)
  }

  /** Cached bytes are authorized against the source captured when read. */
  public async decideSource(
    source: ContentSource,
    id: string,
  ): Promise<{ allowed: boolean; reason?: string }> {
    if (source.kind === 'git')
      return {
        allowed: false,
        reason: this.refuse(
          {
            id,
            class: 'mcp',
            tool: 'cached-git',
            paths: [source.root + '/.git'],
            requiresAsking: false,
            protectedPath: true,
          },
          this.modelText.protectedRefused,
        ),
      }
    if (source.kind !== 'file' && source.kind !== 'skill' && source.kind !== 'directory')
      return { allowed: false }
    if (source.kind === 'directory') {
      for (const recordedPath of source.paths) {
        const path = recordedPath.replaceAll('\\', '/')
        const decision = await this.decideAction(
          {
            id,
            class: 'mcp',
            tool: 'cached-index',
            paths: [path],
            requiresAsking: false,
            protectedPath: false,
          },
          false,
          path,
        )
        if (!decision.allowed) return decision
      }
      return { allowed: this.isActive() }
    }
    const path = source.file.path.replaceAll('\\', '/')
    return await this.decideAction(
      {
        id,
        class: 'mcp',
        tool: 'cached-context',
        paths: [path],
        requiresAsking: false,
        protectedPath: false,
      },
      false,
      path,
    )
  }

  public async defer(event: Extract<AgentEvent, { type: 'questionRequested' }>): Promise<string> {
    await this.deps.deferQuestions(event, this.context)
    return this.modelText.questionsDeferred
  }
  /** Named attachments have a confined source; anonymous bytes cannot prove one. */
  public async checkParts(parts: readonly TurnPart[]): Promise<void> {
    for (const part of parts) {
      if (part.type === 'text') continue
      const isNamed = part.type === 'file' || part.type === 'textFile'
      const decision = await this.decide(
        {
          id: this.context.scheduleId,
          class: 'mcp',
          tool: 'attachment',
          paths: isNamed ? [part.name] : [],
          requiresAsking: !isNamed,
          protectedPath: false,
        },
        false,
      )
      if (!decision.allowed) throw new Error(decision.reason ?? this.modelText.approvalRefused)
    }
  }

  public allowsPaid(feature: PaidFeature, requiresAsking = false): boolean {
    return (
      !requiresAsking &&
      this.isActive() &&
      this.context.grant.paidCapUsd !== '0' &&
      this.paid?.allows(feature) === true
    )
  }
}

/** D/X use these entry points; ordinary AgentSession methods keep their existing behavior. */
export interface ScheduledAgentSession extends AgentSession {
  /** W binds host-owned IDE tools/hooks to the same run safety and paid scope. */
  getScheduledRun(turnId?: string): UnattendedRun | undefined
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
