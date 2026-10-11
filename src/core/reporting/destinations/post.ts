import { UI_TEXT } from '../../../shared/constants'
import { reportScrubber, type ReportRedaction } from '../render/redaction'
import {
  reportDeliveryReceiptSchema,
  reportPostTargetSchema,
  type ReportDeliveryPayload,
  type ReportDestination,
  type ReportDeliveryReceipt,
} from './types'

type PostTarget = Extract<ReportDestination, { type: 'post' }>['target']
export interface ReportPostPort {
  // N/M71 bind the user's existing sign-in (or their own gh); this module
  // receives neither a token nor an HTTP/MSP body. Wire schemas stay in N.
  isEnabled(kind: string, target: PostTarget): Promise<boolean>
  isConfirmed(kind: string, target: PostTarget): Promise<boolean>
  previewAndConfirm(kind: string, target: PostTarget, fullMarkdown: string): Promise<boolean>
  rememberConfirmation(kind: string, target: PostTarget): Promise<void>
  // statusIssue edits the user's selected pinned issue in place; other kinds
  // add a comment. The binding persists the post id for occurrence idempotency.
  publish(
    target: PostTarget,
    markdown: string,
    context: { readonly requester: string; readonly idempotencyKey: string },
  ): Promise<unknown>
}
export class ReportPostDelivery {
  constructor(
    private readonly port: ReportPostPort,
    private readonly redaction: ReportRedaction = {},
  ) {}
  private body(payload: ReportDeliveryPayload): string {
    return reportScrubber(this.redaction)(
      `${payload.markdown}\n\n${UI_TEXT.reportUi.automatedNote}\n`,
    )
  }
  async confirm(target: PostTarget, payload: ReportDeliveryPayload): Promise<boolean> {
    const checked = reportPostTargetSchema.parse(target)
    const kind = payload.document.header.kind
    if (!(await this.port.isEnabled(kind, checked))) return false
    if (await this.port.isConfirmed(kind, checked)) return true
    if (!(await this.port.previewAndConfirm(kind, checked, this.body(payload)))) return false
    await this.port.rememberConfirmation(kind, checked)
    return true
  }
  async post(
    scheduleId: string,
    destinationId: string,
    target: PostTarget,
    payload: ReportDeliveryPayload,
  ): Promise<ReportDeliveryReceipt> {
    const checked = reportPostTargetSchema.parse(target)
    const kind = payload.document.header.kind
    if (
      !(await this.port.isEnabled(kind, checked)) ||
      !(await this.port.isConfirmed(kind, checked))
    )
      return { status: 'failed' }
    return reportDeliveryReceiptSchema.parse(
      await this.port.publish(checked, this.body(payload), {
        requester: `schedule:${scheduleId}`,
        idempotencyKey: `${scheduleId}:${payload.document.header.asOf}:${destinationId}`,
      }),
    )
  }
}
