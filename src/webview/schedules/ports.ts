// Editor-independent bindings. W supplies S/U's request handler and T's
// preview; M104 bridges supply the same ports without importing VS Code.
import * as z from 'zod/mini'
import type { ReactNode } from 'react'
import { SCHEDULE_PREVIEW_COUNT } from '../../shared/constants'
import type { ScheduleSourceCapability } from '../../shared/scheduleEvents'
import type { ScheduleDraft, ScheduleRequest, ScheduleTarget } from '../../shared/scheduleV2'
import { type scheduleResponseSchema, type scheduleViewV2Schema } from '../../shared/scheduleV2'

export type ScheduleView = z.infer<typeof scheduleViewV2Schema>
export type ScheduleResponse = z.infer<typeof scheduleResponseSchema>
export type EventSources = Extract<ScheduleResponse, { kind: 'eventSources' }>['sources']
export type GrantAudit = Extract<ScheduleResponse, { kind: 'grantAudit' }>['entries']

export const schedulePreviewSchema = z.discriminatedUnion('available', [
  z.strictObject({
    available: z.literal(true),
    times: z.array(z.int().check(z.gte(0))).check(z.maxLength(SCHEDULE_PREVIEW_COUNT)),
  }),
  z.strictObject({ available: z.literal(false), reason: z.string().check(z.minLength(1)) }),
])

export interface ScheduleSurfacePort {
  // Unknown at the boundary: every consumer parses the frozen contract.
  request(request: ScheduleRequest): Promise<unknown>
  preview(draft: ScheduleDraft): Promise<unknown>
}

export interface ScheduleTargetChoice {
  readonly id: string
  readonly label: string
  readonly target: ScheduleTarget
  readonly capability: ScheduleSourceCapability
}

export interface ScheduleSurfaceProps {
  readonly port: ScheduleSurfacePort
  readonly workspaceKey: string
  readonly targets: readonly ScheduleTargetChoice[]
  readonly defaultDraft: ScheduleDraft
  /** RA/M113 provides the verified destination picker; no local fake sender. */
  readonly reportAction?: {
    readonly capability: ScheduleSourceCapability
    readonly initial: Extract<ScheduleDraft['action'], { kind: 'report' }>
    render(
      action: Extract<ScheduleDraft['action'], { kind: 'report' }>,
      onChange: (action: Extract<ScheduleDraft['action'], { kind: 'report' }>) => void,
    ): ReactNode
  }
  readonly paid?: {
    readonly model: string
    readonly price: string
    readonly sharedDailyBudgetUsd: number
  }
  readonly nowMs: number
  readonly initialView?: 'list' | 'timeline' | 'editor'
  readonly onClose?: () => void
}
